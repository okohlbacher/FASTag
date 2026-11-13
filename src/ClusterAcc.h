// Per-cluster accumulators of the tagging loop (FASTag 1.12, P4).
//
// The tagging loop in FASTag.cpp keeps two kinds of state:
//   - PerThread: counters and samples summed over threads after the loop;
//   - Block: per-spectrum results of one block of the output ring, written
//     in input order by write_block.
// Each 1.12 cluster gets ONE sub-struct of each kind here and edits only its
// own (PLAN-INTEGRATION section 2.1): E data types (#2/#6/#7/#9/#15 counters),
// A hand-off (#5 shortlist records), D organism/chemistry (#3g alkylation
// accumulator), F QC (#11 census rows). Block order is fixed: E, A, D, F.
//
// Contract, so that adding a field never touches the loop's shared code:
//   - Thread*::merge(other) adds @p other into *this; it is called once per
//     thread, in thread order, after the loop (ClusterThread::merge).
//   - Block*::prepare(n_used) sizes the per-spectrum slots of a block before
//     it is tagged; capacity may be recycled across blocks (see prep_block).
//   - Nothing here may change existing outputs at defaults: a cluster's state
//     is touched only when its own option is on.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#pragma once

#include "AlkylationCall.h"
#include "AlkylationTags.h"
#include "Centroid.h"
#include "IonSeries.h"
#include "PrecursorHypotheses.h"
#include "Census.h"
#include "Shortlist.h"

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace FASTag::ClusterAcc
{
  // ---- 1.12 E ----
  /**
    @brief Per-thread counters of cluster E (data types: activation, charge hypotheses, ion series).
  */
  struct ThreadE
  {
    /// #15 phase A: activation class of every tagged MS2. Counted at every
    /// run (no option): the b/y warning needs it, and it changes no output.
    IonSeries::ActivationCounts activation;
    /// #6: hypotheses tagged and selected, by charge source (non-default
    /// -unknown_charge or -isotope_error only).
    Hyp::SourceCounts hyp;
    /// #15 phase B: MS2 tagged per ion series (-ion_series).
    IonSeries::SeriesCounts series;
    /**
      @brief Adds the counters of another thread into this one.
      @param[in] o Accumulator of another thread.
    */
    void merge(const ThreadE& o)
    {
      activation.merge(o.activation);
      hyp.merge(o.hyp);
      series.merge(o.series);
    }
  };
  /**
    @brief Per-block state of cluster E (currently empty).
  */
  struct BlockE
  {
    /// @brief Sizes the per-spectrum slots of a block; no-op for cluster E.
    void prepare(std::size_t) {}
  };

  // ---- 1.12 A ----
  /**
    @brief Per-thread state of cluster A (hand-off, #5).

    The shortlist evidence (one record per qualifying placement, filled
    only with -shortlist_out/-fasta_out/-search_config_out) and the spectra
    whose tag ends the protease check counts.
  */
  struct ThreadA
  {
    std::vector<Shortlist::Evidence> sl;  ///< shortlist evidence records, one per qualifying placement
    std::uint64_t protease_spectra = 0;   ///< spectra whose tag ends the protease check counts
    std::size_t last_counted = static_cast<std::size_t>(-1);  ///< last spectrum counted in protease_spectra
    /**
      @brief Appends the evidence of another thread and adds its protease count.

      last_counted is not merged.

      @param[in] o Accumulator of another thread.
    */
    void merge(const ThreadA& o)
    {
      sl.insert(sl.end(), o.sl.begin(), o.sl.end());
      protease_spectra += o.protease_spectra;
    }
  };
  /**
    @brief Per-block state of cluster A (currently empty).
  */
  struct BlockA
  {
    /// @brief Sizes the per-spectrum slots of a block; no-op for cluster A.
    void prepare(std::size_t) {}
  };

  // ---- 1.12 D ----
  /**
    @brief Per-thread state of cluster D (organism/chemistry, #3g).

    The alkylation votes and placement outcomes (-alkylation_out only).
  */
  struct ThreadD
  {
    Alkylation::Tally alk;       ///< #3g: alkylation votes and placement outcomes (-alkylation_out)
    AlkylationTags::Tally alkt;  ///< 1.13 #22: -alkylation_tags_out (shadow tags)
    /**
      @brief Adds the tallies of another thread into this one.
      @param[in] o Accumulator of another thread.
    */
    void merge(const ThreadD& o)
    {
      alk.merge(o.alk);
      alkt.merge(o.alkt);
    }
  };
  /**
    @brief Per-block state of cluster D (currently empty).
  */
  struct BlockD
  {
    /// @brief Sizes the per-spectrum slots of a block; no-op for cluster D.
    void prepare(std::size_t) {}
  };

  // ---- 1.12 F ----
  /**
    @brief Per-thread state of cluster F (QC census, #11).
  */
  struct ThreadF
  {
    Census::Tally census;  ///< -census counts and samples (#11)
    /**
      @brief Adds the census tally of another thread into this one.
      @param[in] o Accumulator of another thread.
    */
    void merge(const ThreadF& o) { census.merge(o.census); }
  };
  /**
    @brief Per-block state of cluster F: one census row per spectrum slot.
  */
  struct BlockF
  {
    bool census = false;                   ///< -census is on; set once before the loop
    std::vector<std::string> census_rows;  ///< one census row per slot (census only)
    /**
      @brief Grows census_rows to at least @p n_used slots when -census is on.
      @param[in] n_used Number of spectrum slots used in the block.
    */
    void prepare(std::size_t n_used)
    {
      if (census && census_rows.size() < n_used) census_rows.resize(n_used);
    }
  };

  // ---- shared (P4; not edited by the clusters) ----

  /**
    @brief Per-thread state of all clusters; one per PerThread, summed after the loop.
  */
  struct ClusterThread
  {
    ThreadE e;  ///< cluster E (data types)
    ThreadA a;  ///< cluster A (hand-off)
    ThreadD d;  ///< cluster D (organism/chemistry)
    ThreadF f;  ///< cluster F (QC)
    /**
      @brief Merges every cluster's state of another thread into this one, in order E, A, D, F.
      @param[in] o Accumulator of another thread.
    */
    void merge(const ClusterThread& o)
    {
      e.merge(o.e);
      a.merge(o.a);
      d.merge(o.d);
      f.merge(o.f);
    }
  };

  /**
    @brief Per-block state of all clusters; one per Block of the output ring.
  */
  struct ClusterBlock
  {
    BlockE e;  ///< cluster E (data types)
    BlockA a;  ///< cluster A (hand-off)
    BlockD d;  ///< cluster D (organism/chemistry)
    BlockF f;  ///< cluster F (QC)
    /**
      @brief Prepares every cluster's block state for @p n_used spectra, in order E, A, D, F.
      @param[in] n_used Number of spectrum slots used in the block.
    */
    void prepare(std::size_t n_used)
    {
      e.prepare(n_used);
      a.prepare(n_used);
      d.prepare(n_used);
      f.prepare(n_used);
    }
  };
}
