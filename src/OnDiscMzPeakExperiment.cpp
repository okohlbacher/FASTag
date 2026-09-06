// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "OnDiscMzPeakExperiment.h"

#ifdef FASTAG_HAVE_MZPEAK_LIB

#include <OpenMS/CONCEPT/Exception.h>
#include <OpenMS/CONCEPT/LogStream.h>
#include <OpenMS/DATASTRUCTURES/DateTime.h>
#include <OpenMS/KERNEL/MSSpectrum.h>
#include <OpenMS/METADATA/DataProcessing.h>
#include <OpenMS/METADATA/Instrument.h>
#include <OpenMS/METADATA/InstrumentSettings.h>
#include <OpenMS/METADATA/IonDetector.h>
#include <OpenMS/METADATA/IonSource.h>
#include <OpenMS/METADATA/MassAnalyzer.h>
#include <OpenMS/METADATA/Precursor.h>
#include <OpenMS/METADATA/Sample.h>
#include <OpenMS/METADATA/Software.h>
#include <OpenMS/METADATA/SourceFile.h>
#include <OpenMS/METADATA/SpectrumSettings.h>
#include <OpenMS/PROCESSING/CENTROIDING/PeakPickerHiRes.h>

#include <mzpeak.h>
#include <mzpeak/run_metadata.h>
#include <mzpeak/util/manager.h>
#include <mzpeak/util/parquet.h>
#include <mzpeak/writer.h>
#include <parquet/metadata.h>

#include <boost/json.hpp>

#include <algorithm>
#include <atomic>
#include <exception>
#include <mutex>
#include <optional>
#include <vector>

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

    /// Largest signal row group across the archive's spectrum tables, in
    /// uncompressed bytes. Read from the Parquet footers, so it costs a few
    /// file opens and nothing else.
    std::size_t largestRowGroup(const MzPeak::Index& index)
    {
      using enum MzPeak::Schema::DataKind::Type;
      std::size_t best = 0;
      const auto manager = index.manager();
      for (const auto& file : index.files())
      {
        if (file.entity_type().type() != MzPeak::Schema::EntityType::Spectrum) continue;
        const auto kind = file.data_kind().type();
        if (kind != DataArray && kind != Peaks) continue;
        const auto fmd = manager->parquet(file)->file_metadata();
        for (int g = 0; g < fmd->num_row_groups(); ++g)
          best = std::max(best, static_cast<std::size_t>(fmd->RowGroup(g)->total_byte_size()));
      }
      return best;
    }

    /// Opening a Spectra over the shared index from several threads at once
    /// is what the per-thread copies do; the library's own lock covers its
    /// metadata cache, this one covers the file opens around it.
    std::mutex g_open_mutex;

    MzPeak::Spectra openSpectra(const MzPeak::Index& index)
    {
      // Lean metadata: the library caches the WHOLE descriptive metadata table
      // before the first peak is read, and Lean leaves out the CV-parameter
      // lists, scan windows and auxiliary arrays -- none of which FASTag reads.
      // It needs the id, MS level, retention time, representation and the
      // precursor isolation windows and selected ions, and Lean keeps all of
      // those. Measured on a 7,534-spectrum run: 25.9 MB -> 18.7 MB, of which
      // the live map is 10.2 MB -> 7.1 MB; the rest is Parquet columns Lean
      // never asks for and so never decodes.
      std::lock_guard<std::mutex> guard(g_open_mutex);
      return index.spectra(MzPeak::MetadataDetail::Lean);
    }

    /// The archive's raw run metadata travels with the settings under this
    /// key, so a write can start from it instead of from the lossy mapping.
    const char* const kRawMetaKey = "mzpeak_run_metadata_json";

    namespace json = boost::json;

    json::object cv(const char* name, const std::string& value, const char* accession = nullptr)
    {
      json::object o;
      if (accession) o["accession"] = accession;
      o["name"] = name;
      if (!value.empty()) o["value"] = value;
      return o;
    }

    std::optional<std::string> paramValue(const std::vector<MzPeak::CvParam>& params,
                                          const char* name)
    {
      for (const auto& p : params)
        if (p.name == name && p.value) return *p.value;
      return std::nullopt;
    }

    template <std::size_t N>
    int indexOf(const std::string (&names)[N], const std::string& value)
    {
      for (std::size_t i = 0; i < N; ++i)
        if (names[i] == value) return static_cast<int>(i);
      return -1;
    }

    /// OpenMS's "yyyy-MM-dd hh:mm:ss" <-> the format's ISO 8601. Fractions and
    /// zones past the seconds are dropped: OpenMS has no field for them.
    std::string isoFromOpenMS(const String& s) { std::string r(s); if (r.size() > 10) r[10] = 'T'; return r; }
    std::string openMSFromIso(std::string s)
    {
      if (s.size() > 19) s.resize(19);
      if (s.size() > 10) s[10] = ' ';
      return s;
    }
  }

  /****************************************************************************/
  /// What every copy of a reader shares: the archive, its run-level settings,
  /// the row-group size, and the picking counters.
  struct Shared
  {
    explicit Shared(const std::string& path) : index(MzPeak::open(path)) {}
    MzPeak::Index index;
    ExperimentalSettings settings;
    std::size_t row_group_bytes = 0;
    std::atomic<std::size_t> picked{0}, pick_failed{0};
  };

  struct OnDiscMzPeakExperiment::Impl
  {
    explicit Impl(const std::string& path)
      : shared(std::make_shared<Shared>(path)), spectra(openSpectra(shared->index))
    {
    }
    Impl(const Impl& other) : shared(other.shared), spectra(openSpectra(shared->index)) {}
    std::shared_ptr<Shared> shared;
    MzPeak::Spectra spectra;
    PeakPickerHiRes picker;
  };

  OnDiscMzPeakExperiment::OnDiscMzPeakExperiment(const std::string& path)
  try
    : impl_(std::make_unique<Impl>(path))
  {
    impl_->shared->settings = fromRunMetadata(impl_->shared->index.metadata());
    impl_->shared->row_group_bytes = largestRowGroup(impl_->shared->index);
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

  OnDiscMzPeakExperiment::OnDiscMzPeakExperiment(const OnDiscMzPeakExperiment& other)
    : impl_(std::make_unique<Impl>(*other.impl_))
  {
  }

  OnDiscMzPeakExperiment::~OnDiscMzPeakExperiment() = default;

  Size OnDiscMzPeakExperiment::getNrSpectra() const { return static_cast<Size>(impl_->spectra.size()); }
  const ExperimentalSettings& OnDiscMzPeakExperiment::getMetaData() const { return impl_->shared->settings; }
  std::size_t OnDiscMzPeakExperiment::maxRowGroupBytes() const { return impl_->shared->row_group_bytes; }
  std::size_t OnDiscMzPeakExperiment::nPicked() const { return impl_->shared->picked.load(); }
  std::size_t OnDiscMzPeakExperiment::nPickFailed() const { return impl_->shared->pick_failed.load(); }

  MSSpectrum OnDiscMzPeakExperiment::getSpectrum(Size i)
  {
    MSSpectrum spec;
    const MzPeak::Spectrum s = impl_->spectra[static_cast<std::size_t>(i)];
    // Decode peaks only for what the tool can use: FASTag tags MS2 and
    // -out_spectra only ever writes spectra that carried a tag, so an MS1's
    // peak arrays would be read, decoded, copied and thrown away.
    const bool ms2 = s.ms_level() == 2;
    toOpenMS(s, spec, ms2);
    if (!ms2 || spec.empty() || spec.getType() != SpectrumSettings::SpectrumType::PROFILE)
      return spec;

    // pick() copies the spectrum meta (precursors included) and stamps the
    // result CENTROID, so the caller sees a spectrum that is honestly labelled
    // and still carries what the tagger needs. A picker that returns nothing
    // has destroyed the spectrum rather than improved it (it happens on data
    // too sparse to have peak shapes); keep the profile points instead.
    MSSpectrum picked;
    try
    {
      impl_->picker.pick(spec, picked);
    }
    catch (const Exception::BaseException&)
    {
      ++impl_->shared->pick_failed;
      return spec;
    }
    if (picked.empty())
    {
      ++impl_->shared->pick_failed;
      return spec;
    }
    ++impl_->shared->picked;
    return picked;
  }

  /****************************************************************************/
  ExperimentalSettings fromRunMetadata(const MzPeak::RunMetadata& md)
  {
    ExperimentalSettings es;
    if (const auto& run = md.run())
    {
      if (run->id) es.setIdentifier(*run->id);
      if (run->start_time)
      {
        try
        {
          DateTime dt;
          dt.set(openMSFromIso(*run->start_time));
          es.setDateTime(dt);
        }
        catch (const Exception::BaseException&)
        {
          // A start time OpenMS cannot parse is not worth refusing the run for.
        }
      }
    }
    if (const auto& fd = md.file_description())
    {
      std::vector<SourceFile> files;
      for (const auto& sf : fd->source_files)
      {
        SourceFile f;
        if (sf.name) f.setNameOfFile(*sf.name);
        if (sf.location) f.setPathToFile(*sf.location);
        for (const auto& p : sf.parameters)
        {
          if (!p.value) continue;
          if (p.accession == "MS:1000569") f.setChecksum(*p.value, SourceFile::ChecksumType::SHA1);
          else if (p.accession == "MS:1000568") f.setChecksum(*p.value, SourceFile::ChecksumType::MD5);
        }
        files.push_back(f);
      }
      es.setSourceFiles(files);
    }
    if (!md.instrument_configurations().empty())
    {
      // The run's default configuration is the only one OpenMS can hold.
      const auto& ic = md.instrument_configurations().front();
      Instrument inst;
      if (auto v = paramValue(ic.parameters, "instrument model")) inst.setModel(*v);
      if (auto v = paramValue(ic.parameters, "instrument name")) inst.setName(*v);
      if (auto v = paramValue(ic.parameters, "vendor")) inst.setVendor(*v);
      if (auto v = paramValue(ic.parameters, "customization")) inst.setCustomizations(*v);
      for (const auto& c : ic.components)
      {
        const std::string type = c.component_type.value_or("");
        const Int order = static_cast<Int>(c.order.value_or(0));
        if (type == "source")
        {
          IonSource s;
          s.setOrder(order);
          if (auto v = paramValue(c.parameters, "ionization type"))
          {
            const int k = indexOf(IonSource::NamesOfIonizationMethod, *v);
            if (k >= 0) s.setIonizationMethod(static_cast<IonSource::IonizationMethod>(k));
          }
          inst.getIonSources().push_back(s);
        }
        else if (type == "analyzer")
        {
          MassAnalyzer a;
          a.setOrder(order);
          if (auto v = paramValue(c.parameters, "mass analyzer type"))
          {
            const int k = indexOf(MassAnalyzer::NamesOfAnalyzerType, *v);
            if (k >= 0) a.setType(static_cast<MassAnalyzer::AnalyzerType>(k));
          }
          inst.getMassAnalyzers().push_back(a);
        }
        else if (type == "detector")
        {
          IonDetector d;
          d.setOrder(order);
          if (auto v = paramValue(c.parameters, "detector type"))
          {
            const int k = indexOf(IonDetector::NamesOfType, *v);
            if (k >= 0) d.setType(static_cast<IonDetector::Type>(k));
          }
          inst.getIonDetectors().push_back(d);
        }
      }
      if (ic.software_reference)
      {
        for (const auto& sw : md.software_list())
          if (sw.id == *ic.software_reference)
            inst.setSoftware(Software(sw.id, sw.version.value_or("")));
      }
      es.setInstrument(inst);
    }
    if (!md.samples().empty())
    {
      const auto& s0 = md.samples().front();
      Sample s;
      s.setName(s0.name.value_or(s0.id));
      if (auto v = paramValue(s0.parameters, "organism")) s.setOrganism(*v);
      es.setSample(s);
    }
    if (!md.raw().empty()) es.setMetaValue(kRawMetaKey, json::serialize(md.raw()));
    return es;
  }

  /****************************************************************************/
  MzPeak::RunMetadata toRunMetadata(const ExperimentalSettings& es, const MSExperiment* exp)
  {
    json::object o;
    if (es.metaValueExists(kRawMetaKey))
    {
      try
      {
        o = json::parse(std::string(es.getMetaValue(kRawMetaKey).toString())).as_object();
      }
      catch (const std::exception&)
      {
        o.clear();
      }
    }

    // Not from an archive: build the block from what OpenMS holds.
    if (o.empty())
    {
      json::object run;
      if (!es.getIdentifier().empty()) run["id"] = std::string(es.getIdentifier());
      if (!es.getDateTime().isNull()) run["start_time"] = isoFromOpenMS(es.getDateTime().get());

      if (!es.getSourceFiles().empty())
      {
        json::array sfs;
        std::size_t n = 0;
        for (const auto& f : es.getSourceFiles())
        {
          json::object sf;
          sf["id"] = "sf_" + std::to_string(n++);
          if (!f.getNameOfFile().empty()) sf["name"] = std::string(f.getNameOfFile());
          if (!f.getPathToFile().empty()) sf["location"] = std::string(f.getPathToFile());
          json::array ps;
          if (!f.getChecksum().empty())
          {
            if (f.getChecksumType() == SourceFile::ChecksumType::SHA1)
              ps.push_back(cv("SHA-1", f.getChecksum(), "MS:1000569"));
            else if (f.getChecksumType() == SourceFile::ChecksumType::MD5)
              ps.push_back(cv("MD5", f.getChecksum(), "MS:1000568"));
          }
          sf["parameters"] = ps;
          sfs.push_back(sf);
        }
        json::object fd;
        fd["source_files"] = sfs;
        o["file_description"] = fd;
        run["default_source_file_id"] = "sf_0";
      }

      json::array software;
      const Instrument& inst = es.getInstrument();
      const bool have_inst = !inst.getName().empty() || !inst.getModel().empty()
          || !inst.getVendor().empty() || !inst.getIonSources().empty()
          || !inst.getMassAnalyzers().empty() || !inst.getIonDetectors().empty();
      if (have_inst)
      {
        json::object ic;
        ic["id"] = 0;
        json::array ps;
        if (!inst.getModel().empty()) ps.push_back(cv("instrument model", inst.getModel(), "MS:1000031"));
        if (!inst.getName().empty()) ps.push_back(cv("instrument name", inst.getName()));
        if (!inst.getVendor().empty()) ps.push_back(cv("vendor", inst.getVendor()));
        if (!inst.getCustomizations().empty())
          ps.push_back(cv("customization", inst.getCustomizations(), "MS:1000032"));
        ic["parameters"] = ps;
        json::array comps;
        auto comp = [&comps](const char* type, Int order, const char* pname, const std::string& value) {
          json::object c;
          c["component_type"] = type;
          c["order"] = order;
          json::array cp;
          cp.push_back(cv(pname, value));
          c["parameters"] = cp;
          comps.push_back(c);
        };
        for (const auto& s : inst.getIonSources())
          comp("source", s.getOrder(), "ionization type",
               IonSource::NamesOfIonizationMethod[static_cast<std::size_t>(s.getIonizationMethod())]);
        for (const auto& a : inst.getMassAnalyzers())
          comp("analyzer", a.getOrder(), "mass analyzer type",
               MassAnalyzer::NamesOfAnalyzerType[static_cast<std::size_t>(a.getType())]);
        for (const auto& d : inst.getIonDetectors())
          comp("detector", d.getOrder(), "detector type",
               IonDetector::NamesOfType[static_cast<std::size_t>(d.getType())]);
        ic["components"] = comps;
        if (!inst.getSoftware().getName().empty())
        {
          const std::string name(inst.getSoftware().getName());
          ic["software_reference"] = name;
          json::object sw;
          sw["id"] = name;
          if (!inst.getSoftware().getVersion().empty())
            sw["version"] = std::string(inst.getSoftware().getVersion());
          software.push_back(sw);
        }
        json::array ics;
        ics.push_back(ic);
        o["instrument_configuration_list"] = ics;
        run["default_instrument_id"] = 0;
      }

      if (!es.getSample().getName().empty() || !es.getSample().getOrganism().empty())
      {
        json::object s;
        s["id"] = "sample_0";
        if (!es.getSample().getName().empty()) s["name"] = std::string(es.getSample().getName());
        json::array ps;
        if (!es.getSample().getOrganism().empty())
          ps.push_back(cv("organism", es.getSample().getOrganism()));
        s["parameters"] = ps;
        json::array sl;
        sl.push_back(s);
        o["sample_list"] = sl;
      }

      if (!run.empty()) o["run"] = run;
      if (!software.empty()) o["software_list"] = software;
    }

    // The data-processing history is appended either way: FASTag's own
    // filtering step is what a written archive most needs to declare, and an
    // archive that came in with a history keeps it ahead of ours.
    if (exp && !exp->empty())
    {
      const auto dps = (*exp)[0].getDataProcessing();
      if (!dps.empty())
      {
        if (!o.contains("software_list")) o["software_list"] = json::array();
        json::array& sw_list = o["software_list"].as_array();
        json::array methods;
        int order = 0;
        for (const auto& dp : dps)
        {
          json::object m;
          m["order"] = order++;
          const std::string swname(dp->getSoftware().getName());
          if (!swname.empty())
          {
            m["software_reference"] = swname;
            bool listed = false;
            for (const auto& v : sw_list)
              if (v.is_object() && v.as_object().contains("id") && v.as_object().at("id").as_string() == swname)
                listed = true;
            if (!listed)
            {
              json::object sw;
              sw["id"] = swname;
              if (!dp->getSoftware().getVersion().empty())
                sw["version"] = std::string(dp->getSoftware().getVersion());
              sw_list.push_back(sw);
            }
          }
          json::array ps;
          for (const auto action : dp->getProcessingActions())
            ps.push_back(cv(DataProcessing::NamesOfProcessingAction[static_cast<std::size_t>(action)].c_str(), ""));
          m["parameters"] = ps;
          methods.push_back(m);
        }
        if (!o.contains("data_processing_method_list")) o["data_processing_method_list"] = json::array();
        json::array& dpl = o["data_processing_method_list"].as_array();
        json::object dpo;
        dpo["id"] = "dp_" + std::to_string(dpl.size());
        dpo["methods"] = methods;
        dpl.push_back(dpo);
        if (!o.contains("run") || !o["run"].is_object()) o["run"] = json::object();
        o["run"].as_object()["default_data_processing_id"] = dpo["id"];
      }
    }
    return MzPeak::RunMetadata(o);
  }

  /****************************************************************************/
  void writeMzPeak(const std::string& path, const MSExperiment& exp)
  {
    MzPeak::RunContents run;
    run.spectra.reserve(exp.size());
    for (const MSSpectrum& s : exp)
    {
      MzPeak::SpectrumData out;
      out.mz.reserve(s.size());
      out.intensity.reserve(s.size());
      // intensity is float32 in the library's SpectrumData and on disk
      // (arrow::float32); OpenMS's Peak1D intensity is float too, so this is
      // the exact value, not a narrowing.
      for (const Peak1D& p : s)
      {
        out.mz.push_back(p.getMZ());
        out.intensity.push_back(p.getIntensity());
      }
      // UNKNOWN goes to the data-arrays table: for a spectrum that declares no
      // representation the reader falls back to "wherever the data is", and
      // that is the table it looks in first.
      out.centroid = s.getType() == SpectrumSettings::SpectrumType::CENTROID;
      out.ms_level = static_cast<uint8_t>(std::min<UInt>(s.getMSLevel(), 255u));
      out.retention_time = s.getRT();  // seconds on both sides of this call
      switch (s.getInstrumentSettings().getPolarity())
      {
        case IonSource::Polarity::POSITIVE: out.polarity = 1; break;
        case IonSource::Polarity::NEGATIVE: out.polarity = -1; break;
        default: break;  // unknown stays absent rather than becoming 0
      }
      if (!s.getNativeID().empty()) out.id = s.getNativeID();

      for (const Precursor& prec : s.getPrecursors())
      {
        MzPeak::PrecursorData pd;
        // OpenMS keeps one m/z per precursor and no separate isolation target,
        // so the window is centred on it. It goes out as both: the reader
        // takes the selected ion's m/z (double) and falls back to the target
        // (float) only when no ion is present, so nothing is lost on the way
        // back.
        pd.isolation_target_mz = static_cast<float>(prec.getMZ());
        pd.isolation_lower_offset = static_cast<float>(prec.getIsolationWindowLowerOffset());
        pd.isolation_upper_offset = static_cast<float>(prec.getIsolationWindowUpperOffset());
        MzPeak::SelectedIonData ion;
        ion.mz = prec.getMZ();
        // OpenMS says "unknown charge" with 0; the format has a null for that.
        if (prec.getCharge() != 0) ion.charge = prec.getCharge();
        if (prec.getIntensity() > 0) ion.intensity = static_cast<float>(prec.getIntensity());
        pd.selected_ions.push_back(std::move(ion));
        out.precursors.push_back(std::move(pd));
      }
      run.spectra.push_back(std::move(out));
    }

    try
    {
      const MzPeak::RunMetadata md = toRunMetadata(exp.getExperimentalSettings(), &exp);
      MzPeak::write_run_archive(path, run, md.empty() ? nullptr : &md);
    }
    catch (const std::exception& e)
    {
      throw Exception::UnableToCreateFile(__FILE__, __LINE__, OPENMS_PRETTY_FUNCTION, path,
                                          std::string("mzPeak write failed: ") + e.what());
    }
  }
}

#endif  // FASTAG_HAVE_MZPEAK_LIB
