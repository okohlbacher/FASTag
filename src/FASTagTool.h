// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
//
// --------------------------------------------------------------------------
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
// --------------------------------------------------------------------------

// The FASTag TOPP tool: the TOPPFASTag class shared by its units
// (FASTag.cpp: main_() and main(); FASTagOptions.cpp: option registration and
// option queries; FASTagReports.cpp: tag TSV rows and report paths;
// FASTagModes.cpp: the GUI modes -probe_input and -dump_spectrum).

#pragma once

#include <optional>

#include <OpenMS/CONCEPT/VersionInfo.h>
#include <OpenMS/APPLICATIONS/ParameterInformation.h>
#include <OpenMS/APPLICATIONS/TOPPBase.h>
#include <OpenMS/CHEMISTRY/ModificationsDB.h>
#include <OpenMS/CHEMISTRY/ModifiedPeptideGenerator.h>
#include <OpenMS/CHEMISTRY/ProteaseDB.h>
#include <OpenMS/CHEMISTRY/ResidueModification.h>
#include <OpenMS/CONCEPT/LogStream.h>
#include <OpenMS/DATASTRUCTURES/FASTAContainer.h>
#include <OpenMS/DATASTRUCTURES/ListUtils.h>
#include <OpenMS/DATASTRUCTURES/StringUtils.h>
#include <OpenMS/FORMAT/FASTAFile.h>
#include <OpenMS/FORMAT/FileHandler.h>
#include <OpenMS/FORMAT/FileNameUtils.h>
#include <OpenMS/FORMAT/MzMLFile.h>
#include <OpenMS/FORMAT/MzPeakFile.h>
#include <OpenMS/IONMOBILITY/IMTypes.h>
#include <OpenMS/PROCESSING/CENTROIDING/PeakPickerHiRes.h>
#include <OpenMS/KERNEL/MSExperiment.h>
#include <OpenMS/KERNEL/OnDiscMSExperiment.h>
#include <OpenMS/FORMAT/DATAACCESS/MSDataWritingConsumer.h>
#include <OpenMS/SYSTEM/File.h>

#include "Acquisition.h"
#include "AcquisitionProbe.h"
#include "AlkylationCall.h"
#include "AlkylationTags.h"
#include "Centroid.h"
#include "CliParam.h"
#include "ComplementTol.h"
#include "Census.h"
#include "CensusIds.h"
#include "ClusterAcc.h"
#include "Digest.h"
#include "FASTagger.h"
#include "FastaFilter.h"
#include "Glyco.h"
#include "IndexedMzMLReader.h"
#include "InputProbe.h"
#include "IonSeries.h"
#include "MgfReader.h"
#include "NumFormat.h"
#include "OutputGuard.h"
#include "PrecursorHypotheses.h"
#include "Proforma.h"
#include "ReconIds.h"
#include "RunMeta.h"
#include "Cleavage.h"
#include "SearchConfig.h"
#include "Sha256.h"
#include "Shortlist.h"
#include "SpeciesCall.h"
#include "SpeciesEvidence.h"
#include "SpeciesLookup.h"
#include "SpectrumSampler.h"
#include "TagFDR.h"
#include "TagRecon.h"
#include "TmtPseudoFilter.h"
#include "TaxDeconv.h"
#include "TaxIndex.h"
#include "TaxStats.h"
#include "Usi.h"
#include "MzPeakStream.h"


#include <algorithm>
#include <atomic>
#include <chrono>
#include <cctype>
#include <cmath>
#include <condition_variable>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <filesystem>
#include <functional>
#include <fstream>
#include <iterator>
#include <iostream>
#include <limits>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <iomanip>
#include <sstream>
#include <thread>
#include <unordered_map>
#include <vector>
#ifdef _WIN32
#include <io.h>
#define fastag_dup _dup
#define fastag_dup2 _dup2
#define fastag_fdopen _fdopen
#else
#include <sys/resource.h>
#include <unistd.h>
#define fastag_dup dup
#define fastag_dup2 dup2
#define fastag_fdopen fdopen
#endif

#ifdef _OPENMP
#include <omp.h>
#endif
// `schedule(FASTAG_MONOTONIC dynamic, n)`: chunks strictly in index order,
// which the tagging loop's block ring depends on. From OpenMP 5.0 a bare
// `dynamic` means NONmonotonic, and libomp then lets threads steal chunks out
// of order; before 4.5 there is no modifier to write (MSVC's /openmp is 2.0),
// and dynamic scheduling is monotonic by definition.
#if defined(_OPENMP) && _OPENMP >= 201511
#define FASTAG_MONOTONIC monotonic:
#else
#define FASTAG_MONOTONIC
#endif
#ifndef _OPENMP
static inline int omp_get_max_threads() { return 1; }
static inline int omp_get_thread_num() { return 0; }
#endif


/// Directory holding the bundled taxonomy, or "" when there is none (FASTag.cpp).
std::string taxonomyDir_();

/// @name State shared by the tool units
//@{
/// Options on the command line (`-name`, set by main()): TOPPBase does not
/// tell an explicit default value from the default. Read for
/// -shortlist_specificity (post-1.13.1, aspn) and the msfragger shortlist
/// defaults (post-1.13.1, msfragger).
inline std::set<std::string> g_cli_options;

/// FASTAG_FULL_PRECISION=1: the tag TSV writes nterm_mass, cterm_mass and
/// evalue in shortest round-trip form, so a differential test reads the
/// doubles -digest_out counted. Deliberately not an option.
inline const bool g_full_precision = [] {
  const char* e = std::getenv("FASTAG_FULL_PRECISION");
  return e != nullptr && std::strcmp(e, "1") == 0;
}();
//@}

class TOPPFASTag : public OpenMS::TOPPBase
{
  // ---- 1.14: removed options and values ------------------------------------
  // Options and option values removed in 1.14 because they failed their
  // held-out test (CHANGELOG 1.14). TOPPBase refuses an INI file with an
  // unknown key or value, and -write_ini (like the GUI's INI export) writes
  // every key, so each removed name stays registered, advanced and without
  // effect, as -mzpeak_read_memory does for 1.11's decode cache, and a removed
  // value stays valid. Given on the command line or with a non-default INI
  // value, each one warns once (warnRemoved_()); a removed value is read as
  // the option's default (stringOption_()).
  struct RemovedOption
  {
    const char* name;
    const char* why;  ///< the reason the warning gives
  };
  static constexpr const char* FAILED_HELD_OUT = "failed its held-out test";
  static constexpr RemovedOption REMOVED_OPTIONS[] = {
      {"label_discovery_out", FAILED_HELD_OUT},
      {"label_discovery_max_flank", FAILED_HELD_OUT},
      {"label_discovery_depth", FAILED_HELD_OUT},
      {"label_discovery_min_spectra", FAILED_HELD_OUT},
      {"label_discovery_min_share", FAILED_HELD_OUT},
      {"label_discovery_window_n", FAILED_HELD_OUT},
      {"label_discovery_window_c", FAILED_HELD_OUT},
      {"label_discovery_unimod_top", FAILED_HELD_OUT},
      {"label_call_min_tags", FAILED_HELD_OUT},
      {"ion_series_photo", FAILED_HELD_OUT},
      {"species_reagents", "read only by -species_call explain, which failed its held-out test"},
      {"pick_unknown_type", "read only by -pick_profile auto, which failed its held-out test"},
      {"search_shifts", FAILED_HELD_OUT},
      {"search_shifts_out", FAILED_HELD_OUT},
      {"shift_max_variable", FAILED_HELD_OUT},
      {"shift_max_offsets", FAILED_HELD_OUT},
      {"shift_expand_sites", FAILED_HELD_OUT},
      {"shift_site_min_share", FAILED_HELD_OUT},
      {"shift_site_min_count", FAILED_HELD_OUT},
      {"shift_site_min_ions", FAILED_HELD_OUT},
      {"shortlist_exact_only", FAILED_HELD_OUT},
  };
  struct RemovedValue
  {
    const char* option;
    const char* value;
  };
  static constexpr RemovedValue REMOVED_VALUES[] = {
      {"ion_series", "ax"},
      {"species_call", "explain"},
      {"pick_profile", "auto"},
  };
  static constexpr const char* REMOVED_HELP =
      "Removed in 1.14; no effect (accepted so that existing command lines and INI files keep working)";

  static bool isRemovedOption_(const std::string& name);

  /// True when option @p name holds one of its removed values.
  bool isRemovedValue_(const std::string& name) const;

  /// getStringOption_, with a removed value read as the registered default.
  std::string stringOption_(const std::string& name) const;

  /// One WARN for each removed option given on the command line or with a
  /// non-default value (read through the Param, so a removed input file is
  /// not opened), and for each removed value in force.
  void warnRemoved_() const;

  // -out_spectra (mzML) compatibility shim (1.12 P3, decided in P0).
  // TOPPBase::getProcessingInfo_ lists EVERY registered parameter as a
  // "parameter: <name>" userParam of the exported mzML, so an option added
  // after 1.11 would change the exported bytes even at its default. Options
  // outside the frozen 1.11 list (FASTag::Cli::LEGACY_OUT_SPECTRA_PARAMETERS)
  // are dropped from it while they hold their registered default; a
  // non-default value is kept, so the provenance stays truthful whenever an
  // option actually acted. Removing entries keeps the order of the rest:
  // MetaInfo is ordered by registry index, which follows registration order.
  OpenMS::DataProcessing outSpectraProcessingInfo_() const;

  // What -complement_tolerance_unit auto decided (set by the probe in main_).
  struct ComplAutoRecord
  {
    bool on = false;
    std::string tol;       ///< Da in force, full precision
    std::string source;    ///< measured, lower_bound (raised to -complement_tolerance) or fallback
    std::string measured;  ///< Da as measured, full precision; empty when not measured
    std::string probe;   ///< the probe's statistics, as logged
  };
  ComplAutoRecord compl_auto_rec_;
  std::string tmt_filter_rec_;

public:
  // toolhandler_test = false: FASTag lives outside the OpenMS tree and so is
  // not in ToolHandler's list. Passing true makes the TOPPBase constructor
  // throw InvalidValue on startup.
  TOPPFASTag();

protected:
  void registerOptionsAndFlags_() override;

  /// True when option @p name holds a value other than its registered
  /// default, read through the typed getter of its registered type: a flag
  /// when given, a number when it differs, a string (or file path) when it
  /// differs, so an empty-default path when it is set. Used by the
  /// table-driven -stream refusals and the ignored-option warnings.
  bool optionNonDefault_(const std::string& name) const;

  /// The user set option @p name: on the command line, or a value other than
  /// its default from an INI (an INI value equal to the default cannot be
  /// told from the default).
  bool optionGiven_(const std::string& name) const;

  /// True when option @p name is registered in this build and holds a value
  /// other than its default (optionNonDefault_, plus integer lists). False
  /// for a name this build does not register.
  bool registeredNonDefault_(const std::string& name) const;

  /// Default report path: @p out with its extension replaced by @p suffix --
  /// only if the dot is in the FILE NAME. `-out /tmp/run.v1/tags` has its
  /// last dot in the directory, and cutting there would write elsewhere.
  static std::string defaultReportPath_(const std::string& out, const char* suffix);

  /// Append free text as one TSV field: a tab, CR or LF (an mzML id may
  /// carry them as &#9; / &#10;) would shift columns or split the row.
  static void appendField_(std::string& buf, const std::string& text);

  /// The tag TSV header line, matching appendTagRow_'s columns.
  /// @p hyp (1.12 #6, non-default -unknown_charge or -isotope_error only)
  /// adds the hypothesis columns after the other optional ones; @p
  /// ion_series (1.12 #15 phase B) the ion_series column after those.
  static std::string tagHeader_(bool proforma, bool res_conf, bool usi, bool hyp = false, bool ion_series = false);

  /// One TSV row for one tag, appended to buf. File mode and -stream both call
  /// this, so the two formats cannot drift. readSpeciesFields_() reads columns
  /// back out of these rows and must change with them.
  //
  // Appended field by field, so a very long native ID needs no fixed-buffer
  // fallback. Flanking masses at 4 decimals (0.1 mDa) -- %g's 6 significant
  // digits are coarser than the tolerance the tag was found with, and these
  // are what a downstream search constrains on. Numbers go through appendNum,
  // not snprintf: the same text as "%.4f" / "%g" / "%.3f", without the locale
  // lock every worker queues on in macOS's printf (NumFormat.h).
  static void appendTagRow_(std::string& buf, const FASTag::Tag& t,
                           const std::string& native_id, const char* hit,
                           bool want_proforma, const std::string& proforma_fixed,
                           bool want_res_conf, const std::string& usi = std::string(),
                           const FASTag::Hyp::Hypothesis* hyp = nullptr,
                           bool want_series = false);

  /// Reads back, from one appendTagRow_ line [start, nl) of @p r, the columns
  /// species detection needs: 0 (spectrum id), 1 (tag), 7 (gapped) and 8
  /// (E-value). Must change whenever appendTagRow_'s column order does. The
  /// printed E-value is parsed on purpose, not the tag's double, so ties are
  /// those of the TSV. @p gapped and @p evalue stay false and NaN when the
  /// line lacks those columns.
  /// @return false when the line has no tag column.
  static bool readSpeciesFields_(const std::string& r, size_t start, size_t nl, std::string& id,
                                std::string& tag, bool& gapped, double& evalue);

  /// ProForma global fixed-modification prefix: each fixed residue
  /// modification becomes `<[Name]@Residue>`. Fixed mods change residue
  /// masses but are NOT in the tag sequence, so a bare `C` is really
  /// carbamidomethyl-C; the prefix declares that for the whole proteoform.
  /// Built from the resolved modifications, so terminal ones (absorbed into
  /// the flanking masses, see resolveMods_) are left out.
  static std::string buildProformaPrefix_(const std::vector<FASTag::ModSpec>& mods);

  /// Resolve OpenMS/UniMod modification names to FASTag::ModSpec via
  /// ModificationsDB. Terminal mods are skipped with a note -- they are absorbed
  /// into the reported flanking masses, not the internal residue alphabet.
  /// Peptide-terminal ones on any residue are summed into @p term_n / @p term_c
  /// when given (the -recon_localize fragment ladder needs them).
  /// @p kept receives the full ID of every residue modification added to @p out.
  /// @return false if a name is not in ModificationsDB (logged): a typo must
  ///   not run with the wrong chemistry and exit 0.
  bool resolveMods_(const OpenMS::StringList& names, bool variable, std::vector<FASTag::ModSpec>& out,
                    OpenMS::StringList& kept, double* term_n = nullptr, double* term_c = nullptr);

  FILE* stream_data_ = nullptr;  ///< the REAL stdout in -stream mode

  /// The exit code of a G1 mode's status (src/InputProbe.h).
  ExitCodes probeExit_(FASTag::Probe::Status s) const;

  /// Writes @p jsonl to the sealed stdout; false when that fails.
  bool writeGuiStream_(const std::string& jsonl);

  /// 1.12 G1 -probe_input: the input's metadata as JSON lines, nothing else.
  ExitCodes probeInputMode_();

  /// 1.12 G1 -dump_spectrum: one spectrum's tagged peaks as JSON lines.
  ExitCodes dumpSpectrumMode_(const std::string& in, const FASTag::Param& p);

  /**
    @brief Species detection from the tags (-species, -species_call): phase 10 of main_().

    Taxonomic / species detection from the tags.

    For every spectrum, the SET of taxa its tags support (a tag supports a
    taxon when every one of its k-mers is in that taxon -- intersection, so a
    longer tag is more specific). Each taxon is counted ONCE per spectrum, not
    per tag, so correlated tags from one spectrum cannot manufacture evidence.
    Roll the per-leaf counts up the taxonomy, compare each node against the
    breadth it has in the index, and rank. The q-value is a ranking aid, not a
    calibrated FDR: the per-k-mer background is a proxy and the chimeric-null
    problem described for -entrapment_fasta applies here too.

    The parameters are main_()'s locals of the same names.
    @return the exit code main_() returns, or std::nullopt to continue
  */
  std::optional<ExitCodes> detectSpecies_(bool want_species, FASTag::SpeciesOrientation species_orient, bool species_both,
                                          bool species_call_on, FASTag::SpeciesCall::Params& species_call_params,
                                          std::string& species_call_params_path, const std::string& in,
                                          const std::string& out, std::vector<int>& lengths, const char* length_opt,
                                          std::map<std::string, std::vector<std::pair<std::string, double>>>& by_spec);

  ExitCodes main_(int, const char**) override;
};
