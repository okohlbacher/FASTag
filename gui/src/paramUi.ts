// PARAM_UI: how each CLI parameter is presented, one entry per parameter
// (GUI-DESIGN P5).
//
// The manifest (params.generated.json) says what the parameters ARE; this
// table says how they are PRESENTED: where each one sits in the form (or why
// it is not in the form), its label, the parameters it depends on, its unit,
// the value overlays where the manifest is not the tool's own truth, the
// extra value checks, and its plain-language help. They are deliberately
// separate: the manifest is regenerated from the tool and must never be
// hand-edited, while this table is a human judgement.
//
// Before P5 this lived in ten tables keyed by parameter name (CHOICES,
// OVERRIDES, the section lists, DEPENDS, UNIT_OF, LABEL, HIDDEN, POSITIVE,
// BELOW_MAX and help/params.ts PARAM_HELP). paramLayout.ts derives every view
// the app uses from this one table.
//
// paramUi.test.ts holds the table to the manifest in both directions: every
// parameter of params.generated.json has exactly one entry, and no entry,
// master or unit names a parameter the manifest lacks. Regenerating the
// manifest (npm run params) is therefore a table edit only: each new option
// gets one entry here -- `{ hidden: '<why>' }` keeps it out of the form, and
// the CLI default applies; `{ section: '<title>', help: {...} }` puts it in.
//
// Order matters: the form shows a section's parameters in the order of
// their entries here.
//
// Help text. Reader: someone who has measured MS2 spectra but has not used a
// tagger. `text` says what the setting does; `tip` says when to change it,
// with a number where one helps. The CLI's own description stays the
// technical line and is shown beside this text, so it is not repeated here.
// Every fact in it must match src/FASTag.cpp, README.md, doc/DESIGN-digest.md
// or doc/SPECIES-DETECTOR.md. It must not claim: that a tag, a database
// match, a species call, a mass gap or a glyco flag is an identification;
// that the E-value or a species q-value is an error rate. Every parameter
// has help, hidden ones too: Help lists them under "Not in the form"
// (help.test.tsx).

/// A parameter's plain-language help (Help > Settings).
export interface ParamHelp {
  text: string
  tip?: string
}

/// Parameters that do nothing unless another parameter is set.
///
/// Without this a user could set `gap_penalty` with `gaps` at 0, or fill in
/// three taxonomy paths with `-species` off, and the run would silently ignore
/// all of it. Each dependency is the one stated in the option's own help text.
export interface Dependency {
  /// The parameter that has to be set, or a list of which any one will do.
  on: string | string[]
  /// Inverted: the parameter is inert while any of `on` IS set, because that
  /// one replaces it (tag_lengths replaces tag_length).
  replaced?: true
  /// Shown in place of the field's help when unmet. Phrased as the consequence,
  /// not the rule: a user wants to know what would happen, not what to obey.
  note: string
}

export interface ParamUi {
  /// The form section (paramLayout.ts SECTIONS) the parameter is shown in.
  /// Exactly one of `section` and `hidden` is set.
  section?: string
  /// Deliberately not rendered, and why. Not merely invisible: a hidden
  /// parameter is never sent (several are not settable at all: `-version`
  /// records the tool's version in the INI and the CLI rejects it).
  hidden?: string
  /// The option in words, for one whose CLI name is an abbreviation. The CLI
  /// name is shown beside it. Default: the name with spaces.
  label?: string
  /// The unit parameter drawn inside this value's field (one control).
  unit?: string
  /// Replaces the manifest's choices: a known small set of useful values the
  /// tool does not itself declare as restrictions.
  choices?: string[]
  /// Replaces the manifest's default or description where the manifest is
  /// not the tool's truth, or its text is written for developers.
  override?: { default?: string; description?: string }
  /// The declared minimum is a tiny floor standing for "greater than 0": 0
  /// and negatives are reported as such rather than as "must be at least".
  positive?: true
  /// The CLI refuses the declared maximum itself.
  belowMax?: true
  /// The parameters it needs (paramLayout.ts inertDependency).
  depends?: Dependency[]
  help?: ParamHelp
}

/// FASTag 1.12 options. Each is opt-in and leaves the output as 1.11 at its
/// default. Not offered in the form until each has its GUI design; until then
/// a GUI run uses the CLI defaults. The exception is acquisition_check (under
/// Spectra).
const OPT_IN_1_12 = '1.12 command-line option, not in the form yet (CLI default applies)'

const SPECIES_OFF: Dependency = { on: 'species', note: 'species detection is off' }
const GLYCO_OFF: Dependency = { on: 'glyco', note: 'oxonium flagging is off' }
const RECON_OFF: Dependency = { on: 'recon_out', note: 'reconciliation only runs when it has an output file' }
const MASSGAP_OFF: Dependency = { on: 'massgap_out', note: 'only the mass-gap report uses it' }

export const PARAM_UI: Record<string, ParamUi> = {
  // ---- Spectra
  // 1.12: the one changed default (raw DIA is refused), so the form offers
  // warn and off, or a GUI user could not tag raw DIA at all.
  acquisition_check: {
    section: 'Spectra',
    label: 'Raw DIA check',
    help: {
      text: 'Before tagging, FASTag checks whether the file is raw DIA data, whose MS2 spectra each mix several peptides. By default (refuse) such a file is not tagged: the run stops with exit code 11 before any file is written. warn tags it anyway, with a warning in the log; off skips the check. DDA and pseudo-DDA files pass the check and are tagged the same under every setting.',
      tip: 'Better than warn: make pseudo-DDA spectra with DIAspeXtract (or diaTracer for timsTOF .d) first, and tag those. Tags of raw DIA spectra get wrong flanking masses and complement statistics.'
    }
  },
  no_deisotope: {
    section: 'Spectra',
    label: 'Skip deisotoping',
    help: {
      text: 'FASTag normally merges each isotope cluster into its first (monoisotopic) peak and moves fragments of charge 2 or 3 to the mass they would have at charge 1, before it picks peaks. This switch turns both steps off.',
      tip: 'Leave it off. Turn it on only for the fastest possible run, or to compare with a tool that has no such step.'
    }
  },
  max_peaks: {
    section: 'Spectra',
    override: { description: 'Peaks kept per spectrum, at most 1024; 0 means 1024. More peaks need more memory.' },
    help: {
      text: 'How many peaks of each spectrum are kept, at most 1024. 0 also means 1024. More peaks need more memory.',
      tip: '400 suits most data. With peaks per window on, this is also the ceiling for that budget.'
    }
  },
  peaks_per_window: {
    section: 'Spectra',
    help: {
      text: 'Keep this many of the strongest peaks in every 100 Da window, instead of the strongest peaks of the whole spectrum. A wide spectrum then keeps more peaks than a narrow one. 0 turns it off.',
      tip: '10 is the default. Set 0 to keep simply the strongest "Max peaks" peaks.'
    }
  },
  subsample_spectra: {
    section: 'Spectra',
    help: {
      text: 'Tag only this many spectra, chosen at random. 0 tags all of them. When both this and the fraction are set, this count wins.',
      tip: 'Useful for a quick look at a large run.'
    }
  },
  subsample_fraction: {
    section: 'Spectra',
    help: {
      text: 'Tag only this share of the spectra (more than 0, up to 1), chosen at random. 0 tags all of them.',
      tip: '0.1 gives a fast species call on a large run.'
    }
  },
  subsample_seed: {
    section: 'Spectra',
    depends: [{ on: ['subsample_spectra', 'subsample_fraction'], note: 'nothing is being subsampled' }],
    help: {
      text: 'The starting number of the random choice. The same seed picks the same spectra again.',
      tip: 'Change it to draw a different random subset.'
    }
  },

  // ---- Tagging
  tag_length: {
    // The CLI warns "tag_length N is ignored: tag_lengths replaces it".
    section: 'Tagging',
    depends: [{ on: 'tag_lengths', replaced: true, note: 'tag_lengths replaces it' }],
    help: {
      text: 'The length of the shortest tag FASTag looks for, in residues. Every tag starts as a seed of this length; extension can make it longer.',
      tip: '3 is the default. Species detection needs tags of 7 residues: set 7 here (see How species detection works).'
    }
  },
  tag_lengths: {
    section: 'Tagging',
    help: {
      text: 'Several seed lengths in one pass over the file, one per line, instead of tag length. Each length is tagged as if run on its own, with its own "Max tags" limit, and a spectrum\'s rows come in order of length. A tag that several lengths find is kept once, from the length that scores it best.',
      tip: 'Cannot be combined with the entrapment database.'
    }
  },
  fragment_tolerance: {
    // Its declared minimum (1e-9) stands for "greater than 0"; it carries its
    // unit inside its field.
    section: 'Tagging',
    unit: 'fragment_tolerance_unit',
    positive: true,
    help: {
      text: 'How far a peak may lie from the mass FASTag expects and still count. The unit beside the number is ppm (parts per million of the mass) or Da.',
      tip: 'Set it to match the instrument that measured the MS2: 20 ppm for Orbitrap, Astral and TOF data; 0.3 Da for an ion trap. A ppm tolerance on ion-trap data gives almost no tags.'
    }
  },
  fragment_tolerance_unit: {
    section: 'Tagging',
    help: {
      text: 'The unit of the fragment tolerance: ppm or Da.',
      tip: 'ppm for high-resolution MS2, Da for an ion trap. With Da, the Digest tab makes no protease call.'
    }
  },
  gaps: {
    section: 'Tagging',
    help: {
      text: 'With 1, a tag may cross one missing peak: two peaks whose distance is the mass of two residues are joined, and both residue orders are written as separate tags. 0 turns this off.',
      tip: 'Leave it at 1; it lets a tag continue past a fragment that was not measured.'
    }
  },
  gap_penalty: {
    // -gaps 0 means no gapped tags exist, so nothing can be penalised.
    section: 'Tagging',
    depends: [{ on: 'gaps', note: 'only applies when tags may cross a gap' }],
    help: {
      text: 'Gapped tags are ranked as if their E-value were this many times worse, because they claim a peak nobody saw. The printed E-value of a gapped tag includes this factor. It never removes a tag at the E-value cutoff, but it decides which tags fill the "Max tags" places.',
      tip: '100 is the default. 1 turns the penalty off.'
    }
  },
  extension: {
    section: 'Tagging',
    help: {
      text: 'After a seed is found, FASTag tries to read up to this many more residues at each end, and scores the longer tag again. 0 turns extension off; the maximum is 12.',
      tip: 'Raise it for longer tags, for example 2 to let a seed of 3 grow to 7.'
    }
  },
  max_tags: {
    section: 'Tagging',
    help: {
      text: 'How many tags are written per spectrum, best first; with several tag lengths, per length. 0 writes all of them.',
      tip: '50 is the default. Lower it for smaller files when only the best tags matter.'
    }
  },
  max_evalue: {
    section: 'Tagging',
    label: 'Maximum E-value',
    help: {
      text: 'Tags with an E-value above this are not written; for a gapped tag the value before the gap penalty counts, so its printed E-value can be up to this times the gap penalty. 0 turns the cutoff off.',
      tip: '20 is the default. Lower it, for example to 1, to keep only the stronger tags.'
    }
  },
  diversity: {
    section: 'Tagging',
    override: {
      description:
        'When a spectrum has more candidate tags than max_tags allows, prefer tags that read different peaks over near-copies of a tag already kept. The number of tags kept stays the same.'
    },
    help: {
      text: 'When a spectrum has more tags than "Max tags" allows, prefer tags that read other peaks over near-copies of a tag already kept. The number of tags and the best tag stay the same.',
      tip: 'Try it for spectra that hold two peptides at once (common in TMT runs).'
    }
  },

  // ---- Sequence matching
  fasta: {
    section: 'Sequence matching',
    help: {
      text: 'A protein file (FASTA). Only tags that occur in these sequences are written (and, with an entrapment database, the entrapment-only matches, marked efwd/erev). I and L count as the same, tags are also tried reversed, and some residue pairs may stand in for a residue of the same mass.',
      tip: 'Very short tags occur in almost any protein by chance, so FASTag sets a minimum length from the size of the file: about 4 for one protein, 7 or 8 for a proteome. Set extension so that tag length + 2 × extension reaches it, or the run is refused. The log shows how many matches chance alone would give.'
    }
  },
  entrapment_fasta: {
    section: 'Sequence matching',
    depends: [{ on: 'fasta', note: 'the entrapment database is only searched together with fasta' }],
    help: {
      text: 'A second protein file from organisms the sample cannot contain. Matches to it estimate how often a tag matches the database by chance, written as a q_db column. Needs a sequence database.',
      tip: 'Use a distant proteome, for example archaea for a human sample. Cannot be combined with species detection or with several tag lengths.'
    }
  },
  orientation: {
    // Read by the fasta filter AND by reconciliation (FASTag.cpp: TagReconciler
    // takes the orientation, the proteome index the isobaric tolerance).
    section: 'Sequence matching',
    depends: [
      { on: ['fasta', 'recon_out'], note: 'only affects matching against fasta and reconciliation' }
    ],
    override: {
      description:
        'Match tags as written, or also reversed, against fasta and recon_fasta. Tags are written N- to C-terminal, so tags read from the other ion series match only reversed.'
    },
    help: {
      text: 'Whether a tag is matched only as written, or also reversed. Tags are written N- to C-terminal as if read from y ions; a tag read from b ions matches only reversed.',
      tip: 'Keep "both" unless you know the tags come from one ion series.'
    }
  },
  isobaric_tolerance: {
    section: 'Sequence matching',
    depends: [
      { on: ['fasta', 'recon_out'], note: 'only affects matching against fasta and reconciliation' }
    ],
    help: {
      text: 'When matching against the sequence database or reconciling, a residue may stand for a pair of residues of the same mass within this tolerance (for example N for GG). 0 asks for exact sequences.',
      tip: '0.04 Da is the default.'
    }
  },
  min_filter_length: {
    section: 'Sequence matching',
    depends: [{ on: 'fasta', note: 'only affects matching against a sequence database' }],
    help: {
      text: 'Tags shorter than this are not matched against the sequence database. 0 lets FASTag choose a length from the size of the database, where chance matches become rare.',
      tip: 'Leave it at 0 unless the chance table in the log says otherwise.'
    }
  },

  // ---- Species detection
  species: {
    section: 'Species detection',
    help: {
      text: 'Work out which organisms the tags come from, using the species reference index bundled with FASTag. The result appears in the Species tab and in a report beside the tags.',
      tip: 'Needs tags of 7 residues: set tag length 7 (extension alone lets few tags reach 7). Subsample a large run (fraction 0.1) for a fast answer.'
    }
  },
  species_rank: {
    // The CLI accepts any rank and reports nothing for one the bundled taxonomy
    // lacks, so the list holds only ranks its nodes.dmp has: NCBI names the top
    // rank `domain` there, and `superkingdom` gives an empty report.
    section: 'Species detection',
    choices: ['species', 'genus', 'family', 'order', 'class', 'phylum', 'kingdom', 'domain'],
    depends: [SPECIES_OFF],
    help: {
      text: 'The level of the taxonomy at which organisms are reported: genus, family, and so on.',
      tip: 'genus is the default and the finest level the reference supports; species names are not reliable.'
    }
  },
  species_evidence: {
    section: 'Species detection',
    depends: [SPECIES_OFF],
    override: {
      description:
        "Which tags of a spectrum count as evidence for a taxon: 'best' = only its best tag that matches the reference; 'all' = every reported tag (the behaviour before 1.10)."
    },
    help: {
      text: 'Which tags of a spectrum make it count for an organism. "best": only its best tag that is found in the reference. "all": every reported tag.',
      tip: 'Keep "best"; with "all", wrong tags add organisms they hit by chance.'
    }
  },
  species_min_len: {
    section: 'Species detection',
    depends: [SPECIES_OFF],
    help: {
      text: 'Tags shorter than this are not used for species detection. Values below the index length (7 for the bundled index) use that length.',
      tip: 'Leave it at 0.'
    }
  },
  species_use_gapped: {
    // Two masters: a gapped tag has to exist before it can be let into the index.
    section: 'Species detection',
    depends: [SPECIES_OFF, { on: 'gaps', note: 'no gapped tags are produced' }],
    help: {
      text: 'Let gapped tags count as species evidence. Off by default, because the two residues across a gap are inferred, not seen, and an exact lookup cannot tell the difference.',
      tip: 'Leave it off: gapped tags pushed the true genus far down on a public test run.'
    }
  },
  species_deconvolve: {
    section: 'Species detection',
    depends: [SPECIES_OFF],
    help: {
      text: 'Subtract the evidence an organism collects only because it shares protein sequence with a stronger one. Adds an Adjusted column to the Species tab.',
      tip: 'Try it on high-resolution data when close relatives are in the reference. Leave it off for ion-trap data and when rare organisms matter: it can remove real ones.'
    }
  },
  species_max_kmer_share: {
    section: 'Species detection',
    label: 'Maximum taxon share of a k-mer',
    depends: [SPECIES_OFF],
    help: {
      text: 'Ignore protein pieces found in more than this share of the organisms in the reference, since they cannot tell organisms apart. 1 keeps all.',
      tip: 'Leave it at 1; on test data it changed nothing.'
    }
  },
  species_min_margin: {
    section: 'Species detection',
    label: 'Minimum lead over runner-up taxon',
    depends: [SPECIES_OFF],
    help: {
      text: 'Ignore a tag unless its best organisms hold a clearly larger share of its pieces than the next organism, by at least this margin. 0 keeps all.',
      tip: 'Leave it at 0; on test data it changed nothing.'
    }
  },
  species_out: {
    section: 'Species detection',
    depends: [SPECIES_OFF],
    help: {
      text: 'Where the species report is written. Empty: beside the tags file, named <name>.tags.species.tsv.'
    }
  },
  taxdb: {
    section: 'Species detection',
    label: 'Species reference index',
    depends: [SPECIES_OFF],
    override: { description: 'Species reference index. Default: the one bundled with FASTag.' },
    help: {
      text: 'A species reference index of your own (built with buildtaxdb). Empty: the index bundled with FASTag.',
      tip: 'Give it together with both taxonomy files, or leave all three empty.'
    }
  },
  taxonomy_nodes: {
    section: 'Species detection',
    depends: [SPECIES_OFF],
    help: {
      text: 'The NCBI taxonomy tree (nodes.dmp) that goes with your own index. Empty: the bundled one.',
      tip: 'Give all three of index, nodes and names, or none.'
    }
  },
  taxonomy_names: {
    section: 'Species detection',
    depends: [SPECIES_OFF],
    help: {
      text: 'The NCBI taxonomy names (names.dmp) that go with your own index. Empty: the bundled one.',
      tip: 'Give all three of index, nodes and names, or none.'
    }
  },

  // ---- Glycopeptides
  glyco: {
    section: 'Glycopeptides',
    help: {
      text: 'Write a report that flags spectra with oxonium ions, the small sugar fragments that glycopeptides and glycans give off. A spectrum is flagged when at least 2 different oxonium ions are found and their summed intensity reaches the minimum fraction of the base peak.',
      tip: 'A flag means a sugar broke apart in that spectrum; it does not identify a glycopeptide. On TMT data at 0.3 Da, a TMT reporter ion (126.128) overlaps a sugar fragment (126.055), so read the flags with care. Keep the tolerance that suits the MS2 analyzer.'
    }
  },
  glyco_min_fraction: {
    section: 'Glycopeptides',
    depends: [GLYCO_OFF],
    help: {
      text: 'The summed oxonium intensity a flagged spectrum needs, as a fraction of its strongest peak.',
      tip: '0.10, the threshold from the literature.'
    }
  },
  glyco_out: {
    section: 'Glycopeptides',
    depends: [GLYCO_OFF],
    help: {
      text: 'Where the oxonium report is written. Empty: beside the tags file, named <name>.tags.glyco.tsv.'
    }
  },

  // ---- Digest and labels
  digest_out: {
    section: 'Digest and labels',
    help: {
      text: 'Write the digest report: which residues sit at the ends of the tags, and which protease that pattern fits best (or why no call is made). Shown in the Digest tab.',
      tip: 'Run it without a sequence or entrapment database: with one, only the written rows are counted.'
    }
  },
  label_out: {
    section: 'Digest and labels',
    help: {
      text: 'Write the label report: how many tag ends carry a TMT, TMTpro or iTRAQ4 mass, and the share of heavy K and R (SILAC). Shown in the Digest tab.'
    }
  },
  digest_models: {
    section: 'Digest and labels',
    depends: [{ on: 'digest_out', note: 'only the digest report uses the models' }],
    help: {
      text: 'A table of protease models of your own, replacing the shipped ones (Trypsin, Lys-C, Arg-C, Glu-C, Chymotrypsin, Asp-N, Lys-N and unspecific).',
      tip: 'Needed only for other models, such as HLA ligands or the proteasome.'
    }
  },
  digest_tag_min: {
    section: 'Digest and labels',
    depends: [{ on: 'digest_out', note: 'only the digest report uses it' }],
    help: {
      text: 'How many C-terminal tag ends a protease call needs. The N-terminal ends are used only when there are as many of them.',
      tip: '100 is the default.'
    }
  },
  digest_window: {
    section: 'Digest and labels',
    depends: [
      { on: ['digest_out', 'label_out'], note: 'neither the digest nor the label report is written' }
    ],
    help: {
      text: 'How close the mass at a tag end must be to a residue or label mass to count.',
      tip: '0.008 Da is the default.'
    }
  },
  digest_background_share: {
    // Declared 0..1, but at 1 every protease model is the background, so all tie.
    section: 'Digest and labels',
    belowMax: true,
    depends: [{ on: 'digest_out', note: 'only the digest report uses it' }],
    help: {
      text: 'How much of the background residue composition is mixed into every protease model, so that an unexpected residue does not rule a model out. Must be below 1.',
      tip: '0.05 is the default.'
    }
  },
  digest_silac_min: {
    section: 'Digest and labels',
    label: 'Heavy-label check: minimum K and R ends',
    depends: [{ on: 'label_out', note: 'only the label report uses it' }],
    help: {
      text: 'How many K and how many R tag ends the label report needs before it judges the heavy SILAC shares.',
      tip: '50 is the default.'
    }
  },

  // ---- Reconciliation
  recon_out: {
    section: 'Reconciliation',
    label: 'Reconciliation table',
    help: {
      text: 'Place each tag in the peptides of a protein database, using the masses on either side of it, and write one row per placement. When one side does not fit, the leftover mass is written with a guess at what it could be.',
      tip: 'Needs a database: the reconciliation database, or else the sequence database. The rows are candidates, not identifications. Reconciliation uses tryptic peptides (cut after K and R, with up to 1 missed cleavage by default) whatever the protease call says, so for other proteases the placements and mass gaps are incomplete.'
    }
  },
  recon_fasta: {
    section: 'Reconciliation',
    label: 'Reconciliation database',
    depends: [RECON_OFF],
    help: {
      text: 'The protein database for reconciliation. Empty: the sequence database (fasta) is used.',
      tip: 'With a database here and none under Sequence matching, every tag is reconciled, not only those that match the sequence database.'
    }
  },
  recon_missed_cleavages: {
    section: 'Reconciliation',
    label: 'Reconciliation: missed cleavages',
    depends: [RECON_OFF],
    help: {
      text: 'How many skipped trypsin cleavage sites a database peptide may contain, at most 10.',
      tip: '1 is the default.'
    }
  },
  recon_min_length: {
    section: 'Reconciliation',
    label: 'Reconciliation: minimum tag length',
    depends: [RECON_OFF],
    help: {
      text: 'Tags shorter than this are not reconciled. 0 lets FASTag choose the length at which chance matches fall below 5%.',
      tip: 'Leave it at 0.'
    }
  },
  recon_localize: {
    section: 'Reconciliation',
    label: 'Localize mass gaps',
    depends: [RECON_OFF],
    help: {
      text: 'Try to pin each leftover mass to one residue, by the fragment peaks it would shift. Adds the columns loc_site, loc_score and loc_ties.'
    }
  },
  delta_out: {
    section: 'Reconciliation',
    label: 'Mass-shift histogram',
    depends: [{ on: 'recon_out', note: 'the histogram is built from the reconciliation results' }],
    help: {
      text: 'Write a histogram of the leftover masses, one count per spectrum.',
      tip: 'Read it as candidates: no peak here is an identified modification.'
    }
  },
  recon_id_out: {
    section: 'Reconciliation',
    label: 'Reconciliation as identifications',
    depends: [{ on: 'recon_out', note: 'it writes the reconciliation results as identifications' }],
    help: {
      text: 'Write the placements as identifications in idXML, mzIdentML or mzTab, for tools that read those formats. The file extension chooses the format: .idXML, .mzid or .mzTab (.mzIdentML is not accepted).',
      tip: 'These are not filtered by a false discovery rate.'
    }
  },
  massgap_out: {
    section: 'Reconciliation',
    label: 'Mass-gap report',
    depends: [{ on: 'recon_out', note: 'the mass gaps come from the reconciliation results' }],
    help: {
      text: 'Write the mass-gap report: the leftover masses, cysteine alkylation counts, frequent gaps explained as combinations of known modifications, and SILAC labels among them. Shown in the Digest tab.',
      tip: 'To see the cysteine alkylation, run it without fixed modifications.'
    }
  },
  massgap_window: {
    section: 'Reconciliation',
    label: 'Gap window (ppm runs)',
    depends: [RECON_OFF, MASSGAP_OFF],
    help: {
      text: 'How close a leftover mass must be to a modification mass, on runs with a ppm tolerance.',
      tip: '0.02 Da is the default.'
    }
  },
  massgap_window_da: {
    section: 'Reconciliation',
    label: 'Gap window (Da runs)',
    depends: [RECON_OFF, MASSGAP_OFF],
    help: {
      text: 'The same window on runs with a Da tolerance.',
      tip: '0.5 Da is the default.'
    }
  },
  massgap_min_spectra: {
    section: 'Reconciliation',
    depends: [RECON_OFF, MASSGAP_OFF],
    help: {
      text: 'How many spectra a mass-gap peak needs.',
      tip: '20 is the default; the share below can ask for more.'
    }
  },
  massgap_min_share: {
    section: 'Reconciliation',
    depends: [RECON_OFF, MASSGAP_OFF],
    help: {
      text: 'The share of placed spectra a mass-gap peak needs.',
      tip: '0.005 is the default.'
    }
  },
  massgap_min_bin: {
    section: 'Reconciliation',
    depends: [RECON_OFF, MASSGAP_OFF],
    help: {
      text: 'How many spectra a histogram row needs to take part in the peaks.',
      tip: '2 is the default.'
    }
  },
  massgap_max_mods: {
    section: 'Reconciliation',
    depends: [RECON_OFF, MASSGAP_OFF],
    help: {
      text: 'How many modifications may be combined to explain one gap (1 to 4).',
      tip: '3 is the default.'
    }
  },
  massgap_top: {
    section: 'Reconciliation',
    depends: [RECON_OFF, MASSGAP_OFF],
    help: {
      text: 'How many modifications are listed as the most frequent.',
      tip: '5 is the default.'
    }
  },
  massgap_silac_share: {
    section: 'Reconciliation',
    label: 'SILAC: minimum share of shifted spectra',
    depends: [RECON_OFF, MASSGAP_OFF],
    help: {
      text: 'The share of shifted spectra a SILAC label needs to count; a SILAC call needs two of Lys4, Arg6, Lys8 and Arg10 to reach it.',
      tip: '0.08 is the default.'
    }
  },
  massgap_silac_min: {
    section: 'Reconciliation',
    label: 'SILAC: minimum shifted spectra',
    depends: [RECON_OFF, MASSGAP_OFF],
    help: {
      text: 'How many shifted spectra a SILAC call needs.',
      tip: '500 is the default.'
    }
  },

  // ---- Modifications
  fixed_modifications: {
    section: 'Modifications',
    help: {
      text: "Modifications present on every residue of a kind, by their OpenMS (Unimod) name, one per line. They change that residue's mass and are not written in the tag.",
      tip: 'The default is Carbamidomethyl (C), for iodoacetamide alkylation. For a TMT sample add, for example, TMT6plex (K) and TMT6plex (N-term). A terminal one (N-term) appears in the mass-gap report as a peak at its mass.'
    }
  },
  variable_modifications: {
    section: 'Modifications',
    help: {
      text: 'Modifications that may or may not be present, one per line. A modified residue is written in the tag as X[Name], for example S[Phospho].',
      tip: 'Each one adds candidate masses, so add only those you expect.'
    }
  },

  // ---- Output
  proforma: {
    section: 'Output',
    label: 'ProForma column',
    help: {
      text: 'Add a column with each tag in ProForma 2.0 notation, a standard way to write peptides that other tools can read. I and L are written as J.'
    }
  },
  res_conf: {
    section: 'Output',
    label: 'Per-residue confidence column',
    override: {
      description:
        'Add a res_conf column: a confidence from 0 to 100 for each residue, N- to C-terminal. De novo assembly tools can use it.'
    },
    help: {
      text: 'Add a column with a confidence from 0 to 100 for each residue of the tag. Tools that build full peptide sequences from tags can use it.'
    }
  },
  usi_collection: {
    section: 'Output',
    label: 'USI column (dataset ID)',
    help: {
      text: "Add a column naming each tag's spectrum as a Universal Spectrum Identifier (USI) in this dataset, for example PXD000001.",
      tip: 'Use USI000000 until the dataset has an accession.'
    }
  },
  out_spectra: {
    section: 'Output',
    label: 'Spectra with tags (file)',
    help: {
      text: 'Also write the spectra that carry at least one reported tag that is not an entrapment match, as mzML or mzPeak (chosen by the extension).',
      tip: 'This needs memory in proportion to the size of the file. With a sequence database, it collects the spectra whose tags match.'
    }
  },

  // ---- Performance
  threads: {
    // TOPPBase registers -threads itself with default 1, and FASTag applies its
    // real default -- 0, half the logical cores -- to argv in main(), because
    // TOPPBase offers no hook to change a common option. The manifest is a dump
    // of -write_ini, so it carries TOPPBase's number and text; this is the tool's.
    section: 'Performance',
    override: {
      default: '0',
      description: 'Threads to use. 0 (the default) means half the logical cores.'
    },
    help: {
      text: 'How many processor threads a run uses. 0, the default, means half of the logical cores, so the computer stays usable.',
      tip: 'The output is the same at every thread count.'
    }
  },

  // ---- Not in the form
  in: {
    hidden: 'dedicated input picker',
    help: {
      text: 'The spectra file. Chosen with Choose file… under Input.'
    }
  },
  out: {
    hidden: 'dedicated output field',
    help: {
      text: 'The tags file. Set under Output as "Tags TSV".'
    }
  },
  progress: {
    hidden: 'forced on; the GUI consumes the progress stream',
    help: {
      text: 'The progress messages the progress bar reads. The app always turns them on.'
    }
  },
  version: {
    hidden: 'TOPP boilerplate',
    help: {
      text: 'The FASTag version that wrote a parameter file. Not a setting.'
    }
  },
  log: {
    hidden: 'TOPP boilerplate',
    help: {
      text: 'A standard OpenMS option that writes the log to a file. The app shows the log itself.'
    }
  },
  debug: {
    hidden: 'TOPP boilerplate',
    help: {
      text: 'A standard OpenMS option for more detailed log messages.'
    }
  },
  no_progress: {
    hidden: 'TOPP boilerplate; unrelated to -progress',
    help: {
      text: "A standard OpenMS option that hides OpenMS's own progress messages."
    }
  },
  force: {
    hidden: 'TOPP boilerplate',
    help: {
      text: 'A standard OpenMS option that skips some of its checks.'
    }
  },
  test: {
    hidden: 'TOPP boilerplate',
    help: {
      text: 'A standard OpenMS option for its internal tests.'
    }
  },
  stream: {
    hidden: 'stdin/stdout resident mode; meaningless under a GUI',
    help: {
      text: 'A mode that reads spectra one at a time from another program. It does not work from the app.'
    }
  },
  mzpeak_read_memory: {
    hidden: 'ignored by the CLI: mzPeak is read in file order without a decode cache',
    help: {
      text: 'Has no effect; kept so that old command lines still run.'
    }
  },

  // ---- Not in the form: FASTag 1.12 command-line options (see OPT_IN_1_12)
  acquisition_probe_spectra: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'How many MS2 spectra at the start of the run the acquisition check reads (metadata only).'
    }
  },
  alkylation_min_share: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'Which share of the counted spectra the alkylation call needs.'
    }
  },
  alkylation_min_spectra: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'How many spectra the alkylation call needs.'
    }
  },
  alkylation_out: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'Write a report of which reagent alkylated the cysteines, or none, from the placements of peptides with one cysteine. Not validated on held-out data.'
    }
  },
  alkylation_proteome: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'The database the alkylation report uses when no reconciliation database is given: a FASTA file. In 1.12.0 the alkylation report needs this FASTA file or a reconciliation database: the shipped proteomes (human, mouse, yeast, E. coli) that the names stand for are not in this release, and naming one, or leaving the default auto, stops the run with an error.'
    }
  },
  alkylation_window: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'The mass window around each cysteine form for the alkylation report. 0 means 0.02 Da on a ppm run and 0.5 Da on a Da run.'
    }
  },
  census: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'Also write a census: one row for every MS2 spectrum read, tagged or not, and a run summary. A status in the census is not a quality call.'
    }
  },
  census_ids: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'Identifications of the same run (idXML or mzid) for the census: each spectrum is then marked identified or not. The file needs q-values.'
    }
  },
  census_ids_fdr: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'The q-value a target hit needs for its spectrum to count as identified in the census.'
    }
  },
  census_out: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'Where the per-spectrum census goes. By default next to the tags file, ending in .census.tsv.'
    }
  },
  census_summary_out: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'Where the census run summary goes. By default next to the tags file, ending in .census_summary.tsv.'
    }
  },
  census_triage_evalue: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'The E-value at or below which an unidentified spectrum with a tag is marked for a second look in the census. It is a threshold, not a quality call.'
    }
  },
  charge_infer_margin: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'By how much the supported charge must beat the next one to be tagged alone; when the two are closer, both are tagged.'
    }
  },
  charge_max: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'The highest charge tried for a precursor without a charge, when it is not tagged as 2+.'
    }
  },
  charge_min: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'The lowest charge tried for a precursor without a charge, when it is not tagged as 2+.'
    }
  },
  complement_midp: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'Score tags with no or one complement pair with the mid-p variant of the complement test.'
    }
  },
  complement_probe: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'How many MS2 spectra the auto complement window is measured on (experimental).'
    }
  },
  complement_rule: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'Which fragment pairs count as complements when tags are scored: pairs at the same charge (the default), pairs that share the precursor charge, or either.'
    }
  },
  complement_tol_factor: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'The factor on the fragment tolerance when the complement window follows it.'
    }
  },
  complement_tolerance: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'The mass window, in Da, for a complement partner.'
    }
  },
  complement_tolerance_unit: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'Whether the complement window is a fixed value in Da, follows the fragment tolerance, or (auto, experimental) is measured on the run from the complement pairs of confident tags.'
    }
  },
  digest_calibration: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'A file that calibrates the confidence of the digest call. By default the shipped one.'
    }
  },
  digest_detection: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'Apply per-instrument weights in the digest report, which also gives a call on timsTOF runs. Not validated on held-out data.'
    }
  },
  digest_flank2: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'Let the digest report also use the two residues before each cut when the one-residue counts are too few. Not validated on held-out data.'
    }
  },
  digest_min_confidence: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'Give no digest call when its calibrated confidence is below this value. 0 turns it off.'
    }
  },
  digest_models_version: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'Which protease models the digest report uses: the shipped ones (as in 1.11) or v2. v2 is not validated on held-out data.'
    }
  },
  dump_spectrum: {
    hidden: 'spectrum dump for programs; prints JSON lines and exits',
    help: {
      text: 'Print the peaks FASTag tags in one spectrum and exit. It writes no output file and is for other programs.'
    }
  },
  fasta_out: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'Write a smaller FASTA with the proteins of the shortlist, for a database search. No decoys are added; let the search engine make them.'
    }
  },
  ion_series: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'Read the spectra as b/y ions (the default), as c/z ions of ETD or ECD, or choose per spectrum from its activation (auto).'
    }
  },
  isotope_error: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'Also consider precursor masses lowered by one or more isotope spacings (1.00336 Da each), for precursors picked on the wrong isotope peak. Needs a fragment tolerance below 0.05 Da.'
    }
  },
  pick_profile: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'Centroid profile MS2 spectra before tagging. By default only mzPeak input is centroided (as in 1.11); auto also centroids mzML; off never centroids. Spectra that are already centroided are never picked again.'
    }
  },
  pick_unknown_type: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'With profile picking on auto, also centroid spectra that do not say whether they are profile or centroided, when their data look like profile.'
    }
  },
  probe_input: {
    hidden: 'metadata probe for programs; prints JSON lines and exits',
    help: {
      text: 'Print what a spectra file contains (instrument, activation, spectrum counts, profile or centroided) and exit. It writes no output file and is for other programs.'
    }
  },
  search_config_out: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'Write search-engine settings (Sage or Comet) for the smaller FASTA.'
    }
  },
  search_config_template: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'For Comet only: a parameter file the written settings are merged into.'
    }
  },
  search_decoy_prefix: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'The decoy prefix the search engine uses. Empty means the engine default.'
    }
  },
  search_engine: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'The search engine the settings are written for: Sage or Comet.'
    }
  },
  search_isotope_errors: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'How many precursor isotope errors the search engine should consider.'
    }
  },
  search_precursor_tolerance: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'The precursor tolerance written into the search settings.'
    }
  },
  search_precursor_unit: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'The unit of that precursor tolerance.'
    }
  },
  search_shifts: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'Add the mass shifts FASTag sees in the run to the search settings: as variable modifications, as Comet mass offsets, or both. Experimental.'
    }
  },
  search_shifts_out: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'Write a table of the mass shifts FASTag found and what it did with each one in the search settings.'
    }
  },
  shift_expand_sites: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'Let a variable modification also sit on the residues where FASTag placed that shift.'
    }
  },
  shift_max_offsets: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'How many mass shifts are written as Comet mass offsets, besides 0.'
    }
  },
  shift_max_variable: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'How many mass shifts are written as variable modifications.'
    }
  },
  shift_site_min_count: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'How many placed spectra a residue needs before a shift is allowed on it.'
    }
  },
  shift_site_min_ions: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'How many fragment ions a placed spectrum needs to count for a residue.'
    }
  },
  shift_site_min_share: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'The share of the placed spectra of a shift that a residue needs before the shift is allowed on it.'
    }
  },
  shortlist_background: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'Proteins that are always added to the smaller FASTA, such as the host proteome or contaminants.'
    }
  },
  shortlist_decoy_affix: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'The name prefixes and suffixes that mark a decoy entry; decoys never enter the shortlist.'
    }
  },
  shortlist_force: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'Write the smaller FASTA and the search settings even when the protease of the run does not fit tryptic placement.'
    }
  },
  shortlist_gapped: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'Let placements with one mismatched flank count for the shortlist.'
    }
  },
  shortlist_max_evalue: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'The E-value a tag needs for its placements to count for the shortlist.'
    }
  },
  shortlist_min_spectra: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'How many spectra a protein needs to stay on the shortlist.'
    }
  },
  shortlist_out: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'Write a ranked list of the proteins the tags were placed on. It narrows a later database search; it is not an identification and has no FDR control.'
    }
  },
  shortlist_parsimony: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'Whether proteins whose spectra a higher-ranked protein already has are dropped from the shortlist.'
    }
  },
  shortlist_top: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'Keep at most this many proteins on the shortlist. 0 means no limit.'
    }
  },
  species_call: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'Call each organism of the species report present, no call or not detected, by comparing it with decoy tags. Off by default.'
    }
  },
  species_call_decoys: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'How many decoy tags are made for each tag when organisms are called.'
    }
  },
  species_call_min_units: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'Fewer spectra with organism evidence than this give no call for the whole run.'
    }
  },
  species_call_params: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'A file with the decision settings of the organism call. By default the one in the taxonomy folder.'
    }
  },
  species_orientation: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'Look up each tag in the species index as written (the default) or also reversed. When reversed readings are used, the log p-value and q-value columns are NA.'
    }
  },
  species_pi0: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'The share of absent organisms assumed for the q-values of the organism call. 1 is the standard (Benjamini-Hochberg) correction.'
    }
  },
  unknown_charge: {
    hidden: OPT_IN_1_12,
    help: {
      text: 'How a precursor whose charge the file does not give is tagged: as 2+ (the default, as before 1.12), at each possible charge, or at the charge its fragment pairs support best. A charge given in the file is never replaced.'
    }
  }
}
