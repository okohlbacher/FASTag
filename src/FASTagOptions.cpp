// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
//
// --------------------------------------------------------------------------
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
// --------------------------------------------------------------------------

// TOPPFASTag: option registration, removed options and option queries.

#include "FASTagTool.h"

using namespace OpenMS;

bool TOPPFASTag::isRemovedOption_(const std::string& name)
{
  for (const RemovedOption& r : REMOVED_OPTIONS)
    if (name == r.name) return true;
  return false;
}

bool TOPPFASTag::isRemovedValue_(const std::string& name) const
{
  for (const RemovedValue& r : REMOVED_VALUES)
    if (name == r.option && getStringOption_(name) == r.value) return true;
  return false;
}

std::string TOPPFASTag::stringOption_(const std::string& name) const
{
  return isRemovedValue_(name) ? static_cast<std::string>(findEntry_(name).default_value) : getStringOption_(name);
}

void TOPPFASTag::warnRemoved_() const
{
  for (const RemovedOption& r : REMOVED_OPTIONS)
  {
    const ParameterInformation& e = findEntry_(r.name);
    const bool given = g_cli_options.count(r.name) > 0
        || (e.type == ParameterInformation::FLAG ? getFlag_(r.name) : getParam_().getValue(r.name) != e.default_value);
    if (given)
      OPENMS_LOG_WARN << "-" << r.name << " was removed in 1.14 (" << r.why << "); it has no effect." << std::endl;
  }
  for (const RemovedValue& r : REMOVED_VALUES)
    if (*r.option && getStringOption_(r.option) == r.value)
      OPENMS_LOG_WARN << "-" << r.option << " " << r.value << " was removed in 1.14 (" << FAILED_HELD_OUT
                      << "); it has no effect: -" << r.option << " " << stringOption_(r.option) << " is used."
                      << std::endl;
}

TOPPFASTag::TOPPFASTag()
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

void TOPPFASTag::registerOptionsAndFlags_()
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

  registerIntOption_("tag_length", "<n>", FASTag::Cli::TAG_LENGTH, "Seed tag length in residues", false);
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
  registerIntOption_("extension", "<n>", FASTag::Cli::EXTENSION,
                     "Maximum residues appended per terminus; 0 disables extension", false);
  setMinInt_("extension", 0);
  // tag_length + 2*extension is computed as int and indexes the null tables.
  // Unbounded, --extension 1073741824 overflows and aborts with std::length_error.
  setMaxInt_("extension", (FASTag::MAX_FILTER_LEN - 1) / 2);
  registerIntOption_("gaps", "<n>", FASTag::Cli::GAPS,
                     "Allow a tag to cross one missing peak, spelling the two "
                     "residues either side of it from their summed mass; "
                     "0 disables", false);
  setMinInt_("gaps", 0);
  // One gap only. Each additional gap multiplies the branching and asserts
  // another unobserved split, and a two-gap tag would be mostly inference.
  setMaxInt_("gaps", 1);
  registerStringOption_("tmt_pseudo_filter", "off|auto|on", "off",
                        "Experimental TMT6/10 G/A pseudo-residue filter before the tag cap; auto probes "
                        "N-terminal and lysine mass signatures, on asserts TMT6/10 labeling", false);
  setValidStrings_("tmt_pseudo_filter", ListUtils::create<std::string>("off,auto,on"));
  registerFlag_("tmt_reporter_filter", "Also reject b/y tags anchored on singly charged TMT6/10 "
                "reporter ions; requires tmt_pseudo_filter auto or on and the same active TMT gate", false);
  // Negated, because a TOPP flag is false unless given and deisotoping is on
  // by default. `-no_deisotope` follows TOPPBase's own `-no_progress`.
  registerFlag_("no_deisotope",
                "Do not collapse isotope clusters to their monoisotopic peak, and "
                "do not move multiply-charged fragments onto the singly-charged "
                "scale, before peak selection", false);

  registerDoubleOption_("fragment_tolerance", "<value>", FASTag::Cli::FRAGMENT_TOLERANCE, "Fragment mass tolerance", false);
  // Without a floor a negative or zero tolerance matches nothing and the run
  // reports zero tags with no indication why. The floor stays in the INI/CTD
  // (restrictions="1.0e-09:") for KNIME/Galaxy validators; main_ also refuses
  // NaN, which TOPPBase's range check lets through.
  setMinFloat_("fragment_tolerance", 1e-9);
  registerStringOption_("fragment_tolerance_unit", "<unit>", FASTag::Cli::FRAGMENT_TOLERANCE_UNIT, "Tolerance unit", false);
  setValidStrings_("fragment_tolerance_unit", ListUtils::create<std::string>("ppm,Da"));

  registerIntOption_("max_peaks", "<n>", FASTag::Cli::MAX_PEAKS,
                     "Peaks kept per spectrum, at most 1024; 0 means 1024, not "
                     "unlimited. Higher values use more memory. Also caps "
                     "-peaks_per_window", false);
  setMinInt_("max_peaks", 0);
  setMaxInt_("max_peaks", 1024);
  registerIntOption_("peaks_per_window", "<n>", FASTag::Cli::PEAKS_PER_WINDOW,
                     "Keep this many peaks per 100 Da window instead of the "
                     "strongest -max_peaks overall; 0 disables. Scales the "
                     "effective peak budget with the spectrum's m/z range, so "
                     "dense spectra are not starved and sparse ones not padded", false);
  setMinInt_("peaks_per_window", 0);
  registerIntOption_("max_tags", "<n>", FASTag::Cli::MAX_TAGS, "Tags reported per spectrum; 0 = unlimited", false);
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
  // 1.14: -label_discovery_* removed (failed its held-out tests); the
  // names stay without effect (REMOVED_OPTIONS).
  registerOutputFile_("label_discovery_out", "<file>", "", REMOVED_HELP, false, true);
  registerDoubleOption_("label_discovery_max_flank", "<Da>", 700.0, REMOVED_HELP, false, true);
  registerIntOption_("label_discovery_depth", "<n>", 2, REMOVED_HELP, false, true);
  registerIntOption_("label_discovery_min_spectra", "n", 20, REMOVED_HELP, false, true);
  registerDoubleOption_("label_discovery_min_share", "<f>", 0.005, REMOVED_HELP, false, true);
  registerDoubleOption_("label_discovery_window_n", "<Da>", 0.0, REMOVED_HELP, false, true);
  registerDoubleOption_("label_discovery_window_c", "<Da>", 0.0, REMOVED_HELP, false, true);
  registerIntOption_("label_discovery_unimod_top", "<n>", 3, REMOVED_HELP, false, true);
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
  // 1.14: -label_call_min_tags removed (0 failed its held-out test); 175 is a constant again.
  registerIntOption_("label_call_min_tags", "<n>", 175, REMOVED_HELP, false, true);
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
  registerDoubleOption_("max_evalue", "<value>", FASTag::Cli::MAX_EVALUE, "E-value cutoff; 0 disables", false);
  setMinFloat_("max_evalue", 0.0);
  registerDoubleOption_("gap_penalty", "<value>", FASTag::Cli::GAP_PENALTY,
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
                      ListUtils::create<std::string>(FASTag::Cli::FIXED_MODIFICATIONS),
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
                        "(or diaTracer for .d) first. The revised 1.13 check passed its second held-out "
                        "test on Thermo files: 0 of 58 non-DIA and 35 of 37 DIA files refused "
                        "(no Astral, timsTOF or SCIEX files tested). If a known DDA file is refused, "
                        "inspect the acquisition metadata before choosing warn or off", false);
  setValidStrings_("acquisition_check", ListUtils::create<std::string>("refuse,warn,off"));
  registerIntOption_("acquisition_probe_spectra", "<n>", 4000,
                     "MS2 spectra the acquisition check reads (metadata only) from the start of "
                     "the run, reading at most ten times as many spectra in all; a mixed file is "
                     "judged on these", false, /*advanced=*/true);
  setMinInt_("acquisition_probe_spectra", 1);
  // #9: centroiding of profile MS2 (src/Centroid.h).
  registerStringOption_("pick_profile", "<mode>", FASTag::Centroid::MODE_DEFAULT,
                        "Centroid profile MS2 (MS:1000128) with OpenMS PeakPickerHiRes before tagging: "
                        "'legacy' on mzPeak input only (as FASTag 1.11), 'off' never ('auto' was removed "
                        "in 1.14 and is read as legacy). Centroided MS2 are never re-picked; "
                        "-out_spectra writes the spectra as they were tagged", false);
  setValidStrings_("pick_profile", ListUtils::create<std::string>(FASTag::Centroid::MODE_VALUES));
  registerFlag_("pick_unknown_type", REMOVED_HELP, true);  // 1.14: removed with -pick_profile auto
  // E2: complement-ion rules across fragment charges, tolerance tied to the
  // run. Defaults are FASTag 1.11 (src/CliParam.h); validation decides any
  // other default.
  registerStringOption_("complement_rule", "<rule>", FASTag::Cli::COMPLEMENT_RULE,
                        "Which fragment pairs count as complements in the complement "
                        "subscore: same_charge (both at the fragment charge z, partner "
                        "at M/z + 2p - m), precursor (the partner carries the precursor's "
                        "remaining c - z charges, at (M + c*p - z*m)/(c - z)), or both "
                        "(either rule)", false, true);
  setValidStrings_("complement_rule", ListUtils::create<std::string>("same_charge,precursor,both"));
  registerDoubleOption_("complement_tolerance", "<value>", FASTag::Cli::COMPLEMENT_TOLERANCE,
                        "Window for a complement partner in Da (used with "
                        "-complement_tolerance_unit Da)", false, true);
  setMinFloat_("complement_tolerance", 1e-9);
  // Its own option, not -complement_tolerance read as k: one value with one
  // default would make "-complement_tolerance_unit fragment" alone run at
  // k = 0.02. The name keeps the --helphelp column at the 1.11 width.
  registerDoubleOption_("complement_tol_factor", "<k>", FASTag::Cli::COMPLEMENT_TOL_FACTOR,
                        "Factor k of the complement window k*(fragment tolerance at the "
                        "peak + at the partner) (used with -complement_tolerance_unit "
                        "fragment)", false, true);
  setMinFloat_("complement_tol_factor", 1e-9);
  // "<u>", not "<unit>": the longest option-and-argument column of the
  // --helphelp listing must stay the 1.11 width, or every line reflows.
  registerStringOption_("complement_tolerance_unit", "<u>", FASTag::Cli::COMPLEMENT_TOLERANCE_UNIT,
                        "Da: the window is -complement_tolerance. fragment: "
                        "-complement_tol_factor scales the run's -fragment_tolerance at "
                        "both partners. auto (experimental; its first held-out test failed, the second, with the revised estimator, was inconclusive with no criterion failed: +1.1 points of correct rank-1 tags on ion trap, same window as Da on the high-resolution files): the window is measured on the run, "
                        "from the complement pairs of high-confidence tags in a probe of "
                        "-complement_probe MS2 spectra; -complement_tolerance when too few pairs",
                        false, true);
  setValidStrings_("complement_tolerance_unit", ListUtils::create<std::string>("Da,fragment,auto"));
  // 1.13 item 15 (src/ComplementTol.h): the probe size of
  // -complement_tolerance_unit auto. Read only under auto.
  registerIntOption_("complement_probe", "<n>", 500,
                     "MS2 spectra the -complement_tolerance_unit auto probe tags to measure "
                     "the complement window", false, true);
  setMinInt_("complement_probe", 1);
  registerFlag_("complement_midp",
                "Score complements with DirecTag's hypergeometric mid-p P(X>c) + P(X=c)/2 "
                "for tags with 0 or 1 complemented peaks; 2 or more keep P(X>=c)", true);
  // #6: precursor charge and isotope hypotheses (src/PrecursorHypotheses.h).
  // Defaults are FASTag 1.11: uncharged precursors are tagged as 2+, no
  // isotope offset; validation decides any other default.
  registerStringOption_("unknown_charge", "<mode>", FASTag::Hyp::MODE_DEFAULT,
                        "How a precursor without a charge is tagged: assume2 (as 2+, as before "
                        "1.12), enumerate (at each listed possible charge, else at every charge "
                        "-charge_min..-charge_max) or infer (at the charge its complement pairs "
                        "support; both of two close calls; 1+ when 1 is a candidate and almost no "
                        "intensity lies above the precursor; without evidence 2+, or the lowest "
                        "candidate when 2 is none). Every charge tagged is a listed possible charge, "
                        "else one of -charge_min..-charge_max. With several, E-values are multiplied "
                        "by their number and the reports count the charge-evidence choice only. A "
                        "header charge is never replaced (-check_header_charge both tags a flagged "
                        "spectrum under the flagged charge as well)", false);
  setValidStrings_("unknown_charge", ListUtils::create<std::string>(FASTag::Hyp::MODE_VALUES));
  registerIntOption_("charge_min", "<n>", FASTag::Hyp::CHARGE_MIN_DEFAULT,
                     "Lowest charge -unknown_charge enumerate or infer tries (1 enables infer's "
                     "1+ test)", false);
  setMinInt_("charge_min", 1);
  setMaxInt_("charge_min", FASTag::Hyp::CHARGE_LIMIT);
  registerIntOption_("charge_max", "<n>", FASTag::Hyp::CHARGE_MAX_DEFAULT,
                     "Highest charge -unknown_charge enumerate or infer tries", false);
  setMinInt_("charge_max", 1);
  setMaxInt_("charge_max", FASTag::Hyp::CHARGE_LIMIT);
  registerDoubleOption_("charge_infer_margin", "<value>", FASTag::Hyp::INFER_MARGIN_DEFAULT,
                        "Complement-pair excess by which the inferred charge must beat the "
                        "runner-up to be tagged alone; closer, both are tagged (ambiguous). Any "
                        "excess above 0 is a call", false, true);
  setMinFloat_("charge_infer_margin", 0.0);
  registerIntList_("isotope_error", "<k>", ListUtils::create<Int>("0"),
                   "Precursor isotope offsets (-1..3) to consider: the precursor mass is "
                   "lowered by k x 1.00336 Da, for every precursor; each charge is tagged at "
                   "the offset its complement pairs support best. Needs a fragment tolerance "
                   "below 0.05 Da", false, true);
  setMinInt_("isotope_error", FASTag::Hyp::ISOTOPE_MIN);
  setMaxInt_("isotope_error", FASTag::Hyp::ISOTOPE_MAX);
  // 1.13 (backlog #14): re-check header charges against the infer call.
  registerStringOption_("check_header_charge", "<mode>", FASTag::Hyp::HEADER_CHECK_DEFAULT,
                        "Check every precursor charge the file gives against the isotope spacing "
                        "of the precursor in the preceding MS1 scan and, where that gives no "
                        "charge, against the charge its complement pairs support (the "
                        "-unknown_charge infer call over -charge_min..-charge_max and the header "
                        "charge, with 1+/(z-1)+ pairs for z >= 3): off (the default), warn (count "
                        "and report disagreements, tag at the header charge) or both (tag a "
                        "disagreeing spectrum under its header charge and under the charge the "
                        "check found, charge_src 'check_call'; the header charge stays the "
                        "selected one). Experimental", false, true);
  setValidStrings_("check_header_charge", ListUtils::create<std::string>(FASTag::Hyp::HEADER_CHECK_VALUES));
  registerDoubleOption_("check_header_margin", "<value>", FASTag::Hyp::HEADER_MARGIN_DEFAULT,
                        "Complement-pair excess by which the supported charge must beat the header "
                        "charge's own for -check_header_charge to call a disagreement", false, true);
  setMinFloat_("check_header_margin", 0.0);
  registerOutputFile_("check_header_out", "<file>", "",
                      "-check_header_charge: one row per header-charged MS2 spectrum (header "
                      "charge, MS1 charge, call, evidence, verdict)", false, true);
  setValidFormats_("check_header_out", ListUtils::create<std::string>("tsv"));
  // #15 phase B: c/z-dot ions for electron activation (src/IonSeries.h).
  // Default by is FASTag 1.11; validation decides any other default.
  registerStringOption_("ion_series", "<mode>", FASTag::IonSeries::MODE_DEFAULT,
                        "Ion series the MS2 spectra are read as: by (b/y ions, as before 1.12), cz "
                        "(c/z-dot ions of electron transfer or capture dissociation, ETD/ECD), or auto "
                        "(c/z-dot for spectra whose activation is ETD or ECD, b/y for all others, hybrid "
                        "EThcD/ETciD included). Under cz and auto the tag TSV gains an ion_series column when some "
                        "spectrum can be read as c/z. ax was removed in 1.14 (failed its held-out test); it is "
                        "read as by", false);
  setValidStrings_("ion_series", ListUtils::create<std::string>(FASTag::IonSeries::MODE_VALUES));
  // 1.14: -ion_series_photo removed (a/x failed its held-out test); the
  // name stays without effect (REMOVED_OPTIONS).
  registerStringOption_("ion_series_photo", "<series>", "by", REMOVED_HELP, false, true);
  // 1.13 backlog item 10: hybrid EThcD/ETciD read as b/y and c/z-dot; experimental.
  registerStringOption_("ion_series_hybrid", "<series>", FASTag::IonSeries::HYBRID_DEFAULT,
                        "Under -ion_series auto: how hybrid-activated spectra (EThcD, ETciD) are read: by (b/y "
                        "ions, as before 1.13) or both (tagged twice, as b/y and as c/z-dot ions; the rows of "
                        "both passes merged by E-value under one -max_tags cap, every E-value multiplied by 2, "
                        "each row with its ion_series). mzML input only. "
                        "Experimental; passed its held-out test (5 projects: +43 points of identified spectra with a correct tag, 1.6x CPU time)", false, true);
  setValidStrings_("ion_series_hybrid", ListUtils::create<std::string>(FASTag::IonSeries::HYBRID_VALUES));
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
                        "E-value a tag needs for its placements to count for the shortlist. With -search_engine "
                        "msfragger, -search_config_out and -shortlist_protease trypsin the default is 10 (the "
                        "held-out-tested MSFragger configuration) unless given on the command line or in an INI",
                        false, true);
  setMinFloat_("shortlist_max_evalue", 0.0);
  registerIntOption_("shortlist_min_spectra", "<n>", 2,
                     "Spectra a protein needs to be kept", false, true);
  setMinInt_("shortlist_min_spectra", 1);
  registerFlag_("shortlist_gapped",
                "Let placements with one mismatched flank (a mass gap) count for the shortlist; "
                "by default only exact ones count (a gap equal to a fixed terminal label is exact). On by default "
                "with -search_engine msfragger, -search_config_out and -shortlist_protease trypsin (the "
                "held-out-tested MSFragger configuration)");
  // 1.14: -shortlist_exact_only (added in 1.13.3) removed, failed its
  // held-out test; the name stays without effect (REMOVED_OPTIONS).
  registerFlag_("shortlist_exact_only", REMOVED_HELP, true);
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
  // ---- 1.13 item 20: protease-aware shortlist placement (experimental) ----
  registerStringOption_("shortlist_protease", "<protease>", "trypsin",
                        "Cleavage rule of the shortlist's placements and of -search_config_out. 'trypsin': "
                        "tryptic windows, a confidently non-tryptic run is refused (FASTag 1.12). 'auto': the "
                        "protease the tag ends call (trypsin when inconclusive). A protease name, or "
                        "'unspecific': that rule. Except for 'trypsin', windows are found by flank mass and "
                        "kept by the rule and -shortlist_specificity; only exact placements count. "
                        "Experimental; auto passed its held-out test (9 runs, 5 proteases: median protein recall 0.25 against the full search, +0.12 over the trypsin shortlist); a named rule and unspecific have no held-out test. After 1.13.1 an Asp-N call of 'auto' is exported semi-specific unless -shortlist_specificity is given (development runs only, no held-out test)", false, true);
  setValidStrings_("shortlist_protease",
                   ListUtils::create<std::string>("trypsin,auto,unspecific,lys-c,arg-c,asp-n,glu-c,chymotrypsin,lys-n"));
  registerStringOption_("shortlist_specificity", "<mode>", "full",
                        "With -shortlist_protease other than trypsin: 'full' both window ends at a cleavage "
                        "site (or a protein terminus), 'semi' at least one, 'none' any window. When it is "
                        "not given and -shortlist_protease auto calls Asp-N, 'semi' is used (development "
                        "runs only, no held-out test); a named asp-n stays 'full'", false, true);
  setValidStrings_("shortlist_specificity", ListUtils::create<std::string>("full,semi,none"));
  registerOutputFile_("search_config_out", "<file>", "",
                      "Search-engine configuration for -fasta_out (or the input database): Sage JSON, "
                      "Comet parameters (merged into -search_config_template when given), or a complete "
                      "MSFragger fragger.params", false);
  registerStringOption_("search_engine", "<engine>", "sage",
                        "Engine of -search_config_out; msfragger (MSFragger 4.4.1, experimental) needs decoys in "
                        "the database: -fasta_out then appends reversed ones. With msfragger and -shortlist_protease "
                        "trypsin, -shortlist_gapped is on, -shortlist_max_evalue 10, -recon_min_length 6 and "
                        "-recon_missed_cleavages 2, each unless given on the command line or in an INI. These "
                        "defaults are not validated: they passed the second held-out test (kept share 0.83-0.98 of "
                        "a full MSFragger search, 9 runs) and failed the third (8 new runs: kept share 0.53 in one "
                        "run, entrapment FDP 2.12% in another); the first test, with the 1.13 shortlist, FAILED at "
                        "0.49-0.73. After 1.15 the export under these defaults also sets calibrate_mass 2 (MSFragger "
                        "calibrates the masses and optimizes the fragment tolerance on the shortlist): on 27 "
                        "development runs, among them those of the three tests, the lowest kept share rose from 0.53 "
                        "to 0.80 and the median speed-up fell from 2.59 to 1.49; not validated on held-out data", false);
  setValidStrings_("search_engine", ListUtils::create<std::string>("sage,comet,msfragger"));
  registerInputFile_("search_config_template", "<file>", "",
                     "Comet only: a `comet -p` parameter file the managed keys are merged into", false);
  registerDoubleOption_("search_precursor_tolerance", "<f>", -1.0,
                        "Precursor tolerance written to -search_config_out; -1 = by engine: 10, or 20 ppm "
                        "(MSFragger's own default) for msfragger", false);
  setMinFloat_("search_precursor_tolerance", -1.0);
  registerStringOption_("search_precursor_unit", "<unit>", "ppm",
                        "Unit of -search_precursor_tolerance", false);
  setValidStrings_("search_precursor_unit", ListUtils::create<std::string>("ppm,Da"));
  registerIntOption_("search_isotope_errors", "<n>", -1,
                     "Precursor isotope errors 0..n the engine searches; 0 = none; -1 = by engine: none for "
                     "Sage and Comet, 0..3 (MSFragger's own default) for msfragger", false);
  setMinInt_("search_isotope_errors", -1);
  setMaxInt_("search_isotope_errors", 3);
  registerIntOption_("search_missed_cleavages", "<n>", -1,
                     "Missed cleavages the engine searches; -1 = by engine: -recon_missed_cleavages for Sage "
                     "and Comet and with -shortlist_protease other than trypsin, 2 (MSFragger's own default) "
                     "for msfragger", false);
  setMinInt_("search_missed_cleavages", -1);
  setMaxInt_("search_missed_cleavages", 10);
  registerStringOption_("search_nterm_acetyl", "<mode>", "engine",
                        "Add 'Acetyl (Protein N-term)' to the variable modifications of -search_config_out; "
                        "'engine' = yes for msfragger (its own default), no for Sage and Comet", false);
  setValidStrings_("search_nterm_acetyl", ListUtils::create<std::string>("engine,yes,no"));
  registerStringOption_("search_decoy_prefix", "<s>", "",
                        "Decoy prefix the engine generates; empty = rev_ (Sage, MSFragger) or DECOY_ (Comet)", false);
  // 1.14: -search_shifts and its options removed (#17, failed both
  // held-out tests); the names stay without effect (REMOVED_OPTIONS).
  registerStringOption_("search_shifts", "<mode>", "none", REMOVED_HELP, false, true);
  registerOutputFile_("search_shifts_out", "<file>", "", REMOVED_HELP, false, true);
  registerIntOption_("shift_max_variable", "<n>", 3, REMOVED_HELP, false, true);
  registerIntOption_("shift_max_offsets", "<n>", 10, REMOVED_HELP, false, true);
  registerFlag_("shift_expand_sites", REMOVED_HELP, true);
  registerDoubleOption_("shift_site_min_share", "<f>", 0.2, REMOVED_HELP, false, true);
  registerIntOption_("shift_site_min_count", "<n>", 10, REMOVED_HELP, false, true);
  registerIntOption_("shift_site_min_ions", "<n>", 2, REMOVED_HELP, false, true);
  // ---- 1.12 D: options ----
  // #1 calibrated species presence or abstention (src/SpeciesCall.h). Off
  // by default: at 'none' nothing of it runs and the report is 1.11's. A
  // default flip needs the held-out acceptance and a user decision.
  registerStringOption_("species_call", "<mode>", "none",
                        "Call each taxon of the -species report present, no_call or not_detected: "
                        "'decoy' tests its count against a null of decoy tags (looked up like the "
                        "tags) plus the spill expected from stronger related taxa, and appends the "
                        "columns call, call_reason, decoy_spectra, decoy_expected, decoy_qvalue, "
                        "share and lod. 'none' = the ranked report only. 'explain' was removed in 1.14 "
                        "(failed its held-out test); it is read as none", false, true);
  setValidStrings_("species_call", ListUtils::create<std::string>("none,decoy,explain"));
  // 1.14: -species_reagents removed (read only by -species_call explain,
  // which failed its held-out test); the name stays without effect
  // (REMOVED_OPTIONS) and the file is never opened.
  registerInputFile_("species_reagents", "<file>", "", REMOVED_HELP, false, true);
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
                        "(no analytic background follows). The optional decoy_qvalue and call from "
                        "-species_call decoy are experimental and not calibrated", false, true);
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
  // 1.13 digqual (backlog 23): digestion quality rows of -digest_out. Off by
  // default: without it -digest_out is the 1.12 report byte for byte.
  registerStringOption_("digest_quality", "<enzyme>", "",
                        "Append missed-cleavage and non-specific-end measurements for this enzyme to -digest_out: "
                        "a model name of the protease table (e.g. Trypsin) or 'auto' (the report's call). "
                        "Experimental; empty = off",
                        false, true);
  // #3g the alkylation call (src/AlkylationCall.h), from the reconciler's
  // placements. Opt-in; every other output is the same with or without it.
  registerOutputFile_("alkylation_out", "<file>", "",
                      "Report which reagent alkylated the cysteines (or none), from the placements of "
                      "single-Cys peptides on -recon_fasta or -alkylation_proteome: Cys form counts and "
                      "the call (not validated on held-out data)", false);
  setValidFormats_("alkylation_out", ListUtils::create<std::string>("tsv"));
  registerStringOption_("alkylation_proteome", "<name>", "auto",
                        "Database of -alkylation_out without -recon_fasta: a FASTA file (.gz allowed). The names "
                        "auto (= human), human, mouse, yeast and ecoli stand for the shipped UniProt reference "
                        "proteomes (reviewed entries; share/FASTag/alkylation, release in its proteomes.tsv). "
                        "Tags place on them from 8 residues (human, mouse) or 7 (yeast, ecoli): give -tag_length 8 "
                        "or 7, at the default no tag places and there is no call (reason tags_too_short)",
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
  // 1.13 #22: the database-free alkylation call (src/AlkylationTags.h),
  // from a second, unwritten tagging pass with alternative C edges.
  // Opt-in; every other output is the same with or without it.
  registerOutputFile_("alkylation_tags_out", "<file>", "",
                      "Experimental (held-out test passed at the margin: 40 of 57 runs called, 37 right; "
                      "unalkylated runs are rarely called): report which reagent alkylated the cysteines (or none) without a database, "
                      "from a second tagging pass with unmodified C and one alternative C edge per reagent "
                      "(Carbamidomethyl, Propionamide, Nethylmaleimide, Methylthio, Carboxymethyl): votes per "
                      "C form inside tags and the call. Use with -extension (measured with -tag_length 4 -extension 6): "
                      "without it few spectra vote",
                      false, true);
  setValidFormats_("alkylation_tags_out", ListUtils::create<std::string>("tsv"));
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
  registerDoubleOption_("census_ids_fdr", "<f>", FASTag::CensusIds::DEFAULT_FDR,
                        "q-value a target hit of -census_ids needs to identify its spectrum", false, true);
  setMinFloat_("census_ids_fdr", 0.0);
  setMaxFloat_("census_ids_fdr", 1.0);
  registerDoubleOption_("census_triage_evalue", "<f>", FASTag::CensusIds::DEFAULT_TRIAGE_EVALUE,
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

bool TOPPFASTag::optionNonDefault_(const std::string& name) const
{
  const ParameterInformation& e = findEntry_(name);
  switch (e.type)
  {
    case ParameterInformation::FLAG: return getFlag_(name);
    case ParameterInformation::INT: return getIntOption_(name) != static_cast<int>(e.default_value);
    case ParameterInformation::DOUBLE: return getDoubleOption_(name) != static_cast<double>(e.default_value);
    case ParameterInformation::INTLIST: return getIntList_(name) != e.default_value.toIntVector();
    default: return stringOption_(name) != static_cast<std::string>(e.default_value);
  }
}

bool TOPPFASTag::optionGiven_(const std::string& name) const
{
  return g_cli_options.count(name) > 0 || optionNonDefault_(name);
}

bool TOPPFASTag::registeredNonDefault_(const std::string& name) const
{
  const ParameterInformation* e = nullptr;
  try { e = &findEntry_(name); }
  catch (const Exception::UnregisteredParameter&) { return false; }
  if (e->type == ParameterInformation::INTLIST) return getIntList_(name) != e->default_value.toIntVector();
  return optionNonDefault_(name);
}

bool TOPPFASTag::resolveMods_(const StringList& names, bool variable, std::vector<FASTag::ModSpec>& out,
                  StringList& kept, double* term_n, double* term_c)
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
