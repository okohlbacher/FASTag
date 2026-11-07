// Per-tag taxon lookup for -species: which index taxa one reported tag
// supports, after the share and margin filters and the whole-tag rule.
//
// Extracted unchanged from the phase-10 loop of FASTag.cpp (1.12 P6), so the
// species decoy null (#1) and the orientation option (#10) can evaluate the
// same rule on decoy and reversed tags without copying it.
//
// The rule, per tag (base sequence, I/L folded per k-mer):
//   * a k-mer in NO taxon kills the tag (the reference cannot explain it);
//   * a k-mer carried by more than share_cap taxa is skipped, not deleted
//     (counted in kmer_skipped);
//   * a taxon must carry EVERY evaluated k-mer (with share_cap at its maximum
//     this is plain set intersection);
//   * margin = (best - runner-up) / n_eval must reach min_margin, else the tag
//     is too generic (counted in tag_generic).
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#pragma once

#include "TaxIndex.h"

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace FASTag
{
  /// Run-level counters of the per-tag filters.
  struct TagLookupCounters
  {
    uint64_t kmer_skipped = 0;  ///< k-mers skipped by the share cap (also in tags later rejected)
    uint64_t tag_generic = 0;   ///< tags rejected by the margin filter
  };

  /// The taxa supporting one tag. @p seq is the tag's base sequence (unfolded;
  /// each k-mer is folded before lookup), @p k the index k. Returns true and
  /// fills @p taxa (ascending, the taxa carrying every evaluated k-mer) when the
  /// tag is informative; returns false and leaves @p taxa empty otherwise.
  /// @p counters is updated exactly as the 1.11 inline loop did.
  bool tagSupport(const TaxIndex& idx, const std::string& seq, int k,
                  std::size_t share_cap, double min_margin,
                  std::vector<uint32_t>& taxa, TagLookupCounters& counters);

  /// Decoy @p j of a tag for the -species_call null (1.12 #1): a permutation
  /// of the I/L-folded @p seq, seeded by FNV-1a 64 over (folded seq, j), so it
  /// depends on nothing but the tag and j (not on thread, order or the
  /// standard library's shuffle). It keeps composition and length. It never
  /// equals the folded tag or the folded tag reversed: a permutation that does
  /// is rotated by one position until it differs. Returns the empty string
  /// when no rotation differs from both (a homopolymer, a two-residue tag):
  /// that tag has no decoy.
  std::string decoyTag(const std::string& seq, uint32_t j);
}
