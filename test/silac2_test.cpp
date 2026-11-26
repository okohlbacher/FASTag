// -label_format 2 (1.17 silac2): the route-split SILAC rows.
//
// Small synthetic tag tables, one rule each (src/Digest.h, "1.17 silac2"):
//   1. the y route (cterm_mass) and the b route (nterm_mass + H2O) are
//      counted and reported apart;
//   2. an end mass that is also a dipeptide's (Arg10 = A+L less H2O, W = G+F
//      less H2O) is flagged, and Arg10 is assessed on the y route alone
//      (not_assessable alias_AL below the gate);
//   3. no label present and the y route below the gate: no_call no_y1_ends,
//      where the 1.16 label_call says label-free;
//   4. one call per label (Lys4, Arg6, Lys8, Arg10) with share, count and a
//      Wilson 95% interval, no two-label rule.
// Synthetic evidence pins the rules; it does not choose a default.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "Digest.h"

#include <cmath>
#include <iostream>
#include <map>
#include <string>
#include <vector>

namespace D = FASTag::Digest;

static int failures = 0;
static void check(bool ok, const std::string& what)
{
  if (!ok) { std::cerr << "FAIL: " << what << "\n"; ++failures; }
}
static std::string value(const std::vector<D::Row>& rows, const std::string& section, const std::string& key)
{
  for (const D::Row& r : rows)
    if (r.section == section && r.key == key) return r.value;
  return "<missing " + section + " " + key + ">";
}

static double mass(const char* key)
{
  for (const D::Silac2Key& k : D::silac2Keys())
    if (std::string(key) == k.name) return k.mass;
  check(false, std::string("no silac2 key ") + key);
  return 0.0;
}
static constexpr double A = 71.03711, L = 113.08406, G = 57.02146, F = 147.06841;
static constexpr double FAR = 900.0;  // a flank mass that matches no key

/// A synthetic tag table: y-route ends (cterm = residue) and b-route ends
/// (nterm = residue + H2O) per silac2 key, each a tag of its own.
static D::TerminusCounter table(const std::map<std::string, int>& y, const std::map<std::string, int>& b = {})
{
  D::TerminusCounter tc;
  for (const auto& [k, n] : y)
    for (int i = 0; i < n; ++i) tc.add(FAR, mass(k.c_str()), "GSG");
  for (const auto& [k, n] : b)
    for (int i = 0; i < n; ++i) tc.add(mass(k.c_str()) + D::H2O_MASS, FAR, "GSG");
  return tc;
}

/// "status silac reason" of the silac2 rows
static std::string run(const D::TerminusCounter& tc, const D::DigestSettings& s = D::DigestSettings())
{
  const auto rows = D::silac2Rows(D::silac2Call(tc, s), tc, s);
  return value(rows, "silac2", "status") + " " + value(rows, "silac2", "silac") + " " + value(rows, "silac2", "reason");
}
/// "call reason" of one label
static std::string lab(const D::TerminusCounter& tc, const std::string& name, const D::DigestSettings& s = D::DigestSettings())
{
  const auto rows = D::silac2Rows(D::silac2Call(tc, s), tc, s);
  return value(rows, "silac2", name + ".call") + " " + value(rows, "silac2", name + ".reason");
}
/// the 1.16 label_call label
static std::string v1(const D::TerminusCounter& tc, const D::DigestSettings& s = D::DigestSettings())
{
  return value(D::labelCallRows(D::labelCall(tc, s), tc, s), "label_call", "label");
}

int main()
{
  const D::DigestSettings s;

  // ---- keys and aliases
  {
    const auto& k = D::silac2Keys();
    check(k.size() == 7 && std::string(k[0].name) == "K" && std::string(k[6].name) == "W", "silac2 keys K .. W");
    check(mass("K+4") == 128.09496 + 4.025107 && mass("R+6") == 156.10111 + 6.020129, "Lys4 and Arg6 masses");
    // the same doubles as residueKeys() for the keys both hold
    for (const D::ResidueKey& r : D::residueKeys())
      for (const D::Silac2Key& q : k)
        if (std::string(r.name) == q.name) check(r.mass == q.mass, std::string("mass of ") + q.name);
    const auto r10 = D::dipeptideAliases(mass("R+10"), 0.008);
    check(r10.size() == 1 && r10[0].name == "AL" && r10[0].less_h2o && r10[0].end_mass == A + L - D::H2O_MASS,
          "R+10 is A+L less H2O at 0.008 Da");
    const auto w = D::dipeptideAliases(mass("W"), 0.008);
    check(w.size() == 1 && w[0].name == "GF" && w[0].less_h2o, "W is G+F less H2O at 0.008 Da");
    for (const char* q : {"K", "K+4", "K+8", "R", "R+6"})
      check(D::dipeptideAliases(mass(q), 0.008).empty(), std::string("no alias of ") + q + " at 0.008 Da");
    // the window decides: R = G+V (11 mDa) at 0.02 Da, N = G+G (two residues in the flank)
    const auto r = D::dipeptideAliases(mass("R"), 0.02);
    check(r.size() == 1 && r[0].name == "GV" && !r[0].less_h2o, "R is G+V at 0.02 Da");
    const auto n = D::dipeptideAliases(114.04293, 0.008);
    check(n.size() == 1 && n[0].name == "GG" && !n[0].less_h2o, "N is G+G at 0.008 Da");
  }

  // ---- Wilson 95% interval (reference: the closed form in CPython, 17 digits)
  {
    const auto a = D::wilson(10, 50);
    check(std::fabs(a[0] - 0.11243750015776111) < 1e-15 && std::fabs(a[1] - 0.33037105932225419) < 1e-15, "Wilson 10/50");
    const auto b = D::wilson(18, 90);
    check(std::fabs(b[0] - 0.13042401182717056) < 1e-15 && std::fabs(b[1] - 0.29413736351142555) < 1e-15, "Wilson 18/90");
    const auto z = D::wilson(0, 50), o = D::wilson(50, 50), e = D::wilson(0, 0);
    check(z[0] == 0.0 && std::fabs(z[1] - 0.071347599133358724) < 1e-15, "Wilson 0/50 starts at 0");
    check(o[1] == 1.0 && std::fabs(o[0] - 0.92865240086664136) < 1e-15, "Wilson 50/50 ends at 1");
    check(e[0] == 0.0 && e[1] == 1.0, "Wilson 0/0 is [0, 1]");
  }

  // ---- rule 1: the two routes are counted and reported apart
  {
    D::TerminusCounter tc = table({{"K", 7}, {"K+8", 3}, {"R", 5}}, {{"K", 11}, {"R+10", 2}});
    check(tc.tags == 28, "rule 1: 28 tags");
    const std::size_t K = 0, K8 = 2, R = 3, R10 = 5;
    check(tc.s2_y[K] == 7 && tc.s2_b[K] == 11 && tc.s2_y[K8] == 3 && tc.s2_b[K8] == 0, "rule 1: K and K+8 by route");
    check(tc.s2_y[R] == 5 && tc.s2_b[R] == 0 && tc.s2_y[R10] == 0 && tc.s2_b[R10] == 2, "rule 1: R and R+10 by route");
    // the pooled 1.16 counts are the two routes added
    check(tc.res(11) == 18 && tc.c_near[11] == 7 && tc.n_h2o[11] == 11, "rule 1: res(K) = y + b");
    const auto rows = D::silac2Rows(D::silac2Call(tc, s), tc, s);
    check(value(rows, "route", "K.y") == "7" && value(rows, "route", "K.b") == "11", "rule 1: K.y and K.b rows");
    check(value(rows, "route", "R+10.y") == "0" && value(rows, "route", "R+10.b") == "2", "rule 1: R+10.y and R+10.b rows");
    check(value(rows, "route", "y.K.tags") == "10" && value(rows, "route", "y.R.tags") == "5",
          "rule 1: the y-route K and R ends leave the b route out");
    // merge adds both routes and the alias counts
    D::TerminusCounter m = table({{"K", 1}}, {{"R+10", 1}});
    m.merge(tc);
    check(m.s2_y[K] == 8 && m.s2_b[K] == 11 && m.s2_b[R10] == 3 && m.s2_b_alias[R10] == 3, "rule 1: merge");
    // a c/z-dot read: the b route takes the series' reversed-read offset
    D::TerminusCounter cz;
    cz.add(mass("K+8") - 15.0347, FAR, "GSG", -15.0347);
    check(cz.s2_b[K8] == 1 && cz.s2_y[K8] == 0, "rule 1: b route at the c/z-dot offset");
  }

  // ---- rule 2: dipeptide aliases; Arg10 on the y route alone
  {
    // peptide N-termini A+L (b2 = 184.1212 Da) land on the b route of R+10;
    // G+F N-termini on that of W; an AL b2 read as y1 on the y route of R+10
    D::TerminusCounter tc;
    for (int i = 0; i < 40; ++i) tc.add(A + L, FAR, "VDW");
    for (int i = 0; i < 6; ++i) tc.add(G + F, FAR, "SSK");
    for (int i = 0; i < 4; ++i) tc.add(FAR, A + L - D::H2O_MASS, "SSK");
    tc.add(mass("K+8") + D::H2O_MASS, FAR, "GSG");  // an unaliased b-route end
    check(tc.s2_b[5] == 40 && tc.s2_b_alias[5] == 40, "rule 2: 40 A+L N-termini are R+10 b-route ends, all flagged");
    check(tc.s2_y[5] == 4 && tc.s2_y_alias[5] == 4, "rule 2: 4 A+L b2 ions read as y1 are R+10 y-route ends, all flagged");
    check(tc.s2_b[6] == 6 && tc.s2_b_alias[6] == 6, "rule 2: G+F N-termini are W b-route ends, flagged");
    check(tc.s2_b[2] == 1 && tc.s2_b_alias[2] == 0, "rule 2: a K+8 b-route end is not flagged");
    const auto rows = D::silac2Rows(D::silac2Call(tc, s), tc, s);
    check(value(rows, "route", "R+10.alias") == "AL" && value(rows, "route", "W.alias") == "GF" &&
              value(rows, "route", "K+8.alias") == "-",
          "rule 2: the alias rows");
    check(value(rows, "route", "R+10.b_alias") == "40" && value(rows, "silac2", "Arg10.route") == "y" &&
              value(rows, "silac2", "Lys8.route") == "y+b" && value(rows, "silac2", "Arg6.route") == "y+b",
          "rule 2: Arg10 is counted on the y route, the others on both");

    // 1000 b-route Arg10 ends (A+L) and 49 y-route R ends: Arg10 not assessable
    const auto below = table({{"K", 60}, {"R", 40}, {"R+10", 9}}, {{"R+10", 1000}});
    check(lab(below, "Arg10") == "not_assessable alias_AL", "rule 2: 49 y-route R ends: Arg10 alias_AL (" + lab(below, "Arg10") + ")");
    // the same b-route ends would make the 1.16 Arg10 share 0.96
    const auto r1 = D::labelRows(below, s);
    check(value(r1, "heavy", "R10.share").rfind("0.96", 0) == 0, "rule 2: the 1.16 R10.share pools the aliased b route");
    // 50 y-route ends: assessed, the b route left out (9/50 = 0.18 < 0.2)
    const auto at = table({{"K", 60}, {"R", 41}, {"R+10", 9}}, {{"R+10", 1000}});
    check(lab(at, "Arg10") == "not_detected -", "rule 2: 50 y-route R ends: Arg10 assessed on y (" + lab(at, "Arg10") + ")");
    const auto rat = D::silac2Rows(D::silac2Call(at, s), at, s);
    check(value(rat, "silac2", "Arg10.count") == "9" && value(rat, "silac2", "Arg10.share") == D::num(9.0 / 50.0),
          "rule 2: Arg10 share 9 of 50 y-route ends");
    const auto ten = table({{"K", 60}, {"R", 40}, {"R+10", 10}}, {{"R+10", 1000}});
    check(lab(ten, "Arg10") == "present -", "rule 2: Arg10 at 10/50 on the y route is present");
    // a window that aliases light R too (G+V at 0.02 Da) takes Arg6 to the y route
    D::DigestSettings wide = s;
    wide.window = 0.02;
    const auto rw = D::silac2Rows(D::silac2Call(D::TerminusCounter(0.02), wide), D::TerminusCounter(0.02), wide);
    check(value(rw, "silac2", "Arg6.route") == "y" && value(rw, "silac2", "Arg6.reason") == "alias_GV" &&
              value(rw, "silac2", "Arg10.reason") == "alias_AL_GV",
          "rule 2: at 0.02 Da the R aliases take Arg6 and Arg10 to the y route");
  }

  // ---- rule 3: no y1 ends -> no_call no_y1_ends, not label-free
  {
    // a label-free timsTOF run as on PXD067551's FiC plate: every K/R end on
    // the b route, the R+10 b route full of A+L N-termini
    const auto tc = table({}, {{"K", 900}, {"R", 150}, {"R+10", 800}, {"W", 200}});
    check(v1(tc) == "label-free", "rule 3: the 1.16 label_call says label-free (" + v1(tc) + ")");
    check(run(tc) == "no_call - no_y1_ends", "rule 3: silac2 is no_call no_y1_ends (" + run(tc) + ")");
    check(lab(tc, "Lys8") == "not_detected -" && lab(tc, "Lys4") == "not_detected -" && lab(tc, "Arg6") == "not_detected -",
          "rule 3: the unaliased labels are assessed on the b route");
    check(lab(tc, "Arg10") == "not_assessable alias_AL", "rule 3: Arg10 is not assessable");
    const auto rows = D::silac2Rows(D::silac2Call(tc, s), tc, s);
    check(value(rows, "route", "y.gate") == "no" && value(rows, "route", "y.kr") == "-", "rule 3: no y-route K/R share");
    // the y gate: 50 K and 50 R y-route ends each (-digest_silac_min)
    const auto k49 = table({{"K", 49}, {"R", 60}});
    const auto k50 = table({{"K", 50}, {"R", 60}});
    check(run(k49) == "no_call - no_y1_ends" && run(k50) == "call none -", "rule 3: the y gate at 49 and 50 K ends");
    D::DigestSettings smin = s;
    smin.silac_min = 60;
    check(run(k50, smin) == "no_call - no_y1_ends", "rule 3: -digest_silac_min 60 moves the y gate");
    const auto rk = D::silac2Rows(D::silac2Call(k50, s), k50, s);
    check(value(rk, "route", "y.gate") == "yes" && value(rk, "route", "y.kr") == "1", "rule 3: y.kr is 1 for K/R-only ends");
  }

  // ---- rule 4: one call per label
  {
    // Lys8 only (PXD067551 myofibroblasts): the 1.16 rule needs both labels
    const auto k8 = table({{"K", 100}, {"K+8", 100}, {"R", 100}});
    check(v1(k8) == "label-free", "rule 4: Lys8-only is label-free under 1.16");
    check(run(k8) == "call Lys8 -", "rule 4: Lys8-only is called Lys8 (" + run(k8) + ")");
    check(lab(k8, "Lys4") == "not_detected -" && lab(k8, "Arg6") == "not_detected -" && lab(k8, "Arg10") == "not_detected -",
          "rule 4: the other labels are not detected");
    const auto rows = D::silac2Rows(D::silac2Call(k8, s), k8, s);
    const auto ci = D::wilson(100, 200);
    check(value(rows, "silac2", "Lys8.count") == "100" && value(rows, "silac2", "Lys8.share") == "0.5" &&
              value(rows, "silac2", "Lys8.ci_low") == D::num(ci[0]) && value(rows, "silac2", "Lys8.ci_high") == D::num(ci[1]),
          "rule 4: Lys8 count, share and Wilson interval");
    // Arg10 only, y route
    check(run(table({{"K", 100}, {"R", 80}, {"R+10", 20}})) == "call Arg10 -", "rule 4: Arg10 alone at 0.2");
    // a mix below the 1.16 strong share, each label on its own
    check(run(table({{"K", 75}, {"K+8", 25}, {"R", 79}, {"R+10", 21}})) == "call Lys8+Arg10 -", "rule 4: Lys8+Arg10 mix");
    // triplex: Lys4/Arg6 and Lys8/Arg10, every label present
    check(run(table({{"K", 60}, {"K+4", 60}, {"K+8", 60}, {"R", 60}, {"R+6", 60}, {"R+10", 60}})) == "call Lys4+Arg6+Lys8+Arg10 -",
          "rule 4: triplex");
    // the share threshold at 0.2 (HEAVY_MIN), per label
    check(lab(table({{"K", 80}, {"K+8", 20}, {"R", 100}}), "Lys8") == "present -", "rule 4: Lys8 at 0.2 is present");
    check(lab(table({{"K", 81}, {"K+8", 19}, {"R", 100}}), "Lys8") == "not_detected -", "rule 4: Lys8 at 0.19 is not detected");
    // the label gate: heavy + light >= 50 on its routes
    const auto f49 = table({{"K", 30}, {"R", 60}}, {{"K", 10}, {"K+8", 9}});
    const auto f50 = table({{"K", 30}, {"R", 60}}, {{"K", 10}, {"K+8", 10}});
    check(lab(f49, "Lys8") == "not_assessable few_ends" && lab(f50, "Lys8") == "present -",
          "rule 4: Lys8 at 49 and 50 y+b ends (" + lab(f49, "Lys8") + ", " + lab(f50, "Lys8") + ")");
    // Lys8 from the b route alone, with no y1 ends: present, the run called
    const auto b8 = table({}, {{"K", 60}, {"K+8", 30}, {"R", 80}, {"R+10", 500}});
    check(run(b8) == "call Lys8 -" && lab(b8, "Arg10") == "not_assessable alias_AL", "rule 4: Lys8 on the b route alone");
    // all four assessed and below 0.2: call none
    check(run(table({{"K", 100}, {"K+8", 1}, {"R", 100}, {"R+10", 7}})) == "call none -", "rule 4: all not detected is none");
    // none present, y gate open, one label short of ends: its reason
    const auto few = table({{"K", 45}, {"K+8", 6}, {"R", 60}});
    check(lab(few, "Lys4") == "not_assessable few_ends" && run(few) == "no_call - few_ends", "rule 4: few_ends no call");
    // Da tolerance: no call, every label not assessable
    D::DigestSettings da = s;
    da.low_resolution = true;
    check(run(k8, da) == "no_call - low_resolution" && lab(k8, "Lys8", da) == "not_assessable low_resolution",
          "rule 4: low_resolution");
  }

  // ---- the rows: order, sections, every field set, no tab or newline
  {
    const auto tc = table({{"K", 100}, {"K+8", 100}, {"R", 100}}, {{"R+10", 50}});
    const auto rows = D::silac2Rows(D::silac2Call(tc, s), tc, s);
    check(rows.size() == 1 + 7 * 5 + 5 + 4 * 7 + 3, "rows: " + std::to_string(rows.size()));
    check(rows.front().section == "route" && rows.front().key == "format" && rows.front().value == "2", "rows: format first");
    std::string keys;
    for (const D::Row& r : rows)
      if (r.section == "silac2" && r.key.find('.') == std::string::npos) keys += r.key + ",";
    check(keys == "status,silac,reason,", "rows: silac2 ends with status, silac, reason (" + keys + ")");
    bool ok = true;
    for (const D::Row& r : rows)
      for (const std::string* f : {&r.section, &r.key, &r.value, &r.n, &r.description})
        if (f->empty() || f->find_first_of("\t\n\r") != std::string::npos) ok = false;
    check(ok, "rows: every field non-empty, without tab or newline");
  }

  if (failures) std::cerr << failures << " failure(s)\n";
  else std::cout << "silac2_test: all checks passed\n";
  return failures ? 1 : 0;
}
