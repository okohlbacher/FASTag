// Database-free label discovery (-label_discovery_out, format 1).
//
// Finds every terminal or lysine mass offset the flanks of a run's tags
// carry, known or not, without a protein database, explains each one with
// residues, the known labels or Unimod (OpenMS ModificationsDB), and makes a
// provisional run-level call. Design: doc/DESIGN-label-discovery.md (the
// section numbers below are its sections); report format:
// doc/LABEL-DISCOVERY-REPORT.md.
//
// The flanks are read in the two raw channels FASTagger writes, n =
// nterm_mass and c = cterm_mass (section 3). Every hypothesis (a label at the
// N-terminus, at K, at R, or at the peptide C-terminus) is turned into the
// masses it predicts in each channel, its "images". The unlabelled flanks of
// every residue composition up to max_flank, in all four reading/terminus
// combinations and with the precursor 13C picks, are the null image set; a
// label image within the channel window of a null image is "confounded",
// otherwise "clean". Only clean evidence can call a label.
//
// Opt-in. With -label_discovery_out unset nothing here runs; with it set no
// other output changes (the collector reads the tag values -label_out reads,
// through its own counter).
//
// Thresholds are priors; the evidence bar of the call (Settings::tier_min_*)
// was set on the DEV half of evaluation 2 only (design section 16).
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#pragma once

#include "Digest.h"

#include <array>
#include <cstdint>
#include <limits>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace FASTag::LabelDiscovery
{
  inline constexpr int kFormat = 5;
  inline constexpr double kBin = 0.0005;          ///< histogram bin width (Da)
  inline constexpr double kC13 = 1.0033548378;    ///< 13C - 12C
  inline constexpr double kH2O = Digest::kH2O;
  inline constexpr double kCO = 27.994915, kNH3 = 17.026549;  ///< ion-series satellites (a ions, ammonia loss)
  inline constexpr double kMassK = 128.09496, kMassR = 156.10111;  ///< the K and R site anchors (bare residues)
  inline constexpr double kScanLow = -50.0;       ///< lowest offset of the site scan (section 7)
  inline constexpr double kMinImageMass = 1.0;    ///< images below this are dropped (the clamp's neighbourhood)
  inline constexpr std::size_t kMaxPeaks = 200;   ///< channel peaks written per channel
  inline constexpr std::size_t kMaxSiteCandidates = 200;  ///< site candidates evaluated per site
  inline constexpr std::uint64_t kMinReference = 200;     ///< reference deviations a window estimate needs
  inline constexpr std::uint64_t kMinCalibrationReference = 20;  ///< ... a calibration offset needs
  /// Reference deviations calibrate only when they form a peak: at least
  /// kReferencePeakShare of them within kReferencePeakHalfWidth (Da) of their
  /// median (uniform chance values over the 0.02 Da window give 25 %).
  inline constexpr double kReferencePeakHalfWidth = 0.005, kReferencePeakShare = 0.6;
  /// An offset beyond this (ppm) is chance references, not a calibration.
  inline constexpr double kMaxCalibrationPpm = 30.0;
  inline constexpr std::uint64_t kSlopeReference = 1000;  ///< ... and a linear calibration term
  inline constexpr double kSlopeSpan = 150.0;             ///< Da the references must span for the linear term
  inline constexpr std::uint64_t kPerReferenceMin = 50;   ///< values per reference mass in the spread term
  inline constexpr double kRefWindow = 0.02;              ///< reference deviations are taken within this (Da)
  inline constexpr double kWindowMin = 0.0015, kWindowMax = 0.02;
  inline constexpr double kDefaultWindowN = 0.008, kDefaultWindowC = 0.004;
  /// Largest -label_discovery_max_flank. The null image set grows faster
  /// than linearly with it (composition bins, 11 intervals of 24 bytes each):
  /// about 5 MB at the default 700 Da, 25 MB at 1000 Da and 130 MB at 1500 Da,
  /// but 315 MB at 2000 Da and several GB at 5000 Da. Measured peak RSS of a
  /// fixture run: 145 MB at 700 Da, 704 MB at 1500 Da (design section 11).
  inline constexpr double kMaxFlankLimit = 1500.0;
  /// Largest -label_discovery_window_n / _window_c (Da). The background is read
  /// at half-integer offsets (+-(k + 0.5) Da) and must stay outside the
  /// window, and the local-maximum scans cost O(bins x window / kBin).
  inline constexpr double kWindowOptionMax = 0.05;
  /// Calibration allowance (ppm) of the near-isobaric rule when a channel
  /// has no calibration: a TOF or uncalibrated Orbitrap offset (section 5).
  inline constexpr double kUnknownCalibrationPpm = 5.0;

  // ---- per-tag records (section 4) -----------------------------------------

  enum : std::uint8_t
  {
    kFirstK = 1,
    kLastK = 2,
    kFirstR = 4,
    kLastR = 8,
  };
  /// One counted b/y tag: its flanks n and c as written, the precursor
  /// neutral mass M, the spectrum's index in scan order, the tag's place in
  /// the spectrum's tag list and the K/R flags of its first and last residue.
  struct Record
  {
    float n = 0, c = 0, M = 0;
    std::uint32_t spectrum = 0;
    std::uint16_t order = 0;
    std::uint8_t flags = 0;
    std::uint8_t pad = 0;
  };
  static_assert(sizeof(Record) == 20, "Record is 20 bytes");

  /// The K/R flags of a tag sequence without modification annotations.
  std::uint8_t residueFlags(std::string_view base_seq);

  /// A label whose -label_out-compatible counts ld_known writes (section 10).
  struct KnownSet
  {
    std::string name;
    double mass = 0;
  };
  /// ld_known's images per KnownSet, in this order.
  inline constexpr int kKnownImages = 5;
  inline constexpr std::array<const char*, kKnownImages> kKnownImageNames = {"N0f", "N0r", "K0f", "K1f", "K1r"};

  /// The per-thread collector the tagging loop feeds (one add() per counted
  /// tag). Merged in thread order; records are put in scan order afterwards
  /// (finish()), so nothing depends on the thread count.
  class Collector
  {
  public:
    Collector() = default;
    /// The known sets and the window of ld_known (-digest_window).
    void configure(const std::vector<KnownSet>& known, double known_window);
    /// One counted tag: every written row of the selected hypothesis that is
    /// ungapped with E <= 1, as -label_out counts it. A c/z tag (@p cz) is
    /// counted in ld_known (as in -label_out) and in tags_excluded_cz, never
    /// binned.
    void add(double nterm, double cterm, double precursor_mass, std::uint32_t spectrum, std::uint16_t order,
             std::string_view base_seq, bool cz);
    /// Appends @p o (call in thread order).
    void merge(const Collector& o);
    /// Puts the records in scan order (stable: a spectrum's tags keep their order).
    void finish();

    std::vector<Record> records;
    std::uint64_t cz = 0;
    std::vector<KnownSet> known;
    double known_window = 0.008;
    /// Per known set and image: tags and distinct spectra.
    std::vector<std::array<std::uint64_t, kKnownImages>> known_tags, known_spectra;

  private:
    std::vector<std::array<std::uint64_t, kKnownImages>> last_;  ///< last spectrum counted + 1 (0: none)
  };

  // ---- settings ------------------------------------------------------------

  /// One entry of the run alphabet S1: a residue (I folded into L), with the
  /// run's fixed modification applied, or a variable-modification alternative.
  struct Residue
  {
    std::string name;  ///< "A", "C", "M[Oxidation]"
    double mass = 0;
    char letter = 0;
  };
  struct AlphabetMod
  {
    char residue = 0;
    double delta = 0;
    std::string name;
    bool variable = false;
  };
  /// The run alphabet: the 19 residues of Digest::kAAs (C unmodified,
  /// 103.00919), the fixed residue modifications applied, then one entry per
  /// variable modification.
  std::vector<Residue> runAlphabet(const std::vector<AlphabetMod>& mods);

  struct Settings
  {
    double max_flank = 700.0;
    int depth = 2;
    std::uint64_t min_spectra = 20;
    double min_share = 0.005;
    double window_n = 0.0, window_c = 0.0;  ///< 0: estimate from the run
    int unimod_top = 3;
    // priors of the call (sections 6, 9)
    double min_fold = 20.0, max_log10_q = -2.0, call_min_share = 0.01;
    /// A called label needs this share of the parsimony of the strongest
    /// called one and of its site's delta 0 control (prior).
    double min_relative_parsimony = 0.1;
    /// The evidence bar of a call (evaluation 2, fitted on the DEV half of the
    /// 256-run evaluation only), per tier of the candidate's explanation:
    /// 0 a known label (TMT, TMTpro, iTRAQ4/8, SILAC Lys4/6/8 and Arg6/10,
    /// dimethyl light/medium/heavy), 1 a Unimod label (N-terminal or K/R
    /// entry classed isotopic label or chemical derivative, or a curated
    /// derivatisation label), 2 anything else (an unknown mass, other Unimod
    /// entries). relative share = spectra_clean / (spectra_clean + the site's
    /// delta 0 control spectra); clean share = spectra_clean / counted spectra;
    /// ladder = ladder_clean (residues with a clean ladder image).
    double tier_min_relative[3] = {0.15, 0.35, 0.5};
    double tier_min_clean_share[3] = {0.02, 0.1, 0.2};
    int tier_min_ladder[3] = {0, 3, 5};
    std::uint64_t min_counted_spectra = 175;  ///< Digest::kLabelTagMin
    bool low_resolution = false;              ///< fragment tolerance in Da
    bool fasta_filtered = false;              ///< -fasta: only database matches are written
    double fixed_nterm = 0.0, fixed_cterm = 0.0;   ///< the run's fixed terminal modifications
    std::string fixed_nterm_name, fixed_cterm_name;
    std::vector<KnownSet> fixed_k;           ///< the run's fixed K modifications (delta)
    std::vector<Residue> alphabet;           ///< S1; runAlphabet({}) when empty
    double known_window = 0.008;             ///< -digest_window, for ld_known
    /// The known sets of ld_known: Digest::labelKeys(), then the fixed
    /// N-terminal modification, then the fixed K modifications.
    std::vector<KnownSet> knownSets() const;
  };

  // ---- Unimod adaptor (section 8) -------------------------------------------

  enum class Term : int { Anywhere = 0, CTerm = 1, NTerm = 2, ProteinCTerm = 3, ProteinNTerm = 4 };
  struct UnimodEntry
  {
    std::string id;       ///< getId(): "Dimethyl"
    std::string full_id;  ///< getFullId(): "Dimethyl (N-term)"
    std::string formula;  ///< getDiffFormula().toString()
    int record_id = 0;    ///< getUniModRecordId()
    double mass = 0;      ///< getDiffMonoMass()
    char origin = 'X';    ///< getOrigin(); 'X' = any residue
    Term term = Term::Anywhere;
    int classification = 0;  ///< ResidueModification::SourceClassification
  };
  /// The searched entries, ascending by mass (then record id, full id).
  struct UnimodTable
  {
    std::vector<UnimodEntry> entries;
    /// Built once from OpenMS ModificationsDB: every entry with a Unimod
    /// record id. Single-threaded.
    static UnimodTable fromModificationsDB();
    void sort();
  };
  // The SourceClassification values the group priority reads.
  inline constexpr int kClassArtifact = 0, kClassChemicalDerivative = 5, kClassIsotopicLabel = 6;

  // ---- calibration and windows (section 5) ----------------------------------

  struct Calibration
  {
    std::uint64_t n_ref_c = 0, n_ref_n = 0;
    std::uint64_t n_ref_n_all = 0;  ///< channel n deviations against every residue (the window's spread)
    bool estimated_c = false, estimated_n = false;  ///< enough references (kMinReference)
    double ppm_c = 0, ppm_n = 0;     ///< median ppm offsets
    bool slope = false;              ///< linear term in mass fitted for channel c
    double slope_c = 0;              ///< ppm per Da (Theil-Sen over the per-reference medians)
    double intercept_c = 0;          ///< ppm at mass 0 with the linear term
    double unc_ppm_c = -1, unc_ppm_n = -1;  ///< -1: unknown (no references)
    double sigma_c = 0;              ///< Da, 1.4826 MAD of the corrected c deviations
    double sigma_ppm_n = 0;          ///< 1.4826 MAD of the corrected n deviations in ppm of M
    /// ppm offset of channel c at mass @p m.
    double ppmC(double m) const { return slope ? intercept_c + slope_c * m : ppm_c; }
  };
  /// Reference deviations (nearest one-residue image within kRefWindow: c =
  /// m_r over the alphabet and bare K and R; n = m_r + H2O) give the
  /// per-channel calibration. The channel n offset is taken from r = K or R
  /// only (the tryptic C-terminal residue), its spread from every r.
  Calibration calibrate(const std::vector<Record>& records, const std::vector<Residue>& alphabet);

  struct Windows
  {
    double w_c = kDefaultWindowC;
    double n_flat = 0;          ///< > 0: a flat n window (option or default), else w_n(M)
    double sigma_ppm_n = 0;
    double w_n_hist = kDefaultWindowN;  ///< the histogram's n window: w_n at the 90th percentile of M
    std::string source_c = "default", source_n = "default";
    double m_q10 = 0, m_q50 = 0, m_q90 = 0;
    /// The n window of a tag with precursor mass @p M.
    double wn(double M) const;
  };
  Windows estimateWindows(const std::vector<Record>& records, const Calibration& cal, const Settings& s);

  // ---- statistics (section 6) -----------------------------------------------

  /// log10 of the Poisson upper tail P(X >= k | lambda); 0 for k = 0.
  double log10PoissonUpper(std::uint64_t k, double lambda);
  /// min(0, max(-300, log10p + log10(n_tested))).
  double log10Q(double log10p, double n_tested);

  // ---- null image set (section 7) -------------------------------------------

  /// Every residue composition S (|S| >= 1) of the alphabet up to a mass, as
  /// the exact lowest and highest composition mass per 0.0005 Da bin.
  struct Compositions
  {
    std::vector<double> lo, hi;     ///< ascending
    std::vector<std::uint8_t> nres; ///< fewest residues of a composition in the bin
    std::size_t size() const { return lo.size(); }
  };
  Compositions compositions(const std::vector<Residue>& alphabet, double max_mass);

  /// One null reading (section 7): where an unlabelled flank of residue
  /// composition S lands in a channel, from FASTagger's flank formula
  /// (section 3: c = low peak neutral - H2O, n = M - high peak neutral). The
  /// predicted mass is m(S) + shift.
  ///   c, forward (low peak y = S + H2O):       y, y - NH3, y - H2O
  ///   c, reversed (low peak b = S):            b, b - NH3, b - H2O, a = b - CO, a - NH3
  ///   n, forward (high peak y_high = M - S):   y, y - NH3, y - H2O
  ///   n, reversed (high peak b = M - S - H2O): b, b - NH3, b - H2O
  ///   n, each of these with the precursor picked k = 1, 2 13C peaks high (+k 13C)
  /// The precursor family (S empty, @c precursor): a high peak that is the
  /// precursor less NH3 or H2O (forward: n = NH3, H2O) or b_n = M - H2O less
  /// nothing, NH3 or H2O (reversed: n = H2O, H2O + NH3, 2 H2O), each read at
  /// k = -1, 0, 1, 2 13C (its own 13C peak as the high peak, or a 13C pick of
  /// the precursor). A reading that coincides with another (y - H2O and b in
  /// channel c) is listed once.
  struct NullReading
  {
    char ch;
    double shift;
    std::string name;
    bool precursor;  ///< S empty: the mass is the shift itself
  };
  /// The readings, indexed by NullImages::Interval::reading. Index 0 is
  /// channel c, m(S) exactly (the composition mass itself).
  const std::vector<NullReading>& nullReadings();
  inline constexpr std::uint8_t kReadingAccepted = 255;  ///< an accepted hypothesis' image

  /// Null channel images: intervals of predicted masses per channel.
  struct NullImages
  {
    struct Interval
    {
      double lo, hi;
      /// reading: an index of nullReadings(), or kReadingAccepted
      std::uint8_t nres, reading;
      int owner = -1;              ///< accepted hypothesis (reading 7), else -1
    };
    std::vector<Interval> n, c;  ///< sorted by lo
    double max_len = kBin;       ///< longest interval
    /// A null image of channel @p ch ('n' or 'c') within @p w of @p v.
    bool near(char ch, double v, double w) const;
    const Interval* nearest(char ch, double v, double w) const;
    void add(char ch, double lo, double hi, std::uint8_t nres, std::uint8_t reading, int owner = -1);
    void sortAll();
  };
  /// Every nullReadings() reading of every composition, and the precursor
  /// family once; images above @p max_mass are left out.
  NullImages nullImages(const Compositions& comps, double max_mass = std::numeric_limits<double>::infinity());
  /// Composition masses the null set needs for flanks up to @p max_flank: the
  /// largest negative c shift (a - NH3 = S - H2O - CO - NH3) still reaches it.
  double compositionLimit(double max_flank);

  // ---- images (section 3) ---------------------------------------------------

  struct Image
  {
    char ch = 'n';         ///< channel 'n' or 'c'
    double mass = 0;
    std::string name;      ///< N0f, N1rA, N2fAG, K1f, K2rA, R1f, ...
    int residue = -1;      ///< alphabet index of a ladder image (N1, K2, R2), else -1
    int nres = 0;          ///< residues in S
    bool zero = false;     ///< zero-residue image (N0f, N0r, K0f)
    std::uint8_t need = 0; ///< flag the tag must have (kLastK for K0f)
  };
  /// The images of a modification of @p delta at @p site ('N', 'K', 'R'; 'C'
  /// = K and R images without K0f, plus C0f/C0r) with |S| <= @p max_s (0, 1
  /// or 2), dropped when outside [kMinImageMass, max_flank].
  std::vector<Image> imagesFor(char site, double delta, const std::vector<Residue>& alphabet, int max_s,
                               double max_flank);

  // ---- the analysis ---------------------------------------------------------

  struct Peak
  {
    char ch = 'n';
    double mass = 0, sigma = 0, se = 0;
    std::uint64_t spectra = 0, tags = 0, hits = 0;
    double background = 0, fold = 0, log10_q = 0, share_adjacent_k = 0;
    std::string cls, explanation, alternatives;
  };

  struct SiteCandidate
  {
    char site = 'N';
    bool control = false;  ///< the delta 0 row
    double delta = 0, sigma = 0, se = 0;
    std::uint64_t spectra = 0, spectra_clean = 0, image_hits = 0, clean_hits = 0;
    std::uint64_t support_c = 0, support_n = 0;
    double share = 0;
    int ladder_clean = 0, ladder_confounded = 0;
    bool null_coincident = false;
    std::string null_composition;  ///< the coincident composition, for the alternatives
    bool zero_clean = false;       ///< a clean zero-residue image with >= min_spectra spectra
    std::string images;
    double background = 0, null_expectation = 0, fold = 0, log10_q = 0;
    std::string cls, explanation, alternatives, label;
    double completeness = -1;  ///< -1: not computed
    bool called = false;
    int tier = 2;               ///< evidence tier of the explanation (Settings::tier_min_*), -1 for the controls
    double relative_share = 0;  ///< spectra_clean / (spectra_clean + the site's control spectra)
    double clean_share = 0;     ///< spectra_clean / counted spectra
    /// Ranking key of the call: per spectrum 2^-k, k the fewest residues of
    /// a clean image supporting it, summed (zero-residue images weigh 1).
    double parsimony = 0;
    double est_c = 0;          ///< delta from the clean c images (when support_c > 0)
    bool has_est_c = false;
  };

  /// Reporter ions of the isobaric labels in the high-resolution MS2 and MS3
  /// scans of the run (format 2). The reporters decide the label family, the
  /// tag flanks the variant. Thresholds were set on development runs only.
  struct ReporterCounter
  {
    std::uint64_t scans = 0, covered = 0;  // covered: scans with a peak in 112-137 m/z
                     ///< non-ion-trap MS2/MS3 scans examined
    std::uint64_t ms2 = 0, ms2_ion_trap = 0;  ///< MS2 scans seen, and those from an ion trap (filter string ITMS)
    /// Scans with >= 2 TMT channels (126-131), >= 2 iTRAQ4 channels (114-117),
    /// >= 1 iTRAQ8-only channel (113, 118, 119, 121), >= 2 TMTpro-only
    /// channels (132-135); *_decoy: the same at all channels + and - 0.0170 Da
    /// (two decoy counts per scan).
    std::uint64_t tmt = 0, itraq4 = 0, itraq8 = 0, tmtpro = 0;
    std::uint64_t tmt_decoy = 0, itraq4_decoy = 0, itraq8_decoy = 0, tmtpro_decoy = 0;
    /// One non-ion-trap MSn scan: its peaks (m/z, intensity) between 112 and
    /// 137 m/z in any order, and the base peak intensity of the whole scan.
    void add(const std::vector<std::pair<double, double>>& low, double base_peak);
    void merge(const ReporterCounter& o);
    /// Fraction of scans with the reporters minus the decoy fraction.
    double excess(std::uint64_t hits, std::uint64_t decoy) const
    {
      return scans == 0 ? 0.0 : (static_cast<double>(hits) - 0.5 * static_cast<double>(decoy)) / static_cast<double>(scans);
    }
    bool ionTrapMs2() const { return ms2 > 0 && 2 * ms2_ion_trap > ms2; }
  };
  /// `unknown` (below 200 scans), `tmt`, `itraq4`, `itraq8`, `none` (no
  /// isobaric label) or `unclear`.
  std::string reporterGate(const ReporterCounter& rc);

  /// SILAC from precursor pairs (format 3): the MS2 precursors (charge 2-4) of
  /// the run and how many have a partner of the same charge at +8.0142 Da
  /// (Lys8) and +10.0083 Da (Arg10) within 2 mDa and 9 s, against eight
  /// control spacings (the label masses shifted by whole Da, off the 13C
  /// isotope spacing). Needs no tags, so it also sees the heavy partner whose
  /// tags the site scan misses. Thresholds were set on development runs only.
  struct PairCounter
  {
    struct Precursor
    {
      double mz;
      float rt;  ///< seconds
      std::int8_t z;
    };
    std::vector<Precursor> precursors;
    void add(double rt_seconds, double mz, int charge);  ///< charges outside 2-4 are dropped
    void merge(PairCounter&& o);
    // filled by count()
    std::uint64_t lys8 = 0, arg10 = 0;
    /// The largest count at one of the other label spacings: +6.0201 (Lys6,
    /// Arg6), +3.9891 / +3.9881 (Lys4 to Lys8, Arg6 to Arg10) and the dimethyl
    /// spacings per labelled site +4.0251 (also Lys4), +6.0318, +6.0377,
    /// +8.0444, +4.0193.
    std::uint64_t other = 0;
    /// Dimethyl (format 5): the largest, over the five dimethyl spacings, of
    /// the smaller count at the spacing (one labelled site) and at twice the
    /// spacing (N-terminus and one Lys).
    std::uint64_t dimethyl2 = 0;
    std::uint64_t silac_top = 0;  ///< the largest count at a SILAC spacing (Lys8, Arg10, +6.0201, medium to heavy)
    double control = 0;  ///< median of the eight control counts
    void count();
    /// count / (control + 5): the excess of a label spacing over the controls.
    double ratio(std::uint64_t pairs) const { return static_cast<double>(pairs) / (control + 5.0); }
    /// Both Lys8 and Arg10 have >= 30 pairs and a ratio >= 2.
    bool silac() const;
    /// dimethyl2 has >= 30 pairs and a ratio >= 2 and exceeds silac_top
    /// (SILAC with Lys4 shows +4.0251 and twice that as well).
    bool dimethyl() const;
    /// Any label spacing has >= 30 pairs and a ratio >= 2.
    bool anyLabel() const;
  };

  struct Analysis
  {
    // ld_count
    std::uint64_t spectra_counted = 0, tags_counted = 0, tags_excluded_cz = 0;
    std::uint64_t clamped_n = 0, clamped_c = 0, above_max_n = 0, above_max_c = 0;
    // ld_run
    Calibration cal;
    Windows win;
    std::size_t null_compositions = 0, unimod_entries = 0;
    bool analysed = false;  ///< false on low_resolution / cz_only
    std::vector<Peak> peaks_n, peaks_c;
    std::vector<SiteCandidate> sites;  ///< per site N, K, R, C: the control first, then the ranked candidates
    // ld_call
    std::string status = "no_call", labels = "-", call_sites = "-", reason = "-";
    std::string basis = "site_scan";  ///< `reporter_ions` / `precursor_pairs` when applyReporters() / applyPairs() made the call
    // ld_reporter
    ReporterCounter reporters;
    std::string reporter_gate = "unknown";
    // ld_pair
    PairCounter pairs;
    // ld_known
    std::vector<KnownSet> known;
    std::vector<std::array<std::uint64_t, kKnownImages>> known_tags, known_spectra;
  };

  /// The whole analysis over finished (scan-ordered) collector records.
  Analysis analyze(const Collector& col, const Settings& s, const UnimodTable& unimod);

  /// The reporter-ion gate on the finished call: a TMT or iTRAQ gate keeps a
  /// call of that family and otherwise replaces the call by the family's
  /// label (TMTpro when the TMTpro-only reporters reach half the TMT excess,
  /// format 5; else the variant from the N-terminal candidates; sites `-`
  /// when none fits); gate `none` removes isobaric labels from the call; a no call on a
  /// run of ion-trap MS2 scans gets the reason `low_resolution_ms2`.
  void applyReporters(Analysis& a, const ReporterCounter& rc);

  /// Counts the pairs of @p pc (sorts it) and, when they show SILAC, replaces
  /// a label-free call or a no call by `K:Lys8+R:Arg10` (basis
  /// `precursor_pairs`); a call of SILAC labels only gains `K:Lys8` and
  /// `R:Arg10` where it lacks them (basis `+precursor_pairs` appended, format
  /// 4). Any other label call stays. Format 5: pairs at a dimethyl spacing
  /// and at twice that spacing replace a label-free call or a no call by
  /// `Dimethyl`, and the label-free call by absence is also made on a run of
  /// ion-trap MS2 scans without a reporter gate. Call after applyReporters().
  void applyPairs(Analysis& a, PairCounter pc);

  /// The report rows after the shared run rows: ld_run, ld_count, ld_peak,
  /// ld_site, ld_known, ld_reporter, ld_pair, ld_call.
  std::vector<Digest::Row> reportRows(const Analysis& a, const Settings& s);
}
