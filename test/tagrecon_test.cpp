// Tag placement: place a tag on a database peptide by flanking
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

#include <algorithm>
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
    return ResidueDB::getInstance()->getResidue(std::string(1, c))->getMonoWeight(Residue::Internal);
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
          std::fabs(x.delta_mass) < 1e-6 && x.start == 9) exact = true;  // after MSTVWYAAR
    check(exact, "exact placement of an internal tag reconciles with delta 0, at its protein offset");
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
    check(interpreted, "gap interpretation reads the +79.966 gap as mod:Phospho@S/T");
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
    check(sub, "gap interpretation reads an A->S mass gap as sub:A->S");
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
    // A b-derived reading stores the tag reversed, and its flanks are what
    // FASTagger computes under the y assumption: cterm = low b ion's neutral
    // mass - H2O = N-side residues - H2O; nterm = precursor - high b ion =
    // C-side residues + H2O.
    const double water = EmpiricalFormula("H2O").getMonoWeight();
    const double nflank_spec = sumMass(pep.substr(pos + 4)) + water;  // the tag's "nterm"
    const double cflank_spec = sumMass(pep.substr(0, pos)) - water;   // the tag's "cterm"
    auto res = r.reconcile(rev, nflank_spec, cflank_spec);
    bool ok = false;
    for (const auto& x : res)
      if (x.peptide == pep && x.pos == pos && x.reversed && x.nterm_match && x.cterm_match)
        ok = true;
    check(ok, "a reversed tag reconciles with swapped, water-offset flanks");
    // The water-free swap (the old convention) is two waters off and rejected.
    bool stale = false;
    for (const auto& x : r.reconcile(rev, sumMass(pep.substr(pos + 4)), sumMass(pep.substr(0, pos))))
      if (x.peptide == pep && x.pos == pos && x.reversed && x.nterm_match && x.cterm_match)
        stale = true;
    check(!stale, "water-free swapped flanks are not an exact reversed placement");
  }

  // --- ppm: the precursor-derived N flank is judged at the peptide's mass ---
  {
    // 20 ppm of the ~500 Da N flank is 0.010 Da; a +0.015 Da error there is
    // ~10 ppm of the peptide, an ordinary precursor-scale error.
    const size_t pos = 5;
    const std::string tag = pep.substr(pos, 4);
    TagReconciler rp(20.0, /*ppm=*/true, /*both=*/true);
    rp.attach(&idx, /*missed=*/0, /*min_len=*/4);
    bool exact = false;
    for (const auto& x : rp.reconcile(tag, sumMass(pep.substr(0, pos)) + 0.015,
                                      sumMass(pep.substr(pos + 4))))
      if (x.peptide == pep && x.pos == pos && !x.reversed && x.nterm_match && x.cterm_match)
        exact = true;
    check(exact, "a precursor-scale error on the N flank still places exactly (ppm)");
    // The C flank (one low fragment) keeps its own-mass tolerance.
    bool c_exact = false;
    for (const auto& x : rp.reconcile(tag, sumMass(pep.substr(0, pos)),
                                      sumMass(pep.substr(pos + 4)) + 0.015))
      if (x.peptide == pep && x.pos == pos && !x.reversed && x.cterm_match)
        c_exact = true;
    check(!c_exact, "the C flank is still judged at its own mass");
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

    // An unlabelled peptide (incomplete labelling) has the oxidation alone in
    // its gap; read as label + rest, the M would tie with S and A.
    bool unlabelled_unique = false;
    for (const auto& x : r.reconcile(tag, nflank, cflank, &spec, 2))
      if (placed(x))
        unlabelled_unique = x.loc_pos == static_cast<int>(site) && x.loc_ties == 1;
    check(unlabelled_unique, "an unlabelled peptide's gap on a labelled run localizes to the M");

    // "Alone" at 20 ppm of the peptide, not of the SAMP flank: 0.02 Da over the
    // label is precursor-scale error, not a 0.02 Da shift for the b ions to place.
    TagReconciler rp(20.0, /*ppm=*/true, /*both=*/true);
    rp.attach(&idx, /*missed=*/0, /*min_len=*/4);
    rp.setFixedTermMods(tmt, 0.0);
    bool label_err_first = false;
    for (const auto& x : rp.reconcile(tag, nflank - ox + tmt + 0.02, cflank, &label_only, 2))
      if (placed(x)) label_err_first = x.loc_pos == 0 && x.loc_ties == 1;
    check(label_err_first, "a label-only gap off by precursor-scale error stays on the first residue");
  }

  // --- A variable mod inside the tag rides on the localization ladder ---
  {
    // GM[Ox]AM[Ox]AAK: tag "MAAK" at 3 with its M oxidized, gap = Oxidation
    // on M1 in the N-side region "GMA". y ions only. Without the tag's mod on
    // the ladder, the y ions between M1 and the tag matched "shifted" by
    // coincidence (gap mass == tag mod mass) and the call moved to A2.
    const std::string gp = "GMAMAAK";
    std::vector<FASTAFile::FASTAEntry> e2;
    e2.emplace_back("PROT2", "test protein", "MSTVWYAAR" + gp + "GTANLEFDSK");
    ProteomeIndex idx2;
    idx2.build(e2, {}, 0);
    TagReconciler r2(0.02, /*ppm=*/false, /*both=*/false);
    r2.attach(&idx2, 0, 4);
    const double ox = 15.99491;
    const double water = EmpiricalFormula("H2O").getMonoWeight();
    MSSpectrum s;
    for (size_t i = 1; i < gp.size(); ++i)
    {
      double y = sumMass(gp.substr(gp.size() - i)) + water;
      const size_t from = gp.size() - i;
      if (from <= 1) y += ox;  // M1, the gap
      if (from <= 3) y += ox;  // M3, the tag's own mod
      s.push_back(Peak1D(y + Constants::PROTON_MASS_U, 100.0f));
    }
    s.sortByPosition();
    const std::vector<double> shift = {ox, 0.0, 0.0, 0.0};
    bool right = false;
    for (const auto& x : r2.reconcile("MAAK", sumMass("GMA") + ox, 0.0, &s, 2, &shift))
      if (x.peptide == gp && x.pos == 3 && !x.nterm_match && x.cterm_match)
        right = x.loc_pos == 1 && x.loc_ties == 1;
    check(right, "a gap equal to the tag's own mod localizes to M1 with the mod on the ladder");
  }

  // --- protein_index: the placement's protein ordinal (1.12 P2) ---
  {
    std::vector<FASTAFile::FASTAEntry> e3;
    e3.emplace_back("A", "", "MSTVWYAAR");
    e3.emplace_back("B", "", "GGGR" + pep);
    e3.emplace_back("B", "", "WWWR" + pep);  // a duplicate accession
    ProteomeIndex idx3;
    idx3.build(e3, {}, 0);
    TagReconciler r3(0.02, false, false);
    r3.attach(&idx3, 0, 4);
    const size_t pos = 4;
    const auto res = r3.reconcile(pep.substr(pos, 4), sumMass(pep.substr(0, pos)), sumMass(pep.substr(pos + 4)));
    std::vector<uint32_t> ords;
    bool consistent = true;
    for (const auto& x : res)
    {
      ords.push_back(x.protein_index);
      consistent = consistent && x.protein == idx3.accession(x.protein_index);
    }
    std::sort(ords.begin(), ords.end());
    check(ords == std::vector<uint32_t>({1, 2}), "protein_index tells duplicate accessions apart");
    check(consistent, "protein_index names the placement's protein");
  }

  if (failures == 0) std::cout << "tagrecon_test: all checks passed\n";
  return failures == 0 ? 0 : 1;
}
