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
  inline constexpr std::string_view kAAs = "GASPVTCLNDQKEMHFRYW";
  inline constexpr int kNumAA = 19;
  /// Index of @p c in kAAs (I counts as L), or -1.
  int aaIndex(char c);

  inline constexpr double kH2O = 18.010565;

  /// Python's sum() over floats (CPython >= 3.12): the first value as is,
  /// then Neumaier-compensated addition, the compensation added at the end.
  class PySum
  {
  public:
    void add(double x);
    double value() const;

  private:
    double f_ = 0.0, c_ = 0.0;
    bool any_ = false;
  };

  /// Residue keys: the 19 residues, then lysine with TMT, TMTpro, iTRAQ4 or
  /// +8 Da (heavy), and arginine +10 Da (heavy).
  inline constexpr int kNumKeys = 24;
  struct ResidueKey
  {
    const char* name;
    double mass;
    int merged;  ///< residue index the key counts as (labelled K as K), -1 for R+10
  };
  const std::array<ResidueKey, kNumKeys>& residueKeys();

  /// The N-terminal labels counted.
  inline constexpr int kNumLabels = 3;
  struct LabelKey
  {
    const char* name;
    double mass;
  };
  const std::array<LabelKey, kNumLabels>& labelKeys();

  struct Flank2Bins;  // 1.12 D #3d, below

  /// Counts over the filtered tags (gapped == 0, evalue <= 1), added one tag
  /// at a time. "Near m" below means within [m - w, m + w], w the window.
  class TerminusCounter
  {
  public:
    explicit TerminusCounter(double window = 0.008) : w_(window) {}

    // ---- 1.12 D: flank2 (#3d), off unless enabled ----
    /// Also count the dipeptide histogram dip: per Flank2Bins bin at this
    /// window, the tags whose C-terminal flank (or N-terminal flank less
    /// H2O, a reversed b tag) is a two-residue sum of that bin.
    void enableFlank2();
    bool flank2() const { return bins_ != nullptr; }
    const Flank2Bins* flank2Table() const { return bins_.get(); }
    std::vector<std::uint64_t> dip;  ///< empty unless enableFlank2()
    // ---- end 1.12 D ----

    /// One filtered tag: its flanking masses and its sequence without
    /// modification annotations. A b/y tag (FASTag 1.11).
    void add(double nterm, double cterm, std::string_view seq);
    /// The same for a tag of another ion series (1.12 #15 phase B): a
    /// reversed read's N-terminal flank is the C-side residues +
    /// @p reversed_offset (IonSeries::IonPair::reversedOffset(); +H2O is the
    /// b/y overload above, c/z-dot -15.0347). The n_h2o counts are the
    /// reversed reads' C-terminal residues in every series.
    void add(double nterm, double cterm, std::string_view seq, double reversed_offset);
    void merge(const TerminusCounter& o);

    std::uint64_t tags = 0;                         ///< number of tags counted
    std::array<std::uint64_t, kNumKeys> c_near{};   ///< tags whose C-terminal flank mass is near key k's mass
    std::array<std::uint64_t, kNumKeys> n_h2o{};    ///< tags whose N-terminal flank mass is near key k's mass + H2O
    std::array<std::uint64_t, kNumKeys> n_near{};   ///< tags whose N-terminal flank mass is near key k's mass
    /// Per labelKeys() entry: tags whose N- or C-terminal flank mass is near
    /// the label mass.
    std::array<std::uint64_t, kNumLabels> lab_n{}, lab_c{};
    /// The same counts at label mass + 0.5 Da, where no label sits: an
    /// off-mass control, written as <L>.background by the label report.
    std::array<std::uint64_t, kNumLabels> lab_bg_n{}, lab_bg_c{};
    /// Counts per position and residue (kAAs order). Positions use the
    /// protease notation of Schechter and Berger: the cleavage falls between
    /// P1 and P1'; P1 is the last residue before it, P2 the one before P1, and
    /// P1' the first residue after it. cpos[0..3] = P1..P4 on the C end,
    /// npos[0..3] = P1'..P4' on the N end.
    std::array<std::array<std::uint64_t, kNumAA>, 4> cpos{}, npos{};
    // ---- 1.13 digqual (backlog 23): read by digestQuality() only ----
    /// The residues at P2..P4 of the tags counted at P1, by their P1 residue:
    /// cq[P1][residue] (kAAs order, labelled K merged into K as in cpos);
    /// nq the same for P2'..P4' by the P1' residue.
    std::array<std::array<std::uint64_t, kNumAA>, kNumAA> cq{}, nq{};
    // ---- end 1.13 digqual ----

    /// Tag ends that match key k: C-terminal flank near the key mass, or
    /// N-terminal flank near the key mass + H2O.
    std::uint64_t res(int k) const { return c_near[k] + n_h2o[k]; }
    /// res() summed over every key
    std::uint64_t tot() const;
    /// C- and N-terminal counts at P1 and P1', labelled lysines merged into K,
    /// in kAAs order
    std::array<std::uint64_t, kNumAA> cterm() const { return cpos[0]; }
    std::array<std::uint64_t, kNumAA> nterm() const { return npos[0]; }

  private:
    void add_(double nterm, double cterm, std::string_view seq, const double* reversed_offset);
    bool near_(double v, double m) const { return v >= m - w_ && v <= m + w_; }
    double w_;
    std::shared_ptr<const Flank2Bins> bins_;  ///< 1.12 D #3d; shared by copies
  };

  // ---- model table ------------------------------------------------------

  using Dist = std::array<double, kNumAA>;

  struct Model
  {
    std::string name, cls;  ///< cls: the table's 'class' column ('class' is a C++ keyword)
    Dist c{}, n{};
    bool c_bg = true, n_bg = true;  ///< that end is the background
  };

  // ---- 1.12 D: model table v2 (#3c, #3e) ----
  /// The header line ('#' and this text) that makes a table a v2 table. Only
  /// a v2 table reads the reserved model names detection, reference and
  /// specificity; in a table without it they are ordinary models, as in 1.11.
  inline constexpr std::string_view kModelsV2Marker = "fastag_digest_models v2";
  /// Instrument classes of the detection weights (instrumentClass()).
  inline constexpr std::array<std::string_view, 3> kInstrumentClasses = {"orbitrap_hcd", "timstof", "other"};

  /// Detection weights of one instrument class: observed P1 (C) or P1' (N)
  /// is proportional to e(a) * p(a). A residue without a row weighs 1.
  struct Detection
  {
    std::string cls;
    Dist c{}, n{};
  };
  // ---- end 1.12 D ----

  struct ModelTable
  {
    std::vector<std::string> header;  ///< the '#' lines, without '#'
    std::vector<Model> models;        ///< in first-appearance order
    bool has_bg = false;
    Dist bg_c{}, bg_n{};
    // ---- 1.12 D: v2 rows (empty in a v1 table) ----
    int version = 1;                   ///< 2 with the kModelsV2Marker header line
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
    /// The detection weights of instrument class @p cls, or null.
    const Detection* detectionFor(std::string_view cls) const;
  };

  /// Reads a model table (columns model, class, end, residue, freq; '#' lines
  /// are its header). Rows with model "background" are the mixing component
  /// and must cover all 19 residues at both ends; residue "*" sets that end of
  /// a model to the background, as does an end without rows. Returns false
  /// with @p err on a malformed table.
  ///
  /// A v2 table (header line kModelsV2Marker) may also hold detection,
  /// reference and specificity rows (ModelTable). A v1 table parses as in
  /// FASTag 1.11.
  bool loadModelTable(const std::string& path, ModelTable& out, std::string* err);
  bool parseModelTable(std::istream& in, ModelTable& out, std::string* err);

  /// Residue composition of @p sequences, Ile (I) counted as Leu (L), other
  /// letters skipped, normalised over the 19 residues.
  Dist composition(const std::vector<std::string>& sequences);

  /// Adds the residues of @p seq to @p cnt, counted as composition() does,
  /// so a FASTA can be streamed rather than held in memory.
  void addResidues(const std::string& seq, std::array<std::uint64_t, kNumAA>& cnt);

  /// @p cnt normalised. With @p pseudocount, one count is first added to
  /// every residue when any of them is 0, so no model scores -inf on a
  /// residue the FASTA lacks; @p added says whether that happened.
  Dist composition(std::array<std::uint64_t, kNumAA> cnt, bool pseudocount, bool* added = nullptr);

  struct ModelScore
  {
    std::string name, cls;
    double loglik;
  };

  struct Classification
  {
    bool scored = false;   ///< n_c >= tag_min
    bool uses_nterm = false;
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

  /// The protease call over the merged counts: each model mixed as
  /// (1 - share) * model + share * background, scored by the multinomial
  /// log-likelihood of the C-terminal counts plus, with >= tag_min N-terminal
  /// counts, of the N-terminal ones. The call is the top model (ties to the
  /// one listed first); the runner-up the best model of another class.
  Classification classify(const std::array<std::uint64_t, kNumAA>& cterm,
                          const std::array<std::uint64_t, kNumAA>& nterm,
                          const ModelTable& table, double share, int tag_min);

  // ---- 1.12 D: detection, specificity, flank2 (#3c-#3e), all opt-in ----

  /// What classify() and classify2() add to the 1.11 model. Default: nothing,
  /// and classify() is the 1.11 classifier bit for bit.
  struct ClassifyOptions
  {
    /// #3c: weights applied to each model end and to the background before
    /// they are mixed: (1 - s) * w(p) + s * w(bg), w(x) = e * x rescaled to
    /// the sum of x (so unit weights give the 1.11 scores bit for bit).
    const Detection* detection = nullptr;
    /// #3e: s per model from the table's specificity rows (Trypsin class:
    /// s_trypsin, every other class: s_nontryptic) instead of @p share.
    bool specificity = false;
    double s_trypsin = 0.05, s_nontryptic = 0.05;
    bool active() const { return detection != nullptr || specificity; }
  };

  Classification classify(const std::array<std::uint64_t, kNumAA>& cterm,
                          const std::array<std::uint64_t, kNumAA>& nterm,
                          const ModelTable& table, double share, int tag_min,
                          const ClassifyOptions& opt);

  /// #3d: the two-residue flank masses. When y1 is cut off, a tag's C-terminal
  /// flank is m(P2) + m(P1). Every ordered residue pair (X, Y) = (P2, P1) is
  /// put into one bin: pairs whose sums lie within the window of each other
  /// (single linkage) share it, so a collision (AG, GA; GG at the mass of N)
  /// is one bin whose pairs are summed once.
  struct Flank2Bins
  {
    double window = 0.0;
    std::vector<double> lo, hi;                           ///< per bin: lowest and highest pair sum
    std::vector<std::vector<std::pair<int, int>>> pairs;  ///< per bin: (P2, P1) in kAAs indices
    std::vector<double> sums;                             ///< every pair sum, ascending
    std::vector<int> bin_of;                              ///< the bin of sums[i]
    /// The bin of the pair sum nearest @p mass when it is within the window,
    /// else -1.
    int find(double mass) const;
  };
  /// The bins at @p window over the residueKeys() masses (C carbamidomethylated).
  Flank2Bins flank2Bins(double window);

  /// #3d: the flank2 call over the dipeptide histogram @p dip (one count per
  /// bin of @p bins): each model predicts bin b as the sum over its pairs of
  /// bg_C(P2) * model_C(P1), mixed as classify() mixes, and is scored by the
  /// multinomial log-likelihood of the counts. Scored with >= tag_min counts;
  /// n_c is the histogram total, uses_nterm is false.
  Classification classify2(const std::vector<std::uint64_t>& dip, const Flank2Bins& bins,
                           const ModelTable& table, double share, int tag_min,
                           const ClassifyOptions& opt = ClassifyOptions());

  /// #3f: the calibrated probability that a call is correct, a logistic model
  /// over at most three features: p = 1 / (1 + exp(-(intercept + margin_coef
  /// * margin + log_n_coef * ln(n) + first_peak_coef * first_peak))).
  struct Calibration
  {
    bool loaded = false;
    std::vector<std::string> header;  ///< the '#' lines, without '#'
    double intercept = 0.0, margin = 0.0, log_n = 0.0, first_peak = 0.0;
  };
  /// Columns feature, coef; the features intercept, margin, log_n and
  /// first_peak, each exactly once. False with @p err on a malformed table.
  bool parseCalibration(std::istream& in, Calibration& out, std::string* err);
  bool loadCalibration(const std::string& path, Calibration& out, std::string* err);
  /// p_correct of a call with this margin (per tag end), @p n tag ends
  /// (at least 1 is used) and the first-peak flag.
  double pCorrect(const Calibration& cal, double margin, std::uint64_t n, bool first_peak);
  // ---- end 1.12 D ----

  // ---- mass gaps --------------------------------------------------------

  struct GapMod
  {
    std::string name, site;
    double prior = 1.0, mass = 0.0;
  };

  /// Reads name, site, prior rows ('#' lines skipped); masses are filled by
  /// the caller (ModificationsDB).
  bool parseGapMods(std::istream& in, std::vector<GapMod>& out, std::string* err);

  struct Combo
  {
    double mass;
    std::vector<int> mods;  ///< indices into the modification list, ascending
  };
  /// Every multiset of 1..@p max_mods modifications, sorted as Python sorts
  /// (mass, names): by mass, then by the names.
  std::vector<Combo> combinations(const std::vector<GapMod>& mods, int max_mods);
  /// The combinations within @p tol of @p delta, best first
  /// (fewest modifications, highest prior product, smallest mass error).
  std::vector<std::vector<int>> explain(const std::vector<Combo>& combos, const std::vector<GapMod>& mods,
                                        double delta, double tol);

  struct GapRow
  {
    double delta;
    std::uint64_t spectra;
  };

  struct GapPeak
  {
    double delta;
    std::uint64_t spectra;
    std::vector<int> explained_by;              ///< empty = none
    std::vector<std::vector<int>> alternatives;
    std::string context;
    /// The histogram rows the peak claimed: indices into the rows given to
    /// detectGaps() (gapResult(): into its unfiltered rows), ascending.
    /// Internal, never printed.
    std::vector<std::size_t> members;
  };

  struct GapResult
  {
    std::uint64_t placed = 0, shifted = 0;  ///< shifted tags counted; a share uses max(1, shifted) as its denominator
    std::vector<GapPeak> peaks;
    std::vector<std::pair<int, double>> share;  ///< modification -> share, first-seen order
    std::string silac = "none";
    std::array<double, 4> silac_share{};        ///< Lys4, Arg6, Lys8, Arg10
  };

  /// Gap peaks explained as modification combinations, their shares and the
  /// SILAC call, over @p hist (the rows with >= min_bin spectra).
  GapResult detectGaps(const std::vector<GapRow>& hist, const std::vector<GapMod>& mods,
                       const std::vector<Combo>& combos, double tol, std::uint64_t min_spectra,
                       double min_share, double silac_share, std::uint64_t silac_min);

  // ---- report rows ------------------------------------------------------

  struct Row
  {
    std::string section, key, value, n, description;
  };
  /// The double in shortest round-trip form.
  std::string num(double v);
  std::string num(std::uint64_t v);
  bool writeReport(const std::string& path, const std::vector<Row>& rows);

  // ---- reports ----------------------------------------------------------

  /// What the input says about the instrument, from run and MS2 metadata.
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
  /// What one MS2 spectrum says about its fragmentation and analyzer.
  enum class Fragmentation : int { Unknown = 0, Beam, Resonance };
  /// Counts one MS2 into @p meta: @p frag from its activation methods (or
  /// its filter string's @hcd/@cid token when they say nothing), and the
  /// ITMS/FTMS prefix of @p filter (empty: none).
  void addFragmentation(RunMeta& meta, Fragmentation frag, std::string_view filter);
  /// The @<method> tokens of a Thermo filter string: hcd is Beam; cid and
  /// pqd are Resonance (hcd wins when both appear).
  Fragmentation fragmentationFromFilter(std::string_view filter);
  // ---- end 1.12 D ----

  struct DigestSettings
  {
    double window = 0.008;
    int tag_min = 100;
    double background_share = 0.05;
    int silac_min = 50;
    bool low_resolution = false;               ///< fragment tolerance in Da
    std::string models = "shipped", background = "shipped_human";
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
    /// Any of the above is on: digestRows() writes the v2 rows.
    bool chemV2() const
    {
      return models_version != "shipped" || detection || flank2 || min_confidence > 0.0 || calibration.loaded;
    }
    // ---- end 1.12 D ----
  };

  // ---- 1.12 D: instrument class (#3c) ----
  /// The detection class of a run (kInstrumentClasses). Detection is a
  /// property of the MS2 analyzer and the fragmentation, not of the
  /// instrument's name:
  ///   - timstof when the timstof or ion_counts no-call rule of -digest_out
  ///     would read "yes";
  ///   - orbitrap_hcd for an Orbitrap-family run (the name or model names
  ///     Orbitrap, Q Exactive, Exploris, Astral, Lumos, Fusion, Eclipse or
  ///     Ascend, or the run header lists an Orbitrap analyzer) whose MS2 are
  ///     mostly beam-type CID (HCD) and not mostly read in the ion trap (ITMS
  ///     filter strings). Without any activation information, only the
  ///     HCD-only families (Q Exactive, Exploris, Astral) or a header with an
  ///     Orbitrap and no ion-trap analyzer count;
  ///   - other otherwise: an LTQ Orbitrap or Velos run with ion-trap CID MS2
  ///     is other, not orbitrap_hcd.
  std::string instrumentClass(const RunMeta& meta);
  // ---- end 1.12 D ----

  /// Python statistics.median; NaN for none.
  double median(std::vector<double> v);

  /// The -digest_out rows after @p run.
  std::vector<Row> digestRows(const TerminusCounter& tc, const ModelTable& table, const RunMeta& meta,
                              const DigestSettings& s);
  /// The -label_out rows after @p run.
  std::vector<Row> labelRows(const TerminusCounter& tc, const DigestSettings& s);

  /// The C-terminal K/R share of the tag ends, labelled K and R+10 included:
  /// the -digest_out row share.kr (res() / tot() summed over the K and R keys
  /// in residueKeys() order). Needs tot() > 0.
  double krShare(const TerminusCounter& tc);

  // ---- 1.13 digqual (backlog 23): digestion quality ----------------------
  //
  // Missed-cleavage and non-specific-end measurements for one enzyme (a model
  // of the table), from the tag ends alone; see doc/DESIGN-digest.md,
  // "Digestion quality". Written by -digest_quality after the 1.12 rows.

  /// The measurements at one cleaving end of the enzyme's model.
  struct QualityEnd
  {
    char end = 'C';                   ///< 'C' (P1) or 'N' (P1')
    std::vector<int> sites;           ///< kAAs indices whose model probability is above the background's
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

  struct Quality
  {
    std::string enzyme;               ///< the model measured ("-" when none)
    std::string basis;                ///< "named" (-digest_quality <model>) or "call" (auto)
    bool measured = false;            ///< at least one end measured
    std::string reason;               ///< not measured: low_resolution, no_call, no_specific_end, few_tags
    std::vector<QualityEnd> ends;     ///< the model's non-background ends, C first
  };

  /// The site residues of one model end: residues with p(a) > bg(a), both
  /// normalised over the 19 residues. Empty for a background end.
  std::vector<int> siteResidues(const Dist& model_end, const Dist& bg);
  /// The background share s in [0, 1] that maximises sum_a k_a ln((1 - s) p_a
  /// + s b_a) (p, b normalised); bisection on the derivative (concave in s).
  double mixtureShareMle(const std::array<std::uint64_t, kNumAA>& k, const Dist& p, const Dist& b);
  /// The quality of @p model (a model of @p table, whose background is used)
  /// over the counts of @p tc; an end is measured with >= @p tag_min ends,
  /// and its missed-cleavage ratios (mc_site_share, mc_retention) need
  /// >= @p tag_min specific ends as well (mc_measured). @p basis is written
  /// as given.
  Quality digestQuality(const TerminusCounter& tc, const ModelTable& table, const Model& model,
                        const std::string& basis, int tag_min);
  /// The quality written for -digest_quality @p option (a model name of
  /// @p table, or "auto") on a report whose 1.12 rows are @p report: auto
  /// takes the model of the rows `call status` = call and `call model`
  /// (basis "call"; no call or a model not in @p table gives reason no_call).
  /// A Da tolerance (@p s.low_resolution) gives reason low_resolution and no
  /// end, whatever the enzyme.
  Quality reportQuality(const TerminusCounter& tc, const ModelTable& table, const std::vector<Row>& report,
                        const std::string& option, const DigestSettings& s);
  /// The quality section rows (section "quality"), for a measured or an
  /// unmeasured result.
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
  //   - no_call few_tags: fewer than kLabelTagMin C-terminal tag ends
  //     (tot(), prose-auto's TAG_MIN);
  //   - an isobaric label (labelKeys() order) when its count reaches
  //     kLabelMinShare of the filtered tags AND kLabelBackgroundFold times
  //     max(its +0.5 Da background, 1);
  //   - SILAC (Lys8/Arg10) when the heavy K8 and R10 shares are both
  //     >= kHeavyMin, the K/R share rounded to 3 decimals (as prose-auto
  //     compares it) is >= kKrTryptic and the K- and R-terminal ends are each
  //     >= DigestSettings::silac_min (50, prose-auto's SILAC_MIN_TAGS);
  //     strong when both shares are >= kHeavyStrong;
  //   - every label that passes is listed (isobaric first); none is
  //     label-free.
  inline constexpr std::uint64_t kLabelTagMin = 175;
  inline constexpr double kLabelMinShare = 0.01, kLabelBackgroundFold = 20.0;
  inline constexpr double kHeavyMin = 0.2, kHeavyStrong = 0.3, kKrTryptic = 0.8;

  struct LabelCall
  {
    bool called = false;
    std::string reason;               ///< no call: low_resolution or few_tags
    std::vector<std::string> labels;  ///< labelKeys() names that passed, then "SILAC"
    bool isobaric = false;            ///< an isobaric label passed
    bool silac = false, silac_strong = false;
    double kr_rounded = 0.0;          ///< krShare() rounded to 3 decimals; 0 when tot() is 0
  };

  /// The label call over the tag-end counts (see above).
  LabelCall labelCall(const TerminusCounter& tc, const DigestSettings& s);
  /// The label_call rows -label_out appends after labelRows(): status, label,
  /// basis, silac and reason, in that order.
  std::vector<Row> labelCallRows(const LabelCall& c, const TerminusCounter& tc, const DigestSettings& s);

  struct GapSettings
  {
    double window = 0.02;  ///< the window in use (ppm or Da run)
    std::uint64_t min_spectra = 20, min_bin = 2;
    double min_share = 0.005;
    int max_mods = 3, top = 5;
    double silac_share = 0.08;
    std::uint64_t silac_min = 500;
  };

  /// The gap result every gap reader shares: detectGaps() over the rows of
  /// @p rows with at least @p s.min_bin spectra, with @p s's window and
  /// thresholds. GapPeak::members index @p rows itself (unfiltered).
  GapResult gapResult(const std::vector<GapRow>& rows, const std::vector<GapMod>& mods,
                      const std::vector<Combo>& combos, const GapSettings& s);

  /// The -massgap_out rows: @p rows / @p keys are every -delta_out row (its
  /// gap as parsed and as printed), @p cys the Cys alkylation candidates.
  std::vector<Row> massgapRows(const std::vector<GapRow>& rows, const std::vector<std::string>& keys,
                               const std::vector<GapMod>& mods, const std::vector<Combo>& combos,
                               const std::vector<GapMod>& cys, const GapSettings& s);
  /// The same, with @p res = gapResult(rows, mods, combos, s) computed by the
  /// caller, so the report and other gap readers share one result.
  std::vector<Row> massgapRows(const std::vector<GapRow>& rows, const std::vector<std::string>& keys,
                               const std::vector<GapMod>& mods, const std::vector<GapMod>& cys,
                               const GapSettings& s, const GapResult& res);
}
