// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
//
// species_evidence_test.cpp -- which taxa one spectrum counts for in -species.
// Returns 0 when every check passes.

#include "SpeciesEvidence.h"
#include "SpeciesLookup.h"
#include "TaxIndex.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <limits>
#include <set>
#include <string>
#include <vector>

namespace
{
  int g_fail = 0;
#define CHECK(cond, msg)                                                       \
  do {                                                                         \
    if (!(cond)) { std::fprintf(stderr, "FAIL line %d: %s\n", __LINE__, msg); ++g_fail; } \
  } while (0)

  using FASTag::SpeciesEvidence;
  using FASTag::TagSupport;
  using FASTag::spectrumTaxa;
  using Set = std::set<uint32_t>;
}

int main()
{
  // 1. The defect: one correct tag (taxa 1, 2) and wrong lower-ranked tags whose
  //    7-mers hit other taxa by chance. The union credits every one of them, so
  //    adding wrong tags raises the count of unrelated taxa; Best does not.
  {
    std::vector<TagSupport> tags = {{0.001, {1, 2}}, {3.5, {7}}, {12.0, {8, 9}}};
    CHECK(spectrumTaxa(tags, SpeciesEvidence::ALL) == (Set{1, 2, 7, 8, 9}), "All is the union");
    CHECK(spectrumTaxa(tags, SpeciesEvidence::BEST) == (Set{1, 2}), "Best keeps the best tag's taxa");
    tags.push_back({15.0, {3}});
    tags.push_back({18.0, {4, 5}});
    CHECK(spectrumTaxa(tags, SpeciesEvidence::BEST) == (Set{1, 2}),
          "Best does not change when more low-ranked tags are reported");
  }

  // 2. Row order does not matter: the best tag may come last (multi-length
  //    rows are grouped by length, not sorted by E-value).
  {
    std::vector<TagSupport> tags = {{9.0, {7}}, {0.5, {3}}, {0.02, {1}}};
    CHECK(spectrumTaxa(tags, SpeciesEvidence::BEST) == (Set{1}), "best tag found anywhere in the list");
  }

  // 3. Ties at the best E-value are united, so the result is order-independent.
  {
    std::vector<TagSupport> a = {{0.1, {1}}, {0.1, {2}}, {4.0, {3}}};
    std::vector<TagSupport> b = {{4.0, {3}}, {0.1, {2}}, {0.1, {1}}};
    CHECK(spectrumTaxa(a, SpeciesEvidence::BEST) == (Set{1, 2}), "tied best tags are united");
    CHECK(spectrumTaxa(a, SpeciesEvidence::BEST) == spectrumTaxa(b, SpeciesEvidence::BEST), "order-independent");
  }

  // 4. Tags that do not map (empty taxa) never become the best tag.
  {
    std::vector<TagSupport> tags = {{0.0001, {}}, {2.0, {5}}};
    CHECK(spectrumTaxa(tags, SpeciesEvidence::BEST) == (Set{5}), "an unmapped tag cannot be best");
    CHECK(spectrumTaxa({}, SpeciesEvidence::BEST).empty(), "no tags, no taxa");
    CHECK(spectrumTaxa({{1.0, {}}}, SpeciesEvidence::ALL).empty(), "no informative tag, no taxa");
  }

  // 5. A NaN E-value (unparsable) never wins; with only NaNs every tag counts.
  {
    const double nan = std::numeric_limits<double>::quiet_NaN();
    std::vector<TagSupport> tags = {{nan, {1}}, {3.0, {2}}};
    CHECK(spectrumTaxa(tags, SpeciesEvidence::BEST) == (Set{2}), "NaN does not beat a finite E-value");
    std::vector<TagSupport> only_nan = {{nan, {1}}, {nan, {2}}};
    CHECK(spectrumTaxa(only_nan, SpeciesEvidence::BEST) == (Set{1, 2}), "only NaN: union");
  }

  // 6. The decoy list of -species_call (1.12 #1): every target tag's decoys
  //    carry the target's E-value and go through the same lookup and the same
  //    Best rule, so a spectrum's decoy taxa never borrow the target's taxa by
  //    construction. On a toy index the decoys of genuine tags map nowhere.
  {
    std::vector<OpenMS::FASTAFile::FASTAEntry> se;
    se.emplace_back("t1", "", "ACDEFGHKLMNPQRSTVWY");
    se.emplace_back("t2", "", "YWVTSRQPNMLKHGFEDCA");
    std::vector<uint32_t> st = {1, 2};
    FASTag::TaxIndex idx;
    idx.build(se, st, 4);
    const std::vector<std::pair<std::string, double>> rows = {{"CDEFGHK", 0.01}, {"MNPQRST", 2.0}};
    std::vector<TagSupport> target;
    FASTag::TagLookupCounters c;
    for (const auto& r : rows)
    {
      TagSupport t;
      t.evalue = r.second;
      if (FASTag::tagSupport(idx, r.first, 4, 2, 0.0, t.taxa, c)) target.push_back(t);
    }
    CHECK(spectrumTaxa(target, SpeciesEvidence::BEST) == (Set{1}), "decoy list: the target counts for taxon 1");
    for (uint32_t j = 0; j < 5; ++j)
    {
      std::vector<TagSupport> decoy;
      FASTag::TagLookupCounters dc;
      for (const auto& r : rows)
      {
        TagSupport t;
        t.evalue = r.second;
        const std::string d = FASTag::decoyTag(r.first, j);
        CHECK(!d.empty() && d != r.first, "decoy list: each tag has a decoy that is not the tag");
        if (FASTag::tagSupport(idx, d, 4, 2, 0.0, t.taxa, dc)) decoy.push_back(t);
      }
      CHECK(spectrumTaxa(decoy, SpeciesEvidence::BEST).count(1) == 0, "decoy list: decoys do not reproduce the target taxon");
      CHECK(c.kmer_skipped == 0 && c.tag_generic == 0, "decoy list: target counters untouched by the decoy pass");
    }
  }

  // 7. Both tag orientations (1.12 #10): combineOrientations.
  {
    using FASTag::OrientationOutcome;
    using V = std::vector<uint32_t>;
    V out;
    CHECK(FASTag::combineOrientations({1, 2}, {}, out) == OrientationOutcome::FORWARD && out == (V{1, 2}),
          "orientations: forward only is used as it is");
    CHECK(FASTag::combineOrientations({}, {3}, out) == OrientationOutcome::REVERSE && out == (V{3}),
          "orientations: reverse only is used as it is");
    CHECK(FASTag::combineOrientations({1, 2, 3}, {2, 3, 4}, out) == OrientationOutcome::INTERSECTION
              && out == (V{2, 3}),
          "orientations: both informative -> the intersection, not the union");
    CHECK(FASTag::combineOrientations({1}, {2}, out) == OrientationOutcome::AMBIGUOUS && out.empty(),
          "orientations: disjoint -> ambiguous, supports nothing");
    CHECK(FASTag::combineOrientations({}, {}, out) == OrientationOutcome::NONE && out.empty(),
          "orientations: neither informative");
    out = {9};
    FASTag::combineOrientations({}, {}, out);
    CHECK(out.empty(), "orientations: out is cleared");
    // Order independence: swapping the readings gives the same taxa, with
    // Forward and Reverse swapped.
    const std::vector<V> sets = {{}, {1}, {2}, {1, 2}, {2, 5, 7}, {1, 5}, {7}};
    bool sym = true;
    for (const V& a : sets)
      for (const V& b : sets)
      {
        V ab, ba;
        const OrientationOutcome o1 = FASTag::combineOrientations(a, b, ab);
        const OrientationOutcome o2 = FASTag::combineOrientations(b, a, ba);
        const OrientationOutcome mirrored = o1 == OrientationOutcome::FORWARD ? OrientationOutcome::REVERSE
            : o1 == OrientationOutcome::REVERSE ? OrientationOutcome::FORWARD : o1;
        if (ab != ba || o2 != mirrored) sym = false;
        if (!ab.empty() && !a.empty() && !b.empty())
          for (uint32_t t : ab)
            if (!std::binary_search(a.begin(), a.end(), t) || !std::binary_search(b.begin(), b.end(), t)) sym = false;
      }
    CHECK(sym, "orientations: order-independent, never outside both readings");
  }

  // 8. orientedTagSupport on a toy index: the E-value of a tag is kept
  //    whichever reading made it informative, so Best picks by E-value
  //    across orientations; palindromes are looked up once; forward is
  //    tagSupport exactly.
  {
    std::vector<OpenMS::FASTAFile::FASTAEntry> se;
    se.emplace_back("t1", "", "GGACDEFHKGG");        // taxon 1: CDEF... forward
    se.emplace_back("t2", "", "WWYTSRQPNWW");        // taxon 2: NPQRSTY reversed
    se.emplace_back("t3", "", "GGKLMMLKGG");         // taxon 3: a palindrome KLMMLK
    se.emplace_back("t4", "", "AALMMLAA");           // taxon 4 shares only LMML
    std::vector<uint32_t> st = {1, 2, 3, 4};
    FASTag::TaxIndex idx;
    idx.build(se, st, 4);
    using FASTag::SpeciesOrientation;
    using V = std::vector<uint32_t>;
    FASTag::TagLookupCounters c, rc;
    FASTag::OrientationCounts oc;
    // Spectrum: a forward tag of taxon 1 at E 1.0 and a reverse-only tag of
    // taxon 2 at E 0.01.
    const std::vector<std::pair<std::string, double>> rows = {{"CDEFHK", 1.0}, {"NPQRSTY", 0.01}};
    std::vector<TagSupport> fwd_list, both_list;
    for (const auto& r : rows)
    {
      TagSupport t;
      t.evalue = r.second;
      if (FASTag::orientedTagSupport(idx, r.first, 4, 3, 0.0, SpeciesOrientation::FORWARD, t.taxa, c, rc, &oc))
        fwd_list.push_back(t);
      TagSupport u;
      u.evalue = r.second;
      if (FASTag::orientedTagSupport(idx, r.first, 4, 3, 0.0, SpeciesOrientation::BOTH, u.taxa, c, rc, &oc))
        both_list.push_back(u);
    }
    CHECK(spectrumTaxa(fwd_list, SpeciesEvidence::BEST) == (Set{1}), "orientation: forward sees only taxon 1");
    CHECK(spectrumTaxa(both_list, SpeciesEvidence::BEST) == (Set{2}),
          "orientation: both keeps the reverse-only tag's E-value, which is best");
    CHECK(both_list.size() == 2 && both_list[1].evalue == 0.01, "orientation: E-value preserved");
    CHECK(oc.forward == 1 && oc.reverse == 1 && oc.intersection == 0 && oc.ambiguous == 0,
          "orientation: one forward-only and one reverse-only tag counted (forward runs count nothing)");
    // Palindrome: one lookup, so the reverse counters stay untouched (the
    // shared k-mer LMML is skipped at share cap 1, counted once).
    FASTag::TagLookupCounters pc, prc;
    FASTag::OrientationCounts poc;
    V taxa;
    CHECK(FASTag::orientedTagSupport(idx, "KLMMLK", 4, 1, 0.0, SpeciesOrientation::BOTH, taxa, pc, prc, &poc),
          "orientation: palindrome informative");
    CHECK(taxa == (V{3}) && poc.palindrome == 1 && poc.forward + poc.reverse + poc.intersection == 0,
          "orientation: palindrome counted once as a palindrome");
    CHECK(pc.kmer_skipped == 1 && prc.kmer_skipped == 0, "orientation: palindrome looked up once");
    // I/L folding: KIMMLK folds to KLMMLK, a palindrome after folding.
    poc = {};
    CHECK(FASTag::orientedTagSupport(idx, "KIMMLK", 4, 1, 0.0, SpeciesOrientation::BOTH, taxa, pc, prc, &poc)
              && taxa == (V{3}) && poc.palindrome == 1,
          "orientation: a palindrome after I/L folding");
  }

  if (g_fail) { std::fprintf(stderr, "species_evidence_test: %d failure(s)\n", g_fail); return 1; }
  std::printf("species_evidence_test: all checks passed\n");
  return 0;
}
