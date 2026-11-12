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
//     column-conditional matrix of the distinct-k-mer overlap of the
//     report-rank groups (TaxIndex::groupOverlap) and N_h the deconvolved
//     count of h.
//
// p_g = P(X >= o_g), X ~ Poisson(lambda_g); q_g by Benjamini-Hochberg (or
// Storey's pi0, opt-in) over the genera with o_g >= Taxonomy::kObservedFloor.
// Decision, in this order: run-level no_call (low_resolution, few_spectra);
// present (q <= alpha, share >= tau, o >= n_min); no_call unstable (see
// below); no_call near_neighbour (spill > 0, and q <= alpha on the random part
// alone but not once the spill is included); otherwise not_detected with a
// detection limit. The report never says "absent".
//
// The present set S must be self-consistent: S = F(S), F(S) being the genera
// that qualify with spill from S. BH couples the genera (a genus's spill can
// raise another's q), so F can cycle instead of converging. callGenera()
// iterates F from the empty set until a set repeats. On a fixed point S is
// it. On a cycle, S is the intersection of the sets of the cycle, shrunk to
// S AND F(S) until every member qualifies on spill from S alone; the genera
// that qualify on spill from S but are not in S are no_call "unstable". The
// statistics reported are always those computed with spill from the final S,
// and spill only ever comes from genera called present. The result does not
// depend on the iteration bound, nor on untested genera.
//
// Pure functions, no I/O except loadParams(); deterministic.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
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
    uint64_t reagent_n_min = 8; ///< -species_reagents: minimum tags in the listed reagent proteins (optional key)
    int decoys = 0;             ///< D the file was calibrated with; 0 = not stated
    std::string version;        ///< free text, e.g. "1.12.0-provisional"
    std::string training_sha256;///< sha256 of the training run list, or "none"
  };

  /// Read a key<TAB>value table ('#' comments, blank lines ignored). Keys
  /// alpha, tau and n_min are required; decoys, version and training_sha256
  /// and reagent_n_min are optional; any other key is an error, so a typo cannot silently keep
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
    uint64_t observed = 0;         ///< explain: distinct tags in spectra not explained at the decision
    uint64_t tags = 0;             ///< explain only: distinct tags of the genus in the run
    uint64_t decoy_spectra = 0;    ///< explain: decoy tags (same count), summed over the replicates
    double random_expected = 0.0;  ///< r_g * N_trials
    double spill = 0.0;            ///< homology part
    double expected = 0.0;         ///< lambda_g = spill + random_expected
    double pvalue = 1.0;           ///< P(X >= o_g | lambda_g)
    double qvalue = 1.0;           ///< over the tested genera; 1 when not tested
    double qvalue_random = 1.0;    ///< the same with the random part alone
    double share = 0.0;
    double lod = -1.0;             ///< detection limit as a share; < 0 = not applicable
    bool tested = false;           ///< observed >= Taxonomy::kObservedFloor
    bool reagent = false;          ///< -species_reagents: the group has listed reagent proteins
    uint64_t reagent_tags = 0;     ///< distinct unexplained tags in its listed reagent proteins
    double reagent_expected = 0.0; ///< the same count on the decoy tags, per replicate
    Call call = Call::NotDetected;
    std::string reason;            ///< pass, low_resolution, few_spectra, unstable,
                                   ///< near_neighbour, not_significant, low_share,
                                   ///< few_genus_spectra; explain: explained, reagent
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

  /// The call for every genus of @p genera. @p C is the n x n conditional
  /// matrix in the order of @p genera (n = genera.size()); empty means no
  /// homology term. Output in the order of @p genera.
  std::vector<GenusStat> callGenera(const std::vector<GenusInput>& genera,
                                    const std::vector<double>& C,
                                    const RunInput& run, const Params& params);

  // ---- -species_call explain (1.13) ----------------------------------------
  //
  // The decoy call above counts spectra and lets a called genus explain a
  // weaker one through an expected spill. The explain call lets it explain
  // SPECTRA instead: genera are called one at a time, strongest first, and a
  // spectrum that has a contributing tag of a called genus no longer counts
  // for any other genus. The unit is the DISTINCT TAG (a peptide seen in 500
  // spectra is one piece of evidence, as its decoy is one lookup).
  //
  // Per step, for every genus g not yet called: o_g = distinct tags of g in
  // unexplained spectra; K_gj = the same count on decoy replicate j (decoys of
  // the tags of unexplained spectra). Null: negative binomial with mean
  // lambda_g = (sum_j K_gj + 0.5) / R and variance f * lambda_g,
  // f = phi * (1 + 1/R): 1/R for the estimated mean (predictive), phi =
  // max(1, sum_g var_j(K_gj) / sum_g mean_j(K_gj)) for the spread between
  // replicates beyond Poisson, pooled over the genera not yet called. The
  // genus with the smallest p (ties: more tags, then smaller taxid) is called
  // present when p * m <= alpha, m = genera not yet called with o >= n_min
  // (step-down Bonferroni); then its spectra become explained. The first
  // failure ends the loop. alpha and n_min come from Params; tau and pi0 are
  // not used. Run-level no_call as in callGenera().

  /// One contributing tag of a spectrum for one report-rank group.
  struct TagHit
  {
    uint32_t spectrum = 0;
    uint32_t tag = 0;    ///< id of the (target) tag sequence; a decoy carries its target's id
    uint32_t group = 0;  ///< index into group_taxid
  };

  /// P(X >= o) for X negative binomial with mean @p mean and variance
  /// @p variance_factor * mean; Poisson when variance_factor <= 1. 1 for o == 0.
  double negBinomialUpperTail(uint64_t o, double mean, double variance_factor);

  /// The explain call for every group, in the order of @p group_taxid.
  /// GenusStat: observed = o_g at the genus's decision (its step when called,
  /// the stop otherwise), tags = o_g before anything was explained,
  /// decoy_spectra = sum_j K_gj, expected = lambda_g, qvalue = min(1, p * m),
  /// reason pass | not_significant | explained (tags >= n_min > observed);
  /// share is left 0 for the caller, lod is not applicable.
  std::vector<GenusStat> callExplain(const std::vector<uint32_t>& group_taxid,
                                     const std::vector<TagHit>& target,
                                     const std::vector<std::vector<TagHit>>& decoys,
                                     const RunInput& run, const Params& params);

  // ---- reagent organisms (-species_reagents, experimental, after 1.13.1) ----
  //
  // The explain call tests a genus on all its tags against the random matches
  // of its whole proteome. A protein reagent (porcine trypsin, BSA, casein,
  // serum) gives some tens of tags from a few proteins: far below that null,
  // although each of them is specific. callReagents() tests the tags lying
  // in the LISTED reagent proteins of a group against the decoy tags lying in
  // the same proteins. Only tags no called group explains count (a tag whose
  // index support holds a called group is homology, not reagent). Greedy as
  // callExplain(): the group with the smallest Poisson p is called present
  // with reason "reagent" when p * m <= alpha (m = candidate groups with
  // >= reagent_n_min tags), and then explains tags like any called group. A reagent
  // call says the protein reagent is in the sample, not the organism.

  /// One evaluated tag lying in a listed reagent protein of @p group
  /// (replicate < 0), or one whose decoy replicate @p replicate does.
  struct ReagentHit
  {
    uint32_t tag = 0;              ///< id of the target tag
    uint32_t group = 0;            ///< group of the reagent protein
    int replicate = -1;            ///< < 0: the target tag; j >= 0: its decoy j
    std::vector<uint32_t> groups;  ///< groups of the target tag's index support (may be empty)
  };

  /// Fills reagent, reagent_tags and reagent_expected of the groups in
  /// @p hits and turns not_detected groups that pass into present / "reagent".
  /// A target hit counts only if its index support holds the group. @p st is
  /// the result of callExplain(); no_call rows are never changed.
  void callReagents(std::vector<GenusStat>& st, const std::vector<ReagentHit>& hits, int decoys, const Params& params);
}
