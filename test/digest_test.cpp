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

// ---- label_call (FASTag 1.12 #3a): counters set field by field
static int key(const char* name)
{
  const auto& keys = D::residueKeys();
  for (int k = 0; k < D::kNumKeys; ++k)
    if (std::string(name) == keys[static_cast<std::size_t>(k)].name) return k;
  return -1;
}
/// @p tags filtered tags; C-terminal tag ends per residue key (c_near);
/// N-terminal label gaps and their +0.5 Da background per labelKeys() entry.
static D::TerminusCounter labelCounter(std::uint64_t tags, const std::map<std::string, std::uint64_t>& ends,
                                       std::array<std::uint64_t, D::kNumLabels> lab = {},
                                       std::array<std::uint64_t, D::kNumLabels> bg = {})
{
  D::TerminusCounter tc;
  tc.tags = tags;
  for (const auto& [k, v] : ends) tc.c_near[static_cast<std::size_t>(key(k.c_str()))] = v;
  tc.lab_n = lab;
  tc.lab_bg_n = bg;
  return tc;
}
/// "status label basis silac reason" of the label_call rows
static std::string callOf(const D::TerminusCounter& tc, const D::DigestSettings& s = D::DigestSettings())
{
  const auto rows = D::labelCallRows(D::labelCall(tc, s), tc, s);
  return value(rows, "label_call", "status") + " " + value(rows, "label_call", "label") + " " +
         value(rows, "label_call", "basis") + " " + value(rows, "label_call", "silac") + " " +
         value(rows, "label_call", "reason");
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

  // ---- post-1.13.1 (aspn): softenNterm. A third of the N-terminal tag ends
  // at D (an Asp-N digest as tags see it) is `unspecific` under the D-only
  // model and Asp-N under the softened one; 12 % D stays unspecific.
  {
    std::map<char, std::uint64_t> bgc;
    for (int i = 0; i < D::kNumAA; ++i) bgc[D::kAAs[static_cast<std::size_t>(i)]] = 4 * static_cast<std::uint64_t>(i + 1);
    auto third = bgc, eighth = bgc;
    third['D'] += 300;   // 340 of 1060
    eighth['D'] += 60;   // 100 of 820
    const auto top = [](const D::Classification& c) { return c.scores[static_cast<std::size_t>(c.top)].name; };
    D::ModelTable soft = table();
    D::softenNterm(soft, "Asp-N", D::kNtermSiteShare);
    D::softenNterm(soft, "Trypsin", D::kNtermSiteShare);  // N end is the background: no-op
    D::softenNterm(soft, "no such model", D::kNtermSiteShare);
    check(top(D::classify(counts(bgc), counts(third), table(), 0.05, 100)) == "unspecific", "soften: 32 % D is unspecific before");
    check(top(D::classify(counts(bgc), counts(third), soft, 0.05, 100)) == "Asp-N", "soften: 32 % D is Asp-N after");
    check(top(D::classify(counts(bgc), counts(eighth), soft, 0.05, 100)) == "unspecific", "soften: 12 % D stays unspecific");
    check(top(D::classify(counts({{'K', 150}, {'R', 60}}), counts(third), soft, 0.05, 100)) == "Trypsin",
          "soften: a tryptic C end still wins");
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

  {
    // gapResult (1.12 P2): detectGaps over the rows with >= min_bin spectra,
    // members indexing the unfiltered rows; massgapRows with it equals the
    // self-computing overload.
    const std::vector<D::GapRow> rows = {{56.0262, 900}, {112.0524, 400}, {98.0368, 150}, {79.9663, 1200},
                                         {15.9949, 200}, {0.0, 3000},     {137.3, 5},     {56.0302, 40},
                                         {79.9603, 30},  {56.0282, 1},    {15.9939, 1}};
    std::vector<std::string> keys;
    for (const auto& r : rows) keys.push_back(D::num(r.delta));
    for (const std::uint64_t min_bin : {std::uint64_t{1}, std::uint64_t{2}, std::uint64_t{50}})
    {
      D::GapSettings gs;
      gs.min_bin = min_bin;
      std::vector<D::GapRow> hist;
      for (const auto& r : rows)
        if (r.spectra >= min_bin) hist.push_back(r);
      const D::GapResult old = D::detectGaps(hist, mods, combos, gs.window, gs.min_spectra, gs.min_share,
                                             gs.silac_share, gs.silac_min);
      const D::GapResult res = D::gapResult(rows, mods, combos, gs);
      const std::string tag = " (min_bin " + std::to_string(min_bin) + ")";
      bool eq = old.placed == res.placed && old.shifted == res.shifted && old.peaks.size() == res.peaks.size() &&
                old.share == res.share && old.silac == res.silac && old.silac_share == res.silac_share;
      for (std::size_t i = 0; eq && i < old.peaks.size(); ++i)
        eq = old.peaks[i].delta == res.peaks[i].delta && old.peaks[i].spectra == res.peaks[i].spectra &&
             old.peaks[i].explained_by == res.peaks[i].explained_by &&
             old.peaks[i].alternatives == res.peaks[i].alternatives && old.peaks[i].context == res.peaks[i].context;
      check(eq, "gapResult equals detectGaps on the min_bin-filtered rows" + tag);
      bool members_ok = true;
      for (const auto& p : res.peaks)
      {
        std::uint64_t n = 0;
        for (std::size_t k = 0; k < p.members.size(); ++k)
        {
          const std::size_t m = p.members[k];
          members_ok = members_ok && m < rows.size() && rows[m].spectra >= min_bin &&
                       std::fabs(rows[m].delta - p.delta) <= 2 * gs.window && (k == 0 || p.members[k - 1] < m);
          if (m < rows.size()) n += rows[m].spectra;
        }
        members_ok = members_ok && n == p.spectra;
      }
      check(members_ok, "peak members index the unfiltered rows and sum to the peak" + tag);
      const auto a = D::massgapRows(rows, keys, mods, combos, {}, gs);
      const auto b = D::massgapRows(rows, keys, mods, {}, gs, res);
      bool same_rows = a.size() == b.size();
      for (std::size_t i = 0; same_rows && i < a.size(); ++i)
        same_rows = a[i].section == b[i].section && a[i].key == b[i].key && a[i].value == b[i].value &&
                    a[i].n == b[i].n && a[i].description == b[i].description;
      check(same_rows, "massgapRows with a precomputed gapResult equals the old path" + tag);
    }
    // Two rows, each below min_bin, that would form a peak together do not.
    D::GapSettings gs;
    gs.min_bin = 30;
    gs.min_spectra = 20;
    const auto split = D::gapResult({{15.9949, 25}, {15.9959, 25}, {0.0, 3000}}, mods, combos, gs);
    check(split.peaks.empty(), "rows below min_bin never combine into a peak");
  }

  // ---- label_call: prose-auto fastag_termini / termini_evidence (0.1.10's rule; tag minimum 175 by default,
  //      0 opt-in since 1.13)
  {
    const D::DigestSettings s;
    D::DigestSettings da = s;
    da.low_resolution = true;
    // a label-free tryptic run: 175 C-terminal K/R ends
    const D::TerminusCounter lf = labelCounter(1000, {{"K", 100}, {"R", 75}});
    check(lf.tot() == 175, "label_call: 175 tag ends");
    check(callOf(lf) == "call label-free none none -", "label_call: 175 ends, no label: label-free (" + callOf(lf) + ")");
    // the minimum is 175 C-terminal tag ends, the 1.12 rule (prose-auto 0.1.10's TAG_MIN;
    // -label_call_min_tags 0 failed its 1.13 held-out test and was removed in 1.14)
    check(D::kLabelTagMin == 175, "label_call: the tag minimum is 175");
    const D::TerminusCounter lf174 = labelCounter(1000, {{"K", 100}, {"R", 74}});
    check(callOf(lf174) == "no_call - - - few_tags",
          "label_call: 174 ends at the minimum 175 (prose-auto 0.1.10's TAG_MIN) is few_tags (" + callOf(lf174) + ")");
    {
      const auto rows = D::labelCallRows(D::labelCall(lf174, s), lf174, s);
      bool says = false;
      for (const D::Row& r : rows)
        if (r.key == "status") says = r.description.find("fewer than 175") != std::string::npos;
      check(says, "label_call: the few_tags row names the minimum");
    }
    auto statusDesc = [&](const D::TerminusCounter& tc, const D::DigestSettings& st) {
      for (const D::Row& r : D::labelCallRows(D::labelCall(tc, st), tc, st))
        if (r.section == "label_call" && r.key == "status") return r.description;
      return std::string("<missing>");
    };
    check(statusDesc(lf, s).find("fewer than") == std::string::npos, "label_call: a call from 175 ends has no weak-evidence sentence");
    // no C-terminal end at all: few_tags
    const D::TerminusCounter none = labelCounter(1000, {});
    check(none.tot() == 0, "label_call: the empty fixture has no tag end");
    check(callOf(none) == "no_call - - - few_tags", "label_call: 0 ends is few_tags (" + callOf(none) + ")");
    check(callOf(lf, da) == "no_call - - - low_resolution", "label_call: a Da run is low_resolution");
    // low_resolution comes before few_tags, and a Da run never calls a label
    check(callOf(labelCounter(1000, {{"K", 10}}, {500, 0, 0}), da) == "no_call - - - low_resolution",
          "label_call: low_resolution before few_tags");

    // isobaric: count >= 1% of the filtered tags AND >= 20 x max(background, 1)
    const std::map<std::string, std::uint64_t> kr = {{"K", 200}, {"R", 100}};
    check(callOf(labelCounter(10000, kr, {100, 0, 0})) == "call TMT nterm_gap none -", "label_call: TMT at exactly 1%, background 0");
    check(callOf(labelCounter(10000, kr, {99, 0, 0})) == "call label-free none none -", "label_call: TMT at 0.99% is label-free");
    check(callOf(labelCounter(1000, kr, {200, 0, 0}, {10, 0, 0})) == "call TMT nterm_gap none -", "label_call: TMT at exactly 20x background");
    check(callOf(labelCounter(1000, kr, {200, 0, 0}, {11, 0, 0})) == "call label-free none none -", "label_call: TMT below 20x background");
    check(callOf(labelCounter(1000, kr, {19, 0, 0})) == "call label-free none none -", "label_call: 19 gaps are below 20 x max(0, 1)");
    check(callOf(labelCounter(1000, kr, {20, 0, 0})) == "call TMT nterm_gap none -", "label_call: 20 gaps reach 20 x max(0, 1) and 1%");
    check(callOf(labelCounter(1000, kr, {0, 60, 0})) == "call TMTpro nterm_gap none -", "label_call: TMTpro, not TMT");
    check(callOf(labelCounter(1000, kr, {0, 0, 60})) == "call iTRAQ4 nterm_gap none -", "label_call: iTRAQ4");
    check(callOf(labelCounter(1000, kr, {60, 60, 0})) == "call TMT+TMTpro nterm_gap none -", "label_call: both hits listed, labelKeys() order");
    {
      const D::TerminusCounter pro = labelCounter(1000, kr, {0, 60, 0});
      const auto rows = D::labelCallRows(D::labelCall(pro, s), pro, s);
      bool itraq8 = false;
      for (const D::Row& r : rows)
        if (r.section == "label_call" && r.key == "label") itraq8 = r.description.find("iTRAQ8plex") != std::string::npos;
      check(itraq8, "label_call: the TMTpro row says iTRAQ8plex has the same mass");
    }

    // SILAC (Lys8/Arg10): both heavy shares >= 0.2, K/R share >= 0.8 (rounded to 3 decimals, as prose-auto
    // compares it), >= silac_min (50) K- and R-terminal ends; strong when both shares are >= 0.3
    const D::TerminusCounter weak = labelCounter(1000, {{"K", 100}, {"K+8", 25}, {"R", 100}, {"R+10", 25}});
    check(value(D::labelRows(weak, s), "heavy", "K8.share") == "0.2" && value(D::labelRows(weak, s), "heavy", "R10.share") == "0.2",
          "label_call: the weak fixture sits at heavy shares 0.2");
    check(callOf(weak) == "call SILAC heavy_share weak -", "label_call: SILAC at 0.2 is weak (" + callOf(weak) + ")");
    check(callOf(labelCounter(1000, {{"K", 101}, {"K+8", 24}, {"R", 100}, {"R+10", 25}})) == "call label-free none none -",
          "label_call: Lys8 below 0.2 is not SILAC");
    const D::TerminusCounter strong = labelCounter(1000, {{"K", 70}, {"K+8", 30}, {"R", 70}, {"R+10", 30}});
    check(value(D::labelRows(strong, s), "heavy", "K8.share") == "0.3" && value(D::labelRows(strong, s), "heavy", "R10.share") == "0.3",
          "label_call: the strong fixture sits at heavy shares 0.3");
    check(callOf(strong) == "call SILAC heavy_share strong -", "label_call: SILAC at 0.3 is strong (" + callOf(strong) + ")");
    check(callOf(labelCounter(1000, {{"K", 70}, {"K+8", 30}, {"R", 75}, {"R+10", 25}})) == "call SILAC heavy_share weak -",
          "label_call: strong needs both shares >= 0.3");
    // K/R share 0.79 refuses; 0.7996 rounds to 0.800 and calls, 0.7994 rounds to 0.799 and refuses
    auto withOthers = [](std::uint64_t k, std::uint64_t k8, std::uint64_t r, std::uint64_t r10, std::uint64_t other) {
      return labelCounter(100000, {{"K", k}, {"K+8", k8}, {"R", r}, {"R+10", r10}, {"L", other}});
    };
    const D::TerminusCounter kr79 = withOthers(2000, 1950, 2000, 1950, 2100);
    check(value(D::digestRows(kr79, table(), D::RunMeta(), s), "share", "kr").rfind("0.79", 0) == 0, "label_call: K/R share 0.79 fixture");
    check(callOf(kr79) == "call label-free none none -", "label_call: SILAC refused at K/R share 0.79");
    const D::TerminusCounter kr7996 = withOthers(2000, 1998, 2000, 1998, 2004);
    const D::TerminusCounter kr7994 = withOthers(2000, 1997, 2000, 1997, 2006);
    check(D::krShare(kr7996) < 0.8 && D::krShare(kr7996) > 0.7995, "label_call: K/R share 0.7996 fixture");
    check(D::krShare(kr7994) < 0.7995, "label_call: K/R share 0.7994 fixture");
    check(callOf(kr7996) == "call SILAC heavy_share strong -", "label_call: K/R share 0.7996 rounds to 0.800 (" + callOf(kr7996) + ")");
    check(callOf(kr7994) == "call label-free none none -", "label_call: K/R share 0.7994 rounds to 0.799");
    // 49 R-terminal ends refuse, 50 call; -digest_silac_min moves the gate
    check(callOf(labelCounter(1000, {{"K", 100}, {"K+8", 50}, {"R", 29}, {"R+10", 20}})) == "call label-free none none -",
          "label_call: SILAC refused at 49 R-terminal tag ends");
    check(callOf(labelCounter(1000, {{"K", 100}, {"K+8", 50}, {"R", 30}, {"R+10", 20}})) == "call SILAC heavy_share strong -",
          "label_call: SILAC at 50 R-terminal tag ends");
    D::DigestSettings smin = s;
    smin.silac_min = 60;
    check(callOf(labelCounter(1000, {{"K", 100}, {"K+8", 50}, {"R", 30}, {"R+10", 20}}), smin) == "call label-free none none -",
          "label_call: -digest_silac_min 60 refuses 50 R-terminal ends");
    // isobaric and SILAC together: both listed, isobaric first
    check(callOf(labelCounter(1000, {{"K", 100}, {"K+8", 50}, {"R", 100}, {"R+10", 50}}, {60, 0, 0})) ==
              "call TMT+SILAC nterm_gap+heavy_share strong -",
          "label_call: TMT and SILAC");

    // the rows: section label_call, five keys in order, five non-empty fields
    const auto rows = D::labelCallRows(D::labelCall(weak, s), weak, s);
    std::string keys;
    bool full = true;
    for (const D::Row& r : rows)
    {
      keys += (keys.empty() ? "" : ",") + r.section + "." + r.key;
      full = full && !r.value.empty() && !r.n.empty() && !r.description.empty();
    }
    check(keys == "label_call.status,label_call.label,label_call.basis,label_call.silac,label_call.reason",
          "label_call: the five rows in order (" + keys + ")");
    check(full, "label_call: every field filled");
    // the K/R share is the -digest_out share.kr, bit for bit
    for (const D::TerminusCounter& tc : {weak, strong, kr79, kr7996, kr7994, lf})
      check(D::num(D::krShare(tc)) == value(D::digestRows(tc, table(), D::RunMeta(), s), "share", "kr"),
            "label_call: krShare equals share.kr");
  }

  if (failures) std::cerr << failures << " failure(s)\n";
  else std::cout << "digest_test: all checks passed\n";
  return failures ? 1 : 0;
}
