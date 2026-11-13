// Which taxa one spectrum counts for in -species.
//
// A spectrum is one peptide, but FASTag reports up to -max_tags tags for it,
// most of them wrong readings. Each tag that maps into the index supports the
// taxa carrying all of its k-mers. Taking the UNION over every reported tag
// lets every wrong tag add the taxa its random 7-mer happens to hit, so the
// count of a taxon grows with the number of tags reported per spectrum rather
// than with the number of spectra that evidence it. Large and widely shared
// proteomes (vertebrates, plants) collect most of those chance hits, and the
// default ranking (by spectrum count) then turns on how many low-ranked tags
// were reported. Scoring changes that only reorder or admit lower-ranked tags
// (FASTag 1.9.0: gap edges, per-peak ppm fidelity, merged 1+/2+ copies) moved
// the ranking of true genera although the best tags were unchanged.
//
// The BEST mode counts a spectrum for the taxa of its best-scoring informative
// tag only: the lowest E-value among the tags that map; tags tied at that
// E-value are united, so the result does not depend on row order.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#pragma once

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <iterator>
#include <set>
#include <vector>

namespace FASTag
{
  /**
    @brief One reported tag's taxon support within a spectrum.
  */
  struct TagSupport
  {
    double evalue = 0.0;          ///< the tag's E-value (lower is better)
    std::vector<uint32_t> taxa;   ///< taxa carrying every evaluated k-mer; empty = not informative
  };

  /**
    @brief Which tags of a spectrum count for -species (see the file comment).
  */
  enum class SpeciesEvidence { Best, All };

  /**
    @brief The taxa the tags of one spectrum make it count for.

    All: the union over every informative tag. Best: the union over the
    informative tags with the lowest E-value. A NaN E-value never wins in Best
    mode; if all informative tags have NaN E-values, all of them count.

    @param[in] tags The reported tags of the spectrum with their taxon support.
    @param[in] mode Best or All.
    @return The taxa the spectrum counts for.
  */
  inline std::set<uint32_t> spectrumTaxa(const std::vector<TagSupport>& tags, SpeciesEvidence mode)
  {
    std::set<uint32_t> out;
    if (mode == SpeciesEvidence::All)
    {
      for (const TagSupport& t : tags) out.insert(t.taxa.begin(), t.taxa.end());
      return out;
    }
    const TagSupport* best = nullptr;
    for (const TagSupport& t : tags)
      if (!t.taxa.empty() && t.evalue == t.evalue && (!best || t.evalue < best->evalue)) best = &t;
    if (!best)
    {
      // Only NaN E-values among the informative tags: no ordering, so all count.
      for (const TagSupport& t : tags) out.insert(t.taxa.begin(), t.taxa.end());
      return out;
    }
    for (const TagSupport& t : tags)
      if (!t.taxa.empty() && t.evalue == best->evalue) out.insert(t.taxa.begin(), t.taxa.end());
    return out;
  }
  /**
    @brief Which orientations of a tag -species looks up (1.12 #10, -species_orientation).

    Independent of -orientation, which governs -fasta and reconciliation only.
  */
  enum class SpeciesOrientation { Forward, Both };

  /**
    @brief What combineOrientations() made of one tag.
  */
  enum class OrientationOutcome
  {
    None,          ///< neither orientation is informative
    Forward,       ///< only the tag as written is informative
    Reverse,       ///< only the reversed tag is informative
    Intersection,  ///< both are informative and share taxa: the shared taxa
    Ambiguous      ///< both are informative with no common taxon: skipped
  };

  /**
    @brief Combines the taxon support of a tag as written and reversed.

    An empty vector is an orientation that is not informative. One
    informative orientation is used as it is; two are intersected; two
    without a common taxon make the tag orientation-ambiguous, and it
    supports nothing. The union is never taken: it would let a tag count
    for the chance hits of both readings. Swapping @p fwd and @p rev gives
    the same @p out (with Forward and Reverse swapped).

    @param[in] fwd Ascending taxa of the tag as written (as tagSupport() returns them).
    @param[in] rev Ascending taxa of the reversed tag.
    @param[out] out The combined taxa (cleared first).
    @return The outcome for the tag.
  */
  inline OrientationOutcome combineOrientations(const std::vector<uint32_t>& fwd,
                                                const std::vector<uint32_t>& rev,
                                                std::vector<uint32_t>& out)
  {
    out.clear();
    if (fwd.empty() && rev.empty()) return OrientationOutcome::None;
    if (rev.empty()) { out = fwd; return OrientationOutcome::Forward; }
    if (fwd.empty()) { out = rev; return OrientationOutcome::Reverse; }
    std::set_intersection(fwd.begin(), fwd.end(), rev.begin(), rev.end(), std::back_inserter(out));
    return out.empty() ? OrientationOutcome::Ambiguous : OrientationOutcome::Intersection;
  }
}
