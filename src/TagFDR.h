// Empirical q-values from target E-values and weighted decoy (entrapment)
// E-values: q(e) = D_w(e) / T(e), monotonized non-decreasing in e, evaluated
// by binary search over the target thresholds. Each entrapment event carries
// weight 1/r_len because entrapment key spaces are per-tag-length, and a
// single scalar cannot calibrate a curve pooled across lengths.
//
// No decoys -> q 0. The finite-sample caveat is the CALLER's to surface (log
// the resolution floor so q=0 reads as "below resolution", never "zero risk").
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#pragma once

#include <algorithm>
#include <utility>
#include <vector>

namespace FASTag
{
  /**
    @brief Empirical q-values from target E-values and weighted decoy (entrapment) E-values.

    q(e) = D_w(e) / T(e), monotonized non-decreasing in e, evaluated by binary
    search over the target thresholds. With no decoys every q is 0.
  */
  class TagFDR
  {
  public:
    /**
      @brief Builds the monotone q-value table from targets and weighted decoys.

      @param[in] targets E-values of the target events (taken by value and sorted).
      @param[in] weighted_decoys (evalue, weight) per decoy event.
    */
    TagFDR(std::vector<double> targets,
           std::vector<std::pair<double, double>> weighted_decoys)
    {
      std::sort(targets.begin(), targets.end());
      std::sort(weighted_decoys.begin(), weighted_decoys.end());
      es_ = std::move(targets);
      qs_.resize(es_.size());
      // FDR at each target threshold: cumulative decoy weight at or below it,
      // over the target count. Then monotonize: q(e) = min FDR over
      // thresholds >= e, swept from the right.
      size_t di = 0;
      double dw = 0.0;
      for (size_t i = 0; i < es_.size(); ++i)
      {
        while (di < weighted_decoys.size() && weighted_decoys[di].first <= es_[i])
          dw += weighted_decoys[di++].second;
        qs_[i] = dw / static_cast<double>(i + 1);
      }
      double m = 1.0;
      for (size_t i = es_.size(); i-- > 0;) qs_[i] = m = std::min(m, qs_[i]);
    }

    /**
      @brief Returns the q-value of accepting everything with evalue <= e.

      The q at the LAST target threshold <= e (that threshold accepts the
      identical set). Below the best target the acceptance set is empty --
      return the first threshold's q, the conservative continuation; beyond
      the worst target the set is all targets, so its q is the last
      threshold's. 1.0 only when there are no targets at all. In-pipeline
      queries are always exact target evalues, where this and any step
      convention agree.

      @param[in] e E-value acceptance threshold.
      @return The q-value for threshold @p e.
    */
    double qOf(double e) const
    {
      if (es_.empty()) return 1.0;
      const auto it = std::upper_bound(es_.begin(), es_.end(), e);
      if (it == es_.begin()) return qs_.front();
      return qs_[static_cast<size_t>(it - es_.begin()) - 1];
    }

  private:
    std::vector<double> es_;  ///< sorted target evalues
    std::vector<double> qs_;  ///< monotone q at each threshold
  };
}
