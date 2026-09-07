// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
//
// --------------------------------------------------------------------------
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
// --------------------------------------------------------------------------

#include <OpenMS/APPLICATIONS/TOPPBase.h>
#include <OpenMS/CHEMISTRY/ModificationsDB.h>
#include <OpenMS/CHEMISTRY/ResidueModification.h>
#include <OpenMS/CONCEPT/LogStream.h>
#include <OpenMS/DATASTRUCTURES/ListUtils.h>
#include <OpenMS/FORMAT/FASTAFile.h>
#include <OpenMS/FORMAT/FileHandler.h>
#include <OpenMS/KERNEL/MSExperiment.h>
#include <OpenMS/KERNEL/OnDiscMSExperiment.h>
#ifdef FASTAG_HAVE_MZPEAK_LIB
#include "IndexedMzMLReader.h"
#include "OnDiscMzPeakExperiment.h"
#include <functional>
#endif

#include "FASTagger.h"
#include "FastaFilter.h"
#include "Glyco.h"

#include <OpenMS/FORMAT/DATAACCESS/MSDataWritingConsumer.h>
#include "TagFDR.h"
#include "TagRecon.h"
#include "Proforma.h"
#include "SpectrumSampler.h"
#include "TaxIndex.h"
#include "TaxStats.h"

#include <cstdio>
#include <fstream>
#include <filesystem>
#include <csignal>
#include <iostream>
#ifdef _WIN32
#include <io.h>
#define fastag_dup _dup
#define fastag_dup2 _dup2
#define fastag_fdopen _fdopen
#else
#include <unistd.h>
#define fastag_dup dup
#define fastag_dup2 dup2
#define fastag_fdopen fdopen
#endif
#include <map>
#include <limits>
#include <memory>
#include <algorithm>
#include <iterator>
#include <OpenMS/SYSTEM/File.h>

#include <atomic>
#include <chrono>

namespace
{
  /// Program start, for FASTAG_TIMING. Static init runs before main, so the
  /// pre-loop phases (opening the archive, building its metadata map, the
  /// tolerance probe) are attributable rather than lumped into "the rest".
  const std::chrono::steady_clock::time_point g_t_program = std::chrono::steady_clock::now();
  double g_t_open = 0; ///< seconds spent constructing the input reader
}
#include <cstdlib>
#include <cstring>
#include <set>
#include <vector>

#ifdef _OPENMP
#include <omp.h>
#else
static inline int omp_get_max_threads() { return 1; }
static inline int omp_get_num_threads() { return 1; }
static inline int omp_get_thread_num() { return 0; }
#endif

using namespace OpenMS;

namespace
{
  // Deliberately OUTSIDE the FASTAG_HAVE_MZPEAK_LIB guard below. -species
  // works on any build, so a mzPeak-less build must still compile this; it
  // lived inside the guard briefly and broke every stock-OpenMS build while
  // CI (which always builds the patched OpenMS) stayed green.
  /// Directory holding the bundled taxonomy, or "" when there is none.
  ///
  /// Resolution order:
  ///   1. $FASTAG_TAXONOMY_DIR   -- a custom or larger reference set
  ///   2. <executable dir>/../share/FASTag/taxonomy   -- the release layout
  ///
  /// Deliberately anchored to the EXECUTABLE, not OPENMS_DATA_PATH: this is
  /// FASTag's own data, and a user pointing OPENMS_DATA_PATH at a system OpenMS
  /// installation must not silently lose the taxonomy that shipped beside the
  /// binary they are running.
  /// k of a taxonomy index, read from its 16-byte header alone.
  ///
  /// Exists so the tag-length precondition can be checked BEFORE tagging.
  /// Loading the index to learn k costs seconds and ~2 GB, which is exactly the
  /// work we want to refuse to waste.
  ///
  /// Both index versions put k at the same place: magic(4) | u32 version | u32 k.
  /// This MUST accept the current "FTX2" and not only the legacy "FTXI" -- when
  /// it recognised only v1, the shipped v2 index made the whole tag-length
  /// precondition a no-op, reviving the slow empty-report path it exists to stop.
  int peekTaxdbK_(const String& path)
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

  String taxonomyDir_()
  {
    const char* env = std::getenv("FASTAG_TAXONOMY_DIR");
    if (env != nullptr && *env != '\0' && File::isDirectory(String(env))) return String(env);

    // Two layouts, because the project ships both:
    //   ../share/FASTag/taxonomy   a normal `cmake --install` tree (bin/ + share/)
    //   ./share-FASTag-taxonomy    the release tarball, which is flat: the
    //                              executable sits at the root next to lib/ and
    //                              share-OpenMS/, so there is no ../share to find.
    // Checking only the first would leave -species broken in every release while
    // working perfectly from a local install -- the worst way to get this wrong.
    // A directory only counts if it actually HOLDS the taxonomy. Accepting the
    // first that merely exists meant an empty ../share/FASTag/taxonomy masked a
    // complete share-FASTag-taxonomy beside it -- exactly the layout a release
    // has if the index was never installed.
    // Prefer a directory that has the INDEX (a fully usable set), then one with
    // the dumps (installable -- the index is a separate download), then any that
    // merely exists (so the error names a real path). Without the index-first
    // pass, a dumps-only install tree masked a complete flat-release dir.
    const String exe = File::getExecutablePath();
    const String cands[] = {exe + "../share/FASTag/taxonomy",
                            exe + "share-FASTag-taxonomy",
                            exe + "taxonomy"};
    String with_dumps, any;
    for (const String& c : cands)
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

  Reimplements DirecTag (Tabb et al., J Proteome Res 2008, 7:3838) with three
  differences: the intensity null is computed by dynamic programming instead of
  by enumerating every C(n,k) subset of peak ranks, which is what makes tag
  lengths above four reachable; a seed tag can be extended, so the configured
  length is a minimum; and reported tags can be restricted to sequences supplied
  as FASTA, with the carrying spectra written out as mzML.

  <B>The command line parameters of this tool are:</B>
  @verbinclude TOPP_FASTag.cli
*/
//-------------------------------------------------------------------------

class TOPPFASTag : public TOPPBase
{
public:
  // official = false: FASTag lives outside the OpenMS tree and so is not in
  // ToolHandler's list. Passing true makes the TOPPBase constructor throw
  // InvalidValue on startup.
  TOPPFASTag()
    : TOPPBase("FASTag", "Infers partial sequence tags from MS/MS spectra.", false,
               {{"Tabb DL, Ma ZQ, Martin DB, Ham AJ, Chambers MC",
                 "DirecTag: accurate sequence tags from peptide MS/MS through statistical scoring",
                 "J Proteome Res 2008; 7(9): 3838-46", "10.1021/pr800154p"}})
  {
  }

protected:
  void registerOptionsAndFlags_() override
  {
    // No setValidFormats_ on the two spectrum files. TOPPBase validates that
    // list against OpenMS's FileTypes enum at registration and throws on a
    // name it does not know, and MZPEAK exists only on one OpenMS feature
    // branch -- so naming mzpeak here is what forced every release to build
    // OpenMS from source. Left unrestricted, TOPPBase skips the check and the
    // extension is decided below, where an unsupported one is refused with
    // its own message. The description carries what --help's format list
    // used to.
#ifdef FASTAG_HAVE_MZPEAK_LIB
    registerInputFile_("in", "<file>", "", "Input spectra (mzML or mzpeak)", /*required=*/false);
#else
    registerInputFile_("in", "<file>", "", "Input spectra (mzML; this build has no mzPeak reader)",
                       /*required=*/false);
#endif
    registerOutputFile_("out", "<file>", "", "Tag list (tab-separated)", /*required=*/false);
    setValidFormats_("out", ListUtils::create<String>("tsv"));

    registerInputFile_("fasta", "<file>", "", "Report only tags occurring in these sequences", false);
    setValidFormats_("fasta", ListUtils::create<String>("fasta"));
    registerOutputFile_("out_spectra", "<file>", "",
                        "Write spectra carrying a reported tag here (mzML, or "
                        "mzpeak if this build has the library). Note this path "
                        "holds one slot per input spectrum, so unlike the default "
                        "it needs memory proportional to the FILE, not to the "
                        "thread count", false);

    registerIntOption_("tag_length", "<n>", 3, "Seed tag length in residues", false);
    setMinInt_("tag_length", 1);
    registerIntOption_("extension", "<n>", 0,
                       "Maximum residues appended per terminus; 0 disables extension", false);
    setMinInt_("extension", 0);
    // tag_length + 2*extension is computed as int and indexes the null tables.
    // Unbounded, --extension 1073741824 overflows and aborts with std::length_error.
    setMaxInt_("extension", (FASTag::MAX_FILTER_LEN - 1) / 2);
    registerIntOption_("gaps", "<n>", 0,
                       "Allow a tag to cross one missing peak, spelling the two "
                       "residues either side of it from their summed mass; "
                       "0 disables", false);
    setMinInt_("gaps", 0);
    registerFlag_("deisotope",
                  "Collapse isotope clusters to their monoisotopic peak and move "
                  "multiply-charged fragments onto the singly-charged scale before "
                  "peak selection", false);
    // One gap only. Each additional gap multiplies the branching and asserts
    // another unobserved split, and a two-gap tag would be mostly inference.
    setMaxInt_("gaps", 1);

    registerDoubleOption_("fragment_tolerance", "<value>", 20.0, "Fragment mass tolerance", false);
    // Without a floor a negative or zero tolerance matches nothing and the run
    // reports zero tags with no indication why.
    setMinFloat_("fragment_tolerance", 1e-9);
    registerStringOption_("fragment_tolerance_unit", "<unit>", "ppm", "Tolerance unit", false);
    setValidStrings_("fragment_tolerance_unit", ListUtils::create<String>("ppm,Da"));

    registerIntOption_("max_peaks", "<n>", 400,
                       "Peaks retained per spectrum; 0 uses the internal ceiling "
                       "of 1024, not unlimited -- the scoring tables are built to "
                       "that bound. The ceiling for 'peaks_per_window'", false);
    setMinInt_("max_peaks", 0);
    registerIntOption_("peaks_per_window", "<n>", 10,
                       "Keep this many peaks per 100 Da window instead of the "
                       "strongest 'max_peaks' overall; 0 disables. Scales the "
                       "effective peak budget with the spectrum's m/z range, so "
                       "dense spectra are not starved and sparse ones not padded", false);
    setMinInt_("peaks_per_window", 0);
    registerIntOption_("max_tags", "<n>", 50, "Tags reported per spectrum; 0 = unlimited", false);
    setMinInt_("max_tags", 0);

    // Random subsampling of input spectra. For a taxon call (or a quick preview)
    // a run does not need every spectrum -- a uniformly random subset gives the
    // same lowest-common-ancestor at a fraction of the cost. Selection is seeded
    // (-subsample_seed) so a run is reproducible. 0 / 0.0 disables. If both are
    // set, the absolute count wins.
    registerIntOption_("subsample_spectra", "<n>", 0,
                       "Tag only this many randomly chosen input spectra; 0 = all", false);
    setMinInt_("subsample_spectra", 0);
    registerDoubleOption_("subsample_fraction", "<f>", 0.0,
                          "Tag only this random fraction (0..1] of input spectra; 0 = all", false);
    setMinFloat_("subsample_fraction", 0.0);
    setMaxFloat_("subsample_fraction", 1.0);

    // How much decoded mzPeak may be held at once. This is a real ceiling, not
    // a hint: the archive cache admits a decode only when the bytes already in
    // flight leave room, so peak memory follows this number and not -threads.
    // Too small costs time rather than correctness -- a group evicted before
    // the next thread reaches it is decoded again.
    registerIntOption_("mzpeak_read_memory", "<MB>", 0,
                       "Decoded mzPeak held at once, in MB; 0 = size it to the archive", false, true);
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
                  "rows + '#end' sentinels on stdout. Core tagging only "
                  "(refuses -fasta/-species/-recon_out/-out_spectra/"
                  "-entrapment_fasta); parameter changes need a restart");

    registerFlag_("diversity",
                  "Diversify which tags occupy the -max_tags slots on chimeric "
                  "spectra: near-duplicate re-reads of an already-kept tag's peak "
                  "set are demoted behind non-duplicates, then backfilled. "
                  "Reorders slot occupancy under the cap; never drops below it");

    // ProForma 2.0 rendering of each tag, appended as a trailing column. Off by
    // default so the TSV schema is unchanged unless asked for. See Proforma.h.
    registerFlag_("proforma", "Append a ProForma 2.0 column ([+nterm]-SEQ-[+cterm]) for each tag");

    registerFlag_("res_conf",
                  "Append a res_conf column: per-residue confidences 0..100, "
                  "N->C, space-separated, one per residue (a gap's two residues "
                  "share their pair score). What assembly-style consumers "
                  "(Stitch/ALPS via tools/tags_to_denovo.py) read as local "
                  "confidence");

    // Tag reconciliation (TagRecon stage A+B) at proteome scale: place each
    // reported tag onto tryptic windows of a database by its flanking masses
    // and localize/interpret the single mass gap the flanks imply. Runs on a
    // per-run suffix-array index (ProteomeIndex, ~2 s to build on a human
    // reference proteome) -- deliberately DECOUPLED from -fasta: filtering
    // builds a per-length k-mer membership index whose memory grows with
    // (residues x lengths), while reconciliation needs only the ~150 MB
    // locate index, so a proteome-scale -recon_fasta must not force the
    // filter's build.
    // Entrapment-calibrated q-values for the -fasta membership filter.
    // Adds a q_db column: the estimated FALSE-MATCH rate of accepting every
    // tag at or below a row's E-value -- i.e. how often a tag this good hits
    // the database by chance, calibrated by sequences the sample cannot
    // contain. q_db is NOT the probability the tag misreads its precursor: a
    // correct ladder read of a co-isolated chimeric peptide legitimately
    // matches the target database and is not false under this null (which is
    // exactly why this null works where single-spectrum decoys measured an
    // empty one -- see doc/BACKLOG.md F4).
    registerInputFile_("entrapment_fasta", "<file>", "",
                       "Entrapment database (foreign species the sample cannot "
                       "contain; phylogenetically distant, e.g. archaea for a "
                       "mammalian sample). Requires -fasta. Appends a q_db "
                       "column and marks entrapment-only matches efwd/erev "
                       "in fasta_hit", false);
    setValidFormats_("entrapment_fasta", ListUtils::create<String>("fasta"));

    registerOutputFile_("recon_out", "<file>", "",
                        "Reconcile reported tags against a protein database and write "
                        "one row per placement (protein, peptide, position, flank "
                        "agreement, mass gap + interpretation). Uses -recon_fasta, "
                        "or -fasta when that is not given", false);
    setValidFormats_("recon_out", ListUtils::create<String>("tsv"));
    registerInputFile_("recon_fasta", "<file>", "",
                       "Protein database for -recon_out. Default: the -fasta file", false);
    setValidFormats_("recon_fasta", ListUtils::create<String>("fasta"));
    registerIntOption_("recon_missed_cleavages", "<n>", 1,
                       "Missed tryptic cleavages allowed in reconciliation windows", false);
    setMinInt_("recon_missed_cleavages", 0);
    registerIntOption_("recon_min_length", "<n>", 0,
                       "Shortest tag worth reconciling; 0 derives it from database size "
                       "(the length where chance matches fall below 5%). Overridable "
                       "because the floor is a noise gate, not a correctness rule", false);
    setMinInt_("recon_min_length", 0);
    registerOutputFile_("delta_out", "<file>", "",
                        "Aggregated mass-shift histogram over the reconciliations "
                        "(requires -recon_out): delta, spectrum count, top "
                        "interpretations. Region-level candidates, NOT localized "
                        "identifications and NOT FDR-controlled", false);
    setValidFormats_("delta_out", ListUtils::create<String>("tsv"));

    // Taxonomic / species detection: throw the tags at a prebuilt tag->taxon
    // index (buildtaxdb) and infer the taxa present by lowest-common-ancestor
    // over the tag hits. A reduced reference set gives honest genus/family
    // resolution; short peptide tags cannot resolve species. Pair with
    // -subsample_* for a fast call on a large run.
    // The switch. Off by default -- loading an index costs seconds and ~2 GB,
    // which no plain tagging run should pay for. With it on, the three inputs
    // below default to the taxonomy bundled beside the binary, so `-species` on
    // its own is a complete request.
    registerFlag_("species", "Infer which taxa are present from the tags. Uses the bundled "
                             "taxonomy unless -taxdb/-taxonomy_* are given, and writes "
                             "<out>.species.tsv unless -species_out is given");

    // Glycopeptide spectrum flag: oxonium-ion detection per MS2 spectrum,
    // written to its own TSV (see Glyco.h for why it is not a tag column).
    registerFlag_("glyco",
                  "Flag oxonium-bearing MS2 spectra (glycopeptide/glycan "
                  "evidence, NOT an identification) to <out> with a .glyco.tsv "
                  "suffix, or -glyco_out");
    registerOutputFile_("glyco_out", "<file>", "",
                        "Per-spectrum oxonium report. Default: <out> with a "
                        ".glyco.tsv suffix", false);
    setValidFormats_("glyco_out", ListUtils::create<String>("tsv"));
    registerDoubleOption_("glyco_min_fraction", "<f>", 0.10,
                          "Minimum summed oxonium intensity as a fraction of the "
                          "base peak (MSFragger-Glyco's diagnostic filter)", false);
    setMinFloat_("glyco_min_fraction", 0.0);

    registerInputFile_("taxdb", "<file>", "", "Tag->taxon index (built by buildtaxdb). Default: the bundled tax_k7.taxdb", false);
    registerInputFile_("taxonomy_nodes", "<file>", "", "NCBI taxonomy nodes.dmp. Default: the bundled nodes.dmp", false);
    registerInputFile_("taxonomy_names", "<file>", "", "NCBI taxonomy names.dmp. Default: the bundled names.dmp", false);
    registerOutputFile_("species_out", "<file>", "", "Ranked taxa TSV. Default: <out> with a .species.tsv suffix", false);
    setValidFormats_("species_out", ListUtils::create<String>("tsv"));
    registerIntOption_("species_min_len", "<n>", 0,
                       "Ignore tags shorter than this for taxonomy; 0 uses the index k", false);
    setMinInt_("species_min_len", 0);
    registerStringOption_("species_rank", "<rank>", "genus",
                          "Report taxa at this NCBI rank (genus, family, ...)", false);
    registerDoubleOption_("max_evalue", "<value>", 20.0, "E-value cutoff; 0 disables", false);
    setMinFloat_("max_evalue", 0.0);
    registerDoubleOption_("gap_penalty", "<value>", 100.0,
                          "Rank gapped tags as if their E-value were this many times "
                          "worse. Affects ORDER only, never which tags are reported. "
                          "1 disables. Gapped tags are otherwise heavily over-ranked: "
                          "they take ~95% of top-1 slots while being ~3.6x less likely "
                          "to be correct", false);
    setMinFloat_("gap_penalty", 1.0);

    registerDoubleOption_("isobaric_tolerance", "<value>", 0.04,
                          "When matching against 'fasta', treat a residue as interchangeable "
                          "with an isobaric residue pair within this tolerance; 0 requires "
                          "exact strings", false);
    registerIntOption_("min_filter_length", "<n>", 0,
                       "Ignore tags shorter than this when matching against 'fasta'; "
                       "0 derives a floor from the database size", false);
    registerStringOption_("orientation", "<mode>", "both",
                          "Match a tag as written, or also reversed. Tags are stored N->C under a "
                          "y-ion assumption, so b-derived tags read reversed", false);
    setValidStrings_("orientation", ListUtils::create<String>("both,forward"));

    // Modifications, resolved through OpenMS ModificationsDB so any UniMod name
    // works, not a fixed list. Fixed mods shift a residue's mass and are not
    // annotated (the shift is implicit, as carbamidomethyl-C conventionally is);
    // variable mods add a modified alternative that is written inline in the tag
    // as X[Name] (e.g. S[Phospho]). Residue-specific mods only -- a terminal mod
    // shifts the whole precursor and so is already carried in the flanking
    // masses, with nothing per-residue to annotate.
    registerStringList_("fixed_modifications", "<mods>",
                        ListUtils::create<String>("Carbamidomethyl (C)"),
                        "Fixed modifications by OpenMS/UniMod name, e.g. "
                        "'Carbamidomethyl (C)' 'TMT6plex (K)'. Shift residue masses; "
                        "not annotated in the tag", false);
    registerStringList_("variable_modifications", "<mods>", ListUtils::create<String>(""),
                        "Variable modifications by OpenMS/UniMod name, e.g. "
                        "'Phospho (S)' 'Phospho (T)' 'Phospho (Y)' 'Formyl (K)'. "
                        "Add a modified alternative, written inline as X[Name]", false);
  }

  /// Resolve OpenMS/UniMod modification names to FASTag::ModSpec via
  /// ModificationsDB. Terminal mods are skipped with a note -- they are absorbed
  /// into the reported flanking masses, not the internal residue alphabet.
  /// One TSV row for one tag, appended to buf. THE row format -- file mode
  /// and -stream both call this, so the two can never drift.
  //
  // Append field by field: a string grows on its own, so there is one code
  // path and no fixed-buffer fallback to drift (an earlier snprintf version
  // dropped columns on very long native IDs). Flanking masses at 4 decimals
  // (0.1 mDa) -- %g's 6 significant digits are coarser than the tolerance the
  // tag was found with, and these are what a downstream search constrains on.
  static void appendTagRow(std::string& buf, const FASTag::Tag& t,
                           const String& native_id, const char* hit,
                           bool want_proforma, const std::string& proforma_fixed,
                           bool want_res_conf = false)
  {
    char num[48];
    auto f = [&](const char* fmt, auto v) { std::snprintf(num, sizeof num, fmt, v); buf += num; };
    buf += native_id;          buf += '\t';
    buf += t.seq;              buf += '\t';
    f("%zu", t.n_res);         buf += '\t';
    f("%d", t.charge);         buf += '\t';
    f("%.4f", t.nterm_mass);   buf += '\t';
    f("%.4f", t.cterm_mass);   buf += '\t';
    f("%d", t.extended ? 1 : 0); buf += '\t';
    f("%d", t.gapped ? 1 : 0); buf += '\t';
    f("%g", t.evalue);         buf += '\t';
    f("%.3f", t.min_conf);     buf += '\t';
    f("%.3f", t.mean_conf);    buf += '\t';
    buf += hit;
    if (want_proforma) { buf += '\t'; buf += FASTag::toProforma(t.seq, t.nterm_mass, t.cterm_mass, proforma_fixed); }
    if (want_res_conf)
    {
      buf += '\t';
      for (size_t i = 0; i < t.res_conf.size(); ++i)
      {
        if (i) buf += ' ';
        f("%d", static_cast<int>(t.res_conf[i]));
      }
    }
    buf += '\n';
  }

  /// ProForma global fixed-modification prefix: each "Name (Residues)" entry
  /// becomes `<[Name]@Residues>`. Fixed mods change residue masses but are
  /// NOT in the tag sequence, so a bare `C` is really carbamidomethyl-C; the
  /// prefix declares that for the whole proteoform.
  static std::string buildProformaPrefix(const StringList& mods)
  {
    std::string out;
    for (const String& m : mods)
    {
      const size_t lp = m.find('('), rp = m.rfind(')');
      if (lp == String::npos || rp == String::npos || rp < lp) continue;
      std::string name = m.substr(0, lp);
      while (!name.empty() && name.back() == ' ') name.pop_back();
      std::string targets;
      for (char c : m.substr(lp + 1, rp - lp - 1))
        if (c >= 'A' && c <= 'Z') targets += (c == 'I' ? 'L' : c);
      if (name.empty() || targets.empty()) continue;
      out += "<[" + name + "]@";
      for (size_t i = 0; i < targets.size(); ++i) { if (i) out += ','; out += targets[i]; }
      out += ">";
    }
    return out;
  }

  void resolveMods_(const StringList& names, bool variable, std::vector<FASTag::ModSpec>& out)
  {
    auto* db = ModificationsDB::getInstance();
    for (const String& nm : names)
    {
      if (nm.empty()) continue;
      const ResidueModification* mod = nullptr;
      try { mod = db->getModification(nm); }
      catch (Exception::BaseException&)
      {
        OPENMS_LOG_ERROR << "Unknown modification '" << nm << "'; ignoring." << std::endl;
        continue;
      }
      if (!mod) continue;
      if (mod->getTermSpecificity() != ResidueModification::ANYWHERE)
      {
        OPENMS_LOG_INFO << "Modification '" << nm << "' is terminal; it is absorbed "
                           "into the reported flanking masses and not annotated "
                           "per-residue." << std::endl;
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
    }
  }

  FILE* stream_data_ = nullptr;  ///< the REAL stdout in -stream mode

  ExitCodes main_(int, const char**) override
  {
    if (getFlag_("stream"))
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
        OPENMS_LOG_ERROR << "-stream: cannot rewire stdout." << std::endl;
        return ILLEGAL_PARAMETERS;
      }
#ifndef _WIN32
      // A consumer that vanishes must surface as an error, not a SIGPIPE kill
      // -- the flag help promises the process never dies mid-stream.
      signal(SIGPIPE, SIG_IGN);
#endif
    }

    // Species precondition, checked BEFORE the run rather than after.
    //
    // The index is keyed on k-mers, so a tag shorter than k can never be looked
    // up. With the default tag_length of 3 against the bundled k=7 index that is
    // EVERY tag: the run used to succeed, spend seconds and ~2 GB loading the
    // index, and write a header-only report -- which reads as "nothing found"
    // instead of "nothing could be found". A warning after the fact was not
    // enough; refuse up front and say exactly what to change.
    // Same activation condition as the run itself (below): the legacy
    // -taxdb + -species_out invocation triggers species detection without the
    // -species flag, and it must get the same up-front check, not the slow
    // empty-report path.
    if (getFlag_("species")
        || (!getStringOption_("taxdb").empty() && !getStringOption_("species_out").empty()))
    {
      String probe_taxdb = getStringOption_("taxdb");
      if (probe_taxdb.empty())
      {
        const String d = taxonomyDir_();
        if (!d.empty()) probe_taxdb = d + "/tax_k7.taxdb";
      }
      const int kk = probe_taxdb.empty() ? -1 : peekTaxdbK_(probe_taxdb);
      if (kk > 0)
      {
        const int reach = getIntOption_("tag_length") + 2 * getIntOption_("extension");
        if (reach < kk)
        {
          OPENMS_LOG_ERROR << "-species: tag_length (" << getIntOption_("tag_length")
                           << ") + 2*extension (" << getIntOption_("extension") << ") = "
                           << reach << " cannot reach the index k = " << kk
                           << ", so every tag would be too short to look up and the "
                           << "report would be empty. Set -tag_length " << kk
                           << " (or raise -extension)." << std::endl;
          return ILLEGAL_PARAMETERS;
        }
      }
    }

    const String in = getStringOption_("in");
    const String out = getStringOption_("out");
    const bool stream_mode = getFlag_("stream");
    if (!stream_mode && (in.empty() || out.empty()))
    {
      OPENMS_LOG_ERROR << "The parameters 'in' and 'out' are required (or use -stream)." << std::endl;
      return ILLEGAL_PARAMETERS;
    }
    if (stream_mode)
    {
      // Whole-run machinery is meaningless per-block: -out_spectra re-reads
      // indexed input, q_db needs the full curve, -species aggregates a run,
      // and the filter/recon paths are not per-spectrum-latency material yet.
      for (const char* opt : {"fasta", "entrapment_fasta", "recon_out", "species_out",
                              "taxdb", "out_spectra", "delta_out"})
        if (!getStringOption_(opt).empty())
        {
          OPENMS_LOG_ERROR << "-stream cannot be combined with -" << opt << "." << std::endl;
          return ILLEGAL_PARAMETERS;
        }
      if (getFlag_("species") || getFlag_("glyco"))
      {
        OPENMS_LOG_ERROR << "-stream cannot be combined with -species or -glyco." << std::endl;
        return ILLEGAL_PARAMETERS;
      }
    }
    const String fasta = getStringOption_("fasta");
    const String out_spectra = getStringOption_("out_spectra");

    FASTag::Param p;
    p.tag_length = getIntOption_("tag_length");
    p.max_extension = getIntOption_("extension");
    p.max_gaps = getIntOption_("gaps");
    p.deisotope = getFlag_("deisotope");
    p.peaks_per_window = getIntOption_("peaks_per_window");
    p.frag_tol = getDoubleOption_("fragment_tolerance");
    p.tol_ppm = getStringOption_("fragment_tolerance_unit") == "ppm";
    p.max_peak_count = static_cast<size_t>(getIntOption_("max_peaks"));
    p.max_tag_count = getIntOption_("max_tags");
    p.diversity = getFlag_("diversity");
    p.per_residue_conf = getFlag_("res_conf");
    p.max_evalue = getDoubleOption_("max_evalue");
    p.gap_penalty = getDoubleOption_("gap_penalty");
    resolveMods_(getStringList_("fixed_modifications"), false, p.mods);
    resolveMods_(getStringList_("variable_modifications"), true, p.mods);
    if (!p.mods.empty())
    {
      String summary;
      for (const auto& m : p.mods)
        summary += (summary.empty() ? "" : ", ") + m.name + " (" + String(m.residue) + ", "
                 + (m.variable ? "variable" : "fixed") + ")";
      OPENMS_LOG_INFO << "Modifications: " << summary << std::endl;
    }

    // Unconditional: the realised length bounds the null tables whether or not a
    // FASTA filter is in use.
    const int max_len = p.tag_length + 2 * p.max_extension;
    if (max_len > FASTag::MAX_FILTER_LEN)
    {
      OPENMS_LOG_ERROR << "Realised tag length can reach " << max_len << ", beyond the filter's "
                       << FASTag::MAX_FILTER_LEN << "-residue encoding." << std::endl;
      return ILLEGAL_PARAMETERS;
    }

    FASTag::FastaFilter filt(getStringOption_("orientation") == "both");
    FASTag::FastaFilter entrap(getStringOption_("orientation") == "both");
    const bool filtering = !fasta.empty();
    const String entrap_fasta = getStringOption_("entrapment_fasta");
    const bool entrap_on = !entrap_fasta.empty();
    if (entrap_on && !filtering)
    {
      OPENMS_LOG_ERROR << "-entrapment_fasta calibrates the -fasta filter; "
                          "give -fasta too." << std::endl;
      return ILLEGAL_PARAMETERS;
    }
    if (entrap_on
        && (getFlag_("species")
            || (!getStringOption_("taxdb").empty() && !getStringOption_("species_out").empty())))
    {
      OPENMS_LOG_ERROR << "-entrapment_fasta cannot be combined with -species: "
                          "entrapment matches are known-false calibration "
                          "material and would pollute the taxon evidence."
                       << std::endl;
      return ILLEGAL_PARAMETERS;
    }

    const String recon_out = getStringOption_("recon_out");
    const String delta_out = getStringOption_("delta_out");
    const bool recon_on = !recon_out.empty();
    if (!delta_out.empty() && !recon_on)
    {
      OPENMS_LOG_ERROR << "-delta_out requires -recon_out (the histogram is "
                          "aggregated over reconciliations)." << std::endl;
      return ILLEGAL_PARAMETERS;
    }
    FASTag::ProteomeIndex pindex;
    FASTag::TagReconciler recon(p.frag_tol, p.tol_ppm,
                                getStringOption_("orientation") == "both");
    if (recon_on)
    {
      String rfasta = getStringOption_("recon_fasta");
      if (rfasta.empty()) rfasta = fasta;
      if (rfasta.empty())
      {
        OPENMS_LOG_ERROR << "-recon_out needs a database: give -recon_fasta "
                            "(or -fasta)." << std::endl;
        return ILLEGAL_PARAMETERS;
      }
      std::vector<FASTAFile::FASTAEntry> rentries;
      FASTAFile().load(rfasta, rentries);
      std::vector<std::pair<char, double>> fixed_deltas;
      for (const auto& m : p.mods)
        if (!m.variable) fixed_deltas.emplace_back(m.residue, m.delta);
      pindex.build(rentries, fixed_deltas, getDoubleOption_("isobaric_tolerance"));
      int rmin = getIntOption_("recon_min_length");
      if (rmin == 0) rmin = pindex.autoMinLen();
      recon.attach(&pindex, getIntOption_("recon_missed_cleavages"), rmin);
      std::vector<FASTag::ModCandidate> cands;
      for (const auto& m : p.mods)
        if (m.variable) cands.push_back({m.name, m.delta, std::string(1, m.residue)});
      recon.setModCandidates(std::move(cands));
      OPENMS_LOG_INFO << "Recon index: " << pindex.proteinCount() << " proteins, "
                      << pindex.residueCount() << " residues, "
                      << pindex.collapseRuleCount() << " isobaric rules; min tag length "
                      << rmin << (getIntOption_("recon_min_length") == 0 ? " (derived)" : " (set)")
                      << std::endl;
    }

    if (stream_mode)
    {
      FILE* const dataf = stream_data_;  // the real stdout, sealed at entry
      const FASTag::Tables stables(p);
      const bool spf = getFlag_("proforma");
      const std::string spfx =
          spf ? buildProformaPrefix(getStringList_("fixed_modifications")) : std::string();
      std::fprintf(dataf, "spectrum\ttag\tlength\tcharge\tnterm_mass\tcterm_mass\textended"
                          "\tgapped\tevalue\tmin_conf\tmean_conf\tfasta_hit%s%s\n",
                   spf ? "\tproforma" : "", p.per_residue_conf ? "\tres_conf" : "");
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
            const auto tags = FASTag::tagSpectrum(spec, prec_mz, charge, p, stables);
            n = tags.size();
            for (const auto& t : tags)
              appendTagRow(buf, t, id, "-", spf, spfx, p.per_residue_conf);
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
          char idbuf[256] = {0};
          if (std::sscanf(line.c_str(), "spectrum %255s %lf %d", idbuf, &prec_mz, &charge) != 3
              || prec_mz <= 0)
          {
            id.clear();
            in_block = true;
            resync_error("bad header (want: spectrum <id> <precursor_mz> <charge>)");
            continue;
          }
          id = idbuf;
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
      const int floor_ = getIntOption_("min_filter_length");
      if (floor_ > 0) filt.setMinLen(floor_);
      const double iso = getDoubleOption_("isobaric_tolerance");
      if (iso > 0)
      {
        std::vector<std::pair<char, double>> fixed_deltas;
        for (const auto& m : p.mods)
          if (!m.variable) fixed_deltas.emplace_back(m.residue, m.delta);
        filt.deriveCollapses(iso, fixed_deltas);
      }
      filt.build(p.tag_length, max_len);
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
        const double iso2 = getDoubleOption_("isobaric_tolerance");
        if (iso2 > 0)
        {
          std::vector<std::pair<char, double>> fixed_deltas;
          for (const auto& m : p.mods)
            if (!m.variable) fixed_deltas.emplace_back(m.residue, m.delta);
          entrap.deriveCollapses(iso2, fixed_deltas);
        }
        entrap.build(p.tag_length, max_len);
        OPENMS_LOG_INFO << "Entrapment: " << entrap.sequenceCount() << " sequences, "
                        << entrap.residueCount() << " residues, "
                        << entrap.indexedKeys() << " keys" << std::endl;
      }
    }

    // Stream from disk rather than loading the run into memory.
    //
    // loadExperiment() reads the whole file into a PeakMap first: measured at
    // 7.1 GB peak RSS for a 5.3 GB mzML, with most of the wall time spent in that
    // single-threaded load. OnDiscMSExperiment reads one spectrum at a time from
    // an indexed mzML, so memory becomes O(threads) instead of O(file).
    //
    // It is documented as NOT thread-safe -- it holds an open stream -- so each
    // worker gets its own copy, exactly as the class comment prescribes. Falls
    // back to a full load when the file carries no index, since random access is
    // then impossible.
    // Skip the up-front metadata pass; each worker reads its own spectrum's
    // metadata from the block it already parses.
    //
    // openFile() otherwise calls loadMetaData_(), a fully serial parse of every
    // spectrum's metadata before any work starts -- ~55 s of a 60 s run on S23,
    // and the reason wall time stopped improving past 16 threads however many
    // cores it was given.
    //
    // REQUIRES a patched OpenMS. Stock MzMLSpectrumDecoder::domParseSpectrum()
    // fills the binary data and native ID only, so with skipMetaData every
    // spectrum has MS level 0 and no precursor and the run silently returns
    // nothing. The patch harvests MS level, RT and precursors from the DOM that
    // function already builds; verified identical to the canonical parser across
    // all 632,677 spectra of S23. Guarded below rather than assumed.
    //
    // -out_spectra still needs getMetaData() for the run-level settings, so that
    // path keeps the full load.
    // mzPeak is read through OnDiscMzPeakExperiment, the library-backed twin
    // of OnDiscMSExperiment below, so both formats feed the same loop. Decided
    // by extension, not by OpenMS's FileTypes: that enum has no MZPEAK outside
    // one feature branch, and the format now lives entirely in the external
    // library.
    //
    // Which writer -out_spectra gets is decided from ITS extension, not the
    // input's, so mzML->mzpeak and mzpeak->mzML both work as a side effect of
    // tagging.
    const auto has_ext = [](const String& p, const char* ext) {
      String lower(p);
      lower.toLower();  // mutates, so on a copy
      return lower.hasSuffix(ext);
    };
    const auto is_mzpeak = [&](const String& p) { return has_ext(p, ".mzpeak"); };
    const auto is_mzml = [&](const String& p) { return has_ext(p, ".mzml"); };
    if (!is_mzpeak(in) && !is_mzml(in))
    {
      OPENMS_LOG_ERROR << "Input '" << in << "' is neither .mzML nor .mzpeak." << std::endl;
      return ILLEGAL_PARAMETERS;
    }
    if (!out_spectra.empty() && !is_mzpeak(out_spectra) && !is_mzml(out_spectra))
    {
      OPENMS_LOG_ERROR << "-out_spectra '" << out_spectra
                       << "' must end in .mzML or .mzpeak." << std::endl;
      return ILLEGAL_PARAMETERS;
    }
    const bool mzpeak_in = is_mzpeak(in);
    const bool mzpeak_out = !out_spectra.empty() && is_mzpeak(out_spectra);
#ifndef FASTAG_HAVE_MZPEAK_LIB
    // Refuse up front, with the reason. The alternative -- OpenMS's own
    // MzPeakFile -- implemented the pre-0.7.0 layout and read every current
    // archive as zero spectra, so there is no fallback worth having.
    if (mzpeak_in || mzpeak_out)
    {
      OPENMS_LOG_ERROR << "This build has no mzPeak support: it was configured without "
                          "mzpeak-openms (-DMZPEAK_SOURCE_DIR=... -DMZPEAK_LIB_DIR=...; "
                          "see README). Supply mzML, or rebuild with the library."
                       << std::endl;
      return ILLEGAL_PARAMETERS;
    }
#endif

#ifdef FASTAG_HAVE_MZPEAK_LIB
    std::unique_ptr<FASTag::OnDiscMzPeakExperiment> mzp;
    if (mzpeak_in)
    {
      try
      {
        {
          const auto a = std::chrono::steady_clock::now();
          mzp = std::make_unique<FASTag::OnDiscMzPeakExperiment>(in);
          g_t_open = std::chrono::duration<double>(std::chrono::steady_clock::now() - a).count();
        }
      }
      catch (const Exception::BaseException& e)
      {
        OPENMS_LOG_ERROR << e.what() << std::endl;
        return INPUT_FILE_CORRUPT;
      }
    }
#endif
    // The fast mzML path: our own index-driven reader, which fills the
    // metadata OpenMS's per-spectrum decoder drops and so needs no up-front
    // metadata parse at all (see IndexedMzMLReader.h -- that parse is 4.0 s of
    // a 9.1 s run on a 1.8 GB file, serial and immune to -threads).
    //
    // Only when -out_spectra is off: writing needs run-level settings
    // (instrument, source files), which this reader deliberately does not
    // read, and getting them means the very pre-pass being avoided.
    //
    // Probed before it is trusted, exactly as the OnDiscMSExperiment path
    // below is: a reader reporting no MS2-with-precursor in the first 64
    // spectra is not used, so a file it cannot understand falls back instead
    // of producing a confident nothing.
    std::unique_ptr<FASTag::IndexedMzMLReader> fastmz;
    if (!mzpeak_in && out_spectra.empty())
    {
      auto candidate = std::make_unique<FASTag::IndexedMzMLReader>(in);
      if (candidate->ok() && candidate->reportsSpectrumMetadata()) fastmz = std::move(candidate);
    }

    // A pointer, not a value: the fallback below must replace this with a
    // genuinely fresh reader, and OnDiscMSExperiment's operator= is private
    // (copy-construction only), so an in-place reassignment isn't available.
    auto ondisc = std::make_unique<OnDiscMSExperiment>();
    PeakMap exp;
    const bool streaming = !mzpeak_in && !fastmz && ondisc->openFile(in, out_spectra.empty());
    // Spectrum i, whatever the input: the mzPeak reader, the per-spectrum mzML
    // reader, or the fully loaded map. For the SERIAL callers only; the
    // tagging loop gives each thread its own reader.
    auto read_spectrum = [&](Size i) -> MSSpectrum {
#ifdef FASTAG_HAVE_MZPEAK_LIB
      if (mzp) return mzp->getSpectrum(i);
#endif
      if (fastmz) return fastmz->getSpectrum(i);
      return streaming ? ondisc->getSpectrum(i) : exp[i];
    };
    if (!streaming && !mzpeak_in && !fastmz)
    {
      OPENMS_LOG_WARN << "'" << in << "' has no usable index; reading it entirely "
                         "into memory. Run FileConverter to write an indexed mzML "
                         "if the file is large." << std::endl;
      FileHandler().loadExperiment(in, exp, {FileTypes::MZML});
    }
    // Refuse to run blind on an unpatched OpenMS.
    //
    // Without the patch every spectrum comes back at MS level 1 (the
    // default-constructed value, never overwritten) with no precursor, so the
    // MS2 test rejects all of them and the tool reports a clean run with an
    // empty output file. That is the worst possible failure -- indistinguishable
    // from a file that genuinely holds no MS2 -- so probe for it and take the
    // slow path instead of producing a confident nothing.
    //
    // The probe checks for level 2 WITH a precursor -- what tag_one() actually
    // requires -- not merely "level > 0". A bare ">0" is satisfied by the very
    // default this guard exists to catch (level 1 is > 0), so it passed on
    // spectrum 0 of every file regardless of what the reader actually reported,
    // and the fallback never engaged. Confirmed against a real 617 MB Thermo
    // file built with stock bioconda OpenMS: every spectrum read back at level 1
    // through the fast path, 0 of 53,521 MS2 spectra found, no warning printed.
    if (streaming && out_spectra.empty() && !mzpeak_in && !fastmz)
    {
      bool have_meta = false;
      const Size probe = std::min<Size>(ondisc->getNrSpectra(), 64);
      for (Size i = 0; i < probe && !have_meta; ++i)
      {
        const MSSpectrum s = ondisc->getSpectrum(i);
        if (s.getMSLevel() == 2 && !s.getPrecursors().empty()) have_meta = true;
      }
      if (!have_meta && probe > 0)
      {
        OPENMS_LOG_WARN << "This OpenMS does not report spectrum metadata from the "
                           "per-spectrum reader, so the fast path is unavailable; "
                           "loading metadata up front instead. Expect roughly a "
                           "minute of extra single-threaded startup on a large file."
                        << std::endl;
        // A fresh instance, not a second openFile() on this one: calling
        // openFile() again on the SAME OnDiscMSExperiment crashed (EXC_BAD_ACCESS
        // inside MSSpectrum's copy constructor, reached via getSpectrum()) on the
        // same real file this whole guard exists for -- this fallback had never
        // actually run before, since the old ">0" probe never triggered it.
        ondisc = std::make_unique<OnDiscMSExperiment>();
        ondisc->openFile(in);
      }
    }
    size_t n_total = streaming ? ondisc->getNrSpectra() : exp.size();
#ifdef FASTAG_HAVE_MZPEAK_LIB
    if (mzp) n_total = mzp->getNrSpectra();
#endif
    if (fastmz) n_total = fastmz->getNrSpectra();

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
      size_t sel = 0; for (char c : sample_mask) sel += c ? 1 : 0;
      OPENMS_LOG_INFO << "Subsampling: tagging " << sel << " of " << n_total
                      << " input spectra (seed " << subsample_seed << ")" << std::endl;
    }

#ifdef FASTAG_HAVE_MZPEAK_LIB
    size_t picked_before_loop = 0;  // the probe below re-picks what it samples
#endif
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
    {
      double tightest = std::numeric_limits<double>::max();
      double at_mz = 0;
      // 64 samples, not 200. The test is coarse (does the tightest spacing
      // anywhere exceed 20x the tolerance?), and every sample costs a read --
      // on a profile archive it costs a CENTROIDING too, and consecutive
      // sampling hits far more MS2 than the old strided one did, which made
      // 200 samples 0.16 s of a 0.67 s run.
      const Size want = std::min<Size>(n_total, 64);
      // Sampled in a few CLUSTERS of consecutive spectra, not strided across
      // the whole run.
      //
      // Striding cost more than the tagging it precedes. A columnar reader
      // decodes a whole row group to reach one spectrum, and 200 evenly
      // spaced indices land in ~200 different groups, so the probe decoded
      // the entire archive single-threaded before any tagging started: 2.8 s
      // of a 5.1 s run on an 874 MB archive. Clusters touch a handful of
      // groups instead, and cost nothing on mzML either (fewer, more local
      // reads). Several clusters rather than one because a run changes over
      // its gradient, and the probe is looking for the file's TIGHTEST peak
      // spacing, not a typical one.
      constexpr Size kClusters = 8;  // 8 spectra each
      const Size per_cluster = std::max<Size>(1, want / kClusters);
      const Size cluster_step = std::max<Size>(1, n_total / kClusters);
      Size seen = 0;
      for (Size c = 0; c < kClusters && seen < want; ++c)
      {
        const Size start = c * cluster_step;
        for (Size k = 0; k < per_cluster && start + k < n_total && seen < want; ++k)
        {
          MSSpectrum s = read_spectrum(start + k);
          if (s.getMSLevel() != 2 || s.size() < 8) continue;
          ++seen;
          s.sortByPosition();
          for (Size j = 1; j < s.size(); ++j)
          {
            const double d = s[j].getMZ() - s[j - 1].getMZ();
            if (d > 0 && d < tightest) { tightest = d; at_mz = s[j].getMZ(); }
          }
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
    }

    const FASTag::Tables tables(p);
    std::ofstream tsv(out.c_str());
    if (!tsv)
    {
      OPENMS_LOG_ERROR << "Cannot open output file " << out << " for writing." << std::endl;
      return CANNOT_WRITE_OUTPUT_FILE;
    }
    const bool want_proforma = getFlag_("proforma");
    tsv << "spectrum\ttag\tlength\tcharge\tnterm_mass\tcterm_mass\textended\tgapped\tevalue\tmin_conf\tmean_conf\tfasta_hit"
        << (want_proforma ? "\tproforma" : "") << (p.per_residue_conf ? "\tres_conf" : "") << "\n";

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
              "\tdelta_mass\tregion\tdelta_interp\n";
    }

    const bool glyco_on = getFlag_("glyco");
    String glyco_out = getStringOption_("glyco_out");
    std::ofstream gtsv;
    if (glyco_on)
    {
      if (glyco_out.empty())
      {
        const size_t gslash = out.find_last_of("/\\");
        const size_t gdot = out.rfind('.');
        const bool gext = gdot != std::string::npos && (gslash == std::string::npos || gdot > gslash);
        glyco_out = (gext ? out.substr(0, gdot) : out) + ".glyco.tsv";
      }
      gtsv.open(glyco_out.c_str());
      if (!gtsv)
      {
        OPENMS_LOG_ERROR << "Cannot open output file " << glyco_out << " for writing." << std::endl;
        return CANNOT_WRITE_OUTPUT_FILE;
      }
      gtsv << "spectrum\tn_oxonium\toxonium_frac\tglyco\tions\n";
    }

    const std::string proforma_fixed =
        want_proforma ? buildProformaPrefix(getStringList_("fixed_modifications")) : std::string();

    PeakMap kept;
#ifdef FASTAG_HAVE_MZPEAK_LIB
    if (mzp) picked_before_loop = mzp->nPicked();
    if (mzp) kept.getExperimentalSettings() = mzp->getMetaData();
    else
#endif
    if (streaming)
    {
      if (auto meta = ondisc->getMetaData()) kept.getExperimentalSettings() = *meta;
    }
    else kept.getExperimentalSettings() = exp.getExperimentalSettings();

    size_t n_ms2 = 0, n_tags = 0, n_reported = 0;
    size_t n_glyco = 0, n_glyco_scanned = 0;
    std::map<int, std::pair<size_t, size_t>> by_len;   // length -> (seen, matched)

    // Parallel over spectra, which is the only safe level: each spectrum is
    // independent, `tables` and `filt` are immutable once built, and per-spectrum
    // work is ~60 us -- far too little to amortise a fork/join inside the tagger.
    //
    // Results are collected per BLOCK of spectra and written in input order as
    // each block finishes, so the output is identical whatever -threads is set
    // to while TSV memory stays bounded by the block, not the run. 64k spectra
    // x ~100 bytes/row is a few MB; the old whole-run buffer held every row of
    // a 5 GB file at once.
    const SignedSize n_spec = static_cast<SignedSize>(n_total);
    constexpr size_t BLOCK = 65536;
    std::vector<std::string> rows;
    std::vector<std::string> rrows;  ///< block-local recon rows (recon_on only)
    std::vector<std::string> grows;  ///< block-local glyco rows (glyco_on only)
    // Two-pass -out_spectra, whatever the formats: record kept INPUT indices
    // during tagging, re-read them at the end. An mzML output streams them
    // through a writing consumer, O(1 spectrum); an mzPeak output re-reads
    // them into memory, O(kept), because the library writer takes a whole run.
    // Every reader here is indexed, so nothing is held during tagging.
    const bool want_out = !out_spectra.empty();
    std::vector<Size> kept_idx;
    std::vector<char> keep_target;
    size_t block_base = 0;
    std::vector<char> keep;
    std::vector<std::map<int, std::pair<size_t, size_t>>> per_thread_len(
        static_cast<size_t>(std::max(1, omp_get_max_threads())));
    std::vector<size_t> per_thread_ms2(per_thread_len.size(), 0),
                        per_thread_tags(per_thread_len.size(), 0),
                        per_thread_rep(per_thread_len.size(), 0);

    // The per-spectrum work, shared by every input path.
    //
    // Takes its thread id rather than calling omp_get_thread_num() internally,
    // and returns its rows rather than writing them: the caller owns where a
    // result lands. That is what lets a second input path reuse this without the
    // two drifting apart, which is the failure mode that matters here -- two
    // readers that mostly agree are worse than one.
    //
    // Callers must not resize rows/keep while this runs.
    //
    // Returns the tag rows and (when -recon_out) the reconciliation rows for
    // one spectrum, as strings the caller places by index -- one result type
    // so the two files can never desynchronize their ordering discipline.
    struct SpecResult
    {
      std::string buf, rbuf;
      /// Per reported row, in row order: (evalue, is_entrapment) -- the
      /// material the q_db post-pass consumes without ever reparsing a
      /// serialized %g evalue back off the TSV.
      std::vector<std::pair<double, bool>> meta;
      bool any_target = false;  ///< at least one non-entrapment reported tag
    };
    // Entrapment-calibration accumulators (entrap_on only): target E-values,
    // and entrapment E-values with their tag length -- the key spaces are
    // per-length, so each entrapment event is weighted by 1/r_len later.
    std::vector<std::vector<double>> pt_target_e(per_thread_len.size());
    std::vector<std::vector<std::pair<double, int>>> pt_entrap_e(per_thread_len.size());
    // -delta_out accumulators: one (delta, interp) sample per spectrum -- the
    // best-E-value tag's smallest-|delta| placement -- so 50 correlated tags
    // cannot flood a bin. Clamped-flank placements are excluded and counted:
    // a flank clamped to 0 (FASTagger's max(0,.)) makes its delta bogus.
    std::vector<std::vector<std::pair<double, std::string>>> per_thread_delta(per_thread_len.size());
    std::vector<size_t> per_thread_delta_clamped(per_thread_len.size(), 0);

    auto tag_one = [&](const MSSpectrum& spec, size_t tid) -> SpecResult
    {
      SpecResult res;
      std::string& buf = res.buf;
      if (spec.getMSLevel() != 2 || spec.empty() || spec.getPrecursors().empty()) return res;
      ++per_thread_ms2[tid];

      const auto& prec = spec.getPrecursors().front();
      const auto tags = FASTag::tagSpectrum(spec, prec.getMZ(), prec.getCharge(), p, tables);
      per_thread_tags[tid] += tags.size();

      // Reserve once so the per-field appends below do not repeatedly realloc.
      // ~80 bytes/row covers the fixed columns and a typical native ID; the
      // append path just grows past it for the rare long one.
      buf.reserve(tags.size() * 80);
      bool delta_done = false;  // one -delta_out sample per spectrum

      for (const auto& t : tags)
      {
        const char* hit = "-";
        bool row_entrap = false;
        if (filtering)
        {
          ++per_thread_len[tid][static_cast<int>(t.n_res)].first;
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
            pt_entrap_e[tid].emplace_back(t.evalue, static_cast<int>(t.n_res));
          }
          else
          {
            ++per_thread_len[tid][static_cast<int>(t.n_res)].second;
            // A reverse-only match identifies the ion series: the tag was read off
            // the b series, so its flanking masses carry a one-water offset.
            hit = (h == FASTag::FastaFilter::Hit::Forward) ? "fwd" : "rev";
            if (entrap_on) pt_target_e[tid].push_back(t.evalue);
          }
        }
        if (!row_entrap) res.any_target = true;
        if (entrap_on) res.meta.emplace_back(t.evalue, row_entrap);
        ++per_thread_rep[tid];

        appendTagRow(buf, t, spec.getNativeID(), hit, want_proforma, proforma_fixed,
                     p.per_residue_conf);

        if (recon_on && !row_entrap)  // known-false rows must not place or bin
        {
          const auto places = recon.reconcile(FASTag::baseSequence(t.seq),
                                              t.nterm_mass, t.cterm_mass);
          for (const auto& pl : places)
          {
            std::string prot = pl.protein;
            for (char& ch : prot) if (ch == '\t' || ch == '\n' || ch == '\r') ch = ' ';
            res.rbuf += spec.getNativeID(); res.rbuf += '\t';
            res.rbuf += t.seq;             res.rbuf += '\t';
            res.rbuf += prot;              res.rbuf += '\t';
            res.rbuf += pl.peptide;        res.rbuf += '\t';
            char rnum[64];
            std::snprintf(rnum, sizeof rnum, "%zu\t%d\t%d\t%d\t%.4f\t",
                          pl.pos, pl.reversed ? 1 : 0, pl.nterm_match ? 1 : 0,
                          pl.cterm_match ? 1 : 0, pl.delta_mass);
            res.rbuf += rnum;
            if (pl.region_hi >= pl.region_lo)
            {
              std::snprintf(rnum, sizeof rnum, "%d-%d", pl.region_lo, pl.region_hi);
              res.rbuf += rnum;
            }
            res.rbuf += '\t';
            res.rbuf += pl.delta_interp;
            res.rbuf += '\n';
          }
          // The spectrum's -delta_out sample: this is the best-E-value tag
          // (tags arrive sorted best first) -- take its min-|delta| placement.
          if (!delta_out.empty() && !places.empty() && !delta_done)
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
            const bool clamped_side =
                std::fabs(best->delta_mass) > 1e-6 && side_flank == 0.0;
            if (clamped_side) ++per_thread_delta_clamped[tid];
            else per_thread_delta[tid].emplace_back(best->delta_mass, best->delta_interp);
            delta_done = true;
          }
        }
      }
      return res;
    };

    // Record one spectrum's result at its BLOCK-LOCAL index. Serial or
    // parallel: the index is the caller's, so output order never depends on
    // scheduling.
    // Per-row (evalue, is_entrapment) in FILE order, appended block by block
    // in write_block -- the q_db post-pass walks the written TSV and this
    // vector in lockstep. ~17 bytes/row; a 13 M-row HeLa run is ~220 MB,
    // which is the honest cost of a whole-run calibration curve.
    std::vector<std::pair<double, bool>> row_meta;
    std::vector<std::vector<std::pair<double, bool>>> rmeta_blk;

    auto record = [&](size_t idx, SpecResult&& r, const MSSpectrum& spec)
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
        const auto g = FASTag::scanOxonium(*sp, p.frag_tol, p.tol_ppm,
                                           getDoubleOption_("glyco_min_fraction"));
        char gnum[64];
        std::snprintf(gnum, sizeof gnum, "\t%d\t%.3f\t%d\t", g.n_matched, g.frac,
                      g.glyco ? 1 : 0);
        grows[idx] = spec.getNativeID();
        grows[idx] += gnum;
        grows[idx] += g.ions;
        grows[idx] += '\n';
      }
      if (r.buf.empty()) return;  // rbuf is only ever non-empty alongside buf
      rows[idx].swap(r.buf);
      if (recon_on) rrows[idx].swap(r.rbuf);
      if (entrap_on) rmeta_blk[idx].swap(r.meta);
      keep[idx] = 1;
      // A spectrum whose only reported tags are entrapment matches is
      // calibration material, not a hit -- keep it out of -out_spectra.
      if (want_out) keep_target[idx] = r.any_target ? 1 : 0;
    };

    // Size the block buffers (capacity is recycled across blocks) and reset
    // the keep flags. Callers must not resize rows/keep while a parallel block
    // runs.
    auto prep_block = [&](size_t n_used)
    {
      if (rows.size() < n_used)
      {
        rows.resize(n_used);
        if (recon_on) rrows.resize(n_used);
        if (glyco_on) grows.resize(n_used);
        if (entrap_on) rmeta_blk.resize(n_used);
      }
      keep.assign(n_used, 0);
      if (want_out) keep_target.assign(n_used, 0);
    };

    // -species consumes (spectrum id, tag) pairs from the REPORTED rows. They
    // were once re-parsed from the whole-run row buffer after the loop; the
    // rows are recycled per block now, so the pairs are collected here, where
    // each row is written. id + tag is far smaller than the full rows.
    const bool want_species = getFlag_("species")
        || (!getStringOption_("taxdb").empty() && !getStringOption_("species_out").empty());
    std::map<std::string, std::vector<std::string>> by_spec;

    // Write one finished block's rows in index order and recycle the buffers.
    // Kept spectra still accumulate for the whole run: MzMLFile::store writes
    // one map at the end, and -out_spectra is opt-in.
    auto write_block = [&](size_t n_used)
    {
      for (size_t i = 0; i < n_used; ++i)
      {
        if (glyco_on && !grows[i].empty())
        {
          gtsv << grows[i];
          // 4th field is the 0/1 flag; count flagged spectra for the summary.
          size_t tp = grows[i].find('\t');
          for (int f = 0; f < 2 && tp != std::string::npos; ++f)
            tp = grows[i].find('\t', tp + 1);
          if (tp != std::string::npos && grows[i].compare(tp + 1, 1, "1") == 0) ++n_glyco;
          ++n_glyco_scanned;
          grows[i].clear();
        }
        if (!keep[i]) continue;
        tsv << rows[i];
        if (recon_on && !rrows[i].empty()) { rtsv << rrows[i]; rrows[i].clear(); }
        if (entrap_on)
        {
          row_meta.insert(row_meta.end(), rmeta_blk[i].begin(), rmeta_blk[i].end());
          rmeta_blk[i].clear();
        }
        if (want_species)
        {
          // Field 0 = spectrum id, field 1 = tag, per line.
          const std::string& r = rows[i];
          size_t start = 0;
          while (start < r.size())
          {
            size_t nl = r.find('\n', start);
            if (nl == std::string::npos) nl = r.size();
            size_t t1 = r.find('\t', start);
            if (t1 != std::string::npos && t1 < nl)
            {
              size_t t2 = r.find('\t', t1 + 1);
              if (t2 != std::string::npos && t2 <= nl)
                by_spec[r.substr(start, t1 - start)].push_back(r.substr(t1 + 1, t2 - t1 - 1));
            }
            start = nl + 1;
          }
        }
        rows[i].clear();
        if (want_out && keep_target[i]) kept_idx.push_back(static_cast<Size>(block_base + i));
      }
    };

    // Progress reporting (opt-in via -progress), shared across both input paths.
    // One atomic counter; the single thread that observes each step boundary
    // emits one line under a critical section, so lines never interleave.
    const bool emit_progress = getFlag_("progress");
    std::atomic<long long> progress_done{0};
    std::atomic<long long> progress_total{static_cast<long long>(n_spec)};
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
    // Percent alone goes quiet for minutes on a slow file (one 5 GB run spends
    // ~a minute in metadata before the first spectrum), which reads as a hung
    // GUI; a pure time interval spams a fast run. Together the line rate is
    // bounded by ~101 + elapsed/5s regardless of file size or speed.
    auto tick = [&]()
    {
      if (!emit_progress) return;
      const long long d = ++progress_done;
      const long long tot = progress_total.load(std::memory_order_relaxed);
      const int pct = tot > 0 ? static_cast<int>((d * 100) / tot) : -1;
      // 100% is NOT emitted here. The loop finishing is not the tool finishing --
      // species classification and -out_spectra still run -- so the completion
      // line is reserved for the end of main_(). Without this the last percent
      // and the completion line print the same text twice.
      bool want = (d == 1) || (pct < 100 && pct > progress_pct.load(std::memory_order_relaxed));
      // The clock is consulted only every 64th spectrum: the time rule exists for
      // SLOW runs, where 64 spectra is a rounding error, and this keeps the hot
      // path free of a clock read per spectrum.
      // The clock is read on EVERY tick, not one in 64. Sampling made the
      // advertised 5 s guarantee false exactly where it matters: at one
      // spectrum per second the gap became ~63 s, and a single slow spectrum
      // produced no heartbeat at all. steady_clock::now() is tens of
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
        const long long tt = progress_total.load();
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

    // EVERY thread reads and tags. The two used to be one number: readers were
    // capped so that two row groups per reader fit the cache budget, and the
    // budget was then re-sized to that reader count -- so memory grew with the
    // thread count, and capping readers capped tagging with them.
    //
    // The cache now ADMITS decodes against its budget (a decode waits when the
    // bytes already in flight leave no room), so peak memory follows the
    // budget and not the thread count. That decouples the two: the budget is
    // sized to the ARCHIVE, tagging gets every core, and reading self-limits
    // to as many concurrent decodes as the budget allows.
    //
    // A FIXED number of resident row groups, NOT one that scales with -threads.
    // The budget used to scale because in-flight groups were unevictable and
    // each reader pinned its own, so memory grew whether or not it bought
    // anything. Admission control removed that, and a sweep on a 363-group
    // archive then showed the optimum is thread-INDEPENDENT -- 1 GB won at
    // both thread counts (wall time, 9.07 GB / 762,016 spectra):
    //
    //    64 threads:  256 MB 17.7 s | 512 MB 10.7 s | 1 GB 10.9 s | 4 GB 11.6 s
    //   192 threads:  256 MB 14.4 s | 512 MB 12.9 s | 1 GB 12.7 s | 4 GB 13.3 s
    //
    // Too small thrashes -- 256 MB cost 2,653 decodes over 363 groups -- and
    // too large just holds memory: 4 GB was slower than 1 GB at both counts.
    // 64 groups lands on that optimum for this archive's 20 MB groups and
    // beats v1.2.1 on wall AND memory at 192 threads (12.7 s / 8.1 GB against
    // 13.9 s / 8.7 GB). -mzpeak_read_memory overrides it.
    //
    // Sized in DECODED bytes, which is what maxRowGroupBytes() now reports and
    // what the cache charges. The two were briefly in different units, and the
    // budget then silently meant 4.4x what it said.
    const int read_threads = std::max(1, omp_get_max_threads());
    constexpr size_t kResidentGroups = 64;
#ifdef FASTAG_HAVE_MZPEAK_LIB
    if (mzp && mzp->maxRowGroupBytes() > 0)
    {
      const auto requested = static_cast<size_t>(getIntOption_("mzpeak_read_memory"));
      mzp->setCacheBudget(requested > 0
                              ? requested << 20
                              : std::min<size_t>(mzp->cacheBudget(),
                                                 kResidentGroups * mzp->maxRowGroupBytes()));
    }
#endif

    // FASTAG_TIMING=1 breaks the run into phases on stderr. Diagnostic only:
    // wall time that no phase claims is the thing worth chasing, and guessing
    // at that split has been wrong twice already in this file's history.
    // ponytail: steady_clock and four doubles, not a profiler dependency.
    const bool timing = std::getenv("FASTAG_TIMING") != nullptr;
    using Clock = std::chrono::steady_clock;
    const auto t_loop_start = Clock::now();
    double t_readers = 0, t_prep = 0, t_parallel = 0, t_write = 0;
    auto secs = [](Clock::time_point a, Clock::time_point b)
    { return std::chrono::duration<double>(b - a).count(); };

    // The READERS are built once per thread, before the loop; the parallel
    // region still opens and closes per block.
    //
    // Building an mzPeak reader costs 3.83 ms and is SERIALIZED: index.spectra()
    // re-opens five Parquet members -- a zip_open over the archive's central
    // directory plus a footer parse each, and the peaks footer alone describes
    // 363 row groups -- under a process-global mutex. Building them inside the
    // region paid that BLOCKS x THREADS times: 12 x 192 = 2,304 constructions,
    // 12.7 s of a 16 s run, GROWING with -threads, which is why mzPeak got
    // slower above 64 threads while mzML kept scaling. Measured on the
    // benchmark archive at 192 threads: 12.69 s of startup -> 4.91 s.
    //
    // Hoisting the REGION as well was tried and reverted. It removed the same
    // constructions, but left 191 threads spinning on the barriers around the
    // serial write_block instead of parked outside a closed region: +344 CPU
    // seconds at 192 threads, and the spinners stole enough bandwidth from the
    // writing thread to eat the entire startup saving (16.01 s -> 15.22 s).
    // Threads must not be inside a region while one of them writes a block.
    std::vector<std::unique_ptr<OnDiscMSExperiment>> readers(read_threads);
    std::vector<std::unique_ptr<FASTag::IndexedMzMLReader>> freaders(read_threads);
#ifdef FASTAG_HAVE_MZPEAK_LIB
    std::vector<std::unique_ptr<FASTag::OnDiscMzPeakExperiment>> mreaders(read_threads);
#endif
    const auto t_readers_a = Clock::now();
    for (int t = 0; t < read_threads; ++t)
    {
      // Copy-constructed, not assigned: OnDiscMSExperiment's operator= is
      // private. Each copy keeps its own open streams and is used by one
      // thread only, which is what both readers document as required.
      if (streaming) readers[t] = std::make_unique<OnDiscMSExperiment>(*ondisc);
      if (fastmz) freaders[t] = std::make_unique<FASTag::IndexedMzMLReader>(*fastmz);
#ifdef FASTAG_HAVE_MZPEAK_LIB
      if (mzp) mreaders[t] = std::make_unique<FASTag::OnDiscMzPeakExperiment>(*mzp);
#endif
    }
    t_readers = secs(t_readers_a, Clock::now());

    // Serial over blocks, parallel within each: a block's rows hit the disk
    // before the next block starts.
    for (SignedSize base = 0; base < n_spec; base += static_cast<SignedSize>(BLOCK))
    {
      const SignedSize lim = std::min(n_spec, base + static_cast<SignedSize>(BLOCK));
      block_base = static_cast<size_t>(base);
      const auto t_prep_a = Clock::now();
      prep_block(static_cast<size_t>(lim - base));
      const auto t_par_a = Clock::now();
      t_prep += secs(t_prep_a, t_par_a);
#pragma omp parallel num_threads(read_threads)
      {
        const size_t tid = static_cast<size_t>(omp_get_thread_num());
        OnDiscMSExperiment* reader = readers[tid].get();
        FASTag::IndexedMzMLReader* freader = freaders[tid].get();
#ifdef FASTAG_HAVE_MZPEAK_LIB
        FASTag::OnDiscMzPeakExperiment* mreader = mreaders[tid].get();
#endif
        auto work = [&](SignedSize i)
        {
          if (!sample_mask.empty() && !sample_mask[static_cast<size_t>(i)]) { tick(); return; }
          MSSpectrum loaded;
          bool loaded_here = false;
#ifdef FASTAG_HAVE_MZPEAK_LIB
          if (mreader) { loaded = mreader->getSpectrum(static_cast<Size>(i)); loaded_here = true; }
#endif
          if (!loaded_here && freader) { loaded = freader->getSpectrum(static_cast<Size>(i)); loaded_here = true; }
          if (!loaded_here && reader) { loaded = reader->getSpectrum(static_cast<Size>(i)); loaded_here = true; }
          const MSSpectrum& spec = loaded_here ? loaded : exp[static_cast<Size>(i)];
          record(static_cast<size_t>(i - base), tag_one(spec, tid), spec);
          tick();
        };
        // One schedule for both formats: dynamic, in chunks.
        //
        // A static split is the wrong shape: it hands every thread the same
        // COUNT of spectra, which cost different amounts, so the fast threads
        // sat in the join barrier (measured: 24% of all samples blocked).
        // Dynamic chunks let a thread that finishes early take more.
        //
        // GUIDED, not a fixed chunk: it hands out large pieces first and
        // small ones at the end, which is exactly the shape wanted here.
        // Large early chunks keep each thread inside one row group, so the
        // shared decode cache holds few groups at once; the shrinking tail is
        // what stops the fast threads waiting in the join barrier. A fixed
        // 256-spectrum chunk balanced the tail but fragmented the start, and
        // cost 17% on a small profile archive.
        constexpr SignedSize kMinChunk = 64;
#pragma omp for schedule(guided, kMinChunk)
        for (SignedSize i = base; i < lim; ++i) work(i);
      }
      const auto t_write_a = Clock::now();
      t_parallel += secs(t_par_a, t_write_a);
      write_block(static_cast<size_t>(lim - base));
      t_write += secs(t_write_a, Clock::now());
    }
    if (timing)
    {
      const double total = secs(t_loop_start, Clock::now());
      std::cerr << "FASTAG_TIMING open=" << g_t_open
                << " pre_loop=" << secs(g_t_program, t_loop_start)
                << " readers=" << t_readers << " prep=" << t_prep
                << " parallel=" << t_parallel << " write=" << t_write
                << " loop_total=" << total
                << " unaccounted_in_loop="
                << (total - t_readers - t_prep - t_parallel - t_write)
                << " since_program_start=" << secs(g_t_program, Clock::now());
#ifdef FASTAG_HAVE_MZPEAK_LIB
      if (mzp)
      {
        long evals = 0, batches = 0, slices = 0;
        mzp->readCounters(evals, batches, slices);
        std::cerr << " cache_calls=" << mzp->cacheCalls()
                  << " plan_group_evals=" << evals
                  << " batches_visited=" << batches
                  << " slices_made=" << slices;
        long pruned = 0, fscan = 0, pidx = 0, pinull = 0, nranges = 0, rrows = 0;
        mzp->planCounters(pruned, fscan, pidx, pinull, nranges, rrows);
        std::cerr << " plan_pruned=" << pruned << " plan_full_scan=" << fscan
                  << " plan_page_index=" << pidx << " plan_pi_null=" << pinull
                  << " plan_ranges=" << nranges << " plan_range_rows=" << rrows;
      }
#endif
      std::cerr << std::endl;
    }
#ifdef FASTAG_HAVE_MZPEAK_LIB
    // Once, at the end. Profile MS2 is a property of the archive the user
    // cannot see and would otherwise only notice as an unexplained tag count.
    if (mzp && mzp->nPicked() > picked_before_loop)
    {
      OPENMS_LOG_INFO << "mzPeak: centroided " << (mzp->nPicked() - picked_before_loop)
                      << " profile spectra on read"
                      << (mzp->nPickFailed() > 0
                            ? " (" + String(mzp->nPickFailed()) + " kept as profile: picking yielded nothing)"
                            : "")
                      << std::endl;
    }
    // One decode per group is the whole point of the shared cache; say what it
    // cost so a regression to per-thread decoding would be visible in a log.
    if (mzp)
    {
      OPENMS_LOG_INFO << "mzPeak: decoded " << mzp->rowGroupsDecoded() << " row groups once for "
                      << read_threads << " reader thread" << (read_threads == 1 ? "" : "s")
                      << ", cache budget " << (mzp->cacheBudget() >> 20) << " MB" << std::endl;
    }
#endif

    // Land the bar on 100%.
    //
    // The denominator can be an upper bound the run never reaches: for mzPeak it
    // comes from setExpectedSize(), which counts every spectrum the file's
    // metadata describes, while the reader delivers only those with point data
    // (42,092 of 53,521 on a real Lumos run -- the bar would stop at 79%).
    // Emitting done==total once at the end costs one line and avoids a GUI that
    // sits at four-fifths on a finished run.
    // NOTE: this is deliberately NOT the completion line. It reports that the
    // TAGGING LOOP finished; species classification and -out_spectra can still
    // run for many seconds after it, and an earlier version emitted 100% here
    // and then kept working -- or emitted 100% and then returned an error. The
    // real completion line is at the end of main_().
    if (false)
    {
      // Skipped when the loop already reported 100%, which the indexed path
      // does via its d == total case -- otherwise every mzML run ends with the
      // same line twice.
      //
      // total is the LARGER of what was announced and what was delivered, never
      // the delivered count alone. The mzPeak reader announces every spectrum in
      // the file but delivers only those with point data (42,092 of 53,521), and
      // rewriting total downwards made it non-monotonic -- a consumer could not
      // tell "the reader skipped some" from "the total was always smaller".
      const long long dd = progress_done.load();
      const long long tt = std::max(dd, progress_total.load());
      std::cerr << "FASTAG_PROGRESS done=" << tt << " total=" << tt << std::endl;
    }

    for (size_t t = 0; t < per_thread_len.size(); ++t)
    {
      n_ms2 += per_thread_ms2[t];
      n_tags += per_thread_tags[t];
      n_reported += per_thread_rep[t];
      for (const auto& kv : per_thread_len[t])
      {
        by_len[kv.first].first += kv.second.first;
        by_len[kv.first].second += kv.second.second;
      }
    }
    tsv.flush();
    if (!tsv)
    {
      OPENMS_LOG_ERROR << "Failed writing " << out << " (disk full?)." << std::endl;
      return CANNOT_WRITE_OUTPUT_FILE;
    }
    tsv.close();
    if (tsv.fail())
    {
      OPENMS_LOG_ERROR << "Failed writing " << out << " (disk full?)." << std::endl;
      return CANNOT_WRITE_OUTPUT_FILE;
    }

    // ---- q_db: entrapment-calibrated false-match q-values ----------------
    //
    // Post-pass over the finished TSV: build the weighted target/decoy curve
    // from the in-memory E-values (never reparsing the serialized %g values),
    // then stream-rewrite <out> appending the q_db column. Atomic via rename.
    if (entrap_on)
    {
      std::vector<double> target_e;
      std::vector<std::pair<double, int>> entrap_e;
      for (size_t t = 0; t < pt_target_e.size(); ++t)
      {
        target_e.insert(target_e.end(), pt_target_e[t].begin(), pt_target_e[t].end());
        entrap_e.insert(entrap_e.end(), pt_entrap_e[t].begin(), pt_entrap_e[t].end());
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
      if (!entrap_e.empty() && wdecoys.empty())
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

      const String tmp = out + ".qtmp";
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
        // platform; C rename() refuses to on Windows, which killed the
        // feature there.
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
      OPENMS_LOG_INFO << "q_db calibration envelope (measured 2026-09, "
                         "doc/F4-CALIBRATION-AUDIT.md): conservative at q_db <= 0.02; "
                         "UNDERESTIMATES the false-match rate ~1.6x at 0.05-0.1. Use "
                         "tight thresholds, and read q_db as DB-match spuriousness, "
                         "never as read correctness." << std::endl;
    }

    if (glyco_on)
    {
      gtsv.flush();
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

    if (recon_on)
    {
      rtsv.flush();
      rtsv.close();
      if (rtsv.fail())
      {
        OPENMS_LOG_ERROR << "Failed writing " << recon_out << " (disk full?)." << std::endl;
        return CANNOT_WRITE_OUTPUT_FILE;
      }

      // -delta_out: aggregate the per-spectrum samples into a histogram.
      // 0.0005 Da bins, adjacent-bin local-max grouping into peaks; each row
      // reports the peak center, its spectrum count, and the most frequent
      // interpretations. Candidates, not identifications -- the README says so.
      if (!delta_out.empty())
      {
        std::map<int64_t, std::pair<uint64_t, std::map<std::string, uint64_t>>> bins;
        size_t clamped = 0, samples = 0;
        for (size_t t = 0; t < per_thread_delta.size(); ++t)
        {
          clamped += per_thread_delta_clamped[t];
          for (const auto& d : per_thread_delta[t])
          {
            ++samples;
            auto& b = bins[static_cast<int64_t>(std::llround(d.first / 0.0005))];
            ++b.first;
            if (!d.second.empty()) ++b.second[d.second];
          }
        }
        // Local-max grouping: a bin whose count is not exceeded by either
        // neighbor becomes a peak and absorbs its (strictly smaller) neighbors.
        std::ofstream dtsv(delta_out.c_str());
        if (!dtsv)
        {
          OPENMS_LOG_ERROR << "Cannot open output file " << delta_out << " for writing." << std::endl;
          return CANNOT_WRITE_OUTPUT_FILE;
        }
        dtsv << "delta\tspectra\ttop_interps\n";
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
          for (auto* nb : {lo != bins.end() ? &*lo : nullptr, hi != bins.end() ? &*hi : nullptr})
            if (nb && nb->second.first < kv.second.first)
            {
              count += nb->second.first;
              for (const auto& ip : nb->second.second) interps[ip.first] += ip.second;
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
          dtsv << dnum;
          for (size_t r = 0; r < ranked.size() && r < 3; ++r)
          {
            if (r) dtsv << ';';
            dtsv << ranked[r].second << ':' << ranked[r].first;
          }
          if (ranked.empty()) dtsv << '-';
          dtsv << '\n';
        }
        dtsv.close();
        if (dtsv.fail())
        {
          OPENMS_LOG_ERROR << "Failed writing " << delta_out << "." << std::endl;
          return CANNOT_WRITE_OUTPUT_FILE;
        }
        OPENMS_LOG_INFO << "Delta histogram: " << samples << " spectra sampled"
                        << (clamped ? String(", ") + clamped + " excluded (clamped flank)" : String(""))
                        << " -> " << delta_out << std::endl;
      }
    }

    // Taxonomic / species detection from the tags.
    //
    // For every spectrum, the SET of taxa its tags support (a tag supports a
    // taxon when every one of its k-mers is in that taxon -- intersection, so a
    // longer tag is more specific). Each taxon is counted ONCE per spectrum, not
    // per tag, so correlated tags from one spectrum cannot manufacture evidence.
    // Roll the per-leaf counts up the taxonomy, compare each node against the
    // breadth it has in the index, and rank. The q-value is a ranking aid, not a
    // calibrated FDR: the per-k-mer background is a proxy and the chimeric-null
    // problem (see F4 in doc/BACKLOG.md) applies here too.
    String taxdb = getStringOption_("taxdb");
    String species_out = getStringOption_("species_out");
    String nodes = getStringOption_("taxonomy_nodes");
    String names = getStringOption_("taxonomy_names");
    // -species is the switch. Passing -taxdb and -species_out explicitly still
    // works without it, which is how this was driven before the flag existed.

    if (want_species)
    {
      const String tdir = taxonomyDir_();
      // The index and its taxonomy are ONE coherent set. An index and dumps from
      // different sources silently drop every taxid one does not know and bias
      // the background, with no error. So it is all-bundle OR all-user: if ANY of
      // the three was given explicitly, ALL three must be -- checking only -taxdb
      // let `FASTAG_TAXONOMY_DIR=/x` + explicit bundled dumps mix a custom index
      // with bundled dumps through the back door.
      const bool any_explicit = !taxdb.empty() || !nodes.empty() || !names.empty();
      if (any_explicit && (taxdb.empty() || nodes.empty() || names.empty()))
      {
        OPENMS_LOG_ERROR << "-taxdb, -taxonomy_nodes and -taxonomy_names are one set: "
                         << "give all three, or none (to use the bundled taxonomy). "
                         << "Mixing a custom index with another taxonomy silently "
                         << "drops every taxon the two do not share." << std::endl;
        return ILLEGAL_PARAMETERS;
      }
      if (!any_explicit && !tdir.empty())
      {
        taxdb = tdir + "/tax_k7.taxdb";
        nodes = tdir + "/nodes.dmp";
        names = tdir + "/names.dmp";
      }
      if (species_out.empty())
      {
        // Strip an extension only if the dot is in the FILE NAME. `-out
        // /tmp/run.v1/tags` has its last dot in the directory, and blindly
        // cutting there wrote /tmp/run.species.tsv -- a different directory.
        const size_t slash = out.find_last_of("/\\");
        const size_t dot = out.rfind('.');
        const bool ext = dot != std::string::npos && (slash == std::string::npos || dot > slash);
        species_out = (ext ? out.substr(0, dot) : out) + ".species.tsv";
      }

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
      const int kk = idx.k();
      int min_len = getIntOption_("species_min_len");
      if (min_len < kk) min_len = kk;

      // The silent-empty trap: the index is keyed on k-mers, so a tag shorter
      // than k can never be looked up. With the default tag_length of 3 against
      // a k=7 index that is EVERY tag -- the run then succeeds, reports "0
      // spectra contributed taxon evidence" and writes a header-only file, which
      // reads as "nothing found" rather than "nothing could have been found".
      const int reach = getIntOption_("tag_length") + 2 * getIntOption_("extension");
      if (reach < kk)
      {
        OPENMS_LOG_WARN << "-species: no tag can reach the index k (this run was "
                        << "driven by -taxdb/-species_out rather than -species, which "
                        << "checks up front). tag_length ("
                        << getIntOption_("tag_length") << ") + 2*extension ("
                        << getIntOption_("extension") << ") = " << reach << " < k = " << kk
                        << ", so every tag is too short to look up and the report WILL be empty. "
                        << "Raise -tag_length to " << kk << " (or use -extension to reach it)."
                        << std::endl;
      }

      // Per-spectrum taxon support -> per-leaf spectrum counts. by_spec was
      // collected in write_block, in write order.
      std::map<uint32_t, uint64_t> hits;
      size_t n_units = 0;
      for (const auto& sp : by_spec)
      {
        std::set<uint32_t> taxa;  // taxa supported anywhere in this spectrum
        for (const std::string& raw : sp.second)
        {
          const std::string seq = FASTag::baseSequence(raw);
          if (static_cast<int>(seq.size()) < min_len) continue;
          // Intersection of the tag's k-mer taxon sets: the taxon must carry the
          // whole tag, not just one window.
          std::vector<uint32_t> acc;
          bool first = true;
          const int L = static_cast<int>(seq.size());
          // One reusable buffer: lookup() fills rather than returns a reference,
          // because the mapped index holds taxon INDICES, not a vector to borrow.
          std::vector<uint32_t> t;
          for (int i = 0; i + kk <= L; ++i)
          {
            idx.lookup(FASTag::TaxIndex::fold(seq.substr(static_cast<size_t>(i), static_cast<size_t>(kk))), t);
            if (first) { acc = t; first = false; }
            else
            {
              std::vector<uint32_t> tmp;
              std::set_intersection(acc.begin(), acc.end(), t.begin(), t.end(), std::back_inserter(tmp));
              acc.swap(tmp);
            }
            if (acc.empty()) break;
          }
          for (uint32_t tx : acc) taxa.insert(tx);
        }
        if (taxa.empty()) continue;
        ++n_units;
        // Count each NODE at most once per spectrum. Increment every ancestor of
        // every supported taxon, deduplicated within the spectrum, so `hits` is
        // already a correct spectrum-count at every rank. Summing leaf counts up
        // the tree instead (the old rollUp path) counted one spectrum TWICE at a
        // genus with two supported species -- observed > n_total, p = -inf, q = 0.
        std::set<uint32_t> spec_nodes;
        for (uint32_t tx : taxa)
          for (uint32_t a : tax.lineage(tx)) spec_nodes.insert(a);
        for (uint32_t a : spec_nodes) ++hits[a];
      }

      // hits is already rolled up (spectrum-deduped per node), so build the
      // evidence directly -- rolling it again would re-introduce the double count.
      std::vector<FASTag::NodeEvidence> rolled;
      rolled.reserve(hits.size());
      for (const auto& kv : hits) rolled.push_back({kv.first, kv.second, kv.second});

      // The background (index breadth) IS summed up the subtree. This over-counts
      // a k-mer shared by sibling taxa, which inflates the expectation and makes
      // calls more CONSERVATIVE -- the safe direction, unlike the observed bug.
      std::vector<std::pair<uint32_t, uint64_t>> post_pairs;
      for (uint32_t tx : idx.taxa()) post_pairs.emplace_back(tx, idx.postings(tx));
      const auto rolled_post = tax.rollUp(post_pairs);
      std::map<uint32_t, double> bg;
      const double nk = static_cast<double>(std::max<uint64_t>(1, idx.nKmers()));
      for (const auto& np : rolled_post) bg[np.taxid] = static_cast<double>(np.subtree_hits) / nk;
      std::vector<std::pair<uint32_t, double>> bg_pairs(bg.begin(), bg.end());

      const double qthr = 1.0;  // rank everything; the report shows q, caller thresholds
      auto calls = tax.call(rolled, bg_pairs, static_cast<uint64_t>(n_units), qthr);

      const String want_rank = getStringOption_("species_rank");
      std::ofstream so(species_out.c_str());
      so << "rank\ttaxid\tname\tobserved\texpected\tenrichment\tlog_pvalue\tqvalue\n";
      size_t shown = 0;
      for (const auto& c : calls)
      {
        if (c.rank != want_rank) continue;
        const double enr = c.expected > 0 ? c.observed / c.expected : 999.0;
        // rank/name come from the taxdump, which can carry arbitrary text: a tab
        // or newline in a name would desync columns, and a very long name would
        // overrun a fixed buffer. Sanitise the free-text fields (the numerics are
        // bounded) and append to a string so length is never a factor.
        auto clean = [](const std::string& in) {
          std::string o; o.reserve(in.size());
          for (char ch : in) o += (ch == '\t' || ch == '\n' || ch == '\r') ? ' ' : ch;
          return o;
        };
        char num[128];
        std::snprintf(num, sizeof num, "\t%llu\t%.1f\t%.1fx\t%g\t%g\n",
                      static_cast<unsigned long long>(c.observed), c.expected, enr,
                      c.log_pvalue, c.qvalue);
        so << clean(c.rank) << '\t' << c.taxid << '\t' << clean(c.name) << num;
        if (++shown >= 50) break;
      }
      so.flush();
      const bool species_ok = static_cast<bool>(so);
      so.close();
      if (!species_ok)
        OPENMS_LOG_ERROR << "Failed writing species report to " << species_out << std::endl;
      OPENMS_LOG_INFO << "Species: " << n_units << " spectra contributed taxon evidence; "
                      << "top " << want_rank << " calls -> " << species_out << std::endl;
    }

    OPENMS_LOG_INFO << n_ms2 << " MS2 spectra, " << n_tags << " tags";
    if (filtering) OPENMS_LOG_INFO << " -> " << n_reported << " after filtering";
    OPENMS_LOG_INFO << std::endl;

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
        OPENMS_LOG_ERROR << "No spectrum carried a reported tag; not writing " << out_spectra
                         << std::endl;
        return UNEXPECTED_RESULT;
      }
      if (mzpeak_out)
      {
#ifdef FASTAG_HAVE_MZPEAK_LIB
        // Streamed, like the mzML branch below: each kept spectrum is re-read
        // and handed straight to the writer, which flushes a Parquet row
        // group when enough points have accumulated. O(1 spectrum) plus the
        // row group, never O(kept). Per-spectrum sourceFile/dataProcessing
        // references are cleared so the run-level metadata cannot dangle; the
        // FILTERING step is declared once, in that metadata.
        //
        // Not routed through FileHandler: its storeExperiment() has no mzPeak
        // branch, so asking it for one silently writes something else.
        // `kept` holds no spectra any more, and addDataProcessing_ stamps
        // SPECTRA -- so the FILTERING step is carried by a one-spectrum map
        // whose only purpose is to hand that step to the metadata mapping,
        // which reads it from spectrum 0.
        PeakMap processing_carrier;
        processing_carrier.addSpectrum(MSSpectrum());
        addDataProcessing_(processing_carrier, getProcessingInfo_(DataProcessing::FILTERING));
        FASTag::MzPeakSpectrumWriter writer(out_spectra, kept.getExperimentalSettings(),
                                            &processing_carrier);
        for (const Size i : kept_idx)
        {
          MSSpectrum sp = read_spectrum(i);
          sp.setSourceFile(SourceFile());
          sp.setDataProcessing({});
          writer.add(sp);
        }
        writer.finish();
        OPENMS_LOG_INFO << "Wrote " << writer.size() << " spectra to " << out_spectra
                        << " (streamed, O(1) memory)" << std::endl;
#endif
      }
      else
      {
        {
          // Scoped: the destructor writes footer + index. The count is known
          // exactly BEFORE the first consume (the header bakes it in at that
          // point -- why per-block streaming was rejected). Per-spectrum
          // sourceFile/dataProcessing references are cleared so the header,
          // built from the run-level settings alone, can never dangle; the
          // FILTERING processing step is declared for every spectrum instead.
          PlainMSDataWritingConsumer consumer(out_spectra);
          consumer.setExperimentalSettings(kept.getExperimentalSettings());
          consumer.setExpectedSize(kept_idx.size(), 0);
          consumer.addDataProcessing(getProcessingInfo_(DataProcessing::FILTERING));
          for (const Size i : kept_idx)
          {
            MSSpectrum sp = read_spectrum(i);
            sp.setSourceFile(SourceFile());
            sp.setDataProcessing({});
            consumer.consumeSpectrum(sp);
          }
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
    // announced and delivered counts, so it never shrinks (the mzPeak reader
    // announces every spectrum in the file but delivers only those with point
    // data, 42,092 of 53,521).
    if (emit_progress)
    {
      const long long dd = progress_done.load();
      const long long tt = std::max(dd, progress_total.load());
      std::cerr << "FASTAG_PROGRESS done=" << tt << " total=" << tt << std::endl;
    }

    return EXECUTION_OK;
  }
};

int main(int argc, const char** argv)
{
  TOPPFASTag tool;
  return tool.main(argc, argv);
}
