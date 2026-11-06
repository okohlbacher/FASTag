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

#include <string>
#include <vector>

namespace FASTag::RunReport
{
  /// Version of the run section format written by Emit::Versioned.
  /// 1 = the FASTag 1.11 `run` rows followed by `run_report_version`.
  inline constexpr int kFormatVersion = 1;

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
    // ---- 1.12 A ----
    // ---- 1.12 D ----
    // ---- 1.12 F ----
    return r;
  }
}
