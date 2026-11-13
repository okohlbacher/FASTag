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
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
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
  /**
    @brief One qualifying placement of one reported tag (about 20 bytes).

    A tag with several placements gives several records; a spectrum with
    several tags on one protein counts once for that protein (rankProteins).
  */
  struct Evidence
  {
    std::uint32_t spectrum = 0;      ///< input index of the spectrum
    std::uint32_t protein = 0;       ///< database ordinal (ProteomeIndex order)
    float evalue = 0.0f;             ///< the tag's E-value
    std::uint32_t window_start = 0;  ///< 0-based start of the tryptic window in the protein
    std::uint16_t window_len = 0;    ///< its length (capped at 65535)
    std::uint8_t exact = 0;          ///< 1 = exact or label-exact, 0 = gapped
  };

  /**
    @brief How a placement counts.

    Both flanks agree (Exact); one flank is off by exactly the fixed terminal
    modification the spectrum carries and the database prefix does not
    (LabelExact, counted as exact); anything else with one flank mismatch
    (Gapped).
  */
  enum class Placement
  {
    EXACT,       ///< both flanks agree
    LABEL_EXACT,  ///< one flank off by exactly the fixed terminal modification
    GAPPED       ///< any other one-flank mismatch
  };

  /**
    @brief Classifies one placement as Exact, LabelExact or Gapped.

    The raw match flags are not changed.

    @param[in] nterm_match Whether the N-terminal flank agrees.
    @param[in] cterm_match Whether the C-terminal flank agrees.
    @param[in] delta The reconciliation's delta_mass (spectrum flank minus
      database flank on the mismatched side, Da).
    @param[in] fixed_n Fixed peptide N-terminal modification mass (Da, 0 = none).
    @param[in] fixed_c Fixed peptide C-terminal modification mass (Da, 0 = none).
    @param[in] tol_da The flank tolerance in Da at that flank.
    @return The classification.
  */
  Placement classifyPlacement(bool nterm_match, bool cterm_match, double delta, double fixed_n,
                              double fixed_c, double tol_da);

  /**
    @brief Parsimony rule applied when selecting proteins.
  */
  enum class Parsimony
  {
    NONE,    ///< keep every protein above the evidence floor
    SUBSET,  ///< drop a protein whose spectra are a subset of a higher-ranked kept one's
    GREEDY   ///< greedy set cover of the spectra, in rank order
  };

  /**
    @brief Parameters of the ranking and selection (rankProteins).
  */
  struct Settings
  {
    double max_evalue = 0.1;          ///< -shortlist_max_evalue
    std::uint64_t min_spectra = 2;    ///< -shortlist_min_spectra
    bool gapped = false;              ///< -shortlist_gapped
    Parsimony parsimony = Parsimony::NONE;  ///< parsimony rule
    std::size_t top = 0;              ///< -shortlist_top, 0 = no cap
  };

  /**
    @brief The default -shortlist_decoy_affix list.

    OpenMS DecoyHelper's prefix spellings with their separator, and the two
    suffix forms.

    @return The affixes.
  */
  std::vector<std::string> defaultDecoyAffixes();

  /**
    @brief Whether an accession carries a decoy affix.

    True if @p accession starts with an affix of @p affixes that ends in a
    separator ('_'), or ends with one that starts with it, case-insensitive.
    An affix without a separator at its inner end is matched as a prefix.

    @param[in] accession Protein accession.
    @param[in] affixes Decoy affixes (defaultDecoyAffixes()).
    @return true for a decoy.
  */
  bool isDecoy(const std::string& accession, const std::vector<std::string>& affixes);

  /**
    @brief What the ranking needs to know about each database entry.
  */
  struct ProteinInfo
  {
    std::string accession;     ///< protein accession
    std::uint32_t length = 0;  ///< sequence length (residues)
    bool decoy = false;        ///< the entry is a decoy (isDecoy())
    /// Ordinal of the first identical entry (same identifier and sequence);
    /// its own ordinal when it is the first. Evidence on a duplicate counts
    /// for that entry.
    std::uint32_t canonical = 0;
  };

  /**
    @brief Duplicate identifiers of one database (checkDuplicates).
  */
  struct DuplicateCheck
  {
    std::vector<std::uint32_t> canonical;  ///< per entry, see ProteinInfo::canonical
    std::size_t identical = 0;             ///< entries collapsed onto an earlier one
    std::string conflict;                  ///< identifier seen with two sequences; "" if none
  };

  /**
    @brief Finds duplicate identifiers in a database.

    Identical duplicates (identifier and sequence) collapse onto the first;
    a conflicting one (same identifier, other sequence) is reported.

    @param[in] entries The database entries.
    @return Canonical ordinals, duplicate count and the first conflict.
  */
  DuplicateCheck checkDuplicates(const std::vector<OpenMS::FASTAFile::FASTAEntry>& entries);

  /**
    @brief Selects the background entries to append.

    Decoys (by @p affixes) and entries identical to an earlier background
    entry or to a database entry are dropped. A background entry identical
    to a database entry is not lost: its database ordinal (the first entry
    with that identifier) goes to @p in_database, and keepBackgroundTwins
    keeps that entry.

    @param[in] database The database entries.
    @param[in] background The candidate background entries.
    @param[in] affixes Decoy affixes.
    @param[out] kept The background entries to append (cleared first).
    @param[out] decoys If not null, receives the number of decoys dropped.
    @param[out] duplicates If not null, receives the number of duplicates dropped.
    @param[out] in_database If not null, receives the database ordinals of
      background entries identical to a database entry (cleared first).
    @return "" or the identifier that a background entry and the database
      (or two background entries) spell with different sequences.
  */
  std::string selectBackground(const std::vector<OpenMS::FASTAFile::FASTAEntry>& database,
                               const std::vector<OpenMS::FASTAFile::FASTAEntry>& background,
                               const std::vector<std::string>& affixes,
                               std::vector<OpenMS::FASTAFile::FASTAEntry>& kept,
                               std::size_t* decoys = nullptr, std::size_t* duplicates = nullptr,
                               std::vector<std::uint32_t>* in_database = nullptr);

  /**
    @brief One row of the shortlist.
  */
  struct ProteinRow
  {
    std::uint32_t ordinal = 0;  ///< database ordinal
    std::string accession;      ///< protein accession
    /// Evidence counts: spectra, distinct peptides, spectra with exact and with gapped evidence.
    std::uint64_t spectra = 0, peptides = 0, exact_spectra = 0, gapped_spectra = 0;
    double weighted = 0.0;  ///< sum over its spectra of 1 / (proteins that spectrum hits)
    double nsaf = 0.0;      ///< weighted / length
    float best_evalue = 0.0f;  ///< lowest E-value of its evidence
    std::uint32_t length = 0;  ///< sequence length (residues)
    std::size_t rank = 0;   ///< 1-based among the target proteins with evidence; 0 = no rank
    bool kept = false;      ///< written to the reduced FASTA
    /// selected, below_min_spectra, subset_of:<acc>, not_in_cover, beyond_top,
    /// background, decoy
    std::string reason;
  };

  /**
    @brief Ranks and selects the proteins.

    Evidence above max_evalue, gapped evidence unless enabled and evidence on
    decoys never counts for a target; a decoy with evidence gets a row
    (kept 0, reason decoy). Target rows come first, by rank: spectra desc,
    peptides desc, weighted desc, best E asc, accession asc, ordinal asc;
    then decoy rows in ordinal order. Selection: the min_spectra floor, then
    parsimony, then the top cap (ties at the cut on spectra, peptides,
    weighted and best E are kept).

    @param[in] evidence The placements (taken by value; order does not matter).
    @param[in] proteins Per database entry, what the ranking needs.
    @param[in] s Settings.
    @return The rows, targets by rank, then decoys.
  */
  std::vector<ProteinRow> rankProteins(std::vector<Evidence> evidence,
                                       const std::vector<ProteinInfo>& proteins,
                                       const Settings& s);

  /**
    @brief Keeps the database entries a background entry duplicates.

    The background is always kept: every database entry in @p twins (from
    selectBackground's in_database) that the selection did not keep is set
    in @p keep (at its canonical ordinal, never a decoy), and its row becomes
    kept 1, reason `background` (a row with rank `-` and no evidence is
    appended when it had none). The reduced FASTA then holds it once, in
    database order.

    @param[in] twins Database ordinals from selectBackground's in_database.
    @param[in] proteins Per database entry, what the ranking needs.
    @param[in,out] keep Per database ordinal, whether the entry is kept.
    @param[in,out] rows The shortlist rows; updated or appended.
    @return The number of entries newly kept.
  */
  std::size_t keepBackgroundTwins(const std::vector<std::uint32_t>& twins, const std::vector<ProteinInfo>& proteins,
                                  std::vector<bool>& keep, std::vector<ProteinRow>& rows);

  /**
    @brief Writes the shortlist TSV.

    '#' header lines (@p header, each written as "# <line>"), the column
    header, then @p rows and one `background` row per @p background entry.
    Through a .part file renamed on success.

    @param[in] path Output path.
    @param[in] header Header lines.
    @param[in] rows The shortlist rows.
    @param[in] background The appended background entries.
    @param[out] err If not null, receives the error message on failure.
    @return false on a failed write (nothing left at @p path's .part).
  */
  bool writeShortlist(const std::string& path, const std::vector<std::string>& header,
                      const std::vector<ProteinRow>& rows,
                      const std::vector<OpenMS::FASTAFile::FASTAEntry>& background, std::string* err);

  /**
    @brief Result of writeReducedFasta().
  */
  struct FastaWriteResult
  {
    bool ok = false;          ///< the file was written
    std::size_t entries = 0;  ///< entries written (database plus background)
    std::size_t decoys = 0;   ///< reversed decoys appended (@p decoy_prefix set)
    std::string error;        ///< error message when not ok
  };

  /**
    @brief Writes the reduced FASTA.

    The database at @p db_path is streamed again and the entries whose
    ordinal is set in @p keep are written, in database order, as
    ">identifier description" with the sequence wrapped at 80 columns, then
    @p background. Identifier, description and sequence round-trip through
    FASTAFile::load; the original line wrapping is not kept. Written to a
    .part file and renamed only when every write and the close succeeded. A
    database with a different number of entries than @p keep is an error
    (the file changed during the run).
    With @p decoy_prefix (1.13 #18, MSFragger, which generates no decoys)
    every written entry is followed, after all of them, by a decoy in the
    same order: identifier @p decoy_prefix + identifier, the same
    description, the sequence reversed whole (DecoyDatabase -method
    reverse; Philosopher). Empty: no decoys, the file as before.

    @param[in] db_path Path of the database FASTA.
    @param[in] keep Per database ordinal, whether the entry is written.
    @param[in] background Entries appended after the database entries.
    @param[in] out_path Output path.
    @param[in] decoy_prefix Prefix of reversed decoys to append ("" = none).
    @return Success, entry counts and the error message.
  */
  FastaWriteResult writeReducedFasta(const std::string& db_path, const std::vector<bool>& keep,
                                     const std::vector<OpenMS::FASTAFile::FASTAEntry>& background,
                                     const std::string& out_path, const std::string& decoy_prefix = std::string());

  /**
    @brief The protease check before the hand-off writers.

    The placement index is tryptic (ProteomeIndex), so a shortlist from a run
    digested otherwise would rank the wrong windows.
  */
  struct ProteaseVerdict
  {
    /// @brief The verdict.
    enum class Kind
    {
      COMPATIBLE,    ///< Trypsin, Lys-C or Arg-C called: proceed
      INCONCLUSIVE,  ///< no confident call: WARN and proceed
      NON_TRYPTIC    ///< another protease called confidently: refuse unless forced
    } kind = Kind::INCONCLUSIVE;
    std::string model;   ///< the called model ("" when not scored)
    std::string reason;  ///< why, one short phrase for the log and the TSV header
    double margin = 0.0; ///< log-likelihood per tag end over the best trypsin-compatible model
  };

  /// Margin (log-likelihood per tag end) a non-trypsin-compatible call needs
  /// over the best trypsin-compatible model to count as confident.
  inline constexpr double kNonTrypticMargin = 0.05;

  /**
    @brief Decides whether the run's protease allows a tryptic shortlist.

    @param[in] c The Digest classification over the run's tag ends.
    @param[in] low_resolution A Da fragment tolerance (the residue windows do not hold).
    @param[in] spectra The MS2 spectra with at least one counted tag end.
    @param[in] min_spectra Fewer spectra give Inconclusive.
    @param[in] min_margin Margin (log-likelihood per tag end) a non-trypsin-compatible
      call needs over the best trypsin-compatible model to give NonTryptic.
    @return The verdict.
  */
  ProteaseVerdict proteaseVerdict(const FASTag::Digest::Classification& c, bool low_resolution,
                                  std::uint64_t spectra, std::uint64_t min_spectra = 100,
                                  double min_margin = kNonTrypticMargin);
}
