// The census identifiability score (FASTag 1.16, item 4; -census_score).
//
// With -census -census_score the census table gains four columns taken
// BEFORE any database filter (pre_best_evalue, pre_best_len,
// pre_best_mean_conf, pre_tag_cover: the best of all tags the selected
// precursor hypothesis returned, whatever -fasta later keeps) and, after
// the tagging loop, the column ident_score: a frozen logistic model of how
// likely the run's first database search identifies the spectrum.
//
// Contract.
//   - Every census row gets a score, whatever its status: a feature a
//     spectrum does not have (no precursor, no tag, not prepared) is the
//     lowest value of its feature in the run.
//   - Features are standardized per run: each is replaced by its mid-rank
//     in the run, (rank - 0.5) / n with ties averaged, so E-value scales
//     (database size, tolerance, analyzer) do not enter the model.
//   - The model (Model below) was fitted once on the development samples of
//     PXD000561 (acceptance/ident/splits.tsv) against a fixed Sage search and
//     is frozen in this header; FASTag never refits it.
//   - It is a ranking score for review order, not a calibrated probability
//     and not a quality call. Because of the per-run ranks it depends on the
//     whole run (and on subsampling).
// The table is rescored in two streaming passes over the finished census
// (as -census_ids joins it); -census_sorted_out writes the same rows ordered
// by ident_score, highest first (ties: input order).
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#pragma once

#include "Digest.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace FASTag::CensusScore
{
  /// Number of model features.
  inline constexpr std::size_t N_FEATURES = 12;

  /// Feature names, in model order (census column each is read from).
  inline constexpr std::array<const char*, N_FEATURES> FEATURE_COLUMNS = {
      "pre_best_evalue",  // as -log10(E)
      "pre_best_len", "pre_best_mean_conf", "pre_tag_cover", "n_found", "n_peaks", "n_compl", "n_edges",
      "n_peaks_kept", "int_gini", "charge_used", "precursor_mz"};

  /**
    @brief The frozen model: intercept and one coefficient per feature (on the rank scale).
  */
  struct Model
  {
    const char* id;                       ///< model name, written to the summary
    double intercept;                     ///< b0
    std::array<double, N_FEATURES> coef;  ///< b_k, FEATURE_COLUMNS order
  };

  /// The model FASTag uses (fitted on PXD000561 development samples; see src/CensusScore.h and doc/CENSUS-IDENT.md).
  const Model& model();

  /// Header suffix of the pre-filter columns (Census::header() with score columns).
  inline constexpr const char* PRE_COLUMNS = "\tpre_best_evalue\tpre_best_len\tpre_best_mean_conf\tpre_tag_cover";
  /// Header suffix of the score column.
  inline constexpr const char* SCORE_COLUMN = "\tident_score";

  /**
    @brief The raw value of one feature from its census field.

    Empty or unparsable fields (a fact the spectrum does not have) give
    -infinity, the lowest value of the run. pre_best_evalue becomes
    -log10(E); E = 0 gives +infinity's stand-in 400.

    @param[in] k Feature index (FEATURE_COLUMNS).
    @param[in] field The census field text.
    @return The raw value.
  */
  double rawFeature(std::size_t k, const std::string& field);

  /**
    @brief Replaces values by their per-run mid-rank, (rank - 0.5) / n.

    Ties get the mean of their ranks; -infinity ties with itself.

    @param[in,out] v Values of one feature over the run's rows.
  */
  void midRanks(std::vector<double>& v);

  /**
    @brief The model's score of one row from its rank features.

    @param[in] m Model.
    @param[in] r Rank features (FEATURE_COLUMNS order).
    @return 1 / (1 + exp(-(b0 + sum b_k r_k))).
  */
  double score(const Model& m, const std::array<double, N_FEATURES>& r);

  /**
    @brief Counts of a scored table.
  */
  struct Tally
  {
    std::uint64_t rows = 0;  ///< rows scored
    std::uint64_t pre_tagged = 0;  ///< rows with a pre-filter tag (pre_best_evalue set)
  };

  /**
    @brief Scores a census table: appends ident_score to every row.

    @param[in] header_line The table's header line (no newline); must hold
      every FEATURE_COLUMNS name.
    @param[in] in Census table path.
    @param[in] out Output path (header_line + ident_score).
    @param[in] m Model.
    @param[out] tally Counts (reset first).
    @param[out] error The message on failure.
    @return false on a read, format or write failure.
  */
  bool scoreTableAs(const std::string& header_line, const std::string& in, const std::string& out, const Model& m,
                    Tally& tally, std::string& error);

  /**
    @brief Writes the rows of a scored table ordered by ident_score.

    Highest first; equal scores (as written) keep input order. A leading
    column ident_rank (1-based) is added.

    @param[in] in Scored census table (any columns after ident_score, e.g. identified and triage, are kept).
    @param[in] out Output path.
    @param[out] error The message on failure.
    @return false on a read, format or write failure.
  */
  bool writeSorted(const std::string& in, const std::string& out, std::string& error);

  /**
    @brief The `census_score` section of -census_summary_out.

    @param[in] m Model.
    @param[in] t Counts of the scored table.
    @return The summary rows.
  */
  std::vector<Digest::Row> summaryRows(const Model& m, const Tally& t);
}
