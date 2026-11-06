// See SpeciesLookup.h.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "SpeciesLookup.h"

#include <algorithm>
#include <map>

namespace FASTag
{
  bool tagSupport(const TaxIndex& idx, const std::string& seq, int k,
                  std::size_t share_cap, double min_margin,
                  std::vector<uint32_t>& taxa, TagLookupCounters& counters)
  {
    taxa.clear();
    const int tag_len = static_cast<int>(seq.size());
    // Buffer reused across this tag's k-mers: lookup() fills it rather than
    // returning a reference, because the mapped index holds taxon INDICES, not
    // a vector to borrow.
    std::vector<uint32_t> kmer_taxa;
    std::map<uint32_t, int> kmers_per_taxon;  // taxon -> how many of this tag's k-mers it carries
    int n_eval = 0;                           // k-mers that were discriminative enough to use
    for (int i = 0; i + k <= tag_len; ++i)
    {
      idx.lookup(TaxIndex::fold(seq.substr(static_cast<std::size_t>(i), static_cast<std::size_t>(k))), kmer_taxa);
      // A k-mer in NO taxon kills the tag: the reference cannot explain this
      // tag at all.
      if (kmer_taxa.empty()) return false;
      if (kmer_taxa.size() > share_cap) { ++counters.kmer_skipped; continue; }
      ++n_eval;
      for (uint32_t tx : kmer_taxa) ++kmers_per_taxon[tx];
    }
    if (n_eval == 0) return false;

    int best = 0;
    for (const auto& kv : kmers_per_taxon) best = std::max(best, kv.second);
    // The whole-tag rule: a taxon must carry EVERY k-mer that was actually
    // evaluated. With share_cap at its maximum that is plain set intersection.
    if (best < n_eval) return false;
    int runner = 0;
    for (const auto& kv : kmers_per_taxon) if (kv.second < best) runner = std::max(runner, kv.second);
    const double margin = static_cast<double>(best - runner) / static_cast<double>(n_eval);
    if (margin < min_margin) { ++counters.tag_generic; return false; }
    for (const auto& kv : kmers_per_taxon) if (kv.second == best) taxa.push_back(kv.first);
    return true;
  }
}
