// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "MzPeakReader.h"

#ifdef FASTAG_HAVE_MZPEAK_LIB

#include <OpenMS/CONCEPT/Exception.h>
#include <OpenMS/CONCEPT/LogStream.h>
#include <OpenMS/KERNEL/MSSpectrum.h>
#include <OpenMS/METADATA/InstrumentSettings.h>
#include <OpenMS/METADATA/Precursor.h>
#include <OpenMS/METADATA/SpectrumSettings.h>
#include <OpenMS/PROCESSING/CENTROIDING/PeakPickerHiRes.h>

#include <mzpeak.h>

#include <exception>

using namespace OpenMS;

namespace FASTag
{
  namespace
  {
    /// Convert one library spectrum into the OpenMS spectrum the rest of the
    /// tool already knows how to handle.
    ///
    /// Only what the tagger and -out_spectra actually consume is mapped: peaks,
    /// MS level, retention time, precursors and the native ID. Anything richer
    /// (auxiliary arrays, scan windows, vendor trailers) is deliberately left
    /// behind rather than half-translated.
    void toOpenMS(const MzPeak::Spectrum& in, MSSpectrum& out, bool with_peaks)
    {
      // clear(true) shrink_to_fit's the peak buffer, so this reallocates once
      // per spectrum. Reusing the capacity via clear(false) measured no faster
      // (1.33 vs 1.27 s, run-to-run noise): the decode dominates.
      out.clear(true);

      // with_peaks == false leaves the peak arrays UNTOUCHED, and that is the
      // point: mz()/intensity() are what trigger the library's lazy Parquet
      // decode, so not calling them means the spectrum's chunk is never
      // decoded at all. Everything below reads only the cached metadata map.
      if (with_peaks)
      {
        const std::vector<double>& mz = in.mz();
        const std::vector<float>& intensity = in.intensity();
        // A spectrum whose arrays disagree is corrupt, not merely odd: pairing
        // them by index would invent peaks. Take the common prefix and say so.
        const size_t n = std::min(mz.size(), intensity.size());
        if (mz.size() != intensity.size())
        {
          OPENMS_LOG_WARN << "mzPeak spectrum '" << in.metadata().id << "' has "
                          << mz.size() << " m/z values against " << intensity.size()
                          << " intensities; using the first " << n << "." << std::endl;
        }
        out.reserve(n);
        for (size_t i = 0; i < n; ++i)
          out.push_back(Peak1D(mz[i], intensity[i]));
      }

      const MzPeak::SpectrumMetadata& meta = in.metadata();
      out.setNativeID(meta.id);
      // Carry the representation across. It is not cosmetic: mzPeak archives
      // converted from raw files routinely store PROFILE MS2 with an empty
      // centroid entry, and tagging profile samples is materially worse than
      // tagging centroids (measured: 80,990 tags against 122,098 for the same
      // run supplied as centroided mzML). Without this the caller cannot even
      // tell, and -out_spectra would mislabel what it wrote.
      if (meta.representation == "MS:1000127")
        out.setType(SpectrumSettings::SpectrumType::CENTROID);
      else if (meta.representation == "MS:1000128")
        out.setType(SpectrumSettings::SpectrumType::PROFILE);
      out.setMSLevel(in.ms_level() > 0 ? static_cast<UInt>(in.ms_level()) : 1u);
      // Polarity: mzPeak stores it as a signed scalar, OpenMS as an enum. Not
      // cosmetic -- it is the only place a downstream writer can learn it, and
      // -out_spectra otherwise emits spectra with no polarity at all.
      if (meta.polarity)
      {
        out.getInstrumentSettings().setPolarity(*meta.polarity > 0
                                                    ? IonSource::Polarity::POSITIVE
                                                    : IonSource::Polarity::NEGATIVE);
      }
      // The library hands retention time over in SECONDS (it converts from the
      // format's minutes at its own boundary), which is what OpenMS wants.
      if (meta.retention_time) out.setRT(*meta.retention_time);

      for (const MzPeak::PrecursorInfo& p : meta.precursors)
      {
        // One OpenMS Precursor per SELECTED ION, not per precursor record: a
        // DIA frame carries several selected ions under one precursor entry,
        // and collapsing them would hide every window but the first.
        for (const MzPeak::SelectedIonInfo& ion : p.selected_ions)
        {
          Precursor prec;
          if (ion.selected_ion_mz) prec.setMZ(*ion.selected_ion_mz);
          if (ion.charge_state) prec.setCharge(*ion.charge_state);
          if (p.isolation_window.target_mz && !ion.selected_ion_mz)
          {
            // No selected ion m/z: the isolation target is the best available
            // stand-in, and a precursor without an m/z is useless downstream.
            prec.setMZ(*p.isolation_window.target_mz);
          }
          if (p.isolation_window.lower_offset)
            prec.setIsolationWindowLowerOffset(*p.isolation_window.lower_offset);
          if (p.isolation_window.upper_offset)
            prec.setIsolationWindowUpperOffset(*p.isolation_window.upper_offset);
          out.getPrecursors().push_back(std::move(prec));
        }
        // A precursor record with no selected ion still describes an isolation
        // window; keep it so an MS2 is never silently precursor-less.
        if (p.selected_ions.empty() && p.isolation_window.target_mz)
        {
          Precursor prec;
          prec.setMZ(*p.isolation_window.target_mz);
          if (p.isolation_window.lower_offset)
            prec.setIsolationWindowLowerOffset(*p.isolation_window.lower_offset);
          if (p.isolation_window.upper_offset)
            prec.setIsolationWindowUpperOffset(*p.isolation_window.upper_offset);
          out.getPrecursors().push_back(std::move(prec));
        }
      }
    }
  }

  void streamMzPeak(const std::string& path, Interfaces::IMSDataConsumer& consumer)
  {
    try
    {
      MzPeak::Index index = MzPeak::open(path);
      // Lean metadata: the library caches the WHOLE descriptive metadata table
      // before the first peak is read, and Lean leaves out the CV-parameter
      // lists, scan windows and auxiliary arrays -- none of which FASTag reads.
      // It needs the id, MS level, retention time, representation and the
      // precursor isolation windows and selected ions, and Lean keeps all of
      // those. Measured on a 7,534-spectrum run: 25.9 MB -> 18.7 MB, of which
      // the live map is 10.2 MB -> 7.1 MB; the rest is Parquet columns Lean
      // never asks for and so never decodes.
      MzPeak::Spectra spectra = index.spectra(MzPeak::MetadataDetail::Lean);

      // Announce the count up front so a GUI progress bar is determinate from
      // the first spectrum, unlike the old push reader which learned it late.
      consumer.setExpectedSize(static_cast<Size>(spectra.size()), 0);

      // Default-configured picker: signal-to-noise off, so nothing is
      // discarded on a threshold the caller never chose. It is const and
      // stateless across calls, so one instance serves the whole run.
      PeakPickerHiRes picker;

      MSSpectrum spec, picked;
      size_t n_picked = 0, n_pick_failed = 0;
      for (const MzPeak::Spectrum& s : spectra)
      {
        // Decode peaks only for what the consumer can use. FASTag tags MS2 and
        // -out_spectra only ever writes spectra that carried a tag, so an MS1's
        // peak arrays are read, decoded, copied and thrown away. The spectrum is
        // still OFFERED (metadata only) so the consumer's progress counter keeps
        // the same denominator it has on the mzML path.
        const bool tagged_level = s.ms_level() == 2;
        toOpenMS(s, spec, tagged_level);

        if (tagged_level && !spec.empty() &&
            spec.getType() == SpectrumSettings::SpectrumType::PROFILE)
        {
          // pick() copies the spectrum meta (precursors included) and stamps
          // the result CENTROID, so the consumer sees a spectrum that is
          // honestly labelled and still carries what the tagger needs.
          try
          {
            picker.pick(spec, picked);
            // A picker that returns nothing has destroyed the spectrum rather
            // than improved it (it happens on data too sparse to have peak
            // shapes); keep the profile points instead of emitting an empty.
            if (picked.empty()) { ++n_pick_failed; consumer.consumeSpectrum(spec); }
            else { ++n_picked; consumer.consumeSpectrum(picked); }
          }
          catch (const Exception::BaseException& e)
          {
            ++n_pick_failed;
            OPENMS_LOG_DEBUG << "centroiding failed for '" << spec.getNativeID()
                             << "' (" << e.getName() << "); keeping profile points" << std::endl;
            consumer.consumeSpectrum(spec);
          }
          continue;
        }
        consumer.consumeSpectrum(spec);
      }
      // Once, at the end. Profile MS2 is a property of the archive the user
      // cannot see and would otherwise only notice as an unexplained tag count.
      if (n_picked > 0)
      {
        OPENMS_LOG_INFO << "mzPeak: centroided " << n_picked << " profile spectra on read"
                        << (n_pick_failed > 0
                              ? " (" + String(n_pick_failed) + " kept as profile: picking yielded nothing)"
                              : "")
                        << std::endl;
      }
    }
    catch (const Exception::BaseException&)
    {
      throw;  // already an OpenMS error with a usable message
    }
    catch (const std::exception& e)
    {
      throw Exception::ParseError(__FILE__, __LINE__, OPENMS_PRETTY_FUNCTION, path,
                                  std::string("mzPeak read failed: ") + e.what());
    }
  }
}

#endif  // FASTAG_HAVE_MZPEAK_LIB
