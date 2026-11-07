// FASTag 1.12 #3c-#3f: the v2 model table, detection weights, the timsTOF
// call, the two-residue flank model and the calibrated no-call. All of it is
// opt-in: the first block checks that at the defaults classify() and
// digestRows() are the 1.11 ones bit for bit.
//
// Synthetic tables only (no MEROPS or Atlas data). No value here is fitted:
// the fits come at the DEV regeneration on the release candidate.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "Digest.h"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <iostream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

namespace D = FASTag::Digest;

static int failures = 0;
static void check(bool ok, const std::string& what)
{
  if (!ok) { std::cerr << "FAIL: " << what << "\n"; ++failures; }
}

static std::string background()
{
  std::string t;
  for (const char* end : {"C", "N"})
    for (int i = 0; i < D::kNumAA; ++i)
    {
      char b[16];
      std::snprintf(b, sizeof b, "0.%02d", i + 1);
      t += std::string("background\t-\t") + end + "\t" + D::kAAs[static_cast<std::size_t>(i)] + "\t" + b + "\n";
    }
  return t;
}
static const char* kModels =
    "Trypsin\tTrypsin\tC\tK\t0.5\nTrypsin\tTrypsin\tC\tR\t0.5\nTrypsin\tTrypsin\tN\t*\t-\n"
    "Lys-C\tLys-C\tC\tK\t1\nLys-C\tLys-C\tN\t*\t-\n"
    "Arg-C\tArg-C\tC\tR\t1\nArg-C\tArg-C\tN\t*\t-\n"
    "Lys-N\tLys-N\tC\t*\t-\nLys-N\tLys-N\tN\tK\t1\n"
    "LysargiNase\tLysargiNase\tC\t*\t-\nLysargiNase\tLysargiNase\tN\tK\t0.5\nLysargiNase\tLysargiNase\tN\tR\t0.5\n"
    "unspecific\tunspecific cleavage\tC\t*\t-\nunspecific\tunspecific cleavage\tN\t*\t-\n";

static D::ModelTable parse(const std::string& text, bool want_ok = true, std::string* err_out = nullptr)
{
  D::ModelTable t;
  std::istringstream in(text);
  std::string err;
  const bool ok = D::parseModelTable(in, t, &err);
  if (err_out) *err_out = err;
  check(ok == want_ok, std::string("table parses ") + (want_ok ? "" : "not ") + "as expected: " + err);
  return t;
}
static std::string v1Text() { return "# synthetic v1\nmodel\tclass\tend\tresidue\tfreq\n" + background() + kModels; }
/// A v2 table: detection weights for all three classes (orbitrap_hcd R 0.4,
/// timstof K 1.5), a reference and a specificity.
static std::string v2Text(const std::string& extra = "", bool all_classes = true)
{
  std::string t = "# fastag_digest_models v2\n# synthetic\nmodel\tclass\tend\tresidue\tfreq\n" + background() + kModels;
  t += "detection\torbitrap_hcd\tC\tR\t0.4\n";
  if (all_classes) t += "detection\ttimstof\tC\tK\t1.5\ndetection\tother\tC\tK\t1\n";
  t += "reference\t-\tC\tK\t0.55\nreference\t-\tC\tR\t0.45\n";
  t += "specificity\ttrypsin\t-\t-\t0.05\nspecificity\tnontryptic\t-\t-\t0.05\n";
  return t + extra;
}
static std::array<std::uint64_t, D::kNumAA> counts(const std::map<char, std::uint64_t>& m)
{
  std::array<std::uint64_t, D::kNumAA> a{};
  for (const auto& [c, v] : m) a[static_cast<std::size_t>(D::aaIndex(c))] = v;
  return a;
}
/// Counts drawn as n * norm(e * ((1 - s) p + s bg)), rounded: what a model
/// with detection weights e would show.
static std::array<std::uint64_t, D::kNumAA> generate(const D::ModelTable& t, const std::string& model, const D::Dist* e,
                                                     double s, double n, bool cend = true)
{
  const D::Model* m = nullptr;
  for (const D::Model& x : t.models)
    if (x.name == model) m = &x;
  std::array<double, D::kNumAA> q{};
  double z = 0;
  for (int a = 0; a < D::kNumAA; ++a)
  {
    const D::Dist& p = cend ? (m->c_bg ? t.bg_c : m->c) : (m->n_bg ? t.bg_n : m->n);
    const D::Dist& bg = cend ? t.bg_c : t.bg_n;
    double zp = 0, zb = 0;
    for (int b = 0; b < D::kNumAA; ++b) { zp += p[b]; zb += bg[b]; }
    q[a] = (e ? (*e)[a] : 1.0) * ((1 - s) * p[a] / zp + s * bg[a] / zb);
    z += q[a];
  }
  std::array<std::uint64_t, D::kNumAA> c{};
  for (int a = 0; a < D::kNumAA; ++a) c[a] = static_cast<std::uint64_t>(std::llround(n * q[a] / z));
  return c;
}
static std::string top(const D::Classification& c)
{
  return c.scored && c.top >= 0 ? c.scores[static_cast<std::size_t>(c.top)].name : "<unscored>";
}
static std::string value(const std::vector<D::Row>& rows, const std::string& section, const std::string& key)
{
  for (const D::Row& r : rows)
    if (r.section == section && r.key == key) return r.value;
  return "<missing " + section + " " + key + ">";
}
static bool has(const std::vector<D::Row>& rows, const std::string& section, const std::string& key)
{
  for (const D::Row& r : rows)
    if (r.section == section && r.key == key) return true;
  return false;
}
static bool sameRows(const std::vector<D::Row>& a, const std::vector<D::Row>& b)
{
  if (a.size() != b.size()) return false;
  for (std::size_t i = 0; i < a.size(); ++i)
    if (a[i].section != b[i].section || a[i].key != b[i].key || a[i].value != b[i].value || a[i].n != b[i].n ||
        a[i].description != b[i].description)
      return false;
  return true;
}
static bool sameClassification(const D::Classification& a, const D::Classification& b)
{
  if (a.scored != b.scored || a.uses_nterm != b.uses_nterm || a.top != b.top || a.runner_up != b.runner_up ||
      a.n_c != b.n_c || a.n_n != b.n_n || a.nonfinite != b.nonfinite || a.tied != b.tied ||
      a.scores.size() != b.scores.size())
    return false;
  if (std::memcmp(&a.margin, &b.margin, sizeof(double)) != 0) return false;
  for (std::size_t i = 0; i < a.scores.size(); ++i)
    if (a.scores[i].name != b.scores[i].name || std::memcmp(&a.scores[i].loglik, &b.scores[i].loglik, sizeof(double)) != 0)
      return false;
  return true;
}
/// A counter whose C-terminal P1 counts are @p c (each count one y-tag end).
static D::TerminusCounter counterOf(const std::array<std::uint64_t, D::kNumAA>& c, bool flank2 = false)
{
  D::TerminusCounter tc;
  if (flank2) tc.enableFlank2();
  const auto& keys = D::residueKeys();
  for (int a = 0; a < D::kNumAA; ++a)
    for (std::uint64_t i = 0; i < c[a]; ++i) tc.add(500.0, keys[static_cast<std::size_t>(a)].mass, "PEPT");
  return tc;
}

int main()
{
  // ---- defaults: 1.11 bit for bit
  const D::ModelTable v1 = parse(v1Text());
  check(v1.version == 1 && v1.detection.empty() && !v1.has_specificity && !v1.has_reference, "v1 table: no v2 rows");
  {
    const std::vector<std::array<std::uint64_t, D::kNumAA>> sets = {
        counts({{'K', 150}, {'R', 60}, {'L', 9}}), counts({{'R', 400}, {'K', 5}, {'A', 20}}),
        counts({{'K', 40}}), counts({{'D', 300}, {'E', 10}, {'K', 33}})};
    for (const auto& c : sets)
      for (const auto& n : sets)
        check(sameClassification(D::classify(c, n, v1, 0.05, 30), D::classify(c, n, v1, 0.05, 30, D::ClassifyOptions())),
              "classify with default options is the 1.11 classify bit for bit");
    const D::TerminusCounter tc = counterOf(counts({{'K', 150}, {'R', 60}}));
    D::DigestSettings s;
    check(!s.chemV2(), "default settings: v2 off");
    const auto rows = D::digestRows(tc, v1, D::RunMeta(), s);
    for (const char* k : {"models_version", "detection", "flank2", "min_confidence", "calibration", "specificity"})
      check(!has(rows, "run", k), std::string("default settings: no run.") + k + " row");
    for (const char* k : {"p_correct", "flank2_used", "timstof_call"})
      check(!has(rows, "call", k), std::string("default settings: no call.") + k + " row");
    check(!has(rows, "nocall", "low_confidence") && !has(rows, "meta", "instrument_class") && !has(rows, "count", "flank2_n"),
          "default settings: no low_confidence, instrument_class or flank2_n row");
    // a v2 table changes nothing in a v1 reading: reserved names are ordinary models without the marker
    const D::ModelTable plain = parse("model\tclass\tend\tresidue\tfreq\n" + background() +
                                      "detection\tdetection\tC\tK\t1\nTrypsin\tTrypsin\tC\tK\t0.5\nTrypsin\tTrypsin\tC\tR\t0.5\n");
    check(plain.version == 1 && plain.models.size() == 2 && plain.models[0].name == "detection",
          "without the v2 marker 'detection' is an ordinary model, as in 1.11");
    // a flank2-enabled counter keeps every 1.11 count
    const D::TerminusCounter tf = counterOf(counts({{'K', 150}, {'R', 60}}), true);
    check(tf.cterm() == tc.cterm() && tf.tot() == tc.tot() && tf.tags == tc.tags, "flank2 counting leaves the 1.11 counts as they are");
  }

  // ---- the v2 table
  const D::ModelTable v2 = parse(v2Text());
  {
    check(v2.version == 2, "v2 marker read");
    check(v2.detection.size() == 3 && v2.detectionFor("orbitrap_hcd") && v2.detectionFor("timstof") && v2.detectionFor("other"),
          "v2: three detection classes");
    const D::Detection* o = v2.detectionFor("orbitrap_hcd");
    check(o->c[static_cast<std::size_t>(D::aaIndex('R'))] == 0.4 && o->c[static_cast<std::size_t>(D::aaIndex('K'))] == 1.0 &&
              o->n[0] == 1.0,
          "v2: detection weight R 0.4, other residues 1");
    check(v2.has_reference && v2.ref_k == 0.55 && v2.ref_r == 0.45, "v2: reference K:R");
    check(v2.has_specificity && v2.s_trypsin == 0.05 && v2.s_nontryptic == 0.05, "v2: specificity");
    check(v2.models.size() == v1.models.size(), "v2: reserved rows are not models");
    std::string err;
    parse(v2Text("detection\tqtof\tC\tK\t1\n"), false, &err);
    check(err.find("detection class") != std::string::npos, "v2: an unknown detection class is refused (" + err + ")");
    parse(v2Text("detection\tother\tC\tK\t1\n"), false, &err);
    check(err.find("given twice") != std::string::npos, "v2: a repeated detection row is refused");
    parse(v2Text("detection\tother\tC\tR\t-1\n"), false, &err);
    parse("# fastag_digest_models v2\nmodel\tclass\tend\tresidue\tfreq\n" + background() + kModels +
              "specificity\ttrypsin\t-\t-\t0.05\n", false, &err);
    check(err.find("nontryptic") != std::string::npos, "v2: a specificity needs both rows");
    parse(v2Text("specificity\ttrypsin\t-\t-\t0.1\n"), false, &err);
    parse("# fastag_digest_models v2\nmodel\tclass\tend\tresidue\tfreq\n" + background() + kModels +
              "reference\t-\tC\tK\t0.5\n", false, &err);
    check(err.find("reference") != std::string::npos, "v2: a reference needs K and R");
    // the shipped v2 table parses and has every class
#ifdef FASTAG_DIGEST_DATA
    D::ModelTable shipped;
    check(D::loadModelTable(std::string(FASTAG_DIGEST_DATA) + "/digest_models_v2.tsv", shipped, &err),
          "shipped digest_models_v2.tsv parses: " + err);
    check(shipped.version == 2 && shipped.has_bg && shipped.has_specificity, "shipped v2: version 2, background, specificity");
    for (std::string_view c : D::kInstrumentClasses) check(shipped.detectionFor(c) != nullptr, "shipped v2: detection " + std::string(c));
    bool lysarg = false, ambic = false;
    for (const D::Model& m : shipped.models)
    {
      lysarg = lysarg || (m.name == "LysargiNase" && m.c_bg && !m.n_bg);
      ambic = ambic || (m.name == "Asp-N_ambic" && m.cls == "Asp-N" && m.c_bg && !m.n_bg);
    }
    check(lysarg && ambic, "shipped v2: rule-only LysargiNase and Asp-N_ambic rows");
    D::ModelTable shipped_v1;
    check(D::loadModelTable(std::string(FASTAG_DIGEST_DATA) + "/digest_models.tsv", shipped_v1, &err) && shipped_v1.version == 1,
          "shipped digest_models.tsv stays a v1 table");
    D::Calibration cal;
    check(D::loadCalibration(std::string(FASTAG_DIGEST_DATA) + "/digest_calibration.tsv", cal, &err) && cal.loaded,
          "shipped digest_calibration.tsv parses: " + err);
#endif
  }

  // ---- #3c detection: Arg-C with e(R) = 0.4 is Arg-C, an observed R:K 1:1 run stays trypsin
  {
    const D::Detection* o = v2.detectionFor("orbitrap_hcd");
    D::ClassifyOptions opt;
    opt.detection = o;
    const auto argc = generate(v2, "Arg-C", &o->c, 0.05, 2000);
    check(top(D::classify(argc, {}, v2, 0.05, 100, opt)) == "Arg-C", "detection: an Arg-C run with e(R) 0.4 is called Arg-C");
    const auto kr = counts({{'K', 500}, {'R', 500}, {'L', 20}, {'A', 20}});
    check(top(D::classify(kr, {}, v2, 0.05, 100, opt)) == "Trypsin", "detection: an observed R:K 1:1 run stays trypsin");
    const auto tryp = generate(v2, "Trypsin", &o->c, 0.05, 2000);
    check(top(D::classify(tryp, {}, v2, 0.05, 100, opt)) == "Trypsin", "detection: a trypsin run with e(R) 0.4 stays trypsin");
    // the weights change the scores (they are applied), unlike the default options
    const D::Classification a = D::classify(argc, {}, v2, 0.05, 100, opt), b = D::classify(argc, {}, v2, 0.05, 100);
    check(a.scores[0].loglik != b.scores[0].loglik, "detection: the weights change the log-likelihoods");
    // e = 1 everywhere is the 1.11 classifier's result
    const D::Detection* other = v2.detectionFor("other");
    D::ClassifyOptions neutral;
    neutral.detection = other;
    const D::Classification n1 = D::classify(tryp, {}, v2, 0.05, 100, neutral), n0 = D::classify(tryp, {}, v2, 0.05, 100);
    check(top(n1) == top(n0) && std::fabs(n1.margin - n0.margin) < 1e-12, "detection: unit weights give the 1.11 call and margin");
    // specificity: s per class replaces the global share
    D::ClassifyOptions sp;
    sp.specificity = true;
    sp.s_trypsin = 0.05;
    sp.s_nontryptic = 0.4;
    const D::Classification s1 = D::classify(argc, {}, v2, 0.05, 100, sp);
    check(s1.scores[0].loglik == D::classify(argc, {}, v2, 0.05, 100).scores[0].loglik &&
              s1.scores[2].loglik != D::classify(argc, {}, v2, 0.05, 100).scores[2].loglik,
          "specificity: Trypsin keeps s_trypsin, Arg-C takes s_nontryptic");
  }

  // ---- #3e LysargiNase (rule-only, N-end K/R) against Lys-N (N-end K)
  {
    const auto bgc = generate(v2, "unspecific", nullptr, 0.05, 1000);
    const auto nkr = generate(v2, "LysargiNase", nullptr, 0.05, 1000, false);
    check(top(D::classify(bgc, nkr, v2, 0.05, 100)) == "LysargiNase", "LysargiNase wins on N-end K/R");
    const auto nk = generate(v2, "Lys-N", nullptr, 0.05, 1000, false);
    check(nk[static_cast<std::size_t>(D::aaIndex('R'))] < 10, "Lys-N sample: R near 0");
    const D::Classification c = D::classify(bgc, nk, v2, 0.05, 100);
    check(top(c) == "Lys-N", "with R = 0 at the N end, Lys-N and not LysargiNase is called");
  }

  // ---- #3d flank2
  {
    const D::Flank2Bins bins = D::flank2Bins(0.008);
    std::size_t pairs = 0;
    for (const auto& b : bins.pairs) pairs += b.size();
    check(pairs == 361, "flank2: every ordered pair in exactly one bin");
    const auto& keys = D::residueKeys();
    const double G = keys[0].mass, A = keys[1].mass, N = keys[8].mass, Q = keys[10].mass;
    const int gg = bins.find(G + G), ag = bins.find(A + G);
    check(gg >= 0 && bins.find(N) == gg, "flank2: GG and N share a bin");
    check(ag >= 0 && bins.find(Q) == ag, "flank2: AG and Q share a bin");
    int n_ag = 0, n_gg = 0;
    for (const auto& [x, y] : bins.pairs[static_cast<std::size_t>(ag)])
      n_ag += (x == 1 && y == 0) + (x == 0 && y == 1);
    for (const auto& [x, y] : bins.pairs[static_cast<std::size_t>(gg)]) n_gg += (x == 0 && y == 0);
    check(n_ag == 2 && n_gg == 1, "flank2: AG and GA both in the AG bin, GG once");
    check(bins.find(1000.0) == -1 && bins.find(0.0) == -1, "flank2: a mass far from every pair sum has no bin");
    // a flank at the GG/N mass is counted once in the histogram
    D::TerminusCounter tc;
    tc.enableFlank2();
    tc.add(500.0, G + G, "PEPT");
    std::uint64_t total = 0;
    for (std::uint64_t v : tc.dip) total += v;
    check(total == 1 && tc.dip[static_cast<std::size_t>(gg)] == 1, "flank2: a GG/N flank counts once");
    // reversed b tag: N-terminal flank less H2O
    tc.add(A + G + D::kH2O, 900.0, "PEPT");
    check(tc.dip[static_cast<std::size_t>(ag)] == 1, "flank2: a reversed b tag counts its N-terminal flank less H2O");
    // merge
    D::TerminusCounter m;
    m.merge(tc);
    m.merge(tc);
    check(m.flank2() && m.dip[static_cast<std::size_t>(gg)] == 2, "flank2: merge adds the histograms");

    // classify2 recovers trypsin with zero P1 counts: a sample from trypsin's dipeptide prediction
    std::vector<std::uint64_t> dip(bins.pairs.size(), 0);
    {
      const D::Model* t = &v2.models[0];
      std::vector<double> pred(bins.pairs.size(), 0.0);
      double z = 0;
      double zp = 0, zb = 0;
      for (int a = 0; a < D::kNumAA; ++a) { zp += t->c[a]; zb += v2.bg_c[a]; }
      for (std::size_t k = 0; k < bins.pairs.size(); ++k)
      {
        for (const auto& [x, y] : bins.pairs[k])
          pred[k] += v2.bg_c[static_cast<std::size_t>(x)] * (0.95 * t->c[static_cast<std::size_t>(y)] / zp + 0.05 * v2.bg_c[static_cast<std::size_t>(y)] / zb);
        z += pred[k];
      }
      for (std::size_t k = 0; k < pred.size(); ++k) dip[k] = static_cast<std::uint64_t>(std::llround(3000 * pred[k] / z));
    }
    const std::array<std::uint64_t, D::kNumAA> zero{};
    check(!D::classify(zero, zero, v2, 0.05, 100).scored, "flank2: zero P1 counts are not scored by classify");
    const D::Classification c2 = D::classify2(dip, bins, v2, 0.05, 100);
    check(c2.scored && top(c2) == "Trypsin", "flank2: classify2 recovers trypsin with zero P1 counts (" + top(c2) + ")");
    check(!D::classify2(std::vector<std::uint64_t>(bins.pairs.size(), 0), bins, v2, 0.05, 100).scored,
          "flank2: an empty histogram is not scored");

    // digestRows: y1 cut off (first peak above 147.21) is called through flank2 when enabled
    D::TerminusCounter run;
    run.enableFlank2();
    for (std::size_t k = 0; k < dip.size(); ++k)
      for (std::uint64_t i = 0; i < dip[k]; ++i) run.add(500.0, bins.lo[k], "PEPT");
    D::RunMeta meta;
    meta.first_peak = {300.0, 310.0};
    D::DigestSettings s;
    const auto off = D::digestRows(run, v2, meta, s);
    check(value(off, "call", "reason") == "ms2_first_peak", "flank2 off: ms2_first_peak withholds the call");
    s.flank2 = true;
    const auto on = D::digestRows(run, v2, meta, s);
    check(value(on, "call", "status") == "call" && value(on, "call", "model") == "Trypsin" &&
              value(on, "call", "flank2_used") == "yes",
          "flank2 auto: the first-peak run is called Trypsin from the flank sums");
    check(value(on, "run", "flank2") == "auto" && has(on, "count", "flank2_n") && has(on, "model", "Trypsin.flank2_loglik"),
          "flank2 auto: run, count and model rows");
  }

  // ---- the timsTOF call (#3c): withheld without detection, called with it
  {
    const D::TerminusCounter tc = counterOf(generate(v2, "Trypsin", &v2.detectionFor("timstof")->c, 0.05, 1500));
    D::RunMeta meta;
    meta.instrument_name = "timsTOF Pro";
    check(D::instrumentClass(meta) == "timstof", "instrument class: timsTOF");
    D::DigestSettings s;
    check(value(D::digestRows(tc, v2, meta, s), "call", "reason") == "timstof", "timsTOF: withheld at the defaults");
    s.detection = true;
    const auto rows = D::digestRows(tc, v2, meta, s);
    check(value(rows, "call", "status") == "call" && value(rows, "call", "model") == "Trypsin" &&
              value(rows, "call", "timstof_call") == "yes" && value(rows, "nocall", "timstof") == "yes",
          "timsTOF: called with -digest_detection shipped, the nocall fact still yes");
    check(value(rows, "meta", "instrument_class") == "timstof" && value(rows, "run", "detection") == "shipped",
          "timsTOF: meta.instrument_class and run.detection rows");
    D::RunMeta orbi;
    orbi.instrument_model = "Orbitrap Exploris 480";
    check(D::instrumentClass(orbi) == "orbitrap_hcd", "instrument class: Orbitrap");
    check(D::instrumentClass(D::RunMeta()) == "other", "instrument class: nothing known is other");
  }

  // ---- #3f calibration and the low_confidence no-call
  {
    std::string err;
    D::Calibration cal;
    std::istringstream in("# synthetic\nfeature\tcoef\nintercept\t-2\nmargin\t3\nlog_n\t0.5\nfirst_peak\t-1\n");
    check(D::parseCalibration(in, cal, &err) && cal.loaded, "calibration parses: " + err);
    std::istringstream bad("feature\tcoef\nintercept\t-2\nmargin\t3\n");
    D::Calibration c2;
    check(!D::parseCalibration(bad, c2, &err) && err.find("four") != std::string::npos, "calibration: all four features needed");
    std::istringstream dup("feature\tcoef\nintercept\t1\nintercept\t1\nmargin\t3\nlog_n\t0\nfirst_peak\t0\n");
    check(!D::parseCalibration(dup, c2, &err), "calibration: a repeated feature is refused");
    std::istringstream unk("feature\tcoef\nslope\t1\n");
    check(!D::parseCalibration(unk, c2, &err), "calibration: an unknown feature is refused");
    double prev = -1;
    bool mono = true;
    for (double m = 0; m <= 1.0; m += 0.05)
    {
      const double p = D::pCorrect(cal, m, 200, false);
      mono = mono && p > prev && p > 0 && p < 1;
      prev = p;
    }
    check(mono, "pCorrect is monotone in the margin");
    check(D::pCorrect(cal, 0.3, 1000, false) > D::pCorrect(cal, 0.3, 100, false), "pCorrect grows with n");
    check(D::pCorrect(cal, 0.3, 100, true) < D::pCorrect(cal, 0.3, 100, false), "pCorrect: the first-peak flag lowers it");
    check(std::fabs(D::pCorrect(cal, 0.0, 1, false) - 1.0 / (1.0 + std::exp(2.0))) < 1e-15, "pCorrect formula");

    const D::TerminusCounter tc = counterOf(counts({{'K', 150}, {'R', 60}, {'L', 10}}));
    D::DigestSettings s;
    s.calibration = cal;
    s.calibration_source = "synthetic.tsv";
    const auto rows = D::digestRows(tc, v1, D::RunMeta(), s);
    const double p = std::stod(value(rows, "call", "p_correct"));
    check(value(rows, "call", "status") == "call" && p > 0 && p < 1, "calibration: p_correct written with the call");
    check(value(rows, "nocall", "low_confidence") == "no", "calibration: low_confidence no at threshold 0");
    s.min_confidence = std::nextafter(p, 2.0);
    const auto low = D::digestRows(tc, v1, D::RunMeta(), s);
    check(value(low, "call", "status") == "no_call" && value(low, "call", "reason") == "low_confidence" &&
              value(low, "nocall", "low_confidence") == "yes" && has(low, "call", "p_correct"),
          "calibration: below -digest_min_confidence the call is no_call low_confidence");
    s.min_confidence = p;
    check(value(D::digestRows(tc, v1, D::RunMeta(), s), "call", "status") == "call", "calibration: at the threshold it is a call");
  }

  if (failures) std::cerr << failures << " failure(s)\n";
  else std::cout << "digest_v2_test: all checks passed\n";
  return failures ? 1 : 0;
}
