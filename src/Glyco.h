// Oxonium-ion detector: is this MS2 spectrum glycopeptide-bearing?
//
// A FLAG, not an identification: oxonium ions say "a glycan fragmented here"
// (glycopeptide, free glycan, or O-GlcNAc) and nothing about which peptide
// carries it. Reported per SPECTRUM in a separate TSV, deliberately NOT as a
// column of the tag TSV -- glyco spectra are precisely the tag-poor ones a
// tag-row column would systematically miss.
//
// Detection matches the accepted literature heuristics rather than anything
// locally tuned (shipped thresholds are literature values, per the
// synthetic-evidence rule): flag = at least two distinct oxonium species
// matched (Toghi Eshghi et al. 2016 / GPQuest) AND their summed intensity is
// at least `min_fraction` of the base peak (MSFragger-Glyco's
// diagnostic_intensity_filter, default 0.10). Matching runs on the RAW peak
// list, before any peak-budget selection, so -max_peaks can never eat the
// oxonium region; oxonium ions are intrinsically singly charged, so 1+ m/z
// matching without deisotoping is correct, not a shortcut.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#pragma once

#include <OpenMS/KERNEL/MSSpectrum.h>

#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

namespace FASTag
{
  struct OxoniumIon
  {
    double mz;         ///< singly-protonated m/z
    const char* name;
  };

  /// Canonical oxonium ions -- a superset of MSFragger-Glyco's defaults, plus
  /// the phospho-glycan diagnostics. HexNAc fragment 126.055 sits 0.073 Da
  /// from the TMT reporter 126.128: separated cleanly at ppm tolerances,
  /// coincident at 0.3 Da -- the README carries that caveat.
  inline const std::vector<OxoniumIon>& oxoniumTable()
  {
    static const std::vector<OxoniumIon> T = {
        {126.05495, "HexNAc-C2H6O3"}, {138.05495, "HexNAc-CH6O3"},
        {144.06552, "HexNAc-C2H4O2"}, {163.06010, "Hex"},
        {168.06552, "HexNAc-2H2O"},   {186.07608, "HexNAc-H2O"},
        {204.08665, "HexNAc"},        {243.02638, "HexP"},
        {274.09213, "NeuAc-H2O"},     {290.08705, "NeuGc-H2O"},
        {292.10269, "NeuAc"},         {308.09761, "NeuGc"},
        {366.13948, "HexHexNAc"},     {405.07926, "HexNAcHexP"},
        {512.19737, "HexHexNAcdHex"}, {657.23488, "HexHexNAcNeuAc"},
    };
    return T;
  }

  struct OxoniumScan
  {
    int n_matched = 0;        ///< distinct oxonium species found
    double frac = 0.0;        ///< summed matched intensity / base peak (can exceed 1)
    std::string ions;         ///< semicolon-joined names, "-" if none
    bool glyco = false;
  };

  /// Scan a RAW (m/z-sorted) spectrum for the table's ions at the run's
  /// fragment tolerance (`tol_ppm` ? mz*tol*1e-6 : tol Da), taking the most
  /// intense peak in each window.
  inline OxoniumScan scanOxonium(const OpenMS::MSSpectrum& spec, double frag_tol,
                                 bool tol_ppm, double min_fraction)
  {
    OxoniumScan out;
    out.ions = "-";
    if (spec.empty()) return out;

    double base = 0.0;
    for (const auto& p : spec) base = std::max(base, static_cast<double>(p.getIntensity()));
    if (base <= 0.0) return out;

    double matched_sum = 0.0;
    std::string names;
    for (const auto& ion : oxoniumTable())
    {
      const double tol = tol_ppm ? ion.mz * frag_tol * 1e-6 : frag_tol;
      auto lo = std::lower_bound(spec.begin(), spec.end(), ion.mz - tol,
                                 [](const OpenMS::Peak1D& p, double v) { return p.getMZ() < v; });
      double best = 0.0;
      for (; lo != spec.end() && lo->getMZ() <= ion.mz + tol; ++lo)
        best = std::max(best, static_cast<double>(lo->getIntensity()));
      if (best > 0.0)
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
