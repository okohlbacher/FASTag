// Digest, label and mass-gap reports (-digest_out, -label_out, -massgap_out).
//
// Measurements only: residue counts at the tag termini, the protease call the
// counts support with its margin, label and heavy-residue counts, and the
// mass-gap histogram explained as modification combinations. What a caller
// makes of them (confidence, evidence thresholds) is its own business; see
// doc/DESIGN-digest.md.
//
// Ported operation for operation from the Python reference implementation
// prose-auto 0.1.3, so both give the same numbers from the tag TSV: the same
// window tests, the same summation order and Python's float sum()
// (Neumaier-compensated since Python 3.12). doc/DESIGN-digest.md maps each
// quantity to its name there; test/digest_test.cpp pins the outputs.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#pragma once

#include <array>
#include <cstdint>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

namespace FASTag::Digest
{
  /// The tag alphabet, I merged into L, in the order every sum runs.
  inline constexpr std::string_view AAS = "GASPVTCLNDQKEMHFRYW";
  /// Number of residues in AAS.
  inline constexpr int NUM_AA = 19;
  /**
    @brief Index of a residue letter in AAS.

    @param[in] c Residue letter (I counts as L).
    @return Index of @p c in AAS, or -1.
  */
  int aaIndex(char c);

  /// Monoisotopic mass of water (Da).
  inline constexpr double H2O_MASS = 18.010565;

  /**
    @brief Python's sum() over floats (CPython >= 3.12).

    The first value as is, then Neumaier-compensated addition, the
    compensation added at the end.
  */
  class PySum
  {
  public:
    /**
      @brief Adds a value to the sum.

      @param[in] x Value to add.
    */
    void add(double x);
    /**
      @brief The compensated sum of the values added so far.

      @return The sum; 0 when nothing was added.
    */
    double value() const;

  private:
    double f_ = 0.0, c_ = 0.0;
    bool any_ = false;
  };

  /// Residue keys: the 19 residues, then lysine with TMT, TMTpro, iTRAQ4 or
  /// +8 Da (heavy), and arginine +10 Da (heavy).
  inline constexpr int NUM_KEYS = 24;
  /**
    @brief One residue key: a residue, possibly labelled, with its mass.
  */
  struct ResidueKey
  {
    const char* name;  ///< key name
    double mass;       ///< residue mass (Da; C carbamidomethylated)
    int merged;  ///< residue index the key counts as (labelled K as K), -1 for R+10
  };
  /**
    @brief The residue keys (see NUM_KEYS).

    @return The NUM_KEYS residue keys, the 19 residues in AAS order first.
  */
  const std::array<ResidueKey, NUM_KEYS>& residueKeys();

  /// The N-terminal labels counted.
  inline constexpr int NUM_LABELS = 3;
  /**
    @brief One N-terminal label with its mass.
  */
  struct LabelKey
  {
    const char* name;  ///< label name
    double mass;       ///< label mass (Da)
  };
  /**
    @brief The N-terminal labels counted.

    @return The NUM_LABELS labels: TMT, TMTpro, iTRAQ4.
  */
  const std::array<LabelKey, NUM_LABELS>& labelKeys();

  struct Flank2Bins;  // 1.12 D #3d, below

  /**
    @brief Terminus counts over the filtered tags.

    Counts over the filtered tags (gapped == 0, evalue <= 1), added one tag
    at a time. "Near m" below means within [m - w, m + w], w the window.
  */
  class TerminusCounter
  {
  public:
    /**
      @brief Creates an empty counter.

      @param[in] window Half-width w of the mass window (Da).
    */
    explicit TerminusCounter(double window = 0.008) : w_(window) {}

    // ---- 1.12 D: flank2 (#3d), off unless enabled ----
    /**
      @brief Enables the dipeptide histogram dip.

      Also count the dipeptide histogram dip: per Flank2Bins bin at this
      window, the tags whose C-terminal flank (or N-terminal flank less
      H2O, a reversed b tag) is a two-residue sum of that bin.
    */
    void enableFlank2();
    /// @brief Whether enableFlank2() was called (or merged in).
    /// @return True when the dipeptide histogram is counted.
    bool flank2() const { return bins_ != nullptr; }
    /// @brief The flank2 bins in use.
    /// @return The bins, or null when flank2 is off.
    const Flank2Bins* flank2Table() const { return bins_.get(); }
    std::vector<std::uint64_t> dip;  ///< empty unless enableFlank2()
    // ---- end 1.12 D ----

    /**
      @brief Counts one filtered b/y tag.

      One filtered tag: its flanking masses and its sequence without
      modification annotations. A b/y tag (FASTag 1.11).

      @param[in] nterm N-terminal flank mass (Da).
      @param[in] cterm C-terminal flank mass (Da).
      @param[in] seq Tag sequence without modification annotations.
    */
    void add(double nterm, double cterm, std::string_view seq);
    /**
      @brief Counts one filtered tag of another ion series.

      The same for a tag of another ion series (1.12 #15 phase B): a
      reversed read's N-terminal flank is the C-side residues +
      @p reversed_offset (IonSeries::IonPair::reversedOffset(); +H2O is the
      b/y overload above, c/z-dot -15.0347). The n_h2o counts are the
      reversed reads' C-terminal residues in every series.

      @param[in] nterm N-terminal flank mass (Da).
      @param[in] cterm C-terminal flank mass (Da).
      @param[in] seq Tag sequence without modification annotations.
      @param[in] reversed_offset Offset of a reversed read's N-terminal flank (Da).
    */
    void add(double nterm, double cterm, std::string_view seq, double reversed_offset);
    /**
      @brief Adds the counts of another counter to this one.

      The dip histogram (and its bins) is taken over when @p o has one.

      @param[in] o Counter whose counts are added.
    */
    void merge(const TerminusCounter& o);

    std::uint64_t tags = 0;                         ///< number of tags counted
    std::array<std::uint64_t, NUM_KEYS> c_near{};   ///< tags whose C-terminal flank mass is near key k's mass
    std::array<std::uint64_t, NUM_KEYS> n_h2o{};    ///< tags whose N-terminal flank mass is near key k's mass + H2O
    std::array<std::uint64_t, NUM_KEYS> n_near{};   ///< tags whose N-terminal flank mass is near key k's mass
    /// Per labelKeys() entry: tags whose N- or C-terminal flank mass is near
    /// the label mass.
    std::array<std::uint64_t, NUM_LABELS> lab_n{}, lab_c{};
    /// The same counts at label mass + 0.5 Da, where no label sits: an
    /// off-mass control, written as <L>.background by the label report.
    std::array<std::uint64_t, NUM_LABELS> lab_bg_n{}, lab_bg_c{};
    /// Counts per position and residue (AAS order). Positions use the
    /// protease notation of Schechter and Berger: the cleavage falls between
    /// P1 and P1'; P1 is the last residue before it, P2 the one before P1, and
    /// P1' the first residue after it. cpos[0..3] = P1..P4 on the C end,
    /// npos[0..3] = P1'..P4' on the N end.
    std::array<std::array<std::uint64_t, NUM_AA>, 4> cpos{}, npos{};
    // ---- 1.13 digqual (backlog 23): read by digestQuality() only ----
    /// The residues at P2..P4 of the tags counted at P1, by their P1 residue:
    /// cq[P1][residue] (AAS order, labelled K merged into K as in cpos);
    /// nq the same for P2'..P4' by the P1' residue.
    std::array<std::array<std::uint64_t, NUM_AA>, NUM_AA> cq{}, nq{};
    // ---- end 1.13 digqual ----

    /**
      @brief Tag ends that match key k.

      C-terminal flank near the key mass, or N-terminal flank near the key
      mass + H2O.

      @param[in] k Index into residueKeys().
      @return c_near[k] + n_h2o[k].
    */
    std::uint64_t res(int k) const { return c_near[k] + n_h2o[k]; }
    /// @brief res() summed over every key.
    /// @return The total number of matched tag ends.
    std::uint64_t tot() const;
    /// @brief C-terminal counts at P1, labelled lysines merged into K, in AAS order.
    /// @return cpos[0].
    std::array<std::uint64_t, NUM_AA> cterm() const { return cpos[0]; }
    /// @brief N-terminal counts at P1', labelled lysines merged into K, in AAS order.
    /// @return npos[0].
    std::array<std::uint64_t, NUM_AA> nterm() const { return npos[0]; }

  private:
    void add_(double nterm, double cterm, std::string_view seq, const double* reversed_offset);
    bool near_(double v, double m) const { return v >= m - w_ && v <= m + w_; }
    double w_;
    std::shared_ptr<const Flank2Bins> bins_;  ///< 1.12 D #3d; shared by copies
  };

  // ---- model table ------------------------------------------------------

  /// A distribution over the 19 residues, in AAS order.
  using Dist = std::array<double, NUM_AA>;

  /**
    @brief One protease model: residue distributions at the C (P1) and N (P1') ends.
  */
  struct Model
  {
    std::string name, cls;  ///< cls: the table's 'class' column ('class' is a C++ keyword)
    Dist c{}, n{};          ///< residue frequencies at the C (P1) and N (P1') end
    bool c_bg = true, n_bg = true;  ///< that end is the background
  };

  // ---- 1.12 D: model table v2 (#3c, #3e) ----
  /// The header line ('#' and this text) that makes a table a v2 table. Only
  /// a v2 table reads the reserved model names detection, reference and
  /// specificity; in a table without it they are ordinary models, as in 1.11.
  inline constexpr std::string_view MODELS_V2_MARKER = "fastag_digest_models v2";
  /// Instrument classes of the detection weights (instrumentClass()).
  inline constexpr std::array<std::string_view, 3> INSTRUMENT_CLASSES = {"orbitrap_hcd", "timstof", "other"};

  /**
    @brief Detection weights of one instrument class.

    Observed P1 (C) or P1' (N) is proportional to e(a) * p(a). A residue
    without a row weighs 1.
  */
  struct Detection
  {
    std::string cls;  ///< instrument class (INSTRUMENT_CLASSES)
    Dist c{}, n{};    ///< weights at the C (P1) and N (P1') end
  };
  // ---- end 1.12 D ----

  /**
    @brief A protease model table with its background and optional v2 rows.
  */
  struct ModelTable
  {
    std::vector<std::string> header;  ///< the '#' lines, without '#'
    std::vector<Model> models;        ///< in first-appearance order
    bool has_bg = false;              ///< the table has background rows
    Dist bg_c{}, bg_n{};              ///< background at the C and N end
    // ---- 1.12 D: v2 rows (empty in a v1 table) ----
    int version = 1;                   ///< 2 with the MODELS_V2_MARKER header line
    std::vector<Detection> detection;  ///< rows "detection <class> <end> <residue> <weight>"
    /// "reference - C K|R <freq>": the in-silico tryptic K and R shares of the
    /// fixed reference the detection weights were fitted against (provenance;
    /// never read by the classifier).
    bool has_reference = false;
    double ref_k = 0.0, ref_r = 0.0;
    /// "specificity trypsin|nontryptic - - <s>": the background share mixed
    /// into the Trypsin-class models and into every other model.
    bool has_specificity = false;
    double s_trypsin = 0.05, s_nontryptic = 0.05;
    /**
      @brief The detection weights of an instrument class.

      @param[in] cls Instrument class.
      @return The detection weights of instrument class @p cls, or null.
    */
    const Detection* detectionFor(std::string_view cls) const;
  };

  /**
    @brief Reads a model table from a file.

    Reads a model table (columns model, class, end, residue, freq; '#' lines
    are its header). Rows with model "background" are the mixing component
    and must cover all 19 residues at both ends; residue "*" sets that end of
    a model to the background, as does an end without rows. Returns false
    with @p err on a malformed table.

    A v2 table (header line MODELS_V2_MARKER) may also hold detection,
    reference and specificity rows (ModelTable). A v1 table parses as in
    FASTag 1.11.

    @param[in] path Path of the table file.
    @param[out] out The table read (reset first).
    @param[out] err Error message on failure; may be null.
    @return True on success; false when the file cannot be read or the table is malformed.
  */
  bool loadModelTable(const std::string& path, ModelTable& out, std::string* err);
  /**
    @brief Reads a model table from a stream (see loadModelTable()).

    @param[in,out] in Stream the table is read from.
    @param[out] out The table read (reset first).
    @param[out] err Error message on failure; may be null.
    @return True on success; false on a malformed table.
  */
  bool parseModelTable(std::istream& in, ModelTable& out, std::string* err);

  /**
    @brief Residue composition of a set of sequences.

    Ile (I) counted as Leu (L), other letters skipped, normalised over the
    19 residues.

    @param[in] sequences Protein or peptide sequences.
    @return The normalised residue composition in AAS order.
  */
  Dist composition(const std::vector<std::string>& sequences);

  /**
    @brief Adds the residues of a sequence to residue counts.

    Counted as composition() does, so a FASTA can be streamed rather than
    held in memory.

    @param[in] seq Sequence whose residues are counted.
    @param[in,out] cnt Residue counts in AAS order, incremented.
  */
  void addResidues(const std::string& seq, std::array<std::uint64_t, NUM_AA>& cnt);

  /**
    @brief Normalises residue counts to a composition.

    With @p pseudocount, one count is first added to every residue when any
    of them is 0, so no model scores -inf on a residue the FASTA lacks;
    @p added says whether that happened.

    @param[in] cnt Residue counts in AAS order.
    @param[in] pseudocount Whether to add the pseudocount when a residue count is 0.
    @param[out] added Set to whether the pseudocount was added; may be null.
    @return The normalised composition (all 0 when the total is 0).
  */
  Dist composition(std::array<std::uint64_t, NUM_AA> cnt, bool pseudocount, bool* added = nullptr);

  /**
    @brief The log-likelihood of one model.
  */
  struct ModelScore
  {
    std::string name, cls;  ///< model name and class
    double loglik;          ///< log-likelihood of the counts under the model
  };

  /**
    @brief A protease call: the model scores, the call, the runner-up and its margin.
  */
  struct Classification
  {
    bool scored = false;   ///< n_c >= tag_min
    bool uses_nterm = false;  ///< the N-terminal counts were scored as well
    std::vector<ModelScore> scores;  ///< table order
    int top = -1, runner_up = -1;    ///< indices into scores; runner_up -1 = no other class
    double margin = 0.0;             ///< log-likelihood per tag
    std::uint64_t n_c = 0, n_n = 0;  ///< sums of the merged C- and N-terminal (P1, P1') counts; written as count.n_c, count.n_n
    /// The call's or the runner-up's log-likelihood is not finite (a residue
    /// at probability 0), so there is no valid margin.
    bool nonfinite = false;
    /// The runner-up scores exactly as the call: the names of every model
    /// with the top score, in table order (empty when there is no tie).
    std::vector<std::string> tied;
  };

  /**
    @brief The protease call over the merged counts.

    Each model mixed as (1 - share) * model + share * background, scored by
    the multinomial log-likelihood of the C-terminal counts plus, with
    >= tag_min N-terminal counts, of the N-terminal ones. The call is the
    top model (ties to the one listed first); the runner-up the best model
    of another class.

    @param[in] cterm Merged C-terminal (P1) counts in AAS order.
    @param[in] nterm Merged N-terminal (P1') counts in AAS order.
    @param[in] table Model table with background.
    @param[in] share Background share mixed into each model.
    @param[in] tag_min Minimum number of counts at an end to score it.
    @return The classification.
  */
  Classification classify(const std::array<std::uint64_t, NUM_AA>& cterm,
                          const std::array<std::uint64_t, NUM_AA>& nterm,
                          const ModelTable& table, double share, int tag_min);

  /// post-1.13.1 (aspn): the share of the counted N-terminal tag ends that
  /// softenNterm() leaves at the Asp-N model's cleavage site. With the 5 %
  /// background share Asp-N then beats `unspecific` from about 21 % D among
  /// the N-terminal tag ends (above 50 % before); the development runs have
  /// 33-78 % D in Asp-N digests and at most 10 % elsewhere.
  inline constexpr double NTERM_SITE_SHARE = 0.5;
  /**
    @brief Mixes the N end of one model with the background.

    Replaces the N end of model @p name by site_share * model +
    (1 - site_share) * background: only part of the N-terminal tag ends of an
    N-terminal-rule digest sit at a cleavage site (a tag seldom reaches the
    peptide's N-terminus cleanly). No-op for an unknown model or an N end
    that is the background. Used by the shortlist's protease check with
    -shortlist_protease other than trypsin; -digest_out's call is untouched.

    @param[in,out] table Model table whose model is changed.
    @param[in] name Name of the model.
    @param[in] site_share Share of the model at its N end (e.g. NTERM_SITE_SHARE).
  */
  void softenNterm(ModelTable& table, std::string_view name, double site_share);

  // ---- 1.12 D: detection, specificity, flank2 (#3c-#3e), all opt-in ----

  /**
    @brief What classify() and classify2() add to the 1.11 model.

    Default: nothing, and classify() is the 1.11 classifier bit for bit.
  */
  struct ClassifyOptions
  {
    /// #3c: weights applied to each model end and to the background before
    /// they are mixed: (1 - s) * w(p) + s * w(bg), w(x) = e * x rescaled to
    /// the sum of x (so unit weights give the 1.11 scores bit for bit).
    const Detection* detection = nullptr;
    /// #3e: s per model from the table's specificity rows (Trypsin class:
    /// s_trypsin, every other class: s_nontryptic) instead of @p share.
    bool specificity = false;
    double s_trypsin = 0.05, s_nontryptic = 0.05;  ///< background shares used with specificity
    /// @brief Whether any option differs from the 1.11 model.
    /// @return True with detection weights or specificity set.
    bool active() const { return detection != nullptr || specificity; }
  };

  /**
    @brief The protease call with the 1.12 options (see the overload without them).

    @param[in] cterm Merged C-terminal (P1) counts in AAS order.
    @param[in] nterm Merged N-terminal (P1') counts in AAS order.
    @param[in] table Model table with background.
    @param[in] share Background share mixed into each model (unless @p opt sets specificity).
    @param[in] tag_min Minimum number of counts at an end to score it.
    @param[in] opt Detection weights and specificity options.
    @return The classification.
  */
  Classification classify(const std::array<std::uint64_t, NUM_AA>& cterm,
                          const std::array<std::uint64_t, NUM_AA>& nterm,
                          const ModelTable& table, double share, int tag_min,
                          const ClassifyOptions& opt);

  /**
    @brief #3d: the two-residue flank masses, binned.

    When y1 is cut off, a tag's C-terminal flank is m(P2) + m(P1). Every
    ordered residue pair (X, Y) = (P2, P1) is put into one bin: pairs whose
    sums lie within the window of each other (single linkage) share it, so a
    collision (AG, GA; GG at the mass of N) is one bin whose pairs are summed
    once.
  */
  struct Flank2Bins
  {
    double window = 0.0;                                  ///< the window the bins were built at (Da)
    std::vector<double> lo, hi;                           ///< per bin: lowest and highest pair sum
    std::vector<std::vector<std::pair<int, int>>> pairs;  ///< per bin: (P2, P1) in AAS indices
    std::vector<double> sums;                             ///< every pair sum, ascending
    std::vector<int> bin_of;                              ///< the bin of sums[i]
    /**
      @brief The bin of a flank mass.

      @param[in] mass Flank mass (Da).
      @return The bin of the pair sum nearest @p mass when it is within the
        window, else -1.
    */
    int find(double mass) const;
  };
  /**
    @brief Builds the two-residue flank bins.

    @param[in] window Mass window (Da).
    @return The bins at @p window over the residueKeys() masses (C carbamidomethylated).
  */
  Flank2Bins flank2Bins(double window);

  /**
    @brief #3d: the flank2 call over the dipeptide histogram.

    Each model predicts bin b as the sum over its pairs of
    bg_C(P2) * model_C(P1), mixed as classify() mixes, and is scored by the
    multinomial log-likelihood of the counts. Scored with >= tag_min counts;
    n_c is the histogram total, uses_nterm is false.

    @param[in] dip Dipeptide histogram, one count per bin of @p bins.
    @param[in] bins The flank2 bins.
    @param[in] table Model table with background.
    @param[in] share Background share mixed into each model.
    @param[in] tag_min Minimum histogram total to score.
    @param[in] opt Detection weights and specificity options.
    @return The classification.
  */
  Classification classify2(const std::vector<std::uint64_t>& dip, const Flank2Bins& bins,
                           const ModelTable& table, double share, int tag_min,
                           const ClassifyOptions& opt = ClassifyOptions());

  /**
    @brief #3f: the calibrated probability that a call is correct.

    A logistic model over at most three features: p = 1 / (1 + exp(-(intercept
    + margin_coef * margin + log_n_coef * ln(n) + first_peak_coef * first_peak))).
  */
  struct Calibration
  {
    bool loaded = false;              ///< a calibration was read
    std::vector<std::string> header;  ///< the '#' lines, without '#'
    double intercept = 0.0, margin = 0.0, log_n = 0.0, first_peak = 0.0;  ///< coefficients
  };
  /**
    @brief Reads a calibration table from a stream.

    Columns feature, coef; the features intercept, margin, log_n and
    first_peak, each exactly once. False with @p err on a malformed table.

    @param[in,out] in Stream the table is read from.
    @param[out] out The calibration read (reset first; loaded set on success).
    @param[out] err Error message on failure; may be null.
    @return True on success.
  */
  bool parseCalibration(std::istream& in, Calibration& out, std::string* err);
  /**
    @brief Reads a calibration table from a file (see parseCalibration()).

    @param[in] path Path of the table file.
    @param[out] out The calibration read.
    @param[out] err Error message on failure; may be null.
    @return True on success; false when the file cannot be read or the table is malformed.
  */
  bool loadCalibration(const std::string& path, Calibration& out, std::string* err);
  /**
    @brief p_correct of a call.

    @param[in] cal The calibration.
    @param[in] margin Margin of the call (per tag end).
    @param[in] n Number of tag ends (at least 1 is used).
    @param[in] first_peak The first-peak flag.
    @return The calibrated probability that the call is correct.
  */
  double pCorrect(const Calibration& cal, double margin, std::uint64_t n, bool first_peak);
  // ---- end 1.12 D ----

  // ---- mass gaps --------------------------------------------------------

  /**
    @brief A modification considered to explain mass gaps.
  */
  struct GapMod
  {
    std::string name, site;          ///< modification name and site
    double prior = 1.0, mass = 0.0;  ///< prior weight and mass shift (Da)
  };

  /**
    @brief Reads gap modifications from a stream.

    Reads name, site, prior rows ('#' lines skipped); masses are filled by
    the caller (ModificationsDB).

    @param[in,out] in Stream the rows are read from.
    @param[out] out The modifications read (cleared first), masses 0.
    @param[out] err Error message on failure; may be null.
    @return True on success; false on a malformed row.
  */
  bool parseGapMods(std::istream& in, std::vector<GapMod>& out, std::string* err);

  /**
    @brief A multiset of modifications and its summed mass.
  */
  struct Combo
  {
    double mass;            ///< summed mass shift (Da)
    std::vector<int> mods;  ///< indices into the modification list, ascending
  };
  /**
    @brief Every combination of up to max_mods modifications.

    Every multiset of 1..@p max_mods modifications, sorted as Python sorts
    (mass, names): by mass, then by the names.

    @param[in] mods The modifications (with masses).
    @param[in] max_mods Largest number of modifications in a combination.
    @return The sorted combinations.
  */
  std::vector<Combo> combinations(const std::vector<GapMod>& mods, int max_mods);
  /**
    @brief The combinations that explain a mass gap.

    @param[in] combos Combinations from combinations().
    @param[in] mods The modifications the combinations index.
    @param[in] delta Mass gap to explain (Da).
    @param[in] tol Mass tolerance (Da).
    @return The combinations within @p tol of @p delta, best first
      (fewest modifications, highest prior product, smallest mass error).
  */
  std::vector<std::vector<int>> explain(const std::vector<Combo>& combos, const std::vector<GapMod>& mods,
                                        double delta, double tol);

  /**
    @brief One mass-gap histogram row.
  */
  struct GapRow
  {
    double delta;           ///< mass gap (Da)
    std::uint64_t spectra;  ///< spectra with this gap
  };

  /**
    @brief One detected mass-gap peak and its explanation.
  */
  struct GapPeak
  {
    double delta;           ///< mass gap of the peak (Da)
    std::uint64_t spectra;  ///< spectra in the peak
    std::vector<int> explained_by;              ///< empty = none
    std::vector<std::vector<int>> alternatives; ///< other explaining combinations
    std::string context;                        ///< context text for the report
    /// The histogram rows the peak claimed: indices into the rows given to
    /// detectGaps() (gapResult(): into its unfiltered rows), ascending.
    /// Internal, never printed.
    std::vector<std::size_t> members;
  };

  /**
    @brief The mass-gap result: peaks, modification shares and the SILAC call.
  */
  struct GapResult
  {
    std::uint64_t placed = 0, shifted = 0;  ///< shifted tags counted; a share uses max(1, shifted) as its denominator
    std::vector<GapPeak> peaks;             ///< detected peaks
    std::vector<std::pair<int, double>> share;  ///< modification -> share, first-seen order
    std::string silac = "none";                 ///< the SILAC call
    std::array<double, 4> silac_share{};        ///< Lys4, Arg6, Lys8, Arg10
  };

  /**
    @brief Detects mass-gap peaks and explains them.

    Gap peaks explained as modification combinations, their shares and the
    SILAC call, over @p hist (the rows with >= min_bin spectra).

    @param[in] hist Histogram rows.
    @param[in] mods The modifications.
    @param[in] combos Combinations from combinations().
    @param[in] tol Mass tolerance (Da).
    @param[in] min_spectra Minimum spectra for a peak.
    @param[in] min_share Minimum peak size as a share of the placed tags (the threshold is the larger of the two).
    @param[in] silac_share Minimum share for a SILAC label modification to count as seen.
    @param[in] silac_min Minimum shifted tags for a SILAC call.
    @return The gap result.
  */
  GapResult detectGaps(const std::vector<GapRow>& hist, const std::vector<GapMod>& mods,
                       const std::vector<Combo>& combos, double tol, std::uint64_t min_spectra,
                       double min_share, double silac_share, std::uint64_t silac_min);

  // ---- report rows ------------------------------------------------------

  /**
    @brief One report row (section, key, value, n, description).
  */
  struct Row
  {
    std::string section, key, value, n, description;  ///< the report columns
  };
  /**
    @brief Formats a double for a report.

    @param[in] v Value to format.
    @return The double in shortest round-trip form.
  */
  std::string num(double v);
  /**
    @brief Formats an unsigned integer for a report.

    @param[in] v Value to format.
    @return The decimal digits of @p v.
  */
  std::string num(std::uint64_t v);
  /**
    @brief Writes report rows as a TSV with a header line.

    Tabs and line breaks inside fields are written as spaces; an empty n is
    written as "-".

    @param[in] path Output file path.
    @param[in] rows Rows to write.
    @return True on success; false when the file cannot be written.
  */
  bool writeReport(const std::string& path, const std::vector<Row>& rows);

  // ---- reports ----------------------------------------------------------

  /**
    @brief What the input says about the instrument, from run and MS2 metadata.
  */
  struct RunMeta
  {
    std::string instrument_name, instrument_model, native_id_type;  ///< empty = absent
    std::uint64_t ms2 = 0;                       ///< MS2 spectra looked at
    std::uint64_t im_vssc = 0, im_drift = 0, im_faims = 0, im_other = 0;  ///< MS2 with ion mobility, by unit
    std::vector<double> scan_low;                ///< lowest scan-window begin per MS2 that has one
    std::vector<double> first_peak;              ///< lowest peak m/z per MS2
    std::uint64_t peaks = 0, peaks_whole = 0;    ///< MS2 peaks with an intensity above 0, and those of them that are whole numbers
    bool im_unread = false;                      ///< the input format carries no ion mobility (MGF)
    // ---- 1.12 D #3c: MS2 fragmentation and analyzer, for instrumentClass() only ----
    std::uint64_t ms2_beam = 0;       ///< MS2 with beam-type CID (HCD) activation (addFragmentation())
    std::uint64_t ms2_resonance = 0;  ///< MS2 with resonance (ion-trap) CID, trap-type CID or PQD
    std::uint64_t ms2_itms = 0, ms2_ftms = 0;  ///< MS2 whose Thermo filter string starts ITMS / FTMS
    bool analyzer_orbitrap = false, analyzer_iontrap = false;  ///< mass analyzers the run header names
    // ---- end 1.12 D ----
  };

  // ---- 1.12 D #3c: MS2 fragmentation ----
  /**
    @brief What one MS2 spectrum says about its fragmentation and analyzer.
  */
  enum class Fragmentation : int { UNKNOWN = 0, BEAM, RESONANCE };
  /**
    @brief Counts one MS2 into the run metadata.

    @p frag from its activation methods (or its filter string's @hcd/@cid
    token when they say nothing), and the ITMS/FTMS prefix of @p filter
    (empty: none).

    @param[in,out] meta Run metadata whose MS2 counters are incremented.
    @param[in] frag Fragmentation of the MS2.
    @param[in] filter Thermo filter string of the MS2 (may be empty).
  */
  void addFragmentation(RunMeta& meta, Fragmentation frag, std::string_view filter);
  /**
    @brief The fragmentation named by a Thermo filter string.

    The @<method> tokens of a Thermo filter string: hcd is Beam; cid and
    pqd are Resonance (hcd wins when both appear).

    @param[in] filter Thermo filter string.
    @return The fragmentation; Unknown when no token says.
  */
  Fragmentation fragmentationFromFilter(std::string_view filter);
  // ---- end 1.12 D ----

  /**
    @brief Settings of the digest and label reports.
  */
  struct DigestSettings
  {
    double window = 0.008;                     ///< terminus mass window (Da)
    int tag_min = 100;                         ///< minimum tag ends for a call
    double background_share = 0.05;            ///< background share mixed into each model
    int silac_min = 50;                        ///< minimum K- and R-terminal ends for SILAC
    bool low_resolution = false;               ///< fragment tolerance in Da
    std::string models = "shipped", background = "shipped_human";  ///< model table and background sources
    bool background_pseudocount = false;       ///< one count added per residue of the FASTA
    // ---- 1.12 D: chemistry v2 (#3c-#3f), all off by default ----
    // At these defaults digestRows() writes the 1.11 rows byte for byte. Not
    // validated on held-out data; the fits come at the DEV regeneration on
    // the release candidate.
    std::string models_version = "shipped";  ///< -digest_models_version: shipped | v2
    bool detection = false;                   ///< -digest_detection shipped (#3c; the timsTOF call)
    bool flank2 = false;                      ///< -digest_flank2 auto (#3d)
    double min_confidence = 0.0;              ///< -digest_min_confidence (#3f); 0 = off
    Calibration calibration;                  ///< loaded when p_correct is written (#3f)
    std::string calibration_source;           ///< "shipped" or the -digest_calibration path
    /**
      @brief Whether any chemistry v2 option is on.

      Any of the above is on: digestRows() writes the v2 rows.

      @return True when a v2 option is set.
    */
    bool chemV2() const
    {
      return models_version != "shipped" || detection || flank2 || min_confidence > 0.0 || calibration.loaded;
    }
    // ---- end 1.12 D ----
  };

  // ---- 1.12 D: instrument class (#3c) ----
  /**
    @brief The detection class of a run (INSTRUMENT_CLASSES).

    Detection is a property of the MS2 analyzer and the fragmentation, not of
    the instrument's name:
      - timstof when the timstof or ion_counts no-call rule of -digest_out
        would read "yes";
      - orbitrap_hcd for an Orbitrap-family run (the name or model names
        Orbitrap, Q Exactive, Exploris, Astral, Lumos, Fusion, Eclipse or
        Ascend, or the run header lists an Orbitrap analyzer) whose MS2 are
        mostly beam-type CID (HCD) and not mostly read in the ion trap (ITMS
        filter strings). Without any activation information, only the
        HCD-only families (Q Exactive, Exploris, Astral) or a header with an
        Orbitrap and no ion-trap analyzer count;
      - other otherwise: an LTQ Orbitrap or Velos run with ion-trap CID MS2
        is other, not orbitrap_hcd.

    @param[in] meta Run metadata.
    @return One of INSTRUMENT_CLASSES.
  */
  std::string instrumentClass(const RunMeta& meta);
  // ---- end 1.12 D ----

  /**
    @brief Python statistics.median.

    @param[in] v Values (taken by value and sorted).
    @return The median; NaN for none.
  */
  double median(std::vector<double> v);

  /**
    @brief The -digest_out rows of a run.

    @param[in] tc Terminus counts of the run.
    @param[in] table Model table.
    @param[in] meta Run metadata.
    @param[in] s Digest settings.
    @return The report rows.
  */
  std::vector<Row> digestRows(const TerminusCounter& tc, const ModelTable& table, const RunMeta& meta,
                              const DigestSettings& s);
  /**
    @brief The -label_out rows of a run.

    @param[in] tc Terminus counts of the run.
    @param[in] s Digest settings.
    @return The report rows.
  */
  std::vector<Row> labelRows(const TerminusCounter& tc, const DigestSettings& s);

  /**
    @brief The C-terminal K/R share of the tag ends.

    Labelled K and R+10 included: the -digest_out row share.kr (res() / tot()
    summed over the K and R keys in residueKeys() order). Needs tot() > 0.

    @param[in] tc Terminus counts.
    @return The K/R share.
  */
  double krShare(const TerminusCounter& tc);

  // ---- 1.13 digqual (backlog 23): digestion quality ----------------------
  //
  // Missed-cleavage and non-specific-end measurements for one enzyme (a model
  // of the table), from the tag ends alone; see doc/DESIGN-digest.md,
  // "Digestion quality". Written by -digest_quality after the 1.12 rows.

  /**
    @brief The measurements at one cleaving end of the enzyme's model.
  */
  struct QualityEnd
  {
    char end = 'C';                   ///< 'C' (P1) or 'N' (P1')
    std::vector<int> sites;           ///< AAS indices whose model probability is above the background's
    bool measured = false;            ///< ends >= tag_min
    bool mc_measured = false;         ///< measured and specific >= tag_min (the mc_* ratios)
    std::uint64_t ends = 0;           ///< merged P1 (P1') counts
    std::uint64_t specific = 0;       ///< of them at a site residue
    double nonspecific_share = 0.0;   ///< 1 - specific / ends
    double nonspecific_mle = 0.0;     ///< s maximising the likelihood of (1 - s) model + s background
    std::uint64_t mc_positions = 0;   ///< residues at P2..P4 (P2'..P4') of the tags with a specific end
    std::uint64_t mc_sites = 0;       ///< of them at a site residue
    double mc_background_share = 0.0; ///< background share of the site residues
    double mc_retention = 0.0;        ///< (sites / non-sites) / (b / (1 - b)); NaN when undefined
  };

  /**
    @brief The digestion quality of one enzyme.
  */
  struct Quality
  {
    std::string enzyme;               ///< the model measured ("-" when none)
    std::string basis;                ///< "named" (-digest_quality <model>) or "call" (auto)
    bool measured = false;            ///< at least one end measured
    std::string reason;               ///< not measured: low_resolution, no_call, no_specific_end, few_tags
    std::vector<QualityEnd> ends;     ///< the model's non-background ends, C first
  };

  /**
    @brief The site residues of one model end.

    Residues with p(a) > bg(a), both normalised over the 19 residues.

    @param[in] model_end Residue distribution of the model end.
    @param[in] bg Background distribution of the same end.
    @return AAS indices of the site residues; empty for a background end.
  */
  std::vector<int> siteResidues(const Dist& model_end, const Dist& bg);
  /**
    @brief Maximum-likelihood background share of a mixture.

    The background share s in [0, 1] that maximises sum_a k_a ln((1 - s) p_a
    + s b_a) (p, b normalised); bisection on the derivative (concave in s).

    @param[in] k Residue counts in AAS order.
    @param[in] p Model distribution.
    @param[in] b Background distribution.
    @return The share s in [0, 1].
  */
  double mixtureShareMle(const std::array<std::uint64_t, NUM_AA>& k, const Dist& p, const Dist& b);
  /**
    @brief The digestion quality of one model.

    The quality of @p model (a model of @p table, whose background is used)
    over the counts of @p tc; an end is measured with >= @p tag_min ends,
    and its missed-cleavage ratios (mc_site_share, mc_retention) need
    >= @p tag_min specific ends as well (mc_measured). @p basis is written
    as given.

    @param[in] tc Terminus counts.
    @param[in] table Model table (its background is used).
    @param[in] model Model to measure.
    @param[in] basis Basis written into the result.
    @param[in] tag_min Minimum ends for a measurement.
    @return The quality.
  */
  Quality digestQuality(const TerminusCounter& tc, const ModelTable& table, const Model& model,
                        const std::string& basis, int tag_min);
  /**
    @brief The quality written for a -digest_quality option.

    The quality written for -digest_quality @p option (a model name of
    @p table, or "auto") on a report whose 1.12 rows are @p report: auto
    takes the model of the rows `call status` = call and `call model`
    (basis "call"; no call or a model not in @p table gives reason no_call).
    A Da tolerance (@p s.low_resolution) gives reason low_resolution and no
    end, whatever the enzyme.

    @param[in] tc Terminus counts.
    @param[in] table Model table.
    @param[in] report The 1.12 -digest_out rows.
    @param[in] option The -digest_quality value.
    @param[in] s Digest settings.
    @return The quality.
  */
  Quality reportQuality(const TerminusCounter& tc, const ModelTable& table, const std::vector<Row>& report,
                        const std::string& option, const DigestSettings& s);
  /**
    @brief The quality section rows (section "quality").

    For a measured or an unmeasured result.

    @param[in] q The quality.
    @param[in] s Digest settings.
    @return The report rows.
  */
  std::vector<Row> qualityRows(const Quality& q, const DigestSettings& s);
  // ---- end 1.13 digqual ----

  // ---- label_call (FASTag 1.12 #3a) ---------------------------------------
  //
  // The label call prose-auto 0.1.10 makes from FASTag's -digest_out and
  // -label_out (prose_auto/external.py fastag_termini / termini_evidence,
  // commit e15aaf7), ported rule for rule so both call the same label from
  // the same counts. It reads the tag-end counts only, never the mass-gap
  // result, so -massgap_out cannot change it.
  //   - no_call low_resolution: the fragment tolerance is in Da (prose-auto
  //     runs the termini only on ppm runs);
  //   - no_call few_tags: fewer than LABEL_TAG_MIN C-terminal tag ends
  //     (tot(); 175, prose-auto 0.1.10's TAG_MIN, the 1.12 rule);
  //   - an isobaric label (labelKeys() order) when its count reaches
  //     LABEL_MIN_SHARE of the filtered tags AND LABEL_BACKGROUND_FOLD times
  //     max(its +0.5 Da background, 1);
  //   - SILAC (Lys8/Arg10) when the heavy K8 and R10 shares are both
  //     >= HEAVY_MIN, the K/R share rounded to 3 decimals (as prose-auto
  //     compares it) is >= KR_TRYPTIC and the K- and R-terminal ends are each
  //     >= DigestSettings::silac_min (50, prose-auto's SILAC_MIN_TAGS);
  //     strong when both shares are >= HEAVY_STRONG;
  //   - every label that passes is listed (isobaric first); none is
  //     label-free.
  inline constexpr std::uint64_t LABEL_TAG_MIN = 175;
  inline constexpr double LABEL_MIN_SHARE = 0.01, LABEL_BACKGROUND_FOLD = 20.0;
  inline constexpr double HEAVY_MIN = 0.2, HEAVY_STRONG = 0.3, KR_TRYPTIC = 0.8;

  /**
    @brief The label call over the tag-end counts.
  */
  struct LabelCall
  {
    bool called = false;              ///< a call was made
    std::string reason;               ///< no call: low_resolution or few_tags
    std::vector<std::string> labels;  ///< labelKeys() names that passed, then "SILAC"
    bool isobaric = false;            ///< an isobaric label passed
    bool silac = false, silac_strong = false;  ///< SILAC passed, and passed strongly
    double kr_rounded = 0.0;          ///< krShare() rounded to 3 decimals; 0 when tot() is 0
  };

  /**
    @brief The label call over the tag-end counts (see the rules above).

    @param[in] tc Terminus counts.
    @param[in] s Digest settings.
    @return The label call.
  */
  LabelCall labelCall(const TerminusCounter& tc, const DigestSettings& s);
  /**
    @brief The label_call rows -label_out appends after labelRows().

    Status, label, basis, silac and reason, in that order.

    @param[in] c The label call.
    @param[in] tc Terminus counts.
    @param[in] s Digest settings.
    @return The report rows.
  */
  std::vector<Row> labelCallRows(const LabelCall& c, const TerminusCounter& tc, const DigestSettings& s);

  /**
    @brief Settings of the mass-gap report.
  */
  struct GapSettings
  {
    double window = 0.02;  ///< the window in use (ppm or Da run)
    std::uint64_t min_spectra = 20, min_bin = 2;  ///< minimum spectra per peak and per histogram row
    double min_share = 0.005;                     ///< minimum peak size as a share of the placed tags
    int max_mods = 3, top = 5;                    ///< modifications per combination, and shares reported
    double silac_share = 0.08;                    ///< minimum share for a SILAC label to count as seen
    std::uint64_t silac_min = 500;                ///< minimum shifted tags for a SILAC call
  };

  /**
    @brief The gap result every gap reader shares.

    detectGaps() over the rows of @p rows with at least @p s.min_bin spectra,
    with @p s's window and thresholds. GapPeak::members index @p rows itself
    (unfiltered).

    @param[in] rows Histogram rows (unfiltered).
    @param[in] mods The modifications.
    @param[in] combos Combinations from combinations().
    @param[in] s Gap settings.
    @return The gap result.
  */
  GapResult gapResult(const std::vector<GapRow>& rows, const std::vector<GapMod>& mods,
                      const std::vector<Combo>& combos, const GapSettings& s);

  /**
    @brief The -massgap_out rows.

    @param[in] rows Every -delta_out row, its gap as parsed.
    @param[in] keys Every -delta_out row's gap as printed.
    @param[in] mods The modifications.
    @param[in] combos Combinations from combinations().
    @param[in] cys The Cys alkylation candidates.
    @param[in] s Gap settings.
    @return The report rows.
  */
  std::vector<Row> massgapRows(const std::vector<GapRow>& rows, const std::vector<std::string>& keys,
                               const std::vector<GapMod>& mods, const std::vector<Combo>& combos,
                               const std::vector<GapMod>& cys, const GapSettings& s);
  /**
    @brief The -massgap_out rows from a precomputed gap result.

    The same, with @p res = gapResult(rows, mods, combos, s) computed by the
    caller, so the report and other gap readers share one result.

    @param[in] rows Every -delta_out row, its gap as parsed.
    @param[in] keys Every -delta_out row's gap as printed.
    @param[in] mods The modifications.
    @param[in] cys The Cys alkylation candidates.
    @param[in] s Gap settings.
    @param[in] res The gap result.
    @return The report rows.
  */
  std::vector<Row> massgapRows(const std::vector<GapRow>& rows, const std::vector<std::string>& keys,
                               const std::vector<GapMod>& mods, const std::vector<GapMod>& cys,
                               const GapSettings& s, const GapResult& res);
}
