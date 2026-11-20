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
#include <cstddef>
#include <iostream>
#include <map>
#include <set>
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
  const MSSpectrum& empty_spectrum_()
  {
    static const MSSpectrum e;
    return e;
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

  // ------------------------------------------------- 1.16b evidence classes
  {  // a one-residue region with no fragment evidence is sequence-constrained, never fragment-localized
    const std::string t1 = pep.substr(1, 4);  // AMPL: N-side region is S1 alone
    Reconciliation got;
    bool found = false;
    const MSSpectrum empty;
    for (const auto& x : r.reconcile(t1, sumMass(pep.substr(0, 1)) + ac, sumMass(pep.substr(5)), &empty, 2))
      if (x.peptide == pep && x.pos == 1 && !x.nterm_match && x.cterm_match) { got = x; found = true; }
    check(found, "placed AMPL with a one-residue N-side gap");
    SS::Site st;
    check(got.loc_alternatives == 0 && got.loc_evidence == 0, "one-residue region: no rival, no evidence");
    check(SS::locClass(got, 1) == SS::LocClass::SEQUENCE_CONSTRAINED &&
              SS::locClass(got, 3) == SS::LocClass::SEQUENCE_CONSTRAINED,
          "a one-residue region is sequence-constrained at any threshold");
    check(SS::siteOf(got, st, 2) && SS::siteKey(st) == "N-term|S", "and keeps its site for naming");
  }
  {  // one site-determining ion: fragment-localized at 1, ambiguous at 2
    const MSSpectrum s = ladder(pep, 2, ox, [](char k, size_t i) { return k == 'b' && (i == 2 || i == 3); });
    const Reconciliation x = nside(pep, ox, &s);
    SS::Site st;
    check(x.loc_pos == 2 && x.loc_evidence == 1, "plain b2 + shifted b3: M3 by one ion");
    check(SS::locClass(x, 1) == SS::LocClass::FRAGMENT_LOCALIZED, "evidence 1 is fragment-localized at threshold 1");
    check(SS::locClass(x, 2) == SS::LocClass::AMBIGUOUS && !SS::siteOf(x, st, 2), "and ambiguous at threshold 2");
    check(SS::siteOf(x, st, 1) == SS::siteOf(x, st), "siteOf(r, out, 1) is siteOf(r, out)");
    const MSSpectrum full = ladder(pep, 2, ox);
    const Reconciliation y = nside(pep, ox, &full);
    check(SS::locClass(y, 2) == SS::LocClass::FRAGMENT_LOCALIZED, "a full ladder is fragment-localized at 2");
    const Reconciliation z = nside(pep, ox, &empty_spectrum_());
    check(SS::locClass(z, 1) == SS::LocClass::UNLOCALIZED, "no peaks: unlocalized");
  }
  {  // UNIQUE: a peak supports one ion of a site's hypothesis at most
    TagReconciler wide(300.0, /*ppm=*/false, /*both=*/false);
    wide.attach(&idx, 0, 4);
    MSSpectrum one;
    one.push_back(Peak1D(600.0, 100.0f));
    Reconciliation a = nside(pep, ox, nullptr), b = a;
    wide.localize(a, one, 2, nullptr, nullptr, LocModel::COUNT);
    wide.localize(b, one, 2, nullptr, nullptr, LocModel::UNIQUE);
    check(a.loc_score > 1, "COUNT: one wide peak counts for many ions");
    check(b.loc_score == 1 && b.loc_evidence == 0, "UNIQUE: one peak counts once, no site is preferred");
  }
  {  // STRICT: H2O-loss satellites of observed unshifted b ions are no evidence for a -18.011 shift
    const double dh = -18.010565;
    MSSpectrum s = ladder(pep, 3, dh, [](char k, size_t) { return k == 'b'; });  // Dha-like loss on P4
    for (size_t i = 1; i <= 3; ++i)  // the loss satellites of the plain b1..b3
      s.push_back(Peak1D(sumMass(pep.substr(0, i)) - WATER + Constants::PROTON_MASS_U, 50.0f));
    s.sortByPosition();
    Reconciliation c = nside(pep, dh, nullptr), u = c, t = c;
    r.localize(c, s, 2, nullptr, nullptr, LocModel::COUNT);
    r.localize(u, s, 2, nullptr, nullptr, LocModel::UNIQUE);
    r.localize(t, s, 2, nullptr, nullptr, LocModel::STRICT);
    check(c.loc_evidence == 0 && u.loc_evidence == 0, "COUNT/UNIQUE: the satellites tie every site");
    check(t.loc_pos == 3 && t.loc_evidence >= 1 && t.loc_excluded > 0, "STRICT: satellites excluded, P4 determined");
    check(u.loc_excluded == 0, "only STRICT excludes");
  }

  // ------------------------------------------------ 1.16b observation classes
  {
    const std::vector<SS::Entry> umc = SS::unimodEntries();
    const std::vector<SS::FixedMod> cam = {{'C', 57.021464, "Carbamidomethyl"}};
    auto cls = [&](double d, const std::string& region, const std::vector<std::string>& sites, bool prec,
                   std::vector<double> beyond = {}, std::vector<double> inside = {}, const std::string& interp = "?") {
      SS::Observation o;
      o.delta = d; o.tol_da = 0.01; o.precursor_flank = prec; o.region = region; o.interp = interp;
      o.beyond = beyond; o.inside = inside;
      for (const auto& k : sites) o.sites.push_back(site(k));
      std::string det;
      return std::make_pair(SS::observationClass(o, umc, cam, &det), det);
    };
    check(cls(156.1011, "SK", {"N-term|S"}, true, {156.10111}).first == SS::ObsClass::EXTENSION,
          "+156.101 with Arg before the peptide: extension");
    check(cls(-131.0405, "MSK", {"N-term|M"}, true, {}, {131.04048}).first == SS::ObsClass::TRUNCATION,
          "-131.040 = the first region residue M: truncation");
    check(cls(21.9819, "DE", {"D"}, true).first == SS::ObsClass::ADDUCT, "+21.982: Na adduct");
    check(cls(37.9470, "DE", {"D"}, true).second == "Ca[II]", "+37.947: the nearest cation, Ca (not K, 9 mDa off)");
    check(cls(52.9115, "W", {"W"}, true).second == "Fe[III]", "+52.912: Fe(III)");
    {
      SS::Observation o;  // -57.021 next to a terminal Gly: truncation, unless localized on the Cys
      o.delta = -57.0215; o.tol_da = 0.01; o.region = "GC"; o.inside = {57.02146};
      o.sites = {site("N-term|G"), site("C")};
      check(SS::observationClass(o, umc, cam) == SS::ObsClass::TRUNCATION, "-57.021, unlocalized, G first: truncation");
      o.sites = {site("C")}; o.localized = true;
      check(SS::observationClass(o, umc, cam) == SS::ObsClass::FIXED_LOSS, "-57.021 localized on C: fixed-mod loss");
    }
    const auto i1 = cls(1.0034, "LS", {"L"}, true);
    check(i1.first == SS::ObsClass::ISOTOPE && i1.second == "13C+1", "+1.003 on a precursor flank: 13C+1");
    check(cls(1.0034, "LS", {"L"}, false).first != SS::ObsClass::ISOTOPE, "+1.003 on a fragment flank: no isotope");
    check(cls(0.9842, "NG", {"N"}, true).first == SS::ObsClass::RESIDUE, "+0.984 on N (precursor flank): deamidation, not 13C");
    check(cls(-18.0106, "SA", {"S"}, true).first == SS::ObsClass::LOSS, "-18.011: H2O loss class before any name");
    const auto fl = cls(-57.0215, "AC", {"C"}, false);
    check(fl.first == SS::ObsClass::FIXED_LOSS && fl.second == "-Carbamidomethyl@C", "-57.021 on CAM-Cys: fixed-mod loss");
    check(cls(-91.0092, "AC", {"C"}, false).first == SS::ObsClass::FIXED_REPLACEMENT, "-91.009 on CAM-Cys: Cys->Dha instead of CAM");
    check(cls(42.0106, "LL", {"N-term|L"}, true).first == SS::ObsClass::TERMINAL, "+42.011 on N-term|L: terminal");
    check(cls(63.123, "W", {"W"}, true).first == SS::ObsClass::UNKNOWN, "+63.123: unknown");
    check(cls(14.0157, "GK", {}, false, {}, {}, "sub:G->A").first == SS::ObsClass::SUBSTITUTION,
          "no site, a sub: reading: substitution");
    check(std::string(SS::obsClassName(SS::ObsClass::FIXED_LOSS)) == "fixed_loss", "class names");

    // Exact isobars: one class, not one winner.
    auto iso = [&](double d, const std::vector<std::string>& keys) {
      std::vector<SS::Site> st;
      for (const auto& k : keys) st.push_back(site(k));
      const auto ms = SS::match(umc, d, 0.005, st, cam, SIZE_MAX);
      return SS::isobarClass(d, ms, st, cam, 0.001);
    };
    const std::string ox_c = iso(15.9949, {"M", "A", "F"});
    check(ox_c.find("Oxidation") != std::string::npos && ox_c.find("Ala->Ser") != std::string::npos &&
              ox_c.find("Phe->Tyr") != std::string::npos,
          "oxidation = A->S = F->Y: " + ox_c);
    const std::string diox = iso(31.9898, {"W", "P"});
    check(diox.find("Pro->Glu") != std::string::npos && diox.find("Oxidation+Oxidation") != std::string::npos,
          "dioxidation = P->E = 2 x oxidation: " + diox);
    check(iso(42.0106, {"K", "S"}).find("Ser->Glu") != std::string::npos, "acetyl = S->E");
    check(iso(0.9840, {"N"}).find("Asn->Asp") != std::string::npos, "deamidation = N->D");
    check(iso(0.9840, {"Q"}).find("Gln->Glu") != std::string::npos, "deamidation = Q->E");
    check(iso(57.0215, {"N-term|G"}).find("Gly->Asn") != std::string::npos, "carbamidomethyl = G->N");
    const std::string cmx = iso(58.0055, {"Protein N-term|M"});
    check(cmx.find("Oxidation+Acetyl") != std::string::npos, "carboxymethyl = acetyl + oxidation: " + cmx);
    check(iso(52.912, {"W"}) == "-", "no name: no class");

    // 1.15.5: a two-modification reading that fits the localized site is named first.
    auto combo = [&](double d, const std::vector<std::string>& keys, const std::vector<std::uint64_t>& sup) {
      std::vector<SS::Site> st;
      for (const auto& k : keys) st.push_back(site(k));
      const auto ms = SS::match(umc, d, 0.005, st, cam, SIZE_MAX, &sup);
      return SS::siteCombination(d, ms, st, &sup, umc, cam, 0.001, 0.0);
    };
    const std::string pnm = combo(58.0055, {"Protein N-term|M"}, {1007});
    check(pnm.rfind("Oxidation+Acetyl@", 0) == 0 && pnm.find("M") != std::string::npos &&
              pnm.find("Protein N-term") != std::string::npos,
          "+58.005 on a protein N-terminal Met: Acetyl+Oxidation, not Carboxymethyl@N-term: " + pnm);
    check(combo(58.0055, {"Protein N-term|M", "K"}, {1007, 3}).rfind("Oxidation+Acetyl@", 0) == 0,
          "the most-supported site decides");
    check(combo(58.0055, {"K"}, {10}).empty(), "+58.005 on K: no Acetyl+Oxidation reading (Oxidation does not fit K)");
    check(combo(28.0313, {"K"}, {10}).empty(), "Dimethyl@K already explains K: no Methyl+Methyl entry");
    check(combo(15.9949, {"M"}, {10}).empty(), "a single unambiguous name stays alone");
    check(combo(42.0106, {"N-term|S"}, {10}).empty(), "Acetyl@N-term is common: not Methyl+Formyl");
  }

  // ---------------------------------------------------------------- Unimod
  const std::vector<SS::Entry> um = SS::unimodEntries();
  check(um.size() > 500, "Unimod entries read from unimod.xml");
  {
    bool custom = false;
    for (const auto& e : um) custom = custom || e.name.rfind("CUSTOM", 0) == 0;
    check(!custom, "custom_mods.xml's CUSTOM entries are no Unimod names");
    std::string err;
    check(SS::unimodEntries(fixtures + "/no-such.xml", &err).empty() && !err.empty(), "a missing unimod.xml says so");
  }
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
    check(pm.size() == 6, "6 of 11 fixture terms kept (obsolete, origin X anywhere, cross-link, common, class left out)");
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
    // 1.16: deamidation is named MOD:00684, not the "common" placeholder
    // MOD:00565 ("glycosylated asparagine", Unimod 7's N-glycosylation
    // site) nor the residue-generic class MOD:00400.
    const auto dm = SS::match(pm, 0.984016, tol, {site("N"), site("N-term|N")}, {}, 5);
    check(!dm.empty() && dm.front().entry->acc == "MOD:00684", "deamidation on N: MOD:00684 first");
    check(!hasAcc(dm, "MOD:00565") && !hasAcc(dm, "MOD:00400"), "MOD:00565 and MOD:00400 never name a row");
  }
  {  // the shipped PSI-MOD.obo: Unimod-linked terms are entries here, not just aliases
    std::string err;
    const auto pm = SS::psimodEntries("CHEMISTRY/PSI-MOD.obo", &err);
    check(err.empty() && pm.size() > 500, "shipped PSI-MOD read: " + err);
    bool linked = false;
    for (const auto& e : pm)
      if (e.acc == "MOD:00189" && e.unimod == 23) linked = true;
    check(linked, "shipped PSI-MOD: MOD:00189 with its Unimod:23 link");
    bool common = false, generic = false, specific = false;
    for (const auto& e : pm)
    {
      common = common || e.acc == "MOD:00565";
      generic = generic || e.acc == "MOD:00400";
      specific = specific || e.acc == "MOD:00684";
    }
    check(!common && !generic && specific, "shipped PSI-MOD: MOD:00565 and MOD:00400 left out, MOD:00684 kept");
    const std::vector<std::uint64_t> nq = {28, 23};
    const auto dm = SS::match(pm, 0.9860, 0.01, {site("N"), site("Q")}, {}, 5, &nq);
    check(dm.size() >= 2 && dm[0].entry->acc == "MOD:00684" && dm[1].entry->acc == "MOD:00685",
          "shipped PSI-MOD at +0.986 on N 28 / Q 23: MOD:00684, then MOD:00685");
  }

  // ------------------------------------------------- ranking (1.16)
  {
    // Support first, then mass error: on 9 M and 1 W localized spectra at
    // +15.995, Oxidation (M/W) ranks before an entry 0.1 mDa nearer that
    // fits W alone.
    SS::Entry near{"TEST:1", "NearW", 'W', SS::Term::ANYWHERE, ox + 0.0001};
    SS::Entry oxm{"TEST:2", "OxM", 'M', SS::Term::ANYWHERE, ox};
    SS::Entry oxw{"TEST:2", "OxM", 'W', SS::Term::ANYWHERE, ox};
    const std::vector<SS::Entry> cat = {near, oxm, oxw};
    const std::vector<std::uint64_t> sup = {9, 1};
    const auto r = SS::match(cat, ox + 0.0001, tol, {site("M"), site("W")}, {}, 5, &sup);
    check(r.size() == 2 && r[0].entry->acc == "TEST:2" && r[0].support == 10 && r[1].entry->acc == "TEST:1",
          "matches by support (10 vs 1) before mass error");
    const std::vector<std::uint64_t> eq = {1, 1};
    const std::vector<SS::Entry> cat2 = {oxm, SS::Entry{"TEST:3", "OxM2", 'M', SS::Term::ANYWHERE, ox + 0.002}};
    const auto r2 = SS::match(cat2, ox, tol, {site("M"), site("W")}, {}, 5, &eq);
    check(r2.size() == 2 && r2[0].entry->acc == "TEST:2", "equal support: the smaller mass error first");
  }

  // ------------------------------------------------- isotope error (1.16)
  {
    const double c13 = SS::C13_STEP;
    // +1.003 on L/S sites: only a 15N label fits better, and labels never
    // outrank the isotope reading.
    const auto l = SS::match(um, c13 + 0.0005, 0.02, {site("L"), site("S")}, {}, SIZE_MAX);
    check(SS::isotopeError(c13 + 0.0005, 0.02, l, 2, 1000.0) == "13C+1(+0.5ppm)", "+1.0039 on L/S: 13C+1");
    check(SS::isotopeError(2 * c13 - 0.001, 0.02, {}, 0, 0.0) == "13C+2(-1.0mDa)", "+2.0057: 13C+2 in mDa");
    check(SS::isotopeError(1.5, 0.02, {}, 0, 0.0) == "-", "+1.5: no isotope reading");
    // Deamidation (+0.984) on N/Q-localized spectra keeps its name: 19 mDa
    // below +1.003, it is the better-fitting residue-specific name.
    const std::vector<std::uint64_t> nq = {30, 20};
    const auto d = SS::match(um, 0.9850, 0.02, {site("N"), site("Q")}, {}, SIZE_MAX, &nq);
    check(SS::isotopeError(0.9850, 0.02, d, 50, 2000.0) == "-", "+0.985 on N/Q: deamidation, no isotope reading");
    // ... but a +0.995 row localized mostly to L has no such name.
    const std::vector<std::uint64_t> mostlyL = {2, 18};
    const auto mix = SS::match(um, 0.9950, 0.02, {site("N"), site("L")}, {}, SIZE_MAX, &mostlyL);
    check(SS::isotopeError(0.9950, 0.02, mix, 20, 2000.0).rfind("13C+1(", 0) == 0,
          "+0.995 on 18 L / 2 N: the isotope reading (Deamidated holds 2 of 20)");
    // At ppm the two stay apart: 0.984 is 19 mDa from 13C+1, outside 5 ppm of 2000 Da.
    check(SS::isotopeError(0.9840, 0.010, {}, 0, 2000.0) == "-", "+0.984 is no isotope error at 10 mDa");
  }

  // ------------------------------------------------- row grouping (1.16)
  {
    // bins (0.5 mDa): a deamidation-like spread 1960..1980 and an isotope
    // peak at 2006..2008.
    std::map<std::int64_t, std::uint64_t> c = {{1960, 2}, {1964, 10}, {1965, 3}, {1966, 1}, {1970, 40},
                                                {1971, 30}, {1972, 5}, {1975, 2}, {1980, 1},
                                                {2006, 4}, {2007, 9}, {2008, 3}};
    std::uint64_t total = 0;
    for (const auto& kv : c) total += kv.second;
    const auto g = SS::groupBins(c, 8);
    std::uint64_t sum = 0;
    std::set<std::int64_t> seen;
    bool once = true;
    for (const auto& r : g)
      for (std::int64_t b : r.bins) { sum += c.at(b); once = once && seen.insert(b).second; }
    check(sum == total && once && seen.size() == c.size(), "grouping: every bin in exactly one row");
    check(g.size() == 4 && g[0].center == 1960 && g[1].center == 1970 && g[2].center == 1980 && g[3].center == 2007,
          "grouping 4 mDa: rows at 1960, 1970, 1980 and 2007");
    check(g[1].bins == std::vector<std::int64_t>({1964, 1965, 1966, 1970, 1971, 1972, 1975}),
          "the 1970 seed takes the bins within 8 of it; 1980 (10 away) is not chained in");
    check(SS::groupBins(c, 8).size() == g.size(), "grouping is deterministic");
    // 1.15 rule at width 0: local maxima and their smaller neighbours only.
    const auto old = SS::groupBins(c, 0);
    std::vector<std::int64_t> centers;
    for (const auto& r : old) centers.push_back(r.center);
    check(centers == std::vector<std::int64_t>({1960, 1964, 1970, 1975, 1980, 2007}),
          "width 0: the 1.15 local maxima");
    check(old[1].bins == std::vector<std::int64_t>({1964, 1965}) && old[2].bins == std::vector<std::int64_t>({1970, 1971}) &&
              old[5].bins == std::vector<std::int64_t>({2006, 2007, 2008}),
          "width 0: a peak takes its strictly smaller neighbours");
    std::uint64_t kept = 0;
    for (const auto& r : old)
      for (std::int64_t b : r.bins) kept += c.at(b);
    check(kept == total - 1 - 5, "width 0 drops 1966 and 1972 (neither a peak nor next to one), as 1.15 did");
  }

  if (failures == 0) std::cout << "shift_survey_test: all checks passed\n";
  return failures == 0 ? 0 : 1;
}
