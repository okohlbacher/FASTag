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

  /// Counts over the filtered tags (gapped == 0, evalue <= 1), added one tag
  /// at a time. "Near m" below means within [m - w, m + w], w the window.
  class TerminusCounter
  {
  public:
    explicit TerminusCounter(double window = 0.008) : w_(window) {}

    /// One filtered tag: its flanking masses and its sequence without
    /// modification annotations.
    void add(double nterm, double cterm, std::string_view seq);
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
    bool near_(double v, double m) const { return v >= m - w_ && v <= m + w_; }
    double w_;
  };

  // ---- model table ------------------------------------------------------

  using Dist = std::array<double, kNumAA>;

  struct Model
  {
    std::string name, cls;  ///< cls: the table's 'class' column ('class' is a C++ keyword)
    Dist c{}, n{};
    bool c_bg = true, n_bg = true;  ///< that end is the background
  };

  struct ModelTable
  {
    std::vector<std::string> header;  ///< the '#' lines, without '#'
    std::vector<Model> models;        ///< in first-appearance order
    bool has_bg = false;
    Dist bg_c{}, bg_n{};
  };

  /// Reads a model table (columns model, class, end, residue, freq; '#' lines
  /// are its header). Rows with model "background" are the mixing component
  /// and must cover all 19 residues at both ends; residue "*" sets that end of
  /// a model to the background, as does an end without rows. Returns false
  /// with @p err on a malformed table.
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
  };

  struct DigestSettings
  {
    double window = 0.008;
    int tag_min = 100;
    double background_share = 0.05;
    int silac_min = 50;
    bool low_resolution = false;               ///< fragment tolerance in Da
    std::string models = "shipped", background = "shipped_human";
    bool background_pseudocount = false;       ///< one count added per residue of the FASTA
  };

  /// Python statistics.median; NaN for none.
  double median(std::vector<double> v);

  /// The -digest_out rows after @p run.
  std::vector<Row> digestRows(const TerminusCounter& tc, const ModelTable& table, const RunMeta& meta,
                              const DigestSettings& s);
  /// The -label_out rows after @p run.
  std::vector<Row> labelRows(const TerminusCounter& tc, const DigestSettings& s);

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
