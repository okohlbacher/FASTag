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
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
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
  /**
    @brief The reader a run is read through, for the probe.

    mzPeak (read by path), else the first non-null of mgf, fastmz, ondisc (an
    indexed mzML opened by OnDiscMSExperiment) and exp (an mzML loaded into
    memory).
  */
  struct ProbeSource
  {
    bool mzpeak = false;     ///< the run is mzPeak, read by path
    int mzpeak_threads = 1;  ///< OpenMP threads of the mzPeak metadata read
    FASTag::MgfReader* mgf = nullptr;              ///< MGF reader, or null
    FASTag::IndexedMzMLReader* fastmz = nullptr;   ///< FASTag's fast indexed mzML reader, or null
    OpenMS::OnDiscMSExperiment* ondisc = nullptr;  ///< indexed mzML opened by OnDiscMSExperiment, or null
    const OpenMS::PeakMap* exp = nullptr;          ///< mzML loaded into memory, or null
    std::size_t n_total = 0;  ///< spectra in the run (not used for mzPeak)
  };

  /**
    @brief What a probe found.

    ok = false: the input could not be read (FASTag exits INPUT_FILE_CORRUPT
    with @c error), @c call is then empty.
  */
  struct ProbeResult
  {
    bool ok = true;            ///< false when the input could not be read
    std::string error;         ///< the read error when ok is false
    std::vector<Ms2Meta> ms2;  ///< metadata of the probed MS2 spectra
    AcqCall call;              ///< the acquisition classification
  };

  /**
    @brief Probe limits for -acquisition_probe_spectra.
    @param[in] probe_spectra n: the number of MS2 to probe.
    @return Limits of the first n MS2, reading at most 10 n spectra.
  */
  ProbeLimits probeLimits(std::size_t probe_spectra);

  /**
    @brief Probes a run through an opened reader and classifies it.

    Reads metadata only: the fast reader's getSpectrumMetadata(), OnDisc's
    metadata map, or the map in memory; MGF leniently (a block that cannot be
    parsed is the tagging loop's to report, as before the check, so it counts
    as no MS2 here). mzML is marked pseudo-DDA from its header too
    (mzmlHeaderProvenance()). A reader error (an OpenMS exception) gives
    ok = false, as FASTag exits INPUT_FILE_CORRUPT on it.

    @param[in] in Input path (read directly for mzPeak; header provenance for mzML).
    @param[in] src The opened reader to probe through.
    @param[in] probe_spectra Number of MS2 to probe (see probeLimits()).
    @param[in] t Classification thresholds.
    @return The probe result.
  */
  ProbeResult probeRun(const std::string& in, const ProbeSource& src, std::size_t probe_spectra = 4000,
                       const Thresholds& t = Thresholds());

  /**
    @brief Opens an input as FASTag does and probes it with probeRun().

    Opens as FASTag does without -out_spectra (mzPeak; MGF; mzML through the
    fast reader when it reports spectrum metadata, else OnDiscMSExperiment,
    else loaded into memory). FASTag's own readers give the same Ms2Meta on
    every path (acquisition_test).

    @param[in] in Input path.
    @param[in] probe_spectra Number of MS2 to probe (see probeLimits()).
    @param[in] mzpeak_threads OpenMP threads of the mzPeak metadata read.
    @param[in] t Classification thresholds.
    @return The probe result; ok = false for an input that cannot be opened.
  */
  ProbeResult probeFile(const std::string& in, std::size_t probe_spectra = 4000, int mzpeak_threads = 1,
                        const Thresholds& t = Thresholds());
}
