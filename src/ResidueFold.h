// Residue folding and isobaric collapse rules, shared by FastaFilter and
// ProteomeIndex. One implementation on purpose: the tagger, the membership
// filter and the locate index must agree byte-for-byte on what a residue IS
// (I folds to L, ambiguity codes become AMBIG) and on which residue equals
// which two-residue sum -- two copies of either rule would drift apart in
// exactly the way that produces sequence-correlated recall loss.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#pragma once

#include <OpenMS/CHEMISTRY/Residue.h>
#include <OpenMS/CHEMISTRY/ResidueDB.h>

#include <algorithm>
#include <cmath>
#include <string>
#include <utility>
#include <vector>

namespace FASTag
{
  /// Sentinel for ambiguity codes; no tag can contain it. (Kept in sync with
  /// FastaFilter.h's constant by the compiler: both are this one.)
  constexpr char RESIDUE_AMBIG = '#';

  /// Canonicalize one database character, EXACTLY as FastaFilter always has
  /// (moved here verbatim so the filter's index keys cannot change):
  /// lowercase is uppercased; non-letters return 0 (drop the character);
  /// ambiguity codes X/B/Z/J/U/O become RESIDUE_AMBIG (kept, unmatchable --
  /// J too: it stands for I-or-L, but an indexed J would otherwise become a
  /// matchable letter of its own); I folds to L.
  inline char normResidue(char c) noexcept
  {
    if (c >= 'a' && c <= 'z') c = static_cast<char>(c - 'a' + 'A');
    if (c < 'A' || c > 'Z') return 0;
    if (c == 'X' || c == 'B' || c == 'Z' || c == 'J' || c == 'U' || c == 'O')
      return RESIDUE_AMBIG;
    return c == 'I' ? 'L' : c;
  }

  /// One interchangeable-mass rule: residue `one` weighs the same as the
  /// ordered pair (a, b) within the tolerance the rules were derived at.
  struct CollapseRule
  {
    char a, b, one;
  };

  /// Derive the collapse rules from the residue masses at @p tol, with fixed
  /// modification mass shifts folded in first (a carbamidomethylated C is 57 Da
  /// heavier, which changes which sums are isobaric). At 0.04 Da the unmodified
  /// set is N=GG, Q=GA/AG, K=GA/AG(*), R=GV/VG, W=AD/DA/GE/EG/SV/VS.
  inline std::vector<CollapseRule> deriveCollapseRules(
      double tol, const std::vector<std::pair<char, double>>& fixed_deltas = {})
  {
    std::vector<CollapseRule> rules;
    std::vector<std::pair<char, double>> R;
    for (const OpenMS::Residue* r :
         OpenMS::ResidueDB::getInstance()->getResidues("Natural19WithoutI"))
      R.emplace_back(r->getOneLetterCode()[0], r->getMonoWeight(OpenMS::Residue::Internal));
    for (auto& e : R)
      for (const auto& d : fixed_deltas)
        if (d.first == e.first) e.second += d.second;

    // ResidueDB::getResidues returns a std::set<const Residue*> -- ordered by
    // POINTER, which varies per process (allocation order/ASLR). Left as-is,
    // the derived rules keep their set but permute their ORDER between runs,
    // and FastaFilter::emitReadings' reading budget then truncates a
    // DIFFERENT subset of collapse readings -- a one-in-several-runs
    // nondeterministic index observed on real data (an extra 6-mer in
    // ~1 of 5 runs, reproduced back to v0.19.1). Sorting the residue table
    // pins the rule order and with it every downstream truncation.
    std::sort(R.begin(), R.end());
    for (const auto& one : R)
      for (const auto& a : R)
        for (const auto& b : R)
          if (std::fabs(one.second - (a.second + b.second)) <= tol)
            rules.push_back({a.first, b.first, one.first});
    return rules;
  }
}
