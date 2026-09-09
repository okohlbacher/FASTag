// Where each CLI parameter appears in the UI, and what it depends on.
//
// The manifest (params.generated.json) says what the parameters ARE; this says
// how they are PRESENTED. They are deliberately separate: the manifest is
// regenerated from the tool and must never be hand-edited, while this layout is
// a human judgement about which knobs belong together and which are inert
// unless another one is set.
//
// TOPP's own advanced="true" flag is not usable for this split -- it marks only
// TOPPBase boilerplate (log, debug, force, test, ...) and leaves every FASTag
// parameter, including deep internals like gap_penalty, marked non-advanced.

import manifest from './params.generated.json'

export interface ParamSpec {
  name: string
  type: string
  default: string | string[]
  description: string
  required: boolean
  toppAdvanced: boolean
  min?: number
  max?: number
  choices?: string[]
}

// UI overlays: the manifest is a faithful dump of the tool, but a few string
// params have a known small set of valid values the tool does not itself
// declare as restrictions. Turning them into a dropdown keeps the user from
// typing a rank the rollup can't resolve.
const CHOICES: Record<string, string[]> = {
  species_rank: ['species', 'genus', 'family', 'order', 'class', 'phylum', 'kingdom', 'superkingdom'],
  orientation: ['both', 'forward', 'reverse']
}

// TOPPBase registers -threads itself with default 1, and FASTag applies its
// real default -- 0, half the logical cores -- to argv in main(), because
// TOPPBase offers no hook to change a common option. The manifest is a dump of
// --help, so it carries TOPPBase's number and text; this is the tool's.
const OVERRIDES: Record<string, Partial<ParamSpec>> = {
  threads: {
    default: '0',
    description: 'Threads to use. 0 (the default) means half the logical cores.'
  }
}

export const PARAMS: ParamSpec[] = (manifest.params as ParamSpec[]).map((p) => ({
  ...p,
  ...(OVERRIDES[p.name] ?? {}),
  ...(CHOICES[p.name] ? { choices: CHOICES[p.name] } : {})
}))
export const PARAM_BY_NAME = new Map(PARAMS.map((p) => [p.name, p]))

export interface Section {
  title: string
  /// One line under the heading: what this stage of the run does. A user who
  /// does not already know what "reconciliation" means needs it here, not in a
  /// tooltip on the fourth field.
  blurb: string
  /// Open on first launch. Only the knobs of a routine run are.
  open: boolean
  /// The switch that makes the rest of the section do anything, if there is
  /// one. Rendered first, and the section header shows whether it is on.
  master?: string
  params: string[]
}

/// The form, in the order the run happens: what is read, what is tagged, what
/// the tags are then compared against, and what comes out.
///
/// One flat list of sections replaced a "core knobs + Advanced accordion of
/// groups" split. The old shape put `species` next to `tag_length` and its own
/// `taxdb` two disclosure levels away, which is the opposite of grouping by
/// content -- and it forced a judgement ("is this advanced?") that nothing in
/// the tool actually supports.
export const SECTIONS: Section[] = [
  {
    title: 'Spectra',
    blurb: 'Which spectra are read, and which peaks survive preprocessing.',
    open: false,
    params: [
      'no_deisotope',
      'max_peaks',
      'peaks_per_window',
      'subsample_spectra',
      'subsample_fraction',
      'subsample_seed',
      'mzpeak_read_memory'
    ]
  },
  {
    title: 'Tagging',
    blurb: 'The tags themselves: how long, how tolerant, how many per spectrum.',
    open: true,
    params: [
      'tag_length',
      'fragment_tolerance',
      'fragment_tolerance_unit',
      'gaps',
      'gap_penalty',
      'extension',
      'max_tags',
      'max_evalue',
      'diversity'
    ]
  },
  {
    title: 'Sequence matching',
    blurb: 'Keep only tags that occur in sequences you supply.',
    open: false,
    master: 'fasta',
    params: ['fasta', 'entrapment_fasta', 'orientation', 'isobaric_tolerance', 'min_filter_length']
  },
  {
    title: 'Species detection',
    blurb: 'Infer which taxa are present from the tags, against the bundled index.',
    open: false,
    master: 'species',
    params: [
      'species',
      'species_rank',
      'species_min_len',
      'species_use_gapped',
      'species_deconvolve',
      'species_max_kmer_share',
      'species_min_margin',
      'species_out',
      'taxdb',
      'taxonomy_nodes',
      'taxonomy_names'
    ]
  },
  {
    title: 'Glycopeptides',
    blurb: 'Flag spectra carrying oxonium ions.',
    open: false,
    master: 'glyco',
    params: ['glyco', 'glyco_min_fraction', 'glyco_out']
  },
  {
    title: 'Reconciliation',
    blurb: 'Place tags in database peptides and report the mass left over.',
    open: false,
    master: 'recon_out',
    params: ['recon_out', 'recon_fasta', 'recon_missed_cleavages', 'recon_min_length', 'delta_out']
  },
  {
    title: 'Modifications',
    blurb: 'Residue masses used when spelling and matching tags.',
    open: false,
    params: ['fixed_modifications', 'variable_modifications']
  },
  {
    title: 'Output',
    blurb: 'Extra columns and extra files beside the tag list.',
    open: false,
    params: ['proforma', 'res_conf', 'out_spectra']
  },
  {
    title: 'Performance',
    blurb: '',
    open: false,
    params: ['threads']
  }
]

/// Parameters that do nothing unless another parameter is set.
///
/// This is the tool's real structure and the UI used to hide it completely: a
/// user could set `gap_penalty` with `gaps` at 0, or fill in three taxonomy
/// paths with `-species` off, and the run would silently ignore all of it. The
/// dependency is stated in each option's own help text -- it just never reached
/// the form.
export interface Dependency {
  /// The parameter that has to be set.
  on: string
  /// Shown in place of the field's help when unmet. Phrased as the consequence,
  /// not the rule: a user wants to know what would happen, not what to obey.
  note: string
}

export const DEPENDS: Record<string, Dependency[]> = {
  // -gaps 0 means no gapped tags exist, so nothing can be penalised.
  gap_penalty: [{ on: 'gaps', note: 'only applies when tags may cross a gap' }],

  // Every one of these is read only when the fasta filter runs.
  entrapment_fasta: [{ on: 'fasta', note: 'the entrapment database is scored against the same filter' }],
  orientation: [{ on: 'fasta', note: 'only affects matching against a sequence database' }],
  isobaric_tolerance: [{ on: 'fasta', note: 'only affects matching against a sequence database' }],
  min_filter_length: [{ on: 'fasta', note: 'only affects matching against a sequence database' }],

  species_rank: [{ on: 'species', note: 'species detection is off' }],
  species_min_len: [{ on: 'species', note: 'species detection is off' }],
  species_deconvolve: [{ on: 'species', note: 'species detection is off' }],
  species_max_kmer_share: [{ on: 'species', note: 'species detection is off' }],
  species_min_margin: [{ on: 'species', note: 'species detection is off' }],
  species_out: [{ on: 'species', note: 'species detection is off' }],
  taxdb: [{ on: 'species', note: 'species detection is off' }],
  taxonomy_nodes: [{ on: 'species', note: 'species detection is off' }],
  taxonomy_names: [{ on: 'species', note: 'species detection is off' }],
  // Two masters: a gapped tag has to exist before it can be let into the index.
  species_use_gapped: [
    { on: 'species', note: 'species detection is off' },
    { on: 'gaps', note: 'no gapped tags are produced' }
  ],

  glyco_min_fraction: [{ on: 'glyco', note: 'oxonium flagging is off' }],
  glyco_out: [{ on: 'glyco', note: 'oxonium flagging is off' }],

  recon_fasta: [{ on: 'recon_out', note: 'reconciliation only runs when it has an output file' }],
  recon_missed_cleavages: [{ on: 'recon_out', note: 'reconciliation only runs when it has an output file' }],
  recon_min_length: [{ on: 'recon_out', note: 'reconciliation only runs when it has an output file' }],
  delta_out: [{ on: 'recon_out', note: 'the histogram aggregates the reconciliations' }],

  // Either subsampling knob arms the seed; `on` holds the first and the OR is
  // in isSet, because no other dependency in the tool needs a general boolean.
  subsample_seed: [{ on: 'subsample_spectra', note: 'nothing is being subsampled' }]
}

/// "Set" for dependency purposes: a checked box, a non-zero number, a non-empty
/// path. This is the same test the tool applies -- every master here treats its
/// default (false / 0 / "") as off.
export function isActive(name: string, values: Record<string, unknown>): boolean {
  const v = values[name]
  if (typeof v === 'boolean') return v
  const s = String(v ?? '').trim()
  if (s === '') return false
  const n = Number(s)
  return Number.isNaN(n) ? true : n !== 0
}

/// Why @p name is inert right now, or null if it is live. Returns the FIRST
/// unmet dependency: naming one thing to fix beats listing two.
export function inertBecause(name: string, values: Record<string, unknown>): string | null {
  // The seed's OR, stated once rather than generalising the whole table.
  if (name === 'subsample_seed') {
    return isActive('subsample_spectra', values) || isActive('subsample_fraction', values)
      ? null
      : 'nothing is being subsampled'
  }
  for (const d of DEPENDS[name] ?? []) if (!isActive(d.on, values)) return d.note
  return null
}

/// Deliberately not rendered, each for a stated reason. Listing them (rather
/// than defaulting to hide) is what lets the check below be exhaustive.
export const HIDDEN: Record<string, string> = {
  in: 'dedicated input picker',
  out: 'dedicated output field',
  progress: 'forced on; the GUI consumes the progress stream',
  version: 'TOPP boilerplate',
  log: 'TOPP boilerplate',
  debug: 'TOPP boilerplate',
  no_progress: 'TOPP boilerplate; unrelated to -progress',
  force: 'TOPP boilerplate',
  test: 'TOPP boilerplate',
  stream: 'stdin/stdout resident mode; meaningless under a GUI'
}

/// The parameters actually shown, and so the only ones a run may send. HIDDEN
/// entries are not merely invisible: several are not settable at all (`-version`
/// records the tool's version in the INI and the CLI rejects it as an option),
/// so submitting the whole manifest aborts the run.
export const RENDERED: string[] = SECTIONS.flatMap((s) => s.params)

/// Every parameter must be placed somewhere. A new CLI option then shows up as
/// a loud failure instead of silently never appearing in the GUI -- the whole
/// point of generating the manifest from the tool.
export function unplacedParams(): string[] {
  const placed = new Set<string>([...RENDERED, ...Object.keys(HIDDEN)])
  return PARAMS.map((p) => p.name).filter((n) => !placed.has(n))
}

/// A layout that names a parameter the tool does not have is the other half of
/// the same bug, and it fails silently: the field simply never renders. The
/// stale manifest that shipped without the four -species_* options was only
/// visible from this direction.
export function unknownParams(): string[] {
  return [...RENDERED, ...Object.keys(DEPENDS), ...SECTIONS.flatMap((s) => (s.master ? [s.master] : []))].filter(
    (n) => !PARAM_BY_NAME.has(n)
  )
}
