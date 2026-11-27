// Run QC report (FASTag 1.16, -qc_out).
//
// A key/value report on one run, in the section/key/value/n/description
// format of -census_summary_out, after the shared `run` rows:
//
//   instrument  the instrument model, its serial number and the start of the
//               acquisition, as the input's run metadata states them (n/a
//               when it does not; MGF has none).
//   counts      spectra per MS level and analyser class (ITMS, FTMS, TOF,
//               other, unknown), from the Thermo filter string, else the
//               instrument configuration the scan references, else the run's
//               default configuration. Metadata only: MS1 is counted although
//               the fast mzML reader never decodes its peaks.
//   resolution  per analyser class and MS level: the value the file states
//               (mass resolving power, MS:1000800, or mass resolution,
//               MS:1000011, as OpenMS's readers give them), and the value
//               measured as m/z / FWHM on profile spectra read before any
//               centroiding, by m/z band; n/a when the class has centroids only.
//   charge      the precursor charge histogram of the MS2 spectra (0 = none
//               given).
//   reporters   isobaric reporter ions of OpenMS's kit channel tables (TMT
//               6/10/11/16/18, iTRAQ 4/8): per kit present, absent or not
//               assessable, the kits compatible with what was seen, the
//               one kit the label mass and the channels allow (reporter_kit)
//               and, per channel of the family seen, the MS2 that show it.
//   tag yield   the share of MS2 spectra with a reported tag at E <= 0.01, the
//               census's best tag (Census::bestTag).
//   redundancy  the share of MS2 spectra in clusters of size > 1: same charge,
//               precursor within 10 ppm, complete linkage with a retention
//               time span <= 60 s, ion mobility within 0.02 when both have
//               one, and a binned cosine >= 0.8 over >= 6 shared fragment bins
//               after the reporter, immonium and precursor peaks are removed;
//               and a tag-driven variant (same best tag instead of the cosine).
//
// Every field a metric reads is in ScanFacts (counts, resolution stated,
// charge, reporter assessability) or in the spectrum handed to the
// collector. A vendor reader supplies the same ScanFacts from its own tables
// and the same spectra, and gets the same report.
//
// Output does not depend on -threads: per-thread results are merged in input
// order and the clustering is a deterministic function of the records.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#pragma once

#include "Digest.h"

#include <OpenMS/KERNEL/MSSpectrum.h>
#include <OpenMS/METADATA/ExperimentalSettings.h>
#include <OpenMS/METADATA/MassAnalyzer.h>

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <map>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace FASTag::RunQC
{
  /// Version of the qc section; bumped when a key, its meaning or its order changes.
  /// 2: instrument_model, instrument_serial_number, start_timestamp.
  /// 3: reporter_kit, reporter_kit_candidates, reporter_family_evidence,
  ///    reporter_label_delta and the reporter_channel_<label> counts.
  inline constexpr int QC_VERSION = 3;

  // ---- run metadata ---------------------------------------------------------

  /// What the input states about its instrument and acquisition ("" = not stated).
  struct RunInfo
  {
    std::string model;       ///< the instrument model
    std::string serial;      ///< the instrument serial number
    std::string start_time;  ///< the acquisition start, ISO 8601
  };
  /**
    @brief The run metadata of @p es, as OpenMS's readers fill it.

    Model: Instrument::getName() (the PSI-MS model name, which the mzML,
    Thermo .raw and Bruker readers set); Instrument::getModel() (the vendor's
    string) when the name is empty or only a parent term such as "Thermo
    Fisher Scientific instrument model" and the vendor string is not empty. Serial number: the instrument's meta value
    "instrument serial number". Start: the meta value
    "mzml_start_time_stamp" (the stamp as written, with fractions and time
    zone), else getDateTime() when valid.

    @param[in] es The run's settings.
    @return The fields; "" for each one not stated.
  */
  RunInfo runInfoOf(const OpenMS::ExperimentalSettings& es);

  // ---- analyser classes ----------------------------------------------------

  /// The analyser class a spectrum was read out in.
  enum class Analyzer : std::uint8_t
  {
    ITMS,     ///< ion trap (linear or 3D)
    FTMS,     ///< Orbitrap or FT-ICR
    TOF,      ///< time of flight (incl. Astral)
    OTHER,    ///< any other named analyser (quadrupole, sector, ...)
    UNKNOWN,  ///< no filter string, no configuration naming an analyser
  };
  inline constexpr std::size_t ANALYZER_COUNT = 5;
  /// @brief The report name of @p a: ITMS, FTMS, TOF, other, unknown.
  /// @param[in] a The class.
  /// @return Its name.
  const char* analyzerName(Analyzer a);
  /**
    @brief The analyser class a Thermo filter string names.

    The first token: FTMS -> FTMS, ITMS -> ITMS, TOFMS and ASTMS -> TOF, any
    other ...MS token (TQMS, SQMS, SectorMS) -> other.

    @param[in] filter The filter string.
    @return The class; UNKNOWN when the string names none.
  */
  Analyzer analyzerFromFilter(std::string_view filter);
  /**
    @brief The analyser class of a PSI-MS mass analyser type name.

    "orbitrap", "fourier transform ion cyclotron resonance mass spectrometer"
    -> FTMS; any "... ion trap" -> ITMS; "time-of-flight" (and "astral") ->
    TOF; any other name -> other; "" -> unknown.

    @param[in] name The cvParam name (case is ignored).
    @return The class.
  */
  Analyzer analyzerFromName(std::string_view name);
  /// @brief The analyser class of an OpenMS analyser type.
  /// @param[in] t The type.
  /// @return The class; UNKNOWN for AnalyzerType::ANALYZERNULL.
  Analyzer analyzerFromType(OpenMS::MassAnalyzer::AnalyzerType t);

  /// Where a spectrum's analyser class came from.
  enum class Source : std::uint8_t
  {
    FILTER,  ///< the Thermo filter string
    CONFIG,  ///< the instrument configuration the scan references
    RUN,     ///< the run's default instrument configuration
    NONE,    ///< nothing named an analyser
  };
  inline constexpr std::size_t SOURCE_COUNT = 4;

  /// Analyser classes per instrument configuration (an mzML's head; a vendor
  /// source fills it from its own tables).
  struct InstrumentMap
  {
    std::map<std::string, Analyzer> by_config;  ///< instrumentConfiguration id -> class
    std::string default_config;                 ///< the run's defaultInstrumentConfigurationRef
    Analyzer run_default = Analyzer::UNKNOWN;   ///< class when no configuration matches
  };

  // ---- per-spectrum facts --------------------------------------------------

  /// What the report reads of one spectrum's metadata.
  struct ScanFacts
  {
    bool valid = false;                ///< the spectrum was read
    std::uint8_t ms_level = 0;         ///< MS level (0 = not given)
    Analyzer analyzer = Analyzer::UNKNOWN;
    Source source = Source::NONE;
    std::uint8_t type = 0;             ///< 0 unknown, 1 centroid, 2 profile (as stated)
    std::uint16_t n_precursors = 0;    ///< precursors (more than one in SPS-MS3)
    std::int16_t charge = 0;           ///< first precursor's charge, 0 = none given
    double precursor_mz = 0;           ///< first precursor's m/z, 0 = none
    double rt = 0;                     ///< retention time (s)
    float im = std::numeric_limits<float>::quiet_NaN();          ///< 1/K0 (V s/cm2), NaN = none
    float scan_low = std::numeric_limits<float>::quiet_NaN();    ///< lowest scan window m/z, NaN = none
    float stated_resolution = std::numeric_limits<float>::quiet_NaN();  ///< as the file states it, NaN = none
  };
  /**
    @brief The facts of @p s.

    Analyser: the filter string, else the acquisition meta value
    "instrument_configuration_ref" looked up in @p map, else the map's default
    configuration, else its run_default. Stated resolution: the meta value
    "mass resolving power", else "mass resolution" (positive, finite).

    @param[in] s The spectrum (peaks are not read).
    @param[in] map The run's instrument configurations.
    @return Its facts, valid.
  */
  ScanFacts factsOf(const OpenMS::MSSpectrum& s, const InstrumentMap& map);

  // ---- resolution ----------------------------------------------------------

  /// One measured peak: its m/z and m/z / FWHM.
  struct ResolutionPoint
  {
    double mz = 0;
    double resolution = 0;
  };
  /// The peak-quality rules of measureResolution().
  struct ResolutionRules
  {
    double min_signal_to_background = 10.0;  ///< apex over the median positive intensity
    int min_points = 3;                      ///< raw points with signal inside the FWHM
    double isolation_fwhm = 3.0;             ///< no neighbour this many FWHM away ...
    double neighbour_share = 0.1;            ///< ... at this share of the apex or more
    std::size_t max_peaks = 20;              ///< the most intense passing peaks kept
  };
  /**
    @brief Resolution measured on one profile spectrum.

    OpenMS's PeakPickerHiRes picks the peaks and reports each FWHM (absolute,
    report_FWHM). A peak counts only if its apex is at least
    min_signal_to_background times the median positive intensity, at least
    min_points raw points with signal lie inside its FWHM (not undersampled),
    and no other picked peak of at least neighbour_share of its height lies
    within isolation_fwhm FWHM (no overlap or shoulder). Of those the
    max_peaks most intense are returned, in m/z order.

    @param[in] profile A profile spectrum (sorted or not).
    @param[in] rules The peak-quality rules.
    @return The measured peaks; empty for a centroided or empty spectrum.
  */
  std::vector<ResolutionPoint> measureResolution(const OpenMS::MSSpectrum& profile,
                                                 const ResolutionRules& rules = {});
  /// Lower edges of the m/z bands resolution is reported in (the last is open).
  inline constexpr std::array<double, 5> BAND_LOW = {0.0, 400.0, 800.0, 1200.0, 2000.0};
  /// @brief The band of @p mz (an index into BAND_LOW).
  /// @param[in] mz The m/z.
  /// @return The band.
  std::size_t bandOf(double mz);
  /// @brief The key part of band @p b: "mz0-400", ..., "mz2000+".
  /// @param[in] b The band.
  /// @return The name.
  std::string bandName(std::size_t b);
  /**
    @brief The spectra to measure resolution on, evenly spaced per class.

    Per (analyser class, MS level) at most @p per_class of the valid spectra
    whose type is profile or not stated (or any type with @p include_centroid),
    evenly spaced over that class's spectra in input order. Deterministic.

    @param[in] facts The facts of every input spectrum, by index.
    @param[in] per_class The most spectra per class.
    @param[in] include_centroid Also spectra stated centroid: for a reader that
               gave the tagging loop vendor-centroided scans and can reread
               them as acquired (Thermo .raw, Representation::PROFILE).
    @return Spectrum indices, ascending.
  */
  std::vector<std::size_t> profileSamples(const std::vector<ScanFacts>& facts, std::size_t per_class,
                                          bool include_centroid = false);

  // ---- isobaric reporters --------------------------------------------------

  /// The reporter ions of OpenMS's kit channel tables.
  struct ReporterTable
  {
    /// Distinct reporter m/z (channels of several kits within 0.1 mDa are one).
    std::vector<double> mz;
    std::vector<std::string> label;      ///< e.g. "126", "127N", "113"
    std::vector<std::uint8_t> family;    ///< 0 = TMT, 1 = iTRAQ, per channel
    struct Kit
    {
      std::string name;                  ///< OpenMS method name, e.g. "tmt10plex"
      std::uint8_t family = 0;
      /// Bit mask over mz: the union of #patterns (every channel the kit can show).
      std::uint32_t channels = 0;
      /**
        The channel sets of the kit's reagent generations, each a bit mask over
        mz; the kit fits a run when one of them holds every observed channel.
        One per kit (OpenMS's table), except tmt6plex, which has two: the
        current sixplex 126/127N/128C/129N/130C/131 (OpenMS
        TMTSixPlexQuantitationMethod, MSnbase TMT6b) and the original reagent
        126/127C/128C/129C/130C/131 (Dayon et al. 2008; MSnbase TMT6; the
        127C/129C m/z of OpenMS's TMT10 table).
      */
      std::vector<std::uint32_t> patterns;
      /// The Digest::labelKeys() entry of the kit's label: TMT (229.162932 Da)
      /// for TMT 6/10/11, TMTpro (304.207146 Da) for TMTpro 16/18 and iTRAQ8
      /// (304.205, inside the label window), iTRAQ4 (144.102063 Da).
      std::uint8_t label = 0;
    };
    std::vector<Kit> kits;               ///< tmt6plex .. tmt18plex, itraq4plex, itraq8plex
    std::array<double, 2> family_low{}, family_high{};  ///< lowest/highest channel m/z per family
    std::array<std::uint32_t, 2> family_mask{};         ///< channels per family
    /// Built from OpenMS's TMT 6/10/11/16/18 and iTRAQ 4/8 methods.
    ReporterTable();
    /// @brief The family name: "TMT" or "iTRAQ".
    static const char* familyName(std::size_t f);
  };
  inline constexpr std::size_t FAMILY_COUNT = 2;
  /// Reporter match tolerance (ppm); the closest TMT pair is 6.3 mDa apart.
  inline constexpr double REPORTER_TOL_PPM = 20.0;
  /// A channel is seen when its most intense peak is this many times the
  /// spectrum's median positive peak intensity.
  inline constexpr double REPORTER_MIN_SB = 3.0;
  /// A channel is observed in the run when seen in this share of the
  /// assessable MS2.
  inline constexpr double REPORTER_MIN_SHARE = 0.2;
  /// A family is present when this many of its channels are observed.
  inline constexpr std::size_t REPORTER_MIN_CHANNELS = 3;
  /// A family needs this many assessable MS2 for a call.
  inline constexpr std::uint64_t REPORTER_MIN_ASSESSABLE = 20;
  /**
    @brief The reporter channels seen in @p s.
    @param[in] s The spectrum (sorted or not).
    @param[in] table The channels.
    @return A bit mask over table.mz.
  */
  std::uint32_t reportersSeen(const OpenMS::MSSpectrum& s, const ReporterTable& table);

  /// Why a spectrum cannot show a family's reporters.
  enum class Assess : std::uint8_t
  {
    OK,               ///< assessable
    ION_TRAP,         ///< ion-trap MS2 covering the reporter range: too coarse for the channels
    LOW_MASS_CUTOFF,  ///< the scan (or its lowest peak) starts above the reporter range
    NO_PEAKS,         ///< an empty spectrum
  };
  inline constexpr std::size_t ASSESS_COUNT = 4;
  /**
    @brief Whether an MS2 spectrum can show family @p f's reporters.
    @param[in] f The facts of the spectrum.
    @param[in] lowest_peak Its lowest peak m/z (NaN when empty).
    @param[in] table The channels.
    @param[in] family The family.
    @return OK or the reason it cannot.
  */
  Assess assessReporters(const ScanFacts& f, double lowest_peak, const ReporterTable& table, std::size_t family);

  /// Reporter counts over a run.
  struct ReporterTally
  {
    std::array<std::array<std::uint64_t, ASSESS_COUNT>, FAMILY_COUNT> by_assess{};  ///< MS2 per family and verdict
    std::vector<std::uint64_t> seen;  ///< per channel: assessable MS2 of its family in which it was seen
    void merge(const ReporterTally& o);
  };

  /// The run-level verdict on one kit.
  struct KitCall
  {
    std::string state;   ///< present, absent, not_assessable
    std::string reason;  ///< for not_assessable; "-" otherwise
  };
  /// The run-level reporter call.
  struct ReporterCall
  {
    std::vector<KitCall> kits;              ///< per ReporterTable::kits
    std::array<std::uint32_t, FAMILY_COUNT> observed{};  ///< channels observed per family
    std::vector<std::string> compatible;    ///< kits present, smallest first
  };
  /**
    @brief The kit states of a run.

    A channel is observed when seen in at least REPORTER_MIN_SHARE of its
    family's assessable MS2; a family is present with at least
    REPORTER_MIN_CHANNELS observed channels. A kit is present when its family
    is and every observed channel of the family is one of the kit's
    (compatible), absent otherwise. A family is not assessable with fewer
    than REPORTER_MIN_ASSESSABLE assessable MS2 (reason: the most frequent
    verdict, or no_ms2), or, when it is not present, if the run has MS3
    spectra (sps_ms3_not_read: the reporters of an SPS-MS3 design are in
    MS3, which is not read).

    @param[in] t The tally.
    @param[in] table The channels.
    @param[in] n_ms3 MS3 spectra of the run.
    @return The call.
  */
  ReporterCall callReporters(const ReporterTally& t, const ReporterTable& table, std::uint64_t n_ms3);

  /// The label-mass evidence of a run: Digest::labelCall() over the tag ends
  /// counted in the tagging loop (the -label_out call).
  struct LabelEvidence
  {
    bool counted = false;  ///< tag ends were counted; false: no evidence
    bool called = false;   ///< Digest::labelCall() made a call
    std::string reason;    ///< no call: low_resolution or few_tags
    /// 1.16.3: low_resolution because most tags were tagged at a Da
    /// tolerance on a ppm run (Digest::reportSettings()).
    bool da_tagged = false;
    std::uint64_t tags = 0;  ///< filtered tags counted
    std::array<std::uint64_t, Digest::NUM_LABELS> ends{};        ///< per labelKeys(): N- and C-terminal ends near the label
    std::array<std::uint64_t, Digest::NUM_LABELS> background{};  ///< the same at label + 0.5 Da
    std::array<bool, Digest::NUM_LABELS> passed{};               ///< the label passed the call
  };
  /**
    @brief The label-mass evidence from tag-end counts.
    @param[in] tc The tag ends of the run.
    @param[in] s The digest settings (window, low_resolution).
    @return The evidence (counted = true).
  */
  LabelEvidence labelEvidence(const Digest::TerminusCounter& tc, const Digest::DigestSettings& s);

  /// The run's isobaric kit: what was seen, not what it could be.
  struct KitDecision
  {
    /// A kit name; "ambiguous" (several candidates), "conflict" (one label
    /// passed, but no kit of it holds every observed channel: the label mass
    /// and the channels disagree, so no kit is called), "none" (no family
    /// present, at least one assessed) or "not_assessable" (no family could
    /// be assessed).
    std::string kit;
    /// label_mass, reporters_only, label_conflict (kit "conflict"), or "-" without a present family.
    std::string evidence = "-";
    /// The smallest kit per label the channels (and label) allow, table order;
    /// for a conflict, the kits the channels allow (of the other labels).
    std::vector<std::string> candidates;
    /// The labelKeys() entry that passed the label call: the one that decided
    /// (label_mass) or the one the channels contradict (label_conflict); else -1.
    int label = -1;
    /// Why the label did not decide (reporters_only): not_counted,
    /// low_resolution, few_tags, no_label, several_labels, label_conflict.
    std::string why;
  };
  /**
    @brief The kit of a run from the label mass and the observed channels.

    For each label of a present reporter family (TMT, TMTpro; iTRAQ4,
    iTRAQ8), the candidate is the smallest kit of that label whose channels
    hold every observed channel; a larger kit whose extra channels were not
    seen is never named. When exactly one label of a present family passed
    the label call and it has a candidate, that candidate is the kit
    (label_mass) and the other label's kits are not named. Otherwise
    (reporters_only) the candidates of every label are listed, smallest
    first per label, and the kit is the one candidate or "ambiguous".

    @param[in] call The reporter call.
    @param[in] table The channels.
    @param[in] ev The label evidence.
    @return The decision.
  */
  KitDecision decideKit(const ReporterCall& call, const ReporterTable& table, const LabelEvidence& ev);

  // ---- redundancy ----------------------------------------------------------

  /// A fragment fingerprint: unit-width bins (1.0005079 Th) with L2-normalized
  /// square-root intensities, sorted by bin.
  using Fingerprint = std::vector<std::pair<std::uint32_t, float>>;
  /// The redundancy rules.
  struct RedundancyRules
  {
    double precursor_ppm = 10.0;     ///< precursor m/z window
    double rt_span = 60.0;           ///< largest RT span of a cluster (s)
    double im_window = 0.02;         ///< 1/K0 window, when both spectra have one
    double min_cosine = 0.8;         ///< binned cosine
    std::size_t min_matched = 6;     ///< shared bins
    std::size_t top_peaks = 50;      ///< peaks kept per spectrum (most intense)
    std::size_t max_component = 300; ///< linked spectra clustered together at most
  };
  /**
    @brief The fingerprint of an MS2 spectrum.

    Removed first: the reporter channels, the immonium ions (the 20 residues,
    carbamidomethyl C, oxidized M and the K/R related 84.081/112.087/129.102),
    and the precursor at every charge up to its own (2..3 when unknown) with
    its water and ammonia losses and its +1 isotope. Then the top_peaks most
    intense remain.

    @param[in] s The spectrum.
    @param[in] precursor_mz Its precursor m/z.
    @param[in] charge Its precursor charge (0 = unknown).
    @param[in] table The reporter channels.
    @param[in] tol Removal tolerance (Da, or ppm when @p tol_ppm).
    @param[in] tol_ppm Whether @p tol is in ppm.
    @param[in] top_peaks Peaks kept.
    @return The fingerprint.
  */
  Fingerprint fingerprint(const OpenMS::MSSpectrum& s, double precursor_mz, int charge, const ReporterTable& table,
                          double tol, bool tol_ppm, std::size_t top_peaks);
  /**
    @brief The cosine of two fingerprints.
    @param[in] a One.
    @param[in] b The other.
    @param[out] matched Shared bins.
    @return The cosine (0 when either is empty).
  */
  double cosine(const Fingerprint& a, const Fingerprint& b, std::size_t& matched);

  /// One MS2 spectrum as the redundancy metric sees it.
  struct RedundancyRecord
  {
    std::size_t index = 0;   ///< input index (the deterministic order)
    double mz = 0;           ///< precursor m/z
    double rt = 0;           ///< retention time (s)
    float im = std::numeric_limits<float>::quiet_NaN();  ///< 1/K0, NaN = none
    int charge = 0;          ///< 0 = unknown (matches unknown only)
    bool tagged = false;     ///< a best tag at E <= TAG_EVALUE
    std::string tag;         ///< that tag's sequence
    Fingerprint fp;
  };
  /// The outcome of one clustering.
  struct RedundancyResult
  {
    std::uint64_t spectra = 0;           ///< records clustered
    std::uint64_t in_clusters = 0;       ///< records in clusters of size > 1
    std::uint64_t clusters = 0;          ///< clusters of size > 1
    std::uint64_t largest = 0;           ///< largest cluster
    std::uint64_t pairs_compared = 0;    ///< candidate pairs checked (precursor/charge window)
    std::uint64_t links = 0;             ///< pairs passing every rule
    std::uint64_t components_split = 0;  ///< linked groups larger than max_component, clustered in RT chunks
    std::vector<std::uint32_t> cluster_of;  ///< per record (in the order given): cluster id, by first member
  };
  /**
    @brief Complete-linkage clusters of @p recs.

    Two records may share a cluster when they have the same charge, precursor
    m/z within precursor_ppm, ion mobility within im_window (when both have
    one; a record with one never joins one without) and either (by_tag
    false) a cosine >= min_cosine over >= min_matched bins or (by_tag) the
    same best tag, both tagged. Within each linked group the two clusters
    with the highest complete-linkage similarity (the lowest pairwise one;
    every pair must be linked) merge first, ties to the lower first indices,
    while the merged RT span stays within rt_span. A group larger than
    max_component is clustered in consecutive RT chunks of that size, which
    bounds time (O(max_component^3) per chunk) and memory.

    @param[in] recs The records, in input order.
    @param[in] rules The rules.
    @param[in] by_tag The tag-driven variant.
    @return The result.
  */
  RedundancyResult cluster(const std::vector<RedundancyRecord>& recs, const RedundancyRules& rules, bool by_tag);

  // ---- the run --------------------------------------------------------------

  /// Tag yield: a best tag at or below this E-value.
  inline constexpr double TAG_EVALUE = 0.01;
  /// Profile spectra measured per (analyser class, MS level).
  inline constexpr std::size_t PROFILE_SAMPLES = 32;

  /**
    @brief Collects the report over one run, from any number of threads.

    scan() for every spectrum read, ms2() for every MS2 spectrum read (with
    its best tag), each index once; finish() after the last; then
    profileSamples() and profile() for the resolution measurement, and rows().
  */
  class Collector
  {
  public:
    /**
      @param[in] n_total Spectra in the input.
      @param[in] map The run's instrument configurations.
      @param[in] threads Threads that call scan() and ms2().
      @param[in] frag_tol Fragment tolerance (precursor peak removal).
      @param[in] tol_ppm Whether @p frag_tol is in ppm.
    */
    Collector(std::size_t n_total, InstrumentMap map, std::size_t threads, double frag_tol, bool tol_ppm);
    /// @brief Records the metadata of spectrum @p index.
    void scan(std::size_t tid, std::size_t index, const OpenMS::MSSpectrum& s);
    /**
      @brief Records an MS2 spectrum: reporters, tag yield, redundancy.
      @param[in] tid The calling thread.
      @param[in] index Its input index (scan() must have been called for it).
      @param[in] s The spectrum as read (not preprocessed).
      @param[in] best_evalue Its best reported tag's E-value (infinity when none).
      @param[in] best_tag That tag's sequence.
    */
    void ms2(std::size_t tid, std::size_t index, const OpenMS::MSSpectrum& s, double best_evalue,
             const std::string& best_tag);
    /// @brief Merges the threads' records; call once, after the last scan()/ms2().
    void finish();
    /// @brief The spectra to measure resolution on (after finish()); see the free function.
    std::vector<std::size_t> profileSamples(bool include_centroid = false) const;
    /**
      @brief Measures resolution on spectrum @p index, read with its peaks before any centroiding.
      @param[in] index Its input index.
      @param[in] s The spectrum.
    */
    void profile(std::size_t index, const OpenMS::MSSpectrum& s);
    /**
      @brief The run metadata (see runInfoOf()).
      @param[in] info The fields.
      @param[in] absent_why Why a field the input does not state is absent
                 (e.g. "MGF carries no run metadata"); "" = the input does not state it.
    */
    void setRunInfo(RunInfo info, std::string absent_why = {})
    {
      run_info_ = std::move(info);
      run_info_absent_ = std::move(absent_why);
    }
    /// @brief The label-mass evidence for the kit call (labelEvidence()); none = reporters only.
    void setLabelEvidence(const LabelEvidence& ev) { label_ev_ = ev; }
    /// @brief The reason resolution was not measured for every class (e.g. mzPeak input); "" = measured.
    void setProfileUnavailable(const std::string& why) { profile_unavailable_ = why; }
    /**
      @brief The qc section.
      @param[in] subsampled Whether only a sample of the spectra was read.
      @return The rows.
    */
    std::vector<Digest::Row> rows(bool subsampled) const;

    /// @brief The merged facts, by input index (after finish()).
    const std::vector<ScanFacts>& facts() const { return facts_; }
    /// @brief The merged redundancy records, by input index (after finish()).
    const std::vector<RedundancyRecord>& records() const { return records_; }
    /// @brief The reporter channels.
    const ReporterTable& reporterTable() const { return table_; }

  private:
    struct Thread
    {
      ReporterTally reporters;
      std::uint64_t ms2_read = 0, ms2_tagged = 0;
      std::vector<RedundancyRecord> records;
    };
    InstrumentMap map_;
    double frag_tol_;
    bool tol_ppm_;
    ReporterTable table_;
    std::vector<ScanFacts> facts_;
    std::vector<Thread> threads_;
    ReporterTally reporters_;
    std::uint64_t ms2_read_ = 0, ms2_tagged_ = 0;
    std::vector<RedundancyRecord> records_;
    /// Measured points per (analyser, MS level 1..3) and band.
    std::map<std::pair<int, int>, std::array<std::vector<double>, BAND_LOW.size()>> measured_;
    std::map<std::pair<int, int>, std::uint64_t> measured_spectra_, sampled_centroid_;
    std::string profile_unavailable_;
    RunInfo run_info_;
    std::string run_info_absent_;
    LabelEvidence label_ev_;
  };
}
