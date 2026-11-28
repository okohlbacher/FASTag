// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
//
// --------------------------------------------------------------------------
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
// --------------------------------------------------------------------------

#include "FASTagTool.h"
#include "Terminus.h"

#include <tuple>
#include <unordered_set>

#ifdef FASTAG_MIMALLOC
#include <mimalloc.h> // Windows: mimalloc with CRT redirection (CMakeLists.txt)
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

  /// -fasta_proteins writes a protein as its identifier only: warn once per
  /// database (@p what) whose entries repeat an identifier, since a hit in
  /// one of them cannot be told from one in another (the GUI does not align
  /// such an identifier).
  void warnRepeatedIdentifiers_(const std::vector<FASTAFile::FASTAEntry>& entries, const char* what)
  {
    std::unordered_set<std::string> seen;
    seen.reserve(entries.size());
    size_t repeated = 0;
    const std::string* first = nullptr;
    for (const auto& e : entries)
    {
      if (seen.insert(e.identifier).second) continue;
      if (!first) first = &e.identifier;
      ++repeated;
    }
    if (repeated == 0) return;
    OPENMS_LOG_WARN << "-fasta_proteins: " << repeated << (repeated == 1 ? " entry" : " entries") << " of the " << what
                    << " repeat an earlier identifier (first: " << *first << "); db_proteins names a protein by its "
                    << "identifier only, so a hit in such an entry cannot be told from one in another entry of that "
                    << "identifier." << std::endl;
  }


  /// The value of environment variable @p name, "" when it is unset or empty.
  std::string envOf_(const char* name)
  {
    const char* env = std::getenv(name);
    return env == nullptr ? std::string() : std::string(env);
  }

  /// The folders beside the executable where the shipped digest data is
  /// looked for: the cmake --install tree (../share/FASTag/digest), the flat
  /// release layout (share-FASTag-digest; a build tree links data/digest
  /// there, CMakeLists.txt FASTAG_STAGE_DATA_IN_BUILD) and a plain digest/.
  std::vector<std::string> digestCandidates_()
  {
    const std::string exe = File::getExecutablePath();
    return {exe + "../share/FASTag/digest", exe + "share-FASTag-digest", exe + "digest"};
  }

  /// Directory holding the shipped digest data (protease models, mass-gap
  /// modifications): $FASTAG_DIGEST_DIR, else the first candidate beside the
  /// executable that holds digest_models.tsv. "" when there is none. A
  /// FASTAG_DIGEST_DIR that names no folder finds nothing (the error says
  /// so): it is not silently replaced by other data.
  std::string digestDir_()
  {
    const std::string env = envOf_("FASTAG_DIGEST_DIR");
    if (!env.empty()) return File::isDirectory(env) ? env : std::string();
    for (const std::string& c : digestCandidates_())
      if (File::exists(c + "/digest_models.tsv")) return c;
    return std::string();
  }

  /// @p d with a trailing "digest" replaced by "alkylation"; "" when it does
  /// not end in "digest".
  std::string alkylationSibling_(std::string d)
  {
    while (!d.empty() && (d.back() == '/' || d.back() == '\\')) d.pop_back();
    if (d.size() < 6 || d.compare(d.size() - 6, 6, "digest") != 0) return std::string();
    return d.substr(0, d.size() - 6) + "alkylation";
  }

  /// 1.12 D (#3g): directory of the shipped -alkylation_proteome proteomes:
  /// $FASTAG_ALKYLATION_DIR, else "alkylation" beside the digest data
  /// directory (share/FASTag/digest -> share/FASTag/alkylation,
  /// share-FASTag-digest -> share-FASTag-alkylation). "" when there is none.
  /// As for the digest data, a FASTAG_ALKYLATION_DIR that names no folder
  /// finds nothing.
  std::string alkylationDir_()
  {
    const std::string env = envOf_("FASTAG_ALKYLATION_DIR");
    if (!env.empty()) return File::isDirectory(env) ? env : std::string();
    const std::string a = alkylationSibling_(digestDir_());
    return !a.empty() && File::isDirectory(a) ? a : std::string();
  }

  /// @p p without "." and ".." steps, for messages.
  std::string shownPath_(const std::string& p)
  {
    return std::filesystem::path(p).lexically_normal().string();
  }

  /// Where a shipped data file was looked for, for the error that names it:
  /// the folder @p env_name names (and whether it is one), else the folder
  /// found (@p dir), else every candidate (@p cands).
  std::string searchedFor_(const char* env_name, const std::string& dir, const std::vector<std::string>& cands)
  {
    const std::string env = envOf_(env_name);
    if (!env.empty())
      return File::isDirectory(env) ? "it is not in '" + env + "', the folder " + env_name + " names"
                                    : std::string(env_name) + " is set to '" + env + "', which is not a folder";
    if (!dir.empty()) return "it is not in '" + shownPath_(dir) + "'";
    std::string where;
    for (const std::string& c : cands) where += (where.empty() ? "" : ", ") + shownPath_(c);
    return "looked in " + where;
  }

  /// -data_paths (the desktop app's capability check): one JSON line with the
  /// folders this FASTag reads its shipped data from, as a run would
  /// (digestDir_, alkylationDir_, with this process's environment), the
  /// digest folders looked in (FASTAG_DIGEST_DIR as given, or the three
  /// beside the executable), the shipped proteomes whose file is there, and
  /// what -alkylation_proteome auto reads without a database: "none" (the
  /// call from the tags alone; before 1.16 auto meant the human proteome).
  std::string dataPathsJson_()
  {
    namespace P = FASTag::Probe;
    const std::string env = envOf_("FASTAG_DIGEST_DIR");
    const std::string digest = digestDir_();
    const std::string alk = alkylationDir_();
    std::string j = "{\"digest_dir\":" + (digest.empty() ? std::string("null") : P::jsonString(shownPath_(digest)));
    j += ",\"digest_from_env\":" + std::string(env.empty() ? "false" : "true") + ",\"digest_searched\":[";
    const std::vector<std::string> searched = env.empty() ? digestCandidates_() : std::vector<std::string>{env};
    for (std::size_t i = 0; i < searched.size(); ++i) j += (i ? "," : "") + P::jsonString(env.empty() ? shownPath_(searched[i]) : env);
    j += "],\"alkylation_dir\":" + (alk.empty() ? std::string("null") : P::jsonString(shownPath_(alk))) + ",\"proteomes\":[";
    std::string mtext;
    const bool manifest = !alk.empty() && File::exists(alk + "/proteomes.tsv");
    if (manifest)
    {
      std::ifstream mf((alk + "/proteomes.tsv").c_str(), std::ios::binary);
      mtext.assign(std::istreambuf_iterator<char>(mf), std::istreambuf_iterator<char>());
    }
    bool first = true;
    for (const char* name : {"human", "mouse", "yeast", "ecoli"})
    {
      if (alk.empty()) break;
      FASTag::Alkylation::ShippedProteome sp;
      const std::string file = manifest ? (FASTag::Alkylation::findShippedProteome(mtext, name, sp) ? sp.file : std::string())
                                        : std::string(name) + ".fasta.gz";
      if (file.empty() || file.find_first_of("/\\") != std::string::npos || !File::exists(alk + "/" + file)) continue;
      j += (first ? "" : ",") + P::jsonString(name);
      first = false;
    }
    j += "],\"alkylation_auto\":\"none\"}\n";
    return j;
  }

  /// The error for shipped digest data a run needs and does not find: what
  /// needs it (@p what), the file, where it was looked for, and the fixes in
  /// order, ending with @p tail (an option that replaces the file, or the
  /// output to leave out). One line: the GUI shows the first line.
  void missingDigestData_(const std::string& what, const std::string& file, const std::string& dir, const std::string& tail)
  {
    OPENMS_LOG_ERROR << what << " needs " << file << " from FASTag's shipped digest data, and it was not found ("
                     << searchedFor_("FASTAG_DIGEST_DIR", dir, digestCandidates_())
                     << "). To fix: use an installed FASTag (cmake --install puts the data in "
                        "<prefix>/share/FASTag/digest), or set FASTAG_DIGEST_DIR to a folder that holds "
                     << file << " (data/digest in the FASTag sources), or " << tail << "." << std::endl;
  }

  /// @p dir/@p file when the file is there, else "".
  std::string shippedFile_(const std::string& dir, const std::string& file)
  {
    return !dir.empty() && File::exists(dir + "/" + file) ? dir + "/" + file : std::string();
  }

  /// k of a taxonomy index, read from its 16-byte header alone.
  ///
  /// Exists so the tag-length precondition can be checked BEFORE tagging.
  /// Loading the index to learn k maps a ~1 GB file, which is exactly the work
  /// we want to refuse to waste.
  ///
  /// Every index format puts k at the same place: magic(4) | u32 version | u32 k,
  /// so the current "FTX2", its packed form "FTZ1" and the legacy "FTXI" are accepted.
  int peekTaxdbK_(const std::string& path)
  {
    std::ifstream f(path.c_str(), std::ios::binary);
    if (!f) return -1;
    char magic[4];
    if (!f.read(magic, 4)) return -1;
    const bool v1 = std::memcmp(magic, "FTXI", 4) == 0;
    const bool v2 = std::memcmp(magic, "FTX2", 4) == 0;
    const bool z1 = std::memcmp(magic, "FTZ1", 4) == 0;
    if (!v1 && !v2 && !z1) return -1;
    std::uint32_t ver = 0, k = 0;
    if (!f.read(reinterpret_cast<char*>(&ver), 4)) return -1;
    if (!f.read(reinterpret_cast<char*>(&k), 4)) return -1;
    // Reject a header the real loader would reject, so a corrupt/hostile file
    // does not yield a plausible k and a misleading precondition error.
    if ((v1 && ver != 1) || (v2 && ver != 2) || (z1 && ver != 1)) return -1;
    if (k < 1 || k > static_cast<std::uint32_t>(FASTag::TaxIndex::MAX_K)) return -1;
    return static_cast<int>(k);
  }

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
    if (dumps && !FASTag::TaxIndex::findInDir(c).empty()) return c;   // complete (.taxdb or .ftz)
    if (dumps && with_dumps.empty()) with_dumps = c;
  }
  return !with_dumps.empty() ? with_dumps : any;
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

DataProcessing TOPPFASTag::outSpectraProcessingInfo_() const
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
    // A removed option (1.14) never: it had no effect. A removed value is
    // read as the default, so it is listed as the default would be.
    if (isRemovedOption_(name))
    {
      p.removeMetaValue(k);
      continue;
    }
    // A flag's registered default (false) and its Param value ("false")
    // never compare equal, so a flag at its default would stay listed; ask
    // the flag itself.
    const ParameterInformation& e = findEntry_(name);
    const bool at_default = e.type == ParameterInformation::FLAG ? !getFlag_(name)
                            : isRemovedValue_(name)              ? true
                                                                 : getParam_().getValue(name) == e.default_value;
    if (at_default) p.removeMetaValue(k);
  }
  // 1.13 item 15: under -complement_tolerance_unit auto the window in force
  // is not an option value, so it is recorded next to the options (full
  // precision; with -complement_tolerance_unit Da it reproduces the tags).
  // Absent without auto, so those exports keep their bytes.
  if (compl_auto_rec_.on)
  {
    p.setMetaValue("complement_tolerance (auto)", compl_auto_rec_.tol);
    p.setMetaValue("complement_tolerance (auto) source", compl_auto_rec_.source);
    if (!compl_auto_rec_.measured.empty())
      p.setMetaValue("complement_tolerance (auto) measured", compl_auto_rec_.measured);
    p.setMetaValue("complement_tolerance (auto) probe", compl_auto_rec_.probe);
  }
  if (!tmt_filter_rec_.empty()) p.setMetaValue("tmt_pseudo_filter resolved", tmt_filter_rec_);
  return p;
}

TOPPFASTag::ExitCodes TOPPFASTag::main_(int, const char**)
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

  // 1.15.4: the shortlist recipe is the default of every tryptic shortlist run
  // (before, only -search_engine msfragger with -search_config_out took part of
  // it). At FASTag's tagging defaults (-tag_length 3, no extension) no tag
  // reaches the reconciliation length a real database derives (8 for 94k
  // proteins, 9 for 870k), so -fasta_out was empty (exit 13). The values are
  // those of PREREG-msfragger2 (PASS; its repeat PREREG-exactonly FAILED, so
  // they are a working default, not a validated claim). Another protease
  // keeps the plain defaults. An option given on the command line or in an
  // INI wins; the log and the shortlist header name what was applied.
  {
    const bool recipe_on = (!getStringOption_("shortlist_out").empty() || !getStringOption_("fasta_out").empty() ||
                            !getStringOption_("search_config_out").empty()) &&
                           getStringOption_("shortlist_protease") == "trypsin" &&
                           getStringOption_("shortlist_defaults") == "recipe";
    const auto take = [&](const char* name, const std::string& shown) {
      const bool apply = recipe_on && !optionGiven_(name);
      if (apply) recipe_defaults_ += std::string(recipe_defaults_.empty() ? "" : ", ") + "-" + name + " " + shown;
      return apply;
    };
    if (!optionGiven_("tag_lengths") && take("tag_length", "4")) recipe_int_["tag_length"] = 4;
    if (take("extension", "6")) recipe_int_["extension"] = 6;
    if (take("shortlist_min_spectra", "1")) recipe_int_["shortlist_min_spectra"] = 1;
    if (take("recon_min_length", "6")) recipe_int_["recon_min_length"] = 6;
    if (take("recon_missed_cleavages", "2")) recipe_int_["recon_missed_cleavages"] = 2;
    recipe_gapped_ = take("shortlist_gapped", "on");
    recipe_evalue_ = take("shortlist_max_evalue", "10");
    if (!recipe_defaults_.empty())
      OPENMS_LOG_INFO << "Shortlist recipe defaults (doc/SHORTLIST.md): " << recipe_defaults_
                      << "; an option given on the command line or in an INI wins." << std::endl;
  }
  const bool dump_mode = !getFlag_("stream") && !getStringOption_("dump_spectrum").empty();
  // -data_paths: a GUI mode like the two above (JSON on the sealed stdout).
  const bool data_paths_mode = !getFlag_("stream") && getFlag_("data_paths");

  if (getIntOption_("threads") == 0)
  {
    const unsigned cores = std::thread::hardware_concurrency();  // 0 if unknown
    const int n = std::max(1, static_cast<int>(cores / 2));
    TOPPBase::setMaxNumberOfThreads(n);  // omp_set_num_threads, or a no-op without OpenMP
    // Not under -stream: this runs before stdout is rewired into the data
    // channel, and a log line there is a corrupt spectrum block.
    if (!getFlag_("stream") && !probe_mode && !dump_mode && !data_paths_mode)
      OPENMS_LOG_INFO << "-threads 0: using " << n << " of " << cores << " logical cores." << std::endl;
  }

  if (getFlag_("stream") || probe_mode || dump_mode || data_paths_mode)
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
      OPENMS_LOG_ERROR << (getFlag_("stream") ? "-stream" : probe_mode ? "-probe_input" : dump_mode ? "-dump_spectrum" : "-data_paths")
                       << ": cannot rewire stdout." << std::endl;
      return ILLEGAL_PARAMETERS;
    }
#ifndef _WIN32
    // A consumer that vanishes must surface as an error, not a SIGPIPE kill
    // -- the flag help promises the process never dies mid-stream.
    signal(SIGPIPE, SIG_IGN);
#endif
  }
  // 1.14: removed options and values, after the seal (stderr only).
  warnRemoved_();
  // After the seal, so that a refusal, too, leaves stdout empty.
  if (probe_mode && dump_mode)
  {
    OPENMS_LOG_ERROR << "-probe_input and -dump_spectrum are separate modes; give one of them." << std::endl;
    return ILLEGAL_PARAMETERS;
  }
  if (probe_mode) return probeInputMode_();
  if (data_paths_mode)
  {
    if (dump_mode)
    {
      OPENMS_LOG_ERROR << "-data_paths and -dump_spectrum are separate modes; give one of them." << std::endl;
      return ILLEGAL_PARAMETERS;
    }
    if (!writeGuiStream_(dataPathsJson_()))
    {
      OPENMS_LOG_ERROR << "-data_paths: cannot write to stdout." << std::endl;
      return CANNOT_WRITE_OUTPUT_FILE;
    }
    return EXECUTION_OK;
  }

  // ---- phase 1: option checks, refusals and tagging parameters ----------

  // -species is the switch; -taxdb with -species_out still works without it,
  // which is how species detection was driven before the flag existed.
  const bool want_species = getFlag_("species")
      || (!getStringOption_("taxdb").empty() && !getStringOption_("species_out").empty());
  // 1.12 #1: the calibrated call runs only with species detection.
  // 1.14: -species_call explain (removed) is read as the default, none.
  const bool species_call_on = want_species && stringOption_("species_call") != "none";
  // 1.12 #10: both tag orientations in the species lookup.
  const FASTag::SpeciesOrientation species_orient = getStringOption_("species_orientation") == "both"
      ? FASTag::SpeciesOrientation::BOTH : FASTag::SpeciesOrientation::FORWARD;
  const bool species_both = want_species && species_orient == FASTag::SpeciesOrientation::BOTH;

  // The seed lengths this run tags at, ascending and distinct: -tag_lengths
  // when given, else the one -tag_length.
  const IntList tag_lengths = getIntList_("tag_lengths");
  const std::set<int> distinct_lengths(tag_lengths.begin(), tag_lengths.end());
  std::vector<int> lengths(distinct_lengths.begin(), distinct_lengths.end());
  if (lengths.empty()) lengths.push_back(intOption_("tag_length"));
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
                        "species_pi0", "digest_min_confidence", "alkylation_min_share",
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
      if (!d.empty()) probe_taxdb = FASTag::TaxIndex::findInDir(d);
    }
    const int index_k = probe_taxdb.empty() ? -1 : peekTaxdbK_(probe_taxdb);
    if (index_k > 0)
    {
      const int reach = lengths.back() + 2 * intOption_("extension");
      if (reach < index_k)
      {
        OPENMS_LOG_ERROR << "-species: tag_length (" << lengths.back()
                         << ") + 2*extension (" << intOption_("extension") << ") = "
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
        {"fasta_proteins", nullptr},
        {"recon_out", nullptr},
        {"species_out", nullptr},
        {"taxdb", nullptr},
        {"out_spectra", nullptr},
        {"delta_out", nullptr},
        {"delta_spectra_out", nullptr},
        {"delta_counts_out", nullptr},
        {"recon_id_out", nullptr},
        {"usi_collection", nullptr},
        {"digest_out", nullptr},
        {"label_out", nullptr},
        {"massgap_out", nullptr},
        {"species", "-stream cannot be combined with -species or -glyco."},
        {"glyco", "-stream cannot be combined with -species or -glyco."},
        // ---- 1.12 E: -stream refusals ----
        {"pick_profile", nullptr},
        {"ion_series", nullptr},
        {"ion_series_hybrid", nullptr},
        {"unknown_charge", nullptr},
        {"charge_min", nullptr},
        {"charge_max", nullptr},
        {"charge_infer_margin", nullptr},
        {"isotope_error", nullptr},
        {"complement_probe", nullptr},
        {"check_header_charge", nullptr},
        {"check_header_margin", nullptr},
        {"check_header_out", nullptr},
        // ---- 1.12 A: -stream refusals ----
        {"shortlist_out", nullptr},
        {"fasta_out", nullptr},
        {"shortlist_background", nullptr},
        {"search_config_out", nullptr},
        // ---- 1.12 D: -stream refusals ----
        {"species_call", "-stream cannot be combined with -species_call."},
        {"species_orientation", nullptr},
        {"alkylation_out", nullptr},
        {"alkylation_tags_out", nullptr},  // 1.13 #22
        // ---- 1.12 F: -stream refusals ----
        {"census", nullptr},
        {"census_out", nullptr},
        {"census_summary_out", nullptr},
        {"census_ids", nullptr},
        {"census_ids_fdr", nullptr},
        {"census_ids_accept", nullptr},    // 1.16
        {"census_triage_evalue", nullptr},
        // ---- 1.16 QC: -stream refusals ----
        {"qc_out", nullptr},
        {"census_ids_exact", nullptr},     // 1.16 item 4
        {"census_score", nullptr},
        {"census_sorted_out", nullptr},
        // ---- 1.12 G: -stream refusals ----
        {"probe_input", nullptr},
        {"dump_spectrum", nullptr},
        {"data_paths", nullptr},
        {"terminus", nullptr},  // the -terminus columns need the run's precursor hypotheses
    };
    // 1.13 item 15: the probe needs random access to the run.
    if (getStringOption_("complement_tolerance_unit") == "auto")
    {
      OPENMS_LOG_ERROR << "-stream cannot be combined with -complement_tolerance_unit auto." << std::endl;
      return ILLEGAL_PARAMETERS;
    }
    if (getStringOption_("tmt_pseudo_filter") == "auto")
    {
      OPENMS_LOG_ERROR << "-stream cannot be combined with -tmt_pseudo_filter auto; use on only for known TMT6/10 input." << std::endl;
      return ILLEGAL_PARAMETERS;
    }
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
                      << " specify " << species_call_params.decoys
                      << " decoy replicates; this run uses -species_call_decoys "
                      << getIntOption_("species_call_decoys") << "." << std::endl;
  }
  // 1.12 #10: no analytic background follows from the orientation rule, so
  // the analytic log_pvalue and qvalue (forward index background) are
  // withheld under both, with or without -species_call decoy. The optional
  // decoy null (decoy_qvalue, call) remains experimental and uncalibrated.
  if (species_both)
    OPENMS_LOG_WARN << "-species_orientation both: the analytic log_pvalue and qvalue columns of the species "
                       "report are NA under both; "
                    << (species_call_on ? "use decoy_qvalue and call from -species_call decoy."
                                        : "use decoy_qvalue from -species_call decoy.")
                    << " These optional decoy values are experimental and not calibrated."
                    << std::endl;
  const std::string fasta = getStringOption_("fasta");
  const std::string out_spectra = getStringOption_("out_spectra");

  // The CLI's defaults (src/CliParam.h), then every option over them; the
  // modifications are resolved from the options below.
  FASTag::Param p = FASTag::cliDefaultParam(/*resolve_mods=*/false);
  const std::string tmt_mode = getStringOption_("tmt_pseudo_filter");
  p.tmt_pseudo_filter = tmt_mode == "on";
  p.tmt_reporter_filter = getFlag_("tmt_reporter_filter");
  if (p.tmt_reporter_filter && tmt_mode == "off")
  {
    OPENMS_LOG_ERROR << "-tmt_reporter_filter requires -tmt_pseudo_filter auto or on." << std::endl;
    return ILLEGAL_PARAMETERS;
  }
  if (tmt_mode == "on")
  {
    tmt_filter_rec_ = "on; forced_TMT6_10; reporters=" + std::string(p.tmt_reporter_filter ? "on" : "off");
    std::cerr << "TMT pseudo-filter: " << tmt_filter_rec_ << std::endl;
  }
  p.tag_length = lengths.front();
  p.max_extension = intOption_("extension");
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
  // 1.15.5 (PREREG-lowres-defaults, change A): with the fragment tolerance in
  // Da and no complement option given, the complement window is measured on
  // the run (auto) instead of the 0.02 Da default; not under -stream (the
  // probe needs random access) nor for mzPeak input (read in one pass; see
  // the mzPeak check below).
  // 1.15.5 change B: each MS2 spectrum's tolerance from its analyzer.
  const bool by_analyzer = getStringOption_("tolerance_by_analyzer") == "on";
  const double itms_tol = getDoubleOption_("fragment_tolerance_itms");
  compl_auto_by_unit_ = getStringOption_("fragment_tolerance_unit") == "Da" && !optionGiven_("complement_tolerance_unit") &&
                        !optionGiven_("complement_tolerance") && !optionGiven_("complement_tol_factor") &&
                        !getFlag_("stream");
  FASTag::Cli::setComplementTolerance(p, getDoubleOption_("complement_tolerance"),
                                      getDoubleOption_("complement_tol_factor"),
                                      compl_auto_by_unit_ ? std::string("auto")
                                                          : getStringOption_("complement_tolerance_unit"));
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
  const bool hdr_check_on = hyp_param.header_check != FASTag::Hyp::HeaderCheck::OFF;
  const std::string check_header_out = getStringOption_("check_header_out");
  if (const std::string herr = FASTag::Hyp::validate(hyp_param, p.frag_tol, p.tol_ppm); !herr.empty())
  {
    OPENMS_LOG_ERROR << herr << std::endl;
    return ILLEGAL_PARAMETERS;
  }
  // 1.13: experimental; say so whenever it runs.
  if (hyp_param.header_check == FASTag::Hyp::HeaderCheck::BOTH)
    OPENMS_LOG_WARN << "-check_header_charge both is experimental: a flagged spectrum is tagged under two "
                       "charges, and on held-out data about one flag in three was wrong (doc/HEADER-CHARGE-CHECK.md)."
                    << std::endl;
  const bool hyp_on = !hyp_param.isDefault();
  // #6: -species reads the selected hypothesis' rows only, through a per-row
  // flag carried beside the rows (Block::row_species).
  const bool species_sel_on = hyp_on && want_species;
  // The complement pairs the infer call counts: #2's rule and tolerance.
  // Not const: -complement_tolerance_unit auto sets the window after the
  // probe (phase 5) and rebuilds both.
  FASTag::ComplementSpec hyp_cs = FASTag::ComplementSpec::fromParam(p);
  // #15 phase B: a spectrum read as c/z-dot counts c/z-dot pairs (they sum
  // to M + H) for its charge and isotope evidence, as its tags do.
  FASTag::Param p_cz = p;
  p_cz.ion_pair = FASTag::IonSeries::ionPair(FASTag::IonSeries::Series::CZ);
  FASTag::ComplementSpec hyp_cs_cz = FASTag::ComplementSpec::fromParam(p_cz);
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
  // 1.14: -ion_series ax (removed) is read as the default, by.
  const FASTag::IonSeries::Mode ion_mode = FASTag::IonSeries::modeFromString(stringOption_("ion_series"));
  const FASTag::IonSeries::IonPair cz_pair = FASTag::IonSeries::ionPair(FASTag::IonSeries::Series::CZ);
  // 1.13 item 10: auto with -ion_series_hybrid both reads a hybrid spectrum
  // in two passes, with the b/y and the c/z-dot sets (no third set).
  const bool hybrid_both =
      ion_mode == FASTag::IonSeries::Mode::AUTO && getStringOption_("ion_series_hybrid") == "both";
  const bool cz_tables = ion_mode == FASTag::IonSeries::Mode::CZ || ion_mode == FASTag::IonSeries::Mode::AUTO;
  std::vector<FASTag::Param> len_params_cz;
  if (cz_tables)
  {
    len_params_cz = len_params;
    for (FASTag::Param& lp : len_params_cz) lp.ion_pair = cz_pair;
  }
  // 1.15.5 (change B, -tolerance_by_analyzer): the Params of ion-trap MS2
  // spectra, filled after the probes (empty while the option is off or the
  // run has no ion-trap spectra in its probe).
  std::vector<FASTag::Param> len_params_it, len_params_cz_it;
  // The Params of series @p sr (b/y or c/z-dot), of an ion-trap spectrum
  // when @p itms.
  const auto params_of = [&len_params, &len_params_cz, &len_params_it, &len_params_cz_it](
                             FASTag::IonSeries::Series sr, bool itms = false) -> const std::vector<FASTag::Param>& {
    if (sr == FASTag::IonSeries::Series::CZ) return itms ? len_params_cz_it : len_params_cz;
    return itms ? len_params_it : len_params;
  };
  auto build_tables = [&params_of](FASTag::IonSeries::Series sr = FASTag::IonSeries::Series::BY, bool itms = false) {
    const std::vector<FASTag::Param>& lps = params_of(sr, itms);
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
  auto tag_all = [&params_of](const MSSpectrum& s, double prec_mz, int charge,
                              const std::vector<FASTag::Tables>& tabs,
                              FASTag::SpectrumDiag* diag = nullptr, double multiplicity = 1.0,
                              FASTag::IonSeries::Series sr = FASTag::IonSeries::Series::BY, bool itms = false) {
    const std::vector<FASTag::Param>& lps = params_of(sr, itms);
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
  // -fasta_proteins: the proteins (and positions) of each written -fasta hit.
  const int fasta_proteins = getIntOption_("fasta_proteins");
  if (fasta_proteins > 0 && !filtering)
  {
    OPENMS_LOG_ERROR << "-fasta_proteins names the -fasta proteins a tag matches; "
                        "give -fasta too." << std::endl;
    return ILLEGAL_PARAMETERS;
  }
  // Their locate indexes (the -recon_out one when it reads the same -fasta),
  // gene names and decoy flags, per protein ordinal; the entrapment ones
  // annotate efwd/erev rows.
  FASTag::ProteomeIndex db_index_own, db_entrap_index;
  const FASTag::ProteomeIndex* db_index = nullptr;
  std::vector<std::string> db_genes, db_entrap_genes;
  std::vector<char> db_decoy, db_entrap_decoy;
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
  // -subsume_tags (on by default): rows lying wholly in another row of their
  // spectrum are left out of -out (FASTag::subsumedTags); -terminus: the
  // series and terminus columns (src/Terminus.h).
  const bool subsume_on = getStringOption_("subsume_tags") == "on";
  const bool terminus_on = getFlag_("terminus");
  const std::string delta_out = getStringOption_("delta_out");
  const std::string delta_spectra_out = getStringOption_("delta_spectra_out");
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
  // #3g: -alkylation_out. Its call is read off the tags (the shadow pass of
  // 1.13 #22, no database); since feedback 202dbcf4 the placements of the
  // run's own reconciler only refine it, when there is a database: another
  // placement reader, -recon_fasta, -fasta or a non-default
  // -alkylation_proteome. The default auto no longer means the human proteome.
  const std::string alkylation_out = getStringOption_("alkylation_out");
  const bool alkylation_on = !alkylation_out.empty();
  // 1.13 #22: -alkylation_tags_out tags every MS2 a second time; it places nothing.
  const std::string alkylation_tags_out = getStringOption_("alkylation_tags_out");
  const bool alkylation_tags_on = !alkylation_tags_out.empty();
  // The shadow pass runs for either report (one tally, run_acc.d.alkt).
  const bool alkylation_shadow_on = alkylation_on || alkylation_tags_on;
  const std::string alk_prot_opt = alkylation_on ? getStringOption_("alkylation_proteome") : std::string();
  const bool alk_place = alkylation_on && (recon_on || handoff_on || !getStringOption_("recon_fasta").empty() ||
                                           !fasta.empty() || !(alk_prot_opt.empty() || alk_prot_opt == "auto"));
  const bool place_on = recon_on
      // ---- 1.12 A: placement readers ----
      || handoff_on
      // ---- 1.12 D: placement readers ----
      || alk_place
      ;
  // Only -alkylation_out places: every other placement reader is off, so
  // the index is built on its database and only the tags it reads are
  // placed (recon_out, the hand-off and -delta_out read every tag).
  const bool alkylation_only_db = alk_place && !recon_on && !handoff_on;
  // The placement-report checks below keep their 1.11 meaning: placing for
  // -alkylation_out alone does not satisfy them (1.12 D #3g).
  const bool place_reports = place_on && !alkylation_only_db;
  // Feedback 422372a2: -recon_proteome, a shipped proteome as the database
  // of -recon_out (after -recon_fasta, before -fasta). The hand-off outputs
  // name their database to the engine and still need a FASTA file.
  const std::string recon_prot = getStringOption_("recon_proteome");
  const bool recon_prot_on = !recon_prot.empty() && recon_on && !handoff_on && getStringOption_("recon_fasta").empty();
  if (!recon_prot.empty() && !recon_prot_on)
    OPENMS_LOG_WARN << "-recon_proteome is ignored: "
                    << (!recon_on ? "it is only read with -recon_out."
                        : !getStringOption_("recon_fasta").empty() ? "the tags place on -recon_fasta."
                        : "-shortlist_out, -fasta_out and -search_config_out need a FASTA file (-recon_fasta).")
                    << std::endl;
  if (!delta_out.empty() && !place_reports)
  {
    OPENMS_LOG_ERROR << "-delta_out requires -recon_out (the histogram is "
                        "aggregated over reconciliations)." << std::endl;
    return ILLEGAL_PARAMETERS;
  }
  if (!delta_spectra_out.empty() && delta_out.empty())
  {
    OPENMS_LOG_ERROR << "-delta_spectra_out requires -delta_out (it lists that table's samples)." << std::endl;
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
                        "(a Sage or MSFragger configuration is written complete)." << std::endl;
    return ILLEGAL_PARAMETERS;
  }
  // The shortlist settings; the recipe defaults (set at the start of main_)
  // replace the values the user did not give. The help of the two -recon_*
  // options is frozen (1.11 interface, baseline_identity_test).
  FASTag::Shortlist::Settings sl_settings;
  sl_settings.gapped = recipe_gapped_ || getFlag_("shortlist_gapped");
  sl_settings.max_evalue = recipe_evalue_ ? 10.0 : getDoubleOption_("shortlist_max_evalue");
  const int recon_min_length = intOption_("recon_min_length");
  const int recon_mc = intOption_("recon_missed_cleavages");
  sl_settings.min_spectra = static_cast<std::uint64_t>(intOption_("shortlist_min_spectra"));
  {
    const std::string pm = getStringOption_("shortlist_parsimony");
    sl_settings.parsimony = pm == "subset" ? FASTag::Shortlist::Parsimony::SUBSET
                          : pm == "greedy" ? FASTag::Shortlist::Parsimony::GREEDY
                                           : FASTag::Shortlist::Parsimony::NONE;
  }
  sl_settings.top = static_cast<std::size_t>(getIntOption_("shortlist_top"));
  const StringList sl_affix_option = getStringList_("shortlist_decoy_affix");
  std::vector<std::string> sl_affixes;
  for (const std::string& a : sl_affix_option)
    if (!a.empty()) sl_affixes.push_back(a);
  // 1.13 item 20: protease-aware placement for the hand-off outputs.
  const std::string sl_protease = getStringOption_("shortlist_protease");
  const bool sl_nontryptic = handoff_on && sl_protease != "trypsin";
  FASTag::Cleavage::Specificity sl_spec = FASTag::Cleavage::Specificity::FULL;
  FASTag::Cleavage::parseSpecificity(getStringOption_("shortlist_specificity"), sl_spec);
  if (sl_nontryptic && sl_settings.gapped)
  {
    OPENMS_LOG_WARN << "-shortlist_gapped is ignored with -shortlist_protease " << sl_protease
                    << ": windows found by flank mass have no mismatched flank." << std::endl;
    sl_settings.gapped = false;
  }
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
    // The input is .mzML, .mzpeak, .mgf or a Bruker .d / .d.zip (refused
    // otherwise below), so the last dot starts the extension, and a Bruker
    // run is named without ".d" or ".d.zip" (as its conversions are). Except
    // for MGF, whose run keeps it: USI 1.0 lets the msRun carry the
    // extension, and an MGF index points into the peak list, not into the
    // raw run it came from.
    const std::string file = File::basename(in);
    const bool mgf_run = FileHandler::getTypeByFileName(in) == FileTypes::MGF
                         && !FileNameUtils::hasCompressionSuffix(in);
    const std::string run = FASTag::Bruker::isBrukerPath(in) ? FASTag::Bruker::runName(in)
                            : mgf_run ? file : file.substr(0, file.rfind('.'));
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
  std::array<std::uint64_t, FASTag::Digest::NUM_AA> sl_db_residues{};
  std::size_t sl_decoys = 0;
  // 1.13 #18: entries starting with the MSFragger decoy prefix (MSFragger
  // generates no decoys; without -fasta_out the database must hold them).
  std::size_t sl_prefix_decoys = 0;
  const bool msfragger_on = !search_config_out.empty() && getStringOption_("search_engine") == "msfragger";
  const std::string msfragger_prefix =
      getStringOption_("search_decoy_prefix").empty() ? std::string("rev_") : getStringOption_("search_decoy_prefix");
  // #3g: where -alkylation_out's placements come from (its report says).
  std::string alk_db_source, alk_db;
  // 1.13 (#24): a shipped proteome's manifest row (entries 0 = no manifest).
  FASTag::Alkylation::ShippedProteome alk_shipped;
  std::string alk_manifest;
  // The shipped proteome @p name (human, mouse, yeast, ecoli) in @p path, its
  // manifest row in alk_shipped; @p who starts each message, @p alt is the
  // advice when it is missing. EXECUTION_OK when found.
  const auto findShipped = [&](const std::string& name, const char* who, const char* alt, std::string& path) -> ExitCodes
  {
    const std::string dir = alkylationDir_();
    path = dir.empty() ? std::string() : dir + "/" + name + ".fasta.gz";
    // 1.13 (#24): the shipped directory's proteomes.tsv names each file and
    // records its UniProt release, entries and sha256. A directory without
    // it (a FASTAG_ALKYLATION_DIR of one's own) is read as in 1.12.
    const std::string manifest = dir.empty() ? std::string() : dir + "/proteomes.tsv";
    if (!manifest.empty() && File::exists(manifest))
    {
      std::ifstream mf(manifest.c_str(), std::ios::binary);
      const std::string mtext((std::istreambuf_iterator<char>(mf)), std::istreambuf_iterator<char>());
      if (!mf.good() && !mf.eof())
      {
        OPENMS_LOG_ERROR << who << ": cannot read '" << manifest << "'." << std::endl;
        return INPUT_FILE_NOT_READABLE;
      }
      if (!FASTag::Alkylation::findShippedProteome(mtext, name, alk_shipped))
      {
        OPENMS_LOG_ERROR << who << ": '" << manifest << "' has no valid row for the " << name
                         << " proteome (columns name, proteome, taxon, release, release_date, entries, "
                            "sha256, fasta_sha256, file; one row per name)." << std::endl;
        return INPUT_FILE_CORRUPT;
      }
      path = dir + "/" + alk_shipped.file;
      alk_manifest = manifest;
    }
    if (path.empty() || !File::exists(path))
    {
      // Where it was looked for: the folder beside the digest data, or
      // beside each place the digest data is looked for.
      std::vector<std::string> alk_cands;
      const std::string dd = digestDir_();
      for (const std::string& c : dd.empty() ? digestCandidates_() : std::vector<std::string>{dd})
        alk_cands.push_back(alkylationSibling_(c));
      OPENMS_LOG_ERROR << who << ": no shipped " << name << " proteome found ("
                       << searchedFor_("FASTAG_ALKYLATION_DIR", dir, alk_cands) << "). Give " << alt
                       << ", or use an installed FASTag "
                          "(cmake --install puts the proteomes in <prefix>/share/FASTag/alkylation), or set "
                          "FASTAG_ALKYLATION_DIR to a folder that holds "
                       << name << ".fasta.gz (data/alkylation in the FASTag sources)." << std::endl;
      return ILLEGAL_PARAMETERS;
    }
    return EXECUTION_OK;
  };
  // -recon_proteome: the file -recon_out places on.
  std::string recon_prot_path;
  if (recon_prot_on)
  {
    const ExitCodes rc = findShipped(recon_prot, "-recon_proteome", "-recon_fasta <fasta>", recon_prot_path);
    if (rc != EXECUTION_OK) return rc;
  }
  if (alk_place)
  {
    const std::string prot = alk_prot_opt;
    if (recon_prot_on)
    {
      if (optionNonDefault_("alkylation_proteome"))
        OPENMS_LOG_WARN << "-alkylation_proteome is ignored: -alkylation_out reads the placements on "
                           "-recon_proteome." << std::endl;
      alk_db_source = "bundled:" + recon_prot;
    }
    else if (!getStringOption_("recon_fasta").empty() || !alkylation_only_db)
    {
      if (optionNonDefault_("alkylation_proteome"))
        OPENMS_LOG_WARN << "-alkylation_proteome is ignored: -alkylation_out reads the placements on "
                        << (getStringOption_("recon_fasta").empty() ? "-fasta" : "-recon_fasta") << "." << std::endl;
      alk_db_source = getStringOption_("recon_fasta").empty() ? "fasta" : "recon_fasta";
    }
    else if (prot.empty() || prot == "auto")
    {
      // feedback 202dbcf4: auto with -fasta places on -fasta (the run's own
      // database); auto without any database places nothing (alk_place).
      alk_db = fasta;
      alk_db_source = "fasta";
    }
    else
    {
      const bool named = prot == "human" || prot == "mouse" || prot == "yeast" || prot == "ecoli";
      if (named)
      {
        std::string path;
        const ExitCodes rc = findShipped(prot, "-alkylation_out", "-alkylation_proteome <fasta> or -recon_fasta", path);
        if (rc != EXECUTION_OK) return rc;
        alk_db = path;
        alk_db_source = "bundled:" + prot;
      }
      else if (File::exists(prot) && !File::isDirectory(prot))
      {
        alk_db = prot;
        alk_db_source = "proteome";
      }
      else
      {
        OPENMS_LOG_ERROR << "-alkylation_proteome '" << prot << "' is neither auto, human, mouse, yeast, ecoli "
                            "nor a readable FASTA file. auto (the default) needs no database." << std::endl;
        return ILLEGAL_PARAMETERS;
      }
    }
  }
  // The reconciler's minimum tag length (-recon_min_length, else derived
  // from the database); 0 when nothing places.
  int recon_min_len = 0;
  if (place_on)
  {
    recon_db = getStringOption_("recon_fasta");
    if (recon_db.empty()) recon_db = recon_prot_on ? recon_prot_path : alkylation_only_db ? alk_db : fasta;
    if (recon_db.empty())
    {
      OPENMS_LOG_ERROR << "-recon_out needs a database: give -recon_fasta "
                          "(or -fasta), or -recon_proteome for a shipped proteome." << std::endl;
      return ILLEGAL_PARAMETERS;
    }
    std::vector<FASTAFile::FASTAEntry> rentries;
    // #3g: the shipped proteomes are gzip-compressed, which FASTAFile cannot read.
    // 1.13 (#24): of a shipped proteome also the sha256 of the FASTA text read.
    std::string alk_fasta_sha;
    // A shipped proteome (gzip-compressed): -alkylation_proteome's or -recon_proteome's.
    const bool shipped_db = alkylation_only_db || recon_prot_on;
    const char* shipped_who = recon_prot_on ? "-recon_proteome" : "-alkylation_out";
    const char* shipped_alt = recon_prot_on ? "-recon_fasta <fasta>" : "-alkylation_proteome <fasta>";
    if (shipped_db)
      FASTag::Alkylation::loadFasta(recon_db, rentries, alk_shipped.entries > 0 ? &alk_fasta_sha : nullptr);
    else FASTAFile().load(recon_db, rentries);
    // 1.13 (#24): a shipped proteome must be the FASTA its manifest records,
    // byte for byte (the report's database_release states that sha256), and
    // hold its entries; otherwise the file is truncated, edited or replaced.
    if (shipped_db && alk_shipped.entries > 0 && alk_fasta_sha != alk_shipped.fasta_sha256)
    {
      OPENMS_LOG_ERROR << shipped_who << ": the shipped " << alk_shipped.name << " proteome '" << recon_db
                       << "' reads as a FASTA with sha256 " << alk_fasta_sha << ", its proteomes.tsv records "
                       << alk_shipped.fasta_sha256 << " (UniProt " << alk_shipped.release
                       << "); the file is damaged or was replaced. Reinstall FASTag, or give "
                       << shipped_alt << "." << std::endl;
      return INPUT_FILE_CORRUPT;
    }
    if (shipped_db && alk_shipped.entries > 0 && rentries.size() != alk_shipped.entries)
    {
      OPENMS_LOG_ERROR << shipped_who << ": the shipped " << alk_shipped.name << " proteome '" << recon_db
                       << "' holds " << rentries.size() << " entries, its proteomes.tsv records "
                       << alk_shipped.entries << " (UniProt " << alk_shipped.release
                       << "); the file is damaged or was replaced. Reinstall FASTag, or give "
                       << shipped_alt << "." << std::endl;
      return INPUT_FILE_CORRUPT;
    }
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
        if (msfragger_on && pi.accession.compare(0, msfragger_prefix.size(), msfragger_prefix) == 0) ++sl_prefix_decoys;
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
      // release-3: on a database without decoys the heuristic can succeed with an empty affix; say nothing then.
      if (dh.success && !dh.name.empty() && !FASTag::Shortlist::isDecoy(dh.is_prefix ? dh.name + "x" : "x" + dh.name, sl_affixes))
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
    int rmin = recon_min_length;
    if (rmin == 0) rmin = pindex.autoMinLen();
    recon_min_len = rmin;
    recon.attach(&pindex, recon_mc, rmin);
    std::vector<FASTag::ModCandidate> cands;
    for (const auto& m : p.mods)
      if (m.variable) cands.push_back({m.name, m.delta, std::string(1, m.residue)});
    recon.setModCandidates(std::move(cands));
    recon.setFixedTermMods(fixed_term_n, fixed_term_c);
    recon.setSubstitutionTolerance(getDoubleOption_("recon_sub_tolerance"),
                                   getStringOption_("recon_sub_tolerance_unit") == "ppm");
    if (recon_ids_on)
    {
      // The modifications the index was built with: residue ones only. A
      // terminal one is not in the window masses, so its mass is part of the
      // gap and must not also be on the peptide.
      id_params.db = recon_db;
      id_params.fixed_modifications = fixed_mods;
      id_params.variable_modifications = variable_mods;
      id_params.missed_cleavages = static_cast<UInt>(recon_mc);
      id_params.fragment_mass_tolerance = p.frag_tol;
      id_params.fragment_mass_tolerance_ppm = p.tol_ppm;
      id_params.digestion_enzyme = *ProteaseDB::getInstance()->getEnzyme("Trypsin");  // ProteomeIndex's rule
      id_fixed = ModifiedPeptideGenerator::getModifications(id_params.fixed_modifications);
    }
    OPENMS_LOG_INFO << "Recon index: " << pindex.proteinCount() << " proteins, "
                    << pindex.residueCount() << " residues, "
                    << pindex.collapseRuleCount() << " isobaric rules; min tag length "
                    << rmin
                    << (recon_min_length == 0 ? " (derived)"
                        : recipe_int_.count("recon_min_length") ? " (shortlist recipe default)" : " (set)")
                    << std::endl;
    // 1.13 (#24): a run whose tags cannot reach that length places nothing,
    // and -alkylation_out cannot call (the default -tag_length 3 on a
    // shipped proteome, which needs 7 or 8).
    if (alk_place && max_len < rmin)
      OPENMS_LOG_WARN << "-alkylation_out: tags place on '" << recon_db << "' from " << rmin
                      << " residues, but this run's longest tag has " << max_len
                      << " (seed length + 2 x -extension); no tag will place and the placements will make no call "
                         "(the call comes from the tags alone). Give -tag_length " << rmin << " or more." << std::endl;
    if (recon_prot_on && max_len < rmin)
      OPENMS_LOG_WARN << "-recon_proteome: tags place on the shipped " << recon_prot << " proteome from " << rmin
                      << " residues, but this run's longest tag has " << max_len
                      << " (seed length + 2 x -extension); no tag will place. Raise -extension or -tag_length."
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
        // -qc_out (qc_version 3): the label mass decides the isobaric kit.
        || !getStringOption_("qc_out").empty()
        ;
  };
  const bool count_on = needCounting();
  const bool massgap_on = !massgap_out.empty();
  // gap_needed: the mass-gap tables are loaded and the histogram rows are
  // kept as gaps (GapRow), for -massgap_out and every other gap reader.
  const bool gap_needed = massgap_on
      // ---- 1.12 A: mass-gap readers ----
      ;
  // delta_on: one delta sample per spectrum is taken and binned.
  const bool delta_on = !delta_out.empty() || gap_needed;
  // 1.16 mass-shift survey: -delta_out's site and name columns. The
  // selected sample's gap is localized (if -recon_localize did not) and
  // classed; each row is named from Unimod (ModificationsDB) and PSI-MOD
  // (the OBO file read with its own specificity, ShiftSurvey.h).
  const bool delta_sites = !delta_out.empty();
  const bool delta_per_spectrum = !delta_spectra_out.empty();
  const int64_t delta_group_bins = static_cast<int64_t>(std::llround(getDoubleOption_("delta_group") / 0.0005));
  std::vector<FASTag::ShiftSurvey::Entry> survey_unimod, survey_psimod;
  std::vector<FASTag::ShiftSurvey::FixedMod> survey_fixed;
  const double survey_tol = getDoubleOption_("delta_name_tolerance");
  const bool survey_ppm = getStringOption_("delta_name_tolerance_unit") == "ppm";
  // 1.16b survey rules (README "Mass-shift survey"): the sample's
  // selection, its localization model and evidence threshold, the null,
  // the isotope reading's flank, the isobar classes and the count table.
  const bool delta_consensus = getStringOption_("delta_select") == "consensus";
  const std::string delta_loc_model_s = getStringOption_("delta_loc_model");
  const FASTag::LocModel delta_loc_model = delta_loc_model_s == "count"  ? FASTag::LocModel::COUNT
                                         : delta_loc_model_s == "unique" ? FASTag::LocModel::UNIQUE
                                                                         : FASTag::LocModel::STRICT;
  const int delta_loc_min_evidence = getIntOption_("delta_loc_min_evidence");
  const double delta_loc_null = getDoubleOption_("delta_loc_null");
  const bool delta_iso_precursor = getStringOption_("delta_isotope_flank") == "precursor";
  const double delta_isobar_tol = getDoubleOption_("delta_isobar_tolerance");
  const std::string delta_counts_out = getStringOption_("delta_counts_out");
  if (!delta_counts_out.empty() && delta_out.empty())
  {
    OPENMS_LOG_ERROR << "-delta_counts_out requires -delta_out (it counts that table's samples)." << std::endl;
    return ILLEGAL_PARAMETERS;
  }
  if (delta_sites)
  {
    std::string err;
    survey_unimod = FASTag::ShiftSurvey::unimodEntries("CHEMISTRY/unimod.xml", &err);
    if (!err.empty())
      OPENMS_LOG_WARN << "-delta_out: Unimod not read (" << err << "); the unimod column stays empty."
                      << std::endl;
    err.clear();
    survey_psimod = FASTag::ShiftSurvey::psimodEntries("CHEMISTRY/PSI-MOD.obo", &err);
    if (!err.empty())
      OPENMS_LOG_WARN << "-delta_out: PSI-MOD not read (" << err << "); the psimod column stays empty."
                      << std::endl;
    for (const auto& m : p.mods)
      if (!m.variable) survey_fixed.push_back({m.residue, m.delta, m.name});
  }
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
  FASTag::Centroid::Mode pick_mode = FASTag::Centroid::Mode::LEGACY;
  FASTag::Centroid::parseMode(stringOption_("pick_profile"), pick_mode);
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
        {"digest_window", "-digest_out, -label_out or -qc_out", count_on},
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
        {"ion_series_hybrid", "-ion_series auto", stringOption_("ion_series") == "auto"},
        {"charge_min", "-unknown_charge enumerate or infer, or -check_header_charge",
         hyp_param.mode != FASTag::Hyp::ChargeMode::ASSUME2 || hdr_check_on},
        {"charge_max", "-unknown_charge enumerate or infer, or -check_header_charge",
         hyp_param.mode != FASTag::Hyp::ChargeMode::ASSUME2 || hdr_check_on},
        {"charge_infer_margin", "-unknown_charge enumerate or infer, or -check_header_charge",
         hyp_param.mode != FASTag::Hyp::ChargeMode::ASSUME2 || hdr_check_on},
        {"check_header_margin", "-check_header_charge warn or both", hdr_check_on},
        {"check_header_out", "-check_header_charge warn or both", hdr_check_on},
        // ---- 1.12 A: ignored-option warnings ----
        {"shortlist_background", "-fasta_out", !fasta_out.empty()},
        {"shortlist_max_evalue", "-shortlist_out or -fasta_out", shortlist_on},
        {"shortlist_min_spectra", "-shortlist_out or -fasta_out", shortlist_on},
        {"shortlist_gapped", "-shortlist_out or -fasta_out", shortlist_on},
        {"shortlist_parsimony", "-shortlist_out or -fasta_out", shortlist_on},
        {"shortlist_top", "-shortlist_out or -fasta_out", shortlist_on},
        {"shortlist_protease", "-shortlist_out, -fasta_out or -search_config_out", handoff_on},
        {"shortlist_defaults", "-shortlist_out, -fasta_out or -search_config_out", handoff_on},
        {"shortlist_specificity", "-shortlist_protease other than trypsin", sl_nontryptic},
        {"search_engine", "-search_config_out", !search_config_out.empty()},
        {"search_config_template", "-search_config_out", !search_config_out.empty()},
        {"search_precursor_tolerance", "-search_config_out", !search_config_out.empty()},
        {"search_precursor_unit", "-search_config_out", !search_config_out.empty()},
        {"search_isotope_errors", "-search_config_out", !search_config_out.empty()},
        {"search_missed_cleavages", "-search_config_out", !search_config_out.empty()},
        {"search_nterm_acetyl", "-search_config_out", !search_config_out.empty()},
        {"search_decoy_prefix", "-search_config_out", !search_config_out.empty()},
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
        {"digest_quality", "-digest_out", digest_on},  // 1.13 digqual
        {"alkylation_proteome", "-alkylation_out", alkylation_on},
        {"alkylation_min_spectra", alkylation_tags_on ? "-alkylation_out or -alkylation_tags_out" : "-alkylation_out",
         alkylation_on || alkylation_tags_on},
        {"alkylation_min_share", alkylation_tags_on ? "-alkylation_out or -alkylation_tags_out" : "-alkylation_out",
         alkylation_on || alkylation_tags_on},
        {"alkylation_window", "-alkylation_out with a database (-recon_fasta, -fasta or -alkylation_proteome)", alk_place},
        // ---- 1.12 F: ignored-option warnings ----
        {"census_out", "-census", getFlag_("census")},
        {"census_summary_out", "-census", getFlag_("census")},
        {"census_ids", "-census", getFlag_("census")},
        {"census_ids_fdr", "-census_ids",
         getFlag_("census") && !getStringOption_("census_ids").empty() && getStringOption_("census_ids_accept") == "qvalue"},
        {"census_ids_accept", "-census_ids", getFlag_("census") && !getStringOption_("census_ids").empty()},
        {"census_triage_evalue", "-census_ids", getFlag_("census") && !getStringOption_("census_ids").empty()},
        {"census_ids_exact", "-census_ids", getFlag_("census") && !getStringOption_("census_ids").empty()},
        {"census_score", "-census", getFlag_("census")},
        {"census_sorted_out", "-census_score", getFlag_("census") && getFlag_("census_score")},
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
  // A shipped table a run needs and does not find: the error names it, where
  // it was looked for and what to do (missingDigestData_), before any output.
  const auto no_digest_data = [&](const std::string& what, const std::string& file, const std::string& tail) {
    missingDigestData_(what, file, digest_dir, tail);
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
      const std::string file = digest_v2 ? "digest_models_v2.tsv" : "digest_models.tsv";
      models_path = shippedFile_(digest_dir, file);
      if (models_path.empty())
        return no_digest_data("-digest_out", file, "give -digest_models <tsv>, or leave out -digest_out");
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
      for (std::string_view cls : FD::INSTRUMENT_CLASSES)
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
      const std::string cp = cal_path.empty() ? shippedFile_(digest_dir, "digest_calibration.tsv") : cal_path;
      if (cp.empty())
        return no_digest_data(digest_v2 ? "-digest_out with -digest_models_version v2" : "-digest_out with -digest_min_confidence",
                              "digest_calibration.tsv", "give -digest_calibration <tsv>");
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
      std::array<std::uint64_t, FD::NUM_AA> background_counts{};
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
      if (shippedFile_(digest_dir, "digest_models.tsv").empty())
        return no_digest_data("-digest_out with a -digest_models table without a background", "digest_models.tsv",
                              "give -fasta or -recon_fasta for the background");
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
  // 1.13 digqual: the enzyme of -digest_quality must be a model of the table.
  const std::string digest_quality = digest_on ? getStringOption_("digest_quality") : std::string();
  if (!digest_quality.empty() && digest_quality != "auto")
  {
    bool found = false;
    for (const FD::Model& m : protease_models.models) found = found || m.name == digest_quality;
    if (!found)
    {
      std::string names;
      for (const FD::Model& m : protease_models.models) names += (names.empty() ? "" : ", ") + m.name;
      OPENMS_LOG_ERROR << "-digest_quality '" << digest_quality << "' is not a model of the protease table ("
                       << names << ") and not 'auto'." << std::endl;
      return ILLEGAL_PARAMETERS;
    }
  }
  std::vector<FD::GapMod> gap_mods, cys_alkylations;
  std::vector<FD::Combo> gap_combos;
  FD::GapSettings gap_settings;
  if (gap_needed)
  {
    if (shippedFile_(digest_dir, "massgap_mods.tsv").empty())
      return no_digest_data("-massgap_out", "massgap_mods.tsv", "leave out -massgap_out");
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
          OPENMS_LOG_ERROR << "-massgap_out: OpenMS does not know the modification '" << m.site << "'." << std::endl;
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
  // 1.14: the reduced FASTA would hold no protein; it is not written.
  bool empty_database = false;
  if (handoff_on)
  {
    if (digest_on) sl_models = protease_models;
    else
    {
      const std::string dd = digestDir_();
      std::string err;
      if (shippedFile_(dd, "digest_models.tsv").empty())
      {
        // Name the outputs given: the protease check runs for each of them.
        std::string given;
        for (const auto& o : {std::make_pair("-shortlist_out", &shortlist_out), std::make_pair("-fasta_out", &fasta_out),
                              std::make_pair("-search_config_out", &search_config_out)})
          if (!o.second->empty()) given += (given.empty() ? "" : ", ") + std::string(o.first);
        missingDigestData_(given + " (the protease check of the hand-off)", "digest_models.tsv", dd,
                           "give -digest_out with -digest_models <tsv> (the check then uses that table), or leave out "
                               + given);
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
    // post-1.13.1 (aspn): an Asp-N digest has D at a third of its counted
    // N-terminal tag ends, not at all of them; without this it is called
    // `unspecific`. Only the experimental non-trypsin placement path.
    if (sl_nontryptic) FD::softenNterm(sl_models, "Asp-N", FD::NTERM_SITE_SHARE);
    if (!search_config_out.empty())
    {
      sl_plan.database = fasta_out.empty() ? recon_db : fasta_out;
      sl_plan.spectra = in;
      const ModificationsDB* mdb = ModificationsDB::getInstance();
      for (const std::string& nm : getStringList_("fixed_modifications"))
        if (!nm.empty()) sl_plan.fixed.push_back(mdb->getModification(nm));
      for (const std::string& nm : getStringList_("variable_modifications"))
        if (!nm.empty()) sl_plan.variable.push_back(mdb->getModification(nm));
      // By engine (post-1.13.1, nine development runs): MSFragger gets its own
      // closed-search defaults (2 missed cleavages, 20 ppm, protein N-terminal
      // acetylation); Sage and Comet are unchanged.
      const bool msf = search_engine == "msfragger";
      const std::string ac = getStringOption_("search_nterm_acetyl");
      const ResidueModification* acetyl = mdb->getModification("Acetyl (Protein N-term)");
      if ((ac == "yes" || (ac == "engine" && msf)) &&
          std::find(sl_plan.variable.begin(), sl_plan.variable.end(), acetyl) == sl_plan.variable.end())
        sl_plan.variable.push_back(acetyl);
      sl_plan.missed_cleavages = getIntOption_("search_missed_cleavages");
      if (sl_plan.missed_cleavages < 0)  // 2 measured with trypsin only
        sl_plan.missed_cleavages = msf && !sl_nontryptic ? 2 : recon_mc;
      sl_plan.fragment_tolerance = p.frag_tol;
      sl_plan.fragment_ppm = p.tol_ppm;
      sl_plan.precursor_ppm = getStringOption_("search_precursor_unit") == "ppm";
      sl_plan.precursor_tolerance = getDoubleOption_("search_precursor_tolerance");
      if (sl_plan.precursor_tolerance < 0) sl_plan.precursor_tolerance = msf && sl_plan.precursor_ppm ? 20.0 : 10.0;
      // -1: Sage and Comet none (as before); MSFragger its own default 0..3
      // (development runs: without it the search lost a third of its PSMs).
      sl_plan.isotope_errors = getIntOption_("search_isotope_errors");
      if (sl_plan.isotope_errors < 0) sl_plan.isotope_errors = search_engine == "msfragger" ? 3 : 0;
      sl_plan.decoy_prefix = getStringOption_("search_decoy_prefix");
      sl_plan.fastag_version = FASTAG_VERSION;
      sl_plan.threads = getIntOption_("threads");  // MSFragger num_threads; 0 = every CPU
      std::string err;
      // 1.13 item 20: a named rule is known now and validated with the
      // template below; 'auto' knows its rule only after the run.
      const bool sl_named = sl_nontryptic && sl_protease != "auto";
      if (sl_named)
        sl_plan.enzyme = FASTag::Cleavage::engineEnzyme(*FASTag::Cleavage::findRule(sl_protease), sl_spec);
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
            const auto m = sl_named
                               ? FASTag::SearchConfig::mergeKeyValueTemplate(sl_template, keys, sl_plan.enzyme)
                               : FASTag::SearchConfig::mergeKeyValueTemplate(sl_template, keys);
            if (!m.error.empty()) err = "-search_config_template '" + tmpl_path + "': " + m.error;
          }
        }
      }
      else if (search_engine == "msfragger")
      {
        std::vector<std::pair<std::string, std::string>> keys;
        err = FASTag::SearchConfig::msfraggerKeys(sl_plan, keys);
        // A target-decoy database by DecoyHelper::findDecoyString's rule: the
        // prefix on at least 40 % of the entries (here case-sensitive, as
        // MSFragger matches it).
        if (err.empty() && fasta_out.empty() &&
            static_cast<double>(sl_prefix_decoys) < 0.4 * static_cast<double>(sl_proteins.size()))
          err = "MSFragger generates no decoys, and only " + std::to_string(sl_prefix_decoys) + " of " +
                std::to_string(sl_proteins.size()) + " entries of '" + recon_db + "' start with the decoy prefix '" +
                msfragger_prefix + "' (a target-decoy database has them on >= 40 %); give -fasta_out (FASTag then "
                "appends reversed decoys), a target-decoy database, or its prefix as -search_decoy_prefix";
      }
      if (err.empty() && sl_named && search_engine == "comet" &&
          getStringOption_("search_config_template").empty() && sl_plan.enzyme.comet_default < 0)
        err = "Comet's default enzyme table has no " + sl_plan.enzyme.name +
              " entry with this rule; give -search_config_template with one";
      if (!err.empty())
      {
        OPENMS_LOG_ERROR << "-search_config_out: " << err << "." << std::endl;
        return ILLEGAL_PARAMETERS;
      }
      // 'auto' with Comet: name the rules the run could call that have no
      // Comet enzyme entry (in the template, or in Comet's own table), so
      // the user learns it before the run; such a call is refused after the
      // run with neither hand-off output written.
      if (sl_nontryptic && !sl_named && search_engine == "comet")
      {
        std::vector<std::pair<std::string, std::string>> keys;
        FASTag::SearchConfig::cometKeys(sl_plan, keys);
        std::string missing;
        for (const FASTag::Cleavage::Rule& r : FASTag::Cleavage::rules())
        {
          const auto spec = r.unspecific() ? FASTag::Cleavage::Specificity::NONE : sl_spec;
          const auto enz = FASTag::Cleavage::engineEnzyme(r, spec);
          const bool has = sl_template.empty()
                               ? enz.comet_default >= 0
                               : FASTag::SearchConfig::mergeKeyValueTemplate(sl_template, keys, enz).error.empty();
          if (!has) missing += (missing.empty() ? "" : ", ") + r.name;
        }
        if (!missing.empty())
          OPENMS_LOG_WARN << "-shortlist_protease auto with Comet: " << (sl_template.empty()
                                                                              ? "Comet's default enzyme table"
                                                                              : "the -search_config_template")
                          << " has no entry for " << missing << "; if the run calls one of them, neither "
                          << "-fasta_out nor -search_config_out is written." << std::endl;
      }
      if (search_engine == "msfragger")
      {
        if (fasta_out.empty())
          OPENMS_LOG_INFO << "-search_config_out (msfragger): '" << recon_db << "' holds " << sl_prefix_decoys
                          << " entries with the decoy prefix '" << msfragger_prefix << "'." << std::endl;
      }
      else if (fasta_out.empty() && sl_decoys > 0)
        OPENMS_LOG_WARN << "-search_config_out names '" << recon_db << "', which holds " << sl_decoys
                        << " decoys, and lets the engine generate decoys as well; give -fasta_out to search "
                           "a database without them." << std::endl;
    }
  }
  // The run rows every report starts with (src/RunMeta.h), filled once.
  FASTag::RunReport::RunMeta run_meta;
  run_meta.tmt_filter_mode = tmt_mode;
  run_meta.tmt_filter_resolved = tmt_filter_rec_;
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
        stream_proforma ? buildProformaPrefix_(p.mods) : std::string();
    std::fputs(tagHeader_(stream_proforma, p.per_residue_conf, false).c_str(), dataf);
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
          const std::vector<char> drop = subsume_on ? FASTag::subsumedTags(tags) : std::vector<char>();
          for (size_t ti = 0; ti < tags.size(); ++ti)
          {
            if (!drop.empty() && drop[ti]) continue;
            appendTagRow_(buf, tags[ti], id, "-", stream_proforma, stream_proforma_prefix, p.per_residue_conf);
            ++n;
          }
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
      if (fasta_proteins > 0)
      {
        db_entrap_index.build(eentries, fixed_deltas, iso_tol);
        warnRepeatedIdentifiers_(eentries, "-entrapment_fasta");
        const std::vector<std::string> affixes = FASTag::Shortlist::defaultDecoyAffixes();
        for (const auto& e : eentries)
        {
          db_entrap_genes.push_back(FASTag::fastaGeneName(e.description));
          db_entrap_decoy.push_back(FASTag::Shortlist::isDecoy(e.identifier, affixes) ? 1 : 0);
        }
      }
    }
    if (fasta_proteins > 0)
    {
      // The -recon_out index serves when it was built from this -fasta (same
      // fixed modifications and isobaric tolerance, database order).
      if (place_on && recon_db == fasta && !alkylation_only_db && pindex.proteinCount() == entries.size())
        db_index = &pindex;
      else
      {
        db_index_own.build(entries, fixed_deltas, iso_tol);
        db_index = &db_index_own;
      }
      warnRepeatedIdentifiers_(entries, "-fasta");
      const std::vector<std::string> affixes = FASTag::Shortlist::defaultDecoyAffixes();
      for (const auto& e : entries)
      {
        db_genes.push_back(FASTag::fastaGeneName(e.description));
        db_decoy.push_back(FASTag::Shortlist::isDecoy(e.identifier, affixes) ? 1 : 0);
      }
      OPENMS_LOG_INFO << "Protein index: " << db_index->proteinCount() << " proteins"
                      << (db_index == &pindex ? " (the reconciliation index)" : "") << std::endl;
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
  //   .d       Bruker timsTOF (DDA-PASEF) through OpenMS's BrukerTimsFile
  //   .d.zip   (src/BrukerInput.h): the MS2 spectra, one per precursor,
  //            loaded into memory (MS1 frames are not decoded); a .d.zip is
  //            unpacked into OPENMS_TMPDIR for the read. dia-PASEF is
  //            refused from analysis.tdf before anything is decoded.
  //   .raw     Thermo, through OpenMS's OnDiscThermoRawExperiment
  //            (src/ThermoInput.h): scan headers indexed once, each worker
  //            decodes the scans it tags through its own clone, like the
  //            mzML index; vendor-centroided (Thermo's peak picking).
  // Compressed input (.gz, .bz2, .zip) is refused: none of these seek. A
  // zipped Bruker run (.d.zip) is the exception: the reader unpacks it.
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
  const bool bruker_in = FASTag::Bruker::isBrukerPath(in);
  if (bruker_in && !FASTag::Bruker::supported())
  {
    OPENMS_LOG_ERROR << "Input '" << in << "' is a Bruker timsTOF run, which this build cannot read: "
                        "the OpenMS it uses was built without WITH_OPENTIMS. Convert the run to mzML "
                        "or mzPeak, or use a FASTag built against OpenMS with WITH_OPENTIMS=ON."
                     << std::endl;
    return ILLEGAL_PARAMETERS;
  }
  if (!bruker_in && !is_mzpeak(in) && FileNameUtils::hasCompressionSuffix(in))
  {
    const FileTypes::Type c = FileNameUtils::compressionType(in);
    OPENMS_LOG_ERROR << "Input '" << in << "' is "
                     << (c == FileTypes::GZ ? "gzip" : c == FileTypes::BZ2 ? "bzip2" : "zip")
                     << "-compressed; FASTag reads uncompressed input only. Decompress it first."
                     << std::endl;
    return ILLEGAL_PARAMETERS;
  }
  const bool thermo_in = FASTag::Thermo::isThermoPath(in);
  if (thermo_in && !FASTag::Thermo::supported())
  {
    OPENMS_LOG_ERROR << "Input '" << in << "' is a Thermo .raw file, which this build cannot read: "
                        "the OpenMS it uses was built without WITH_THERMO_RAW. Convert it to mzML "
                        "(ThermoRawFileParser), or use a FASTag built against OpenMS with "
                        "WITH_THERMO_RAW=ON." << std::endl;
    return ILLEGAL_PARAMETERS;
  }
  if (!bruker_in && !thermo_in && !is_mzpeak(in) && !is_mzml(in) && !is_mgf(in))
  {
    OPENMS_LOG_ERROR << "Input '" << in << "' is neither .mzML, .mzpeak, .mgf, a Thermo .raw nor a Bruker "
                        "timsTOF .d directory or .d.zip archive." << std::endl;
    return ILLEGAL_PARAMETERS;
  }
  const bool mzpeak_in = !bruker_in && !thermo_in && is_mzpeak(in);
  const bool mgf_in = !bruker_in && !thermo_in && !mzpeak_in && is_mgf(in);
  // 1.13 item 15: the auto probe reads spectra by index before the tagging
  // pass; mzPeak input is read once, in file order.
  bool compl_auto = getStringOption_("complement_tolerance_unit") == "auto" || compl_auto_by_unit_;
  if (compl_auto && mzpeak_in && compl_auto_by_unit_)
  {
    // change A is a default, not a request: mzPeak keeps the Da window.
    compl_auto = false;
    compl_auto_by_unit_ = false;
  }
  if (compl_auto && mzpeak_in)
  {
    OPENMS_LOG_ERROR << "-complement_tolerance_unit auto needs mzML or MGF input; mzPeak input is "
                        "read in one pass. Give -complement_tolerance_unit Da or fragment." << std::endl;
    return ILLEGAL_PARAMETERS;
  }
  if (tmt_mode == "auto" && mzpeak_in)
  {
    OPENMS_LOG_ERROR << "-tmt_pseudo_filter auto needs random-access mzML or MGF input; use on only for known TMT6/10 input." << std::endl;
    return ILLEGAL_PARAMETERS;
  }
  // #9: what the mzPeak reader does with profile MS2 (src/Centroid.h;
  // MzPeakStream centroids). mzML and MGF are tagged as read.
  namespace FC = FASTag::Centroid;
  const FC::Policy pick_mzpeak = FC::policyFor(pick_mode, FC::Input::MZPEAK);
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
  constexpr int CHUNK = 256, TAIL_CHUNK = 16;
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
          in, mzpeak_decode_threads, static_cast<size_t>(read_threads) * CHUNK + 4096);
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
    if (mgf->headerBytes() > FASTag::MgfReader::HEADER_SCAN)
      OPENMS_LOG_WARN << "'" << in << "': " << mgf->headerBytes() << " bytes before the first "
                         "BEGIN IONS were ignored (only the first "
                      << FASTag::MgfReader::HEADER_SCAN << " were looked at for a CHARGE= default)."
                      << std::endl;
  }
  // A random-access vendor reader (Thermo .raw): its scan headers are
  // indexed here, before any output is opened, so an unreadable file or a
  // missing .NET runtime is said up front. Each tagging thread reads
  // through its own clone(), as with OnDiscMSExperiment below. Tagging
  // reads Thermo's centroids (src/ThermoInput.h: set explicitly, the
  // reader's default is profile).
  std::unique_ptr<IMSExperimentRandomAccess> vra;
  if (thermo_in)
  {
    try
    {
      const auto a = std::chrono::steady_clock::now();
      vra = FASTag::Thermo::open(in, FASTag::Thermo::Representation::CENTROID);
      g_t_open = std::chrono::duration<double>(std::chrono::steady_clock::now() - a).count();
      std::cerr << "Thermo .raw input: " << vra->getNrSpectra() << " scans indexed in "
                << std::round(g_t_open * 10.0) / 10.0
                << " s (OpenMS OnDiscThermoRawExperiment; vendor centroiding on)" << std::endl;
    }
    catch (const Exception::FileNotFound& e)
    {
      OPENMS_LOG_ERROR << e.what() << std::endl;
      return INPUT_FILE_NOT_FOUND;
    }
    catch (const Exception::BaseException& e)
    {
      OPENMS_LOG_ERROR << "Cannot read '" << in << "': " << e.what() << std::endl;
      if (const std::string hint = FASTag::Thermo::runtimeHint(e.what()); !hint.empty())
        OPENMS_LOG_ERROR << hint << std::endl;
      return INPUT_FILE_CORRUPT;
    }
    catch (const std::exception& e)
    {
      OPENMS_LOG_ERROR << "Cannot read '" << in << "': " << e.what() << std::endl;
      if (const std::string hint = FASTag::Thermo::runtimeHint(e.what()); !hint.empty())
        OPENMS_LOG_ERROR << hint << std::endl;
      return INPUT_FILE_CORRUPT;
    }
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
  // Bruker timsTOF: the facts of analysis.tdf first (SQL only; for a .d.zip
  // that member alone is extracted), so dia-PASEF is refused before the run
  // is unpacked or decoded, then the MS2 spectra into memory. The refusal
  // follows -acquisition_check as the probe below does for other input.
  PeakMap exp;
  if (bruker_in)
  {
    namespace BR = FASTag::Bruker;
    const BR::TdfFacts tdf = BR::facts(in);
    if (!tdf.ok)
    {
      OPENMS_LOG_ERROR << tdf.error << std::endl;
      return tdf.tsf ? INCOMPATIBLE_INPUT_DATA : INPUT_FILE_CORRUPT;
    }
    // stderr, as the acquisition check's own line: stdout's summary is digested.
    std::cerr << "Bruker timsTOF input (analysis.tdf): " << tdf.frames << " frames, " << tdf.ms1_frames
              << " MS1, " << tdf.pasef_frames << " DDA-PASEF MS/MS, " << tdf.dia_frames
              << " dia-PASEF MS/MS; " << tdf.precursors << " precursors, " << tdf.precursors_no_charge
              << " without a charge" << std::endl;
    const std::string acq_check = getStringOption_("acquisition_check");
    if (tdf.dia() && acq_check != "off")
    {
      if (acq_check == "refuse")
      {
        OPENMS_LOG_ERROR << BR::diaRefusalMessage(tdf, in) << std::endl;
        std::cerr << BR::diaRefusalSentinel(tdf) << std::endl;
        return INCOMPATIBLE_INPUT_DATA;
      }
      OPENMS_LOG_WARN << "'" << in << "' is dia-PASEF (" << tdf.dia_windows << " isolation windows); "
                         "tagged anyway as -acquisition_check warn asks: flanks and complements "
                         "will be wrong." << std::endl;
    }
    std::string tmp_dir;
    std::uintmax_t tmp_free = 0;
    if (const std::string err = BR::checkTempSpace(in, tmp_dir, tmp_free); !err.empty())
    {
      OPENMS_LOG_ERROR << err << std::endl;
      return CANNOT_WRITE_OUTPUT_FILE;
    }
    try
    {
      const BR::LoadStats ls = BR::loadMs2(in, exp);
      g_t_open = ls.seconds;
      std::cerr << "Bruker timsTOF input: " << ls.spectra << " MS2 spectra (one per precursor, "
                << "centroided by OpenMS BrukerTimsFile; MS1 frames not decoded) in "
                << std::round(ls.seconds * 10.0) / 10.0 << " s";
      if (!File::isDirectory(BR::normalizePath(in)))
        std::cerr << ", unpacked under " << tmp_dir << " (" << std::round(tmp_free / 1e8) / 10.0
                  << " GB free before)";
      std::cerr << std::endl;
      // Charge 0 stays unknown: -unknown_charge decides how such a spectrum
      // is tagged, and the charge source is reported per spectrum (and the
      // count after the loop, as for any input).
      if (ls.charge_unknown > 0)
        std::cerr << "Bruker timsTOF input: " << ls.charge_unknown << " of " << ls.spectra
                  << " MS2 spectra have no precursor charge (no monoisotopic peak found; their m/z is "
                     "that of the most intense isotope peak); tagged per -unknown_charge "
                  << getStringOption_("unknown_charge") << std::endl;
    }
    catch (const Exception::BaseException& e)
    {
      OPENMS_LOG_ERROR << "Cannot read '" << in << "': " << e.what() << std::endl;
      return INPUT_FILE_CORRUPT;
    }
  }

  std::unique_ptr<FASTag::IndexedMzMLReader> fastmz;
  if (!mzpeak_in && !mgf_in && !bruker_in && !vra && out_spectra.empty())
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
  const bool streaming = !mzpeak_in && !mgf_in && !bruker_in && !vra && !fastmz && ondisc->openFile(in);
  // Spectrum i of an mzML input: the per-spectrum reader or the fully
  // loaded map. For the SERIAL callers only; the tagging loop gives each
  // thread its own reader. (mzPeak is read in one pass, by MzPeakStream.)
  auto read_spectrum = [&](Size i) -> MSSpectrum {
    if (mgf) return mgf->getSpectrum(i);
    if (vra) return vra->getSpectrum(i);
    if (fastmz)
      return fastmz->getSpectrum(i, by_analyzer ? FASTag::IndexedMzMLReader::ALL_FIELDS |
                                                      FASTag::IndexedMzMLReader::STEP0_SCAN_EXTRAS
                                                : FASTag::IndexedMzMLReader::ALL_FIELDS);
    return streaming ? ondisc->getSpectrum(i) : exp[i];
  };
  if (!streaming && !mzpeak_in && !mgf_in && !bruker_in && !vra && !fastmz)
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
  if (vra) n_total = vra->getNrSpectra();

  // The analyzer of each spectrum (RunQC::factsOf): -qc_out counts MS2 per
  // analyzer and, 1.15.5, -tolerance_by_analyzer picks each MS2 spectrum's
  // tolerance from it. Built from the run's header once.
  FASTag::RunQC::InstrumentMap run_imap;
  if (by_analyzer || !getStringOption_("qc_out").empty())
  {
    namespace QC = FASTag::RunQC;
    // The class of an instrument's last analyser (the one MS2 is read out in).
    const auto last_analyzer = [](const Instrument& ins) {
      QC::Analyzer a = QC::Analyzer::UNKNOWN;
      Int order = std::numeric_limits<Int>::min();
      for (const MassAnalyzer& m : ins.getMassAnalyzers())
        if (m.getOrder() >= order)
        {
          order = m.getOrder();
          a = QC::analyzerFromType(m.getType());
        }
      return a;
    };
    if (mzs) run_imap.run_default = last_analyzer(mzs->settings().getInstrument());
    else if (vra)  // Thermo .raw: the reader's run settings (no mzML header to read)
    {
      if (auto rs = vra->getExperimentalSettings()) run_imap.run_default = last_analyzer(rs->getInstrument());
    }
    else if (bruker_in) run_imap.run_default = last_analyzer(exp.getInstrument());
    else if (!mgf_in)
    {
      const FASTag::Probe::MzmlHeader h = FASTag::Probe::readMzmlHeader(in);
      for (const auto& [id, name] : h.analyzer_of) run_imap.by_config[id] = QC::analyzerFromName(name);
      run_imap.default_config = h.default_config;
      if (!fastmz && !streaming) run_imap.run_default = last_analyzer(exp.getInstrument());
    }
  }
  // Is MS2 spectrum @p s ion trap? (filter string, then the scan's or the
  // run's instrument configuration; RunQC::factsOf)
  const auto is_itms = [&run_imap](const MSSpectrum& s) {
    return FASTag::RunQC::factsOf(s, run_imap).analyzer == FASTag::RunQC::Analyzer::ITMS;
  };

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
      src.ra = vra.get();
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
  bool ion_column = ion_mode == FASTag::IonSeries::Mode::CZ;
  if (ion_mode == FASTag::IonSeries::Mode::AUTO && FASTag::IonSeries::autoReadsActivation(mzpeak_in, mgf_in))
  {
    std::shared_ptr<PeakMap> od_meta;
    if (!fastmz && streaming) od_meta = ondisc->getMetaData();
    FASTag::IonSeries::ActivationCounts scan;
    for (size_t i = 0; i < n_total && scan.of(FASTag::IonSeries::Activation::ELECTRON) == 0
                       && !(hybrid_both && scan.of(FASTag::IonSeries::Activation::HYBRID) > 0); ++i)
    {
      MSSpectrum head;
      // Activation and filter string only (1.12.2): all activationClass() reads.
      if (fastmz) head = fastmz->getSpectrumMetadata(i, FASTag::IndexedMzMLReader::ACTIVATION_FIELDS);
      else if (vra) head = FASTag::Thermo::ms2Metadata(*vra, i);
      else if (od_meta) { if (i < od_meta->size()) head = (*od_meta)[i]; }
      else if (i < exp.size()) head = exp[i];
      if (head.getMSLevel() == 2) scan.add(FASTag::IonSeries::activationClass(head));
    }
    ion_column = FASTag::IonSeries::seriesColumn(ion_mode, scan, hybrid_both);
  }
  // The census layout of this run (Census::header() reads it; so does
  // -census_ids, which takes that header as the table's layout).
  FASTag::Census::runColumns().ion_series = ion_column;
  // 1.16 item 4: -census_score adds the pre-filter columns (and, after the
  // run, ident_score).
  const bool census_score_on = getFlag_("census") && getFlag_("census_score");
  FASTag::Census::runColumns().score = census_score_on;

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
  constexpr Size CLUSTERS = 8;  // 8 spectra each
  const Size probe_want = std::min<Size>(n_total, 64);
  const Size per_cluster = std::max<Size>(1, probe_want / CLUSTERS);
  const Size cluster_step = std::max<Size>(1, n_total / CLUSTERS);
  std::set<Size> probe_idx;
  for (Size c = 0; c < CLUSTERS; ++c)
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
      // 1.15.5: under -tolerance_by_analyzer on, ion-trap spectra with
      // analyzer information get their own tolerance; MGF carries none.
      if (tol > 0 && tightest > 20.0 * tol && (!by_analyzer || mgf_in))
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
  else tolerance_probe(read_spectrum);

  // 1.13 item 15: -complement_tolerance_unit auto (src/ComplementTol.h).
  // A probe of up to -complement_probe MS2 spectra, drawn uniformly over
  // the run with a fixed seed and read as the tagging pass reads them, is
  // tagged at seed length ComplTol::AUTO_PROBE_LENGTH with the default
  // preprocessing and search settings (ComplTol::probeParam: one file, one
  // window, whatever -tag_length or -no_deisotope) and the complement
  // window set to the whole measurement window, at the header charge (the precursor
  // hypotheses of -unknown_charge and -isotope_error are not probed);
  // the rank-1 tags at or below ComplTol::AUTO_MAX_EVALUE give the signed
  // complement errors, and their floor-corrected median and MAD give the
  // window (|median| + 1.96 x 1.4826 x MAD). Too few
  // pairs keep -complement_tolerance (Da). Not reached under Da or fragment.
  // The complement errors of a probe, tagged with ComplTol::probeParam of
  // @p by_base (and @p cz_base for spectra the tagging pass reads as
  // c/z-dot): the estimate and the number of confident probe spectra.
  // Shared by the run's auto window and, 1.15.5, the ion-trap window of
  // -tolerance_by_analyzer.
  struct ComplProbe
  {
    FASTag::ComplTol::Estimate est;
    Size n_conf = 0;
  };
  const auto measure_complement = [&](const std::vector<MSSpectrum>& probe_specs, const FASTag::Param& by_base,
                                      const FASTag::Param* cz_base, double window) {
    namespace CT = FASTag::ComplTol;
    const FASTag::Param probe_by = CT::probeParam(by_base, window);
    const FASTag::Tables probe_tab_by(probe_by);
    const bool any_cz = cz_base != nullptr;
    const FASTag::Param probe_cz = any_cz ? CT::probeParam(*cz_base, window) : probe_by;
    const FASTag::Tables probe_tab_cz(probe_cz);
    std::vector<std::vector<double>> per_spec(probe_specs.size());
    std::vector<char> confident(probe_specs.size(), 0);
    // An exception must not leave the OpenMP region (std::terminate): each
    // iteration stores its own and the first is rethrown after the loop.
    std::vector<std::exception_ptr> probe_failed(probe_specs.size());
#pragma omp parallel for schedule(dynamic, 8)
    for (std::ptrdiff_t k = 0; k < static_cast<std::ptrdiff_t>(probe_specs.size()); ++k)
    {
      try
      {
        const MSSpectrum& s = probe_specs[static_cast<Size>(k)];
        const Precursor& pc = s.getPrecursors().front();
        // The series rule of the tagging pass (IonSeries::seriesInRun).
        const FASTag::IonSeries::Series sr =
            FASTag::IonSeries::seriesInRun(ion_mode, FASTag::IonSeries::activationClass(s), ion_column);
        const bool cz = any_cz && sr == FASTag::IonSeries::Series::CZ;
        const FASTag::Param& pp = cz ? probe_cz : probe_by;
        const std::vector<FASTag::Tag> tg =
            FASTag::tagSpectrum(s, pc.getMZ(), pc.getCharge(), pp, cz ? probe_tab_cz : probe_tab_by);
        if (tg.empty() || !(tg.front().evalue <= CT::AUTO_MAX_EVALUE)) continue;
        confident[static_cast<Size>(k)] = 1;
        const MSSpectrum prep = FASTag::preparedPeaks(s, pc.getMZ(), pc.getCharge(), pp);
        CT::collectErrors(prep, pc.getMZ(), pc.getCharge(), tg.front(), FASTag::ComplementSpec::fromParam(pp),
                          window, per_spec[static_cast<Size>(k)]);
      }
      catch (...)
      {
        probe_failed[static_cast<Size>(k)] = std::current_exception();
      }
    }
    for (const std::exception_ptr& e : probe_failed)
      if (e) std::rethrow_exception(e);
    std::vector<double> errors;
    for (const auto& v : per_spec) errors.insert(errors.end(), v.begin(), v.end());
    ComplProbe r;
    r.est = CT::estimate(errors, window);
    r.n_conf = static_cast<Size>(std::count(confident.begin(), confident.end(), char(1)));
    return r;
  };
  // The probe draw: a uniform draw of 4x the probe size over all spectra
  // (MS1 included; the level is known only once read), every one read; of
  // the MS2 among them that @p keep accepts, a second uniform draw keeps the
  // probe size (ComplTol::pickProbe), so the probe spans the whole run.
  // mzPeak input (read in one pass by MzPeakStream) reads the same
  // candidates in a pass of its own before the tagging pass
  // (readMzPeakSpectra, centroided as the tagging pass centroids) and keeps
  // the accepted ones, so the probe is the one the same run read as mzML
  // draws. @p pass_s, when given, receives that pass's wall time.
  const auto draw_probe = [&](Size want, auto&& keep, double* pass_s = nullptr) {
    namespace CT = FASTag::ComplTol;
    const FASTag::SampleMask cand = FASTag::sampleByCount(n_total, std::min<Size>(n_total, 4 * want), 0x434F4D50u);
    const auto accept = [&keep](const MSSpectrum& s) {
      return s.getMSLevel() == 2 && !s.empty() && !s.getPrecursors().empty() && keep(s);
    };
    std::vector<Size> ms2_idx;
    std::map<Size, MSSpectrum> held;  // mzPeak: the accepted candidates, as read
    if (mzs)
    {
      const auto a = std::chrono::steady_clock::now();
      std::vector<Size> cand_idx;
      for (Size i = 0; i < n_total; ++i)
        if (cand[i]) cand_idx.push_back(i);
      Size k = 0;
      FASTag::readMzPeakSpectra(
          in, mzpeak_decode_threads, cand_idx,
          [&](MSSpectrum& s) {
            const Size i = cand_idx[k++];
            if (!accept(s)) return;
            ms2_idx.push_back(i);
            held.emplace(i, std::move(s));
          },
          pick_mzpeak);
      if (pass_s) *pass_s = std::chrono::duration<double>(std::chrono::steady_clock::now() - a).count();
    }
    else
    {
      for (Size i = 0; i < n_total; ++i)
      {
        if (!cand[i]) continue;
        if (accept(read_spectrum(i))) ms2_idx.push_back(i);
      }
    }
    std::vector<MSSpectrum> probe_specs;
    probe_specs.reserve(want);
    for (const Size i : CT::pickProbe(ms2_idx, want, 0x50524F42u))
    {
      MSSpectrum s = mzs ? std::move(held.at(i)) : read_spectrum(i);
      s.sortByPosition();
      probe_specs.push_back(std::move(s));
    }
    return probe_specs;
  };
  if (compl_auto)
  {
    namespace CT = FASTag::ComplTol;
    const Size want = static_cast<Size>(getIntOption_("complement_probe"));
    const double window = CT::measurementWindow(p.frag_tol, p.tol_ppm);
    const std::vector<MSSpectrum> probe_specs = draw_probe(want, [](const MSSpectrum&) { return true; });
    const ComplProbe cp =
        measure_complement(probe_specs, len_params.front(), len_params_cz.empty() ? nullptr : &len_params_cz.front(),
                           window);
    const CT::Estimate& est = cp.est;
    const Size n_conf = cp.n_conf;
    // -complement_tolerance is the fallback and the lower bound
    // (ComplTol::inForce): auto only widens the window.
    const double fallback = p.complement_tol;
    const double in_force = CT::inForce(est, fallback);
    const bool raised = est.ok && in_force > est.tol;
    const std::string source = !est.ok ? "fallback" : raised ? "lower_bound" : "measured";
    if (in_force != fallback)
    {
      p.complement_tol = in_force;
      for (FASTag::Param& lp : len_params) lp.complement_tol = in_force;
      for (FASTag::Param& lp : len_params_cz) lp.complement_tol = in_force;
      p_cz.complement_tol = in_force;
      hyp_cs = FASTag::ComplementSpec::fromParam(p);
      hyp_cs_cz = FASTag::ComplementSpec::fromParam(p_cz);
    }
    // stderr, not stdout (nothing new may reach stdout or the gate's
    // summary line); the same values go to every Versioned run report
    // (format 6 rows) and to the -out_spectra mzML provenance below. The
    // window in force at full precision, so it can be given back as
    // -complement_tolerance and reproduce the run.
    const auto full = [](double v) {
      std::ostringstream o;
      o << std::setprecision(17) << v;
      return o.str();
    };
    const std::string tol_txt = full(in_force);
    std::ostringstream probe_txt;
    probe_txt << probe_specs.size() << " MS2, " << n_conf << " confident tags, " << est.n << " pairs within "
              << window << " Da (signal " << std::lround(est.signal);
    if (est.ok) probe_txt << ", median error " << est.median << " Da, MAD " << est.mad << " Da";
    probe_txt << ")";
    std::cerr << "Complement tolerance (auto): ";
    if (!est.ok) std::cerr << "not measured, using -complement_tolerance " << tol_txt << " Da";
    else
      std::cerr << "measured " << full(est.tol) << " Da, in force " << tol_txt << " Da"
                << (raised ? " (not below -complement_tolerance)" : "");
    std::cerr << "; probe " << probe_txt.str() << (est.ok ? std::string() : "; " + est.why) << std::endl;
    run_meta.complement_tol_auto = true;
    run_meta.complement_tol_measured = est.ok;
    run_meta.complement_tol = in_force;
    run_meta.complement_tol_source = source;
    run_meta.complement_tol_measured_value = est.ok ? est.tol : 0.0;
    run_meta.complement_tol_window = window;
    run_meta.complement_probe_ms2 = probe_specs.size();
    run_meta.complement_probe_confident = n_conf;
    run_meta.complement_probe_pairs = est.n;
    run_meta.complement_probe_signal = est.signal;
    run_meta.complement_probe_median = est.median;
    run_meta.complement_probe_mad = est.mad;
    run_meta.complement_tol_why = est.why;
    compl_auto_rec_.on = true;
    compl_auto_rec_.tol = tol_txt;
    compl_auto_rec_.source = source;
    compl_auto_rec_.measured = est.ok ? full(est.tol) : std::string();
    compl_auto_rec_.probe = probe_txt.str() + (est.ok ? std::string() : "; " + est.why);
  }

  // Resolve the experimental gate once, before any production tag is
  // selected. A fixed, deterministic probe is independent of worker order.
  if (tmt_mode == "auto")
  {
    namespace TP = FASTag::TmtPseudo;
    TP::ProbeCounts counts;
    std::size_t probed = 0;
    if (p.tol_ppm)
    {
      const auto mask = FASTag::sampleByCount(n_total, std::min<std::size_t>(n_total, 4 * TP::PROBE_COUNT), 0x544D5431u);
      std::vector<std::size_t> candidates;
      for (std::size_t i = 0; i < n_total; ++i)
      {
        if (!mask[i]) continue;
        const MSSpectrum s = read_spectrum(i);
        if (s.getMSLevel() == 2 && !s.empty() && !s.getPrecursors().empty()
            && s.getPrecursors().front().getCharge() > 0) candidates.push_back(i);
      }
      FASTag::Param probe = p;
      probe.tag_length = 4;
      probe.max_extension = 0;
      probe.max_gaps = 0;
      probe.max_tag_count = 50;
      probe.max_evalue = 1.0;
      probe.tmt_pseudo_filter = false;
      probe.tmt_reporter_filter = false;
      probe.diversity = false;
      probe.per_residue_conf = false;
      probe.ion_pair = FASTag::IonSeries::ionPair(FASTag::IonSeries::Series::BY);
      const FASTag::Tables probe_tables(probe);
      for (const std::size_t i : FASTag::ComplTol::pickProbe(candidates, TP::PROBE_COUNT, 0x544D5432u))
      {
        MSSpectrum s = read_spectrum(i);
        const auto series = FASTag::IonSeries::seriesInRun(ion_mode, FASTag::IonSeries::activationClass(s), ion_column);
        if (series != FASTag::IonSeries::Series::BY) continue;
        s.sortByPosition();
        const Precursor& pc = s.getPrecursors().front();
        counts.add(FASTag::tagSpectrum(s, pc.getMZ(), pc.getCharge(), probe, probe_tables));
        ++probed;
      }
    }
    p.tmt_pseudo_filter = counts.detected(p.tol_ppm);
    for (FASTag::Param& lp : len_params) lp.tmt_pseudo_filter = p.tmt_pseudo_filter;
    // Other ion series remain unfiltered, even in a mixed-activation run.
    tmt_filter_rec_ = std::string(p.tmt_pseudo_filter ? "on" : "off") + "; " + counts.reason(p.tol_ppm)
      + "; probed=" + std::to_string(probed) + "; " + counts.summary()
      + "; reporters=" + (p.tmt_reporter_filter && p.tmt_pseudo_filter ? "on" : "off");
    run_meta.tmt_filter_resolved = tmt_filter_rec_;
    std::cerr << "TMT pseudo-filter (auto): " << tmt_filter_rec_ << std::endl;
  }

  // 1.15.5 change B (-tolerance_by_analyzer on): ion-trap MS2 spectra are
  // tagged with -fragment_tolerance_itms (Da). Their complement window
  // follows change A: a complement option given on the command line is kept;
  // otherwise the window is measured (auto) on a probe of the run's
  // ion-trap spectra only, so a mixed run measures each analyzer class on
  // its own spectra. A run whose probe draw has no ion-trap spectrum keeps
  // every Param as before (byte-identical tags); an ion-trap spectrum found
  // later in such a run still gets the ion-trap tolerance, with the
  // -complement_tolerance window. Not under -stream. mzPeak input (read in
  // one pass) draws the same probe in a pass of its own (draw_probe); an
  // archive without filter strings or analyzer metadata (OpenMS before
  // OpenMS/OpenMS#10955 drops the filter string) finds no ion-trap MS2 and
  // keeps its tags.
  itms_on_ = false;
  if (by_analyzer)
  {
    namespace CT = FASTag::ComplTol;
    const Size want = static_cast<Size>(getIntOption_("complement_probe"));
    double mzpeak_pass_s = 0;
    const std::vector<MSSpectrum> it_specs = draw_probe(want, is_itms, &mzpeak_pass_s);
    if (mzs)
      std::cerr << "Tolerance by analyzer: mzPeak probe pass " << std::fixed << std::setprecision(2) << mzpeak_pass_s
                << std::defaultfloat << " s" << std::endl;
    FASTag::Param base_it = len_params.front();
    base_it.frag_tol = itms_tol;
    base_it.tol_ppm = false;
    const bool compl_given = optionGiven_("complement_tolerance_unit") || optionGiven_("complement_tolerance") ||
                             optionGiven_("complement_tol_factor");
    double it_compl = p.complement_tol;   // a given -complement_tolerance (Da) or the run's auto window
    std::string it_source = compl_given ? "given" : "fallback";
    if (!compl_given)
    {
      // As ComplTol::inForce: -complement_tolerance is the fallback and lower bound.
      it_compl = getDoubleOption_("complement_tolerance");
      base_it.complement_tol_mode = FASTag::ComplementTolMode::DA;
      base_it.complement_tol = it_compl;
      if (!it_specs.empty())
      {
        const double window = CT::measurementWindow(itms_tol, false);
        FASTag::Param cz_it;
        if (!len_params_cz.empty())
        {
          cz_it = len_params_cz.front();
          cz_it.frag_tol = itms_tol;
          cz_it.tol_ppm = false;
        }
        const ComplProbe cp = measure_complement(it_specs, base_it, len_params_cz.empty() ? nullptr : &cz_it, window);
        it_compl = CT::inForce(cp.est, it_compl);
        it_source = !cp.est.ok ? "fallback" : it_compl > cp.est.tol ? "lower_bound" : "measured";
        itms_log_ = "probe " + std::to_string(it_specs.size()) + " ion-trap MS2, " + std::to_string(cp.n_conf) +
                    " confident tags, " + std::to_string(cp.est.n) + " pairs";
      }
    }
    {
      len_params_it = len_params;
      for (FASTag::Param& lp : len_params_it)
      {
        lp.frag_tol = itms_tol;
        lp.tol_ppm = false;
        if (!compl_given)
        {
          lp.complement_tol_mode = FASTag::ComplementTolMode::DA;
          lp.complement_tol = it_compl;
        }
      }
      len_params_cz_it = len_params_cz;
      for (FASTag::Param& lp : len_params_cz_it)
      {
        lp.frag_tol = itms_tol;
        lp.tol_ppm = false;
        if (!compl_given)
        {
          lp.complement_tol_mode = FASTag::ComplementTolMode::DA;
          lp.complement_tol = it_compl;
        }
      }
      itms_on_ = true;
    }
    std::ostringstream o;
    o << "Tolerance by analyzer: ion-trap MS2 at " << itms_tol << " Da, complement window " << it_compl << " Da ("
      << it_source << (itms_log_.empty() ? "" : "; " + itms_log_) << "); other MS2 at " << p.frag_tol
      << (p.tol_ppm ? " ppm" : " Da") << ". The probe draw found " << it_specs.size() << " ion-trap MS2.";
    itms_log_ = o.str();
    std::cerr << itms_log_ << std::endl;
  }

  const auto t_tables_a = std::chrono::steady_clock::now();
  g_t_probe = std::chrono::duration<double>(t_tables_a - t_probe_a).count();
  const std::vector<FASTag::Tables> tables = build_tables();
  // #15 phase B: the c/z-dot tables (empty under by).
  const std::vector<FASTag::Tables> tables_cz =
      cz_tables ? build_tables(FASTag::IonSeries::Series::CZ) : std::vector<FASTag::Tables>();
  // 1.15.5 change B: the tables of ion-trap spectra (empty when off), and
  // the complement test their precursor hypotheses count with.
  const std::vector<FASTag::Tables> tables_it =
      itms_on_ ? build_tables(FASTag::IonSeries::Series::BY, true) : std::vector<FASTag::Tables>();
  const std::vector<FASTag::Tables> tables_cz_it =
      itms_on_ && cz_tables ? build_tables(FASTag::IonSeries::Series::CZ, true) : std::vector<FASTag::Tables>();
  const FASTag::ComplementSpec hyp_cs_it = itms_on_ ? FASTag::ComplementSpec::fromParam(len_params_it.front()) : hyp_cs;
  const FASTag::ComplementSpec hyp_cs_cz_it =
      itms_on_ && !len_params_cz_it.empty() ? FASTag::ComplementSpec::fromParam(len_params_cz_it.front()) : hyp_cs_cz;
  std::atomic<size_t> n_ms2_itms{0}, n_ms2_other{0};
  // 1.13 #22: -alkylation_tags_out's shadow pass, one Param and one set of
  // tables per seed length (AlkylationTags::shadowParam); empty when off.
  std::vector<FASTag::Alkylation::Form> alkt_cands;
  std::vector<FASTag::Param> alkt_params;
  std::vector<FASTag::Tables> alkt_tables;
  std::vector<std::string> alkt_dropped;
  // The shadow alphabet's other residue steps, for the twin and alias checks.
  std::vector<FASTag::AlkylationTags::Step> alkt_alpha;
  // Review n1/n2: the per-vote checks (aliases against the spectrum, the
  // twin windows at the C edge's m/z).
  FASTag::AlkylationTags::VoteContext alkt_ctx;
  const char* const alkt_opt = alkylation_on ? "-alkylation_out" : "-alkylation_tags_out";
  if (alkylation_shadow_on)
  {
    try { alkt_cands = FASTag::AlkylationTags::candidates(FASTag::Alkylation::forms()); }
    catch (const std::exception& e)
    {
      OPENMS_LOG_ERROR << alkt_opt << ": " << e.what() << "." << std::endl;
      return INTERNAL_ERROR;
    }
    for (const FASTag::Param& lp : len_params)
      alkt_params.push_back(FASTag::AlkylationTags::shadowParam(lp, alkt_cands, alkt_params.empty() ? &alkt_dropped : nullptr));
    // The tagger indexes its alphabet with 8 bits; the five alternatives
    // must not push a large -variable_modifications list past it.
    if (FASTag::AlkylationTags::alphabetSize(alkt_params.front().mods) > 255)
    {
      OPENMS_LOG_ERROR << alkt_opt << ": the variable modifications and the five C alternatives make more "
                          "than 255 residue entries; give fewer -variable_modifications." << std::endl;
      return ILLEGAL_PARAMETERS;
    }
    alkt_alpha = FASTag::AlkylationTags::alphabet(alkt_params.front().mods);
    alkt_ctx = FASTag::AlkylationTags::voteContext(alkt_params.front(), alkt_cands, &alkt_alpha);
    alkt_tables.reserve(alkt_params.size());
    for (const FASTag::Param& lp : alkt_params) alkt_tables.emplace_back(lp);
  }
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
    const Size n_check = vra ? vra->getNrSpectra() : streaming ? ondisc->getNrSpectra() : exp.size();
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
    if (!alk_manifest.empty()) guard.input("alkylation_proteome", alk_manifest);
    // -recon_proteome's shipped file (its manifest is alk_manifest above).
    if (!recon_prot_path.empty()) guard.input("recon_proteome", recon_prot_path);
    // Inputs resolved from defaults: the shipped digest tables loaded above,
    // and the bundled taxonomy -species reads when no -taxdb set is given.
    for (const auto& ri : resolved_inputs) guard.input(ri.first.c_str(), ri.second);
    if (want_species && getStringOption_("taxdb").empty() && getStringOption_("taxonomy_nodes").empty()
        && getStringOption_("taxonomy_names").empty())
    {
      const std::string tdir = taxonomyDir_();
      if (!tdir.empty())
      {
        const std::string tdb = FASTag::TaxIndex::findInDir(tdir);
        if (!tdb.empty()) guard.input("taxdb (bundled)", tdb);
        for (const auto& tf : {std::make_pair("taxonomy_nodes (bundled)", "/nodes.dmp"),
                               std::make_pair("taxonomy_names (bundled)", "/names.dmp")})
          if (File::exists(tdir + tf.second)) guard.input(tf.first, tdir + tf.second);
      }
    }
    // ---- 1.12 F: guarded inputs ----
    if (getFlag_("census")) guard.input("census_ids", getStringOption_("census_ids"));
    guard.output("out", out);
    guard.output("out_spectra", out_spectra);
    guard.output("recon_out", recon_out);
    guard.output("delta_out", delta_out);
    guard.output("delta_spectra_out", delta_spectra_out);
    guard.output("delta_counts_out", delta_counts_out);
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
      guard.output("glyco_out", g.empty() ? defaultReportPath_(out, ".glyco.tsv") : g);
    }
    if (want_species)
    {
      const std::string sp = getStringOption_("species_out");
      guard.output("species_out", sp.empty() ? defaultReportPath_(out, ".species.tsv") : sp);
    }
    // Outputs are checked in this order. Each 1.12 cluster adds its rows
    // at its own anchor.
    // ---- 1.12 E: output paths ----
    // ---- 1.12 A: output paths ----
    guard.output("shortlist_out", shortlist_out, true);
    guard.output("fasta_out", fasta_out, true);
    guard.output("search_config_out", search_config_out, true);
    // ---- 1.12 D: output paths ----
    guard.output("alkylation_out", alkylation_out, true);
    guard.output("alkylation_tags_out", alkylation_tags_out, true);  // 1.13 #22
    // ---- 1.12 F: output paths ----
    if (getFlag_("census"))
    {
      const std::string c = getStringOption_("census_out");
      const std::string cs = getStringOption_("census_summary_out");
      // -census_ids joins the finished <census_out>.part into a .part of
      // that .part (a PartFile on the temporary path), so that path is
      // checked too.
      guard.output("census_out", c.empty() ? defaultReportPath_(out, ".census.tsv") : c, /*via_part=*/true,
                   /*part_of_part=*/!getStringOption_("census_ids").empty() || getFlag_("census_score"));
      if (getFlag_("census_score")) guard.output("census_sorted_out", getStringOption_("census_sorted_out"), true);
      guard.output("census_summary_out", cs.empty() ? defaultReportPath_(out, ".census_summary.tsv") : cs,
                   /*via_part=*/true);
    }
    // ---- 1.16 QC: output paths ----
    guard.output("qc_out", getStringOption_("qc_out"), /*via_part=*/true);
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
  const bool census_ids_exact = census_ids_on && getFlag_("census_ids_exact");  // 1.16 item 4
  if (census_ids_exact && subsampling)
  {
    OPENMS_LOG_ERROR << "-census_ids_exact needs every spectrum read: it cannot be combined with subsampling."
                     << std::endl;
    return ILLEGAL_PARAMETERS;
  }
  census_ids_index.setExact(census_ids_exact);
  if (census_ids_on)
  {
    census_ids_loaded = FASTag::CensusIds::load(census_ids, census_ids_fdr, census_ids_index,
                                                FASTag::CensusIds::acceptOf(getStringOption_("census_ids_accept")));
    if (!census_ids_loaded.refusal.empty())
    {
      OPENMS_LOG_ERROR << census_ids_loaded.refusal << std::endl;
      return INCOMPATIBLE_INPUT_DATA;
    }
    census_ids_run_check = FASTag::CensusIds::runCheck(census_ids_loaded, in);
    if (census_ids_exact)
    {
      // The checks that need no spectrum: before any output is opened.
      const std::string why = FASTag::CensusIds::exactRefusal(census_ids_loaded, census_ids_index,
                                                              FASTag::CensusIds::Index::Counts{},
                                                              census_ids_run_check);
      if (!why.empty())
      {
        OPENMS_LOG_ERROR << why << std::endl;
        return INCOMPATIBLE_INPUT_DATA;
      }
    }
    if (census_ids_run_check == "mismatch")
      OPENMS_LOG_WARN << "Warning: -census_ids names the run '" << census_ids_loaded.runs.front() << "', -in is '"
                      << FASTag::CensusIds::runStem(in) << "'; the spectrum references are matched anyway."
                      << std::endl;
    using FASTag::CensusIds::Accept;
    OPENMS_LOG_INFO << "Census ids: " << census_ids_loaded.n_accepted << " of " << census_ids_loaded.n_ids
                    << " spectrum identifications ";
    if (census_ids_loaded.accept == Accept::QVALUE) OPENMS_LOG_INFO << "pass q <= " << census_ids_fdr;
    else if (census_ids_loaded.accept == Accept::THRESHOLD)
      OPENMS_LOG_INFO << "hold a target hit that passes the file's own threshold (-census_ids_accept threshold, no FDR)";
    else OPENMS_LOG_INFO << "hold a target hit (-census_ids_accept all, no FDR)";
    OPENMS_LOG_INFO << " (" << census_ids << ")" << std::endl;
    if (census_ids_loaded.n_ref_title > 0)
      OPENMS_LOG_INFO << "Census ids: " << census_ids_loaded.n_ref_title
                      << " of them name their spectrum by the NativeID in the spectrum title." << std::endl;
  }

  std::ofstream tsv(out.c_str());
  if (!tsv)
  {
    OPENMS_LOG_ERROR << "Cannot open output file " << out << " for writing." << std::endl;
    return CANNOT_WRITE_OUTPUT_FILE;
  }
  const bool want_proforma = getFlag_("proforma");
  tsv << tagHeader_(want_proforma, p.per_residue_conf, !usi_prefix.empty(), hyp_on, ion_column, terminus_on,
                    fasta_proteins > 0);
  // -terminus: the run's termini (its terminal modifications, residues and
  // precursor isotope offsets).
  std::vector<std::string> mod_names = getStringList_("fixed_modifications");
  for (const std::string& nm : getStringList_("variable_modifications")) mod_names.push_back(nm);
  const FASTag::Terminus::Termini termini = terminus_on
      ? FASTag::Terminus::terminiOfRun(p.mods, mod_names, hyp_param.isotope_errors)
      : FASTag::Terminus::Termini();

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
    if (glyco_out.empty()) glyco_out = defaultReportPath_(out, ".glyco.tsv");
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
  if (census_out.empty()) census_out = defaultReportPath_(out, ".census.tsv");
  if (census_summary_out.empty()) census_summary_out = defaultReportPath_(out, ".census_summary.tsv");
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

  // -qc_out (1.16, src/RunQC.h): collected in the tagging loop from every
  // spectrum read; resolution from a sample of profile spectra afterwards.
  const std::string qc_out = getStringOption_("qc_out");
  const bool qc_on = !qc_out.empty();
  const unsigned qc_fields = qc_on || by_analyzer ? FASTag::IndexedMzMLReader::STEP0_SCAN_EXTRAS : 0u;
  std::unique_ptr<FASTag::RunQC::Collector> qc;
  if (qc_on)
  {
    namespace QC = FASTag::RunQC;
    qc = std::make_unique<QC::Collector>(n_total, QC::InstrumentMap(run_imap), static_cast<size_t>(read_threads),
                                         p.frag_tol, p.tol_ppm);
  }

  const std::string proforma_fixed =
      want_proforma ? buildProformaPrefix_(p.mods) : std::string();

  PeakMap kept;
  if (mzs) kept.getExperimentalSettings() = mzs->settings();
  else if (mgf) kept.getExperimentalSettings() = mgf->settings();
  else if (vra)
  {
    if (auto meta = vra->getExperimentalSettings()) kept.getExperimentalSettings() = *meta;
  }
  else if (streaming)
  {
    if (auto meta = ondisc->getMetaData()) kept.getExperimentalSettings() = *meta;
  }
  else kept.getExperimentalSettings() = exp.getExperimentalSettings();

  // -qc_out: instrument model, serial number and acquisition start, from the
  // run settings OpenMS's readers fill. The fast mzML reader skips the
  // header, so it is read alone (parsing stops at the spectrumList).
  if (qc)
  {
    if (mgf_in) qc->setRunInfo({}, "MGF carries no run metadata");
    else if (fastmz)
    {
      try
      {
        PeakMap head;
        MzMLFile mf;
        mf.getOptions().setMetadataOnly(true);
        mf.load(in, head);
        qc->setRunInfo(FASTag::RunQC::runInfoOf(head.getExperimentalSettings()));
      }
      catch (const Exception::BaseException& e)
      {
        OPENMS_LOG_WARN << "-qc_out: could not read the run header of " << in << " (" << e.what()
                        << "); instrument and start time are reported n/a." << std::endl;
        qc->setRunInfo({}, "the run header could not be read");
      }
    }
    else qc->setRunInfo(FASTag::RunQC::runInfoOf(kept.getExperimentalSettings()));
  }

  // ---- phase 6: the tagging loop -----------------------------------------

  size_t n_ms2 = 0, n_tags = 0, n_reported = 0, n_subsumed = 0;
  size_t n_untaggable_msn = 0;  // 1.16: MS2 without peaks or a precursor, and non-MS2 with a precursor
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
  // One block's results at block-local indices. There are RING of them: the
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
    /// -species: per spectrum, every row incl. the ones -subsume_tags left
    /// out of -out (SpecResult::sbuf), when it left any out; else empty.
    std::vector<std::string> species_rows;
    std::vector<char> keep, keep_target;
    /// #15 phase B: per spectrum, whether its rows were read as c/z-dot
    /// ions (SpecResult::cz); every row of a spectrum shares its series.
    /// -species leaves these rows out and counts them; no reader finds the
    /// ion_series column by position.
    std::vector<char> row_cz;
    /// 1.13 item 10: per row, for a two-pass hybrid spectrum only (empty
    /// otherwise): 1 for a c/z-dot row, which -species leaves out.
    std::vector<std::vector<char>> row_series;
    FASTag::ClusterAcc::ClusterBlock acc;  ///< 1.12 per-cluster slots (src/ClusterAcc.h)
  };
  // Three: a fourth only helped within noise, for another block of rows
  // held in memory.
  constexpr size_t RING = 3;
  Block blocks[RING];
  for (Block& b : blocks) b.acc.f.census = census_on;
  // Two-pass -out_spectra, whatever the formats: record kept INPUT indices
  // during tagging, re-read and stream them to the writer at the end. Every
  // reader here is indexed, so nothing is held during tagging.
  const bool want_out = !out_spectra.empty();
  std::vector<Size> kept_idx;
  // One spectrum's delta sample: its placement's gap and interpretation.
  struct DeltaSample
  {
    double delta = 0.0;
    std::string interp;
    // 1.16 (-delta_out only): whether the placement has a gap to localize,
    // its site class (ShiftSurvey::siteKey; empty = unlocalized) and the
    // peptide's mass (the ppm scale of the name tolerance).
    bool gap = false;
    std::string site;
    double pep_mass = 0.0;
    // -delta_spectra_out only: the spectrum, the placement and the site.
    size_t index = 0;
    std::string native_id, peptide;
    int site_pos = -1;  ///< 0-based in peptide, -1 = none
    int loc_evidence = 0;
    double evalue = 0.0;
    // 1.16b provenance and classes (-delta_out; the strings only with
    // -delta_spectra_out). The site above follows -delta_loc_model and
    // -delta_loc_min_evidence.
    bool region_gap = false;       ///< a gap with residues between the tag and the terminus
    bool precursor_flank = false;  ///< the gap's flank is the precursor less a fragment
    bool charge_assumed = false;   ///< the precursor gave no charge; tagged and localized as 2+
    bool exact_vs_gapped = false;  ///< the selected tag also has an exact (or a gapped) placement
    std::uint8_t loc_class = 0;    ///< ShiftSurvey::LocClass
    std::uint8_t obs_class = 0;    ///< ShiftSurvey::ObsClass
    std::string tag, protein, placements, obs_detail, charge_src, null_class;
    char gap_side = '-';
    bool reversed = false;
    int pos = 0, region_lo = 0, region_hi = -1, charge = 2, prec_iso = 0;
    int loc_score = 0, loc_ties = 0, loc_excluded = 0, null_evidence = 0;
    int n_placements = 0, n_exact = 0, n_gapped = 0, n_peptides = 0, tag_support = 0, tags_placed = 0;
  };
  // Per-thread accumulators, summed after the loop. One cache-line-aligned
  // struct per thread, so neighbouring threads' counters never share a line.
  struct alignas(64) PerThread
  {
    std::map<int, std::pair<size_t, size_t>> len;  ///< length -> (seen, matched)
    size_t ms2 = 0, tags = 0, reported = 0, subsumed = 0;
    size_t untaggable_msn = 0;  ///< spectra not tagged although MS2 or with a precursor
    size_t no_charge = 0;  ///< MS2 whose precursor carries no charge (tagged as 2+)
    size_t multi_charge = 0;  ///< ... of them, those listing several possible charges
    size_t mz0_target = 0;  ///< OpenMS-read spectra whose selected-ion m/z 0 became the isolation target
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
    // 1.16b -delta_counts_out: MS2 with a selected-hypothesis tag that
    // reached placement, and of them those with at least one placement.
    size_t delta_tagged = 0, delta_placed = 0;
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
    // -check_header_charge: spectra ms1_lo..ms1_hi are known to hold no MS1
    // scan; with ms1_has, the scan at ms1_lo - 1 is one and is kept in ms1.
    MSSpectrum ms1;
    size_t ms1_lo = 1, ms1_hi = 0;
    bool ms1_has = false;
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
    bool any_target = false;  ///< at least one non-entrapment tag the filter keeps (written or subsumed)
    /// -species when -subsume_tags dropped rows of the spectrum: every row,
    /// written or not, in row order (Block::species_rows); empty otherwise,
    /// and then the species pass reads the written rows (buf).
    std::string sbuf;
    /// Per row the species pass reads (sbuf when set, else buf): may it be
    /// species evidence (Block::row_species).
    std::vector<char> row_species;
    /// -recon_id_out: the spectrum's identification, when it placed anything.
    std::vector<PeptideIdentification> ids;
    /// -census: the spectrum's census row (an MS2 spectrum read, census_on only).
    bool census = false;
    FASTag::Census::Row census_row;
    /// #15 phase B: the rows were read as c/z-dot ions (Block::row_cz).
    bool cz = false;
    /// 1.13 item 10: per written row of a two-pass hybrid spectrum, 1 for a
    /// c/z-dot row (Block::row_series); empty for every other spectrum.
    std::vector<char> row_series;
    /// -qc_out (1.16): the best reported tag of the selected hypothesis, as
    /// the census takes it (Census::bestTag); infinity when none.
    double qc_best_e = std::numeric_limits<double>::infinity();
    std::string qc_best_tag;
  };

  // 1.13 -check_header_charge: the MS1 scan before spectrum @p index, at
  // most MS1_BACK spectra back, else nullptr. The answer depends on the
  // file only, never on which thread asks or what it read before.
  constexpr size_t MS1_BACK = 512;
  std::function<MSSpectrum(size_t tid, size_t j, bool peaks)> ms1_read;  // set once the readers exist
  auto ms1_for = [&](size_t tid, size_t index) -> const MSSpectrum*
  {
    if (!ms1_read) return nullptr;
    PerThread& q = per_thread[tid];
    const size_t stop = index > MS1_BACK ? index - MS1_BACK : 0;
    for (size_t j = index; j-- > stop;)
    {
      if (j >= q.ms1_lo && j <= q.ms1_hi)  // scanned before: skip to its lower end
      {
        if (!q.ms1_has) { j = q.ms1_lo; continue; }
        q.ms1_hi = std::max(q.ms1_hi, index);
        return q.ms1_lo - 1 >= stop ? &q.ms1 : nullptr;
      }
      if (ms1_read(tid, j, false).getMSLevel() != 1) continue;
      try { q.ms1 = ms1_read(tid, j, true); }
      catch (const Exception::BaseException&) { q.ms1 = MSSpectrum(); }  // unreadable MS1: no MS1 evidence
      q.ms1_lo = j + 1; q.ms1_hi = index; q.ms1_has = true;
      return &q.ms1;
    }
    q.ms1_lo = stop; q.ms1_hi = index; q.ms1_has = false;
    return nullptr;
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
      crow.tic = sig.tic;
      crow.has_xrea = sig.has_xrea;
      crow.xrea = sig.xrea;
    }
    if (spec.getMSLevel() != 2 || spec.empty() || spec.getPrecursors().empty())
    {
      if (spec.getMSLevel() == 2 || !spec.getPrecursors().empty()) ++per_thread[tid].untaggable_msn;
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
    const FASTag::IonSeries::Series read_series = FASTag::IonSeries::seriesInRun(ion_mode, act, ion_column);
    const bool read_cz = read_series == FASTag::IonSeries::Series::CZ;
    // 1.15.5 change B: an ion-trap spectrum takes the ion-trap Params.
    const bool spec_itms = itms_on_ && is_itms(spec);
    (spec_itms ? n_ms2_itms : n_ms2_other).fetch_add(1, std::memory_order_relaxed);
    const FASTag::ComplementSpec& cs_by = spec_itms ? hyp_cs_it : hyp_cs;
    const FASTag::ComplementSpec& cs_cz = spec_itms ? hyp_cs_cz_it : hyp_cs_cz;
    // 1.13 item 10: a hybrid spectrum under auto + -ion_series_hybrid both
    // (read_series is b/y) gets a second, c/z-dot pass; its rows keep their
    // series (Tag::ion_series) in every consumer below.
    const bool read_hybrid = FASTag::IonSeries::hybridTwoPass(ion_mode, act, ion_column, hybrid_both);
    if (read_cz) ++pt.acc.e.series.ms2_cz;
    else if (read_hybrid) ++pt.acc.e.series.ms2_hybrid;
    else ++pt.acc.e.series.ms2_by;
    res.cz = read_cz;
    if (read_series == FASTag::IonSeries::Series::BY
        && FASTag::IonSeries::seriesFor(ion_mode, act) == FASTag::IonSeries::Series::CZ)
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
        FASTag::Digest::Fragmentation fr = FASTag::Digest::Fragmentation::UNKNOWN;
        if (am.count(AM::HCD) || am.count(AM::HCID)) fr = FASTag::Digest::Fragmentation::BEAM;
        else if (am.count(AM::CID) || am.count(AM::TRAP) || am.count(AM::PQD) || am.count(AM::LCID))
          fr = FASTag::Digest::Fragmentation::RESONANCE;
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
    // MS1 isotope spacing and the infer call; under both a disagreeing one
    // is tagged at the check's charge as well.
    // Off (the default): nothing here runs.
    FASTag::Hyp::HeaderCheckResult hdr_res;
    const bool hdr_this = hdr_check_on && prec.getCharge() > 0;
    if (hdr_this)
    {
      hdr_res = FASTag::Hyp::checkHeaderCharge(spec, prec, hyp_param, read_cz ? cs_cz : cs_by,
                                               ms1_for(tid, index));
      pt.hdr.add(hdr_res, hyp_param.header_check == FASTag::Hyp::HeaderCheck::BOTH);
      if (!check_header_out.empty()) pt.hdr_rows.push_back({index, spec.getNativeID(), prec.getMZ(), hdr_res});
    }
    const std::vector<FASTag::Hyp::Hypothesis> hyps = FASTag::Hyp::precursorHypotheses(
        spec, prec, hyp_param, read_cz ? cs_cz : cs_by, nullptr, hdr_this ? &hdr_res : nullptr);
    if (hyp_on) pt.acc.e.hyp.add(hyps);
    FASTag::SpectrumDiag cdiag;
    std::vector<FASTag::Tag> tags;
    std::vector<std::uint8_t> tag_hyp;  // per row: its hypothesis (hyp_on only)
    size_t sel_found = 0;                // rows of the selected hypothesis
    // The one place a hypothesis is tagged: its m/z and charge, the
    // multiplicity H (1 = the 1.11 call), the census diagnostics only for
    // the selected one. #15 phase B: the ion series (read_cz, decided once
    // per spectrum above) picks the tables, for every hypothesis alike.
    // 1.13 item 10: a two-pass hybrid spectrum is tagged as b/y (with the
    // census diagnostics) and as c/z-dot, each at H x HYBRID_PASSES, and
    // the rows merged under the cap one pass has (mergeSeriesPasses).
    const auto tag_at = [&](const FASTag::Hyp::Hypothesis& hy, double H, FASTag::SpectrumDiag* diag) {
      if (read_hybrid)
      {
        const double Hh = H * FASTag::IonSeries::HYBRID_PASSES;
        const size_t cap = p.max_tag_count > 0 ? static_cast<size_t>(p.max_tag_count) * lengths.size() : 0;
        return FASTag::mergeSeriesPasses(
            tag_all(spec, hy.mz, hy.charge, spec_itms ? tables_it : tables, diag, Hh, FASTag::IonSeries::Series::BY,
                    spec_itms),
            tag_all(spec, hy.mz, hy.charge, spec_itms ? tables_cz_it : tables_cz, nullptr, Hh,
                    FASTag::IonSeries::Series::CZ, spec_itms),
            cap);
      }
      return tag_all(spec, hy.mz, hy.charge,
                     read_cz ? (spec_itms ? tables_cz_it : tables_cz) : (spec_itms ? tables_it : tables), diag, H,
                     read_series, spec_itms);
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
    // 1.13 #22: the shadow pass of -alkylation_tags_out, on the selected
    // hypothesis with the run's multiplicity. Its tags are counted, never
    // written; a spectrum read as c/z is not shadow-tagged. Also for
    // -alkylation_out, whose default call it is.
    if (alkylation_shadow_on)
    {
      if (read_cz) ++pt.acc.d.alkt.spectra_cz;
      else
        for (const FASTag::Hyp::Hypothesis& hy : hyps)
        {
          if (!hy.selected) continue;
          const double H = static_cast<double>(hyps.size());
          const std::vector<FASTag::Tag> st = alkt_params.size() == 1
              ? FASTag::tagSpectrum(spec, hy.mz, hy.charge, alkt_params[0], alkt_tables[0], nullptr, H)
              : FASTag::mergeLengths(FASTag::tagSpectrum(spec, hy.mz, hy.charge, alkt_params, alkt_tables, nullptr, H));
          // The alias check reads the peaks the tagger read (only when a
          // tag holds a C).
          static thread_local OpenMS::MSSpectrum alkt_peaks;
          alkt_peaks.clear(true);
          for (const FASTag::Tag& t : st)
            if (t.seq.find('C') != std::string::npos)
            {
              alkt_peaks = FASTag::preparedPeaks(spec, hy.mz, hy.charge, alkt_params[0]);
              break;
            }
          const int alkt_z = hy.charge > 0 ? hy.charge : 2;
          // Release-gate review n1: the immonium check reads the spectrum as
          // read (the peak selection may drop the low m/z ions), m/z sorted.
          const MSSpectrum* alkt_raw = &spec;
          static thread_local MSSpectrum alkt_sorted;
          if (!alkt_peaks.empty() && !spec.isSorted())
          {
            alkt_sorted = spec;
            alkt_sorted.sortByPosition();
            alkt_raw = &alkt_sorted;
          }
          const FASTag::AlkylationTags::SpectrumPeaks alkt_sp{
              &alkt_peaks, (hy.mz - OpenMS::Constants::PROTON_MASS_U) * alkt_z, alkt_raw};
          FASTag::AlkylationTags::Vote v;
          for (const FASTag::Tag& t : st) pt.acc.d.alkt.addTag(v, t, alkt_ctx, alkt_sp);
          pt.acc.d.alkt.addSpectrum(v);
          break;
        }
    }
    pt.tags += tags.size();
    // -census: the reported rows (scratch reused per thread) and placements.
    static thread_local std::vector<FASTag::Census::TagView> ctags;
    ctags.clear();
    // census 2: max_len and the residues of the reported tags (res_cover).
    static thread_local std::vector<std::pair<double, double>> cres;
    cres.clear();
    bool cres_exact = true;   // census 3: every orientation known and every residue placed (res_cover_exact)
    bool cres_folded = false;  // census 3: some orientation unresolved, so every span is folded
    // census 3: each tag's span block [first, last) in cres and its mirror
    // axis (tags of different hypotheses have different axes), folded at
    // the end when any orientation is unresolved.
    static thread_local std::vector<std::tuple<std::size_t, std::size_t, double>> cres_blk;
    cres_blk.clear();
    size_t cmax_len = 0;
    size_t cplaced = 0;
    const auto census_view = [](const FASTag::Tag& t) {
      FASTag::Census::TagView v;
      v.evalue = t.evalue;
      v.low_mz = t.low_mz;
      v.high_mz = t.high_mz;
      v.n_res = t.n_res;
      v.min_conf = t.min_conf;
      v.mean_conf = t.mean_conf;
      v.peak_tic = t.peak_tic;
      v.cz = t.ion_series == FASTag::IonSeries::Series::CZ;
      return v;
    };
    // -census_score (1.16 item 4): every tag of the selected hypothesis
    // BEFORE any database filter, so the score's features do not depend on
    // -fasta (the rows above are the reported ones, after it).
    static thread_local std::vector<FASTag::Census::TagView> cpre;
    cpre.clear();
    if (res.census && census_score_on)
      for (size_t ti = 0; ti < tags.size(); ++ti)
        if (hyp_of(ti).selected) cpre.push_back(census_view(tags[ti]));

    // Reserve once so the per-field appends below do not repeatedly realloc.
    // ~80 bytes/row covers the fixed columns and a typical native ID; the
    // append path just grows past it for the rare long one.
    buf.reserve(tags.size() * 80);
    // One -delta_out sample per spectrum: the placed tag with the lowest
    // E-value. Each length's tags arrive sorted best first, so with one
    // length this is simply the first placed tag.
    bool delta_have = false, delta_clamped = false, delta_tagged = false;
    double delta_e = 0.0;
    DeltaSample delta_sample;
    // 1.16b: the placed tags a sample is chosen from. The tag with the
    // lowest E-value (the first on a tie) and its placements; with
    // -delta_select consensus or -delta_spectra_out every placed tag's.
    struct DeltaCand
    {
      size_t ti = 0;
      double evalue = 0.0;
      std::vector<FASTag::Reconciliation> places;
      std::vector<std::string> folded;  ///< the placements' peptides, I folded to L
      bool modded = false, cz = false;
      std::vector<double> shift;
    };
    DeltaCand delta_best;
    std::vector<DeltaCand> delta_all;
    const bool delta_keep_all = delta_consensus || delta_per_spectrum;
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
    if ((recon_loc || delta_sites) && !tags.empty())
    {
      for (const auto& pk : spec)
        if (pk.getIntensity() > 0 && std::isfinite(pk.getMZ())) loc_peaks.push_back(pk);
      loc_peaks.sortByPosition();
    }

    // -subsume_tags: the rows of -out that lie wholly in another written row
    // of the spectrum (FASTag::subsumedTags), from the final list (after
    // every merge and cap), among the rows the -fasta filter would write.
    // They are dropped from -out and from what follows it row by row (q_db,
    // the reported counts) only: the filter, digest, label, alkylation,
    // census tag statistics, placements, -qc_out, the -species evidence and
    // the -out_spectra target flag still see every row.
    std::vector<char> drop;
    if (subsume_on && tags.size() > 1)
    {
      std::vector<char> eligible;
      if (filtering)
      {
        eligible.resize(tags.size());
        for (size_t ti = 0; ti < tags.size(); ++ti)
        {
          // The row's hit class, attributed target-first as the row loop
          // does: 1 target, 2 entrapment only, 0 dropped by the filter. A
          // row is only subsumed by a row of its own class, so a target row
          // never gives way to a known-false entrapment row.
          const std::string base = FASTag::baseSequence(tags[ti].seq);
          if (filt.match(base) != FASTag::FastaFilter::Hit::NONE) eligible[ti] = 1;
          else if (entrap_on && entrap.match(base) != FASTag::FastaFilter::Hit::NONE) eligible[ti] = 2;
        }
      }
      drop = FASTag::subsumedTags(tags, tag_hyp, eligible);
    }
    // -species counts every row: when rows are dropped, its pass reads them
    // all from sbuf (the written ones copied, the dropped ones formatted).
    const bool species_all = want_species && std::find(drop.begin(), drop.end(), 1) != drop.end();
    res.sbuf.clear();
    size_t census_dropped = 0;  // dropped rows among ctags (census n_reported counts written rows)

    for (size_t ti = 0; ti < tags.size(); ++ti)
    {
      const FASTag::Tag& t = tags[ti];
      const FASTag::Hyp::Hypothesis& hy = hyp_of(ti);
      const bool sel = hy.selected;  // always true at the defaults
      const bool written = drop.empty() || !drop[ti];
      const char* hit = "-";
      bool row_entrap = false;
      if (filtering)
      {
        ++pt.len[static_cast<int>(t.n_res)].first;
        const auto h = filt.match(FASTag::baseSequence(t.seq));
        if (h == FASTag::FastaFilter::Hit::NONE)
        {
          // Target-first attribution: only a tag the TARGET rejects may
          // count as entrapment evidence (a tag hitting both is a target
          // match -- exclusive attribution matches the exclusive key space
          // the r_len correction is computed over).
          if (!entrap_on) continue;
          const auto he = entrap.match(FASTag::baseSequence(t.seq));
          if (he == FASTag::FastaFilter::Hit::NONE) continue;
          row_entrap = true;
          hit = (he == FASTag::FastaFilter::Hit::FORWARD) ? "efwd" : "erev";
          pt.entrap_e.emplace_back(t.evalue, static_cast<int>(t.n_res));
        }
        else
        {
          ++pt.len[static_cast<int>(t.n_res)].second;
          // A reverse-only match identifies the ion series: the tag was read off
          // the b series, so its flanking masses carry a one-water offset.
          hit = (h == FASTag::FastaFilter::Hit::FORWARD) ? "fwd" : "rev";
          if (entrap_on) pt.target_e.push_back(t.evalue);
        }
      }
      if (qc_on && sel && t.evalue < res.qc_best_e)  // -qc_out tag yield (1.16)
      {
        res.qc_best_e = t.evalue;
        res.qc_best_tag = t.seq;
      }
      if (res.census && sel)
      {
        ctags.push_back(census_view(t));
        if (!written) ++census_dropped;
        cmax_len = std::max(cmax_len, t.n_res);
        // census 3: a -fasta match in one orientation only tells the read's
        // orientation (fwd: a y or z-dot read, rev: a b or c read; match()
        // says FORWARD when both hit, so a forward hit is checked reversed
        // too). Otherwise the tag is folded and res_cover is the lower bound
        // (res_cover_exact 0). The mirror axis is the hypothesis' neutral
        // mass less H2O plus the series' reversed-read offset, the tagger's
        // precursor mass (charge <= 0 tagged as 2).
        using Orient = FASTag::Census::Orientation;
        const bool tfwd = std::strcmp(hit, "fwd") == 0, efwd = std::strcmp(hit, "efwd") == 0;
        Orient orient = (tfwd || efwd) ? Orient::Forward
                      : (std::strcmp(hit, "rev") == 0 || std::strcmp(hit, "erev") == 0) ? Orient::Reversed
                                                                                        : Orient::Unresolved;
        if (orient == Orient::Forward)
        {
          std::string rs = FASTag::baseSequence(t.seq);
          std::reverse(rs.begin(), rs.end());
          if ((efwd ? entrap : filt).match(rs) == FASTag::FastaFilter::Hit::FORWARD) orient = Orient::Unresolved;
        }
        if (orient == Orient::Unresolved)
        {
          cres_exact = false;
          cres_folded = true;
        }
        static const double WATER_MONO = EmpiricalFormula("H2O").getMonoWeight();
        const int zc = hy.charge > 0 ? hy.charge : 2;
        const double axis = hy.mz * zc - zc * Constants::PROTON_MASS_U - WATER_MONO
                          + FASTag::IonSeries::ionPair(t.ion_series).reversedOffset();
        const std::size_t cfirst = cres.size();
        // Codex6 review n7: a gap's residues add no span; res_cover is a lower bound then.
        if (!FASTag::Census::addResidueSpans(cres, t.nterm_mass, t.path_mz, t.step_res, t.charge, t.n_res, t.res_mass,
                                             orient, axis))
          cres_exact = false;
        cres_blk.emplace_back(cfirst, cres.size(), axis);
      }
      if (!row_entrap) res.any_target = true;
      if (written)
      {
        if (entrap_on) res.meta.emplace_back(t.evalue, row_entrap);
        ++pt.reported;
        FASTag::Terminus::Call term;
        if (terminus_on)
        {
          // The row's precursor (its hypothesis) and its series' tolerance.
          const FASTag::Param& tp = params_of(t.ion_series, spec_itms).front();
          FASTag::Terminus::Peaks tpk;
          if (hy.mz > 0 && std::isfinite(hy.mz)) tpk.precursor = hy.mz;
          tpk.charge = hy.charge > 0 ? hy.charge : 2;
          tpk.tolerance = tp.frag_tol;
          tpk.ppm = tp.tol_ppm;
          tpk.isotope = hy.iso;
          term = FASTag::Terminus::seriesCall(t, tpk, termini);
        }
        // -fasta_proteins: the proteins of the database that matched, in the
        // orientation the filter reported (it tries forward first).
        std::string db_cells;
        if (db_index)
        {
          const bool rev = hit[0] == 'r' || (hit[0] == 'e' && hit[1] == 'r');
          const FASTag::ProteomeIndex& ix = row_entrap ? db_entrap_index : *db_index;
          std::vector<FASTag::ProteomeIndex::ProteinHit> ph;
          ix.proteinHits(FASTag::baseSequence(t.seq), rev, row_entrap ? db_entrap_decoy : db_decoy, ph);
          db_cells = FASTag::dbProteinCells(ix, row_entrap ? db_entrap_genes : db_genes, ph,
                                            static_cast<size_t>(fasta_proteins));
        }
        const size_t row_start = buf.size();
        appendTagRow_(buf, t, spec.getNativeID(), hit, want_proforma, proforma_fixed,
                     p.per_residue_conf, usi, hyp_on ? &hy : nullptr, ion_column, terminus_on ? &term : nullptr,
                     db_index ? &db_cells : nullptr);
        if (species_all) res.sbuf.append(buf, row_start, std::string::npos);
      }
      else
      {
        ++pt.subsumed;
        // Only the species pass reads this copy (readSpeciesFields_: the
        // leading columns), so the -terminus columns are left off.
        if (species_all)
          appendTagRow_(res.sbuf, t, spec.getNativeID(), hit, want_proforma, proforma_fixed,
                        p.per_residue_conf, usi, hyp_on ? &hy : nullptr, ion_column, nullptr);
      }
      if (written || species_all)
      {
        if (species_sel_on) res.row_species.push_back(sel ? 1 : 0);
        // 1.13 item 10: a two-pass hybrid spectrum's rows differ in series.
        if (read_hybrid) res.row_series.push_back(t.ion_series == FASTag::IonSeries::Series::CZ ? 1 : 0);
      }
      // The tags the digest and label reports count: every written row that
      // is ungapped with E <= 1 (of the selected hypothesis, #6). A c/z tag
      // (#15 phase B) with its series' reversed-read offset.
      const bool tag_cz = t.ion_series == FASTag::IonSeries::Series::CZ;
      if (count_on && sel && !t.gapped && t.evalue <= 1.0)
      {
        if (tag_cz) pt.digest.add(t.nterm_mass, t.cterm_mass, FASTag::baseSequence(t.seq), cz_pair.reversedOffset());
        else pt.digest.add(t.nterm_mass, t.cterm_mass, FASTag::baseSequence(t.seq));
        // 1.16.3: a tag of a spectrum tagged at a Da tolerance (an ion-trap
        // MS2 under -tolerance_by_analyzer on); FD::reportSettings() reads it.
        if (!params_of(t.ion_series, spec_itms).front().tol_ppm) ++pt.digest.tags_da;
      }
      // 1.12 D #3g: the tags -alkylation_out reads (as the digest report),
      // of the selected hypothesis only (#6, PLAN-INTEGRATION 2.4). A c/z
      // tag (#15 phase B) is not placed for the call: the Cys form rules
      // are b/y-only, so it is counted in Tally::excludeNonBy() instead
      // (PLAN-INTEGRATION 2.3 contract 2; doc/ALKYLATION-REPORT.md).
      const bool alk_counted = alk_place && sel && FASTag::Alkylation::countsTag(t.gapped, t.evalue);
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
            appendField_(res.rbuf, spec.getNativeID()); res.rbuf += '\t';
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
          // 1.13 item 20: windows by flank mass, kept by the cleavage
          // rule after the run (Cleavage::WindowFilter).
          std::vector<FASTag::Reconciliation> sl_by_mass;
          if (sl_nontryptic && shortlist_on && t.evalue <= sl_settings.max_evalue)
            sl_by_mass = recon.reconcileByMass(FASTag::baseSequence(t.seq), t.nterm_mass, t.cterm_mass,
                                               tag_cz ? &cz_pair : nullptr);
          if (shortlist_on && t.evalue <= sl_settings.max_evalue)
            for (const auto& pl : (sl_nontryptic ? sl_by_mass : places))
            {
              double flank = 0.0;
              if (!pl.nterm_match) flank = pl.reversed ? t.cterm_mass : t.nterm_mass;
              else if (!pl.cterm_match) flank = pl.reversed ? t.nterm_mass : t.cterm_mass;
              const double tol_da = p.tol_ppm ? flank * p.frag_tol * 1e-6 : p.frag_tol;
              const auto cls = FASTag::Shortlist::classifyPlacement(pl.nterm_match, pl.cterm_match, pl.delta_mass,
                                                                    fixed_term_n, fixed_term_c, tol_da);
              if (cls == FASTag::Shortlist::Placement::GAPPED && !sl_settings.gapped) continue;
              FASTag::Shortlist::Evidence ev;
              ev.spectrum = static_cast<std::uint32_t>(index);
              ev.protein = pl.protein_index;
              ev.evalue = static_cast<float>(t.evalue);
              ev.window_start = static_cast<std::uint32_t>(pl.start);
              ev.window_len = static_cast<std::uint16_t>(std::min<std::size_t>(pl.peptide.size(), 65535));
              ev.exact = cls != FASTag::Shortlist::Placement::GAPPED;
              a.sl.push_back(ev);
            }
        }
        // ---- 1.12 D: per-tag placement records ----
        if (alk_tag)  // #3g
          FASTag::Alkylation::addTag(pt.acc.d.alk, alk_vote, places, t.evalue, alk_settings, alk_forms);
        // A candidate for the spectrum's -delta_out sample (chosen after
        // the loop, -delta_select): this tag's placements.
        if (delta_on && sel) delta_tagged = true;
        if (delta_on && sel && !places.empty())
        {
          const bool better = !delta_have || t.evalue < delta_e;
          if (better || delta_keep_all)
          {
            DeltaCand c;
            c.ti = ti;
            c.evalue = t.evalue;
            c.places = places;
            c.modded = tag_modded;
            c.cz = tag_cz;
            if (tag_modded) c.shift = tag_shift;
            if (delta_keep_all)
            {
              c.folded.reserve(places.size());
              for (const auto& pl : places)
              {
                std::string f = pl.peptide;
                for (char& ch : f) if (ch == 'I') ch = 'L';
                c.folded.push_back(std::move(f));
              }
            }
            if (better) delta_best = c;
            if (delta_keep_all) delta_all.push_back(std::move(c));
          }
          if (better) delta_e = t.evalue;
          delta_have = true;
        }
      }
    }
    if (delta_tagged) ++pt.delta_tagged;
    if (delta_have)
    {
      ++pt.delta_placed;
      // ---- the spectrum's -delta_out sample (1.16b: -delta_select) ----
      // min_delta (1.15): the lowest-E-value tag (the first on a tie) and
      // its smallest-|delta| placement (the first on a tie). consensus: the
      // placement the most placed tags agree with (the same peptide, I/L
      // folded, and a gap within DELTA_CONSENSUS_DA), then the lower tag
      // E-value, the smaller |delta|, the earlier tag and placement.
      constexpr double DELTA_CONSENSUS_DA = 0.05;
      auto support = [&](const std::string& pep, double d) {
        int n = 0;
        for (const DeltaCand& c2 : delta_all)
          for (size_t k = 0; k < c2.places.size(); ++k)
            if (c2.folded[k] == pep && std::fabs(c2.places[k].delta_mass - d) <= DELTA_CONSENSUS_DA) { ++n; break; }
        return n;
      };
      const DeltaCand* selc = &delta_best;
      size_t selk = 0;
      int sel_support = 0;
      if (delta_consensus)
      {
        bool any = false;
        double best_e = 0.0, best_abs = 0.0;
        for (const DeltaCand& c : delta_all)
          for (size_t k = 0; k < c.places.size(); ++k)
          {
            const int n = support(c.folded[k], c.places[k].delta_mass);
            const double ad = std::fabs(c.places[k].delta_mass);
            if (!any || n > sel_support || (n == sel_support && (c.evalue < best_e || (c.evalue == best_e && ad < best_abs))))
            {
              any = true; selc = &c; selk = k; sel_support = n; best_e = c.evalue; best_abs = ad;
            }
          }
      }
      else
      {
        for (size_t k = 1; k < selc->places.size(); ++k)
          if (std::fabs(selc->places[k].delta_mass) < std::fabs(selc->places[selk].delta_mass)) selk = k;
        if (delta_per_spectrum)
        {
          std::string f = selc->places[selk].peptide;
          for (char& ch : f) if (ch == 'I') ch = 'L';
          sel_support = support(f, selc->places[selk].delta_mass);
        }
      }
      const FASTag::Tag& t = tags[selc->ti];
      const FASTag::Hyp::Hypothesis& hy = hyp_of(selc->ti);
      const FASTag::Reconciliation* best = &selc->places[selk];
      const std::vector<double>* tshift = selc->modded ? &selc->shift : nullptr;
      const FASTag::IonSeries::IonPair* tser = selc->cz ? &cz_pair : nullptr;
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
      delta_sample.charge = hy.charge > 0 ? hy.charge : 2;
      delta_sample.charge_assumed = hy.charge <= 0 || hy.src == FASTag::Hyp::ChargeSource::ASSUMED;
      delta_sample.gap_side = !best->nterm_match ? 'N' : !best->cterm_match ? 'C' : '-';
      // The precursor-derived flank: the N-side of a forward (y-read)
      // placement, the C-side of a reversed one (TagReconciler::tryPlace_).
      delta_sample.precursor_flank = delta_sample.gap_side != '-' && ((delta_sample.gap_side == 'N') != best->reversed);
      for (const auto& pl : selc->places)
      {
        if (std::fabs(pl.delta_mass) <= 1e-6) ++delta_sample.n_exact;
        else ++delta_sample.n_gapped;
      }
      delta_sample.exact_vs_gapped = delta_sample.n_exact > 0 && delta_sample.n_gapped > 0;
      if (delta_sites)
      {
        // The placement selected, localized on this spectrum's peaks with
        // -delta_loc_model (COUNT: as -recon_localize does).
        FASTag::Reconciliation chosen = *best;
        chosen.loc_pos = -1; chosen.loc_score = 0; chosen.loc_ties = 0; chosen.loc_evidence = 0;
        chosen.loc_alternatives = 0; chosen.loc_excluded = 0; chosen.loc_site = 0;
        recon.localize(chosen, loc_peaks, hy.charge, tshift, tser, delta_loc_model);
        delta_sample.gap = chosen.region_hi >= chosen.region_lo && std::fabs(chosen.delta_mass) > 1e-6;
        delta_sample.region_gap = delta_sample.gap;
        const FASTag::ShiftSurvey::LocClass lc = FASTag::ShiftSurvey::locClass(chosen, delta_loc_min_evidence);
        delta_sample.loc_class = static_cast<std::uint8_t>(lc);
        FASTag::ShiftSurvey::Site site;
        const bool localized = delta_sample.gap && FASTag::ShiftSurvey::siteOf(chosen, site, delta_loc_min_evidence);
        delta_sample.site = localized ? FASTag::ShiftSurvey::siteKey(site) : std::string();
        delta_sample.pep_mass = chosen.pep_mass;
        // The observation class, before any catalogue name.
        if (std::fabs(chosen.delta_mass) > 1e-6)
        {
          namespace SS = FASTag::ShiftSurvey;
          SS::Observation ob;
          ob.delta = chosen.delta_mass;
          ob.tol_da = survey_ppm ? survey_tol * chosen.pep_mass * 1e-6 : survey_tol;
          ob.precursor_flank = delta_sample.precursor_flank;
          ob.interp = chosen.delta_interp;
          const uint32_t L = chosen.win_end - chosen.win_start;
          const uint32_t pstart = chosen.win_start - static_cast<uint32_t>(chosen.start);
          const uint32_t pend = pstart + pindex.proteinLength(chosen.protein_index);
          for (uint32_t k = 1; k <= 3; ++k)
          {
            if (delta_sample.gap_side == 'N' && chosen.win_start >= pstart + k)
              ob.beyond.push_back(pindex.massBetween(chosen.win_start - k, chosen.win_start));
            if (delta_sample.gap_side == 'C' && chosen.win_end + k <= pend)
              ob.beyond.push_back(pindex.massBetween(chosen.win_end, chosen.win_end + k));
          }
          if (delta_sample.gap)
          {
            const uint32_t n_reg = static_cast<uint32_t>(chosen.region_hi - chosen.region_lo + 1);
            for (uint32_t k = 1; k <= 3 && k <= n_reg; ++k)
            {
              if (delta_sample.gap_side == 'N') ob.inside.push_back(pindex.massBetween(chosen.win_start, chosen.win_start + k));
              else ob.inside.push_back(pindex.massBetween(chosen.win_end - k, chosen.win_end));
            }
            ob.region = chosen.peptide.substr(static_cast<size_t>(chosen.region_lo), n_reg);
          }
          ob.localized = localized;
          if (localized) ob.sites.push_back(site);
          else if (delta_sample.gap)
            for (int j = chosen.region_lo; j <= chosen.region_hi; ++j)
            {
              SS::Site st;
              st.residue = chosen.peptide[static_cast<size_t>(j)];
              if (delta_sample.gap_side == 'N' && j == 0) { st.kind = 'N'; st.protein_term = chosen.protein_nterm; }
              else if (delta_sample.gap_side == 'C' && j == static_cast<int>(L) - 1) { st.kind = 'C'; st.protein_term = chosen.protein_cterm; }
              ob.sites.push_back(st);
            }
          else if (!chosen.peptide.empty())
          {
            // No residue between the tag and the terminus: the gap is on the terminus.
            SS::Site st;
            st.kind = delta_sample.gap_side == 'N' ? 'N' : 'C';
            st.residue = st.kind == 'N' ? chosen.peptide.front() : chosen.peptide.back();
            st.protein_term = st.kind == 'N' ? chosen.protein_nterm : chosen.protein_cterm;
            ob.sites.push_back(st);
          }
          delta_sample.obs_class = static_cast<std::uint8_t>(
              SS::observationClass(ob, survey_unimod, survey_fixed, delta_per_spectrum ? &delta_sample.obs_detail : nullptr));
        }
        if (delta_per_spectrum)
        {
          delta_sample.index = index;
          delta_sample.native_id = spec.getNativeID();
          delta_sample.peptide = chosen.peptide;
          delta_sample.site_pos = delta_sample.gap ? chosen.loc_pos : -1;
          delta_sample.loc_evidence = chosen.loc_evidence;
          delta_sample.loc_score = chosen.loc_pos >= 0 ? chosen.loc_score : 0;
          delta_sample.loc_ties = chosen.loc_pos >= 0 ? chosen.loc_ties : 0;
          delta_sample.loc_excluded = chosen.loc_excluded;
          delta_sample.evalue = t.evalue;
          delta_sample.tag = t.seq;
          delta_sample.protein = chosen.protein;
          for (char& ch : delta_sample.protein) if (ch == '\t' || ch == '\n' || ch == '\r') ch = ' ';
          delta_sample.reversed = chosen.reversed;
          delta_sample.pos = static_cast<int>(chosen.pos);
          delta_sample.region_lo = chosen.region_lo;
          delta_sample.region_hi = chosen.region_hi;
          delta_sample.prec_iso = hy.iso;
          {
            using CS = FASTag::Hyp::ChargeSource;
            delta_sample.charge_src = hy.charge <= 0 || hy.src == CS::ASSUMED ? "assumed"
                                    : hy.src == CS::HEADER ? "given" : "inferred";
          }
          delta_sample.n_placements = static_cast<int>(selc->places.size());
          delta_sample.tag_support = sel_support;
          delta_sample.tags_placed = static_cast<int>(delta_all.size());
          {
            std::vector<std::string> peps;
            char num[40];
            for (const auto& pl : selc->places)
            {
              std::string f = pl.peptide;
              for (char& ch : f) if (ch == 'I') ch = 'L';
              peps.push_back(f);
              if (!delta_sample.placements.empty()) delta_sample.placements += ';';
              std::string prot = pl.protein;
              for (char& ch : prot) if (ch == '\t' || ch == '\n' || ch == '\r' || ch == ';' || ch == '|') ch = ' ';
              std::snprintf(num, sizeof num, "|%zu|%c|%.6f", pl.pos + 1, pl.reversed ? 'r' : 'f', pl.delta_mass);
              delta_sample.placements += prot + '|' + pl.peptide + num;
            }
            std::sort(peps.begin(), peps.end());
            delta_sample.n_peptides = static_cast<int>(std::unique(peps.begin(), peps.end()) - peps.begin());
          }
          if (delta_loc_null > 0.0 && delta_sample.gap)
          {
            // The null: the same placement on the spectrum's peaks moved by
            // -delta_loc_null in m/z (the same peak density, no ladder).
            FASTag::Reconciliation nul = *best;
            nul.loc_pos = -1; nul.loc_score = 0; nul.loc_ties = 0; nul.loc_evidence = 0;
            nul.loc_alternatives = 0; nul.loc_excluded = 0;
            MSSpectrum moved = loc_peaks;
            for (auto& pk : moved) pk.setMZ(pk.getMZ() + delta_loc_null);
            recon.localize(nul, moved, hy.charge, tshift, tser, delta_loc_model);
            delta_sample.null_class = FASTag::ShiftSurvey::locClassName(FASTag::ShiftSurvey::locClass(nul, delta_loc_min_evidence));
            delta_sample.null_evidence = nul.loc_alternatives > 0 ? nul.loc_evidence : 0;
          }
        }
      }
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
      cfacts.n_reported = ctags.size() - census_dropped;
      cfacts.n_placed = cplaced;
      cfacts.count_placements = recon_on;
      crow.status = FASTag::Census::classify(cfacts);
      crow.prepared = cdiag.prepared;
      crow.n_kept = cdiag.n_kept;
      crow.n_edges = cdiag.n_edges;
      crow.n_compl = cdiag.n_compl;
      crow.n_found = sel_found;
      crow.n_reported = ctags.size() - census_dropped;
      const size_t best = FASTag::Census::bestTag(ctags);
      if (best != FASTag::Census::NO_INDEX)
      {
        crow.has_best = true;
        crow.best = ctags[best];
        crow.tag_cover = FASTag::Census::tagCoverOf(ctags);
        crow.max_len = cmax_len;
        // While any orientation is unresolved every residue is folded (known
        // tags after their exact placement), each on its own, so a known and
        // an unresolved read of one stretch, and overlapping tags, count each
        // residue once; folding a folded span changes nothing. The longest
        // tag is the other lower bound.
        if (cres_folded)
          for (const auto& [a, b, ax] : cres_blk) FASTag::Census::foldResidueSpans(cres, a, b, ax);
        crow.res_cover = FASTag::Census::resCoverLowerBound(cres, cmax_len);
        crow.res_cover_exact = cres_exact;
      }
      const size_t pre = FASTag::Census::bestTag(cpre);
      if (census_score_on && pre != FASTag::Census::NO_INDEX)
      {
        crow.has_pre = true;
        crow.pre_best = cpre[pre];
        crow.pre_tag_cover = FASTag::Census::tagCoverOf(cpre);
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
      appendField_(gr, spec.getNativeID());
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
      FASTag::Census::appendRow(cr, r.census_row, spec.getNativeID(), ion_column, census_score_on);
    }
    if (r.buf.empty()) return;  // rbuf is only ever non-empty alongside buf
    b.rows[idx].swap(r.buf);
    if (recon_on) b.recon_rows[idx].swap(r.rbuf);
    if (recon_ids_on) b.recon_id_lists[idx].swap(r.ids);
    if (entrap_on) b.row_meta[idx].swap(r.meta);
    if (species_sel_on) b.row_species[idx].swap(r.row_species);
    if (hybrid_both) b.row_series[idx].swap(r.row_series);
    if (want_species) b.species_rows[idx].swap(r.sbuf);
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
      if (hybrid_both) b.row_series.resize(n_used);
      if (want_species) b.species_rows.resize(n_used);
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
  constexpr size_t WRITE_CHUNK = size_t(4) << 20;
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
    if (pending.size() >= WRITE_CHUNK) drain(os, pending);
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
        // Every row of the spectrum: the written ones, or all of them when
        // -subsume_tags left some out of -out (Block::species_rows).
        const std::string& r = b.species_rows[i].empty() ? b.rows[i] : b.species_rows[i];
        size_t start = 0, row = 0, rix = 0;
        // 1.13 item 10: per-row series of a two-pass hybrid spectrum.
        const std::vector<char>* rser =
            hybrid_both && !b.row_series[i].empty() ? &b.row_series[i] : nullptr;
        std::string id, tag;
        bool gapped = false;
        double evalue = 0;
        while (start < r.size())
        {
          size_t nl = r.find('\n', start);
          if (nl == std::string::npos) nl = r.size();
          const bool row_is_cz = rser && rix < rser->size() && (*rser)[rix];
          ++rix;
          // #6: a row of a losing precursor hypothesis is no species
          // evidence (the per-row flag from tag_one, not a TSV column).
          if (species_sel_on && !b.row_species[i][row++]) { start = nl + 1; continue; }
          // #15 phase B: a c/z row (Block::row_cz, one flag per spectrum,
          // every row of it alike) is left out and counted.
          if (b.row_cz[i] || row_is_cz) ++species_cz_excluded;
          else if (readSpeciesFields_(r, start, nl, id, tag, gapped, evalue))
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
      if (want_species) b.species_rows[i].clear();
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

  // One reader per thread, built before the loop; for mzPeak a picker per
  // thread (profile MS2 is centroided on the reading thread).
  std::vector<std::unique_ptr<OnDiscMSExperiment>> readers(read_threads);
  std::vector<std::unique_ptr<FASTag::IndexedMzMLReader>> freaders(read_threads);
  std::vector<std::unique_ptr<FASTag::MgfReader>> mreaders(read_threads);
  std::vector<std::unique_ptr<IMSExperimentRandomAccess>> vreaders(read_threads);
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
    if (vra) vreaders[t] = vra->clone();
    if (mzs) pickers[t] = std::make_unique<PeakPickerHiRes>();
  }
  t_readers = secs(t_readers_a, Clock::now());
  // 1.13 -check_header_charge: MS1 access for the formats that keep MS1
  // scans (indexed or in-memory mzML); MGF and mzPeak have none here.
  if (hdr_check_on && !mgf && !mzs)
    ms1_read = [&](size_t tid, size_t j, bool peaks) -> MSSpectrum {
      if (freaders[tid]) return peaks ? freaders[tid]->getSpectrumAnyLevel(j) : freaders[tid]->getSpectrumMetadata(j);
      if (vreaders[tid]) return peaks ? vreaders[tid]->getSpectrum(j) : vreaders[tid]->getSpectrumMetadata(j);
      if (readers[tid]) return peaks ? readers[tid]->getSpectrum(j) : readers[tid]->getMetaData()->operator[](j);
      if (peaks) return exp[j];
      MSSpectrum m;
      m.setMSLevel(exp[j].getMSLevel());
      return m;
    };

  // ONE parallel region over the whole run. Blocks only bound the memory the
  // results take; a writer thread empties them in input order. A region per
  // block would put a barrier at every block end; with one region the
  // stragglers of one block overlap the start of the next instead.
  //
  // A ring of RING buffers. Chunks are handed out in index order
  // (monotonic), so a thread reaching block k knows every earlier chunk is
  // taken; it waits only while block k's buffer still holds block k - RING,
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
  size_t open_upto = std::min(RING, n_blocks);  ///< blocks below have a prepared buffer (ring_mutex)
  std::atomic<size_t> open_hint{open_upto};      ///< its lock-free copy, for the common case
  bool write_abort = false;                      ///< the writer failed (ring_mutex)
  std::atomic<bool> abort_hint{false};
  std::exception_ptr write_failed;
  std::exception_ptr work_failed;                ///< first reader/tagger failure (ring_mutex)

  const auto t_prep_a = Clock::now();
  for (size_t k = 0; k < open_upto; ++k) prep_block(blocks[k % RING], k * BLOCK, block_size(k));
  t_prep = secs(t_prep_a, Clock::now());

  // FASTAG_TIMING: each thread's exit from its last chunk. Allocated before
  // the writer starts: a throw between its start and join() would destroy a
  // joinable std::thread (std::terminate).
  std::vector<Clock::time_point> t_done(static_cast<size_t>(read_threads));
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
        Block& b = blocks[k % RING];
        write_block(b, block_size(k));
        if (k + RING < n_blocks) prep_block(b, (k + RING) * BLOCK, block_size(k + RING));
        t_write_busy += secs(a, Clock::now());
        {
          std::lock_guard<std::mutex> guard(ring_mutex);
          open_upto = std::min(n_blocks, k + RING + 1);
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

  const auto t_par_a = Clock::now();
#pragma omp parallel num_threads(read_threads)
  {
    const size_t tid = static_cast<size_t>(omp_get_thread_num());
    OnDiscMSExperiment* reader = readers[tid].get();
    FASTag::IndexedMzMLReader* freader = freaders[tid].get();
    FASTag::MgfReader* mreader = mreaders[tid].get();
    IMSExperimentRandomAccess* vreader = vreaders[tid].get();
    PeakPickerHiRes* picker = pickers[tid].get();
    auto work = [&](SignedSize i, Block& blk, size_t idx)
    {
      if (!sample_mask.empty() && !sample_mask[static_cast<size_t>(i)])
      {
        tick();
        return;
      }
      const Clock::time_point ta = timing ? Clock::now() : Clock::time_point();
      MSSpectrum loaded;
      bool loaded_here = false;
      if (mzs) { loaded = mzs->take(static_cast<size_t>(i), *picker); loaded_here = true; }
      if (!loaded_here && mreader) { loaded = mreader->getSpectrum(static_cast<Size>(i)); loaded_here = true; }
      // Thermo: the peaks of other levels are not decoded here (the loop
      // tags MS2; -check_header_charge reads MS1 through ms1_read).
      if (!loaded_here && vreader)
      {
        const Size si = static_cast<Size>(i);
        loaded = vreader->getSpectrumMSLevel(si) == 2 ? vreader->getSpectrum(si) : vreader->getSpectrumMetadata(si);
        loaded_here = true;
      }
      // The step-0 fields the loop reads, no more (1.12.2; IndexedMzMLReader::TAGGING_FIELDS).
      if (!loaded_here && freader)
      {
        loaded = freader->getSpectrum(static_cast<Size>(i), FASTag::IndexedMzMLReader::TAGGING_FIELDS | qc_fields);
        loaded_here = true;
      }
      if (!loaded_here && reader) { loaded = reader->getSpectrum(static_cast<Size>(i)); loaded_here = true; }
      // A selected-ion m/z of 0 next to an isolation target, as OpenMS reads
      // it (OnDiscMSExperiment, in-memory mzML, mzPeak): the target instead,
      // as the indexed reader reads the same precursor. MGF has no target.
      if (!freader && !mreader && FASTag::needsSelectedIonTarget(loaded_here ? loaded : exp[static_cast<Size>(i)]))
      {
        if (!loaded_here) { loaded = exp[static_cast<Size>(i)]; loaded_here = true; }
        FASTag::useSelectedIonTarget(loaded);
        ++per_thread[tid].mz0_target;
      }
      const MSSpectrum& spec = loaded_here ? loaded : exp[static_cast<Size>(i)];
      if (mzpeak_out && spec.getMSLevel() == 2 && spec.containsIMData()) throw IonMobilityRefused{};
      const Clock::time_point tb = timing ? Clock::now() : ta;
      SpecResult result = tag_one(spec, tid, static_cast<size_t>(i));
      if (qc)  // -qc_out (1.16): metadata of every spectrum read, the MS2 as read
      {
        qc->scan(tid, static_cast<size_t>(i), spec);
        if (spec.getMSLevel() == 2) qc->ms2(tid, static_cast<size_t>(i), spec, result.qc_best_e, result.qc_best_tag);
      }
      record(blk, idx, std::move(result), spec);
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
        std::max<SignedSize>(0, n_spec - static_cast<SignedSize>(read_threads) * CHUNK);
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
          work(i, blocks[k % RING], static_cast<size_t>(i) - k * BLOCK);
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
#pragma omp for schedule(FASTAG_MONOTONIC dynamic, CHUNK) nowait
    for (SignedSize i = 0; i < tail_from; ++i) one(i);
#pragma omp for schedule(FASTAG_MONOTONIC dynamic, TAIL_CHUNK) nowait
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
  // Selected-ion m/z 0 (or below, or not finite): counted by the indexed
  // reader's per-thread copies, or by the loop for spectra OpenMS read.
  size_t n_mz0 = 0, n_mz0_target = 0;
  for (const auto& r : freaders)
    if (r)
    {
      n_mz0 += r->invalidSelectedMz();
      n_mz0_target += r->invalidSelectedMzFromTarget();
    }
  FASTag::ClusterAcc::ClusterThread run_acc;  // the per-cluster accumulators, summed in thread order
  FASTag::Hyp::HeaderCheckCounts hdr_counts;  // 1.13 -check_header_charge
  for (const PerThread& pt : per_thread)
  {
    run_acc.merge(pt.acc);
    hdr_counts.merge(pt.hdr);
    n_no_charge += pt.no_charge;
    n_multi_charge += pt.multi_charge;
    n_mz0 += pt.mz0_target;
    n_mz0_target += pt.mz0_target;
    n_ms2 += pt.ms2;
    n_untaggable_msn += pt.untaggable_msn;
    n_tags += pt.tags;
    n_reported += pt.reported;
    n_subsumed += pt.subsumed;
    for (const auto& kv : pt.len)
    {
      by_len[kv.first].first += kv.second.first;
      by_len[kv.first].second += kv.second.second;
    }
  }
  // ---- 1.12 E: run-level facts from the loop ----
  {
    // #9: picking counts (RunMeta Versioned rows); only mzPeak picks.
    run_meta.pick_profile = stringOption_("pick_profile");
    run_meta.pick_picked = mzs ? mzs->picked() : 0;
    run_meta.pick_failed = mzs ? mzs->pickFailed() : 0;
    // #15 phase A: activation counts (RunMeta Versioned rows only).
    using FASTag::IonSeries::Activation;
    const auto& act = run_acc.e.activation;
    run_meta.activation_collisional = act.of(Activation::COLLISIONAL);
    run_meta.activation_electron = act.of(Activation::ELECTRON);
    run_meta.activation_hybrid = act.of(Activation::HYBRID);
    run_meta.activation_unknown = act.of(Activation::UNKNOWN);
    // #6: where the selected hypotheses' charges came from (RunMeta
    // Versioned rows; zero at the defaults, where no hypothesis step runs).
    using FASTag::Hyp::ChargeSource;
    const FASTag::Hyp::SourceCounts& hc = run_acc.e.hyp;
    const auto sel_of = [&](ChargeSource s) { return hc.selected[static_cast<size_t>(s)]; };
    run_meta.unknown_charge = getStringOption_("unknown_charge");
    run_meta.isotope_error.clear();
    for (const int k : hyp_param.isotope_errors)
      run_meta.isotope_error += (run_meta.isotope_error.empty() ? "" : ",") + std::to_string(k);
    run_meta.charge_header = sel_of(ChargeSource::HEADER);
    run_meta.charge_possible = sel_of(ChargeSource::POSSIBLE);
    run_meta.charge_inferred = sel_of(ChargeSource::INFERRED);
    run_meta.charge_ambiguous = sel_of(ChargeSource::AMBIGUOUS);
    run_meta.charge_assumed = sel_of(ChargeSource::ASSUMED);
    run_meta.charge_enumerated = sel_of(ChargeSource::ENUMERATED);
    // 1.13 -check_header_charge (rows only when it is on).
    run_meta.check_header_charge = getStringOption_("check_header_charge");
    run_meta.header_checked = hdr_counts.checked;
    run_meta.header_agree = hdr_counts.verdict[static_cast<size_t>(FASTag::Hyp::HeaderVerdict::AGREE)];
    run_meta.header_disagree = hdr_counts.verdict[static_cast<size_t>(FASTag::Hyp::HeaderVerdict::DISAGREE)];
    run_meta.header_ambiguous = hdr_counts.verdict[static_cast<size_t>(FASTag::Hyp::HeaderVerdict::AMBIGUOUS)];
    run_meta.header_nocall = hdr_counts.verdict[static_cast<size_t>(FASTag::Hyp::HeaderVerdict::NO_CALL)];
    run_meta.header_both = hdr_counts.both;
    run_meta.iso_shifted = hc.iso_shifted;
    run_meta.multi_hypothesis = hc.multi;
    // #15 phase B: the series per tagged MS2.
    run_meta.ion_series = FASTag::IonSeries::modeName(ion_mode);
    run_meta.ion_series_ms2_by = run_acc.e.series.ms2_by;
    run_meta.ion_series_ms2_cz = run_acc.e.series.ms2_cz;
    // 1.13 item 10: the hybrid rows only under auto + -ion_series_hybrid both.
    run_meta.ion_series_ms2_hybrid = run_acc.e.series.ms2_hybrid;
    run_meta.ion_series_hybrid_row = hybrid_both;
  }
  // ---- 1.12 D: the alkylation call (#3g), once, right after the merge ----
  // Before the hand-off exports, so a reader of the call there sees the
  // same Call that -alkylation_out writes after phase 9.
  FASTag::Alkylation::Call alk_call;
  if (alk_place)
  {
    alk_call = FASTag::Alkylation::callAlkylation(run_acc.d.alk, alk_settings);
    // 1.13 (#24): on a shipped proteome, say when the tags were too short to place.
    if (alk_shipped.entries > 0) FASTag::Alkylation::markTagsTooShort(alk_call, max_len, recon_min_len);
  }
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
  FASTag::CensusScore::Tally score_tally;
  if (census_on)
  {
    ctsv.close();
    std::string census_head = FASTag::Census::header();
    census_head.pop_back();  // the newline
    // -census_score (1.16 item 4): ident_score from the finished table, to
    // a second .part file that replaces it; before the join, so identified
    // and triage stay the last two columns.
    if (census_score_on && !ctsv.fail())
    {
      FASTag::PartFile scored(census_part.writePath());
      std::string err;
      if (!scored.begin()
          || !FASTag::CensusScore::scoreTableAs(census_head, census_part.writePath(), scored.writePath(),
                                                FASTag::CensusScore::model(), score_tally, err)
          || !scored.commit())
      {
        OPENMS_LOG_ERROR << "Failed scoring " << census_out << ": " << (err.empty() ? scored.error() : err)
                         << std::endl;
        census_part.discard();
        return CANNOT_WRITE_OUTPUT_FILE;
      }
      census_head += FASTag::CensusScore::SCORE_COLUMN;
    }
    // -census_ids: the join, from the finished table to a second .part
    // file that replaces it before the commit.
    if (census_ids_on && !ctsv.fail())
    {
      FASTag::PartFile joined(census_part.writePath());
      std::string err;
      if (!joined.begin()
          || !FASTag::CensusIds::joinTableAs(census_head, census_part.writePath(), joined.writePath(),
                                             census_ids_index, census_triage_evalue, ids_tally, err)
          || !joined.commit())
      {
        OPENMS_LOG_ERROR << "Failed joining -census_ids to " << census_out << ": "
                         << (err.empty() ? joined.error() : err) << std::endl;
        census_part.discard();
        return CANNOT_WRITE_OUTPUT_FILE;
      }
      ids_counts = census_ids_index.counts();
      const std::string exact_why = census_ids_exact
          ? FASTag::CensusIds::exactRefusal(census_ids_loaded, census_ids_index, ids_counts, census_ids_run_check)
          : std::string();
      // Foreign references: only known when every spectrum was read.
      const double share = ids_counts.refs ? static_cast<double>(ids_counts.unmatched) /
                                                 static_cast<double>(ids_counts.refs)
                                           : 0.0;
      if (!exact_why.empty())
      {
        OPENMS_LOG_ERROR << exact_why << " No census was written; the other outputs are complete." << std::endl;
        census_part.discard();
        census_ids_refused = true;
      }
      else if (!subsampling && share > FASTag::CensusIds::REFUSE_UNMATCHED)
      {
        OPENMS_LOG_ERROR << "-census_ids: " << ids_counts.unmatched << " of " << ids_counts.refs
                         << " spectrum references match no spectrum of -in (more than "
                         << FASTag::CensusIds::REFUSE_UNMATCHED * 100
                         << "%): the file belongs to another run, or names spectra by an id FASTag cannot "
                            "match. No census was written; the other outputs are complete." << std::endl;
        census_part.discard();
        census_ids_refused = true;
      }
      else if (!subsampling && share > FASTag::CensusIds::WARN_UNMATCHED)
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
    std::vector<FD::Row> rows = FASTag::RunReport::runRows(run_meta, FASTag::RunReport::Emit::VERSIONED);
    rows.push_back(FASTag::Census::maxTagsRow(p.max_tag_count, lengths.size()));  // census 2
    for (FD::Row& r : FASTag::Census::summaryRows(tally, static_cast<std::uint64_t>(n_total), subsampling))
      rows.push_back(std::move(r));
    if (census_ids_on)
      for (FD::Row& r : FASTag::CensusIds::summaryRows(census_ids_loaded, ids_counts, ids_tally, census_ids,
                                                       census_ids_run_check, census_ids_fdr,
                                                       census_triage_evalue, !subsampling, census_ids_exact))
        rows.push_back(std::move(r));
    if (census_score_on)
      for (FD::Row& r : FASTag::CensusScore::summaryRows(FASTag::CensusScore::model(), score_tally))
        rows.push_back(std::move(r));
    FASTag::PartFile summary_part(census_summary_out);
    if (!summary_part.begin() || !FD::writeReport(summary_part.writePath(), rows) || !summary_part.commit())
    {
      OPENMS_LOG_ERROR << "Failed writing " << census_summary_out
                       << (summary_part.error().empty() ? std::string() : ": " + summary_part.error()) << std::endl;
      return CANNOT_WRITE_OUTPUT_FILE;
    }
    // -census_sorted_out: the committed table, ordered by ident_score.
    const std::string census_sorted_out = census_score_on ? getStringOption_("census_sorted_out") : std::string();
    if (!census_sorted_out.empty())
    {
      FASTag::PartFile sorted_part(census_sorted_out);
      std::string err;
      if (!sorted_part.begin() || !FASTag::CensusScore::writeSorted(census_out, sorted_part.writePath(), err)
          || !sorted_part.commit())
      {
        OPENMS_LOG_ERROR << "Failed writing " << census_sorted_out << ": "
                         << (err.empty() ? sorted_part.error() : err) << std::endl;
        return CANNOT_WRITE_OUTPUT_FILE;
      }
    }
    const auto count = [&](FASTag::Census::Status st) { return tally.by_status[static_cast<size_t>(st)]; };
    OPENMS_LOG_INFO << "Census: " << tally.ms2_seen << " MS2 spectra read, "
                    << count(FASTag::Census::Status::TAGGED) + count(FASTag::Census::Status::PLACED)
                    << " with a reported tag ("
                    << count(FASTag::Census::Status::PLACED) << " placed), "
                    << count(FASTag::Census::Status::NO_TAGS) << " no_tags -> " << census_out
                    << ", summary -> " << census_summary_out << std::endl;
    if (census_ids_on)
      OPENMS_LOG_INFO << "Census ids: " << ids_tally.by_ident[1] << " identified, " << ids_tally.by_ident[0]
                      << " not, " << ids_tally.by_ident[2] << " unknown; " << ids_tally.triage
                      << " triage candidates (best_evalue <= " << census_triage_evalue << ")" << std::endl;
    if (tally.n_processed() != n_ms2)
      OPENMS_LOG_WARN << "Census: " << tally.n_processed() << " processed spectra, but " << n_ms2
                      << " MS2 spectra were tagged; please report this." << std::endl;
  }

  // -qc_out (1.16): merge, measure resolution on the sampled profile
  // spectra (read with their peaks, before any centroiding), write.
  if (qc)
  {
    const auto qa = std::chrono::steady_clock::now();
    qc->finish();
    if (mzs) qc->setProfileUnavailable("mzpeak_input");
    else
    {
      // Thermo .raw: the tagging loop read vendor-centroided scans; the
      // resolution is measured on the same scans read again as acquired
      // (Representation::PROFILE), so the sample may include them.
      std::unique_ptr<IMSExperimentRandomAccess> vprof;
      if (vra)
      {
        try
        {
          vprof = FASTag::Thermo::open(in, FASTag::Thermo::Representation::PROFILE);
        }
        catch (const std::exception& e)
        {
          OPENMS_LOG_WARN << "-qc_out: '" << in << "' could not be reopened for profile scans (" << e.what()
                          << "); resolution is not measured." << std::endl;
        }
        if (!vprof) qc->setProfileUnavailable("thermo_profile_unavailable");
      }
      const std::vector<size_t> samples =
          vra ? (vprof ? qc->profileSamples(/*include_centroid=*/true) : std::vector<size_t>{}) : qc->profileSamples();
      for (const size_t i : samples)
      {
        try
        {
          if (vprof) qc->profile(i, vprof->getSpectrum(i));
          else if (fastmz) qc->profile(i, fastmz->getSpectrumAnyLevel(i));
          else if (mgf) qc->profile(i, mgf->getSpectrum(i));
          else if (streaming) qc->profile(i, ondisc->getSpectrum(i));
          else if (i < exp.size()) qc->profile(i, exp[i]);
        }
        catch (const Exception::BaseException& e)
        {
          OPENMS_LOG_WARN << "-qc_out: spectrum " << i << " could not be read for the resolution ("
                          << e.what() << "); it is skipped." << std::endl;
        }
      }
    }
    // The label mass of the tag ends (the -label_out call) decides the kit family.
    if (count_on)
    {
      FD::TerminusCounter qc_tc(digest_settings.window);
      for (const PerThread& pt : per_thread) qc_tc.merge(pt.digest);
      qc->setLabelEvidence(FASTag::RunQC::labelEvidence(qc_tc, digest_settings));
    }
    std::vector<FD::Row> rows = FASTag::RunReport::runRows(run_meta, FASTag::RunReport::Emit::VERSIONED);
    for (FD::Row& r : qc->rows(subsampling)) rows.push_back(std::move(r));
    FASTag::PartFile qc_part(qc_out);
    if (!qc_part.begin() || !FD::writeReport(qc_part.writePath(), rows) || !qc_part.commit())
    {
      OPENMS_LOG_ERROR << "Failed writing " << qc_out
                       << (qc_part.error().empty() ? std::string() : ": " + qc_part.error()) << std::endl;
      return CANNOT_WRITE_OUTPUT_FILE;
    }
    OPENMS_LOG_INFO << "QC report -> " << qc_out << " ("
                    << std::round(std::chrono::duration<double>(std::chrono::steady_clock::now() - qa).count() * 100.0) / 100.0
                    << " s after the tagging loop)" << std::endl;
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
    // -delta_out: aggregate the per-spectrum samples into a histogram.
    // 0.0005 Da bins, adjacent-bin local-max grouping into peaks; each row
    // reports the peak center, its spectrum count, and the most frequent
    // interpretations. Candidates, not identifications -- the README says so.
    if (delta_on)
    {
      std::map<int64_t, std::pair<uint64_t, std::map<std::string, uint64_t>>> bins;
      // 1.16 survey columns, per bin: sites of the localized gaps, the
      // unlocalized gaps, and the peptide masses (the ppm scale).
      struct SiteBin
      {
        std::map<std::string, uint64_t> sites;
        uint64_t unloc = 0;
        std::vector<double> masses;
        // 1.16b: evidence classes, flank, charge and observation classes.
        uint64_t frag = 0, seq = 0, ambiguous = 0, nonzero = 0, prec_flank = 0, charge_assumed = 0;
        std::map<std::string, uint64_t> classes;
      };
      std::map<int64_t, SiteBin> site_bins;
      size_t clamped = 0, samples = 0, survey_loc = 0, survey_unloc = 0;
      // 1.16b -delta_counts_out: the run's reconciliation, MS2 to rows.
      namespace SSc = FASTag::ShiftSurvey;
      size_t c_tagged = 0, c_placed = 0, c_exact = 0, c_region = 0, c_terminal = 0, c_frag = 0, c_seq = 0,
             c_amb = 0, c_unloc = 0, c_assumed = 0, c_assumed_gap = 0, c_prec = 0, c_evg = 0, c_zero_gap = 0;
      std::map<std::string, size_t> c_classes;
      for (const PerThread& pt : per_thread)
      {
        clamped += pt.delta_clamped;
        c_tagged += pt.delta_tagged;
        c_placed += pt.delta_placed;
        for (const auto& d : pt.delta)
        {
          ++samples;
          const int64_t bin_key = static_cast<int64_t>(std::llround(d.delta / 0.0005));
          auto& b = bins[bin_key];
          ++b.first;
          if (!d.interp.empty()) ++b.second[d.interp];
          const bool nonzero = std::fabs(d.delta) > 1e-6;
          if (!nonzero) ++c_exact;
          else if (d.region_gap) ++c_region;
          else ++c_terminal;
          if (nonzero && bin_key == 0) ++c_zero_gap;
          if (d.charge_assumed) { ++c_assumed; if (nonzero) ++c_assumed_gap; }
          if (nonzero && d.precursor_flank) ++c_prec;
          if (d.exact_vs_gapped) ++c_evg;
          if (delta_sites)
          {
            SiteBin& sb = site_bins[bin_key];
            sb.masses.push_back(d.pep_mass);
            if (d.charge_assumed) ++sb.charge_assumed;
            if (nonzero)
            {
              ++sb.nonzero;
              if (d.precursor_flank) ++sb.prec_flank;
              const char* cn = SSc::obsClassName(static_cast<SSc::ObsClass>(d.obs_class));
              ++sb.classes[cn];
              ++c_classes[cn];
            }
            if (!d.gap) continue;
            switch (static_cast<SSc::LocClass>(d.loc_class))
            {
              case SSc::LocClass::FRAGMENT_LOCALIZED: ++sb.frag; ++c_frag; break;
              case SSc::LocClass::SEQUENCE_CONSTRAINED: ++sb.seq; ++c_seq; break;
              case SSc::LocClass::AMBIGUOUS: ++sb.ambiguous; ++c_amb; break;
              default: ++c_unloc; break;
            }
            if (d.site.empty()) { ++sb.unloc; ++survey_unloc; }
            else { ++sb.sites[d.site]; ++survey_loc; }
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
        dtsv << "delta\tspectra\ttop_interps\tlocalized\tresidues\tunlocalized\tunimod\tpsimod\tisotope_error"
                "\tfragment_localized\tsequence_constrained\tambiguous\tprecursor_flank\tcharge_assumed\tclass\tisobars\n";
      }
      // Rows (ShiftSurvey::groupBins): -delta_group > 0 groups the bins
      // around the most populated ones, every bin in one row; 0 keeps the
      // 1.15 local-maximum rows.
      namespace SS = FASTag::ShiftSurvey;
      std::map<int64_t, uint64_t> bin_counts;
      for (const auto& kv : bins) bin_counts[kv.first] = kv.second.first;
      const std::vector<SS::BinGroup> groups = SS::groupBins(bin_counts, delta_group_bins);
      std::map<int64_t, int64_t> row_of;  // bin -> its row's center (-delta_spectra_out)
      size_t n_rows = 0;
      uint64_t rows_sum = 0, rows_zero_gap = 0;
      for (const SS::BinGroup& g : groups)
      {
        const auto& kv = *bins.find(g.center);
        uint64_t count = 0;
        std::map<std::string, uint64_t> interps;
        SiteBin row_sites;
        for (int64_t key : g.bins)
        {
          const auto& b = bins.at(key);
          count += b.first;
          for (const auto& ip : b.second) interps[ip.first] += ip.second;
          if (delta_per_spectrum) row_of[key] = g.center;
          if (!delta_sites) continue;
          const auto it = site_bins.find(key);
          if (it == site_bins.end()) continue;
          for (const auto& sc : it->second.sites) row_sites.sites[sc.first] += sc.second;
          row_sites.unloc += it->second.unloc;
          row_sites.masses.insert(row_sites.masses.end(), it->second.masses.begin(), it->second.masses.end());
          for (const auto& sc : it->second.classes) row_sites.classes[sc.first] += sc.second;
          row_sites.frag += it->second.frag;
          row_sites.seq += it->second.seq;
          row_sites.ambiguous += it->second.ambiguous;
          row_sites.nonzero += it->second.nonzero;
          row_sites.prec_flank += it->second.prec_flank;
          row_sites.charge_assumed += it->second.charge_assumed;
        }
        ++n_rows;
        rows_sum += count;
        if (g.center == 0)
          for (int64_t key : g.bins)
          {
            const auto it = site_bins.find(key);
            if (it != site_bins.end()) rows_zero_gap += it->second.nonzero;
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
        }
        if (!write_delta) continue;
        dtsv << dnum;
        for (size_t r = 0; r < ranked.size() && r < 3; ++r)
        {
          if (r) dtsv << ';';
          dtsv << ranked[r].second << ':' << ranked[r].first;
        }
        if (ranked.empty()) dtsv << '-';
        {
          // 1.16 survey columns. Names only for a localized site; the
          // tolerance in ppm is of the row's median peptide mass.
          uint64_t nloc = 0;
          std::vector<SS::Site> sites;
          std::vector<uint64_t> support;
          for (const auto& sc : row_sites.sites)
          {
            nloc += sc.second;
            SS::Site st;
            if (SS::parseSiteKey(sc.first, st)) { sites.push_back(st); support.push_back(sc.second); }
          }
          double ref = 0.0;
          if (!row_sites.masses.empty())
          {
            std::vector<double>& m = row_sites.masses;
            std::sort(m.begin(), m.end());
            ref = m.size() % 2 ? m[m.size() / 2] : 0.5 * (m[m.size() / 2 - 1] + m[m.size() / 2]);
          }
          const double tol_da = survey_ppm ? survey_tol * ref * 1e-6 : survey_tol;
          const double row_delta = kv.first * 0.0005;
          constexpr size_t NAME_CAP = 5;
          // Uncapped for the isotope reading (a better-supported name past the cap counts too).
          auto um = SS::match(survey_unimod, row_delta, tol_da, sites, survey_fixed, SIZE_MAX, &support);
          // 1.16b: an isotope error is a precursor's, so the reading needs
          // at least half of the row's gaps on the precursor-derived flank
          // (-delta_isotope_flank any: 1.16a, every row).
          const bool iso_flank = !delta_iso_precursor ||
                                 (row_sites.nonzero > 0 && 2 * row_sites.prec_flank >= row_sites.nonzero);
          const std::string iso =
              iso_flank ? SS::isotopeError(row_delta, tol_da, um, nloc, survey_ppm ? ref : 0.0) : std::string("-");
          const std::string isobars = SS::isobarClass(row_delta, um, sites, survey_fixed, delta_isobar_tol);
          // 1.15.5: a two-modification reading that fits the localized site goes first
          // (Acetyl+Oxidation on a protein N-terminal Met, not Carboxymethyl@N-term).
          const std::string combo = SS::siteCombination(row_delta, um, sites, &support, survey_unimod, survey_fixed,
                                                        delta_isobar_tol, survey_ppm ? ref : 0.0);
          if (um.size() > NAME_CAP) um.resize(NAME_CAP);
          const auto pm = SS::match(survey_psimod, row_delta, tol_da, sites, survey_fixed, NAME_CAP, &support);
          dtsv << '\t' << nloc << '\t' << SS::formatSites(row_sites.sites) << '\t' << row_sites.unloc << '\t'
               << (combo.empty() ? SS::format(um, false, survey_ppm ? ref : 0.0)
                                 : um.empty() ? combo : combo + ";" + SS::format(um, false, survey_ppm ? ref : 0.0))
               << '\t'
               << SS::format(pm, true, survey_ppm ? ref : 0.0) << '\t' << iso;
          // The observation classes, most frequent first (three at most).
          std::vector<std::pair<uint64_t, std::string>> cls;
          for (const auto& c : row_sites.classes) cls.emplace_back(c.second, c.first);
          std::sort(cls.begin(), cls.end(), [](const auto& a, const auto& b) {
            return a.first != b.first ? a.first > b.first : a.second < b.second;
          });
          std::string ccell;
          for (size_t i = 0; i < cls.size() && i < 3; ++i)
            ccell += (i ? "," : "") + cls[i].second + ":" + std::to_string(cls[i].first);
          dtsv << '\t' << row_sites.frag << '\t' << row_sites.seq << '\t' << row_sites.ambiguous << '\t'
               << row_sites.prec_flank << '\t' << row_sites.charge_assumed << '\t' << (ccell.empty() ? "-" : ccell)
               << '\t' << isobars;
        }
        dtsv << '\n';
      }
      if (delta_per_spectrum)
      {
        // One line per sampled spectrum, in input order; a spectrum in a
        // bin no 1.15 row took (-delta_group 0) has row "-".
        std::vector<const DeltaSample*> all;
        all.reserve(samples);
        for (const PerThread& pt : per_thread)
          for (const auto& d : pt.delta) all.push_back(&d);
        std::sort(all.begin(), all.end(), [](const DeltaSample* a, const DeltaSample* b) { return a->index < b->index; });
        std::ofstream stsv(delta_spectra_out.c_str());
        if (!stsv)
        {
          OPENMS_LOG_ERROR << "Cannot open output file " << delta_spectra_out << " for writing." << std::endl;
          return CANNOT_WRITE_OUTPUT_FILE;
        }
        stsv << "spectrum\tdelta\trow\tinterp\tpeptide\tsite\tsite_pos\tlocalized\tloc_evidence\tevalue"
                "\tdelta_full\ttag\tprotein\tpos\torientation\tgap_side\tflank\tregion\tcharge\tcharge_source"
                "\tprecursor_isotope\tloc_class\tloc_score\tloc_ties\tloc_excluded\tnull_class\tnull_evidence"
                "\tobs_class\tobs_detail\tn_placements\tn_exact\tn_gapped\tn_peptides\ttag_support\ttags_placed"
                "\tplacements\n";
        char num[64];
        for (const DeltaSample* d : all)
        {
          const int64_t key = static_cast<int64_t>(std::llround(d->delta / 0.0005));
          const auto r = row_of.find(key);
          stsv << d->native_id << '\t';
          std::snprintf(num, sizeof num, "%.6f\t", d->delta);
          stsv << num;
          if (r != row_of.end())
          {
            std::snprintf(num, sizeof num, "%.4f", r->second * 0.0005);
            stsv << num;
          }
          else stsv << '-';
          stsv << '\t' << (d->interp.empty() ? "-" : d->interp) << '\t' << d->peptide << '\t';
          if (d->site_pos >= 0 && d->site_pos < static_cast<int>(d->peptide.size()))
            stsv << d->peptide[static_cast<size_t>(d->site_pos)] << '\t' << d->site_pos + 1;
          else stsv << "-\t-";
          std::snprintf(num, sizeof num, "%.3g", d->evalue);
          stsv << '\t' << (d->site.empty() ? "-" : d->site) << '\t' << d->loc_evidence << '\t' << num;
          std::snprintf(num, sizeof num, "%.10g", d->delta);
          stsv << '\t' << num << '\t' << d->tag << '\t' << d->protein << '\t' << d->pos + 1 << '\t'
               << (d->reversed ? "reversed" : "forward") << '\t' << d->gap_side << '\t'
               << (d->gap_side == '-' ? "-" : d->precursor_flank ? "precursor" : "fragment") << '\t';
          if (d->region_hi >= d->region_lo) stsv << d->region_lo + 1 << '-' << d->region_hi + 1;
          else stsv << '-';
          stsv << '\t' << d->charge << '\t' << d->charge_src << '\t' << d->prec_iso << '\t'
               << SSc::locClassName(static_cast<SSc::LocClass>(d->loc_class)) << '\t' << d->loc_score << '\t'
               << d->loc_ties << '\t' << d->loc_excluded << '\t' << (d->null_class.empty() ? "-" : d->null_class)
               << '\t' << d->null_evidence << '\t' << SSc::obsClassName(static_cast<SSc::ObsClass>(d->obs_class))
               << '\t' << (d->obs_detail.empty() ? "-" : d->obs_detail) << '\t' << d->n_placements << '\t'
               << d->n_exact << '\t' << d->n_gapped << '\t' << d->n_peptides << '\t' << d->tag_support << '\t'
               << d->tags_placed << '\t' << (d->placements.empty() ? "-" : d->placements) << '\n';
        }
        stsv.close();
        if (stsv.fail())
        {
          OPENMS_LOG_ERROR << "Failed writing " << delta_spectra_out << "." << std::endl;
          return CANNOT_WRITE_OUTPUT_FILE;
        }
      }
      if (!delta_counts_out.empty())
      {
        // 1.16b: every MS2 to the rows, with the sums that must hold.
        size_t ms2 = 0;
        for (const PerThread& pt : per_thread) ms2 += pt.ms2;
        std::ofstream ctsv(delta_counts_out.c_str());
        if (!ctsv)
        {
          OPENMS_LOG_ERROR << "Cannot open output file " << delta_counts_out << " for writing." << std::endl;
          return CANNOT_WRITE_OUTPUT_FILE;
        }
        const auto ok = [](bool b) { return b ? "ok" : "FAIL"; };
        ctsv << "key\tvalue\n"
             << "ms2_read\t" << ms2 << "\n"
             << "ms2_tagged\t" << c_tagged << "\n"
             << "ms2_placed\t" << c_placed << "\n"
             << "clamped_excluded\t" << clamped << "\n"
             << "samples\t" << samples << "\n"
             << "samples_exact\t" << c_exact << "\n"
             << "samples_gap_region\t" << c_region << "\n"
             << "samples_gap_terminal\t" << c_terminal << "\n"
             << "gap_fragment_localized\t" << c_frag << "\n"
             << "gap_sequence_constrained\t" << c_seq << "\n"
             << "gap_ambiguous\t" << c_amb << "\n"
             << "gap_unlocalized\t" << c_unloc << "\n"
             << "gap_precursor_flank\t" << c_prec << "\n"
             << "samples_charge_assumed\t" << c_assumed << "\n"
             << "gaps_charge_assumed\t" << c_assumed_gap << "\n"
             << "samples_exact_vs_gapped\t" << c_evg << "\n"
             << "gaps_in_zero_bin\t" << c_zero_gap << "\n"
             << "gaps_in_zero_row\t" << rows_zero_gap << "\n";
        for (const auto& c : c_classes) ctsv << "class_" << c.first << "\t" << c.second << "\n";
        ctsv << "rows\t" << n_rows << "\n"
             << "rows_spectra_sum\t" << rows_sum << "\n"
             << "check_tagged_le_ms2\t" << ok(c_tagged <= ms2) << "\n"
             << "check_placed_le_tagged\t" << ok(c_placed <= c_tagged) << "\n"
             << "check_placed_eq_samples_plus_clamped\t" << ok(c_placed == samples + clamped) << "\n"
             << "check_samples_eq_exact_region_terminal\t" << ok(samples == c_exact + c_region + c_terminal) << "\n"
             << "check_region_eq_classes\t" << ok(c_region == c_frag + c_seq + c_amb + c_unloc) << "\n"
             << "check_rows_sum_eq_samples\t" << ok(rows_sum == samples) << "\n";
        ctsv.close();
        if (ctsv.fail())
        {
          OPENMS_LOG_ERROR << "Failed writing " << delta_counts_out << "." << std::endl;
          return CANNOT_WRITE_OUTPUT_FILE;
        }
      }
      if (write_delta)
      {
        OPENMS_LOG_INFO << "Delta counts: " << c_placed << " MS2 placed of " << c_tagged << " tagged; " << samples
                        << " samples (" << c_exact << " exact, " << c_region << " gapped, " << c_terminal
                        << " terminal gaps); gaps " << c_frag << " fragment-localized, " << c_seq
                        << " sequence-constrained, " << c_amb << " ambiguous, " << c_unloc << " unlocalized; "
                        << rows_sum << " in " << n_rows << " rows" << std::endl;
        dtsv.close();
        if (dtsv.fail())
        {
          OPENMS_LOG_ERROR << "Failed writing " << delta_out << "." << std::endl;
          return CANNOT_WRITE_OUTPUT_FILE;
        }
        OPENMS_LOG_INFO << "Delta histogram: " << samples << " spectra sampled"
                        << (clamped ? ", " + std::to_string(clamped) + " excluded (clamped flank)" : std::string())
                        << " -> " << delta_out << std::endl;
        OPENMS_LOG_INFO << "Delta sites: " << survey_loc << " gaps localized, " << survey_unloc
                        << " unlocalized; names from " << survey_unimod.size() << " Unimod and "
                        << survey_psimod.size() << " PSI-MOD entries" << std::endl;
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
      const char* kind = verdict.kind == Verdict::Kind::COMPATIBLE ? "compatible"
                       : verdict.kind == Verdict::Kind::NON_TRYPTIC ? "non_tryptic"
                                                             : "inconclusive";
      // 1.13 item 20: the rule the placements are kept by.
      FASTag::Cleavage::Choice sl_choice;
      std::string sl_withheld;  // what the placement check withheld, for the TSV header
      if (sl_nontryptic)
      {
        // post-1.13.1 (aspn): an Asp-N call under `auto` is semi-specific
        // unless the user chose the specificity (on the command line, or a
        // value other than the default from an INI).
        sl_choice = FASTag::Cleavage::choose(sl_protease, sl_spec, verdict,
                                             optionGiven_("shortlist_specificity"));
        std::string withheld;
        if (!fasta_out.empty()) withheld = "-fasta_out";
        if (!search_config_out.empty()) withheld += (withheld.empty() ? "" : " or ") + std::string("-search_config_out");
        OPENMS_LOG_INFO << "Shortlist protease check: " << kind << " (" << verdict.reason << ")." << std::endl;
        if (!sl_choice.refuse && sl_choice.mismatch)
          OPENMS_LOG_WARN << "Shortlist placement: " << sl_choice.rule->name << ", "
                          << FASTag::Cleavage::specificityName(sl_choice.specificity) << " specificity ("
                          << sl_choice.reason << "); the engine searches the named rule, not the call."
                          << std::endl;
        else if (!sl_choice.refuse)
          OPENMS_LOG_INFO << "Shortlist placement: " << sl_choice.rule->name << ", "
                          << FASTag::Cleavage::specificityName(sl_choice.specificity) << " specificity ("
                          << sl_choice.reason << ")." << std::endl;
        else if (force)
          OPENMS_LOG_WARN << "Shortlist placement: " << sl_choice.reason
                          << "; -shortlist_force writes the hand-off outputs anyway." << std::endl;
        else if (withheld.empty())
          OPENMS_LOG_WARN << "Shortlist placement: " << sl_choice.reason
                          << ", so the shortlist may not describe this run (the call is in its header)." << std::endl;
        else
          OPENMS_LOG_ERROR << "Shortlist placement: " << sl_choice.reason
                           << ", so the shortlist may not describe this run. Not writing " << withheld
                           << " (-shortlist_force overrides)." << std::endl;
        if (sl_choice.auto_unspecific)
          OPENMS_LOG_WARN << "Shortlist export: the tag ends call no protease (unspecific), so the shortlist and "
                             "the exported search are unspecific. An unspecific search of the shortlist can take "
                             "longer and more memory than a full search with the true protease; if the protease "
                             "is known, name it with -shortlist_protease (and -shortlist_specificity semi)."
                          << std::endl;
        handoff_refused = sl_choice.refuse && !force && !withheld.empty();
        if (handoff_refused) sl_withheld = withheld;
        sl_plan.enzyme = FASTag::Cleavage::engineEnzyme(*sl_choice.rule, sl_choice.specificity);
        if (shortlist_on)
        {
          auto& ev = run_acc.a.sl;
          const std::size_t n_all = ev.size();
          std::stable_sort(ev.begin(), ev.end(),
                           [](const FASTag::Shortlist::Evidence& x, const FASTag::Shortlist::Evidence& y) {
                             return x.protein < y.protein;
                           });
          const FASTag::Cleavage::WindowFilter wf(*sl_choice.rule, sl_choice.specificity,
                                                  recon_mc);
          std::string prot;
          std::uint32_t cur = std::numeric_limits<std::uint32_t>::max();
          std::size_t w = 0;
          for (std::size_t i = 0; i < n_all; ++i)
          {
            if (ev[i].protein != cur)
            {
              cur = ev[i].protein;
              prot = pindex.proteinText(cur);
            }
            if (wf.accepts(prot, ev[i].window_start, ev[i].window_len)) ev[w++] = ev[i];
          }
          ev.resize(w);
          OPENMS_LOG_INFO << "Shortlist placement: " << w << " of " << n_all
                          << " placements by flank mass fit the rule." << std::endl;
        }
      }
      else if (verdict.kind == Verdict::Kind::COMPATIBLE)
        OPENMS_LOG_INFO << "Shortlist protease check: " << verdict.reason << "." << std::endl;
      else if (verdict.kind == Verdict::Kind::INCONCLUSIVE)
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
                          << (fasta_out.empty() || handoff_refused || sl_background.empty()
                                  ? ""
                                  : "; -fasta_out holds the background only")
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
          if (sl_nontryptic)
            header.insert(header.begin() + 4,
                          "placement: " + sl_choice.rule->name + ", " +
                              FASTag::Cleavage::specificityName(sl_choice.specificity) + " specificity, " +
                              (sl_choice.rule->unspecific() || sl_choice.specificity ==
                                                                   FASTag::Cleavage::Specificity::NONE
                                   ? std::string("no missed-cleavage limit")
                                   : "missed cleavages <= " + std::to_string(recon_mc)) +
                              ", windows by flank mass (" + sl_choice.reason + ")" +
                              (sl_withheld.empty() ? std::string() : "; " + sl_withheld + " withheld"));
          if (!recipe_defaults_.empty())
            header.push_back("shortlist recipe defaults (doc/SHORTLIST.md): " + recipe_defaults_);
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
      // 1.14: a reduced database without a protein (the shortlist kept none
      // and there is no background) lets the engine search nothing. Neither
      // it nor the configuration naming it is written, files an earlier run
      // left at those paths are removed, the other outputs are written and
      // the run ends with UNEXPECTED_RESULT.
      if (!handoff_refused && !fasta_out.empty() &&
          static_cast<std::size_t>(std::count(keep.begin(), keep.end(), true)) + sl_background.size() == 0)
      {
        empty_database = true;
        std::vector<std::string> stale;
        for (const std::string& f : {fasta_out, search_config_out})
        {
          std::error_code ec;
          if (!f.empty() && std::filesystem::is_regular_file(f, ec) && std::filesystem::remove(f, ec))
            stale.push_back(f);
        }
        std::string removed;
        for (const std::string& f : stale) removed += (removed.empty() ? "" : ", ") + f;
        OPENMS_LOG_ERROR << "Reduced FASTA: no protein has " << sl_settings.min_spectra
                         << " qualifying spectra and there is no -shortlist_background, so the reduced database "
                            "would be empty. Not writing -fasta_out"
                         << (search_config_out.empty() ? "" : " and -search_config_out")
                         << (removed.empty() ? std::string() : " (removed " + removed + ", left by an earlier run)")
                         << ". Search the full database; if the protease is not trypsin, name it with "
                            "-shortlist_protease."
                         << std::endl;
      }
      // The engine configuration's text is made before -fasta_out is
      // written: a rule the engine cannot express (1.13 item 20: 'auto'
      // calling a protease without a Comet enzyme entry) writes neither.
      std::string sc_text;
      if (!handoff_refused && !empty_database && !search_config_out.empty())
      {
        std::string err;
        if (search_engine == "sage") sc_text = FASTag::SearchConfig::renderSage(sl_plan);
        else if (search_engine == "msfragger") sc_text = FASTag::SearchConfig::renderMSFragger(sl_plan, &err);
        else if (sl_template.empty()) sc_text = FASTag::SearchConfig::renderComet(sl_plan, &err);
        else
        {
          std::vector<std::pair<std::string, std::string>> keys;
          err = FASTag::SearchConfig::cometKeys(sl_plan, keys);
          if (err.empty())
          {
            const auto m = sl_nontryptic
                               ? FASTag::SearchConfig::mergeKeyValueTemplate(sl_template, keys, sl_plan.enzyme)
                               : FASTag::SearchConfig::mergeKeyValueTemplate(sl_template, keys);
            for (const std::string& w : m.warnings) OPENMS_LOG_WARN << "-search_config_template: " << w << "." << std::endl;
            err = m.error;
            sc_text = m.text;
          }
        }
        if (!err.empty())
        {
          OPENMS_LOG_ERROR << "-search_config_out: " << err << (sl_nontryptic ? " (the placement rule " + sl_plan.enzyme.name + ")" : std::string())
                           << ". Neither " << (fasta_out.empty() ? std::string() : "-fasta_out nor ")
                           << "-search_config_out written." << std::endl;
          return ILLEGAL_PARAMETERS;
        }
      }
      if (!handoff_refused && !empty_database && !fasta_out.empty())
      {
        // 1.13 #18: MSFragger generates no decoys; its -fasta_out gets reversed ones.
        const auto res = FASTag::Shortlist::writeReducedFasta(recon_db, keep, sl_background, fasta_out,
                                                              msfragger_on ? msfragger_prefix : std::string());
        if (!res.ok)
        {
          OPENMS_LOG_ERROR << "Failed writing " << fasta_out << ": " << res.error
                           << "; -search_config_out not written." << std::endl;
          return CANNOT_WRITE_OUTPUT_FILE;
        }
        if (res.decoys > 0)
          OPENMS_LOG_INFO << "Reduced FASTA: " << res.entries << " entries and " << res.decoys
                          << " reversed decoys ('" << msfragger_prefix << "', for MSFragger) -> " << fasta_out
                          << std::endl;
        else
          OPENMS_LOG_INFO << "Reduced FASTA: " << res.entries << " entries (no decoys) -> " << fasta_out << std::endl;
      }
      if (!handoff_refused && !empty_database && !search_config_out.empty())
      {
        std::string err;
        FASTag::PartFile pf(search_config_out);
        std::ofstream cf;
        if (!pf.open(cf, std::ios::out | std::ios::binary)) err = pf.error();
        if (err.empty())
        {
          cf << sc_text;
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
      else if (vra)
      {
        // Thermo: the reader's run-level settings (instrument, analyzers,
        // the Thermo native-ID format MS:1000768).
        if (auto rs = vra->getExperimentalSettings()) es = *rs;
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
      // 1.13 digqual: the quality rows, after every 1.12 row.
      if (!digest_quality.empty())
      {
        const FD::Quality qual = FD::reportQuality(tc, protease_models, more, digest_quality, digest_settings);
        const auto qrows = FD::qualityRows(qual, FD::reportSettings(digest_settings, tc));
        rows.insert(rows.end(), qrows.begin(), qrows.end());
      }
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

  // ---- 1.12 D: -alkylation_out (#3g); format 2 (feedback 202dbcf4): the
  // tag-only call, refined by the placements when there is a database ----
  const double alkt_tol_da = alkylation_shadow_on ? FASTag::AlkylationTags::edgeToleranceDa(len_params.front()) : 0.0;
  FASTag::AlkylationTags::ReportInfo alkt_info;
  if (alkylation_shadow_on)
  {
    alkt_info.tol_da = alkt_tol_da;
    alkt_info.tol_ppm = len_params.front().tol_ppm;
    alkt_info.resolved_below_mz = alkt_ctx.resolved_below_mz;
    alkt_info.dropped = alkt_dropped;
    alkt_info.alpha = alkt_alpha;
    for (int L : lengths) alkt_info.lengths += (alkt_info.lengths.empty() ? "" : ",") + std::to_string(L);
  }
  if (alkylation_on)
  {
    const FASTag::AlkylationTags::Tally& tt = run_acc.d.alkt;
    // Codex7 review n1: the tag call never names a form with an exact alias
    // (aliasGuard); the placements on a database can confirm it.
    const FASTag::Alkylation::Call tag_call =
        FASTag::AlkylationTags::aliasGuard(FASTag::AlkylationTags::callTags(tt, alk_settings, alkt_ctx), alkt_ctx);
    const FASTag::Alkylation::Call call = FASTag::Alkylation::combineCalls(tag_call, alk_place ? &alk_call : nullptr);
    std::vector<FD::Row> rows = FASTag::RunReport::runRows(run_meta, FASTag::RunReport::Emit::VERSIONED);
    if (alk_place)
    {
      FASTag::Alkylation::ReportInfo info;
      info.database = recon_db;
      info.database_source = alk_db_source;
      if (alk_shipped.entries > 0)
      {
        info.database_release = FASTag::Alkylation::shippedRelease(alk_shipped);
        info.min_tag_length = recon_min_len;
        info.longest_tag = max_len;
      }
      for (const auto& m : p.mods)
        if (!m.variable && m.residue == 'C') info.reagent_note += (info.reagent_note.empty() ? "" : "+") + m.name;
      for (FD::Row& r : FASTag::Alkylation::alkylationRows(run_acc.d.alk, alk_call, alk_settings, alk_forms, info))
        rows.push_back(std::move(r));
    }
    else
      for (FD::Row& r : FASTag::Alkylation::tagOnlyRunRows(alk_settings)) rows.push_back(std::move(r));
    for (FD::Row& r : FASTag::AlkylationTags::rows(tt, tag_call, alk_settings, alkt_cands, alkt_info)) rows.push_back(std::move(r));
    for (FD::Row& r : FASTag::Alkylation::callRows("alkylation_call", call, alk_settings, alk_forms,
                                                   call.source == "placement" ? "binned spectra" : "votes", true))
      rows.push_back(std::move(r));
    FASTag::PartFile alk_part(alkylation_out);
    if (!alk_part.begin() || !FD::writeReport(alk_part.writePath(), rows) || !alk_part.commit())
    {
      OPENMS_LOG_ERROR << "Failed writing " << alkylation_out
                       << (alk_part.error().empty() ? std::string() : ": " + alk_part.error()) << std::endl;
      return CANNOT_WRITE_OUTPUT_FILE;
    }
    OPENMS_LOG_INFO << "Alkylation: " << tt.spectra << " of " << tt.spectra_tagged << " spectra vote from their tags"
                    << (alk_place ? ", " + std::to_string(run_acc.d.alk.spectra) + " have a single-Cys placement" : std::string())
                    << ", " << (call.called ? std::string("call ") + FASTag::Alkylation::className(call.cls)
                                            : "no_call " + call.reason +
                                                  (call.reason == FASTag::Alkylation::ALIAS_NEEDS_DATABASE
                                                       ? std::string(" (candidate ") + FASTag::Alkylation::className(call.cls) +
                                                             ", needs a protein database to confirm)"
                                                       : std::string()))
                    << " (" << call.source << ") -> " << alkylation_out << std::endl;
  }

  // ---- 1.13 #22: -alkylation_tags_out ----
  if (alkylation_tags_on)
  {
    const FASTag::AlkylationTags::Tally& at = run_acc.d.alkt;
    FASTag::Alkylation::Settings as;
    as.min_spectra = static_cast<std::uint64_t>(getIntOption_("alkylation_min_spectra"));
    as.min_share = getDoubleOption_("alkylation_min_share");
    const FASTag::Alkylation::Call call =
        FASTag::AlkylationTags::aliasGuard(FASTag::AlkylationTags::callTags(at, as, alkt_ctx), alkt_ctx);
    std::vector<FD::Row> rows = FASTag::RunReport::runRows(run_meta, FASTag::RunReport::Emit::VERSIONED);
    for (FD::Row& r : FASTag::AlkylationTags::rows(at, call, as, alkt_cands, alkt_info)) rows.push_back(std::move(r));
    FASTag::PartFile part(alkylation_tags_out);
    if (!part.begin() || !FD::writeReport(part.writePath(), rows) || !part.commit())
    {
      OPENMS_LOG_ERROR << "Failed writing " << alkylation_tags_out
                       << (part.error().empty() ? std::string() : ": " + part.error()) << std::endl;
      return CANNOT_WRITE_OUTPUT_FILE;
    }
    OPENMS_LOG_INFO << "Alkylation (tags, no database): " << at.spectra << " of " << at.spectra_tagged
                    << " spectra vote, "
                    << (call.called ? std::string("call ") + FASTag::Alkylation::className(call.cls)
                                    : "no_call " + call.reason +
                                          (call.reason == FASTag::Alkylation::ALIAS_NEEDS_DATABASE
                                               ? std::string(" (candidate ") + FASTag::Alkylation::className(call.cls) + ")"
                                               : std::string()))
                    << " -> " << alkylation_tags_out << std::endl;
  }

  // ---- phase 10: species detection ---------------------------------------
  if (const std::optional<ExitCodes> rc = detectSpecies_(want_species, species_orient, species_both, species_call_on,
                                                         species_call_params, species_call_params_path, in, out,
                                                         lengths, length_opt, by_spec))
    return *rc;

  OPENMS_LOG_INFO << n_ms2 << " MS2 spectra, " << n_tags << " tags";
  if (filtering) OPENMS_LOG_INFO << " -> " << n_reported << " after filtering";
  OPENMS_LOG_INFO << std::endl;
  if (subsume_on) OPENMS_LOG_INFO << "Subsumed tags dropped: " << n_subsumed << std::endl;
  // 1.15.5 change B: stderr only (stdout's summary line is read by gates).
  if (itms_on_)
    std::cerr << "Tolerance by analyzer: " << n_ms2_itms.load() << " ion-trap MS2 tagged at " << itms_tol
              << " Da, " << n_ms2_other.load() << " other MS2 at " << p.frag_tol << (p.tol_ppm ? " ppm" : " Da")
              << std::endl;
  // 1.16: a run with spectra but nothing to tag must not pass for a run
  // without tags. Spectra that are MS2, or carry a precursor, yet none could
  // be tagged mean the MS/MS was not read (SCIEX MS Data Converter mzML read
  // as all MS1 before 1.16): refused after the outputs are written. With no
  // sign of MS/MS at all the run is MS1-only and FASTag only warns.
  const bool no_ms2_read = n_total > 0 && n_ms2 == 0 && n_untaggable_msn > 0;
  if (no_ms2_read)
    OPENMS_LOG_ERROR << "None of the " << n_total << " spectra of '" << in
                     << "' is an MS2 spectrum with peaks and a precursor, although " << n_untaggable_msn
                     << " of them are MS2 or carry a precursor: FASTag did not read the run's MS/MS spectra "
                        "(for example, MS levels it cannot find in the mzML). The outputs are written but "
                        "hold no tags. Rewriting the file with OpenMS FileConverter may help; please report it."
                     << std::endl;
  else if (n_total > 0 && n_ms2 == 0)
    OPENMS_LOG_WARN << "Warning: none of the " << n_total << " spectra of '" << in
                    << "' is an MS2 spectrum (no precursor either): an MS1-only run has nothing to tag, "
                       "and the outputs hold no tags." << std::endl;
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
                    << sel_of(ChargeSource::INFERRED) << " inferred, " << sel_of(ChargeSource::AMBIGUOUS)
                    << " ambiguous (better of two), " << sel_of(ChargeSource::POSSIBLE) << " listed, "
                    << sel_of(ChargeSource::ENUMERATED) << " enumerated and " << sel_of(ChargeSource::ASSUMED)
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
  if (n_mz0 > 0)
    OPENMS_LOG_WARN << n_mz0 << " spectra have a selected ion m/z of 0 (or below 0, or not a number): "
                       "the converter wrote m/z 0 for precursors it had no m/z for. "
                    << n_mz0_target << " of them were tagged at their isolation window target m/z instead, "
                       "as if the selected ion m/z were missing (OpenMS MzMLFile keeps the 0)"
                    << (n_mz0 > n_mz0_target ? "; the other " + std::to_string(n_mz0 - n_mz0_target)
                                                   + " have no isolation target and yield no tags."
                                             : std::string("."))
                    << std::endl;
  // ---- 1.13: -check_header_charge summary and -check_header_out ----
  if (hdr_check_on)
  {
    using FASTag::Hyp::HeaderVerdict;
    using FASTag::Hyp::CallBasis;
    const auto v = [&](HeaderVerdict x) { return hdr_counts.verdict[static_cast<size_t>(x)]; };
    const auto by = [&](CallBasis b) { return hdr_counts.disagree_by[static_cast<size_t>(b)]; };
    const bool both = hyp_param.header_check == FASTag::Hyp::HeaderCheck::BOTH;
    std::string moves;
    for (int a = 1; a <= FASTag::Hyp::CHARGE_LIMIT; ++a)
      for (int b = 1; b <= FASTag::Hyp::CHARGE_LIMIT; ++b)
        if (hdr_counts.moves[a][b] > 0)
          moves += (moves.empty() ? "" : ", ") + std::to_string(a) + "+ -> " + std::to_string(b) + "+: "
                 + std::to_string(hdr_counts.moves[a][b]);
    std::ostringstream m;
    m << "Header charge check (-check_header_charge " << getStringOption_("check_header_charge") << "): "
      << hdr_counts.checked << " of " << n_ms2 << " MS2 spectra carry a precursor charge; " << v(HeaderVerdict::AGREE)
      << " agree with their charge evidence, " << v(HeaderVerdict::DISAGREE) << " disagree ("
      << by(CallBasis::MS1_ISOTOPE) << " by MS1 isotope spacing, " << by(CallBasis::COMPLEMENT) << " by complement pairs, "
      << by(CallBasis::ONE_PLUS) << " by the 1+ test" << (moves.empty() ? std::string() : "; " + moves) << "), "
      << v(HeaderVerdict::AMBIGUOUS) << " ambiguous and " << v(HeaderVerdict::NO_CALL) << " without evidence; "
      << (both ? std::to_string(hdr_counts.both) + " disagreeing spectra were tagged under both charges."
               : std::string("every spectrum was tagged at its header charge."));
    if (v(HeaderVerdict::DISAGREE) > 0) OPENMS_LOG_WARN << m.str() << std::endl;
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
                        "\theader_excess\tcall_excess\theader_ruled_out\theader_peaks_above\tms1_charge\tms1_peaks\tflag_basis"
                        "\tflag_charge\tverdict\ttagged_charge\n";
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
        FASTag::appendNum(buf, h.header_peaks_above); buf += '\t';
        FASTag::appendNum(buf, h.ms1_charge); buf += '\t';
        FASTag::appendNum(buf, h.ms1_peaks); buf += '\t';
        buf += FASTag::Hyp::basisName(h.flag_basis); buf += '\t';
        FASTag::appendNum(buf, h.flag_charge); buf += '\t';
        buf += FASTag::Hyp::verdictName(h.verdict); buf += '\t';
        // Under both, a flagged spectrum's two charges, ascending.
        const int z = both ? h.replacement() : h.header;
        if (z >= 1 && z <= FASTag::Hyp::CHARGE_LIMIT && z != h.header)
        {
          FASTag::appendNum(buf, std::min(z, h.header)); buf += ',';
          FASTag::appendNum(buf, std::max(z, h.header));
        }
        else FASTag::appendNum(buf, h.header);
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
    if (ion_mode == IS::Mode::BY)
    {
      if (act.warnUnderBy()) OPENMS_LOG_WARN << IS::byModeWarning(act) << std::endl;
    }
    else
    {
      std::cerr << IS::seriesInfo(ion_mode, run_acc.e.series, act, hybrid_both) << std::endl;
      // 1.13 item 10: under -ion_series_hybrid both the hybrid spectra are
      // read as both series, so the 1.12 hybrid WARN does not apply.
      if (ion_mode == IS::Mode::AUTO && !hybrid_both && IS::warnHybridUnderAuto(act))
        OPENMS_LOG_WARN << IS::hybridAutoWarning(act) << std::endl;
      if (ion_mode == IS::Mode::CZ && IS::warnCollisionalUnderCz(act))
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
        // As tagged: a selected-ion m/z 0 written as the isolation target.
        FASTag::useSelectedIonTarget(sp);
        sink(sp);
      };
      if (mzpeak_in)
      {
        FASTag::readMzPeakSpectra(in, mzpeak_decode_threads, kept_idx, clean, pick_mzpeak);
        return;
      }
      for (const Size i : kept_idx)
      {
        MSSpectrum sp = read_spectrum(i);
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
  // 1.14: the reduced FASTA would have held no protein and was not written.
  if (empty_database) return UNEXPECTED_RESULT;
  // #11B: -census_ids named mostly foreign spectra; the census was withheld.
  if (census_ids_refused) return INCOMPATIBLE_INPUT_DATA;
  // 1.16: spectra with MS/MS signs, but no MS2 could be tagged.
  if (no_ms2_read) return UNEXPECTED_RESULT;
  return EXECUTION_OK;
}

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
  NONE,
  INI,
  CTD,
  CWL_OR_JSON
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
  if (given("-write_ini")) return DescriptorRequest::INI;
  if (given("-write_ctd")) return DescriptorRequest::CTD;
  if (given("-write_nested_cwl") || given("-write_cwl") || given("-write_nested_json") || given("-write_json"))
  {
    return DescriptorRequest::CWL_OR_JSON;
  }
  return DescriptorRequest::NONE;
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
  // Thermo .raw: the .NET runtime the release bundles ship beside the
  // executable, unless the user's DOTNET_ROOT names another (1.15.2).
  FASTag::Thermo::useBundledRuntime();
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
    if (argv[i][0] == '-') g_cli_options.insert(argv[i] + 1);
  }
  // ...and not for a bare `FASTag` either: with no arguments TOPPBase prints
  // the usage, and an injected pair would turn that into "in and out are
  // required".
  if (!explicit_threads && argc > 1)
  {
    args.push_back("-threads");
    args.push_back("0");
  }
  // --version / -version: the version line alone (TOPPBase has no such flag;
  // its --help prints the same text after "Version:"), with the notice of
  // every component whose licence asks for one in the About text.
  if (argc == 2 && (std::strcmp(argv[1], "--version") == 0 || std::strcmp(argv[1], "-version") == 0))
  {
    std::cout << "FASTag " FASTAG_VERSION " (OpenMS " << VersionInfo::getVersion() << ")\n";
    if (FASTag::Thermo::supported())
      std::cout << "Thermo .raw input: " << FASTag::Thermo::copyrightNotice() << "\n";
    return TOPPBase::EXECUTION_OK;
  }
  const DescriptorRequest descriptor = requestedDescriptor(argc, argv);
  const bool want_descriptor =
      !help && (descriptor == DescriptorRequest::CTD || descriptor == DescriptorRequest::CWL_OR_JSON);

#ifndef ENABLE_TDL
  // ENABLE_TDL is a PUBLIC compile definition on OpenMS's exported CMake target
  // (src/openms/CMakeLists.txt), so it reaches this file exactly when the
  // OpenMS being linked can write CWL/JSON at all -- bioconda 3.5.0 has it on,
  // a default develop build has it off. Refuse here rather than letting
  // ParamCWLFile::store() open (and therefore TRUNCATE) the target file before
  // throwing a std::runtime_error from a depth TOPPBase does not catch: that
  // would replace an existing, good descriptor with an empty one.
  if (want_descriptor && descriptor == DescriptorRequest::CWL_OR_JSON)
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
  if (help && rc == TOPPBase::EXECUTION_OK && FASTag::Thermo::supported())
    std::cerr << "This build reads Thermo .raw files with Thermo's RawFileReader:\n  "
              << FASTag::Thermo::copyrightNotice() << "\n";
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
