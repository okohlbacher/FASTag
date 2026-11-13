// The census ids join (FASTag 1.12, item #11 phase B, "F6 ids join").
//
// -census_ids <idXML|mzid> adds two columns to the census table, identified
// (1, 0, or empty for unknown) and triage (1, 0, or empty), and a section
// `census_ids` to the census summary: the cross-tab of status by identified
// and the count of triage candidates. Without -census_ids the census is the
// one of phase A, byte for byte.
//
// Accepted hits. A spectrum is identified only if one of its
// PeptideIdentifications holds a target hit that passes the file's own FDR:
// its q-value is <= -census_ids_fdr. The q-value is the hit's score when the
// identification's score type is a q-value and lower is better, otherwise the
// hit's `q-value` or `MS:1002354` meta value. Decoy hits (target_decoy =
// decoy) are ignored; target+decoy counts as a target, as in OpenMS's FDR. A
// hit without a q-value never passes. A file in which no hit carries a
// q-value is refused (INCOMPATIBLE_INPUT_DATA): presence alone never counts as
// identified, and the user is pointed to IDFilter.
//
// Matching. The spectrum reference is matched to the census row's native id
// exactly first. A scan-number fallback is used only when the scan number is
// unique among the references and among the spectra read, and the reference
// matched no spectrum exactly. An ambiguous scan makes the spectrum unknown.
// A spectrum no reference names is not identified (0). A
// PeptideIdentification with hits but without a spectrum_reference (empty
// or blank; pepXML converted without -mz_file, older idXML) cannot be
// matched: such a file is refused (INCOMPATIBLE_INPUT_DATA) before any
// output, and the user is pointed to IDFileConverter -mz_file. An empty
// reference never enters the Index.
//
// Run provenance. The primary MS run paths of the file are compared with -in
// by name without extension: a different name is a warning, more than one
// run is refused (a merged-run file). References that match no spectrum read
// are counted: above 1% FASTag warns, above 50% the census is refused. Under
// subsampling unread spectra cannot be told from foreign references, so the
// count and both thresholds are skipped.
//
// Triage. triage = 1 for spectra with identified = 0, status tagged or placed
// and best_evalue <= -census_triage_evalue, as written in the census row (the
// rule can be recomputed from the table). It is an E-value threshold, not a
// quality call.
//
// The join runs after the tagging loop on the finished census table (two
// streaming passes), so the tagging loop, its outputs and the census rows of
// phase A are untouched.
//
// Layout. The join finds the columns it reads (spectrum, status,
// best_evalue) and the field count by name in Census::header(), so a census
// column added later moves them without breaking the join. identified and
// triage are always the last two columns.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#pragma once

#include "Census.h"
#include "Digest.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

namespace OpenMS
{
  class PeptideHit;
  class PeptideIdentification;
  class PeptideIdentificationList;
  class ProteinIdentification;
}

namespace FASTag::CensusIds
{
  /// Format version of the `census_ids` summary section and the two columns.
  inline constexpr int TABLE_VERSION = 1;

  /// Default of -census_ids_fdr.
  inline constexpr double DEFAULT_FDR = 0.01;
  /// Default of -census_triage_evalue.
  inline constexpr double DEFAULT_TRIAGE_EVALUE = 0.01;

  /// Share of unmatched references that warns.
  inline constexpr double WARN_UNMATCHED = 0.01;
  /// Share of unmatched references that refuses.
  inline constexpr double REFUSE_UNMATCHED = 0.5;

  /**
    @brief The identified value of one spectrum. Append-only.
  */
  enum class Ident : std::uint8_t { NO = 0, YES = 1, UNKNOWN = 2 };
  /// Number of Ident values.
  inline constexpr std::size_t IDENT_COUNT = 3;
  /**
    @brief Table text of an identified value.

    @param[in] i The value.
    @return "0", "1" or "" (unknown), as written in the table.
  */
  const char* text(Ident i);
  /**
    @brief Summary key of an identified value.

    @param[in] i The value.
    @return "0", "1" or "unknown", as used in the summary keys.
  */
  const char* key(Ident i);

  /**
    @brief The scan number in a native id or spectrum reference.

    The digits after a `scan=` field (at the start or after a space), or the
    whole reference when it is a plain non-negative integer. `index=` and MGF
    titles name no scan.

    @param[in] id Native id or spectrum reference.
    @return The scan number; -1 otherwise.
  */
  long long scanOf(const std::string& id);

  /**
    @brief File name of @p path without directory and MS/compression extensions.

    Extensions .mzML, .mzXML, .mgf, .raw, .d, .mzpeak, .wiff, .gz, .bz2,
    .zip are removed, case-insensitive, repeatedly; a file:// prefix and
    backslashes are accepted.

    @param[in] path File path or URI.
    @return The stem.
  */
  std::string runStem(const std::string& path);

  /**
    @brief Whether a score type is a q-value.

    @param[in] score_type Score type name.
    @return true for q-value, qvalue, q_value, MS:1002354, PSM-level q-value
      (case-insensitive).
  */
  bool isQValueScoreType(const std::string& score_type);

  /**
    @brief The q-value of @p hit within @p id (see the file comment).

    @param[in] id The identification (its score type).
    @param[in] hit The hit.
    @return The q-value; NaN when none.
  */
  double qValue(const OpenMS::PeptideIdentification& id, const OpenMS::PeptideHit& hit);

  /**
    @brief References and their acceptance, matched to census rows in two passes.
  */
  class Index
  {
  public:
    /**
      @brief Adds one PeptideIdentification's reference.

      The reference is escaped as a census field, with whether it holds an
      accepted hit. The same reference twice is one reference, accepted if
      either is. An empty or blank reference is not added; interpret()
      counts it in Loaded::n_no_ref.

      @param[in] ref Spectrum reference.
      @param[in] accepted Whether the identification holds an accepted hit.
      @return false when the reference is empty or blank (not added).
    */
    bool add(const std::string& ref, bool accepted);
    /**
      @brief Pass 1: registers a spectrum read.

      @param[in] native_id Its census native id, escaped.
    */
    void see(const std::string& native_id);
    /**
      @brief Pass 2, after every see(): the identified value of a spectrum.

      @param[in] native_id Its census native id, escaped.
      @return Yes, No or Unknown (ambiguous scan).
    */
    Ident lookup(const std::string& native_id);

    /**
      @brief How the references matched (counts()).
    */
    struct Counts
    {
      std::size_t refs = 0;       ///< distinct references
      std::size_t exact = 0;      ///< matched a spectrum's native id exactly
      std::size_t by_scan = 0;    ///< matched through the unique scan fallback
      std::size_t ambiguous = 0;  ///< their scan matched several spectra or references
      std::size_t unmatched = 0;  ///< matched no spectrum read
    };
    /// @brief How the references matched.
    /// @return Counts per match kind.
    Counts counts() const;

  private:
    struct Ref
    {
      bool accepted = false;
      bool exact = false, by_scan = false, ambiguous = false;
      long long scan = -1;
    };
    std::unordered_map<std::string, Ref> refs_;
    std::unordered_map<long long, std::vector<Ref*>> by_scan_;   ///< built on the first see()
    std::unordered_map<long long, std::uint32_t> input_scans_;   ///< scans of the spectra read
    bool scans_built_ = false;
  };

  /**
    @brief What the identification file held.
  */
  struct Loaded
  {
    std::size_t n_ids = 0;          ///< PeptideIdentifications
    std::size_t n_with_hits = 0;    ///< ... with at least one hit
    std::size_t n_accepted = 0;     ///< ... with an accepted target hit
    std::size_t n_decoy_only = 0;   ///< ... whose hits are all decoys
    std::size_t n_hits = 0;         ///< hits
    std::size_t n_hits_q = 0;       ///< hits with a q-value
    std::size_t n_no_ref = 0;       ///< PeptideIdentifications without a spectrum_reference
    std::size_t n_no_ref_hits = 0;  ///< ... of them with at least one hit (refused when > 0)
    std::vector<std::string> runs;  ///< distinct primary MS run stems (runStem)
    std::string refusal;            ///< non-empty: the file is refused (the message)
  };

  /**
    @brief Interprets loaded identifications into @p index (see the file comment).

    Sets Loaded::refusal for a file without q-values, with several runs or
    with identifications (with hits) that carry no spectrum_reference.

    @param[in] proteins Protein identifications (primary MS run paths).
    @param[in] peptides Peptide identifications.
    @param[in] fdr q-value threshold for an accepted hit.
    @param[in,out] index Receives each identification's reference (add()).
    @return Counts, run stems and the refusal message.
  */
  Loaded interpret(const std::vector<OpenMS::ProteinIdentification>& proteins,
                   const OpenMS::PeptideIdentificationList& peptides, double fdr, Index& index);

  /**
    @brief Loads @p path (idXML or mzid) and interprets it.

    A load error is a refusal (Loaded::refusal), not an exception.

    @param[in] path Identification file.
    @param[in] fdr q-value threshold for an accepted hit.
    @param[in,out] index Receives each identification's reference (add()).
    @return As interpret().
  */
  Loaded load(const std::string& path, double fdr, Index& index);

  /**
    @brief Counts of the joined table.
  */
  struct JoinTally
  {
    std::array<std::array<std::uint64_t, IDENT_COUNT>, Census::STATUS_COUNT> by_status{};  ///< rows per status and identified value
    std::array<std::uint64_t, IDENT_COUNT> by_ident{};  ///< rows per identified value
    std::uint64_t rows = 0;             ///< rows joined
    std::uint64_t triage = 0;           ///< triage = 1
    std::uint64_t triage_eligible = 0;  ///< identified 0 and tagged or placed
  };

  /// The two columns' header suffix, appended to Census::header().
  inline constexpr const char* HEADER_SUFFIX = "\tidentified\ttriage";

  /**
    @brief Joins the identifications into the census table.

    Reads the census table @p in (Census::header() and its rows) twice and
    writes it to @p out with the columns identified and triage appended.

    @param[in] in Census table path.
    @param[in] out Output path.
    @param[in,out] index The references; see() and lookup() update its match state.
    @param[in] triage_evalue E-value threshold of the triage column.
    @param[out] tally Counts of the joined table (reset first).
    @param[out] error The message on failure.
    @return false on a read, format or write failure.
  */
  bool joinTable(const std::string& in, const std::string& out, Index& index, double triage_evalue,
                 JoinTally& tally, std::string& error);

  /**
    @brief Where the join reads a census row.

    Field count and the 0-based columns spectrum, status and best_evalue,
    found by name in a header line.
  */
  struct Layout
  {
    /// Field count, and the 0-based columns spectrum, status and best_evalue.
    std::size_t fields = 0, spectrum = 0, status = 0, best_evalue = 0;
  };
  /**
    @brief The layout of a census header line.

    @param[in] header_line Tab-separated names, no newline.
    @param[out] layout The layout (reset first).
    @return false when a column the join reads is missing.
  */
  bool layoutOf(const std::string& header_line, Layout& layout);

  /**
    @brief joinTable() for a census table with header line @p header_line.

    Uses @p header_line (no newline) instead of Census::header();
    joinTable() calls it with Census::header(). Exposed so a test can join a
    table with more columns.

    @param[in] header_line The table's header line.
    @param[in] in Census table path.
    @param[in] out Output path.
    @param[in,out] index The references; see() and lookup() update its match state.
    @param[in] triage_evalue E-value threshold of the triage column.
    @param[out] tally Counts of the joined table (reset first).
    @param[out] error The message on failure.
    @return false on a read, format or write failure.
  */
  bool joinTableAs(const std::string& header_line, const std::string& in, const std::string& out, Index& index,
                   double triage_evalue, JoinTally& tally, std::string& error);

  /**
    @brief Run-provenance verdict for the summary.

    @param[in] loaded What the identification file held (its run stems).
    @param[in] in_path Path of -in.
    @return "match", "mismatch" or "unnamed".
  */
  std::string runCheck(const Loaded& loaded, const std::string& in_path);

  /**
    @brief The `census_ids` section of -census_summary_out.

    @param[in] loaded What the identification file held.
    @param[in] counts How the references matched.
    @param[in] tally Counts of the joined table.
    @param[in] ids_path Path of -census_ids.
    @param[in] run_check Verdict of runCheck().
    @param[in] fdr -census_ids_fdr.
    @param[in] triage_evalue -census_triage_evalue.
    @param[in] unmatched_known false under subsampling (refs_unmatched is
      then written empty).
    @return The summary rows.
  */
  std::vector<Digest::Row> summaryRows(const Loaded& loaded, const Index::Counts& counts, const JoinTally& tally,
                                       const std::string& ids_path, const std::string& run_check, double fdr,
                                       double triage_evalue, bool unmatched_known);
}
