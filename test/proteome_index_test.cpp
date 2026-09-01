// ProteomeIndex: locate correctness against brute force, collapse-branching
// equivalence with FastaFilter's DB-side contraction, tryptic windows against
// OpenMS's own digestion, and flank masses against AASequence.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "ProteomeIndex.h"
#include "FastaFilter.h"

#include <OpenMS/CHEMISTRY/AASequence.h>
#include <OpenMS/CHEMISTRY/ProteaseDigestion.h>

#include <algorithm>
#include <cmath>
#include <iostream>
#include <random>
#include <set>
#include <string>
#include <vector>

using namespace FASTag;
using namespace OpenMS;

namespace
{
  int failures = 0;
  void check(bool ok, const std::string& what)
  {
    if (!ok) { std::cerr << "FAIL: " << what << "\n"; ++failures; }
  }

  std::vector<FASTAFile::FASTAEntry> entries(const std::vector<std::string>& seqs)
  {
    std::vector<FASTAFile::FASTAEntry> out;
    for (size_t i = 0; i < seqs.size(); ++i)
      out.emplace_back("P" + std::to_string(i), "test", seqs[i]);
    return out;
  }

  /// Every (protein, offset) where `pat` occurs literally in the folded seqs.
  size_t bruteCount(const std::vector<std::string>& seqs, std::string pat)
  {
    for (char& c : pat) if (c == 'I') c = 'L';
    size_t n = 0;
    for (auto s : seqs)
    {
      std::string f;
      for (char c : s) { const char x = normResidue(c); if (x) f.push_back(x); }
      for (size_t i = 0; i + pat.size() <= f.size(); ++i)
        if (f.compare(i, pat.size(), pat) == 0) ++n;
    }
    return n;
  }
}

int main()
{
  std::mt19937 rng(42);
  const char AA[] = "ACDEFGHKLMNPQRSTVWY";

  // --- 1. locate vs brute force on random proteins, no collapse rules ---
  {
    std::vector<std::string> seqs;
    for (int p = 0; p < 20; ++p)
    {
      std::string s;
      for (int i = 0; i < 200; ++i) s += AA[rng() % 19];
      seqs.push_back(s);
    }
    ProteomeIndex idx;
    idx.build(entries(seqs), {}, /*isobaric_tol=*/0);

    for (int trial = 0; trial < 200; ++trial)
    {
      const auto& s = seqs[rng() % seqs.size()];
      const size_t k = 3 + rng() % 10;
      const size_t at = rng() % (s.size() - k);
      const std::string pat = s.substr(at, k);
      std::vector<ProteomeIndex::TagOcc> occ;
      idx.locateTag(pat, /*both=*/false, occ);
      check(occ.size() == bruteCount(seqs, pat),
            "locate count mismatch for " + pat);
      for (const auto& o : occ)
        check(idx.foldedText(o.pos, o.pos + o.len) == pat, "occurrence text mismatch");
    }
    // A pattern that is absent
    std::vector<ProteomeIndex::TagOcc> occ;
    idx.locateTag("WWWWWWWWWW", false, occ);
    check(occ.size() == bruteCount(seqs, "WWWWWWWWWW"), "absent-pattern count");
    std::cout << "1. locate == brute force over 200 random patterns\n";
  }

  // --- 2. orientation: reversed occurrences carry the flag; sentinels split ---
  {
    ProteomeIndex idx;
    idx.build(entries({"AAACDEFGGG", "GGGFEDCAAA"}), {}, 0);
    std::vector<ProteomeIndex::TagOcc> occ;
    idx.locateTag("CDEF", /*both=*/true, occ);
    // forward in protein 0, reversed in protein 1
    check(occ.size() == 2, "both orientations found");
    check(std::count_if(occ.begin(), occ.end(), [](auto& o) { return o.reversed; }) == 1,
          "exactly one reversed");
    // No match spanning proteins: "GGGGGG" exists only as two 3-runs split by '#'
    occ.clear();
    idx.locateTag("GGGGGG", true, occ);
    check(occ.empty(), "no match across the sentinel");
    std::cout << "2. orientation flags + sentinel isolation\n";
  }

  // --- 3. collapse equivalence with FastaFilter: tag N vs database GG ---
  {
    const std::string seq = "ARNDCQEGGHKLMFPSTWYV";
    ProteomeIndex idx;
    idx.build(entries({seq}), {}, /*isobaric_tol=*/0.04);
    check(idx.collapseRuleCount() > 0, "rules derived");

    std::vector<ProteomeIndex::TagOcc> occ;
    idx.locateTag("QENH", true, occ);  // N spells the database's GG
    bool found = false;
    for (const auto& o : occ)
      if (!o.reversed && o.len == 5 && idx.foldedText(o.pos, o.pos + o.len) == "QEGGH")
        found = true;
    check(found, "N-for-GG collapse located with db length 5");

    // Cross-check the SEMANTICS against FastaFilter on many random tags: the
    // filter contracts DB pairs, the index expands query singles -- accepted
    // sets must agree.
    FastaFilter filt(true);
    filt.load(entries({seq}));
    filt.setMinLen(4);
    filt.deriveCollapses(0.04);
    filt.build(4, 4);
    for (int trial = 0; trial < 3000; ++trial)
    {
      std::string tag;
      for (int i = 0; i < 4; ++i) tag += AA[rng() % 19];
      std::vector<ProteomeIndex::TagOcc> o2;
      idx.locateTag(tag, true, o2);
      const bool filter_hit = filt.match(tag) != FastaFilter::Hit::None;
      const bool index_hit = !o2.empty();
      check(filter_hit == index_hit,
            "filter/index disagreement on " + tag);
    }
    std::cout << "3. collapse equivalence with FastaFilter over 3000 tags\n";
  }

  // --- 4. tryptic windows vs ProteaseDigestion, with missed cleavages ---
  {
    const std::string prot = "MKAAARDDDKPEEEKFFFRGGG";  // KP = no cut after that K
    for (int mc = 0; mc <= 2; ++mc)
    {
      ProteomeIndex idx;
      idx.build(entries({prot}), {}, 0);

      ProteaseDigestion dig;
      dig.setEnzyme("Trypsin");
      dig.setMissedCleavages(mc);
      std::vector<AASequence> parts;
      dig.digest(AASequence::fromString(prot), parts);
      std::set<std::string> expected;
      for (const auto& p : parts) expected.insert(p.toUnmodifiedString());

      // Union of windows over every position must reproduce the digest set.
      std::set<std::string> got;
      std::vector<ProteomeIndex::Window> w;
      for (uint32_t pos = 0; pos < prot.size(); ++pos)
      {
        w.clear();
        idx.windowsAt(pos, 1, mc, w);
        for (const auto& win : w) got.insert(idx.originalText(win.start, win.end));
      }
      check(got == expected, "window set == ProteaseDigestion at mc=" + std::to_string(mc));
    }
    std::cout << "4. windowsAt == ProteaseDigestion for mc 0..2\n";
  }

  // --- 5. flank masses vs AASequence, fixed mods folded ---
  {
    const std::string prot = "MSTVWYAARSAMPLEVGATSDGKGTANLEFDSK";
    const double cam = 57.02146;
    ProteomeIndex idx;
    idx.build(entries({prot}), {{'C', cam}}, 0);
    // window "SAMPLEVGATSDGK" starts at 9; tag "PLE" at text pos 12..15
    std::vector<ProteomeIndex::TagOcc> occ;
    idx.locateTag("PLE", false, occ);
    check(occ.size() == 1, "PLE located once");
    std::vector<ProteomeIndex::Window> w;
    idx.windowsAt(occ[0].pos, occ[0].len, 0, w);
    check(w.size() == 1, "one tryptic window at mc=0");
    const double db_n = idx.massBetween(w[0].start, occ[0].pos);
    const double db_c = idx.massBetween(occ[0].pos + occ[0].len, w[0].end);
    const double want_n = AASequence::fromString("SAM").getMonoWeight(Residue::Internal);
    const double want_c = AASequence::fromString("VGATSDGK").getMonoWeight(Residue::Internal);
    check(std::fabs(db_n - want_n) < 1e-6, "N flank mass matches AASequence");
    check(std::fabs(db_c - want_c) < 1e-6, "C flank mass matches AASequence");
    check(idx.proteinAt(occ[0].pos) == "P0", "protein accession resolves");
    std::cout << "5. flank masses match AASequence\n";
  }

  // --- 6. ambiguity residues are hard barriers ---
  {
    ProteomeIndex idx;
    idx.build(entries({"AAAKXDDDK"}), {}, 0);
    std::vector<ProteomeIndex::TagOcc> occ;
    idx.locateTag("KXD", false, occ);
    check(occ.empty(), "patterns cannot contain ambiguity residues");
    occ.clear();
    idx.locateTag("DDDK", false, occ);
    check(occ.size() == 1, "segment after X still matches");
    std::vector<ProteomeIndex::Window> w;
    idx.windowsAt(occ[0].pos, occ[0].len, 5, w);
    for (const auto& win : w)
      check(idx.foldedText(win.start, win.end).find(RESIDUE_AMBIG) == std::string::npos,
            "no window contains the barrier");
    check(!w.empty(), "windows exist within the segment");
    std::cout << "6. ambiguity barrier honored\n";
  }

  // --- 7. derived floor sanity ---
  {
    ProteomeIndex idx;
    std::vector<std::string> seqs;
    std::string s;
    for (int i = 0; i < 100000; ++i) s += AA[rng() % 19];
    seqs.push_back(s);
    idx.build(entries(seqs), {}, 0);
    check(idx.autoMinLen() >= 5 && idx.autoMinLen() <= 7,
          "autoMinLen in a plausible range for 100k residues");
    std::cout << "7. autoMinLen = " << idx.autoMinLen() << " for 100k residues\n";
  }

  if (failures == 0) std::cout << "proteome_index_test: all checks passed\n";
  return failures == 0 ? 0 : 1;
}
