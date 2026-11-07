// FASTag 1.12 #3g: the alkylation call from the reconciler's placements
// (src/AlkylationCall.h). Synthetic placements only; nothing is fitted.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "AlkylationCall.h"

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
  if (e.outcome != A::Outcome::Binned) return A::outcomeName(e.outcome);
  return f[static_cast<std::size_t>(e.form)].name;
}
static A::Tally tally(std::uint64_t cam, std::uint64_t none, std::uint64_t prop = 0)
{
  A::Tally t;
  t.cls[A::Carbamidomethyl] = cam;
  t.cls[A::None] = none;
  t.cls[A::Propionamide] = prop;
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
  check(forms.size() == static_cast<std::size_t>(A::kNumForms), "eleven Cys forms");
  check(forms[0].name == "Carbamidomethyl" && std::fabs(forms[0].mass - 57.021464) < 1e-5, "CAM from ModificationsDB");
  {
    int none = 0;
    for (const A::Form& f : forms) none += f.cls == A::None;
    check(none == 6, "six forms in the not-alkylated family");
    std::set<std::string> want = {"unmodified", "Oxidation", "Dioxidation", "Trioxidation", "Cysteinyl", "Dehydroalanine"};
    for (const A::Form& f : forms)
      if (f.cls == A::None) check(want.count(f.name) == 1, "family member " + f.name);
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
    strict.min_share = 0.95;
    check(callOf(tally(30, 2), strict) == "call Carbamidomethyl" && callOf(tally(30, 3), strict) == "no_call ambiguous",
          "-alkylation_min_share is the share bound");
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
    std::vector<A::Form> two = {A::Form{"X73", "", CAM + OX, A::Propionamide}, A::Form{"Carbamidomethyl", "", CAM, A::Carbamidomethyl}};
    check(formOf(A::evaluate(place("MDCAPLLTEVK", 5, 'N', OX), s, two), two) == "met_ambiguous",
          "an M whose two readings are two classes is excluded");
    check(formOf(A::evaluate(place("PDCAPLLTEVK", 5, 'N', OX), s, two), two) == "X73", "without an M there is one reading");
  }

  // ---- votes and run-level calls from placements
  {
    const A::Settings s = settings(CAM);
    std::array<std::uint64_t, static_cast<int>(A::Outcome::kCount)> oc{};
    const A::Eval cam = A::evaluate(place("PDCAGLLTEVK", 5, 'E'), s, forms);
    const A::Eval un = A::evaluate(place("PDCAGLLTEVK", 5, 'N', -CAM), s, forms);
    const A::Eval ox = A::evaluate(place("PDCAGLLTEVK", 5, 'N', OX - CAM), s, forms);
    const A::Eval two = A::evaluate(place("PCDCALLTEVK", 5, 'E'), s, forms);
    const A::Vote c = A::tagVote({cam, un}, forms, oc);
    check(c.have && c.conflict, "placements of two classes: a conflict");
    const A::Vote f = A::tagVote({un, ox}, forms, oc);
    check(f.have && !f.conflict && f.cls == A::None && f.form == -1, "two family forms: class none, no single form");
    const A::Vote n = A::tagVote({two}, forms, oc);
    check(!n.have, "no counted placement: no vote");
    check(oc[static_cast<std::size_t>(A::Outcome::MultiCys)] == 1 && oc[static_cast<std::size_t>(A::Outcome::Binned)] == 4,
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
    check(m.spectra == t.spectra + u.spectra && m.cls[A::None] == t.cls[A::None] + u.cls[A::None] &&
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
    const auto none_rows = A::alkylationRows(A::Tally(), A::callAlkylation(A::Tally(), s), s, forms, info);
    check(value(none_rows, "alkylation_call", "status") == "no_call" &&
              value(none_rows, "alkylation_call", "reason") == "few_cys_spectra" &&
              value(none_rows, "alkylation_call", "share") == "-",
          "an empty run: no_call few_cys_spectra");
    check(rows.size() == none_rows.size(), "the same rows whatever the counts");
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

  if (failures) std::cerr << failures << " failure(s)\n";
  else std::cout << "alkylation_test: all checks passed\n";
  return failures ? 1 : 0;
}
