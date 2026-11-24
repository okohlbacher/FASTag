// Oxonium detector: count rule, fraction rule, tolerance semantics, and the
// scan-range edge. Thresholds under test are literature values (>= 2 ions,
// 0.10 base-peak fraction), never locally fitted.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "Glyco.h"

#include <cstdio>
#include <string>

using namespace FASTag;
using OpenMS::MSSpectrum;

namespace
{
  int failures = 0;
  void check(bool ok, const std::string& what)
  {
    if (!ok) { std::fprintf(stderr, "FAIL: %s\n", what.c_str()); ++failures; }
  }

  MSSpectrum spec(std::initializer_list<std::pair<double, float>> peaks)
  {
    MSSpectrum s;
    for (const auto& p : peaks) s.emplace_back(p.first, p.second);
    s.sortByPosition();
    return s;
  }
}

int main()
{
  // Dominant HexNAc 204.0867 + HexHexNAc 366.1395 over modest b/y peaks.
  {
    const auto g = scanOxonium(
        spec({{204.08665, 800}, {366.13948, 400}, {500.3, 1000}, {700.4, 300}}),
        20, true, 0.10);
    check(g.n_matched == 2, "two oxonium species matched");
    check(g.glyco, "dominant oxonium pair flags the spectrum");
    check(g.ions.find("HexNAc") != std::string::npos, "ion names reported");
  }
  // b/y-only spectrum: nothing near any oxonium m/z.
  {
    const auto g = scanOxonium(spec({{350.2, 500}, {480.3, 800}, {610.35, 400}}), 20, true, 0.10);
    check(g.n_matched == 0 && !g.glyco && g.ions == "-", "clean spectrum stays unflagged");
  }
  // Single 204 alone: count rule (>= 2 species) refuses.
  {
    const auto g = scanOxonium(spec({{204.08665, 900}, {500.0, 1000}}), 20, true, 0.10);
    check(g.n_matched == 1 && !g.glyco, "one species is not enough");
  }
  // Two ions at 5% of base: fraction rule refuses.
  {
    const auto g = scanOxonium(
        spec({{204.08665, 30}, {366.13948, 20}, {500.0, 1000}}), 20, true, 0.10);
    check(g.n_matched == 2 && !g.glyco, "sub-threshold intensity is not enough");
  }
  // ppm tolerance edges: a peak 22 ppm off 204.0867 misses at 20 ppm, hits at 25.
  {
    const double off = 204.08665 * (1.0 + 22e-6);
    const auto g20 = scanOxonium(spec({{off, 900}, {366.13948, 900}, {500.0, 1000}}), 20, true, 0.10);
    const auto g25 = scanOxonium(spec({{off, 900}, {366.13948, 900}, {500.0, 1000}}), 25, true, 0.10);
    check(g20.n_matched == 1, "22 ppm off misses at 20 ppm");
    check(g25.n_matched == 2 && g25.glyco, "22 ppm off hits at 25 ppm");
  }
  // Da tolerance path.
  {
    const auto g = scanOxonium(
        spec({{204.15, 900}, {366.2, 900}, {500.0, 1000}}), 0.3, false, 0.10);
    check(g.n_matched >= 2 && g.glyco, "Da tolerance matches loosely");
  }
  // Spectrum whose peaks all sit above the oxonium region.
  {
    const auto g = scanOxonium(spec({{800.4, 1000}, {900.5, 600}}), 20, true, 0.10);
    check(g.n_matched == 0 && !g.glyco, "no low-mass peaks, nothing matched");
  }
  // Monotonicity: tightening 20 -> 10 ppm can only shrink the match count.
  {
    const auto s = spec({{204.0885, 900}, {366.1420, 900}, {500.0, 1000}});
    const auto g20 = scanOxonium(s, 20, true, 0.10);
    const auto g10 = scanOxonium(s, 10, true, 0.10);
    check(g10.n_matched <= g20.n_matched, "tolerance tightening is monotone");
  }

  // HexNAc fragments without HexNAc 204.087 (PXD003531 scan 1288: 126.055 and
  // 144.066 at 5.8% of the base peak each, no 204): one monosaccharide's
  // fragments are not two species, and without the parent not glycan
  // evidence at all. Counted before 1.16 (n 2, frac 0.116, flagged).
  {
    const auto g = scanOxonium(spec({{126.05524, 994}, {144.06595, 987}, {129.10257, 17087}}), 20, true, 0.10);
    check(g.n_matched == 0 && !g.glyco && g.ions == "-", "HexNAc fragments without 204.087 do not count");
    const auto h = scanOxonium(spec({{126.05524, 994}, {138.0552, 5000}, {144.06595, 987}, {168.066, 3000},
                                     {186.0762, 2000}, {129.10257, 17087}}),
                               20, true, 0.10);
    check(h.n_matched == 0 && !h.glyco, "five HexNAc fragments without 204.087 do not count");
  }
  // With 204.087 its fragments count as before (the usual HexNAc ladder).
  {
    const auto g = scanOxonium(spec({{138.05495, 900}, {204.08665, 800}, {500.0, 1000}}), 20, true, 0.10);
    check(g.n_matched == 2 && g.glyco && g.ions == "HexNAc-CH6O3;HexNAc", "204.087 with 138.055 flags");
  }
  // A sialic acid ion counts on its own: NeuAc-H2O + Hex, no HexNAc.
  {
    const auto g = scanOxonium(spec({{163.0601, 300}, {274.09213, 400}, {500.0, 1000}}), 20, true, 0.10);
    check(g.n_matched == 2 && g.glyco, "NeuAc-H2O and Hex flag without 204.087");
  }
  // At 0.3 Da the TMT reporter 126.128 falls in the 126.055 window; with a
  // peak in the 144.066 window it no longer flags a labeled spectrum.
  {
    const auto g = scanOxonium(spec({{126.128, 5000}, {144.1, 3000}, {500.0, 1000}}), 0.3, false, 0.10);
    check(!g.glyco, "TMT 126.128 and a 144 peak at 0.3 Da do not flag");
  }

  if (failures == 0) std::printf("glyco_test: all checks passed\n");
  return failures == 0 ? 0 : 1;
}
