// Distribution of a sum of k distinct ranks drawn from 1..n.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
//
// This is the one piece of mathematics FASTag keeps in-house: neither OpenMS nor
// Boost provides the exact null of a rank sum over distinct ranks. Boost offers
// the normal approximation to Mann-Whitney, which is not usable here because the
// interesting tags sit far in the tail, where that approximation is worst.
//
// DirecTag computes the same distribution by enumerating every C(n, k) subset,
// work that grows ~10x per residue (~30 min at k=8). The distribution is a
// restricted-partition count, so a DP gets it in polynomial time; that is what
// makes tag lengths above four usable at all.
#pragma once

#include <cstddef>
#include <vector>

namespace FASTag
{
  /// P(rank sum <= s) under the null that k peaks are drawn uniformly from n
  /// ranked peaks, for EVERY n in [k, n_max]: entry n of the result is the CDF
  /// over s in [0, sum of the top k ranks], and the entries below k are empty.
  ///
  /// dp[j][s] counts the j-subsets of the values seen so far that sum to s.
  /// Values ascend; j and s descend, so each value is used at most once. After
  /// value v, row k holds the counts for n = v, so one pass yields every n:
  /// O(k^2 * n_max^2). Counts are doubles, exact while C(n,k) <= 2^53, and
  /// only their ratios are used. The CDF is stored as float: it indexes a
  /// binned lookup, so double precision buys nothing and costs twice the cache.
  inline std::vector<std::vector<float>> ranksumCdfs(int k, int n_max)
  {
    std::vector<std::vector<float>> out(n_max < 0 ? 0 : static_cast<size_t>(n_max) + 1);
    if (k <= 0 || n_max < k) return out;
    const int smax = k * n_max - k * (k - 1) / 2;
    std::vector<std::vector<double>> dp(static_cast<size_t>(k) + 1,
                                        std::vector<double>(static_cast<size_t>(smax) + 1, 0.0));
    dp[0][0] = 1.0;
    for (int v = 1; v <= n_max; ++v)
    {
      for (int j = (k < v ? k : v); j >= 1; --j)
      {
        auto& cur = dp[static_cast<size_t>(j)];
        const auto& prev = dp[static_cast<size_t>(j) - 1];
        for (int s = smax; s >= v; --s)
          if (prev[static_cast<size_t>(s - v)] != 0.0)
            cur[static_cast<size_t>(s)] += prev[static_cast<size_t>(s - v)];
      }
      if (v < k) continue;
      // The CDF over this n's support, [0, sum of its top k ranks].
      const auto& counts = dp[static_cast<size_t>(k)];
      const size_t len = static_cast<size_t>(k * v - k * (k - 1) / 2) + 1;
      double total = 0.0;   // C(v, k) >= 1
      for (size_t s = 0; s < len; ++s) total += counts[s];
      std::vector<float>& cdf = out[static_cast<size_t>(v)];
      cdf.assign(len, 0.0f);
      double running = 0.0;
      for (size_t s = 0; s < len; ++s)
      {
        running += counts[s];
        cdf[s] = static_cast<float>(running / total);
      }
    }
    return out;
  }
}
