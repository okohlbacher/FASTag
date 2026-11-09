// FASTag 1.13 digqual (backlog 23): missed-cleavage and non-specific-end
// measurements of -digest_quality. Synthetic tables and tag ends only.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "Digest.h"

#include <cmath>
#include <cstdio>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace D = FASTag::Digest;

static int failures = 0;
static void check(bool ok, const std::string& what)
{
  if (!ok) { std::cerr << "FAIL: " << what << "\n"; ++failures; }
}
static void close(double got, double want, double tol, const std::string& what)
{
  check(std::fabs(got - want) <= tol, what + ": got " + std::to_string(got) + ", want " + std::to_string(want));
}
static std::size_t ix(char c) { return static_cast<std::size_t>(D::aaIndex(c)); }

// Uniform background (1/19 per residue) and the shipped rule models.
static D::ModelTable table()
{
  std::string t = "model\tclass\tend\tresidue\tfreq\n";
  for (const char* end : {"C", "N"})
    for (int i = 0; i < D::kNumAA; ++i)
      t += std::string("background\t-\t") + end + "\t" + D::kAAs[static_cast<std::size_t>(i)] + "\t1\n";
  t += "Trypsin\tTrypsin\tC\tK\t0.5\nTrypsin\tTrypsin\tC\tR\t0.5\nTrypsin\tTrypsin\tN\t*\t-\n"
       "Asp-N\tAsp-N\tC\t*\t-\nAsp-N\tAsp-N\tN\tD\t1\n"
       "unspecific\tunspecific cleavage\tC\t*\t-\nunspecific\tunspecific cleavage\tN\t*\t-\n"
       "Both\tBoth\tC\tE\t1\nBoth\tBoth\tN\tD\t1\n";
  D::ModelTable m;
  std::istringstream in(t);
  std::string err;
  check(D::parseModelTable(in, m, &err), "table parses: " + err);
  return m;
}
static const D::Model& model(const D::ModelTable& t, const std::string& name)
{
  for (const D::Model& m : t.models)
    if (m.name == name) return m;
  std::cerr << "no model " << name << "\n";
  std::exit(1);
}
static std::string value(const std::vector<D::Row>& rows, const std::string& key)
{
  for (const D::Row& r : rows)
    if (r.section == "quality" && r.key == key) return r.value;
  return "<none>";
}

int main()
{
  const D::ModelTable t = table();
  const double K = 128.09496, R = 156.10111, Dm = 115.02694;

  // ---- site residues: model above background
  {
    const auto s = D::siteResidues(model(t, "Trypsin").c, t.bg_c);
    check(s.size() == 2 && s[0] == D::aaIndex('K') && s[1] == D::aaIndex('R'), "Trypsin C sites are K, R (kAAs order)");
    check(D::siteResidues(model(t, "Asp-N").n, t.bg_n) == std::vector<int>{D::aaIndex('D')}, "Asp-N N site is D");
    D::Dist flat{};
    flat.fill(1.0);
    check(D::siteResidues(flat, t.bg_c).empty(), "a model equal to the background has no site");
  }

  // ---- joint counts from add(): a y tag at P1 = K, a reversed b tag at P1 = R,
  // an N-end tag at P1' = D
  {
    D::TerminusCounter tc;
    tc.add(500.0, K, "GAKS");        // C flank K: P2..P4 = S, K, A (tail)
    tc.add(R + D::kH2O, 800.0, "LRTV");  // reversed b tag, P1 = R: P2..P4 = L, R, T (head)
    tc.add(Dm, 900.0, "DGAV");      // N flank D: P2'..P4' = D, G, A
    check(tc.cq[ix('K')][ix('S')] == 1 && tc.cq[ix('K')][ix('K')] == 1 && tc.cq[ix('K')][ix('A')] == 1 &&
              tc.cq[ix('K')][ix('G')] == 0,
          "cq[K] holds the last three residues of the y tag");
    check(tc.cq[ix('R')][ix('L')] == 1 && tc.cq[ix('R')][ix('R')] == 1 && tc.cq[ix('R')][ix('T')] == 1 &&
              tc.cq[ix('R')][ix('V')] == 0,
          "cq[R] holds the first three residues of the reversed b tag");
    check(tc.nq[ix('D')][ix('D')] == 1 && tc.nq[ix('D')][ix('G')] == 1 && tc.nq[ix('D')][ix('A')] == 1 &&
              tc.nq[ix('D')][ix('V')] == 0,
          "nq[D] holds the first three residues of the N-end tag");
    // A labelled K (TMT) counts as K.
    D::TerminusCounter tl;
    tl.add(500.0, K + 229.162932, "AAAK");
    check(tl.cq[ix('K')][ix('K')] == 1 && tl.cq[ix('K')][ix('A')] == 2, "K+TMT end merges into cq[K]");
    // merge adds them.
    D::TerminusCounter m;
    m.merge(tc);
    m.merge(tc);
    check(m.cq[ix('K')][ix('K')] == 2 && m.nq[ix('D')][ix('D')] == 2, "merge() adds cq and nq");
  }

  // ---- mixture MLE: counts drawn exactly as (1 - s) Trypsin + s background
  {
    const D::Model& tr = model(t, "Trypsin");
    // s = 0.2 with background 1/19: K and R each 0.8*0.5 + 0.2/19, others 0.2/19.
    // 19000 ends: K, R 7800 each; 17 others 200 each.
    std::array<std::uint64_t, D::kNumAA> k{};
    k.fill(200);
    k[ix('K')] = 7800;
    k[ix('R')] = 7800;
    close(D::mixtureShareMle(k, tr.c, t.bg_c), 0.2, 1e-9, "MLE recovers s = 0.2");
    std::array<std::uint64_t, D::kNumAA> pure{};
    pure[ix('K')] = 60;
    pure[ix('R')] = 40;
    close(D::mixtureShareMle(pure, tr.c, t.bg_c), 0.0, 0.0, "only K/R ends: s = 0");
    std::array<std::uint64_t, D::kNumAA> flat{};
    flat.fill(10);
    close(D::mixtureShareMle(flat, tr.c, t.bg_c), 1.0, 1e-9, "background-shaped ends: s = 1 (derivative 0 at s = 1)");
  }

  // ---- digestQuality on a counter: Trypsin
  {
    D::TerminusCounter tc;
    // 150 K ends (y tags "GAKS": P2..P4 S, K, A), 50 R ends ("AAAA": no site),
    // 20 ends at L.
    for (int i = 0; i < 150; ++i) tc.add(500.0, K, "GAKS");
    for (int i = 0; i < 50; ++i) tc.add(500.0, R, "AAAA");
    for (int i = 0; i < 20; ++i) tc.add(500.0, 113.08406, "KKKK");  // non-specific: not in the MC positions
    D::DigestSettings s;
    const D::Quality q = D::digestQuality(tc, t, model(t, "Trypsin"), "named", 100);
    check(q.measured && q.reason.empty() && q.ends.size() == 1 && q.ends[0].end == 'C', "Trypsin: one measured C end");
    const D::QualityEnd& e = q.ends[0];
    check(e.ends == 220 && e.specific == 200, "ends 220, specific 200");
    close(e.nonspecific_share, 20.0 / 220.0, 1e-15, "non-specific share");
    check(e.mc_positions == 600 && e.mc_sites == 150, "600 positions, 150 sites (K at P3 of the K tags)");
    close(e.mc_background_share, 2.0 / 19.0, 1e-15, "background share of K, R");
    close(e.mc_retention, (150.0 / 450.0) / ((2.0 / 19.0) / (17.0 / 19.0)), 1e-12, "retention odds ratio");
    const auto rows = D::qualityRows(q, s);
    check(value(rows, "enzyme") == "Trypsin" && value(rows, "basis") == "named" && value(rows, "status") == "measured",
          "rows: enzyme, basis, status");
    check(value(rows, "C.sites") == "K,R" && value(rows, "C.ends") == "220" && value(rows, "C.mc_sites") == "150",
          "rows: sites, ends, mc_sites");
    check(value(rows, "C.mc_retention") == D::num(e.mc_retention), "rows: retention in round-trip form");
    check(e.mc_measured && value(rows, "C.mc_measured") == "yes" && value(rows, "C.mc_reason") == "<none>",
          "200 specific ends: mc measured");
    check(value(rows, "N.sites") == "<none>", "rows: no N end for Trypsin");
    for (const D::Row& r : rows)
      check(r.section == "quality" && !r.key.empty() && !r.value.empty() && !r.description.empty(),
            "row " + r.key + " has every field");
    // Few tags: below tag_min the end is not measured.
    const D::Quality few = D::digestQuality(tc, t, model(t, "Trypsin"), "named", 1000);
    check(!few.measured && few.reason == "few_tags" && few.ends.size() == 1 && !few.ends[0].measured, "few_tags");
    const auto frows = D::qualityRows(few, s);
    check(value(frows, "status") == "not_measured" && value(frows, "reason") == "few_tags" &&
              value(frows, "C.measured") == "no" && value(frows, "C.mc_retention") == "<none>",
          "few_tags rows");
  }

  // ---- every site cut: retention 0; only sites: undefined
  {
    D::TerminusCounter tc;
    for (int i = 0; i < 100; ++i) tc.add(500.0, K, "AAAA");
    const D::Quality q = D::digestQuality(tc, t, model(t, "Trypsin"), "named", 100);
    close(q.ends[0].mc_retention, 0.0, 0.0, "no internal K/R: retention 0");
    D::TerminusCounter all;
    for (int i = 0; i < 100; ++i) all.add(500.0, K, "KRKR");
    const D::Quality qa = D::digestQuality(all, t, model(t, "Trypsin"), "named", 100);
    check(std::isnan(qa.ends[0].mc_retention), "only K/R internal: retention undefined");
    check(value(D::qualityRows(qa, D::DigestSettings()), "C.mc_retention") == "-", "undefined retention written as -");
  }

  // ---- N-end enzyme, both ends, background-only model
  {
    D::TerminusCounter tc;
    for (int i = 0; i < 120; ++i) tc.add(Dm, 900.0, "DGAV");
    const D::Quality q = D::digestQuality(tc, t, model(t, "Asp-N"), "call", 100);
    check(q.measured && q.ends.size() == 1 && q.ends[0].end == 'N', "Asp-N: one N end");
    check(q.ends[0].ends == 120 && q.ends[0].mc_positions == 360 && q.ends[0].mc_sites == 120, "Asp-N counts");
    const auto rows = D::qualityRows(q, D::DigestSettings());
    check(value(rows, "N.sites") == "D" && value(rows, "basis") == "call", "Asp-N rows");
    const D::Quality b = D::digestQuality(tc, t, model(t, "Both"), "named", 100);
    check(b.ends.size() == 2 && b.ends[0].end == 'C' && b.ends[1].end == 'N' && !b.ends[0].measured && b.ends[1].measured &&
              b.measured,
          "a model with two cleaving ends: C (too few) then N (measured)");
    const D::Quality u = D::digestQuality(tc, t, model(t, "unspecific"), "named", 100);
    check(!u.measured && u.reason == "no_specific_end" && u.ends.empty(), "unspecific: no_specific_end");
    check(value(D::qualityRows(u, D::DigestSettings()), "reason") == "no_specific_end", "unspecific rows");
  }

  // ---- many ends, few specific: the end is measured, its missed-cleavage
  // ratios are not (mc_few_specific); the non-specific rows are written
  {
    D::TerminusCounter tc;
    for (int i = 0; i < 40; ++i) tc.add(500.0, K, "GAKS");               // 40 specific (K)
    for (int i = 0; i < 400; ++i) tc.add(500.0, 113.08406, "AAAA");      // 400 at L
    const D::Quality q = D::digestQuality(tc, t, model(t, "Trypsin"), "named", 100);
    check(q.measured && q.ends.size() == 1 && q.ends[0].measured && !q.ends[0].mc_measured,
          "few specific: end measured, mc not measured");
    check(q.ends[0].ends == 440 && q.ends[0].specific == 40 && q.ends[0].mc_positions == 120 && q.ends[0].mc_sites == 40,
          "few specific: counts");
    check(std::isnan(q.ends[0].mc_retention), "few specific: no retention");
    const auto rows = D::qualityRows(q, D::DigestSettings());
    check(value(rows, "status") == "measured" && value(rows, "C.measured") == "yes" && value(rows, "C.mc_measured") == "no" &&
              value(rows, "C.mc_reason") == "mc_few_specific",
          "few specific rows: mc_measured no, mc_reason mc_few_specific");
    check(value(rows, "C.mc_retention") == "-" && value(rows, "C.mc_site_share") == "-", "few specific rows: ratios are -");
    close(q.ends[0].nonspecific_share, 400.0 / 440.0, 1e-15, "few specific: non-specific share");
    check(value(rows, "C.nonspecific_share") == D::num(q.ends[0].nonspecific_share) &&
              value(rows, "C.nonspecific_mle") == D::num(q.ends[0].nonspecific_mle),
          "few specific rows: non-specific share and MLE written");
    // At tag_min 40 the same counts measure the ratios.
    const D::Quality q40 = D::digestQuality(tc, t, model(t, "Trypsin"), "named", 40);
    check(q40.ends[0].mc_measured && !std::isnan(q40.ends[0].mc_retention), "specific == tag_min: mc measured");
    const auto rows40 = D::qualityRows(q40, D::DigestSettings());
    check(value(rows40, "C.mc_measured") == "yes" && value(rows40, "C.mc_reason") == "<none>" &&
              value(rows40, "C.mc_retention") == D::num(q40.ends[0].mc_retention),
          "specific == tag_min rows");
  }

  // ---- reportQuality: auto from the call rows, named, no call, Da tolerance
  {
    D::TerminusCounter tc;
    for (int i = 0; i < 150; ++i) tc.add(500.0, K, "GAKS");
    for (int i = 0; i < 50; ++i) tc.add(500.0, R, "AAAA");
    D::DigestSettings s;  // tag_min 100, ppm
    const std::vector<D::Row> called = {{"call", "status", "call", "-", "x"}, {"call", "model", "Trypsin", "-", "x"}};
    const D::Quality a = D::reportQuality(tc, t, called, "auto", s);
    const D::Quality n = D::reportQuality(tc, t, {}, "Trypsin", s);
    check(a.measured && a.basis == "call" && a.enzyme == "Trypsin", "auto: the call's model, basis call");
    check(n.measured && n.basis == "named" && n.enzyme == "Trypsin", "named: basis named");
    auto ra = D::qualityRows(a, s), rn = D::qualityRows(n, s);
    check(ra.size() == rn.size(), "auto and named give the same number of rows");
    for (std::size_t i = 0; i < ra.size() && i < rn.size(); ++i)
      if (ra[i].key != "basis" && ra[i].key != "enzyme")
        check(ra[i].key == rn[i].key && ra[i].value == rn[i].value && ra[i].n == rn[i].n,
              "auto row " + ra[i].key + " equals the named row");
    // Asp-N called: the N end of Asp-N (the model name is looked up, not fixed)
    const std::vector<D::Row> aspn = {{"call", "model", "Asp-N", "-", "x"}, {"call", "status", "call", "-", "x"}};
    check(D::reportQuality(tc, t, aspn, "auto", s).enzyme == "Asp-N", "auto: Asp-N call");
    const std::vector<D::Row> nocall = {{"call", "status", "no_call", "-", "x"}, {"call", "reason", "few_tags", "-", "x"}};
    const D::Quality nc = D::reportQuality(tc, t, nocall, "auto", s);
    check(!nc.measured && nc.reason == "no_call" && nc.enzyme == "-" && nc.ends.empty(), "auto without a call: no_call");
    const std::vector<D::Row> other = {{"call", "status", "call", "-", "x"}, {"call", "model", "Papain", "-", "x"}};
    check(D::reportQuality(tc, t, other, "auto", s).reason == "no_call", "auto with a model not in the table: no_call");
    check(D::reportQuality(tc, t, {{"model", "status", "call", "-", "x"}, {"model", "model", "Trypsin", "-", "x"}}, "auto", s).reason ==
              "no_call",
          "auto reads the call section only");
    D::DigestSettings da = s;
    da.low_resolution = true;
    const D::Quality ln = D::reportQuality(tc, t, called, "Trypsin", da);
    const D::Quality la = D::reportQuality(tc, t, called, "auto", da);
    check(!ln.measured && ln.reason == "low_resolution" && ln.enzyme == "Trypsin" && ln.ends.empty(),
          "Da, named: low_resolution, no end");
    check(!la.measured && la.reason == "low_resolution" && la.basis == "call" && la.ends.empty(), "Da, auto: low_resolution");
    const auto lr = D::qualityRows(ln, da);
    check(value(lr, "status") == "not_measured" && value(lr, "reason") == "low_resolution" && value(lr, "C.ends") == "<none>" &&
              value(lr, "C.mc_retention") == "<none>",
          "Da rows: not_measured low_resolution, no end rows");
  }

  if (failures) { std::cerr << failures << " failure(s)\n"; return 1; }
  std::cout << "digest_quality_test: OK\n";
  return 0;
}
