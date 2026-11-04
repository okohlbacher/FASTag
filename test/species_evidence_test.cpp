// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
//
// species_evidence_test.cpp -- which taxa one spectrum counts for in -species.
// Returns 0 when every check passes.

#include "SpeciesEvidence.h"

#include <cmath>
#include <cstdio>
#include <limits>
#include <set>
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
    CHECK(spectrumTaxa(tags, SpeciesEvidence::All) == (Set{1, 2, 7, 8, 9}), "All is the union");
    CHECK(spectrumTaxa(tags, SpeciesEvidence::Best) == (Set{1, 2}), "Best keeps the best tag's taxa");
    tags.push_back({15.0, {3}});
    tags.push_back({18.0, {4, 5}});
    CHECK(spectrumTaxa(tags, SpeciesEvidence::Best) == (Set{1, 2}),
          "Best does not change when more low-ranked tags are reported");
  }

  // 2. Row order does not matter: the best tag may come last (multi-length
  //    rows are grouped by length, not sorted by E-value).
  {
    std::vector<TagSupport> tags = {{9.0, {7}}, {0.5, {3}}, {0.02, {1}}};
    CHECK(spectrumTaxa(tags, SpeciesEvidence::Best) == (Set{1}), "best tag found anywhere in the list");
  }

  // 3. Ties at the best E-value are united, so the result is order-independent.
  {
    std::vector<TagSupport> a = {{0.1, {1}}, {0.1, {2}}, {4.0, {3}}};
    std::vector<TagSupport> b = {{4.0, {3}}, {0.1, {2}}, {0.1, {1}}};
    CHECK(spectrumTaxa(a, SpeciesEvidence::Best) == (Set{1, 2}), "tied best tags are united");
    CHECK(spectrumTaxa(a, SpeciesEvidence::Best) == spectrumTaxa(b, SpeciesEvidence::Best), "order-independent");
  }

  // 4. Tags that do not map (empty taxa) never become the best tag.
  {
    std::vector<TagSupport> tags = {{0.0001, {}}, {2.0, {5}}};
    CHECK(spectrumTaxa(tags, SpeciesEvidence::Best) == (Set{5}), "an unmapped tag cannot be best");
    CHECK(spectrumTaxa({}, SpeciesEvidence::Best).empty(), "no tags, no taxa");
    CHECK(spectrumTaxa({{1.0, {}}}, SpeciesEvidence::All).empty(), "no informative tag, no taxa");
  }

  // 5. A NaN E-value (unparsable) never wins; with only NaNs every tag counts.
  {
    const double nan = std::numeric_limits<double>::quiet_NaN();
    std::vector<TagSupport> tags = {{nan, {1}}, {3.0, {2}}};
    CHECK(spectrumTaxa(tags, SpeciesEvidence::Best) == (Set{2}), "NaN does not beat a finite E-value");
    std::vector<TagSupport> only_nan = {{nan, {1}}, {nan, {2}}};
    CHECK(spectrumTaxa(only_nan, SpeciesEvidence::Best) == (Set{1, 2}), "only NaN: union");
  }

  if (g_fail) { std::fprintf(stderr, "species_evidence_test: %d failure(s)\n", g_fail); return 1; }
  std::printf("species_evidence_test: all checks passed\n");
  return 0;
}
