// Ranked protein shortlist and reduced FASTA (FASTag 1.12, item #5).
//
// Turns the placements FASTag already computes (TagReconciler over
// ProteomeIndex) into a ranked list of proteins, a reduced FASTA of the kept
// ones plus an optional background, and the protease check that decides
// whether a tryptic placement index may reduce the database at all. This is a
// SEARCH-SPACE REDUCTION, not an identification, not protein inference and not
// FDR-controlled; the TSV header and the log say so.
//
// Everything here is a pure function of its arguments (no OpenMS logging, no
// global state), so the unit test exercises exactly what the tool runs.
// Results never depend on the order of the evidence or the thread count.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#pragma once

#include <OpenMS/FORMAT/FASTAFile.h>

#include <cstdint>
#include <string>
#include <vector>

namespace FASTag::Digest
{
  struct Classification;
}

namespace FASTag::Shortlist
{
  /// One qualifying placement of one reported tag (about 20 bytes). A tag
  /// with several placements gives several records; a spectrum with several
  /// tags on one protein counts once for that protein (rankProteins).
  struct Evidence
  {
    std::uint32_t spectrum = 0;      ///< input index of the spectrum
    std::uint32_t protein = 0;       ///< database ordinal (ProteomeIndex order)
    float evalue = 0.0f;             ///< the tag's E-value
    std::uint32_t window_start = 0;  ///< 0-based start of the tryptic window in the protein
    std::uint16_t window_len = 0;    ///< its length (capped at 65535)
    std::uint8_t exact = 0;          ///< 1 = exact or label-exact, 0 = gapped
  };

  /// How a placement counts: both flanks agree (Exact); one flank is off by
  /// exactly the fixed terminal modification the spectrum carries and the
  /// database prefix does not (LabelExact, counted as exact); anything else
  /// with one flank mismatch (Gapped).
  enum class Placement
  {
    Exact,
    LabelExact,
    Gapped
  };

  /// @p delta is the reconciliation's delta_mass (spectrum flank minus
  /// database flank on the mismatched side), @p fixed_n / @p fixed_c the
  /// fixed peptide N-/C-terminal modification masses (0 = none), @p tol_da the
  /// flank tolerance in Da at that flank. The raw match flags are not changed.
  Placement classifyPlacement(bool nterm_match, bool cterm_match, double delta, double fixed_n,
                              double fixed_c, double tol_da);

  enum class Parsimony
  {
    None,    ///< keep every protein above the evidence floor
    Subset,  ///< drop a protein whose spectra are a subset of a higher-ranked kept one's
    Greedy   ///< greedy set cover of the spectra, in rank order
  };

  struct Settings
  {
    double max_evalue = 0.1;          ///< -shortlist_max_evalue
    std::uint64_t min_spectra = 2;    ///< -shortlist_min_spectra
    bool gapped = false;              ///< -shortlist_gapped
    Parsimony parsimony = Parsimony::None;
    std::size_t top = 0;              ///< -shortlist_top, 0 = no cap
  };

  /// The default -shortlist_decoy_affix list: OpenMS DecoyHelper's prefix
  /// spellings with their separator, and the two suffix forms.
  std::vector<std::string> defaultDecoyAffixes();

  /// True if @p accession starts with an affix of @p affixes that ends in a
  /// separator ('_'), or ends with one that starts with it, case-insensitive.
  /// An affix without a separator at its inner end is matched as a prefix.
  bool isDecoy(const std::string& accession, const std::vector<std::string>& affixes);

  /// What the ranking needs to know about each database entry.
  struct ProteinInfo
  {
    std::string accession;
    std::uint32_t length = 0;
    bool decoy = false;
    /// Ordinal of the first identical entry (same identifier and sequence);
    /// its own ordinal when it is the first. Evidence on a duplicate counts
    /// for that entry.
    std::uint32_t canonical = 0;
  };

  /// Duplicate identifiers of one database (checkDuplicates).
  struct DuplicateCheck
  {
    std::vector<std::uint32_t> canonical;  ///< per entry, see ProteinInfo::canonical
    std::size_t identical = 0;             ///< entries collapsed onto an earlier one
    std::string conflict;                  ///< identifier seen with two sequences; "" if none
  };

  /// Identical duplicates (identifier and sequence) collapse onto the first;
  /// a conflicting one (same identifier, other sequence) is reported.
  DuplicateCheck checkDuplicates(const std::vector<OpenMS::FASTAFile::FASTAEntry>& entries);

  /// The background entries to append: decoys (by @p affixes) and entries
  /// identical to an earlier background entry or to a database entry are
  /// dropped. Returns "" or the identifier that a background entry and the
  /// database (or two background entries) spell with different sequences.
  std::string selectBackground(const std::vector<OpenMS::FASTAFile::FASTAEntry>& database,
                               const std::vector<OpenMS::FASTAFile::FASTAEntry>& background,
                               const std::vector<std::string>& affixes,
                               std::vector<OpenMS::FASTAFile::FASTAEntry>& kept,
                               std::size_t* decoys = nullptr, std::size_t* duplicates = nullptr);

  /// One row of the shortlist.
  struct ProteinRow
  {
    std::uint32_t ordinal = 0;
    std::string accession;
    std::uint64_t spectra = 0, peptides = 0, exact_spectra = 0, gapped_spectra = 0;
    double weighted = 0.0;  ///< sum over its spectra of 1 / (proteins that spectrum hits)
    double nsaf = 0.0;      ///< weighted / length
    float best_evalue = 0.0f;
    std::uint32_t length = 0;
    std::size_t rank = 0;   ///< 1-based among the target proteins with evidence; 0 = no rank
    bool kept = false;
    /// selected, below_min_spectra, subset_of:<acc>, not_in_cover, beyond_top,
    /// background, decoy
    std::string reason;
  };

  /// Ranks and selects. Evidence above max_evalue, gapped evidence unless
  /// enabled and evidence on decoys never counts for a target; a decoy with
  /// evidence gets a row (kept 0, reason decoy). Target rows come first, by
  /// rank: spectra desc, peptides desc, weighted desc, best E asc, accession
  /// asc, ordinal asc; then decoy rows in ordinal order. Selection: the
  /// min_spectra floor, then parsimony, then the top cap (ties at the cut on
  /// spectra, peptides, weighted and best E are kept).
  std::vector<ProteinRow> rankProteins(std::vector<Evidence> evidence,
                                       const std::vector<ProteinInfo>& proteins,
                                       const Settings& s);

  /// Writes the shortlist TSV: '#' header lines (@p header, each written as
  /// "# <line>"), the column header, then @p rows and one `background` row per
  /// @p background entry. Through a .part file renamed on success. False with
  /// @p err on a failed write (nothing left at @p path's .part).
  bool writeShortlist(const std::string& path, const std::vector<std::string>& header,
                      const std::vector<ProteinRow>& rows,
                      const std::vector<OpenMS::FASTAFile::FASTAEntry>& background, std::string* err);

  struct FastaWriteResult
  {
    bool ok = false;
    std::size_t entries = 0;  ///< entries written (database plus background)
    std::string error;
  };

  /// The reduced FASTA: the database at @p db_path is streamed again and the
  /// entries whose ordinal is set in @p keep are written, in database order,
  /// as ">identifier description" with the sequence wrapped at 80 columns,
  /// then @p background. Identifier, description and sequence round-trip
  /// through FASTAFile::load; the original line wrapping is not kept. Written
  /// to a .part file and renamed only when every write and the close
  /// succeeded. A database with a different number of entries than @p keep is
  /// an error (the file changed during the run).
  FastaWriteResult writeReducedFasta(const std::string& db_path, const std::vector<bool>& keep,
                                     const std::vector<OpenMS::FASTAFile::FASTAEntry>& background,
                                     const std::string& out_path);

  /// The protease check before the hand-off writers. The placement index is
  /// tryptic (ProteomeIndex), so a shortlist from a run digested otherwise
  /// would rank the wrong windows.
  struct ProteaseVerdict
  {
    enum Kind
    {
      Compatible,    ///< Trypsin, Lys-C or Arg-C called: proceed
      Inconclusive,  ///< no confident call: WARN and proceed
      NonTryptic     ///< another protease called confidently: refuse unless forced
    } kind = Inconclusive;
    std::string model;   ///< the called model ("" when not scored)
    std::string reason;  ///< why, one short phrase for the log and the TSV header
    double margin = 0.0; ///< log-likelihood per tag end over the best trypsin-compatible model
  };

  /// Margin (log-likelihood per tag end) a non-trypsin-compatible call needs
  /// over the best trypsin-compatible model to count as confident.
  inline constexpr double kNonTrypticMargin = 0.05;

  /// @p c the Digest classification over the run's tag ends;
  /// @p low_resolution a Da fragment tolerance (the residue windows do not
  /// hold); @p spectra the MS2 spectra with at least one counted tag end.
  ProteaseVerdict proteaseVerdict(const FASTag::Digest::Classification& c, bool low_resolution,
                                  std::uint64_t spectra, std::uint64_t min_spectra = 100,
                                  double min_margin = kNonTrypticMargin);
}
