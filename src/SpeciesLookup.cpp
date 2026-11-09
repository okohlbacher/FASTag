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

  std::string decoyTag(const std::string& seq, uint32_t j)
  {
    const std::string f = TaxIndex::fold(seq);
    const std::size_t n = f.size();
    if (n < 2) return std::string();
    const std::string r(f.rbegin(), f.rend());
    // FNV-1a 64 over the folded bytes, then the 4 bytes of j (little endian).
    uint64_t h = 0xcbf29ce484222325ULL;
    const auto mix = [&h](unsigned char c) { h ^= c; h *= 0x100000001b3ULL; };
    for (char c : f) mix(static_cast<unsigned char>(c));
    for (int b = 0; b < 4; ++b) mix(static_cast<unsigned char>((j >> (8 * b)) & 0xFFu));
    // splitmix64 stream for the Fisher-Yates shuffle (own generator, so the
    // permutation is the same with every standard library).
    uint64_t state = h;
    const auto next = [&state]() {
      uint64_t z = (state += 0x9e3779b97f4a7c15ULL);
      z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
      z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL;
      return z ^ (z >> 31);
    };
    std::string p = f;
    for (std::size_t i = n - 1; i > 0; --i)
      std::swap(p[i], p[static_cast<std::size_t>(next() % (i + 1))]);
    for (std::size_t rot = 0; rot < n; ++rot)
    {
      if (p != f && p != r) return p;
      std::rotate(p.begin(), p.begin() + 1, p.end());
    }
    return std::string();
  }
  std::string residueDecoy(const std::string& seq, uint32_t j)
  {
    static const char kAlpha[] = "ACDEFGHKLMNPQRSTVWY";  // 19 residues, I folded to L
    constexpr int n = 19;
    // Sattolo's algorithm on a splitmix64 stream seeded by j: a uniformly drawn
    // cyclic permutation, so no residue maps to itself (a derangement).
    char perm[n];
    for (int i = 0; i < n; ++i) perm[i] = kAlpha[i];
    uint64_t state = 0x5ca1ab1e00000000ULL ^ static_cast<uint64_t>(j);
    const auto next = [&state]() {
      uint64_t z = (state += 0x9e3779b97f4a7c15ULL);
      z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
      z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL;
      return z ^ (z >> 31);
    };
    for (int i = n - 1; i > 0; --i)
      std::swap(perm[i], perm[static_cast<int>(next() % static_cast<uint64_t>(i))]);
    char map[256];
    for (int c = 0; c < 256; ++c) map[c] = static_cast<char>(c);
    for (int i = 0; i < n; ++i) map[static_cast<unsigned char>(kAlpha[i])] = perm[i];
    std::string d = TaxIndex::fold(seq);
    for (char& c : d) c = map[static_cast<unsigned char>(c)];
    return d;
  }
  bool kmerDecoySupport(const TaxIndex& idx, const std::string& seq, int k, uint32_t j,
                        std::size_t share_cap, double min_margin,
                        std::vector<uint32_t>& taxa, TagLookupCounters& counters, bool* no_decoy)
  {
    // One consistent decoy sequence for the whole tag: overlapping k-mers stay
    // overlapping, so the whole-tag rule sees the same co-occurrence structure
    // a target tag does (b113 review: independent per-k-mer decoys almost never
    // hit for tags longer than k and made the null anti-conservative).
    if (no_decoy) *no_decoy = false;
    return tagSupport(idx, residueDecoy(seq, j), k, share_cap, min_margin, taxa, counters);
  }

  std::string reversedFolded(const std::string& seq)
  {
    return TaxIndex::fold(std::string(seq.rbegin(), seq.rend()));
  }

  bool orientedTagSupport(const TaxIndex& idx, const std::string& seq, int k,
                          std::size_t share_cap, double min_margin, SpeciesOrientation orient,
                          std::vector<uint32_t>& taxa, TagLookupCounters& counters,
                          TagLookupCounters& rev_counters, OrientationCounts* oc)
  {
    if (orient == SpeciesOrientation::Forward)
      return tagSupport(idx, seq, k, share_cap, min_margin, taxa, counters);
    std::vector<uint32_t> fwd;
    tagSupport(idx, seq, k, share_cap, min_margin, fwd, counters);
    const std::string rseq = reversedFolded(seq);
    if (rseq == TaxIndex::fold(seq))
    {
      // A palindrome reads the same both ways: one lookup, its result as is.
      taxa = std::move(fwd);
      if (oc && !taxa.empty()) ++oc->palindrome;
      return !taxa.empty();
    }
    std::vector<uint32_t> rev;
    tagSupport(idx, rseq, k, share_cap, min_margin, rev, rev_counters);
    const OrientationOutcome o = combineOrientations(fwd, rev, taxa);
    if (oc)
    {
      switch (o)
      {
        case OrientationOutcome::Forward: ++oc->forward; break;
        case OrientationOutcome::Reverse: ++oc->reverse; break;
        case OrientationOutcome::Intersection: ++oc->intersection; break;
        case OrientationOutcome::Ambiguous: ++oc->ambiguous; break;
        case OrientationOutcome::None: break;
      }
    }
    return !taxa.empty();
  }
}
