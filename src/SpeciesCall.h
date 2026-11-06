// Calibrated species presence or abstention for -species (1.12 #1, opt-in
// with -species_call decoy).
//
// The 1.10 species q-value tests a genus against a binomial background (the
// share of indexed k-mers in its subtree), which is not the unit of evidence
// (one spectrum counted for the taxa of its best tag) and ignores the main
// source of false genera: tags shared with the true organism by homology. This
// module replaces that background, for the call only, by a null with two parts:
//
//   lambda_g = spill_g + r_g * N_trials
//
//   * random part: every evaluated target tag is also looked up as D
//     deterministic decoy tags (decoyTag() in SpeciesLookup.h) through the same
//     filters; d_g decoy spectra (summed over the D replicates) give the rate
//     r_g = (d_g + 0.5) / (D * N_trials) per trial, where a trial is a spectrum
//     with at least one evaluated target tag. Normalised per TRIAL, never per
//     decoy hit.
//   * homology part: spill_g = sum over the genera h that rank above g (more
//     observed spectra) and are called present of C[g][h] * N_h, with C the
//     column-conditional overlap matrix rolled up to the report rank and N_h
//     the deconvolved count of h.
//
// p_g = P(X >= o_g), X ~ Poisson(lambda_g); q_g by Benjamini-Hochberg (or
// Storey's pi0, opt-in) over the genera with o_g >= Taxonomy::kObservedFloor.
// Decision, in this order: run-level no_call (low_resolution, few_spectra);
// present (q <= alpha, share >= tau, o >= n_min); no_call near_neighbour (q
// <= alpha on the random part alone, but not once the spill is included);
// otherwise not_detected with a detection limit. The report never says
// "absent".
//
// Pure functions, no I/O except loadParams(); deterministic.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace FASTag::SpeciesCall
{
  /// The frozen decision parameters (data/taxonomy/species_call.tsv).
  struct Params
  {
    double alpha = 0.01;        ///< q-value threshold
    double tau = 0.0;           ///< minimum share of the run's units
    uint64_t n_min = 10;        ///< minimum observed spectra of a present genus
    int decoys = 0;             ///< D the file was calibrated with; 0 = not stated
    std::string version;        ///< free text, e.g. "1.12.0-provisional"
    std::string training_sha256;///< sha256 of the training run list, or "none"
  };

  /// Read a key<TAB>value table ('#' comments, blank lines ignored). Keys
  /// alpha, tau and n_min are required; decoys, version and training_sha256
  /// are optional; any other key is an error, so a typo cannot silently keep
  /// a default. Returns false and sets *err on a missing file, a missing or
  /// unknown key, or a value out of range (alpha in (0,1], tau in [0,1],
  /// n_min >= 1, decoys >= 0).
  bool loadParams(const std::string& path, Params& out, std::string* err);

  enum class Call { Present, NoCall, NotDetected };

  /// "present", "no_call", "not_detected".
  const char* callName(Call c);

  /// One genus (or whatever -species_rank is) entering the call.
  struct GenusInput
  {
    uint32_t taxid = 0;
    uint64_t observed = 0;       ///< o_g: target spectra counted for g
    uint64_t decoy_spectra = 0;  ///< d_g: decoy spectra, summed over the D replicates
    double share = 0.0;          ///< share_g of the run's units (deconvolved or o_g / n_units)
    double deconvolved = 0.0;    ///< N_g: what g contributes as spill source once called present
  };

  struct RunInput
  {
    uint64_t n_units = 0;        ///< spectra with any target taxon evidence
    uint64_t n_trials = 0;       ///< spectra with at least one evaluated target tag
    int decoys = 5;              ///< D
    uint64_t min_units = 200;    ///< below this n_units the run is a few_spectra no_call
    bool low_resolution = false; ///< fragment tolerance in Da
    double pi0 = 1.0;            ///< 1 = BH; in (0,1) a fixed pi0; 0 = estimate (Storey)
  };

  struct GenusStat
  {
    uint32_t taxid = 0;
    uint64_t observed = 0;
    uint64_t decoy_spectra = 0;
    double random_expected = 0.0;  ///< r_g * N_trials
    double spill = 0.0;            ///< homology part
    double expected = 0.0;         ///< lambda_g = spill + random_expected
    double pvalue = 1.0;           ///< P(X >= o_g | lambda_g)
    double qvalue = 1.0;           ///< over the tested genera; 1 when not tested
    double qvalue_random = 1.0;    ///< the same with the random part alone
    double share = 0.0;
    double lod = -1.0;             ///< detection limit as a share; < 0 = not applicable
    bool tested = false;           ///< observed >= Taxonomy::kObservedFloor
    Call call = Call::NotDetected;
    std::string reason;            ///< pass, low_resolution, few_spectra, near_neighbour,
                                   ///< not_significant, low_share, few_genus_spectra
  };

  /// P(X >= o) for X ~ Poisson(lambda); 1 for o == 0.
  double poissonUpperTail(uint64_t o, double lambda);

  /// The random part of the null: r_g * N_trials with r_g = (d + 0.5) / (D * N_trials).
  double randomExpected(uint64_t decoy_spectra, int decoys, uint64_t n_trials);

  /// q-values over @p p (all entries tested) with a fixed @p pi0 in (0, 1]:
  /// pi0 = 1 is Benjamini-Hochberg. Through OpenMS MultipleTesting::qValue.
  std::vector<double> qValues(const std::vector<double>& p, double pi0);

  /// Storey's pi0 of @p p (OpenMS MultipleTesting::pi0Est), clamped to
  /// (0, 1]; 1 when there are fewer than 2 values or the estimate fails.
  double estimatePi0(const std::vector<double>& p);

  /// Roll an index-taxon overlap matrix (row-major n x n, TaxIndex::
  /// pairwiseOverlap order) up to groups: entry (a, b) of the result is the sum
  /// of overlap(i, j) over the taxa i of group a and j of group b. @p group_of
  /// maps each index taxon to its group, or -1 for a taxon outside every group.
  std::vector<uint64_t> rollUpOverlap(const std::vector<uint64_t>& overlap, std::size_t n,
                                      const std::vector<int>& group_of, std::size_t n_groups);

  /// The rolled-up column-conditional matrix: conditionalMatrix() of
  /// rollUpOverlap(); C[g][h] = P(k-mer in g | k-mer in h).
  std::vector<double> rollUpConditional(const std::vector<uint64_t>& overlap, std::size_t n,
                                        const std::vector<int>& group_of, std::size_t n_groups);

  /// The call for every genus of @p genera. @p C is the n x n conditional
  /// matrix in the order of @p genera (n = genera.size()); empty means no
  /// homology term. Output in the order of @p genera.
  std::vector<GenusStat> callGenera(const std::vector<GenusInput>& genera,
                                    const std::vector<double>& C,
                                    const RunInput& run, const Params& params);
}
