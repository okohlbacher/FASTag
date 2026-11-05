// Checks the digest, label and mass-gap reports against prose-auto 0.1.3.
//
// The expected values (hex floats) are what 0.1.3's own functions return on
// the same inputs: external.fastag_termini / protease_call with this file's
// synthetic model table in place of _tag_models(), and delta_combos.explain /
// detect, run under CPython 3.15. The model table is synthetic: FASTag's
// tests carry no MEROPS or MHC Motif Atlas data.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "Digest.h"

#include <OpenMS/CHEMISTRY/ModificationsDB.h>
#include <OpenMS/CHEMISTRY/ResidueModification.h>

#include <cmath>
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
static std::string hex(double v)
{
  char b[64];
  std::snprintf(b, sizeof b, "%a", v);
  return b;
}
static void same(double got, double want, const std::string& what)
{
  check(got == want, what + ": got " + hex(got) + ", want " + hex(want));
}

// background 0.01 .. 0.19 over GASPVTCLNDQKEMHFRYW at both ends
static std::string syntheticTable()
{
  std::string t = "# synthetic test models\nmodel\tclass\tend\tresidue\tfreq\n";
  for (const char* end : {"C", "N"})
    for (int i = 0; i < D::kNumAA; ++i)
    {
      char b[16];
      std::snprintf(b, sizeof b, "0.%02d", i + 1);
      t += std::string("background\t-\t") + end + "\t" + D::kAAs[static_cast<std::size_t>(i)] + "\t" + b + "\n";
    }
  t += "Trypsin\tTrypsin\tC\tK\t0.5\nTrypsin\tTrypsin\tC\tR\t0.5\nTrypsin\tTrypsin\tN\t*\t-\n"
       "Lys-C\tLys-C\tC\tK\t1\n"
       "AnchorL\tunspecific cleavage\tC\tL\t0.4\nAnchorL\tunspecific cleavage\tC\tV\t0.2\n"
       "AnchorL\tunspecific cleavage\tC\tF\t0.2\nAnchorL\tunspecific cleavage\tC\tY\t0.1\n"
       "AnchorL\tunspecific cleavage\tC\tM\t0.1\n"
       "unspecific\tunspecific cleavage\tC\t*\t-\nunspecific\tunspecific cleavage\tN\t*\t-\n"
       "Asp-N\tAsp-N\tC\t*\t-\nAsp-N\tAsp-N\tN\tD\t1\n"
       "Twin\tLys-C\tC\tK\t1\n";
  return t;
}

static D::ModelTable table()
{
  D::ModelTable t;
  std::istringstream in(syntheticTable());
  std::string err;
  check(D::parseModelTable(in, t, &err), "synthetic table parses: " + err);
  return t;
}

struct TagRow
{
  double nterm, cterm;
  const char* seq;
  bool gapped;
  double evalue;
};
static D::TerminusCounter count(const std::vector<std::pair<TagRow, int>>& rows)
{
  D::TerminusCounter tc;
  for (const auto& [r, times] : rows)
    for (int i = 0; i < times; ++i)
      if (!r.gapped && r.evalue <= 1.0) tc.add(r.nterm, r.cterm, r.seq);
  return tc;
}
static std::array<std::uint64_t, D::kNumAA> counts(std::map<char, std::uint64_t> m)
{
  std::array<std::uint64_t, D::kNumAA> a{};
  for (const auto& [c, v] : m) a[static_cast<std::size_t>(D::aaIndex(c))] = v;
  return a;
}
static std::map<char, std::uint64_t> bgc_all()
{
  std::map<char, std::uint64_t> m;
  for (int i = 0; i < D::kNumAA; ++i) m[D::kAAs[static_cast<std::size_t>(i)]] = 1;
  return m;
}
static std::string value(const std::vector<D::Row>& rows, const std::string& section, const std::string& key)
{
  for (const D::Row& r : rows)
    if (r.section == section && r.key == key) return r.value;
  return "<missing " + section + " " + key + ">";
}

int main()
{
  // ---- Python's sum(): Neumaier since 3.12
  {
    D::PySum s;
    for (int i = 0; i < 10; ++i) s.add(0.1);
    same(s.value(), 1.0, "sum([0.1] * 10)");
    D::PySum t;
    for (double x : {1e16, 1.0, -1e16}) t.add(x);
    same(t.value(), 1.0, "sum([1e16, 1.0, -1e16])");
    check(D::PySum().value() == 0.0, "empty sum");
  }

  // ---- the residue window is inclusive at both ends, as bisect counts it
  {
    const double K = 128.09496, w = 0.008;
    D::TerminusCounter tc(w);
    tc.add(0.0, K + w, "PEPT");
    tc.add(0.0, K - w, "PEPT");
    tc.add(0.0, std::nextafter(K + w, 1e9), "PEPT");
    check(tc.c_near[11] == 2, "K window inclusive, one ulp beyond excluded");
  }

  // ---- 0.1.3 test_fastag_termini_tryptic_tmt (synthetic models)
  const double K = 128.09496, R = 156.10111, TMT = 229.162932, L = 113.08406, H2O = 18.010565;
  {
    const D::TerminusCounter tc = count({{{TMT + 300.1, K + TMT, "PEPT", false, 0.01}, 150},
                                         {{R + H2O, 412.2, "AGSW", false, 0.01}, 60},
                                         {{TMT, 500.3, "PEPT", false, 0.01}, 40},
                                         {{300.0, K, "PEPT", true, 0.01}, 30},     // gapped
                                         {{300.0, K, "PEPT", false, 1.5}, 30}});   // E > 1
    check(tc.tags == 250, "tryptic: 250 filtered tags");
    check(tc.tot() == 210, "tryptic: tot 210");
    check(tc.cterm() == counts({{'K', 150}, {'R', 60}}), "tryptic: merged C-terminal K 150, R 60");
    check(tc.res(19) == 150 && tc.res(11) == 0 && tc.res(16) == 60, "tryptic: unmerged K+TMT 150, K 0, R 60");
    check(tc.lab_n[0] == 40 && tc.lab_c[0] == 0 && tc.lab_bg_n[0] == 0, "tryptic: 40 N-terminal TMT gaps, no background");
    // y tags give P2..P4 from their end (T, P, E of PEPT), reversed b tags from their start (A, G, S of AGSW)
    check(tc.cpos[1][static_cast<std::size_t>(D::aaIndex('T'))] == 150 && tc.cpos[1][static_cast<std::size_t>(D::aaIndex('A'))] == 60,
          "tryptic: P2 is T for y tags and A for reversed b tags");
    check(tc.cpos[3][static_cast<std::size_t>(D::aaIndex('E'))] == 150 && tc.cpos[3][static_cast<std::size_t>(D::aaIndex('S'))] == 60,
          "tryptic: P4 is E (PEPT read backwards) and S (AGSW forwards)");
    const D::Classification c = D::classify(tc.cterm(), tc.nterm(), table(), 0.05, 100);
    check(c.scored && !c.uses_nterm, "tryptic: scored on the C end only");
    check(c.scores[static_cast<std::size_t>(c.top)].name == "Trypsin" &&
              c.scores[static_cast<std::size_t>(c.runner_up)].name == "Lys-C",
          "tryptic: Trypsin, runner-up Lys-C");
    same(c.margin, 0x1.53eec403ab7a7p-1, "tryptic: margin");

    D::DigestSettings s;
    const auto rows = D::labelRows(tc, s);
    check(value(rows, "nlabel", "TMT.count") == "40" && value(rows, "nlabel", "TMT.share") == D::num(40.0 / 250.0),
          "tryptic: TMT label rows");
    const auto drows = D::digestRows(tc, table(), D::RunMeta(), s);
    check(value(drows, "share", "kr") == "1", "tryptic: kr 1");
    check(value(drows, "residue", "C.K+TMT") == "150" && value(drows, "count", "n_c") == "210", "tryptic: residue rows");
    check(value(drows, "call", "status") == "call" && value(drows, "call", "model") == "Trypsin", "tryptic: call row");
    check(value(drows, "nocall", "timstof") == "unknown" && value(drows, "nocall", "ms2_scan_window") == "unknown" &&
              value(drows, "nocall", "ion_counts") == "unknown",
          "metadata absent reads unknown and still calls");
  }

  // ---- 0.1.3 test_fastag_termini_hla, plus N-terminal D
  {
    const D::TerminusCounter tc = count({{{300.1, L, "PEPT", false, 0.01}, 160},
                                         {{250.2, K, "PEPT", false, 0.01}, 60},
                                         {{115.02694, 333.3, "GGGG", false, 0.5}, 120}});
    check(tc.tags == 340 && tc.tot() == 220, "anchor: 340 tags, tot 220");
    check(tc.nterm() == counts({{'D', 120}}), "anchor: 120 N-terminal D");
    const D::Classification c = D::classify(tc.cterm(), tc.nterm(), table(), 0.05, 100);
    check(c.uses_nterm, "anchor: N end used with 120 >= 100");
    check(c.scores[static_cast<std::size_t>(c.top)].name == "Asp-N" &&
              c.scores[static_cast<std::size_t>(c.runner_up)].name == "AnchorL",
          "anchor: Asp-N, runner-up AnchorL");
    same(c.margin, 0x1.a4f1b6ea16fd6p-2, "anchor: margin");
    const auto drows = D::digestRows(tc, table(), D::RunMeta(), D::DigestSettings());
    check(value(drows, "share", "kr") == D::num(0x1.1745d1745d174p-2), "anchor: kr");
    check(value(drows, "share", "anchors_LVFYM") == D::num(0x1.745d1745d1746p-1), "anchor: anchors");
    check(value(drows, "share", "nterm_D") == "1", "anchor: nterm_D");
  }

  // ---- protease_call on fixed counts: every model's log-likelihood
  {
    const auto cterm = counts({{'K', 150}, {'R', 60}, {'L', 20}, {'G', 7}, {'W', 3}});
    const auto nterm = counts({{'D', 120}, {'A', 5}, {'K', 9}});
    const D::Classification c = D::classify(cterm, nterm, table(), 0.05, 100);
    const std::map<std::string, double> want = {
        {"Trypsin", -0x1.7341fd19331f8p+9}, {"Lys-C", -0x1.b8f8744bf3ca2p+9}, {"AnchorL", -0x1.83d3724efa253p+10},
        {"unspecific", -0x1.0ac6240c4994cp+10}, {"Asp-N", -0x1.7b120fbdc1fdbp+9}, {"Twin", -0x1.b8f8744bf3ca2p+9}};
    for (const auto& m : c.scores) same(m.loglik, want.at(m.name), "loglik " + m.name);
    check(c.scores[static_cast<std::size_t>(c.top)].name == "Trypsin" &&
              c.scores[static_cast<std::size_t>(c.runner_up)].name == "Asp-N",
          "fixed counts: Trypsin, runner-up Asp-N");
    same(c.margin, 0x1.564229d979878p-5, "fixed counts: margin");
  }

  // ---- ties go to the model listed first; the runner-up is of another class
  {
    const D::Classification c = D::classify(counts({{'K', 200}}), counts({}), table(), 0.05, 100);
    check(c.scores[static_cast<std::size_t>(c.top)].name == "Lys-C", "tie: Lys-C before Twin");
    check(c.scores[static_cast<std::size_t>(c.runner_up)].name == "Trypsin", "tie: runner-up skips Twin (same class)");
    same(c.margin, 0x1.5fb0215ec2873p-1, "tie: margin");
  }

  // ---- no-call rules, in order, written as no_call with a reason
  {
    const D::TerminusCounter tc = count({{{300.1, K, "PEPT", false, 0.01}, 150}});
    D::RunMeta meta;
    meta.instrument_model = "Q Exactive HF";
    meta.scan_low = {100.0, 120.0, 150.0};
    D::DigestSettings s;
    auto reason = [&](const D::RunMeta& m, const D::DigestSettings& ds) {
      const auto rows = D::digestRows(tc, table(), m, ds);
      return value(rows, "call", "status") + " " + value(rows, "call", "reason");
    };
    check(reason(meta, s).rfind("call ", 0) == 0, "Orbitrap metadata: call");
    D::RunMeta tims = meta;
    tims.instrument_model = "timsTOF Pro 2";
    check(reason(tims, s) == "no_call timstof", "timsTOF instrument");
    D::RunMeta tdf = meta;
    tdf.instrument_model.clear();
    tdf.native_id_type = "MS:1002818";
    check(reason(tdf, s) == "no_call timstof", "Bruker TDF native ID");
    D::RunMeta k0 = meta;
    k0.im_vssc = 3;
    check(reason(k0, s) == "no_call timstof", "1/K0 ion mobility");
    D::RunMeta faims = meta;
    faims.im_faims = 3;
    check(reason(faims, s).rfind("call ", 0) == 0, "FAIMS is not timsTOF");
    D::RunMeta window = meta;
    window.scan_low = {150.0, 156.0, 156.0};
    check(reason(window, s) == "no_call ms2_scan_window", "scan window above y1(K) + 0.1");
    window.scan_low = {147.2128 - 1e-9};
    check(reason(window, s).rfind("call ", 0) == 0, "scan window just below 147.2128");
    D::RunMeta peak = meta;
    peak.first_peak = {150.0, 151.0, 147.0};
    check(reason(peak, s) == "no_call ms2_first_peak", "median first MS2 peak above y1(K) + 0.1");
    peak.first_peak = {147.2128 - 1e-9};
    check(reason(peak, s).rfind("call ", 0) == 0, "median first MS2 peak just below 147.2128");
    peak.scan_low.clear();
    peak.first_peak = {160.0};
    check(reason(peak, s) == "no_call ms2_first_peak", "first-peak rule without scan windows");
    // ion_counts: only without instrument and native-ID metadata (MGF, converted pseudo-spectra)
    D::RunMeta bare;
    bare.peaks = 1000;
    bare.peaks_whole = 500;
    check(reason(bare, s) == "no_call ion_counts", "no metadata, half the intensities whole: ion counts");
    bare.peaks_whole = 499;
    check(reason(bare, s).rfind("call ", 0) == 0, "no metadata, under half whole: call");
    check(value(D::digestRows(tc, table(), bare, s), "meta", "ms2_whole_intensity_share") == D::num(0.499),
          "whole-intensity share row");
    D::RunMeta counted = meta;
    counted.peaks = counted.peaks_whole = 1000;
    check(reason(counted, s).rfind("call ", 0) == 0, "instrument named: whole intensities do not withhold");
    check(value(D::digestRows(tc, table(), counted, s), "nocall", "ion_counts") == "no", "instrument named: ion_counts no");
    check(value(D::digestRows(tc, table(), D::RunMeta(), s), "nocall", "ion_counts") == "unknown", "no peaks: ion_counts unknown");
    D::RunMeta tdf_counts = tdf;
    tdf_counts.peaks = tdf_counts.peaks_whole = 10;
    check(reason(tdf_counts, s) == "no_call timstof", "native ID format named: the timstof rule decides");
    D::RunMeta generic = bare;
    generic.peaks_whole = 1000;
    generic.native_id_type = "MS:1000777";
    check(reason(generic, s) == "no_call ion_counts", "generic native ID format MS:1000777: ion_counts still fires");
    check(value(D::digestRows(tc, table(), generic, s), "nocall", "timstof") == "unknown", "generic native ID format: timstof unknown");
    for (const char* acc : {"MS:1000774", "MS:1000775", "MS:1000776", "MS:1000824"})
    {
      generic.native_id_type = acc;
      check(reason(generic, s) == "no_call ion_counts", std::string("generic native ID format ") + acc + ": ion_counts still fires");
    }
    D::RunMeta thermo = bare;
    thermo.peaks_whole = 1000;
    thermo.native_id_type = "MS:1000768";
    check(reason(thermo, s).rfind("call ", 0) == 0, "vendor native ID format MS:1000768: the timstof rule decides");
    D::RunMeta bare_peak = bare;
    bare_peak.peaks_whole = 1000;
    bare_peak.first_peak = {160.0};
    check(reason(bare_peak, s) == "no_call ms2_first_peak", "ms2_first_peak comes before ion_counts");
    D::DigestSettings lowres = s;
    lowres.low_resolution = true;
    check(reason(tims, lowres) == "no_call low_resolution", "low resolution comes first");
    check(value(D::labelRows(tc, lowres), "run", "low_resolution") == "yes" &&
              value(D::labelRows(tc, s), "run", "low_resolution") == "no",
          "label report marks a Da run");
    D::DigestSettings strict = s;
    strict.tag_min = 151;
    check(reason(meta, strict) == "no_call few_tags", "150 tags below 151");
    const auto rows = D::digestRows(tc, table(), tims, lowres);
    check(value(rows, "nocall", "low_resolution") == "yes" && value(rows, "nocall", "timstof") == "yes" &&
              value(rows, "nocall", "few_tags") == "no",
          "nocall lists every rule");
    for (const auto& r : rows) check(!(r.section == "call" && r.key == "margin"), "no margin row on a no call");
  }

  // ---- an exact tie with another class is no call, never a call with margin 0
  {
    // C ends shaped as the background, 50 N ends (< 100): unspecific and
    // Asp-N both score the background at both ends.
    std::map<char, std::uint64_t> bgc;
    for (int i = 0; i < D::kNumAA; ++i) bgc[D::kAAs[static_cast<std::size_t>(i)]] = 4 * static_cast<std::uint64_t>(i + 1);
    const D::Classification c = D::classify(counts(bgc), counts({{'D', 50}}), table(), 0.05, 100);
    check(c.tied == std::vector<std::string>{"unspecific", "Asp-N"}, "tie: unspecific and Asp-N tie");
    D::TerminusCounter none;
    const auto rows = D::digestRows(none, table(), D::RunMeta(), D::DigestSettings());
    check(value(rows, "nocall", "tie") == "no", "tie: not on an unscored run");
  }

  // ---- a residue at probability 0 is no call, not a margin of inf or nan
  {
    std::string t = "model\tclass\tend\tresidue\tfreq\n";
    for (const char* end : {"C", "N"})
      for (int i = 0; i < D::kNumAA; ++i)
        t += std::string("background\t-\t") + end + "\t" + D::kAAs[static_cast<std::size_t>(i)] + "\t" +
             (D::kAAs[static_cast<std::size_t>(i)] == 'W' ? "0" : "0.05") + "\n";
    t += "Trypsin\tTrypsin\tC\tK\t0.5\nTrypsin\tTrypsin\tC\tR\t0.5\n"
         "Chymotrypsin\tChymotrypsin\tC\tF\t0.25\nChymotrypsin\tChymotrypsin\tC\tY\t0.25\n"
         "Chymotrypsin\tChymotrypsin\tC\tW\t0.25\nChymotrypsin\tChymotrypsin\tC\tL\t0.25\n";
    D::ModelTable nw;
    std::istringstream in(t);
    std::string err;
    check(D::parseModelTable(in, nw, &err), "no-W table parses: " + err);
    const D::Classification c = D::classify(counts({{'K', 150}, {'R', 120}, {'W', 1}}), counts({}), nw, 0.05, 100);
    check(c.nonfinite && c.scores[static_cast<std::size_t>(c.top)].name == "Chymotrypsin",
          "no W in the background: Trypsin scores -inf, flagged");
    D::TerminusCounter tc;
    for (int i = 0; i < 150; ++i) tc.add(300.1, K, "PEPT");
    for (int i = 0; i < 120; ++i) tc.add(300.1, R, "PEPT");
    tc.add(300.1, 186.07931, "PEPT");  // W
    const auto rows = D::digestRows(tc, nw, D::RunMeta(), D::DigestSettings());
    check(value(rows, "call", "status") == "no_call" && value(rows, "call", "reason") == "nonfinite_score",
          "no W in the background: no_call nonfinite_score");
    bool added = false;
    const D::Dist p = D::composition(counts({{'A', 3}}), true, &added);
    check(added, "pseudocount added when a residue is absent");
    same(p[static_cast<std::size_t>(D::aaIndex('A'))], 4.0 / 22.0, "pseudocount: A (3 + 1) of 22");
    same(p[static_cast<std::size_t>(D::aaIndex('W'))], 1.0 / 22.0, "pseudocount: W 1 of 22");
    D::composition(counts(bgc_all()), true, &added);
    check(!added, "no pseudocount when every residue is present");
  }

  // ---- the model table: format and refusals
  {
    auto refused = [](const std::string& body, const std::string& what) {
      D::ModelTable t;
      std::istringstream in(body);
      std::string err;
      check(!D::parseModelTable(in, t, &err) && !err.empty(), "refused: " + what);
    };
    const std::string head = "model\tclass\tend\tresidue\tfreq\n";
    refused(head + "background\t-\tC\tG\t1\nX\tX\tC\tK\t1\n", "background missing residues");
    refused(head + "X\tA\tC\tK\t1\nX\tB\tC\tR\t1\n", "model with two classes");
    refused(head + "X\tA\tC\tK\t1\nX\tA\tC\t*\t-\n", "'*' and rows for one end");
    refused(head + "X\tA\tC\tI\t1\n", "residue I");
    refused(head + "X\tA\tC\tK\tx\n", "bad freq");
    refused("model\tclass\tend\tresidue\n", "wrong columns");
    refused(head + "X\tA\tC\tK\t0.5\nX\tA\tC\tK\t0.9\n", "a model residue row given twice");
    refused(head + "X\tA\tC\tK\t0\nX\tA\tC\tR\t0\n", "a model end with no mass");
    D::ModelTable t;
    std::istringstream in(head + "X\tA\tC\tK\t1\r\n");
    check(D::parseModelTable(in, t, nullptr) && !t.has_bg && !t.models[0].c_bg && t.models[0].n_bg,
          "no background rows; an end without rows is the background; CRLF");
    D::ModelTable shipped;
    std::string err;
    check(D::loadModelTable(std::string(FASTAG_DIGEST_DATA) + "/digest_models.tsv", shipped, &err) && shipped.has_bg &&
              shipped.models.size() == 8,
          "the shipped table loads: " + err);
    const D::Dist comp = D::composition({"AAIL", "kx"});
    same(comp[static_cast<std::size_t>(D::aaIndex('L'))], 0.4, "composition: I counted as L, X skipped");
    same(comp[static_cast<std::size_t>(D::aaIndex('K'))], 0.2, "composition: lower case counted");
  }

  // ---- mass gaps: 0.1.3 delta_combos.MODS, in order
  std::vector<D::GapMod> mods = {
      {"Oxidation", "", 1.0, 15.994915}, {"Dioxidation", "", 0.5, 31.989829}, {"Deamidated", "", 1.0, 0.984016},
      {"Gln->pyro-Glu", "", 1.0, -17.026549}, {"Glu->pyro-Glu", "", 1.0, -18.010565},
      {"Carbamidomethyl", "", 1.0, 57.021464}, {"Cation:Na", "", 0.7, 21.981943}, {"Cation:K", "", 0.5, 37.955882},
      {"Carbamyl", "", 0.7, 43.005814}, {"Formyl", "", 0.5, 27.994915}, {"Acetyl", "", 1.0, 42.010565},
      {"Methyl", "", 0.7, 14.01565}, {"Dimethyl", "", 0.7, 28.0313}, {"Trimethyl", "", 0.5, 42.04695},
      {"Propionyl", "", 0.5, 56.026215}, {"Butyryl", "", 0.3, 70.041865}, {"Crotonyl", "", 0.3, 68.026215},
      {"Succinyl", "", 0.3, 100.016044}, {"Malonyl", "", 0.3, 86.000394}, {"GG", "", 0.5, 114.042927},
      {"Phospho", "", 0.7, 79.966331}, {"Sulfo", "", 0.2, 79.956815}, {"Nitro", "", 0.3, 44.985078},
      {"HexNAc", "", 0.5, 203.079373}, {"Hex", "", 0.3, 162.052824}, {"Cysteinyl", "", 0.3, 119.004099},
      {"Methylthio", "", 0.5, 45.987721}, {"Propionamide", "", 0.5, 71.037114}, {"Nethylmaleimide", "", 0.5, 125.047679},
      {"TMT6plex", "", 0.5, 229.162932}, {"TMTpro", "", 0.5, 304.207146}, {"iTRAQ4plex", "", 0.5, 144.102063},
      {"Label:13C(6)15N(2)", "", 0.5, 8.014199}, {"Label:13C(6)15N(4)", "", 0.5, 10.008269},
      {"Label:2H(4)", "", 0.5, 4.025107}, {"Label:13C(6)", "", 0.5, 6.020129}, {"Met-loss", "", 0.7, -131.040485},
      {"Met-loss+Acetyl", "", 0.7, -89.02992}};

  // The shipped list is 0.1.3's, and OpenMS's Unimod has the same masses.
  {
    std::ifstream f(std::string(FASTAG_DIGEST_DATA) + "/massgap_mods.tsv");
    std::vector<D::GapMod> shipped;
    std::string err;
    check(f && D::parseGapMods(f, shipped, &err) && shipped.size() == mods.size(), "massgap_mods.tsv: 38 rows " + err);
    const OpenMS::ModificationsDB* db = OpenMS::ModificationsDB::getInstance();
    for (std::size_t i = 0; i < shipped.size() && i < mods.size(); ++i)
    {
      check(shipped[i].name == mods[i].name && shipped[i].prior == mods[i].prior, "massgap_mods.tsv row " + mods[i].name);
      const OpenMS::ResidueModification* m = nullptr;
      try { m = db->getModification(shipped[i].site); } catch (...) {}
      check(m != nullptr, "ModificationsDB knows " + shipped[i].site);
      if (m) same(m->getDiffMonoMass(), mods[i].mass, "Unimod mass of " + shipped[i].site);
    }
    const std::map<std::string, double> cys = {{"Carbamidomethyl (C)", 57.021464}, {"Propionamide (C)", 71.037114},
                                               {"Nethylmaleimide (C)", 125.047679}, {"Methylthio (C)", 45.987721},
                                               {"Carboxymethyl (C)", 58.005479}};
    for (const auto& [site, mass] : cys)
    {
      const OpenMS::ResidueModification* m = nullptr;
      try { m = db->getModification(site); } catch (...) {}
      check(m && m->getDiffMonoMass() == mass, "DELTA_CANDIDATES mass of " + site);
    }
  }

  const auto combos = D::combinations(mods, 3);
  check(combos.size() == 10659, "38 + 741 + 9880 combinations");
  auto names = [&](const std::vector<int>& c) {
    std::string s;
    for (int m : c) s += (s.empty() ? "" : "+") + mods[static_cast<std::size_t>(m)].name;
    return s;
  };
  {
    const auto e112 = D::explain(combos, mods, 112.05243, 0.02);
    check(e112.size() >= 3 && names(e112[0]) == "Acetyl+Butyryl" && names(e112[1]) == "Propionyl+Propionyl" &&
              names(e112[2]) == "Acetyl+Acetyl+Dimethyl",
          "explain 112.05243");
    check(names(D::explain(combos, mods, 98.03678, 0.02).at(0)) == "Acetyl+Propionyl", "explain 98.03678");
    check(names(D::explain(combos, mods, 42.04695, 0.02).at(0)) == "Trimethyl", "explain 42.04695");
    check(names(D::explain(combos, mods, 42.0106, 0.02).at(0)) == "Acetyl", "explain 42.0106");
  }
  {
    const std::vector<D::GapRow> hist = {{56.0262, 900}, {112.0524, 400}, {98.0368, 150}, {79.9663, 1200},
                                         {15.9949, 200}, {0.0, 3000},     {137.3, 5},     {56.0302, 40},
                                         {79.9603, 30}};
    const D::GapResult r = D::detectGaps(hist, mods, combos, 0.02, 20, 0.005, 0.08, 500);
    check(r.placed == 5925 && r.shifted == 2925, "detect: placed 5925, shifted 2925");
    const std::vector<std::pair<std::uint64_t, std::string>> want = {
        {1230, "Phospho"}, {940, "Propionyl"}, {400, "Propionyl+Propionyl"}, {200, "Oxidation"}, {150, "Acetyl+Propionyl"}};
    const double draw[] = {0x1.3fdd5762794d3p+6, 0x1.c03601960b58dp+5, 0x1.c035a858793ddp+6, 0x1.ffd63886594afp+3,
                           0x1.8825aee631f8ap+6};
    check(r.peaks.size() == want.size(), "detect: 5 peaks");
    for (std::size_t i = 0; i < r.peaks.size() && i < want.size(); ++i)
    {
      check(r.peaks[i].spectra == want[i].first && names(r.peaks[i].explained_by) == want[i].second,
            "detect peak " + std::to_string(i + 1) + ": " + names(r.peaks[i].explained_by));
      same(r.peaks[i].delta, draw[i], "detect peak delta " + std::to_string(i + 1));
    }
    check(r.peaks.size() > 2 && r.peaks[2].context == "members seen as single-modification peaks" &&
              names(r.peaks[2].alternatives.at(0)) == "Acetyl+Butyryl",
          "detect: the isobaric pair prefers members seen alone");
    const std::map<std::string, double> share = {{"Phospho", 0x1.ae9ae9ae9ae9bp-2}, {"Propionyl", 0x1.4ad4ad4ad4ad6p-1},
                                                 {"Oxidation", 0x1.1811811811812p-4}, {"Acetyl", 0x1.a41a41a41a41ap-5}};
    check(r.share.size() == share.size(), "detect: four modifications share");
    for (const auto& [m, v] : r.share) same(v, share.at(mods[static_cast<std::size_t>(m)].name), "share " + mods[static_cast<std::size_t>(m)].name);
    check(r.silac == "none", "detect: no SILAC");
    check(D::detectGaps({{0.0, 500}}, mods, combos, 0.02, 20, 0.005, 0.08, 500).peaks.empty(), "nothing shifted, no peak");
  }
  {
    const auto sil = D::detectGaps({{8.0142, 100}, {10.0083, 100}, {0.0, 1000}, {15.9949, 400}}, mods, combos, 0.02, 20,
                                   0.005, 0.08, 500);
    check(sil.silac == "SILAC (Lys8/Arg10)", "SILAC Lys8/Arg10: " + sil.silac);
    const auto tri = D::detectGaps({{4.0251, 120}, {6.0201, 120}, {8.0142, 100}, {0.0, 1000}, {15.9949, 400}}, mods,
                                   combos, 0.02, 20, 0.005, 0.08, 500);
    check(tri.silac == "SILAC triplex (Lys4/Arg6, Lys8/Arg10)", "SILAC triplex: " + tri.silac);
    const auto few = D::detectGaps({{8.0142, 100}, {10.0083, 100}, {0.0, 1000}, {15.9949, 200}}, mods, combos, 0.02, 20,
                                   0.005, 0.08, 500);
    check(few.silac == "none", "SILAC needs 500 shifted spectra");
  }
  {
    // report values join members with " + ", since Met-loss+Acetyl is one modification
    const std::vector<D::GapRow> hist = {{-89.0299, 300}, {-73.0350, 200}, {15.9949, 400}, {0.0, 3000}};
    const std::vector<std::string> keys = {"-89.0299", "-73.0350", "15.9949", "0.0000"};
    std::map<std::string, std::string> ex;
    for (const auto& r : D::massgapRows(hist, keys, mods, combos, {}, D::GapSettings()))
      if (r.section == "peak") ex[r.key] = r.value;
    bool single = false, pair = false;
    for (const auto& [k, v] : ex)
    {
      single = single || v == "Met-loss+Acetyl";
      pair = pair || v == "Oxidation + Met-loss+Acetyl";
    }
    check(single, "massgap row: Met-loss+Acetyl alone");
    check(pair, "massgap row: Oxidation + Met-loss+Acetyl");
  }

  if (failures) std::cerr << failures << " failure(s)\n";
  else std::cout << "digest_test: all checks passed\n";
  return failures ? 1 : 0;
}
