// Oxonium-ion detector: is this MS2 spectrum glycopeptide-bearing?
//
// A FLAG, not an identification: oxonium ions say "a glycan fragmented here"
// (glycopeptide, free glycan, or O-GlcNAc) and nothing about which peptide
// carries it. Reported per SPECTRUM in a separate TSV, deliberately NOT as a
// column of the tag TSV -- glyco spectra are precisely the tag-poor ones a
// tag-row column would systematically miss.
//
// Detection matches the accepted literature heuristics rather than anything
// locally tuned: flag = at least two distinct oxonium species
// matched (Toghi Eshghi et al. 2016 / GPQuest) AND their summed intensity is
// at least `min_fraction` of the base peak (MSFragger-Glyco's
// diagnostic_intensity_filter, default 0.10). Matching runs on the RAW peak
// list, before any peak-budget selection, so -max_peaks can never eat the
// oxonium region; oxonium ions are intrinsically singly charged, so 1+ m/z
// matching without deisotoping is correct, not a shortcut.
//
// A HexNAc fragment (the cross-ring and water losses 126.055 to 186.076)
// counts only when HexNAc 204.087 itself is matched: the fragments are
// evidence of that one HexNAc, not of a second species, and HexNAc
// glycopeptide spectra carry 204.087 itself. On PXD003531 and PXD020401
// 792 and 484 flags rested on HexNAc fragments alone, most often 126.055 +
// 144.066 with no 204.087 (FASTag 1.16); at 0.3 Da 126.055 also takes the
// TMT reporter 126.128. The sialic acid ions (NeuAc-H2O is often the
// stronger) count on their own.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#pragma once

#include <OpenMS/KERNEL/MSSpectrum.h>

#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

namespace FASTag
{
  /**
    @brief One diagnostic oxonium ion.
  */
  struct OxoniumIon
  {
    double mz;                      ///< singly-protonated m/z
    const char* name;               ///< glycan fragment name, e.g. "HexNAc"
    const char* parent = nullptr;   ///< a fragment's parent ion (its name), which must match for it to count
  };

  /**
    @brief Canonical oxonium ions.

    A superset of MSFragger-Glyco's defaults, plus the phospho-glycan
    diagnostics. HexNAc fragment 126.055 sits 0.073 Da from the TMT reporter
    126.128: separated cleanly at ppm tolerances, coincident at 0.3 Da -- the
    README carries that caveat.

    @return The static ion table, sorted by m/z.
  */
  inline const std::vector<OxoniumIon>& oxoniumTable()
  {
    static const std::vector<OxoniumIon> T = {
        {126.05495, "HexNAc-C2H6O3", "HexNAc"}, {138.05495, "HexNAc-CH6O3", "HexNAc"},
        {144.06552, "HexNAc-C2H4O2", "HexNAc"}, {163.06010, "Hex"},
        {168.06552, "HexNAc-2H2O", "HexNAc"},   {186.07608, "HexNAc-H2O", "HexNAc"},
        {204.08665, "HexNAc"},        {243.02638, "HexP"},
        {274.09213, "NeuAc-H2O"},     {290.08705, "NeuGc-H2O"},
        {292.10269, "NeuAc"},         {308.09761, "NeuGc"},
        {366.13948, "HexHexNAc"},     {405.07926, "HexNAcHexP"},
        {512.19737, "HexHexNAcdHex"}, {657.23488, "HexHexNAcNeuAc"},
    };
    return T;
  }

  /**
    @brief Result of the oxonium scan of one spectrum.
  */
  struct OxoniumScan
  {
    int n_matched = 0;        ///< distinct oxonium ions found (a fragment only with its parent)
    double frac = 0.0;        ///< summed matched intensity / base peak (can exceed 1)
    std::string ions;         ///< semicolon-joined names, "-" if none
    bool glyco = false;       ///< flagged: n_matched >= 2 and frac >= min_fraction
  };

  /**
    @brief Scans a raw spectrum for the table's oxonium ions.

    Takes the most intense peak in each ion's window; a fragment ion
    (OxoniumIon::parent) counts only when its parent ion matches. The
    spectrum is flagged when at least two ions count and their summed
    intensity is at least @p min_fraction of the base peak.

    @param[in] spec RAW spectrum, sorted by m/z.
    @param[in] frag_tol Fragment tolerance (ppm or Da, see @p tol_ppm).
    @param[in] tol_ppm True: window is mz*frag_tol*1e-6; false: frag_tol Da.
    @param[in] min_fraction Minimum summed matched intensity relative to the base peak.
    @return The scan result; empty or zero-intensity spectra give no match.
  */
  inline OxoniumScan scanOxonium(const OpenMS::MSSpectrum& spec, double frag_tol,
                                 bool tol_ppm, double min_fraction)
  {
    OxoniumScan out;
    out.ions = "-";
    if (spec.empty()) return out;

    double base = 0.0;
    for (const auto& p : spec) base = std::max(base, static_cast<double>(p.getIntensity()));
    if (base <= 0.0) return out;

    const auto& table = oxoniumTable();
    std::vector<double> found(table.size(), 0.0);
    for (std::size_t i = 0; i < table.size(); ++i)
    {
      const auto& ion = table[i];
      const double tol = tol_ppm ? ion.mz * frag_tol * 1e-6 : frag_tol;
      auto lo = std::lower_bound(spec.begin(), spec.end(), ion.mz - tol,
                                 [](const OpenMS::Peak1D& p, double v) { return p.getMZ() < v; });
      for (; lo != spec.end() && lo->getMZ() <= ion.mz + tol; ++lo)
        found[i] = std::max(found[i], static_cast<double>(lo->getIntensity()));
    }
    const auto parentFound = [&](const char* parent) {
      for (std::size_t j = 0; j < table.size(); ++j)
        if (std::string(table[j].name) == parent) return found[j] > 0.0;
      return false;
    };
    double matched_sum = 0.0;
    std::string names;
    for (std::size_t i = 0; i < table.size(); ++i)
    {
      const auto& ion = table[i];
      const double best = found[i];
      if (best > 0.0 && (!ion.parent || parentFound(ion.parent)))
      {
        ++out.n_matched;
        matched_sum += best;
        if (!names.empty()) names += ';';
        names += ion.name;
      }
    }
    out.frac = matched_sum / base;
    if (out.n_matched > 0) out.ions = std::move(names);
    out.glyco = out.n_matched >= 2 && out.frac >= min_fraction;
    return out;
  }
}
