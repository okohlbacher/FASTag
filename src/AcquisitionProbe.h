// The acquisition probe of a run (1.12 item #7): which reader to probe
// through, the header provenance, the probe limits and the error mapping, in
// ONE place. FASTag's refusal calls probeRun() with the readers it has
// opened; a classification without a FASTag run (cluster F's -probe_input,
// the held-out manifests' pre-check) calls probeFile(), which opens the
// input the way FASTag does and then calls probeRun(). Both therefore give
// the AcqCall that FASTag logs as "Acquisition check: ..." and refuses on.
//
// Kept out of Acquisition.h, which is pure (fastag_core): this part needs
// the readers (IndexedMzMLReader, MgfReader, MzPeakStream).
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#pragma once

#include "Acquisition.h"

#include <OpenMS/KERNEL/MSExperiment.h>

#include <cstddef>
#include <string>
#include <vector>

namespace OpenMS
{
  class OnDiscMSExperiment;
}

namespace FASTag
{
  class IndexedMzMLReader;
  class MgfReader;
}

namespace FASTag::Acquisition
{
  /// The reader a run is read through, for the probe: mzPeak (read by path),
  /// else the first non-null of mgf, fastmz, ondisc (an indexed mzML opened
  /// by OnDiscMSExperiment) and exp (an mzML loaded into memory).
  struct ProbeSource
  {
    bool mzpeak = false;
    int mzpeak_threads = 1;  ///< OpenMP threads of the mzPeak metadata read
    FASTag::MgfReader* mgf = nullptr;
    FASTag::IndexedMzMLReader* fastmz = nullptr;
    OpenMS::OnDiscMSExperiment* ondisc = nullptr;
    const OpenMS::PeakMap* exp = nullptr;
    std::size_t n_total = 0;  ///< spectra in the run (not used for mzPeak)
  };

  /// What a probe found. ok = false: the input could not be read (FASTag
  /// exits INPUT_FILE_CORRUPT with @c error), @c call is then empty.
  struct ProbeResult
  {
    bool ok = true;
    std::string error;
    std::vector<Ms2Meta> ms2;
    AcqCall call;
  };

  /// -acquisition_probe_spectra n: the first n MS2, reading at most 10 n spectra.
  ProbeLimits probeLimits(std::size_t probe_spectra);

  /// Probe run @p in through @p src and classify it. Reads metadata only:
  /// the fast reader's getSpectrumMetadata(), OnDisc's metadata map, or the
  /// map in memory; MGF leniently (a block that cannot be parsed is the
  /// tagging loop's to report, as before the check, so it counts as no MS2
  /// here). mzML is marked pseudo-DDA from its header too
  /// (mzmlHeaderProvenance()). A reader error (an OpenMS exception) gives
  /// ok = false, as FASTag exits INPUT_FILE_CORRUPT on it.
  ProbeResult probeRun(const std::string& in, const ProbeSource& src, std::size_t probe_spectra = 4000,
                       const Thresholds& t = Thresholds());

  /// Open @p in as FASTag does without -out_spectra (mzPeak; MGF; mzML
  /// through the fast reader when it reports spectrum metadata, else
  /// OnDiscMSExperiment, else loaded into memory) and probeRun() it.
  /// FASTag's own readers give the same Ms2Meta on every path
  /// (acquisition_test). An input that cannot be opened gives ok = false.
  ProbeResult probeFile(const std::string& in, std::size_t probe_spectra = 4000, int mzpeak_threads = 1,
                        const Thresholds& t = Thresholds());
}
