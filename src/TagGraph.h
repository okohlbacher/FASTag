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
// (data/DESIGN-tag-graph.md v3, GUI commit 38b5da63) with the same constants,
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
// The chain weight is a Scheme (steplogodds by default: each new step's
// log-odds of being right less a threshold, the preregistered scheme of
// work/tag-score/PREREG-tag-scoring.md), or any Weight function.
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
    STEPLOGODDS,  ///< sum over the new steps of (logit - threshold); S2_t<t>
    EVIDENCE,     ///< the placement's summed E-value evidence; S0
    ANCHOR,       ///< the best single placement by E +1e6, then steplogodds; S4_anchor_t<t>
  };
  /// The scheme of a -resolve_score value; throws std::invalid_argument.
  Scheme schemeFromString(const std::string& s);

  /// What placement @p p adds to a chain, started fresh (@p prev < 0) or continuing placement @p prev.
  using Weight = std::function<double(const Graph& g, std::size_t p, long prev)>;

  struct Options
  {
    bool join = false;
    int min_overlap = 1;
    Scheme scheme = Scheme::STEPLOGODDS;
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
  */
  void appendResolvedRows(std::string& buf, const Graph& g, const Peaks& s, const std::string& native_id,
                          bool full_precision = false);
  /// Append one row per placement (graph node) of @p g, in canonical order.
  void appendGraphRows(std::string& buf, const Graph& g, const Peaks& s, const std::string& native_id,
                       bool full_precision = false);
}
