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
  /// The text says all the CLI description does: the (?) leaves the
  /// description out (HelpPopover popoverTexts).
  cliCovered?: true
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
  /// What the field says it needs, in place of the masters' names (two
  /// masters that are one control: Spectra to read).
  say?: string
  /// A master that is a choice counts as set by its value, not by being
  /// non-empty: `is` lists the values that set it, `isNot` those that do
  /// not (an empty field reads as its default). A master without an entry
  /// is set as paramLayout isActive says.
  when?: Record<string, { is?: string[]; isNot?: string[] }>
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
  /// Experimental in the CLI (README): the form marks it so.
  experimental?: true
  /// Named values offered in a select, with Custom for any other: a bare
  /// number would read wrong (0.0 spectra to read means all of them).
  steps?: { label: string; value: string }[]
  /// A value that stands for "not set" (-1: by engine): its field is shown
  /// empty with this placeholder, and an emptied field goes back to it.
  unset?: { value: string; placeholder: string }
  help?: ParamHelp
}

/// FASTag 1.14 removed these options: they failed their held-out tests. The
/// CLI still accepts each name, with a warning and no effect, so that saved
/// command lines and INI files keep working; the form never offers them.
const REMOVED_1_14 = 'removed in 1.14 (failed its held-out test); the CLI accepts it with a warning, no effect'
const REMOVED_1_14_HELP: ParamHelp = {
  text: 'Removed in FASTag 1.14 because it failed its held-out test. It has no effect; it is kept so that old command lines and INI files still run.'
}

const SPECIES_OFF: Dependency = { on: 'species', note: 'species detection is off' }
const GLYCO_OFF: Dependency = { on: 'glyco', note: 'oxonium flagging is off' }
const RECON_OFF: Dependency = { on: 'recon_out', note: 'tags are placed only when the placements are written' }
const MASSGAP_OFF: Dependency = { on: 'massgap_out', note: 'only the mass-gap report uses it' }
const DB_UNUSED: Dependency = {
  on: ['recon_out', 'shortlist_out', 'fasta_out', 'search_config_out', 'alkylation_out'],
  note: 'nothing places tags on the database: turn on the placements, the shortlist or the alkylation report'
}
/// Read wherever tags meet protein sequences: the database filter and every
/// report that places tags (FASTag.cpp: the filter and TagReconciler take the
/// orientation and the isobaric tolerance).
const TAGS_ON_DB: Dependency = {
  on: ['fasta', ...(DB_UNUSED.on as string[])],
  say: 'a Filter database, or a report that places tags on a protein database',
  note: 'keep only tags found in a database, or turn on the placements, the shortlist or the alkylation report'
}
const DELTA_OFF: Dependency = { on: 'delta_out', note: 'only the mass-shift table uses it' }
const SHORTLIST_OFF: Dependency = { on: ['shortlist_out', 'fasta_out', 'search_config_out'], note: 'no shortlist is written' }
/// Read for the shortlist and the reduced FASTA only, not for the search
/// configuration alone (FASTag.cpp IgnoredOption: shortlist_on).
const SHORTLIST_READ: Dependency = { on: ['shortlist_out', 'fasta_out'], note: 'only the shortlist and the reduced FASTA use it' }
const TRYPSIN_ONLY: Dependency = {
  on: 'shortlist_protease',
  when: { shortlist_protease: { is: ['trypsin'] } },
  say: 'Protease set to Trypsin',
  note: 'ignored with any other protease'
}
const NOT_TRYPSIN: Dependency = {
  on: 'shortlist_protease',
  when: { shortlist_protease: { isNot: ['trypsin'] } },
  say: 'Protease set to a rule other than Trypsin',
  note: 'Trypsin always counts fully specific placements'
}
const HEADER_CHECK_OFF: Dependency = {
  on: 'check_header_charge',
  when: { check_header_charge: { isNot: ['off'] } },
  say: 'Charge check mode set to warn or both',
  note: 'the charge check is off'
}
const CALL_OFF: Dependency = {
  on: 'species_call',
  when: { species_call: { is: ['decoy'] } },
  say: 'Presence call set to Decoy',
  note: 'the presence call is None'
}
const CHARGES_TRIED: Dependency = {
  on: ['unknown_charge', 'check_header_charge'],
  when: { unknown_charge: { isNot: ['assume2'] }, check_header_charge: { isNot: ['off'] } },
  say: 'Precursors without a charge set to try other charges, or the Charge check on',
  note: 'charge 2 is assumed for spectra without a charge'
}
const SEARCH_OFF: Dependency = { on: 'search_config_out', note: 'no search configuration is written' }
const CENSUS_OFF: Dependency = { on: 'census', note: 'no identifiability table is written' }
const IDS_OFF: Dependency = { on: 'census_ids', note: 'only used with an identification file' }
const ALKYLATION_OFF: Dependency = { on: ['alkylation_out', 'alkylation_tags_out'], note: 'no alkylation report is written' }
const DIGEST_OFF: Dependency = { on: 'digest_out', note: 'only the digest report uses it' }

export const PARAM_UI: Record<string, ParamUi> = {
  // ---- Spectra
  // 1.12: the one changed default (raw DIA is refused), so the form offers
  // warn and off, or a GUI user could not tag raw DIA at all.
  acquisition_check: {
    section: 'Sampling and checks',
    label: 'DIA input',
    help: {
      text: 'Before tagging, FASTag checks whether the file is raw DIA data, whose MS2 spectra each mix several peptides. By default (refuse) a file classified as raw DIA is not tagged: the run stops with exit code 11 before any file is written. warn tags it anyway, with a warning in the log; off skips the check. The revised 1.13 check passed its second held-out test on Thermo files: 0 of 58 non-DIA files and 35 of 37 DIA files were refused. A third test on Astral, timsTOF and SCIEX files refused 0 of 75 non-DIA and 60 of 60 DIA files; it is inconclusive because it had only 3 Astral DDA files and no closed-window DIA file. A fourth test refused 0 of 86 non-DIA files (12 Astral DDA) and 70 of 71 DIA files; it is also inconclusive, with only 1 closed-window DIA file. If a known DDA file is refused, inspect the acquisition metadata before choosing warn or off.',
      tip: 'Better than warn: make pseudo-DDA spectra with DIAspeXtract (or diaTracer for timsTOF .d) first, and tag those. Tags of raw DIA spectra get wrong flanking masses and complement statistics.'
    }
  },
  no_deisotope: {
    section: 'Peaks',
    label: 'Skip deisotoping',
    help: {
      text: 'Skips deisotoping and charge reduction. FASTag normally merges each isotope cluster into its first (monoisotopic) peak and moves fragments of charge 2 or 3 to the mass they would have at charge 1, before it picks peaks. This switch turns both steps off.',
      tip: 'Leave it off. Turn it on only for the fastest possible run, or to compare with a tool that has no such step.'
    }
  },
  max_peaks: {
    section: 'Peaks',
    override: { description: 'Peaks kept per spectrum, at most 1024; 0 means 1024. More peaks need more memory.' },
    help: {
      text: 'How many peaks of each spectrum are kept, at most 1024. 0 also means 1024. More peaks need more memory.',
      tip: '400 suits most data. With peaks per window on, this is also the ceiling for that budget.'
    }
  },
  peaks_per_window: {
    section: 'Peaks',
    help: {
      text: 'Keep this many of the strongest peaks in every 100 Da window, instead of the strongest peaks of the whole spectrum. A wide spectrum then keeps more peaks than a narrow one. 0 turns it off.',
      tip: '10 is the default. Set 0 to keep simply the strongest "Peaks kept" peaks.'
    }
  },
  subsample_spectra: {
    section: 'Sampling and checks',
    help: {
      text: 'Tag only this many spectra, chosen at random. 0 tags all of them. When both this and the fraction are set, this count wins.',
      tip: 'Useful for a quick look at a large run.'
    }
  },
  subsample_fraction: {
    section: 'Sampling and checks',
    label: 'Spectra to read',
    steps: [
      { label: 'All spectra', value: '0' },
      { label: '10%', value: '0.1' },
      { label: '25%', value: '0.25' }
    ],
    help: {
      text: 'Tag only this share of the spectra (more than 0, up to 1), chosen at random. 0 tags all of them.',
      tip: '0.1 gives a fast species call on a large run.'
    }
  },
  subsample_seed: {
    section: 'Sampling and checks',
    depends: [{ on: ['subsample_fraction', 'subsample_spectra'], note: 'nothing is being subsampled', say: 'Spectra to read set below all spectra' }],
    help: {
      text: 'The starting number of the random choice. The same seed picks the same spectra again.',
      tip: 'Change it to draw a different random subset.'
    }
  },

  // ---- Tagging
  tag_length: {
    // The CLI warns "tag_length N is ignored: tag_lengths replaces it".
    section: 'Tagging',
    label: 'Seed length',
    depends: [{ on: 'tag_lengths', replaced: true, note: 'the seed lengths listed under Tagging, advanced replace it' }],
    help: {
      text: 'The length of the shortest tag FASTag looks for, in residues. Every tag starts as a seed of this length; extension can make it longer.',
      tip: '3 is the default. Species detection needs tags of 7 residues: seed 3 with extension 2 (the Species workflow) reaches them, or set 7 here.'
    }
  },
  tag_lengths: {
    section: 'Tagging, advanced',
    help: {
      text: 'Several seed lengths in one pass over the file, one per line, instead of tag length. Each length is tagged as if run on its own, with its own "Tags per spectrum" limit, and a spectrum\'s rows come in order of length. A tag that several lengths find is kept once, from the length that scores it best.',
      tip: 'Cannot be combined with the entrapment database.'
    }
  },
  fragment_tolerance: {
    // Its declared minimum (1e-9) stands for "greater than 0"; it carries its
    // unit inside its field.
    section: 'Common',
    label: 'Fragment tolerance',
    unit: 'fragment_tolerance_unit',
    positive: true,
    help: {
      text: 'How far a peak may lie from the mass FASTag expects and still count. The unit beside the number is ppm (parts per million of the mass) or Da.',
      tip: 'Set it to match the instrument that measured the MS2: 20 ppm for Orbitrap, Astral and TOF data; 0.3 Da for an ion trap. A ppm tolerance on ion-trap data gives almost no tags.'
    }
  },
  fragment_tolerance_unit: {
    section: 'Common',
    help: {
      text: 'The unit of the fragment tolerance: ppm or Da.',
      tip: 'ppm for high-resolution MS2, Da for an ion trap. With Da, the Digest tab makes no protease call.'
    }
  },
  gaps: {
    section: 'Tagging, advanced',
    help: {
      text: 'With 1, a tag may cross one missing peak: two peaks whose distance is the mass of two residues are joined, and both residue orders are written as separate tags. 0 turns this off.',
      tip: 'Leave it at 1; it lets a tag continue past a fragment that was not measured.'
    }
  },
  gap_penalty: {
    // -gaps 0 means no gapped tags exist, so nothing can be penalised.
    section: 'Tagging, advanced',
    depends: [{ on: 'gaps', note: 'only applies when tags may cross a gap' }],
    help: {
      text: 'Gapped tags are ranked as if their E-value were this many times worse, because they claim a peak nobody saw. The printed E-value of a gapped tag includes this factor. It never removes a tag at the E-value cutoff, but it decides which tags fill the "Tags per spectrum" places.',
      tip: '100 is the default. 1 turns the penalty off.'
    }
  },
  extension: {
    section: 'Tagging',
    label: 'Extension',
    help: {
      text: 'After a seed is found, FASTag tries to read up to this many more residues at each end, and scores the longer tag again. 0 turns extension off; the maximum is 12.',
      tip: 'Raise it for longer tags, for example 3 to let a seed of 3 grow to 9.',
      // The CLI line only repeats the text and the facts row (0 turns it off).
      cliCovered: true
    }
  },
  max_tags: {
    section: 'Tagging',
    label: 'Tags per spectrum',
    help: {
      text: 'How many tags are written per spectrum, best first; with several tag lengths, per length. 0 writes all of them.',
      tip: '50 is the default. Lower it for smaller files when only the best tags matter.'
    }
  },
  max_evalue: {
    section: 'Tagging',
    label: 'E-value cutoff',
    help: {
      text: 'Tags with an E-value above this are not written; for a gapped tag the value before the gap penalty counts, so its printed E-value can be up to this times the gap penalty. 0 turns the cutoff off.',
      tip: '20 is the default. Lower it, for example to 1, to keep only the stronger tags.'
    }
  },
  diversity: {
    section: 'Tagging, advanced',
    override: {
      description:
        'When a spectrum has more candidate tags than max_tags allows, prefer tags that read different peaks over near-copies of a tag already kept. The number of tags kept stays the same.'
    },
    help: {
      text: 'When a spectrum has more tags than "Tags per spectrum" allows, prefer tags that read other peaks over near-copies of a tag already kept. The number of tags and the best tag stay the same.',
      tip: 'Try it for spectra that hold two peptides at once (common in TMT runs).'
    }
  },
  tmt_pseudo_filter: {
    section: 'Isobaric reporters',
    experimental: true,
    help: {
      text: 'Experimental TMT6/10 filter for tags whose terminal G or A step is consistent with label fragmentation. Terminal K alone never triggers rejection. Auto first checks a sample for both N-terminal and lysine TMT evidence and abstains on conflicting label evidence. Off is the default; on is for known TMT6/10 input.'
    }
  },
  tmt_reporter_filter: {
    section: 'Isobaric reporters',
    experimental: true,
    help: {
      text: 'Also reject b/y tags whose low end is a singly charged TMT6/10 reporter ion. Needs the TMT pseudo-tag filter on, or auto when auto detects TMT labelling.',
      cliCovered: true
    }
  },

  // ---- Sequence matching
  fasta: {
    section: 'Keep only tags found in a database',
    label: 'Filter database',
    help: {
      text: 'A protein file (FASTA). Only tags that occur in these sequences are written (and, with an entrapment database, the entrapment-only matches, marked efwd/erev). I and L count as the same, tags are also tried reversed, and some residue pairs may stand in for a residue of the same mass.',
      tip: 'Very short tags occur in almost any protein by chance, so FASTag sets a minimum length from the size of the file: about 4 for one protein, 7 or 8 for a proteome. Set extension so that tag length + 2 × extension reaches it, or the run is refused. The log shows how many matches chance alone would give.'
    }
  },
  entrapment_fasta: {
    section: 'Keep only tags found in a database',
    depends: [{ on: 'fasta', note: 'the entrapment database is only searched together with fasta' }],
    help: {
      text: 'A second protein file from organisms the sample cannot contain. Matches to it estimate how often a tag matches the database by chance, written as a q_db column. Needs a sequence database.',
      tip: 'Use a distant proteome, for example archaea for a human sample. Cannot be combined with species detection or with several tag lengths.'
    }
  },
  orientation: {
    // Read by the fasta filter AND by reconciliation (FASTag.cpp: TagReconciler
    // takes the orientation, the proteome index the isobaric tolerance).
    section: 'Tagging, advanced',
    depends: [TAGS_ON_DB],
    override: {
      description:
        'Match tags as written, or also reversed, against the protein database. Tags are written N- to C-terminal, so tags read from the other ion series match only reversed.'
    },
    help: {
      text: 'Whether a tag is matched only as written, or also reversed. Tags are written N- to C-terminal as if read from y ions; a tag read from b ions matches only reversed.',
      tip: 'Keep "both" unless you know the tags come from one ion series.'
    }
  },
  isobaric_tolerance: {
    section: 'Tagging, advanced',
    depends: [TAGS_ON_DB],
    help: {
      text: 'When tags are matched against or placed on a protein database, a residue may stand for a pair of residues of the same mass within this tolerance (for example N for GG). 0 asks for exact sequences.',
      tip: '0.04 Da is the default.'
    }
  },
  // ---- Resolved tags (-resolved_out, -tag_graph_out: the Spectrum tab)
  resolve_score: {
    section: 'Resolved tags, advanced',
    label: 'Ranking',
    help: {
      text: "How the resolved tags of a spectrum are ranked, the tags merged on its peaks that the Spectrum tab shows under All tags. cstar adds, for each step a chain gains, the step's C* log-odds of being right (its peaks, mass error, rival steps and the support of the tags) less the step threshold, and ranks first the best resolved tag that holds no peak together with its own complement; steplogodds is the same with the simpler 1.15 step model and without that rule; evidence sums the E-value evidence of a resolved tag's tags; anchor puts the resolved tag of the best single tag first and ranks the rest by steplogodds.",
      tip: 'Keep cstar, the default: it won the preregistered held-out test, at 20 ppm and at 0.5 Da.'
    }
  },
  resolve_threshold: {
    section: 'Resolved tags, advanced',
    label: 'Step threshold',
    depends: [{ on: 'resolve_score', note: 'the evidence ranking uses no step threshold', when: { resolve_score: { isNot: ['evidence'] } } }],
    help: {
      text: 'The log-odds a step must exceed to lengthen a resolved tag, under the cstar, steplogodds and anchor rankings. Higher keeps resolved tags shorter and surer.',
      tip: '3, the default, is the threshold the held-out tests adopted.'
    }
  },
  resolve_max_evalue: {
    section: 'Resolved tags, advanced',
    label: 'Largest E-value merged',
    help: {
      text: 'Only tags with an E-value up to this are merged into resolved tags; the tags table itself is not filtered by it.',
      tip: '1 is the default. Raise it to let weaker tags lengthen resolved tags.'
    }
  },
  resolve_join: {
    section: 'Resolved tags, advanced',
    label: 'Join tags that touch',
    help: {
      text: 'Also join two tags that only meet at a shared peak, without a step in common, into one resolved tag.',
      tip: 'Off by default: a join at one peak is weaker evidence than a shared step.'
    }
  },
  min_filter_length: {
    section: 'Keep only tags found in a database',
    depends: [{ on: 'fasta', note: 'only affects matching against a sequence database' }],
    help: {
      text: 'Tags shorter than this are not matched against the sequence database. 0 lets FASTag choose a length from the size of the database, where chance matches become rare.',
      tip: 'Leave it at 0 unless the chance table in the log says otherwise.'
    }
  },

  // ---- Species detection
  species: {
    section: 'Species',
    label: 'Species report',
    help: {
      text: 'Work out which organisms the tags come from, using the species reference index bundled with FASTag. The result appears in the Species tab and in a report beside the tags.',
      tip: 'Tags must reach 7 residues: tag length + 2 × extension. The Species and Characterize workflows use extension 2 (seed 3 + 2 × 2), the setting validated in the paper; tag length 7 also works. Subsample a large run (fraction 0.1) for a fast answer.'
    }
  },
  species_rank: {
    // The CLI accepts any rank and reports nothing for one the bundled taxonomy
    // lacks, so the list holds only ranks its nodes.dmp has: NCBI names the top
    // rank `domain` there, and `superkingdom` gives an empty report.
    section: 'Species',
    label: 'Report rank',
    choices: ['species', 'genus', 'family', 'order', 'class', 'phylum', 'kingdom', 'domain'],
    depends: [SPECIES_OFF],
    help: {
      text: 'The level of the taxonomy at which organisms are reported: genus, family, and so on.',
      tip: 'genus is the default and the finest level the reference supports; species names are not reliable.'
    }
  },
  species_evidence: {
    section: 'Species, advanced',
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
    section: 'Species, advanced',
    depends: [SPECIES_OFF],
    help: {
      text: 'Tags shorter than this are not used for species detection. Values below the index length (7 for the bundled index) use that length.',
      tip: 'Leave it at 0.'
    }
  },
  species_use_gapped: {
    // Two masters: a gapped tag has to exist before it can be let into the index.
    section: 'Species, advanced',
    depends: [SPECIES_OFF, { on: 'gaps', note: 'no gapped tags are produced' }],
    help: {
      text: 'Let gapped tags count as species evidence. Off by default, because the two residues across a gap are inferred, not seen, and an exact lookup cannot tell the difference.',
      tip: 'Leave it off: gapped tags pushed the true genus far down on a public test run.'
    }
  },
  species_deconvolve: {
    section: 'Species, advanced',
    depends: [SPECIES_OFF],
    help: {
      text: 'Subtract the evidence an organism collects only because it shares protein sequence with a stronger one. Adds an Adjusted column to the Species tab.',
      tip: 'Try it on high-resolution data when close relatives are in the reference. Leave it off for ion-trap data and when rare organisms matter: it can remove real ones.'
    }
  },
  species_max_kmer_share: {
    section: 'Species, advanced',
    label: 'Maximum taxon share of a k-mer',
    depends: [SPECIES_OFF],
    help: {
      text: 'Ignore protein pieces found in more than this share of the organisms in the reference, since they cannot tell organisms apart. 1 keeps all.',
      tip: 'Leave it at 1; on test data it changed nothing.'
    }
  },
  species_min_margin: {
    section: 'Species, advanced',
    label: 'Minimum lead over runner-up taxon',
    depends: [SPECIES_OFF],
    help: {
      text: 'Ignore a tag unless its best organisms hold a clearly larger share of its pieces than the next organism, by at least this margin. 0 keeps all.',
      tip: 'Leave it at 0; on test data it changed nothing.'
    }
  },
  species_out: {
    section: 'Species',
    depends: [SPECIES_OFF],
    help: {
      text: 'Where the species report is written. Empty: beside the tags file, named <name>.tags.species.tsv.'
    }
  },
  taxdb: {
    section: 'Taxonomy',
    label: 'Species reference index',
    depends: [SPECIES_OFF],
    override: { description: 'Species reference index. Default: the one bundled with FASTag.' },
    help: {
      text: 'A species reference index of your own (built with buildtaxdb). Empty: the index bundled with FASTag.',
      tip: 'Give it together with both taxonomy files, or leave all three empty.'
    }
  },
  taxonomy_nodes: {
    section: 'Taxonomy',
    depends: [SPECIES_OFF],
    help: {
      text: 'The NCBI taxonomy tree (nodes.dmp) that goes with your own index. Empty: the bundled one.',
      tip: 'Give all three of index, nodes and names, or none.'
    }
  },
  taxonomy_names: {
    section: 'Taxonomy',
    depends: [SPECIES_OFF],
    help: {
      text: 'The NCBI taxonomy names (names.dmp) that go with your own index. Empty: the bundled one.',
      tip: 'Give all three of index, nodes and names, or none.'
    }
  },

  // ---- Glycopeptides
  glyco: {
    section: 'Glycopeptides',
    label: 'Oxonium flagging',
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
      text: 'A table of protease models of your own, replacing the shipped ones (Trypsin, Lys-C, Arg-C, Glu-C, Chymotrypsin, Asp-N, Lys-N and unspecific). Its columns: model, class, end, residue, freq.',
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
    section: 'Placement on the database',
    label: 'Tag placements',
    help: {
      text: 'Place each tag in the peptides of a protein database, using the masses on either side of it, and write one row per placement. When one side does not fit, the leftover mass is written with a guess at what it could be.',
      tip: 'Needs a protein database: the placement database, or else the filter database. The rows are candidates, not identifications. Placement uses tryptic peptides (cut after K and R, with up to 1 missed cleavage by default) whatever the protease call says, so for other proteases the placements and mass gaps are incomplete.'
    }
  },
  recon_fasta: {
    section: 'Placement on the database',
    label: 'Protein database',
    depends: [DB_UNUSED],
    help: {
      text: 'The protein database tags are placed on. Empty: the database of Keep only tags found in a database is used.',
      tip: 'With a database here and none under Keep only tags found in a database (Advanced), every tag is placed, not only those that match a filter database.'
    }
  },
  recon_missed_cleavages: {
    section: 'Placement on the database',
    label: 'Missed cleavages',
    depends: [DB_UNUSED],
    help: {
      text: 'How many skipped trypsin cleavage sites a database peptide may contain, at most 10. With Sage or Comet the same number goes into the search-engine configuration.',
      tip: 'FASTag uses 1 by default. Database reduction sets 2 (the shortlist recipe), as FASTag does for MSFragger with trypsin.'
    }
  },
  recon_min_length: {
    section: 'Placement, advanced',
    label: 'Shortest tag placed',
    depends: [DB_UNUSED],
    help: {
      text: 'Tags shorter than this are not placed. 0 lets FASTag choose the length at which chance matches fall below 5%.',
      tip: 'FASTag uses 0 by default. Database reduction sets 6 (the shortlist recipe), as FASTag does for MSFragger with trypsin; keep 6 there.'
    }
  },
  recon_localize: {
    section: 'Placement, advanced',
    label: 'Localize mass gaps',
    depends: [RECON_OFF],
    help: {
      text: 'Try to pin each leftover mass to one residue, by the fragment peaks it would shift. Adds the columns loc_site, loc_score and loc_ties.'
    }
  },
  delta_out: {
    section: 'Mass-shift survey',
    label: 'Mass-shift table',
    depends: [{ on: 'recon_out', note: 'the histogram is built from the placements' }],
    help: {
      text: 'Write a histogram of the leftover masses, one count per spectrum.',
      tip: 'Read it as candidates: no peak here is an identified modification.'
    }
  },
  recon_id_out: {
    section: 'Placement on the database',
    label: 'Placements as identifications',
    depends: [{ on: 'recon_out', note: 'it writes the placements as identifications' }],
    help: {
      text: 'Write the placements as identifications in idXML, mzIdentML or mzTab, for tools that read those formats. The file extension chooses the format: .idXML, .mzid or .mzTab (.mzIdentML is not accepted).',
      tip: 'These are not filtered by a false discovery rate.'
    }
  },
  massgap_out: {
    section: 'Mass-shift survey',
    label: 'Mass-gap report',
    depends: [{ on: 'recon_out', note: 'the mass gaps come from the placements' }],
    help: {
      text: 'Write the mass-gap report: the leftover masses, cysteine alkylation counts, frequent gaps explained as combinations of known modifications, and SILAC labels among them. Shown in the Digest tab.',
      tip: 'To see the cysteine alkylation, run it without fixed modifications.'
    }
  },
  massgap_window: {
    section: 'Mass-gap report',
    label: 'Gap window (ppm runs)',
    depends: [RECON_OFF, MASSGAP_OFF],
    help: {
      text: 'How close a leftover mass must be to a modification mass, on runs with a ppm tolerance.',
      tip: '0.02 Da is the default.'
    }
  },
  massgap_window_da: {
    section: 'Mass-gap report',
    label: 'Gap window (Da runs)',
    depends: [RECON_OFF, MASSGAP_OFF],
    help: {
      text: 'The same window on runs with a Da tolerance.',
      tip: '0.5 Da is the default.'
    }
  },
  massgap_min_spectra: {
    section: 'Mass-gap report',
    depends: [RECON_OFF, MASSGAP_OFF],
    help: {
      text: 'How many spectra a mass-gap peak needs.',
      tip: '20 is the default; the share below can ask for more.'
    }
  },
  massgap_min_share: {
    section: 'Mass-gap report',
    depends: [RECON_OFF, MASSGAP_OFF],
    help: {
      text: 'The share of placed spectra a mass-gap peak needs.',
      tip: '0.005 is the default.'
    }
  },
  massgap_min_bin: {
    section: 'Mass-gap report',
    depends: [RECON_OFF, MASSGAP_OFF],
    help: {
      text: 'How many spectra a histogram row needs to take part in the peaks.',
      tip: '2 is the default.'
    }
  },
  massgap_max_mods: {
    section: 'Mass-gap report',
    depends: [RECON_OFF, MASSGAP_OFF],
    help: {
      text: 'How many modifications may be combined to explain one gap (1 to 4).',
      tip: '3 is the default.'
    }
  },
  massgap_top: {
    section: 'Mass-gap report',
    depends: [RECON_OFF, MASSGAP_OFF],
    help: {
      text: 'How many modifications are listed as the most frequent.',
      tip: '5 is the default.'
    }
  },
  massgap_silac_share: {
    section: 'Mass-gap report',
    label: 'SILAC: minimum share of shifted spectra',
    depends: [RECON_OFF, MASSGAP_OFF],
    help: {
      text: 'The share of shifted spectra a SILAC label needs to count; a SILAC call needs two of Lys4, Arg6, Lys8 and Arg10 to reach it.',
      tip: '0.08 is the default.'
    }
  },
  massgap_silac_min: {
    section: 'Mass-gap report',
    label: 'SILAC: minimum shifted spectra',
    depends: [RECON_OFF, MASSGAP_OFF],
    help: {
      text: 'How many shifted spectra a SILAC call needs.',
      tip: '500 is the default.'
    }
  },

  // ---- Modifications
  fixed_modifications: {
    section: 'Common',
    label: 'Fixed modifications',
    help: {
      text: "Modifications present on every residue of a kind, by their OpenMS (Unimod) name, one per line. They change that residue's mass and are not written in the tag.",
      tip: 'The default is Carbamidomethyl (C), for iodoacetamide alkylation. For a TMT sample add, for example, TMT6plex (K) and TMT6plex (N-term). A terminal one (N-term) appears in the mass-gap report as a peak at its mass.'
    }
  },
  variable_modifications: {
    section: 'Modifications',
    label: 'Variable modifications',
    help: {
      text: 'Modifications that may or may not be present, one per line. A modified residue is written in the tag as X[Name], for example S[Phospho].',
      tip: 'Each one adds candidate masses, so add only those you expect.'
    }
  },

  // ---- Output
  proforma: {
    section: 'Tag columns and files',
    label: 'ProForma column',
    help: {
      text: 'Add a column with each tag in ProForma 2.0 notation, a standard way to write peptides that other tools can read. I and L are written as J.'
    }
  },
  res_conf: {
    section: 'Tagging',
    label: 'Per-residue confidence',
    override: {
      description:
        'Add a res_conf column: a confidence from 0 to 100 for each residue, N- to C-terminal. De novo assembly tools can use it.'
    },
    help: {
      text: 'Add a column with a confidence from 0 to 100 for each residue of the tag. Tools that build full peptide sequences from tags can use it.'
    }
  },
  usi_collection: {
    section: 'Tag columns and files',
    label: 'USI column (PRIDE accession)',
    help: {
      text: "Add a column naming each tag's spectrum as a Universal Spectrum Identifier (USI) in this dataset, for example PXD000001.",
      tip: 'Use USI000000 until the dataset has an accession.'
    }
  },
  out_spectra: {
    section: 'Tag columns and files',
    label: 'Spectra with tags',
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
    label: 'Threads',
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
  resolved_out: {
    hidden: 'derived: the app writes it beside the tags output when the CLI has it',
    help: {
      text: 'The resolved tags of each spectrum, best first: the tags merged on its peaks into longer reads. The app writes it beside the tags (run.resolved.tsv) and the Spectrum tab shows it under All tags.'
    }
  },
  tag_graph_out: {
    hidden: 'derived: the app writes it beside the tags output when the CLI has it',
    help: {
      text: "The merge graph of each spectrum: where its tags sit on the peaks and which continue which. The app writes it beside the tags (run.taggraph.tsv) and the Spectrum tab draws it as the merge graph."
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

  // ---- Options added since 1.12, each in its workflow group
  acquisition_probe_spectra: {
    section: 'Sampling and checks',
    depends: [{ on: 'acquisition_check', when: { acquisition_check: { isNot: ['off'] } }, say: 'DIA input set to refuse or warn', note: 'the DIA check is off' }],
    help: {
      text: 'How many MS2 spectra at the start of the run the acquisition check reads (metadata only).'
    }
  },
  alkylation_min_share: {
    section: 'Alkylation',
    depends: [ALKYLATION_OFF],
    help: {
      text: 'Which share of the counted spectra the alkylation call needs.'
    }
  },
  alkylation_min_spectra: {
    section: 'Alkylation',
    depends: [ALKYLATION_OFF],
    help: {
      text: 'How many spectra the alkylation call needs.'
    }
  },
  alkylation_out: {
    section: 'Alkylation',
    help: {
      text: 'Write a report of which reagent alkylated the cysteines, or none, from the placements of peptides with one cysteine. Not validated on held-out data.'
    }
  },
  alkylation_proteome: {
    section: 'Alkylation',
    // FASTag.cpp alkylation_only_db: read only when the alkylation report
    // is the one user of placements and no protein database is given;
    // otherwise the CLI logs "-alkylation_proteome is ignored".
    depends: [
      { on: 'alkylation_out', note: 'only the alkylation report uses it' },
      {
        on: ['recon_fasta', 'recon_out', 'shortlist_out', 'fasta_out', 'search_config_out'],
        replaced: true,
        say: 'a protein database for the placements or the shortlist',
        note: 'the alkylation report places on the Protein database, or on the Filter database when no Protein database is set'
      }
    ],
    help: {
      text: 'The database the alkylation report uses when no placement database is given: auto (the human proteome), human, mouse, yeast or ecoli for the UniProt reference proteomes shipped with FASTag (reviewed entries; the release is in the report), or a FASTA file (.gz allowed). Tags place on the shipped proteomes from 8 residues (human, mouse) or 7 (yeast, E. coli) (or Shortest tag placed, when set above 0), so tag length + 2 × Extension must reach that: at tag length 3, Extension 3 for human or mouse, 2 for yeast or E. coli; otherwise no tag places and there is no call (reason tags_too_short). A FASTA file, here or as Protein database, is indexed with a minimum length that grows with its size (8 for a human-sized one, 4 for a few proteins). Shortest tag placed sets that length; it is in Advanced, group “Placement, advanced”, which is under Other analyses in every workflow but Mass-shift survey. Extension is not raised for a FASTA file, and a run on it that places nothing gives no tags_too_short reason.'
    }
  },
  alkylation_tags_out: {
    section: 'Alkylation',
    experimental: true,
    help: {
      text: 'Write a report of which reagent alkylated the cysteines, or none, without a database: every spectrum is tagged a second time with unmodified and alkylated cysteine as alternatives, and the cysteine forms inside the best tags vote. Experimental: its held-out test passed at the margin (40 of 57 runs called, 37 right); unalkylated runs are rarely called. Use it with tag extension; without it few spectra vote.'
    }
  },
  alkylation_window: {
    section: 'Alkylation',
    depends: [{ on: 'alkylation_out', note: 'only the alkylation report uses it' }],
    help: {
      text: 'The mass window around each cysteine form for the alkylation report. 0 means 0.02 Da on a ppm run and 0.5 Da on a Da run.'
    }
  },
  census: {
    section: 'Identifiability',
    label: 'Identifiability table',
    help: {
      text: 'Also write a census: one row for every MS2 spectrum read, tagged or not, and a run summary. A status in the census is not a quality call.'
    }
  },
  census_ids: {
    section: 'Identifiability',
    label: 'Identifications',
    depends: [CENSUS_OFF],
    help: {
      text: 'Identifications of the same run (idXML or mzid) for the census: each spectrum is then marked identified, not identified or unknown. Needs q-values, unless Accept hits (Advanced) is threshold or all.'
    }
  },
  census_ids_fdr: {
    section: 'Identifiability',
    label: 'ID q-value',
    depends: [CENSUS_OFF, IDS_OFF, { on: 'census_ids_accept', when: { census_ids_accept: { is: ['qvalue'] } }, say: 'Accept hits set to q-value', note: 'only read when hits are accepted by q-value' }],
    help: {
      text: 'The q-value a target hit needs for its spectrum to count as identified in the census.'
    }
  },
  census_out: {
    section: 'Identifiability',
    depends: [CENSUS_OFF],
    help: {
      text: 'Where the per-spectrum census goes. By default next to the tags file, ending in .census.tsv.'
    }
  },
  census_summary_out: {
    section: 'Identifiability',
    depends: [CENSUS_OFF],
    help: {
      text: 'Where the census run summary goes. By default next to the tags file, ending in .census_summary.tsv.'
    }
  },
  delta_counts_out: {
    section: 'Mass-shift survey',
    experimental: true,
    depends: [DELTA_OFF],
    help: {
      text: 'An accounting of the mass-shift survey: how many MS2 spectra reach each step, with sum checks.'
    }
  },
  delta_group: {
    section: 'Mass-shift survey, advanced',
    experimental: true,
    depends: [DELTA_OFF],
    help: {
      text: 'How wide one row of the mass-shift survey may be, in Da: neighbouring bins within this distance of the most populated one form one row.'
    }
  },
  delta_isobar_tolerance: {
    section: 'Mass-shift survey, advanced',
    experimental: true,
    depends: [DELTA_OFF],
    help: {
      text: 'How close two explanations of a mass shift must be to be listed as exact isobars (oxidation and Ala to Ser, for example).'
    }
  },
  delta_isotope_flank: {
    section: 'Mass-shift survey, advanced',
    experimental: true,
    depends: [DELTA_OFF],
    help: {
      text: 'Which survey rows may be called an isotope error: only rows whose gaps mostly sit on the precursor-derived side, or any row.'
    }
  },
  delta_loc_min_evidence: {
    section: 'Mass-shift survey, advanced',
    experimental: true,
    depends: [DELTA_OFF],
    help: {
      text: 'How much more evidence the best site needs than the next one before a mass shift counts as localized by the fragments.'
    }
  },
  delta_loc_model: {
    section: 'Mass-shift survey, advanced',
    experimental: true,
    depends: [DELTA_OFF],
    help: {
      text: 'How the survey localizes a mass shift on the peptide: by every matched ion, by distinct peaks, or by distinct peaks without neutral-loss satellites (strict).'
    }
  },
  delta_loc_null: {
    section: 'Mass-shift survey, advanced',
    experimental: true,
    depends: [DELTA_OFF],
    help: {
      text: 'Repeat the localization on peaks moved by this many m/z units, to see how often a site is found by chance.'
    }
  },
  delta_name_tolerance: {
    section: 'Mass-shift survey, advanced',
    unit: 'delta_name_tolerance_unit',
    experimental: true,
    depends: [DELTA_OFF],
    help: {
      text: 'How close a mass shift must be to a Unimod or PSI-MOD entry to be named after it.'
    }
  },
  delta_name_tolerance_unit: {
    section: 'Mass-shift survey, advanced',
    experimental: true,
    help: {
      text: 'The unit of the naming tolerance: ppm of the median peptide mass, or Da.'
    }
  },
  delta_select: {
    section: 'Mass-shift survey, advanced',
    experimental: true,
    depends: [DELTA_OFF],
    help: {
      text: 'Which placement of a spectrum the survey counts: the one with the smallest shift of its best tag, or the one most of its tags agree on.'
    }
  },
  delta_spectra_out: {
    section: 'Mass-shift survey',
    experimental: true,
    depends: [DELTA_OFF],
    help: {
      text: 'One line per spectrum behind the mass-shift survey: the shift, its row, peptide, site and provenance, for comparison with a search engine.'
    }
  },
  qc_out: {
    section: 'Run QC',
    label: 'QC report',
    help: {
      text: 'A run QC report: spectra per MS level and analyser, resolution, precursor charges, isobaric reporters, tag yield and redundancy.'
    }
  },
  recon_sub_tolerance: {
    section: 'Placement, advanced',
    unit: 'recon_sub_tolerance_unit',
    experimental: true,
    depends: [RECON_OFF],
    help: {
      text: 'How close a leftover mass must be to an amino-acid substitution to be read as one.'
    }
  },
  recon_sub_tolerance_unit: {
    section: 'Placement, advanced',
    experimental: true,
    help: {
      text: 'The unit of the substitution tolerance: ppm of the flanking mass, or Da.'
    }
  },
  census_ids_accept: {
    section: 'Identifiability, advanced',
    depends: [CENSUS_OFF, IDS_OFF],
    help: {
      text: 'Which hits of the identification file mark a spectrum identified: those passing a q-value, those the file marks as passing its own threshold (Mascot), or every target hit.'
    }
  },
  census_ids_exact: {
    section: 'Identifiability, advanced',
    depends: [CENSUS_OFF, IDS_OFF],
    help: {
      text: 'Join the identifications one to one: exact spectrum ids only, and refuse a file that does not belong to this run.'
    }
  },
  census_score: {
    section: 'Identifiability',
    label: 'Identifiability score',
    depends: [CENSUS_OFF],
    help: {
      text: 'Add an identifiability score to the census: a ranking of the MS2 spectra by how likely a standard database search identifies them. Experimental: not validated on held-out data. Not a quality call.'
    }
  },
  census_sorted_out: {
    section: 'Identifiability',
    depends: [CENSUS_OFF, { on: 'census_score', note: 'the table is ordered by the identifiability score' }],
    help: {
      text: 'The census rows ordered by the identifiability score, highest first.'
    }
  },
  census_triage_evalue: {
    section: 'Identifiability',
    label: 'Triage E-value',
    depends: [CENSUS_OFF, IDS_OFF],
    help: {
      text: 'The E-value at or below which an unidentified spectrum with a tag is marked for a second look in the census. It is a threshold, not a quality call.'
    }
  },
  charge_infer_margin: {
    section: 'Charge and ions',
    depends: [CHARGES_TRIED],
    help: {
      text: 'By how much the supported charge must beat the next one to be tagged alone; when the two are closer, both are tagged.'
    }
  },
  charge_max: {
    section: 'Charge and ions',
    depends: [CHARGES_TRIED],
    help: {
      text: 'The highest charge tried for a precursor without a charge, when it is not tagged as 2+.'
    }
  },
  charge_min: {
    section: 'Charge and ions',
    depends: [CHARGES_TRIED],
    help: {
      text: 'The lowest charge tried for a precursor without a charge, when it is not tagged as 2+ (each possible charge, or the one its fragment pairs support best). 1 lets the best-supported choice test 1+ too.'
    }
  },
  check_header_charge: {
    section: 'Sampling and checks',
    experimental: true,
    help: {
      text: "Checks the precursor charge the file gives. It is checked against the isotope spacing of the precursor in the preceding MS1 scan and against its fragment pairs: off, warn (report disagreements only) or both (tag a disagreeing spectrum under the file's charge and under the charge the check found). Experimental."
    }
  },
  check_header_margin: {
    section: 'Sampling and checks',
    depends: [HEADER_CHECK_OFF],
    experimental: true,
    help: {
      text: 'By how much the supported charge must beat the given charge before the header charge check calls a disagreement.'
    }
  },
  check_header_out: {
    section: 'Sampling and checks',
    depends: [HEADER_CHECK_OFF],
    experimental: true,
    help: {
      text: 'Where the header charge check writes one row per spectrum with a given charge: the given charge, the supported charge, the evidence and the verdict.'
    }
  },
  complement_midp: {
    section: 'Complement pairs',
    help: {
      text: 'Score tags with no or one complement pair with the mid-p variant of the complement test.'
    }
  },
  complement_probe: {
    section: 'Complement pairs',
    experimental: true,
    help: {
      text: 'How many MS2 spectra the auto complement window is measured on (experimental).'
    }
  },
  complement_rule: {
    section: 'Complement pairs',
    help: {
      text: 'Which fragment pairs count as complements when tags are scored: pairs at the same charge (the default), pairs that share the precursor charge, or either.'
    }
  },
  complement_tol_factor: {
    section: 'Complement pairs',
    help: {
      text: 'Complement window in fragment tolerances. The factor on the fragment tolerance when the complement window follows it (unit fragment).'
    }
  },
  complement_tolerance: {
    section: 'Complement pairs',
    help: {
      text: 'The mass window, in Da, for a complement partner.'
    }
  },
  complement_tolerance_unit: {
    section: 'Complement pairs',
    help: {
      text: 'Whether the complement window is a fixed value in Da, follows the fragment tolerance, or is measured on the run from the complement pairs of confident tags (auto).',
      tip: 'Auto is validated: its third held-out test passed (+3.3 points of correct rank-1 tags on ion trap, not worse on timsTOF); the first, with an earlier estimator, failed, and the second was inconclusive.'
    }
  },
  digest_calibration: {
    section: 'Digest and labels',
    depends: [DIGEST_OFF],
    help: {
      text: 'A file that calibrates the confidence of the digest call. By default the shipped one.'
    }
  },
  digest_detection: {
    section: 'Digest and labels',
    depends: [DIGEST_OFF],
    help: {
      text: 'Apply per-instrument weights in the digest report, which also gives a call on timsTOF runs. Not validated on held-out data.'
    }
  },
  digest_flank2: {
    section: 'Digest and labels',
    depends: [DIGEST_OFF],
    help: {
      text: 'Let the digest report also use the two residues before each cut when the one-residue counts are too few. Not validated on held-out data.'
    }
  },
  digest_min_confidence: {
    section: 'Digest and labels',
    depends: [DIGEST_OFF],
    help: {
      text: 'Give no digest call when its calibrated confidence is below this value. 0 turns it off.'
    }
  },
  digest_quality: {
    section: 'Digest and labels',
    experimental: true,
    depends: [DIGEST_OFF],
    help: {
      text: 'Add missed-cleavage and non-specific-end measurements for one enzyme (or the call: auto) to the digest report. Experimental.'
    }
  },
  digest_models_version: {
    section: 'Digest and labels',
    // FASTag.cpp: a custom -digest_models file decides the model table, but
    // v2 still loads its calibration and writes the v2 rows (p_correct), so
    // the value is sent with a models file too.
    depends: [DIGEST_OFF],
    help: {
      text: 'Which protease models the digest report uses: the shipped ones (as in 1.11) or v2, which adds detection, LysargiNase and Asp-N (ammonium bicarbonate) rows and a pooled specificity. Version v2 is not validated on held-out data.',
      cliCovered: true,
      tip: "With a custom models file the file's models are used as given (the log says v2 is ignored for the table); v2 still loads the calibration and adds the p_correct rows."
    }
  },
  dump_spectrum: {
    hidden: 'spectrum dump for programs; prints JSON lines and exits',
    help: {
      text: 'Print the peaks FASTag tags in one spectrum and exit. It writes no output file and is for other programs.'
    }
  },
  fasta_out: {
    section: 'Shortlist',
    help: {
      text: 'Write a smaller FASTA with the proteins of the shortlist, for a database search. For Sage and Comet no decoys are added (the engine makes them); for MSFragger, FASTag appends reversed rev_ decoys. When it would hold no protein, it is not written and the run fails with exit code 13.'
    }
  },
  ion_series: {
    section: 'Charge and ions',
    // 1.14: ax (a/x ions) was removed; the CLI still accepts it and reads by.
    choices: ['by', 'cz', 'auto'],
    help: {
      text: 'Read the spectra as b/y ions (the default), as c/z ions of ETD or ECD, or choose per spectrum from its activation (auto). The a/x reading (ax) was removed in 1.14: it failed its held-out test.'
    }
  },
  ion_series_photo: { hidden: REMOVED_1_14, help: REMOVED_1_14_HELP },
  ion_series_hybrid: {
    section: 'Charge and ions',
    depends: [{ on: 'ion_series', when: { ion_series: { is: ['auto'] } }, say: 'Ion series set to auto', note: 'only read when the ion series follows each spectrum\'s activation' }],
    experimental: true,
    help: {
      text: 'Under ion series auto: read hybrid EThcD/ETciD spectra as b/y ions (the default) or tag them twice, as b/y and as c/z ions, and merge the rows (both). Experimental; passed its held-out test (5 projects: +43 points of identified spectra with a correct tag, 1.6x CPU time).'
    }
  },
  isotope_error: {
    section: 'Charge and ions',
    help: {
      text: 'Also consider precursor masses lowered by one or more isotope spacings (1.00336 Da each), for precursors picked on the wrong isotope peak. Needs a fragment tolerance below 0.05 Da.'
    }
  },
  pick_profile: {
    section: 'Peaks',
    // 1.14: auto (centroid mzML too) was removed; the CLI still accepts it and reads legacy.
    choices: ['legacy', 'off'],
    help: {
      text: 'Centroid profile MS2 spectra before tagging. By default only mzPeak input is centroided (as in 1.11); off never centroids. Spectra that are already centroided are never picked again. The auto mode, which also centroided mzML, was removed in 1.14: it failed its held-out test.'
    }
  },
  pick_unknown_type: { hidden: REMOVED_1_14, help: REMOVED_1_14_HELP },
  probe_input: {
    hidden: 'metadata probe for programs; prints JSON lines and exits',
    help: {
      text: 'Print what a spectra file contains (instrument, activation, spectrum counts, profile or centroided) and exit. It writes no output file and is for other programs.'
    }
  },
  search_config_out: {
    section: 'Shortlist',
    help: {
      text: 'Write search-engine settings (Sage, Comet, or MSFragger, experimental) for the smaller FASTA.'
    }
  },
  search_config_template: {
    section: 'Search configuration',
    depends: [SEARCH_OFF, { on: 'search_engine', when: { search_engine: { is: ['comet'] } }, say: 'Search engine set to Comet', note: 'a Sage or MSFragger configuration is written complete' }],
    help: {
      text: 'For Comet only: your comet.params (comet -p writes one). The written settings are merged into it, giving a complete file; without it FASTag writes a fragment of the managed keys to merge by hand.'
    }
  },
  search_decoy_prefix: {
    section: 'Search configuration',
    depends: [SEARCH_OFF],
    help: {
      text: 'The decoy prefix the search engine uses. Empty means the engine default.'
    }
  },
  search_engine: {
    section: 'Shortlist',
    label: 'Search engine',
    depends: [SEARCH_OFF],
    help: {
      text: 'The search engine the settings are written for: Sage, Comet or MSFragger (experimental; needs decoys in the database). The shortlist recipe (gapped placements, E-value 10, shortest placed tag 6, 2 missed cleavages) is not validated: with MSFragger it passed the second held-out test and failed the third. With MSFragger and trypsin FASTag applies it to every setting you leave unchanged; the Database reduction workflow sets it for every engine, Sage and Comet included. MSFragger mass calibration (calibrate_mass 2) failed its held-out test and is not exported.'
    }
  },
  search_isotope_errors: {
    section: 'Search configuration',
    unset: { value: '-1', placeholder: 'engine default' },
    depends: [SEARCH_OFF],
    help: {
      text: 'How many precursor isotope errors the search engine should consider; -1 leaves it to the engine: none for Sage and Comet, up to 3 for MSFragger.'
    }
  },
  search_missed_cleavages: {
    section: 'Search configuration',
    unset: { value: '-1', placeholder: 'engine default' },
    depends: [SEARCH_OFF],
    help: {
      text: 'How many missed cleavages the search engine should allow; -1 leaves it to the engine: the tag placement setting for Sage and Comet, 2 for MSFragger with trypsin.'
    }
  },
  search_nterm_acetyl: {
    section: 'Search configuration',
    depends: [SEARCH_OFF],
    help: {
      text: 'Whether protein N-terminal acetylation is written into the search settings as a variable modification; "engine" means yes for MSFragger and no for Sage and Comet.'
    }
  },
  search_precursor_tolerance: {
    section: 'Search configuration',
    unset: { value: '-1', placeholder: 'engine default' },
    unit: 'search_precursor_unit',
    depends: [SEARCH_OFF],
    help: {
      text: 'The precursor tolerance written into the search settings; -1 leaves it to the engine: 10, or 20 ppm for MSFragger.'
    }
  },
  search_precursor_unit: {
    section: 'Search configuration',
    help: {
      text: 'The unit of that precursor tolerance.'
    }
  },
  search_shifts: { hidden: REMOVED_1_14, help: REMOVED_1_14_HELP },
  search_shifts_out: { hidden: REMOVED_1_14, help: REMOVED_1_14_HELP },
  shift_expand_sites: { hidden: REMOVED_1_14, help: REMOVED_1_14_HELP },
  shift_max_offsets: { hidden: REMOVED_1_14, help: REMOVED_1_14_HELP },
  shift_max_variable: { hidden: REMOVED_1_14, help: REMOVED_1_14_HELP },
  shift_site_min_count: { hidden: REMOVED_1_14, help: REMOVED_1_14_HELP },
  shift_site_min_ions: { hidden: REMOVED_1_14, help: REMOVED_1_14_HELP },
  shift_site_min_share: { hidden: REMOVED_1_14, help: REMOVED_1_14_HELP },
  shortlist_background: {
    section: 'Shortlist',
    label: 'Background proteins',
    depends: [{ on: 'fasta_out', note: 'only the reduced FASTA uses it' }],
    help: {
      text: 'Proteins that are always added to the smaller FASTA, such as the host proteome or contaminants.'
    }
  },
  shortlist_decoy_affix: {
    section: 'Shortlist, advanced',
    depends: [SHORTLIST_READ],
    help: {
      text: 'The name prefixes and suffixes that mark a decoy entry; decoys never enter the shortlist.'
    }
  },
  shortlist_force: {
    section: 'Shortlist, advanced',
    // FASTag.cpp: read for the reduced FASTA and the search configuration only.
    depends: [{ on: ['fasta_out', 'search_config_out'], note: 'only the reduced FASTA and the search configuration use it' }],
    help: {
      text: 'Write the smaller FASTA and the search settings even when the protease of the run does not fit tryptic placement.'
    }
  },
  tolerance_by_analyzer: {
    section: 'Fragment tolerance by analyzer',
    label: 'Tolerance by analyzer',
    help: {
      text: 'Tags each MS2 spectrum with the tolerance of its analyzer: ion-trap spectra with the ion-trap tolerance (0.5 Da) and a complement window measured on them, Orbitrap and TOF spectra with the fragment tolerance. Off tags every spectrum with the fragment tolerance, as before 1.15.5.'
    }
  },
  fragment_tolerance_itms: {
    section: 'Fragment tolerance by analyzer',
    label: 'Ion-trap fragment tolerance (Da)',
    depends: [{ on: 'tolerance_by_analyzer', when: { tolerance_by_analyzer: { is: ['on'] } }, say: 'Tolerance by analyzer on', note: 'with it off every spectrum uses the fragment tolerance' }],
    help: {
      text: 'Fragment tolerance (Da) of ion-trap MS2 spectra when tolerances follow the analyzer.'
    }
  },
  shortlist_defaults: {
    hidden: '1.15.4 command-line option, not in the form (CLI default applies: the shortlist recipe)',
    help: {
      text: 'Defaults of a tryptic shortlist run (shortlist, reduced FASTA or search configuration): recipe (the default) sets tag length 4, extension 6, gapped placement, E-value 10, 1 spectrum per protein, reconciliation length 6 and 2 missed cleavages unless you set them; plain keeps every option at its own default, as before 1.15.4.'
    }
  },
  shortlist_protease: {
    section: 'Shortlist',
    label: 'Protease',
    experimental: true,
    depends: [SHORTLIST_OFF],
    help: {
      text: 'The cleavage rule the shortlist places tags with: trypsin (as in 1.12), the protease the run calls (auto), a named protease, or none (unspecific). Experimental; auto passed its held-out test (9 runs, 5 proteases: median protein recall 0.25 against the full search, +0.12 over the trypsin shortlist); a named rule and unspecific have no held-out test. The Asp-N call of auto and its semi-specific export are not validated: their held-out test failed on one criterion only, an empty trypsin comparison export (+0.37 protein recall over the trypsin shortlist, Asp-N called in 11 of 12 Asp-N runs). It has no second test: PRIDE has no unused eligible Asp-N project. With a protease other than trypsin only exact placements count; gapped placements are ignored.'
    }
  },
  shortlist_specificity: {
    section: 'Shortlist, advanced',
    depends: [SHORTLIST_OFF, NOT_TRYPSIN],
    // '' (Automatic) is not sent: the CLI then chooses (full, but semi for a
    // run Auto calls Asp-N). An explicit full is sent, and the CLI keeps it.
    choices: ['', 'full', 'semi', 'none'],
    override: { default: '' },
    help: {
      text: 'How many window ends must be cleavage sites of the protease rule: both (full), one (semi) or none. Automatic is full, except that a run the Auto protease calls Asp-N is placed and exported semi-specific (not validated: its held-out test failed, see Protease). Choose Full to keep full specificity for such a run too.'
    }
  },
  shortlist_gapped: {
    section: 'Shortlist, advanced',
    depends: [SHORTLIST_READ, TRYPSIN_ONLY],
    help: {
      text: 'Let placements with one mismatched flank count for the shortlist. Only with trypsin: with another protease gapped placements are ignored.'
    }
  },
  shortlist_exact_only: { hidden: REMOVED_1_14, help: REMOVED_1_14_HELP },
  shortlist_max_evalue: {
    section: 'Shortlist, advanced',
    depends: [SHORTLIST_READ],
    help: {
      text: 'The E-value a tag needs for its placements to count for the shortlist. 10 by the shortlist recipe; for a metaproteome database use 100 (held-out test: 96% of the full-search peptides kept with 23% of an 870k-protein database).'
    }
  },
  shortlist_min_spectra: {
    section: 'Shortlist, advanced',
    depends: [SHORTLIST_READ],
    help: {
      text: 'How many spectra a protein needs to stay on the shortlist.'
    }
  },
  shortlist_out: {
    section: 'Shortlist',
    help: {
      text: 'Write a ranked list of the proteins the tags were placed on. It narrows a later database search; it is not an identification and has no FDR control.'
    }
  },
  shortlist_parsimony: {
    section: 'Shortlist, advanced',
    depends: [SHORTLIST_READ],
    help: {
      text: 'Whether proteins whose spectra a higher-ranked protein already has are dropped from the shortlist.'
    }
  },
  shortlist_top: {
    section: 'Shortlist, advanced',
    depends: [SHORTLIST_READ],
    help: {
      text: 'Keep at most this many proteins on the shortlist. 0 means no limit.'
    }
  },
  species_call: {
    section: 'Species',
    label: 'Presence call',
    experimental: true,
    depends: [SPECIES_OFF],
    // 1.14: explain was removed; the CLI still accepts it and reads none.
    choices: ['none', 'decoy'],
    help: {
      text: 'Call each taxon of the species report present, no call or not detected (experimental). Decoy compares its evidence with decoy tags; None only ranks the taxa. The explain call was removed in 1.14: it failed its held-out test.',
      tip: 'The decision settings are provisional. These calls and their decoy q-values are not calibrated error guarantees; not detected never proves biological absence.'
    }
  },
  species_call_decoys: {
    section: 'Species, advanced',
    depends: [SPECIES_OFF, CALL_OFF],
    help: {
      text: 'How many decoy tags are made for each tag when organisms are called.'
    }
  },
  species_call_min_units: {
    section: 'Species, advanced',
    depends: [SPECIES_OFF, CALL_OFF],
    help: {
      text: 'Fewer spectra with organism evidence than this give no call for the whole run.'
    }
  },
  species_call_params: {
    section: 'Species, advanced',
    depends: [SPECIES_OFF, CALL_OFF],
    help: {
      text: 'A file with the decision settings of the organism call. By default the one in the taxonomy folder.'
    }
  },
  species_orientation: {
    section: 'Species, advanced',
    depends: [SPECIES_OFF],
    help: {
      text: 'Look up each tag in the species index as written (the default) or also reversed. When reversed readings are used, the log p-value and q-value columns are NA.',
      tip: 'The optional decoy-based calls and decoy q-values remain experimental and uncalibrated.'
    }
  },
  species_reagents: { hidden: REMOVED_1_14, help: REMOVED_1_14_HELP },
  species_pi0: {
    section: 'Species, advanced',
    depends: [SPECIES_OFF, CALL_OFF],
    help: {
      text: 'The share of absent organisms assumed for the q-values of the organism call. 1 is the standard (Benjamini-Hochberg) correction; 0 estimates the share from the run (Storey).'
    }
  },
  unknown_charge: {
    section: 'Charge and ions',
    help: {
      text: 'How a precursor whose charge the file does not give is tagged: as 2+ (the default, as before 1.12), at each possible charge, or at the charge its fragment pairs support best. A charge given in the file is never replaced (the experimental header charge check in both mode can add a second charge).'
    }
  },

  // ---- FASTag 1.13 experimental options
  label_call_min_tags: { hidden: REMOVED_1_14, help: REMOVED_1_14_HELP },

  // ---- Not in the form: removed in 1.14 (see REMOVED_1_14)
  label_discovery_out: { hidden: REMOVED_1_14, help: REMOVED_1_14_HELP },
  label_discovery_depth: { hidden: REMOVED_1_14, help: REMOVED_1_14_HELP },
  label_discovery_max_flank: { hidden: REMOVED_1_14, help: REMOVED_1_14_HELP },
  label_discovery_min_share: { hidden: REMOVED_1_14, help: REMOVED_1_14_HELP },
  label_discovery_min_spectra: { hidden: REMOVED_1_14, help: REMOVED_1_14_HELP },
  label_discovery_unimod_top: { hidden: REMOVED_1_14, help: REMOVED_1_14_HELP },
  label_discovery_window_c: { hidden: REMOVED_1_14, help: REMOVED_1_14_HELP },
  label_discovery_window_n: { hidden: REMOVED_1_14, help: REMOVED_1_14_HELP }
}
