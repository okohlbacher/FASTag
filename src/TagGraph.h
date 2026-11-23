// FASTag -- partial sequence tags from peptide MS/MS spectra.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
//
// Tag resolution by a compatibility graph: the tags of one spectrum merged
// into resolved tags and ranked (-resolved_out, -tag_graph_out).
//
// A port of the desktop GUI's gui/src/spectrum/{ladder,graph,stepScore}.ts
// (data/DESIGN-tag-graph.md v4, GUI commit 38b5da63) with the same constants,
// the same tie-breaks and the same step model, so the CLI ranks a spectrum's
// resolved tags exactly as the Spectrum tab does:
//
// - every tag row is walked onto the prepared peaks from both flanks (b/c
//   from nterm_mass, y/z from cterm_mass); each complete walk is a placement
//   candidate, judged b or y on its own peaks (seriesCall);
// - rows on the same chain of peaks of one layer (b and y of one fragment
//   charge together, c and z apart) are one placement, a step's different
//   readings (Q or [AG]) kept apart with their own evidence;
// - a resolved tag is a chain of whole placements, each continuing the one
//   before by at least one shared step (or touching it at a peak, with
//   join) and agreeing with it on every shared step; chains are taken best
//   first by a longest-path search under the chain weight, placements lying
//   wholly inside a chain are subsumed, and what is left forms the
//   alternatives.
//
// The chain weight is a Scheme (cstar by default: each new step's C* log-odds
// of being right less a threshold, and rank 1 the first resolved tag that
// holds no peak together with its own complement; scheme X1 adopted by the
// preregistered held-out test of work/tag-score/PREREG-tag-scoring.md,
// amendment 3), or any Weight function.
#pragma once

#include "FASTagger.h"

#include <OpenMS/KERNEL/MSSpectrum.h>

#include <cstddef>
#include <functional>
#include <map>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace FASTag::TagGraph
{
  // ladder.ts constants (the GUI's, verbatim).
  inline constexpr double PROTON = 1.007276466812;
  inline constexpr double WATER = 18.0105646837;
  /// OpenMS Residue::getInternalToCIon (NH3).
  inline constexpr double C_OFFSET = 17.0265491015;
  /// OpenMS Residue::getInternalToZp1Ion (H2O - NH2, the z+1 radical).
  inline constexpr double Z_DOT_OFFSET = WATER - 16.0187240694;
  inline constexpr double CO = 27.9949146;
  /// The series rules are not applied above these tolerances.
  inline constexpr double SERIES_MAX_PPM = 25;
  inline constexpr double SERIES_MAX_DA = 0.02;
  /// The 4 decimals the TSV prints the flanks with.
  inline constexpr double FLANK_SLACK = 1e-4;
  /// evidence(): E-value of the fixed reference, in decades.
  inline constexpr double EVIDENCE_REF = 3;
  /// stepScore.ts: the adopted threshold and the tolerance up to which the
  /// step model with the mass error applies.
  inline constexpr double STEP_THRESHOLD = 3;
  inline constexpr double STEP_MAX_PPM = 25;

  /// The peaks a spectrum was tagged on (the GUI's SpectrumPeaks, the
  /// -dump_spectrum record): m/z strictly ascending.
  struct Peaks
  {
    std::vector<double> mz;
    std::vector<double> intensity;
    std::optional<double> precursor;  ///< precursor m/z
    int charge = 2;                   ///< precursor charge (2 when none was given)
    double tolerance = 20;
    bool ppm = true;
    /// The precursor isotope offset k the precursor m/z was already shifted
    /// by (the selected hypothesis's, -isotope_error); terminus() only.
    int isotope = 0;
  };

  /**
    @brief The peaks of @p prepared (FASTag::preparedPeaks) with the run's tolerance.

    @param[in] prepared the prepared peaks
    @param[in] precursor_mz precursor m/z (<= 0 or not finite: none)
    @param[in] charge precursor charge; <= 0 is taken as 2
    @param[in] p the tagging parameters (frag_tol, tol_ppm)
    @return the peaks
  */
  Peaks peaksFrom(const OpenMS::MSSpectrum& prepared, double precursor_mz, int charge, const Param& p);

  /// Residue masses as the tagger has them: base residues with the fixed
  /// modifications folded in, I as L, and the variable modifications'
  /// residues by (residue, name) as written inline in a tag (M[Oxidation]).
  struct Residues
  {
    std::map<char, double> base;
    std::map<std::pair<char, std::string>, double> variable;
    /// The mass of @p residue with the inline modification @p mod ("" none).
    std::optional<double> mass(char residue, const std::string& mod) const;
  };

  /**
    @brief The tagger's residue masses (OpenMS ResidueDB "Natural19WithoutI") under @p mods.

    @param[in] mods the run's modifications (Param::mods)
    @return the masses
  */
  Residues residuesFrom(const std::vector<ModSpec>& mods);

  enum class Level
  {
    SURE,
    LIKELY,
    OPEN,
  };
  /// Which ion series a ladder lies on, and how sure.
  struct SeriesCall
  {
    char series = 'b';  ///< b, y, c or z
    Level level = Level::OPEN;
  };
  const char* levelName(Level l);

  /// One tag row: its ladder fields as written to -out.
  struct TagIn
  {
    std::string seq;   ///< the tag column, N->C, inline mods (GS[Phospho]TK)
    int charge = 1;    ///< fragment charge
    double nterm_mass = 0, cterm_mass = 0;
    bool gapped = false;
    bool cz = false;   ///< read as c/z-dot ions (ion_series cz)
    std::optional<double> evalue;  ///< null: unscored
    std::size_t index = 0;         ///< the row's index among the spectrum's rows
  };

  struct Reading
  {
    std::string label;  ///< one residue (M[Oxidation]), or a gap's residues sorted: [CW]
    bool gap = false;
    std::optional<double> evalue;  ///< best E-value of the rows that read the step so
    double delta_mz = 0, delta_ppm = 0;  ///< observed minus expected distance
    double mass = 0;    ///< the residue mass the reading spans
  };

  struct Step
  {
    int u = 0, v = 0;   ///< peak indices, u below v in m/z
    std::vector<Reading> readings;  ///< best evidence first
  };

  /// The rows that lie on one chain of peaks of one layer.
  struct Placement
  {
    char series = 'b';  ///< as judged on its peaks
    SeriesCall call;
    char flank = 'b';   ///< the flank its best row was walked from
    std::pair<double, double> flank_e{0, 0};  ///< (E or infinity, row index) of that row
    int charge = 1;
    std::vector<int> peaks;
    std::vector<Step> steps;
    std::vector<std::size_t> rows;
    std::vector<std::string> tags;
    std::optional<double> evalue;
    bool gap_unresolved = false;
  };

  struct Relation
  {
    std::size_t path = 0;  ///< 0-based index into Graph::paths
    bool fork = false;     ///< fork, else touch
    int shared = 0;        ///< steps the two have in common
  };

  /// One placement continuing another (placement indices, from < to).
  struct Arc
  {
    std::size_t from = 0, to = 0;
    bool touch = false;  ///< they share one peak only (joined under join)
    bool used = false;   ///< it links two consecutive placements of a chain
  };

  /// A resolved tag.
  struct Path
  {
    char series = 'b';
    SeriesCall call;
    int charge = 1;
    std::vector<int> peaks;
    std::vector<Step> steps;
    std::vector<std::size_t> chain;   ///< placements that build it, in m/z order
    std::vector<std::size_t> inside;  ///< placements subsumed
    std::optional<double> best, weakest;
    std::vector<int> joined;          ///< peaks at which touching tags were joined
    std::vector<Relation> relations;
    std::vector<std::pair<std::size_t, int>> same_as;  ///< (path, steps) of another layer/series
    double score = 0;                 ///< the chain weight of its (final) chain
  };

  struct Graph
  {
    std::vector<Placement> placements;  ///< canonical order: layer, first peak, peaks
    std::vector<Path> paths;            ///< rank order
    std::vector<std::size_t> off_peaks; ///< rows whose ladder is not on the peaks
    std::vector<Arc> arcs;
  };

  /// The chain weight (-resolve_score).
  enum class Scheme
  {
    /// X1 = CstarNS_t3 (PREREG-tag-scoring.md amendment 3): sum over the new
    /// steps of (C* logit - threshold), rank 1 by noself.
    CSTAR,
    STEPLOGODDS,  ///< sum over the new steps of (logit - threshold); S2_t<t>
    EVIDENCE,     ///< the placement's summed E-value evidence; S0
    ANCHOR,       ///< the best single placement by E +1e6, then steplogodds; S4_anchor_t<t>
  };
  /// The scheme of a -resolve_score value; throws std::invalid_argument.
  Scheme schemeFromString(const std::string& s);
  /// The -resolve_score value of @p s.
  std::string schemeName(Scheme s);

  /// What placement @p p adds to a chain, started fresh (@p prev < 0) or continuing placement @p prev.
  using Weight = std::function<double(const Graph& g, std::size_t p, long prev)>;

  struct Options
  {
    bool join = false;
    int min_overlap = 1;
    Scheme scheme = Scheme::CSTAR;
    double threshold = STEP_THRESHOLD;
    /// When set, replaces the scheme (a scoring study's own weight).
    Weight weight;
  };

  /// stepScore.ts features of one step, from its first reading (fitstep.py).
  struct StepFeatures
  {
    double lE = 0, abs_dppm = 0, dppm2 = 0, rank_max = 0, rank_min = 0;
    double comp_any = 0, comp_both = 0, gap = 0, amb = 0, log_np = 0;
  };

  /// The step model of stepScore.ts: a logistic regression on the steps of
  /// tags with E <= 1 of PXD003531 and PXD000001 against Sage; the variant
  /// without the mass error above STEP_MAX_PPM or in Da.
  class StepModel
  {
  public:
    explicit StepModel(const Peaks& s);
    StepFeatures features(const Step& st, int z) const;
    double logit(const Step& st, int z) const;
    double logit(const StepFeatures& f) const;
    bool fullModel() const { return full_; }

  private:
    const Peaks* s_;
    bool full_;
    std::vector<double> rank_;
    std::optional<double> M_;
    bool comp(int p, int z) const;
  };

  /**
    @brief The signed mass error of a step as the cstar features read it.

    The first reading's delta_ppm at a ppm tolerance <= STEP_MAX_PPM (as the
    model was fitted); otherwise the error in tolerance units scaled to 20,
    ad_n = 20 * delta_mz / tol(x), x = mz[v] - delta_mz the expected m/z.
  */
  double stepMassError(const Peaks& s, const Step& st);

  /// The C* features of one placement step (work/tag-score/study2/C/featC.ts,
  /// the features of the final model), in the model's order.
  struct CstarFeatures
  {
    double lE = 0, abs_dppm = 0, dppm2 = 0, rank_max = 0, rank_min = 0;
    double comp_any = 0, comp_both = 0, gap = 0, amb = 0, log_np = 0;
    double compz_any = 0, compz_both = 0, lrank_max = 0, lrank_min = 0, amb_margin = 0;
    double rival_n = 0, rival_margin = 0, sup_n = 0, sup_rows = 0;
    double rel_dppm = 0, rel_dppm2 = 0, lE_gap = 0, in_best = 0;
    char residue = 0;  ///< first letter of the first reading (I as L); 0 for a gap
  };

  /// The C* features of every step of every placement of @p g, per placement.
  std::vector<std::vector<CstarFeatures>> cstarFeatures(const Graph& g, const Peaks& s);
  /// The C* log-odds of a step being right.
  double cstarLogit(const CstarFeatures& f);
  /**
    @brief The C* logit of every placement step of @p g, per placement.

    Keyed as the reference harness keys them (layer, peaks, step), a later
    placement with the same key giving the logits of an earlier one.
  */
  std::vector<std::vector<double>> cstarLogits(const Graph& g, const Peaks& s);

  /// noself: the first resolved tag of @p g none of whose peaks has its own
  /// complement among its other peaks (0 when every one has; -1 without paths).
  long noselfPick(const Graph& g, const Peaks& s);
  /// Move resolved tag @p r to rank 1, the others after it in their order;
  /// relations and same_as follow the new ranks.
  void promote(Graph& g, std::size_t r);

  /// A placement's evidence against the fixed reference: 0 when unscored.
  double evidence(std::optional<double> e);

  /// The tag graph of @p tags on @p s, resolved (graph.ts buildGraph, then settleSeries).
  Graph buildGraph(const std::vector<TagIn>& tags, const Peaks& s, const Residues& res, const Options& opt = {});

  /// The chain weight @p opt gives placement @p p after @p prev (< 0: none).
  Weight weightOf(const Graph& g, const Peaks& s, const Options& opt);

  /// A step as text: its reading, or {Q|[AG]} when its readings are not told apart.
  std::string stepLabel(const Step& st);
  /// Residues from N to C terminus of steps read as @p series.
  std::string sequenceOf(char series, const std::vector<Step>& steps);
  /// by<z> or cz<z>.
  std::string layerOf(char series, int charge);

  /// 13C - 12C (PrecursorHypotheses' isotope spacing).
  inline constexpr double C13 = 1.0033548378;

  /// What terminus() tests a resolved tag's flanks against (-resolved_out `terminus`).
  struct Termini
  {
    /// Masses a terminal flank is "at": 0 plus the run's terminal
    /// modifications (fixed and variable, N-term and protein N-term on the N
    /// side, C-term and protein C-term on the C side), as the flanks carry them.
    std::vector<double> nterm{0.0}, cterm{0.0};
    /// The run's precursor isotope offsets k (-isotope_error); a precursor-side
    /// flank is also accepted (k - Peaks::isotope) * C13 off its target.
    std::vector<int> isotope{0};
    /// The single residues a flank can be one away by: label and mass (the
    /// tagger's residues, fixed modifications in, I and L apart, the variable
    /// ones as M[Oxidation]).
    std::vector<std::pair<std::string, double>> residues;
  };

  /**
    @brief The termini the run knows: @p res's residues, and the terminal modification masses given.

    @param[in] res the tagger's residues (residuesFrom)
    @param[in] nterm_mods N-terminal modification masses (0 is always a target)
    @param[in] cterm_mods C-terminal modification masses
    @param[in] isotope the run's -isotope_error offsets
  */
  Termini terminiFrom(const Residues& res, const std::vector<double>& nterm_mods = {},
                      const std::vector<double>& cterm_mods = {}, const std::vector<int>& isotope = {0});

  /**
    @brief Whether a resolved tag's flanks put it at a peptide terminus (-resolved_out `terminus`).

    Each flank side is tested on its own. The side read from the peaks (nterm
    for b/c, cterm for y/z) has the fragment tolerance at the low peak times
    the fragment charge; the side from the precursor (the other) that plus the
    fragment tolerance at the precursor m/z times the precursor charge, and
    any isotope offset of Termini::isotope; without a precursor it is not
    tested. A side within its tolerance of a target is "N" / "C"; else one
    within it of a target plus one residue "N+K", several "N+[KQ]" (sorted as
    gap labels).

    @param[in] series b, y, c or z
    @param[in] charge the fragment charge
    @param[in] low_mz the low peak (the first ion of the series ladder)
    @param[in] nterm the nterm_mass before its clamp at 0 (a negative flank matches no target)
    @param[in] cterm the cterm_mass before its clamp at 0
    @param[in] s the peaks (tolerance, precursor, isotope)
    @param[in] t the targets
    @return the tokens, N side first, comma-separated ("N", "C+K", "N,C+[IL]"); empty if neither
  */
  std::string terminus(char series, int charge, double low_mz, double nterm, double cterm, const Peaks& s,
                       const Termini& t);

  // ---- -resolved_out / -tag_graph_out rows ----
  std::string resolvedHeader();
  std::string graphHeader();
  /**
    @brief Append one row per resolved tag of @p g, in rank order.

    @param[in,out] buf the rows
    @param[in] g the graph
    @param[in] s its peaks
    @param[in] native_id the spectrum
    @param[in] full_precision masses and E-values in shortest round-trip form
    @param[in] ranking the options @p g was ranked with: its scheme and threshold
               are written on every row (scheme, threshold), so a reader of the
               table knows the ranking without the run's parameters
    @param[in] termini what the last column, terminus, tests the flanks against
  */
  void appendResolvedRows(std::string& buf, const Graph& g, const Peaks& s, const std::string& native_id,
                          bool full_precision = false, const Options& ranking = {}, const Termini& termini = {});
  /// Append one row per placement (graph node) of @p g, in canonical order.
  void appendGraphRows(std::string& buf, const Graph& g, const Peaks& s, const std::string& native_id,
                       bool full_precision = false);
}
