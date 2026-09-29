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
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#pragma once

#include <OpenMS/KERNEL/MSSpectrum.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
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
}
