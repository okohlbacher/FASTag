// Empirical q-values from a target/decoy E-value pair of lists.
//
// RECREATED to the contract of the original (written, unit-tested, then
// deleted uncommitted; recovered from the surviving build-f4/ artifacts):
//   TagFDR(targets, decoys, decoy_scale);  q(e) = scale * D(e) / T(e),
// monotonized non-decreasing in e, evaluated by binary search over the target
// thresholds. "No decoys -> q 0" is part of that contract and is preserved --
// the finite-sample caveat is the CALLER's to surface (log the resolution
// floor scale/T so q=0 reads as "below resolution", never "zero risk").
//
// The weighted-decoy constructor is the one deliberate extension: entrapment
// key spaces are per-tag-length, so each entrapment event carries weight
// 1/r_len instead of one global scale -- a scalar cannot calibrate a curve
// pooled across lengths.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#pragma once

#include <algorithm>
#include <utility>
#include <vector>

namespace FASTag
{
  class TagFDR
  {
  public:
    /// Weighted decoys: (evalue, weight) per decoy event.
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
      for (size_t i = es_.size(); i-- > 0;)
      {
        m = std::min(m, qs_[i]);
        qs_[i] = std::min(1.0, m);
      }
    }

    /// The recovered scalar contract: every decoy weighs `decoy_scale`.
    TagFDR(std::vector<double> targets, const std::vector<double>& decoys,
           double decoy_scale)
      : TagFDR(std::move(targets), scaled_(decoys, decoy_scale))
    {
    }

    /// q of accepting everything with evalue <= e: the q at the LAST target
    /// threshold <= e (that threshold accepts the identical set). Below the
    /// best target the acceptance set is empty -- return the first
    /// threshold's q, the conservative continuation; beyond the worst target
    /// the set is all targets, so its q is the last threshold's. 1.0 only
    /// when there are no targets at all. In-pipeline queries are always exact
    /// target evalues, where this and any step convention agree.
    double qOf(double e) const
    {
      if (es_.empty()) return 1.0;
      const auto it = std::upper_bound(es_.begin(), es_.end(), e);
      if (it == es_.begin()) return qs_.front();
      return qs_[static_cast<size_t>(it - es_.begin()) - 1];
    }

  private:
    static std::vector<std::pair<double, double>> scaled_(
        const std::vector<double>& decoys, double scale)
    {
      std::vector<std::pair<double, double>> w;
      w.reserve(decoys.size());
      for (double d : decoys) w.emplace_back(d, scale);
      return w;
    }

    std::vector<double> es_;  ///< sorted target evalues
    std::vector<double> qs_;  ///< monotone q at each threshold
  };
}
