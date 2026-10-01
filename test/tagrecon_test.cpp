// Stage-A tag reconciliation: place a tag on a database peptide by flanking
// masses and localize a single mass gap. Dataset-independent -- the "spectrum"
// flank masses are computed from the peptide itself, so a correct placement
// must reconcile with delta 0, and an injected gap must localize.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "TagRecon.h"

#include <OpenMS/CHEMISTRY/EmpiricalFormula.h>
#include <OpenMS/CHEMISTRY/Residue.h>
#include <OpenMS/CHEMISTRY/ResidueDB.h>
#include <OpenMS/CONCEPT/Constants.h>
#include <OpenMS/KERNEL/MSSpectrum.h>

#include <cassert>
#include <cmath>
#include <iostream>
#include <string>
#include <vector>

using namespace FASTag;
using namespace OpenMS;

namespace
{
  int failures = 0;
  void check(bool ok, const std::string& what)
  {
    if (!ok) { std::cerr << "FAIL: " << what << "\n"; ++failures; }
  }

  double resMass(char c)
  {
    return ResidueDB::getInstance()->getResidue(String(c))->getMonoWeight(Residue::Internal);
  }
  double sumMass(const std::string& s)
  {
    double m = 0; for (char c : s) m += resMass(c); return m;
  }

}

int main()
{
  // A tryptic peptide (ends in K, no internal K/R): trypsin yields it whole.
  // Flanked by tryptic boundaries so the digest produces it cleanly.
  const std::string pep = "SAMPLEVGATSDGK";
  std::vector<FASTAFile::FASTAEntry> entries;
  entries.emplace_back("PROT1", "test protein", "MSTVWYAAR" + pep + "GTANLEFDSK");
  ProteomeIndex idx;
  idx.build(entries, /*fixed_mods=*/{}, /*isobaric_tol=*/0);
  check(idx.proteinCount() == 1, "index built over the protein");
  TagReconciler r(0.02, /*ppm=*/false, /*both=*/true);
  r.attach(&idx, /*missed=*/0, /*min_len=*/4);
  r.setModCandidates({{"Phospho", 79.96633, "STY"}, {"Acetyl", 42.01057, "K"},
                      {"Oxidation", 15.99491, "M"}});

  // --- Exact placement: an internal 4-mer with its true flanking masses ---
  {
    const size_t pos = 4;                // tag = pep[4..8)
    const std::string tag = pep.substr(pos, 4);      // "LEVG"
    const double nflank = sumMass(pep.substr(0, pos));           // S A M P
    const double cflank = sumMass(pep.substr(pos + 4));          // A T S D G K
    auto res = r.reconcile(tag, nflank, cflank);
    bool exact = false;
    for (const auto& x : res)
      if (x.peptide == pep && x.pos == pos && x.nterm_match && x.cterm_match &&
          std::fabs(x.delta_mass) < 1e-6) exact = true;
    check(exact, "exact placement of an internal tag reconciles with delta 0");
  }

  // --- Modification gap on the C-side: +79.96633 (phospho) ---
  {
    const size_t pos = 4;
    const std::string tag = pep.substr(pos, 4);
    const double nflank = sumMass(pep.substr(0, pos));
    const double cflank = sumMass(pep.substr(pos + 4)) + 79.96633;  // a phospho somewhere C-side
    auto res = r.reconcile(tag, nflank, cflank);
    bool localized = false, interpreted = false;
    for (const auto& x : res)
      if (x.peptide == pep && x.pos == pos && x.nterm_match && !x.cterm_match &&
          std::fabs(x.delta_mass - 79.96633) < 1e-3 &&
          x.region_lo == static_cast<int>(pos + 4) && x.region_hi == static_cast<int>(pep.size()) - 1)
      {
        localized = true;
        if (x.delta_interp.rfind("mod:Phospho@", 0) == 0) interpreted = true;
      }
    check(localized, "a C-side +79.966 gap localizes to the C-flank region with the right mass");
    check(interpreted, "stage B interprets the +79.966 gap as mod:Phospho@S/T");
  }

  // --- Substitution gap: replace a region residue X by Y, delta = m(Y)-m(X) ---
  {
    const size_t pos = 4;                               // tag "LEVG", region C = "ATSDGK"
    const std::string tag = pep.substr(pos, 4);
    // A->S substitution in the C region: delta = m(S) - m(A) = 87.03203 - 71.03711.
    const double dsub = 87.03203 - 71.03711;
    const double nflank = sumMass(pep.substr(0, pos));
    const double cflank = sumMass(pep.substr(pos + 4)) + dsub;
    auto res = r.reconcile(tag, nflank, cflank);
    bool sub = false;
    for (const auto& x : res)
      if (x.peptide == pep && !x.cterm_match && std::fabs(x.delta_mass - dsub) < 1e-3 &&
          x.delta_interp == "sub:A->S")
        sub = true;
    check(sub, "stage B interprets an A->S mass gap as sub:A->S");
  }

  // --- Modification gap on the N-side ---
  {
    const size_t pos = 6;
    const std::string tag = pep.substr(pos, 4);
    const double nflank = sumMass(pep.substr(0, pos)) + 42.01057;   // acetyl somewhere N-side
    const double cflank = sumMass(pep.substr(pos + 4));
    auto res = r.reconcile(tag, nflank, cflank);
    bool localized = false;
    for (const auto& x : res)
      if (x.peptide == pep && x.pos == pos && !x.nterm_match && x.cterm_match &&
          std::fabs(x.delta_mass - 42.01057) < 1e-3 &&
          x.region_lo == 0 && x.region_hi == static_cast<int>(pos) - 1)
        localized = true;
    check(localized, "an N-side +42.011 gap localizes to the N-flank region");
  }

  // --- Both flanks wrong: rejected (only one gap allowed) ---
  {
    const size_t pos = 5;
    const std::string tag = pep.substr(pos, 4);
    const double nflank = sumMass(pep.substr(0, pos)) + 16.0;
    const double cflank = sumMass(pep.substr(pos + 4)) + 16.0;
    auto res = r.reconcile(tag, nflank, cflank);
    bool any_this_pep = false;
    for (const auto& x : res) if (x.peptide == pep && x.pos == pos) any_this_pep = true;
    check(!any_this_pep, "a tag with both flanks off is rejected");
  }

  // --- Reversed (b-derived) placement: reversed tag, swapped flanks ---
  {
    const size_t pos = 4;
    const std::string tag = pep.substr(pos, 4);
    const std::string rev(tag.rbegin(), tag.rend());
    // A b-derived reading stores the tag reversed; its nterm/cterm flanks are the
    // peptide's C/N flanks respectively.
    const double nflank_spec = sumMass(pep.substr(pos + 4));   // becomes the tag's "nterm"
    const double cflank_spec = sumMass(pep.substr(0, pos));    // becomes the tag's "cterm"
    auto res = r.reconcile(rev, nflank_spec, cflank_spec);
    bool ok = false;
    for (const auto& x : res)
      if (x.peptide == pep && x.pos == pos && x.reversed && x.nterm_match && x.cterm_match)
        ok = true;
    check(ok, "a reversed tag reconciles with swapped flanks");
  }

  // --- Site localization: shifted b/y fragments pick the modified residue ---
  {
    // Oxidation on the M of the N-side region "SAMP" (tag "LEVG" at pos 4); the
    // spectrum is the singly charged b/y ladder of SAM[Oxidation]PLEVGATSDGK.
    const size_t pos = 4, site = 2;
    const double ox = 15.99491;
    const double water = EmpiricalFormula("H2O").getMonoWeight();
    const std::string tag = pep.substr(pos, 4);
    // nlabel: a fixed N-term label every b ion carries (0 = unlabelled);
    // mod: the mass on the M.
    auto ladder = [&](double nlabel, double mod) {
      MSSpectrum s;
      for (size_t i = 1; i < pep.size(); ++i)
      {
        const double b = sumMass(pep.substr(0, i)) + nlabel + (site < i ? mod : 0.0);
        const double y = sumMass(pep.substr(pep.size() - i)) + water +
                         (site >= pep.size() - i ? mod : 0.0);
        s.push_back(Peak1D(b + Constants::PROTON_MASS_U, 100.0f));
        s.push_back(Peak1D(y + Constants::PROTON_MASS_U, 100.0f));
      }
      s.sortByPosition();
      return s;
    };
    const MSSpectrum spec = ladder(0.0, ox);
    const double nflank = sumMass(pep.substr(0, pos)) + ox;
    const double cflank = sumMass(pep.substr(pos + 4));
    auto placed = [&](const Reconciliation& x) {
      return x.peptide == pep && x.pos == pos && !x.reversed && !x.nterm_match;
    };
    bool unique = false, unlocalized = false, tied = false;
    for (const auto& x : r.reconcile(tag, nflank, cflank, &spec, 2))
      if (placed(x))
        unique = x.loc_pos == static_cast<int>(site) && x.loc_ties == 1 &&
                 x.loc_site == 9 + site + 1;  // "MSTVWYAAR" precedes the peptide
    for (const auto& x : r.reconcile(tag, nflank, cflank))
      if (placed(x)) unlocalized = x.loc_pos < 0;
    const MSSpectrum empty;
    for (const auto& x : r.reconcile(tag, nflank, cflank, &empty, 2))
      if (placed(x)) tied = x.loc_pos == 0 && x.loc_score == 0 && x.loc_ties == 4;
    check(unique, "an N-side +15.995 gap localizes uniquely to the M by its fragments");
    check(unlocalized, "without a spectrum nothing is localized");
    check(tied, "with no fragment evidence every region residue ties, the first reported");

    // A fixed N-term label (TMT6plex) is in the N-side gap but not in the
    // prefixes: on the ladder it must ride on every b ion, or the label-only b
    // ions before the M match no state and S, A and M tie.
    // A gap that is the label alone lands on the first residue.
    const double tmt = 229.162932;
    r.setFixedTermMods(tmt, 0.0);
    const MSSpectrum labelled = ladder(tmt, ox), label_only = ladder(tmt, 0.0);
    bool label_unique = false, label_first = false;
    for (const auto& x : r.reconcile(tag, nflank + tmt, cflank, &labelled, 2))
      if (placed(x))
        label_unique = x.loc_pos == static_cast<int>(site) && x.loc_ties == 1;
    for (const auto& x : r.reconcile(tag, nflank - ox + tmt, cflank, &label_only, 2))
      if (placed(x)) label_first = x.loc_pos == 0 && x.loc_ties == 1;
    check(label_unique, "a fixed N-term label + oxidation gap localizes uniquely to the M");
    check(label_first, "a gap of the fixed N-term label alone localizes to the first residue");
  }

  if (failures == 0) std::cout << "tagrecon_test: all checks passed\n";
  return failures == 0 ? 0 : 1;
}
