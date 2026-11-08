// Raw-DIA detection for FASTag (1.12 item #7, cluster E).
//
// WHY: FASTag tags every MS2 with a precursor. On raw DIA the "precursor" is
// an isolation window that holds several peptides, usually without a charge,
// so FASTag tags it as 2+ with wrong flanking masses and complement
// statistics, and the run exits 0 as if nothing were wrong. Since 1.12 such
// input is refused (exit 11) by default, with advice to generate pseudo-DDA
// spectra first (DIAspeXtract; diaTracer for .d) and tag those.
//
// HOW: a metadata-only probe over the first MS2 of the run (Ms2Meta per MS2,
// from the precursor FASTag tags with: the first one), before any output is
// opened, and the pure classifier classifyAcquisition() below.
//
// The classifier is ported from prose-auto's detect_acquisition and
// window_periodicity (prose_auto/detect_instrument.py, release 0.1.10,
// prose-auto-20261029/harness/v0110c_code): a DIA scheme visits the same
// windows in the same order every cycle, so every window returns after
// exactly one cycle and the cycle holds each window once. Changes against
// prose-auto (PLAN-data-types.md, item #7):
//  1. Event collapse: runs of consecutive MS2 with the same rounded m/z and
//     the same isolation offsets are one event (frame-split diaPASEF, MSX,
//     and CID/ETD pairs on one DDA precursor).
//  2. Periodicity on the selected-ion m/z (what FASTag tags with), rounded to
//     0.1, not on the window centre: DIAspeXtract pseudo-spectra carry their
//     DIA window as isolation window but a real monoisotopic m/z.
//  3. No width criterion: Astral DIA uses ~2 Th windows.
//  4. Window coverage from the union of [target - lower, target + upper],
//     the target being the isolation window target, not the selected ion.
//  5. Charge: raw DIA is refused only when most MS2 are uncharged; a
//     periodic, tiling, mostly charged pattern only warns. No single signal
//     (missing selected ion, a target-only precursor, a wide window) refuses
//     on its own.
//  5b. Without recorded isolation windows (MGF, mzML without window
//     cvParams) periodicity and missing charges are not enough either: the
//     distinct m/z must form a regular grid (most consecutive spacings near
//     their median), as DIA window centres do. An uncharged PRM or
//     inclusion list of arbitrary targets is PRM, tagged as in 1.11.
//  6. Provenance: DIAspeXtract (spx_* userParams, its software entry) and
//     diaTracer (its software entry) mark pseudo-DDA, which always passes.
//     Provenance only ever passes a file.
//
// The thresholds are FROZEN after the development sweep (validation-registry
// rows E7-02 and E7-09: the prose-auto heldout and validation_v3 corpora,
// 183 public data sets, 13 of them Bruker .d converted to mzML, plus
// pseudo-DDA outputs, fixtures and the gate inputs). The sweep changed one
// value, min_periodicity 0.8 -> 0.2: converted raw diaPASEF writes the
// windows of one TIMS frame in a varying order, so a window returns after
// cycle-1, cycle or cycle+1 events and the share of the commonest gap falls
// to 0.26-0.53; |cycle - n_win| <= 0.1 n_win and n_win >= 5 are what keep
// DDA (hundreds of distinct m/z, short gaps) out. The release test on a fresh
// PRIDE sample (E7-03) is scored once on the frozen rule; it is not re-tuned.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#pragma once

#include <OpenMS/KERNEL/MSSpectrum.h>

#include <cstddef>
#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace FASTag::Acquisition
{
  /// What the probe records per MS2 (from its first precursor).
  struct Ms2Meta
  {
    double x = 0;       ///< selected-ion m/z: what FASTag tags with
    double target = 0;  ///< isolation window target m/z; x when the file gives none
    double lower = 0;   ///< isolation window lower offset (Th), 0 if none
    double upper = 0;   ///< isolation window upper offset (Th), 0 if none
    int charge = 0;     ///< precursor charge, 0 = none
    bool im = false;    ///< the spectrum or its precursor carries an ion mobility
    bool provenance = false;  ///< written by a pseudo-DDA generator (DIAspeXtract, diaTracer)
  };

  enum class Mode
  {
    Undetermined,  ///< too few repeats to judge (or no MS2)
    DDA,
    PseudoDDA,  ///< provenance of a pseudo-DDA generator
    PRM,        ///< periodic, but the windows do not tile a range (targeted)
    DIALike,    ///< periodic and tiling, but mostly charged: warn, tag
    DIA,        ///< raw DIA: refuse
  };

  /// The classifier's thresholds, frozen after the development sweep
  /// (validation-registry E7-09); the values of PLAN-data-types.md (item #7)
  /// except min_periodicity.
  struct Thresholds
  {
    std::size_t min_gaps = 10;         ///< repeat gaps needed to judge periodicity
    double min_periodicity = 0.2;      ///< share of gaps equal to the commonest gap (0.8 before E7-09)
    double cycle_tolerance = 0.1;      ///< |cycle - n_win| <= this * n_win
    std::size_t min_windows = 5;       ///< distinct m/z values in the cycle
    double windows_min_share = 0.5;    ///< events with an isolation window, for "windows recorded"
    double min_coverage = 0.8;         ///< union of the windows over [lo, hi]
    double min_span = 100.0;           ///< hi - lo, Th
    double dia_min_uncharged = 0.5;    ///< uncharged MS2 share to refuse a windowed scheme
    double nowin_min_uncharged = 0.9;  ///< the same without windows
    double nowin_max_spacing = 50.0;   ///< median spacing of the distinct m/z without windows, Th
    double nowin_grid_tolerance = 0.2; ///< a spacing within this share of the median lies on the grid ...
    double nowin_grid_min_share = 0.8; ///< ... and this share of the spacings must, to read as window centres
    double warn_min_width = 4.0;       ///< undetermined: warn from this median width ...
    double warn_min_uncharged = 0.9;   ///< ... and this uncharged share
    double min_provenance = 0.5;       ///< MS2 share with pseudo-DDA provenance to pass
  };

  /// The classification and the statistics behind it.
  struct AcqCall
  {
    Mode mode = Mode::Undetermined;
    bool warn = false;          ///< log a WARN (DIA-like, or a suspicious undetermined run)
    std::size_t n_ms2 = 0;      ///< MS2 probed
    std::size_t n_events = 0;   ///< after event collapse
    std::size_t n_gaps = 0;     ///< repeat gaps between events
    double per = 0;             ///< periodicity: share of gaps equal to the cycle
    std::size_t cycle = 0;      ///< the commonest gap, in events
    std::size_t n_win = 0;      ///< distinct rounded m/z values
    bool periodic = false;
    bool windows = false;       ///< isolation windows recorded
    double median_width = 0;    ///< of the recorded windows, Th
    double lo = 0, hi = 0;      ///< the window range, Th
    double coverage = 0;        ///< union of the windows over [lo, hi]
    double spacing = 0;         ///< median spacing of the distinct m/z values, Th
    double grid_share = 0;      ///< share of those spacings within nowin_grid_tolerance of the median
    double frac_uncharged = 0;  ///< of the MS2 probed
    double frac_provenance = 0;
    bool im = false;            ///< most MS2 carry an ion mobility (diaPASEF)
    std::string why;            ///< one sentence for the log
  };

  /// Classify the MS2 of a run, in file order.
  AcqCall classifyAcquisition(const std::vector<Ms2Meta>& ms2, const Thresholds& t = Thresholds());

  /// "DDA", "pseudo-DDA", "PRM/targeted", "DIA-like", "DIA", "DIA (diaPASEF)"
  /// or "undetermined".
  std::string modeName(const AcqCall& c);

  /// The Ms2Meta of @p s: empty unless it is an MS2 with a precursor (what
  /// FASTag tags). Reads only metadata. @p run_provenance marks every MS2 as
  /// pseudo-DDA (from the file header, see mzmlHeaderProvenance()); a
  /// spectrum also has provenance on its own when it carries a userParam
  /// "spx_*" (DIAspeXtract) or its data processing names DIAspeXtract or
  /// diaTracer.
  std::optional<Ms2Meta> fromSpectrum(const OpenMS::MSSpectrum& s, bool run_provenance = false);

  /// Probe limits: the first @p max_ms2 MS2 with a precursor, reading at
  /// most @p max_spectra spectra (heads) in all.
  struct ProbeLimits
  {
    std::size_t max_ms2 = 4000;
    std::size_t max_spectra = 40000;
  };

  /// Ms2Meta of the first MS2 among spectra 0..n_total-1, read through
  /// @p read (metadata only is enough). A leading MS1-only stretch is crossed
  /// up to the spectra limit.
  std::vector<Ms2Meta> collectMs2Meta(std::size_t n_total, const std::function<OpenMS::MSSpectrum(std::size_t)>& read,
                                      const ProbeLimits& limits, bool run_provenance = false);

  /// True when the head of mzML @p path (up to its spectrumList) names a
  /// pseudo-DDA generator: DIAspeXtract (its software entry or an spx:
  /// userParam) or diaTracer (its software id). Reads at most 4 MB.
  bool mzmlHeaderProvenance(const std::string& path);

  /// The refusal message (one paragraph) for raw DIA @p in.
  std::string refusalMessage(const AcqCall& c, const std::string& in);
  /// The machine-readable stderr line of a refusal:
  /// "FASTAG_REFUSED reason=raw_dia windows=<n> median_width=<w>".
  std::string refusalSentinel(const AcqCall& c);
  /// The WARN for a DIA-like or suspicious undetermined run; empty if none.
  std::string warningMessage(const AcqCall& c, const std::string& in);
  /// The WARN when -acquisition_check warn tags raw DIA anyway.
  std::string taggedAnywayMessage(const AcqCall& c, const std::string& in);
  /// The one INFO line every probed run logs.
  std::string infoLine(const AcqCall& c);
}
