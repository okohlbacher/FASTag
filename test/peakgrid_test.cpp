// PeakGrid::nearest against MSSpectrum::findNearest(mz, tol), query by query.
//
// The grid replaces OpenMS's search inside buildGraph and the complement loop,
// and the tool's output is only unchanged if every answer is: same peak, same
// -1. So this compares the two on random spectra built to hit the rules that
// are easy to get subtly wrong -- equal-distance neighbours (lower index wins),
// duplicate m/z, targets before the first and after the last peak, exact hits,
// ppm tolerance, non-finite targets and spectra wide enough to widen buckets.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "PeakGrid.h"

#include <OpenMS/KERNEL/MSSpectrum.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <limits>
#include <random>
#include <vector>

using namespace FASTag;
using OpenMS::MSSpectrum;
using OpenMS::Peak1D;

namespace
{
  int failures = 0;
  size_t queries = 0, accepted = 0, ties = 0, before = 0, after = 0;

  void compare(const MSSpectrum& s, const PeakGrid& g, double t, double tol)
  {
    ++queries;
    const int want = s.findNearest(t, tol);
    const int got = g.nearest(t, tol);
    if (want >= 0) ++accepted;
    const size_t n = s.size();
    if (n > 0 && t < s[0].getMZ()) ++before;
    if (n > 0 && t > s[n - 1].getMZ()) ++after;
    if (n > 1)
    {
      const size_t k = static_cast<size_t>(s.MZBegin(t) - s.begin());
      if (k > 0 && k < n && s[k].getMZ() != s[k - 1].getMZ()
          && std::fabs(s[k].getMZ() - t) == std::fabs(s[k - 1].getMZ() - t)) ++ties;
    }
    if (want != got && ++failures <= 20)
      std::printf("FAIL: n=%zu t=%.17g tol=%.17g findNearest=%d grid=%d\n", n, t, tol, want, got);
  }

  void checkSpectrum(const std::vector<double>& mzs, PeakGrid& g, std::mt19937_64& rng)
  {
    MSSpectrum s;
    for (double m : mzs) s.push_back(Peak1D(m, 1.0f));
    s.sortByPosition();
    g.build(s);   // one grid reused across spectra, as prepare() does

    std::vector<double> ts;
    const size_t n = s.size();
    const double inf = std::numeric_limits<double>::infinity();
    ts.insert(ts.end(), {std::numeric_limits<double>::quiet_NaN(), inf, -inf, 0.0, -5.0});
    if (n > 0)
    {
      const double lo = s[0].getMZ(), hi = s[n - 1].getMZ();
      ts.insert(ts.end(), {lo, hi, lo - 1e-9, lo - 0.01, lo - 7.0, hi + 1e-9, hi + 0.01, hi + 7.0,
                           hi + 5000.0, std::nextafter(lo, -inf), std::nextafter(hi, inf)});
      std::uniform_real_distribution<double> u(lo - 10.0, hi + 10.0), off(-0.6, 0.6);
      for (size_t i = 0; i < n; ++i)
      {
        const double m = s[i].getMZ();
        ts.push_back(m);                                   // exact hit
        ts.push_back(m + off(rng));                        // near a peak
        ts.push_back(m + 57.02146 + off(rng) * 0.05);      // buildGraph-like
        if (i + 1 < n) ts.push_back((m + s[i + 1].getMZ()) / 2);   // equal distance
      }
      for (int r = 0; r < 200; ++r) ts.push_back(u(rng));
    }
    for (double t : ts)
    {
      for (double tol : {0.0, 0.005, 0.02, 0.5, 3.0}) compare(s, g, t, tol);
      for (double ppm : {5.0, 20.0, 100.0}) compare(s, g, t, t * ppm * 1e-6);   // tolAt()
    }
  }
}

int main()
{
  std::mt19937_64 rng(20260929);
  PeakGrid g;

  for (int rep = 0; rep < 300; ++rep)
    for (size_t n : {0, 1, 2, 3, 17, 100, 400, 1024})
    {
      std::uniform_real_distribution<double> u(150.0, 1800.0);
      std::vector<double> mzs;
      switch (rep % 4)
      {
        case 0:   // multiples of 1/64: midpoints and distances are exact, so ties are real
          for (size_t i = 0; i < n; ++i) mzs.push_back(std::round(u(rng) * 64) / 64);
          break;
        case 1:   // realistic precision, with duplicated m/z
          for (size_t i = 0; i < n; ++i) mzs.push_back(std::round(u(rng) * 1e4) / 1e4);
          for (size_t i = 0; i + 1 < n; i += 7) mzs.push_back(mzs[i]);
          break;
        case 2:   // dense clusters: many peaks inside one bucket
          for (size_t i = 0; i < n; ++i)
            mzs.push_back(500.0 + std::floor(u(rng) / 400) + (u(rng) - 150.0) * 1e-4);
          break;
        default:  // span far beyond MAX_BUCKETS Th: buckets widen
          for (size_t i = 0; i < n; ++i)
            mzs.push_back(std::round(std::exp(std::uniform_real_distribution<double>(4.6, 14.5)(rng)) * 64) / 64);
          break;
      }
      checkSpectrum(mzs, g, rng);
    }

  // The test must actually reach the cases it claims to cover.
  if (ties == 0) { ++failures; std::printf("FAIL: no equal-distance query was generated\n"); }
  if (before == 0 || after == 0) { ++failures; std::printf("FAIL: no out-of-range query\n"); }
  if (accepted == 0) { ++failures; std::printf("FAIL: no query was within tolerance\n"); }

  std::printf("%zu queries, %zu within tolerance, %zu equal-distance, %zu before first, %zu after last\n",
              queries, accepted, ties, before, after);
  if (failures) { std::printf("%d FAILURE(S)\n", failures); return 1; }
  std::printf("PeakGrid matches MSSpectrum::findNearest on every query\n");
  return 0;
}
