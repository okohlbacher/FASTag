// Mass-shift survey (1.16): the site class of a reconciled mass gap and the
// Unimod and PSI-MOD entries that could name a -delta_out row.
//
// A -delta_out row stays a candidate, not an identification: its sites are
// those the spectra's own fragments determine (TagReconciler's site-
// determining evidence), and its names are the catalogue entries that fit
// its mass on one of those sites. Neither is FDR-controlled.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#pragma once

#include "TagRecon.h"

#include <cstddef>
#include <cstdint>
#include <map>
#include <string>
#include <vector>

namespace FASTag
{
  namespace ShiftSurvey
  {
    /// Where an entry may sit: anywhere on its residue, or at a terminus.
    enum class Term : std::uint8_t { ANYWHERE, N_TERM, C_TERM, PROTEIN_N_TERM, PROTEIN_C_TERM };

    /// One catalogue entry: a mass shift with its site specificity.
    struct Entry
    {
      std::string acc;   ///< "UNIMOD:35" or "MOD:00719"
      std::string name;  ///< "Oxidation", or the PSI-MOD term name
      char origin = 'X'; ///< residue, 'X' = any residue (terminal entries only)
      Term term = Term::ANYWHERE;
      double mass = 0.0; ///< monoisotopic shift relative to the unmodified residue (Da)
      int unimod = 0;    ///< PSI-MOD only: the Unimod record it cross-references, 0 = none
      /// Unimod only: classification "Isotopic label" (Label:15N(1), Label:13C(1)...);
      /// such an entry never outranks the isotope-error reading (isotopeError()).
      bool label = false;
    };

    /// The site class of one localized gap.
    struct Site
    {
      /// 'R' a residue; 'N' / 'C' the peptide's N- / C-terminal residue,
      /// which b/y ladders cannot tell from the terminus itself.
      char kind = 'R';
      char residue = 'X';
      bool protein_term = false;  ///< kind N/C only: the terminus is the protein's too
    };

    /**
      @brief The site class of a placement's gap, or false when it is not localized.

      Not localized: no localization (loc_pos < 0), or rival sites in the
      region and no site-determining evidence for the chosen one
      (loc_evidence < 1: a tie or no distinguishing ion matched). The chosen
      site is terminal-ambiguous (kind 'N' / 'C') when it is the peptide's
      first residue of a gap on the N-terminal side, or its last of a gap on
      the C-terminal side: no b/y ion separates that residue from the terminus.
      Every region reaches a terminus, so a one-residue region is always
      terminal-ambiguous.

      @param[in] r the placement
      @param[out] out its site class
      @return whether the gap is localized
    */
    bool siteOf(const Reconciliation& r, Site& out);

    /**
      @brief The evidence class of a placement's gap (1.16b).

      NONE: no gap to place (exact, or a gap with no residue between the tag
      and the terminus). SEQUENCE_CONSTRAINED: the gap's region is one
      residue, so the placement alone puts it there; no fragment chose it.
      FRAGMENT_LOCALIZED: rival sites, and the chosen one leads the best
      rival by at least @p min_evidence site-determining ions (peaks, under
      LocModel UNIQUE / STRICT). AMBIGUOUS: rival sites and a lead of 1 to
      @p min_evidence - 1. UNLOCALIZED: rival sites and no lead (a tie), or
      no localization.
    */
    enum class LocClass : std::uint8_t { NONE = 0, UNLOCALIZED, AMBIGUOUS, SEQUENCE_CONSTRAINED, FRAGMENT_LOCALIZED };

    /// "-", "unlocalized", "ambiguous", "sequence", "fragment".
    const char* locClassName(LocClass c);

    /**
      @brief The evidence class of @p r's gap (see LocClass).

      @param[in] r the placement, localized
      @param[in] min_evidence the lead a FRAGMENT_LOCALIZED site needs (>= 1)
      @return the class
    */
    LocClass locClass(const Reconciliation& r, int min_evidence);

    /**
      @brief siteOf() at a site-determining evidence threshold (1.16b).

      Localized: SEQUENCE_CONSTRAINED or FRAGMENT_LOCALIZED at @p min_evidence.
      siteOf(r, out) is siteOf(r, out, 1).

      @param[in] r the placement
      @param[out] out its site class
      @param[in] min_evidence the lead a fragment-localized site needs
      @return whether the gap is localized
    */
    bool siteOf(const Reconciliation& r, Site& out, int min_evidence);

    /// "K", "N-term|K", "Protein N-term|M", "C-term|R", "Protein C-term|L".
    std::string siteKey(const Site& s);
    /// The inverse of siteKey; false for anything else.
    bool parseSiteKey(const std::string& key, Site& out);

    /**
      @brief The Unimod entries of a unimod.xml, one per site specificity.

      Read with OpenMS's UnimodXMLDataProvider, as ModificationsDB reads it,
      but from the file alone: ModificationsDB also holds custom_mods.xml's
      CUSTOM entries and modifications registered at run time. Kept: a record
      id, a non-zero mass, a residue or a terminus.

      @param[in] path the file (absolute, or resolved as OpenMS::File::find does)
      @param[out] error why nothing was read, when the file cannot be read
      @return the entries
    */
    std::vector<Entry> unimodEntries(const std::string& path = "CHEMISTRY/unimod.xml",
                                     std::string* error = nullptr);

    /**
      @brief The PSI-MOD terms of an OBO file, read with their own specificity.

      ModificationsDB keeps a PSI-MOD term that cross-references Unimod only
      as an alias of the Unimod entry, so its accession, name and narrower
      residue are lost there; this reads them from the file. Kept: terms
      with a DiffMono other than 0, not obsolete, one Origin residue (a
      cross-link's "C, S" is left out), Origin "X" only with an N-/C-term
      TermSpec. TermSpec N-term / C-term become N_TERM / C_TERM. The Unimod
      cross-reference is the "UniMod:<n>" of the def line, or an
      "xref: Unimod:<n>" line.

      @param[in] path the OBO file (absolute, or resolved as OpenMS::File::find does)
      @param[out] error why nothing was read, when the file cannot be read
      @return the entries, in file order
    */
    std::vector<Entry> psimodEntries(const std::string& path, std::string* error = nullptr);

    /// A fixed residue modification of the search (database residues carry it).
    struct FixedMod
    {
      char residue;
      double mass;
      std::string name;
    };

    /// One catalogue entry that fits a gap, with the sites it fits on.
    struct Match
    {
      const Entry* entry = nullptr;
      /// Site labels, most-supported first: "M", "N-term", "N-term Q",
      /// "Protein N-term", "C-term G".
      std::vector<std::string> sites;
      std::string fixed;  ///< the fixed mod the entry replaces ("" = on top of it / none)
      double error = 0.0; ///< gap - (entry mass - fixed mass), Da
      std::uint64_t support = 0;  ///< localized spectra on those sites
    };

    /**
      @brief The entries that fit @p delta on any of @p sites, best first.

      Site compatibility: a residue site takes ANYWHERE entries of that
      residue; a terminal-ambiguous site takes those and the entries of its
      terminus (origin X or its residue), the protein-terminal ones only
      when the site is the protein's terminus too. Origin-X entries never
      match a residue site.

      Fixed modifications: database residues carry them, so a gap on a
      residue with a fixed mod is measured against the modified residue. An
      entry on that residue is tried twice: on top of the fixed mod (gap ~=
      entry mass) and instead of it (gap ~= entry mass - fixed mass; reported
      with @c fixed set), e.g. Cys->Dha (-33.988 vs Cys) is a gap of -91.009
      on carbamidomethyl-Cys.

      One match per (accession, fixed), its sites merged (a Unimod accession
      has one entry per site). Sorted by support (the localized spectra on
      its sites, from @p support; most first), then |error|, then accession;
      at most @p cap. Unimod and PSI-MOD are ranked alike: within the
      tolerance the entry that explains more of the row's localized
      spectra comes first, and mass error breaks ties.

      @param[in] entries the catalogue
      @param[in] delta the gap (Da)
      @param[in] tol_da the tolerance (Da)
      @param[in] sites the localized sites
      @param[in] fixed the fixed residue modifications
      @param[in] cap the most matches returned
      @param[in] support localized spectra per site (parallel to @p sites), or nullptr for 1 each
      @return the matches
    */
    std::vector<Match> match(const std::vector<Entry>& entries, double delta, double tol_da,
                             const std::vector<Site>& sites, const std::vector<FixedMod>& fixed,
                             std::size_t cap, const std::vector<std::uint64_t>* support = nullptr);

    /**
      @brief "Oxidation@M/W(+0.4ppm);Cys->Dha@C[-Carbamidomethyl](-1.2ppm)", or "-" when empty.

      @param[in] matches the matches, as match() returns them
      @param[in] psimod write PSI-MOD form ("MOD:00719 name@M(...)") instead of the Unimod name
      @param[in] ppm_of the mass a ppm error is relative to; <= 0 writes the error in mDa
      @return the cell
    */
    std::string format(const std::vector<Match>& matches, bool psimod, double ppm_of);

    /// The 13C - 12C mass difference (Da), the step of a precursor or flank isotope error.
    constexpr double C13_STEP = 1.0033548378;

    /**
      @brief The isotope-error reading of a row, "13C+1(+0.4ppm)", or "-".

      A row whose delta is within @p tol_da of k * C13_STEP (k = 1 or 2,
      the nearer) reads as an isotope error, unless a residue-specific
      catalogue name explains it better: a match in @p names (as match()
      returns them, uncapped) that is not an isotopic label, sits on a
      residue (not an origin-X terminal entry), has a smaller |error| than
      the isotope step and carries at least half of the row's @p localized
      spectra. Deamidation (+0.984, 19 mDa below +1.003) on N/Q-localized
      rows therefore keeps its name and no isotope reading.

      @param[in] delta the row's delta (Da)
      @param[in] tol_da the name tolerance (Da)
      @param[in] names the row's Unimod matches
      @param[in] localized the row's localized spectra
      @param[in] ppm_of the mass a ppm error is relative to; <= 0 writes mDa
      @return the cell
    */
    std::string isotopeError(double delta, double tol_da, const std::vector<Match>& names,
                             std::uint64_t localized, double ppm_of);

    /**
      @brief The observation class of one sampled gap (1.16b), assigned before any catalogue name.

      Tried in this order, the first that fits within the tolerance wins
      (FIXED_LOSS first when the gap is localized on a residue that carries
      the fixed modification: -57.021 is a lost carbamidomethyl and a lost
      Gly alike, and the site tells them apart): EXTENSION (the gap is the mass of the 1-3 protein residues beyond the
      peptide on the gap's side: a missed cleavage or a longer peptide),
      TRUNCATION (minus the mass of the 1-3 region residues next to that
      terminus: a shorter, semi-specific peptide), ADDUCT (the nearest of
      Na+, Mg2+, K+, Ca2+, Fe3+, Fe2+ for protons, or NH3), ISOTOPE (k x 13C, k = 1, 2, on a precursor-derived
      flank only, and for k = 1 nearer +1.00336 than deamidation's
      +0.98402), LOSS (H2O, NH3, CH4SO, H3PO4 lost), FIXED_LOSS (minus a
      fixed modification on a region residue that carries it: -57.021 on
      Cys searched as carbamidomethyl is an unalkylated Cys),
      FIXED_REPLACEMENT / TERMINAL / RESIDUE (a non-label catalogue entry
      fits: instead of a fixed modification, on a terminus, on a residue),
      SUBSTITUTION (the placement's own sub:X->Y reading), else UNKNOWN.
    */
    enum class ObsClass : std::uint8_t
    {
      NONE = 0, EXTENSION, TRUNCATION, ADDUCT, ISOTOPE, LOSS, FIXED_LOSS, FIXED_REPLACEMENT, TERMINAL,
      RESIDUE, SUBSTITUTION, UNKNOWN
    };
    inline constexpr std::size_t OBS_CLASSES = 12;  ///< number of ObsClass values

    /// "-", "extension", "truncation", "adduct", "isotope", "loss", "fixed_loss",
    /// "fixed_replacement", "terminal", "residue", "substitution", "unknown".
    const char* obsClassName(ObsClass c);

    /// What observationClass() reads about one sampled gap.
    struct Observation
    {
      double delta = 0.0;           ///< the gap (Da)
      double tol_da = 0.0;          ///< the tolerance (Da)
      bool precursor_flank = false; ///< the gap is on the flank derived from the precursor mass
      /// Masses of the 1, 2, 3 protein residues beyond the peptide on the gap's side (fixed mods included).
      std::vector<double> beyond;
      /// Masses of the 1, 2, 3 region residues next to the gap's terminus.
      std::vector<double> inside;
      /// The region's residues (I/L as in the database) and the sites a name may sit on.
      std::string region;
      std::vector<Site> sites;
      std::string interp;  ///< the placement's gap reading ("sub:X->Y", "mod:...", "?")
      bool localized = false;  ///< @p sites is the one site the evidence chose (else every region site)
    };

    /**
      @brief The observation class of @p o (see ObsClass).

      @param[in] o the gap
      @param[in] unimod the catalogue (isotopic labels are not used)
      @param[in] fixed the fixed residue modifications
      @param[out] detail what fits: residues, "Na", "13C+1", "H2O", the entry's name, or empty
      @return the class
    */
    ObsClass observationClass(const Observation& o, const std::vector<Entry>& unimod,
                              const std::vector<FixedMod>& fixed, std::string* detail = nullptr);

    /**
      @brief The exact isobars of a named row: "Oxidation=Ala->Ser=Phe->Tyr", or "-".

      The members whose mass is within @p iso_tol of the row's best name
      (the first non-label entry of @p names, its mass @p delta less its
      error): that name, the other catalogue names in @p names (as match() returns them,
      uncapped; isotopic labels left out), single substitutions X->Y of a
      residue X among @p sites (unmodified Y against X with its fixed
      modification, if any), and sums of two common modifications
      (Oxidation, Deamidated, Acetyl, Methyl, Carbamidomethyl, Carbamyl,
      Formyl, Phospho, Dehydrated, Amidated, Cation:Na). Exact isobars
      (oxidation = A->S = F->Y, dioxidation = P->E = 2 x oxidation, acetyl =
      S->E, deamidation = N->D = Q->E, carbamidomethyl = G->N, carboxymethyl =
      acetyl + oxidation) have one elemental composition; mass cannot tell
      them apart, so a row reports the class, not one winner. "-" when the
      class has one member.

      @param[in] delta the row's delta (Da)
      @param[in] names the row's catalogue matches, best first
      @param[in] sites the row's localized sites
      @param[in] fixed the fixed residue modifications
      @param[in] iso_tol the isobar tolerance (Da)
      @return the cell
    */
    std::string isobarClass(double delta, const std::vector<Match>& names, const std::vector<Site>& sites,
                            const std::vector<FixedMod>& fixed, double iso_tol);

    /**
      @brief A two-modification reading of a named row that fits its localized site, or "".

      Exact isobars cannot be told apart by mass (isobarClass() lists them), but
      the site can favour one: +58.005 on a protein N-terminal Met is Acetyl
      (protein N-term) + Oxidation (M), while the single Unimod name,
      Carboxymethyl@N-term, does not involve the Met at all. Returned only when
      the row's best name (the first non-label entry of @p names) is not
      specific to the residue of the most-supported site nor itself one of the common
      modifications (Acetyl@N-term stays, though it equals Methyl+Formyl), and a sum of two
      common modifications (the list isobarClass() uses) within @p iso_tol of
      that name's mass has both parts fit that site (match() on it) with at
      least one part specific to its residue. Then -delta_out writes it before
      the Unimod names: "Oxidation+Acetyl@M/Protein N-term(-0.3ppm)". Rows whose
      best name is already residue-specific (e.g. Dimethyl@K, also Methyl+Methyl)
      are left alone.

      @param[in] delta the row's delta (Da)
      @param[in] names the row's Unimod matches, best first
      @param[in] sites the row's localized sites
      @param[in] support localized spectra per site (parallel to @p sites), or nullptr
      @param[in] entries the Unimod catalogue
      @param[in] fixed the fixed residue modifications
      @param[in] iso_tol the isobar tolerance (Da)
      @param[in] ppm_of the mass a ppm error is relative to; <= 0 writes the error in mDa
      @return the cell entry, or "" when there is none
    */
    std::string siteCombination(double delta, const std::vector<Match>& names, const std::vector<Site>& sites,
                                const std::vector<std::uint64_t>* support, const std::vector<Entry>& entries,
                                const std::vector<FixedMod>& fixed, double iso_tol, double ppm_of);

    /// One -delta_out row: its centre bin and the bins it takes.
    struct BinGroup
    {
      std::int64_t center = 0;
      std::vector<std::int64_t> bins;  ///< ascending, center included
    };

    /**
      @brief Group histogram bins into -delta_out rows.

      @p width > 0 (bins): seeds in order of count (most first, then lower
      key) each take every bin not yet taken within @p width bins of
      themselves; no chaining, so a row spans at most 2 * width + 1 bins and
      every bin (and spectrum) goes to exactly one row. Deterministic.

      @p width == 0: the 1.15 rule, reproduced exactly: a bin no neighbour
      exceeds is a row and takes its strictly smaller neighbours (a valley
      between two rows goes to the lower one); a bin that is neither is left
      out.

      @param[in] counts spectra per bin key
      @param[in] width the half-width in bins, 0 for the 1.15 rule
      @return the rows, by center
    */
    std::vector<BinGroup> groupBins(const std::map<std::int64_t, std::uint64_t>& counts, std::int64_t width);

    /// "K:41,S:3,N-term|K:12": counts by site key, by count (descending) then key; "-" when empty.
    std::string formatSites(const std::map<std::string, std::uint64_t>& counts);
  }
}
