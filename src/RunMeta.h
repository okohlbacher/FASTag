// The shared run report section (FASTag 1.12, P4).
//
// Every long-form report (-digest_out, -label_out, -massgap_out, and the 1.12
// reports to come) starts with the same `run` rows in the five-column
// section/key/value/n/description format of FASTag::Digest::writeReport. This
// header owns those rows. RunMeta is filled ONCE per run, after option
// parsing, and every report takes its rows from runRows(); a report never
// builds run rows of its own.
//
// Rules for 1.12 work (PLAN-INTEGRATION section 2.1):
//   - A cluster that needs a run-level fact (acquisition class #7, picking
//     counts #9, charge sources #6, activation counts #15, census counts #11,
//     ...) adds FIELDS to its own anchored block in RunMeta below and rows to
//     its own anchored block in runRows() -- never a section of its own.
//   - The row format is frozen at kFormatVersion. Legacy output (Emit::LEGACY,
//     the default and the only mode any caller uses today) is byte-identical
//     to FASTag 1.11: the 7 `run` rows, no version row, no cluster rows.
//   - Emit::VERSIONED is the 1.12 format: the legacy rows, then a
//     `run_report_version` row, then the cluster rows. It is not emitted by
//     default; switching a report to it is a default change that needs new
//     references (refs-1.12.0) and a user decision.
//   - Any change to a row's key, order, value formatting or description, or a
//     new row, bumps kFormatVersion and updates test/runmeta_test.cpp.
//
// Instrument metadata read for -digest_out (instrument, native ID format, ion
// mobility, scan window) stays in FASTag::Digest::RunMeta (Digest.h) and its
// `meta` section; it is filled only when that report is written.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#pragma once

#include "Digest.h"

#include <cmath>
#include <cstddef>
#include <string>
#include <vector>

namespace FASTag::RunReport
{
  /// Version of the run section format written by Emit::VERSIONED.
  /// 1 = the FASTag 1.11 `run` rows followed by `run_report_version`.
  /// 2 = format 1, then the E picking rows (#9).
  /// 3 = format 2, then the E activation rows (#15 phase A).
  /// 4 = format 3, then the E precursor-hypothesis rows (#6, wave 2).
  /// 5 = format 4, then the E ion-series rows (#15 phase B, wave 2).
  /// 6 = format 5, then the 1.13 complement-tolerance rows (backlog item 15).
  ///     They are written only under -complement_tolerance_unit auto; a
  ///     report without them is format 5 and says 5 (kFormatVersionNoAuto),
  ///     so every report of a run without auto keeps its bytes.
  /// Bumped once per item in the PLAN-INTEGRATION merge order (E#7 adds
  /// fields only, E#9 = 2, E#15A = 3, E#6 = 4, E#15B = 5).
  inline constexpr int kFormatVersion = 6;
  /// The version a Versioned report without the format-6 rows writes.
  inline constexpr int kFormatVersionNoAuto = 5;
  inline constexpr int kTmtFormatVersion = 7;  ///< adds opt-in TMT filtering decision

  /**
    @brief Run-level facts shared by every long-form report.

    Filled once per run, after option parsing (counts after the tagging loop).
  */
  struct RunMeta
  {
    // ---- run (FASTag 1.11; frozen, written by every report) ----
    std::string version;                  ///< FASTAG_VERSION
    std::string input;                    ///< basename of -in
    double fragment_tolerance = 0;        ///< -fragment_tolerance as parsed
    std::string fragment_tolerance_unit;  ///< -fragment_tolerance_unit
    std::vector<int> tag_lengths;         ///< seed lengths, ascending and distinct
    double subsample_fraction = 0;        ///< -subsample_fraction
    int subsample_spectra = 0;            ///< -subsample_spectra

    // ---- 1.12 E ----
    // #7: the acquisition class (Acquisition::modeName) and why; empty when
    // -acquisition_check off. A field only: no report writes a row for it
    // yet (Emit::VERSIONED rows need a format bump and new references).
    std::string acquisition;              ///< acquisition class (Acquisition::modeName)
    std::string acquisition_why;          ///< why that class was called
    // #9: -pick_profile (as read: the removed auto reads as legacy) and its
    // outcome (only mzPeak picks, in MzPeakStream); filled after the loop.
    std::string pick_profile = "legacy";  ///< -pick_profile
    std::size_t pick_picked = 0;          ///< profile MS2 centroided
    std::size_t pick_failed = 0;          ///< profile MS2 kept as profile (picking yielded nothing)
    // #15 phase A: tagged MS2 spectra per activation class (src/IonSeries.h);
    // filled after the tagging loop.
    std::size_t activation_collisional = 0;  ///< MS2 activated by collision (CID, HCD, PQD)
    std::size_t activation_electron = 0;     ///< MS2 activated by electron transfer or capture (ETD, ECD)
    std::size_t activation_hybrid = 0;       ///< MS2 activated by a hybrid method (EThcD, ETciD)
    std::size_t activation_unknown = 0;      ///< MS2 without an activation FASTag classifies
    // #6: -unknown_charge, -isotope_error and, per spectrum tagged, where its
    // selected hypothesis' charge came from (src/PrecursorHypotheses.h);
    // filled after the tagging loop. All zero at the defaults (no hypothesis
    // step runs).
    std::string unknown_charge = "assume2";  ///< -unknown_charge
    std::string isotope_error = "0";         ///< -isotope_error, comma-joined
    std::size_t charge_header = 0;           ///< selected: the precursor's charge
    std::size_t charge_possible = 0;         ///< selected: a listed possible charge
    std::size_t charge_inferred = 0;         ///< selected: an unambiguous infer call
    std::size_t charge_ambiguous = 0;        ///< selected: the call of an ambiguous pair
    std::size_t charge_assumed = 0;          ///< selected: 2 without evidence
    std::size_t charge_enumerated = 0;       ///< selected: one of -charge_min..-charge_max
    // 1.13 (backlog #14): -check_header_charge and its verdicts; rows only
    // when it is not off, so every report is unchanged at the default.
    std::string check_header_charge = "off";  ///< -check_header_charge
    std::size_t header_checked = 0;          ///< header-charged MS2 spectra checked
    std::size_t header_agree = 0;            ///< verdict agree
    std::size_t header_disagree = 0;         ///< verdict disagree
    std::size_t header_ambiguous = 0;        ///< verdict ambiguous
    std::size_t header_nocall = 0;           ///< verdict nocall
    std::size_t header_both = 0;             ///< tagged under the header charge and the check's
    std::size_t iso_shifted = 0;             ///< selected hypothesis with an isotope offset
    std::size_t multi_hypothesis = 0;        ///< spectra tagged under more than one hypothesis
    // #15 phase B: -ion_series and the tagged MS2 spectra per series; filled
    // after the tagging loop.
    std::string ion_series = "by";           ///< -ion_series
    std::size_t ion_series_ms2_by = 0;       ///< MS2 tagged as b/y ions
    std::size_t ion_series_ms2_cz = 0;       ///< MS2 tagged as c/z-dot ions
    // 1.13 item 10: spectra read in two passes (b/y and c/z-dot), and whether
    // the run ran under auto + -ion_series_hybrid both: only then the
    // ion_series_hybrid row is written.
    std::size_t ion_series_ms2_hybrid = 0;   ///< MS2 tagged in two passes (b/y and c/z-dot)
    bool ion_series_hybrid_row = false;      ///< write the ion_series_hybrid row
    // ---- 1.13 item 15 ----
    // -complement_tolerance_unit auto (src/ComplementTol.h): whether it ran,
    // whether the probe measured a window, the window in force (Da) and the
    // probe's statistics. Written (format 6) only when complement_tol_auto.
    bool complement_tol_auto = false;     ///< -complement_tolerance_unit auto ran (format-6 rows)
    bool complement_tol_measured = false; ///< the probe measured a window
    double complement_tol = 0;          ///< Da, in force (measured, or -complement_tolerance)
    std::string complement_tol_source = "fallback";  ///< measured, lower_bound or fallback
    double complement_tol_measured_value = 0;        ///< Da as measured (measured only)
    double complement_tol_window = 0;   ///< measurement window W, Da
    std::size_t complement_probe_ms2 = 0;        ///< MS2 spectra the probe tagged
    std::size_t complement_probe_confident = 0;  ///< of them, rank-1 tag at E <= 0.01
    std::size_t complement_probe_pairs = 0;      ///< signed errors within W
    double complement_probe_signal = 0;          ///< pairs minus the chance floor
    double complement_probe_median = 0;          ///< floor-corrected median error, Da (measured only)
    double complement_probe_mad = 0;             ///< floor-corrected MAD, Da (measured only)
    std::string complement_tol_why;              ///< why not measured (fallback only)
    std::string tmt_filter_mode = "off";         ///< requested TMT filter mode; rows unless "off"
    std::string tmt_filter_resolved;             ///< run-level TMT filter decision and probe counts
    // ---- 1.12 A ----
    // ---- 1.12 D ----
    // ---- 1.12 F ----
  };

  /**
    @brief Which rows runRows() writes.
  */
  enum class Emit
  {
    LEGACY,     ///< the 7 FASTag 1.11 `run` rows; the default
    VERSIONED,  ///< Legacy, then `run_report_version`, then the cluster rows
  };

  /**
    @brief The comma-joined seed lengths ("5" or "3,5").

    @param[in] lengths the seed lengths
    @return the lengths joined by commas
  */
  inline std::string joinLengths(const std::vector<int>& lengths)
  {
    std::string s;
    for (int L : lengths) s += (s.empty() ? "" : ",") + std::to_string(L);
    return s;
  }

  /**
    @brief The run rows every long-form report starts with.

    Legacy: the 7 FASTag 1.11 `run` rows. Versioned: those, then
    `run_report_version` (kFormatVersion, kFormatVersionNoAuto or
    kTmtFormatVersion), then the cluster rows.

    @param[in] m the run's facts
    @param[in] emit which rows to write
    @return the rows, in report order
  */
  inline std::vector<Digest::Row> runRows(const RunMeta& m, Emit emit = Emit::LEGACY)
  {
    using Digest::num;
    std::vector<Digest::Row> r;
    const std::string lens = joinLengths(m.tag_lengths);
    const std::string& unit = m.fragment_tolerance_unit;
    r.push_back({"run", "version", m.version, "-", "FASTag " + m.version + " wrote this report."});
    r.push_back({"run", "input", m.input, "-", "The spectra were read from " + m.input + "."});
    r.push_back({"run", "fragment_tolerance", num(m.fragment_tolerance), "-",
                 "The fragment tolerance is " + num(m.fragment_tolerance) + " " + unit + "."});
    r.push_back({"run", "fragment_tolerance_unit", unit, "-", "The fragment tolerance is in " + unit + "."});
    r.push_back({"run", "tag_length", lens, "-", "Tags were seeded at length " + lens + "."});
    r.push_back({"run", "subsample_fraction", num(m.subsample_fraction), "-",
                 "A fraction of " + num(m.subsample_fraction) + " of the spectra was tagged (0 = all)."});
    r.push_back({"run", "subsample_spectra", std::to_string(m.subsample_spectra), "-",
                 std::to_string(m.subsample_spectra) + " spectra were drawn for tagging (0 = all)."});
    if (emit == Emit::LEGACY) return r;

    const std::string v = std::to_string(m.tmt_filter_mode != "off" ? kTmtFormatVersion :
                                       m.complement_tol_auto ? kFormatVersion : kFormatVersionNoAuto);
    r.push_back({"run", "run_report_version", v, "-", "The run section follows FASTag run report format " + v + "."});
    // ---- 1.12 E ----
    {
      {
        // #9: value = spectra, n = profile MS2 that needed picking.
        const std::string n = std::to_string(m.pick_picked + m.pick_failed);
        r.push_back({"run", "pick_profile", m.pick_profile, "-",
                     "Profile MS2 was centroided under -pick_profile " + m.pick_profile + "."});
        const std::string pk = std::to_string(m.pick_picked), fl = std::to_string(m.pick_failed);
        r.push_back({"run", "profile_ms2_picked", pk, n,
                     pk + " of " + n + " profile MS2 spectra were centroided before tagging."});
        r.push_back({"run", "profile_ms2_kept", fl, n,
                     fl + " of " + n + " profile MS2 spectra were tagged as profile (picking yielded nothing)."});
      }
      {
        // #15 phase A: value = spectra of the class, n = all tagged MS2.
        const std::size_t all = m.activation_collisional + m.activation_electron + m.activation_hybrid
                              + m.activation_unknown;
        const std::string n = std::to_string(all);
        const auto row = [&](const char* key, std::size_t k, const std::string& how) {
          const std::string c = std::to_string(k);
          r.push_back({"run", key, c, n, c + " of " + n + " MS2 spectra " + how + "."});
        };
        row("activation_collisional", m.activation_collisional,
            "were activated by collision (CID, HCD, trap-type CID, PQD)");
        row("activation_electron", m.activation_electron,
            "were activated by electron transfer or capture (ETD, ECD)");
        row("activation_hybrid", m.activation_hybrid, "were activated by a hybrid method (EThcD, ETciD)");
        row("activation_unknown", m.activation_unknown, "carry no activation FASTag classifies");
      }
      {
        // #6: value = spectra, n = spectra with a selected hypothesis (0 at
        // the defaults, where no hypothesis step runs).
        r.push_back({"run", "unknown_charge", m.unknown_charge, "-",
                     "Precursors without a charge were tagged under -unknown_charge " + m.unknown_charge + "."});
        r.push_back({"run", "isotope_error", m.isotope_error, "-",
                     "Precursor isotope offsets " + m.isotope_error + " were considered."});
        const std::size_t all = m.charge_header + m.charge_possible + m.charge_inferred + m.charge_ambiguous
                              + m.charge_assumed + m.charge_enumerated;
        const std::string n = std::to_string(all);
        const auto row = [&](const char* key, std::size_t k, const std::string& how) {
          const std::string c = std::to_string(k);
          r.push_back({"run", key, c, n, c + " of " + n + " MS2 spectra " + how + "."});
        };
        row("charge_header", m.charge_header, "were reported at their precursor's charge");
        row("charge_possible", m.charge_possible, "were reported at a listed possible charge");
        row("charge_inferred", m.charge_inferred, "were reported at an inferred charge");
        row("charge_ambiguous", m.charge_ambiguous, "were reported at the better of two inferred charges");
        row("charge_assumed", m.charge_assumed, "were reported at charge 2 without charge evidence");
        row("charge_enumerated", m.charge_enumerated, "were reported at an enumerated charge");
        row("isotope_shifted", m.iso_shifted, "were reported at a precursor isotope offset other than 0");
        row("multi_hypothesis", m.multi_hypothesis, "were tagged under more than one precursor hypothesis");
        if (m.check_header_charge != "off")
        {
          // 1.13: value = spectra, n = header-charged MS2 spectra checked.
          r.push_back({"run", "check_header_charge", m.check_header_charge, "-",
                       "Header charges were checked under -check_header_charge " + m.check_header_charge + "."});
          const std::string hn = std::to_string(m.header_checked);
          const auto hrow = [&](const char* key, std::size_t k, const std::string& how) {
            const std::string c = std::to_string(k);
            r.push_back({"run", key, c, hn, c + " of " + hn + " header-charged MS2 spectra " + how + "."});
          };
          hrow("header_charge_agree", m.header_agree, "agree with their charge evidence");
          hrow("header_charge_disagree", m.header_disagree, "disagree with their charge evidence");
          hrow("header_charge_ambiguous", m.header_ambiguous, "have two close supported charges, neither the header");
          hrow("header_charge_nocall", m.header_nocall, "have no charge evidence either way");
          hrow("header_charge_both", m.header_both, "were tagged under their header charge and the charge the check found");
        }
      }
      {
        // #15 phase B: value = spectra read as the series, n = all tagged MS2.
        const std::string n = std::to_string(m.ion_series_ms2_by + m.ion_series_ms2_cz + m.ion_series_ms2_hybrid);
        r.push_back({"run", "ion_series", m.ion_series, "-",
                     "MS2 spectra were read under -ion_series " + m.ion_series + "."});
        const std::string by = std::to_string(m.ion_series_ms2_by), cz = std::to_string(m.ion_series_ms2_cz);
        r.push_back({"run", "ion_series_by", by, n, by + " of " + n + " MS2 spectra were tagged as b/y ions."});
        r.push_back({"run", "ion_series_cz", cz, n, cz + " of " + n + " MS2 spectra were tagged as c/z-dot ions."});
        if (m.ion_series_hybrid_row)
        {
          const std::string hy = std::to_string(m.ion_series_ms2_hybrid);
          r.push_back({"run", "ion_series_hybrid", hy, n,
                       hy + " of " + n + " MS2 spectra were tagged as b/y and as c/z-dot ions (hybrid, two passes)."});
        }
      }
    }
    // ---- 1.13 item 15 (format 6; only under -complement_tolerance_unit auto) ----
    if (m.complement_tol_auto)
    {
      // The window at full precision: given back as -complement_tolerance
      // with -complement_tolerance_unit Da it reproduces the run's tags.
      const std::string tol = num(m.complement_tol);
      const std::string w = num(m.complement_tol_window);
      r.push_back({"run", "complement_tolerance", tol, "-",
                   "The complement window in force was " + tol + " Da (-complement_tolerance_unit auto)."});
      const std::string& src = m.complement_tol_source;
      r.push_back({"run", "complement_tolerance_source", src, "-",
                   src == "measured"      ? "The window was measured on the run's probe."
                   : src == "lower_bound" ? "The measured window was below -complement_tolerance, the lower bound."
                                          : "The window is -complement_tolerance: " + m.complement_tol_why + "."});
      if (m.complement_tol_measured)
      {
        const std::string mv = num(m.complement_tol_measured_value);
        r.push_back({"run", "complement_tolerance_measured", mv, "-",
                     "The probe measured a complement window of " + mv + " Da."});
      }
      const std::string ms2 = std::to_string(m.complement_probe_ms2);
      const std::string conf = std::to_string(m.complement_probe_confident);
      const std::string pairs = std::to_string(m.complement_probe_pairs);
      r.push_back({"run", "complement_probe_confident", conf, ms2,
                   conf + " of " + ms2 + " probe MS2 spectra had a rank-1 tag at E <= 0.01."});
      const std::string sig = std::to_string(std::lround(m.complement_probe_signal));
      r.push_back({"run", "complement_probe_signal", sig, pairs,
                   pairs + " complement pairs fell within " + w + " Da, " + sig + " above the chance floor."});
      if (m.complement_tol_measured)
      {
        const std::string med = num(m.complement_probe_median), mad = num(m.complement_probe_mad);
        r.push_back({"run", "complement_probe_median", med, "-",
                     "The floor-corrected median complement error was " + med + " Da."});
        r.push_back({"run", "complement_probe_mad", mad, "-",
                     "The floor-corrected median absolute deviation of the complement error was " + mad + " Da."});
      }
    }
    if (m.tmt_filter_mode != "off")
    {
      r.push_back({"run", "tmt_pseudo_filter", m.tmt_filter_mode, "-", "Requested experimental TMT6/10 tag filtering mode."});
      r.push_back({"run", "tmt_pseudo_filter_resolved", m.tmt_filter_resolved, "-", "Run-level decision and deterministic probe counts; windows N=0.020, C=0.006 Da."});
    }
    // ---- 1.12 A ----
    // ---- 1.12 D ----
    // ---- 1.12 F ----
    return r;
  }
}
