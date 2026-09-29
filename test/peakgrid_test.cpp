// PeakGrid::nearest and StepTable::nearestAbove against
// MSSpectrum::findNearest(mz, tol), query by query.
//
// Both replace OpenMS's search inside buildGraph (and the grid also in the
// complement loop), and the tool's output is only unchanged if every answer
// is: same peak, same -1. So this compares them on random spectra built to hit
// the rules that are easy to get subtly wrong -- equal-distance neighbours
// (lower index wins), duplicate m/z, targets before the first and after the
// last peak, exact hits, ppm tolerance, non-finite targets, spectra wide
// enough to widen buckets, and for the table peaks straddling t +- tol to the
// last bit, where the nearer neighbour decides even when it fails the test.
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
#include <utility>
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

  // ------------------------------------------------------------ StepTable

  size_t pairs = 0, edges = 0, pair_ties = 0, nearer_fails = 0;

  /// Every (peak, step) of one spectrum through the table, against the edge
  /// buildGraph used to take from findNearest: its index if above i, else -1.
  void checkTable(const std::vector<double>& mzs, StepTable& dt, const std::vector<double>& steps,
                  bool ppm, double frag_tol)
  {
    MSSpectrum s;
    for (double m : mzs) s.push_back(Peak1D(m, 1.0f));
    s.sortByPosition();
    const size_t n = s.size();
    if (n == 0) return;
    std::vector<double> mz(n);
    for (size_t i = 0; i < n; ++i) mz[i] = s[i].getMZ();
    auto tolAt = [&](double t) { return ppm ? t * frag_tol * 1e-6 : frag_tol; };   // as FASTagger's
    if (!dt.fit(steps, tolAt(mz.back() + *std::max_element(steps.begin(), steps.end()))))
    {
      ++failures;
      std::printf("FAIL: fit() refused a serviceable table (tol %g%s)\n", frag_tol, ppm ? " ppm" : "");
      return;
    }
    std::vector<int> out;
    for (size_t i = 0; i < n; ++i)
    {
      dt.nearestAbove(mz, i, tolAt, out);
      for (size_t r = 0; r < steps.size(); ++r)
      {
        ++pairs;
        const double t = mz[i] + steps[r], tl = tolAt(t);
        int want = s.findNearest(t, tl);
        const size_t L = static_cast<size_t>(s.MZBegin(t) - s.begin());
        if (L > i + 1 && L < n)
        {
          auto pass = [&](size_t k) { return mz[k] >= t - tl && mz[k] <= t + tl; };
          if (mz[L] != mz[L - 1] && std::fabs(mz[L] - t) == std::fabs(mz[L - 1] - t)) ++pair_ties;
          if (want < 0 && (pass(L) || pass(L - 1))) ++nearer_fails;   // case (a)
        }
        if (want <= static_cast<int>(i)) want = -1;
        if (want >= 0) ++edges;
        if (out[r] != want && ++failures <= 40)
          std::printf("FAIL: n=%zu i=%zu r=%zu t=%.17g tol=%.17g findNearest=%d table=%d\n",
                      n, i, r, t, tl, want, out[r]);
      }
    }
  }

  /// Peaks placed around mz_i + step_r +- tol, down to the last bit on both
  /// sides, plus exact mirror images (equal distance), so the nearer neighbour
  /// is sometimes the one that fails.
  void straddle(std::vector<double>& mzs, const std::vector<double>& steps, bool ppm, double frag_tol,
                std::mt19937_64& rng, int count)
  {
    if (mzs.empty()) return;
    const double inf = std::numeric_limits<double>::infinity();
    auto tolAt = [&](double t) { return ppm ? t * frag_tol * 1e-6 : frag_tol; };
    std::uniform_int_distribution<size_t> pi(0, mzs.size() - 1), pr(0, steps.size() - 1), pc(0, 10);
    std::uniform_real_distribution<double> u01(0.0, 1.0);
    for (int c = 0; c < count; ++c)
    {
      const double t = mzs[pi(rng)] + steps[pr(rng)];
      const double tl = tolAt(t);
      const double a = t - tl, b = t + tl;
      const double near[] = {a, std::nextafter(a, -inf), std::nextafter(a, inf),
                             b, std::nextafter(b, -inf), std::nextafter(b, inf),
                             t - tl / 2, t + tl / 3, t,
                             t - (std::nextafter(b, inf) - t), t - (b - t)};   // mirrors of b's side
      for (int k = 0; k < 2; ++k) mzs.push_back(near[pc(rng)]);

      // Case (a) itself. Just above a power of two, t - tol lies in the finer
      // binade below, so the exact mirror of fl(t + tol) across t can land one
      // bit below fl(t - tol): an exact tie whose lower side -- the one
      // findNearest keeps -- fails while the upper side passes. findNearest
      // returns -1; choosing among passing peaks would return the upper one.
      const double pow2 = std::ldexp(1.0, 8 + static_cast<int>(pc(rng) % 4));
      const double st = steps[pr(rng)];
      const double p = pow2 + tolAt(pow2) * u01(rng) - st;
      const double t2 = p + st, b2 = t2 + tolAt(t2);
      mzs.insert(mzs.end(), {p, b2, t2 - (b2 - t2)});
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
  std::printf("grid: %zu queries, %zu within tolerance, %zu equal-distance, %zu before first, %zu after last\n",
              queries, accepted, ties, before, after);

  // StepTable. Real residue masses (with two modified ones) at charges 1, 2, 3
  // and 8, and a synthetic alphabet on a 1/64 grid whose targets are exact, so
  // equal distances are real ties. One table serves every configuration in
  // turn, as a thread's does across charges and spectra, so a stale table
  // would show.
  const std::vector<double> residues = {57.02146, 71.03711, 87.03203, 97.05276, 99.06841, 101.04768,
                                        103.00919, 113.08406, 114.04293, 115.02694, 128.05858, 128.09496,
                                        129.04259, 131.04049, 137.05891, 147.06841, 156.10111, 163.06333,
                                        186.07931, 147.0354, 166.99836};
  std::vector<std::vector<double>> alphabets;
  for (int z : {1, 2, 3, 8})
  {
    alphabets.emplace_back();
    for (double m : residues) alphabets.back().push_back(m / z);
  }
  alphabets.emplace_back();
  std::uniform_int_distribution<int> sixty4(57 * 64, 190 * 64);
  for (int r = 0; r < 20; ++r) alphabets.back().push_back(sixty4(rng) / 64.0);

  StepTable dt;
  for (int rep = 0; rep < 12; ++rep)
    for (const auto& steps : alphabets)
      for (const auto& [ppm, tol] : std::vector<std::pair<bool, double>>{
               {false, 0.0}, {false, 0.005}, {false, 0.02}, {false, 0.5}, {true, 5}, {true, 20}, {true, 100}})
        for (size_t n : {1, 2, 40, 150, 400})
        {
          std::uniform_real_distribution<double> u(150.0, 1800.0);
          std::uniform_int_distribution<size_t> pr(0, steps.size() - 1);
          std::vector<double> mzs;
          for (size_t i = 0; i < n; ++i)
            mzs.push_back(rep % 2 ? std::round(u(rng) * 64) / 64 : std::round(u(rng) * 1e4) / 1e4);
          for (size_t i = 0; i + 1 < n; i += 5) mzs.push_back(mzs[i] + steps[pr(rng)]);   // ladders
          if (rep % 3 == 0) for (size_t i = 0; i + 1 < n; i += 9) mzs.push_back(mzs[i]); // duplicates
          straddle(mzs, steps, ppm, tol, rng, static_cast<int>(n / 4) + 1);
          checkTable(mzs, dt, steps, ppm, tol);
        }

  // Tables that cannot serve must say so, and a refusal must not poison the next fit.
  const auto& real = alphabets[0];
  if (dt.fit(real, std::numeric_limits<double>::quiet_NaN())) { ++failures; std::printf("FAIL: fit(NaN)\n"); }
  if (dt.fit(real, 2 * StepTable::MAX_W)) { ++failures; std::printf("FAIL: fit above MAX_W\n"); }
  if (dt.fit({0.01, 57.0}, 0.02)) { ++failures; std::printf("FAIL: fit with a step inside w\n"); }
  if (!dt.fit(real, 0.02)) { ++failures; std::printf("FAIL: fit after a refusal\n"); }

  if (pair_ties == 0) { ++failures; std::printf("FAIL: no equal-distance (peak, step) pair\n"); }
  if (edges == 0) { ++failures; std::printf("FAIL: no edge was found\n"); }
  if (nearer_fails == 0) { ++failures; std::printf("FAIL: case (a) was never constructed\n"); }
  std::printf("table: %zu (peak, step) pairs, %zu edges, %zu equal-distance, %zu nearer-neighbour-fails\n",
              pairs, edges, pair_ties, nearer_fails);

  if (failures) { std::printf("%d FAILURE(S)\n", failures); return 1; }
  std::printf("PeakGrid and StepTable match MSSpectrum::findNearest on every query\n");
  return 0;
}
