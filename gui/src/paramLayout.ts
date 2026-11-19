// Where each CLI parameter appears in the UI, and what it depends on: the
// views of PARAM_UI (paramUi.ts, one entry per parameter) the app uses, and
// the checks built on them.
//
// The manifest (params.generated.json) says what the parameters ARE; PARAM_UI
// says how they are PRESENTED. They are deliberately separate: the manifest is
// regenerated from the tool and must never be hand-edited, while PARAM_UI is
// a human judgement about which knobs belong together and which are inert
// unless another one is set.
//
// TOPP's own advanced="true" flag is not used for this split: it marks the
// TOPPBase boilerplate (log, debug, force, test, ...) and 14 FASTag options
// (digest_*, massgap_*, mzpeak_read_memory), yet leaves deep internals like
// gap_penalty non-advanced. The manifest keeps it as `toppAdvanced`.

import manifest from './params.generated.json'
import { DECIMAL } from './digestReport'
import { PARAM_UI, type Dependency, type ParamHelp, type ParamUi } from './paramUi'

export { PARAM_UI, type Dependency, type ParamHelp, type ParamUi }

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

/// The entry of @p name, or an empty one for a name PARAM_UI lacks (which
/// paramUi.test.ts reports).
export const uiOf = (name: string): ParamUi => (Object.prototype.hasOwnProperty.call(PARAM_UI, name) ? PARAM_UI[name] : {})

/// The manifest with PARAM_UI's overlays: its `override` (the tool's own
/// default or a plain description) and its `choices`.
export const PARAMS: ParamSpec[] = (manifest.params as ParamSpec[]).map((p) => {
  const ui = uiOf(p.name)
  return { ...p, ...(ui.override ?? {}), ...(ui.choices ? { choices: ui.choices } : {}) }
})
export const PARAM_BY_NAME = new Map(PARAMS.map((p) => [p.name, p]))

import type { TaskId } from './setup/tasks'

/// Where a group belongs (doc/GUI-WORKFLOWS.md section 4): a workflow, whose
/// Advanced part shows it open; `common`, the block every workflow shows in
/// Settings; or `global`, the same settings for every workflow.
export type GroupHome = TaskId | 'common' | 'global'

export interface Section {
  title: string
  /// One line under the heading: what the group does, in plain words.
  blurb: string
  home: GroupHome
  /// Open on first launch. Groups open by workflow instead (SetupForm).
  open: boolean
  /// Every option of the group is experimental in the CLI (README).
  experimental?: true
  /// Kept for older callers: no group has a switch of its own any more; a
  /// report is turned on by its output checkbox (setup/products.ts).
  master?: string
  /// Its parameters, in form order.
  params: string[]
}

/// The groups, in the order of the workflows (doc/GUI-WORKFLOWS.md section 4),
/// then the global ones. Each parameter of the form is in exactly one group;
/// its PARAM_UI `section` names it (paramUi.test.ts holds both to that).
const SECTION_DEFS: Omit<Section, 'open'>[] = [
  { title: 'Common', home: 'common', blurb: 'The fragment tolerance of your analyzer and the fixed modifications.', params: ['fragment_tolerance', 'fragment_tolerance_unit', 'fixed_modifications'] },
  { title: 'Tagging', home: 'export-tags', blurb: 'How long the tags are, how good, and how many per spectrum.', params: ['tag_length', 'extension', 'max_evalue', 'max_tags', 'res_conf'] },
  { title: 'Tag columns and files', home: 'export-tags', blurb: 'Extra columns in the tags table, and the spectra that carry tags.', params: ['proforma', 'usi_collection', 'out_spectra'] },
  { title: 'Tagging, advanced', home: 'export-tags', blurb: 'Several seed lengths, gapped tags, and how near-copies of a tag are ranked.', params: ['tag_lengths', 'gaps', 'gap_penalty', 'diversity', 'orientation', 'isobaric_tolerance'] },
  { title: 'Keep only tags found in a database', home: 'export-tags', blurb: 'Write only tags that occur in sequences you supply.', params: ['fasta', 'min_filter_length', 'entrapment_fasta'] },
  { title: 'Run QC', home: 'run-qc', blurb: 'How much of the run is read, and the check for raw DIA data.', params: ['qc_out', 'subsample_fraction', 'acquisition_check'] },
  { title: 'Sampling and checks', home: 'run-qc', blurb: 'A random subset of spectra, and checks of the acquisition and the precursor charges.', params: ['subsample_spectra', 'subsample_seed', 'acquisition_probe_spectra', 'check_header_charge', 'check_header_margin', 'check_header_out'] },
  { title: 'Placement on the database', home: 'mass-shift', blurb: 'Place tags on the proteins of a FASTA and keep the mass left over at each end.', params: ['recon_fasta', 'recon_missed_cleavages', 'recon_out', 'recon_id_out'] },
  { title: 'Placement, advanced', home: 'mass-shift', blurb: 'Site localization, the shortest tag placed, and single-residue substitutions.', params: ['recon_localize', 'recon_min_length', 'recon_sub_tolerance', 'recon_sub_tolerance_unit'] },
  { title: 'Mass-shift survey', home: 'mass-shift', blurb: 'The mass shifts between tag flanks and the database: a frequency table with sites and UniMod names.', params: ['delta_out', 'delta_spectra_out', 'delta_counts_out', 'massgap_out'] },
  { title: 'Mass-shift survey, advanced', home: 'mass-shift', experimental: true, blurb: 'How shifts are grouped, localized and named.', params: ['delta_select', 'delta_group', 'delta_isobar_tolerance', 'delta_isotope_flank', 'delta_loc_model', 'delta_loc_min_evidence', 'delta_loc_null', 'delta_name_tolerance', 'delta_name_tolerance_unit'] },
  { title: 'Mass-gap report', home: 'mass-shift', blurb: 'Peaks of the mass-gap distribution, explained as UniMod combinations.', params: ['massgap_max_mods', 'massgap_min_bin', 'massgap_min_share', 'massgap_min_spectra', 'massgap_silac_min', 'massgap_silac_share', 'massgap_top', 'massgap_window', 'massgap_window_da'] },
  { title: 'Species', home: 'species', blurb: 'Which taxa the tags point to, from the species index bundled with FASTag.', params: ['species', 'species_out', 'species_rank', 'species_call'] },
  { title: 'Species, advanced', home: 'species', blurb: 'Which tags count as evidence, and how a taxon is called present.', params: ['species_evidence', 'species_min_len', 'species_use_gapped', 'species_deconvolve', 'species_max_kmer_share', 'species_min_margin', 'species_orientation', 'species_call_decoys', 'species_call_min_units', 'species_call_params', 'species_pi0'] },
  { title: 'Taxonomy', home: 'species', blurb: 'Your own species index and taxonomy. Leave all three empty to use the bundled ones.', params: ['taxdb', 'taxonomy_nodes', 'taxonomy_names'] },
  { title: 'Shortlist', home: 'db-reduction', blurb: 'A ranked protein shortlist, a reduced FASTA and a configuration for your search engine.', params: ['shortlist_out', 'fasta_out', 'search_config_out', 'shortlist_background', 'shortlist_protease', 'search_engine'] },
  { title: 'Shortlist, advanced', home: 'db-reduction', blurb: 'Which placements count, and which proteins are kept.', params: ['shortlist_min_spectra', 'shortlist_top', 'shortlist_parsimony', 'shortlist_specificity', 'shortlist_gapped', 'shortlist_max_evalue', 'shortlist_force', 'shortlist_decoy_affix'] },
  { title: 'Search configuration', home: 'db-reduction', blurb: 'Settings written into the search-engine configuration.', params: ['search_config_template', 'search_decoy_prefix', 'search_isotope_errors', 'search_missed_cleavages', 'search_nterm_acetyl', 'search_precursor_tolerance', 'search_precursor_unit'] },
  { title: 'Identifiability', home: 'triage', blurb: 'One row per MS/MS spectrum, ranked by how identifiable it is, and marked when your search identified it.', params: ['census', 'census_score', 'census_out', 'census_summary_out', 'census_sorted_out', 'census_ids', 'census_ids_fdr', 'census_triage_evalue'] },
  { title: 'Identifiability, advanced', home: 'triage', blurb: 'How the identification file is joined to the spectra.', params: ['census_ids_accept', 'census_ids_exact'] },
  { title: 'Digest and labels', home: 'characterize', blurb: 'The protease the tags fit and the labels they carry.', params: ['digest_out', 'label_out', 'digest_models', 'digest_models_version', 'digest_calibration', 'digest_detection', 'digest_flank2', 'digest_min_confidence', 'digest_tag_min', 'digest_window', 'digest_background_share', 'digest_silac_min', 'digest_quality'] },
  { title: 'Alkylation', home: 'characterize', blurb: 'Which reagent alkylated the cysteines, from placements on a shipped proteome.', params: ['alkylation_out', 'alkylation_tags_out', 'alkylation_proteome', 'alkylation_min_share', 'alkylation_min_spectra', 'alkylation_window'] },
  { title: 'Glycopeptides', home: 'characterize', blurb: 'Flag spectra that carry oxonium ions.', params: ['glyco', 'glyco_out', 'glyco_min_fraction'] },
  { title: 'Performance', home: 'global', blurb: 'How much of the computer a run may use.', params: ['threads'] },
  { title: 'Peaks', home: 'global', blurb: 'Which peaks of a spectrum survive preprocessing.', params: ['no_deisotope', 'max_peaks', 'peaks_per_window', 'pick_profile'] },
  { title: 'Charge and ions', home: 'global', blurb: 'The ion series spectra are read as, and the precursor charges tried.', params: ['ion_series', 'ion_series_hybrid', 'unknown_charge', 'charge_min', 'charge_max', 'charge_infer_margin', 'isotope_error'] },
  { title: 'Complement pairs', home: 'global', blurb: 'How b/y complement pairs are found and scored.', params: ['complement_rule', 'complement_tolerance', 'complement_tolerance_unit', 'complement_tol_factor', 'complement_probe', 'complement_midp'] },
  { title: 'Isobaric reporters', home: 'global', experimental: true, blurb: 'Filters for TMT-labelled runs.', params: ['tmt_pseudo_filter', 'tmt_reporter_filter'] },
  { title: 'Modifications', home: 'global', blurb: 'Variable modifications, tagged as alternatives.', params: ['variable_modifications'] }
]

export const SECTIONS: Section[] = SECTION_DEFS.map((s) => ({ ...s, open: false }))

/// The group of @p title.
export const sectionByTitle = (title: string): Section | undefined => SECTIONS.find((s) => s.title === title)

/// The options a GUI run sends even at their default: the ones the form
/// offered before the workflows (FASTag 1.11 to 1.15.3). Every other option
/// is sent only when it differs from the CLI default, so a command line
/// stays as short as it was and an option the run does not use is not named.
export const ALWAYS_SENT: ReadonlySet<string> = new Set([
  'acquisition_check', 'no_deisotope', 'max_peaks', 'peaks_per_window', 'subsample_spectra', 'subsample_fraction', 'subsample_seed',
  'tag_length', 'tag_lengths', 'fragment_tolerance', 'fragment_tolerance_unit', 'gaps', 'gap_penalty', 'extension', 'max_tags',
  'max_evalue', 'diversity', 'fasta', 'entrapment_fasta', 'orientation', 'isobaric_tolerance', 'min_filter_length', 'species',
  'species_rank', 'species_evidence', 'species_min_len', 'species_use_gapped', 'species_deconvolve', 'species_max_kmer_share',
  'species_min_margin', 'species_out', 'taxdb', 'taxonomy_nodes', 'taxonomy_names', 'glyco', 'glyco_min_fraction', 'glyco_out',
  'digest_out', 'label_out', 'digest_models', 'digest_tag_min', 'digest_window', 'digest_background_share', 'digest_silac_min',
  'recon_out', 'recon_fasta', 'recon_missed_cleavages', 'recon_min_length', 'recon_localize', 'delta_out', 'recon_id_out',
  'massgap_out', 'massgap_window', 'massgap_window_da', 'massgap_min_spectra', 'massgap_min_share', 'massgap_min_bin',
  'massgap_max_mods', 'massgap_top', 'massgap_silac_share', 'massgap_silac_min', 'fixed_modifications', 'variable_modifications',
  'proforma', 'res_conf', 'usi_collection', 'out_spectra', 'threads'
])

/// The dependencies of @p name (PARAM_UI `depends`), none for most.
export const dependsOf = (name: string): Dependency[] => uiOf(name).depends ?? []

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
  for (const d of dependsOf(name)) {
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
export const unitOf = (name: string): string | undefined => uiOf(name).unit
export const UNIT_PARAMS = new Set(Object.keys(PARAM_UI).flatMap((n) => (PARAM_UI[n].unit ? [PARAM_UI[n].unit!] : [])))

/// The CLI name in words, for the label beside it: tag_length -> Tag length.
export function humanName(name: string): string {
  const s = name.replace(/_/g, ' ')
  return uiOf(name).label ?? s.charAt(0).toUpperCase() + s.slice(1)
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

/// Deliberately not rendered (PARAM_UI `hidden`), in table order.
export const HIDDEN_PARAMS: string[] = Object.keys(PARAM_UI).filter((n) => PARAM_UI[n].hidden !== undefined)

/// Why @p name is not in the form, or undefined if it is.
export const hiddenReason = (name: string): string | undefined => uiOf(name).hidden

/// The parameters actually shown, and so the only ones a run may send. Hidden
/// entries are not merely invisible: several are not settable at all (`-version`
/// records the tool's version in the INI and the CLI rejects it as an option),
/// so submitting the whole manifest aborts the run.
export const RENDERED: string[] = SECTIONS.flatMap((s) => s.params)

/// Every parameter must have its PARAM_UI entry, placed in a section or
/// hidden. A new CLI option then shows up as a loud failure instead of
/// silently never appearing in the GUI -- the whole point of generating the
/// manifest from the tool.
export function unplacedParams(): string[] {
  const titles = new Set(SECTIONS.map((s) => s.title))
  return PARAMS.map((p) => p.name).filter((n) => {
    const ui = Object.prototype.hasOwnProperty.call(PARAM_UI, n) ? PARAM_UI[n] : undefined
    return !ui || (ui.hidden === undefined) === (ui.section === undefined) || (ui.section !== undefined && !titles.has(ui.section))
  })
}

/// An entry that names a parameter the tool does not have is the other half
/// of the same bug, and it fails silently: the field simply never renders (a
/// stale manifest is only visible from this direction). Masters and units
/// count too.
export function unknownParams(): string[] {
  return [
    ...Object.keys(PARAM_UI),
    ...Object.values(PARAM_UI).flatMap((u) => [...(u.depends ?? []).flatMap(masters), ...(u.unit ? [u.unit] : [])]),
    ...SECTIONS.flatMap((s) => s.params)
  ].filter((n, i, all) => !PARAM_BY_NAME.has(n) && all.indexOf(n) === i)
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
  if (!Number.isFinite(n)) return 'must be a finite number'
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
    const positive = uiOf(spec.name).positive === true
    const bad = badNumber(spec.type, s, positive ? undefined : spec.min, spec.max)
    if (bad) return bad
    if (uiOf(spec.name).belowMax && spec.max !== undefined && Number(s) >= spec.max) return `must be below ${spec.max}`
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
      ? { params: ['recon_fasta', 'recon_out', 'fasta'], note: 'The placements need a protein database: choose one under Protein database.' }
      : null,
  // "-shortlist_out needs a database: give -recon_fasta (or -fasta)."
  (values) =>
    ['shortlist_out', 'fasta_out', 'search_config_out'].some((n) => isActive(n, values)) && !isActive('recon_fasta', values) && !isActive('fasta', values)
      ? { params: ['recon_fasta', 'shortlist_out', 'fasta'], note: 'The shortlist needs a protein database: choose one under Protein database.' }
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

/// The section a parameter is in.
export const SECTION_OF: Map<string, Section> = new Map(SECTIONS.flatMap((s) => s.params.map((n) => [n, s] as [string, Section])))
