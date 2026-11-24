// FASTag -- partial sequence tags from peptide MS/MS spectra.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
//
// Whether a tag's flanks put it at a peptide terminus, and which ion series
// a terminally anchored tag was read off (-terminus).
//
// The desktop GUI tests the same (gui/src/spectrum/terminus.ts,
// terminusFromFlanks), with the same tolerances and tokens.
#pragma once

#include "FASTagger.h"

#include <map>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace FASTag::Terminus
{
  /// 13C - 12C (PrecursorHypotheses' isotope spacing).
  inline constexpr double C13 = 1.0033548378;

  /// What terminus() needs of a spectrum: the run's fragment tolerance and
  /// the precursor the row was tagged under.
  struct Peaks
  {
    std::optional<double> precursor;  ///< precursor m/z
    int charge = 2;                   ///< precursor charge (2 when none was given)
    double tolerance = 20;
    bool ppm = true;
    /// The precursor isotope offset k the precursor m/z was already shifted
    /// by (the row's hypothesis, -isotope_error).
    int isotope = 0;
  };

  /// The fragment tolerance of @p s at m/z @p x, in Th.
  inline double tolAt(const Peaks& s, double x) { return s.ppm ? (x * s.tolerance) / 1e6 : s.tolerance; }

  /// Residue masses as the tagger has them: base residues with the fixed
  /// modifications folded in, I as L, and the variable modifications'
  /// residues by (residue, name) as written inline in a tag (M[Oxidation]).
  struct Residues
  {
    std::map<char, double> base;
    std::map<std::pair<char, std::string>, double> variable;
  };

  /**
    @brief The tagger's residue masses (OpenMS ResidueDB "Natural19WithoutI") under @p mods.

    @param[in] mods the run's modifications (Param::mods)
    @return the masses
  */
  Residues residuesFrom(const std::vector<ModSpec>& mods);

  /// What terminus() tests a tag's flanks against.
  struct Termini
  {
    /// Masses a terminal flank is "at": 0 plus the run's terminal
    /// modifications (fixed and variable, N-term and protein N-term on the N
    /// side, C-term and protein C-term on the C side), as the flanks carry them.
    std::vector<double> nterm{0.0}, cterm{0.0};
    /// The run's precursor isotope offsets k (-isotope_error); a precursor-side
    /// flank is also accepted (k - Peaks::isotope) * C13 off its target.
    std::vector<int> isotope{0};
    /// The single residues a flank can be one away by: label and mass (the
    /// tagger's residues, fixed modifications in, I and L apart, the variable
    /// ones as M[Oxidation]).
    std::vector<std::pair<std::string, double>> residues;
  };

  /**
    @brief The termini the run knows: @p res's residues, and the terminal modification masses given.

    @param[in] res the tagger's residues (residuesFrom)
    @param[in] nterm_mods N-terminal modification masses (0 is always a target)
    @param[in] cterm_mods C-terminal modification masses
    @param[in] isotope the run's -isotope_error offsets
  */
  Termini terminiFrom(const Residues& res, const std::vector<double>& nterm_mods = {},
                      const std::vector<double>& cterm_mods = {}, const std::vector<int>& isotope = {0});

  /**
    @brief The termini of a run: its residues under @p mods and the terminal ones of @p mod_names.

    A modification of @p mod_names (OpenMS names, fixed and variable) counts
    when it may sit on any residue at the N-terminus or protein N-terminus
    (nterm) or at the C-terminus or protein C-terminus (cterm); unknown names
    are skipped (the run refused them already).

    @param[in] mods the run's modifications (Param::mods)
    @param[in] mod_names the names of -fixed_modifications and -variable_modifications
    @param[in] isotope the run's -isotope_error offsets
  */
  Termini terminiOfRun(const std::vector<ModSpec>& mods, const std::vector<std::string>& mod_names,
                       const std::vector<int>& isotope);

  /**
    @brief Whether a tag's flanks put it at a peptide terminus.

    Each flank side is tested on its own. The side read from the peaks (nterm
    for b/c, cterm for y/z) has the fragment tolerance at the low peak times
    the fragment charge; the side from the precursor (the other) that plus the
    fragment tolerance at the precursor m/z times the precursor charge, and
    any isotope offset of Termini::isotope; without a precursor it is not
    tested. A side within its tolerance of a target is "N" / "C"; else one
    within it of a target plus one residue "N+K", several "N+[KQ]" (sorted as
    gap labels).

    @param[in] series b, y, c or z
    @param[in] charge the fragment charge
    @param[in] low_mz the low peak (the first ion of the series ladder)
    @param[in] nterm the N-terminal flank in the series' reading, before any clamp at 0
    @param[in] cterm the C-terminal flank in the series' reading, before any clamp at 0
    @param[in] s the peaks (tolerance, precursor, isotope)
    @param[in] t the targets
    @return the tokens, N side first, comma-separated ("N", "C+K", "N,C+[IL]"); empty if neither
  */
  std::string terminus(char series, int charge, double low_mz, double nterm, double cterm, const Peaks& s,
                       const Termini& t);

  /// The widest fragment tolerance the series call is made at: the anchors
  /// were measured at 20 ppm; above 25 ppm or 0.02 Da the precursor-side
  /// window meets a residue by chance (as the GUI's seriesTolerance).
  inline constexpr double SERIES_MAX_PPM = 25;
  inline constexpr double SERIES_MAX_DA = 0.02;

  /// Whether the series call is made at the tolerance of @p s.
  inline bool seriesTolerance(const Peaks& s) { return s.ppm ? s.tolerance <= SERIES_MAX_PPM : s.tolerance <= SERIES_MAX_DA; }

  /**
    @brief Whether the tokens of one reading may decide its series (the GUI's anchorUsed).

    By anchor kind, as measured at 20 ppm on PXD003531 (development) and
    PXD020401 (held out). Used: any N-side token (N, b1 = N+X from the peaks,
    y(n-1) = N+X from the precursor); the C terminus itself (C); a C-terminal
    K or R one residue away on the peak side (y1 or z1 of K/R, the run's K
    and R with their fixed modifications; a variably modified K[...] is not
    one); a C-terminal set holding a bare K or R, such as C+[KQ], on either
    side. Not used: a C-terminal K or R alone on the precursor side (b(n-1)
    or c(n-1)), and any other C-terminal residue on either side. Tokens with
    one used side are used.

    @param[in] series the reading: b, y, c or z
    @param[in] tokens its tokens as terminus() writes them ("N,C+K"); empty: none
  */
  bool anchorUsed(char series, const std::string& tokens);

  /// The -terminus columns of one tag row: the series call and its terminus tokens.
  struct Call
  {
    /// b or y when exactly one reading has tokens that anchorUsed() accepts
    /// and the tolerance is within seriesTolerance(), else "-"; always "-"
    /// for a c/z row (c/z anchors were not measured).
    std::string series = "-";
    /// Every token found, whether used or not: the one anchored reading's
    /// tokens; "y:<t>;b:<t>" when both are anchored; "-" when neither.
    std::string terminus = "-";
  };

  /**
    @brief Which series a tag was read off, from a terminal anchor of one of its two readings.

    The tag is read as written (y, or z for c/z) and reversed (b, or c),
    each with its own unclamped flanks from the low peak @p t.low_mz, the
    tag's residue masses @p t.res_mass and the precursor of @p s: as written
    N = M - (low + res_mass) - (H2O - offC), C = low - offC; reversed N =
    C(as written) + reversedOffset, C = N(as written) - reversedOffset (low as
    a neutral mass at the tag's charge, M the precursor's): the flanks the
    tagger writes, unclamped. A reading is anchored when terminus() finds a
    token for it; the series is the one reading whose tokens anchorUsed()
    accepts, and "-" above 25 ppm or 0.02 Da (seriesTolerance()) and for a
    c/z row (c/z anchors were never measured; terminus still lists its
    tokens).

    @param[in] t the tag (charge, low_mz, res_mass, ion_series)
    @param[in] s the precursor the tag was tagged under and the tolerance
    @param[in] terms the targets
    @return the call
  */
  Call seriesCall(const Tag& t, const Peaks& s, const Termini& terms);
}
