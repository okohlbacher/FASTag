// Mass-shift survey (1.16): site classes from site-determining evidence and
// the Unimod / PSI-MOD naming of -delta_out rows.
//
// Localization cases are synthetic b/y ladders of a database peptide (as in
// tagrecon_test); naming runs against OpenMS's own Unimod (ModificationsDB),
// a PSI-MOD fixture (test/fixtures/psimod_mini.obo) and the shipped
// PSI-MOD.obo.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "ShiftSurvey.h"
#include "TagRecon.h"

#include <OpenMS/CHEMISTRY/EmpiricalFormula.h>
#include <OpenMS/CHEMISTRY/Residue.h>
#include <OpenMS/CHEMISTRY/ResidueDB.h>
#include <OpenMS/CONCEPT/Constants.h>
#include <OpenMS/KERNEL/MSSpectrum.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <string>
#include <vector>

using namespace FASTag;
using namespace OpenMS;
namespace SS = FASTag::ShiftSurvey;

namespace
{
  int failures = 0;
  void check(bool ok, const std::string& what)
  {
    if (!ok) { std::cerr << "FAIL: " << what << "\n"; ++failures; }
  }
  double resMass(char c)
  {
    return ResidueDB::getInstance()->getResidue(std::string(1, c))->getMonoWeight(Residue::Internal);
  }
  double sumMass(const std::string& s)
  {
    double m = 0;
    for (char c : s) m += resMass(c);
    return m;
  }
  const double WATER = EmpiricalFormula("H2O").getMonoWeight();

  /// Singly charged b/y ladder of @p pep with @p mod on residue @p site;
  /// @p keep(kind, i) selects the ions written ('b'/'y', ion length i).
  template <class Keep>
  MSSpectrum ladder(const std::string& pep, size_t site, double mod, Keep keep)
  {
    MSSpectrum s;
    for (size_t i = 1; i < pep.size(); ++i)
    {
      const double b = sumMass(pep.substr(0, i)) + (site < i ? mod : 0.0);
      const double y = sumMass(pep.substr(pep.size() - i)) + WATER + (site >= pep.size() - i ? mod : 0.0);
      if (keep('b', i)) s.push_back(Peak1D(b + Constants::PROTON_MASS_U, 100.0f));
      if (keep('y', i)) s.push_back(Peak1D(y + Constants::PROTON_MASS_U, 100.0f));
    }
    s.sortByPosition();
    return s;
  }
  MSSpectrum ladder(const std::string& pep, size_t site, double mod)
  {
    return ladder(pep, site, mod, [](char, size_t) { return true; });
  }

  bool hasAcc(const std::vector<SS::Match>& ms, const std::string& acc, const std::string& site = "",
              const std::string& fixed = "-")
  {
    for (const auto& m : ms)
      if (m.entry->acc == acc && (site.empty() || std::find(m.sites.begin(), m.sites.end(), site) != m.sites.end()) &&
          (fixed == "-" || m.fixed == fixed))
        return true;
    return false;
  }
  SS::Site site(const std::string& key)
  {
    SS::Site s;
    if (!SS::parseSiteKey(key, s)) { std::cerr << "FAIL: bad site key " << key << "\n"; ++failures; }
    return s;
  }
}

int main(int argc, char** argv)
{
  const std::string fixtures = argc > 1 ? argv[1] : "test/fixtures";

  // ---------------------------------------------------------------- sites
  // PROT1 holds the peptide inside the protein; PROT2 starts with its own.
  const std::string pep = "SAMPLEVGATSDGK";
  const std::string pep2 = "SAMPLEVGATSDGR";
  std::vector<FASTAFile::FASTAEntry> entries;
  entries.emplace_back("PROT1", "inside", "MSTVWYAAR" + pep + "GTANLEFDSK");
  entries.emplace_back("PROT2", "at the start", pep2 + "GTANLEFDSK");
  ProteomeIndex idx;
  idx.build(entries, {}, 0);
  TagReconciler r(0.02, /*ppm=*/false, /*both=*/false);
  r.attach(&idx, 0, 4);
  const size_t pos = 4;  // tag LEVG; N-side region SAMP (0-3), C-side ATSDGK/R (8-13)
  const std::string tag = pep.substr(pos, 4);
  auto nside = [&](const std::string& p, double mod, const MSSpectrum* spec) {
    Reconciliation got;
    bool found = false;
    for (const auto& x : r.reconcile(tag, sumMass(p.substr(0, pos)) + mod, sumMass(p.substr(pos + 4)), spec, 2))
      if (x.peptide == p && x.pos == pos && !x.nterm_match && x.cterm_match) { got = x; found = true; }
    check(found, "placed " + p + " with an N-side gap");
    return got;
  };
  auto cside = [&](const std::string& p, double mod, const MSSpectrum* spec) {
    Reconciliation got;
    bool found = false;
    for (const auto& x : r.reconcile(tag, sumMass(p.substr(0, pos)), sumMass(p.substr(pos + 4)) + mod, spec, 2))
      if (x.peptide == p && x.pos == pos && x.nterm_match && !x.cterm_match) { got = x; found = true; }
    check(found, "placed " + p + " with a C-side gap");
    return got;
  };
  const double ox = 15.994915, ac = 42.010565;

  {  // a residue site, determined by its fragments
    const MSSpectrum s = ladder(pep, 2, ox);
    const Reconciliation x = nside(pep, ox, &s);
    SS::Site st;
    check(x.loc_pos == 2 && x.loc_alternatives == 3 && x.loc_evidence >= 1, "M3 determined, with evidence");
    check(SS::siteOf(x, st) && SS::siteKey(st) == "M", "site class M");
    check(!x.protein_nterm && !x.protein_cterm, "PROT1's peptide is internal");
    check(std::fabs(x.pep_mass - (sumMass(pep) + WATER)) < 1e-6, "peptide mass carried");
  }
  {  // zero evidence: no peaks, every site ties at 0
    const MSSpectrum empty;
    const Reconciliation x = nside(pep, ox, &empty);
    SS::Site st;
    check(x.loc_pos == 0 && x.loc_evidence == 0, "no peaks: no evidence");
    check(!SS::siteOf(x, st), "zero evidence is unlocalized (not N-term|S, the first of the tie)");
  }
  {  // a tie: only shifted b3, which sites 0, 1 and 2 all explain
    const MSSpectrum s = ladder(pep, 2, ox, [](char k, size_t i) { return k == 'b' && i == 3; });
    const Reconciliation x = nside(pep, ox, &s);
    SS::Site st;
    check(x.loc_ties == 3 && x.loc_evidence == 0, "b3 alone ties sites 0-2");
    check(!SS::siteOf(x, st), "a tied site is unlocalized");
  }
  {  // shared evidence only: unshifted y ions of the C-side are the same for every N-side site
    const MSSpectrum s = ladder(pep, 2, ox, [&](char k, size_t i) { return k == 'y' && i <= pep.size() - pos; });
    const Reconciliation x = nside(pep, ox, &s);
    SS::Site st;
    check(x.loc_score > 0 && x.loc_evidence == 0, "shared ions score but do not determine the site");
    check(!SS::siteOf(x, st), "shared-only evidence is unlocalized");
  }
  {  // the first residue: terminal-ambiguous, the protein's N-term on PROT2
    const MSSpectrum s1 = ladder(pep, 0, ac);
    const Reconciliation x1 = nside(pep, ac, &s1);
    SS::Site st;
    check(x1.loc_pos == 0 && x1.loc_evidence >= 1, "S1 determined against A2-P4");
    check(SS::siteOf(x1, st) && SS::siteKey(st) == "N-term|S", "an internal peptide's first residue is N-term|S");
    const MSSpectrum s2 = ladder(pep2, 0, ac);
    const Reconciliation x2 = nside(pep2, ac, &s2);
    check(x2.protein_nterm, "PROT2's peptide starts the protein");
    check(SS::siteOf(x2, st) && SS::siteKey(st) == "Protein N-term|S", "and its first residue is Protein N-term|S");
  }
  {  // the last residue of a C-side gap: C-term ambiguous
    const MSSpectrum s = ladder(pep, pep.size() - 1, ac);
    const Reconciliation x = cside(pep, ac, &s);
    SS::Site st;
    check(x.loc_pos == static_cast<int>(pep.size()) - 1 && x.loc_evidence >= 1, "K14 determined");
    check(SS::siteOf(x, st) && SS::siteKey(st) == "C-term|K", "the last residue is C-term|K");
  }
  {  // localize() after the fact equals localizing in reconcile()
    const MSSpectrum s = ladder(pep, 2, ox);
    Reconciliation late = nside(pep, ox, nullptr);
    check(late.loc_pos < 0, "no spectrum, no localization");
    r.localize(late, s, 2);
    const Reconciliation now = nside(pep, ox, &s);
    check(late.loc_pos == now.loc_pos && late.loc_score == now.loc_score && late.loc_evidence == now.loc_evidence &&
              late.loc_ties == now.loc_ties,
          "localize() reproduces reconcile()'s localization");
  }
  {
    SS::Site st;
    for (const char* k : {"K", "N-term|Q", "C-term|G", "Protein N-term|M", "Protein C-term|L"})
      check(SS::parseSiteKey(k, st) && SS::siteKey(st) == k, std::string("site key round trip ") + k);
    check(!SS::parseSiteKey("N-term", st) && !SS::parseSiteKey("", st), "malformed keys refused");
    check(SS::formatSites({{"S", 3}, {"K", 41}, {"N-term|K", 12}, {"A", 3}}) == "K:41,N-term|K:12,A:3,S:3",
          "sites by count, then key");
    check(SS::formatSites({}) == "-", "no sites: -");
  }

  // ---------------------------------------------------------------- Unimod
  const std::vector<SS::Entry> um = SS::unimodEntries();
  check(um.size() > 500, "Unimod entries enumerated from ModificationsDB");
  const double tol = 0.005;
  {
    const auto m = SS::match(um, ox + 0.0004, tol, {site("M")}, {}, 50);
    const SS::Match* oxm = nullptr;
    for (const auto& x : m)
      if (x.entry->acc == "UNIMOD:35" && x.sites == std::vector<std::string>{"M"}) oxm = &x;
    check(oxm != nullptr, "Oxidation@M names +15.995 on M");
    check(oxm && SS::format({*oxm}, false, 1000.0) == "Oxidation@M(+0.4ppm)", "format: name@site(ppm)");
    check(oxm && SS::format({*oxm}, false, 0.0) == "Oxidation@M(+0.4mDa)", "format: mDa without a ppm scale");
    check(SS::match(um, ox + 0.0004, tol, {site("M")}, {}, 1).size() == 1, "the cap holds");
    // One match per accession, its sites by support.
    const std::vector<std::uint64_t> support = {1, 5, 2};
    const auto g = SS::match(um, ox, tol, {site("W"), site("M"), site("N-term|M")}, {}, 50, &support);
    const SS::Match* gm = nullptr;
    size_t n35 = 0;
    for (const auto& x : g)
      if (x.entry->acc == "UNIMOD:35") { gm = &x; ++n35; }
    check(n35 == 1 && gm && gm->sites == std::vector<std::string>({"M", "W"}) && gm->support == 8,
          "Oxidation once, on M (5 + 2 from N-term|M) before W (1)");
    check(gm && SS::format({*gm}, false, 0.0) == "Oxidation@M/W(+0.0mDa)", "format: sites joined by /");
  }
  {  // wrong residue: Unimod has Oxidation on no A, and on G only at the C-term
    check(!hasAcc(SS::match(um, ox, tol, {site("A")}, {}, 50), "UNIMOD:35"), "Oxidation@A rejected");
    check(!hasAcc(SS::match(um, ox, tol, {site("G")}, {}, 50), "UNIMOD:35"), "Oxidation on residue G rejected");
    check(hasAcc(SS::match(um, ox, tol, {site("C-term|G")}, {}, 50), "UNIMOD:35", "C-term G"),
          "Oxidation@C-term G on a C-terminal G");
  }
  {  // terminal specificity: Acetyl (N-term, Protein N-term, K/S/T/...; not A)
    const auto inner = SS::match(um, ac, tol, {site("N-term|A")}, {}, 50);
    check(hasAcc(inner, "UNIMOD:1", "N-term"), "Acetyl@N-term on a peptide N-terminus");
    check(!hasAcc(inner, "UNIMOD:1", "Protein N-term"), "no Protein N-term entry on an internal peptide");
    check(hasAcc(SS::match(um, ac, tol, {site("Protein N-term|A")}, {}, 50), "UNIMOD:1", "Protein N-term"),
          "Acetyl@Protein N-term on the protein's N-terminus");
    check(!hasAcc(SS::match(um, ac, tol, {site("A")}, {}, 50), "UNIMOD:1"), "terminal entries never on a residue site");
    check(hasAcc(SS::match(um, ac, tol, {site("K")}, {}, 50), "UNIMOD:1", "K"), "Acetyl@K");
  }
  {  // fixed-mod reference: Cys->Dha is -33.988 vs Cys, -91.009 vs carbamidomethyl-Cys
    const std::vector<SS::FixedMod> cam = {{'C', 57.021464, "Carbamidomethyl"}};
    const auto onCam = SS::match(um, -91.009185, tol, {site("C")}, cam, 50);
    check(hasAcc(onCam, "UNIMOD:368", "C", "Carbamidomethyl"), "-91.009 on CAM-Cys: Cys->Dha instead of Carbamidomethyl");
    check(!hasAcc(SS::match(um, -91.009185, tol, {site("C")}, {}, 50), "UNIMOD:368"),
          "without the fixed mod -91.009 is no Cys->Dha");
    check(hasAcc(SS::match(um, -33.987721, tol, {site("C")}, {}, 50), "UNIMOD:368", "C", ""),
          "-33.988 on unmodified Cys: Cys->Dha");
    bool written = false;
    for (const auto& m : onCam)
      if (m.entry->acc == "UNIMOD:368")
        written = SS::format({m}, false, 0.0).find("@C[-Carbamidomethyl](") != std::string::npos;
    check(written, "the replaced fixed mod is written [-Carbamidomethyl]");
  }

  // ---------------------------------------------------------------- PSI-MOD
  {
    std::string err;
    const auto pm = SS::psimodEntries(fixtures + "/psimod_mini.obo", &err);
    check(err.empty(), "fixture read: " + err);
    check(pm.size() == 5, "5 of 8 fixture terms kept (obsolete, origin X anywhere, cross-link left out)");
    const SS::Entry* metO = nullptr;
    const SS::Entry* dha = nullptr;
    const SS::Entry* pyro = nullptr;
    for (const auto& e : pm)
    {
      if (e.acc == "MOD:00719") metO = &e;
      if (e.acc == "MOD:00189") dha = &e;
      if (e.acc == "MOD:00040") pyro = &e;
    }
    check(metO && metO->unimod == 0 && metO->origin == 'M', "PSI-only term MOD:00719 on M, no Unimod link");
    check(dha && dha->unimod == 23 && dha->origin == 'S', "Unimod-linked MOD:00189 keeps its own S (Unimod:23 is S/T/D/Y)");
    check(pyro && pyro->term == SS::Term::N_TERM && pyro->unimod == 28, "MOD:00040: N-term Q, Unimod:28");
    check(hasAcc(SS::match(pm, ox, tol, {site("M")}, {}, 5), "MOD:00719", "M"), "PSI-only term names +15.995 on M");
    check(hasAcc(SS::match(pm, -18.010565, tol, {site("S")}, {}, 5), "MOD:00189"), "Unimod-linked term names -18.011 on S");
    check(!hasAcc(SS::match(pm, -18.010565, tol, {site("T"), site("C")}, {}, 5), "MOD:00189"),
          "MOD:00189 rejected on T and C (wrong residue; the cross-link is not read)");
    check(hasAcc(SS::match(pm, -17.026549, tol, {site("N-term|Q")}, {}, 5), "MOD:00040", "N-term Q"),
          "MOD:00040 on an N-terminal Q");
    check(!hasAcc(SS::match(pm, -17.026549, tol, {site("Q"), site("N-term|E")}, {}, 5), "MOD:00040"),
          "MOD:00040 rejected on an internal Q and on an N-terminal E");
    check(hasAcc(SS::match(pm, -91.009185, tol, {site("C")}, {{'C', 57.021464, "Carbamidomethyl"}}, 5), "MOD:00793"),
          "PSI-MOD Cys dehydroalanine on CAM-Cys");
    const auto x = SS::match(pm, ox, tol, {site("M")}, {}, 5);
    check(SS::format(x, true, 1000.0) == "MOD:00719 oxidation to L-methionine sulfoxide@M(+0.0ppm)", "PSI-MOD format");
    check(SS::psimodEntries(fixtures + "/no-such.obo", &err).empty() && !err.empty(), "a missing file says so");
  }
  {  // the shipped PSI-MOD.obo: Unimod-linked terms are entries here, not just aliases
    std::string err;
    const auto pm = SS::psimodEntries("CHEMISTRY/PSI-MOD.obo", &err);
    check(err.empty() && pm.size() > 500, "shipped PSI-MOD read: " + err);
    bool linked = false;
    for (const auto& e : pm)
      if (e.acc == "MOD:00189" && e.unimod == 23) linked = true;
    check(linked, "shipped PSI-MOD: MOD:00189 with its Unimod:23 link");
  }

  if (failures == 0) std::cout << "shift_survey_test: all checks passed\n";
  return failures == 0 ? 0 : 1;
}
