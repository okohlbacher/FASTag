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
#pragma once

#include "Centroid.h"
#include "IonSeries.h"
#include "Census.h"
#include "Shortlist.h"

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace FASTag::ClusterAcc
{
  // ---- 1.12 E ----
  struct ThreadE
  {
    /// #9: profile MS2 of an mzML input centroided in the tagging loop
    /// (-pick_profile auto; mzPeak counts its own, in MzPeakStream).
    Centroid::Counts pick;
    /// #15 phase A: activation class of every tagged MS2. Counted at every
    /// run (no option): the b/y warning needs it, and it changes no output.
    IonSeries::ActivationCounts activation;
    void merge(const ThreadE& o)
    {
      pick.merge(o.pick);
      activation.merge(o.activation);
    }
  };
  struct BlockE
  {
    void prepare(std::size_t) {}
  };

  // ---- 1.12 A ----
  // #5: the shortlist evidence (one record per qualifying placement, filled
  // only with -shortlist_out/-fasta_out/-search_config_out) and the spectra
  // whose tag ends the protease check counts.
  struct ThreadA
  {
    std::vector<Shortlist::Evidence> sl;
    std::uint64_t protease_spectra = 0;
    std::size_t last_counted = static_cast<std::size_t>(-1);  ///< last spectrum counted in protease_spectra
    void merge(const ThreadA& o)
    {
      sl.insert(sl.end(), o.sl.begin(), o.sl.end());
      protease_spectra += o.protease_spectra;
    }
  };
  struct BlockA
  {
    void prepare(std::size_t) {}
  };

  // ---- 1.12 D ----
  struct ThreadD
  {
    void merge(const ThreadD&) {}
  };
  struct BlockD
  {
    void prepare(std::size_t) {}
  };

  // ---- 1.12 F ----
  struct ThreadF
  {
    Census::Tally census;  ///< -census counts and samples (#11)
    void merge(const ThreadF& o) { census.merge(o.census); }
  };
  struct BlockF
  {
    bool census = false;                   ///< -census is on; set once before the loop
    std::vector<std::string> census_rows;  ///< one census row per slot (census only)
    void prepare(std::size_t n_used)
    {
      if (census && census_rows.size() < n_used) census_rows.resize(n_used);
    }
  };

  // ---- shared (P4; not edited by the clusters) ----

  /// One per PerThread, summed after the loop.
  struct ClusterThread
  {
    ThreadE e;
    ThreadA a;
    ThreadD d;
    ThreadF f;
    void merge(const ClusterThread& o)
    {
      e.merge(o.e);
      a.merge(o.a);
      d.merge(o.d);
      f.merge(o.f);
    }
  };

  /// One per Block of the output ring.
  struct ClusterBlock
  {
    BlockE e;
    BlockA a;
    BlockD d;
    BlockF f;
    void prepare(std::size_t n_used)
    {
      e.prepare(n_used);
      a.prepare(n_used);
      d.prepare(n_used);
      f.prepare(n_used);
    }
  };
}
