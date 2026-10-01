// Tag reconciliation: place a sequence tag onto database peptides by its
// flanking masses, and localize the single mass gap (modification or mutation)
// that the flanks imply. The database-search counterpart to tagging, after
// DirecTag/TagRecon (Dasari et al., J Proteome Res 2010, 9:1716).
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#pragma once

#include "ProteomeIndex.h"

#include <OpenMS/KERNEL/MSSpectrum.h>

#include <string>
#include <vector>

namespace FASTag
{
  /// One reconciliation of a tag against one database peptide placement.
  struct Reconciliation
  {
    std::string protein;    ///< accession of the protein the peptide came from
    std::string peptide;    ///< the digested peptide (I/L as in the database)
    size_t      pos = 0;    ///< 0-based residue index where the tag starts in peptide
    bool        reversed = false;  ///< tag matched the peptide reading C->N (b-derived)
    /// Flank mass agreement. Both true = exact placement (no mass gap).
    bool        nterm_match = false;
    bool        cterm_match = false;
    double      delta_mass = 0.0;  ///< spectrum flank - database flank on the mismatched side; 0 if exact
    /// Inclusive residue range (in peptide coordinates) the mass gap localizes to
    /// -- the residues between the tag and the mismatched terminus. Empty (lo>hi)
    /// when exact.
    int         region_lo = 0, region_hi = -1;
    /// Stage B: what the mass gap most likely IS. Empty when exact. Otherwise one
    /// of "mod:Name@X" (a known modification on a residue X present in the
    /// region), "sub:X->Y" (a single residue X in the region replaced by Y), or
    /// "?" (delta explained by neither within tolerance). The delta on its own is
    /// a number; this is the interpretation a search would act on.
    std::string delta_interp;
    /// Site localization, only when reconcile() was given the spectrum and
    /// there is a mass gap: the region residue that, carrying delta_mass,
    /// explains the most b/y fragment ions. loc_pos < 0 when not localized.
    int         loc_pos = -1;   ///< peptide-local index of the best site (lowest on a tie)
    size_t      loc_site = 0;   ///< 1-based position of that residue in the protein
    int         loc_score = 0;  ///< b/y ion/charge matches with the gap on loc_pos
    int         loc_ties = 0;   ///< region positions sharing loc_score; 1 = unique
  };

  /// A candidate variable modification for stage-B interpretation: its
  /// monoisotopic mass shift and the residues it can sit on ("" = any). Supplied
  /// by the caller (the TOPP tool resolves names via OpenMS ModificationsDB), so
  /// this library needs no modification database of its own.
  struct ModCandidate
  {
    std::string name;
    double      delta = 0.0;
    std::string residues;  ///< e.g. "STY" for Phospho; "" matches any residue
  };

  /// Reconciles tags against a tryptically digested protein database.
  ///
  /// Locates each tag in a ProteomeIndex, enumerates the tryptic windows around
  /// every occurrence, and compares the database flanking masses to the
  /// spectrum's. I is folded to L, exactly as the tagger and FastaFilter do,
  /// since a spectrum cannot distinguish them.
  class TagReconciler
  {
  public:
    /// @param frag_tol,tol_ppm  flank-mass agreement tolerance (per flank).
    ///   ppm is evaluated at the flank mass itself.
    /// @param both_orientations also try the tag reversed (b-ion reading).
    TagReconciler(double frag_tol, bool tol_ppm, bool both_orientations = true)
      : frag_tol_(frag_tol), tol_ppm_(tol_ppm), both_(both_orientations) {}

    /// Reconcile against a caller-owned ProteomeIndex (any tag length in
    /// [min_len, MAX_FILTER_LEN], collapse rules as the index was built with).
    /// The index must outlive this object. Call once; reconcile() is
    /// const/thread-safe after.
    void attach(const ProteomeIndex* idx, int missed_cleavages, int min_len);

    /// All placements of @p tag consistent with the flanking masses, at most one
    /// flank mismatch each. @p tag is base residues (bracket annotations already
    /// stripped), N->C.
    ///
    /// With @p spec (m/z-sorted fragment peaks) every placement with a mass gap
    /// is also site-localized against it, at fragment charges
    /// 1..max(1, @p precursor_charge - 1) (a charge <= 0 counts as 2, as in
    /// the tagger).
    std::vector<Reconciliation> reconcile(const std::string& tag, double nterm_mass,
                                          double cterm_mass,
                                          const OpenMS::MSSpectrum* spec = nullptr,
                                          int precursor_charge = 2) const;

    /// Candidate variable modifications for stage-B delta interpretation. Set
    /// before reconcile(); read-only after. Empty means only substitutions and
    /// "?" are ever reported.
    void setModCandidates(std::vector<ModCandidate> mods) { mods_ = std::move(mods); }

    /// Fixed peptide-terminal modification masses (e.g. a TMT/iTRAQ N-term
    /// label). The spectrum flanks carry them, the index prefixes do not, so a
    /// gap on that side includes them; localization puts them on every ion of
    /// that terminus and places only the rest. Set before reconcile().
    void setFixedTermMods(double nterm, double cterm) { fixed_n_ = nterm; fixed_c_ = cterm; }

  private:
    double tolAt(double m) const { return tol_ppm_ ? m * frag_tol_ * 1e-6 : frag_tol_; }
    void tryPlace(const ProteomeIndex::TagOcc& occ, const ProteomeIndex::Window& w,
                  double nterm_mass, double cterm_mass, const OpenMS::MSSpectrum* spec,
                  int frag_charges, std::vector<Reconciliation>& out) const;
    /// Fill r.loc_*: score every residue of r's region as the gap's site by the
    /// b/y ions of window @p w it explains in @p spec.
    void localize_(Reconciliation& r, const ProteomeIndex::Window& w,
                   const OpenMS::MSSpectrum& spec, int frag_charges) const;
    /// Best explanation of @p delta over the residues in @p region: a candidate
    /// mod on a present residue, a single substitution of a present residue, or
    /// "?" if neither fits within tolerance. Prefers whichever fits with the
    /// smaller mass error; on a near-tie a modification wins (it is the more
    /// common explanation).
    std::string interpretDelta_(double delta, const std::string& region) const;

    double frag_tol_;
    bool   tol_ppm_;
    bool   both_;
    int    min_len_ = 3;  ///< shortest tag reconciled
    int    mc_ = 0;       ///< missed cleavages for window enumeration
    double residue_masses_[128] = {0};  ///< by ASCII code, unmodified
    std::vector<ModCandidate> mods_;    ///< candidate variable mods for stage B
    double fixed_n_ = 0, fixed_c_ = 0;  ///< fixed peptide N-/C-terminal mod masses
    const ProteomeIndex* idx_ = nullptr;    ///< the index queries run against
  };
}
