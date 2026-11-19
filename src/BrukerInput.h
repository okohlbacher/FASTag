// Bruker timsTOF input: a .d directory or a zipped one (.d.zip).
//
// WHY THIS EXISTS: FASTag reads mzML, mzPeak and MGF by itself. A timsTOF run
// is read through OpenMS's BrukerTimsFile (opentims, MIT; no Bruker SDK), which
// exists only in an OpenMS built with WITH_OPENTIMS=ON. This file keeps that
// dependency in one place, with what FASTag needs around it:
//
//   - facts(): counts from the run's analysis.tdf by SQL alone (MS1 and MS/MS
//     frames, precursors, precursors without a charge, dia-PASEF windows). For
//     a .d.zip only analysis.tdf is extracted. This is what refuses dia-PASEF
//     before anything large is unpacked or decoded, and what the census-style
//     counts of a run come from without decoding a single MS1 frame.
//   - loadMs2(): the DDA-PASEF MS2 spectra, one per precursor, centroided by
//     the reader, MS1 frames not decoded (Config::load_ms1 = false).
//
// Charge: a precursor whose monoisotopic peak the acquisition software did not
// find has no charge in analysis.tdf. The reader gives it charge 0 and the
// m/z of its most intense isotope peak. FASTag keeps charge 0 ("unknown"): the
// -unknown_charge mode decides how such a spectrum is tagged, and the reports
// record the charge source (assumed, inferred, ...) per spectrum, as for any
// other input.
//
// Temporary space: BrukerTimsFile unpacks a .d.zip in full into a directory
// under OpenMS's temporary directory (OPENMS_TMPDIR, else TMPDIR/TMP/TEMP) for
// the duration of the read: about the archive's unpacked size, 1-1.4x the
// archive for timsTOF runs. OpenMS refuses an archive whose declared size
// exceeds 90 % of the free space there; checkTempSpace() refuses earlier, from
// the archive's own size, and names the directory.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#pragma once

#include <OpenMS/KERNEL/MSExperiment.h>

#include <cstddef>
#include <cstdint>
#include <string>

namespace FASTag::Bruker
{
  /**
    @brief Whether this build reads Bruker timsTOF data (OpenMS with WITH_OPENTIMS).
  */
  bool supported();

  /**
    @brief Whether @p path names Bruker data by its form: a directory whose name ends
    in ".d" (a trailing separator allowed), or a file ending in ".d.zip".

    Names only; nothing is opened. The reader decides whether it can read it.
  */
  bool isBrukerPath(const std::string& path);

  /**
    @brief @p path without trailing separators ("run.d/" -> "run.d").
  */
  std::string normalizePath(const std::string& path);

  /**
    @brief The run name of a Bruker path: its base name without ".d" or ".d.zip".
  */
  std::string runName(const std::string& path);

  /// What analysis.tdf says about a run, by SQL alone.
  struct TdfFacts
  {
    bool ok = false;            ///< false: see error
    std::string error;          ///< why the facts could not be read
    std::size_t frames = 0;              ///< all frames
    std::size_t ms1_frames = 0;          ///< MsMsType 0
    std::size_t pasef_frames = 0;        ///< MsMsType 8 (DDA-PASEF MS/MS)
    std::size_t dia_frames = 0;          ///< MsMsType 9 (dia-PASEF MS/MS)
    std::size_t other_ms2_frames = 0;    ///< any other MsMsType
    std::size_t precursors = 0;          ///< rows of Precursors (DDA-PASEF)
    std::size_t precursors_no_charge = 0;  ///< of them, Charge NULL (or 0)
    std::size_t precursors_no_mono = 0;    ///< of them, MonoisotopicMz NULL
    std::size_t dia_windows = 0;         ///< rows of DiaFrameMsMsWindows
    double dia_median_width = 0;         ///< median IsolationWidth of those rows, Th
    bool tsf = false;                    ///< TSF data (no ion mobility): no analysis.tdf

    /// dia-PASEF: DIA windows or MS/MS frames of type 9.
    bool dia() const { return dia_windows > 0 || dia_frames > 0; }
  };

  /**
    @brief Reads TdfFacts from the analysis.tdf of @p path (.d or .d.zip).

    For a .d.zip only analysis.tdf is extracted, into OpenMS's temporary
    directory, and removed again. Never throws; see TdfFacts::ok.
  */
  TdfFacts facts(const std::string& path);

  /**
    @brief For a .d.zip: an error message when the temporary directory cannot hold
    the unpacked run, else empty. A .d directory needs no space: always empty.

    The unpacked run is at least the archive's size (the archive is deflated);
    the check asks for 1.5x the archive's size free, which covers the timsTOF
    runs measured (1.0-1.4x).

    @param[in] path The input.
    @param[out] tmp_dir The temporary directory checked (for the log).
    @param[out] free_bytes Its free space (0 if unknown).
  */
  std::string checkTempSpace(const std::string& path, std::string& tmp_dir, std::uintmax_t& free_bytes);

  /// What loadMs2() read.
  struct LoadStats
  {
    std::size_t spectra = 0;        ///< MS2 spectra loaded
    std::size_t charge_unknown = 0; ///< of them, precursor charge 0
    double seconds = 0;             ///< wall time of the read (unpacking included)
  };

  /**
    @brief Loads the MS2 spectra of a DDA-PASEF run: one centroided spectrum per
    precursor, with its m/z, charge (0 = unknown), intensity and 1/K0; MS1 frames
    are not decoded.

    @throws Exception::BaseException as BrukerTimsFile::load() does
    (Exception::NotImplemented when the build has no Bruker support).
  */
  LoadStats loadMs2(const std::string& path, OpenMS::PeakMap& exp);

  /**
    @brief Loads the MS2 spectra of the first @p max_frames frames only (a probe):
    as loadMs2() otherwise.
  */
  LoadStats loadMs2Head(const std::string& path, OpenMS::PeakMap& exp, std::uint32_t max_frames);

  /**
    @brief The refusal of a dia-PASEF run, in the words of the acquisition check.
  */
  std::string diaRefusalMessage(const TdfFacts& f, const std::string& in);

  /**
    @brief The machine-readable stderr line of that refusal (as Acquisition::refusalSentinel()).
  */
  std::string diaRefusalSentinel(const TdfFacts& f);
}
