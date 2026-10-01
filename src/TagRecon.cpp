// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "TagRecon.h"

#include "FastaFilter.h"  // MAX_FILTER_LEN

#include <OpenMS/CHEMISTRY/EmpiricalFormula.h>
#include <OpenMS/CHEMISTRY/Residue.h>
#include <OpenMS/CHEMISTRY/ResidueDB.h>
#include <OpenMS/CONCEPT/Constants.h>

#include <algorithm>
#include <cmath>

using namespace OpenMS;

namespace FASTag
{
  void TagReconciler::attach(const ProteomeIndex* idx, int missed_cleavages, int min_len)
  {
    mc_ = missed_cleavages;
    min_len_ = std::max(1, min_len);
    idx_ = idx;
    // Unmodified masses: they feed only interpretDelta_'s substitution
    // arithmetic, and a fixed mod shifts the database flank and the substituted
    // residue identically, so sub:X->Y deltas stay on the unmodified scale
    // (mods on the substituted residue itself are the mod candidates' job).
    // Database flanks come from the index's fixed-mod-adjusted prefixes.
    for (const Residue* r : ResidueDB::getInstance()->getResidues("Natural19WithoutI"))
      residue_masses_[static_cast<unsigned char>(r->getOneLetterCode()[0])] =
          r->getMonoWeight(Residue::Internal);
  }

  void TagReconciler::tryPlace(const ProteomeIndex::TagOcc& occ, const ProteomeIndex::Window& w,
                               double nterm_mass, double cterm_mass,
                               const MSSpectrum* spec, int frag_charges,
                               std::vector<Reconciliation>& out) const
  {
    const double db_n = idx_->massBetween(w.start, occ.pos);
    const double db_c = idx_->massBetween(occ.pos + occ.len, w.end);

    // Under the y-ion assumption the tag's nterm_mass is the N-side flank and
    // cterm_mass the C-side. A reversed (b-derived) placement reads the peptide
    // C->N, so the two spectrum flanks swap relative to the peptide.
    const double want_n = occ.reversed ? cterm_mass : nterm_mass;
    const double want_c = occ.reversed ? nterm_mass : cterm_mass;

    const bool n_ok = std::fabs(db_n - want_n) <= tolAt(std::max(db_n, want_n));
    const bool c_ok = std::fabs(db_c - want_c) <= tolAt(std::max(db_c, want_c));

    // Only ONE flank may carry a mass gap: a peptide with mismatches on both
    // sides of the tag is under-constrained and, in TagRecon's own words, hurts
    // both speed and accuracy. Reject those.
    if (!n_ok && !c_ok) return;

    const size_t pos = occ.pos - w.start;  // peptide-local tag start
    const size_t L = w.end - w.start;
    const size_t klen = occ.len;

    Reconciliation r;
    r.protein = idx_->proteinAt(occ.pos);
    r.peptide = idx_->originalText(w.start, w.end);  // original DB spelling
    r.pos = pos;
    r.reversed = occ.reversed;
    r.nterm_match = n_ok;
    r.cterm_match = c_ok;
    if (n_ok && c_ok) { r.delta_mass = 0.0; r.region_lo = 0; r.region_hi = -1; }
    else if (!n_ok)   // gap is on the N-side residues [0, pos)
    {
      r.delta_mass = want_n - db_n;
      r.region_lo = 0;
      r.region_hi = static_cast<int>(pos) - 1;
    }
    else              // gap is on the C-side residues [pos+klen, L)
    {
      r.delta_mass = want_c - db_c;
      r.region_lo = static_cast<int>(pos + klen);
      r.region_hi = static_cast<int>(L) - 1;
    }
    // Stage B: interpret the localized gap as a mod or a substitution. The
    // region is read folded (masses are I/L-blind).
    if (r.region_hi >= r.region_lo && std::fabs(r.delta_mass) > 1e-6)
    {
      const std::string region =
          idx_->foldedText(w.start + static_cast<uint32_t>(r.region_lo),
                           w.start + static_cast<uint32_t>(r.region_hi) + 1);
      r.delta_interp = interpretDelta_(r.delta_mass, region);
      if (spec) localize_(r, w, *spec, frag_charges);
    }
    out.push_back(std::move(r));
  }

  void TagReconciler::localize_(Reconciliation& r, const ProteomeIndex::Window& w,
                                const MSSpectrum& spec, int frag_charges) const
  {
    // Shifted-fragment scoring. With the gap on residue j of an L-residue
    // peptide, b_i (residues [0,i)) carries it iff j < i and y_i (residues
    // [L-i,L)) iff j >= L-i. Each ion is looked up once plain and once
    // shifted; a site scores the ions matched in the state it puts them in.
    // Only ions ending inside the region differ between sites (the
    // site-determining ions); every other ion adds the same to all of them.
    //
    // The ladder is the index's prefix masses -- the masses the flank check
    // used, fixed mods included -- not AASequence + TheoreticalSpectrumGenerator:
    // an arbitrary-delta modification is registered in the process-global
    // ModificationsDB once per distinct value, i.e. once per reconciled delta.
    //
    // ponytail: variable mods INSIDE the tag are not on the ladder. Ions
    // spanning such a residue miss for every site alike -- lost evidence (more
    // ties), never a different site; put them on the ladder if that matters.
    static const double WATER = EmpiricalFormula("H2O").getMonoWeight();
    const int L = static_cast<int>(w.end - w.start);
    const double d = r.delta_mass;
    auto hits = [&](double neutral) {
      int n = 0;
      for (int z = 1; z <= frag_charges; ++z)
      {
        const double mz = (neutral + z * Constants::PROTON_MASS_U) / z;
        if (spec.findNearest(mz, tolAt(mz)) >= 0) ++n;
      }
      return n;
    };
    // [i] = charges matched for the ion of length i, plain (0) / shifted (1).
    std::vector<int> b0(L, 0), b1(L, 0), y0(L, 0), y1(L, 0);
    for (int i = 1; i < L; ++i)
    {
      const double b = idx_->massBetween(w.start, w.start + i);
      const double y = idx_->massBetween(w.end - i, w.end) + WATER;
      b0[i] = hits(b); b1[i] = hits(b + d);
      y0[i] = hits(y); y1[i] = hits(y + d);
    }
    int best = -1;
    for (int j = r.region_lo; j <= r.region_hi; ++j)
    {
      int score = 0;
      for (int i = 1; i < L; ++i)
        score += (j < i ? b1[i] : b0[i]) + (j >= L - i ? y1[i] : y0[i]);
      if (score > best) { best = score; r.loc_pos = j; r.loc_ties = 1; }
      else if (score == best) ++r.loc_ties;
    }
    r.loc_score = best;
    r.loc_site = idx_->proteinOffset(w.start + static_cast<uint32_t>(r.loc_pos)) + 1;
  }

  std::string TagReconciler::interpretDelta_(double delta, const std::string& region) const
  {
    // Two hypotheses, both localized to `region`:
    //   modification -- delta ~= a candidate mod's shift, and the region carries a
    //                   residue that mod applies to;
    //   substitution -- delta ~= mass(Y) - mass(X) for some residue X IN the region
    //                   replaced by any residue Y (unmodified masses; see attach()).
    // The best fit (smallest mass error) wins; a modification breaks a near-tie
    // because it is the more common explanation of a given mass shift.
    const double tol = tolAt(std::fabs(delta) > 1.0 ? std::fabs(delta) : 200.0);
    std::string best;
    double best_err = tol;
    bool best_is_mod = false;

    for (const ModCandidate& m : mods_)
    {
      const double err = std::fabs(delta - m.delta);
      if (err > tol) continue;
      bool applies = m.residues.empty();
      char site = 0;
      if (!applies)
        for (char c : region)
          if (m.residues.find(c) != std::string::npos) { applies = true; site = c; break; }
      if (!applies) continue;
      if (err < best_err || (err <= best_err && !best_is_mod))
      {
        best_err = err; best_is_mod = true;
        best = "mod:" + m.name + "@" + (site ? std::string(1, site) : region.substr(0, 1));
      }
    }

    static const char AA[] = "GASPVTCLNDQKEMHFRYW";
    for (char x : region)
    {
      const double mx = residue_masses_[static_cast<unsigned char>(x)];
      if (mx <= 0) continue;
      for (const char* y = AA; *y; ++y)
      {
        if (*y == x) continue;
        const double my = residue_masses_[static_cast<unsigned char>(*y)];
        if (my <= 0) continue;
        const double err = std::fabs(delta - (my - mx));
        if (err < best_err)  // strict: mods win ties
        {
          best_err = err; best_is_mod = false;
          best = std::string("sub:") + x + "->" + *y;
        }
      }
    }
    return best.empty() ? "?" : best;
  }

  std::vector<Reconciliation> TagReconciler::reconcile(const std::string& tag,
                                                       double nterm_mass, double cterm_mass,
                                                       const MSSpectrum* spec,
                                                       int precursor_charge) const
  {
    std::vector<Reconciliation> out;
    if (!idx_) return out;
    const int len = static_cast<int>(tag.size());
    if (len < min_len_ || len > MAX_FILTER_LEN) return out;

    std::vector<ProteomeIndex::TagOcc> occs;
    idx_->locateTag(tag, both_, occs);  // folds, collapse-branches, dedupes
    const int frag_charges = std::max(1, (precursor_charge > 0 ? precursor_charge : 2) - 1);

    std::vector<ProteomeIndex::Window> windows;
    for (const auto& occ : occs)
    {
      windows.clear();
      idx_->windowsAt(occ.pos, occ.len, mc_, windows);
      for (const auto& w : windows)
        tryPlace(occ, w, nterm_mass, cterm_mass, spec, frag_charges, out);
    }
    return out;
  }
}
