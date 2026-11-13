// The acquisition probe of a run (1.12 item #7). See AcquisitionProbe.h.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#include "AcquisitionProbe.h"

#include "IndexedMzMLReader.h"
#include "MgfReader.h"
#include "MzPeakStream.h"

#include <OpenMS/CONCEPT/Exception.h>
#include <OpenMS/FORMAT/FileHandler.h>
#include <OpenMS/FORMAT/MzPeakFile.h>
#include <OpenMS/KERNEL/OnDiscMSExperiment.h>

#include <algorithm>
#include <exception>
#include <functional>
#include <memory>
#include <optional>
#include <vector>

#ifdef _OPENMP
#include <omp.h>
#endif

using namespace OpenMS;

namespace FASTag::Acquisition
{
  namespace
  {
    /// collectMs2Meta() over the fast reader, read in parallel (1.12.2).
    ///
    /// The result is collectMs2Meta()'s, element for element: the same
    /// spectra in the same order, the same stop. Heads are read in rounds of
    /// at least the MS2 still wanted -- every head gives at most one, so a
    /// round never reads past where the serial loop would have stopped,
    /// except the minimum round of a few per thread at the very end -- each
    /// thread through its own reader, and the round is then taken in index
    /// order exactly as the serial loop takes it. A read that throws is
    /// rethrown when the serial loop would have reached it, and not at all
    /// otherwise. Only the fields fromSpectrum() reads are parsed
    /// (IndexedMzMLReader::PROBE_FIELDS). One thread, or a per-thread reader
    /// that cannot open the file, gives the serial loop.
    std::vector<Ms2Meta> collectFastMs2Meta(FASTag::IndexedMzMLReader& reader, std::size_t n_total,
                                            const ProbeLimits& limits, bool run_provenance)
    {
      constexpr unsigned kFields = FASTag::IndexedMzMLReader::PROBE_FIELDS;
      const std::size_t heads = std::min(n_total, limits.max_spectra);
      int threads = 1;
#ifdef _OPENMP
      threads = std::max(1, omp_get_max_threads());
#endif
      std::vector<std::unique_ptr<FASTag::IndexedMzMLReader>> copies;
      if (threads > 1 && heads > 1)
      {
        for (int t = 1; t < threads; ++t)
        {
          auto c = std::make_unique<FASTag::IndexedMzMLReader>(reader);
          if (!c->ok())
          {
            copies.clear();
            break;
          }
          copies.push_back(std::move(c));
        }
      }
      std::vector<Ms2Meta> out;
      if (copies.empty())
      {
        for (std::size_t i = 0; i < heads && out.size() < limits.max_ms2; ++i)
          if (auto m = fromSpectrum(reader.getSpectrumMetadata(i, kFields), run_provenance)) out.push_back(*m);
        return out;
      }
      const int team = static_cast<int>(copies.size()) + 1;
      const std::size_t min_round = static_cast<std::size_t>(team) * 16;
      std::vector<std::optional<Ms2Meta>> got;
      std::vector<std::exception_ptr> failed;
      std::size_t i = 0;
      while (i < heads && out.size() < limits.max_ms2)
      {
        const std::size_t round = std::min(heads - i, std::max(limits.max_ms2 - out.size(), min_round));
        got.assign(round, std::nullopt);
        failed.assign(round, nullptr);
#pragma omp parallel for num_threads(team) schedule(dynamic, 8)
        for (std::ptrdiff_t k = 0; k < static_cast<std::ptrdiff_t>(round); ++k)
        {
          int tid = 0;
#ifdef _OPENMP
          tid = omp_get_thread_num();
#endif
          FASTag::IndexedMzMLReader& r = tid == 0 ? reader : *copies[static_cast<std::size_t>(tid - 1)];
          try
          {
            got[static_cast<std::size_t>(k)] =
                fromSpectrum(r.getSpectrumMetadata(i + static_cast<std::size_t>(k), kFields), run_provenance);
          }
          catch (...)
          {
            failed[static_cast<std::size_t>(k)] = std::current_exception();
          }
        }
        for (std::size_t k = 0; k < round && out.size() < limits.max_ms2; ++k)
        {
          if (failed[k]) std::rethrow_exception(failed[k]);
          if (got[k]) out.push_back(*got[k]);
        }
        i += round;
      }
      return out;
    }
  }

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
          head = nullptr;  // collectFastMs2Meta() below
        else if (src.ondisc && (od_meta = src.ondisc->getMetaData()))
          head = [&](Size i) { return i < od_meta->size() ? (*od_meta)[i] : MSSpectrum(); };
        else if (src.exp)
          head = [&](Size i) { return i < src.exp->size() ? (*src.exp)[i] : MSSpectrum(); };
        else
          head = [](Size) { return MSSpectrum(); };
        r.ms2 = src.fastmz && !src.mgf ? collectFastMs2Meta(*src.fastmz, src.n_total, lim, provenance)
                                       : collectMs2Meta(src.n_total, head, lim, provenance);
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
