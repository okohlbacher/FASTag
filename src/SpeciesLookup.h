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
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#pragma once

#include "SpeciesEvidence.h"
#include "TaxIndex.h"

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace FASTag
{
  /**
    @brief Run-level counters of the per-tag filters.
  */
  struct TagLookupCounters
  {
    uint64_t kmer_skipped = 0;  ///< k-mers skipped by the share cap (also in tags later rejected)
    uint64_t tag_generic = 0;   ///< tags rejected by the margin filter
  };

  /**
    @brief The taxa supporting one tag, by the rule in the file comment.
    @param[in] idx The taxon k-mer index.
    @param[in] seq The tag's base sequence (unfolded; each k-mer is folded before lookup).
    @param[in] k The index k.
    @param[in] share_cap K-mers carried by more taxa than this are skipped.
    @param[in] min_margin Minimum (best - runner-up) / n_eval margin.
    @param[out] taxa Ascending taxa carrying every evaluated k-mer; empty when
      the tag is not informative.
    @param[in,out] counters Updated exactly as the 1.11 inline loop did.
    @return True when the tag is informative.
  */
  bool tagSupport(const TaxIndex& idx, const std::string& seq, int k,
                  std::size_t share_cap, double min_margin,
                  std::vector<uint32_t>& taxa, TagLookupCounters& counters);

  /**
    @brief Decoy @p j of a tag for the -species_call null (1.12 #1).

    A permutation of the I/L-folded @p seq, seeded by FNV-1a 64 over (folded
    seq, j), so it depends on nothing but the tag and j (not on thread, order
    or the standard library's shuffle). It keeps composition and length. It
    never equals the folded tag or the folded tag reversed: a permutation that
    does is rotated by one position until it differs.

    @param[in] seq The tag's base sequence.
    @param[in] j Decoy replicate number.
    @return The decoy, or the empty string when no rotation differs from both
      (a homopolymer, a two-residue tag): that tag has no decoy.
  */
  std::string decoyTag(const std::string& seq, uint32_t j);
  /**
    @brief The k-mer-keyed decoy @p j of a tag of exactly @p k residues.

    1.13 species redesign, DEV prototype: tagSupport() of decoyTag(@p seq, @p j).
    Such a tag is one k-mer, so two tags with the same k-mer share its decoy
    and decoy hits repeat across spectra the way target hits do. A tag of
    another length than k has no decoy here: per-k-mer decoys would lose the
    k-1 overlaps the whole-tag rule depends on (they almost never hit, an
    anti-conservative null) and a whole-tag shuffle is not k-mer keyed. The
    1.12 DEV species runs evaluate only 7-residue tags at index k 7.

    @param[in] idx The taxon k-mer index.
    @param[in] seq The tag's base sequence.
    @param[in] k The index k.
    @param[in] j Decoy replicate number.
    @param[in] share_cap K-mers carried by more taxa than this are skipped.
    @param[in] min_margin Minimum (best - runner-up) / n_eval margin.
    @param[out] taxa Taxa supporting the decoy (cleared first).
    @param[in,out] counters Updated by tagSupport() of the decoy.
    @param[out] no_decoy If not null, set to true when the tag has no decoy
      (length != k or no decoyTag()), false otherwise.
    @return True when the decoy is informative.
  */
  bool kmerDecoySupport(const TaxIndex& idx, const std::string& seq, int k, uint32_t j,
                        std::size_t share_cap, double min_margin,
                        std::vector<uint32_t>& taxa, TagLookupCounters& counters, bool* no_decoy);
  /**
    @brief A tag reversed and I/L folded.

    The reading of a tag written N->C under a y-ion assumption when it was
    really read from b ions.

    @param[in] seq The tag's base sequence.
    @return @p seq reversed and I/L folded.
  */
  std::string reversedFolded(const std::string& seq);

  /**
    @brief Run-level counts of the orientation rule (1.12 #10).

    One per tag looked up under SpeciesOrientation::Both. Tags that are
    informative in neither orientation are not counted.
  */
  struct OrientationCounts
  {
    uint64_t forward = 0;       ///< informative only as written
    uint64_t reverse = 0;       ///< informative only reversed (the gains of both)
    uint64_t intersection = 0;  ///< informative both ways, the common taxa used
    uint64_t ambiguous = 0;     ///< informative both ways without a common taxon: skipped
    uint64_t palindrome = 0;    ///< folded tag equals its reverse: looked up once
  };

  /**
    @brief The taxa supporting one tag in the orientations @p orient asks for.

    Forward: tagSupport(seq) exactly, @p rev_counters and @p oc untouched.
    Both: tagSupport() of @p seq (counted in @p counters) and of
    reversedFolded(@p seq) (counted in @p rev_counters, so the forward
    counters equal a forward run's), combined by combineOrientations(); a
    palindrome (folded) is looked up once.

    @param[in] idx The taxon k-mer index.
    @param[in] seq The tag's base sequence.
    @param[in] k The index k.
    @param[in] share_cap K-mers carried by more taxa than this are skipped.
    @param[in] min_margin Minimum (best - runner-up) / n_eval margin.
    @param[in] orient Forward only, or both orientations.
    @param[out] taxa The combined supporting taxa.
    @param[in,out] counters Filter counters of the forward lookup.
    @param[in,out] rev_counters Filter counters of the reversed lookup.
    @param[in,out] oc If not null, the orientation outcome is counted here.
    @return True when the combined support is non-empty.
  */
  bool orientedTagSupport(const TaxIndex& idx, const std::string& seq, int k,
                          std::size_t share_cap, double min_margin, SpeciesOrientation orient,
                          std::vector<uint32_t>& taxa, TagLookupCounters& counters,
                          TagLookupCounters& rev_counters, OrientationCounts* oc);
}
