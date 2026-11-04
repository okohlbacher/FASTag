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
#pragma once

#include <cstdint>
#include <set>
#include <vector>

namespace FASTag
{
  /// One reported tag's taxon support within a spectrum.
  struct TagSupport
  {
    double evalue = 0.0;          ///< the tag's E-value (lower is better)
    std::vector<uint32_t> taxa;   ///< taxa carrying every evaluated k-mer; empty = not informative
  };

  enum class SpeciesEvidence { Best, All };

  /// The taxa @p tags make one spectrum count for. All: the union over every
  /// informative tag. Best: the union over the informative tags with the
  /// lowest E-value. A NaN E-value never wins in Best mode.
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
}
