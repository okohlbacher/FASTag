// Where each CLI parameter appears in the UI, and what it depends on.
//
// The manifest (params.generated.json) says what the parameters ARE; this says
// how they are PRESENTED. They are deliberately separate: the manifest is
// regenerated from the tool and must never be hand-edited, while this layout is
// a human judgement about which knobs belong together and which are inert
// unless another one is set.
//
// TOPP's own advanced="true" flag is not used for this split: it marks the
// TOPPBase boilerplate (log, debug, force, test, ...) and 14 FASTag options
// (digest_*, massgap_*, mzpeak_read_memory), yet leaves deep internals like
// gap_penalty non-advanced. The manifest keeps it as `toppAdvanced`.

import manifest from './params.generated.json'
import { DECIMAL } from './digestReport'

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
  /// File extensions the CLI declares for a file parameter (no dot).
  formats?: string[]
  /// For a string-list: the type of each item as the CLI declares it ("int"
  /// for tag_lengths). min/max then bound each item.
  itemType?: string
}

// UI overlays: the manifest is a faithful dump of the tool, but species_rank
// has a known small set of useful values the tool does not itself declare as
// restrictions. The CLI accepts any rank and reports nothing for one the bundled
// taxonomy lacks, so the list holds only ranks its nodes.dmp has: NCBI names the
// top rank `domain` there, and `superkingdom` gives an empty report.
// Options the tool does restrict (orientation) take the manifest's choices.
const CHOICES: Record<string, string[]> = {
  species_rank: ['species', 'genus', 'family', 'order', 'class', 'phylum', 'kingdom', 'domain']
}

// TOPPBase registers -threads itself with default 1, and FASTag applies its
// real default -- 0, half the logical cores -- to argv in main(), because
// TOPPBase offers no hook to change a common option. The manifest is a dump of
// -write_ini, so it carries TOPPBase's number and text; this is the tool's.
//
// The other entries replace a CLI help text that is written for developers
// with plain words; the facts stay those of the CLI text.
const OVERRIDES: Record<string, Partial<ParamSpec>> = {
  threads: {
    default: '0',
    description: 'Threads to use. 0 (the default) means half the logical cores.'
  },
  max_peaks: { description: 'Peaks kept per spectrum, at most 1024; 0 means 1024. More peaks need more memory.' },
  diversity: {
    description:
      'When a spectrum has more candidate tags than max_tags allows, prefer tags that read different peaks over near-copies of a tag already kept. The number of tags kept stays the same.'
  },
  res_conf: {
    description:
      'Add a res_conf column: a confidence from 0 to 100 for each residue, N- to C-terminal. De novo assembly tools can use it.'
  },
  species_evidence: {
    description:
      "Which tags of a spectrum count as evidence for a taxon: 'best' = only its best tag that matches the reference; 'all' = every reported tag (the behaviour before 1.10)."
  },
  taxdb: { description: 'Species reference index. Default: the one bundled with FASTag.' },
  orientation: {
    description:
      'Match tags as written, or also reversed, against fasta and recon_fasta. Tags are written N- to C-terminal, so tags read from the other ion series match only reversed.'
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
/// One flat list of sections, grouped by content. There is no core-vs-advanced
/// split: nothing in the tool supports that judgement.
export const SECTIONS: Section[] = [
  {
    title: 'Spectra',
    blurb: 'Which spectra are read, and which peaks survive preprocessing.',
    open: false,
    params: [
      'acquisition_check',
      'no_deisotope',
      'max_peaks',
      'peaks_per_window',
      'subsample_spectra',
      'subsample_fraction',
      'subsample_seed'
    ]
  },
  {
    title: 'Tagging',
    blurb: 'The tags themselves: how long, how tolerant, how many per spectrum.',
    open: true,
    params: [
      'tag_length',
      'tag_lengths',
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
    blurb: 'Infer which taxa are present from the tags, using the species index bundled with FASTag (or one you supply).',
    open: false,
    master: 'species',
    params: [
      'species',
      'species_rank',
      'species_evidence',
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
    title: 'Digest and labels',
    blurb: 'Report the terminal residues of the tags, the protease they fit and the labels they carry. Both reports are shown in the Digest tab.',
    open: false,
    params: [
      'digest_out',
      'label_out',
      'digest_models',
      'digest_tag_min',
      'digest_window',
      'digest_background_share',
      'digest_silac_min'
    ]
  },
  {
    title: 'Reconciliation',
    blurb: 'Place tags in database peptides and report the mass left over. The mass-gap report (massgap_out) is shown in the Digest tab.',
    open: false,
    master: 'recon_out',
    params: [
      'recon_out',
      'recon_fasta',
      'recon_missed_cleavages',
      'recon_min_length',
      'recon_localize',
      'delta_out',
      'recon_id_out',
      'massgap_out',
      'massgap_window',
      'massgap_window_da',
      'massgap_min_spectra',
      'massgap_min_share',
      'massgap_min_bin',
      'massgap_max_mods',
      'massgap_top',
      'massgap_silac_share',
      'massgap_silac_min'
    ]
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
    params: ['proforma', 'res_conf', 'usi_collection', 'out_spectra']
  },
  {
    title: 'Performance',
    blurb: 'How much of the computer a run may use.',
    open: false,
    params: ['threads']
  }
]

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

export const DEPENDS: Record<string, Dependency[]> = {
  // -gaps 0 means no gapped tags exist, so nothing can be penalised.
  gap_penalty: [{ on: 'gaps', note: 'only applies when tags may cross a gap' }],

  // The CLI warns "tag_length N is ignored: tag_lengths replaces it".
  tag_length: [{ on: 'tag_lengths', replaced: true, note: 'tag_lengths replaces it' }],

  // Read only when the fasta filter runs.
  entrapment_fasta: [{ on: 'fasta', note: 'the entrapment database is only searched together with fasta' }],
  min_filter_length: [{ on: 'fasta', note: 'only affects matching against a sequence database' }],
  // Read by the fasta filter AND by reconciliation (FASTag.cpp: TagReconciler
  // takes the orientation, the proteome index the isobaric tolerance).
  orientation: [{ on: ['fasta', 'recon_out'], note: 'only affects matching against fasta and reconciliation' }],
  isobaric_tolerance: [{ on: ['fasta', 'recon_out'], note: 'only affects matching against fasta and reconciliation' }],

  species_rank: [{ on: 'species', note: 'species detection is off' }],
  species_evidence: [{ on: 'species', note: 'species detection is off' }],
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
  recon_localize: [{ on: 'recon_out', note: 'reconciliation only runs when it has an output file' }],
  delta_out: [{ on: 'recon_out', note: 'the histogram is built from the reconciliation results' }],
  recon_id_out: [{ on: 'recon_out', note: 'it writes the reconciliation results as identifications' }],

  subsample_seed: [{ on: ['subsample_spectra', 'subsample_fraction'], note: 'nothing is being subsampled' }],

  digest_models: [{ on: 'digest_out', note: 'only the digest report uses the models' }],
  digest_tag_min: [{ on: 'digest_out', note: 'only the digest report uses it' }],
  digest_background_share: [{ on: 'digest_out', note: 'only the digest report uses it' }],
  digest_window: [{ on: ['digest_out', 'label_out'], note: 'neither the digest nor the label report is written' }],
  digest_silac_min: [{ on: 'label_out', note: 'only the label report uses it' }],

  massgap_out: [{ on: 'recon_out', note: 'the mass gaps come from the reconciliation results' }],
  ...Object.fromEntries(
    [
      'massgap_window',
      'massgap_window_da',
      'massgap_min_spectra',
      'massgap_min_share',
      'massgap_min_bin',
      'massgap_max_mods',
      'massgap_top',
      'massgap_silac_share',
      'massgap_silac_min'
    ].map((n) => [
      n,
      [
        { on: 'recon_out', note: 'reconciliation only runs when it has an output file' },
        { on: 'massgap_out', note: 'only the mass-gap report uses it' }
      ]
    ])
  )
}

/// "Set" for dependency purposes: a checked box, a non-zero number, a non-empty
/// path or list. This is the same test the tool applies -- every master here
/// treats its default (false / 0 / "") as off.
///
/// An empty field is not sent, so the CLI applies its own default: a cleared
/// `gaps` runs with gaps 1. It is therefore read as the manifest default.
export function isActive(name: string, values: Record<string, unknown>): boolean {
  const v = values[name]
  if (typeof v === 'boolean') return v
  let s = (Array.isArray(v) ? v.filter((x) => String(x).trim() !== '').join(',') : String(v ?? '')).trim()
  if (s === '') {
    const d = PARAM_BY_NAME.get(name)?.default ?? ''
    s = (Array.isArray(d) ? d.join(',') : d).trim()
  }
  if (s === '' || s === 'false') return false
  if (s === 'true') return true
  const n = Number(s)
  return Number.isNaN(n) ? true : n !== 0
}

/// The FIRST unmet dependency of @p name right now, or null if it is live:
/// naming one thing to fix beats listing two.
export function inertDependency(name: string, values: Record<string, unknown>): Dependency | null {
  for (const d of DEPENDS[name] ?? []) {
    const set = masters(d).some((n) => isActive(n, values))
    if (d.replaced ? set : !set) return d
  }
  return null
}

/// Why @p name is inert right now, or null if it is live.
export function inertBecause(name: string, values: Record<string, unknown>): string | null {
  return inertDependency(name, values)?.note ?? null
}

/// Masters named by a dependency, flattened.
export function masters(d: Dependency): string[] {
  return Array.isArray(d.on) ? d.on : [d.on]
}

/// A value and its unit are one control: the unit parameter is drawn inside
/// the value's field, not as a field of its own.
export const UNIT_OF: Record<string, string> = { fragment_tolerance: 'fragment_tolerance_unit' }
export const UNIT_PARAMS = new Set(Object.values(UNIT_OF))

/// Labels for options whose CLI name is an abbreviation, not words. The CLI
/// name is shown beside the label, so the label is the option in words.
export const LABEL: Record<string, string> = {
  recon_out: 'Reconciliation table',
  recon_fasta: 'Reconciliation database',
  recon_id_out: 'Reconciliation as identifications',
  recon_localize: 'Localize mass gaps',
  recon_min_length: 'Reconciliation: minimum tag length',
  recon_missed_cleavages: 'Reconciliation: missed cleavages',
  delta_out: 'Mass-shift histogram',
  massgap_out: 'Mass-gap report',
  massgap_window: 'Gap window (ppm runs)',
  massgap_window_da: 'Gap window (Da runs)',
  massgap_silac_min: 'SILAC: minimum shifted spectra',
  massgap_silac_share: 'SILAC: minimum share of shifted spectra',
  species_max_kmer_share: 'Maximum taxon share of a k-mer',
  species_min_margin: 'Minimum lead over runner-up taxon',
  res_conf: 'Per-residue confidence column',
  usi_collection: 'USI column (dataset ID)',
  out_spectra: 'Spectra with tags (file)',
  no_deisotope: 'Skip deisotoping',
  proforma: 'ProForma column',
  taxdb: 'Species reference index',
  digest_silac_min: 'Heavy-label check: minimum K and R ends',
  max_evalue: 'Maximum E-value',
  acquisition_check: 'Raw DIA check'
}

/// The CLI name in words, for the label beside it: tag_length -> Tag length.
export function humanName(name: string): string {
  const s = name.replace(/_/g, ' ')
  return LABEL[name] ?? s.charAt(0).toUpperCase() + s.slice(1)
}

const listText = (v: unknown): string =>
  (Array.isArray(v) ? v.map((x) => String(x).trim()).filter((x) => x !== '').join('\n') : String(v ?? '').trim())

/// The manifest default as the form shows it: off for a switch, "not set" for
/// an empty one.
export function defaultText(spec: ParamSpec): string {
  if (spec.type === 'bool') return spec.default === 'true' ? 'on' : 'off'
  const d = listText(spec.default).replace(/\n/g, ', ')
  return d === '' ? 'not set' : d
}

/// The value differs from the CLI default. An empty field is not sent, so the
/// CLI applies its default: it is unchanged.
export function isChanged(name: string, value: unknown): boolean {
  const spec = PARAM_BY_NAME.get(name)
  if (!spec) return false
  if (spec.type === 'bool') return (value === true) !== (spec.default === 'true')
  const v = listText(value)
  if (v === '' && spec.type !== 'string-list') return false
  return v !== listText(spec.default)
}

/// Deliberately not rendered, each for a stated reason. Listing them (rather
/// than defaulting to hide) is what lets the check below be exhaustive.
const OPT_IN_1_12 = '1.12 command-line option, not in the form yet (CLI default applies)'
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
  stream: 'stdin/stdout resident mode; meaningless under a GUI',
  mzpeak_read_memory: 'ignored by the CLI: mzPeak is read in file order without a decode cache',
  // FASTag 1.12 options. Each is opt-in and leaves the output as 1.11 at its
  // default. Not offered in the form until each has its GUI design; until then
  // a GUI run uses the CLI defaults. The exception is acquisition_check (under
  // Spectra): its default refuses raw DIA, the one 1.12 default change, so the
  // form offers warn and off, or a GUI user could not tag raw DIA at all.
  probe_input: 'metadata probe for programs; prints JSON lines and exits',
  dump_spectrum: 'spectrum dump for programs; prints JSON lines and exits',
  acquisition_probe_spectra: OPT_IN_1_12,
  alkylation_out: OPT_IN_1_12,
  alkylation_proteome: OPT_IN_1_12,
  alkylation_min_spectra: OPT_IN_1_12,
  alkylation_min_share: OPT_IN_1_12,
  alkylation_window: OPT_IN_1_12,
  census: OPT_IN_1_12,
  census_out: OPT_IN_1_12,
  census_summary_out: OPT_IN_1_12,
  census_ids: OPT_IN_1_12,
  census_ids_fdr: OPT_IN_1_12,
  census_triage_evalue: OPT_IN_1_12,
  unknown_charge: OPT_IN_1_12,
  charge_min: OPT_IN_1_12,
  charge_max: OPT_IN_1_12,
  charge_infer_margin: OPT_IN_1_12,
  isotope_error: OPT_IN_1_12,
  complement_rule: OPT_IN_1_12,
  complement_tolerance: OPT_IN_1_12,
  complement_tolerance_unit: OPT_IN_1_12,
  complement_tol_factor: OPT_IN_1_12,
  complement_midp: OPT_IN_1_12,
  pick_profile: OPT_IN_1_12,
  pick_unknown_type: OPT_IN_1_12,
  ion_series: OPT_IN_1_12,
  species_call: OPT_IN_1_12,
  species_call_decoys: OPT_IN_1_12,
  species_call_min_units: OPT_IN_1_12,
  species_call_params: OPT_IN_1_12,
  species_pi0: OPT_IN_1_12,
  species_orientation: OPT_IN_1_12,
  digest_models_version: OPT_IN_1_12,
  digest_detection: OPT_IN_1_12,
  digest_flank2: OPT_IN_1_12,
  digest_min_confidence: OPT_IN_1_12,
  digest_calibration: OPT_IN_1_12,
  shortlist_out: OPT_IN_1_12,
  fasta_out: OPT_IN_1_12,
  shortlist_background: OPT_IN_1_12,
  shortlist_min_spectra: OPT_IN_1_12,
  shortlist_max_evalue: OPT_IN_1_12,
  shortlist_top: OPT_IN_1_12,
  shortlist_parsimony: OPT_IN_1_12,
  shortlist_gapped: OPT_IN_1_12,
  shortlist_decoy_affix: OPT_IN_1_12,
  shortlist_force: OPT_IN_1_12,
  search_config_out: OPT_IN_1_12,
  search_engine: OPT_IN_1_12,
  search_config_template: OPT_IN_1_12,
  search_decoy_prefix: OPT_IN_1_12,
  search_precursor_tolerance: OPT_IN_1_12,
  search_precursor_unit: OPT_IN_1_12,
  search_isotope_errors: OPT_IN_1_12
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
/// the same bug, and it fails silently: the field simply never renders (a stale
/// manifest is only visible from this direction).
export function unknownParams(): string[] {
  return [
    ...RENDERED,
    ...Object.keys(DEPENDS),
    ...SECTIONS.flatMap((s) => (s.master ? [s.master] : []))
  ].filter((n) => !PARAM_BY_NAME.has(n))
}

// ---------------------------------------------------------------------------
// Values the CLI would refuse.
//
// A number field is a text field: <input type=number> turns `0,02` into `002`
// under an English WebKit locale and sends '' for a half-typed `5e`, which the
// CLI then replaces by its default. So the text is checked here, the way the
// CLI parses it, and a value it would refuse is flagged instead of sent.

// A leading '+' is accepted, as the CLI accepts it (-max_peaks +400).
const INT = /^[+-]?\d+$/
// TOPP options are C++ ints.
const INT_LIMIT = 2147483647

// Options whose declared minimum is a tiny floor standing for "greater than 0"
// (fragment_tolerance: 1e-9). 0 and negatives are reported as such rather than
// as "must be at least 1e-9".
const POSITIVE = new Set(['fragment_tolerance'])

// Options whose declared maximum the CLI itself refuses (digest_background_share:
// declared 0..1, but at 1 every protease model is the background, so all tie).
const BELOW_MAX = new Set(['digest_background_share'])

function badNumber(type: string, s: string, min?: number, max?: number): string | null {
  if (type === 'int') {
    if (!INT.test(s)) return 'a whole number is required'
  } else if (s.includes(',') && DECIMAL.test(s.replace(',', '.'))) {
    // Rejected rather than converted: `1,500` may mean 1500.
    return 'use a decimal point, not a comma'
  } else if (!DECIMAL.test(s)) {
    return 'not a number'
  }
  const n = Number(s)
  if (type === 'int' && Math.abs(n) > INT_LIMIT) return 'too large'
  if (min !== undefined && n < min) return `must be at least ${min}`
  if (max !== undefined && n > max) return `must be at most ${max}`
  return null
}

/// Why the CLI would refuse @p value for @p spec, or null. An empty field is
/// always fine: it is not sent, and the CLI applies its default.
export function invalidBecause(spec: ParamSpec, value: unknown): string | null {
  if (spec.type === 'string-list') {
    if (spec.itemType !== 'int' && spec.itemType !== 'double') return null
    const items = Array.isArray(value) ? value.map((x) => String(x).trim()) : []
    for (const item of items) {
      if (item === '') continue
      // `7, 8` on one line is one argv item, which the CLI cannot convert.
      if (/[\s,;]/.test(item)) return 'one value per line'
      const bad = badNumber(spec.itemType, item, spec.min, spec.max)
      if (bad) return `${item}: ${bad}`
    }
    return null
  }
  const s = typeof value === 'boolean' ? '' : String(value ?? '').trim()
  if (s === '') return null
  if (spec.choices?.length && !spec.choices.includes(s)) return `not one of ${spec.choices.join(', ')}`
  if (spec.type === 'int' || spec.type === 'double') {
    const positive = POSITIVE.has(spec.name)
    const bad = badNumber(spec.type, s, positive ? undefined : spec.min, spec.max)
    if (bad) return bad
    if (BELOW_MAX.has(spec.name) && spec.max !== undefined && Number(s) >= spec.max) return `must be below ${spec.max}`
    if (positive) {
      const n = Number(s)
      if (!(n > 0)) return 'must be greater than 0'
      if (spec.min !== undefined && n < spec.min) return `must be at least ${spec.min}`
    }
  }
  return null
}

/// Every rendered, live parameter whose value the CLI would refuse, with the
/// reason. An inert one is not sent, so it cannot fail the run. Run should stay
/// disabled while this is non-empty.
export function invalidParams(values: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of RENDERED) {
    const spec = PARAM_BY_NAME.get(name)
    if (!spec || inertBecause(name, values)) continue
    const bad = invalidBecause(spec, values[name])
    if (bad) out[name] = bad
  }
  return out
}

// ---------------------------------------------------------------------------
// Combinations the CLI refuses up front (FASTag.cpp, before reading any
// spectrum), each with rc 6. Every value here is valid on its own, so the
// field checks above cannot see them.

/// What a preflight check may need beyond the form: the k of the species
/// index, read from its header (taxdb_info), null while unknown.
export interface PreflightContext {
  taxdbK?: number | null
}

export interface Conflict {
  /// The parameters involved, CLI names. The first is the one to change.
  params: string[]
  /// Why the CLI would refuse, phrased like the CLI's own message.
  note: string
}

const int = (v: unknown): number | null => (INT.test(String(v ?? '').trim()) ? Number(String(v).trim()) : null)

/// The seed lengths the CLI tags at: the distinct tag_lengths when given,
/// else tag_length (its default when cleared).
function seedLengths(values: Record<string, unknown>): { lengths: number[]; option: string } {
  const list = Array.isArray(values['tag_lengths']) ? values['tag_lengths'] : []
  const lengths = [...new Set(list.map(int).filter((n): n is number => n !== null))].sort((a, b) => a - b)
  if (lengths.length) return { lengths, option: 'tag_lengths' }
  const one = int(values['tag_length']) ?? int(PARAM_BY_NAME.get('tag_length')?.default)
  return { lengths: one === null ? [] : [one], option: 'tag_length' }
}

/// With species detection on: how far the longest tag reaches (longest seed
/// + 2 × extension) when that is short of the species index's k, else null.
/// FASTag.cpp: "-species: tag_length (3) + 2*extension (0) = 3 cannot reach the index k = 7".
export function speciesReach(
  values: Record<string, unknown>,
  taxdbK: number | null | undefined
): { reach: number; k: number; option: string; seed: number; ext: number } | null {
  if (!isActive('species', values) || !taxdbK || taxdbK <= 0) return null
  const { lengths, option } = seedLengths(values)
  if (!lengths.length) return null
  const seed = lengths[lengths.length - 1]
  const ext = int(values['extension']) ?? int(PARAM_BY_NAME.get('extension')?.default) ?? 0
  const reach = seed + 2 * ext
  return reach >= taxdbK ? null : { reach, k: taxdbK, option, seed, ext }
}

export const CONFLICTS: ((values: Record<string, unknown>, ctx: PreflightContext) => Conflict | null)[] = [
  (values, { taxdbK }) => {
    const r = speciesReach(values, taxdbK)
    if (!r) return null
    const { reach, option, seed, ext } = r
    return {
      params: [option, 'extension', 'species'],
      note:
        `${option} (${seed}) + 2 × extension (${ext}) = ${reach} cannot reach the species index k = ${taxdbK}, ` +
        `so every tag would be too short to look up. Set ${option} to ${taxdbK} (or raise extension).`
    }
  },
  // "-entrapment_fasta calibrates q_db over one seed length; run each of -tag_lengths separately."
  (values) =>
    !inertBecause('entrapment_fasta', values) && isActive('entrapment_fasta', values) && seedLengths(values).lengths.length > 1
      ? { params: ['entrapment_fasta', 'tag_lengths'], note: 'entrapment_fasta estimates the false-match rate (q_db) for one tag length at a time; run each of tag_lengths separately.' }
      : null,
  // "-entrapment_fasta cannot be combined with -species".
  (values) =>
    !inertBecause('entrapment_fasta', values) && isActive('entrapment_fasta', values) && isActive('species', values)
      ? {
          params: ['entrapment_fasta', 'species'],
          note: 'entrapment_fasta cannot be combined with species: entrapment matches would be counted as species evidence.'
        }
      : null,
  // "-recon_out needs a database: give -recon_fasta (or -fasta)."
  (values) =>
    isActive('recon_out', values) && !isActive('recon_fasta', values) && !isActive('fasta', values)
      ? { params: ['recon_out', 'recon_fasta', 'fasta'], note: 'recon_out needs a database: set recon_fasta (or fasta).' }
      : null,
  // "-taxdb, -taxonomy_nodes and -taxonomy_names are one set: give all three, or none (to use the bundled taxonomy)."
  (values) => {
    if (!isActive('species', values)) return null
    const set = ['taxdb', 'taxonomy_nodes', 'taxonomy_names']
    const missing = set.filter((n) => !isActive(n, values))
    return missing.length === 0 || missing.length === set.length
      ? null
      : {
          params: missing,
          note: 'taxdb, taxonomy_nodes and taxonomy_names are one set: give all three, or none to use the bundled taxonomy.'
        }
  }
]

/// Every combination in @p values the CLI would refuse before starting. Run
/// should stay disabled, with these notes beside it, while this is non-empty.
export function conflicts(values: Record<string, unknown>, ctx: PreflightContext = {}): Conflict[] {
  return CONFLICTS.map((c) => c(values, ctx)).filter((c): c is Conflict => c !== null)
}
