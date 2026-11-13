// FASTag 1.12 #3g: the alkylation call from the reconciler's placements
// (src/AlkylationCall.h). Synthetic placements only; nothing is fitted.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "AlkylationCall.h"
#include "Sha256.h"

#include <OpenMS/CHEMISTRY/ModificationsDB.h>
#include <OpenMS/CHEMISTRY/ResidueModification.h>

#include <cmath>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <set>
#include <string>
#include <vector>

namespace A = FASTag::Alkylation;
namespace D = FASTag::Digest;

static int failures = 0;
static void check(bool ok, const std::string& what)
{
  if (!ok) { std::cerr << "FAIL: " << what << "\n"; ++failures; }
}

static double mod(const char* id) { return OpenMS::ModificationsDB::getInstance()->getModification(id)->getDiffMonoMass(); }

static A::Settings settings(double fixed_c)
{
  A::Settings s;
  s.fixed_c = fixed_c;
  s.met_oxidation = mod("Oxidation (M)");
  std::vector<std::pair<char, double>> fixed;
  if (fixed_c != 0) fixed.emplace_back('C', fixed_c);
  s.residue_mass = A::residueMasses(fixed);
  return s;
}
/// A placement of the 4-residue tag at @p pos; @p side 'N' or 'C' carries
/// @p gap, 'E' is exact.
static A::Placement place(const char* pep, int pos, char side, double gap = 0.0, std::size_t start = 10)
{
  A::Placement p;
  p.peptide = pep;
  p.start = start;
  p.tag_pos = pos;
  p.tag_len = 4;
  p.nterm_match = side != 'N';
  p.cterm_match = side != 'C';
  p.gap = side == 'E' ? 0.0 : gap;
  return p;
}
static std::string formOf(const A::Eval& e, const std::vector<A::Form>& f)
{
  if (e.outcome != A::Outcome::BINNED) return A::outcomeName(e.outcome);
  return f[static_cast<std::size_t>(e.form)].name;
}
static A::Tally tally(std::uint64_t cam, std::uint64_t none, std::uint64_t prop = 0)
{
  A::Tally t;
  t.cls[A::CARBAMIDOMETHYL] = cam;
  t.cls[A::NONE] = none;
  t.cls[A::PROPIONAMIDE] = prop;
  return t;
}
static std::string callOf(const A::Tally& t, const A::Settings& s)
{
  const A::Call c = A::callAlkylation(t, s);
  return c.called ? std::string("call ") + A::className(c.cls) : "no_call " + c.reason;
}
/// Votes of @p n spectra, each with one tag of one placement.
static void vote(A::Tally& t, const A::Placement& p, int n, const A::Settings& s, const std::vector<A::Form>& f)
{
  for (int i = 0; i < n; ++i)
  {
    const A::Vote v = A::tagVote({A::evaluate(p, s, f)}, f, t.outcomes);
    t.add(v);
  }
}
static std::string value(const std::vector<D::Row>& rows, const std::string& section, const std::string& key)
{
  for (const D::Row& r : rows)
    if (r.section == section && r.key == key) return r.value;
  return "<missing " + section + " " + key + ">";
}

int main()
{
  const std::vector<A::Form> forms = A::forms();
  const double CAM = mod("Carbamidomethyl (C)"), PROP = mod("Propionamide (C)"), OX = mod("Oxidation (M)");
  const double TRIOX = mod("Trioxidation (C)");
  check(forms.size() == static_cast<std::size_t>(A::NUM_FORMS), "eleven Cys forms");
  check(forms[0].name == "Carbamidomethyl" && std::fabs(forms[0].mass - 57.021464) < 1e-5, "CAM from ModificationsDB");
  {
    int none = 0;
    for (const A::Form& f : forms) none += f.cls == A::NONE;
    check(none == 6, "six forms in the not-alkylated family");
    std::set<std::string> want = {"unmodified", "Oxidation", "Dioxidation", "Trioxidation", "Cysteinyl", "Dehydroalanine"};
    for (const A::Form& f : forms)
      if (f.cls == A::NONE) check(want.count(f.name) == 1, "family member " + f.name);
  }

  // ---- the call rule
  {
    const A::Settings s = settings(CAM);
    check(callOf(tally(30, 2), s) == "call Carbamidomethyl", "CAM 30/2 is Carbamidomethyl");
    check(callOf(tally(3, 25), s) == "call none", "none 25/3 is none");
    check(callOf(tally(15, 12), s) == "no_call ambiguous", "15/12 is ambiguous");
    check(callOf(tally(6, 2), s) == "no_call few_cys_spectra", "fewer than 10 binned is few_cys_spectra");
    check(callOf(tally(10, 10), s) == "no_call ambiguous", "a tie is ambiguous");
    check(callOf(tally(9, 1), s) == "no_call ambiguous", "the leading class below 10 spectra is ambiguous");
    A::Settings strict = s;
    strict.min_share = 0.9;  // 30/32 = 0.9375 passes, 30/34 = 0.882 does not
    check(callOf(tally(30, 2), strict) == "call Carbamidomethyl" && callOf(tally(30, 4), strict) == "no_call ambiguous",
          "-alkylation_min_share is the share bound");
    check(callOf(tally(30, 2), s) == "call Carbamidomethyl" && callOf(tally(30, 4), s) == "call Carbamidomethyl",
          "at the default share 0.6 both are calls");
  }

  // ---- placements under a fixed CAM: the reagent is gap + 57.021
  {
    const A::Settings s = settings(CAM);
    const char* pep = "PDCAGLLTEVK";  // C at 2, tag LLTE at 5..8, N side PDCAG
    check(formOf(A::evaluate(place(pep, 5, 'E'), s, forms), forms) == "Carbamidomethyl",
          "fixed CAM, exact placement: the C carries 57.021, Carbamidomethyl");
    check(formOf(A::evaluate(place(pep, 5, 'N', -CAM), s, forms), forms) == "unmodified",
          "fixed CAM, N-side gap -57.021: unmodified");
    check(formOf(A::evaluate(place(pep, 5, 'N', TRIOX - CAM), s, forms), forms) == "Trioxidation",
          "fixed CAM, gap trioxidation - 57.021: Trioxidation");
    check(formOf(A::evaluate(place(pep, 5, 'N', CAM), s, forms), forms) == "unexplained",
          "N-terminal over-alkylation (+57.021 on top of CAM) bins to no form");
    check(formOf(A::evaluate(place(pep, 5, 'C', -CAM), s, forms), forms) == "cys_outside_region",
          "a gap on the side without the C is excluded");
    check(formOf(A::evaluate(place(pep, 5, 'N', -CAM, 0), s, forms), forms) == "protein_nterm",
          "a gap at the protein N-terminus is excluded");
    check(formOf(A::evaluate(place("PCDCALLTEVK", 5, 'E'), s, forms), forms) == "multi_cys", "a 2-Cys peptide is excluded");
    check(formOf(A::evaluate(place("PDAAGLLCEVK", 5, 'E'), s, forms), forms) == "cys_in_tag", "a C inside the tag is excluded");
    check(formOf(A::evaluate(place("PDAAGLLTEVK", 5, 'E'), s, forms), forms) == "no_cys", "a C-free peptide is excluded");
    // the C-terminal side: tag LLTE at 0..3, C at 6
    check(formOf(A::evaluate(place("LLTEPDCAGK", 0, 'C', -CAM), s, forms), forms) == "unmodified",
          "C-side gap -57.021: unmodified");
    // the reported reagent mass
    check(std::fabs(A::evaluate(place(pep, 5, 'N', -CAM), s, forms).reagent) < 1e-9, "reagent = gap + fixed C");
  }

  // ---- the reagent with and without a fixed CAM
  {
    const A::Settings s = settings(0.0);
    const char* pep = "PDCAGLLTEVK";
    check(formOf(A::evaluate(place(pep, 5, 'E'), s, forms), forms) == "unmodified",
          "no fixed C mod, exact placement: unmodified");
    check(formOf(A::evaluate(place(pep, 5, 'N', CAM), s, forms), forms) == "Carbamidomethyl",
          "no fixed C mod, gap +57.021: Carbamidomethyl");
    check(formOf(A::evaluate(place(pep, 5, 'N', PROP), s, forms), forms) == "Propionamide",
          "no fixed C mod, gap +71.037: Propionamide");
  }

  // ---- truncation guard: a product one G (CAM) or one A (Propionamide) shorter
  {
    const A::Settings cam = settings(CAM);
    check(formOf(A::evaluate(place("GDCAPLLTEVK", 5, 'N', -57.02146), cam, forms), forms) == "truncation",
          "fixed CAM, gap -G at the outermost G: truncation, not unmodified");
    check(formOf(A::evaluate(place("PDCAGLLTEVK", 5, 'N', -57.02146), cam, forms), forms) == "unmodified",
          "the same gap with a G inside the region (not outermost) counts");
    const A::Settings prop = settings(PROP);
    check(formOf(A::evaluate(place("ADCPGLLTEVK", 5, 'N', -71.03711), prop, forms), forms) == "truncation",
          "fixed Propionamide, gap -A at the outermost A: truncation");
    check(formOf(A::evaluate(place("PDCAGLLTEVK", 5, 'N', -71.03711), prop, forms), forms) == "unmodified",
          "fixed Propionamide, gap -71.037 without an outer A: unmodified");
    check(formOf(A::evaluate(place("GADCPLLTEVK", 5, 'N', -(57.02146 + 71.03711)), cam, forms), forms) == "truncation",
          "the two outermost residues (GA) are guarded too");
    check(formOf(A::evaluate(place("LLTEPDCAGK", 0, 'C', -128.09496), cam, forms), forms) == "truncation",
          "C side: the outermost K is guarded");
  }

  // ---- M in the gap region: with and without +15.995
  {
    const A::Settings s = settings(CAM);
    check(formOf(A::evaluate(place("MDCAPLLTEVK", 5, 'N', OX), s, forms), forms) == "Carbamidomethyl",
          "gap +15.995 with an M: CAM with oxidised Met");
    check(formOf(A::evaluate(place("PDCAPLLTEVK", 5, 'N', OX), s, forms), forms) == "unexplained",
          "gap +15.995 without an M: no form (73.016)");
    check(formOf(A::evaluate(place("MDCAPLLTEVK", 5, 'N', OX - CAM), s, forms), forms) == "Oxidation",
          "an M and Cys oxidation or Met oxidation: both readings are not alkylated");
    std::vector<A::Form> two = {A::Form{"X73", "", CAM + OX, A::PROPIONAMIDE}, A::Form{"Carbamidomethyl", "", CAM, A::CARBAMIDOMETHYL}};
    check(formOf(A::evaluate(place("MDCAPLLTEVK", 5, 'N', OX), s, two), two) == "met_ambiguous",
          "an M whose two readings are two classes is excluded");
    check(formOf(A::evaluate(place("PDCAPLLTEVK", 5, 'N', OX), s, two), two) == "X73", "without an M there is one reading");
  }

  // ---- a fixed N-terminal label (TMT): the gap on the N side carries it
  {
    const double TMT = mod("TMT6plex (N-term)");
    A::Settings s = settings(CAM);
    s.fixed_term_n = TMT;
    const char* pep = "PDCAGLLTEVK";  // C on the N side
    check(formOf(A::evaluate(place(pep, 5, 'N', TMT), s, forms), forms) == "Carbamidomethyl",
          "fixed TMT N-term, N-side gap = TMT, C on the N side: label-exact, Carbamidomethyl");
    check(formOf(A::evaluate(place("PDAAGLLTECK", 5, 'N', TMT), s, forms), forms) == "Carbamidomethyl",
          "fixed TMT N-term, gap = TMT + 0 on a C-free N side, C on the C side: label-exact, counts");
    check(formOf(A::evaluate(place(pep, 5, 'N', TMT - CAM), s, forms), forms) == "unmodified",
          "fixed TMT N-term, gap = TMT - 57.021: unmodified");
    check(formOf(A::evaluate(place(pep, 5, 'N', TMT + TRIOX - CAM), s, forms), forms) == "Trioxidation",
          "fixed TMT N-term, gap = TMT + trioxidation - 57.021: Trioxidation");
    check(A::evaluate(place(pep, 5, 'N', TMT - CAM), s, forms).reagent == (TMT - CAM - TMT) + CAM,
          "reagent = (gap - label) + fixed C delta");
    check(formOf(A::evaluate(place("PDAAGLLTECK", 5, 'N', TMT - CAM), s, forms), forms) == "cys_outside_region",
          "fixed TMT N-term, a gap beyond the label on the side without the C is excluded");
    check(formOf(A::evaluate(place(pep, 5, 'C', TMT), s, forms), forms) == "cys_outside_region",
          "an N-term label is not taken off a C-side gap");
    check(formOf(A::evaluate(place(pep, 5, 'N', TMT - CAM, 0), s, forms), forms) == "protein_nterm",
          "fixed TMT N-term: a gapped placement at the protein N-terminus is still excluded");
    // the same placements without the label setting: the 1.12 r2 behaviour
    const A::Settings plain = settings(CAM);
    check(formOf(A::evaluate(place(pep, 5, 'N', TMT), plain, forms), forms) == "unexplained",
          "without fixed_term_n the label reads as an unexplained gap");
    // a C-terminal label on the C side
    A::Settings sc = settings(CAM);
    sc.fixed_term_c = 10.0;
    check(formOf(A::evaluate(place("PDAAGLLTECK", 5, 'C', 10.0), sc, forms), forms) == "Carbamidomethyl" &&
              formOf(A::evaluate(place("PDAAGLLTECK", 5, 'C', 10.0 - CAM), sc, forms), forms) == "unmodified",
          "fixed C-term label: taken off a C-side gap");
    // a labelled run's call: CAM on the N side read through the label
    A::Tally t;
    vote(t, place(pep, 5, 'N', TMT), 20, s, forms);
    vote(t, place("PDAAGLLTECK", 5, 'N', TMT), 10, s, forms);
    check(callOf(t, s) == "call Carbamidomethyl" && t.unexplained == 0, "a TMT-labelled CAM run is called Carbamidomethyl");
  }

  // ---- addTag: one call per tag, the spectrum's best tag votes
  {
    const A::Settings s = settings(CAM);
    auto rec = [](const char* pep, char side, double gap) {
      FASTag::Reconciliation r;
      r.peptide = pep;
      r.start = 10;
      r.pos = 5;
      r.tag_len = 4;
      r.nterm_match = side != 'N';
      r.cterm_match = side != 'C';
      r.delta_mass = side == 'E' ? 0.0 : gap;
      return r;
    };
    A::Tally t;
    A::Vote sv;
    A::addTag(t, sv, {rec("PDCAGLLTEVK", 'N', -CAM)}, 0.5, s, forms);  // unmodified
    A::addTag(t, sv, {rec("PDCAGLLTEVK", 'E', 0)}, 0.1, s, forms);     // CAM, better E
    A::addTag(t, sv, {rec("PDAAGLLTEVK", 'E', 0)}, 0.01, s, forms);    // no C: no vote
    A::addTag(t, sv, {}, 0.001, s, forms);                             // no placement
    check(t.tags == 4 && sv.have && sv.cls == A::CARBAMIDOMETHYL && sv.evalue == 0.1,
          "addTag: every tag counted, the best tag with a counted placement votes");
    check(t.outcomes[static_cast<std::size_t>(A::Outcome::NO_CYS)] == 1 && t.outcomes[static_cast<std::size_t>(A::Outcome::BINNED)] == 2,
          "addTag: placement outcomes counted");
    A::addSpectrum(t, sv);
    A::addSpectrum(t, A::Vote());
    check(t.spectra == 1 && t.cls[A::CARBAMIDOMETHYL] == 1, "addSpectrum: one vote per spectrum, none without one");
    check(A::countsTag(false, 1.0) && !A::countsTag(true, 0.1) && !A::countsTag(false, 1.5), "countsTag: ungapped, E <= 1");
  }

  // ---- votes and run-level calls from placements
  {
    const A::Settings s = settings(CAM);
    std::array<std::uint64_t, static_cast<int>(A::Outcome::COUNT)> oc{};
    const A::Eval cam = A::evaluate(place("PDCAGLLTEVK", 5, 'E'), s, forms);
    const A::Eval un = A::evaluate(place("PDCAGLLTEVK", 5, 'N', -CAM), s, forms);
    const A::Eval ox = A::evaluate(place("PDCAGLLTEVK", 5, 'N', OX - CAM), s, forms);
    const A::Eval two = A::evaluate(place("PCDCALLTEVK", 5, 'E'), s, forms);
    const A::Vote c = A::tagVote({cam, un}, forms, oc);
    check(c.have && c.conflict, "placements of two classes: a conflict");
    const A::Vote f = A::tagVote({un, ox}, forms, oc);
    check(f.have && !f.conflict && f.cls == A::NONE && f.form == -1, "two family forms: class none, no single form");
    const A::Vote n = A::tagVote({two}, forms, oc);
    check(!n.have, "no counted placement: no vote");
    check(oc[static_cast<std::size_t>(A::Outcome::MULTI_CYS)] == 1 && oc[static_cast<std::size_t>(A::Outcome::BINNED)] == 4,
          "outcome counts");

    // a CAM run with N-terminal over-alkylation stays CAM
    A::Tally t;
    vote(t, place("PDCAGLLTEVK", 5, 'E'), 30, s, forms);
    vote(t, place("PDCAGLLTEVK", 5, 'N', CAM), 12, s, forms);
    check(t.unexplained == 12 && callOf(t, s) == "call Carbamidomethyl", "over-alkylated CAM run stays Carbamidomethyl");
    // an unalkylated run dominated by trioxidation is none
    A::Tally u;
    vote(u, place("PDCAGLLTEVK", 5, 'N', TRIOX - CAM), 20, s, forms);
    vote(u, place("PDCAGLLTEVK", 5, 'N', -CAM), 5, s, forms);
    vote(u, place("PDCAGLLTEVK", 5, 'E'), 2, s, forms);
    check(callOf(u, s) == "call none", "a trioxidation-dominated unalkylated run is none");
    check(u.form[8] == 20 && u.form[5] == 5 && u.form[0] == 2, "votes per form");
    // merge adds
    A::Tally m;
    m.merge(t);
    m.merge(u);
    check(m.spectra == t.spectra + u.spectra && m.cls[A::NONE] == t.cls[A::NONE] + u.cls[A::NONE] &&
              m.outcomes[0] == t.outcomes[0] + u.outcomes[0],
          "merge adds every count");

    // the report rows
    A::ReportInfo info{"db.fasta", "proteome", "Carbamidomethyl"};
    const auto rows = A::alkylationRows(t, A::callAlkylation(t, s), s, forms, info);
    std::set<std::string> sections;
    bool full = true;
    std::string call_keys;
    for (const D::Row& r : rows)
    {
      sections.insert(r.section);
      full = full && !r.key.empty() && !r.value.empty() && !r.n.empty() && !r.description.empty();
      if (r.section == "alkylation_call") call_keys += (call_keys.empty() ? "" : ",") + r.key;
    }
    check(sections == std::set<std::string>{"alk_run", "alk_cys", "alkylation_call"},
          "sections alk_run, alk_cys, alkylation_call only (never run or cys)");
    check(full, "every field filled");
    check(call_keys == "status,reagent,mass,share,reason", "alkylation_call keys in order: " + call_keys);
    check(value(rows, "alk_run", "format") == "1" && value(rows, "alkylation_call", "reagent") == "Carbamidomethyl" &&
              value(rows, "alk_cys", "class.Carbamidomethyl") == "30" && value(rows, "alk_cys", "unexplained") == "12",
          "report values");
    check(value(rows, "alkylation_call", "mass") == D::num(CAM), "reagent mass row");
    // 1.13 (#24): database_release only for a shipped proteome, right after database_source
    check(value(rows, "alk_run", "database_release").rfind("<missing", 0) == 0,
          "no database_release row for a database that is not shipped");
    A::ReportInfo binfo = info;
    binfo.database_source = "bundled:yeast";
    binfo.database_release = "UniProt 2026_04 UP000002311 (taxon 559292, reviewed, 6067 entries, sha256 ab)";
    const auto brows = A::alkylationRows(t, A::callAlkylation(t, s), s, forms, binfo);
    check(brows.size() == rows.size() + 1, "a shipped proteome adds exactly one row");
    std::size_t src_at = 0;
    for (std::size_t i = 0; i < brows.size(); ++i)
      if (brows[i].section == "alk_run" && brows[i].key == "database_source") src_at = i;
    check(src_at + 1 < brows.size() && brows[src_at + 1].key == "database_release" &&
              brows[src_at + 1].value == binfo.database_release && brows[src_at + 1].n == "-",
          "database_release follows database_source with the release");
    const auto none_rows = A::alkylationRows(A::Tally(), A::callAlkylation(A::Tally(), s), s, forms, info);
    check(value(none_rows, "alkylation_call", "status") == "no_call" &&
              value(none_rows, "alkylation_call", "reason") == "few_cys_spectra" &&
              value(none_rows, "alkylation_call", "share") == "-",
          "an empty run: no_call few_cys_spectra");
    check(rows.size() == none_rows.size(), "the same rows whatever the counts");
    check(value(rows, "alk_cys", "excluded.non_by") == "0" && value(rows, "alk_run", "fixed_nterm_delta") == "0" &&
              value(rows, "alk_run", "fixed_cterm_delta") == "0",
          "excluded.non_by 0 and no terminal label by default");
    A::Tally nb = t;
    nb.excludeNonBy();
    nb.excludeNonBy();
    A::Tally nbm;
    nbm.merge(nb);
    const auto nb_rows = A::alkylationRows(nbm, A::callAlkylation(nbm, s), s, forms, info);
    check(value(nb_rows, "alk_cys", "excluded.non_by") == "2" && nb_rows.size() == rows.size(),
          "excluded.non_by counts the c/z tags and merges");
    // the row order of alk_cys ends with the excluded rules, then non_by
    std::string last_cys;
    for (const D::Row& r : rows)
      if (r.section == "alk_cys") last_cys = r.key;
    check(last_cys == "excluded.non_by", "excluded.non_by is the last alk_cys row");
  }

  // ---- FASTA reading (plain; .gz is covered by digest_cli_test)
  {
    const std::string path = "alkylation_test.fasta";
    std::ofstream(path) << ">sp|P1|ONE first protein\nPEPT\nIDEK\n>P2\nACDK\n";
    std::vector<OpenMS::FASTAFile::FASTAEntry> e;
    A::loadFasta(path, e);
    check(e.size() == 2 && e[0].identifier == "sp|P1|ONE" && e[0].sequence == "PEPTIDEK" && e[1].sequence == "ACDK",
          "plain FASTA read");
    std::remove(path.c_str());
  }

  // ---- 1.13 (#24): the shipped proteomes' manifest
  {
    const std::string A64(64, 'a'), B64(64, 'b'), C64(64, 'c'), D64(64, 'd'), E64(64, 'e'), F64(64, 'f');
    const std::string hdr = "name\tproteome\ttaxon\trelease\trelease_date\tentries\tsha256\tfasta_sha256\tfile\n";
    const std::string human = "human\tUP000005640\t9606\t2026_04\t04-November-2026\t20414\t" + A64 + "\t" + B64 + "\thuman.fasta.gz\n";
    const std::string yeast = "yeast\tUP000002311\t559292\t2026_04\t04-November-2026\t6067\t" + C64 + "\t" + D64 + "\tyeast.fasta.gz\r\n";
    A::ShippedProteome sp;
    check(A::findShippedProteome(hdr + human + yeast, "yeast", sp) && sp.proteome == "UP000002311" &&
              sp.taxon == "559292" && sp.release == "2026_04" && sp.entries == 6067 && sp.sha256 == C64 &&
              sp.fasta_sha256 == D64 && sp.file == "yeast.fasta.gz",
          "manifest row read (CRLF tolerated)");
    check(A::shippedRelease(sp) == "UniProt 2026_04 UP000002311 (taxon 559292, reviewed, 6067 entries, FASTA sha256 " + D64 + ")",
          "release value: " + A::shippedRelease(sp));
    A::ShippedProteome none;
    check(!A::findShippedProteome(hdr + human, "mouse", none) && none.entries == 0, "a name without a row");
    check(!A::findShippedProteome(hdr + human + human, "human", none), "two rows for one name");
    check(!A::findShippedProteome(human, "human", none), "no header");
    check(!A::findShippedProteome("name\tproteome\tfile\n" + human, "human", none), "a header without the columns");
    check(!A::findShippedProteome(hdr + "human\tUP1\t9606\t2026_04\td\t0\t" + A64 + "\t" + B64 + "\thuman.fasta.gz\n", "human", none),
          "zero entries");
    check(!A::findShippedProteome(hdr + "human\tUP1\t9606\t2026_04\td\t2x\t" + A64 + "\t" + B64 + "\thuman.fasta.gz\n", "human", none),
          "entries not a number");
    check(!A::findShippedProteome(hdr + "human\tUP1\t9606\t2026_04\td\t5\t" + A64 + "\t" + B64 + "\t../x.fasta.gz\n", "human", none),
          "a file with a path");
    check(!A::findShippedProteome(hdr + "human\tUP1\t9606\t2026_04\td\t5\t" + A64 + "\t" + B64 + "\t..\n", "human", none),
          "a file named ..");
    check(!A::findShippedProteome(hdr + "human\tUP1\t9606\t\td\t5\t" + A64 + "\t" + B64 + "\th.fasta.gz\n", "human", none),
          "an empty release");
    // the sha256 is checked against the file at run time: it must be one
    check(!A::findShippedProteome(hdr + "human\tUP1\t9606\t2026_04\td\t5\tab\t" + B64 + "\th.fasta.gz\n", "human", none),
          "a sha256 that is not 64 hex digits");
    check(!A::findShippedProteome(hdr + "human\tUP1\t9606\t2026_04\td\t5\t" + std::string(64, 'A') + "\t" + B64 + "\th.fasta.gz\n",
                                  "human", none),
          "an upper-case sha256 (sha256sum prints lower case)");
    check(!A::findShippedProteome(hdr + "human\tUP1\t9606\t2026_04\td\t5\t" + std::string(63, 'a') + "g\t" + B64 + "\th.fasta.gz\n",
                                  "human", none),
          "a sha256 with a non-hex digit");
    check(!A::findShippedProteome(hdr + "human\tUP1\t9606\t2026_04\td\t5\t" + A64 + "\tbb\th.fasta.gz\n", "human", none),
          "a fasta_sha256 that is not 64 hex digits");
    // columns in another order and a comment line
    const std::string reord = "# shipped\nfile\tname\tentries\trelease\trelease_date\tproteome\ttaxon\tsha256\tfasta_sha256\n"
                              "e.fasta.gz\tecoli\t4403\t2026_04\td\tUP000000625\t83333\t" + E64 + "\t" + F64 + "\n";
    check(A::findShippedProteome(reord, "ecoli", sp) && sp.file == "e.fasta.gz" && sp.entries == 4403 &&
              sp.proteome == "UP000000625",
          "columns found by name");
  }

  // ---- 1.13 (#24): SHA-256 (FIPS 180-4 test vectors), and of a file
  {
    auto hex = [](const std::string& m) { FASTag::Sha256 h; h.update(m.data(), m.size()); return h.hexDigest(); };
    check(hex("") == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "sha256 of the empty string");
    check(hex("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "sha256 of abc");
    check(hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq") ==
              "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
          "sha256 of the two-block message");
    FASTag::Sha256 mill;
    const std::string chunk(1000, 'a');
    for (int k = 0; k < 1000; ++k)
    {
      mill.update(chunk.data(), 0);  // an empty update changes nothing
      mill.update(chunk.data(), chunk.size());
    }
    check(mill.hexDigest() == "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0", "sha256 of a million a");
    // split across every block boundary the same as in one piece
    const std::string m = "The quick brown fox jumps over the lazy dog, then over the lazy dog again and again.";
    for (std::size_t cut = 0; cut <= m.size(); ++cut)
    {
      FASTag::Sha256 h;
      h.update(m.data(), cut);
      h.update(m.data() + cut, m.size() - cut);
      if (h.hexDigest() != hex(m)) { check(false, "sha256 split at " + std::to_string(cut)); break; }
    }
    const std::string path = "alkylation_test.sha";
    std::ofstream(path, std::ios::binary) << "abc";
    check(FASTag::sha256File(path) == hex("abc"), "sha256File");
    std::remove(path.c_str());
    check(FASTag::sha256File("alkylation_test.no-such-file").empty(), "sha256File of a missing file is empty");
    const std::string fa = "alkylation_test_sha.fasta";
    const std::string text = ">P1 one\nACDK\n";
    std::ofstream(fa, std::ios::binary) << text;
    std::vector<OpenMS::FASTAFile::FASTAEntry> fe;
    std::string got;
    A::loadFasta(fa, fe, &got);
    check(fe.size() == 1 && got == hex(text), "loadFasta: sha256 of a plain FASTA");
    std::remove(fa.c_str());
    check(FASTag::isSha256Hex(hex("abc")) && !FASTag::isSha256Hex("abc") && !FASTag::isSha256Hex(std::string(64, 'G')),
          "isSha256Hex");
  }

  // ---- 1.13 (#24): tags too short to place on a shipped proteome
  {
    const A::Settings s = settings(0.0);
    const std::vector<A::Form> forms = A::forms();
    A::Call c = A::callAlkylation(A::Tally(), s);
    check(!A::markTagsTooShort(c, 8, 8) && c.reason == "few_cys_spectra", "tags as long as the minimum: few_cys_spectra");
    check(!A::markTagsTooShort(c, 3, 0) && c.reason == "few_cys_spectra", "no minimum known: unchanged");
    check(A::markTagsTooShort(c, 3, 8) && c.reason == "tags_too_short", "tags of 3 on a minimum of 8: tags_too_short");
    A::Tally t = tally(30, 0);
    A::Call called = A::callAlkylation(t, s);
    check(called.called && !A::markTagsTooShort(called, 3, 8) && called.reason == "-", "a call is never changed");
    A::ReportInfo info{"h.fasta.gz", "bundled:human", "", "UniProt x"};
    info.min_tag_length = 8;
    info.longest_tag = 3;
    const auto rows = A::alkylationRows(A::Tally(), c, s, forms, info);
    check(value(rows, "alk_run", "min_tag_length") == "8" && value(rows, "alkylation_call", "reason") == "tags_too_short" &&
              value(rows, "alkylation_call", "status") == "no_call",
          "min_tag_length row and the tags_too_short reason");
    bool says = false;
    for (const D::Row& r : rows)
      if (r.section == "alk_run" && r.key == "min_tag_length")
        says = r.n == "3" && r.description.find("give -tag_length 8 or more") != std::string::npos;
    check(says, "min_tag_length names the longest tag and the -tag_length to give");
    A::ReportInfo plain{"db.fasta", "proteome", ""};
    const auto prow = A::alkylationRows(A::Tally(), A::callAlkylation(A::Tally(), s), s, forms, plain);
    check(value(prow, "alk_run", "min_tag_length").rfind("<missing", 0) == 0 && prow.size() + 2 == rows.size(),
          "no min_tag_length row without a shipped proteome");
  }

  if (failures) std::cerr << failures << " failure(s)\n";
  else std::cout << "alkylation_test: all checks passed\n";
  return failures ? 1 : 0;
}
