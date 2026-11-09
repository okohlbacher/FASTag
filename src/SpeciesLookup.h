// Per-tag taxon lookup for -species: which index taxa one reported tag
// supports, after the share and margin filters and the whole-tag rule.
//
// Extracted unchanged from the phase-10 loop of FASTag.cpp (1.12 P6), so the
// species decoy null (#1) and the orientation option (#10) can evaluate the
// same rule on decoy and reversed tags without copying it.
//
// 1.12 #10 adds orientedTagSupport(): under -species_orientation both a tag is
// also looked up reversed (I/L folded, as -orientation both folds for -fasta)
// and the two readings are combined by combineOrientations()
// (SpeciesEvidence.h). Under forward it is tagSupport() exactly.
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

#include "SpeciesEvidence.h"
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
  /// Residue-map decoy @p j of a tag (1.13 species redesign, DEV prototype):
  /// the I/L-folded @p seq with every residue sent through one fixed
  /// derangement of the 19-letter alphabet chosen by @p j. The map is the same
  /// for every tag, so a k-mer always gets the same decoy k-mer (decoy hits
  /// repeat across spectra the way target hits do) and the k-mers of one tag
  /// keep their k-1 overlaps (the whole-tag rule sees the same co-occurrence
  /// structure for every tag length). Residues outside the alphabet pass
  /// through unchanged. Known limitation: the map changes residue composition
  /// (e.g. W->L), so the decoy rate is exact only for an i.i.d. uniform
  /// proteome; the shuffled-proteome arm is the cross-check on real data.
  std::string residueDecoy(const std::string& seq, uint32_t j);
  /// tagSupport() of residueDecoy(@p seq, @p j). @p no_decoy, when given, is
  /// always set to false (every tag has this decoy); kept for the dump format.
  bool kmerDecoySupport(const TaxIndex& idx, const std::string& seq, int k, uint32_t j,
                        std::size_t share_cap, double min_margin,
                        std::vector<uint32_t>& taxa, TagLookupCounters& counters, bool* no_decoy);
  /// @p seq reversed and I/L folded: the reading of a tag written N->C under a
  /// y-ion assumption when it was really read from b ions.
  std::string reversedFolded(const std::string& seq);

  /// Run-level counts of the orientation rule (1.12 #10), one per tag looked
  /// up under SpeciesOrientation::Both. Tags that are informative in neither
  /// orientation are not counted.
  struct OrientationCounts
  {
    uint64_t forward = 0;       ///< informative only as written
    uint64_t reverse = 0;       ///< informative only reversed (the gains of both)
    uint64_t intersection = 0;  ///< informative both ways, the common taxa used
    uint64_t ambiguous = 0;     ///< informative both ways without a common taxon: skipped
    uint64_t palindrome = 0;    ///< folded tag equals its reverse: looked up once
  };

  /// The taxa supporting one tag in the orientations @p orient asks for.
  /// Forward: tagSupport(seq) exactly, @p rev_counters and @p oc untouched.
  /// Both: tagSupport() of @p seq (counted in @p counters) and of
  /// reversedFolded(@p seq) (counted in @p rev_counters, so the forward
  /// counters equal a forward run's), combined by combineOrientations(); a
  /// palindrome (folded) is looked up once. Returns true and fills @p taxa
  /// when the combined support is non-empty. @p oc may be null.
  bool orientedTagSupport(const TaxIndex& idx, const std::string& seq, int k,
                          std::size_t share_cap, double min_margin, SpeciesOrientation orient,
                          std::vector<uint32_t>& taxa, TagLookupCounters& counters,
                          TagLookupCounters& rev_counters, OrientationCounts* oc);
}
