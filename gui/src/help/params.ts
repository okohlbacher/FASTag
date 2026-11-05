// Plain-language help for every FASTag parameter, shown in Help > Settings.
//
// Reader: someone who has measured MS2 spectra but has not used a tagger.
// `text` says what the setting does; `tip` says when to change it, with a
// number where one helps. The CLI's own description stays the technical line
// and is shown beside this text, so it is not repeated here.
//
// Every fact here must match src/FASTag.cpp, README.md, doc/DESIGN-digest.md
// or doc/SPECIES-DETECTOR.md. help.test.tsx fails when a parameter of
// params.generated.json has no entry, or an entry names no parameter.
//
// Must not claim: that a tag, a database match, a species call, a mass gap or
// a glyco flag is an identification; that the E-value or a species q-value
// is an error rate.

export interface ParamHelp {
  text: string
  tip?: string
}

export const PARAM_HELP: Record<string, ParamHelp> = {
  // Spectra
  no_deisotope: {
    text: 'FASTag normally merges each isotope cluster into its first (monoisotopic) peak and moves fragments of charge 2 or 3 to the mass they would have at charge 1, before it picks peaks. This switch turns both steps off.',
    tip: 'Leave it off. Turn it on only for the fastest possible run, or to compare with a tool that has no such step.'
  },
  max_peaks: {
    text: 'How many peaks of each spectrum are kept, at most 1024. 0 also means 1024. More peaks need more memory.',
    tip: '400 suits most data. With peaks per window on, this is also the ceiling for that budget.'
  },
  peaks_per_window: {
    text: 'Keep this many of the strongest peaks in every 100 Da window, instead of the strongest peaks of the whole spectrum. A wide spectrum then keeps more peaks than a narrow one. 0 turns it off.',
    tip: '10 is the default. Set 0 to keep simply the strongest "Max peaks" peaks.'
  },
  subsample_spectra: {
    text: 'Tag only this many spectra, chosen at random. 0 tags all of them. When both this and the fraction are set, this count wins.',
    tip: 'Useful for a quick look at a large run.'
  },
  subsample_fraction: {
    text: 'Tag only this share of the spectra (more than 0, up to 1), chosen at random. 0 tags all of them.',
    tip: '0.1 gives a fast species call on a large run.'
  },
  subsample_seed: {
    text: 'The starting number of the random choice. The same seed picks the same spectra again.',
    tip: 'Change it to draw a different random subset.'
  },

  // Tagging
  tag_length: {
    text: 'The length of the shortest tag FASTag looks for, in residues. Every tag starts as a seed of this length; extension can make it longer.',
    tip: '3 is the default. Species detection needs tags of 7 residues: set 7 here (see How species detection works).'
  },
  tag_lengths: {
    text: 'Several seed lengths in one pass over the file, one per line, instead of tag length. Each length is tagged as if run on its own, with its own "Max tags" limit, and a spectrum\'s rows come in order of length. A tag that several lengths find is kept once, from the length that scores it best.',
    tip: 'Cannot be combined with the entrapment database.'
  },
  fragment_tolerance: {
    text: 'How far a peak may lie from the mass FASTag expects and still count. The unit beside the number is ppm (parts per million of the mass) or Da.',
    tip: 'Set it to match the instrument that measured the MS2: 20 ppm for Orbitrap, Astral and TOF data; 0.3 Da for an ion trap. A ppm tolerance on ion-trap data gives almost no tags.'
  },
  fragment_tolerance_unit: {
    text: 'The unit of the fragment tolerance: ppm or Da.',
    tip: 'ppm for high-resolution MS2, Da for an ion trap. With Da, the Digest tab makes no protease call.'
  },
  gaps: {
    text: 'With 1, a tag may cross one missing peak: two peaks whose distance is the mass of two residues are joined, and both residue orders are written as separate tags. 0 turns this off.',
    tip: 'Leave it at 1; it lets a tag continue past a fragment that was not measured.'
  },
  gap_penalty: {
    text: 'Gapped tags are ranked as if their E-value were this many times worse, because they claim a peak nobody saw. The printed E-value of a gapped tag includes this factor. It never removes a tag at the E-value cutoff, but it decides which tags fill the "Max tags" places.',
    tip: '100 is the default. 1 turns the penalty off.'
  },
  extension: {
    text: 'After a seed is found, FASTag tries to read up to this many more residues at each end, and scores the longer tag again. 0 turns extension off; the maximum is 12.',
    tip: 'Raise it for longer tags, for example 2 to let a seed of 3 grow to 7.'
  },
  max_tags: {
    text: 'How many tags are written per spectrum, best first; with several tag lengths, per length. 0 writes all of them.',
    tip: '50 is the default. Lower it for smaller files when only the best tags matter.'
  },
  max_evalue: {
    text: 'Tags with an E-value above this are not written; for a gapped tag the value before the gap penalty counts, so its printed E-value can be up to this times the gap penalty. 0 turns the cutoff off.',
    tip: '20 is the default. Lower it, for example to 1, to keep only the stronger tags.'
  },
  diversity: {
    text: 'When a spectrum has more tags than "Max tags" allows, prefer tags that read other peaks over near-copies of a tag already kept. The number of tags and the best tag stay the same.',
    tip: 'Try it for spectra that hold two peptides at once (common in TMT runs).'
  },

  // Sequence matching
  fasta: {
    text: 'A protein file (FASTA). Only tags that occur in these sequences are written (and, with an entrapment database, the entrapment-only matches, marked efwd/erev). I and L count as the same, tags are also tried reversed, and some residue pairs may stand in for a residue of the same mass.',
    tip: 'Very short tags occur in almost any protein by chance, so FASTag sets a minimum length from the size of the file: about 4 for one protein, 7 or 8 for a proteome. Set extension so that tag length + 2 × extension reaches it, or the run is refused. The log shows how many matches chance alone would give.'
  },
  entrapment_fasta: {
    text: 'A second protein file from organisms the sample cannot contain. Matches to it estimate how often a tag matches the database by chance, written as a q_db column. Needs a sequence database.',
    tip: 'Use a distant proteome, for example archaea for a human sample. Cannot be combined with species detection or with several tag lengths.'
  },
  orientation: {
    text: 'Whether a tag is matched only as written, or also reversed. Tags are written N- to C-terminal as if read from y ions; a tag read from b ions matches only reversed.',
    tip: 'Keep "both" unless you know the tags come from one ion series.'
  },
  isobaric_tolerance: {
    text: 'When matching against the sequence database or reconciling, a residue may stand for a pair of residues of the same mass within this tolerance (for example N for GG). 0 asks for exact sequences.',
    tip: '0.04 Da is the default.'
  },
  min_filter_length: {
    text: 'Tags shorter than this are not matched against the sequence database. 0 lets FASTag choose a length from the size of the database, where chance matches become rare.',
    tip: 'Leave it at 0 unless the chance table in the log says otherwise.'
  },

  // Species detection
  species: {
    text: 'Work out which organisms the tags come from, using the species reference index bundled with FASTag. The result appears in the Species tab and in a report beside the tags.',
    tip: 'Needs tags of 7 residues: set tag length 7 (extension alone lets few tags reach 7). Subsample a large run (fraction 0.1) for a fast answer.'
  },
  species_rank: {
    text: 'The level of the taxonomy at which organisms are reported: genus, family, and so on.',
    tip: 'genus is the default and the finest level the reference supports; species names are not reliable.'
  },
  species_evidence: {
    text: 'Which tags of a spectrum make it count for an organism. "best": only its best tag that is found in the reference. "all": every reported tag.',
    tip: 'Keep "best"; with "all", wrong tags add organisms they hit by chance.'
  },
  species_min_len: {
    text: 'Tags shorter than this are not used for species detection. Values below the index length (7 for the bundled index) use that length.',
    tip: 'Leave it at 0.'
  },
  species_use_gapped: {
    text: 'Let gapped tags count as species evidence. Off by default, because the two residues across a gap are inferred, not seen, and an exact lookup cannot tell the difference.',
    tip: 'Leave it off: gapped tags pushed the true genus far down on a public test run.'
  },
  species_deconvolve: {
    text: 'Subtract the evidence an organism collects only because it shares protein sequence with a stronger one. Adds an Adjusted column to the Species tab.',
    tip: 'Try it on high-resolution data when close relatives are in the reference. Leave it off for ion-trap data and when rare organisms matter: it can remove real ones.'
  },
  species_max_kmer_share: {
    text: 'Ignore protein pieces found in more than this share of the organisms in the reference, since they cannot tell organisms apart. 1 keeps all.',
    tip: 'Leave it at 1; on test data it changed nothing.'
  },
  species_min_margin: {
    text: 'Ignore a tag unless its best organisms hold a clearly larger share of its pieces than the next organism, by at least this margin. 0 keeps all.',
    tip: 'Leave it at 0; on test data it changed nothing.'
  },
  species_out: {
    text: 'Where the species report is written. Empty: beside the tags file, named <name>.tags.species.tsv.',
  },
  taxdb: {
    text: 'A species reference index of your own (built with buildtaxdb). Empty: the index bundled with FASTag.',
    tip: 'Give it together with both taxonomy files, or leave all three empty.'
  },
  taxonomy_nodes: {
    text: 'The NCBI taxonomy tree (nodes.dmp) that goes with your own index. Empty: the bundled one.',
    tip: 'Give all three of index, nodes and names, or none.'
  },
  taxonomy_names: {
    text: 'The NCBI taxonomy names (names.dmp) that go with your own index. Empty: the bundled one.',
    tip: 'Give all three of index, nodes and names, or none.'
  },

  // Glycopeptides
  glyco: {
    text: 'Write a report that flags spectra with oxonium ions, the small sugar fragments that glycopeptides and glycans give off. A spectrum is flagged when at least 2 different oxonium ions are found and their summed intensity reaches the minimum fraction of the base peak.',
    tip: 'A flag means a sugar broke apart in that spectrum; it does not identify a glycopeptide. On TMT data at 0.3 Da, a TMT reporter ion (126.128) overlaps a sugar fragment (126.055), so read the flags with care. Keep the tolerance that suits the MS2 analyzer.'
  },
  glyco_min_fraction: {
    text: 'The summed oxonium intensity a flagged spectrum needs, as a fraction of its strongest peak.',
    tip: '0.10, the threshold from the literature.'
  },
  glyco_out: {
    text: 'Where the oxonium report is written. Empty: beside the tags file, named <name>.tags.glyco.tsv.'
  },

  // Digest and labels
  digest_out: {
    text: 'Write the digest report: which residues sit at the ends of the tags, and which protease that pattern fits best (or why no call is made). Shown in the Digest tab.',
    tip: 'Run it without a sequence or entrapment database: with one, only the written rows are counted.'
  },
  label_out: {
    text: 'Write the label report: how many tag ends carry a TMT, TMTpro or iTRAQ4 mass, and the share of heavy K and R (SILAC). Shown in the Digest tab.'
  },
  digest_models: {
    text: 'A table of protease models of your own, replacing the shipped ones (Trypsin, Lys-C, Arg-C, Glu-C, Chymotrypsin, Asp-N, Lys-N and unspecific).',
    tip: 'Needed only for other models, such as HLA ligands or the proteasome.'
  },
  digest_tag_min: {
    text: 'How many C-terminal tag ends a protease call needs. The N-terminal ends are used only when there are as many of them.',
    tip: '100 is the default.'
  },
  digest_window: {
    text: 'How close the mass at a tag end must be to a residue or label mass to count.',
    tip: '0.008 Da is the default.'
  },
  digest_background_share: {
    text: 'How much of the background residue composition is mixed into every protease model, so that an unexpected residue does not rule a model out. Must be below 1.',
    tip: '0.05 is the default.'
  },
  digest_silac_min: {
    text: 'How many K and how many R tag ends the label report needs before it judges the heavy SILAC shares.',
    tip: '50 is the default.'
  },

  // Reconciliation
  recon_out: {
    text: 'Place each tag in the peptides of a protein database, using the masses on either side of it, and write one row per placement. When one side does not fit, the leftover mass is written with a guess at what it could be.',
    tip: 'Needs a database: the reconciliation database, or else the sequence database. The rows are candidates, not identifications. Reconciliation uses tryptic peptides (cut after K and R, with up to 1 missed cleavage by default) whatever the protease call says, so for other proteases the placements and mass gaps are incomplete.'
  },
  recon_fasta: {
    text: 'The protein database for reconciliation. Empty: the sequence database (fasta) is used.',
    tip: 'With a database here and none under Sequence matching, every tag is reconciled, not only those that match the sequence database.'
  },
  recon_missed_cleavages: {
    text: 'How many skipped trypsin cleavage sites a database peptide may contain, at most 10.',
    tip: '1 is the default.'
  },
  recon_min_length: {
    text: 'Tags shorter than this are not reconciled. 0 lets FASTag choose the length at which chance matches fall below 5%.',
    tip: 'Leave it at 0.'
  },
  recon_localize: {
    text: 'Try to pin each leftover mass to one residue, by the fragment peaks it would shift. Adds the columns loc_site, loc_score and loc_ties.'
  },
  delta_out: {
    text: 'Write a histogram of the leftover masses, one count per spectrum.',
    tip: 'Read it as candidates: no peak here is an identified modification.'
  },
  recon_id_out: {
    text: 'Write the placements as identifications in idXML, mzIdentML or mzTab, for tools that read those formats. The file extension chooses the format: .idXML, .mzid or .mzTab (.mzIdentML is not accepted).',
    tip: 'These are not filtered by a false discovery rate.'
  },
  massgap_out: {
    text: 'Write the mass-gap report: the leftover masses, cysteine alkylation counts, frequent gaps explained as combinations of known modifications, and SILAC labels among them. Shown in the Digest tab.',
    tip: 'To see the cysteine alkylation, run it without fixed modifications.'
  },
  massgap_window: {
    text: 'How close a leftover mass must be to a modification mass, on runs with a ppm tolerance.',
    tip: '0.02 Da is the default.'
  },
  massgap_window_da: {
    text: 'The same window on runs with a Da tolerance.',
    tip: '0.5 Da is the default.'
  },
  massgap_min_spectra: {
    text: 'How many spectra a mass-gap peak needs.',
    tip: '20 is the default; the share below can ask for more.'
  },
  massgap_min_share: {
    text: 'The share of placed spectra a mass-gap peak needs.',
    tip: '0.005 is the default.'
  },
  massgap_min_bin: {
    text: 'How many spectra a histogram row needs to take part in the peaks.',
    tip: '2 is the default.'
  },
  massgap_max_mods: {
    text: 'How many modifications may be combined to explain one gap (1 to 4).',
    tip: '3 is the default.'
  },
  massgap_top: {
    text: 'How many modifications are listed as the most frequent.',
    tip: '5 is the default.'
  },
  massgap_silac_share: {
    text: 'The share of shifted spectra a SILAC label needs to count; a SILAC call needs two of Lys4, Arg6, Lys8 and Arg10 to reach it.',
    tip: '0.08 is the default.'
  },
  massgap_silac_min: {
    text: 'How many shifted spectra a SILAC call needs.',
    tip: '500 is the default.'
  },

  // Modifications
  fixed_modifications: {
    text: 'Modifications present on every residue of a kind, by their OpenMS (Unimod) name, one per line. They change that residue\'s mass and are not written in the tag.',
    tip: 'The default is Carbamidomethyl (C), for iodoacetamide alkylation. For a TMT sample add, for example, TMT6plex (K) and TMT6plex (N-term). A terminal one (N-term) appears in the mass-gap report as a peak at its mass.'
  },
  variable_modifications: {
    text: 'Modifications that may or may not be present, one per line. A modified residue is written in the tag as X[Name], for example S[Phospho].',
    tip: 'Each one adds candidate masses, so add only those you expect.'
  },

  // Output
  proforma: {
    text: 'Add a column with each tag in ProForma 2.0 notation, a standard way to write peptides that other tools can read. I and L are written as J.'
  },
  res_conf: {
    text: 'Add a column with a confidence from 0 to 100 for each residue of the tag. Tools that build full peptide sequences from tags can use it.'
  },
  usi_collection: {
    text: 'Add a column naming each tag\'s spectrum as a Universal Spectrum Identifier (USI) in this dataset, for example PXD000001.',
    tip: 'Use USI000000 until the dataset has an accession.'
  },
  out_spectra: {
    text: 'Also write the spectra that carry at least one reported tag that is not an entrapment match, as mzML or mzPeak (chosen by the extension).',
    tip: 'This needs memory in proportion to the size of the file. With a sequence database, it collects the spectra whose tags match.'
  },

  // Performance
  threads: {
    text: 'How many processor threads a run uses. 0, the default, means half of the logical cores, so the computer stays usable.',
    tip: 'The output is the same at every thread count.'
  },

  // Not in the form
  in: { text: 'The spectra file. Chosen with Choose file… under Input.' },
  out: { text: 'The tags file. Set under Output as "Tags TSV".' },
  progress: { text: 'The progress messages the progress bar reads. The app always turns them on.' },
  stream: { text: 'A mode that reads spectra one at a time from another program. It does not work from the app.' },
  mzpeak_read_memory: { text: 'Has no effect; kept so that old command lines still run.' },
  version: { text: 'The FASTag version that wrote a parameter file. Not a setting.' },
  log: { text: 'A standard OpenMS option that writes the log to a file. The app shows the log itself.' },
  debug: { text: 'A standard OpenMS option for more detailed log messages.' },
  no_progress: { text: 'A standard OpenMS option that hides OpenMS\'s own progress messages.' },
  force: { text: 'A standard OpenMS option that skips some of its checks.' },
  test: { text: 'A standard OpenMS option for its internal tests.' }
}
