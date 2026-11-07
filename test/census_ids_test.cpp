// Census ids join (src/CensusIds.h, #11 phase B): scan numbers and run names,
// q-value semantics (score type vs meta value, decoys, target+decoy, empty
// hit lists, the FDR threshold), the refusals (no q-values, merged runs), the
// matcher (exact native id, unique scan fallback, duplicate scans unknown,
// unmatched references), the table join (columns, triage rule, tab escaping,
// tally) and the summary section.
//
// With arguments it is also the fixture writer of census_ids_cli_test.sh:
//   census_ids_test --write-ids <mzML> <out.idXML|out.mzid> <variant> <expected.tsv>
// writes identifications for the MS2 spectra of <mzML> by a fixed pattern of
// their MS2 ordinal and the expected identified value per native id. The
// expectation comes from the pattern, not from the matcher under test.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "Census.h"
#include "CensusIds.h"

#include <OpenMS/FORMAT/IdXMLFile.h>
#include <OpenMS/FORMAT/MzIdentMLFile.h>
#include <OpenMS/FORMAT/MzMLFile.h>
#include <OpenMS/KERNEL/MSExperiment.h>
#include <OpenMS/METADATA/PeptideEvidence.h>
#include <OpenMS/METADATA/PeptideHit.h>
#include <OpenMS/METADATA/ProteinHit.h>
#include <OpenMS/METADATA/PeptideIdentification.h>
#include <OpenMS/METADATA/PeptideIdentificationList.h>
#include <OpenMS/METADATA/ProteinIdentification.h>

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <limits>
#include <random>
#include <sstream>
#include <string>
#include <vector>

using namespace OpenMS;
namespace C = FASTag::Census;
namespace I = FASTag::CensusIds;

static int failures = 0;
#define CHECK(c, ...) do { if (!(c)) { ++failures; std::printf("FAIL %d: ", __LINE__); \
  std::printf(__VA_ARGS__); std::printf("\n"); } } while (0)

namespace
{
  enum class TD { None, Target, Decoy, Both };

  PeptideHit hit(double score, TD td, const char* q_meta = nullptr, double q = 0)
  {
    PeptideHit h;
    h.setScore(score);
    h.setSequence(AASequence::fromString("PEPTIDEK"));
    h.setCharge(2);  // mzid stores the hit's m/z
    if (td == TD::Target) h.setMetaValue("target_decoy", "target");
    if (td == TD::Decoy) h.setMetaValue("target_decoy", "decoy");
    if (td == TD::Both) h.setMetaValue("target_decoy", "target+decoy");
    if (q_meta) h.setMetaValue(q_meta, q);
    return h;
  }

  PeptideIdentification pid(const std::string& ref, const std::string& score_type, bool higher_better,
                            std::vector<PeptideHit> hits)
  {
    PeptideIdentification p;
    p.setIdentifier("run0");
    p.setSpectrumReference(ref);
    p.setScoreType(score_type);
    p.setHigherScoreBetter(higher_better);
    p.setHits(hits);
    p.setMZ(500);
    p.setRT(100);
    return p;
  }

  ProteinIdentification prot(const std::string& id, std::vector<std::string> runs)
  {
    ProteinIdentification pr;
    pr.setIdentifier(id);
    pr.setSearchEngine("test");
    StringList r;
    for (auto& s : runs) r.push_back(s);
    if (!r.empty()) pr.setPrimaryMSRunPath(r);
    return pr;
  }

  const std::string NID = "controllerType=0 controllerNumber=1 scan=";

  std::string slurp(const std::string& p)
  {
    std::ifstream f(p, std::ios::binary);
    std::stringstream ss;
    ss << f.rdbuf();
    return ss.str();
  }

  std::vector<std::vector<std::string>> table(const std::string& text)
  {
    std::vector<std::vector<std::string>> rows;
    std::istringstream is(text);
    std::string line;
    while (std::getline(is, line))
    {
      std::vector<std::string> f;
      std::size_t s = 0;
      for (std::size_t i = 0; i <= line.size(); ++i)
        if (i == line.size() || line[i] == '\t') { f.push_back(line.substr(s, i - s)); s = i + 1; }
      rows.push_back(f);
    }
    return rows;
  }
}

// ---- fixture writer for census_ids_cli_test.sh ---------------------------------
static int writeIds(int argc, char** argv)
{
  if (argc != 6)
  {
    std::fprintf(stderr, "usage: census_ids_test --write-ids <mzML> <out> <variant> <expected.tsv>\n");
    return 2;
  }
  const std::string mzml = argv[2], out = argv[3], variant = argv[4], expected = argv[5];
  PeakMap exp;
  MzMLFile().load(mzml, exp);
  const std::string run = std::filesystem::path(mzml).filename().string();
  std::vector<ProteinIdentification> prots;
  if (variant == "merged") prots = {prot("run0", {"a.mzML"}), prot("run1", {"b.mzML"})};
  else prots = {prot("run0", {variant == "wrongrun" ? std::string("other_run.mzML") : run})};
  const bool mzid = variant == "mzid";
  const bool meta = variant == "meta" || mzid;
  if (mzid)
  {
    // mzIdentML keeps a hit's target/decoy state only in its PeptideEvidence
    // (isDecoy), and the evidence needs a protein of the run: without them a
    // decoy hit is read back as a hit without target_decoy, that is a target.
    ProteinHit t, d;
    t.setAccession("PROT_T");
    t.setMetaValue("target_decoy", "target");
    d.setAccession("DECOY_PROT_T");
    d.setMetaValue("target_decoy", "decoy");
    prots[0].setHits({t, d});
  }
  const bool noq = variant == "noq";
  PeptideIdentificationList peps;
  std::ofstream ex(expected);
  std::size_t k = 0;
  long long first_yes_scan = -1;
  for (const MSSpectrum& s : exp)
  {
    if (s.getMSLevel() != 2) continue;
    const std::string nid = s.getNativeID();
    std::string ref = nid;
    if (variant == "scan" || variant == "dupscan") ref = "scan=" + std::to_string(I::scanOf(nid));
    // noref: every second identification lacks its reference; allnoref: all.
    if ((variant == "noref" && k % 2 == 0) || variant == "allnoref") ref = "";
    const std::string st = meta || noq ? "hyperscore" : "q-value";
    const bool hb = meta || noq;
    auto h = [&](double q, TD td) {
      if (noq) return hit(10, TD::None);
      if (mzid)
      {
        PeptideHit x = hit(10 + q, td, (k % 2) ? "MS:1002354" : "q-value", q);
        // The writer keeps one evidence set per peptide sequence, so decoy
        // hits carry a sequence of their own.
        if (td == TD::Decoy) x.setSequence(AASequence::fromString("KEDITPEP"));
        x.setPeptideEvidences({PeptideEvidence(td == TD::Decoy ? "DECOY_PROT_T" : "PROT_T", 0, 7, '-', '-')});
        return x;
      }
      if (meta) return hit(10 + q, td, (k % 2) ? "MS:1002354" : "q-value", q);
      return hit(q, td);
    };
    std::string want = "0";
    switch (k % 6)
    {
      case 0: peps.push_back(pid(ref, st, hb, {h(0.001, TD::Target)})); want = "1"; break;
      case 1: peps.push_back(pid(ref, st, hb, {h(0.02, TD::Target)})); break;
      case 2: peps.push_back(pid(ref, st, hb, {h(0.001, TD::Decoy)})); break;
      case 3: peps.push_back(pid(ref, st, hb, {})); break;
      case 4: break;
      case 5:
        // mzIdentML writes isDecoy for a target+decoy hit as decoy (one flag
        // per hit), so the mzid variant pairs the decoy with a plain target.
        peps.push_back(pid(ref, st, hb, {h(0.005, TD::Decoy), h(0.005, mzid ? TD::Target : TD::Both)}));
        want = "1";
        break;
    }
    if (want == "1" && first_yes_scan < 0 && variant == "dupscan")
    {
      // a second reference naming the same scan: the spectrum is unknown
      first_yes_scan = I::scanOf(nid);
      peps.push_back(pid(std::to_string(first_yes_scan), st, hb, {h(0.001, TD::Target)}));
      want = "";
    }
    ex << nid << '\t' << want << '\n';
    ++k;
  }
  // References to spectra the input does not hold.
  const std::size_t foreign = variant == "foreign" ? 2 * k : variant == "fewforeign" ? k / 10 : 0;
  for (std::size_t i = 0; i < foreign; ++i)
    peps.push_back(pid("controllerType=0 controllerNumber=1 scan=" + std::to_string(900000 + i), "q-value", false,
                       {hit(0.001, TD::Target)}));
  if (variant == "mzid") MzIdentMLFile().store(out, prots, peps);
  else IdXMLFile().store(out, prots, peps);
  return 0;
}

int main(int argc, char** argv)
{
  if (argc > 1 && std::string(argv[1]) == "--write-ids") return writeIds(argc, argv);
  const double nan = std::numeric_limits<double>::quiet_NaN();

  // 1. Scan numbers and run names.
  {
    CHECK(I::scanOf(NID + "11461") == 11461, "Thermo native id");
    CHECK(I::scanOf("scan=5") == 5, "scan=5");
    CHECK(I::scanOf("42") == 42, "bare integer");
    CHECK(I::scanOf("index=3") == -1, "index= names no scan");
    CHECK(I::scanOf("Ecoli.5.5.2") == -1, "a dotted title names no scan");
    CHECK(I::scanOf("") == -1 && I::scanOf("scan=") == -1, "empty");
    CHECK(I::scanOf("xscan=5") == -1, "scan= must start a field");
    CHECK(I::scanOf("scan=12a") == -1, "trailing garbage");
    CHECK(I::scanOf("frame=3 scan=7") == 7, "scan= after a space");
    CHECK(I::runStem("/a/b/run.mzML") == "run", "runStem %s", I::runStem("/a/b/run.mzML").c_str());
    CHECK(I::runStem("file:///a/run.mzML.gz") == "run", "runStem gz %s", I::runStem("file:///a/run.mzML.gz").c_str());
    CHECK(I::runStem("C:\\x\\run.RAW") == "run", "runStem windows %s", I::runStem("C:\\x\\run.RAW").c_str());
    CHECK(I::runStem("run.1.mzML") == "run.1", "runStem keeps inner dots %s", I::runStem("run.1.mzML").c_str());
    CHECK(I::runStem("run.d") == "run" && I::runStem("RUN.mgf") == "RUN", "runStem .d/.mgf");
    std::printf("1. scan numbers and run names\n");
  }

  // 2. q-values.
  {
    CHECK(I::isQValueScoreType("q-value") && I::isQValueScoreType("Q-Value") && I::isQValueScoreType("qvalue")
              && I::isQValueScoreType("q_value") && I::isQValueScoreType("MS:1002354")
              && I::isQValueScoreType("PSM-level q-value"),
          "q-value score types");
    CHECK(!I::isQValueScoreType("hyperscore") && !I::isQValueScoreType("Posterior Error Probability"),
          "non-q score types");
    PeptideIdentification a = pid("x", "q-value", false, {hit(0.003, TD::Target)});
    CHECK(I::qValue(a, a.getHits()[0]) == 0.003, "q from the score");
    // A q-value score type that claims higher-is-better is not a q-value.
    PeptideIdentification b = pid("x", "q-value", true, {hit(0.003, TD::Target)});
    CHECK(std::isnan(I::qValue(b, b.getHits()[0])), "higher-better q-value score accepted");
    PeptideIdentification c = pid("x", "hyperscore", true, {hit(30, TD::Target, "q-value", 0.004)});
    CHECK(I::qValue(c, c.getHits()[0]) == 0.004, "q from meta q-value");
    PeptideIdentification d = pid("x", "hyperscore", true, {hit(30, TD::Target, "MS:1002354", 0.005)});
    CHECK(I::qValue(d, d.getHits()[0]) == 0.005, "q from meta MS:1002354");
    PeptideIdentification e = pid("x", "hyperscore", true, {hit(30, TD::Target)});
    CHECK(std::isnan(I::qValue(e, e.getHits()[0])), "no q");
    (void)nan;
    std::printf("2. q-values\n");
  }

  // 3. interpret: acceptance, refusals, runs.
  {
    PeptideIdentificationList peps;
    peps.push_back(pid(NID + "1", "q-value", false, {hit(0.001, TD::Target)}));         // yes
    peps.push_back(pid(NID + "2", "q-value", false, {hit(0.02, TD::Target)}));          // q above fdr
    peps.push_back(pid(NID + "3", "q-value", false, {hit(0.001, TD::Decoy)}));          // decoy only
    peps.push_back(pid(NID + "4", "q-value", false, {}));                               // empty
    peps.push_back(pid(NID + "5", "q-value", false, {hit(0.001, TD::Both)}));           // target+decoy: yes
    peps.push_back(pid(NID + "6", "hyperscore", true, {hit(30, TD::Target, "q-value", 0.009)}));  // mixed: yes
    peps.push_back(pid(NID + "7", "hyperscore", true, {hit(30, TD::Target)}));          // no q: no
    peps.push_back(pid(NID + "8", "q-value", false, {hit(0.01, TD::Target)}));          // q == fdr: yes
    I::Index idx;
    const I::Loaded L = I::interpret({prot("run0", {"/x/run.mzML"})}, peps, 0.01, idx);
    CHECK(L.refusal.empty(), "refused: %s", L.refusal.c_str());
    CHECK(L.n_ids == 8 && L.n_with_hits == 7 && L.n_accepted == 4 && L.n_decoy_only == 1,
          "ids %zu hits %zu accepted %zu decoy_only %zu", L.n_ids, L.n_with_hits, L.n_accepted, L.n_decoy_only);
    CHECK(L.runs.size() == 1 && L.runs[0] == "run", "runs");
    for (int i = 1; i <= 8; ++i) idx.see(NID + std::to_string(i));
    const char* want = "10001101";
    for (int i = 1; i <= 8; ++i)
    {
      const I::Ident got = idx.lookup(NID + std::to_string(i));
      CHECK(got == (want[i - 1] == '1' ? I::Ident::Yes : I::Ident::No), "spectrum %d identified %s", i, I::text(got));
    }
    // A stricter threshold drops q = 0.009 and q = 0.01.
    I::Index strict;
    const I::Loaded S = I::interpret({prot("run0", {"/x/run.mzML"})}, peps, 0.005, strict);
    CHECK(S.n_accepted == 2, "fdr 0.005 accepted %zu", S.n_accepted);

    // No q-value anywhere: refused, IDFilter named.
    PeptideIdentificationList raw;
    raw.push_back(pid(NID + "1", "hyperscore", true, {hit(30, TD::Target)}));
    raw.push_back(pid(NID + "2", "hyperscore", true, {hit(20, TD::Decoy)}));
    I::Index r;
    const I::Loaded R = I::interpret({prot("run0", {"run.mzML"})}, raw, 0.01, r);
    CHECK(!R.refusal.empty() && R.refusal.find("IDFilter") != std::string::npos, "unfiltered not refused: '%s'",
          R.refusal.c_str());
    // Merged runs: refused.
    I::Index m;
    const I::Loaded M = I::interpret({prot("run0", {"a.mzML"}), prot("run1", {"b.mzML"})}, peps, 0.01, m);
    CHECK(!M.refusal.empty() && M.runs.size() == 2, "merged runs not refused");
    // Two ProteinIdentifications of the same run are one run.
    I::Index one;
    const I::Loaded O = I::interpret({prot("run0", {"/a/r.mzML"}), prot("run1", {"/b/r.raw"})}, peps, 0.01, one);
    CHECK(O.refusal.empty() && O.runs.size() == 1, "one run counted twice");
    CHECK(I::runCheck(O, "/data/r.mzML") == "match" && I::runCheck(O, "/data/s.mzML") == "mismatch",
          "runCheck");
    I::Index none;
    const I::Loaded N = I::interpret({prot("run0", {})}, peps, 0.01, none);
    CHECK(I::runCheck(N, "/data/r.mzML") == "unnamed", "runCheck unnamed");

    // Identifications without a spectrum_reference: never an Index entry;
    // with hits the file is refused (named), without hits only counted.
    {
      I::Index e;
      CHECK(!e.add("", true) && !e.add(" \t ", true) && e.counts().refs == 0, "an empty reference entered the Index");
      CHECK(e.add(NID + "1", false) && e.counts().refs == 1, "a reference was not added");
    }
    PeptideIdentificationList some = peps;  // 8 identifications, 7 with hits
    some[0].setSpectrumReference("");       // accepted hit
    some[1].setSpectrumReference("  ");     // blank
    I::Index si;
    const I::Loaded SR = I::interpret({prot("run0", {"/x/run.mzML"})}, some, 0.01, si);
    CHECK(!SR.refusal.empty() && SR.refusal.find("spectrum_reference") != std::string::npos
              && SR.refusal.find("2 of 7") != std::string::npos,
          "some references missing, not refused: '%s'", SR.refusal.c_str());
    CHECK(SR.n_no_ref == 2 && SR.n_no_ref_hits == 2 && si.counts().refs == 6, "no_ref %zu/%zu refs %zu", SR.n_no_ref,
          SR.n_no_ref_hits, si.counts().refs);
    PeptideIdentificationList all = peps;
    for (auto& p : all) p.setSpectrumReference("");
    I::Index ai;
    const I::Loaded AR = I::interpret({prot("run0", {"/x/run.mzML"})}, all, 0.01, ai);
    CHECK(!AR.refusal.empty() && AR.refusal.find("spectrum_reference") != std::string::npos
              && AR.refusal.find("7 of 7") != std::string::npos,
          "all references missing, not refused: '%s'", AR.refusal.c_str());
    CHECK(AR.n_no_ref == 8 && ai.counts().refs == 0, "all: no_ref %zu refs %zu", AR.n_no_ref, ai.counts().refs);
    PeptideIdentificationList emptyhits = peps;
    emptyhits[3].setSpectrumReference("");  // the identification without hits
    I::Index ei;
    const I::Loaded ER = I::interpret({prot("run0", {"/x/run.mzML"})}, emptyhits, 0.01, ei);
    CHECK(ER.refusal.empty() && ER.n_no_ref == 1 && ER.n_no_ref_hits == 0 && ei.counts().refs == 7,
          "a hitless identification without reference: '%s' %zu %zu", ER.refusal.c_str(), ER.n_no_ref,
          ER.n_no_ref_hits);
    std::printf("3. interpret\n");
  }

  // 4. The matcher.
  {
    I::Index idx;
    idx.add(NID + "10", true);    // exact
    idx.add("scan=11", true);     // unique scan fallback
    idx.add("scan=12", true);     // duplicate scan among the references
    idx.add("12", false);
    idx.add("scan=13", true);     // duplicate scan among the spectra
    idx.add("scan=99", true);     // no spectrum
    idx.add(NID + "14", false);   // exact, not accepted
    idx.add(NID + "14", true);    // the same reference again: accepted
    idx.add("scan=15", true);     // its scan belongs to a spectrum matched exactly
    idx.add(NID + "15", false);
    const std::vector<std::string> spectra = {NID + "10", NID + "11", NID + "12", NID + "13",
                                              "controllerType=0 controllerNumber=2 scan=13", NID + "14",
                                              NID + "15", NID + "16", "index=4"};
    for (const auto& s : spectra) idx.see(s);
    std::vector<I::Ident> got;
    for (const auto& s : spectra) got.push_back(idx.lookup(s));
    const std::vector<I::Ident> want = {I::Ident::Yes, I::Ident::Yes, I::Ident::Unknown, I::Ident::Unknown,
                                        I::Ident::Unknown, I::Ident::Yes, I::Ident::No, I::Ident::No, I::Ident::No};
    for (std::size_t i = 0; i < spectra.size(); ++i)
      CHECK(got[i] == want[i], "%s: got '%s' want '%s'", spectra[i].c_str(), I::text(got[i]), I::text(want[i]));
    const I::Index::Counts c = idx.counts();
    // refs: NID10, scan=11, scan=12, 12, scan=13, scan=99, NID14, scan=15, NID15 = 9
    CHECK(c.refs == 9, "refs %zu", c.refs);
    CHECK(c.exact == 3, "exact %zu", c.exact);
    CHECK(c.by_scan == 1, "by_scan %zu", c.by_scan);
    CHECK(c.ambiguous == 3, "ambiguous %zu", c.ambiguous);
    // scan=99 matches nothing; scan=15 lost to the exact match of its spectrum
    CHECK(c.unmatched == 2, "unmatched %zu", c.unmatched);
    CHECK(c.refs == c.exact + c.by_scan + c.ambiguous + c.unmatched, "counts do not add up");
    std::printf("4. matcher\n");
  }

  // 5. The table join.
  {
    const std::filesystem::path dir = std::filesystem::temp_directory_path() / ("census_ids_test." + std::to_string(std::random_device{}()));
    std::filesystem::create_directories(dir);
    const std::string in = (dir / "c.tsv").string(), out = (dir / "j.tsv").string();
    {
      std::ofstream f(in, std::ios::binary);
      f << C::header();
      std::string buf;
      auto row = [&](std::size_t i, const std::string& nid, C::Status st, bool best, double e) {
        C::Row r;
        r.index = i;
        r.has_precursor = true;
        r.precursor_mz = 500;
        r.charge_given = r.charge_used = 2;
        r.n_peaks = 20;
        r.status = st;
        r.n_found = r.n_reported = best ? 3 : 0;
        r.has_best = best;
        r.best.evalue = e;
        r.best.n_res = 3;
        C::appendRow(buf, r, nid);
      };
      row(0, NID + "1", C::Status::Tagged, true, 0.001);   // identified 1 -> triage 0
      row(1, NID + "2", C::Status::Tagged, true, 0.001);   // identified 0 -> triage 1
      row(2, NID + "3", C::Status::Placed, true, 0.0099);  // 0, placed, below -> 1
      row(3, NID + "4", C::Status::Tagged, true, 0.5);     // 0, above -> 0
      row(4, NID + "5", C::Status::NoTags, false, 0);      // 0, no tag -> 0
      row(5, NID + "6", C::Status::Tagged, true, 0.001);   // unknown -> triage empty
      row(6, NID + "6", C::Status::Tagged, true, 0.001);   // (same scan twice: unknown)
      row(7, "a\tb", C::Status::Tagged, true, 0.001);      // escaped id, identified 1
      row(8, NID + "9", C::Status::Empty, false, 0);       // not processed, 0
      f << buf;
    }
    I::Index idx;
    idx.add(NID + "1", true);
    idx.add(NID + "2", false);
    idx.add("scan=6", true);
    idx.add("a b", true);   // a tab in a reference is a space, as in the census
    I::JoinTally t;
    std::string err;
    CHECK(I::joinTable(in, out, idx, 0.01, t, err), "joinTable failed: %s", err.c_str());
    // The layout comes from Census::header(): N census fields, then
    // identified and triage.
    const std::string hl = C::header().substr(0, C::header().size() - 1);
    I::Layout lay;
    CHECK(I::layoutOf(hl, lay), "Census::header() lacks a column the join reads");
    const std::size_t N = lay.fields;
    CHECK(N == table(hl)[0].size() && table(hl)[0][lay.spectrum] == "spectrum" && table(hl)[0][lay.status] == "status"
              && table(hl)[0][lay.best_evalue] == "best_evalue",
          "layoutOf(Census::header())");
    const auto rows = table(slurp(out));
    CHECK(rows.size() == 10, "joined rows %zu", rows.size());
    CHECK(rows[0].size() == N + 2 && rows[0][N] == "identified" && rows[0][N + 1] == "triage", "header");
    const std::vector<std::pair<std::string, std::string>> want = {
        {"1", "0"}, {"0", "1"}, {"0", "1"}, {"0", "0"}, {"0", "0"}, {"", ""}, {"", ""}, {"1", "0"}, {"0", "0"}};
    for (std::size_t i = 0; i < want.size() && i + 1 < rows.size(); ++i)
    {
      CHECK(rows[i + 1].size() == N + 2, "row %zu has %zu fields", i, rows[i + 1].size());
      if (rows[i + 1].size() == N + 2)
        CHECK(rows[i + 1][N] == want[i].first && rows[i + 1][N + 1] == want[i].second,
              "row %zu: identified '%s' triage '%s', want '%s' '%s'", i, rows[i + 1][N].c_str(),
              rows[i + 1][N + 1].c_str(), want[i].first.c_str(), want[i].second.c_str());
    }
    // The first N fields are the census row unchanged.
    const auto before = table(slurp(in));
    for (std::size_t i = 0; i < before.size() && i < rows.size(); ++i)
      CHECK(std::vector<std::string>(rows[i].begin(), rows[i].begin() + std::min<std::size_t>(N, rows[i].size()))
                == before[i],
            "row %zu: the census fields changed", i);
    CHECK(t.rows == 9 && t.triage == 2 && t.triage_eligible == 3, "tally rows %llu triage %llu eligible %llu",
          (unsigned long long)t.rows, (unsigned long long)t.triage, (unsigned long long)t.triage_eligible);
    CHECK(t.by_ident[1] == 2 && t.by_ident[0] == 5 && t.by_ident[2] == 2, "by_ident %llu %llu %llu",
          (unsigned long long)t.by_ident[0], (unsigned long long)t.by_ident[1], (unsigned long long)t.by_ident[2]);
    const auto tg = static_cast<std::size_t>(C::Status::Tagged);
    CHECK(t.by_status[tg][1] == 2 && t.by_status[tg][0] == 2 && t.by_status[tg][2] == 2, "tagged cross-tab");
    // A triage threshold of 0.001 keeps only the E = 0.001 spectrum.
    I::Index idx2;
    idx2.add(NID + "1", true);
    idx2.add(NID + "2", false);
    idx2.add("scan=6", true);
    idx2.add("a b", true);
    I::JoinTally t2;
    CHECK(I::joinTable(in, out, idx2, 0.001, t2, err) && t2.triage == 1, "triage at 0.001: %llu",
          (unsigned long long)t2.triage);
    // A census that gains columns (one before best_evalue, one at the end,
    // as a later phase may add) is joined by name: same identified and
    // triage, still the last two columns.
    {
      const std::string in2 = (dir / "c2.tsv").string(), out2 = (dir / "j2.tsv").string();
      auto widen = [&](const std::vector<std::string>& f, const std::string& a, const std::string& b) {
        std::string l;
        for (std::size_t j = 0; j < f.size(); ++j)
        {
          if (j == lay.best_evalue) l += a + "\t";
          l += f[j];
          l += j + 1 < f.size() ? "\t" : "";
        }
        return l + "\t" + b;
      };
      const std::string wide_head = widen(before[0], "ion_series", "extra");
      {
        std::ofstream f(in2, std::ios::binary);
        f << wide_head << '\n';
        for (std::size_t i = 1; i < before.size(); ++i) f << widen(before[i], "0.9", "x") << '\n';
      }
      I::Index wi;
      wi.add(NID + "1", true);
      wi.add(NID + "2", false);
      wi.add("scan=6", true);
      wi.add("a b", true);
      I::JoinTally wt;
      CHECK(I::joinTableAs(wide_head, in2, out2, wi, 0.01, wt, err), "wide join failed: %s", err.c_str());
      const auto wrows = table(slurp(out2));
      CHECK(wrows.size() == 10 && wrows[0].size() == N + 4 && wrows[0][N + 2] == "identified"
                && wrows[0][N + 3] == "triage",
            "wide header");
      for (std::size_t i = 0; i < want.size() && i + 1 < wrows.size(); ++i)
        CHECK(wrows[i + 1].size() == N + 4 && wrows[i + 1][N + 2] == want[i].first
                  && wrows[i + 1][N + 3] == want[i].second,
              "wide row %zu", i);
      CHECK(wt.triage == t.triage && wt.triage_eligible == t.triage_eligible && wt.by_ident == t.by_ident,
            "wide tally");
      // A header without best_evalue is an error, not a join.
      I::Index ni;
      I::JoinTally nt;
      CHECK(!I::joinTableAs("index\tspectrum\tstatus", in2, out2, ni, 0.01, nt, err), "joined without best_evalue");
    }
    // A table that is not a census table is an error, not a join.
    {
      std::ofstream f(in, std::ios::binary);
      f << "a\tb\n1\t2\n";
    }
    I::Index idx3;
    I::JoinTally t3;
    CHECK(!I::joinTable(in, out, idx3, 0.01, t3, err) && !err.empty(), "a foreign table was joined");

    // 6. The summary section.
    const I::Loaded L{10, 9, 4, 1, 12, 12, 0, 0, {"run"}, ""};
    const auto sum = I::summaryRows(L, idx.counts(), t, "/x/ids.idXML", "match", 0.01, 0.01, true);
    auto find = [&](const std::vector<FASTag::Digest::Row>& v, const std::string& k) -> const FASTag::Digest::Row* {
      for (const auto& r : v) if (r.key == k) return &r;
      return nullptr;
    };
    for (const auto& r : sum) CHECK(r.section == "census_ids", "row %s not in census_ids", r.key.c_str());
    CHECK(find(sum, "census_ids_version") && find(sum, "census_ids_version")->value == "1", "version");
    CHECK(find(sum, "ids_file") && find(sum, "ids_file")->value == "ids.idXML", "ids_file is the file name");
    CHECK(find(sum, "identified_1") && find(sum, "identified_1")->value == "2", "identified_1");
    CHECK(find(sum, "identified_0") && find(sum, "identified_0")->value == "5", "identified_0");
    CHECK(find(sum, "identified_unknown") && find(sum, "identified_unknown")->value == "2", "identified_unknown");
    CHECK(find(sum, "triage_candidates") && find(sum, "triage_candidates")->value == "2", "triage_candidates");
    for (std::size_t s = 0; s < C::kStatusCount; ++s)
      for (const char* k : {"1", "0", "unknown"})
      {
        const std::string key = std::string(C::name(static_cast<C::Status>(s))) + "_identified_" + k;
        CHECK(find(sum, key), "missing %s", key.c_str());
      }
    CHECK(find(sum, "tagged_identified_1")->value == "2", "tagged_identified_1");
    CHECK(find(sum, "refs_unmatched") && !find(sum, "refs_unmatched")->value.empty(), "refs_unmatched");
    CHECK(find(sum, "run_check") && find(sum, "run_check")->value == "match", "run_check");
    CHECK(find(sum, "id_no_ref") && find(sum, "id_no_ref")->value == "0", "id_no_ref");
    const auto sub = I::summaryRows(L, idx.counts(), t, "ids.idXML", "match", 0.01, 0.01, false);
    CHECK(find(sub, "refs_unmatched") && find(sub, "refs_unmatched")->value.empty(),
          "refs_unmatched written under subsampling");
    for (const auto& r : sum) CHECK(r.description.find('\t') == std::string::npos, "tab in %s", r.key.c_str());
    std::filesystem::remove_all(dir);
    std::printf("5. join and 6. summary\n");
  }

  std::printf(failures ? "\n%d FAILURES\n" : "\nall checks passed\n", failures);
  return failures ? 1 : 0;
}
