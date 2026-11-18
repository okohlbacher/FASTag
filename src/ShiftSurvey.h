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

    /// "K", "N-term|K", "Protein N-term|M", "C-term|R", "Protein C-term|L".
    std::string siteKey(const Site& s);
    /// The inverse of siteKey; false for anything else.
    bool parseSiteKey(const std::string& key, Site& out);

    /// Every Unimod entry OpenMS's ModificationsDB holds (record id > 0, a
    /// non-zero mass), one per site specificity.
    std::vector<Entry> unimodEntries();

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
      has one entry per site). Sorted by |error|, then support (the localized
      spectra on its sites, from @p support), then accession; at most @p cap.

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

    /// "K:41,S:3,N-term|K:12": counts by site key, by count (descending) then key; "-" when empty.
    std::string formatSites(const std::map<std::string, std::uint64_t>& counts);
  }
}
