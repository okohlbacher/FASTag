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
//   - The row format is frozen at kFormatVersion. Legacy output (Emit::Legacy,
//     the default and the only mode any caller uses today) is byte-identical
//     to FASTag 1.11: the 7 `run` rows, no version row, no cluster rows.
//   - Emit::Versioned is the 1.12 format: the legacy rows, then a
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
#pragma once

#include "Digest.h"

#include <cstddef>
#include <string>
#include <vector>

namespace FASTag::RunReport
{
  /// Version of the run section format written by Emit::Versioned.
  /// 1 = the FASTag 1.11 `run` rows followed by `run_report_version`.
  /// 2 = format 1, then the E picking rows (#9).
  /// 3 = format 2, then the E activation rows (#15 phase A). Bumped once per
  /// item in the PLAN-INTEGRATION merge order (E#7 adds fields only, E#9 = 2,
  /// E#15A = 3).
  /// 4 = format 3, then the E precursor-hypothesis rows (#6, wave 2).
  inline constexpr int kFormatVersion = 4;

  /// Run-level facts shared by every long-form report. Filled once per run.
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
    // yet (Emit::Versioned rows need a format bump and new references).
    std::string acquisition;
    std::string acquisition_why;
    // #9: -pick_profile and its outcome on every reader (mzML in the tagging
    // loop, mzPeak in MzPeakStream); filled after the tagging loop.
    std::string pick_profile = "legacy";  ///< -pick_profile
    std::size_t pick_picked = 0;          ///< profile MS2 centroided
    std::size_t pick_failed = 0;          ///< profile MS2 kept as profile (picking yielded nothing)
    // #15 phase A: tagged MS2 spectra per activation class (src/IonSeries.h);
    // filled after the tagging loop.
    std::size_t activation_collisional = 0;
    std::size_t activation_electron = 0;
    std::size_t activation_hybrid = 0;
    std::size_t activation_unknown = 0;
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
    std::size_t iso_shifted = 0;             ///< selected hypothesis with an isotope offset
    std::size_t multi_hypothesis = 0;        ///< spectra tagged under more than one hypothesis
    // ---- 1.12 A ----
    // ---- 1.12 D ----
    // ---- 1.12 F ----
  };

  /// Which rows runRows() writes.
  enum class Emit
  {
    Legacy,     ///< the 7 FASTag 1.11 `run` rows; the default
    Versioned,  ///< Legacy, then `run_report_version`, then the cluster rows
  };

  /// The comma-joined seed lengths ("5" or "3,5").
  inline std::string joinLengths(const std::vector<int>& lengths)
  {
    std::string s;
    for (int L : lengths) s += (s.empty() ? "" : ",") + std::to_string(L);
    return s;
  }

  /// The run rows every long-form report starts with.
  inline std::vector<Digest::Row> runRows(const RunMeta& m, Emit emit = Emit::Legacy)
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
    if (emit == Emit::Legacy) return r;

    const std::string v = std::to_string(kFormatVersion);
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
      }
    }
    // ---- 1.12 A ----
    // ---- 1.12 D ----
    // ---- 1.12 F ----
    return r;
  }
}
