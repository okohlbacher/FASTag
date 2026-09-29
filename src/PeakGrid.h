// Nearest-peak lookup over one spectrum: MSSpectrum::findNearest(mz, tol),
// exactly, without the binary search.
//
// buildGraph asks "nearest peak to m/z_i + residue/z, if within tolerance" for
// every peak x residue x fragment charge, and prepare() asks it once more per
// peak and charge for complements -- thousands of queries against the same
// few hundred peaks. Profiled, the binary search behind findNearest was 20-40%
// of worker CPU, and not from cache misses (L1D hit 99.3%): an out-of-line
// call into libOpenMS plus ~8 dependent, unpredictable branches per query.
//
// So the spectrum is indexed once. A dense array maps each m/z bucket to the
// first peak at or above it; a query jumps to its bucket and steps forward to
// the exact lower_bound, then applies OpenMS's nearest/tolerance rule
// unchanged. The bucket only has to start AT OR BEFORE lower_bound, which any
// monotone m/z -> bucket map guarantees, so the answer never depends on the
// bucket width, on the tolerance or on its unit -- only the speed does.
//
// buildGraph's residue edges go one step further with StepTable: the one thing
// fixed for a whole run is the residue alphabet, so a table over peak-to-peak
// m/z DIFFERENCES, built once per charge, lists which residues each difference
// could be. Per peak, a walk over the peaks within the heaviest step replaces
// one lookup per residue. Measured on an EPYC 9654 (x86), per spectrum and
// charge: the grid is 1.5-1.8x faster than findNearest, the table 3.0-3.7x faster
// than the grid at 0.02 Da and 20 ppm, and 1.2-2.1x at 0.5 Da.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#pragma once

#include <OpenMS/KERNEL/MSSpectrum.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <utility>
#include <vector>

namespace FASTag
{
  /// Index over one m/z-sorted spectrum; nearest() equals the spectrum's
  /// findNearest(mz, tol) for every query, including ties, duplicate m/z,
  /// targets outside the peak range and non-finite targets.
  ///
  /// build() reuses the vectors' capacity, so a PeakGrid kept per thread costs
  /// no allocation per spectrum once warm.
  struct PeakGrid
  {
    // ponytail: 1-Th buckets up to MAX_BUCKETS of them (16 KB), wider beyond.
    // At the <= 400 retained peaks of a fragment spectrum 1 Th holds under one
    // peak on average, so the step to lower_bound is usually zero or one peak;
    // the ceiling only bounds memory on a spectrum spanning more than 4096 Th
    // (a corrupt precursor would otherwise ask for one bucket per Th of it).
    static constexpr double MAX_BUCKETS = 4096;

    std::vector<double>   mz;     ///< peak m/z, contiguous
    std::vector<uint32_t> first;  ///< bucket -> first peak whose bucket >= it
    double lo = 0;                ///< m/z of bucket 0's lower edge (first peak)
    double inv_w = 1;             ///< buckets per Th

    void build(const OpenMS::MSSpectrum& s)
    {
      const size_t n = s.size();
      mz.resize(n);
      for (size_t i = 0; i < n; ++i) mz[i] = s[i].getMZ();
      first.clear();
      if (n == 0) return;
      lo = mz.front();
      const double span = mz.back() - lo;
      inv_w = span > MAX_BUCKETS ? MAX_BUCKETS / span : 1.0;
      // The same expression buckets peaks here and targets in nearest(); it is
      // monotone in m/z, which is all correctness needs.
      first.assign(bucket(mz.back()) + 1, static_cast<uint32_t>(n));
      for (size_t i = n; i-- > 0;) first[bucket(mz[i])] = static_cast<uint32_t>(i);
      for (size_t b = first.size() - 1; b-- > 0;) first[b] = std::min(first[b], first[b + 1]);
    }

    /// Index of the nearest peak to @p t if it lies within +-@p tol, else -1:
    /// lower_bound, then the lower index on an equal-distance tie, then the
    /// same two-sided test as MSSpectrum::findNearest(mz, tol).
    int nearest(double t, double tol) const
    {
      const size_t n = mz.size();
      if (n == 0) return -1;
      size_t k = 0;   // at or before lower_bound(t); NaN and t <= lo start at 0
      if (t > lo)
      {
        const double q = (t - lo) * inv_w;
        k = q < static_cast<double>(first.size()) ? first[static_cast<size_t>(q)] : n;
      }
      while (k < n && mz[k] < t) ++k;
      const size_t i = k == 0 ? 0 : k == n ? n - 1
                     : (std::fabs(mz[k] - t) < std::fabs(mz[k - 1] - t) ? k : k - 1);
      const double f = mz[i];
      return (f >= t - tol && f <= t + tol) ? static_cast<int>(i) : -1;
    }

  private:
    size_t bucket(double x) const { return static_cast<size_t>((x - lo) * inv_w); }
  };

  /// Residue-difference table for one fragment charge. nearestAbove() gives,
  /// for peak i and every step r, exactly the index
  /// MSSpectrum::findNearest(mz_i + step[r], tol) returns when it is above i,
  /// else -1 -- from one walk over the peaks after i instead of one search per
  /// step.
  ///
  /// Why that is exact. findNearest looks only at the two peaks straddling the
  /// target, L-1 (last below it) and L (first at or above), keeps the nearer
  /// (L-1 on a tie) and only THEN applies the tolerance test -- so the nearer
  /// neighbour decides even when it fails and the farther one would pass. The
  /// walk reproduces that selection rather than picking among passing peaks:
  /// step r is listed in every bin within w plus one bin of step[r], and bins
  /// are monotone in m/z, so the peaks r is offered form one contiguous run of
  /// indices. If any of them lies below the target, L-1 is among them (the last
  /// one), and if any lies at or above it, L is (the first one). A neighbour
  /// that is not offered is more than w from the target, beyond every
  /// tolerance the table was fitted for, so it can neither pass nor be nearer
  /// than a neighbour that does. Peaks at or below i are never walked; they
  /// are at least the lightest step away, which fit() requires to exceed w.
  struct StepTable
  {
    // ponytail: 0.01-Th bins, and w capped at 1 Th. Neither affects the
    // answer: a bin lists a step up to one bin beyond its window, which only
    // offers a peak that the exact test then settles. Width trades table size
    // (off is ~75 KB at charge 1) against steps offered per peak; the cap
    // stops a ppm tolerance on a corrupt m/z from building a table that offers
    // every step everywhere -- such a spectrum falls back to the grid.
    static constexpr double BINS_PER_TH = 100;
    static constexpr double MAX_W = 1.0;

    std::vector<double>   step;   ///< residue mass / charge, alphabet order
    double w = -1;                ///< tolerance the bins cover
    bool usable = false;          ///< every step exceeds w by two bins
    std::vector<uint32_t> off;    ///< bin -> first entry in cand; nbins + 1
    std::vector<uint8_t>  cand;   ///< step indices listed per bin

    /// Make the table serve @p steps for every tolerance up to @p need; false
    /// when it cannot, and the caller searches per query instead. Rebuilt only
    /// when the steps change or @p need outgrows w, with headroom, so a ppm run
    /// -- whose need follows each spectrum's top m/z -- rebuilds a few times per
    /// thread rather than per spectrum.
    bool fit(const std::vector<double>& steps, double need)
    {
      if (!(need <= MAX_W) || steps.empty() || steps.size() > 256) return false;   // NaN too
      if (steps == step && need <= w) return usable;
      step = steps;
      w = std::max(need, 0.0) * 1.25;
      off.clear(); cand.clear();
      usable = true;
      size_t nbins = 0;
      for (double st : step)
      {
        if (!(st > w + 2 / BINS_PER_TH && st < 1e4)) usable = false;
        else nbins = std::max(nbins, static_cast<size_t>((st + w) * BINS_PER_TH) + 3);
      }
      if (!usable) return false;
      // Compressed rows: count per bin, prefix-sum, fill, then shift the
      // starts back that the fill advanced.
      off.assign(nbins + 1, 0);
      for (size_t r = 0; r < step.size(); ++r)
      {
        const auto [b0, b1] = window(r);
        for (size_t b = b0; b <= b1; ++b) ++off[b + 1];
      }
      for (size_t b = 0; b < nbins; ++b) off[b + 1] += off[b];
      cand.resize(off[nbins]);
      for (size_t r = 0; r < step.size(); ++r)
      {
        const auto [b0, b1] = window(r);
        for (size_t b = b0; b <= b1; ++b) cand[off[b]++] = static_cast<uint8_t>(r);
      }
      for (size_t b = nbins; b > 0; --b) off[b] = off[b - 1];
      off[0] = 0;
      return true;
    }

    /// For peak @p i of the m/z-sorted @p mz: out[r] = findNearest(mz[i] +
    /// step[r], tol(target)) if that is above i, else -1. Only after fit()
    /// returned true, and @p tol must never exceed the need it was given.
    template <class Tol>
    void nearestAbove(const std::vector<double>& mz, size_t i, Tol tol, std::vector<int>& out)
    {
      const size_t n = mz.size(), R = step.size();
      const double mi = mz[i], nb = static_cast<double>(off.size() - 1);
      below.assign(R, -1);
      above.assign(R, -1);
      for (size_t j = i + 1; j < n; ++j)
      {
        const double q = (mz[j] - mi) * BINS_PER_TH;
        if (!(q < nb)) break;
        const size_t b = static_cast<size_t>(q);
        for (uint32_t e = off[b]; e < off[b + 1]; ++e)
        {
          const uint8_t r = cand[e];
          if (mz[j] < mi + step[r]) below[r] = static_cast<int>(j);   // last wins
          else if (above[r] < 0) above[r] = static_cast<int>(j);      // first wins
        }
      }
      out.resize(R);
      for (size_t r = 0; r < R; ++r)
      {
        const double t = mi + step[r];
        const int lo = below[r], hi = above[r];
        int k = hi < 0 ? lo : lo < 0 ? hi
              : (std::fabs(mz[static_cast<size_t>(hi)] - t) < std::fabs(mz[static_cast<size_t>(lo)] - t) ? hi : lo);
        if (k >= 0)
        {
          const double f = mz[static_cast<size_t>(k)], tl = tol(t);
          if (!(f >= t - tl && f <= t + tl)) k = -1;
        }
        out[r] = k;
      }
    }

  private:
    std::vector<int> below, above;   ///< per step, scratch for nearestAbove

    /// Bins listing step r: its window +-w, widened by one bin on each side.
    std::pair<size_t, size_t> window(size_t r) const
    {
      return {static_cast<size_t>((step[r] - w) * BINS_PER_TH) - 1,
              static_cast<size_t>((step[r] + w) * BINS_PER_TH) + 1};
    }
  };
}
