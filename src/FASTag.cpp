// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
//
// --------------------------------------------------------------------------
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
// --------------------------------------------------------------------------

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
#include "Centroid.h"
#include "CliParam.h"
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
#include "SearchConfig.h"
#include "Shortlist.h"
#include "SpeciesCall.h"
#include "SpeciesEvidence.h"
#include "SpeciesLookup.h"
#include "SpectrumSampler.h"
#include "TagFDR.h"
#include "TagRecon.h"
#include "TaxDeconv.h"
#include "TaxIndex.h"
#include "TaxStats.h"
#include "Usi.h"
#include "MzPeakStream.h"

#ifdef FASTAG_MIMALLOC
#include <mimalloc.h> // Windows: mimalloc with CRT redirection (CMakeLists.txt)
#endif

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
#include <iostream>
#include <limits>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <sstream>
#include <thread>
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

using namespace OpenMS;

namespace
{
  /// Program start, for FASTAG_TIMING. Static init runs before main, so the
  /// pre-loop phases (opening the archive, building its metadata map, the
  /// tolerance probe) are attributable rather than lumped into "the rest".
  const std::chrono::steady_clock::time_point g_t_program = std::chrono::steady_clock::now();
  double g_t_open = 0; ///< seconds spent constructing the input reader
  double g_t_probe = 0, g_t_tables = 0; ///< tolerance probe, null tables
  /// When main_() finished a file run; what follows it is teardown.
  std::chrono::steady_clock::time_point g_t_main_end;

  /// Thrown by the tagging loop at the first MS2 with an ion mobility per
  /// peak when -out_spectra is mzPeak, which cannot store it.
  struct IonMobilityRefused {};

  /// FASTAG_FULL_PRECISION=1: the tag TSV writes nterm_mass, cterm_mass and
  /// evalue in shortest round-trip form, so a differential test reads the
  /// doubles -digest_out counted. Deliberately not an option.
  const bool g_full_precision = [] {
    const char* e = std::getenv("FASTAG_FULL_PRECISION");
    return e != nullptr && std::strcmp(e, "1") == 0;
  }();

  /// Directory holding the shipped digest data (protease models, mass-gap
  /// modifications): $FASTAG_DIGEST_DIR, else beside the executable in the
  /// two layouts taxonomyDir_() knows. "" when there is none.
  std::string digestDir_()
  {
    const char* env = std::getenv("FASTAG_DIGEST_DIR");
    if (env != nullptr && *env != '\0' && File::isDirectory(std::string(env))) return std::string(env);
    const std::string exe = File::getExecutablePath();
    for (const std::string& c : {exe + "../share/FASTag/digest", exe + "share-FASTag-digest", exe + "digest"})
      if (File::exists(c + "/digest_models.tsv")) return c;
    return std::string();
  }

  /// 1.12 D (#3g): directory of the shipped -alkylation_proteome proteomes:
  /// $FASTAG_ALKYLATION_DIR, else "alkylation" beside the digest data
  /// directory (share/FASTag/digest -> share/FASTag/alkylation,
  /// share-FASTag-digest -> share-FASTag-alkylation). "" when there is none.
  std::string alkylationDir_()
  {
    const char* env = std::getenv("FASTAG_ALKYLATION_DIR");
    if (env != nullptr && *env != '\0' && File::isDirectory(std::string(env))) return std::string(env);
    std::string d = digestDir_();
    while (!d.empty() && (d.back() == '/' || d.back() == '\\')) d.pop_back();
    if (d.size() < 6 || d.compare(d.size() - 6, 6, "digest") != 0) return std::string();
    const std::string a = d.substr(0, d.size() - 6) + "alkylation";
    return File::isDirectory(a) ? a : std::string();
  }

  /// k of a taxonomy index, read from its 16-byte header alone.
  ///
  /// Exists so the tag-length precondition can be checked BEFORE tagging.
  /// Loading the index to learn k maps a ~1 GB file, which is exactly the work
  /// we want to refuse to waste.
  ///
  /// Both index versions put k at the same place: magic(4) | u32 version | u32 k,
  /// so both the current "FTX2" and the legacy "FTXI" are accepted.
  int peekTaxdbK_(const std::string& path)
  {
    std::ifstream f(path.c_str(), std::ios::binary);
    if (!f) return -1;
    char magic[4];
    if (!f.read(magic, 4)) return -1;
    const bool v1 = std::memcmp(magic, "FTXI", 4) == 0;
    const bool v2 = std::memcmp(magic, "FTX2", 4) == 0;
    if (!v1 && !v2) return -1;
    std::uint32_t ver = 0, k = 0;
    if (!f.read(reinterpret_cast<char*>(&ver), 4)) return -1;
    if (!f.read(reinterpret_cast<char*>(&k), 4)) return -1;
    // Reject a header the real loader would reject, so a corrupt/hostile file
    // does not yield a plausible k and a misleading precondition error.
    if ((v1 && ver != 1) || (v2 && ver != 2)) return -1;
    if (k < 1 || k > static_cast<std::uint32_t>(FASTag::TaxIndex::MAX_K)) return -1;
    return static_cast<int>(k);
  }

  /// Directory holding the bundled taxonomy, or "" when there is none:
  /// $FASTAG_TAXONOMY_DIR (a custom or larger reference set), else a
  /// directory beside the executable.
  ///
  /// Anchored to the EXECUTABLE, not OPENMS_DATA_PATH: this is FASTag's own
  /// data, and a user pointing OPENMS_DATA_PATH at a system OpenMS must not
  /// silently lose the taxonomy that shipped beside the binary they run.
  std::string taxonomyDir_()
  {
    const char* env = std::getenv("FASTAG_TAXONOMY_DIR");
    if (env != nullptr && *env != '\0' && File::isDirectory(std::string(env))) return std::string(env);

    // Both layouts the project ships:
    //   ../share/FASTag/taxonomy   a normal `cmake --install` tree (bin/ + share/)
    //   ./share-FASTag-taxonomy    the release tarball, which is flat: the
    //                              executable sits at the root next to lib/ and
    //                              share-OpenMS/, so there is no ../share to find.
    // Prefer a directory that has the INDEX (a fully usable set), then one with
    // the dumps (installable -- the index is a separate download), then any that
    // merely exists (so the error names a real path). First-that-exists would
    // let an empty or dumps-only install tree mask a complete one beside it.
    const std::string exe = File::getExecutablePath();
    const std::string cands[] = {exe + "../share/FASTag/taxonomy",
                            exe + "share-FASTag-taxonomy",
                            exe + "taxonomy"};
    std::string with_dumps, any;
    for (const std::string& c : cands)
    {
      if (!File::isDirectory(c)) continue;
      if (any.empty()) any = c;
      const bool dumps = File::exists(c + "/nodes.dmp") && File::exists(c + "/names.dmp");
      if (dumps && File::exists(c + "/tax_k7.taxdb")) return c;   // complete
      if (dumps && with_dumps.empty()) with_dumps = c;
    }
    return !with_dumps.empty() ? with_dumps : any;
  }
}

//-------------------------------------------------------------------------
/**
  @page TOPP_FASTag FASTag

  @brief Infers partial sequence tags from MS/MS spectra.

  Based on DirecTag (Tabb et al., J Proteome Res 2008, 7:3838). The main
  algorithmic change is that the intensity null is computed by dynamic
  programming instead of by enumerating every C(n,k) subset of peak ranks,
  which makes tags longer than four residues practical. Seed tags can
  optionally be extended (-extension) and can contain one mass gap (-gaps).
  For the inputs, outputs and further analyses (FASTA filtering, spectra
  output as mzML or mzPeak, species detection, reconciliation, digest
  reports), see README.md.

  <B>The command line parameters of this tool are:</B>
  @verbinclude TOPP_FASTag.cli
*/
//-------------------------------------------------------------------------

class TOPPFASTag : public TOPPBase
{
  // -out_spectra (mzML) compatibility shim (1.12 P3, decided in P0).
  // TOPPBase::getProcessingInfo_ lists EVERY registered parameter as a
  // "parameter: <name>" userParam of the exported mzML, so an option added
  // after 1.11 would change the exported bytes even at its default. Options
  // outside the frozen 1.11 list (FASTag::Cli::kLegacyOutSpectraParameters)
  // are dropped from it while they hold their registered default; a
  // non-default value is kept, so the provenance stays truthful whenever an
  // option actually acted. Removing entries keeps the order of the rest:
  // MetaInfo is ordered by registry index, which follows registration order.
  DataProcessing outSpectraProcessingInfo_() const
  {
    DataProcessing p = getProcessingInfo_(DataProcessing::FILTERING);
    const std::string prefix = "parameter: ";
    std::vector<std::string> keys;
    p.getKeys(keys);
    for (const std::string& k : keys)
    {
      if (k.compare(0, prefix.size(), prefix) != 0) continue;
      const std::string name = k.substr(prefix.size());
      if (FASTag::Cli::isLegacyOutSpectraParameter(name)) continue;
      // A flag's registered default (false) and its Param value ("false")
      // never compare equal, so a flag at its default would stay listed; ask
      // the flag itself.
      const ParameterInformation& e = findEntry_(name);
      const bool at_default = e.type == ParameterInformation::FLAG ? !getFlag_(name)
                                                                   : getParam_().getValue(name) == e.default_value;
      if (at_default) p.removeMetaValue(k);
    }
    return p;
  }

public:
  // toolhandler_test = false: FASTag lives outside the OpenMS tree and so is
  // not in ToolHandler's list. Passing true makes the TOPPBase constructor
  // throw InvalidValue on startup.
  TOPPFASTag()
    : TOPPBase("FASTag", "Infers partial sequence tags from MS/MS spectra.",
               {{"Tabb DL, Ma ZQ, Martin DB, Ham AJ, Chambers MC",
                 "DirecTag: accurate sequence tags from peptide MS/MS through statistical scoring",
                 "J Proteome Res 2008; 7(9): 3838-46", "10.1021/pr800154p"}},
               false)
  {
    // TOPPBase prints the OpenMS version when version_ is empty, which is
    // right for a tool shipped inside OpenMS and wrong for this one.
    // FASTAG_VERSION comes from project(FASTag VERSION ...).
    version_ = FASTAG_VERSION;
    verboseVersion_ = std::string(FASTAG_VERSION) + " (OpenMS " + VersionInfo::getVersion() + ")";
  }

protected:
  void registerOptionsAndFlags_() override
  {
    // No setValidFormats_ on the two spectrum files: main_ decides by type
    // and refuses an unsupported one with its own message.
    registerInputFile_("in", "<file>", "", "Input spectra (mzML, mzpeak or MGF)", /*required=*/false);
    registerOutputFile_("out", "<file>", "", "Tag list (tab-separated)", /*required=*/false);
    setValidFormats_("out", ListUtils::create<std::string>("tsv"));

    registerInputFile_("fasta", "<file>", "", "Report only tags occurring in these sequences", false);
    setValidFormats_("fasta", ListUtils::create<std::string>("fasta"));
    registerOutputFile_("out_spectra", "<file>", "",
                        "Write spectra carrying a reported tag here (mzML or "
                        "mzpeak). Note this path holds one slot per input "
                        "spectrum, so unlike the default it needs memory "
                        "proportional to the FILE, not to the thread count", false);

    registerIntOption_("tag_length", "<n>", FASTag::Cli::kTagLength, "Seed tag length in residues", false);
    setMinInt_("tag_length", 1);
    // Several seed lengths over ONE read of the input. A separate list, not a
    // widened -tag_length, so that option and every INI that sets it are
    // unchanged.
    registerIntList_("tag_lengths", "<n>", IntList(),
                     "Seed tag lengths to run in one pass, replacing -tag_length. "
                     "Each length is tagged, scored and capped (-max_tags) exactly "
                     "as on its own; a spectrum's rows are those runs' rows in "
                     "ascending length, except that a tag several lengths report "
                     "is kept only from the length with its lowest E-value", false);
    setMinInt_("tag_lengths", 1);
    registerIntOption_("extension", "<n>", FASTag::Cli::kExtension,
                       "Maximum residues appended per terminus; 0 disables extension", false);
    setMinInt_("extension", 0);
    // tag_length + 2*extension is computed as int and indexes the null tables.
    // Unbounded, --extension 1073741824 overflows and aborts with std::length_error.
    setMaxInt_("extension", (FASTag::MAX_FILTER_LEN - 1) / 2);
    registerIntOption_("gaps", "<n>", FASTag::Cli::kGaps,
                       "Allow a tag to cross one missing peak, spelling the two "
                       "residues either side of it from their summed mass; "
                       "0 disables", false);
    setMinInt_("gaps", 0);
    // One gap only. Each additional gap multiplies the branching and asserts
    // another unobserved split, and a two-gap tag would be mostly inference.
    setMaxInt_("gaps", 1);
    // Negated, because a TOPP flag is false unless given and deisotoping is on
    // by default. `-no_deisotope` follows TOPPBase's own `-no_progress`.
    registerFlag_("no_deisotope",
                  "Do not collapse isotope clusters to their monoisotopic peak, and "
                  "do not move multiply-charged fragments onto the singly-charged "
                  "scale, before peak selection", false);

    registerDoubleOption_("fragment_tolerance", "<value>", FASTag::Cli::kFragmentTolerance, "Fragment mass tolerance", false);
    // Without a floor a negative or zero tolerance matches nothing and the run
    // reports zero tags with no indication why. The floor stays in the INI/CTD
    // (restrictions="1.0e-09:") for KNIME/Galaxy validators; main_ also refuses
    // NaN, which TOPPBase's range check lets through.
    setMinFloat_("fragment_tolerance", 1e-9);
    registerStringOption_("fragment_tolerance_unit", "<unit>", FASTag::Cli::kFragmentToleranceUnit, "Tolerance unit", false);
    setValidStrings_("fragment_tolerance_unit", ListUtils::create<std::string>("ppm,Da"));

    registerIntOption_("max_peaks", "<n>", FASTag::Cli::kMaxPeaks,
                       "Peaks kept per spectrum, at most 1024; 0 means 1024, not "
                       "unlimited. Higher values use more memory. Also caps "
                       "-peaks_per_window", false);
    setMinInt_("max_peaks", 0);
    setMaxInt_("max_peaks", 1024);
    registerIntOption_("peaks_per_window", "<n>", FASTag::Cli::kPeaksPerWindow,
                       "Keep this many peaks per 100 Da window instead of the "
                       "strongest -max_peaks overall; 0 disables. Scales the "
                       "effective peak budget with the spectrum's m/z range, so "
                       "dense spectra are not starved and sparse ones not padded", false);
    setMinInt_("peaks_per_window", 0);
    registerIntOption_("max_tags", "<n>", FASTag::Cli::kMaxTags, "Tags reported per spectrum; 0 = unlimited", false);
    setMinInt_("max_tags", 0);

    // Random subsampling of input spectra. For a taxon call (or a quick preview)
    // a run does not need every spectrum -- a uniformly random subset gives the
    // same lowest-common-ancestor at a fraction of the cost. Selection is seeded
    // (-subsample_seed) so a run is reproducible. 0 / 0.0 disables. If both are
    // set, the absolute count wins.
    registerIntOption_("subsample_spectra", "<n>", 0,
                       "Tag only this many randomly chosen input spectra; 0 = all. "
                       "Takes precedence over -subsample_fraction", false);
    setMinInt_("subsample_spectra", 0);
    registerDoubleOption_("subsample_fraction", "<f>", 0.0,
                          "Tag only this random fraction (0..1] of input spectra; 0 = all. "
                          "Ignored when -subsample_spectra is set", false);
    setMinFloat_("subsample_fraction", 0.0);
    setMaxFloat_("subsample_fraction", 1.0);

    // Accepted so that existing command lines and INI files keep working; the
    // mzPeak reader has no decode cache to size any more.
    registerIntOption_("mzpeak_read_memory", "<MB>", 0,
                       "Ignored; mzPeak is read in file order without a decode cache", false, true);
    setMinInt_("mzpeak_read_memory", 0);
    registerIntOption_("subsample_seed", "<n>", 1, "Seed for -subsample_* selection", false);
    setMinInt_("subsample_seed", 0);

    // Machine-readable progress for a GUI/pipeline driving FASTag. Off by
    // default so the CLI stays quiet; when set, emit periodic lines to stderr:
    //   FASTAG_PROGRESS done=<n> total=<n>
    // total is the input's spectrum count (every reader is indexed).
    // Emitted from a single thread per update, so lines never interleave.
    registerFlag_("progress", "Emit 'FASTAG_PROGRESS done=<n> total=<n>' lines to stderr for a GUI progress bar");

    // Low-latency resident mode for instrument control: read line-oriented
    // spectrum blocks from stdin, write TSV rows + a sentinel per block to
    // stdout, flushed. Protocol per block:
    //   spectrum <id> <precursor_mz> <charge>     (charge <= 0 -> treated as 2)
    //   <mz> <intensity>                          (one peak per line)
    //   <blank line>                              (ends the block)
    // Output: the TSV header once at startup, then per block its rows and
    //   #end <id> <n_tags>
    // Malformed input yields '#error <id> <msg>' and a resync to the next
    // blank line -- the process never exits mid-stream. Diagnostics stay on
    // stderr. Fixed costs (process start, table build) are paid once; steady
    // state is sub-millisecond per spectrum at defaults.
    registerFlag_("stream",
                  "Resident single-spectrum mode: spectrum blocks on stdin, TSV "
                  "rows + '#end' sentinels on stdout. Core tagging only (refuses "
                  "-fasta, -entrapment_fasta, -species, -species_out, -taxdb, -glyco, "
                  "-recon_out, -recon_id_out, -out_spectra, -delta_out, -digest_out, "
                  "-label_out, -massgap_out, -usi_collection); parameter changes need a restart");

    registerFlag_("diversity",
                  "On spectra with more tags than -max_tags, prefer tags built from "
                  "different peaks over near-copies of a tag already kept. Changes "
                  "which tags fill the slots, not how many");

    // ProForma 2.0 rendering of each tag, appended as a trailing column. Off by
    // default so the TSV schema is unchanged unless asked for. See Proforma.h.
    registerFlag_("proforma", "Append a ProForma 2.0 column ([+nterm]-SEQ-[+cterm]) for each tag");

    registerFlag_("res_conf",
                  "Append a res_conf column: a confidence from 0 to 100 for each "
                  "residue, N to C, space-separated (a gap's two residues share one "
                  "score). Used for de novo assembly export (see README, Assembly export)");

    registerStringOption_("usi_collection", "<id>", "",
                          "Append a usi column: each tag's spectrum as a HUPO-PSI "
                          "Universal Spectrum Identifier, mzspec:<id>:<run>:scan:<n> (or "
                          "the nativeId/index form USI 1.0 prescribes), where <run> is "
                          "the input file name without its extension (an MGF keeps its .mgf) and <id> the "
                          "dataset's PXD/MSV/RPXD/RMSV/PXL identifier, or USI000000 "
                          "until it has one", false);

    // Entrapment-calibrated q-values for the -fasta membership filter.
    // Adds a q_db column: the estimated FALSE-MATCH rate of accepting every
    // tag at or below a row's E-value -- i.e. how often a tag this good hits
    // the database by chance, calibrated by sequences the sample cannot
    // contain. q_db is NOT the probability the tag misreads its precursor: a
    // correct ladder read of a co-isolated chimeric peptide legitimately
    // matches the target database and is not false under this null (which is
    // why this null works where single-spectrum decoys measure an empty one).
    registerInputFile_("entrapment_fasta", "<file>", "",
                       "Entrapment database (foreign species the sample cannot "
                       "contain; phylogenetically distant, e.g. archaea for a "
                       "mammalian sample). Requires -fasta. Appends a q_db "
                       "column and marks entrapment-only matches efwd/erev "
                       "in fasta_hit", false);
    setValidFormats_("entrapment_fasta", ListUtils::create<std::string>("fasta"));

    // Tag reconciliation (placement plus gap interpretation, after TagRecon)
    // at proteome scale: place each reported tag onto tryptic windows of a
    // database by its flanking masses and localize/interpret the single mass
    // gap the flanks imply. Runs on a
    // per-run suffix-array index (ProteomeIndex, ~1.4 s to build on one thread
    // for a human reference proteome) -- deliberately DECOUPLED from -fasta:
    // filtering builds a per-length k-mer membership index whose memory grows
    // with (residues x lengths), while reconciliation needs only the ~75 MB
    // locate index, so a proteome-scale -recon_fasta must not force the
    // filter's build.
    registerOutputFile_("recon_out", "<file>", "",
                        "Reconcile reported tags against a protein database and write "
                        "one row per placement (protein, peptide, position, flank "
                        "agreement, mass gap + interpretation). Uses -recon_fasta, "
                        "or -fasta when that is not given", false);
    setValidFormats_("recon_out", ListUtils::create<std::string>("tsv"));
    registerInputFile_("recon_fasta", "<file>", "",
                       "Protein database for -recon_out. Default: the -fasta file", false);
    setValidFormats_("recon_fasta", ListUtils::create<std::string>("fasta"));
    registerIntOption_("recon_missed_cleavages", "<n>", 1,
                       "Missed tryptic cleavages allowed in reconciliation windows (at most 10)", false);
    setMinInt_("recon_missed_cleavages", 0);
    setMaxInt_("recon_missed_cleavages", 10);
    registerIntOption_("recon_min_length", "<n>", 0,
                       "Shortest tag worth reconciling; 0 derives it from database size "
                       "(the length where chance matches fall below 5%). Overridable "
                       "because the floor is a noise gate, not a correctness rule", false);
    setMinInt_("recon_min_length", 0);
    registerFlag_("recon_localize",
                  "Localize each -recon_out mass gap to one residue of its region: the "
                  "site whose shifted b/y fragments match the most peaks within "
                  "-fragment_tolerance. Appends loc_site (residue + 1-based protein "
                  "position; the first on a tie), loc_score (b/y ion/charge matches) and "
                  "loc_ties (sites sharing that score; 1 = unique)");
    registerOutputFile_("delta_out", "<file>", "",
                        "Aggregated mass-shift histogram over the reconciliations "
                        "(requires -recon_out): delta, spectrum count, top "
                        "interpretations. Region-level candidates, NOT localized "
                        "identifications and NOT FDR-controlled", false);
    setValidFormats_("delta_out", ListUtils::create<std::string>("tsv"));
    registerOutputFile_("recon_id_out", "<file>", "",
                        "The -recon_out placements as identifications (requires "
                        "-recon_out), as idXML, mzid or mzTab by extension: one hit per "
                        "placement with its proteins, the database peptide carrying only "
                        "the fixed residue modifications, scored by the tag's E-value (lower is "
                        "better), the mass gap as metadata. NOT FDR-controlled", false);
    setValidFormats_("recon_id_out", ListUtils::create<std::string>("idXML,mzid,mzTab"));

    // Taxonomic / species detection: throw the tags at a prebuilt tag->taxon
    // index (buildtaxdb) and infer the taxa present by lowest-common-ancestor
    // over the tag hits. A reduced reference set gives honest genus/family
    // resolution; short peptide tags cannot resolve species. Pair with
    // -subsample_* for a fast call on a large run.
    // The switch. Off by default -- loading the ~1 GB memory-mapped index is
    // work no plain tagging run should pay for. With it on, the three inputs
    // below default to the taxonomy bundled beside the binary, so `-species` on
    // its own is a complete request.
    registerFlag_("species", "Infer which taxa are present from the tags. Uses the bundled "
                             "taxonomy unless -taxdb/-taxonomy_* are given, and writes "
                             "<out> with its extension replaced by .species.tsv unless "
                             "-species_out is given");

    // Glycopeptide spectrum flag: oxonium-ion detection per MS2 spectrum,
    // written to its own TSV (see Glyco.h for why it is not a tag column).
    registerFlag_("glyco",
                  "Flag oxonium-bearing MS2 spectra (glycopeptide/glycan "
                  "evidence, NOT an identification) to <out> with its extension "
                  "replaced by .glyco.tsv (tags.tsv -> tags.glyco.tsv), or to -glyco_out");
    registerOutputFile_("glyco_out", "<file>", "",
                        "Per-spectrum oxonium report. Default: <out> with its "
                        "extension replaced by .glyco.tsv", false);
    setValidFormats_("glyco_out", ListUtils::create<std::string>("tsv"));
    registerDoubleOption_("glyco_min_fraction", "<f>", 0.10,
                          "Minimum summed oxonium intensity as a fraction of the "
                          "base peak (MSFragger-Glyco's diagnostic filter)", false);
    setMinFloat_("glyco_min_fraction", 0.0);

    // Digest, label and mass-gap reports: measurements from the reported
    // tags, long-form TSV (section, key, value, n, description). Opt-in; the
    // other outputs are the same with or without them.
    registerOutputFile_("digest_out", "<file>", "",
                        "Report the terminal residues of the tags (ungapped, E-value <= 1) and "
                        "the protease call they support, with its margin or the reason for no call", false);
    setValidFormats_("digest_out", ListUtils::create<std::string>("tsv"));
    registerOutputFile_("label_out", "<file>", "",
                        "Report N-terminal isobaric label gaps (TMT, TMTpro, iTRAQ4) and the heavy "
                        "Lys8/Arg10 shares of the tag ends", false);
    setValidFormats_("label_out", ListUtils::create<std::string>("tsv"));
    registerOutputFile_("massgap_out", "<file>", "",
                        "Report the -delta_out mass-gap distribution (requires -recon_out): Cys "
                        "alkylation counts, gap peaks explained as combinations of Unimod "
                        "modifications, and SILAC labels among them", false);
    setValidFormats_("massgap_out", ListUtils::create<std::string>("tsv"));
    registerInputFile_("digest_models", "<file>", "",
                       "Protease model table for -digest_out (columns model, class, end, residue, "
                       "freq). Default: the shipped cleavage-rule models", false);
    setValidFormats_("digest_models", ListUtils::create<std::string>("tsv"));
    registerIntOption_("digest_tag_min", "<n>", 100,
                       "Tag ends needed for a protease call; the N-terminal ends count from as many", false, true);
    setMinInt_("digest_tag_min", 1);
    registerDoubleOption_("digest_window", "<Da>", 0.008,
                          "Mass window around a residue or label mass at the tag ends", false, true);
    setMinFloat_("digest_window", 0.0);
    registerDoubleOption_("digest_background_share", "<f>", 0.05,
                          "Share of the background mixed into every protease model (below 1)", false, true);
    setMinFloat_("digest_background_share", 0.0);
    setMaxFloat_("digest_background_share", 1.0);
    registerIntOption_("digest_silac_min", "<n>", 50,
                       "K- and R-terminal tag ends each before -label_out's heavy shares are gated in", false, true);
    setMinInt_("digest_silac_min", 0);
    registerDoubleOption_("massgap_window", "<Da>", 0.02,
                          "Gap window of -massgap_out on a ppm run", false, true);
    setMinFloat_("massgap_window", 0.0);
    registerDoubleOption_("massgap_window_da", "<Da>", 0.5,
                          "Gap window of -massgap_out on a run with a Da fragment tolerance", false, true);
    setMinFloat_("massgap_window_da", 0.0);
    registerIntOption_("massgap_min_spectra", "<n>", 20, "Spectra a gap peak needs", false, true);
    setMinInt_("massgap_min_spectra", 0);
    registerDoubleOption_("massgap_min_share", "<f>", 0.005,
                          "Share of the placed spectra a gap peak needs", false, true);
    setMinFloat_("massgap_min_share", 0.0);
    registerIntOption_("massgap_min_bin", "<n>", 2,
                       "Spectra a -delta_out row needs to take part in the gap peaks", false, true);
    setMinInt_("massgap_min_bin", 1);
    registerIntOption_("massgap_max_mods", "<n>", 3,
                       "Modifications combined to explain a gap", false, true);
    setMinInt_("massgap_max_mods", 1);
    setMaxInt_("massgap_max_mods", 4);
    registerIntOption_("massgap_top", "<n>", 5, "Modifications listed by share", false, true);
    setMinInt_("massgap_top", 0);
    registerDoubleOption_("massgap_silac_share", "<f>", 0.08,
                          "Share of the shifted spectra a SILAC label needs", false, true);
    setMinFloat_("massgap_silac_share", 0.0);
    registerIntOption_("massgap_silac_min", "<n>", 500,
                       "Shifted spectra a SILAC call needs", false, true);
    setMinInt_("massgap_silac_min", 0);

    registerInputFile_("taxdb", "<file>", "", "Tag->taxon index (built by buildtaxdb). Default: the bundled tax_k7.taxdb", false);
    registerInputFile_("taxonomy_nodes", "<file>", "", "NCBI taxonomy nodes.dmp. Default: the bundled nodes.dmp", false);
    registerInputFile_("taxonomy_names", "<file>", "", "NCBI taxonomy names.dmp. Default: the bundled names.dmp", false);
    registerOutputFile_("species_out", "<file>", "", "Ranked taxa TSV. Default: <out> with its extension replaced by .species.tsv", false);
    setValidFormats_("species_out", ListUtils::create<std::string>("tsv"));
    registerIntOption_("species_min_len", "<n>", 0,
                       "Ignore tags shorter than this for taxonomy; 0 uses the index k", false);
    setMinInt_("species_min_len", 0);
    // Near-neighbour control. Both filters are identities at their defaults.
    registerDoubleOption_("species_max_kmer_share", "<f>", 1.0,
                          "Ignore k-mers carried by more than this fraction of the indexed taxa: "
                          "a k-mer in most of the reference cannot tell taxa apart. 1 keeps all", false);
    setMinFloat_("species_max_kmer_share", 0.0);
    setMaxFloat_("species_max_kmer_share", 1.0);
    registerDoubleOption_("species_min_margin", "<f>", 0.0,
                          "Require a tag's best taxa to carry this fraction more of its k-mers than "
                          "the runner-up, else the tag is too generic to be evidence. 0 keeps all", false);
    setMinFloat_("species_min_margin", 0.0);
    setMaxFloat_("species_min_margin", 1.0);
    registerFlag_("species_use_gapped",
                  "Let gapped tags contribute taxonomic evidence. Off because a gap is an "
                  "inferred residue pair, and an exact k-mer lookup cannot tell an inferred "
                  "residue from an observed one", false);
    // OPT-IN, on measured evidence rather than preference. On PXD000001 the
    // correction is decisive: the near-neighbour tail turns from Oryza/Zea/Danio
    // into Dickeya/Yersinia/Serratia, which are Pectobacterium's actual
    // relatives. On a human run it is a wash -- Macaca at 93% of Homo is
    // replaced by Chlamydomonas at 92% -- and it drives spiked contaminants
    // down (Sus 1176 -> 0.0, Bos 1199 -> 8.2) that the sample really contains.
    // A default flip needs evidence that holds on both, and this does not.
    registerFlag_("species_deconvolve",
                  "Correct taxon counts for sequence shared between taxa, so a near neighbour "
                  "cannot rank on a relative's evidence. Helps most when the true taxon's "
                  "relatives are in the reference; can suppress genuine low-abundance taxa", false);
    // BEST by default, on measured evidence (48 public runs, FASTag 1.9.0): the
    // union over every reported tag let each wrong tag add the taxa its 7-mer
    // hits by chance, so taxon counts tracked how many low-ranked tags were
    // reported. See SpeciesEvidence.h.
    registerStringOption_("species_evidence", "<mode>", "best",
                          "Which of a spectrum's tags make it count for a taxon: 'best' = the taxa of its "
                          "lowest-E-value tag that maps into the index (ties united); 'all' = the union "
                          "over every reported tag (more chance hits)", false);
    setValidStrings_("species_evidence", ListUtils::create<std::string>("best,all"));
    registerStringOption_("species_rank", "<rank>", "genus",
                          "Report taxa at this NCBI rank (genus, family, ...)", false);
    registerDoubleOption_("max_evalue", "<value>", FASTag::Cli::kMaxEvalue, "E-value cutoff; 0 disables", false);
    setMinFloat_("max_evalue", 0.0);
    registerDoubleOption_("gap_penalty", "<value>", FASTag::Cli::kGapPenalty,
                          "Rank gapped tags as if their E-value were this many times "
                          "worse. Never removes a tag at the -max_evalue cutoff (applied "
                          "to the unpenalised value), but under -max_tags it decides which "
                          "tags fill the capped slots, and a gapped row's printed evalue "
                          "includes it. 1 disables", false);
    setMinFloat_("gap_penalty", 1.0);

    registerDoubleOption_("isobaric_tolerance", "<value>", 0.04,
                          "When matching against -fasta or reconciling against -recon_fasta, "
                          "treat a residue as interchangeable "
                          "with an isobaric residue pair within this tolerance; 0 requires "
                          "exact strings", false);
    setMinFloat_("isobaric_tolerance", 0.0);
    registerIntOption_("min_filter_length", "<n>", 0,
                       "Ignore tags shorter than this when matching against -fasta; "
                       "0 derives a floor from the database size", false);
    setMinInt_("min_filter_length", 0);
    registerStringOption_("orientation", "<mode>", "both",
                          "Match a tag as written, or also reversed, against -fasta and in "
                          "-recon_fasta reconciliation. Tags are stored N->C under a "
                          "y-ion assumption, so b-derived tags read reversed", false);
    setValidStrings_("orientation", ListUtils::create<std::string>("both,forward"));

    // Modifications, resolved through OpenMS ModificationsDB so any UniMod name
    // works, not a fixed list. Fixed mods shift a residue's mass and are not
    // annotated (the shift is implicit, as carbamidomethyl-C conventionally is);
    // variable mods add a modified alternative that is written inline in the tag
    // as X[Name] (e.g. S[Phospho]). Residue-specific mods only -- a terminal mod
    // shifts the whole precursor and so is already carried in the flanking
    // masses, with nothing per-residue to annotate.
    registerStringList_("fixed_modifications", "<mods>",
                        ListUtils::create<std::string>(FASTag::Cli::kFixedModifications),
                        "Fixed modifications by OpenMS/UniMod name, e.g. "
                        "'Carbamidomethyl (C)' 'TMT6plex (K)'. Shift residue masses; "
                        "not annotated in the tag", false);
    registerStringList_("variable_modifications", "<mods>", ListUtils::create<std::string>(""),
                        "Variable modifications by OpenMS/UniMod name, e.g. "
                        "'Phospho (S)' 'Phospho (T)' 'Phospho (Y)' 'Formyl (K)'. "
                        "Add a modified alternative, written inline as X[Name]", false);

    // 1.12 options, one anchored block per cluster in the fixed order E, A, D,
    // F (E data types and acquisition, A identification and search hand-off,
    // D organism and run chemistry, F quality control). A cluster registers
    // its options only inside its own block. The blocks come after every
    // option above, so the order of the existing options, the CTD and the
    // -write_ini output stays as it was. Every new option also reaches the
    // -out_spectra mzML as a "parameter:" userParam.
    // ---- 1.12 E: options ----
    // #7: raw DIA (MS2 whose "precursor" is an isolation window) is refused
    // by default; the probe reads metadata only, before any output opens.
    registerStringOption_("acquisition_check", "<mode>", "refuse",
                          "Check the acquisition before tagging. Raw DIA, whose MS2 'precursors' are "
                          "isolation windows holding several peptides, is refused with exit code 11 "
                          "(refuse), tagged anyway with a warning as before 1.12 (warn), or not "
                          "checked (off). Tag DIA through pseudo-DDA spectra instead: run DIAspeXtract "
                          "(or diaTracer for .d) first; their output passes the check", false);
    setValidStrings_("acquisition_check", ListUtils::create<std::string>("refuse,warn,off"));
    registerIntOption_("acquisition_probe_spectra", "<n>", 4000,
                       "MS2 spectra the acquisition check reads (metadata only) from the start of "
                       "the run, reading at most ten times as many spectra in all; a mixed file is "
                       "judged on these", false, /*advanced=*/true);
    setMinInt_("acquisition_probe_spectra", 1);
    // #9: centroiding of profile MS2 (src/Centroid.h).
    registerStringOption_("pick_profile", "<mode>", FASTag::Centroid::kModeDefault,
                          "Centroid profile MS2 (MS:1000128) with OpenMS PeakPickerHiRes before tagging: "
                          "'legacy' on mzPeak input only (as FASTag 1.11), 'auto' on mzML and mzPeak "
                          "input (not MGF), 'off' never. Centroided MS2 are never re-picked; "
                          "-out_spectra writes the spectra as they were tagged", false);
    setValidStrings_("pick_profile", ListUtils::create<std::string>(FASTag::Centroid::kModeValues));
    registerFlag_("pick_unknown_type",
                  "With -pick_profile auto, also centroid MS2 that declare no spectrum type "
                  "(neither MS:1000127 nor MS:1000128) when OpenMS's PeakTypeEstimator reads "
                  "their data as profile", true);
    // E2: complement-ion rules across fragment charges, tolerance tied to the
    // run. Defaults are FASTag 1.11 (src/CliParam.h); validation decides any
    // other default.
    registerStringOption_("complement_rule", "<rule>", FASTag::Cli::kComplementRule,
                          "Which fragment pairs count as complements in the complement "
                          "subscore: same_charge (both at the fragment charge z, partner "
                          "at M/z + 2p - m), precursor (the partner carries the precursor's "
                          "remaining c - z charges, at (M + c*p - z*m)/(c - z)), or both "
                          "(either rule)", false, true);
    setValidStrings_("complement_rule", ListUtils::create<std::string>("same_charge,precursor,both"));
    registerDoubleOption_("complement_tolerance", "<value>", FASTag::Cli::kComplementTolerance,
                          "Window for a complement partner in Da (used with "
                          "-complement_tolerance_unit Da)", false, true);
    setMinFloat_("complement_tolerance", 1e-9);
    // Its own option, not -complement_tolerance read as k: one value with one
    // default would make "-complement_tolerance_unit fragment" alone run at
    // k = 0.02. The name keeps the --helphelp column at the 1.11 width.
    registerDoubleOption_("complement_tol_factor", "<k>", FASTag::Cli::kComplementTolFactor,
                          "Factor k of the complement window k*(fragment tolerance at the "
                          "peak + at the partner) (used with -complement_tolerance_unit "
                          "fragment)", false, true);
    setMinFloat_("complement_tol_factor", 1e-9);
    // "<u>", not "<unit>": the longest option-and-argument column of the
    // --helphelp listing must stay the 1.11 width, or every line reflows.
    registerStringOption_("complement_tolerance_unit", "<u>", FASTag::Cli::kComplementToleranceUnit,
                          "Da: the window is -complement_tolerance. fragment: "
                          "-complement_tol_factor scales the run's -fragment_tolerance at "
                          "both partners", false, true);
    setValidStrings_("complement_tolerance_unit", ListUtils::create<std::string>("Da,fragment"));
    registerFlag_("complement_midp",
                  "Score complements with DirecTag's hypergeometric mid-p P(X>c) + P(X=c)/2 "
                  "for tags with 0 or 1 complemented peaks; 2 or more keep P(X>=c)", true);
    // #6: precursor charge and isotope hypotheses (src/PrecursorHypotheses.h).
    // Defaults are FASTag 1.11: uncharged precursors are tagged as 2+, no
    // isotope offset; validation decides any other default.
    registerStringOption_("unknown_charge", "<mode>", FASTag::Hyp::kModeDefault,
                          "How a precursor without a charge is tagged: assume2 (as 2+, as before "
                          "1.12), enumerate (at each listed possible charge, else at every charge "
                          "-charge_min..-charge_max) or infer (at the charge its complement pairs "
                          "support; both of two close calls; 1+ when 1 is a candidate and almost no "
                          "intensity lies above the precursor; without evidence 2+, or the lowest "
                          "candidate when 2 is none). Every charge tagged is a listed possible charge, "
                          "else one of -charge_min..-charge_max. With several, E-values are multiplied "
                          "by their number and the reports count the charge-evidence choice only. A "
                          "header charge is never replaced (except by -check_header_charge override)", false);
    setValidStrings_("unknown_charge", ListUtils::create<std::string>(FASTag::Hyp::kModeValues));
    registerIntOption_("charge_min", "<n>", FASTag::Hyp::kChargeMinDefault,
                       "Lowest charge -unknown_charge enumerate or infer tries (1 enables infer's "
                       "1+ test)", false);
    setMinInt_("charge_min", 1);
    setMaxInt_("charge_min", FASTag::Hyp::kChargeLimit);
    registerIntOption_("charge_max", "<n>", FASTag::Hyp::kChargeMaxDefault,
                       "Highest charge -unknown_charge enumerate or infer tries", false);
    setMinInt_("charge_max", 1);
    setMaxInt_("charge_max", FASTag::Hyp::kChargeLimit);
    registerDoubleOption_("charge_infer_margin", "<value>", FASTag::Hyp::kInferMarginDefault,
                          "Complement-pair excess by which the inferred charge must beat the "
                          "runner-up to be tagged alone; closer, both are tagged (ambiguous). Any "
                          "excess above 0 is a call", false, true);
    setMinFloat_("charge_infer_margin", 0.0);
    registerIntList_("isotope_error", "<k>", ListUtils::create<Int>("0"),
                     "Precursor isotope offsets (-1..3) to consider: the precursor mass is "
                     "lowered by k x 1.00336 Da, for every precursor; each charge is tagged at "
                     "the offset its complement pairs support best. Needs a fragment tolerance "
                     "below 0.05 Da", false, true);
    setMinInt_("isotope_error", FASTag::Hyp::kIsotopeMin);
    setMaxInt_("isotope_error", FASTag::Hyp::kIsotopeMax);
    // 1.13 (backlog #14): re-check header charges against the infer call.
    registerStringOption_("check_header_charge", "<mode>", FASTag::Hyp::kHeaderCheckDefault,
                          "Check every precursor charge the file gives against the charge its "
                          "complement pairs support (the -unknown_charge infer call over "
                          "-charge_min..-charge_max and the header charge): off (the default), warn "
                          "(count and report disagreements, tag at the header charge) or override "
                          "(tag a disagreeing spectrum at the supported charge; charge_src "
                          "'overridden'). Experimental", false, true);
    setValidStrings_("check_header_charge", ListUtils::create<std::string>(FASTag::Hyp::kHeaderCheckValues));
    registerDoubleOption_("check_header_margin", "<value>", FASTag::Hyp::kHeaderMarginDefault,
                          "Complement-pair excess by which the supported charge must beat the header "
                          "charge's own for -check_header_charge to call a disagreement", false, true);
    setMinFloat_("check_header_margin", 0.0);
    registerOutputFile_("check_header_out", "<file>", "",
                        "-check_header_charge: one row per header-charged MS2 spectrum (header "
                        "charge, call, evidence, verdict)", false, true);
    setValidFormats_("check_header_out", ListUtils::create<std::string>("tsv"));
    // #15 phase B: c/z-dot ions for electron activation (src/IonSeries.h).
    // Default by is FASTag 1.11; validation decides any other default.
    registerStringOption_("ion_series", "<mode>", FASTag::IonSeries::kModeDefault,
                          "Ion series the MS2 spectra are read as: by (b/y ions, as before 1.12), cz "
                          "(c/z-dot ions of electron transfer or capture dissociation, ETD/ECD), or auto "
                          "(c/z-dot for spectra whose activation is ETD or ECD, b/y for all others, hybrid "
                          "EThcD/ETciD included). Under cz and auto the tag TSV gains an ion_series column "
                          "when some spectrum can be read as c/z", false);
    setValidStrings_("ion_series", ListUtils::create<std::string>(FASTag::IonSeries::kModeValues));
    // ---- 1.12 A: options ----
    // #5: ranked protein shortlist, reduced FASTA and a search-engine
    // configuration from the tag placements. A search-space reduction, NOT an
    // identification, NOT protein inference and NOT FDR-controlled. Every
    // option is empty or off by default; without the three outputs nothing
    // below runs.
    registerOutputFile_("shortlist_out", "<file>", "",
                        "Ranked protein shortlist from the tag placements on -recon_fasta (or -fasta): "
                        "spectra, peptides, shared-spectrum weight and best E-value per protein, and "
                        "whether it is kept. A search-space reduction, NOT FDR-controlled", false);
    setValidFormats_("shortlist_out", ListUtils::create<std::string>("tsv"));
    registerOutputFile_("fasta_out", "<file>", "",
                        "Reduced FASTA: the shortlisted proteins of the database (no decoys; let the "
                        "search engine generate them), then -shortlist_background", false);
    setValidFormats_("fasta_out", ListUtils::create<std::string>("fasta"));
    registerInputFile_("shortlist_background", "<file>", "",
                       "Proteins always appended to -fasta_out (host proteome, contaminants); decoys "
                       "and entries already in the database are left out", false);
    setValidFormats_("shortlist_background", ListUtils::create<std::string>("fasta"));
    registerDoubleOption_("shortlist_max_evalue", "<f>", 0.1,
                          "E-value a tag needs for its placements to count for the shortlist", false, true);
    setMinFloat_("shortlist_max_evalue", 0.0);
    registerIntOption_("shortlist_min_spectra", "<n>", 2,
                       "Spectra a protein needs to be kept", false, true);
    setMinInt_("shortlist_min_spectra", 1);
    registerFlag_("shortlist_gapped",
                  "Let placements with one mismatched flank (a mass gap) count for the shortlist; "
                  "by default only exact ones count (a gap equal to a fixed terminal label is exact)");
    registerStringOption_("shortlist_parsimony", "<mode>", "none",
                          "'none' keeps every protein above -shortlist_min_spectra; 'subset' drops a "
                          "protein whose spectra a higher-ranked kept one has; 'greedy' keeps a greedy "
                          "set cover of the spectra", false);
    setValidStrings_("shortlist_parsimony", ListUtils::create<std::string>("none,subset,greedy"));
    registerIntOption_("shortlist_top", "<n>", 0,
                       "Keep at most this many proteins, ties at the cut kept; 0 = no cap", false, true);
    setMinInt_("shortlist_top", 0);
    registerStringList_("shortlist_decoy_affix", "<list>",
                        ListUtils::create<std::string>("DECOY_,decoy_,rev_,REV_,reverse_,XXX_,shuffled_,random_,_DECOY,_rev"),
                        "Accession prefixes (ending in _) and suffixes (starting with _) that mark a decoy "
                        "entry, case-insensitive; decoys never enter the shortlist or -fasta_out", false, true);
    registerFlag_("shortlist_force",
                  "Write -fasta_out and -search_config_out although the tag ends call a protease the "
                  "tryptic placement does not fit", true);
    registerOutputFile_("search_config_out", "<file>", "",
                        "Search-engine configuration for -fasta_out (or the input database): Sage JSON, or "
                        "Comet parameters (merged into -search_config_template when given)", false);
    registerStringOption_("search_engine", "<engine>", "sage", "Engine of -search_config_out", false);
    setValidStrings_("search_engine", ListUtils::create<std::string>("sage,comet"));
    registerInputFile_("search_config_template", "<file>", "",
                       "Comet only: a `comet -p` parameter file the managed keys are merged into", false);
    registerDoubleOption_("search_precursor_tolerance", "<f>", 10.0,
                          "Precursor tolerance written to -search_config_out", false);
    setMinFloat_("search_precursor_tolerance", 0.0);
    registerStringOption_("search_precursor_unit", "<unit>", "ppm",
                          "Unit of -search_precursor_tolerance", false);
    setValidStrings_("search_precursor_unit", ListUtils::create<std::string>("ppm,Da"));
    registerIntOption_("search_isotope_errors", "<n>", 0,
                       "Precursor isotope errors 0..n the engine searches; 0 = none", false);
    setMinInt_("search_isotope_errors", 0);
    setMaxInt_("search_isotope_errors", 3);
    registerStringOption_("search_decoy_prefix", "<s>", "",
                          "Decoy prefix the engine generates; empty = rev_ (Sage) or DECOY_ (Comet)", false);
    // #17: the run's mass-gap peaks (the -massgap_out peaks) as variable
    // modifications or Comet mass offsets in -search_config_out. Candidates
    // for an FDR-controlling engine, NOT identifications. Off by default.
    registerStringOption_("search_shifts", "<mode>", "none",
                          "Add the run's mass-gap peaks to -search_config_out: 'variable' as variable "
                          "modifications, 'offsets' as Comet mass offsets, 'both'. Isotope errors, fixed "
                          "labels and caps are applied; -search_shifts_out lists every decision. "
                          "Experimental", false);
    setValidStrings_("search_shifts", ListUtils::create<std::string>("none,variable,offsets,both"));
    registerOutputFile_("search_shifts_out", "<file>", "",
                        "One row per mass-gap peak: its explanation and what -search_shifts did with it", false);
    setValidFormats_("search_shifts_out", ListUtils::create<std::string>("tsv"));
    registerIntOption_("shift_max_variable", "<n>", 3,
                       "Mass-gap peaks exported as variable modifications, most spectra first", false, true);
    setMinInt_("shift_max_variable", 0);
    registerIntOption_("shift_max_offsets", "<n>", 10,
                       "Mass-gap peaks exported as Comet mass offsets besides 0, most spectra first", false, true);
    setMinInt_("shift_max_offsets", 0);
    registerFlag_("shift_expand_sites",
                  "Add the residues -recon_localize places a variable shift on (unique sites only) to "
                  "that modification", true);
    registerDoubleOption_("shift_site_min_share", "<f>", 0.2,
                          "Share of a peak's localized samples a residue needs for -shift_expand_sites", false, true);
    setMinFloat_("shift_site_min_share", 0.0);
    setMaxFloat_("shift_site_min_share", 1.0);
    registerIntOption_("shift_site_min_count", "<n>", 10,
                       "Localized samples a residue needs for -shift_expand_sites", false, true);
    setMinInt_("shift_site_min_count", 1);
    registerIntOption_("shift_site_min_ions", "<n>", 2,
                       "b/y ions a localized sample needs to count for -shift_expand_sites", false, true);
    setMinInt_("shift_site_min_ions", 1);
    // ---- 1.12 D: options ----
    // #1 calibrated species presence or abstention (src/SpeciesCall.h). Off
    // by default: at 'none' nothing of it runs and the report is 1.11's. A
    // default flip needs the held-out acceptance and a user decision.
    registerStringOption_("species_call", "<mode>", "none",
                          "Call each taxon of the -species report present, no_call or not_detected: "
                          "'decoy' tests its count against a null of decoy tags (looked up like the "
                          "tags) plus the spill expected from stronger related taxa, and appends the "
                          "columns call, call_reason, decoy_spectra, decoy_expected, decoy_qvalue, "
                          "share and lod. 'none' = the ranked report only", false, true);
    setValidStrings_("species_call", ListUtils::create<std::string>("none,decoy"));
    registerInputFile_("species_call_params", "<file>", "",
                       "Decision parameters of -species_call decoy (alpha, tau, n_min). Default: "
                       "species_call.tsv in the taxonomy directory", false, true);
    setValidFormats_("species_call_params", ListUtils::create<std::string>("tsv"));
    registerIntOption_("species_call_min_units", "<n>", 200,
                       "Fewer spectra with taxon evidence than this make -species_call decoy a "
                       "run-level no_call (few_spectra)", false, true);
    setMinInt_("species_call_min_units", 0);
    registerIntOption_("species_call_decoys", "<n>", 5,
                       "Decoy tags per tag for -species_call decoy", false, true);
    setMinInt_("species_call_decoys", 1);
    setMaxInt_("species_call_decoys", 100);
    registerDoubleOption_("species_pi0", "<f>", 1.0,
                          "Proportion of null taxa for the -species_call q-values: 1 = "
                          "Benjamini-Hochberg; 0 estimates it from the run (Storey)", false, true);
    setMinFloat_("species_pi0", 0.0);
    setMaxFloat_("species_pi0", 1.0);
    // #10 species lookup in both tag orientations (SpeciesEvidence.h
    // combineOrientations). Forward by default: the report is 1.11's. Not
    // coupled to -orientation (default both), which would change it.
    registerStringOption_("species_orientation", "<mode>", "forward",
                          "Which readings of a tag -species looks up: 'forward' = as written; 'both' = "
                          "also reversed (a tag read from b ions is written reversed), using the one "
                          "informative reading, or the taxa both share; a tag whose two readings share "
                          "none is skipped. Independent of -orientation, which applies to -fasta and "
                          "-recon_fasta only. Under 'both' the analytic log_pvalue and qvalue columns are NA "
                          "(no analytic background follows); only decoy_qvalue and call from "
                          "-species_call decoy are calibrated", false, true);
    setValidStrings_("species_orientation", ListUtils::create<std::string>("forward,both"));
    // #3c-#3f chemistry v2 for -digest_out (src/Digest.h). Off by default: at
    // these defaults -digest_out is 1.11's. Not validated on held-out data;
    // the shipped v2 table and calibration are unfitted priors until the DEV
    // regeneration on the release candidate.
    registerStringOption_("digest_models_version", "<v>", "shipped",
                          "Shipped protease models of -digest_out: 'shipped' (1.11) or 'v2' (detection, "
                          "LysargiNase and Asp-N_ambic rows, pooled specificity; not validated on held-out data)",
                          false, true);
    setValidStrings_("digest_models_version", ListUtils::create<std::string>("shipped,v2"));
    registerStringOption_("digest_detection", "<mode>", "none",
                          "Per-instrument detection weights of -digest_out from the model table: 'shipped' "
                          "applies them and calls timsTOF runs instead of withholding them (needs a v2 table; "
                          "not validated on held-out data); 'none' = 1.11",
                          false, true);
    setValidStrings_("digest_detection", ListUtils::create<std::string>("none,shipped"));
    registerStringOption_("digest_flank2", "<mode>", "off",
                          "Two-residue flank model of -digest_out: 'auto' scores the flank sums m(P2) + m(P1) when "
                          "the P1 counts are too few or y1 is cut off (not validated on held-out data); 'off' = 1.11",
                          false, true);
    setValidStrings_("digest_flank2", ListUtils::create<std::string>("off,auto"));
    registerDoubleOption_("digest_min_confidence", "<f>", 0.0,
                          "Withhold a -digest_out call whose calibrated p_correct is below this (no_call "
                          "low_confidence); 0 = off. Not validated on held-out data", false, true);
    setMinFloat_("digest_min_confidence", 0.0);
    setMaxFloat_("digest_min_confidence", 1.0);
    registerInputFile_("digest_calibration", "<file>", "",
                       "Calibration of p_correct for -digest_out (columns feature, coef). Default: the shipped "
                       "digest_calibration.tsv when p_correct is written", false, true);
    setValidFormats_("digest_calibration", ListUtils::create<std::string>("tsv"));
    // #3g the alkylation call (src/AlkylationCall.h), from the reconciler's
    // placements. Opt-in; every other output is the same with or without it.
    registerOutputFile_("alkylation_out", "<file>", "",
                        "Report which reagent alkylated the cysteines (or none), from the placements of "
                        "single-Cys peptides on -recon_fasta or -alkylation_proteome: Cys form counts and "
                        "the call (not validated on held-out data)", false);
    setValidFormats_("alkylation_out", ListUtils::create<std::string>("tsv"));
    registerStringOption_("alkylation_proteome", "<name>", "auto",
                          "Database of -alkylation_out without -recon_fasta: a FASTA file (.gz allowed). The names "
                          "auto (= human), human, mouse, yeast and ecoli stand for shipped proteomes, which 1.12.0 "
                          "does not ship: they stop with exit code 6, so give a FASTA file here or -recon_fasta",
                          false, true);
    registerIntOption_("alkylation_min_spectra", "<n>", 10,
                       "Spectra the -alkylation_out call needs, binned and for the called class", false, true);
    setMinInt_("alkylation_min_spectra", 1);
    registerDoubleOption_("alkylation_min_share", "<f>", 0.6,
                          "Share of the binned spectra the -alkylation_out call needs", false, true);
    setMinFloat_("alkylation_min_share", 0.0);
    setMaxFloat_("alkylation_min_share", 1.0);
    registerDoubleOption_("alkylation_window", "<Da>", 0.0,
                          "Window of -alkylation_out around each Cys form mass; 0 = 0.02 Da on a ppm run, "
                          "0.5 Da on a run with a Da fragment tolerance", false, true);
    setMinFloat_("alkylation_window", 0.0);
    // ---- 1.12 F: options ----
    // #11 phase A: the per-spectrum census. Opt-in; every other output is
    // the same with or without it (src/Census.h).
    registerFlag_("census",
                  "Write a census: one row per MS2 spectrum read (status, peak and tag "
                  "facts, tagged or not) to <out> with its extension replaced by "
                  ".census.tsv, and a run summary to .census_summary.tsv. A status "
                  "is not a quality call. Subsampling counts input spectra of all "
                  "MS levels");
    registerOutputFile_("census_out", "<file>", "",
                        "Per-spectrum census table. Default: <out> with its "
                        "extension replaced by .census.tsv", false);
    setValidFormats_("census_out", ListUtils::create<std::string>("tsv"));
    registerOutputFile_("census_summary_out", "<file>", "",
                        "Census run summary (section, key, value, n, description). "
                        "Default: <out> with its extension replaced by "
                        ".census_summary.tsv", false);
    setValidFormats_("census_summary_out", ListUtils::create<std::string>("tsv"));
    // #11 phase B: the ids join (src/CensusIds.h). Without -census_ids the
    // census is phase A's, byte for byte.
    registerInputFile_("census_ids", "<file>", "",
                       "Identifications of -in (idXML or mzid) for -census: adds the columns identified "
                       "(1, 0, empty = unknown) and triage, and a census_ids section to the summary. A "
                       "spectrum is identified by a target hit whose q-value passes -census_ids_fdr; a "
                       "file without q-values is refused (filter it with IDFilter first)", false);
    setValidFormats_("census_ids", ListUtils::create<std::string>("idXML,mzid"));
    registerDoubleOption_("census_ids_fdr", "<f>", FASTag::CensusIds::kDefaultFdr,
                          "q-value a target hit of -census_ids needs to identify its spectrum", false, true);
    setMinFloat_("census_ids_fdr", 0.0);
    setMaxFloat_("census_ids_fdr", 1.0);
    registerDoubleOption_("census_triage_evalue", "<f>", FASTag::CensusIds::kDefaultTriageEvalue,
                          "best_evalue at or below which an unidentified tagged or placed spectrum is a "
                          "triage candidate (an E-value threshold, not a quality call)", false, true);
    setMinFloat_("census_triage_evalue", 0.0);
    // ---- 1.12 G: options ----
    // G1: the two machine interfaces of the desktop GUI (src/InputProbe.h).
    // Each prints JSON lines to stdout, writes no file and exits without
    // tagging; the GUI finds them in --helphelp. Empty (the default) runs
    // FASTag as before.
    registerInputFile_("probe_input", "<file>", "",
                       "Print the metadata of this spectra file (mzML, mzpeak or MGF) as JSON lines "
                       "and exit: instrument and MS2 analyzer, activation, spectrum counts, "
                       "centroid/profile, mzML index state, the acquisition check's call and, with "
                       "-fasta, its protein and decoy counts. A FASTA file (.fasta, .fa, .faa, .fas) alone gives "
                       "only those counts. Reads metadata only; needs no -in or -out",
                       false, true);
    registerStringOption_("dump_spectrum", "<nativeId>", "",
                          "Print the peaks FASTag tags of the spectrum of -in with this native ID (after "
                          "centroiding, the precursor cut, deisotoping and the peak budget, under the "
                          "options given) as JSON lines and exit; needs no -out. Prepares the "
                          "given precursor at its charge (or 2+) only",
                          false, true);
  }

  /// True when option @p name holds a value other than its registered
  /// default, read through the typed getter of its registered type: a flag
  /// when given, a number when it differs, a string (or file path) when it
  /// differs, so an empty-default path when it is set. Used by the
  /// table-driven -stream refusals and the ignored-option warnings.
  bool optionNonDefault_(const std::string& name) const
  {
    const ParameterInformation& e = findEntry_(name);
    switch (e.type)
    {
      case ParameterInformation::FLAG: return getFlag_(name);
      case ParameterInformation::INT: return getIntOption_(name) != static_cast<int>(e.default_value);
      case ParameterInformation::DOUBLE: return getDoubleOption_(name) != static_cast<double>(e.default_value);
      case ParameterInformation::INTLIST: return getIntList_(name) != e.default_value.toIntVector();
      default: return getStringOption_(name) != static_cast<std::string>(e.default_value);
    }
  }

  /// True when option @p name is registered in this build and holds a value
  /// other than its default (optionNonDefault_, plus integer lists). False
  /// for a name this build does not register.
  bool registeredNonDefault_(const std::string& name) const
  {
    const ParameterInformation* e = nullptr;
    try { e = &findEntry_(name); }
    catch (const Exception::UnregisteredParameter&) { return false; }
    if (e->type == ParameterInformation::INTLIST) return getIntList_(name) != e->default_value.toIntVector();
    return optionNonDefault_(name);
  }

  /// Default report path: @p out with its extension replaced by @p suffix --
  /// only if the dot is in the FILE NAME. `-out /tmp/run.v1/tags` has its
  /// last dot in the directory, and cutting there would write elsewhere.
  static std::string defaultReportPath(const std::string& out, const char* suffix)
  {
    const size_t slash = out.find_last_of("/\\");
    const size_t dot = out.rfind('.');
    const bool ext = dot != std::string::npos && (slash == std::string::npos || dot > slash);
    return (ext ? out.substr(0, dot) : out) + suffix;
  }

  /// Append free text as one TSV field: a tab, CR or LF (an mzML id may
  /// carry them as &#9; / &#10;) would shift columns or split the row.
  static void appendField(std::string& buf, const std::string& text)
  {
    if (text.find_first_of("\t\r\n") == std::string::npos) { buf += text; return; }
    for (char c : text) buf += (c == '\t' || c == '\r' || c == '\n') ? ' ' : c;
  }

  /// The tag TSV header line, matching appendTagRow's columns.
  /// @p hyp (1.12 #6, non-default -unknown_charge or -isotope_error only)
  /// adds the hypothesis columns after the other optional ones; @p
  /// ion_series (1.12 #15 phase B) the ion_series column after those.
  static std::string tagHeader(bool proforma, bool res_conf, bool usi, bool hyp = false, bool ion_series = false)
  {
    std::string h = "spectrum\ttag\tlength\tcharge\tnterm_mass\tcterm_mass\textended"
                    "\tgapped\tevalue\tmin_conf\tmean_conf\tfasta_hit";
    if (proforma) h += "\tproforma";
    if (res_conf) h += "\tres_conf";
    if (usi) h += "\tusi";
    if (hyp) h += "\tprec_charge\tcharge_src\tiso_offset\tselected";
    if (ion_series) h += "\tion_series";  // 1.12 #15 phase B: after #6's, by or cz
    return h + "\n";
  }

  /// One TSV row for one tag, appended to buf. File mode and -stream both call
  /// this, so the two formats cannot drift. readSpeciesFields() reads columns
  /// back out of these rows and must change with them.
  //
  // Appended field by field, so a very long native ID needs no fixed-buffer
  // fallback. Flanking masses at 4 decimals (0.1 mDa) -- %g's 6 significant
  // digits are coarser than the tolerance the tag was found with, and these
  // are what a downstream search constrains on. Numbers go through appendNum,
  // not snprintf: the same text as "%.4f" / "%g" / "%.3f", without the locale
  // lock every worker queues on in macOS's printf (NumFormat.h).
  static void appendTagRow(std::string& buf, const FASTag::Tag& t,
                           const std::string& native_id, const char* hit,
                           bool want_proforma, const std::string& proforma_fixed,
                           bool want_res_conf, const std::string& usi = std::string(),
                           const FASTag::Hyp::Hypothesis* hyp = nullptr,
                           bool want_series = false)
  {
    using FASTag::appendNum;
    constexpr auto fixed = std::chars_format::fixed;
    appendField(buf, native_id); buf += '\t';
    buf += t.seq;              buf += '\t';
    appendNum(buf, t.n_res);   buf += '\t';
    appendNum(buf, t.charge);  buf += '\t';
    if (g_full_precision)
    {
      FASTag::appendShortest(buf, t.nterm_mass); buf += '\t';
      FASTag::appendShortest(buf, t.cterm_mass); buf += '\t';
    }
    else
    {
      appendNum(buf, t.nterm_mass, fixed, 4); buf += '\t';
      appendNum(buf, t.cterm_mass, fixed, 4); buf += '\t';
    }
    buf += t.extended ? '1' : '0'; buf += '\t';
    buf += t.gapped ? '1' : '0';   buf += '\t';
    if (g_full_precision) FASTag::appendShortest(buf, t.evalue);
    else appendNum(buf, t.evalue, std::chars_format::general, 6);
    buf += '\t';
    appendNum(buf, t.min_conf, fixed, 3);  buf += '\t';
    appendNum(buf, t.mean_conf, fixed, 3); buf += '\t';
    buf += hit;
    if (want_proforma) { buf += '\t'; buf += FASTag::toProforma(t.seq, t.nterm_mass, t.cterm_mass, proforma_fixed); }
    if (want_res_conf)
    {
      buf += '\t';
      for (size_t i = 0; i < t.res_conf.size(); ++i)
      {
        if (i) buf += ' ';
        appendNum(buf, static_cast<int>(t.res_conf[i]));
      }
    }
    if (!usi.empty()) { buf += '\t'; buf += usi; }
    if (hyp)
    {
      // 1.12 #6: the hypothesis the row was tagged under.
      buf += '\t'; appendNum(buf, hyp->charge);
      buf += '\t'; buf += FASTag::Hyp::sourceName(hyp->src);
      buf += '\t'; appendNum(buf, hyp->iso);
      buf += '\t'; buf += hyp->selected ? '1' : '0';
    }
    if (want_series) { buf += '\t'; buf += FASTag::IonSeries::seriesName(t.ion_series); }
    buf += '\n';
  }

  /// Reads back, from one appendTagRow line [start, nl) of @p r, the columns
  /// species detection needs: 0 (spectrum id), 1 (tag), 7 (gapped) and 8
  /// (E-value). Must change whenever appendTagRow's column order does. The
  /// printed E-value is parsed on purpose, not the tag's double, so ties are
  /// those of the TSV. @p gapped and @p evalue stay false and NaN when the
  /// line lacks those columns.
  /// @return false when the line has no tag column.
  static bool readSpeciesFields(const std::string& r, size_t start, size_t nl, std::string& id,
                                std::string& tag, bool& gapped, double& evalue)
  {
    const size_t t1 = r.find('\t', start);
    if (t1 == std::string::npos || t1 >= nl) return false;
    const size_t t2 = r.find('\t', t1 + 1);
    if (t2 == std::string::npos || t2 > nl) return false;
    id = r.substr(start, t1 - start);
    tag = r.substr(t1 + 1, t2 - t1 - 1);
    gapped = false;
    evalue = std::numeric_limits<double>::quiet_NaN();
    size_t f = t2, col = 2;
    while (col < 7 && f != std::string::npos && f < nl) { f = r.find('\t', f + 1); ++col; }
    if (f != std::string::npos && f + 1 < nl)
    {
      gapped = (r[f + 1] == '1');
      const size_t fe = r.find('\t', f + 1);
      // Written by appendNum (to_chars: '.', no locale) and read back by
      // strtod in the process's C locale -- FASTag never calls setlocale.
      if (fe != std::string::npos && fe + 1 < nl) evalue = std::strtod(r.c_str() + fe + 1, nullptr);
    }
    return true;
  }

  /// ProForma global fixed-modification prefix: each fixed residue
  /// modification becomes `<[Name]@Residue>`. Fixed mods change residue
  /// masses but are NOT in the tag sequence, so a bare `C` is really
  /// carbamidomethyl-C; the prefix declares that for the whole proteoform.
  /// Built from the resolved modifications, so terminal ones (absorbed into
  /// the flanking masses, see resolveMods_) are left out.
  static std::string buildProformaPrefix(const std::vector<FASTag::ModSpec>& mods)
  {
    std::string out;
    for (const FASTag::ModSpec& m : mods)
      if (!m.variable) out += "<[" + m.name + "]@" + m.residue + ">";
    return out;
  }

  /// Resolve OpenMS/UniMod modification names to FASTag::ModSpec via
  /// ModificationsDB. Terminal mods are skipped with a note -- they are absorbed
  /// into the reported flanking masses, not the internal residue alphabet.
  /// Peptide-terminal ones on any residue are summed into @p term_n / @p term_c
  /// when given (the -recon_localize fragment ladder needs them).
  /// @p kept receives the full ID of every residue modification added to @p out.
  /// @return false if a name is not in ModificationsDB (logged): a typo must
  ///   not run with the wrong chemistry and exit 0.
  bool resolveMods_(const StringList& names, bool variable, std::vector<FASTag::ModSpec>& out,
                    StringList& kept, double* term_n = nullptr, double* term_c = nullptr)
  {
    bool all_known = true;
    // Fetched on the first name, not up front: building the database parses
    // all of UniMod, 0.04 s of serial start-up that a run naming no
    // modification (-fixed_modifications "") never uses.
    const ModificationsDB* db = nullptr;
    for (const std::string& nm : names)
    {
      if (nm.empty()) continue;
      if (!db) db = ModificationsDB::getInstance();
      const ResidueModification* mod = nullptr;
      try { mod = db->getModification(nm); }
      catch (Exception::BaseException&)
      {
        OPENMS_LOG_ERROR << "Unknown modification '" << nm << "' (not in OpenMS's "
                            "ModificationsDB; names look like 'Oxidation (M)')." << std::endl;
        all_known = false;
        continue;
      }
      if (!mod) continue;
      if (mod->getTermSpecificity() != ResidueModification::ANYWHERE)
      {
        OPENMS_LOG_INFO << "Modification '" << nm << "' is terminal; it is absorbed "
                           "into the reported flanking masses and not annotated "
                           "per-residue." << std::endl;
        if (term_n && mod->getOrigin() == 'X')
        {
          if (mod->getTermSpecificity() == ResidueModification::N_TERM)
            *term_n += mod->getDiffMonoMass();
          else if (mod->getTermSpecificity() == ResidueModification::C_TERM)
            *term_c += mod->getDiffMonoMass();
        }
        continue;
      }
      const char origin = mod->getOrigin();
      if (origin < 'A' || origin > 'Z')
      {
        OPENMS_LOG_WARN << "Modification '" << nm << "' has no single-residue origin; "
                           "ignoring." << std::endl;
        continue;
      }
      FASTag::ModSpec ms;
      ms.residue = (origin == 'I') ? 'L' : origin;  // I is folded to L in the alphabet
      ms.delta = mod->getDiffMonoMass();
      ms.name = mod->getId();
      ms.variable = variable;
      out.push_back(ms);
      kept.push_back(mod->getFullId());
    }
    return all_known;
  }

  FILE* stream_data_ = nullptr;  ///< the REAL stdout in -stream mode

  /// The exit code of a G1 mode's status (src/InputProbe.h).
  ExitCodes probeExit_(FASTag::Probe::Status s) const
  {
    using S = FASTag::Probe::Status;
    switch (s)
    {
      case S::Ok: return EXECUTION_OK;
      case S::Unsupported: return ILLEGAL_PARAMETERS;
      case S::NotReadable: return INPUT_FILE_NOT_READABLE;
      case S::Empty: return INPUT_FILE_EMPTY;
      case S::Corrupt: break;
    }
    return INPUT_FILE_CORRUPT;
  }

  /// Writes @p jsonl to the sealed stdout; false when that fails.
  bool writeGuiStream_(const std::string& jsonl)
  {
    if (!stream_data_) return false;
    const bool ok = std::fwrite(jsonl.data(), 1, jsonl.size(), stream_data_) == jsonl.size();
    return std::fflush(stream_data_) == 0 && ok;
  }

  /// 1.12 G1 -probe_input: the input's metadata as JSON lines, nothing else.
  ExitCodes probeInputMode_()
  {
    namespace P = FASTag::Probe;
    P::ProbeOptions opt;
    opt.probe_spectra = static_cast<std::size_t>(getIntOption_("acquisition_probe_spectra"));
    opt.mzpeak_threads = std::min(std::max(1, omp_get_max_threads()), 8);
    FASTag::Centroid::parseMode(getStringOption_("pick_profile"), opt.pick_mode);
    opt.pick_unknown_type = getFlag_("pick_unknown_type");
    opt.acquisition_check = getStringOption_("acquisition_check");
    opt.fasta = getStringOption_("fasta");
    for (const std::string& a : getStringList_("shortlist_decoy_affix"))
      if (!a.empty()) opt.decoy_affixes.push_back(a);
    opt.version = FASTAG_VERSION;
    const std::string file = getStringOption_("probe_input");
    const P::ProbeOutput r = P::probeInput(file, opt);
    if (r.status != P::Status::Ok)
    {
      OPENMS_LOG_ERROR << "-probe_input: " << r.error << std::endl;
      return probeExit_(r.status);
    }
    if (!writeGuiStream_(r.jsonl))
    {
      OPENMS_LOG_ERROR << "-probe_input: cannot write to stdout." << std::endl;
      return CANNOT_WRITE_OUTPUT_FILE;
    }
    return EXECUTION_OK;
  }

  /// 1.12 G1 -dump_spectrum: one spectrum's tagged peaks as JSON lines.
  ExitCodes dumpSpectrumMode_(const std::string& in, const FASTag::Param& p)
  {
    namespace P = FASTag::Probe;
    if (!getStringOption_("out").empty())
      OPENMS_LOG_WARN << "-dump_spectrum writes no file; -out and every other output are ignored." << std::endl;
    // The dump prepares the peaks at the 1.11 precursor rule: the header m/z,
    // its charge or else 2. Options that tag a spectrum at other precursor
    // hypotheses (1.12 #6: -unknown_charge, -isotope_error) would make those
    // peaks and that charge not the ones tagged, so the dump refuses them
    // until it follows the selected hypothesis. They are looked up by name:
    // in a build without #6 they are not registered and nothing is refused.
    for (const char* name : {"unknown_charge", "isotope_error"})
    {
      if (!registeredNonDefault_(name)) continue;
      OPENMS_LOG_ERROR << "-dump_spectrum prepares the peaks at the given precursor and its charge (or 2+) "
                          "only and does not follow -" << name << " yet; leave -unknown_charge and "
                          "-isotope_error at their defaults." << std::endl;
      return ILLEGAL_PARAMETERS;
    }
    // 1.13: override can tag a spectrum at another charge than its header's.
    if (registeredNonDefault_("check_header_charge") && getStringOption_("check_header_charge") == "override")
    {
      OPENMS_LOG_ERROR << "-dump_spectrum prepares the peaks at the given precursor and its charge only and does "
                          "not follow -check_header_charge override yet; leave it off or at warn." << std::endl;
      return ILLEGAL_PARAMETERS;
    }
    P::DumpOptions opt;
    FASTag::Centroid::parseMode(getStringOption_("pick_profile"), opt.pick_mode);
    opt.pick_unknown_type = getFlag_("pick_unknown_type");
    opt.mzpeak_threads = std::min(std::max(1, omp_get_max_threads()), 8);
    opt.param = p;
    opt.ion_mode = FASTag::IonSeries::modeFromString(getStringOption_("ion_series"));
    const std::string id = getStringOption_("dump_spectrum");
    const P::DumpOutput r = P::dumpSpectrum(in, id, opt);
    if (r.status != P::Status::Ok)
    {
      OPENMS_LOG_ERROR << "-dump_spectrum: " << r.error << std::endl;
      return probeExit_(r.status);
    }
    if (!r.found)
    {
      OPENMS_LOG_ERROR << "-dump_spectrum: no spectrum of '" << in << "' has the native ID '" << id << "'."
                       << std::endl;
      return ILLEGAL_PARAMETERS;
    }
    if (!writeGuiStream_(r.jsonl))
    {
      OPENMS_LOG_ERROR << "-dump_spectrum: cannot write to stdout." << std::endl;
      return CANNOT_WRITE_OUTPUT_FILE;
    }
    return EXECUTION_OK;
  }

  ExitCodes main_(int, const char**) override
  {
    // The phases of a run, in order; each starts at a "// ---- phase N" banner:
    //   (1) option checks, refusals and tagging parameters
    //   (2) report setup: digest, label and mass-gap tables, run rows
    //   (3) -stream mode, which returns early
    //   (4) opening the input and choosing the reader
    //   (5) the tolerance probe and the output collision check
    //   (6) the tagging loop: block ring, writer and per-spectrum work
    //   (7) q_db post-pass
    //   (8) glyco summary and reconciliation outputs
    //   (9) digest and label reports
    //   (10) species detection
    //   (11) filter summary and -out_spectra writing

    // -threads 0 is FASTag's default (main() puts it on argv when the user
    // gives none) and it means HALF the logical cores, where TOPPBase would
    // take all of them. A tagger that grabs every core makes the desktop it
    // runs on unusable for the minutes it needs, and the read path stops
    // scaling well before the core count anyway. An explicit -threads <n> is
    // honoured unchanged.
    // ---- 1.12 G: GUI modes (-probe_input, -dump_spectrum) ----
    // Under -stream the -stream refusal table refuses them; otherwise their
    // stdout carries JSON lines only, sealed below as -stream seals its data
    // channel.
    const bool probe_mode = !getFlag_("stream") && !getStringOption_("probe_input").empty();
    const bool dump_mode = !getFlag_("stream") && !getStringOption_("dump_spectrum").empty();

    if (getIntOption_("threads") == 0)
    {
      const unsigned cores = std::thread::hardware_concurrency();  // 0 if unknown
      const int n = std::max(1, static_cast<int>(cores / 2));
      TOPPBase::setMaxNumberOfThreads(n);  // omp_set_num_threads, or a no-op without OpenMP
      // Not under -stream: this runs before stdout is rewired into the data
      // channel, and a log line there is a corrupt spectrum block.
      if (!getFlag_("stream") && !probe_mode && !dump_mode)
        OPENMS_LOG_INFO << "-threads 0: using " << n << " of " << cores << " logical cores." << std::endl;
    }

    if (getFlag_("stream") || probe_mode || dump_mode)
    {
      // stdout is the -stream DATA CHANNEL. OpenMS logs through thread-local
      // streams that do not follow a global reconfig, and TOPPBase prints its
      // timing line after main_ returns -- so the only airtight seal is the
      // OS one: keep the real stdout as a private FILE*, then point fd 1 at
      // stderr for everything else in the process.
      const int data_fd = fastag_dup(1);
      if (data_fd < 0 || fastag_dup2(2, 1) < 0
          || !(stream_data_ = fastag_fdopen(data_fd, "w")))
      {
#ifndef _WIN32
        if (data_fd >= 0 && !stream_data_) close(data_fd);
#endif
        OPENMS_LOG_ERROR << (getFlag_("stream") ? "-stream" : probe_mode ? "-probe_input" : "-dump_spectrum")
                         << ": cannot rewire stdout." << std::endl;
        return ILLEGAL_PARAMETERS;
      }
#ifndef _WIN32
      // A consumer that vanishes must surface as an error, not a SIGPIPE kill
      // -- the flag help promises the process never dies mid-stream.
      signal(SIGPIPE, SIG_IGN);
#endif
    }
    // After the seal, so that a refusal, too, leaves stdout empty.
    if (probe_mode && dump_mode)
    {
      OPENMS_LOG_ERROR << "-probe_input and -dump_spectrum are separate modes; give one of them." << std::endl;
      return ILLEGAL_PARAMETERS;
    }
    if (probe_mode) return probeInputMode_();

    // ---- phase 1: option checks, refusals and tagging parameters ----------

    // -species is the switch; -taxdb with -species_out still works without it,
    // which is how species detection was driven before the flag existed.
    const bool want_species = getFlag_("species")
        || (!getStringOption_("taxdb").empty() && !getStringOption_("species_out").empty());
    // 1.12 #1: the calibrated call runs only with species detection.
    const bool species_call_on = want_species && getStringOption_("species_call") == "decoy";
    // 1.12 #10: both tag orientations in the species lookup.
    const FASTag::SpeciesOrientation species_orient = getStringOption_("species_orientation") == "both"
        ? FASTag::SpeciesOrientation::Both : FASTag::SpeciesOrientation::Forward;
    const bool species_both = want_species && species_orient == FASTag::SpeciesOrientation::Both;

    // The seed lengths this run tags at, ascending and distinct: -tag_lengths
    // when given, else the one -tag_length.
    const IntList tag_lengths = getIntList_("tag_lengths");
    const std::set<int> distinct_lengths(tag_lengths.begin(), tag_lengths.end());
    std::vector<int> lengths(distinct_lengths.begin(), distinct_lengths.end());
    if (lengths.empty()) lengths.push_back(getIntOption_("tag_length"));
    else if (getIntOption_("tag_length") != static_cast<int>(findEntry_("tag_length").default_value)
             && !distinct_lengths.count(getIntOption_("tag_length")))
      OPENMS_LOG_WARN << "tag_length " << getIntOption_("tag_length")
                      << " is ignored: tag_lengths replaces it." << std::endl;
    // The option a length advice must name.
    const char* const length_opt = tag_lengths.empty() ? "-tag_length " : "-tag_lengths ";

    // setMinFloat_ refuses values below 1e-9, but every comparison with NaN is
    // false, so TOPPBase lets -fragment_tolerance nan through.
    if (!std::isfinite(getDoubleOption_("fragment_tolerance")))
    {
      OPENMS_LOG_ERROR << "-fragment_tolerance must be a finite number greater than 0 (got "
                       << getDoubleOption_("fragment_tolerance") << ")." << std::endl;
      return ILLEGAL_PARAMETERS;
    }

    // E2: the same NaN hole as -fragment_tolerance.
    for (const char* o : {"complement_tolerance", "complement_tol_factor"})
    {
      if (!std::isfinite(getDoubleOption_(o)))
      {
        OPENMS_LOG_ERROR << "-" << o << " must be a finite number greater than 0 (got "
                         << getDoubleOption_(o) << ")." << std::endl;
        return ILLEGAL_PARAMETERS;
      }
    }
    // The same NaN hole for every other floating-point option 1.12 adds:
    // setMin/MaxFloat_ cannot refuse NaN, and e.g. -shortlist_max_evalue nan
    // rejected every placement and -census_ids_fdr nan left every spectrum
    // unidentified, both with exit 0. Refused here, before any output opens.
    for (const char* o : {"charge_infer_margin", "check_header_margin", "shortlist_max_evalue", "search_precursor_tolerance",
                          "shift_site_min_share", "species_pi0", "digest_min_confidence", "alkylation_min_share",
                          "alkylation_window", "census_ids_fdr", "census_triage_evalue"})
    {
      if (!std::isfinite(getDoubleOption_(o)))
      {
        OPENMS_LOG_ERROR << "-" << o << " must be a finite number (got " << getDoubleOption_(o) << ")." << std::endl;
        return ILLEGAL_PARAMETERS;
      }
    }

    // Species precondition, checked BEFORE the run rather than after.
    //
    // The index is keyed on k-mers, so a tag shorter than k can never be looked
    // up. With the default tag_length of 3 against the bundled k=7 index that is
    // EVERY tag, and the run would map the ~1 GB index to write a header-only
    // report -- which reads as "nothing found" instead of "nothing could be
    // found". Refuse up front and say exactly what to change.
    if (want_species)
    {
      std::string probe_taxdb = getStringOption_("taxdb");
      if (probe_taxdb.empty())
      {
        const std::string d = taxonomyDir_();
        if (!d.empty()) probe_taxdb = d + "/tax_k7.taxdb";
      }
      const int index_k = probe_taxdb.empty() ? -1 : peekTaxdbK_(probe_taxdb);
      if (index_k > 0)
      {
        const int reach = lengths.back() + 2 * getIntOption_("extension");
        if (reach < index_k)
        {
          OPENMS_LOG_ERROR << "-species: tag_length (" << lengths.back()
                           << ") + 2*extension (" << getIntOption_("extension") << ") = "
                           << reach << " cannot reach the index k = " << index_k
                           << ", so every tag would be too short to look up and the "
                           << "report would be empty. Set " << length_opt << index_k
                           << " (or raise -extension)." << std::endl;
          return ILLEGAL_PARAMETERS;
        }
      }
    }

    const std::string in = getStringOption_("in");
    const std::string out = getStringOption_("out");
    const bool stream_mode = getFlag_("stream");
    if (dump_mode && in.empty())
    {
      OPENMS_LOG_ERROR << "-dump_spectrum needs -in, the file holding the spectrum." << std::endl;
      return ILLEGAL_PARAMETERS;
    }
    if (!stream_mode && !dump_mode && (in.empty() || out.empty()))
    {
      OPENMS_LOG_ERROR << "The parameters 'in' and 'out' are required (or use -stream)." << std::endl;
      return ILLEGAL_PARAMETERS;
    }
    if (stream_mode)
    {
      // Whole-run machinery is meaningless per-block: -out_spectra re-reads
      // indexed input, q_db needs the full curve, -species aggregates a run,
      // and the filter/recon paths are not per-spectrum-latency material.
      // Checked in table order; the first option set away from its default is
      // refused. A null message reads "-stream cannot be combined with
      // -<option>." Each 1.12 cluster adds its rows at its own anchor.
      struct StreamRefusal
      {
        const char* option;
        const char* message;
      };
      static const StreamRefusal stream_refusals[] = {
          {"fasta", nullptr},
          {"entrapment_fasta", nullptr},
          {"recon_out", nullptr},
          {"species_out", nullptr},
          {"taxdb", nullptr},
          {"out_spectra", nullptr},
          {"delta_out", nullptr},
          {"recon_id_out", nullptr},
          {"usi_collection", nullptr},
          {"digest_out", nullptr},
          {"label_out", nullptr},
          {"massgap_out", nullptr},
          {"species", "-stream cannot be combined with -species or -glyco."},
          {"glyco", "-stream cannot be combined with -species or -glyco."},
          // ---- 1.12 E: -stream refusals ----
          {"pick_profile", nullptr},
          {"pick_unknown_type", nullptr},
          {"ion_series", nullptr},
          {"unknown_charge", nullptr},
          {"charge_min", nullptr},
          {"charge_max", nullptr},
          {"charge_infer_margin", nullptr},
          {"isotope_error", nullptr},
          {"check_header_charge", nullptr},
          {"check_header_margin", nullptr},
          {"check_header_out", nullptr},
          // ---- 1.12 A: -stream refusals ----
          {"shortlist_out", nullptr},
          {"fasta_out", nullptr},
          {"shortlist_background", nullptr},
          {"search_config_out", nullptr},
          {"search_shifts", nullptr},
          {"search_shifts_out", nullptr},
          // ---- 1.12 D: -stream refusals ----
          {"species_call", "-stream cannot be combined with -species_call."},
          {"species_orientation", nullptr},
          {"alkylation_out", nullptr},
          // ---- 1.12 F: -stream refusals ----
          {"census", nullptr},
          {"census_out", nullptr},
          {"census_summary_out", nullptr},
          {"census_ids", nullptr},
          {"census_ids_fdr", nullptr},
          {"census_triage_evalue", nullptr},
          // ---- 1.12 G: -stream refusals ----
          {"probe_input", nullptr},
          {"dump_spectrum", nullptr},
      };
      for (const StreamRefusal& r : stream_refusals)
        if (optionNonDefault_(r.option))
        {
          if (r.message)
          {
            OPENMS_LOG_ERROR << r.message << std::endl;
          }
          else
          {
            OPENMS_LOG_ERROR << "-stream cannot be combined with -" << r.option << "." << std::endl;
          }
          return ILLEGAL_PARAMETERS;
        }
    }
    // The index and its taxonomy are ONE coherent set. An index and dumps from
    // different sources silently drop every taxid one does not know and bias
    // the background, with no error. So it is all-bundle OR all-user: if ANY of
    // the three is given explicitly, ALL three must be.
    //
    // A -species_rank that no node in nodes.dmp carries would give an empty
    // report that reads as "no taxon found" (NCBI calls the top rank domain,
    // not superkingdom), so the rank is checked here, before tagging, after the
    // one-set rule. Only nodes.dmp is read. TOPPBase refuses an explicit
    // -taxonomy_nodes that does not exist; if the bundled nodes.dmp is missing,
    // the probe is skipped and the -species file checks report it.
    if (want_species)
    {
      const bool any_tax = !getStringOption_("taxdb").empty() || !getStringOption_("taxonomy_nodes").empty()
                           || !getStringOption_("taxonomy_names").empty();
      if (any_tax && (getStringOption_("taxdb").empty() || getStringOption_("taxonomy_nodes").empty()
                      || getStringOption_("taxonomy_names").empty()))
      {
        OPENMS_LOG_ERROR << "-taxdb, -taxonomy_nodes and -taxonomy_names are one set: "
                         << "give all three, or none (to use the bundled taxonomy). "
                         << "Mixing a custom index with another taxonomy silently "
                         << "drops every taxon the two do not share." << std::endl;
        return ILLEGAL_PARAMETERS;
      }
      std::string probe_nodes = getStringOption_("taxonomy_nodes");
      if (!any_tax)
      {
        const std::string d = taxonomyDir_();
        if (!d.empty()) probe_nodes = d + "/nodes.dmp";
      }
      if (!probe_nodes.empty() && File::exists(probe_nodes)
          && !FASTag::Taxonomy::rankInDump(probe_nodes, getStringOption_("species_rank")))
      {
        OPENMS_LOG_ERROR << "-species_rank '" << getStringOption_("species_rank")
                         << "': no node of the taxonomy has that rank (e.g. genus, family, "
                            "order, class, phylum, kingdom, domain)." << std::endl;
        return ILLEGAL_PARAMETERS;
      }
    }
    // 1.12 #1: the -species_call decision parameters, read before tagging so
    // a missing or malformed file refuses the run instead of failing after it.
    std::string species_call_params_path;
    FASTag::SpeciesCall::Params species_call_params;
    if (species_call_on)
    {
      species_call_params_path = getStringOption_("species_call_params");
      if (species_call_params_path.empty())
      {
        const std::string d = taxonomyDir_();
        if (d.empty() || !File::exists(d + "/species_call.tsv"))
        {
          OPENMS_LOG_ERROR << "-species_call decoy: no shipped species_call.tsv"
                           << (d.empty() ? std::string(" (no taxonomy directory next to the executable)")
                                         : " in '" + d + "'")
                           << ". Pass -species_call_params, or set FASTAG_TAXONOMY_DIR." << std::endl;
          return ILLEGAL_PARAMETERS;
        }
        species_call_params_path = d + "/species_call.tsv";
      }
      std::string perr;
      if (!FASTag::SpeciesCall::loadParams(species_call_params_path, species_call_params, &perr))
      {
        OPENMS_LOG_ERROR << "-species_call_params: " << perr << std::endl;
        return ILLEGAL_PARAMETERS;
      }
      if (species_call_params.decoys > 0 && species_call_params.decoys != getIntOption_("species_call_decoys"))
        OPENMS_LOG_WARN << "-species_call: the parameters in " << species_call_params_path
                        << " were calibrated with " << species_call_params.decoys
                        << " decoy replicates; this run uses -species_call_decoys "
                        << getIntOption_("species_call_decoys") << "." << std::endl;
    }
    // 1.12 #10: no analytic background follows from the orientation rule, so
    // the analytic log_pvalue and qvalue (forward index background) are
    // withheld under both, with or without -species_call decoy; only the
    // decoy null (decoy_qvalue, call) is calibrated.
    if (species_both)
      OPENMS_LOG_WARN << "-species_orientation both: the analytic log_pvalue and qvalue columns of the species "
                         "report are NA under both; "
                      << (species_call_on ? "use decoy_qvalue and call from -species_call decoy."
                                          : "use decoy_qvalue from -species_call decoy.")
                      << std::endl;
    const std::string fasta = getStringOption_("fasta");
    const std::string out_spectra = getStringOption_("out_spectra");

    // The CLI's defaults (src/CliParam.h), then every option over them; the
    // modifications are resolved from the options below.
    FASTag::Param p = FASTag::cliDefaultParam(/*resolve_mods=*/false);
    p.tag_length = lengths.front();
    p.max_extension = getIntOption_("extension");
    p.max_gaps = getIntOption_("gaps");
    p.deisotope = !getFlag_("no_deisotope");
    p.peaks_per_window = getIntOption_("peaks_per_window");
    p.frag_tol = getDoubleOption_("fragment_tolerance");
    p.tol_ppm = getStringOption_("fragment_tolerance_unit") == "ppm";
    p.max_peak_count = static_cast<size_t>(getIntOption_("max_peaks"));
    p.max_tag_count = getIntOption_("max_tags");
    p.diversity = getFlag_("diversity");
    p.per_residue_conf = getFlag_("res_conf");
    p.max_evalue = getDoubleOption_("max_evalue");
    p.gap_penalty = getDoubleOption_("gap_penalty");
    p.complement_rule = FASTag::Cli::complementRuleFromString(getStringOption_("complement_rule"));
    FASTag::Cli::setComplementTolerance(p, getDoubleOption_("complement_tolerance"),
                                        getDoubleOption_("complement_tol_factor"),
                                        getStringOption_("complement_tolerance_unit"));
    p.complement_midp = getFlag_("complement_midp");
    // 1.12 #6: the precursor hypotheses; at the defaults (assume2, isotope 0)
    // hyp_on is false and the tagging loop runs exactly as in 1.11.
    FASTag::Hyp::HypParam hyp_param;
    FASTag::Hyp::parseMode(getStringOption_("unknown_charge"), hyp_param.mode);
    hyp_param.charge_min = getIntOption_("charge_min");
    hyp_param.charge_max = getIntOption_("charge_max");
    hyp_param.infer_margin = getDoubleOption_("charge_infer_margin");
    hyp_param.isotope_errors.clear();
    for (const Int k : getIntList_("isotope_error")) hyp_param.isotope_errors.push_back(k);
    // 1.13 (backlog #14): -check_header_charge; off leaves every output as before.
    FASTag::Hyp::parseHeaderCheck(getStringOption_("check_header_charge"), hyp_param.header_check);
    hyp_param.header_margin = getDoubleOption_("check_header_margin");
    const bool hdr_check_on = hyp_param.header_check != FASTag::Hyp::HeaderCheck::Off;
    const std::string check_header_out = getStringOption_("check_header_out");
    if (const std::string herr = FASTag::Hyp::validate(hyp_param, p.frag_tol, p.tol_ppm); !herr.empty())
    {
      OPENMS_LOG_ERROR << herr << std::endl;
      return ILLEGAL_PARAMETERS;
    }
    const bool hyp_on = !hyp_param.isDefault();
    // #6: -species reads the selected hypothesis' rows only, through a per-row
    // flag carried beside the rows (Block::row_species).
    const bool species_sel_on = hyp_on && want_species;
    // The complement pairs the infer call counts: #2's rule and tolerance.
    const FASTag::ComplementSpec hyp_cs = FASTag::ComplementSpec::fromParam(p);
    // #15 phase B: a spectrum read as c/z-dot counts c/z-dot pairs (they sum
    // to M + H) for its charge and isotope evidence, as its tags do.
    FASTag::Param p_cz = p;
    p_cz.ion_pair = FASTag::IonSeries::ionPair(FASTag::IonSeries::Series::CZ);
    const FASTag::ComplementSpec hyp_cs_cz = FASTag::ComplementSpec::fromParam(p_cz);
    // The residue modifications in use; -recon_id_out reports exactly these.
    StringList fixed_mods, variable_mods;
    double fixed_term_n = 0, fixed_term_c = 0;
    const bool fixed_known = resolveMods_(getStringList_("fixed_modifications"), false, p.mods,
                                          fixed_mods, &fixed_term_n, &fixed_term_c);
    const bool variable_known =
        resolveMods_(getStringList_("variable_modifications"), true, p.mods, variable_mods);
    if (!fixed_known || !variable_known) return ILLEGAL_PARAMETERS;
    if (!p.mods.empty())
    {
      std::string summary;
      for (const auto& m : p.mods)
        summary += (summary.empty() ? "" : ", ") + m.name + " (" + std::string(1, m.residue) + ", "
                 + (m.variable ? "variable" : "fixed") + ")";
      OPENMS_LOG_INFO << "Modifications: " << summary << std::endl;
    }

    // Unconditional: the realised length bounds the null tables whether or not a
    // FASTA filter is in use.
    const int max_len = lengths.back() + 2 * p.max_extension;
    if (max_len > FASTag::MAX_FILTER_LEN)
    {
      OPENMS_LOG_ERROR << "Realised tag length can reach " << max_len << ", beyond the filter's "
                       << FASTag::MAX_FILTER_LEN << "-residue encoding." << std::endl;
      return ILLEGAL_PARAMETERS;
    }

    // One Param and one set of null tables per seed length, each exactly what
    // that length's own run would use.
    std::vector<FASTag::Param> len_params(lengths.size(), p);
    for (size_t i = 0; i < lengths.size(); ++i) len_params[i].tag_length = lengths[i];
    // ---- 1.12 G: -dump_spectrum ----
    // The preprocessing reads no tag length, so the first Param serves; the
    // dump sets the c/z-dot ion pair itself where -ion_series reads the
    // spectrum as c/z (InputProbe dumpSpectrum).
    if (dump_mode) return dumpSpectrumMode_(in, len_params.front());
    // #15 phase B: under -ion_series cz or auto a second set reads spectra as
    // c/z-dot ions (only the ion pair differs); under by it stays empty.
    const FASTag::IonSeries::Mode ion_mode = FASTag::IonSeries::modeFromString(getStringOption_("ion_series"));
    const FASTag::IonSeries::IonPair cz_pair = FASTag::IonSeries::ionPair(FASTag::IonSeries::Series::CZ);
    std::vector<FASTag::Param> len_params_cz;
    if (ion_mode != FASTag::IonSeries::Mode::By)
    {
      len_params_cz = len_params;
      for (FASTag::Param& lp : len_params_cz) lp.ion_pair = cz_pair;
    }
    auto build_tables = [&len_params, &len_params_cz](bool cz = false) {
      const std::vector<FASTag::Param>& lps = cz ? len_params_cz : len_params;
      std::vector<FASTag::Tables> t;
      t.reserve(lps.size());
      for (const FASTag::Param& lp : lps) t.emplace_back(lp);
      return t;
    };
    // One spectrum at every length: each length's tags as its own run reports
    // them (so 'max_tags' caps each length), in ascending length, with a tag
    // several lengths report kept from one of them only (mergeLengths). Every
    // consumer -- TSV, recon, identifications, -stream -- sees these rows.
    // @p diag (-census) is filled when given; it never changes the tags.
    // @p multiplicity (1.12 #6) is the number of precursor hypotheses tagged
    // for the spectrum; 1 changes nothing. @p cz (#15 phase B) reads the
    // spectrum as c/z-dot ions: len_params_cz with @p tabs built from it.
    auto tag_all = [&len_params, &len_params_cz](const MSSpectrum& s, double prec_mz, int charge,
                                                 const std::vector<FASTag::Tables>& tabs,
                                                 FASTag::SpectrumDiag* diag = nullptr, double multiplicity = 1.0,
                                                 bool cz = false) {
      const std::vector<FASTag::Param>& lps = cz ? len_params_cz : len_params;
      if (lps.size() == 1)
        return FASTag::tagSpectrum(s, prec_mz, charge, lps[0], tabs[0], diag, multiplicity);
      return FASTag::mergeLengths(FASTag::tagSpectrum(s, prec_mz, charge, lps, tabs, diag, multiplicity));
    };
    if (lengths.size() > 1)
    {
      std::string list;
      for (int L : lengths) list += (list.empty() ? "" : ", ") + std::to_string(L);
      OPENMS_LOG_INFO << "Seed tag lengths: " << list << std::endl;
    }

    const bool both_orientations = getStringOption_("orientation") == "both";
    const double iso_tol = getDoubleOption_("isobaric_tolerance");
    std::vector<std::pair<char, double>> fixed_deltas;
    for (const auto& m : p.mods)
      if (!m.variable) fixed_deltas.emplace_back(m.residue, m.delta);

    FASTag::FastaFilter filt(both_orientations);
    FASTag::FastaFilter entrap(both_orientations);
    const bool filtering = !fasta.empty();
    const std::string entrap_fasta = getStringOption_("entrapment_fasta");
    const bool entrap_on = !entrap_fasta.empty();
    if (entrap_on && !filtering)
    {
      OPENMS_LOG_ERROR << "-entrapment_fasta calibrates the -fasta filter; "
                          "give -fasta too." << std::endl;
      return ILLEGAL_PARAMETERS;
    }
    if (entrap_on && lengths.size() > 1)
    {
      // q_db is one curve over the run's E-values. Pooling several seed
      // lengths into it would give every row a q_db its own length's run
      // does not report.
      OPENMS_LOG_ERROR << "-entrapment_fasta calibrates q_db over one seed length; "
                          "run each of -tag_lengths separately." << std::endl;
      return ILLEGAL_PARAMETERS;
    }
    if (entrap_on && want_species)
    {
      OPENMS_LOG_ERROR << "-entrapment_fasta cannot be combined with -species: "
                          "entrapment matches are known-false calibration "
                          "material and would pollute the taxon evidence."
                       << std::endl;
      return ILLEGAL_PARAMETERS;
    }

    const std::string recon_out = getStringOption_("recon_out");
    const std::string delta_out = getStringOption_("delta_out");
    // recon_on: -recon_out is written. place_on: tags are placed on the
    // database (the index is built, every tag reconciled, the delta sample
    // taken), whether or not -recon_out is written. Every reader of the
    // placements adds its term at its anchor.
    const bool recon_on = !recon_out.empty();
    // #5: the shortlist and the reduced FASTA rank placements; the engine
    // configuration needs the database and the protease check.
    const std::string shortlist_out = getStringOption_("shortlist_out");
    const std::string fasta_out = getStringOption_("fasta_out");
    const std::string search_config_out = getStringOption_("search_config_out");
    const bool shortlist_on = !shortlist_out.empty() || !fasta_out.empty();
    const bool handoff_on = shortlist_on || !search_config_out.empty();
    // #3g: -alkylation_out reads the placements of the run's own reconciler.
    const std::string alkylation_out = getStringOption_("alkylation_out");
    const bool alkylation_on = !alkylation_out.empty();
    const bool place_on = recon_on
        // ---- 1.12 A: placement readers ----
        || handoff_on
        // ---- 1.12 D: placement readers ----
        || alkylation_on
        ;
    // Only -alkylation_out places: every other placement reader is off, so
    // the index is built on its database and only the tags it reads are
    // placed (recon_out, the hand-off and -delta_out read every tag).
    const bool alkylation_only_db = alkylation_on && !recon_on && !handoff_on;
    // The placement-report checks below keep their 1.11 meaning: placing for
    // -alkylation_out alone does not satisfy them (1.12 D #3g).
    const bool place_reports = place_on && !alkylation_only_db;
    if (!delta_out.empty() && !place_reports)
    {
      OPENMS_LOG_ERROR << "-delta_out requires -recon_out (the histogram is "
                          "aggregated over reconciliations)." << std::endl;
      return ILLEGAL_PARAMETERS;
    }
    const bool recon_loc = getFlag_("recon_localize");
    if (recon_loc && !place_reports)
    {
      OPENMS_LOG_ERROR << "-recon_localize requires -recon_out (it adds columns "
                          "to the reconciliations)." << std::endl;
      return ILLEGAL_PARAMETERS;
    }
    const std::string recon_id_out = getStringOption_("recon_id_out");
    const bool recon_ids_on = !recon_id_out.empty();
    if (recon_ids_on && !recon_on)
    {
      OPENMS_LOG_ERROR << "-recon_id_out requires -recon_out (it writes the same "
                          "placements as identifications)." << std::endl;
      return ILLEGAL_PARAMETERS;
    }
    // #5 checks: a database to place on, the template only for Comet.
    const std::string search_engine = getStringOption_("search_engine");
    if (handoff_on && getStringOption_("recon_fasta").empty() && fasta.empty())
    {
      OPENMS_LOG_ERROR << "-" << (!shortlist_out.empty() ? "shortlist_out" : !fasta_out.empty() ? "fasta_out" : "search_config_out")
                       << " needs a database: give -recon_fasta (or -fasta)." << std::endl;
      return ILLEGAL_PARAMETERS;
    }
    if (!getStringOption_("search_config_template").empty() && search_engine != "comet")
    {
      OPENMS_LOG_ERROR << "-search_config_template is a `comet -p` parameter file; it needs -search_engine comet "
                          "(a Sage configuration is written complete)." << std::endl;
      return ILLEGAL_PARAMETERS;
    }
    // #17 checks: the shifts go into -search_config_out; offsets are Comet's;
    // site expansion reads -recon_localize.
    const std::string search_shifts_out = getStringOption_("search_shifts_out");
    FASTag::SearchConfig::ShiftSettings shift_settings;
    FASTag::SearchConfig::parseShiftMode(getStringOption_("search_shifts"), shift_settings.mode);
    const bool shifts_on = shift_settings.mode != FASTag::SearchConfig::ShiftMode::None;
    if (shifts_on && search_config_out.empty())
    {
      OPENMS_LOG_ERROR << "-search_shifts writes into the engine configuration; it needs -search_config_out." << std::endl;
      return ILLEGAL_PARAMETERS;
    }
    if (shift_settings.mode == FASTag::SearchConfig::ShiftMode::Offsets && search_engine == "sage")
    {
      OPENMS_LOG_ERROR << "-search_shifts offsets: Sage has no mass offsets; use -search_engine comet, or "
                          "-search_shifts variable." << std::endl;
      return ILLEGAL_PARAMETERS;
    }
    shift_settings.engine = search_engine;
    shift_settings.max_variable = static_cast<std::size_t>(getIntOption_("shift_max_variable"));
    shift_settings.max_offsets = static_cast<std::size_t>(getIntOption_("shift_max_offsets"));
    shift_settings.expand_sites = getFlag_("shift_expand_sites");
    shift_settings.site_min_share = getDoubleOption_("shift_site_min_share");
    shift_settings.site_min_count = static_cast<std::uint64_t>(getIntOption_("shift_site_min_count"));
    const int shift_site_min_ions = getIntOption_("shift_site_min_ions");
    if (shifts_on && shift_settings.expand_sites && !recon_loc)
    {
      OPENMS_LOG_ERROR << "-shift_expand_sites needs -recon_localize (the sites are the localized ones)." << std::endl;
      return ILLEGAL_PARAMETERS;
    }
    FASTag::Shortlist::Settings sl_settings;
    sl_settings.max_evalue = getDoubleOption_("shortlist_max_evalue");
    sl_settings.min_spectra = static_cast<std::uint64_t>(getIntOption_("shortlist_min_spectra"));
    sl_settings.gapped = getFlag_("shortlist_gapped");
    {
      const std::string pm = getStringOption_("shortlist_parsimony");
      sl_settings.parsimony = pm == "subset" ? FASTag::Shortlist::Parsimony::Subset
                            : pm == "greedy" ? FASTag::Shortlist::Parsimony::Greedy
                                             : FASTag::Shortlist::Parsimony::None;
    }
    sl_settings.top = static_cast<std::size_t>(getIntOption_("shortlist_top"));
    const StringList sl_affix_option = getStringList_("shortlist_decoy_affix");
    std::vector<std::string> sl_affixes;
    for (const std::string& a : sl_affix_option)
      if (!a.empty()) sl_affixes.push_back(a);
    if (!handoff_on && optionNonDefault_("shortlist_force"))
    {
      OPENMS_LOG_WARN << "-shortlist_force is only read for -fasta_out or -search_config_out; it is ignored here." << std::endl;
    }
    if (!shortlist_on && std::vector<std::string>(sl_affix_option.begin(), sl_affix_option.end())
                             != FASTag::Shortlist::defaultDecoyAffixes())
    {
      OPENMS_LOG_WARN << "-shortlist_decoy_affix is only read for -shortlist_out or -fasta_out; it is ignored here." << std::endl;
    }
    // TOPPBase lets an extension OpenMS does not know (ids.mzIdentML) through.
    if (recon_ids_on)
    {
      const FileTypes::Type t = FileHandler::getTypeByFileName(recon_id_out);
      if (t != FileTypes::IDXML && t != FileTypes::MZIDENTML && t != FileTypes::MZTAB)
      {
        OPENMS_LOG_ERROR << "-recon_id_out '" << recon_id_out << "': the extension picks the "
                            "format; use .idXML, .mzid or .mzTab." << std::endl;
        return ILLEGAL_PARAMETERS;
      }
    }
    // -usi_collection: "mzspec:<collection>:<run>:" once; empty = no usi column.
    std::string usi_prefix;
    if (const std::string coll = getStringOption_("usi_collection"); !coll.empty())
    {
      if (!FASTag::isUsiCollection(coll))
      {
        OPENMS_LOG_ERROR << "-usi_collection '" << coll << "' is not a USI collection "
                            "identifier: give the dataset's PXDnnnnnn (or MSVnnnnnnnnn, "
                            "RPXDnnnnnn, RMSVnnnnnnnnn, PXLnnnnnn), or USI000000 while it "
                            "has none." << std::endl;
        return ILLEGAL_PARAMETERS;
      }
      // The input is .mzML, .mzpeak or .mgf (refused otherwise below), so the
      // last dot starts the extension. Except for MGF, whose run keeps it:
      // USI 1.0 lets the msRun carry the extension, and an MGF index points
      // into the peak list, not into the raw run it came from.
      const std::string file = File::basename(in);
      const bool mgf_run = FileHandler::getTypeByFileName(in) == FileTypes::MGF
                           && !FileNameUtils::hasCompressionSuffix(in);
      const std::string run = mgf_run ? file : file.substr(0, file.rfind('.'));
      // USI 1.0 3.6.1: a run starting with '[' reads as a [subFolder] prefix.
      if (run.empty() || run[0] == '[')
      {
        OPENMS_LOG_ERROR << "-usi_collection: the run name '" << run << "' (the input "
                            "file name without extension) cannot be written into a USI: "
                            "it is empty or starts with '['. Rename the input." << std::endl;
        return ILLEGAL_PARAMETERS;
      }
      usi_prefix = "mzspec:" + coll + ":" + run + ":";
    }
    // -recon_id_out: the fixed modifications its peptides carry and the search
    // settings its run reports, filled with the reconciliation index below.
    ModifiedPeptideGenerator::MapToResidueType id_fixed;
    ProteinIdentification::SearchParameters id_params;
    FASTag::ProteomeIndex pindex;
    FASTag::TagReconciler recon(p.frag_tol, p.tol_ppm, both_orientations);
    // The database the index is built from (-recon_fasta, else -fasta), kept
    // for readers that stream it again; empty without placement.
    std::string recon_db;
    // #5: per database entry its accession, length, decoy flag and canonical
    // duplicate; the background to append; the residue composition of the
    // database for the protease check's background.
    std::vector<FASTag::Shortlist::ProteinInfo> sl_proteins;
    std::vector<FASTAFile::FASTAEntry> sl_background;
    std::vector<std::uint32_t> sl_bg_twins;  // database entries the background duplicates
    std::array<std::uint64_t, FASTag::Digest::kNumAA> sl_db_residues{};
    std::size_t sl_decoys = 0;
    // #3g: where -alkylation_out's placements come from (its report says).
    std::string alk_db_source, alk_db;
    if (alkylation_on)
    {
      const std::string prot = getStringOption_("alkylation_proteome");
      if (!getStringOption_("recon_fasta").empty() || !alkylation_only_db)
      {
        if (optionNonDefault_("alkylation_proteome"))
          OPENMS_LOG_WARN << "-alkylation_proteome is ignored: -alkylation_out reads the placements on "
                          << (getStringOption_("recon_fasta").empty() ? "-fasta" : "-recon_fasta") << "." << std::endl;
        alk_db_source = getStringOption_("recon_fasta").empty() ? "fasta" : "recon_fasta";
      }
      else
      {
        const bool named = prot == "auto" || prot == "human" || prot == "mouse" || prot == "yeast" || prot == "ecoli";
        if (named)
        {
          // auto: the human proteome. Taking the top -species genus would need
          // the species call before the tagging loop that places the tags.
          const std::string name = prot == "auto" ? "human" : prot;
          const std::string dir = alkylationDir_();
          const std::string path = dir.empty() ? std::string() : dir + "/" + name + ".fasta.gz";
          if (path.empty() || !File::exists(path))
          {
            OPENMS_LOG_ERROR << "-alkylation_out: no shipped " << name << " proteome found (expected "
                                "<bin>/../share/FASTag/alkylation/" << name << ".fasta.gz, or set "
                                "FASTAG_ALKYLATION_DIR). Give -alkylation_proteome <fasta> or -recon_fasta." << std::endl;
            return ILLEGAL_PARAMETERS;
          }
          alk_db = path;
          alk_db_source = "bundled:" + name;
        }
        else if (File::exists(prot) && !File::isDirectory(prot))
        {
          alk_db = prot;
          alk_db_source = "proteome";
        }
        else
        {
          OPENMS_LOG_ERROR << "-alkylation_proteome '" << prot << "' is neither auto, human, mouse, yeast, ecoli "
                              "nor a readable FASTA file." << std::endl;
          return ILLEGAL_PARAMETERS;
        }
      }
    }
    if (place_on)
    {
      recon_db = getStringOption_("recon_fasta");
      if (recon_db.empty()) recon_db = alkylation_only_db ? alk_db : fasta;
      if (recon_db.empty())
      {
        OPENMS_LOG_ERROR << "-recon_out needs a database: give -recon_fasta "
                            "(or -fasta)." << std::endl;
        return ILLEGAL_PARAMETERS;
      }
      std::vector<FASTAFile::FASTAEntry> rentries;
      // #3g: the shipped proteomes are gzip-compressed, which FASTAFile cannot read.
      if (alkylation_only_db) FASTag::Alkylation::loadFasta(recon_db, rentries);
      else FASTAFile().load(recon_db, rentries);
      pindex.build(rentries, fixed_deltas, iso_tol);
      if (handoff_on)
      {
        // Decoys by accession, per entry; duplicates by identifier and
        // sequence. Both aligned with the index ordinals (database order).
        const FASTag::Shortlist::DuplicateCheck dup = FASTag::Shortlist::checkDuplicates(rentries);
        if (!dup.conflict.empty())
        {
          OPENMS_LOG_ERROR << "'" << recon_db << "': the identifier '" << dup.conflict
                           << "' names two different sequences; the shortlist selects proteins by entry and "
                              "cannot tell which one is meant. Make the identifiers unique." << std::endl;
          return INPUT_FILE_CORRUPT;
        }
        if (dup.identical > 0)
          OPENMS_LOG_INFO << "Shortlist: " << dup.identical << " identical duplicate entries in '" << recon_db
                          << "' counted as their first entry." << std::endl;
        sl_proteins.resize(rentries.size());
        for (std::size_t i = 0; i < rentries.size(); ++i)
        {
          FASTag::Shortlist::ProteinInfo& pi = sl_proteins[i];
          pi.accession = rentries[i].identifier;
          pi.length = pindex.proteinLength(static_cast<uint32_t>(i));
          pi.decoy = FASTag::Shortlist::isDecoy(pi.accession, sl_affixes);
          pi.canonical = dup.canonical[i];
          if (pi.decoy) ++sl_decoys;
          else FASTag::Digest::addResidues(rentries[i].sequence, sl_db_residues);
        }
        // DecoyHelper's whole-database heuristic only to say what the input is.
        FASTAContainer<TFI_Vector> whole(rentries);
        const DecoyHelper::Result dh = DecoyHelper::findDecoyString(whole, true);
        if (sl_decoys > 0)
          OPENMS_LOG_WARN << "'" << recon_db << "' holds " << sl_decoys << " decoy entries"
                          << (dh.success ? " (a target-decoy database)" : "")
                          << "; they never enter the shortlist or -fasta_out." << std::endl;
        if (dh.success && !FASTag::Shortlist::isDecoy(dh.is_prefix ? dh.name + "x" : "x" + dh.name, sl_affixes))
          OPENMS_LOG_WARN << "'" << recon_db << "' looks like a target-decoy database with the decoy "
                          << (dh.is_prefix ? "prefix '" : "suffix '") << dh.name
                          << "', which -shortlist_decoy_affix does not list; add it there, or its decoys "
                             "count as targets." << std::endl;
        const std::string bg_path = getStringOption_("shortlist_background");
        if (!bg_path.empty() && !fasta_out.empty())
        {
          std::vector<FASTAFile::FASTAEntry> bg;
          FASTAFile().load(bg_path, bg);
          std::size_t bg_decoys = 0, bg_dup = 0;
          const std::string conflict =
              FASTag::Shortlist::selectBackground(rentries, bg, sl_affixes, sl_background, &bg_decoys, &bg_dup,
                                                  &sl_bg_twins);
          if (!conflict.empty())
          {
            OPENMS_LOG_ERROR << "-shortlist_background '" << bg_path << "': the identifier '" << conflict
                             << "' names a different sequence than in '" << recon_db
                             << "' (or than an earlier background entry). Make the identifiers unique." << std::endl;
            return INPUT_FILE_CORRUPT;
          }
          OPENMS_LOG_INFO << "Shortlist background: " << sl_background.size() << " entries from '" << bg_path << "'"
                          << (bg_decoys ? ", " + std::to_string(bg_decoys) + " decoys left out" : std::string())
                          << (bg_dup ? ", " + std::to_string(bg_dup) + " already in the database (kept through it)"
                                    : std::string())
                          << std::endl;
        }
      }
      int rmin = getIntOption_("recon_min_length");
      if (rmin == 0) rmin = pindex.autoMinLen();
      recon.attach(&pindex, getIntOption_("recon_missed_cleavages"), rmin);
      std::vector<FASTag::ModCandidate> cands;
      for (const auto& m : p.mods)
        if (m.variable) cands.push_back({m.name, m.delta, std::string(1, m.residue)});
      recon.setModCandidates(std::move(cands));
      recon.setFixedTermMods(fixed_term_n, fixed_term_c);
      if (recon_ids_on)
      {
        // The modifications the index was built with: residue ones only. A
        // terminal one is not in the window masses, so its mass is part of the
        // gap and must not also be on the peptide.
        id_params.db = recon_db;
        id_params.fixed_modifications = fixed_mods;
        id_params.variable_modifications = variable_mods;
        id_params.missed_cleavages = static_cast<UInt>(getIntOption_("recon_missed_cleavages"));
        id_params.fragment_mass_tolerance = p.frag_tol;
        id_params.fragment_mass_tolerance_ppm = p.tol_ppm;
        id_params.digestion_enzyme = *ProteaseDB::getInstance()->getEnzyme("Trypsin");  // ProteomeIndex's rule
        id_fixed = ModifiedPeptideGenerator::getModifications(id_params.fixed_modifications);
      }
      OPENMS_LOG_INFO << "Recon index: " << pindex.proteinCount() << " proteins, "
                      << pindex.residueCount() << " residues, "
                      << pindex.collapseRuleCount() << " isobaric rules; min tag length "
                      << rmin << (getIntOption_("recon_min_length") == 0 ? " (derived)" : " (set)")
                      << std::endl;
    }

    // ---- phase 2: report setup ---------------------------------------------

    // -digest_out, -label_out, -massgap_out: their tables are read here, so a
    // bad one is refused before any tagging.
    namespace FD = FASTag::Digest;
    const std::string digest_out = getStringOption_("digest_out");
    const std::string label_out = getStringOption_("label_out");
    const std::string massgap_out = getStringOption_("massgap_out");
    const bool digest_on = !digest_out.empty();
    const bool label_on = !label_out.empty();
    // Tag-end counting in the loop (PerThread::digest) feeds every report that
    // reads tag ends: one term per reader, each cluster at its anchor.
    const auto needCounting = [&]() {
      return digest_on || label_on
          // ---- 1.12 A: tag-end counting readers ----
          || handoff_on  // #5 protease check
          // ---- 1.12 D: tag-end counting readers ----
          ;
    };
    const bool count_on = needCounting();
    const bool massgap_on = !massgap_out.empty();
    // gap_needed: the mass-gap tables are loaded and the histogram rows are
    // kept as gaps (GapRow), for -massgap_out and every other gap reader.
    const bool gap_needed = massgap_on
        // ---- 1.12 A: mass-gap readers ----
        || shifts_on  // #17
        ;
    // delta_on: one delta sample per spectrum is taken and binned.
    const bool delta_on = !delta_out.empty() || gap_needed;
    if (massgap_on && !place_reports)
    {
      OPENMS_LOG_ERROR << "-massgap_out requires -recon_out (the gaps are those of the "
                          "reconciliations, as in -delta_out)." << std::endl;
      return ILLEGAL_PARAMETERS;
    }
    FD::DigestSettings digest_settings;
    digest_settings.window = getDoubleOption_("digest_window");
    digest_settings.tag_min = getIntOption_("digest_tag_min");
    digest_settings.background_share = getDoubleOption_("digest_background_share");
    if (digest_settings.background_share >= 1.0)
    {
      OPENMS_LOG_ERROR << "-digest_background_share must be below 1: at 1 every model is the background "
                          "and all of them tie." << std::endl;
      return ILLEGAL_PARAMETERS;
    }
    digest_settings.silac_min = getIntOption_("digest_silac_min");
    digest_settings.low_resolution = !p.tol_ppm;
    FD::ModelTable protease_models;
    const std::string digest_models = getStringOption_("digest_models");
    // #9: -pick_profile (validated by its valid strings).
    FASTag::Centroid::Mode pick_mode = FASTag::Centroid::Mode::Legacy;
    FASTag::Centroid::parseMode(getStringOption_("pick_profile"), pick_mode);
    const bool pick_unknown_type = getFlag_("pick_unknown_type");
    // Report options set without the report that reads them: ignored, so say so.
    // Defaults are compared against the registered ones, never repeated here.
    // One row per option: {option, the report or switch that reads it,
    // whether that reader is on}. Rows warn in table order. Each 1.12 cluster
    // adds its rows at its own anchor.
    {
      struct IgnoredOption
      {
        const char* option;
        const char* reader;
        bool read;
      };
      const bool glyco_flag = getFlag_("glyco");
      // -taxdb and -species_out together switch species detection on, so
      // either one alone does nothing.
      const IgnoredOption ignored[] = {
          {"digest_models", "-digest_out", digest_on},
          {"digest_tag_min", "-digest_out", digest_on},
          {"digest_background_share", "-digest_out", digest_on},
          {"digest_window", "-digest_out or -label_out", count_on},
          {"digest_silac_min", "-label_out", label_on},
          {"glyco_out", "-glyco", glyco_flag},
          {"glyco_min_fraction", "-glyco", glyco_flag},
          {"species_out", "-species", want_species},
          {"taxdb", "-species", want_species},
          {"taxonomy_nodes", "-species", want_species},
          {"taxonomy_names", "-species", want_species},
          {"species_rank", "-species", want_species},
          {"species_evidence", "-species", want_species},
          {"species_min_len", "-species", want_species},
          {"species_max_kmer_share", "-species", want_species},
          {"species_min_margin", "-species", want_species},
          {"species_use_gapped", "-species", want_species},
          {"species_deconvolve", "-species", want_species},
          // ---- 1.12 E: ignored-option warnings ----
          {"acquisition_probe_spectra", "-acquisition_check refuse or warn",
           getStringOption_("acquisition_check") != "off"},
          {"pick_unknown_type", "-pick_profile auto", pick_mode == FASTag::Centroid::Mode::Auto},
          {"charge_min", "-unknown_charge enumerate or infer, or -check_header_charge",
           hyp_param.mode != FASTag::Hyp::ChargeMode::Assume2 || hdr_check_on},
          {"charge_max", "-unknown_charge enumerate or infer, or -check_header_charge",
           hyp_param.mode != FASTag::Hyp::ChargeMode::Assume2 || hdr_check_on},
          {"charge_infer_margin", "-unknown_charge enumerate or infer, or -check_header_charge",
           hyp_param.mode != FASTag::Hyp::ChargeMode::Assume2 || hdr_check_on},
          {"check_header_margin", "-check_header_charge warn or override", hdr_check_on},
          {"check_header_out", "-check_header_charge warn or override", hdr_check_on},
          // ---- 1.12 A: ignored-option warnings ----
          {"shortlist_background", "-fasta_out", !fasta_out.empty()},
          {"shortlist_max_evalue", "-shortlist_out or -fasta_out", shortlist_on},
          {"shortlist_min_spectra", "-shortlist_out or -fasta_out", shortlist_on},
          {"shortlist_gapped", "-shortlist_out or -fasta_out", shortlist_on},
          {"shortlist_parsimony", "-shortlist_out or -fasta_out", shortlist_on},
          {"shortlist_top", "-shortlist_out or -fasta_out", shortlist_on},
          {"search_engine", "-search_config_out", !search_config_out.empty()},
          {"search_config_template", "-search_config_out", !search_config_out.empty()},
          {"search_precursor_tolerance", "-search_config_out", !search_config_out.empty()},
          {"search_precursor_unit", "-search_config_out", !search_config_out.empty()},
          {"search_isotope_errors", "-search_config_out", !search_config_out.empty()},
          {"search_decoy_prefix", "-search_config_out", !search_config_out.empty()},
          {"search_shifts_out", "-search_shifts", shifts_on},
          {"shift_max_variable", "-search_shifts", shifts_on},
          {"shift_max_offsets", "-search_shifts", shifts_on},
          {"shift_expand_sites", "-search_shifts", shifts_on},
          {"shift_site_min_share", "-shift_expand_sites", shifts_on && shift_settings.expand_sites},
          {"shift_site_min_count", "-shift_expand_sites", shifts_on && shift_settings.expand_sites},
          {"shift_site_min_ions", "-shift_expand_sites", shifts_on && shift_settings.expand_sites},
          // ---- 1.12 D: ignored-option warnings ----
          {"species_call", "-species", want_species},
          {"species_call_params", "-species_call decoy", species_call_on},
          {"species_call_min_units", "-species_call decoy", species_call_on},
          {"species_call_decoys", "-species_call decoy", species_call_on},
          {"species_pi0", "-species_call decoy", species_call_on},
          {"species_orientation", "-species", want_species},
          {"digest_models_version", "-digest_out", digest_on},
          {"digest_detection", "-digest_out", digest_on},
          {"digest_flank2", "-digest_out", digest_on},
          {"digest_min_confidence", "-digest_out", digest_on},
          {"digest_calibration", "-digest_out", digest_on},
          {"alkylation_proteome", "-alkylation_out", alkylation_on},
          {"alkylation_min_spectra", "-alkylation_out", alkylation_on},
          {"alkylation_min_share", "-alkylation_out", alkylation_on},
          {"alkylation_window", "-alkylation_out", alkylation_on},
          // ---- 1.12 F: ignored-option warnings ----
          {"census_out", "-census", getFlag_("census")},
          {"census_summary_out", "-census", getFlag_("census")},
          {"census_ids", "-census", getFlag_("census")},
          {"census_ids_fdr", "-census_ids", getFlag_("census") && !getStringOption_("census_ids").empty()},
          {"census_triage_evalue", "-census_ids", getFlag_("census") && !getStringOption_("census_ids").empty()},
      };
      for (const IgnoredOption& r : ignored)
      {
        if (!r.read && optionNonDefault_(r.option))
        {
          OPENMS_LOG_WARN << "-" << r.option << " is only read for " << r.reader << "; it is ignored here."
                          << std::endl;
        }
      }
    }
    const std::string digest_dir = (digest_on || gap_needed) ? digestDir_() : std::string();
    // The shipped tables resolved from the digest directory below: inputs the
    // run consumes although no option names them, so the path guard checks
    // every output against them too ({label, path}).
    std::vector<std::pair<std::string, std::string>> resolved_inputs;
    const auto no_digest_dir = [&](const char* what) {
      OPENMS_LOG_ERROR << "No shipped " << what << " found (expected <bin>/../share/FASTag/digest). "
                          "Set FASTAG_DIGEST_DIR to the directory holding digest_models.tsv and "
                          "massgap_mods.tsv" << (digest_on ? ", or give -digest_models." : ".") << std::endl;
      return ILLEGAL_PARAMETERS;
    };
    // 1.12 D (#3c-#3f): the v2 models, detection, flank2 and calibration.
    digest_settings.models_version = getStringOption_("digest_models_version");
    digest_settings.detection = getStringOption_("digest_detection") == "shipped";
    digest_settings.flank2 = getStringOption_("digest_flank2") == "auto";
    digest_settings.min_confidence = getDoubleOption_("digest_min_confidence");
    const bool digest_v2 = digest_settings.models_version == "v2";
    if (digest_on)
    {
      std::string models_path = digest_models;
      if (models_path.empty())
      {
        if (digest_dir.empty()) return no_digest_dir("protease models");
        models_path = digest_dir + (digest_v2 ? "/digest_models_v2.tsv" : "/digest_models.tsv");
      }
      else if (digest_v2)
        OPENMS_LOG_WARN << "-digest_models_version v2 is ignored: -digest_models '" << digest_models
                        << "' is read as given." << std::endl;
      std::string err;
      if (!FD::loadModelTable(models_path, protease_models, &err))
      {
        OPENMS_LOG_ERROR << "-digest_models '" << models_path << "': " << err << std::endl;
        return INPUT_FILE_CORRUPT;
      }
      if (digest_models.empty()) resolved_inputs.emplace_back("digest_models (shipped)", models_path);
      digest_settings.models = digest_models.empty() ? (digest_v2 ? "shipped_v2" : "shipped") : digest_models;
      if (digest_settings.detection)
        for (std::string_view cls : FD::kInstrumentClasses)
          if (!protease_models.detectionFor(cls))
          {
            OPENMS_LOG_ERROR << "-digest_detection shipped needs detection rows for orbitrap_hcd, timstof and other in "
                                "the model table; '" << models_path << "' has none for " << cls
                             << " (use -digest_models_version v2 or a v2 -digest_models table)." << std::endl;
            return ILLEGAL_PARAMETERS;
          }
      const std::string cal_path = getStringOption_("digest_calibration");
      if (digest_v2 || digest_settings.min_confidence > 0.0 || !cal_path.empty())
      {
        if (cal_path.empty() && digest_dir.empty()) return no_digest_dir("calibration");
        const std::string cp = cal_path.empty() ? digest_dir + "/digest_calibration.tsv" : cal_path;
        if (!FD::loadCalibration(cp, digest_settings.calibration, &err))
        {
          OPENMS_LOG_ERROR << "-digest_calibration '" << cp << "': " << err << std::endl;
          return INPUT_FILE_CORRUPT;
        }
        digest_settings.calibration_source = cal_path.empty() ? "shipped" : cal_path;
        if (cal_path.empty()) resolved_inputs.emplace_back("digest_calibration (shipped)", cp);
      }
      // The table's own background wins; else the FASTA's composition; else
      // the shipped human one.
      std::string background_fasta = getStringOption_("recon_fasta");
      if (background_fasta.empty()) background_fasta = fasta;
      if (!digest_models.empty() && protease_models.has_bg) digest_settings.background = "models_table";
      else if (!background_fasta.empty())
      {
        // Streamed: only the residue counts are needed, not the entries.
        std::array<std::uint64_t, FD::kNumAA> background_counts{};
        FASTAFile background_file;
        background_file.readStart(background_fasta);
        FASTAFile::FASTAEntry background_entry;
        while (background_file.readNext(background_entry)) FD::addResidues(background_entry.sequence, background_counts);
        protease_models.bg_c = protease_models.bg_n = FD::composition(background_counts, true, &digest_settings.background_pseudocount);
        protease_models.has_bg = true;
        digest_settings.background = "fasta:" + background_fasta;
      }
      else if (!protease_models.has_bg)
      {
        FD::ModelTable shipped;
        if (digest_dir.empty()) return no_digest_dir("background");
        if (!FD::loadModelTable(digest_dir + "/digest_models.tsv", shipped, &err) || !shipped.has_bg)
        {
          OPENMS_LOG_ERROR << "The shipped digest_models.tsv in '" << digest_dir << "' has no background: " << err << std::endl;
          return INPUT_FILE_CORRUPT;
        }
        protease_models.bg_c = shipped.bg_c;
        protease_models.bg_n = shipped.bg_n;
        protease_models.has_bg = true;
        resolved_inputs.emplace_back("digest_models (shipped)", digest_dir + "/digest_models.tsv");
      }
    }
    std::vector<FD::GapMod> gap_mods, cys_alkylations;
    std::vector<FD::Combo> gap_combos;
    FD::GapSettings gap_settings;
    if (gap_needed)
    {
      if (digest_dir.empty()) return no_digest_dir("mass-gap modifications");
      std::ifstream mf((digest_dir + "/massgap_mods.tsv").c_str());
      std::string err;
      if (!mf || !FD::parseGapMods(mf, gap_mods, &err))
      {
        OPENMS_LOG_ERROR << "'" << digest_dir << "/massgap_mods.tsv': " << (err.empty() ? "cannot read" : err) << std::endl;
        return INPUT_FILE_CORRUPT;
      }
      resolved_inputs.emplace_back("massgap_mods (shipped)", digest_dir + "/massgap_mods.tsv");
      for (const char* c : {"Carbamidomethyl (C)", "Propionamide (C)", "Nethylmaleimide (C)",
                            "Methylthio (C)", "Carboxymethyl (C)"})
        cys_alkylations.push_back(FD::GapMod{c, c, 1.0, 0.0});
      const ModificationsDB* mdb = ModificationsDB::getInstance();
      for (std::vector<FD::GapMod>* list : {&gap_mods, &cys_alkylations})
        for (FD::GapMod& m : *list)
        {
          const ResidueModification* rm = nullptr;
          try { rm = mdb->getModification(m.site); }
          catch (const Exception::BaseException&) { rm = nullptr; }
          if (rm) m.mass = rm->getDiffMonoMass();
          else
          {
            OPENMS_LOG_ERROR << (massgap_on ? "-massgap_out" : "-search_shifts")
                             << ": OpenMS does not know the modification '" << m.site << "'." << std::endl;
            return INPUT_FILE_CORRUPT;
          }
        }
      gap_settings.window = p.tol_ppm ? getDoubleOption_("massgap_window") : getDoubleOption_("massgap_window_da");
      gap_settings.min_spectra = static_cast<std::uint64_t>(getIntOption_("massgap_min_spectra"));
      gap_settings.min_share = getDoubleOption_("massgap_min_share");
      gap_settings.min_bin = static_cast<std::uint64_t>(getIntOption_("massgap_min_bin"));
      gap_settings.max_mods = getIntOption_("massgap_max_mods");
      gap_settings.top = getIntOption_("massgap_top");
      gap_settings.silac_share = getDoubleOption_("massgap_silac_share");
      gap_settings.silac_min = static_cast<std::uint64_t>(getIntOption_("massgap_silac_min"));
      gap_combos = FD::combinations(gap_mods, gap_settings.max_mods);
    }
    // #5: the protease models the hand-off check scores the tag ends with
    // (-digest_out's table when that report is on, so both agree; else the
    // shipped one over the database's composition), and the engine
    // configuration, validated here so a bad template or an inexpressible
    // modification is refused before any tagging.
    FD::ModelTable sl_models;
    const FD::DigestSettings sl_digest = digest_on ? digest_settings : FD::DigestSettings();
    FASTag::SearchConfig::SearchPlan sl_plan;
    std::string sl_template;
    bool handoff_refused = false;
    if (handoff_on)
    {
      if (digest_on) sl_models = protease_models;
      else
      {
        const std::string dd = digestDir_();
        std::string err;
        if (dd.empty())
        {
          OPENMS_LOG_ERROR << "No shipped protease models found (expected <bin>/../share/FASTag/digest); the "
                              "shortlist's protease check needs them. Set FASTAG_DIGEST_DIR to the directory "
                              "holding digest_models.tsv." << std::endl;
          return ILLEGAL_PARAMETERS;
        }
        if (!FD::loadModelTable(dd + "/digest_models.tsv", sl_models, &err))
        {
          OPENMS_LOG_ERROR << "'" << dd << "/digest_models.tsv': " << err << std::endl;
          return INPUT_FILE_CORRUPT;
        }
        resolved_inputs.emplace_back("digest_models (shipped)", dd + "/digest_models.tsv");
        sl_models.bg_c = sl_models.bg_n = FD::composition(sl_db_residues, true);
        sl_models.has_bg = true;
      }
      if (!search_config_out.empty())
      {
        sl_plan.database = fasta_out.empty() ? recon_db : fasta_out;
        sl_plan.spectra = in;
        const ModificationsDB* mdb = ModificationsDB::getInstance();
        for (const std::string& nm : getStringList_("fixed_modifications"))
          if (!nm.empty()) sl_plan.fixed.push_back(mdb->getModification(nm));
        for (const std::string& nm : getStringList_("variable_modifications"))
          if (!nm.empty()) sl_plan.variable.push_back(mdb->getModification(nm));
        sl_plan.missed_cleavages = getIntOption_("recon_missed_cleavages");
        sl_plan.fragment_tolerance = p.frag_tol;
        sl_plan.fragment_ppm = p.tol_ppm;
        sl_plan.precursor_tolerance = getDoubleOption_("search_precursor_tolerance");
        sl_plan.precursor_ppm = getStringOption_("search_precursor_unit") == "ppm";
        sl_plan.isotope_errors = getIntOption_("search_isotope_errors");
        sl_plan.decoy_prefix = getStringOption_("search_decoy_prefix");
        sl_plan.fastag_version = FASTAG_VERSION;
        std::string err;
        if (search_engine == "comet")
        {
          std::vector<std::pair<std::string, std::string>> keys;
          err = FASTag::SearchConfig::cometKeys(sl_plan, keys);
          const std::string tmpl_path = getStringOption_("search_config_template");
          if (err.empty() && !tmpl_path.empty())
          {
            std::ifstream tf(tmpl_path.c_str(), std::ios::binary);
            std::ostringstream ts;
            ts << tf.rdbuf();
            sl_template = ts.str();
            if (!tf.good() && !tf.eof()) err = "cannot read -search_config_template '" + tmpl_path + "'";
            else
            {
              const auto m = FASTag::SearchConfig::mergeKeyValueTemplate(sl_template, keys);
              if (!m.error.empty()) err = "-search_config_template '" + tmpl_path + "': " + m.error;
            }
          }
        }
        if (!err.empty())
        {
          OPENMS_LOG_ERROR << "-search_config_out: " << err << "." << std::endl;
          return ILLEGAL_PARAMETERS;
        }
        if (fasta_out.empty() && sl_decoys > 0)
          OPENMS_LOG_WARN << "-search_config_out names '" << recon_db << "', which holds " << sl_decoys
                          << " decoys, and lets the engine generate decoys as well; give -fasta_out to search "
                             "a database without them." << std::endl;
      }
    }
    // The run rows every report starts with (src/RunMeta.h), filled once.
    FASTag::RunReport::RunMeta run_meta;
    run_meta.version = FASTAG_VERSION;
    run_meta.input = File::basename(in);
    run_meta.fragment_tolerance = p.frag_tol;
    run_meta.fragment_tolerance_unit = getStringOption_("fragment_tolerance_unit");
    run_meta.tag_lengths = lengths;
    run_meta.subsample_fraction = getDoubleOption_("subsample_fraction");
    run_meta.subsample_spectra = getIntOption_("subsample_spectra");
    const auto run_rows = [&run_meta]() { return FASTag::RunReport::runRows(run_meta); };

    // ---- phase 3: -stream mode (returns early) -----------------------------

    if (stream_mode)
    {
      FILE* const dataf = stream_data_;  // the real stdout, sealed at entry
      const std::vector<FASTag::Tables> stream_tables = build_tables();
      const bool stream_proforma = getFlag_("proforma");
      const std::string stream_proforma_prefix =
          stream_proforma ? buildProformaPrefix(p.mods) : std::string();
      std::fputs(tagHeader(stream_proforma, p.per_residue_conf, false).c_str(), dataf);
      std::fflush(dataf);

      std::string line, id;
      double prec_mz = 0;
      int charge = 0;
      MSSpectrum spec;
      bool in_block = false, bad_block = false, sink_dead = false;
      auto resync_error = [&](const std::string& msg) {
        if (std::fprintf(dataf, "#error %s %s\n", id.empty() ? "?" : id.c_str(), msg.c_str()) < 0
            || std::fflush(dataf) != 0)
          sink_dead = true;
        bad_block = true;
      };
      auto finish_block = [&]() {
        if (!in_block) return;
        if (!bad_block)
        {
          spec.sortByPosition();
          std::string buf;
          size_t n = 0;
          if (!spec.empty())
          {
            const auto tags = tag_all(spec, prec_mz, charge, stream_tables);
            n = tags.size();
            for (const auto& t : tags)
              appendTagRow(buf, t, id, "-", stream_proforma, stream_proforma_prefix, p.per_residue_conf);
          }
          if (std::fprintf(dataf, "%s#end %s %zu\n", buf.c_str(), id.c_str(), n) < 0
              || std::fflush(dataf) != 0)
            sink_dead = true;
        }
        in_block = bad_block = false;
        spec.clear(true);
        id.clear();
      };
      while (!sink_dead && std::getline(std::cin, line))
      {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (line.empty()) { finish_block(); continue; }
        if (line.rfind("spectrum ", 0) == 0)
        {
          finish_block();  // an unterminated previous block still gets its sentinel
          // Sized to the line: a token cannot be longer, so no ID is cut short.
          std::vector<char> idbuf(line.size() + 1, 0);
          if (std::sscanf(line.c_str(), "spectrum %s %lf %d", idbuf.data(), &prec_mz, &charge) != 3
              || !(prec_mz > 0) || !std::isfinite(prec_mz))
          {
            id.clear();
            in_block = true;
            resync_error("bad header (want: spectrum <id> <precursor_mz> <charge>)");
            continue;
          }
          id = idbuf.data();
          in_block = true;
          continue;
        }
        if (!in_block) continue;  // stray line between blocks
        if (bad_block) continue;  // resync: swallow until the blank line
        double mz, inten;
        if (std::sscanf(line.c_str(), "%lf %lf", &mz, &inten) != 2)
        {
          resync_error("bad peak line: " + line.substr(0, 64));
          continue;
        }
        spec.emplace_back(mz, static_cast<float>(inten));
      }
      finish_block();  // EOF mid-block: emit what we have
      if (sink_dead)
      {
        // The CONSUMER died (closed pipe), not us -- the malformed-input
        // promise still holds; a dead reader is the one thing worth exiting for.
        OPENMS_LOG_ERROR << "-stream: the output consumer closed the pipe; exiting." << std::endl;
        return CANNOT_WRITE_OUTPUT_FILE;
      }
      return EXECUTION_OK;
    }
    if (filtering)
    {
      std::vector<FASTAFile::FASTAEntry> entries;
      FASTAFile().load(fasta, entries);
      std::string err;
      if (!filt.load(entries, &err))
      {
        OPENMS_LOG_ERROR << "FASTA: " << err << std::endl;
        return INPUT_FILE_EMPTY;
      }
      const int min_filter_len = getIntOption_("min_filter_length");
      if (min_filter_len > 0) filt.setMinLen(min_filter_len);
      if (iso_tol > 0) filt.deriveCollapses(iso_tol, fixed_deltas);
      // build() refuses a run whose longest tag cannot reach the filter's
      // floor. Every other seed length has to reach it too, as it would have
      // to on its own, and is refused the way build() refuses that run, so
      // the exit code is the same.
      for (size_t i = 0; i + 1 < lengths.size(); ++i)
        if (lengths[i] + 2 * p.max_extension < filt.minLen())
          throw Exception::InvalidParameter(
              __FILE__, __LINE__, OPENMS_PRETTY_FUNCTION,
              "Seed length " + std::to_string(lengths[i]) + " reaches at most " +
              std::to_string(lengths[i] + 2 * p.max_extension) + " residues, below the " +
              std::to_string(filt.minLen()) + " this database needs to beat chance, so it could "
              "never report a tag. Drop it from 'tag_lengths', raise 'extension', or set "
              "'min_filter_length'.");
      try
      {
        filt.build(lengths.front(), max_len);
      }
      catch (const Exception::InvalidParameter&)
      {
        // With several lengths only the size cap gets here (the floor is
        // checked above). One index serves them all, so it can outgrow the
        // cap where each length's own run fits: say so before build()'s text.
        if (lengths.size() > 1)
          OPENMS_LOG_ERROR << "One FASTA index serves every length in tag_lengths, so it covers "
                           << "tags of " << std::max(lengths.front(), filt.minLen()) << " to "
                           << max_len << " residues at once; split the lengths across runs "
                           << "to fit the limit." << std::endl;
        throw;
      }
      OPENMS_LOG_INFO << "Filter index: " << filt.indexedKeys() << " keys" << std::endl;

      OPENMS_LOG_INFO << "Filter: " << filt.sequenceCount() << " sequences, "
                      << filt.residueCount() << " residues; minimum tag length " << filt.minLen()
                      << (filt.minLenAuto() ? " (derived)" : " (set)")
                      << "; " << filt.collapseRules() << " isobaric rules" << std::endl;
      if (!filt.minLenAuto() && filt.minLen() < filt.autoMinLen())
      {
        OPENMS_LOG_WARN << "min_filter_length " << filt.minLen() << " is below the derived floor "
                        << filt.autoMinLen() << "; about " << 100 * filt.chanceRate(filt.minLen())
                        << "% of random tags that length occur in this database by chance."
                        << std::endl;
      }

      if (entrap_on)
      {
        // Identical settings to the target filter -- same orientation, same
        // collapse rules, same length range, and the TARGET's length floor
        // (its own would differ with database size and skew the accounting).
        std::vector<FASTAFile::FASTAEntry> eentries;
        FASTAFile().load(entrap_fasta, eentries);
        std::string eerr;
        if (!entrap.load(eentries, &eerr))
        {
          OPENMS_LOG_ERROR << "Entrapment FASTA: " << eerr << std::endl;
          return INPUT_FILE_EMPTY;
        }
        entrap.setMinLen(filt.minLen());
        if (iso_tol > 0) entrap.deriveCollapses(iso_tol, fixed_deltas);
        entrap.build(lengths.front(), max_len);
        OPENMS_LOG_INFO << "Entrapment: " << entrap.sequenceCount() << " sequences, "
                        << entrap.residueCount() << " residues, "
                        << entrap.indexedKeys() << " keys" << std::endl;
      }
    }

    // ---- phase 4: opening the input and choosing the reader ----------------

    // Input readers. mzML: every one reads a spectrum at a time from an
    // indexed file, so memory is O(threads), not O(file), and each worker
    // gets its own copy (none is thread-safe):
    //   .mzML    IndexedMzMLReader, which needs no up-front metadata parse;
    //            else OnDiscMSExperiment (-out_spectra needs its run-level
    //            metadata); else, with no usable index, a full load.
    //   .mzpeak  MzPeakStream: OpenMS's MzPeakFile reads the archive once,
    //            in file order, and the workers take the spectra from it.
    //   .mgf     MgfReader: one parallel scan finds every block, then each
    //            worker reads blocks at random, like the mzML index.
    // Compressed input (.gz, .bz2, .zip) is refused: none of these seek.
    // -out_spectra's writer follows ITS extension, so mzML->mzpeak and
    // mzpeak->mzML both work as a side effect of tagging.
    const auto has_ext = [](const std::string& p, const char* ext) {
      return StringUtils::hasSuffix(StringUtils::toLowered(p), ext);
    };
    const auto is_mzpeak = [](const std::string& p) {
      return FileHandler::getTypeByFileName(p) == FileTypes::MZPEAK || MzPeakFile::isMzPeak(p);
    };
    const auto is_mzml = [&](const std::string& p) { return has_ext(p, ".mzml"); };
    // getTypeByFileName sees through a compression suffix (x.mgf.gz is MGF),
    // so the suffix is checked first.
    const auto is_mgf = [](const std::string& p) {
      return FileHandler::getTypeByFileName(p) == FileTypes::MGF;
    };
    if (!is_mzpeak(in) && FileNameUtils::hasCompressionSuffix(in))
    {
      const FileTypes::Type c = FileNameUtils::compressionType(in);
      OPENMS_LOG_ERROR << "Input '" << in << "' is "
                       << (c == FileTypes::GZ ? "gzip" : c == FileTypes::BZ2 ? "bzip2" : "zip")
                       << "-compressed; FASTag reads uncompressed input only. Decompress it first."
                       << std::endl;
      return ILLEGAL_PARAMETERS;
    }
    if (!is_mzpeak(in) && !is_mzml(in) && !is_mgf(in))
    {
      OPENMS_LOG_ERROR << "Input '" << in << "' is neither .mzML, .mzpeak nor .mgf." << std::endl;
      return ILLEGAL_PARAMETERS;
    }
    const bool mzpeak_in = is_mzpeak(in);
    const bool mgf_in = !mzpeak_in && is_mgf(in);
    // #9: what each reader does with profile MS2 (src/Centroid.h). mzPeak
    // centroids in MzPeakStream; mzML (any of its readers) in the tagging
    // loop, the probe and the -out_spectra re-read; MGF never.
    namespace FC = FASTag::Centroid;
    const FC::Policy pick_mzpeak = FC::policyFor(pick_mode, FC::Input::MzPeak, pick_unknown_type);
    const FC::Policy pick_mzml =
        FC::policyFor(pick_mode, mgf_in ? FC::Input::Mgf : FC::Input::MzML, pick_unknown_type);
    const bool pick_in_loop = !mzpeak_in && pick_mzml.pick;
    if (mgf_in && pick_mode == FC::Mode::Auto)
      OPENMS_LOG_WARN << "-pick_profile auto does not centroid MGF input (MGF declares no spectrum type); "
                         "its spectra are tagged as read." << std::endl;
    const bool mzpeak_out = !out_spectra.empty()
        && FileHandler::getTypeByFileName(out_spectra) == FileTypes::MZPEAK;
    if (!out_spectra.empty() && !mzpeak_out && !is_mzml(out_spectra))
    {
      OPENMS_LOG_ERROR << "-out_spectra '" << out_spectra
                       << "' must end in .mzML or .mzpeak." << std::endl;
      return ILLEGAL_PARAMETERS;
    }
    if ((mzpeak_in || mzpeak_out) && !MzPeakFile::isSupported())
    {
      OPENMS_LOG_ERROR << "This build has no mzPeak support: the OpenMS it uses was built "
                          "without it (OPENMS_ENABLE_MZPEAK). Supply mzML."
                       << std::endl;
      return ILLEGAL_PARAMETERS;
    }

    // Make sure this process may open the files the readers are about to.
    //
    // Every decoding thread of the mzPeak reader opens its own handles to the
    // archive's members, about six descriptors per thread, and MzPeakFile
    // caps its threads by the soft limit. The usual soft limit of 1024
    // therefore caps the decoding at roughly 110 threads.
    //
    // Raising the SOFT limit toward the hard one needs no privileges; it is
    // what the hard limit is for. Only raise, never lower, and stay quiet
    // unless it cannot be done.
#ifndef _WIN32
    {
      struct rlimit lim{};
      if (getrlimit(RLIMIT_NOFILE, &lim) == 0)
      {
        const rlim_t want = static_cast<rlim_t>(omp_get_max_threads()) * 16 + 1024;
        if (lim.rlim_cur < want && lim.rlim_cur < lim.rlim_max)
        {
          const rlim_t before = lim.rlim_cur;
          lim.rlim_cur = std::min(want, lim.rlim_max);
          if (setrlimit(RLIMIT_NOFILE, &lim) != 0)
          {
            OPENMS_LOG_WARN << "could not raise the open-file limit from " << before
                            << "; a large -threads may read the input with fewer threads."
                            << std::endl;
          }
        }
      }
    }
#endif

    // The tagging loop's dynamic chunks, here because the mzPeak window is
    // sized by them.
    constexpr int kChunk = 256, kTailChunk = 16;
    const int read_threads = std::max(1, omp_get_max_threads());
    // Decoding threads for mzPeak, capped: MzPeakFile opens a reader per
    // decoding thread for every batch of spectra, one at a time, so more
    // threads cost more than they decode. 4-16 were alike at 64 tagging
    // threads (1.0-1.2 s on a 27k-spectrum run); 64 took 2.2 s.
    const int mzpeak_decode_threads = std::min(read_threads, 8);
    std::unique_ptr<FASTag::MzPeakStream> mzs;
    if (mzpeak_in)
    {
      try
      {
        const auto a = std::chrono::steady_clock::now();
        // Room for every thread's chunk, plus a decoded batch either side.
        mzs = std::make_unique<FASTag::MzPeakStream>(
            in, mzpeak_decode_threads, static_cast<size_t>(read_threads) * kChunk + 4096);
        static_cast<void>(mzs->size());
        g_t_open = std::chrono::duration<double>(std::chrono::steady_clock::now() - a).count();
      }
      catch (const Exception::BaseException& e)
      {
        OPENMS_LOG_ERROR << e.what() << std::endl;
        return INPUT_FILE_CORRUPT;
      }
    }
    // MGF: the block scan checks the whole file's structure (its markers)
    // here, before any output is opened, and names the lowest bad block. A
    // block's content is parsed when it is read. Also with
    // -out_spectra: the reader is random access and carries the run-level
    // settings an MGF supports (its SourceFile).
    std::unique_ptr<FASTag::MgfReader> mgf;
    if (mgf_in)
    {
      try
      {
        const auto a = std::chrono::steady_clock::now();
        mgf = std::make_unique<FASTag::MgfReader>(in);
        g_t_open = std::chrono::duration<double>(std::chrono::steady_clock::now() - a).count();
      }
      catch (const Exception::FileEmpty&)
      {
        OPENMS_LOG_ERROR << "'" << in << "' contains no BEGIN IONS block; is it an MGF file?" << std::endl;
        return INPUT_FILE_EMPTY;
      }
      catch (const Exception::FileNotReadable& e)
      {
        OPENMS_LOG_ERROR << e.what() << std::endl;
        return INPUT_FILE_NOT_READABLE;
      }
      catch (const Exception::BaseException& e)
      {
        OPENMS_LOG_ERROR << e.what() << std::endl;
        return INPUT_FILE_CORRUPT;
      }
      if (mgf->hasBom())
        OPENMS_LOG_WARN << "'" << in << "' starts with a UTF-8 byte-order mark; skipped it." << std::endl;
      // Text outside BEGIN IONS ... END IONS is ignored, as in OpenMS; what
      // looks like a lost spectrum there is said, with where it starts.
      const FASTag::MgfReader::Blocks& mb = mgf->blocks();
      if (mb.stray_ends > 0)
        OPENMS_LOG_WARN << "'" << in << "': " << mb.stray_ends << " END IONS line(s) outside any "
                           "block (the first ends at byte " << mb.first_stray_end << "). Each "
                           "ends a block whose BEGIN IONS line is missing; that spectrum is "
                           "ignored." << std::endl;
      if (mb.loose_regions > 0)
        OPENMS_LOG_WARN << "'" << in << "': " << mb.loose_regions << " stretch(es) of text outside "
                           "BEGIN IONS ... END IONS look like spectra (a peak line, PEPMASS=, "
                           "TITLE=, RTINSECONDS= or SCANS=; the first at byte " << mb.first_loose
                        << ") and were ignored." << std::endl;
      if (mgf->headerBytes() > FASTag::MgfReader::kHeaderScan)
        OPENMS_LOG_WARN << "'" << in << "': " << mgf->headerBytes() << " bytes before the first "
                           "BEGIN IONS were ignored (only the first "
                        << FASTag::MgfReader::kHeaderScan << " were looked at for a CHARGE= default)."
                        << std::endl;
    }
    // The fast mzML path: our own index-driven reader, which fills the
    // metadata OpenMS's per-spectrum decoder drops and so needs no serial
    // up-front metadata parse (see IndexedMzMLReader.h).
    //
    // Only when -out_spectra is off: writing needs run-level settings
    // (instrument, source files), which this reader deliberately does not
    // read, and getting them means the very pre-pass being avoided.
    //
    // Probed before it is trusted: a reader reporting no MS2-with-precursor
    // in the first spectra is not used, so a file it cannot understand falls
    // back instead of producing a confident nothing. The fallback,
    // OnDiscMSExperiment, loads all spectrum metadata up front: a serial pass
    // that is slow on a large file, but correct.
    std::unique_ptr<FASTag::IndexedMzMLReader> fastmz;
    if (!mzpeak_in && !mgf_in && out_spectra.empty())
    {
      const auto opened = std::chrono::steady_clock::now();
      auto candidate = std::make_unique<FASTag::IndexedMzMLReader>(in);
      if (candidate->ok() && candidate->reportsSpectrumMetadata()) fastmz = std::move(candidate);
      if (fastmz && fastmz->indexRebuilt())
      {
        const double secs =
            std::chrono::duration<double>(std::chrono::steady_clock::now() - opened).count();
        OPENMS_LOG_WARN << "'" << in << "' has no index, or one that no longer matches the file "
                           "(edited after it was written?); found its "
                        << fastmz->getNrSpectra() << " spectra by scanning it instead ("
                        << std::round(secs * 100.0) / 100.0
                        << " s). Re-index it, e.g. with FileConverter, to skip the scan."
                        << std::endl;
      }
    }

    auto ondisc = std::make_unique<OnDiscMSExperiment>();
    PeakMap exp;
    const bool streaming = !mzpeak_in && !mgf_in && !fastmz && ondisc->openFile(in);
    // Spectrum i of an mzML input: the per-spectrum reader or the fully
    // loaded map. For the SERIAL callers only; the tagging loop gives each
    // thread its own reader. (mzPeak is read in one pass, by MzPeakStream.)
    auto read_spectrum = [&](Size i) -> MSSpectrum {
      if (mgf) return mgf->getSpectrum(i);
      if (fastmz) return fastmz->getSpectrum(i);
      return streaming ? ondisc->getSpectrum(i) : exp[i];
    };
    if (!streaming && !mzpeak_in && !mgf_in && !fastmz)
    {
      OPENMS_LOG_WARN << "'" << in << "' has no usable index; reading it entirely "
                         "into memory. Run FileConverter to write an indexed mzML "
                         "if the file is large." << std::endl;
      FileHandler().loadExperiment(in, exp, {FileTypes::MZML});
    }
    size_t n_total = streaming ? ondisc->getNrSpectra() : exp.size();
    if (mzs) n_total = mzs->size();
    if (fastmz) n_total = fastmz->getNrSpectra();
    if (mgf) n_total = mgf->getNrSpectra();

    // ---- 1.12 E: acquisition check (#7) ------------------------------------

    // Raw DIA is refused HERE: after the reader is chosen and before any
    // output is opened, so a refused run leaves every file that existed
    // before it untouched. A metadata-only probe over the first MS2, through
    // the reader the run uses (the export's reader under -out_spectra, so
    // nothing new is read from the spectra it writes), then the pure
    // classifier of src/Acquisition.h. -stream is not checked (returned
    // above). The thresholds are frozen (validation-registry.tsv E7-09).
    {
      namespace Acq = FASTag::Acquisition;
      const std::string acq_check = getStringOption_("acquisition_check");
      if (acq_check != "off")
      {
        // The probe itself (reader, header provenance, limits) is
        // Acq::probeRun(), shared with probeFile() for callers without a
        // FASTag run; only the decision is made here.
        Acq::ProbeSource src;
        src.mzpeak = mzpeak_in;
        src.mzpeak_threads = mzpeak_decode_threads;
        src.mgf = mgf.get();
        src.fastmz = fastmz.get();
        if (streaming) src.ondisc = ondisc.get();
        else src.exp = &exp;
        src.n_total = n_total;
        const Acq::ProbeResult probe =
            Acq::probeRun(in, src, static_cast<size_t>(getIntOption_("acquisition_probe_spectra")));
        if (!probe.ok)
        {
          OPENMS_LOG_ERROR << probe.error << std::endl;
          return INPUT_FILE_CORRUPT;
        }
        const Acq::AcqCall& call = probe.call;
        run_meta.acquisition = Acq::modeName(call);
        run_meta.acquisition_why = call.why;
        // INFO on stderr only: nothing new may reach stdout or match the
        // summary line the gate digests.
        std::cerr << Acq::infoLine(call) << std::endl;
        if (call.mode == Acq::Mode::DIA)
        {
          if (acq_check == "refuse")
          {
            OPENMS_LOG_ERROR << Acq::refusalMessage(call, in) << std::endl;
            std::cerr << Acq::refusalSentinel(call) << std::endl;
            return INCOMPATIBLE_INPUT_DATA;
          }
          OPENMS_LOG_WARN << Acq::taggedAnywayMessage(call, in) << std::endl;
        }
        else if (call.warn)
        {
          OPENMS_LOG_WARN << Acq::warningMessage(call, in) << std::endl;
        }
      }
    }

    // #15 phase B: whether the tag TSV and the census carry an ion_series
    // column. Under cz always; under auto when some MS2 of the run is
    // electron activated -- found by a metadata-only scan here, before any
    // output opens, that stops at the first one -- so a collisional run
    // under auto writes exactly what by writes. MGF and mzPeak carry no
    // activation (IonSeries.h): auto reads them as b/y, without the column.
    bool ion_column = ion_mode == FASTag::IonSeries::Mode::Cz;
    if (ion_mode == FASTag::IonSeries::Mode::Auto && FASTag::IonSeries::autoReadsActivation(mzpeak_in, mgf_in))
    {
      std::shared_ptr<PeakMap> od_meta;
      if (!fastmz && streaming) od_meta = ondisc->getMetaData();
      FASTag::IonSeries::ActivationCounts scan;
      for (size_t i = 0; i < n_total && scan.of(FASTag::IonSeries::Activation::Electron) == 0; ++i)
      {
        MSSpectrum head;
        if (fastmz) head = fastmz->getSpectrumMetadata(i);
        else if (od_meta) { if (i < od_meta->size()) head = (*od_meta)[i]; }
        else if (i < exp.size()) head = exp[i];
        if (head.getMSLevel() == 2) scan.add(FASTag::IonSeries::activationClass(head));
      }
      ion_column = FASTag::IonSeries::seriesColumn(ion_mode, scan);
    }
    // The census layout of this run (Census::header() reads it; so does
    // -census_ids, which takes that header as the table's layout).
    FASTag::Census::runColumns().ion_series = ion_column;

    // Subsampling selection. The mask is exact for every input -- it is built
    // over the spectrum indices up front. The count over ALL input spectra,
    // not MS2 only: the fast reader does not know the MS level up front, and
    // a fraction is proportional regardless.
    const size_t subsample_n = static_cast<size_t>(getIntOption_("subsample_spectra"));
    const double subsample_frac = getDoubleOption_("subsample_fraction");
    const uint32_t subsample_seed = static_cast<uint32_t>(getIntOption_("subsample_seed"));
    const bool subsampling = subsample_n > 0 || subsample_frac > 0.0;
    FASTag::SampleMask sample_mask;
    if (subsampling)
    {
      sample_mask = subsample_n > 0 ? FASTag::sampleByCount(n_total, subsample_n, subsample_seed)
                                    : FASTag::sampleByFraction(n_total, subsample_frac, subsample_seed);
      OPENMS_LOG_INFO << "Subsampling: tagging "
                      << std::count(sample_mask.begin(), sample_mask.end(), char(1)) << " of " << n_total
                      << " input spectra (seed " << subsample_seed << ")" << std::endl;
    }

    // ---- phase 5: tolerance probe and output collision check --------------

    // Warn when the fragment tolerance looks far too tight for the data.
    //
    // A high-resolution tolerance on low-resolution data is silent, and looks
    // exactly like a bad file. Measured on an ion-trap MS2 run: 3,007 tags at
    // 20 ppm against 824,959 at 0.3 Da -- a factor of 274, with nothing in the
    // output to suggest the setting was at fault rather than the spectra.
    //
    // The analyser is not read from run-level metadata, because the fast reader
    // path deliberately does not load it. Infer resolution from the peaks
    // instead: an ion trap cannot place two peaks closer than roughly 0.2-0.3 Th,
    // while an Orbitrap or TOF routinely does. If the closest pair anywhere in
    // the sample is still many times the tolerance, no real fragment can be
    // matched at that tolerance either.
    // 64 samples: the test is coarse (does the tightest spacing anywhere
    // exceed 20x the tolerance?), and every sample costs a read -- on a
    // profile archive a CENTROIDING too.
    //
    // In a few CLUSTERS of consecutive spectra across the run: a run changes
    // over its gradient, and the probe wants the file's TIGHTEST peak
    // spacing, not a typical one.
    constexpr Size kClusters = 8;  // 8 spectra each
    const Size probe_want = std::min<Size>(n_total, 64);
    const Size per_cluster = std::max<Size>(1, probe_want / kClusters);
    const Size cluster_step = std::max<Size>(1, n_total / kClusters);
    std::set<Size> probe_idx;
    for (Size c = 0; c < kClusters; ++c)
      for (Size k = 0; k < per_cluster && c * cluster_step + k < n_total; ++k)
        probe_idx.insert(c * cluster_step + k);
    auto tolerance_probe = [&](auto&& read)
    {
      // The FIRST closest pair, in cluster order.
      double tightest = std::numeric_limits<double>::max();
      double at_mz = 0;
      for (const Size i : probe_idx)
      {
        MSSpectrum s = read(i);
        if (s.getMSLevel() != 2 || s.size() < 8) continue;
        s.sortByPosition();
        for (Size j = 1; j < s.size(); ++j)
        {
          const double d = s[j].getMZ() - s[j - 1].getMZ();
          if (d > 0 && d < tightest) { tightest = d; at_mz = s[j].getMZ(); }
        }
      }
      if (at_mz > 0)
      {
        const double tol = p.tol_ppm ? at_mz * p.frag_tol * 1e-6 : p.frag_tol;
        if (tol > 0 && tightest > 20.0 * tol)
        {
          OPENMS_LOG_WARN
            << "No two peaks anywhere in this file are closer than " << tightest
            << " Th, yet the fragment tolerance is " << tol << " Th near m/z "
            << at_mz << ". That is what low-resolution (ion trap) MS2 read with a "
                        "high-resolution tolerance looks like, and it yields almost "
                        "no tags for a reason the output cannot show. If the MS2 is "
                        "ion trap, try -fragment_tolerance 0.3 "
                        "-fragment_tolerance_unit Da." << std::endl;
        }
      }
    };
    const auto t_probe_a = std::chrono::steady_clock::now();
    // mzPeak is read once, in file order, so its probe runs on copies the
    // reader keeps aside, after the loop.
    if (mzs) mzs->start(sample_mask, probe_idx, pick_mzpeak);
    else if (pick_in_loop)
    {
      // The probe sees the spectra as they are tagged.
      PeakPickerHiRes probe_picker;
      tolerance_probe([&](Size i) {
        MSSpectrum s = read_spectrum(i);
        FC::apply(s, probe_picker, pick_mzml);
        return s;
      });
    }
    else tolerance_probe(read_spectrum);

    const auto t_tables_a = std::chrono::steady_clock::now();
    g_t_probe = std::chrono::duration<double>(t_tables_a - t_probe_a).count();
    const std::vector<FASTag::Tables> tables = build_tables();
    // #15 phase B: the c/z-dot tables (empty under by).
    const std::vector<FASTag::Tables> tables_cz =
        ion_mode != FASTag::IonSeries::Mode::By ? build_tables(true) : std::vector<FASTag::Tables>();
    g_t_tables = std::chrono::duration<double>(std::chrono::steady_clock::now() - t_tables_a).count();
    // mzPeak output cannot store an ion mobility per peak: refuse before any
    // work. For mzML the first MS2 is checked here; an mzPeak input is read
    // once, in the tagging loop, which stops at its first such MS2.
    const auto refuse_im = [&]()
    {
      OPENMS_LOG_ERROR << "Not writing " << out_spectra << ": the input's MS2 spectra have an "
                          "ion mobility per peak, which mzPeak output cannot store yet. Write "
                          "-out_spectra as .mzML instead." << std::endl;
      return INCOMPATIBLE_INPUT_DATA;
    };
    // MGF carries no per-peak ion mobility: nothing to check.
    if (mzpeak_out && !mzpeak_in && !mgf_in)
    {
      const Size n_check = streaming ? ondisc->getNrSpectra() : exp.size();
      for (Size i = 0; i < n_check; ++i)
      {
        const MSSpectrum sp = read_spectrum(i);
        if (sp.getMSLevel() != 2) continue;
        if (sp.containsIMData()) return refuse_im();
        break;
      }
    }
    // No output may be an input the run consumes or another output, by any
    // name (a symlink or hard link included). Opening an output truncates
    // it: -out_spectra equal to -in destroyed the raw file before it was
    // re-read, and -species_out equal to -out replaced the finished tag
    // table. Checked before the first output is opened, with the default
    // report paths resolved as below (FASTag::PathGuard, OutputGuard.h).
    {
      FASTag::PathGuard guard;
      guard.input("in", in);
      guard.input("fasta", fasta);
      for (const char* opt : {"recon_fasta", "entrapment_fasta", "digest_models", "taxdb",
                              "taxonomy_nodes", "taxonomy_names"})
        guard.input(opt, getStringOption_(opt));
      // ---- 1.12 E: guarded inputs ----
      // ---- 1.12 A: guarded inputs ----
      guard.input("shortlist_background", getStringOption_("shortlist_background"));
      guard.input("search_config_template", getStringOption_("search_config_template"));
      // ---- 1.12 D: guarded inputs ----
      guard.input("species_call_params", species_call_params_path);
      guard.input("digest_calibration", getStringOption_("digest_calibration"));
      // A named proteome (bundled:<name>) is read as much as a given one.
      if (!alk_db.empty()) guard.input("alkylation_proteome", alk_db);
      // Inputs resolved from defaults: the shipped digest tables loaded above,
      // and the bundled taxonomy -species reads when no -taxdb set is given.
      for (const auto& ri : resolved_inputs) guard.input(ri.first.c_str(), ri.second);
      if (want_species && getStringOption_("taxdb").empty() && getStringOption_("taxonomy_nodes").empty()
          && getStringOption_("taxonomy_names").empty())
      {
        const std::string tdir = taxonomyDir_();
        if (!tdir.empty())
          for (const auto& tf : {std::make_pair("taxdb (bundled)", "/tax_k7.taxdb"),
                                 std::make_pair("taxonomy_nodes (bundled)", "/nodes.dmp"),
                                 std::make_pair("taxonomy_names (bundled)", "/names.dmp")})
            if (File::exists(tdir + tf.second)) guard.input(tf.first, tdir + tf.second);
      }
      // ---- 1.12 F: guarded inputs ----
      if (getFlag_("census")) guard.input("census_ids", getStringOption_("census_ids"));
      guard.output("out", out);
      guard.output("out_spectra", out_spectra);
      guard.output("recon_out", recon_out);
      guard.output("delta_out", delta_out);
      guard.output("recon_id_out", recon_id_out);
      guard.output("digest_out", digest_out);
      guard.output("label_out", label_out);
      guard.output("massgap_out", massgap_out);
      if (hdr_check_on) guard.output("check_header_out", check_header_out, true);
      // The q_db post-pass writes <out>.qtmp and renames it onto -out.
      if (entrap_on) guard.output("out (q_db temporary file)", out + ".qtmp");
      if (getFlag_("glyco"))
      {
        const std::string g = getStringOption_("glyco_out");
        guard.output("glyco_out", g.empty() ? defaultReportPath(out, ".glyco.tsv") : g);
      }
      if (want_species)
      {
        const std::string sp = getStringOption_("species_out");
        guard.output("species_out", sp.empty() ? defaultReportPath(out, ".species.tsv") : sp);
      }
      // Outputs are checked in this order. Each 1.12 cluster adds its rows
      // at its own anchor.
      // ---- 1.12 E: output paths ----
      // ---- 1.12 A: output paths ----
      guard.output("shortlist_out", shortlist_out, true);
      guard.output("fasta_out", fasta_out, true);
      guard.output("search_config_out", search_config_out, true);
      guard.output("search_shifts_out", search_shifts_out, true);
      // ---- 1.12 D: output paths ----
      guard.output("alkylation_out", alkylation_out, true);
      // ---- 1.12 F: output paths ----
      if (getFlag_("census"))
      {
        const std::string c = getStringOption_("census_out");
        const std::string cs = getStringOption_("census_summary_out");
        // -census_ids joins the finished <census_out>.part into a .part of
        // that .part (a PartFile on the temporary path), so that path is
        // checked too.
        guard.output("census_out", c.empty() ? defaultReportPath(out, ".census.tsv") : c, /*via_part=*/true,
                     /*part_of_part=*/!getStringOption_("census_ids").empty());
        guard.output("census_summary_out", cs.empty() ? defaultReportPath(out, ".census_summary.tsv") : cs,
                     /*via_part=*/true);
      }
      const std::string collision = guard.check();
      if (!collision.empty())
      {
        OPENMS_LOG_ERROR << collision << std::endl;
        return ILLEGAL_PARAMETERS;
      }
    }

    // -census_ids (#11 phase B): read and checked before any output is
    // opened; the join itself runs on the finished census table (phase 8).
    const std::string census_ids = getFlag_("census") ? getStringOption_("census_ids") : std::string();
    const bool census_ids_on = !census_ids.empty();
    const double census_ids_fdr = getDoubleOption_("census_ids_fdr");
    const double census_triage_evalue = getDoubleOption_("census_triage_evalue");
    FASTag::CensusIds::Index census_ids_index;
    FASTag::CensusIds::Loaded census_ids_loaded;
    std::string census_ids_run_check;
    bool census_ids_refused = false;  ///< the census was withheld after the run (foreign references)
    if (census_ids_on)
    {
      census_ids_loaded = FASTag::CensusIds::load(census_ids, census_ids_fdr, census_ids_index);
      if (!census_ids_loaded.refusal.empty())
      {
        OPENMS_LOG_ERROR << census_ids_loaded.refusal << std::endl;
        return INCOMPATIBLE_INPUT_DATA;
      }
      census_ids_run_check = FASTag::CensusIds::runCheck(census_ids_loaded, in);
      if (census_ids_run_check == "mismatch")
        OPENMS_LOG_WARN << "Warning: -census_ids names the run '" << census_ids_loaded.runs.front() << "', -in is '"
                        << FASTag::CensusIds::runStem(in) << "'; the spectrum references are matched anyway."
                        << std::endl;
      OPENMS_LOG_INFO << "Census ids: " << census_ids_loaded.n_accepted << " of " << census_ids_loaded.n_ids
                      << " spectrum identifications pass q <= " << census_ids_fdr << " (" << census_ids << ")"
                      << std::endl;
    }

    std::ofstream tsv(out.c_str());
    if (!tsv)
    {
      OPENMS_LOG_ERROR << "Cannot open output file " << out << " for writing." << std::endl;
      return CANNOT_WRITE_OUTPUT_FILE;
    }
    const bool want_proforma = getFlag_("proforma");
    tsv << tagHeader(want_proforma, p.per_residue_conf, !usi_prefix.empty(), hyp_on, ion_column);

    std::ofstream rtsv;
    if (recon_on)
    {
      rtsv.open(recon_out.c_str());
      if (!rtsv)
      {
        OPENMS_LOG_ERROR << "Cannot open output file " << recon_out << " for writing." << std::endl;
        return CANNOT_WRITE_OUTPUT_FILE;
      }
      rtsv << "spectrum\ttag\tprotein\tpeptide\tpos\treversed\tnterm_match\tcterm_match"
              "\tdelta_mass\tregion\tdelta_interp"
           << (recon_loc ? "\tloc_site\tloc_score\tloc_ties" : "") << "\n";
    }


    const bool glyco_on = getFlag_("glyco");
    const double glyco_min_fraction = getDoubleOption_("glyco_min_fraction");
    std::string glyco_out = getStringOption_("glyco_out");
    std::ofstream gtsv;
    if (glyco_on)
    {
      if (glyco_out.empty()) glyco_out = defaultReportPath(out, ".glyco.tsv");
      gtsv.open(glyco_out.c_str());
      if (!gtsv)
      {
        OPENMS_LOG_ERROR << "Cannot open output file " << glyco_out << " for writing." << std::endl;
        return CANNOT_WRITE_OUTPUT_FILE;
      }
      gtsv << "spectrum\tn_oxonium\toxonium_frac\tglyco\tions\n";
    }

    // -census (#11): written through .part files, renamed when the run
    // finished; a failed run leaves neither.
    const bool census_on = getFlag_("census");
    std::string census_out = getStringOption_("census_out");
    std::string census_summary_out = getStringOption_("census_summary_out");
    if (census_out.empty()) census_out = defaultReportPath(out, ".census.tsv");
    if (census_summary_out.empty()) census_summary_out = defaultReportPath(out, ".census_summary.tsv");
    FASTag::PartFile census_part(census_out);
    std::ofstream ctsv;
    if (census_on)
    {
      if (!census_part.open(ctsv, std::ios::out | std::ios::binary))
      {
        OPENMS_LOG_ERROR << census_part.error() << std::endl;
        return CANNOT_WRITE_OUTPUT_FILE;
      }
      if (census_ids_on && census_part.direct())
      {
        OPENMS_LOG_ERROR << "-census_ids needs -census_out to be a regular file (" << census_out
                         << " is not): the ids are joined to the finished table." << std::endl;
        return ILLEGAL_PARAMETERS;
      }
      ctsv << FASTag::Census::header();
    }

    const std::string proforma_fixed =
        want_proforma ? buildProformaPrefix(p.mods) : std::string();

    PeakMap kept;
    if (mzs) kept.getExperimentalSettings() = mzs->settings();
    else if (mgf) kept.getExperimentalSettings() = mgf->settings();
    else if (streaming)
    {
      if (auto meta = ondisc->getMetaData()) kept.getExperimentalSettings() = *meta;
    }
    else kept.getExperimentalSettings() = exp.getExperimentalSettings();

    // ---- phase 6: the tagging loop -----------------------------------------

    size_t n_ms2 = 0, n_tags = 0, n_reported = 0;
    size_t n_glyco = 0, n_glyco_scanned = 0;
    std::map<int, std::pair<size_t, size_t>> by_len;   // length -> (seen, matched)

    // Parallel over spectra, which is the only safe level: each spectrum is
    // independent, `tables` and `filt` are immutable once built, and per-spectrum
    // work is ~60 us -- far too little to amortise a fork/join inside the tagger.
    //
    // Results are collected per BLOCK of spectra and written in input order as
    // each block finishes, so the output is identical whatever -threads is set
    // to while TSV memory stays bounded by three blocks (being written, being
    // finished, being started), not the run.
    const SignedSize n_spec = static_cast<SignedSize>(n_total);
    constexpr size_t BLOCK = 65536;
    // One block's results at block-local indices. There are kRing of them: the
    // writer thread empties one while the team finishes one and starts the
    // next (see the loop).
    struct Block
    {
      size_t base = 0;                 ///< input index of slot 0
      std::vector<std::string> rows;
      std::vector<std::string> recon_rows;  ///< recon rows (recon_on only)
      std::vector<std::vector<PeptideIdentification>> recon_id_lists;  ///< (recon_ids_on only)
      std::vector<std::string> glyco_rows;  ///< glyco rows (glyco_on only)
      std::vector<std::vector<std::pair<double, bool>>> row_meta;  ///< (entrap_on only)
      /// Per spectrum, per written tag row in row order: 1 when the row may be
      /// species evidence (#6: its hypothesis is the selected one); hyp_on &&
      /// want_species only. A flag beside the rows, never a column read back
      /// off them, so adding TSV columns cannot change it.
      std::vector<std::vector<char>> row_species;
      std::vector<char> keep, keep_target;
      /// #15 phase B: per spectrum, whether its rows were read as c/z-dot
      /// ions (SpecResult::cz); every row of a spectrum shares its series.
      /// -species leaves these rows out and counts them; no reader finds the
      /// ion_series column by position.
      std::vector<char> row_cz;
      FASTag::ClusterAcc::ClusterBlock acc;  ///< 1.12 per-cluster slots (src/ClusterAcc.h)
    };
    // Three: a fourth only helped within noise, for another block of rows
    // held in memory.
    constexpr size_t kRing = 3;
    Block blocks[kRing];
    for (Block& b : blocks) b.acc.f.census = census_on;
    // Two-pass -out_spectra, whatever the formats: record kept INPUT indices
    // during tagging, re-read and stream them to the writer at the end. Every
    // reader here is indexed, so nothing is held during tagging.
    const bool want_out = !out_spectra.empty();
    std::vector<Size> kept_idx;
    // One spectrum's delta sample: its placement's gap, interpretation and
    // site localization (-recon_localize; loc_residue 0 when not localized).
    struct DeltaSample
    {
      double delta = 0.0;
      std::string interp;
      char loc_residue = 0;  ///< the localized residue, 0 = not localized
      int loc_score = 0;     ///< b/y ions explained with the gap there
      int loc_ties = 0;      ///< region positions sharing loc_score
      int region_len = 0;    ///< residues the gap localizes to (0 when exact)
      bool has_c = false;    ///< #17 (-search_shifts only): the placed peptide holds a C
    };
    // Per-thread accumulators, summed after the loop. One cache-line-aligned
    // struct per thread, so neighbouring threads' counters never share a line.
    struct alignas(64) PerThread
    {
      std::map<int, std::pair<size_t, size_t>> len;  ///< length -> (seen, matched)
      size_t ms2 = 0, tags = 0, reported = 0;
      size_t no_charge = 0;  ///< MS2 whose precursor carries no charge (tagged as 2+)
      size_t multi_charge = 0;  ///< ... of them, those listing several possible charges
      // Entrapment-calibration accumulators (entrap_on only): target E-values,
      // and entrapment E-values with their tag length -- the key spaces are
      // per-length, so each entrapment event is weighted by 1/r_len later.
      std::vector<double> target_e;
      std::vector<std::pair<double, int>> entrap_e;
      // -delta_out accumulators: one sample per spectrum -- the best-E-value
      // tag's smallest-|delta| placement -- so 50 correlated tags cannot
      // flood a bin. Clamped-flank placements are excluded and counted: a
      // flank clamped to 0 (FASTagger's max(0,.)) makes its delta bogus.
      std::vector<DeltaSample> delta;
      size_t delta_clamped = 0;
      // -digest_out / -label_out: tag-end counts, and the MS2 metadata the
      // no-call rules read.
      FASTag::Digest::TerminusCounter digest;
      std::vector<double> first_peak, scan_low;
      size_t ms2_meta = 0, im_vssc = 0, im_drift = 0, im_faims = 0, im_other = 0;
      FASTag::Digest::RunMeta frag;  ///< 1.12 D #3c: MS2 fragmentation counts only (addFragmentation)
      size_t peaks = 0, peaks_whole = 0;
      // FASTAG_TIMING only, thread-seconds: reading (getSpectrum), of that in
      // reads slower than 1 ms (a wait for the mzPeak reader, for one),
      // tagging (tag_one + record), waiting for a ring buffer, and idle after
      // the last chunk.
      double s_read = 0, s_slow = 0, s_tag = 0, s_ring = 0, s_idle = 0;
      size_t n_slow = 0;
      FASTag::ClusterAcc::ClusterThread acc;  ///< 1.12 per-cluster accumulators (src/ClusterAcc.h)
      // 1.13 -check_header_charge: verdict counts, and (-check_header_out)
      // one row per header-charged MS2 spectrum, sorted by index at the end.
      FASTag::Hyp::HeaderCheckCounts hdr;
      struct HdrRow
      {
        size_t index = 0;
        std::string native_id;
        double mz = 0;
        FASTag::Hyp::HeaderCheckResult r;
      };
      std::vector<HdrRow> hdr_rows;
    };
    std::vector<PerThread> per_thread(static_cast<size_t>(std::max(1, omp_get_max_threads())));
    for (PerThread& q : per_thread)
    {
      q.digest = FASTag::Digest::TerminusCounter(digest_settings.window);
      if (digest_on && digest_settings.flank2) q.digest.enableFlank2();  // 1.12 D #3d
    }
    // 1.12 D #3g: -alkylation_out's Cys forms and settings; placements are
    // read for every tag only when another reader needs them all.
    const bool place_every = recon_on || handoff_on || delta_on;
    std::vector<FASTag::Alkylation::Form> alk_forms;
    FASTag::Alkylation::Settings alk_settings;
    if (alkylation_on)
    {
      try { alk_forms = FASTag::Alkylation::forms(); }
      catch (const std::exception& e)
      {
        OPENMS_LOG_ERROR << "-alkylation_out: " << e.what() << "." << std::endl;
        return INTERNAL_ERROR;
      }
      const double w = getDoubleOption_("alkylation_window");
      alk_settings.window = w > 0.0 ? w : (p.tol_ppm ? 0.02 : 0.5);
      alk_settings.min_spectra = static_cast<std::uint64_t>(getIntOption_("alkylation_min_spectra"));
      alk_settings.min_share = getDoubleOption_("alkylation_min_share");
      for (const auto& [res, delta] : fixed_deltas)
        if (res == 'C') alk_settings.fixed_c += delta;
      // A fixed N-/C-terminal label (TMT, iTRAQ) is in the spectrum flank,
      // not the database prefix, as the reconciler is told (setFixedTermMods).
      alk_settings.fixed_term_n = fixed_term_n;
      alk_settings.fixed_term_c = fixed_term_c;
      alk_settings.met_oxidation = ModificationsDB::getInstance()->getModification("Oxidation (M)")->getDiffMonoMass();
      alk_settings.residue_mass = FASTag::Alkylation::residueMasses(fixed_deltas);
    }

    // The per-spectrum work, shared by every input path.
    //
    // Takes its thread id rather than calling omp_get_thread_num() internally,
    // and returns its rows rather than writing them: the caller owns where a
    // result lands. Returns the tag rows and (when -recon_out) the
    // reconciliation rows for one spectrum -- one result type, so the two
    // files can never desynchronize their ordering.
    struct SpecResult
    {
      std::string buf, rbuf;
      /// Per reported row, in row order: (evalue, is_entrapment) -- the
      /// material the q_db post-pass consumes without ever reparsing a
      /// serialized %g evalue back off the TSV.
      std::vector<std::pair<double, bool>> meta;
      bool any_target = false;  ///< at least one non-entrapment reported tag
      /// Per written tag row: may it be species evidence (Block::row_species).
      std::vector<char> row_species;
      /// -recon_id_out: the spectrum's identification, when it placed anything.
      std::vector<PeptideIdentification> ids;
      /// -census: the spectrum's census row (an MS2 spectrum read, census_on only).
      bool census = false;
      FASTag::Census::Row census_row;
      /// #15 phase B: the rows were read as c/z-dot ions (Block::row_cz).
      bool cz = false;
    };

    // @p index is the spectrum's position in the input, for a USI that cannot
    // name a scan.
    auto tag_one = [&](const MSSpectrum& spec, size_t tid, size_t index) -> SpecResult
    {
      SpecResult res;
      std::string& buf = res.buf;
      // -census: the facts of every MS2 spectrum read, taken beside the
      // tagging below and never steering it (src/Census.h).
      FASTag::Census::Row& crow = res.census_row;
      FASTag::Census::Facts cfacts;
      if (census_on && spec.getMSLevel() == 2)
      {
        res.census = true;
        crow.index = index;
        crow.rt = spec.getRT();
        cfacts.empty = spec.empty();
        cfacts.has_precursor = crow.has_precursor = !spec.getPrecursors().empty();
        if (crow.has_precursor)
        {
          const Precursor& pc = spec.getPrecursors().front();
          cfacts.precursor_mz = crow.precursor_mz = pc.getMZ();
          crow.charge_given = std::max(0, pc.getCharge());
          crow.charge_used = pc.getCharge() > 0 ? pc.getCharge() : 2;
        }
        const FASTag::Census::Signal sig = FASTag::Census::signal(spec);
        cfacts.n_peaks = crow.n_peaks = sig.n_peaks;
        crow.has_gini = sig.has_gini;
        crow.gini = sig.gini;
      }
      if (spec.getMSLevel() != 2 || spec.empty() || spec.getPrecursors().empty())
      {
        if (res.census)
        {
          crow.status = FASTag::Census::classify(cfacts);
          per_thread[tid].acc.f.census.add(crow);
        }
        return res;
      }
      PerThread& pt = per_thread[tid];
      ++pt.ms2;
      // ---- 1.12 E: per-spectrum counters ----
      const FASTag::IonSeries::Activation act = FASTag::IonSeries::activationClass(spec);
      pt.acc.e.activation.add(act);  // #15 phase A
      // #15 phase B: the series this spectrum is read as (by under by): c/z
      // only in a run that writes the ion_series column, the one rule both
      // decisions share (IonSeries::seriesInRun).
      const bool read_cz = FASTag::IonSeries::seriesInRun(ion_mode, act, ion_column) == FASTag::IonSeries::Series::CZ;
      if (read_cz) ++pt.acc.e.series.ms2_cz;
      else ++pt.acc.e.series.ms2_by;
      res.cz = read_cz;
      if (!read_cz && FASTag::IonSeries::seriesFor(ion_mode, act) == FASTag::IonSeries::Series::CZ)
        ++pt.acc.e.series.auto_by_no_column;
      if (digest_on)
      {
        ++pt.ms2_meta;
        double first = std::numeric_limits<double>::infinity();
        for (const auto& pk : spec)
        {
          first = std::min(first, pk.getMZ());
          // Ion counts (timsTOF) are whole numbers; Orbitrap intensities are not.
          // Zero-intensity peaks (profile data, padding) carry no ion count and
          // would read as whole, so only peaks above 0 count.
          const float in = pk.getIntensity();
          if (!std::isfinite(in) || in <= 0.0f) continue;
          ++pt.peaks;
          if (std::floor(in) == in) ++pt.peaks_whole;
        }
        pt.first_peak.push_back(first);
        const auto& wins = spec.getInstrumentSettings().getScanWindows();
        if (!wins.empty())
        {
          double b = std::numeric_limits<double>::infinity();
          for (const auto& w : wins) b = std::min(b, w.begin);
          pt.scan_low.push_back(b);
        }
        // 1.12 D #3c: fragmentation and MS2 analyzer, for the detection class.
        {
          using AM = Precursor::ActivationMethod;
          const auto& am = spec.getPrecursors().front().getActivationMethods();
          FASTag::Digest::Fragmentation fr = FASTag::Digest::Fragmentation::Unknown;
          if (am.count(AM::HCD) || am.count(AM::HCID)) fr = FASTag::Digest::Fragmentation::Beam;
          else if (am.count(AM::CID) || am.count(AM::TRAP) || am.count(AM::PQD) || am.count(AM::LCID))
            fr = FASTag::Digest::Fragmentation::Resonance;
          const std::string filter =
              spec.metaValueExists("filter string") ? std::string(spec.getMetaValue("filter string").toString()) : std::string();
          FASTag::Digest::addFragmentation(pt.frag, fr, filter);
        }
        bool has_im = false;
        DriftTimeUnit unit = DriftTimeUnit::NONE;
        if (spec.containsIMData()) { has_im = true; unit = spec.getIMData().second; }
        else if (spec.getDriftTime() != IMTypes::DRIFTTIME_NOT_SET) { has_im = true; unit = spec.getDriftTimeUnit(); }
        if (has_im)
        {
          if (unit == DriftTimeUnit::VSSC) ++pt.im_vssc;
          else if (unit == DriftTimeUnit::MILLISECOND) ++pt.im_drift;
          else if (unit == DriftTimeUnit::FAIMS_COMPENSATION_VOLTAGE) ++pt.im_faims;
          else ++pt.im_other;
        }
      }

      const auto& prec = spec.getPrecursors().front();
      if (prec.getCharge() <= 0)
      {
        ++pt.no_charge;
        if (!prec.getPossibleChargeStates().empty()) ++pt.multi_charge;
      }
      // 1.12 #6: the precursor hypotheses (src/PrecursorHypotheses.h). At the
      // defaults there is one, the 1.11 one (the header charge, <= 0 tagged
      // as 2+, the given m/z, multiplicity 1), and the loop below is 1.11's.
      // Otherwise every hypothesis is tagged with its E-values multiplied by
      // H, the rows are merged by E-value and capped, and every consumer that
      // aggregates over spectra reads the selected hypothesis' rows only
      // (PLAN-INTEGRATION 2.3 contract 1): digest/label counts, delta and
      // massgap samples, the shortlist evidence (#5), the census row (#11)
      // and, through a per-row flag (Block::row_species), the species evidence. The
      // TSV, -recon_out and -recon_id_out keep every row at its hypothesis'
      // charge.
      // 1.13 (backlog #14) -check_header_charge: a header charge is put to the
      // infer call; under override a disagreeing one is tagged at the call.
      // Off (the default): nothing here runs.
      FASTag::Hyp::HeaderCheckResult hdr_res;
      const bool hdr_this = hdr_check_on && prec.getCharge() > 0;
      if (hdr_this)
      {
        hdr_res = FASTag::Hyp::checkHeaderCharge(spec, prec, hyp_param, read_cz ? hyp_cs_cz : hyp_cs);
        pt.hdr.add(hdr_res, hyp_param.header_check == FASTag::Hyp::HeaderCheck::Override);
        if (!check_header_out.empty()) pt.hdr_rows.push_back({index, spec.getNativeID(), prec.getMZ(), hdr_res});
      }
      const std::vector<FASTag::Hyp::Hypothesis> hyps = FASTag::Hyp::precursorHypotheses(
          spec, prec, hyp_param, read_cz ? hyp_cs_cz : hyp_cs, nullptr, hdr_this ? &hdr_res : nullptr);
      if (hyp_on) pt.acc.e.hyp.add(hyps);
      FASTag::SpectrumDiag cdiag;
      std::vector<FASTag::Tag> tags;
      std::vector<std::uint8_t> tag_hyp;  // per row: its hypothesis (hyp_on only)
      size_t sel_found = 0;                // rows of the selected hypothesis
      // The one place a hypothesis is tagged: its m/z and charge, the
      // multiplicity H (1 = the 1.11 call), the census diagnostics only for
      // the selected one. #15 phase B: the ion series (read_cz, decided once
      // per spectrum above) picks the tables, for every hypothesis alike.
      const auto tag_at = [&](const FASTag::Hyp::Hypothesis& hy, double H, FASTag::SpectrumDiag* diag) {
        return tag_all(spec, hy.mz, hy.charge, read_cz ? tables_cz : tables, diag, H, read_cz);
      };
      if (hyps.size() == 1)
      {
        tags = tag_at(hyps[0], 1.0, res.census ? &cdiag : nullptr);
        sel_found = tags.size();
      }
      else
      {
        const double H = static_cast<double>(hyps.size());
        std::vector<std::vector<FASTag::Tag>> per(hyps.size());
        for (size_t h = 0; h < hyps.size(); ++h)
        {
          per[h] = tag_at(hyps[h], H, res.census && hyps[h].selected ? &cdiag : nullptr);
          if (hyps[h].selected) sel_found = per[h].size();
        }
        // The cap over all hypotheses: -max_tags per seed length, as one
        // hypothesis reports at most.
        const size_t cap = p.max_tag_count > 0 ? static_cast<size_t>(p.max_tag_count) * lengths.size() : 0;
        auto merged = FASTag::Hyp::mergeHypotheses(std::move(per), cap);
        tags.reserve(merged.size());
        tag_hyp.reserve(merged.size());
        for (auto& m : merged)
        {
          tags.push_back(std::move(m.first));
          tag_hyp.push_back(m.second);
        }
      }
      const auto hyp_of = [&](size_t i) -> const FASTag::Hyp::Hypothesis& {
        return hyps[tag_hyp.empty() ? 0 : tag_hyp[i]];
      };
      pt.tags += tags.size();
      // -census: the reported rows (scratch reused per thread) and placements.
      static thread_local std::vector<FASTag::Census::TagView> ctags;
      ctags.clear();
      size_t cplaced = 0;

      // Reserve once so the per-field appends below do not repeatedly realloc.
      // ~80 bytes/row covers the fixed columns and a typical native ID; the
      // append path just grows past it for the rare long one.
      buf.reserve(tags.size() * 80);
      // One -delta_out sample per spectrum: the placed tag with the lowest
      // E-value. Each length's tags arrive sorted best first, so with one
      // length this is simply the first placed tag.
      bool delta_have = false, delta_clamped = false;
      double delta_e = 0.0;
      DeltaSample delta_sample;
      FASTag::Alkylation::Vote alk_vote;  // 1.12 D #3g
      const std::string usi = usi_prefix.empty() || tags.empty()
          ? std::string()
          : usi_prefix + (mgf_in ? FASTag::usiIndexMgf(spec.metaValueExists("Scan_ID")
                                                         ? StringUtils::toStr(spec.getMetaValue("Scan_ID"))
                                                         : std::string(),
                                                     spec.getNativeID(), index)
                                 : FASTag::usiIndex(spec.getNativeID(), index));
      std::vector<PeptideHit> id_hits;  // -recon_id_out

      // -recon_localize matches against the spectrum's own peaks: every
      // positive one, m/z sorted (the tagger's peak selection is its own).
      MSSpectrum loc_peaks;
      if (recon_loc && !tags.empty())
      {
        for (const auto& pk : spec)
          if (pk.getIntensity() > 0 && std::isfinite(pk.getMZ())) loc_peaks.push_back(pk);
        loc_peaks.sortByPosition();
      }

      for (size_t ti = 0; ti < tags.size(); ++ti)
      {
        const FASTag::Tag& t = tags[ti];
        const FASTag::Hyp::Hypothesis& hy = hyp_of(ti);
        const bool sel = hy.selected;  // always true at the defaults
        const char* hit = "-";
        bool row_entrap = false;
        if (filtering)
        {
          ++pt.len[static_cast<int>(t.n_res)].first;
          const auto h = filt.match(FASTag::baseSequence(t.seq));
          if (h == FASTag::FastaFilter::Hit::None)
          {
            // Target-first attribution: only a tag the TARGET rejects may
            // count as entrapment evidence (a tag hitting both is a target
            // match -- exclusive attribution matches the exclusive key space
            // the r_len correction is computed over).
            if (!entrap_on) continue;
            const auto he = entrap.match(FASTag::baseSequence(t.seq));
            if (he == FASTag::FastaFilter::Hit::None) continue;
            row_entrap = true;
            hit = (he == FASTag::FastaFilter::Hit::Forward) ? "efwd" : "erev";
            pt.entrap_e.emplace_back(t.evalue, static_cast<int>(t.n_res));
          }
          else
          {
            ++pt.len[static_cast<int>(t.n_res)].second;
            // A reverse-only match identifies the ion series: the tag was read off
            // the b series, so its flanking masses carry a one-water offset.
            hit = (h == FASTag::FastaFilter::Hit::Forward) ? "fwd" : "rev";
            if (entrap_on) pt.target_e.push_back(t.evalue);
          }
        }
        if (!row_entrap) res.any_target = true;
        if (entrap_on) res.meta.emplace_back(t.evalue, row_entrap);
        ++pt.reported;
        if (res.census && sel)
        {
          FASTag::Census::TagView v;
          v.evalue = t.evalue;
          v.low_mz = t.low_mz;
          v.high_mz = t.high_mz;
          v.n_res = t.n_res;
          v.min_conf = t.min_conf;
          v.mean_conf = t.mean_conf;
          v.peak_tic = t.peak_tic;
          v.cz = t.ion_series == FASTag::IonSeries::Series::CZ;
          ctags.push_back(v);
        }

        appendTagRow(buf, t, spec.getNativeID(), hit, want_proforma, proforma_fixed,
                     p.per_residue_conf, usi, hyp_on ? &hy : nullptr, ion_column);
        if (species_sel_on) res.row_species.push_back(sel ? 1 : 0);
        // The tags the digest and label reports count: every written row that
        // is ungapped with E <= 1 (of the selected hypothesis, #6). A c/z tag
        // (#15 phase B) with its series' reversed-read offset.
        const bool tag_cz = t.ion_series == FASTag::IonSeries::Series::CZ;
        if (count_on && sel && !t.gapped && t.evalue <= 1.0)
        {
          if (tag_cz) pt.digest.add(t.nterm_mass, t.cterm_mass, FASTag::baseSequence(t.seq), cz_pair.reversedOffset());
          else pt.digest.add(t.nterm_mass, t.cterm_mass, FASTag::baseSequence(t.seq));
        }

        // 1.12 D #3g: the tags -alkylation_out reads (as the digest report),
        // of the selected hypothesis only (#6, PLAN-INTEGRATION 2.4). A c/z
        // tag (#15 phase B) is not placed for the call: the Cys form rules
        // are b/y-only, so it is counted in Tally::excludeNonBy() instead
        // (PLAN-INTEGRATION 2.3 contract 2; doc/ALKYLATION-REPORT.md).
        const bool alk_counted = alkylation_on && sel && FASTag::Alkylation::countsTag(t.gapped, t.evalue);
        const bool alk_tag = alk_counted && !tag_cz;
        if (alk_counted && tag_cz) pt.acc.d.alk.excludeNonBy();
        if (place_on && !row_entrap && (place_every || alk_tag))  // known-false rows must not place or bin
        {
          // The tag's own variable mods go on the localization ladder.
          const bool tag_modded = t.seq.find('[') != std::string::npos;
          const std::vector<double> tag_shift =
              tag_modded ? FASTag::variableModShifts(t.seq, p.mods) : std::vector<double>();
          const auto places = recon.reconcile(FASTag::baseSequence(t.seq),
                                              t.nterm_mass, t.cterm_mass,
                                              recon_loc ? &loc_peaks : nullptr,
                                              hy.charge,
                                              tag_modded ? &tag_shift : nullptr,
                                              tag_cz ? &cz_pair : nullptr);
          if (res.census && recon_on && sel) cplaced += places.size();
          // -recon_out rows: one per placement.
          if (recon_on)
          {
            for (const auto& pl : places)
            {
              std::string prot = pl.protein;
              for (char& ch : prot) if (ch == '\t' || ch == '\n' || ch == '\r') ch = ' ';
              appendField(res.rbuf, spec.getNativeID()); res.rbuf += '\t';
              res.rbuf += t.seq;             res.rbuf += '\t';
              res.rbuf += prot;              res.rbuf += '\t';
              res.rbuf += pl.peptide;        res.rbuf += '\t';
              FASTag::appendNum(res.rbuf, pl.pos); res.rbuf += '\t';
              res.rbuf += pl.reversed ? '1' : '0';    res.rbuf += '\t';
              res.rbuf += pl.nterm_match ? '1' : '0'; res.rbuf += '\t';
              res.rbuf += pl.cterm_match ? '1' : '0'; res.rbuf += '\t';
              FASTag::appendNum(res.rbuf, pl.delta_mass, std::chars_format::fixed, 4);
              res.rbuf += '\t';
              if (pl.region_hi >= pl.region_lo)
              {
                FASTag::appendNum(res.rbuf, pl.region_lo); res.rbuf += '-';
                FASTag::appendNum(res.rbuf, pl.region_hi);
              }
              res.rbuf += '\t';
              res.rbuf += pl.delta_interp;
              if (recon_loc)
              {
                res.rbuf += '\t';
                if (pl.loc_pos >= 0)
                {
                  res.rbuf += pl.peptide[static_cast<size_t>(pl.loc_pos)];
                  FASTag::appendNum(res.rbuf, pl.loc_site);
                }
                res.rbuf += '\t';
                if (pl.loc_pos >= 0) FASTag::appendNum(res.rbuf, pl.loc_score);
                res.rbuf += '\t';
                if (pl.loc_pos >= 0) FASTag::appendNum(res.rbuf, pl.loc_ties);
              }
              res.rbuf += '\n';
            }
          }
          if (recon_ids_on) FASTag::addReconHits(id_hits, places, t.seq, t.evalue, hy.charge, id_fixed);
          // ---- 1.12 A: per-tag placement records ----
          if (handoff_on && sel)
          {
            // #5: the spectra the protease check counts (once each), and the
            // qualifying placements of the shortlist.
            FASTag::ClusterAcc::ThreadA& a = pt.acc.a;
            if (!t.gapped && t.evalue <= 1.0 && a.last_counted != index)
            {
              ++a.protease_spectra;
              a.last_counted = index;
            }
            if (shortlist_on && t.evalue <= sl_settings.max_evalue)
              for (const auto& pl : places)
              {
                double flank = 0.0;
                if (!pl.nterm_match) flank = pl.reversed ? t.cterm_mass : t.nterm_mass;
                else if (!pl.cterm_match) flank = pl.reversed ? t.nterm_mass : t.cterm_mass;
                const double tol_da = p.tol_ppm ? flank * p.frag_tol * 1e-6 : p.frag_tol;
                const auto cls = FASTag::Shortlist::classifyPlacement(pl.nterm_match, pl.cterm_match, pl.delta_mass,
                                                                      fixed_term_n, fixed_term_c, tol_da);
                if (cls == FASTag::Shortlist::Placement::Gapped && !sl_settings.gapped) continue;
                FASTag::Shortlist::Evidence ev;
                ev.spectrum = static_cast<std::uint32_t>(index);
                ev.protein = pl.protein_index;
                ev.evalue = static_cast<float>(t.evalue);
                ev.window_start = static_cast<std::uint32_t>(pl.start);
                ev.window_len = static_cast<std::uint16_t>(std::min<std::size_t>(pl.peptide.size(), 65535));
                ev.exact = cls != FASTag::Shortlist::Placement::Gapped;
                a.sl.push_back(ev);
              }
          }
          // ---- 1.12 D: per-tag placement records ----
          if (alk_tag)  // #3g
            FASTag::Alkylation::addTag(pt.acc.d.alk, alk_vote, places, t.evalue, alk_settings, alk_forms);
          // A candidate for the spectrum's -delta_out sample: take this
          // tag's min-|delta| placement.
          if (delta_on && sel && !places.empty() && (!delta_have || t.evalue < delta_e))
          {
            const FASTag::Reconciliation* best = nullptr;
            for (const auto& pl : places)
              if (!best || std::fabs(pl.delta_mass) < std::fabs(best->delta_mass)) best = &pl;
            // The delta lives on the mismatched side; the spectrum flank that
            // fed it is nterm/cterm swapped for reversed placements. A 0.0
            // there is indistinguishable from FASTagger's negative-flank clamp,
            // so the sample is excluded either way and counted.
            double side_flank = 0.0;
            if (!best->nterm_match) side_flank = best->reversed ? t.cterm_mass : t.nterm_mass;
            else if (!best->cterm_match) side_flank = best->reversed ? t.nterm_mass : t.cterm_mass;
            delta_clamped = std::fabs(best->delta_mass) > 1e-6 && side_flank == 0.0;
            delta_sample.delta = best->delta_mass;
            delta_sample.interp = best->delta_interp;
            delta_sample.loc_residue = best->loc_pos >= 0 ? best->peptide[static_cast<size_t>(best->loc_pos)] : '\0';
            delta_sample.loc_score = best->loc_score;
            delta_sample.loc_ties = best->loc_ties;
            delta_sample.region_len = best->region_hi >= best->region_lo ? best->region_hi - best->region_lo + 1 : 0;
            if (shifts_on) delta_sample.has_c = best->peptide.find('C') != std::string::npos;
            delta_e = t.evalue;
            delta_have = true;
          }
        }
      }
      if (delta_have)
      {
        if (delta_clamped) ++pt.delta_clamped;
        else pt.delta.push_back(std::move(delta_sample));
      }
      FASTag::Alkylation::addSpectrum(pt.acc.d.alk, alk_vote);  // 1.12 D #3g
      if (!id_hits.empty())
        res.ids.push_back(FASTag::reconSpectrum(spec.getNativeID(), spec.getRT(), prec.getMZ(),
                                                std::move(id_hits)));
      if (res.census)
      {
        // The selected hypothesis' facts (#6; all rows at the defaults).
        for (const auto& h : hyps)
          if (h.selected) crow.charge_used = h.charge > 0 ? h.charge : 2;
        cfacts.enough_peaks = cdiag.enough_peaks;
        cfacts.n_found = sel_found;
        cfacts.n_reported = ctags.size();
        cfacts.n_placed = cplaced;
        cfacts.count_placements = recon_on;
        crow.status = FASTag::Census::classify(cfacts);
        crow.prepared = cdiag.prepared;
        crow.n_kept = cdiag.n_kept;
        crow.n_edges = cdiag.n_edges;
        crow.n_compl = cdiag.n_compl;
        crow.n_found = sel_found;
        crow.n_reported = ctags.size();
        const size_t best = FASTag::Census::bestTag(ctags);
        if (best != FASTag::Census::kNone)
        {
          crow.has_best = true;
          crow.best = ctags[best];
          crow.tag_cover = FASTag::Census::tagCoverOf(ctags);
        }
        pt.acc.f.census.add(crow);
      }
      return res;
    };

    // Per-row (evalue, is_entrapment) in FILE order, appended block by block
    // in write_block -- the q_db post-pass walks the written TSV and this
    // vector in lockstep. ~17 bytes/row: the cost of a whole-run calibration
    // curve.
    std::vector<std::pair<double, bool>> row_meta;
    // -recon_id_out, in input order: OpenMS's writers take the whole run, so
    // the identifications are held until the end; memory grows with the
    // placements written.
    PeptideIdentificationList recon_ids;

    // Record one spectrum's result at its BLOCK-LOCAL index. The index is the
    // caller's, so output order never depends on scheduling.
    auto record = [&](Block& b, size_t idx, SpecResult&& r, const MSSpectrum& spec)
    {
      // Glyco covers every spectrum the tagger PROCESSED (MS2, non-empty,
      // precursor-bearing) -- BEFORE the empty-buf gate: glyco spectra are
      // exactly the tag-poor ones the gate would drop. The raw peak list is
      // scanned so peak budgets can never eat the oxonium region.
      if (glyco_on && spec.getMSLevel() == 2 && !spec.empty() && !spec.getPrecursors().empty())
      {
        const MSSpectrum* sp = &spec;
        MSSpectrum sorted_copy;
        if (!spec.isSorted())
        {
          sorted_copy = spec;
          sorted_copy.sortByPosition();
          sp = &sorted_copy;
        }
        const auto g = FASTag::scanOxonium(*sp, p.frag_tol, p.tol_ppm, glyco_min_fraction);
        std::string& gr = b.glyco_rows[idx];
        gr.clear();
        appendField(gr, spec.getNativeID());
        gr += '\t';
        FASTag::appendNum(gr, g.n_matched); gr += '\t';
        FASTag::appendNum(gr, g.frac, std::chars_format::fixed, 3); gr += '\t';
        gr += g.glyco ? '1' : '0';           gr += '\t';
        gr += g.ions;
        gr += '\n';
      }
      // -census: every MS2 spectrum read has a row, tagged or not.
      if (r.census)
      {
        std::string& cr = b.acc.f.census_rows[idx];
        cr.clear();
        FASTag::Census::appendRow(cr, r.census_row, spec.getNativeID(), ion_column);
      }
      if (r.buf.empty()) return;  // rbuf is only ever non-empty alongside buf
      b.rows[idx].swap(r.buf);
      if (recon_on) b.recon_rows[idx].swap(r.rbuf);
      if (recon_ids_on) b.recon_id_lists[idx].swap(r.ids);
      if (entrap_on) b.row_meta[idx].swap(r.meta);
      if (species_sel_on) b.row_species[idx].swap(r.row_species);
      b.row_cz[idx] = r.cz ? 1 : 0;
      b.keep[idx] = 1;
      // A spectrum whose only reported tags are entrapment matches is
      // calibration material, not a hit -- keep it out of -out_spectra.
      if (want_out) b.keep_target[idx] = r.any_target ? 1 : 0;
    };

    // Size a block's buffers (capacity is recycled across blocks) and reset
    // its keep flags. Callers must not resize a block while it is being
    // tagged or written.
    auto prep_block = [&](Block& b, size_t base, size_t n_used)
    {
      b.base = base;
      if (b.rows.size() < n_used)
      {
        b.rows.resize(n_used);
        if (recon_on) b.recon_rows.resize(n_used);
        if (recon_ids_on) b.recon_id_lists.resize(n_used);
        if (glyco_on) b.glyco_rows.resize(n_used);
        if (entrap_on) b.row_meta.resize(n_used);
        if (species_sel_on) b.row_species.resize(n_used);
      }
      b.keep.assign(n_used, 0);
      b.row_cz.assign(n_used, 0);
      if (want_out) b.keep_target.assign(n_used, 0);
      b.acc.prepare(n_used);
    };

    // -species consumes (spectrum id, tag) pairs from the REPORTED rows,
    // collected in write_block as each row is written: id + tag is far smaller
    // than the rows, which are recycled per block.
    const bool species_use_gapped = getFlag_("species_use_gapped");
    // Per spectrum: (tag, E-value) of every row that may count, in row order.
    std::map<std::string, std::vector<std::pair<std::string, double>>> by_spec;
    // #15 phase B: -species counts b/y tags only (PLAN-INTEGRATION 2.3,
    // contract 2); the c/z rows it leaves out (writer thread only).
    size_t species_cz_excluded = 0;

    // Write one finished block's rows in index order and recycle the buffers.
    //
    // Runs on the writer thread, one block at a time and in block order (see
    // the loop), so everything it appends to -- the streams, the glyco
    // counters, row_meta, by_spec, kept_idx -- is touched by one thread only
    // and read after the last write is joined.
    //
    // Rows go to the files in chunks of a few MB, not one stream insertion per
    // spectrum. libstdc++'s filebuf hands any insertion of 1 KiB or more to a
    // write(2) of its own, whatever its buffer size, and one spectrum's rows
    // are ~1.7 KB at benchmark settings: one system call per spectrum, enough
    // to make the writer hold the loop back through the block ring at high
    // thread counts. 4 MB, emptied at the end of every block; larger only
    // holds more memory.
    constexpr size_t kWriteChunk = size_t(4) << 20;
    std::string tsv_pending, rtsv_pending, ctsv_pending;
    auto drain = [](std::ofstream& os, std::string& pending)
    {
      if (pending.empty()) return;
      os.write(pending.data(), static_cast<std::streamsize>(pending.size()));
      pending.clear();
    };
    auto put_rows = [&](std::ofstream& os, std::string& pending, const std::string& text)
    {
      pending += text;
      if (pending.size() >= kWriteChunk) drain(os, pending);
    };
    auto write_block = [&](Block& b, size_t n_used)
    {
      for (size_t i = 0; i < n_used; ++i)
      {
        if (glyco_on && !b.glyco_rows[i].empty())
        {
          gtsv << b.glyco_rows[i];
          // 4th field is the 0/1 flag; count flagged spectra for the summary.
          size_t tp = b.glyco_rows[i].find('\t');
          for (int f = 0; f < 2 && tp != std::string::npos; ++f)
            tp = b.glyco_rows[i].find('\t', tp + 1);
          if (tp != std::string::npos && b.glyco_rows[i].compare(tp + 1, 1, "1") == 0) ++n_glyco;
          ++n_glyco_scanned;
          b.glyco_rows[i].clear();
        }
        if (census_on && !b.acc.f.census_rows[i].empty())
        {
          put_rows(ctsv, ctsv_pending, b.acc.f.census_rows[i]);
          b.acc.f.census_rows[i].clear();
        }
        if (!b.keep[i]) continue;
        put_rows(tsv, tsv_pending, b.rows[i]);
        if (recon_on && !b.recon_rows[i].empty()) { put_rows(rtsv, rtsv_pending, b.recon_rows[i]); b.recon_rows[i].clear(); }
        if (recon_ids_on)
        {
          for (PeptideIdentification& id : b.recon_id_lists[i]) recon_ids.push_back(std::move(id));
          b.recon_id_lists[i].clear();
        }
        if (entrap_on)
        {
          row_meta.insert(row_meta.end(), b.row_meta[i].begin(), b.row_meta[i].end());
          b.row_meta[i].clear();
        }
        if (want_species)
        {
          const std::string& r = b.rows[i];
          size_t start = 0, row = 0;
          std::string id, tag;
          bool gapped = false;
          double evalue = 0;
          while (start < r.size())
          {
            size_t nl = r.find('\n', start);
            if (nl == std::string::npos) nl = r.size();
            // #6: a row of a losing precursor hypothesis is no species
            // evidence (the per-row flag from tag_one, not a TSV column).
            if (species_sel_on && !b.row_species[i][row++]) { start = nl + 1; continue; }
            // #15 phase B: a c/z row (Block::row_cz, one flag per spectrum,
            // every row of it alike) is left out and counted.
            if (b.row_cz[i]) ++species_cz_excluded;
            else if (readSpeciesFields(r, start, nl, id, tag, gapped, evalue))
            {
              // Skip GAPPED tags unless asked for. A gap spells two residues
              // from one summed mass -- an inference, not a read -- and an
              // exact k-mer lookup cannot tell the difference, so a gapped tag
              // matches taxa it never evidenced. Measured on PXD000001: with
              // gapped tags admitted, the true genus falls from rank 1 to rank
              // 20 and cereal genomes take the top of the table.
              if (species_use_gapped) gapped = false;
              if (!gapped) by_spec[std::move(id)].emplace_back(std::move(tag), evalue);
            }
            start = nl + 1;
          }
        }
        b.rows[i].clear();
        if (want_out && b.keep_target[i]) kept_idx.push_back(static_cast<Size>(b.base + i));
      }
      drain(tsv, tsv_pending);
      if (recon_on) drain(rtsv, rtsv_pending);
      if (census_on) drain(ctsv, ctsv_pending);
    };

    // Progress reporting (opt-in via -progress), shared across both input paths.
    // One atomic counter; the single thread that observes each step boundary
    // emits one line under a critical section, so lines never interleave.
    const bool emit_progress = getFlag_("progress");
    std::atomic<long long> progress_done{0};
    const long long progress_total = static_cast<long long>(n_spec);
    std::atomic<int> progress_pct{-1};
    std::atomic<long long> progress_ms{0};
    const auto progress_t0 = std::chrono::steady_clock::now();
    auto elapsed_ms = [&progress_t0]() {
      return static_cast<long long>(std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::steady_clock::now() - progress_t0).count());
    };

    // At most ONE line per whole percent, and at least one every 5 s.
    //
    // "At most one per percent", not "one for every percent": the emitting
    // thread reports the counter's CURRENT value, which other threads have
    // advanced past, so a busy run legitimately jumps 5% -> 8%. That is right
    // for a progress bar and wrong to describe as per-percent.
    //
    // Percent alone goes quiet for minutes on a slow file, which reads as a
    // hung GUI; a pure time interval spams a fast run. Together the line rate
    // is bounded by ~101 + elapsed/5s regardless of file size or speed.
    auto tick = [&]()
    {
      if (!emit_progress) return;
      const long long d = ++progress_done;
      const int pct = progress_total > 0 ? static_cast<int>((d * 100) / progress_total) : -1;
      // 100% is NOT emitted here. The loop finishing is not the tool finishing --
      // species classification and -out_spectra still run -- so the completion
      // line is reserved for the end of main_(). Without this the last percent
      // and the completion line print the same text twice.
      bool want = (d == 1) || (pct < 100 && pct > progress_pct.load(std::memory_order_relaxed));
      // The clock is read on EVERY tick: sampling it would break the 5 s
      // guarantee exactly on slow spectra, and steady_clock::now() is tens of
      // nanoseconds against microseconds-to-seconds of tagging per spectrum.
      if (!want && elapsed_ms() - progress_ms.load(std::memory_order_relaxed) >= 5000)
      {
        want = true;
      }
      if (!want) return;
#pragma omp critical(fastag_progress)
      {
        // Re-check under the lock: several threads can decide to emit at once,
        // and without this they each print a line for the same percent.
        const long long dd = progress_done.load();
        const long long tt = progress_total;
        const int pp = tt > 0 ? static_cast<int>((dd * 100) / tt) : -1;
        const long long now = elapsed_ms();
        if (dd == 1 || (pp < 100 && pp > progress_pct.load())
            || (pp < 100 && now - progress_ms.load() >= 5000))
        {
          progress_pct.store(pp);
          progress_ms.store(now);
          std::cerr << "FASTAG_PROGRESS done=" << dd << " total=" << tt << std::endl;
        }
      }
    };

    // FASTAG_TIMING=1 breaks the run into phases on stderr. Diagnostic only:
    // wall time that no phase claims is the thing worth chasing.
    const bool timing = std::getenv("FASTAG_TIMING") != nullptr;
    using Clock = std::chrono::steady_clock;
    const auto t_loop_start = Clock::now();
    double t_readers = 0, t_prep = 0, t_parallel = 0, t_write = 0, t_write_busy = 0;
    auto secs = [](Clock::time_point a, Clock::time_point b)
    { return std::chrono::duration<double>(b - a).count(); };

    // One reader per thread, built before the loop; for mzPeak, and for mzML
    // under -pick_profile auto, a picker per thread (profile MS2 is
    // centroided on the reading thread).
    std::vector<std::unique_ptr<OnDiscMSExperiment>> readers(read_threads);
    std::vector<std::unique_ptr<FASTag::IndexedMzMLReader>> freaders(read_threads);
    std::vector<std::unique_ptr<FASTag::MgfReader>> mreaders(read_threads);
    std::vector<std::unique_ptr<PeakPickerHiRes>> pickers(read_threads);
    const auto t_readers_a = Clock::now();
    for (int t = 0; t < read_threads; ++t)
    {
      // Copy-constructed, not assigned: OnDiscMSExperiment's operator= is
      // private. Each copy keeps its own open streams and is used by one
      // thread only, which is what both readers document as required.
      if (streaming) readers[t] = std::make_unique<OnDiscMSExperiment>(*ondisc);
      if (fastmz) freaders[t] = std::make_unique<FASTag::IndexedMzMLReader>(*fastmz);
      if (mgf) mreaders[t] = std::make_unique<FASTag::MgfReader>(*mgf);
      if (mzs || pick_in_loop) pickers[t] = std::make_unique<PeakPickerHiRes>();
    }
    t_readers = secs(t_readers_a, Clock::now());

    // ONE parallel region over the whole run. Blocks only bound the memory the
    // results take; a writer thread empties them in input order. A region per
    // block would put a barrier at every block end; with one region the
    // stragglers of one block overlap the start of the next instead.
    //
    // A ring of kRing buffers. Chunks are handed out in index order
    // (monotonic), so a thread reaching block k knows every earlier chunk is
    // taken; it waits only while block k's buffer still holds block k - kRing,
    // which the writer is then writing. That cannot deadlock: the oldest block
    // that is still open is held only by threads that are not waiting. Three
    // buffers: one being written, one being finished by the stragglers, one
    // taking the frontier.
    //
    // The writer is a plain thread, not a team member, and both sides wait on
    // a condition variable: nobody spins while a block is written (spinning
    // team members steal enough bandwidth from the writer to cost more than
    // the single region saves).
    const size_t n_blocks = static_cast<size_t>((n_spec + static_cast<SignedSize>(BLOCK) - 1)
                                                / static_cast<SignedSize>(BLOCK));
    auto block_size = [&](size_t k)
    { return static_cast<size_t>(std::min<SignedSize>(n_spec - static_cast<SignedSize>(k * BLOCK),
                                                      static_cast<SignedSize>(BLOCK))); };
    // Spectra of each block not yet recorded; the writer takes a block at 0.
    std::unique_ptr<std::atomic<size_t>[]> pending(new std::atomic<size_t>[std::max<size_t>(n_blocks, 1)]);
    for (size_t k = 0; k < n_blocks; ++k) pending[k].store(block_size(k), std::memory_order_relaxed);
    std::mutex ring_mutex;
    std::condition_variable ring_cv;
    size_t open_upto = std::min(kRing, n_blocks);  ///< blocks below have a prepared buffer (ring_mutex)
    std::atomic<size_t> open_hint{open_upto};      ///< its lock-free copy, for the common case
    bool write_abort = false;                      ///< the writer failed (ring_mutex)
    std::atomic<bool> abort_hint{false};
    std::exception_ptr write_failed;
    std::exception_ptr work_failed;                ///< first reader/tagger failure (ring_mutex)

    const auto t_prep_a = Clock::now();
    for (size_t k = 0; k < open_upto; ++k) prep_block(blocks[k % kRing], k * BLOCK, block_size(k));
    t_prep = secs(t_prep_a, Clock::now());

    std::thread writer([&]
    {
      try
      {
        for (size_t k = 0; k < n_blocks; ++k)
        {
          {
            std::unique_lock<std::mutex> lock(ring_mutex);
            ring_cv.wait(lock, [&] { return pending[k].load(std::memory_order_acquire) == 0; });
          }
          const auto a = Clock::now();
          Block& b = blocks[k % kRing];
          write_block(b, block_size(k));
          if (k + kRing < n_blocks) prep_block(b, (k + kRing) * BLOCK, block_size(k + kRing));
          t_write_busy += secs(a, Clock::now());
          {
            std::lock_guard<std::mutex> guard(ring_mutex);
            open_upto = std::min(n_blocks, k + kRing + 1);
            open_hint.store(open_upto, std::memory_order_release);
          }
          ring_cv.notify_all();
        }
      }
      catch (...)
      {
        write_failed = std::current_exception();
        {
          std::lock_guard<std::mutex> guard(ring_mutex);
          write_abort = true;
          abort_hint.store(true);
        }
        ring_cv.notify_all();
        if (mzs) mzs->abort();
      }
    });

    // FASTAG_TIMING: each thread's exit from its last chunk.
    std::vector<Clock::time_point> t_done(static_cast<size_t>(read_threads));
    const auto t_par_a = Clock::now();
#pragma omp parallel num_threads(read_threads)
    {
      const size_t tid = static_cast<size_t>(omp_get_thread_num());
      OnDiscMSExperiment* reader = readers[tid].get();
      FASTag::IndexedMzMLReader* freader = freaders[tid].get();
      FASTag::MgfReader* mreader = mreaders[tid].get();
      PeakPickerHiRes* picker = pickers[tid].get();
      auto work = [&](SignedSize i, Block& blk, size_t idx)
      {
        if (!sample_mask.empty() && !sample_mask[static_cast<size_t>(i)]) { tick(); return; }
        const Clock::time_point ta = timing ? Clock::now() : Clock::time_point();
        MSSpectrum loaded;
        bool loaded_here = false;
        if (mzs) { loaded = mzs->take(static_cast<size_t>(i), *picker); loaded_here = true; }
        if (!loaded_here && mreader) { loaded = mreader->getSpectrum(static_cast<Size>(i)); loaded_here = true; }
        if (!loaded_here && freader) { loaded = freader->getSpectrum(static_cast<Size>(i)); loaded_here = true; }
        if (!loaded_here && reader) { loaded = reader->getSpectrum(static_cast<Size>(i)); loaded_here = true; }
        if (pick_in_loop)
        {
          // #9: mzML profile MS2, centroided before tagging.
          if (!loaded_here) { loaded = exp[static_cast<Size>(i)]; loaded_here = true; }
          per_thread[tid].acc.e.pick.add(FC::apply(loaded, *picker, pick_mzml));
        }
        const MSSpectrum& spec = loaded_here ? loaded : exp[static_cast<Size>(i)];
        if (mzpeak_out && spec.getMSLevel() == 2 && spec.containsIMData()) throw IonMobilityRefused{};
        const Clock::time_point tb = timing ? Clock::now() : ta;
        record(blk, idx, tag_one(spec, tid, static_cast<size_t>(i)), spec);
        tick();
        if (timing)
        {
          PerThread& q = per_thread[tid];
          const double r = secs(ta, tb);
          q.s_read += r;
          q.s_tag += secs(tb, Clock::now());
          if (r > 1e-3) { ++q.n_slow; q.s_slow += r; }
        }
      };
      // Dynamic chunks, one schedule for both formats.
      //
      // A static split is the wrong shape: it hands every thread the same
      // COUNT of spectra, which cost different amounts, so the fast threads
      // sit in the join barrier. Dynamic chunks let a thread that finishes
      // early take more.
      //
      // MONOTONIC, which the ring above depends on, and so not guided: guided
      // over the whole run would hand its first, largest chunks out across
      // every block at once. 256 was best or tied at every thread count in a
      // sweep of 64/128/256/512.
      //
      // Except for the last threads x 256 spectra, which go out 16 at a
      // time: the job guided's shrinking chunks did. Where spectra are heavy
      // (timsTOF, ~3 ms each) one last chunk of 256 is a tail of its own. The
      // second loop keeps the hand-out monotonic: a thread only reaches it
      // once every chunk of the first has been handed out.
      const SignedSize tail_from =
          std::max<SignedSize>(0, n_spec - static_cast<SignedSize>(read_threads) * kChunk);
      auto one = [&](SignedSize i)
      {
        const size_t k = static_cast<size_t>(i) / BLOCK;
        if (k >= open_hint.load(std::memory_order_acquire))
        {
          const Clock::time_point tw = timing ? Clock::now() : Clock::time_point();
          std::unique_lock<std::mutex> lock(ring_mutex);
          ring_cv.wait(lock, [&] { return k < open_upto || write_abort; });
          if (timing) per_thread[tid].s_ring += secs(tw, Clock::now());
        }
        if (!abort_hint.load(std::memory_order_relaxed))
        {
          // An exception must not leave the parallel region: that is
          // std::terminate, an abort instead of an error message. Keep the
          // first, let every thread skip the rest, rethrow after the join.
          try
          {
            work(i, blocks[k % kRing], static_cast<size_t>(i) - k * BLOCK);
          }
          catch (...)
          {
            {
              std::lock_guard<std::mutex> guard(ring_mutex);
              if (!work_failed) work_failed = std::current_exception();
              abort_hint.store(true);
            }
            // A thread waiting for a spectrum the reader will not reach.
            if (mzs) mzs->abort();
          }
        }
        if (pending[k].fetch_sub(1, std::memory_order_acq_rel) == 1)
        {
          std::lock_guard<std::mutex> guard(ring_mutex);
          ring_cv.notify_all();
        }
      };
#pragma omp for schedule(FASTAG_MONOTONIC dynamic, kChunk) nowait
      for (SignedSize i = 0; i < tail_from; ++i) one(i);
#pragma omp for schedule(FASTAG_MONOTONIC dynamic, kTailChunk) nowait
      for (SignedSize i = tail_from; i < n_spec; ++i) one(i);
      if (timing) t_done[tid] = Clock::now();
    }
    const auto t_write_a = Clock::now();
    t_parallel = secs(t_par_a, t_write_a);
    if (timing)
      for (int t = 0; t < read_threads; ++t)
        per_thread[static_cast<size_t>(t)].s_idle += secs(t_done[static_cast<size_t>(t)], t_write_a);
    // write= is only what the loop waits for; write_busy= is the writer's own.
    writer.join();
    t_write = secs(t_write_a, Clock::now());
    // The writer's failure is the cause when both are set: it aborts the
    // mzPeak stream, and a worker blocked in take() then fails with
    // "mzPeak read stopped", which would otherwise be reported instead.
    // Partial reports are no result, whatever stopped the loop: remove the
    // ones opened before it (the others are written after it). An MGF block's
    // content is only parsed here, so a bad block outside the tolerance probe
    // fails after these files exist, and the rows before it look complete.
    // Only regular files: -out may name a device such as /dev/null.
    const auto drop_partial = [&]
    {
      const auto drop = [](std::ofstream& os, const std::string& path)
      {
        os.close();
        std::error_code ec;
        if (std::filesystem::is_regular_file(path, ec)) std::filesystem::remove(path, ec);
      };
      drop(tsv, out);
      if (recon_on) drop(rtsv, recon_out);
      if (glyco_on) drop(gtsv, glyco_out);
      if (census_on)
      {
        ctsv.close();
        census_part.discard();
      }
    };
    if (work_failed)
    {
      drop_partial();
      try
      {
        std::rethrow_exception(work_failed);
      }
      catch (const IonMobilityRefused&)
      {
        return refuse_im();
      }
      catch (...)
      {
        if (write_failed) std::rethrow_exception(write_failed);
        throw;
      }
    }
    if (write_failed)
    {
      drop_partial();
      std::rethrow_exception(write_failed);
    }
    if (mgf)
    {
      // Counted by the workers' copies, which parse every tagged block once
      // (the serial reads of the probe and -out_spectra are not counted).
      size_t no_pepmass = 0, sanitised = 0, scans_sanitised = 0, rt_not_finite = 0, no_charge_key = 0;
      for (const auto& r : mreaders)
      {
        if (!r) continue;
        no_pepmass += r->counts().no_pepmass;
        sanitised += r->counts().titles_sanitised;
        scans_sanitised += r->counts().scans_sanitised;
        rt_not_finite += r->counts().rt_not_finite;
        no_charge_key += r->counts().no_charge_key;
      }
      if (no_pepmass > 0)
        OPENMS_LOG_WARN << no_pepmass << " MGF blocks have no usable PEPMASS (missing, zero or not "
                           "finite); they count as MS2 and yield no tags." << std::endl;
      if (sanitised > 0)
        OPENMS_LOG_WARN << sanitised << " MGF TITLEs carry control bytes or invalid UTF-8, replaced "
                           "by '?'." << std::endl;
      if (scans_sanitised > 0)
        OPENMS_LOG_WARN << scans_sanitised << " MGF SCANS values carry control bytes or invalid "
                           "UTF-8, replaced by '?'." << std::endl;
      if (rt_not_finite > 0)
        OPENMS_LOG_WARN << rt_not_finite << " MGF blocks have an RTINSECONDS that is not finite "
                           "(nan or inf); their retention time is left unset." << std::endl;
      // Only when it matters: OpenMS's own MGF writer puts CHARGE= in the
      // header of files whose every block has its own.
      if (mgf->headerCharge() && no_charge_key > 0)
        OPENMS_LOG_WARN << "'" << in << "' has a file-level CHARGE= before its first block. It is "
                           "not applied (as in OpenMS): " << no_charge_key << " block(s) without "
                           "their own CHARGE were tagged as 2+." << std::endl;
    }
    if (mzs)
    {
      // The reader's own error, if any (a short or corrupt archive), and then
      // the tolerance probe over the copies it kept.
      try
      {
        mzs->finish();
      }
      catch (...)
      {
        drop_partial();
        throw;
      }
      tolerance_probe([&](Size i) { return mzs->copy(i); });
    }
    if (timing)
    {
      const double total = secs(t_loop_start, Clock::now());
      std::cerr << "FASTAG_TIMING open=" << g_t_open << " probe=" << g_t_probe
                << " tables=" << g_t_tables
                << " pre_loop=" << secs(g_t_program, t_loop_start)
                << " readers=" << t_readers << " prep=" << t_prep
                << " parallel=" << t_parallel << " write=" << t_write
                << " write_busy=" << t_write_busy
                << " loop_total=" << total
                << " unaccounted_in_loop="
                << (total - t_readers - t_prep - t_parallel - t_write)
                << " since_program_start=" << secs(g_t_program, Clock::now());
      std::cerr << std::endl;
      double s_read = 0, s_slow = 0, s_tag = 0, s_ring = 0, s_idle = 0;
      size_t n_slow = 0;
      for (const PerThread& q : per_thread)
      { s_read += q.s_read; s_slow += q.s_slow; s_tag += q.s_tag; s_ring += q.s_ring; s_idle += q.s_idle; n_slow += q.n_slow; }
      // Where the team's thread-seconds went: the split that locates this
      // loop's scaling limits (read waits, barriers, lock convoys) when the
      // phase timings cannot.
      std::cerr << "FASTAG_THREADS threads=" << read_threads << " read=" << s_read
                << " slow_reads=" << n_slow << " slow_read=" << s_slow << " tag=" << s_tag
                << " ring_wait=" << s_ring << " idle=" << s_idle;
      std::cerr << std::endl;
    }
    // Once, at the end. Profile MS2 is a property of the archive the user
    // cannot see and would otherwise only notice as an unexplained tag count.
    const auto log_picked = [](const char* reader, size_t picked, size_t failed)
    {
      OPENMS_LOG_INFO << reader << ": centroided " << picked << " profile spectra on read"
                      << (failed > 0 ? " (" + std::to_string(failed) + " kept as profile: picking yielded nothing)"
                                     : std::string())
                      << std::endl;
    };
    if (mzs && mzs->picked() > 0) log_picked("mzPeak", mzs->picked(), mzs->pickFailed());

    size_t n_no_charge = 0, n_multi_charge = 0;
    FASTag::ClusterAcc::ClusterThread run_acc;  // the per-cluster accumulators, summed in thread order
    FASTag::Hyp::HeaderCheckCounts hdr_counts;  // 1.13 -check_header_charge
    for (const PerThread& pt : per_thread)
    {
      run_acc.merge(pt.acc);
      hdr_counts.merge(pt.hdr);
      n_no_charge += pt.no_charge;
      n_multi_charge += pt.multi_charge;
      n_ms2 += pt.ms2;
      n_tags += pt.tags;
      n_reported += pt.reported;
      for (const auto& kv : pt.len)
      {
        by_len[kv.first].first += kv.second.first;
        by_len[kv.first].second += kv.second.second;
      }
    }
    // ---- 1.12 E: run-level facts from the loop ----
    {
      // #9: picking counts (RunMeta Versioned rows; the INFO line for mzML).
      // -pick_profile auto on mzML is said whenever anything was profile, so
      // a run whose picking yielded nothing does not look centroided.
      const FASTag::Centroid::Counts& c = run_acc.e.pick;
      if (pick_in_loop && (c.picked > 0 || c.failed > 0)) log_picked("mzML", c.picked, c.failed);
      run_meta.pick_profile = getStringOption_("pick_profile");
      run_meta.pick_picked = c.picked + (mzs ? mzs->picked() : 0);
      run_meta.pick_failed = c.failed + (mzs ? mzs->pickFailed() : 0);
      // #15 phase A: activation counts (RunMeta Versioned rows only).
      using FASTag::IonSeries::Activation;
      const auto& act = run_acc.e.activation;
      run_meta.activation_collisional = act.of(Activation::Collisional);
      run_meta.activation_electron = act.of(Activation::Electron);
      run_meta.activation_hybrid = act.of(Activation::Hybrid);
      run_meta.activation_unknown = act.of(Activation::Unknown);
      // #6: where the selected hypotheses' charges came from (RunMeta
      // Versioned rows; zero at the defaults, where no hypothesis step runs).
      using FASTag::Hyp::ChargeSource;
      const FASTag::Hyp::SourceCounts& hc = run_acc.e.hyp;
      const auto sel_of = [&](ChargeSource s) { return hc.selected[static_cast<size_t>(s)]; };
      run_meta.unknown_charge = getStringOption_("unknown_charge");
      run_meta.isotope_error.clear();
      for (const int k : hyp_param.isotope_errors)
        run_meta.isotope_error += (run_meta.isotope_error.empty() ? "" : ",") + std::to_string(k);
      run_meta.charge_header = sel_of(ChargeSource::Header);
      run_meta.charge_possible = sel_of(ChargeSource::Possible);
      run_meta.charge_inferred = sel_of(ChargeSource::Inferred);
      run_meta.charge_ambiguous = sel_of(ChargeSource::Ambiguous);
      run_meta.charge_assumed = sel_of(ChargeSource::Assumed);
      run_meta.charge_enumerated = sel_of(ChargeSource::Enumerated);
      run_meta.charge_overridden = sel_of(ChargeSource::Overridden);
      // 1.13 -check_header_charge (rows only when it is on).
      run_meta.check_header_charge = getStringOption_("check_header_charge");
      run_meta.header_checked = hdr_counts.checked;
      run_meta.header_agree = hdr_counts.verdict[static_cast<size_t>(FASTag::Hyp::HeaderVerdict::Agree)];
      run_meta.header_disagree = hdr_counts.verdict[static_cast<size_t>(FASTag::Hyp::HeaderVerdict::Disagree)];
      run_meta.header_ambiguous = hdr_counts.verdict[static_cast<size_t>(FASTag::Hyp::HeaderVerdict::Ambiguous)];
      run_meta.header_nocall = hdr_counts.verdict[static_cast<size_t>(FASTag::Hyp::HeaderVerdict::NoCall)];
      run_meta.header_overridden = hdr_counts.overridden;
      run_meta.iso_shifted = hc.iso_shifted;
      run_meta.multi_hypothesis = hc.multi;
      // #15 phase B: the series per tagged MS2.
      run_meta.ion_series = FASTag::IonSeries::modeName(ion_mode);
      run_meta.ion_series_ms2_by = run_acc.e.series.ms2_by;
      run_meta.ion_series_ms2_cz = run_acc.e.series.ms2_cz;
    }
    // ---- 1.12 D: the alkylation call (#3g), once, right after the merge ----
    // Before the hand-off exports, so a reader of the call there (the A17
    // merge: ShiftSettings::alkylation_call for -search_shifts) sees the same
    // Call that -alkylation_out writes after phase 9.
    FASTag::Alkylation::Call alk_call;
    if (alkylation_on) alk_call = FASTag::Alkylation::callAlkylation(run_acc.d.alk, alk_settings);
    tsv.close();  // flushes; a failed write anywhere leaves the stream failed
    if (tsv.fail())
    {
      OPENMS_LOG_ERROR << "Failed writing " << out << " (disk full?)." << std::endl;
      return CANNOT_WRITE_OUTPUT_FILE;
    }

    // ---- phase 7: q_db, entrapment-calibrated false-match q-values --------
    //
    // Post-pass over the finished TSV: build the weighted target/decoy curve
    // from the in-memory E-values (never reparsing the serialized %g values),
    // then stream-rewrite <out> appending the q_db column. Atomic via rename.
    if (entrap_on)
    {
      std::vector<double> target_e;
      std::vector<std::pair<double, int>> entrap_e;
      for (const PerThread& pt : per_thread)
      {
        target_e.insert(target_e.end(), pt.target_e.begin(), pt.target_e.end());
        entrap_e.insert(entrap_e.end(), pt.entrap_e.begin(), pt.entrap_e.end());
      }

      // Per-length effective ratio r_len = exclusive entrapment keys over
      // target keys, orientation-closed. The key spaces are per-length, so a
      // single pooled scalar would miscalibrate a curve mixing lengths.
      std::map<int, double> r_len;
      double worst_r = std::numeric_limits<double>::max();
      for (int len = filt.minLen(); len <= FASTag::MAX_FILTER_LEN; ++len)
      {
        const size_t tk = filt.keyCount(len);
        const size_t ek = entrap.keyCount(len);
        if (tk > 0 && ek == 0)
          OPENMS_LOG_WARN << "Entrapment len " << len << ": target keys exist but "
                             "the entrapment database has none -- events at this "
                             "length carry no calibration evidence." << std::endl;
        if (tk == 0 || ek == 0) continue;
        const size_t shared = entrap.sharedKeyCount(filt, len);
        const double r = static_cast<double>(ek - shared) / static_cast<double>(tk);
        r_len[len] = r;
        if (r > 0) worst_r = std::min(worst_r, r);
        OPENMS_LOG_INFO << "Entrapment len " << len << ": " << ek << " keys, "
                        << shared << " shared with target (closed), r=" << r << std::endl;
      }

      std::vector<std::pair<double, double>> wdecoys;
      size_t dropped = 0;
      for (const auto& de : entrap_e)
      {
        const auto it = r_len.find(de.second);
        if (it == r_len.end() || it->second <= 0) { ++dropped; continue; }
        wdecoys.emplace_back(de.first, 1.0 / it->second);
      }
      if (dropped)
        OPENMS_LOG_WARN << dropped << " entrapment events at lengths with no "
                           "exclusive entrapment key space were dropped from "
                           "the curve." << std::endl;
      bool any_exclusive = false;
      for (const auto& kv : r_len) any_exclusive = any_exclusive || kv.second > 0;
      // Also with ZERO events: with target-first attribution an entrapment
      // database inside the target's key space (identical to -fasta, a subset,
      // or its reverse) can produce no event at all, and the test below then
      // never fired -- every q_db came out 0 with no evidence.
      if (!any_exclusive || (!entrap_e.empty() && wdecoys.empty()))
      {
        // Every event dropped: the entrapment database's (orientation-closed)
        // key space sits entirely inside the target's. An all-zero q_db here
        // would read as "perfect" while carrying zero evidence -- exactly the
        // failure mode TagFDR's contract tells the caller to prevent.
        OPENMS_LOG_ERROR << "The entrapment database shares its entire key "
                            "space with the target at every matched length; "
                            "q_db cannot be calibrated. Choose a more distant "
                            "entrapment proteome." << std::endl;
        return UNEXPECTED_RESULT;
      }
      if (entrap_e.size() < 200)
        OPENMS_LOG_WARN << "Only " << entrap_e.size() << " entrapment events -- "
                           "the q_db curve is step-noisy below ~200; consider a "
                           "larger entrapment database." << std::endl;
      if (!target_e.empty() && worst_r != std::numeric_limits<double>::max())
        OPENMS_LOG_INFO << "q_db resolution floor ~" << (1.0 / worst_r) / target_e.size()
                        << " (one event at the TIGHTEST length over "
                        << target_e.size() << " target matches; other lengths "
                           "resolve coarser). q_db 0 below it means 'under the "
                           "resolution', not 'zero risk'." << std::endl;

      const size_t n_curve_events = wdecoys.size();
      const FASTag::TagFDR fdr(std::move(target_e), std::move(wdecoys));

      const std::string tmp = out + ".qtmp";
      std::ifstream in_tsv(out.c_str());
      std::ofstream out_tsv(tmp.c_str());
      std::string line;
      size_t ri = 0;
      bool first = true, ok = static_cast<bool>(in_tsv) && static_cast<bool>(out_tsv);
      while (ok && std::getline(in_tsv, line))
      {
        if (first) { out_tsv << line << "\tq_db\n"; first = false; continue; }
        if (ri >= row_meta.size()) { ok = false; break; }
        out_tsv << line << '\t';
        if (!row_meta[ri].second)  // entrapment rows get an empty q_db
        {
          char qn[32];
          std::snprintf(qn, sizeof qn, "%.3g", fdr.qOf(row_meta[ri].first));
          out_tsv << qn;
        }
        out_tsv << '\n';
        ++ri;
      }
      ok = ok && ri == row_meta.size() && !in_tsv.bad();
      out_tsv.flush();
      ok = ok && static_cast<bool>(out_tsv);
      in_tsv.close();
      out_tsv.close();
      std::error_code rc_ec;
      if (ok)
      {
        // std::filesystem::rename replaces an existing destination on every
        // platform; C rename() refuses to on Windows.
        std::filesystem::rename(tmp.c_str(), out.c_str(), rc_ec);
      }
      if (!ok || rc_ec)
      {
        OPENMS_LOG_ERROR << "Failed appending q_db to " << out
                         << " (row/meta mismatch or write failure); the TSV is "
                            "left WITHOUT the column." << std::endl;
        std::remove(tmp.c_str());
        return CANNOT_WRITE_OUTPUT_FILE;
      }
      OPENMS_LOG_INFO << "q_db: " << row_meta.size() << " rows calibrated against "
                      << n_curve_events << " entrapment events ("
                      << entrap_e.size() << " observed) -> " << out << std::endl;
      OPENMS_LOG_INFO << "q_db calibration envelope (measured 2026-09): conservative "
                         "at q_db <= 0.02; UNDERESTIMATES the false-match rate ~1.6x "
                         "at 0.05-0.1. Use tight thresholds, and read q_db as DB-match "
                         "spuriousness, never as read correctness." << std::endl;
    }

    // ---- phase 8: glyco summary and reconciliation outputs ----------------

    if (glyco_on)
    {
      gtsv.close();
      if (gtsv.fail())
      {
        OPENMS_LOG_ERROR << "Failed writing " << glyco_out << " (disk full?)." << std::endl;
        return CANNOT_WRITE_OUTPUT_FILE;
      }
      OPENMS_LOG_INFO << "Glyco: " << n_glyco << " of " << n_glyco_scanned
                      << " processed MS2 spectra carry oxonium evidence -> "
                      << glyco_out << std::endl;
    }

    // -census (#11): the table is complete; the summary starts with the run
    // rows (format Versioned: a new 1.12 report) and adds section `census`.
    FASTag::CensusIds::JoinTally ids_tally;
    FASTag::CensusIds::Index::Counts ids_counts;
    if (census_on)
    {
      ctsv.close();
      // -census_ids: the join, from the finished table to a second .part
      // file that replaces it before the commit.
      if (census_ids_on && !ctsv.fail())
      {
        FASTag::PartFile joined(census_part.writePath());
        std::string err;
        if (!joined.begin()
            || !FASTag::CensusIds::joinTable(census_part.writePath(), joined.writePath(), census_ids_index,
                                             census_triage_evalue, ids_tally, err)
            || !joined.commit())
        {
          OPENMS_LOG_ERROR << "Failed joining -census_ids to " << census_out << ": "
                           << (err.empty() ? joined.error() : err) << std::endl;
          census_part.discard();
          return CANNOT_WRITE_OUTPUT_FILE;
        }
        ids_counts = census_ids_index.counts();
        // Foreign references: only known when every spectrum was read.
        const double share = ids_counts.refs ? static_cast<double>(ids_counts.unmatched) /
                                                   static_cast<double>(ids_counts.refs)
                                             : 0.0;
        if (!subsampling && share > FASTag::CensusIds::kRefuseUnmatched)
        {
          OPENMS_LOG_ERROR << "-census_ids: " << ids_counts.unmatched << " of " << ids_counts.refs
                           << " spectrum references match no spectrum of -in (more than "
                           << FASTag::CensusIds::kRefuseUnmatched * 100
                           << "%): the file belongs to another run, or names spectra by an id FASTag cannot "
                              "match. No census was written; the other outputs are complete." << std::endl;
          census_part.discard();
          census_ids_refused = true;
        }
        else if (!subsampling && share > FASTag::CensusIds::kWarnUnmatched)
          OPENMS_LOG_WARN << "Warning: -census_ids: " << ids_counts.unmatched << " of " << ids_counts.refs
                          << " spectrum references match no spectrum of -in." << std::endl;
      }
    }
    if (census_on && !census_ids_refused)
    {
      if (ctsv.fail() || !census_part.commit())
      {
        OPENMS_LOG_ERROR << "Failed writing " << census_out << " (disk full?)"
                         << (census_part.error().empty() ? std::string() : ": " + census_part.error()) << std::endl;
        return CANNOT_WRITE_OUTPUT_FILE;
      }
      const FASTag::Census::Tally& tally = run_acc.f.census;
      std::vector<FD::Row> rows = FASTag::RunReport::runRows(run_meta, FASTag::RunReport::Emit::Versioned);
      for (FD::Row& r : FASTag::Census::summaryRows(tally, static_cast<std::uint64_t>(n_total), subsampling))
        rows.push_back(std::move(r));
      if (census_ids_on)
        for (FD::Row& r : FASTag::CensusIds::summaryRows(census_ids_loaded, ids_counts, ids_tally, census_ids,
                                                         census_ids_run_check, census_ids_fdr,
                                                         census_triage_evalue, !subsampling))
          rows.push_back(std::move(r));
      FASTag::PartFile summary_part(census_summary_out);
      if (!summary_part.begin() || !FD::writeReport(summary_part.writePath(), rows) || !summary_part.commit())
      {
        OPENMS_LOG_ERROR << "Failed writing " << census_summary_out
                         << (summary_part.error().empty() ? std::string() : ": " + summary_part.error()) << std::endl;
        return CANNOT_WRITE_OUTPUT_FILE;
      }
      const auto count = [&](FASTag::Census::Status st) { return tally.by_status[static_cast<size_t>(st)]; };
      OPENMS_LOG_INFO << "Census: " << tally.ms2_seen << " MS2 spectra read, "
                      << count(FASTag::Census::Status::Tagged) + count(FASTag::Census::Status::Placed)
                      << " with a reported tag ("
                      << count(FASTag::Census::Status::Placed) << " placed), "
                      << count(FASTag::Census::Status::NoTags) << " no_tags -> " << census_out
                      << ", summary -> " << census_summary_out << std::endl;
      if (census_ids_on)
        OPENMS_LOG_INFO << "Census ids: " << ids_tally.by_ident[1] << " identified, " << ids_tally.by_ident[0]
                        << " not, " << ids_tally.by_ident[2] << " unknown; " << ids_tally.triage
                        << " triage candidates (best_evalue <= " << census_triage_evalue << ")" << std::endl;
      if (tally.n_processed() != n_ms2)
        OPENMS_LOG_WARN << "Census: " << tally.n_processed() << " processed spectra, but " << n_ms2
                        << " MS2 spectra were tagged; please report this." << std::endl;
    }

    // Report close, then placement processing, then the exports that read
    // it: -recon_out is closed under recon_on; the delta histogram, the gap
    // result and every placement reader run under place_on, whether or not
    // -recon_out is written.
    if (recon_on)
    {
      rtsv.close();
      if (rtsv.fail())
      {
        OPENMS_LOG_ERROR << "Failed writing " << recon_out << " (disk full?)." << std::endl;
        return CANNOT_WRITE_OUTPUT_FILE;
      }
    }

    // ---- placement processing (place_on) ----
    if (place_on)
    {
      // The histogram rows as gaps (gap_needed only: the gap as parsed and as
      // printed) and the one gap result every gap reader shares.
      std::vector<FD::GapRow> gap_rows;
      std::vector<std::string> gap_keys;
      FD::GapResult gap_result;
      // #17 (shifts_on only): the evidence of each gap row, aligned with
      // gap_rows, and the samples whose placed peptide holds a C.
      std::vector<FASTag::SearchConfig::RowEvidence> shift_rows;
      std::uint64_t shift_c_samples = 0;
      // -delta_out: aggregate the per-spectrum samples into a histogram.
      // 0.0005 Da bins, adjacent-bin local-max grouping into peaks; each row
      // reports the peak center, its spectrum count, and the most frequent
      // interpretations. Candidates, not identifications -- the README says so.
      if (delta_on)
      {
        std::map<int64_t, std::pair<uint64_t, std::map<std::string, uint64_t>>> bins;
        std::map<int64_t, FASTag::SearchConfig::RowEvidence> shift_bins;  // #17, shifts_on only
        size_t clamped = 0, samples = 0;
        for (const PerThread& pt : per_thread)
        {
          clamped += pt.delta_clamped;
          for (const auto& d : pt.delta)
          {
            ++samples;
            const int64_t bin_key = static_cast<int64_t>(std::llround(d.delta / 0.0005));
            auto& b = bins[bin_key];
            ++b.first;
            if (!d.interp.empty()) ++b.second[d.interp];
            if (shifts_on)
            {
              FASTag::SearchConfig::RowEvidence& e = shift_bins[bin_key];
              ++e.spectra;
              if (d.interp.compare(0, 4, "sub:") == 0) ++e.substitution;
              if (d.loc_residue) ++e.localized;
              if (FASTag::SearchConfig::siteSampleCounts(d.loc_residue, d.loc_score, d.loc_ties, d.region_len,
                                                         shift_site_min_ions))
              {
                ++e.site_counted;
                ++e.sites[d.loc_residue];
              }
              if (d.has_c)
              {
                ++shift_c_samples;
                ++e.with_c;
              }
            }
          }
        }
        // Local-max grouping: a bin whose count is not exceeded by either
        // neighbor becomes a peak and absorbs its (strictly smaller) neighbors.
        // Each row goes to -delta_out and, as -massgap_out reads the file,
        // with its gap as printed, to the mass-gap report.
        const bool write_delta = !delta_out.empty();
        std::ofstream dtsv;
        if (write_delta)
        {
          dtsv.open(delta_out.c_str());
          if (!dtsv)
          {
            OPENMS_LOG_ERROR << "Cannot open output file " << delta_out << " for writing." << std::endl;
            return CANNOT_WRITE_OUTPUT_FILE;
          }
          dtsv << "delta\tspectra\ttop_interps\n";
        }
        std::set<int64_t> absorbed;
        for (const auto& kv : bins)
        {
          if (absorbed.count(kv.first)) continue;
          auto lo = bins.find(kv.first - 1), hi = bins.find(kv.first + 1);
          const uint64_t nl = lo != bins.end() ? lo->second.first : 0;
          const uint64_t nh = hi != bins.end() ? hi->second.first : 0;
          if (kv.second.first < nl || kv.second.first < nh) continue;  // not the local max
          uint64_t count = kv.second.first;
          std::map<std::string, uint64_t> interps = kv.second.second;
          FASTag::SearchConfig::RowEvidence row_ev;
          if (shifts_on) row_ev = shift_bins[kv.first];
          for (auto* nb : {lo != bins.end() ? &*lo : nullptr, hi != bins.end() ? &*hi : nullptr})
            // A valley bin between two peaks goes to the first (lower-delta)
            // one only: counted twice, the rows summed to more spectra than
            // were sampled.
            if (nb && nb->second.first < kv.second.first && !absorbed.count(nb->first))
            {
              count += nb->second.first;
              for (const auto& ip : nb->second.second) interps[ip.first] += ip.second;
              if (shifts_on) row_ev.add(shift_bins[nb->first]);
              absorbed.insert(nb->first);
            }
          // top 3 interpretations by count, deterministic tie-break on name
          std::vector<std::pair<uint64_t, std::string>> ranked;
          for (const auto& ip : interps) ranked.emplace_back(ip.second, ip.first);
          std::sort(ranked.begin(), ranked.end(), [](const auto& a, const auto& b) {
            return a.first != b.first ? a.first > b.first : a.second < b.second;
          });
          char dnum[48];
          std::snprintf(dnum, sizeof dnum, "%.4f\t%llu\t", kv.first * 0.0005,
                        static_cast<unsigned long long>(count));
          if (gap_needed)
          {
            const std::string key(dnum, std::strchr(dnum, '\t'));
            gap_rows.push_back({std::strtod(key.c_str(), nullptr), count});
            gap_keys.push_back(key);
            if (shifts_on) shift_rows.push_back(std::move(row_ev));
          }
          if (!write_delta) continue;
          dtsv << dnum;
          for (size_t r = 0; r < ranked.size() && r < 3; ++r)
          {
            if (r) dtsv << ';';
            dtsv << ranked[r].second << ':' << ranked[r].first;
          }
          if (ranked.empty()) dtsv << '-';
          dtsv << '\n';
        }
        if (write_delta)
        {
          dtsv.close();
          if (dtsv.fail())
          {
            OPENMS_LOG_ERROR << "Failed writing " << delta_out << "." << std::endl;
            return CANNOT_WRITE_OUTPUT_FILE;
          }
          OPENMS_LOG_INFO << "Delta histogram: " << samples << " spectra sampled"
                          << (clamped ? ", " + std::to_string(clamped) + " excluded (clamped flank)" : std::string())
                          << " -> " << delta_out << std::endl;
        }
        // One gap result for every gap reader (FD::gapResult): -massgap_out
        // and the 1.12 readers see the same peaks on the same rows.
        if (gap_needed) gap_result = FD::gapResult(gap_rows, gap_mods, gap_combos, gap_settings);
        if (massgap_on)
        {
          std::vector<FD::Row> rows = run_rows();
          const auto more = FD::massgapRows(gap_rows, gap_keys, gap_mods, cys_alkylations, gap_settings, gap_result);
          rows.insert(rows.end(), more.begin(), more.end());
          if (!FD::writeReport(massgap_out, rows))
          {
            OPENMS_LOG_ERROR << "Failed writing " << massgap_out << "." << std::endl;
            return CANNOT_WRITE_OUTPUT_FILE;
          }
          OPENMS_LOG_INFO << "Mass gaps: " << gap_rows.size() << " histogram rows -> " << massgap_out << std::endl;
        }
      }
      // ---- 1.12 A: placement processing and hand-off exports ----
      // #17: the gap peaks into the engine configuration, before it is
      // written below, and the decisions into -search_shifts_out.
      if (shifts_on)
      {
        std::vector<FASTag::SearchConfig::PeakEvidence> shift_ev;
        for (const FD::GapPeak& pk : gap_result.peaks)
          shift_ev.push_back(FASTag::SearchConfig::peakEvidence(pk, shift_rows));
        shift_settings.tol = gap_settings.window;
        shift_settings.c_placements = shift_c_samples;
        // 1.12 D #3g hand-off: -alkylation_out's call decides the fixed Cys
        // modification (the reagent, or none for the not-alkylated family);
        // no call made is no_call. Without -alkylation_out rule 3 applies.
        if (alkylation_on)
          shift_settings.alkylation_call = alk_call.called ? FASTag::Alkylation::className(alk_call.cls) : "no_call";
        const auto shifts = FASTag::SearchConfig::shiftsToPlan(gap_result, shift_ev, gap_mods, gap_combos,
                                                               shift_settings, sl_plan);
        for (const std::string& w : shifts.warnings) OPENMS_LOG_WARN << "-search_shifts: " << w << "." << std::endl;
        for (const std::string& i : shifts.info) OPENMS_LOG_INFO << "-search_shifts: " << i << "." << std::endl;
        if (!search_shifts_out.empty())
        {
          const auto shortest = [](double v) {
            std::string t;
            FASTag::appendShortest(t, v);
            return t;
          };
          const auto f4 = [](double v) {
            std::string t;
            FASTag::appendNum(t, v, std::chars_format::fixed, 4);
            return t;
          };
          std::vector<std::string> header = {
              "FASTag " FASTAG_VERSION " mass shifts for -search_config_out: candidates for an FDR-controlling "
              "engine, NOT identifications.",
              "input: " + File::basename(in) + "; database: " + File::basename(recon_db) + "; engine: " + search_engine +
                  "; mode: " + getStringOption_("search_shifts"),
              "settings: window " + shortest(gap_settings.window) + " Da, max_variable " +
                  std::to_string(shift_settings.max_variable) + ", max_offsets " +
                  std::to_string(shift_settings.max_offsets) + ", expand_sites " +
                  (shift_settings.expand_sites ? "yes" : "no"),
              "gap peaks: " + std::to_string(gap_result.peaks.size()) + "; exported: " +
                  std::to_string(shifts.variable) + " variable, " + std::to_string(shifts.offsets) + " offsets, " +
                  std::to_string(shifts.fixed) + " fixed; isotope errors 0.." + std::to_string(sl_plan.isotope_errors),
              shifts.bias_peaks
                  ? (shifts.bias != 0.0
                         ? "calibration: offsets corrected by the bias " + f4(shifts.bias) + " Da"
                         : "calibration: offsets uncorrected, the bias " + f4(shifts.measured_bias) +
                               " Da is within the centroid resolution " + shortest(shift_settings.resolution) + " Da") +
                        ", the spectra-weighted median of centroid - mass over " + std::to_string(shifts.bias_peaks) +
                        " single-modification peaks; residual " + f4(shifts.residual) +
                        " Da (90 % of their spectra)"
                  : "calibration: no single-modification peak; offsets uncorrected, known to the window " +
                        shortest(gap_settings.window) + " Da"};
          if (alkylation_on)
            header.push_back("alkylation call: " + shift_settings.alkylation_call +
                             " (-alkylation_out; it decides the fixed Cys modification)");
          std::string err;
          if (!FASTag::SearchConfig::writeShiftDecisions(search_shifts_out, header, shifts.decisions, &err))
          {
            OPENMS_LOG_ERROR << "Failed writing " << search_shifts_out << ": " << err << std::endl;
            return CANNOT_WRITE_OUTPUT_FILE;
          }
        }
        OPENMS_LOG_INFO << "Search shifts: " << gap_result.peaks.size() << " gap peaks, " << shifts.variable
                        << " variable, " << shifts.offsets << " offsets, " << shifts.fixed << " fixed"
                        << (search_shifts_out.empty() ? std::string() : " -> " + search_shifts_out) << std::endl;
      }
      // #5, in order: protease check, shortlist, reduced FASTA, engine
      // configuration. The FASTA and the configuration are written only when
      // the placement's tryptic windows fit the run (or -shortlist_force).
      if (handoff_on)
      {
        FD::TerminusCounter sl_tc(digest_settings.window);
        for (const PerThread& pt : per_thread) sl_tc.merge(pt.digest);
        const FD::Classification sl_cls = FD::classify(sl_tc.cterm(), sl_tc.nterm(), sl_models,
                                                       sl_digest.background_share, sl_digest.tag_min);
        using Verdict = FASTag::Shortlist::ProteaseVerdict;
        const Verdict verdict = FASTag::Shortlist::proteaseVerdict(sl_cls, !p.tol_ppm, run_acc.a.protease_spectra);
        const bool force = getFlag_("shortlist_force");
        const char* kind = verdict.kind == Verdict::Compatible ? "compatible"
                         : verdict.kind == Verdict::NonTryptic ? "non_tryptic"
                                                               : "inconclusive";
        if (verdict.kind == Verdict::Compatible)
          OPENMS_LOG_INFO << "Shortlist protease check: " << verdict.reason << "." << std::endl;
        else if (verdict.kind == Verdict::Inconclusive)
          OPENMS_LOG_WARN << "Shortlist protease check inconclusive: " << verdict.reason
                          << "; the placement assumes trypsin." << std::endl;
        else
        {
          // Refused only when something is withheld: a run asking for the
          // shortlist alone gets it, with the call in its header, and exits 0.
          std::string withheld;
          if (!fasta_out.empty()) withheld = "-fasta_out";
          if (!search_config_out.empty()) withheld += (withheld.empty() ? "" : " or ") + std::string("-search_config_out");
          if (force)
            OPENMS_LOG_WARN << "Shortlist protease check: " << verdict.reason
                            << "; -shortlist_force writes the hand-off outputs anyway." << std::endl;
          else if (withheld.empty())
            OPENMS_LOG_WARN << "Shortlist protease check: " << verdict.reason
                            << "; the placement windows are tryptic, so the shortlist does not describe this run "
                               "(the call is in its header)." << std::endl;
          else
            OPENMS_LOG_ERROR << "Shortlist protease check: " << verdict.reason
                             << "; the placement windows are tryptic, so the shortlist does not describe this run. "
                                "Not writing " << withheld << " (-shortlist_force overrides)." << std::endl;
          handoff_refused = !force && !withheld.empty();
        }

        std::vector<bool> keep(sl_proteins.size(), false);
        if (shortlist_on)
        {
          auto rows = FASTag::Shortlist::rankProteins(run_acc.a.sl, sl_proteins, sl_settings);
          std::size_t n_kept = 0, n_target = 0;
          for (const auto& r : rows)
          {
            if (r.rank) ++n_target;
            if (r.kept)
            {
              keep[r.ordinal] = true;
              ++n_kept;
            }
          }
          // The background is always kept, also where it duplicates a database
          // entry the selection left out.
          const std::size_t n_bg_db = FASTag::Shortlist::keepBackgroundTwins(sl_bg_twins, sl_proteins, keep, rows);
          if (n_bg_db > 0)
            OPENMS_LOG_INFO << "Shortlist background: " << n_bg_db
                            << " database entries not selected are kept as background." << std::endl;
          if (n_kept == 0)
            OPENMS_LOG_WARN << "Shortlist: no protein has " << sl_settings.min_spectra << " qualifying spectra"
                            << (fasta_out.empty() || handoff_refused ? "" : "; -fasta_out holds the background only")
                            << "." << std::endl;
          if (!shortlist_out.empty())
          {
            const char* pars[] = {"none", "subset", "greedy"};
            const auto shortest = [](double v) {
              std::string t;
              FASTag::appendShortest(t, v);
              return t;
            };
            std::vector<std::string> header = {
                "FASTag " FASTAG_VERSION " protein shortlist: a search-space reduction from tag placements, "
                "NOT an identification, NOT protein inference and NOT FDR-controlled.",
                "input: " + File::basename(in) + "; database: " + File::basename(recon_db),
                "settings: max_evalue " + shortest(sl_settings.max_evalue) + ", min_spectra " +
                    std::to_string(sl_settings.min_spectra) + ", gapped " + (sl_settings.gapped ? "yes" : "no") +
                    ", parsimony " + pars[static_cast<int>(sl_settings.parsimony)] + ", top " +
                    std::to_string(sl_settings.top),
                std::string("protease: ") + kind + (verdict.model.empty() ? "" : " " + verdict.model) + " (" +
                    verdict.reason + ")",
                "proteins: " + std::to_string(n_target) + " with evidence, " + std::to_string(n_kept) +
                    " kept" + (n_bg_db ? ", " + std::to_string(n_bg_db) + " database entries kept as background"
                                       : std::string()) +
                    "; decoy entries in the database: " + std::to_string(sl_decoys)};
            if (subsampling) header.push_back("counts are over the -subsample_* spectra only");
            if (filtering) header.push_back("-fasta filtered the tags before placement");
            std::string err;
            if (!FASTag::Shortlist::writeShortlist(shortlist_out, header, rows, sl_background, &err))
            {
              OPENMS_LOG_ERROR << "Failed writing " << shortlist_out << ": " << err << std::endl;
              return CANNOT_WRITE_OUTPUT_FILE;
            }
            OPENMS_LOG_INFO << "Shortlist: " << n_kept << " of " << n_target
                            << " proteins with evidence kept, not FDR-controlled -> " << shortlist_out << std::endl;
          }
        }
        if (!handoff_refused && !fasta_out.empty())
        {
          const auto res = FASTag::Shortlist::writeReducedFasta(recon_db, keep, sl_background, fasta_out);
          if (!res.ok)
          {
            OPENMS_LOG_ERROR << "Failed writing " << fasta_out << ": " << res.error
                             << "; -search_config_out not written." << std::endl;
            return CANNOT_WRITE_OUTPUT_FILE;
          }
          OPENMS_LOG_INFO << "Reduced FASTA: " << res.entries << " entries (no decoys) -> " << fasta_out << std::endl;
        }
        if (!handoff_refused && !search_config_out.empty())
        {
          std::string text, err;
          if (search_engine == "sage") text = FASTag::SearchConfig::renderSage(sl_plan);
          else if (sl_template.empty()) text = FASTag::SearchConfig::renderComet(sl_plan, &err);
          else
          {
            std::vector<std::pair<std::string, std::string>> keys;
            err = FASTag::SearchConfig::cometKeys(sl_plan, keys);
            if (err.empty())
            {
              const auto m = FASTag::SearchConfig::mergeKeyValueTemplate(sl_template, keys);
              for (const std::string& w : m.warnings) OPENMS_LOG_WARN << "-search_config_template: " << w << "." << std::endl;
              err = m.error;
              text = m.text;
            }
          }
          FASTag::PartFile pf(search_config_out);
          std::ofstream cf;
          if (err.empty() && !pf.open(cf, std::ios::out | std::ios::binary)) err = pf.error();
          if (err.empty())
          {
            cf << text;
            cf.close();
            if (cf.fail()) err = "write failed (disk full?)";
            else if (!pf.commit()) err = pf.error();
          }
          if (!err.empty())
          {
            OPENMS_LOG_ERROR << "Failed writing " << search_config_out << ": " << err << std::endl;
            return CANNOT_WRITE_OUTPUT_FILE;
          }
          OPENMS_LOG_INFO << "Search configuration (" << search_engine << ", database " << sl_plan.database
                          << ") -> " << search_config_out << std::endl;
        }
      }
    }

    // -recon_id_out: the placements as identifications.
    if (recon_ids_on)
    {
      size_t n_hits = 0;
      for (const PeptideIdentification& id : recon_ids) n_hits += id.getHits().size();
      // The mzIdentML schema requires at least one identification (and
      // OpenMS's reader refuses a file without one); idXML and mzTab may be empty.
      // A 0-byte file still marks the output as produced, for workflow
      // engines that require every declared output, and replaces whatever an
      // earlier run left at that path.
      if (recon_ids.empty() && FileHandler::getTypeByFileName(recon_id_out) == FileTypes::MZIDENTML)
      {
        if (!std::ofstream(recon_id_out.c_str(), std::ios::trunc))
        {
          OPENMS_LOG_ERROR << "Cannot write " << recon_id_out << "." << std::endl;
          return CANNOT_WRITE_OUTPUT_FILE;
        }
        OPENMS_LOG_WARN << "Recon identifications: no placements, and mzIdentML cannot hold an "
                           "empty result; " << recon_id_out << " written empty (0 bytes)." << std::endl;
      }
      else
      {
        try
        {
          FASTag::storeReconIds(recon_id_out, in, FASTAG_VERSION, id_params, recon_ids);
        }
        catch (const Exception::BaseException& e)
        {
          OPENMS_LOG_ERROR << "Failed writing " << recon_id_out << ": " << e.what() << std::endl;
          return CANNOT_WRITE_OUTPUT_FILE;
        }
        OPENMS_LOG_INFO << "Recon identifications: " << n_hits << " hits on " << recon_ids.size()
                        << " spectra, not FDR-controlled -> " << recon_id_out << std::endl;
      }
    }

    // ---- phase 9: digest and label reports ---------------------------------

    // -digest_out and -label_out, from the tag ends counted in the loop.
    if (count_on)
    {
      FD::TerminusCounter tc(digest_settings.window);
      for (const PerThread& pt : per_thread) tc.merge(pt.digest);
      if (digest_on)
      {
        FD::RunMeta meta;
        for (const PerThread& pt : per_thread)
        {
          meta.ms2 += pt.ms2_meta;
          meta.im_vssc += pt.im_vssc;
          meta.im_drift += pt.im_drift;
          meta.im_faims += pt.im_faims;
          meta.im_other += pt.im_other;
          meta.peaks += pt.peaks;
          meta.peaks_whole += pt.peaks_whole;
          meta.ms2_beam += pt.frag.ms2_beam;
          meta.ms2_resonance += pt.frag.ms2_resonance;
          meta.ms2_itms += pt.frag.ms2_itms;
          meta.ms2_ftms += pt.frag.ms2_ftms;
          meta.first_peak.insert(meta.first_peak.end(), pt.first_peak.begin(), pt.first_peak.end());
          meta.scan_low.insert(meta.scan_low.end(), pt.scan_low.begin(), pt.scan_low.end());
        }
        // Run-level metadata: the archive's settings for mzPeak; for mzML
        // the run header alone (the fast reader skips it), parsing stops at
        // the spectrumList.
        ExperimentalSettings es;
        if (mzs) es = mzs->settings();
        else if (mgf_in)
        {
          // An MGF names no instrument, scan window or native-ID format, and
          // FASTag reads no ion mobility from it: all of it is absent. The
          // native-ID format stays empty on purpose (MS:1000774 would make
          // the timsTOF rule read "no", which the file cannot support).
          meta.im_unread = true;
        }
        else
        {
          try
          {
            PeakMap head;
            MzMLFile mf;
            mf.getOptions().setMetadataOnly(true);
            mf.load(in, head);
            es = head.getExperimentalSettings();
          }
          catch (const Exception::BaseException& e)
          {
            OPENMS_LOG_WARN << "-digest_out: could not read the run header of " << in << " (" << e.what()
                            << "); instrument and native ID format are reported absent." << std::endl;
          }
        }
        meta.instrument_name = es.getInstrument().getName();
        meta.instrument_model = es.getInstrument().getModel();
        for (const MassAnalyzer& ma : es.getInstrument().getMassAnalyzers())
        {
          using AT = MassAnalyzer::AnalyzerType;
          const AT at = ma.getType();
          if (at == AT::ORBITRAP) meta.analyzer_orbitrap = true;
          else if (at == AT::PAULIONTRAP || at == AT::RADIALEJECTIONLINEARIONTRAP || at == AT::AXIALEJECTIONLINEARIONTRAP ||
                   at == AT::IT || at == AT::LIT)
            meta.analyzer_iontrap = true;
        }
        for (const SourceFile& sf : es.getSourceFiles())
          if (!sf.getNativeIDTypeAccession().empty()) { meta.native_id_type = sf.getNativeIDTypeAccession(); break; }
        std::vector<FD::Row> rows = run_rows();
        const auto more = FD::digestRows(tc, protease_models, meta, digest_settings);
        rows.insert(rows.end(), more.begin(), more.end());
        if (!FD::writeReport(digest_out, rows))
        {
          OPENMS_LOG_ERROR << "Failed writing " << digest_out << "." << std::endl;
          return CANNOT_WRITE_OUTPUT_FILE;
        }
        std::string status;
        for (const FD::Row& r : more)
          if (r.section == "call" && (r.key == "model" || r.key == "reason")) status = r.key + " " + r.value;
        OPENMS_LOG_INFO << "Digest: " << tc.tags << " filtered tags, " << status << " -> " << digest_out << std::endl;
      }
      if (label_on)
      {
        std::vector<FD::Row> rows = run_rows();
        const auto more = FD::labelRows(tc, digest_settings);
        rows.insert(rows.end(), more.begin(), more.end());
        // ---- 1.12 D: label_call (#3a) ----
        // Appended after the 1.11 rows, which stay a byte prefix.
        const auto call = FD::labelCallRows(FD::labelCall(tc, digest_settings), tc, digest_settings);
        rows.insert(rows.end(), call.begin(), call.end());
        if (!FD::writeReport(label_out, rows))
        {
          OPENMS_LOG_ERROR << "Failed writing " << label_out << "." << std::endl;
          return CANNOT_WRITE_OUTPUT_FILE;
        }
        OPENMS_LOG_INFO << "Labels: " << tc.tags << " filtered tags -> " << label_out << std::endl;
      }
    }

    // ---- 1.12 D: -alkylation_out (#3g) ----
    if (alkylation_on)
    {
      const FASTag::Alkylation::Tally& at = run_acc.d.alk;
      const FASTag::Alkylation::Call& call = alk_call;
      FASTag::Alkylation::ReportInfo info;
      info.database = recon_db;
      info.database_source = alk_db_source;
      for (const auto& m : p.mods)
        if (!m.variable && m.residue == 'C') info.reagent_note += (info.reagent_note.empty() ? "" : "+") + m.name;
      std::vector<FD::Row> rows = FASTag::RunReport::runRows(run_meta, FASTag::RunReport::Emit::Versioned);
      for (FD::Row& r : FASTag::Alkylation::alkylationRows(at, call, alk_settings, alk_forms, info)) rows.push_back(std::move(r));
      FASTag::PartFile alk_part(alkylation_out);
      if (!alk_part.begin() || !FD::writeReport(alk_part.writePath(), rows) || !alk_part.commit())
      {
        OPENMS_LOG_ERROR << "Failed writing " << alkylation_out
                         << (alk_part.error().empty() ? std::string() : ": " + alk_part.error()) << std::endl;
        return CANNOT_WRITE_OUTPUT_FILE;
      }
      OPENMS_LOG_INFO << "Alkylation: " << at.spectra << " spectra with a single-Cys placement, "
                      << (call.called ? std::string("call ") + FASTag::Alkylation::className(call.cls)
                                      : "no_call " + call.reason)
                      << " -> " << alkylation_out << std::endl;
    }

    // ---- phase 10: species detection ---------------------------------------

    // Taxonomic / species detection from the tags.
    //
    // For every spectrum, the SET of taxa its tags support (a tag supports a
    // taxon when every one of its k-mers is in that taxon -- intersection, so a
    // longer tag is more specific). Each taxon is counted ONCE per spectrum, not
    // per tag, so correlated tags from one spectrum cannot manufacture evidence.
    // Roll the per-leaf counts up the taxonomy, compare each node against the
    // breadth it has in the index, and rank. The q-value is a ranking aid, not a
    // calibrated FDR: the per-k-mer background is a proxy and the chimeric-null
    // problem described for -entrapment_fasta applies here too.
    std::string taxdb = getStringOption_("taxdb");
    std::string species_out = getStringOption_("species_out");
    std::string nodes = getStringOption_("taxonomy_nodes");
    std::string names = getStringOption_("taxonomy_names");

    if (want_species)
    {
      const std::string tdir = taxonomyDir_();
      // The one-set rule is enforced before tagging; here explicit means all three.
      const bool any_explicit = !taxdb.empty() || !nodes.empty() || !names.empty();
      if (!any_explicit && !tdir.empty())
      {
        taxdb = tdir + "/tax_k7.taxdb";
        nodes = tdir + "/nodes.dmp";
        names = tdir + "/names.dmp";
      }
      if (species_out.empty()) species_out = defaultReportPath(out, ".species.tsv");

      // Say which file is missing and where it was looked for. "Failed to load"
      // on an empty path is useless when the whole point of the defaults is that
      // the user never typed one.
      for (const auto& need : {std::make_pair("taxdb", taxdb),
                               std::make_pair("taxonomy_nodes", nodes),
                               std::make_pair("taxonomy_names", names)})
      {
        if (need.second.empty() || !File::exists(need.second))
        {
          OPENMS_LOG_ERROR << "-species: no " << need.first << ". ";
          if (tdir.empty())
          {
            OPENMS_LOG_ERROR << "No taxonomy directory was found next to the executable "
                             << "(expected <bin>/../share/FASTag/taxonomy). Set "
                             << "FASTAG_TAXONOMY_DIR, or pass -" << need.first << " explicitly."
                             << std::endl;
          }
          else if (need.second == taxdb)
          {
            // The dumps ship in every release; the ~1 GB index does not (it is a
            // separate asset). Missing index is the common case, so name it.
            OPENMS_LOG_ERROR << "The taxonomy dumps are present in '" << tdir
                             << "' but the k-mer index (tax_k7.taxdb) is not. Download "
                             << "FASTag-taxonomy-k7.tar.gz from the release and extract it "
                             << "there, or set FASTAG_TAXONOMY_DIR / pass -taxdb." << std::endl;
          }
          else
          {
            OPENMS_LOG_ERROR << "Looked in '" << tdir << "'. Pass -" << need.first
                             << " explicitly, or set FASTAG_TAXONOMY_DIR." << std::endl;
          }
          return ILLEGAL_PARAMETERS;
        }
      }
      FASTag::TaxIndex idx;
      std::string ierr;
      if (!idx.load(taxdb, &ierr))
      {
        OPENMS_LOG_ERROR << "Failed to load -taxdb '" << taxdb << "': " << ierr << std::endl;
        return INPUT_FILE_CORRUPT;
      }
      FASTag::Taxonomy tax;
      std::string terr;
      if (!tax.load(nodes, names, &terr))
      {
        OPENMS_LOG_ERROR << "Failed to load taxonomy: " << terr << std::endl;
        return INPUT_FILE_CORRUPT;
      }
      const int index_k = idx.k();
      int min_len = getIntOption_("species_min_len");
      if (min_len < index_k) min_len = index_k;

      // The up-front tag-length check again, against the LOADED k: the header
      // peek rejects legacy headers the loader still accepts, and then a run
      // whose tags are all shorter than k would write a header-only report
      // that reads as "nothing found" rather than "nothing could be found".
      const int reach = lengths.back() + 2 * getIntOption_("extension");
      if (reach < index_k)
      {
        OPENMS_LOG_WARN << "-species: no tag can reach the index k (this run was "
                        << "driven by -taxdb/-species_out rather than -species, which "
                        << "checks up front). tag_length ("
                        << lengths.back() << ") + 2*extension ("
                        << getIntOption_("extension") << ") = " << reach << " < k = " << index_k
                        << ", so every tag is too short to look up and the report WILL be empty. "
                        << "Raise " << length_opt << "to " << index_k << " (or use -extension to reach it)."
                        << std::endl;
      }

      // Per-spectrum taxon support -> per-leaf spectrum counts. by_spec was
      // collected in write_block, in write order.
      // Two filters on what counts as evidence, both identities at their
      // defaults:
      //
      //   share  -- a k-mer carried by most of the reference cannot discriminate
      //             between taxa, so it is not evidence for any of them. It is
      //             SKIPPED rather than deleted: the whole-tag rule below would
      //             otherwise make every tag containing one unmatchable.
      //   margin -- a tag whose best taxa carry no more of it than the field is
      //             too generic to be evidence at all. MARLOWE reports the
      //             absolute form of this failing on a broad database and
      //             replaces it with a top-two comparison; this is that idea
      //             adapted, since one proteome per genus leaves no within-genus
      //             fraction to compare.
      const std::vector<uint32_t> idx_taxa = idx.taxa();
      const double max_share = getDoubleOption_("species_max_kmer_share");
      const double min_margin = getDoubleOption_("species_min_margin");
      const size_t share_cap = max_share >= 1.0
          ? idx_taxa.size()
          : static_cast<size_t>(max_share * static_cast<double>(idx_taxa.size()));

      std::map<uint32_t, uint64_t> hits;       // per NODE, deduplicated per spectrum
      std::map<uint32_t, uint64_t> leaf_hits;  // per INDEX TAXON, deduplicated per spectrum
      size_t n_units = 0;
      FASTag::TagLookupCounters lookup_counters;
      const FASTag::SpeciesEvidence ev_mode = getStringOption_("species_evidence") == "all"
          ? FASTag::SpeciesEvidence::All : FASTag::SpeciesEvidence::Best;
      std::vector<FASTag::TagSupport> support;  // this spectrum's informative tags
      // 1.12 #1 (-species_call decoy): every tag the target lookup evaluates
      // is also looked up as D decoys through the same rule, with the
      // target's E-value; replicate j of a spectrum counts like the spectrum
      // (best/all evidence, once per node, lineage roll-up). A trial is a
      // spectrum with at least one evaluated target tag. Own counters, so the
      // target's log line is unchanged.
      const int n_decoys = species_call_on ? getIntOption_("species_call_decoys") : 0;
      std::map<uint32_t, uint64_t> decoy_hits;  // per NODE, summed over the D replicates
      uint64_t n_trials = 0, n_decoy_less = 0;
      FASTag::TagLookupCounters decoy_counters;
      // 1.12 #10: the reversed lookups count on their own, so the forward
      // counters (and the log line) are a forward run's.
      FASTag::TagLookupCounters rev_counters, decoy_rev_counters;
      FASTag::OrientationCounts orient_counts;
      std::vector<std::vector<FASTag::TagSupport>> decoy_support(static_cast<size_t>(n_decoys));
      for (const auto& sp : by_spec)
      {
        support.clear();
        for (auto& ds : decoy_support) ds.clear();
        bool trial = false;
        for (const auto& row : sp.second)
        {
          const std::string seq = FASTag::baseSequence(row.first);
          if (static_cast<int>(seq.size()) < min_len) continue;
          trial = true;
          bool decoy_less = false;
          for (int j = 0; j < n_decoys; ++j)
          {
            // A homopolymer (or a periodic tag whose permutation cannot leave
            // both orientations) has no decoy j: it is counted, not looked up.
            const std::string dseq = FASTag::decoyTag(seq, static_cast<uint32_t>(j));
            if (dseq.empty()) { decoy_less = true; continue; }
            FASTag::TagSupport dts;
            // Under both orientations the decoy takes the target's rule.
            if (!FASTag::orientedTagSupport(idx, dseq, index_k, share_cap, min_margin, species_orient, dts.taxa,
                                            decoy_counters, decoy_rev_counters, nullptr))
              continue;
            dts.evalue = row.second;
            decoy_support[static_cast<size_t>(j)].push_back(std::move(dts));
          }
          if (decoy_less) ++n_decoy_less;
          // The per-tag rule (share skip, whole-tag rule, margin, and under
          // -species_orientation both the orientation rule) lives in
          // SpeciesLookup.h. Forward is tagSupport() exactly.
          FASTag::TagSupport ts;
          if (!FASTag::orientedTagSupport(idx, seq, index_k, share_cap, min_margin, species_orient, ts.taxa,
                                          lookup_counters, rev_counters, &orient_counts))
            continue;
          ts.evalue = row.second;
          support.push_back(std::move(ts));
        }
        if (trial) ++n_trials;
        for (const auto& ds : decoy_support)
        {
          const std::set<uint32_t> dtaxa = FASTag::spectrumTaxa(ds, ev_mode);
          std::set<uint32_t> dnodes;
          for (uint32_t tx : dtaxa)
            for (uint32_t a : tax.lineage(tx)) dnodes.insert(a);
          for (uint32_t a : dnodes) ++decoy_hits[a];
        }
        // The taxa this spectrum counts for: by default those of its best
        // informative tag, not the union over all reported tags (see
        // SpeciesEvidence.h).
        const std::set<uint32_t> taxa = FASTag::spectrumTaxa(support, ev_mode);
        if (taxa.empty()) continue;
        ++n_units;
        for (uint32_t tx : taxa) ++leaf_hits[tx];
        // Count each NODE at most once per spectrum. Increment every ancestor of
        // every supported taxon, deduplicated within the spectrum, so `hits` is
        // already a correct spectrum-count at every rank. Summing leaf counts up
        // the tree instead would count one spectrum TWICE at a genus with two
        // supported species.
        std::set<uint32_t> spec_nodes;
        for (uint32_t tx : taxa)
          for (uint32_t a : tax.lineage(tx)) spec_nodes.insert(a);
        for (uint32_t a : spec_nodes) ++hits[a];
      }

      // Subtract the evidence a taxon earns only by resembling a stronger one.
      // Counting cannot separate near neighbours -- Macaca trails Homo by a few
      // percent because mammalian proteomes share most 7-mers -- but the index
      // knows exactly how much they share, so the shared part can be removed.
      // See TaxDeconv.h for the model and its limits.
      std::map<uint32_t, double> adjusted_leaf;
      const bool deconvolved = getFlag_("species_deconvolve") && !idx_taxa.empty();
      // The pairwise overlap of the leaves, for the deconvolution only (the
      // homology term of -species_call counts its own group-level overlap).
      std::vector<uint64_t> overlap;
      if (deconvolved) overlap = idx.pairwiseOverlap();
      if (deconvolved)
      {
        const size_t nt = idx_taxa.size();
        std::vector<double> obs(nt, 0.0);
        for (size_t i = 0; i < nt; ++i)
        {
          auto it = leaf_hits.find(idx_taxa[i]);
          if (it != leaf_hits.end()) obs[i] = static_cast<double>(it->second);
        }
        const std::vector<double> est = FASTag::deconvolve(overlap, obs, nt);
        for (size_t i = 0; i < nt; ++i)
          if (est[i] > 0.0) adjusted_leaf[idx_taxa[i]] = est[i];
      }

      // Roll the ADJUSTED leaves up by SUMMING. Spectrum counts had to be
      // deduplicated per node -- one spectrum supporting two species of a genus
      // is still one spectrum -- but these are estimated independent
      // contributions, so a genus really is the sum of its species.
      //
      // Without deconvolution the leaves are raw spectrum counts, NOT
      // independent: a spectrum tied between two sibling leaves would count
      // twice at their parent, and a family of two genera sharing the same
      // spectra would outrank one with more distinct spectra. There the
      // per-node deduplicated count `hits` is the adjusted value; at a leaf it
      // equals leaf_hits.
      std::map<uint32_t, double> adjusted;
      if (deconvolved)
      {
        for (const auto& kv : adjusted_leaf)
          for (uint32_t a : tax.lineage(kv.first)) adjusted[a] += kv.second;
      }
      else
      {
        for (const auto& kv : hits) adjusted[kv.first] = static_cast<double>(kv.second);
      }

      // hits is already rolled up (spectrum-deduped per node), so build the
      // evidence directly -- rolling it again would re-introduce the double count.
      std::vector<FASTag::NodeEvidence> rolled;
      rolled.reserve(hits.size());
      for (const auto& kv : hits) rolled.push_back({kv.first, kv.second, kv.second});

      // The background (index breadth) IS summed up the subtree. This over-counts
      // a k-mer shared by sibling taxa, which inflates the expectation and makes
      // calls more CONSERVATIVE -- the safe direction.
      std::vector<std::pair<uint32_t, uint64_t>> post_pairs;
      for (uint32_t tx : idx_taxa) post_pairs.emplace_back(tx, idx.postings(tx));
      const auto rolled_post = tax.rollUp(post_pairs);
      std::map<uint32_t, double> bg;
      const double nk = static_cast<double>(std::max<uint64_t>(1, idx.nKmers()));
      for (const auto& np : rolled_post) bg[np.taxid] = static_cast<double>(np.subtree_hits) / nk;
      std::vector<std::pair<uint32_t, double>> bg_pairs(bg.begin(), bg.end());

      const double qthr = 1.0;  // rank everything; the report shows q, caller thresholds
      auto calls = tax.call(rolled, bg_pairs, static_cast<uint64_t>(n_units), qthr);

      const std::string want_rank = getStringOption_("species_rank");

      // 1.12 #1: the calibrated call per taxon at the report rank
      // (src/SpeciesCall.h). Groups are the report-rank ancestors of the
      // index taxa; the overlap matrix is rolled up to them for the homology
      // term, and their deconvolved counts are the spill sources.
      std::map<uint32_t, FASTag::SpeciesCall::GenusStat> call_stats;
      FASTag::SpeciesCall::RunInput call_run;
      if (species_call_on)
      {
        std::map<uint32_t, int> group_index;  // report-rank taxid -> group
        std::vector<uint32_t> group_taxid;
        std::vector<int> group_of(idx_taxa.size(), -1);
        for (size_t i = 0; i < idx_taxa.size(); ++i)
          for (uint32_t a : tax.lineage(idx_taxa[i]))
            if (tax.rank(a) == want_rank)
            {
              auto ins = group_index.emplace(a, static_cast<int>(group_taxid.size()));
              if (ins.second) group_taxid.push_back(a);
              group_of[i] = ins.first->second;
              break;
            }
        const size_t ng = group_taxid.size();
        // Distinct k-mers per group pair, not a sum of the members' pairwise
        // overlaps: a k-mer shared by two members of one group counts once,
        // so C[g][h] = P(k-mer in g | k-mer in h) also at family or order
        // rank and for indexes with several strains per genus.
        const std::vector<uint64_t> rolled_overlap = idx.groupOverlap(group_of, ng);
        const std::vector<double> C = FASTag::conditionalMatrix(rolled_overlap, ng);
        std::vector<double> obs(ng, 0.0);
        for (size_t g = 0; g < ng; ++g)
        {
          auto it = hits.find(group_taxid[g]);
          if (it != hits.end()) obs[g] = static_cast<double>(it->second);
        }
        const std::vector<double> est = FASTag::deconvolve(rolled_overlap, obs, ng);
        std::vector<FASTag::SpeciesCall::GenusInput> in_g(ng);
        const double units = static_cast<double>(std::max<size_t>(1, n_units));
        for (size_t g = 0; g < ng; ++g)
        {
          FASTag::SpeciesCall::GenusInput& x = in_g[g];
          x.taxid = group_taxid[g];
          x.observed = static_cast<uint64_t>(obs[g]);
          auto dit = decoy_hits.find(x.taxid);
          x.decoy_spectra = dit == decoy_hits.end() ? 0 : dit->second;
          double cnt = obs[g];
          if (deconvolved)
          {
            auto ait = adjusted.find(x.taxid);
            cnt = ait == adjusted.end() ? 0.0 : ait->second;
          }
          x.share = cnt / units;
          x.deconvolved = g < est.size() ? est[g] : obs[g];
        }
        call_run.n_units = n_units;
        call_run.n_trials = n_trials;
        call_run.decoys = n_decoys;
        call_run.min_units = static_cast<uint64_t>(getIntOption_("species_call_min_units"));
        call_run.low_resolution = getStringOption_("fragment_tolerance_unit") == "Da";
        call_run.pi0 = getDoubleOption_("species_pi0");
        for (const auto& st : FASTag::SpeciesCall::callGenera(in_g, C, call_run, species_call_params))
          call_stats[st.taxid] = st;
      }

      std::ofstream so(species_out.c_str());
      if (!so)
      {
        OPENMS_LOG_ERROR << "Cannot open species report " << species_out << std::endl;
        return CANNOT_WRITE_OUTPUT_FILE;
      }
      so << "rank\ttaxid\tname\tobserved\tadjusted\texpected\tlog_pvalue\tqvalue";
      if (species_call_on) so << "\tcall\tcall_reason\tdecoy_spectra\tdecoy_expected\tdecoy_qvalue\tshare\tlod";
      so << '\n';

      // Order by the corrected count, not by q. Significance ranks a near
      // neighbour highly precisely because its borrowed count IS significant.
      std::vector<const FASTag::TaxonCall*> ranked;
      for (const auto& c : calls) if (c.rank == want_rank) ranked.push_back(&c);
      std::stable_sort(ranked.begin(), ranked.end(),
                       [&](const FASTag::TaxonCall* a, const FASTag::TaxonCall* b) {
                         auto va = adjusted.find(a->taxid), vb = adjusted.find(b->taxid);
                         const double fa = va == adjusted.end() ? 0.0 : va->second;
                         const double fb = vb == adjusted.end() ? 0.0 : vb->second;
                         if (fa != fb) return fa > fb;
                         if (a->observed != b->observed) return a->observed > b->observed;
                         return a->taxid < b->taxid;   // deterministic ties
                       });

      // rank/name come from the taxdump, which can carry arbitrary text: a tab
      // or newline in a name would desync columns. Sanitise the free-text
      // fields, and stream them rather than format them into a fixed buffer
      // (only the bounded numerics go through one).
      auto clean = [](const std::string& in) {
        std::string o; o.reserve(in.size());
        for (char ch : in) o += (ch == '\t' || ch == '\n' || ch == '\r') ? ' ' : ch;
        return o;
      };
      size_t shown = 0;
      size_t n_call[3] = {0, 0, 0};  // present, no_call, not_detected among the rows
      for (const FASTag::TaxonCall* cp : ranked)
      {
        const FASTag::TaxonCall& c = *cp;
        auto ait = adjusted.find(c.taxid);
        const double adj = ait == adjusted.end() ? 0.0 : ait->second;
        char num[128];
        if (species_both)
          // 1.12 #10: uncalibrated under both orientations, also with
          // -species_call decoy (see the warning); decoy_qvalue is calibrated.
          std::snprintf(num, sizeof num, "\t%llu\t%.1f\t%.1f\tNA\tNA",
                        static_cast<unsigned long long>(c.observed), adj, c.expected);
        else
          std::snprintf(num, sizeof num, "\t%llu\t%.1f\t%.1f\t%g\t%g",
                        static_cast<unsigned long long>(c.observed), adj, c.expected,
                        c.log_pvalue, c.qvalue);
        so << clean(c.rank) << '\t' << c.taxid << '\t' << clean(c.name) << num;
        if (species_call_on)
        {
          auto sit = call_stats.find(c.taxid);
          if (sit == call_stats.end())
          {
            // Not an ancestor of any index taxon at this rank: cannot happen
            // for a counted taxon, but never leave the columns short.
            so << "\tnot_detected\tnot_significant\t0\tNA\tNA\tNA\tNA";
            ++n_call[2];
          }
          else
          {
            const FASTag::SpeciesCall::GenusStat& st = sit->second;
            char lod[32];
            if (st.lod >= 0.0) std::snprintf(lod, sizeof lod, "%.6g", st.lod);
            else std::snprintf(lod, sizeof lod, "NA");
            char cnum[160];
            std::snprintf(cnum, sizeof cnum, "\t%llu\t%.3f\t%g\t%.6g\t%s",
                          static_cast<unsigned long long>(st.decoy_spectra), st.expected, st.qvalue,
                          st.share, lod);
            so << '\t' << FASTag::SpeciesCall::callName(st.call) << '\t' << st.reason << cnum;
            ++n_call[st.call == FASTag::SpeciesCall::Call::Present ? 0
                     : st.call == FASTag::SpeciesCall::Call::NoCall ? 1 : 2];
          }
        }
        so << '\n';
        if (++shown >= 50) break;
      }
      so.flush();
      const bool species_ok = static_cast<bool>(so);
      so.close();
      if (!species_ok || so.fail())
      {
        // A write error fails the run, as for every other report; exiting 0
        // would leave a stale report from an earlier run in place.
        OPENMS_LOG_ERROR << "Failed writing species report to " << species_out << std::endl;
        return CANNOT_WRITE_OUTPUT_FILE;
      }
      OPENMS_LOG_INFO << "Species: " << n_units << " spectra contributed taxon evidence";
      if (lookup_counters.kmer_skipped || lookup_counters.tag_generic)
        OPENMS_LOG_INFO << " (" << lookup_counters.kmer_skipped << " k-mers too widely shared, "
                        << lookup_counters.tag_generic << " tags too generic)";
      OPENMS_LOG_INFO << "; top " << want_rank << " calls -> " << species_out << std::endl;
      if (species_both)
      {
        // 1.12 #10: on stderr only, like every new 1.12 INFO line.
        std::cerr << "Species orientation (both): informative tags " << orient_counts.forward
                  << " forward only, " << orient_counts.reverse << " reverse only, "
                  << orient_counts.intersection << " both (shared taxa), " << orient_counts.palindrome
                  << " palindromes; " << orient_counts.ambiguous
                  << " orientation-ambiguous tags skipped" << std::endl;
      }
      if (species_call_on)
      {
        OPENMS_LOG_INFO << "Species call (-species_call decoy): " << n_call[0] << " present, " << n_call[1]
                        << " no_call, " << n_call[2] << " not_detected among the reported " << want_rank
                        << " rows";
        if (call_run.low_resolution) OPENMS_LOG_INFO << " (run-level no_call: low_resolution, Da tolerance)";
        else if (call_run.n_units < call_run.min_units)
          OPENMS_LOG_INFO << " (run-level no_call: few_spectra, " << call_run.n_units << " < "
                          << call_run.min_units << ")";
        OPENMS_LOG_INFO << "; " << n_trials << " trials, " << n_decoys << " decoys per tag";
        if (n_decoy_less) OPENMS_LOG_INFO << ", " << n_decoy_less << " tags without a decoy";
        OPENMS_LOG_INFO << "; parameters " << species_call_params_path
                        << (species_call_params.version.empty() ? std::string()
                                                                : " (" + species_call_params.version + ")")
                        << std::endl;
      }
    }

    OPENMS_LOG_INFO << n_ms2 << " MS2 spectra, " << n_tags << " tags";
    if (filtering) OPENMS_LOG_INFO << " -> " << n_reported << " after filtering";
    OPENMS_LOG_INFO << std::endl;
    if (n_no_charge > 0 && hyp_on)
    {
      // 1.12 #6: the uncharged precursors were tagged under -unknown_charge.
      using FASTag::Hyp::ChargeSource;
      const FASTag::Hyp::SourceCounts& hc = run_acc.e.hyp;
      const auto sel_of = [&](ChargeSource s) { return hc.selected[static_cast<size_t>(s)]; };
      OPENMS_LOG_WARN << n_no_charge << " of " << n_ms2 << " MS2 spectra carry no precursor charge"
                      << (n_multi_charge > 0 ? " (" + std::to_string(n_multi_charge)
                                                   + " of them list several possible charges)"
                                             : std::string())
                      << "; under -unknown_charge " << getStringOption_("unknown_charge") << " their reports use "
                      << sel_of(ChargeSource::Inferred) << " inferred, " << sel_of(ChargeSource::Ambiguous)
                      << " ambiguous (better of two), " << sel_of(ChargeSource::Possible) << " listed, "
                      << sel_of(ChargeSource::Enumerated) << " enumerated and " << sel_of(ChargeSource::Assumed)
                      << " assumed (2+, or the lowest candidate when 2 is none) charges; " << hc.multi << " spectra were tagged under several "
                      << "hypotheses, with their E-values multiplied by the number tagged." << std::endl;
    }
    else if (n_no_charge > 0)
      OPENMS_LOG_WARN << n_no_charge << " of " << n_ms2 << " MS2 spectra carry no precursor "
                         "charge"
                      << (n_multi_charge > 0 ? " (" + std::to_string(n_multi_charge)
                                                   + " of them list several possible charges)"
                                             : std::string())
                      << " and were tagged as 2+: their peaks above the 2+ precursor "
                         "mass are dropped, and their nterm_mass flanks assume charge 2 (wrong "
                         "for a 3+ or higher precursor)." << std::endl;
    // ---- 1.13: -check_header_charge summary and -check_header_out ----
    if (hdr_check_on)
    {
      using FASTag::Hyp::HeaderVerdict;
      using FASTag::Hyp::CallBasis;
      const auto v = [&](HeaderVerdict x) { return hdr_counts.verdict[static_cast<size_t>(x)]; };
      const auto by = [&](CallBasis b) { return hdr_counts.disagree_by[static_cast<size_t>(b)]; };
      const bool ovr = hyp_param.header_check == FASTag::Hyp::HeaderCheck::Override;
      std::string moves;
      for (int a = 1; a <= FASTag::Hyp::kChargeLimit; ++a)
        for (int b = 1; b <= FASTag::Hyp::kChargeLimit; ++b)
          if (hdr_counts.moves[a][b] > 0)
            moves += (moves.empty() ? "" : ", ") + std::to_string(a) + "+ -> " + std::to_string(b) + "+: "
                   + std::to_string(hdr_counts.moves[a][b]);
      std::ostringstream m;
      m << "Header charge check (-check_header_charge " << getStringOption_("check_header_charge") << "): "
        << hdr_counts.checked << " of " << n_ms2 << " MS2 spectra carry a precursor charge; " << v(HeaderVerdict::Agree)
        << " agree with their complement-pair evidence, " << v(HeaderVerdict::Disagree) << " disagree ("
        << by(CallBasis::Complement) << " by complement pairs, " << by(CallBasis::Range) << " by fragment range, "
        << by(CallBasis::OnePlus) << " by the 1+ test" << (moves.empty() ? std::string() : "; " + moves) << "), "
        << v(HeaderVerdict::Ambiguous) << " ambiguous and " << v(HeaderVerdict::NoCall) << " without evidence; "
        << (ovr ? std::to_string(hdr_counts.overridden) + " disagreeing spectra were tagged at the supported charge."
                : std::string("every spectrum was tagged at its header charge."));
      if (v(HeaderVerdict::Disagree) > 0) OPENMS_LOG_WARN << m.str() << std::endl;
      else OPENMS_LOG_INFO << m.str() << std::endl;
      if (!check_header_out.empty())
      {
        std::vector<const PerThread::HdrRow*> rows;
        for (const PerThread& pt : per_thread)
          for (const auto& r : pt.hdr_rows) rows.push_back(&r);
        std::sort(rows.begin(), rows.end(), [](const auto* a, const auto* b) { return a->index < b->index; });
        FASTag::PartFile part(check_header_out);
        std::ofstream os;
        if (!part.open(os))
        {
          OPENMS_LOG_ERROR << "Failed writing " << check_header_out << ": " << part.error() << std::endl;
          return CANNOT_WRITE_OUTPUT_FILE;
        }
        std::string buf = "index\tnative_id\tprecursor_mz\theader_charge\tcall_charge\tcall_src\tbasis\trunner_up"
                          "\theader_excess\tcall_excess\theader_ruled_out\tverdict\ttagged_charge\n";
        for (const auto* r : rows)
        {
          const auto& h = r->r;
          FASTag::appendNum(buf, r->index); buf += '\t';
          buf += r->native_id; buf += '\t';
          FASTag::appendNum(buf, r->mz, std::chars_format::fixed, 5); buf += '\t';
          FASTag::appendNum(buf, h.header); buf += '\t';
          FASTag::appendNum(buf, h.call.charge); buf += '\t';
          buf += FASTag::Hyp::sourceName(h.call.src); buf += '\t';
          buf += FASTag::Hyp::basisName(h.call.basis); buf += '\t';
          FASTag::appendNum(buf, h.call.runner_up); buf += '\t';
          FASTag::appendNum(buf, h.header_excess, std::chars_format::fixed, 3); buf += '\t';
          FASTag::appendNum(buf, h.call_excess, std::chars_format::fixed, 3); buf += '\t';
          buf += h.header_ruled_out ? '1' : '0'; buf += '\t';
          buf += FASTag::Hyp::verdictName(h.verdict); buf += '\t';
          FASTag::appendNum(buf, ovr ? h.replacement() : h.header);
          buf += '\n';
        }
        os << buf;
        os.close();
        if (os.fail() || !part.commit())
        {
          OPENMS_LOG_ERROR << "Failed writing " << check_header_out
                           << (part.error().empty() ? std::string() : ": " + part.error()) << std::endl;
          return CANNOT_WRITE_OUTPUT_FILE;
        }
        OPENMS_LOG_INFO << "Header charge check: " << rows.size() << " rows -> " << check_header_out << std::endl;
      }
    }
    // ---- 1.12 E: end-of-run warnings ----
    // #15 phase A: under -ion_series by tagging reads b/y ions; warn (stderr)
    // when more than 1% of the MS2 spectra are electron or hybrid activated.
    // Phase B: under auto and cz, one INFO line with the spectra per series
    // (stderr), and a warning for what the mode reads as the other series.
    {
      namespace IS = FASTag::IonSeries;
      const IS::ActivationCounts& act = run_acc.e.activation;
      if (ion_mode == IS::Mode::By)
      {
        if (act.warnUnderBy()) OPENMS_LOG_WARN << IS::byModeWarning(act) << std::endl;
      }
      else
      {
        std::cerr << IS::seriesInfo(ion_mode, run_acc.e.series, act) << std::endl;
        if (ion_mode == IS::Mode::Auto && IS::warnHybridUnderAuto(act))
          OPENMS_LOG_WARN << IS::hybridAutoWarning(act) << std::endl;
        if (ion_mode == IS::Mode::Cz && IS::warnCollisionalUnderCz(act))
          OPENMS_LOG_WARN << IS::collisionalCzWarning(act) << std::endl;
      }
      if (species_cz_excluded > 0) OPENMS_LOG_WARN << IS::speciesExcludedWarning(species_cz_excluded) << std::endl;
      if (run_acc.e.series.auto_by_no_column > 0)
        OPENMS_LOG_WARN << IS::autoNoColumnWarning(run_acc.e.series.auto_by_no_column) << std::endl;
    }

    // ---- phase 11: filter summary and -out_spectra writing ----------------

    // Report matches beside the number expected by chance, so a count is never
    // mistaken for signal: below the derived floor the filter passes almost
    // everything.
    if (filtering && !by_len.empty())
    {
      char line[160];
      std::snprintf(line, sizeof line, "%5s %12s %12s %12s %10s",
                    "len", "tags", "matched", "by chance", "enrichment");
      OPENMS_LOG_INFO << line << std::endl;
      for (const auto& kv : by_len)
      {
        const size_t seen = kv.second.first, hit = kv.second.second;
        if (seen == 0) continue;
        const double expect = filt.chanceRate(kv.first) * static_cast<double>(seen);
        // Only a length that actually matched something can be uninformative;
        // zero matches is simply no evidence either way.
        const char* note = "";
        if (hit > 0 && static_cast<double>(hit) <= 2.0 * expect) note = "  <- at chance";
        char enr[24] = "-";
        if (hit > 0) std::snprintf(enr, sizeof enr, "%.1fx",
                                   expect > 0 ? hit / expect : 999.0);
        std::snprintf(line, sizeof line, "%5d %12zu %12zu %12zu %10s%s",
                      kv.first, seen, hit, static_cast<size_t>(expect + 0.5), enr, note);
        OPENMS_LOG_INFO << line << std::endl;
      }
    }

    if (want_out)
    {
      if (kept_idx.empty())
      {
        // Remove what an earlier run left there: next to this run's TSV it
        // would read as this run's spectra. The collision check
        // up front guarantees this is not the input.
        std::error_code ec;
        const bool stale = std::filesystem::is_regular_file(out_spectra, ec)
                           && std::filesystem::remove(out_spectra, ec);
        OPENMS_LOG_ERROR << "No spectrum carried a reported tag; not writing " << out_spectra
                         << (stale ? " (removed the file an earlier run left there)" : "")
                         << std::endl;
        return UNEXPECTED_RESULT;
      }
      // An MGF input names itself as the source file (MgfReader::settings());
      // give it the SHA-1 FileConverter writes for it, at the cost of one more
      // read of the file.
      if (mgf_in && !kept.getExperimentalSettings().getSourceFiles().empty())
      {
        try
        {
          kept.getExperimentalSettings().getSourceFiles()[0].setChecksum(FileHandler::computeFileHash(in),
                                                                         SourceFile::ChecksumType::SHA1);
        }
        catch (const Exception::BaseException& e)
        {
          OPENMS_LOG_WARN << "-out_spectra: no SHA-1 for " << in << " (" << e.what() << ")." << std::endl;
        }
      }
      // The kept spectra, in input order, to @p sink: re-read one at a time
      // from an mzML input, or in one more pass over an mzPeak archive.
      // Per-spectrum sourceFile/dataProcessing references are cleared so the
      // run-level metadata cannot dangle.
      const auto each_kept = [&](const std::function<void(MSSpectrum&)>& sink)
      {
        const auto clean = [&sink](MSSpectrum& sp)
        {
          sp.setSourceFile(SourceFile());
          sp.setDataProcessing({});
          sink(sp);
        };
        if (mzpeak_in)
        {
          FASTag::readMzPeakSpectra(in, mzpeak_decode_threads, kept_idx, clean, pick_mzpeak);
          return;
        }
        // #9: exported as tagged, so centroided again under -pick_profile auto.
        PeakPickerHiRes out_picker;
        for (const Size i : kept_idx)
        {
          MSSpectrum sp = read_spectrum(i);
          if (pick_in_loop) FC::apply(sp, out_picker, pick_mzml);
          clean(sp);
        }
      };
      if (mzpeak_out)
      {
        // MzPeakFile::store() writes a whole experiment, so the kept spectra
        // are held in memory. It refuses spectra with an ion mobility per
        // peak, which it cannot store yet.
        PeakMap out_map;
        out_map.getExperimentalSettings() = kept.getExperimentalSettings();
        each_kept([&out_map](MSSpectrum& sp) { out_map.addSpectrum(std::move(sp)); });
        size_t with_im = 0;
        for (const MSSpectrum& sp : out_map) with_im += sp.containsIMData();
        if (with_im > 0)
        {
          OPENMS_LOG_ERROR << "Not writing " << out_spectra << ": " << with_im
                           << " of the spectra to write have an ion mobility per peak, which "
                              "mzPeak output cannot store yet. Write -out_spectra as .mzML instead."
                           << std::endl;
          return INCOMPATIBLE_INPUT_DATA;
        }
        try
        {
          MzPeakFile().store(out_spectra, out_map);
        }
        catch (const Exception::BaseException& e)
        {
          OPENMS_LOG_ERROR << "Failed writing " << out_spectra << ": " << e.what() << std::endl;
          return CANNOT_WRITE_OUTPUT_FILE;
        }
        OPENMS_LOG_INFO << "Wrote " << out_map.size() << " spectra to " << out_spectra << std::endl;
      }
      else
      {
        {
          // Scoped: the destructor writes footer + index. The count is known
          // exactly BEFORE the first consume, where the header bakes it in.
          // The header is built from the run-level settings alone; the
          // FILTERING processing step is declared for every spectrum.
          PlainMSDataWritingConsumer consumer(out_spectra);
          consumer.setExperimentalSettings(kept.getExperimentalSettings());
          consumer.setExpectedSize(kept_idx.size(), 0);
          consumer.addDataProcessing(outSpectraProcessingInfo_());
          each_kept([&consumer](MSSpectrum& sp) { consumer.consumeSpectrum(sp); });
        }
        // The consumer never checks its stream; verify the artifact instead.
        std::ifstream chk(out_spectra.c_str(), std::ios::ate | std::ios::binary);
        bool ok = chk.good() && chk.tellg() > 0;
        if (ok)
        {
          const auto sz = chk.tellg();
          const std::streamoff back = std::min<std::streamoff>(sz, 256);
          chk.seekg(-back, std::ios::end);
          std::string tail(static_cast<size_t>(back), '\0');
          chk.read(&tail[0], back);
          ok = tail.find("</indexedmzML>") != std::string::npos;
        }
        if (!ok)
        {
          OPENMS_LOG_ERROR << "Failed writing " << out_spectra << " (truncated or unwritable)."
                           << std::endl;
          return CANNOT_WRITE_OUTPUT_FILE;
        }
        OPENMS_LOG_INFO << "Wrote " << kept_idx.size() << " spectra to " << out_spectra
                        << " (two-pass, O(1) memory)" << std::endl;
      }
    }
    // Completion, emitted once everything the run promised has actually been
    // written: tags, species report and -out_spectra. total is the LARGER of the
    // announced and counted spectra, so it never shrinks.
    if (emit_progress)
    {
      const long long dd = progress_done.load();
      const long long tt = std::max(dd, progress_total);
      std::cerr << "FASTAG_PROGRESS done=" << tt << " total=" << tt << std::endl;
    }

    g_t_main_end = std::chrono::steady_clock::now();
    // #5: a confidently non-tryptic run withheld the FASTA or the
    // configuration it was asked for (a shortlist-only run is not refused).
    if (handoff_refused) return ILLEGAL_PARAMETERS;
    // #11B: -census_ids named mostly foreign spectra; the census was withheld.
    if (census_ids_refused) return INCOMPATIBLE_INPUT_DATA;
    return EXECUTION_OK;
  }
};

namespace
{
// ---------------------------------------------------------------------------
// -write_ctd / -write_cwl / -write_json
// ---------------------------------------------------------------------------
// TOPPBase writes the descriptors from OpenMS's own ParamCTDFile / ParamCWLFile
// over getDefaultParameters_(); FASTag composes no XML of its own, so the
// descriptor cannot drift from the parameter contract.
//
// KNOWN LIMITATION, upstream: ParamCTDFile renders float bounds with
// std::to_string, i.e. six decimals, so -fragment_tolerance's minimum of 1e-9
// appears in the CTD as restrictions="0.000000:" while the INI writer prints
// "1.0e-09:". The emitted bound is therefore too permissive: a workflow system
// will accept -fragment_tolerance 0 and FASTag will refuse it at run time with
// a clear message.

/// Which of TOPPBase's descriptor branches this command line will actually
/// take, mirroring TOPPBase::main's own precedence:
/// write_ini wins over everything, then ctd, then the two cwl spellings, then
/// the two json spellings. Whichever comes first returns before the rest run.
enum class DescriptorRequest
{
  None,
  Ini,
  Ctd,
  CwlOrJson
};

DescriptorRequest requestedDescriptor(int argc, const char** argv)
{
  // TOPPBase::parseCommandLine_ matches option tokens by exact string ("-" +
  // registered name), so "--write_ctd",
  // "-write_ctd=DIR" and abbreviations are unknown options to it too; a literal
  // comparison here recognises exactly what it recognises. Options supplied
  // through -ini cannot reach these branches either -- the dispatch reads
  // param_cmdline_, before any INI is loaded.
  auto given = [argc, argv](const char* opt) {
    for (int i = 1; i < argc; ++i)
    {
      if (std::strcmp(argv[i], opt) == 0) return true;
    }
    return false;
  };
  if (given("-write_ini")) return DescriptorRequest::Ini;
  if (given("-write_ctd")) return DescriptorRequest::Ctd;
  if (given("-write_nested_cwl") || given("-write_cwl") || given("-write_nested_json") || given("-write_json"))
  {
    return DescriptorRequest::CwlOrJson;
  }
  return DescriptorRequest::None;
}

} // namespace

int main(int argc, const char** argv)
{
  // OpenMS asks its REST server whether a newer OPENMS exists. For a tool that
  // is not OpenMS the answer is not actionable, and when the request fails --
  // offline, behind a proxy, or sandboxed inside an .app -- Qt prints
  // "QIODevice::read (QNetworkReplyHttpImpl): device not open" to stderr, which
  // reads like a FASTag error and was reported as one.
  //
  // Set only if the user has NOT: exporting it yourself still wins, in both
  // directions, so the check can be turned back on.
#ifdef _WIN32
  size_t sz = 0;
  if (getenv_s(&sz, nullptr, 0, "OPENMS_DISABLE_UPDATE_CHECK") != 0 || sz == 0)
    _putenv_s("OPENMS_DISABLE_UPDATE_CHECK", "ON");
#else
  ::setenv("OPENMS_DISABLE_UPDATE_CHECK", "ON", 0);
#endif
#ifdef FASTAG_MIMALLOC
  // Which heap this process allocates from. The redirection has to cover the
  // DLLs (libxml2, OpenMS), so it is only real when mimalloc-redirect.dll
  // loaded and patched the CRT; MIMALLOC_DISABLE_REDIRECT=1 switches it off.
  // test/mimalloc_redirect_test.sh and the Windows bundle check read this.
  if (std::getenv("FASTAG_TIMING"))
    std::cerr << "FASTAG_ALLOC allocator=mimalloc version=" << mi_version()
              << " redirected=" << (mi_is_redirected() ? 1 : 0) << std::endl;
#endif
  // -threads defaults to 0 (half the cores; see main_). TOPPBase registers
  // that option itself, with default 1, AFTER registerOptionsAndFlags_ and
  // offers no hook to change it, so the default is applied here, to argv,
  // before TOPPBase parses it. Left alone when the user passes -threads, and
  // when they pass -ini: the command line outranks the INI, so an injected
  // value would silently override a threads= line in the file.
  std::vector<const char*> args(argv, argv + argc);
  bool explicit_threads = false;
  bool help = false;
  for (int i = 1; i < argc; ++i)
  {
    if (std::strcmp(argv[i], "-threads") == 0 || std::strcmp(argv[i], "-ini") == 0) explicit_threads = true;
    if (std::strcmp(argv[i], "--help") == 0 || std::strcmp(argv[i], "--helphelp") == 0) help = true;
  }
  // ...and not for a bare `FASTag` either: with no arguments TOPPBase prints
  // the usage, and an injected pair would turn that into "in and out are
  // required".
  if (!explicit_threads && argc > 1)
  {
    args.push_back("-threads");
    args.push_back("0");
  }
  const DescriptorRequest descriptor = requestedDescriptor(argc, argv);
  const bool want_descriptor =
      !help && (descriptor == DescriptorRequest::Ctd || descriptor == DescriptorRequest::CwlOrJson);

#ifndef ENABLE_TDL
  // ENABLE_TDL is a PUBLIC compile definition on OpenMS's exported CMake target
  // (src/openms/CMakeLists.txt), so it reaches this file exactly when the
  // OpenMS being linked can write CWL/JSON at all -- bioconda 3.5.0 has it on,
  // a default develop build has it off. Refuse here rather than letting
  // ParamCWLFile::store() open (and therefore TRUNCATE) the target file before
  // throwing a std::runtime_error from a depth TOPPBase does not catch: that
  // would replace an existing, good descriptor with an empty one.
  if (want_descriptor && descriptor == DescriptorRequest::CwlOrJson)
  {
    std::cerr << "FASTag: -write_cwl and -write_json need an OpenMS built with ENABLE_TDL=ON;\n"
                 "        the OpenMS this binary links has it off. Use -write_ctd instead."
              << std::endl;
    return TOPPBase::UNKNOWN_ERROR;
  }
#endif

  TOPPFASTag tool;
  TOPPBase::ExitCodes rc;
  // TOPPBase::main catches OpenMS's own exceptions only. Anything else -- a
  // standard library error from a reader, bad_alloc -- would reach
  // std::terminate: an abort, no exit code, the message buried in a runtime
  // banner.
  try
  {
    rc = tool.main(static_cast<int>(args.size()), args.data());
  }
  catch (const std::exception& e)
  {
    std::cerr << (want_descriptor ? "FASTag: tool description export failed: " : "Error: ") << e.what()
              << std::endl;
    rc = TOPPBase::UNKNOWN_ERROR;
  }
  // What the run's own FASTAG_TIMING line cannot see: destroying main_()'s
  // state and TOPPBase's epilogue. Wall time past since_program_start is the
  // loader, the libraries' static initialisers, and the kernel's exit.
  if (std::getenv("FASTAG_TIMING") && g_t_main_end.time_since_epoch().count() != 0)
  {
    const auto now = std::chrono::steady_clock::now();
    std::cerr << "FASTAG_TIMING teardown=" << std::chrono::duration<double>(now - g_t_main_end).count()
              << " since_program_start=" << std::chrono::duration<double>(now - g_t_program).count()
              << std::endl;
  }
  // The same missing hook leaves --help printing TOPPBase's own -threads line,
  // "(0 = all available cores) (default: '1')" -- wrong for FASTag on both
  // counts and not editable from a tool: printUsage_ is not virtual, and it
  // wraps at the console width, so patching the captured text would be
  // fragile. TOPPBase prints help to stderr and returns EXECUTION_OK, so the
  // correction follows on the same stream, and only when help was really
  // printed (a bad value next to --help dumps the usage with
  // ILLEGAL_PARAMETERS instead). Nothing parses this: the GUI manifest comes
  // from -write_ini, and the GUI's probe and CI look for "Version:" only.
  if (help && rc == TOPPBase::EXECUTION_OK)
  {
    std::cerr << "Note: in FASTag, -threads defaults to 0 = half the logical cores (at least 1);\n"
                 "      the -threads line above is OpenMS's and shows OpenMS's own default.\n"
                 "      With -ini, the file's threads value applies (1 if it has none) unless\n"
                 "      -threads is also given on the command line.\n"
              << std::endl;
  }
  return rc;
}
