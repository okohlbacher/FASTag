// species_call_test.cpp -- the -species_call decoy null (1.12 #1): decoy tags,
// per-trial normalisation, the homology term, Poisson p and detection limit,
// every outcome of callGenera, q-values, the parameter file, and an all-decoy
// run that must call nothing present.
// Returns 0 when every check passes.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "SpeciesCall.h"
#include "SpeciesEvidence.h"
#include "SpeciesLookup.h"
#include "TaxDeconv.h"
#include "TaxIndex.h"
#include "TaxStats.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <set>
#include <string>
#include <vector>

using namespace FASTag;
namespace SC = FASTag::SpeciesCall;

namespace
{
  int failures = 0;
  void check(bool ok, const std::string& what)
  {
    if (!ok) { std::cerr << "FAIL: " << what << "\n"; ++failures; }
  }
  bool near(double a, double b, double rel = 1e-9)
  {
    return std::fabs(a - b) <= rel * std::max({1.0, std::fabs(a), std::fabs(b)});
  }

  // Independent Poisson upper tail: 1 - sum_{k<o} e^-l l^k / k!.
  double tailRef(uint64_t o, double l)
  {
    double term = std::exp(-l), cdf = 0.0;
    for (uint64_t k = 0; k < o; ++k) { cdf += term; term *= l / static_cast<double>(k + 1); }
    return std::max(0.0, 1.0 - cdf);
  }

  // Textbook Benjamini-Hochberg, independent of OpenMS.
  std::vector<double> bhRef(const std::vector<double>& p)
  {
    const size_t m = p.size();
    std::vector<size_t> ord(m);
    for (size_t i = 0; i < m; ++i) ord[i] = i;
    std::stable_sort(ord.begin(), ord.end(), [&](size_t a, size_t b) { return p[a] < p[b]; });
    std::vector<double> q(m);
    double run = 1.0;
    for (size_t r = m; r-- > 0;)
    {
      run = std::min(run, p[ord[r]] * static_cast<double>(m) / static_cast<double>(r + 1));
      q[ord[r]] = std::min(1.0, run);
    }
    return q;
  }

  std::string sorted(std::string s) { std::sort(s.begin(), s.end()); return s; }
  std::string reversed(std::string s) { std::reverse(s.begin(), s.end()); return s; }

  const SC::GenusStat* find(const std::vector<SC::GenusStat>& v, uint32_t tx)
  {
    for (const auto& s : v) if (s.taxid == tx) return &s;
    return nullptr;
  }

  // Deterministic generator for the simulated runs (splitmix64).
  struct Rng
  {
    uint64_t s;
    uint64_t next() { uint64_t z = (s += 0x9e3779b97f4a7c15ULL); z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
                      z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL; return z ^ (z >> 31); }
    double unif() { return static_cast<double>(next() >> 11) * (1.0 / 9007199254740992.0); }
    uint64_t poisson(double l)
    {
      // Knuth for small lambda; the simulated rates stay below 200.
      uint64_t k = 0; double p = 1.0; const double L = std::exp(-l);
      do { ++k; p *= unif(); } while (p > L);
      return k - 1;
    }
  };

  void writeFile(const std::string& path, const std::string& text)
  {
    std::ofstream o(path.c_str(), std::ios::binary);
    o << text;
  }
}

int main()
{
  // ---- 1. decoyTag --------------------------------------------------------
  {
    const std::string tags[] = {"PEPTIDEK", "LSIGNEAVK", "ACDEFGHK", "ACDCA", "NNQQNNQ"};
    for (const std::string& t : tags)
    {
      const std::string f = TaxIndex::fold(t);
      std::set<std::string> distinct;
      for (uint32_t j = 0; j < 5; ++j)
      {
        const std::string d = decoyTag(t, j);
        check(!d.empty(), "decoyTag: a decoy exists for " + t);
        check(d == decoyTag(t, j), "decoyTag: deterministic for " + t);
        check(sorted(d) == sorted(f), "decoyTag: keeps the I/L-folded composition of " + t);
        check(d.size() == t.size(), "decoyTag: keeps the length of " + t);
        check(d != f, "decoyTag: differs from the forward tag " + t);
        check(d != reversed(f), "decoyTag: differs from the reversed tag " + t);
        check(d.find('I') == std::string::npos, "decoyTag: I is folded to L in " + t);
        distinct.insert(d);
      }
      check(distinct.size() >= 2, "decoyTag: replicates j differ for " + t);
    }
    // The I/L-folded tag and its unfolded form have the same decoys.
    check(decoyTag("PEPTIDEK", 3) == decoyTag("PEPTLDEK", 3), "decoyTag: depends on the folded tag only");
    // Homopolymers and two-residue tags have no permutation that differs from
    // both orientations: no decoy.
    check(decoyTag("LLLLLLL", 0).empty(), "decoyTag: homopolymer has no decoy");
    check(decoyTag("IIILLLI", 2).empty(), "decoyTag: I/L homopolymer has no decoy");
    check(decoyTag("KR", 0).empty(), "decoyTag: two residues have no decoy");
    check(decoyTag("", 0).empty(), "decoyTag: empty tag");
  }

  // ---- 2. a decoy goes through the same per-tag rule ------------------------
  {
    std::vector<OpenMS::FASTAFile::FASTAEntry> se;
    se.emplace_back("t1", "", "ACDEFGHKLMNPQ");
    se.emplace_back("t2", "", "QPNMLKHGFEDCA");  // taxon 2: taxon 1 reversed
    std::vector<uint32_t> st = {1, 2};
    TaxIndex idx;
    idx.build(se, st, 4);
    TagLookupCounters c;
    std::vector<uint32_t> taxa;
    check(tagSupport(idx, "CDEFGHK", 4, 2, 0.0, taxa, c) && taxa == std::vector<uint32_t>({1}),
          "decoy setup: the target tag maps to taxon 1");
    // A decoy of the forward tag is never the reversed tag, so it cannot pick
    // up taxon 2 merely by orientation.
    for (uint32_t j = 0; j < 5; ++j)
    {
      const std::string d = decoyTag("CDEFGHK", j);
      check(d != reversed(TaxIndex::fold("CDEFGHK")), "decoy is not the reversed tag");
      TagLookupCounters dc;
      std::vector<uint32_t> dt;
      const bool ok = tagSupport(idx, d, 4, 2, 0.0, dt, dc);
      check(!ok || std::find(dt.begin(), dt.end(), 2u) == dt.end() || std::find(dt.begin(), dt.end(), 1u) != dt.end(),
            "decoy lookup follows the same rule");
    }
  }

  // ---- 2b. k-mer-keyed decoy (1.13 species redesign) -----------------------
  {
    const std::string A = "ACDEFGHKLMNPQRSTVWY";
    // Chance hit rates on an i.i.d. uniform proteome, k = 3, for L = k..k+4:
    // a uniform random tag (exact chance rate), a whole-tag shuffle, the
    // independent per-k-mer construction, and kmerDecoySupport.
    const int k = 3;
    Rng r{12345};
    std::string prot;
    for (int i = 0; i < 300; ++i) prot += A[r.next() % A.size()];
    std::vector<OpenMS::FASTAFile::FASTAEntry> pe;
    pe.emplace_back("p", "", prot);
    TaxIndex pidx;
    pidx.build(pe, std::vector<uint32_t>{1}, k);
    const int M = 1000000;
    const auto close = [](uint64_t a, uint64_t b, double z) {
      return std::fabs(static_cast<double>(a) - static_cast<double>(b)) <=
             z * (std::sqrt(static_cast<double>(a + b)) + 1.0);
    };
    for (int L = k; L <= k + 4; ++L)
    {
      uint64_t shuf = 0, kd = 0, kd_none = 0, indep = 0, tgt = 0;
      for (int t = 0; t < M; ++t)
      {
        std::string s;
        for (int i = 0; i < L; ++i) s += A[r.next() % A.size()];
        TagLookupCounters c;
        std::vector<uint32_t> tx;
        if (tagSupport(pidx, s, k, 1000, 0.0, tx, c)) ++tgt;
        // A fresh shuffle seed per tag: one fixed seed is a fixed map of tags
        // to decoys whose hit rate scatters by a few percent.
        const std::string sh = decoyTag(s, static_cast<uint32_t>(t));
        if (!sh.empty() && tagSupport(pidx, sh, k, 1000, 0.0, tx, c)) ++shuf;
        bool nd = false;
        if (kmerDecoySupport(pidx, s, k, static_cast<uint32_t>(t), 1000, 0.0, tx, c, &nd)) ++kd;
        if (nd) ++kd_none;
        bool all = true;  // the rejected construction: every k-mer replaced independently
        for (int i = 0; i + k <= L && all; ++i)
        {
          std::string km;
          for (int q = 0; q < k; ++q) km += A[r.next() % A.size()];
          pidx.lookup(km, tx);
          all = !tx.empty();
        }
        if (all) ++indep;
      }
      const std::string got = " (kmer decoy " + std::to_string(kd) + ", no decoy " + std::to_string(kd_none) +
                              ", shuffle " + std::to_string(shuf) + ", random tag " + std::to_string(tgt) +
                              ", independent " + std::to_string(indep) + ")";
      std::cout << "decoy rate L=" << L << got << "\n";
      // decoyTag() never returns the tag or its reverse, which reweights repeat
      // patterns slightly (about +3 % here), hence 6 sigma against the exact rate.
      check(close(shuf, tgt, 6.0), "whole-tag shuffle is the chance rate at L=" + std::to_string(L) + got);
      if (L == k)
      {
        check(kd_none < static_cast<uint64_t>(M / 100), "L == k: almost every tag has a decoy" + got);
        check(close(kd, shuf, 6.0), "L == k: k-mer decoy hit rate is the shuffle rate" + got);
      }
      else
      {
        check(kd == 0 && kd_none == static_cast<uint64_t>(M), "L > k: no decoy (refused, not a silent miss)" + got);
      }
      if (L == k + 1 || L == k + 2)
        check(static_cast<double>(tgt) - static_cast<double>(indep) > 4.0 * (std::sqrt(static_cast<double>(tgt + indep)) + 1.0),
              "independent per-k-mer decoys under-hit at L=" + std::to_string(L) + got);
    }
    // k-mer keyed: the same k-mer has the same decoy in every spectrum.
    {
      TagLookupCounters c1, c2;
      std::vector<uint32_t> t1, t2;
      bool n1 = false, n2 = false;
      const std::string km = prot.substr(10, 3);
      kmerDecoySupport(pidx, km, k, 5, 1000, 0.0, t1, c1, &n1);
      kmerDecoySupport(pidx, km, k, 5, 1000, 0.0, t2, c2, &n2);
      check(n1 == n2 && t1 == t2, "k-mer decoy is deterministic");
    }
  }

  // ---- 3. Poisson tail and the random part --------------------------------
  {
    check(SC::poissonUpperTail(0, 3.0) == 1.0, "P(X>=0) = 1");
    check(near(SC::poissonUpperTail(1, 2.0), 1.0 - std::exp(-2.0)), "P(X>=1 | 2)");
    check(near(SC::poissonUpperTail(3, 1.0), 1.0 - std::exp(-1.0) * 2.5), "P(X>=3 | 1)");
    for (uint64_t o : {1u, 4u, 9u, 15u, 30u})
      for (double l : {0.1, 1.0, 4.5, 12.0})
        check(near(SC::poissonUpperTail(o, l), tailRef(o, l), 1e-7) || tailRef(o, l) < 1e-12,
              "Poisson tail equals the direct sum");
    const double tiny = SC::poissonUpperTail(40, 0.1);
    check(tiny > 0.0 && tiny < 1e-60 && std::isfinite(std::log(tiny)), "deep tail is positive, not 0");
    check(SC::poissonUpperTail(5, 0.0) == 0.0, "lambda 0 cannot produce a count");

    // r_g = (d + 0.5) / (D * N_trials); the random part is r_g * N_trials.
    check(near(SC::randomExpected(50, 5, 1000), 50.5 / 5000.0 * 1000.0), "random part = r * N_trials");
    check(near(SC::randomExpected(0, 5, 1000), 0.1), "random part with no decoy hit = 0.5 / D");
    check(near(SC::randomExpected(7, 2, 12345), 7.5 / 2.0), "random part independent of N_trials scale");
  }

  // ---- 4. normalisation per trial, not per decoy hit -----------------------
  {
    SC::Params pr; pr.alpha = 0.01; pr.tau = 0.0; pr.n_min = 5;
    SC::RunInput run; run.n_units = 900; run.n_trials = 1000; run.decoys = 5; run.min_units = 50;
    std::vector<SC::GenusInput> g = {{100, 30, 50, 30.0 / 900, 30}, {200, 8, 2, 8.0 / 900, 8}};
    const auto a = SC::callGenera(g, {}, run, pr);
    check(near(find(a, 100)->expected, 50.5 / (5.0 * 1000.0) * 1000.0), "lambda = r * N_trials");
    // More decoy hits elsewhere (more decoy units) must not change lambda of g.
    g[1].decoy_spectra = 400;
    const auto b = SC::callGenera(g, {}, run, pr);
    check(near(find(b, 100)->expected, find(a, 100)->expected),
          "lambda of a genus does not depend on how many decoys hit other genera");
    check(find(a, 100)->decoy_spectra == 50, "decoy spectra reported");
  }

  // ---- 5. homology term: 3-genus toy ---------------------------------------
  {
    // Genus 1 strong (N = 1000), genera 2 and 3 sisters with C[g][1] = 0.02,
    // genus 4 unrelated. A sister at C*N (20) is not present; one at 3x is.
    const std::vector<double> C = {
        1.0,  0.10, 0.10, 0.0,
        0.02, 1.0,  0.0,  0.0,
        0.02, 0.0,  1.0,  0.0,
        0.0,  0.0,  0.0,  1.0};
    std::vector<SC::GenusInput> g = {
        {1, 1000, 0, 1000.0 / 1100, 1000.0}, {2, 20, 0, 20.0 / 1100, 0.0},
        {3, 60, 0, 60.0 / 1100, 40.0},       {4, 0, 0, 0.0, 0.0}};
    SC::Params pr; pr.alpha = 0.01; pr.tau = 0.0; pr.n_min = 5;
    SC::RunInput run; run.n_units = 1100; run.n_trials = 1200; run.decoys = 5; run.min_units = 200;
    const auto s = SC::callGenera(g, C, run, pr);
    check(find(s, 1)->call == SC::Call::Present, "homology: the strong genus is present");
    check(near(find(s, 2)->spill, 0.02 * 1000.0), "homology: spill = C[g][h] * N_h");
    check(find(s, 2)->call == SC::Call::NoCall && find(s, 2)->reason == "near_neighbour",
          "homology: a sister at C*N is a near_neighbour no_call");
    check(find(s, 2)->qvalue_random <= pr.alpha, "homology: the sister is significant on the random part alone");
    check(find(s, 3)->call == SC::Call::Present, "homology: a sister at 3x C*N is present");
    check(find(s, 4)->call == SC::Call::NotDetected && !find(s, 4)->tested, "homology: unrelated genus not_detected");
    // Without the homology term the sister at C*N would have been called.
    const auto s0 = SC::callGenera(g, {}, run, pr);
    check(find(s0, 2)->call == SC::Call::Present, "without C the sister is called present (what the spill prevents)");
    // Spill flows only from genera called present that rank above.
    std::vector<SC::GenusInput> g2 = g;
    g2[0].observed = 3;  // genus 1 no longer present (below the floor)
    const auto s2 = SC::callGenera(g2, C, run, pr);
    check(find(s2, 2)->spill == 0.0, "no spill from a genus that is not present");
    // Output order is the input order.
    check(s.size() == 4 && s[0].taxid == 1 && s[3].taxid == 4, "output in input order");
  }

  // ---- 6. every outcome, and the detection limit ----------------------------
  {
    SC::Params pr; pr.alpha = 0.01; pr.tau = 0.01; pr.n_min = 10;
    SC::RunInput run; run.n_units = 1000; run.n_trials = 1000; run.decoys = 1; run.min_units = 200;
    // taxid 1: present; 2: not significant (o = lambda); 3: significant but
    // share below tau; 4: significant, share ok, o below n_min; 5: untested.
    std::vector<SC::GenusInput> g = {
        {1, 300, 0, 0.30, 300}, {2, 5, 4, 0.005, 5}, {3, 9, 0, 0.009, 9},
        {4, 8, 0, 0.02, 8},     {5, 2, 0, 0.002, 2}};
    const auto s = SC::callGenera(g, {}, run, pr);
    check(find(s, 1)->call == SC::Call::Present && find(s, 1)->reason == "pass", "outcome: present");
    check(find(s, 1)->lod < 0, "present has no LOD");
    check(find(s, 2)->call == SC::Call::NotDetected && find(s, 2)->reason == "not_significant", "outcome: not_significant");
    check(find(s, 3)->call == SC::Call::NotDetected && find(s, 3)->reason == "low_share", "outcome: low_share");
    check(find(s, 4)->call == SC::Call::NotDetected && find(s, 4)->reason == "few_genus_spectra", "outcome: few_genus_spectra");
    check(find(s, 5)->call == SC::Call::NotDetected && !find(s, 5)->tested, "outcome: untested genus not_detected");
    for (uint32_t tx : {2u, 3u, 4u, 5u})
      check(std::isfinite(find(s, tx)->lod) && find(s, tx)->lod > 0 && find(s, tx)->lod <= 1.0,
            "not_detected carries a finite LOD");

    // LOD by hand for genus 2: lambda = 4.5 (d = 4, D = 1); m = 4 tested
    // genera, R = 3 others significant -> threshold alpha * 4 / 4; smallest o
    // with P(X >= o) <= t, then at least n_min, the floor and tau * n_units.
    const SC::GenusStat& t2 = *find(s, 2);
    check(near(t2.expected, 4.5), "lambda of genus 2");
    int R = 0, m = 0;
    for (const auto& x : s) if (x.tested) { ++m; if (x.taxid != 2 && x.qvalue <= pr.alpha) ++R; }
    const double thr = pr.alpha * (R + 1) / m;
    uint64_t o = 0;
    while (tailRef(o, 4.5) > thr) ++o;
    o = std::max<uint64_t>({o, pr.n_min, Taxonomy::kObservedFloor,
                            static_cast<uint64_t>(std::ceil(pr.tau * run.n_units))});
    check(near(t2.lod, static_cast<double>(o) / 1000.0), "LOD by hand");
    // Monotone: a larger lambda never lowers the LOD.
    std::vector<SC::GenusInput> g3 = g;
    g3[1].decoy_spectra = 40;
    check(find(SC::callGenera(g3, {}, run, pr), 2)->lod >= t2.lod, "LOD grows with lambda");

    // Run-level no_calls override everything.
    SC::RunInput few = run; few.n_units = 150;
    for (const auto& x : SC::callGenera(g, {}, few, pr))
      check(x.call == SC::Call::NoCall && x.reason == "few_spectra" && x.lod < 0, "outcome: few_spectra");
    SC::RunInput da = run; da.low_resolution = true;
    for (const auto& x : SC::callGenera(g, {}, da, pr))
      check(x.call == SC::Call::NoCall && x.reason == "low_resolution", "outcome: low_resolution");
    // low_resolution wins over few_spectra.
    SC::RunInput both = few; both.low_resolution = true;
    check(SC::callGenera(g, {}, both, pr)[0].reason == "low_resolution", "low_resolution checked first");
    check(std::string(SC::callName(SC::Call::Present)) == "present"
              && std::string(SC::callName(SC::Call::NoCall)) == "no_call"
              && std::string(SC::callName(SC::Call::NotDetected)) == "not_detected",
          "call names");
  }

  // ---- 7. q-values -----------------------------------------------------------
  {
    const std::vector<double> p = {0.04, 0.001, 0.03, 0.5, 0.0002, 0.9, 0.02, 0.011};
    const auto q = SC::qValues(p, 1.0);
    const auto ref = bhRef(p);
    bool eq = q.size() == ref.size();
    for (size_t i = 0; eq && i < q.size(); ++i) eq = near(q[i], ref[i], 1e-12);
    check(eq, "pi0 = 1 equals Benjamini-Hochberg");
    std::vector<size_t> ord(p.size());
    for (size_t i = 0; i < ord.size(); ++i) ord[i] = i;
    std::sort(ord.begin(), ord.end(), [&](size_t a, size_t b) { return p[a] < p[b]; });
    bool mono = true;
    for (size_t i = 1; i < ord.size(); ++i) mono = mono && q[ord[i]] >= q[ord[i - 1]];
    check(mono, "q-values monotone in p");
    const auto qh = SC::qValues(p, 0.5);
    for (size_t i = 0; i < p.size(); ++i) check(qh[i] <= q[i] + 1e-15, "pi0 < 1 lowers q");
    check(SC::qValues({}, 1.0).empty(), "q of nothing");
    const double pi0 = SC::estimatePi0(p);
    check(pi0 > 0.0 && pi0 <= 1.0, "estimated pi0 in (0, 1]");
    check(SC::estimatePi0({0.3}) == 1.0, "pi0 of one value is 1");
  }

  // ---- 8. group-level overlap from distinct k-mers -----------------------------
  {
    // Distinct 4-mers per taxon, by brute force, against TaxIndex::groupOverlap.
    // Group h = taxa 1 and 2 with the SAME protein P (20 k-mers); group g =
    // taxa 3 and 4 with the same protein Q that shares 10 of P's k-mers; taxon
    // 5 (group -1) shares P too and must not count. Summing pairwise overlaps
    // over members would give C[g][h] = 0.5 * 4 / 2 = 1.0 here (and above 1
    // with a third member); the true P(k-mer in g | k-mer in h) is 0.5.
    const std::string P = "ACDEFGHKLMNPQRSTVWYACD";   // 22 residues -> 19 4-mers
    const std::string Q = P.substr(0, 13) + "YWVTSRQPNMLKH";  // first 10 4-mers of P, then its own
    std::vector<OpenMS::FASTAFile::FASTAEntry> e;
    e.emplace_back("p1", "", P); e.emplace_back("p2", "", P);
    e.emplace_back("q3", "", Q); e.emplace_back("q4", "", Q);
    e.emplace_back("x5", "", P);
    TaxIndex idx;
    idx.build(e, {1, 2, 3, 4, 5}, 4);
    const auto kmers = [](const std::string& x) {
      std::set<std::string> k;
      for (size_t i = 0; i + 4 <= x.size(); ++i) k.insert(x.substr(i, 4));
      return k;
    };
    const auto kp = kmers(P), kq = kmers(Q);
    size_t inter = 0;
    for (const auto& k : kq) inter += kp.count(k);
    const std::vector<uint32_t> tx = idx.taxa();
    check(tx == std::vector<uint32_t>({1, 2, 3, 4, 5}), "groupOverlap: index taxa");
    // h = group 0 (taxa 1, 2), g = group 1 (taxa 3, 4).
    const std::vector<int> group_of = {0, 0, 1, 1, -1};
    const auto ov = idx.groupOverlap(group_of, 2);
    check(ov.size() == 4, "groupOverlap: 2 x 2");
    check(ov[0] == kp.size() && ov[3] == kq.size(), "groupOverlap: diagonal = distinct k-mers of the group");
    check(ov[1] == inter && ov[2] == inter, "groupOverlap: off-diagonal = distinct shared k-mers");
    const auto C = conditionalMatrix(ov, 2);
    check(near(C[1 * 2 + 0], static_cast<double>(inter) / kp.size()),
          "groupOverlap: C[g][h] = P(k-mer in g | k-mer in h) with 2 members each");
    for (double c : C) check(c >= 0.0 && c <= 1.0, "groupOverlap: conditional entries in [0, 1]");
    // One member per group reproduces pairwiseOverlap exactly.
    const auto pw = idx.pairwiseOverlap();
    const auto id = idx.groupOverlap({0, 1, 2, 3, 4}, 5);
    check(id == pw, "groupOverlap with singleton groups = pairwiseOverlap");
    // The summed roll-up this replaces gets C wrong when the groups differ in
    // size: g = taxon 3 alone against h = taxa 1 and 2 gives half the truth.
    const auto ov1 = idx.groupOverlap({0, 0, 1, -1, -1}, 2);
    const auto C1 = conditionalMatrix(ov1, 2);
    check(near(C1[1 * 2 + 0], static_cast<double>(inter) / kp.size()),
          "groupOverlap: C[g][h] = P(k-mer in g | k-mer in h), 1 vs 2 members");
    uint64_t sum_gh = 0, sum_hh = 0;
    for (size_t a : {0, 1}) for (size_t b : {0, 1}) sum_hh += pw[a * 5 + b];
    for (size_t b : {0, 1}) sum_gh += pw[2 * 5 + b];
    check(static_cast<double>(sum_gh) / sum_hh < 0.6 * C1[1 * 2 + 0],
          "groupOverlap: the summed pairwise roll-up underestimates it");
    TaxIndex empty;
    check(empty.groupOverlap({}, 3) == std::vector<uint64_t>(9, 0), "groupOverlap of an empty index");
  }

  // ---- 8b. the present set is self-consistent; BH coupling cannot cycle it ----
  {
    // X: o = 100, d = 381 at D = 5 (random part 76.3); Y: o = 20, d = 0 with
    // C[Y][X] = 0.2. With no genus present both qualify; with X present its
    // spill (20) explains Y, which lifts q_X over alpha by BH; with nothing
    // present the spill is gone again. A period-2 cycle: neither genus can be
    // called present self-consistently, so both are no_call unstable, on
    // statistics computed with spill from the (empty) present set. An extra
    // untested genus must not change any call (the old round bound made the
    // result depend on the parity of n).
    SC::Params pr; pr.alpha = 0.01; pr.tau = 0.0; pr.n_min = 5;
    SC::RunInput run; run.n_units = 1000; run.n_trials = 1000; run.decoys = 5; run.min_units = 200;
    const auto mk = [&](size_t extra) {
      std::vector<SC::GenusInput> g = {{10, 100, 381, 0.1, 100.0}, {20, 20, 0, 0.02, 20.0}};
      for (size_t k = 0; k < extra; ++k) g.push_back({static_cast<uint32_t>(30 + k), 0, 0, 0.0, 0.0});
      const size_t n = g.size();
      std::vector<double> C(n * n, 0.0);
      for (size_t i = 0; i < n; ++i) C[i * n + i] = 1.0;
      C[1 * n + 0] = 0.2;  // C[Y][X]
      return SC::callGenera(g, C, run, pr);
    };
    const auto s2 = mk(0);
    check(near(find(s2, 10)->random_expected, 76.3), "cycle: X random part 76.3");
    for (uint32_t t : {10u, 20u})
    {
      check(find(s2, t)->call == SC::Call::NoCall && find(s2, t)->reason == "unstable",
            "cycle: genus " + std::to_string(t) + " is no_call unstable");
      check(find(s2, t)->spill == 0.0, "cycle: no spill from a genus that is not called present");
    }
    for (size_t extra = 1; extra <= 3; ++extra)
    {
      const auto sn = mk(extra);
      for (uint32_t t : {10u, 20u})
      {
        const auto *a = find(s2, t), *b = find(sn, t);
        check(a->call == b->call && a->reason == b->reason && a->spill == b->spill &&
                  near(a->qvalue, b->qvalue, 1e-12),
              "parity: " + std::to_string(extra) + " extra untested genera change nothing for " + std::to_string(t));
      }
    }
    // Without the cycle (X twice as strong) X is present and Y a near_neighbour.
    {
      std::vector<SC::GenusInput> g = {{10, 200, 381, 0.2, 200.0}, {20, 40, 0, 0.04, 40.0}};
      const std::vector<double> C = {1.0, 0.0, 0.2, 1.0};
      const auto s = SC::callGenera(g, C, run, pr);
      check(find(s, 10)->call == SC::Call::Present, "no cycle: X present");
      check(find(s, 20)->call == SC::Call::NoCall && find(s, 20)->reason == "near_neighbour" &&
                near(find(s, 20)->spill, 0.2 * 200.0),
            "no cycle: Y near_neighbour on X's spill");
    }
    // near_neighbour needs spill: Z, unrelated to X and Y, is significant on
    // the random part alone (q_Z = p_Z, rank 3 of 3) but once X's spill
    // explains Y, BH ranks Z second and q_Z = 1.5 p_Z > alpha. Z gets no
    // spill, so it is not_detected, not a near_neighbour.
    {
      const double lamZ = SC::randomExpected(50, 5, 1000);
      uint64_t oZ = 0;
      for (uint64_t o = 1; o < 200 && oZ == 0; ++o)
      {
        const double t = SC::poissonUpperTail(o, lamZ);
        if (t <= 0.0098 && t > 0.0068) oZ = o;
      }
      check(oZ > 0, "BH coupling: a Z count with p in (alpha / 1.5, alpha)");
      std::vector<SC::GenusInput> g = {{10, 200, 381, 0.2, 200.0}, {20, 40, 0, 0.04, 40.0},
                                       {30, oZ, 50, 0.01, static_cast<double>(oZ)}};
      const std::vector<double> C = {1.0, 0.0, 0.0,
                                     0.2, 1.0, 0.0,
                                     0.0, 0.0, 1.0};
      const auto s = SC::callGenera(g, C, run, pr);
      const auto* z = find(s, 30);
      check(find(s, 10)->call == SC::Call::Present, "BH coupling: X present");
      check(z->spill == 0.0 && z->qvalue_random <= pr.alpha && z->qvalue > pr.alpha,
            "BH coupling: Z significant on the random part only, without spill");
      check(z->call == SC::Call::NotDetected && z->reason == "not_significant",
            "BH coupling: Z not_detected, not near_neighbour");
    }
  }

  // ---- 9. all-decoy run: nothing present -------------------------------------
  {
    // 60 genera whose target counts are drawn from the same rate as their
    // decoys: o ~ Poisson(lambda), d ~ Poisson(D * lambda). Nothing is
    // present, whatever the counts; repeated over 20 seeds.
    int false_present = 0;
    for (uint64_t seed = 1; seed <= 20; ++seed)
    {
      Rng rng{seed};
      std::vector<SC::GenusInput> g;
      uint64_t units = 0;
      for (uint32_t i = 0; i < 60; ++i)
      {
        const double l = 0.5 + 40.0 * rng.unif();
        SC::GenusInput x;
        x.taxid = 1000 + i;
        x.observed = rng.poisson(l);
        x.decoy_spectra = rng.poisson(5.0 * l);
        x.deconvolved = static_cast<double>(x.observed);
        units += x.observed;
        g.push_back(x);
      }
      for (auto& x : g) x.share = static_cast<double>(x.observed) / static_cast<double>(units);
      SC::Params pr; pr.alpha = 0.01; pr.tau = 0.0; pr.n_min = 5;
      SC::RunInput run; run.n_units = units; run.n_trials = units; run.decoys = 5; run.min_units = 50;
      for (const auto& s : SC::callGenera(g, {}, run, pr)) if (s.call == SC::Call::Present) ++false_present;
    }
    check(false_present == 0, "all-decoy runs: no genus present (" + std::to_string(false_present) + ")");
  }

  // ---- 10. NaN E-values: a decoy list under Best evidence ---------------------
  {
    // The decoys of a spectrum's tags carry the targets' E-values; the decoy
    // spectrum counts for the taxa of its best informative decoy tag.
    std::vector<TagSupport> dec = {{0.01, {}}, {5.0, {7}}, {9.0, {8}}};
    check(spectrumTaxa(dec, SpeciesEvidence::Best) == std::set<uint32_t>({7}), "decoy list: best informative decoy");
    const double nan = std::numeric_limits<double>::quiet_NaN();
    std::vector<TagSupport> dn = {{nan, {7}}, {nan, {8}}};
    check(spectrumTaxa(dn, SpeciesEvidence::Best) == std::set<uint32_t>({7, 8}), "decoy list: NaN E-values unite");
    // NaN in callGenera inputs cannot produce a present call.
    SC::Params pr; pr.alpha = 0.01; pr.n_min = 5;
    SC::RunInput run; run.n_units = 1000; run.n_trials = 1000; run.decoys = 5; run.min_units = 50;
    std::vector<SC::GenusInput> g = {{1, 50, 0, nan, 50}};
    check(SC::callGenera(g, {}, run, pr)[0].call != SC::Call::Present, "NaN share is never present");
  }

  // ---- 11. the parameter file -------------------------------------------------
  {
    // temp_directory_path: TMPDIR on POSIX, TEMP/TMP on Windows (no "/tmp" there).
    const std::string dir = std::filesystem::temp_directory_path().string();
    const std::string f = dir + "/species_call_test_params.tsv";
    SC::Params p;
    std::string err;
    writeFile(f, "# comment\nversion\t1.12.0-test\nalpha\t0.05\ntau\t0.002\nn_min\t20\ndecoys\t5\ntraining_sha256\tnone\n\n");
    check(SC::loadParams(f, p, &err) && p.alpha == 0.05 && p.tau == 0.002 && p.n_min == 20 && p.decoys == 5
              && p.version == "1.12.0-test" && p.training_sha256 == "none",
          "loadParams: good file (" + err + ")");
    writeFile(f, "alpha\t0.05\ntau\t0.002\n");
    check(!SC::loadParams(f, p, &err) && err.find("n_min") != std::string::npos, "loadParams: missing key refused");
    writeFile(f, "alpha\t0.05\ntau\t0.002\nn_min\t20\nalhpa\t0.1\n");
    check(!SC::loadParams(f, p, &err) && err.find("alhpa") != std::string::npos, "loadParams: unknown key refused");
    writeFile(f, "alpha\t0\ntau\t0.002\nn_min\t20\n");
    check(!SC::loadParams(f, p, &err), "loadParams: alpha 0 refused");
    writeFile(f, "alpha\t0.01\ntau\t1.5\nn_min\t20\n");
    check(!SC::loadParams(f, p, &err), "loadParams: tau > 1 refused");
    writeFile(f, "alpha\t0.01\ntau\tx\nn_min\t20\n");
    check(!SC::loadParams(f, p, &err), "loadParams: non-numeric refused");
    writeFile(f, "alpha\t0.01\ntau\t0\nn_min\t0\n");
    check(!SC::loadParams(f, p, &err), "loadParams: n_min 0 refused");
    check(!SC::loadParams(dir + "/no_such_species_call.tsv", p, &err), "loadParams: missing file refused");
    std::remove(f.c_str());
  }

  // ---- 12. -species_call explain (1.13) ----------------------------------------
  {
    using namespace FASTag::SpeciesCall;
    check(negBinomialUpperTail(0, 2.0, 2.0) == 1.0, "NB tail: o = 0");
    check(std::fabs(negBinomialUpperTail(7, 3.0, 1.0) - poissonUpperTail(7, 3.0)) < 1e-15, "NB tail: factor 1 is Poisson");
    // mean 2, variance 4: size 2, p 1/2 -> P(0) = 1/4, P(1) = 1/4.
    check(std::fabs(negBinomialUpperTail(1, 2.0, 2.0) - 0.75) < 1e-12, "NB tail: P(X >= 1)");
    check(std::fabs(negBinomialUpperTail(2, 2.0, 2.0) - 0.5) < 1e-12, "NB tail: P(X >= 2)");
    check(negBinomialUpperTail(20, 3.0, 2.0) > poissonUpperTail(20, 3.0), "NB tail: heavier than Poisson");

    // contributingTags is the tag view of spectrumTaxa.
    std::vector<TagSupport> tags(4);
    tags[0].evalue = 0.5; tags[0].taxa = {1, 2};
    tags[1].evalue = 0.1; tags[1].taxa = {3};
    tags[2].evalue = 0.1; tags[2].taxa = {4};
    tags[3].evalue = 0.01;  // best E but not informative
    for (SpeciesEvidence mode : {SpeciesEvidence::Best, SpeciesEvidence::All})
    {
      std::set<uint32_t> u;
      for (std::size_t i : contributingTags(tags, mode)) u.insert(tags[i].taxa.begin(), tags[i].taxa.end());
      check(u == spectrumTaxa(tags, mode), "contributingTags: union of taxa equals spectrumTaxa");
    }
    check(contributingTags(tags, SpeciesEvidence::Best) == std::vector<std::size_t>({1, 2}), "contributingTags: the best informative E");

    // Group 0 is the organism (40 tags), group 1 a relative that shares 15 of
    // its tags and has nothing of its own, group 2 a second organism (12 tags
    // in its own spectra), group 3 has chance hits only. One decoy hit per
    // replicate.
    const std::vector<uint32_t> taxid = {10, 20, 30, 40};
    std::vector<TagHit> target;
    for (uint32_t s = 0; s < 40; ++s) target.push_back({s, s, 0});
    for (uint32_t s = 0; s < 15; ++s) target.push_back({s, s, 1});
    for (uint32_t s = 100; s < 112; ++s) target.push_back({s, s, 2});
    target.push_back({200, 200, 3});
    std::vector<std::vector<TagHit>> decoys(5);
    for (uint32_t j = 0; j < 5; ++j) decoys[j].push_back({j, j, j % 4});
    Params prm;  // alpha 0.01, n_min 10
    RunInput run;
    run.n_units = 1000;
    const std::vector<GenusStat> st = callExplain(taxid, target, decoys, run, prm);
    check(st.size() == 4 && st[0].taxid == 10 && st[3].taxid == 40, "explain: one row per group, in order");
    check(st[0].call == Call::Present && st[0].observed == 40 && st[0].tags == 40, "explain: the organism is present");
    check(st[2].call == Call::Present && st[2].observed == 12, "explain: the second organism is present");
    check(st[1].call == Call::NotDetected && st[1].reason == "explained" && st[1].tags == 15 && st[1].observed == 0,
          "explain: the relative's tags are explained by the organism");
    check(st[3].call == Call::NotDetected && st[3].reason == "not_significant", "explain: chance hits are not detected");
    check(st[0].qvalue <= prm.alpha && st[1].qvalue == 1.0, "explain: decoy_qvalue");
    // The relative alone would be called: the explaining is what removes it.
    std::vector<TagHit> alone;
    for (uint32_t s = 0; s < 15; ++s) alone.push_back({s, s, 1});
    check(callExplain(taxid, alone, decoys, run, prm)[1].call == Call::Present, "explain: the same 15 tags alone are present");
    // The same tag in many spectra is one tag.
    std::vector<TagHit> repeat;
    for (uint32_t s = 0; s < 500; ++s) repeat.push_back({s, 7, 0});
    const GenusStat rs = callExplain(taxid, repeat, decoys, run, prm)[0];
    check(rs.tags == 1 && rs.call == Call::NotDetected, "explain: 500 spectra of one tag are one tag");
    // Targets that look like the decoys: nothing present.
    std::vector<TagHit> flat;
    std::vector<std::vector<TagHit>> dflat(5);
    for (uint32_t g = 0; g < 4; ++g)
    {
      for (uint32_t t = 0; t < 12; ++t) flat.push_back({g * 100 + t, g * 100 + t, g});
      for (uint32_t j = 0; j < 5; ++j)
        for (uint32_t t = 0; t < 10 + (j + g) % 5; ++t) dflat[j].push_back({g * 100 + t, g * 100 + t, g});
    }
    for (const GenusStat& s : callExplain(taxid, flat, dflat, run, prm))
      check(s.call == Call::NotDetected, "explain: targets at the decoy level are not detected");
    // Run-level abstention as in the decoy call.
    run.low_resolution = true;
    for (const GenusStat& s : callExplain(taxid, target, decoys, run, prm))
      check(s.call == Call::NoCall && s.reason == "low_resolution", "explain: low_resolution is a run-level no_call");
    run.low_resolution = false;
    run.n_units = 10;
    check(callExplain(taxid, target, decoys, run, prm)[0].reason == "few_spectra", "explain: few_spectra is a run-level no_call");
    check(callExplain({}, target, decoys, run, prm).empty(), "explain: no groups");
  }

  if (failures) { std::cerr << failures << " species_call_test check(s) failed\n"; return 1; }
  std::cout << "species_call_test: all checks passed\n";
  return 0;
}
