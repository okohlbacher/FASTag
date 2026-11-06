// The acquisition probe of a run (1.12 item #7). See AcquisitionProbe.h.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "AcquisitionProbe.h"

#include "IndexedMzMLReader.h"
#include "MgfReader.h"
#include "MzPeakStream.h"

#include <OpenMS/CONCEPT/Exception.h>
#include <OpenMS/FORMAT/FileHandler.h>
#include <OpenMS/FORMAT/MzPeakFile.h>
#include <OpenMS/KERNEL/OnDiscMSExperiment.h>

#include <functional>
#include <memory>

using namespace OpenMS;

namespace FASTag::Acquisition
{
  ProbeLimits probeLimits(std::size_t probe_spectra)
  {
    ProbeLimits lim;
    lim.max_ms2 = probe_spectra;
    lim.max_spectra = probe_spectra * 10;
    return lim;
  }

  ProbeResult probeRun(const std::string& in, const ProbeSource& src, std::size_t probe_spectra, const Thresholds& t)
  {
    ProbeResult r;
    const ProbeLimits lim = probeLimits(probe_spectra);
    try
    {
      if (src.mzpeak)
      {
        r.ms2 = FASTag::probeMzPeakMetadata(in, lim, src.mzpeak_threads);
      }
      else
      {
        // DIAspeXtract and diaTracer name themselves in the mzML header.
        const bool provenance = !src.mgf && mzmlHeaderProvenance(in);
        std::function<MSSpectrum(Size)> head;
        std::shared_ptr<PeakMap> od_meta;
        if (src.mgf)
          head = [&](Size i) {
            try
            {
              return src.mgf->getSpectrum(i);
            }
            catch (const Exception::BaseException&)
            {
              return MSSpectrum();
            }
          };
        else if (src.fastmz)
          head = [&](Size i) { return src.fastmz->getSpectrumMetadata(i); };
        else if (src.ondisc && (od_meta = src.ondisc->getMetaData()))
          head = [&](Size i) { return i < od_meta->size() ? (*od_meta)[i] : MSSpectrum(); };
        else if (src.exp)
          head = [&](Size i) { return i < src.exp->size() ? (*src.exp)[i] : MSSpectrum(); };
        else
          head = [](Size) { return MSSpectrum(); };
        r.ms2 = collectMs2Meta(src.n_total, head, lim, provenance);
      }
    }
    catch (const Exception::BaseException& e)
    {
      r.ok = false;
      r.error = e.what();
      r.ms2.clear();
      return r;
    }
    r.call = classifyAcquisition(r.ms2, t);
    return r;
  }

  ProbeResult probeFile(const std::string& in, std::size_t probe_spectra, int mzpeak_threads, const Thresholds& t)
  {
    ProbeSource src;
    std::unique_ptr<FASTag::MgfReader> mgf;
    std::unique_ptr<FASTag::IndexedMzMLReader> fastmz;
    auto ondisc = std::make_unique<OnDiscMSExperiment>();
    PeakMap exp;
    try
    {
      if (FileHandler::getTypeByFileName(in) == FileTypes::MZPEAK || MzPeakFile::isMzPeak(in))
      {
        src.mzpeak = true;
        src.mzpeak_threads = mzpeak_threads;
      }
      else if (FileHandler::getTypeByFileName(in) == FileTypes::MGF)
      {
        mgf = std::make_unique<FASTag::MgfReader>(in);
        src.mgf = mgf.get();
        src.n_total = mgf->getNrSpectra();
      }
      else
      {
        auto candidate = std::make_unique<FASTag::IndexedMzMLReader>(in);
        if (candidate->ok() && candidate->reportsSpectrumMetadata())
        {
          fastmz = std::move(candidate);
          src.fastmz = fastmz.get();
          src.n_total = fastmz->getNrSpectra();
        }
        else if (ondisc->openFile(in))
        {
          src.ondisc = ondisc.get();
          src.n_total = ondisc->getNrSpectra();
        }
        else
        {
          FileHandler().loadExperiment(in, exp, {FileTypes::MZML});
          src.exp = &exp;
          src.n_total = exp.size();
        }
      }
    }
    catch (const Exception::BaseException& e)
    {
      ProbeResult r;
      r.ok = false;
      r.error = e.what();
      return r;
    }
    return probeRun(in, src, probe_spectra, t);
  }
}
