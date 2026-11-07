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
                               const std::vector<double>* tag_shift,
                               const IonSeries::IonPair* series,
                               std::vector<Reconciliation>& out) const
  {
    const double db_n = idx_->massBetween(w.start, occ.pos);
    const double db_c = idx_->massBetween(occ.pos + occ.len, w.end);

    // Under the y-ion assumption the tag's nterm_mass is the N-side flank and
    // cterm_mass the C-side. A reversed (b-derived) placement reads the peptide
    // C->N, so the two spectrum flanks swap relative to the peptide -- and
    // carry a one-water offset: the tagger subtracts H2O from the low peak (a
    // y ion has it, a b ion does not) and the precursor's H2O stays on the
    // high side. So cterm_mass = N-side residues - H2O and nterm_mass =
    // C-side residues + H2O. (The C-side clamp mirrors the tagger's at 0.)
    static const double WATER = EmpiricalFormula("H2O").getMonoWeight();
    double want_n, want_c;
    if (!series || series->kind == IonSeries::Series::BY)
    {
      want_n = occ.reversed ? cterm_mass + WATER : nterm_mass;
      want_c = occ.reversed ? std::max(0.0, nterm_mass - WATER) : cterm_mass;
    }
    else
    {
      // Another series (#15 phase B): the same swap with the series' own
      // reversed offset (c/z-dot: offC - offN = -15.0347; the tagger's
      // clamp at 0 mirrored as for b/y).
      const double off = series->reversedOffset();
      want_n = occ.reversed ? std::max(0.0, cterm_mass + off) : nterm_mass;
      want_c = occ.reversed ? std::max(0.0, nterm_mass - off) : cterm_mass;
    }

    // The spectrum flank that is the precursor less the top fragment (want_n
    // forward, want_c reversed) carries an error on the PEPTIDE's mass scale,
    // not the flank's: the precursor's error plus that of a fragment of
    // nearly the peptide's mass. Judge it at the peptide mass; the other
    // flank comes from a low fragment alone and is judged at its own mass.
    // (In Da mode both tolerances are the same constant.)
    const double pep_tol = tolAt(idx_->massBetween(w.start, w.end) + WATER);
    const bool n_from_prec = !occ.reversed;
    const bool n_ok = std::fabs(db_n - want_n) <=
                      (n_from_prec ? pep_tol : tolAt(std::max(db_n, want_n)));
    const bool c_ok = std::fabs(db_c - want_c) <=
                      (n_from_prec ? tolAt(std::max(db_c, want_c)) : pep_tol);

    // Only ONE flank may carry a mass gap: a peptide with mismatches on both
    // sides of the tag is under-constrained and, in TagRecon's own words, hurts
    // both speed and accuracy. Reject those.
    if (!n_ok && !c_ok) return;

    const size_t pos = occ.pos - w.start;  // peptide-local tag start
    const size_t L = w.end - w.start;
    const size_t klen = occ.len;

    Reconciliation r;
    r.protein_index = idx_->proteinIndexAt(occ.pos);
    r.protein = idx_->accession(r.protein_index);
    r.peptide = idx_->originalText(w.start, w.end);  // original DB spelling
    r.start = idx_->proteinOffset(w.start);
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
    // Gap interpretation: explain the localized gap as a mod or a
    // substitution. The region is read folded (masses are I/L-blind).
    if (r.region_hi >= r.region_lo && std::fabs(r.delta_mass) > 1e-6)
    {
      const std::string region =
          idx_->foldedText(w.start + static_cast<uint32_t>(r.region_lo),
                           w.start + static_cast<uint32_t>(r.region_hi) + 1);
      r.delta_interp = interpretDelta_(r.delta_mass, region);
      if (spec) localize_(r, w, *spec, frag_charges, occ, tag_shift, series);
    }
    out.push_back(std::move(r));
  }

  void TagReconciler::localize_(Reconciliation& r, const ProteomeIndex::Window& w,
                                const MSSpectrum& spec, int frag_charges,
                                const ProteomeIndex::TagOcc& occ,
                                const std::vector<double>* tag_shift,
                                const IonSeries::IonPair* series) const
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
    // A fixed terminal mod (TMT/iTRAQ N-term label) is in the spectrum's flank
    // but not in the prefixes, so a labelled peptide's gap on that side
    // includes it: it rides on every ion from that terminus and only the rest
    // of the gap is the site's. An unlabelled peptide's gap (incomplete
    // labelling) does not, so both readings are scored and the one explaining
    // more ions is kept, the labelled one on a tie. A flank that matched on
    // the label's side showed no label, so no ion carries it. A gap that is
    // the label alone is scored whole, which places it on the terminal residue
    // it sits on. "Alone" is judged at the peptide's mass, not the flank's: an
    // N-side flank is the precursor less a y ion and carries an error on that
    // scale, and a rest that small is no shift any ion could show.
    //
    // Variable mods INSIDE the tag (@p tag_shift, per tag residue N->C) are
    // put on the ladder: an ion spanning such a residue carries its shift in
    // both states. Left off, a gap whose mass equals the tag's mod made the
    // ions between the true site and the tag match "shifted" by coincidence
    // and pulled the call toward the tag -- a wrong unique site on y-dominated
    // spectra, not just lost evidence.
    // Residue-specific and protein-terminal fixed mods are not on it either: a
    // gap carrying one ties its site with every residue nearer that terminus.
    static const double WATER = EmpiricalFormula("H2O").getMonoWeight();
    const bool by = !series || series->kind == IonSeries::Series::BY;
    const int L = static_cast<int>(w.end - w.start);
    // shift_pre[i] = summed tag-mod shift on peptide residues [0, i).
    std::vector<double> shift_pre(static_cast<size_t>(L) + 1, 0.0);
    if (tag_shift && tag_shift->size() == occ.len)
    {
      std::vector<double> at(static_cast<size_t>(L), 0.0);
      const size_t pos = occ.pos - w.start;
      for (size_t t = 0; t < occ.len; ++t)
      {
        const size_t pi = pos + (occ.reversed ? occ.len - 1 - t : t);
        if (pi < at.size()) at[pi] += (*tag_shift)[t];
      }
      for (int i = 0; i < L; ++i) shift_pre[i + 1] = shift_pre[i] + at[i];
    }
    const double label = r.nterm_match ? fixed_c_ : fixed_n_;
    const bool alone = std::fabs(r.delta_mass - label) <=
                       tolAt(idx_->massBetween(w.start, w.end) + label);
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
    // Score every region site with @p lab on every ion from the gap's
    // terminus and the rest of the gap on the site; keep the best site if it
    // beats the reading scored before.
    auto place = [&](double lab) {
      const double tn = r.nterm_match ? 0.0 : lab, tc = r.nterm_match ? lab : 0.0;
      const double d = r.delta_mass - lab;
      for (int i = 1; i < L; ++i)
      {
        // b/y: 1.11's expressions. Another series (#15 phase B, c/z-dot):
        // its N-ion is prefix + offN, its C-ion suffix + offC.
        const double b = by ? idx_->massBetween(w.start, w.start + i) + shift_pre[i]
                            : idx_->massBetween(w.start, w.start + i) + shift_pre[i] + series->offN;
        const double y = idx_->massBetween(w.end - i, w.end) + (by ? WATER : series->offC)
                         + (shift_pre[L] - shift_pre[L - i]);
        b0[i] = hits(b + tn); b1[i] = hits(b + tn + d);
        y0[i] = hits(y + tc); y1[i] = hits(y + tc + d);
      }
      int best = -1, pos = -1, ties = 0;
      for (int j = r.region_lo; j <= r.region_hi; ++j)
      {
        int score = 0;
        for (int i = 1; i < L; ++i)
          score += (j < i ? b1[i] : b0[i]) + (j >= L - i ? y1[i] : y0[i]);
        if (score > best) { best = score; pos = j; ties = 1; }
        else if (score == best) ++ties;
      }
      if (r.loc_pos < 0 || best > r.loc_score) { r.loc_pos = pos; r.loc_score = best; r.loc_ties = ties; }
    };
    if (label != 0.0 && !alone) place(label);  // labelled: the label rides along
    place(0.0);  // unlabelled, or the gap is the label alone: scored whole
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
                                                       int precursor_charge,
                                                       const std::vector<double>* tag_shift,
                                                       const IonSeries::IonPair* series) const
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
        tryPlace(occ, w, nterm_mass, cterm_mass, spec, frag_charges, tag_shift, series, out);
    }
    return out;
  }
}
