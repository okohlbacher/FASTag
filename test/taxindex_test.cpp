// TaxIndex: k-mer -> taxon-set index over a reduced reference database.
// Dataset-independent: tiny synthetic proteins with known taxids, so the
// expected postings and lookups are exact.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "SpeciesLookup.h"
#include "TaxIndex.h"

#include <algorithm>
#include <map>
#include <random>

#include <cstdint>
#include <cstdio>
#include <fstream>
#include <iostream>
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

  // The 1.11 inline loop of FASTag.cpp phase 10, verbatim apart from the
  // variable plumbing: the reference SpeciesLookup::tagSupport must equal.
  struct OldResult { bool ok = false; std::vector<uint32_t> taxa; uint64_t skipped = 0, generic = 0; };
  OldResult oldTagSupport(const TaxIndex& idx, const std::string& seq, int index_k,
                          size_t share_cap, double min_margin)
  {
    OldResult r;
    uint64_t n_kmer_skipped = 0, n_tag_generic = 0;
    do
    {
      const int tag_len = static_cast<int>(seq.size());
      std::vector<uint32_t> kmer_taxa;
      std::map<uint32_t, int> kmers_per_taxon;
      int n_eval = 0;
      bool unexplained = false;
      for (int i = 0; i + index_k <= tag_len; ++i)
      {
        idx.lookup(TaxIndex::fold(seq.substr(static_cast<size_t>(i), static_cast<size_t>(index_k))), kmer_taxa);
        if (kmer_taxa.empty()) { unexplained = true; break; }
        if (kmer_taxa.size() > share_cap) { ++n_kmer_skipped; continue; }
        ++n_eval;
        for (uint32_t tx : kmer_taxa) ++kmers_per_taxon[tx];
      }
      if (unexplained || n_eval == 0) continue;
      int best = 0;
      for (const auto& kv : kmers_per_taxon) best = std::max(best, kv.second);
      if (best < n_eval) continue;
      int runner = 0;
      for (const auto& kv : kmers_per_taxon) if (kv.second < best) runner = std::max(runner, kv.second);
      const double margin = static_cast<double>(best - runner) / static_cast<double>(n_eval);
      if (margin < min_margin) { ++n_tag_generic; continue; }
      r.ok = true;
      for (const auto& kv : kmers_per_taxon) if (kv.second == best) r.taxa.push_back(kv.first);
    } while (false);
    r.skipped = n_kmer_skipped;
    r.generic = n_tag_generic;
    return r;
  }

  // One tagSupport call compared with the old loop; returns the new result.
  OldResult newTagSupport(const TaxIndex& idx, const std::string& seq, int k,
                          size_t share_cap, double min_margin)
  {
    OldResult r;
    TagLookupCounters c;
    r.taxa = {999u};  // must be cleared
    r.ok = tagSupport(idx, seq, k, share_cap, min_margin, r.taxa, c);
    r.skipped = c.kmer_skipped;
    r.generic = c.tag_generic;
    return r;
  }

  bool sameAsOld(const TaxIndex& idx, const std::string& seq, int k, size_t share_cap, double min_margin,
                 OldResult* out = nullptr)
  {
    const OldResult o = oldTagSupport(idx, seq, k, share_cap, min_margin);
    const OldResult n = newTagSupport(idx, seq, k, share_cap, min_margin);
    if (out) *out = n;
    return o.ok == n.ok && o.taxa == n.taxa && o.skipped == n.skipped && o.generic == n.generic
        && (n.ok || n.taxa.empty());
  }
}

int main()
{
  // Three "proteins" from three taxa. AAAAAAAA (8*A) is shared by taxa 10 and 20;
  // CDEFGHKL is unique to taxon 10; MNPQRSTV unique to taxon 30. I is folded to L,
  // so a tag with I must match a peptide k-mer with L.
  std::vector<FASTAFile::FASTAEntry> e;
  e.emplace_back("p10a", "", "AAAAAAAACDEFGHKL");   // taxon 10
  e.emplace_back("p20a", "", "AAAAAAAAWYWYWYWY");   // taxon 20 (only shares the A-run)
  e.emplace_back("p30a", "", "MNPQRSTVGATSDGKL");   // taxon 30
  std::vector<uint32_t> tax = {10, 20, 30};

  TaxIndex idx;
  idx.build(e, tax, /*k=*/8);
  check(idx.k() == 8, "k stored");

  // lookup() fills a caller buffer: the v2 image stores taxon INDICES, so there
  // is no vector in the file to hand back a reference to.
  std::vector<uint32_t> s;

  // AAAAAAAA is in taxa 10 and 20.
  idx.lookup("AAAAAAAA", s);
  check(s.size() == 2 && s[0] == 10 && s[1] == 20, "shared 8-mer maps to both taxa, sorted");
  // CDEFGHKL only in taxon 10.
  idx.lookup("CDEFGHKL", s);
  check(s.size() == 1 && s[0] == 10, "unique 8-mer maps to one taxon");
  // MNPQRSTV only in taxon 30.
  idx.lookup("MNPQRSTV", s);
  check(s == std::vector<uint32_t>{30}, "taxon-30 8-mer");
  {
    const std::string q = TaxIndex::fold("GATSDGKL");
    idx.lookup(q, s);
    check(s.size() == 1 && s[0] == 30, "internal 8-mer of p30a");
  }
  // Absent k-mer -> empty.
  idx.lookup("WWWWWWWW", s);
  check(s.empty(), "absent k-mer is empty");
  // A k-mer containing a residue outside the folded 19-letter alphabet has no
  // code at all and must not match anything.
  idx.lookup("AAAAAAAX", s);
  check(s.empty(), "k-mer with an ambiguous residue is empty");
  // Wrong length is rejected rather than silently truncated.
  idx.lookup("AAAA", s);
  check(s.empty(), "wrong-length query is empty");

  check(idx.postings(10) >= 1 && idx.postings(20) >= 1 && idx.postings(30) >= 1, "all taxa have postings");
  check(idx.nKmers() > 0, "index non-empty");
  {
    auto t = idx.taxa();
    check(t.size() == 3 && t[0] == 10 && t[1] == 20 && t[2] == 30, "taxa() lists all three, sorted");
  }

  // base-19 packing: distinct k-mers must get distinct codes, and anything with
  // an out-of-alphabet residue must be rejected.
  check(TaxIndex::encode("AAAAAAAA", 8) != TaxIndex::encode("AAAAAAAC", 8), "codes are distinct");
  check(TaxIndex::encode("AAAAAAAX", 8) == UINT64_MAX, "ambiguous residue has no code");
  check(TaxIndex::encode("AAAAAAAI", 8) == TaxIndex::encode("AAAAAAAL", 8), "I folds onto L in the code");
  check(TaxIndex::keyBytes(7) == 4 && TaxIndex::keyBytes(8) == 5, "key width follows 19^k");

  // Save / load round-trip -- this is the v2 packed+mapped path.
  {
    std::string path = std::string(std::tmpnam(nullptr)) + ".ftx2";
    std::string err;
    check(idx.save(path, &err), "save: " + err);
    TaxIndex idx2;
    check(idx2.load(path, &err), "load: " + err);
    check(idx2.k() == idx.k(), "k survives round-trip");

    std::vector<uint32_t> a, b;
    idx.lookup("AAAAAAAA", a); idx2.lookup("AAAAAAAA", b);
    check(a == b, "shared set survives round-trip");
    idx.lookup("MNPQRSTV", a); idx2.lookup("MNPQRSTV", b);
    check(a == b, "singleton set survives round-trip");
    idx2.lookup("WWWWWWWW", b);
    check(b.empty(), "absent k-mer still absent after round-trip");
    check(idx2.postings(10) == idx.postings(10), "postings survive round-trip");
    check(idx2.postings(20) == idx.postings(20), "postings(20) survives round-trip");
    check(idx2.nKmers() == idx.nKmers(), "kmer count survives round-trip");
    check(idx2.taxa() == idx.taxa(), "taxa survive round-trip");

    // Re-saving a MAPPED index must reproduce it exactly (the mapped save path).
    std::string path2 = std::string(std::tmpnam(nullptr)) + ".ftx2";
    check(idx2.save(path2, &err), "re-save mapped: " + err);
    TaxIndex idx3;
    check(idx3.load(path2, &err), "re-load: " + err);
    idx3.lookup("AAAAAAAA", b);
    idx.lookup("AAAAAAAA", a);
    check(a == b, "mapped re-save round-trips");
    check(idx3.nKmers() == idx.nKmers(), "mapped re-save keeps kmer count");
    std::remove(path.c_str());
    std::remove(path2.c_str());
  }

  // Corruption rejection: a v2 file must fail to LOAD, not crash, when
  // truncated or given a hostile header that could read past the mapping.
  // Realistic because the ~1 GB index is a downloaded asset, so a partial
  // download is ordinary corruption.
  {
    std::string good = std::string(std::tmpnam(nullptr)) + ".ftx2";
    std::string err;
    check(idx.save(good, &err), "save for corruption test: " + err);

    // Read the good file's bytes.
    std::ifstream gi(good, std::ios::binary);
    std::string bytes((std::istreambuf_iterator<char>(gi)), std::istreambuf_iterator<char>());
    gi.close();

    auto writeAndTryLoad = [&](const std::string& data, const char* what) {
      std::string p = std::string(std::tmpnam(nullptr)) + ".ftx2";
      { std::ofstream o(p, std::ios::binary); o.write(data.data(), static_cast<std::streamsize>(data.size())); }
      TaxIndex bad;
      std::string e;
      check(!bad.load(p, &e), std::string("rejects ") + what);
      std::vector<uint32_t> out;
      bad.lookup("AAAAAAAA", out);  // must be safe on a failed load, not a crash
      check(out.empty(), std::string("no lookup after rejected ") + what);
      std::remove(p.c_str());
    };

    if (bytes.size() > 100) writeAndTryLoad(bytes.substr(0, bytes.size() / 2), "a truncated file");
    writeAndTryLoad(bytes.substr(0, 40), "a header-only file");
    writeAndTryLoad("FTX2\x02\x00\x00\x00", "a 8-byte stub");
    writeAndTryLoad("not an index at all", "a non-index file");
    // Hostile header: huge n_kmers must be rejected by the bounds check, not wrap.
    std::string hostile = bytes.substr(0, 40);
    for (int i = 16; i < 24; ++i) hostile[i] = static_cast<char>(0xFF);  // n_kmers = UINT64_MAX
    writeAndTryLoad(hostile, "a hostile huge-count header");

    std::remove(good.c_str());
  }


  // SpeciesLookup::tagSupport (1.12 P6) equals the 1.11 inline loop of
  // FASTag.cpp phase 10: return, taxa and both counters.
  {
    // k = 4 toy index over four taxa with designed overlaps.
    std::vector<FASTAFile::FASTAEntry> se;
    se.emplace_back("t1", "", "ACDEFGHKLMNPQ");   // taxon 1
    se.emplace_back("t2", "", "ACDEFGHKWYWYR");   // taxon 2 shares ACDEFGHK with 1
    se.emplace_back("t3", "", "ACDEMNPQRSTVW");   // taxon 3 shares ACDE and MNPQ
    se.emplace_back("t4", "", "ACDEYYYYKLMN");    // taxon 4 shares ACDE, KLMN
    std::vector<uint32_t> st = {1, 2, 3, 4};
    TaxIndex sidx;
    sidx.build(se, st, /*k=*/4);
    const int k = 4;
    OldResult r;

    // Unexplained k-mer: WWWW is in no taxon -> the tag is dropped.
    check(sameAsOld(sidx, "ACDEWWWW", k, 4, 0.0, &r) && !r.ok, "tagSupport: unexplained k-mer kills the tag");
    // Intersection rule: CDEFGHK is in taxa 1 and 2 only (all k-mers).
    check(sameAsOld(sidx, "CDEFGHK", k, 4, 0.0, &r) && r.ok && r.taxa == std::vector<uint32_t>({1, 2}),
          "tagSupport: intersection of taxa carrying every k-mer");
    // Intersection empty: every k-mer of HKLMNPQR is known, but taxon 1 lacks NPQR -> best < n_eval.
    check(sameAsOld(sidx, "HKLMNPQR", k, 4, 0.0, &r) && !r.ok && r.generic == 0, "tagSupport: no taxon carries every k-mer");
    // Share-cap skip: ACDE is in all 4 taxa; at cap 3 it is skipped and the
    // rest decides (counter incremented).
    check(sameAsOld(sidx, "ACDEFGH", k, 3, 0.0, &r) && r.ok && r.skipped == 1 && r.taxa == std::vector<uint32_t>({1, 2}),
          "tagSupport: share-cap skip counts and does not delete");
    // Every k-mer skipped -> n_eval == 0 -> dropped, skips still counted.
    check(sameAsOld(sidx, "ACDE", k, 3, 0.0, &r) && !r.ok && r.skipped == 1, "tagSupport: all k-mers skipped");
    // Skips before a later unexplained k-mer are still counted (old behaviour).
    check(sameAsOld(sidx, "ACDEWWWW", k, 3, 0.0, &r) && !r.ok && r.skipped == 1, "tagSupport: skip then unexplained");
    // Margin failure: ACDEFG -> ACDE{1,2,3,4} CDEF{1,2} DEFG{1,2}: best 3,
    // runner 1, margin 2/3 < 0.7 -> generic.
    check(sameAsOld(sidx, "ACDEFG", k, 4, 0.7, &r) && !r.ok && r.generic == 1, "tagSupport: margin failure");
    check(sameAsOld(sidx, "ACDEFG", k, 4, 0.6, &r) && r.ok && r.generic == 0, "tagSupport: margin pass");
    // Margin 1.0 with an all-shared tag: runner 0, margin 1 -> passes for all four.
    check(sameAsOld(sidx, "ACDE", k, 4, 1.0, &r) && r.ok && r.taxa.size() == 4, "tagSupport: one k-mer, every taxon");
    // I/L folding per k-mer and too-short tags.
    check(sameAsOld(sidx, "GHKIMNPQ", k, 4, 0.0, &r) && r.ok && r.taxa == std::vector<uint32_t>({1}), "tagSupport: I folds to L");
    check(sameAsOld(sidx, "ACD", k, 4, 0.0, &r) && !r.ok, "tagSupport: shorter than k");

    // Randomised: substrings of the toy proteins, with occasional mutations,
    // under every share cap and several margins.
    std::mt19937 rng(12345);
    const std::string alpha = "ACDEFGHIKLMNPQRSTVWY";
    int mismatches = 0, n_ok = 0;
    for (int trial = 0; trial < 20000; ++trial)
    {
      const std::string& src = se[rng() % se.size()].sequence;
      const size_t len = 3 + rng() % 9;
      const size_t start = rng() % src.size();
      std::string seq = src.substr(start, len);
      if (rng() % 4 == 0 && !seq.empty())
      {
        const char c = alpha[rng() % alpha.size()];  // one draw per statement, in the C++17 order of `=`
        seq[rng() % seq.size()] = c;
      }
      const size_t cap = rng() % 6;
      const double margins[] = {0.0, 0.2, 0.34, 0.5, 0.67, 1.0};
      const double m = margins[rng() % 6];
      OldResult nr;
      if (!sameAsOld(sidx, seq, k, cap, m, &nr)) ++mismatches;
      if (nr.ok) ++n_ok;
    }
    check(mismatches == 0, "tagSupport equals the old loop on 20000 random tags");
    check(n_ok > 1000, "random tags exercise the informative path");
  }

  // 1.12 #10: orientedTagSupport. Forward is tagSupport exactly; Both looks
  // the tag up reversed too (I/L folded) and combines the two readings.
  {
    std::vector<FASTAFile::FASTAEntry> se;
    se.emplace_back("t1", "", "ACDEFGHKLMNPQ");   // taxon 1
    se.emplace_back("t2", "", "WVTSRQPNGG");      // taxon 2: NPQRSTVW only reversed
    se.emplace_back("t3", "", "GGYWLRSEYY");      // taxon 3: ESRIWY reversed = YWIRSE -> YWLRSE
    se.emplace_back("t4", "", "QPNMLKHGFF");      // taxon 4: reverse of a taxon-1 stretch
    std::vector<uint32_t> st = {1, 2, 3, 4};
    TaxIndex oidx;
    oidx.build(se, st, /*k=*/4);
    const int k = 4;
    using V = std::vector<uint32_t>;
    auto run = [&](const std::string& seq, SpeciesOrientation o, V& taxa, OrientationCounts* oc) {
      TagLookupCounters c, rc;
      return orientedTagSupport(oidx, seq, k, 4, 0.0, o, taxa, c, rc, oc);
    };
    V taxa;
    OrientationCounts oc;
    // A reversed-only k-mer path: found under both, not under forward.
    check(!run("NPQRSTVW", SpeciesOrientation::Forward, taxa, nullptr) && taxa.empty(),
          "orientation: reversed-only tag not found under forward");
    check(run("NPQRSTVW", SpeciesOrientation::Both, taxa, &oc) && taxa == V({2}) && oc.reverse == 1,
          "orientation: reversed-only tag found under both");
    // I/L folding after reversal.
    oc = {};
    check(run("ESRIWY", SpeciesOrientation::Both, taxa, &oc) && taxa == V({3}) && oc.reverse == 1,
          "orientation: I/L folded after reversal");
    check(!run("ESRIWY", SpeciesOrientation::Forward, taxa, nullptr), "orientation: ESRIWY not found as written");
    check(reversedFolded("ESRIWY") == "YWLRSE", "reversedFolded reverses and folds");
    // Both readings informative and disjoint: HKLMNP is taxon 1 as written,
    // PNMLKH taxon 4 reversed -> ambiguous, skipped.
    oc = {};
    check(!run("HKLMNP", SpeciesOrientation::Both, taxa, &oc) && taxa.empty() && oc.ambiguous == 1,
          "orientation: disjoint readings are ambiguous and skipped");
    check(run("HKLMNP", SpeciesOrientation::Forward, taxa, nullptr) && taxa == V({1}),
          "orientation: the ambiguous tag counted under forward (counts can fall)");
    // Shorter than k, also after reversal; non-alphabet residues.
    check(!run("NPQ", SpeciesOrientation::Both, taxa, nullptr), "orientation: shorter than k after reversal");
    check(!run("NPQXSTVW", SpeciesOrientation::Both, taxa, nullptr), "orientation: non-alphabet residue");
    check(!run("NP1RSTVW", SpeciesOrientation::Both, taxa, nullptr), "orientation: non-letter residue");
    // Forward counters are those of a forward run; the reverse lookups have
    // their own.
    {
      TagLookupCounters c1, r1, c2, r2;
      V t1, t2;
      orientedTagSupport(oidx, "ACDEFGHK", k, 1, 0.0, SpeciesOrientation::Forward, t1, c1, r1, nullptr);
      orientedTagSupport(oidx, "ACDEFGHK", k, 1, 0.0, SpeciesOrientation::Both, t2, c2, r2, nullptr);
      check(c1.kmer_skipped == c2.kmer_skipped && c1.tag_generic == c2.tag_generic && r1.kmer_skipped == 0,
            "orientation: forward counters unchanged under both");
    }
    // The reversed reading's skipped k-mers go to the reverse counters only:
    // CDEFG is taxon 1 as written; GFEDC is in taxa 2 and 3, so at share cap
    // 1 both of its k-mers are skipped (and that reading is not informative).
    {
      std::vector<FASTAFile::FASTAEntry> ce;
      ce.emplace_back("c1", "", "CDEFG");
      ce.emplace_back("c2", "", "GFEDC");
      ce.emplace_back("c3", "", "GFEDC");
      std::vector<uint32_t> ct = {1, 2, 3};
      TaxIndex cidx;
      cidx.build(ce, ct, /*k=*/4);
      TagLookupCounters c, rc;
      OrientationCounts co;
      V t;
      check(orientedTagSupport(cidx, "CDEFG", 4, 1, 0.0, SpeciesOrientation::Both, t, c, rc, &co)
                && t == V({1}) && co.forward == 1,
            "orientation: a reversed reading with only skipped k-mers is not informative");
      check(c.kmer_skipped == 0 && rc.kmer_skipped == 2,
            "orientation: skipped k-mers of the reversed reading counted in the reverse counters only");
    }

    // Randomised against tagSupport: Forward equals it; Both equals the
    // combination of the two readings looked up separately.
    std::mt19937 rng(4711);
    const std::string alpha = "ACDEFGHIKLMNPQRSTVWY";
    int bad_fwd = 0, bad_both = 0, n_rev = 0;
    for (int trial = 0; trial < 20000; ++trial)
    {
      const std::string& src = se[rng() % se.size()].sequence;
      const size_t len = 3 + rng() % 7;
      std::string seq = src.substr(rng() % src.size(), len);
      if (rng() % 2) std::reverse(seq.begin(), seq.end());
      if (rng() % 5 == 0 && !seq.empty())
      {
        const char c = alpha[rng() % alpha.size()];  // one draw per statement, in the C++17 order of `=`
        seq[rng() % seq.size()] = c;
      }
      const size_t cap = 1 + rng() % 4;
      TagLookupCounters c0, c1, r1, c2, r2, cr;
      V ref, f, b, rev;
      const bool ok0 = tagSupport(oidx, seq, k, cap, 0.0, ref, c0);
      const bool ok1 = orientedTagSupport(oidx, seq, k, cap, 0.0, SpeciesOrientation::Forward, f, c1, r1, nullptr);
      if (ok0 != ok1 || ref != f || c0.kmer_skipped != c1.kmer_skipped) ++bad_fwd;
      tagSupport(oidx, std::string(seq.rbegin(), seq.rend()), k, cap, 0.0, rev, cr);
      V want;
      combineOrientations(ref, rev, want);
      OrientationCounts o2;
      const bool ok2 = orientedTagSupport(oidx, seq, k, cap, 0.0, SpeciesOrientation::Both, b, c2, r2, &o2);
      if (ok2 != !want.empty() || b != want || c2.kmer_skipped != c0.kmer_skipped) ++bad_both;
      if (o2.reverse) ++n_rev;
    }
    check(bad_fwd == 0, "orientation: forward equals tagSupport on 20000 random tags");
    check(bad_both == 0, "orientation: both equals the combined readings on 20000 random tags");
    check(n_rev > 500, "random tags exercise the reverse-only path");
  }

  if (failures == 0) std::cout << "taxindex_test: all checks passed\n";
  return failures == 0 ? 0 : 1;
}
