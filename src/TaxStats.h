// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
//
// TaxStats.h -- FASTag taxonomy + statistics module (interface).
//
// This header declares FASTag::Taxonomy, a self-contained C++17 module that
// (1) loads the NCBI taxonomy tree from nodes.dmp / names.dmp dumps and
// answers tree queries (rank, name, lineage),
// (2) rolls per-taxon observed hit counts up the tree into subtree sums, and
// (3) performs a per-taxon enrichment test: a numerically stable log-space
// binomial upper-tail p-value per node, corrected across all tested nodes
// with Benjamini-Hochberg. It depends only on the standard library, holds no
// global mutable state, and is thread-safe for concurrent const reads after
// load() completes. It knows nothing about spectra, tags, or k-mers.

#pragma once

#include <cstdint>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace FASTag {

/**
  @brief Evidence accumulated at one taxonomy node.

  Hits observed directly at the node, and the sum over the node's whole
  subtree (itself + all descendants).
*/
struct NodeEvidence {
  uint32_t taxid = 0;         ///< NCBI taxonomy id of the node
  uint64_t direct_hits = 0;   ///< hits observed at the node itself
  uint64_t subtree_hits = 0;  ///< hits summed over the node and all descendants
};

/**
  @brief Result of the statistical call for one taxon that passed the q-value threshold.
*/
struct TaxonCall {
  uint32_t taxid = 0;       ///< NCBI taxonomy id
  std::string rank;         ///< rank from the taxonomy
  std::string name;         ///< scientific name from the taxonomy
  uint64_t observed = 0;    ///< subtree hits
  double expected = 0.0;    ///< n_total * background probability
  double log_pvalue = 0.0;  ///< natural log of the raw binomial upper-tail p-value
  double qvalue = 1.0;      ///< Benjamini-Hochberg adjusted value in [0,1]
};

/**
  @brief NCBI taxonomy tree with subtree roll-up and a per-taxon enrichment test.

  Thread-safe for concurrent const reads after load() completes.
*/
class Taxonomy {
public:
  /**
    @brief Loads NCBI taxdump files.

    nodes.dmp fields: taxid | parent_taxid | rank | ...
    names.dmp fields: taxid | name_txt | unique_name | name_class |; only rows
    with name_class == "scientific name" are kept. Malformed or duplicate
    lines are skipped without failing.

    @param[in] nodes_dmp Path of nodes.dmp.
    @param[in] names_dmp Path of names.dmp.
    @param[out] err If not null, receives the error message on failure.
    @return False only if a file cannot be opened or yields zero valid nodes.
  */
  bool load(const std::string& nodes_dmp, const std::string& names_dmp,
            std::string* err);

  /**
    @brief Rank of a taxon.
    @param[in] taxid NCBI taxonomy id.
    @return Rank string ("genus", "family", "species", ...), empty if unknown.
  */
  std::string rank(uint32_t taxid) const;

  /**
    @brief Scientific name of a taxon.
    @param[in] taxid NCBI taxonomy id.
    @return The name, empty if unknown.
  */
  std::string name(uint32_t taxid) const;

  /**
    @brief Tests whether a taxon is in the loaded tree.
    @param[in] taxid NCBI taxonomy id.
    @return True if the taxid appears in the loaded tree.
  */
  bool known(uint32_t taxid) const;

  /**
    @brief Tests whether a nodes.dmp file contains a rank.

    NCBI renamed "superkingdom" to "domain", so a rank the dump lacks would
    silently report nothing. Reads only nodes.dmp, stopping at the first
    match, so the CLI can refuse a rank before the run instead of after it.

    @param[in] nodes_dmp Path of nodes.dmp.
    @param[in] rank Rank to look for.
    @return True if some line has this rank; false also when the file cannot be opened.
  */
  static bool rankInDump(const std::string& nodes_dmp, const std::string& rank);

  /**
    @brief Lineage of a taxon.
    @param[in] taxid NCBI taxonomy id.
    @return Path from @p taxid up to (and including) the root; empty if unknown.
  */
  std::vector<uint32_t> lineage(uint32_t taxid) const;

  /**
    @brief Rolls observed hits up the tree.

    For every node that is an ancestor of (or equal to) an observed taxid,
    produces its subtree sum. O(hits * average lineage depth). Hits at
    unknown taxids are ignored.

    @param[in] hits Observed (taxid, count) pairs.
    @return Evidence per node, sorted ascending by taxid.
  */
  std::vector<NodeEvidence> rollUp(
      const std::vector<std::pair<uint32_t, uint64_t>>& hits) const;

  /**
    @brief Natural log of P(X >= k) for X ~ Binomial(n, p).

    Regimes (documented in the .cpp):
      n <= EXACT_MAX_N:          exact summation in log space (log-sum-exp).
      n large, n*p < POISSON_MAX_LAMBDA: Poisson approximation, log space.
      otherwise:                normal approximation with continuity
                                correction, erfc-based with asymptotic tail.

    @param[in] k Observed successes.
    @param[in] n Trials.
    @param[in] p Success probability.
    @return log P(X >= k).
  */
  double binomialUpperTailLogP(uint64_t k, uint64_t n, double p) const;

  /**
    @brief Statistical call over the rolled nodes.

    For every rolled node with subtree_hits >= OBSERVED_FLOOR and a supplied
    background probability p_T, computes expected = n_total*p_T and
    log_pvalue = binomialUpperTailLogP(subtree_hits, n_total, p_T), then
    applies Benjamini-Hochberg across all tested nodes. Rank and name are
    attached from the taxonomy. Nodes without a background_p entry are not
    tested.

    @param[in] rolled Output of rollUp().
    @param[in] background_p Background probability p_T per taxid.
    @param[in] n_total Total number of trials.
    @param[in] q_threshold q-value threshold.
    @return The nodes with qvalue <= @p q_threshold, sorted by qvalue
      ascending, then log_pvalue ascending (q underflows to 0 for the
      strongest taxa; log_pvalue does not), then observed descending, then
      taxid for determinism.
  */
  std::vector<TaxonCall> call(
      const std::vector<NodeEvidence>& rolled,
      const std::vector<std::pair<uint32_t, double>>& background_p,
      uint64_t n_total, double q_threshold) const;

  /// Minimum subtree_hits for a node to enter the multiple-testing pool.
  static constexpr uint64_t OBSERVED_FLOOR = 5;

private:
  struct Node {
    uint32_t parent = 0;
    std::string rank;
    std::string name;
  };
  std::unordered_map<uint32_t, Node> nodes_;

  // Regime thresholds for binomialUpperTailLogP.
  /// log P(X >= k) for X ~ Poisson(lambda), k <= lambda, as 1 - lower tail.
  static double poissonLowerComplementLogP_(uint64_t k, double lambda);
  static constexpr uint64_t EXACT_MAX_N = 20000;
  static constexpr double POISSON_MAX_LAMBDA = 1000.0;
};

}  // namespace FASTag
