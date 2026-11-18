// Tag reconciliation: place a sequence tag onto database peptides by its
// flanking masses, and localize the single mass gap (modification or mutation)
// that the flanks imply. The database-search counterpart to tagging, after
// DirecTag/TagRecon (Dasari et al., J Proteome Res 2010, 9:1716).
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#pragma once

#include "IonSeries.h"
#include "ProteomeIndex.h"

#include <OpenMS/KERNEL/MSSpectrum.h>

#include <cstdint>
#include <string>
#include <vector>

namespace FASTag
{
  /**
    @brief One reconciliation of a tag against one database peptide placement.
  */
  struct Reconciliation
  {
    std::string protein;    ///< accession of the protein the peptide came from
    /// Ordinal of that protein in the database (ProteomeIndex order, the order
    /// of the FASTA entries), for per-protein aggregation without a lookup by
    /// accession (accessions need not be unique).
    uint32_t    protein_index = 0;
    std::string peptide;    ///< the digested peptide (I/L as in the database)
    size_t      start = 0;  ///< 0-based position of the peptide in its protein
    size_t      pos = 0;    ///< 0-based residue index where the tag starts in peptide
    /// Database residues the tag matched from pos (the tag's length, or more
    /// when a collapse rule spelled one tag residue as two). 1.12 D #3g.
    size_t      tag_len = 0;
    bool        reversed = false;  ///< tag matched the peptide reading C->N (b-derived)
    /// Flank mass agreement, within the tolerances reconcile() documents.
    /// Both true = exact placement (no mass gap).
    bool        nterm_match = false;  ///< the N-terminal flank agrees
    bool        cterm_match = false;  ///< the C-terminal flank agrees
    double      delta_mass = 0.0;  ///< spectrum flank - database flank on the mismatched side; 0 if exact
    /// Inclusive residue range (in peptide coordinates) the mass gap localizes to
    /// -- the residues between the tag and the mismatched terminus. Empty (lo>hi)
    /// when exact.
    int         region_lo = 0, region_hi = -1;
    /// Gap interpretation: what the mass gap most likely IS. Empty when exact. Otherwise one
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
    /// Site-determining evidence for loc_pos (1.16): its score less the best
    /// score of any OTHER region site. Ions that every candidate site puts
    /// in the same state add the same to all scores and cancel, so this is
    /// the net count of the ions that tell the chosen site from its nearest
    /// rival. 0 on a tie or with no evidence; 0 as well when the region is a
    /// single residue (loc_alternatives == 0), where nothing competes.
    int         loc_evidence = 0;
    /// Other residues of the region the gap could sit on (region size - 1).
    int         loc_alternatives = 0;
    /// LocModel::STRICT only (1.16b): matches of a shifted ion that were not
    /// counted because the peak is an H2O or NH3 loss satellite of an
    /// observed unshifted ion. 0 under the other models.
    int         loc_excluded = 0;
    /// Text positions of the placement's window [win_start, win_end), for a
    /// localization after the fact (TagReconciler::localize).
    uint32_t    win_start = 0, win_end = 0;
    /// Neutral monoisotopic mass of the database peptide, fixed mods included.
    double      pep_mass = 0.0;
    /// The peptide starts its protein (position 0, or 1 after an initiator
    /// Met) / ends it: the gap's terminus may be the protein's.
    bool        protein_nterm = false, protein_cterm = false;
  };

  /**
    @brief How a gap's site is scored on the spectrum's fragments (1.16b).

    COUNT is 1.11-1.16a: every b/y ion and charge with a peak within the
    tolerance counts, so one peak can count for several ions. UNIQUE counts
    a site's distinct matched peaks: a peak supports at most one ion of a
    site's hypothesis. STRICT is UNIQUE, and a shifted ion's peak does not
    count when it is an H2O or NH3 loss satellite of an observed unshifted
    ion (at the same charge), the HCD loss peaks that otherwise read as a
    -18.011 / -17.027 shift on any residue.
  */
  enum class LocModel : std::uint8_t { COUNT = 0, UNIQUE = 1, STRICT = 2 };

  /**
    @brief A candidate variable modification for interpreting a mass gap.

    Its monoisotopic mass shift and the residues it can sit on ("" = any).
    Supplied by the caller (the TOPP tool resolves names via OpenMS
    ModificationsDB), so this library needs no modification database of its own.
  */
  struct ModCandidate
  {
    std::string name;  ///< modification name, as reported in "mod:Name@X"
    double      delta = 0.0;  ///< monoisotopic mass shift (Da)
    std::string residues;  ///< e.g. "STY" for Phospho; "" matches any residue
  };

  /**
    @brief Reconciles tags against a tryptically digested protein database.

    Locates each tag in a ProteomeIndex, enumerates the tryptic windows around
    every occurrence, and compares the database flanking masses to the
    spectrum's. I is folded to L, exactly as the tagger and FastaFilter do,
    since a spectrum cannot distinguish them.
  */
  class TagReconciler
  {
  public:
    /**
      @brief Creates a reconciler with the given flank-mass tolerance.
      @param[in] frag_tol flank-mass agreement tolerance (per flank), in Da or ppm
      @param[in] tol_ppm whether @p frag_tol is in ppm; ppm is evaluated at the flank mass itself
      @param[in] both_orientations also try the tag reversed (b-ion reading)
    */
    TagReconciler(double frag_tol, bool tol_ppm, bool both_orientations = true)
      : frag_tol_(frag_tol), tol_ppm_(tol_ppm), both_(both_orientations) {}

    /**
      @brief Reconcile against a caller-owned ProteomeIndex.

      Any tag length in [min_len, MAX_FILTER_LEN], collapse rules as the index
      was built with. The index must outlive this object. Call once;
      reconcile() is const/thread-safe after.

      @param[in] idx the index (not owned)
      @param[in] missed_cleavages missed cleavages for window enumeration
      @param[in] min_len shortest tag reconciled
    */
    void attach(const ProteomeIndex* idx, int missed_cleavages, int min_len);

    /**
      @brief All placements of @p tag consistent with the flanking masses, at most one flank mismatch each.

      @p tag is base residues (bracket annotations already stripped), N->C.

      With @p spec (m/z-sorted fragment peaks) every placement with a mass gap
      is also site-localized against it, at fragment charges
      1..max(1, @p precursor_charge - 1) (a charge <= 0 counts as 2, as in
      the tagger). @p tag_shift, if given, holds the mass shift of each tag
      residue's variable modification (0 when unmodified), N->C, one entry
      per residue of @p tag; localization puts those shifts on the ladder.

      Flanks follow the tagger's y-ion convention: a reversed (b-derived)
      placement expects cterm_mass = N-side residues - H2O and nterm_mass =
      C-side residues + H2O. The precursor-derived flank is judged at the
      peptide's mass, the other at its own.

      @p series: the ion pair the tag was read as (Tag::ion_series, 1.12
      #15). nullptr or b/y is the above, FASTag 1.11's code. Another pair
      (c/z-dot) takes the reversed offset from it -- cterm_mass = N-side -
      reversedOffset(), nterm_mass = C-side + reversedOffset() -- and
      localizes on its own ladders (c = prefix + offN, z-dot = suffix + offC).

      @param[in] tag the tag's base residues, N->C
      @param[in] nterm_mass the spectrum's N-terminal flank mass (Da)
      @param[in] cterm_mass the spectrum's C-terminal flank mass (Da)
      @param[in] spec m/z-sorted fragment peaks for site localization, or nullptr
      @param[in] precursor_charge the precursor charge (<= 0 counts as 2)
      @param[in] tag_shift per-residue variable modification shifts of the tag, or nullptr
      @param[in] series the ion pair the tag was read as, or nullptr for b/y
      @return the placements
    */
    std::vector<Reconciliation> reconcile(const std::string& tag, double nterm_mass,
                                          double cterm_mass,
                                          const OpenMS::MSSpectrum* spec = nullptr,
                                          int precursor_charge = 2,
                                          const std::vector<double>* tag_shift = nullptr,
                                          const IonSeries::IonPair* series = nullptr) const;

    /**
      @brief Placements on windows chosen by mass, not by cleavage site (1.13 item 20).

      Uses ProteomeIndex::windowsByMass, for the shortlist's protease-aware
      mode. Per occurrence of @p tag the windows are those whose database
      flanks match the spectrum flanks (the wanted masses tryPlace derives,
      each also less the fixed terminal modification on its side), and each
      goes through tryPlace, so the flags, deltas and the peptide-mass
      tolerance are those of reconcile(). Without a spectrum (no site
      localization). Only placements where tryPlace finds both flanks, or one
      flank off by exactly a fixed terminal modification, are useful; the
      caller classifies them (Shortlist::classifyPlacement). Ascending
      window order per occurrence; independent of mc and the cleavage rule.

      @param[in] tag the tag's base residues, N->C
      @param[in] nterm_mass the spectrum's N-terminal flank mass (Da)
      @param[in] cterm_mass the spectrum's C-terminal flank mass (Da)
      @param[in] series the ion pair the tag was read as, or nullptr for b/y
      @return the placements
    */
    /**
      @brief Localize one placement after the fact, as reconcile() does with a spectrum.

      For a placement made without a spectrum (no -recon_localize) whose gap
      a report still needs placed. Does nothing for an exact placement or one
      already localized (loc_pos >= 0).

      @param[in,out] r a placement this reconciler returned
      @param[in] spec m/z-sorted fragment peaks
      @param[in] precursor_charge the precursor charge (<= 0 counts as 2)
      @param[in] tag_shift per-residue variable modification shifts of the tag, or nullptr
      @param[in] series the ion pair the tag was read as, or nullptr for b/y
      @param[in] model how sites are scored (reconcile() always uses COUNT)
    */
    void localize(Reconciliation& r, const OpenMS::MSSpectrum& spec, int precursor_charge = 2,
                  const std::vector<double>* tag_shift = nullptr,
                  const IonSeries::IonPair* series = nullptr,
                  LocModel model = LocModel::COUNT) const;

    std::vector<Reconciliation> reconcileByMass(const std::string& tag, double nterm_mass, double cterm_mass,
                                                const IonSeries::IonPair* series = nullptr) const;

    /**
      @brief Sets the candidate variable modifications for interpreting a mass gap.

      Set before reconcile(); read-only after. Empty means only substitutions
      and "?" are ever reported.

      @param[in] mods the candidates (moved in)
    */
    void setModCandidates(std::vector<ModCandidate> mods) { mods_ = std::move(mods); }

    /**
      @brief Sets the fixed peptide-terminal modification masses (e.g. a TMT/iTRAQ N-term label).

      The spectrum flanks carry them, the index prefixes do not, so a
      labelled peptide's gap on that side includes them; localization scores
      that gap with them on every ion of the terminus and only the rest
      placed, and without them (an unlabelled peptide), keeping the reading
      that explains more ions. Set before reconcile().

      @param[in] nterm the fixed N-terminal modification mass (Da)
      @param[in] cterm the fixed C-terminal modification mass (Da)
    */
    void setFixedTermMods(double nterm, double cterm) { fixed_n_ = nterm; fixed_c_ = cterm; }

    /**
      @brief Sets the tolerance of a "sub:X->Y" gap interpretation (1.16).

      Residue mass differences are dense at the mDa scale (190 of them), so
      at the fragment tolerance a ppm run read most unexplained gaps as some
      substitution (+2.004 as sub:P->V, 11.7 mDa off). A substitution is
      judged at this tolerance, in ppm of the same flank the gap is on (as
      the modification reading) or in Da, and never looser than the fragment
      tolerance. 0 judges substitutions at the fragment tolerance (1.15).

      @param[in] tol the tolerance, 0 = the fragment tolerance
      @param[in] ppm whether @p tol is in ppm of the flank (else Da)
    */
    void setSubstitutionTolerance(double tol, bool ppm) { sub_tol_ = tol; sub_ppm_ = ppm; }

  private:
    double tolAt_(double m) const { return tol_ppm_ ? m * frag_tol_ * 1e-6 : frag_tol_; }
    /// The database flank masses tryPlace compares an occurrence with (the
    /// y-ion convention and the reversed-reading swap, see reconcile()).
    static void wantedFlanks_(bool reversed, double nterm_mass, double cterm_mass,
                             const IonSeries::IonPair* series, double& want_n, double& want_c);
    void tryPlace_(const ProteomeIndex::TagOcc& occ, const ProteomeIndex::Window& w,
                  double nterm_mass, double cterm_mass, const OpenMS::MSSpectrum* spec,
                  int frag_charges, const std::vector<double>* tag_shift,
                  const IonSeries::IonPair* series, std::vector<Reconciliation>& out) const;
    /// Fill r.loc_*: score every residue of r's region as the gap's site by the
    /// b/y ions (or @p series' ions) of window @p w it explains in @p spec.
    void localize_(Reconciliation& r, const ProteomeIndex::Window& w,
                   const OpenMS::MSSpectrum& spec, int frag_charges,
                   const ProteomeIndex::TagOcc& occ,
                   const std::vector<double>* tag_shift,
                   const IonSeries::IonPair* series, LocModel model = LocModel::COUNT) const;
    /// Best explanation of @p delta over the residues in @p region: a candidate
    /// mod on a present residue, a single substitution of a present residue, or
    /// "?" if neither fits within tolerance. Prefers whichever fits with the
    /// smaller mass error; on a near-tie a modification wins (it is the more
    /// common explanation).
    /// @p tol is the tolerance of the flank the gap is on (see tryPlace_);
    /// @p sub_tol the (tighter) one of a substitution (setSubstitutionTolerance).
    std::string interpretDelta_(double delta, const std::string& region, double tol, double sub_tol) const;

    double frag_tol_;
    bool   tol_ppm_;
    bool   both_;
    int    min_len_ = 3;  ///< shortest tag reconciled
    int    mc_ = 0;       ///< missed cleavages for window enumeration
    double residue_masses_[128] = {0};  ///< by ASCII code, unmodified
    std::vector<ModCandidate> mods_;    ///< candidate variable mods for gap interpretation
    double fixed_n_ = 0, fixed_c_ = 0;  ///< fixed peptide N-/C-terminal mod masses
    double sub_tol_ = 0;     ///< substitution tolerance, 0 = the fragment tolerance
    bool   sub_ppm_ = true;  ///< sub_tol_ in ppm of the flank (else Da)
    const ProteomeIndex* idx_ = nullptr;    ///< the index queries run against
  };
}
