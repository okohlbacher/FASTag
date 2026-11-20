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
import type { ParamValue } from './ParamField'
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
  { title: 'Tagging', home: 'global', blurb: 'How long the tags are, how good, and how many per spectrum.', params: ['tag_length', 'extension', 'max_evalue', 'max_tags', 'res_conf'] },
  { title: 'Tag columns and files', home: 'export-tags', blurb: 'Extra columns in the tags table, and the spectra that carry tags.', params: ['proforma', 'usi_collection', 'out_spectra'] },
  { title: 'Tagging, advanced', home: 'global', blurb: 'Several seed lengths, gapped tags, and how near-copies of a tag are ranked.', params: ['tag_lengths', 'gaps', 'gap_penalty', 'diversity', 'orientation', 'isobaric_tolerance'] },
  { title: 'Keep only tags found in a database', home: 'global', blurb: 'Write only tags that occur in sequences you supply.', params: ['fasta', 'min_filter_length', 'entrapment_fasta'] },
  { title: 'Run QC', home: 'run-qc', blurb: 'Counts, resolution, charges, labels and instrument of the run, in one report.', params: ['qc_out'] },
  { title: 'Sampling and checks', home: 'global', blurb: 'How much of the run is read, the check for raw DIA data, and the check of the precursor charges.', params: ['subsample_fraction', 'acquisition_check', 'subsample_spectra', 'subsample_seed', 'acquisition_probe_spectra', 'check_header_charge', 'check_header_margin', 'check_header_out'] },
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
///
/// recon_min_length and recon_missed_cleavages are not in it although 1.15.3
/// offered them: the CLI applies the MSFragger shortlist recipe only to the
/// options not named on the command line (FASTag.cpp optionGiven_), so
/// naming them at their default gave a run half the recipe.
export const ALWAYS_SENT: ReadonlySet<string> = new Set([
  'acquisition_check', 'no_deisotope', 'max_peaks', 'peaks_per_window', 'subsample_spectra', 'subsample_fraction', 'subsample_seed',
  'tag_length', 'tag_lengths', 'fragment_tolerance', 'fragment_tolerance_unit', 'gaps', 'gap_penalty', 'extension', 'max_tags',
  'max_evalue', 'diversity', 'fasta', 'entrapment_fasta', 'orientation', 'isobaric_tolerance', 'min_filter_length', 'species',
  'species_rank', 'species_evidence', 'species_min_len', 'species_use_gapped', 'species_deconvolve', 'species_max_kmer_share',
  'species_min_margin', 'species_out', 'taxdb', 'taxonomy_nodes', 'taxonomy_names', 'glyco', 'glyco_min_fraction', 'glyco_out',
  'digest_out', 'label_out', 'digest_models', 'digest_tag_min', 'digest_window', 'digest_background_share', 'digest_silac_min',
  'recon_out', 'recon_fasta', 'recon_localize', 'delta_out', 'recon_id_out',
  'massgap_out', 'massgap_window', 'massgap_window_da', 'massgap_min_spectra', 'massgap_min_share', 'massgap_min_bin',
  'massgap_max_mods', 'massgap_top', 'massgap_silac_share', 'massgap_silac_min', 'fixed_modifications', 'variable_modifications',
  'proforma', 'res_conf', 'usi_collection', 'out_spectra', 'threads'
])

/// The value option a unit option belongs to (fragment_tolerance_unit ->
/// fragment_tolerance), or undefined.
export const valueOfUnit = (unit: string): string | undefined => Object.keys(PARAM_UI).find((n) => PARAM_UI[n].unit === unit)

/// The MSFragger shortlist recipe (doc/SHORTLIST.md): what the CLI uses for
/// each of these options not named on the command line, with
/// -search_engine msfragger, -search_config_out and the tryptic shortlist
/// (FASTag.cpp msfDefault). Not validated: it passed the second held-out test
/// and failed the third.
export const MSF_RECIPE: Readonly<Record<string, string>> = {
  shortlist_gapped: 'true',
  shortlist_max_evalue: '10',
  recon_min_length: '6',
  recon_missed_cleavages: '2'
}

const textOf = (values: Record<string, unknown>, name: string): string => {
  const v = String(values[name] ?? '').trim()
  return v === '' ? listText(PARAM_BY_NAME.get(name)?.default ?? '') : v
}

/// The CLI applies the MSFragger recipe to the options not given.
export function msfRecipeOn(values: Record<string, unknown>): boolean {
  return isActive('search_config_out', values) && textOf(values, 'search_engine') === 'msfragger' && textOf(values, 'shortlist_protease') === 'trypsin'
}

/// The recipe options the form shows as a value (shortlist_gapped is a
/// switch the recipe forces on: forcedValue).
export const RECIPE_FIELDS: readonly string[] = ['shortlist_max_evalue', 'recon_min_length', 'recon_missed_cleavages']

const sameNumberText = (a: unknown, b: string): boolean => {
  const t = String(a ?? '').trim()
  return t === b || (t !== '' && Number.isFinite(Number(t)) && Number(t) === Number(b))
}

/// The note under a recipe field while the recipe holds: the value shown is
/// the one FASTag uses unless another is entered, which is then sent.
export function recipeNote(name: string, values: Record<string, unknown>): string | null {
  if (!RECIPE_FIELDS.includes(name) || !msfRecipeOn(values)) return null
  const r = MSF_RECIPE[name]
  return sameNumberText(values[name], r)
    ? `MSFragger default: FASTag uses ${r} here unless you enter another value.`
    : `MSFragger default is ${r}; this value is sent instead.`
}

/// The form after a change from @p prev to @p next: when the MSFragger
/// recipe turns on, each recipe field the user has not edited (@p edited)
/// shows the recipe's value, which is what runs; when it turns off, such a
/// field goes back to @p origin's value (the workflow's, else the manifest
/// default). An edited field keeps its value either way and is sent when it
/// differs from what the CLI would use (sentValues).
export function syncRecipe<T>(prev: Record<string, T>, next: Record<string, T>, edited: ReadonlySet<string>, origin?: Record<string, unknown>): Record<string, T> {
  const was = msfRecipeOn(prev)
  const on = msfRecipeOn(next)
  if (was === on) return next
  const out = { ...next }
  for (const n of RECIPE_FIELDS) {
    if (edited.has(n)) continue
    const back = origin && n in origin ? String(origin[n] ?? '') : listText(PARAM_BY_NAME.get(n)?.default ?? '')
    out[n] = (on ? MSF_RECIPE[n] : back) as T
  }
  return out
}

/// @p values with the recipe's value in each recipe field the CLI would
/// apply it to: the recipe holds and the field is not among @p given (a
/// run record's sent options, a preset's stored ones) and is at the
/// manifest default. What a recorded or saved run did, shown as it ran.
export function fillRecipe<T>(values: Record<string, T>, given: ReadonlySet<string>): Record<string, T> {
  if (!msfRecipeOn(values)) return values
  const out = { ...values }
  for (const n of RECIPE_FIELDS) if (!given.has(n) && !isChanged(n, values[n])) out[n] = MSF_RECIPE[n] as T
  return out
}

/// What the CLI uses for @p name when the option is not named, given the
/// rest of @p values: the manifest default, or the conditional default the
/// CLI applies instead (the MSFragger recipe).
export function cliDefault(name: string, values: Record<string, unknown>): string | string[] {
  if (msfRecipeOn(values) && Object.prototype.hasOwnProperty.call(MSF_RECIPE, name)) return MSF_RECIPE[name]
  return PARAM_BY_NAME.get(name)?.default ?? ''
}

/// A value the CLI cannot be told, and what it uses instead: a switch the
/// MSFragger recipe turns on cannot be sent as off (a flag has no "off").
/// The form shows the value it runs with, disabled, with the reason.
export function forcedValue(name: string, values: Record<string, unknown>): { value: boolean; note: string } | null {
  if (name === 'shortlist_gapped' && msfRecipeOn(values))
    return { value: true, note: 'On for MSFragger with trypsin: the shortlist recipe counts gapped placements, and FASTag cannot be told to leave them out. Choose another engine to turn it off.' }
  return null
}

/// The value differs from what the CLI would use without it (cliDefault):
/// numbers compare as numbers (10 is 10.0), an empty field is not sent.
function differsFromCli(name: string, value: unknown, values: Record<string, unknown>): boolean {
  const spec = PARAM_BY_NAME.get(name)
  if (!spec) return false
  const d = cliDefault(name, values)
  if (spec.type === 'bool') return (value === true) !== (d === 'true')
  const v = listText(value)
  const dt = listText(d)
  if (v === '' && spec.type !== 'string-list') return false
  if ((spec.type === 'int' || spec.type === 'double') && v !== '' && dt !== '' && Number.isFinite(Number(v)) && Number(v) === Number(dt)) return false
  return v !== dt
}

/// What a run sends of @p values (the rendered options only, so hidden ones
/// like -version never reach the command line):
/// - an option of ALWAYS_SENT, unless it is inert;
/// - any other option only when it differs from what the CLI would use
///   without it (cliDefault: the conditional default where the CLI has one)
///   and is live. The CLI tests whether some options were given at all
///   (optionGiven_): an explicit default changes what it does
///   (-shortlist_specificity full turns the semi-specific Asp-N export of
///   -shortlist_protease auto off, and the MSFragger recipe of -search_engine
///   applies only to options not given), so such a value goes whenever it
///   differs from what the CLI would do;
///   A value counts as set when it is a recipe field under the MSFragger
///   recipe, or differs from the manifest default or from
///   @p base, the values the session started from (the workflow's): a
///   field left at the manifest default by both is the CLI's to decide, so
///   Export tags with MSFragger names no recipe option, while Database
///   reduction with its E-value put back to 0.1 sends it;
/// - a value and its unit as one: both when either differs from its
///   default (5 with Da is not 5 ppm), neither when the value is empty (a
///   lone unit would give the CLI's default value that unit).
/// An empty ALWAYS_SENT value without a unit still goes: it asks for the
/// CLI's default.
export function sentValues<T>(values: Record<string, T>, base?: Record<string, unknown>): Record<string, T> {
  const set = (name: string, v: unknown): boolean =>
    isChanged(name, v) || (!!base && name in base && listText(base[name]) !== listText(v))
  // Under the MSFragger recipe a recipe field shows the recipe's value
  // (syncRecipe): any other value in it is the user's and is sent, even the
  // manifest default (0.1 is not the 10 the CLI would use).
  const recipe = msfRecipeOn(values)
  const out: Record<string, T> = {}
  for (const name of RENDERED) {
    if (UNIT_PARAMS.has(name)) continue
    const v = values[name]
    if (v !== undefined && (v as unknown) !== '' && inertBecause(name, values)) continue
    if (forcedValue(name, values)) continue
    const unit = unitOf(name)
    if (unit && String(v ?? '').trim() === '') continue
    const own = (set(name, v) || (recipe && RECIPE_FIELDS.includes(name))) && differsFromCli(name, v, values)
    if (!ALWAYS_SENT.has(name) && !own && !(unit && isChanged(unit, values[unit]))) continue
    if (v === undefined) continue
    out[name] = v
  }
  for (const unit of UNIT_PARAMS) {
    const of = valueOfUnit(unit)
    if (of && of in out && values[unit] !== undefined) out[unit] = values[unit]
  }
  return out
}

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
    const set = masters(d).some((n) => masterSet(d, n, values))
    if (d.replaced ? set : !set) return d
  }
  return null
}

/// Master @p n of @p d is set: by its value where the dependency names one
/// (a choice: species_call decoy), else as isActive says. An empty choice
/// reads as its default, as the CLI does.
export function masterSet(d: Dependency, n: string, values: Record<string, unknown>): boolean {
  const w = d.when?.[n]
  if (!w) return isActive(n, values)
  const v = String(values[n] ?? '').trim() || listText(PARAM_BY_NAME.get(n)?.default ?? '')
  return w.is ? w.is.includes(v) : !(w.isNot ?? []).includes(v)
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

// Labels in words for options whose CLI name reads as a flag in title case
// (Species pi0, Massgap min bin). PARAM_UI `label` wins where it is set.
const LABEL_WORDS: Record<string, string> = {
  min_filter_length: 'Shortest tag matched',
  entrapment_fasta: 'Entrapment database',
  subsample_spectra: 'Spectra to read, count',
  subsample_seed: 'Random seed',
  acquisition_probe_spectra: 'Spectra read by the DIA check',
  check_header_charge: 'Charge check mode',
  check_header_margin: 'Charge check margin',
  check_header_out: 'Charge check report',
  recon_sub_tolerance: 'Substitution tolerance',
  delta_spectra_out: 'Spectra per mass shift',
  delta_counts_out: 'Mass-shift accounting',
  delta_select: 'Placement counted',
  delta_group: 'Row width (Da)',
  delta_isobar_tolerance: 'Isobar tolerance',
  delta_isotope_flank: 'Isotope-error rows',
  delta_loc_model: 'Localization evidence',
  delta_loc_min_evidence: 'Localization margin',
  delta_loc_null: 'Localization null shift',
  delta_name_tolerance: 'Naming tolerance',
  massgap_max_mods: 'Modifications per gap',
  massgap_min_bin: 'Spectra per histogram row',
  massgap_min_share: 'Minimum share of a peak',
  massgap_min_spectra: 'Minimum spectra of a peak',
  massgap_top: 'Most frequent modifications listed',
  species_out: 'Species report file',
  species_evidence: 'Tags counted per spectrum',
  species_min_len: 'Shortest tag looked up',
  species_use_gapped: 'Count gapped tags',
  species_deconvolve: 'Subtract shared evidence',
  species_orientation: 'Tag orientation',
  species_call_decoys: 'Decoys per tag',
  species_call_min_units: 'Minimum spectra for a call',
  species_call_params: 'Call settings file',
  species_pi0: 'Share of absent taxa (pi0)',
  taxonomy_nodes: 'Taxonomy tree (nodes.dmp)',
  taxonomy_names: 'Taxonomy names (names.dmp)',
  shortlist_out: 'Protein shortlist',
  fasta_out: 'Reduced FASTA',
  search_config_out: 'Search-engine configuration',
  shortlist_min_spectra: 'Minimum spectra per protein',
  shortlist_top: 'Proteins kept at most',
  shortlist_parsimony: 'Drop subsumed proteins',
  shortlist_specificity: 'Cleavage specificity',
  shortlist_gapped: 'Count gapped placements',
  shortlist_max_evalue: 'E-value cutoff for placements',
  shortlist_force: 'Write for non-tryptic runs',
  shortlist_decoy_affix: 'Decoy name markers',
  search_config_template: 'Comet template',
  search_decoy_prefix: 'Decoy prefix',
  search_isotope_errors: 'Precursor isotope errors',
  search_missed_cleavages: 'Missed cleavages in the search',
  search_nterm_acetyl: 'Protein N-terminal acetylation',
  search_precursor_tolerance: 'Precursor tolerance',
  census_out: 'Identifiability table',
  census_summary_out: 'Identifiability summary',
  census_sorted_out: 'Spectra ranked by identifiability',
  census_ids_accept: 'Accept hits',
  census_ids_exact: 'Exact spectrum match',
  digest_out: 'Digest report',
  label_out: 'Label report',
  digest_models: 'Protease models file',
  digest_models_version: 'Protease models',
  digest_calibration: 'Calibration file',
  digest_detection: 'Per-instrument weights',
  digest_flank2: 'Use two residues before the cut',
  digest_min_confidence: 'Minimum call confidence',
  digest_tag_min: 'Minimum tag ends for a call',
  digest_window: 'Mass window at tag ends',
  digest_background_share: 'Background share',
  digest_quality: 'Cleavage quality',
  alkylation_out: 'Alkylation report',
  alkylation_tags_out: 'Alkylation from tags',
  alkylation_proteome: 'Alkylation proteome',
  alkylation_min_share: 'Minimum share for a call',
  alkylation_min_spectra: 'Minimum spectra for a call',
  alkylation_window: 'Mass window',
  glyco_out: 'Glycopeptide report file',
  glyco_min_fraction: 'Minimum oxonium intensity',
  max_peaks: 'Peaks kept',
  peaks_per_window: 'Peaks per 100 Da',
  pick_profile: 'Centroid profile spectra',
  ion_series_hybrid: 'Hybrid spectra (EThcD)',
  unknown_charge: 'Precursors without a charge',
  charge_min: 'Lowest charge tried',
  charge_max: 'Highest charge tried',
  charge_infer_margin: 'Charge margin',
  isotope_error: 'Precursor isotope error',
  complement_rule: 'Complement pairs',
  complement_tolerance: 'Complement tolerance',
  complement_tol_factor: 'Complement tolerance factor',
  complement_probe: 'Spectra for the auto window',
  complement_midp: 'Mid-p complement test',
  tmt_pseudo_filter: 'TMT pseudo-tag filter',
  tmt_reporter_filter: 'TMT reporter filter'
}

/// The CLI name in words, for the label beside it: tag_length -> Tag length.
export function humanName(name: string): string {
  const s = name.replace(/_/g, ' ')
  return uiOf(name).label ?? LABEL_WORDS[name] ?? s.charAt(0).toUpperCase() + s.slice(1)
}

/// The one line under an Advanced field (doc/GUI-WORKFLOWS.md 3): the first
/// sentence of the plain help, without option names or version history (the
/// (?) popover keeps the full text).
export function hintText(name: string, fallback: string): string {
  const text = uiOf(name).help?.text ?? fallback
  // Sentences about removed or earlier versions go; so does "(as in 1.11)".
  const kept = text
    .split(/(?<=[.!?])\s+/)
    .filter((x) => !/\b(removed|was removed)\b.*\b1\.\d|\b1\.\d+(\.\d+)?\b.*\bremoved\b/i.test(x))
  let first = (kept[0] ?? text)
    .replace(/\s*\((?:[^()]*\b(?:as in|as before|before|since|from|until|of)\s+1\.\d+(?:\.\d+)?[^()]*)\)/g, '')
    .replace(/,?\s*as before 1\.\d+(\.\d+)?/g, '')
  // A flag or snake_case option name reads as its label.
  first = first.replace(/-?\b([a-z]+(?:_[a-z0-9]+)+)\b/g, (m, n: string) => (PARAM_BY_NAME.has(n) ? humanName(n).toLowerCase() : m))
  return first.trim()
}

/// The line under an Advanced field when no curated hint (BRIEF_HINT, a
/// workflow's own) is given: hintText up to its first clause break (a
/// colon, a semicolon, a bracket, ", because ..."), as a sentence, when that
/// fits one line. A break inside quotes is no break. A hint that does not
/// fit is not cut into a fragment: the field shows none, and the full text
/// stays the tooltip and the (?) popover's.
export const BRIEF_MAX = 70
export function briefHint(text: string): string {
  const t = text.trim()
  const quoted = (i: number): boolean => ((t.slice(0, i).match(/["“”]/g) ?? []).length % 2 === 1) || ((t.slice(0, i).match(/(^|\s)'/g) ?? []).length > (t.slice(0, i).match(/'(\s|[.,;:]|$)/g) ?? []).length)
  const re = /(?:[:;]\s|\s\(|,\s(?:because|so|and|but|which|while|as|for|or)\s|\s(?:—|–)\s)/g
  re.lastIndex = 20
  let s = t
  for (let m = re.exec(t); m; m = re.exec(t)) {
    if (quoted(m.index)) continue
    const cut = t.slice(0, m.index).replace(/[,\s]+$/, '')
    s = /[.!?]$/.test(cut) ? cut : `${cut}.`
    break
  }
  return s.length <= BRIEF_MAX ? s : ''
}

/// Curated one-line hints, the same in Settings and in Advanced (a
/// workflow's own hint, tasks.ts help, comes first in its Settings card and
/// in its Advanced groups alike).
export const BRIEF_HINT: Record<string, string> = {
  // Tagging
  tag_length: 'Residues in a seed tag; 3 suits most runs.',
  extension: 'Residues read on past each end of a seed; 0 reads none.',
  max_evalue: 'Keeps tags at or below this E-value; 0 keeps all.',
  max_tags: 'Most tags per spectrum; 0 sets no limit.',
  res_conf: 'Adds a confidence per residue for assembly.',
  tag_lengths: 'Several seed lengths in one pass, in place of Tag length.',
  diversity: 'Prefers tags from other peaks over near-copies of a kept tag.',
  isobaric_tolerance: 'Lets a residue stand for a pair of the same mass (N for GG).',
  gaps: 'Lets a tag cross one missing peak.',
  gap_penalty: 'Ranks a gapped tag below an ungapped one of the same E-value.',
  fixed_modifications: 'Modifications every residue of that kind carries.',
  ion_series: 'The ions the spectra are read as: b/y, c/z, or by activation.',
  ion_series_hybrid: 'How EThcD and ETciD spectra are read under Ion series auto.',
  unknown_charge: 'How a precursor without a charge in the file is tagged.',
  subsample_fraction: 'Tags only this share of the spectra, chosen at random.',
  threads: 'Processor threads a run uses; 0 uses half the logical cores.',
  // Tag columns and files
  proforma: 'Adds each tag in ProForma 2.0 notation.',
  usi_collection: 'Adds each spectrum’s USI in this dataset (e.g. PXD000001).',
  out_spectra: 'Also writes the spectra that carry a reported tag.',
  // Sampling and checks
  acquisition_check: 'What happens to raw DIA input: refuse, warn or no check.',
  acquisition_probe_spectra: 'MS2 spectra the acquisition check reads.',
  check_header_charge: 'Checks the precursor charge the file gives.',
  check_header_margin: 'How clearly the supported charge must win to disagree.',
  check_header_out: 'One row per spectrum with the charge check’s verdict.',
  // Run QC
  qc_out: 'Spectra, resolution, charges, reporters and tag yield per run.',
  // Placement and mass shifts
  recon_out: 'Places each tag in the database’s peptides, one row each.',
  recon_missed_cleavages: 'Missed trypsin sites a database peptide may hold, up to 10.',
  recon_localize: 'Pins each leftover mass to one residue, by its fragment peaks.',
  recon_sub_tolerance: 'How close a leftover mass must be to a substitution.',
  delta_isobar_tolerance: 'How close two explanations of a shift must be to be isobars.',
  delta_loc_min_evidence: 'How much the best site must lead to count as localized.',
  delta_loc_null: 'Repeats the localization on shifted peaks, as a chance check.',
  delta_name_tolerance: 'How close a shift must be to a UniMod or PSI-MOD entry.',
  massgap_window: 'How close a leftover mass must be to a modification (ppm runs).',
  // Species
  species: 'Which organisms the tags come from, from the bundled index.',
  species_call: 'Calls each taxon present, no call or not detected.',
  species_deconvolve: 'Removes evidence an organism gets only from a stronger one.',
  species_max_kmer_share: 'Ignores protein pieces shared by too many organisms.',
  species_min_margin: 'Ignores a tag whose best organisms do not clearly lead.',
  species_call_min_units: 'Fewer spectra with organism evidence give no call at all.',
  species_pi0: 'The share of absent organisms the call’s q-values assume.',
  // Shortlist and search configuration
  shortlist_background: 'Proteins always added to the reduced FASTA (host, contaminants).',
  shortlist_parsimony: 'Drops proteins whose spectra a higher one already has.',
  shortlist_force: 'Writes the reduced FASTA even when the protease does not fit.',
  search_nterm_acetyl: 'Protein N-terminal acetylation as a variable modification.',
  // Identifiability
  census: 'One row per MS2 spectrum read, tagged or not, and a run summary.',
  census_ids_fdr: 'The q-value a hit needs for its spectrum to count as identified.',
  census_triage_evalue: 'An unidentified spectrum with a tag this good is marked.',
  // Digest and labels
  digest_flank2: 'Also uses two residues before each cut when counts are few.',
  digest_min_confidence: 'No digest call below this calibrated confidence; 0 is off.',
  digest_window: 'How close a tag-end mass must be to a residue or label mass.',
  digest_background_share: 'Background composition mixed into every protease model.',
  digest_silac_min: 'K and R tag ends the label report needs for heavy SILAC.',
  // Alkylation and glycopeptides
  alkylation_proteome: 'The database the alkylation report uses without a placement one.',
  glyco: 'Flags spectra with oxonium ions (glycopeptide sugar fragments).',
  // Peaks, charges and complements
  peaks_per_window: 'Keeps this many of the strongest peaks per 100 Da.',
  charge_min: 'The lowest charge tried for a precursor without a charge.',
  charge_max: 'The highest charge tried for a precursor without a charge.',
  charge_infer_margin: 'How clearly one charge must win to be tagged alone.',
  isotope_error: 'Also tries precursor masses one or more isotopes lower.',
  complement_tolerance_unit: 'The complement window: in Da, by fragment tolerance, or auto.',
  complement_midp: 'Scores tags with few complement pairs by the mid-p test.',
  tmt_pseudo_filter: 'Filters G/A steps consistent with TMT label fragments.',
  tmt_reporter_filter: 'Rejects tags anchored on a TMT reporter ion.'
}

// The words a choice is shown as; the CLI token is what is sent.
const CHOICE_WORDS: Record<string, string> = {
  sage: 'Sage',
  comet: 'Comet',
  msfragger: 'MSFragger',
  'lys-c': 'Lys-C',
  'arg-c': 'Arg-C',
  'asp-n': 'Asp-N',
  'glu-c': 'Glu-C',
  'lys-n': 'Lys-N',
  assume2: 'Assume 2+',
  enumerate: 'Try each charge',
  infer: 'Infer from fragments',
  by: 'b/y ions',
  cz: 'c/z ions',
  ax: 'a/x ions',
  both: 'Both',
  ppm: 'ppm',
  Da: 'Da',
  idXML: 'idXML',
  mzid: 'mzIdentML',
  mzTab: 'mzTab',
  tsv: 'TSV'
}

/// A choice of @p name in words: Sage for sage, Lys-C for lys-c, Genus for
/// genus. Units and formats keep their spelling.
export function choiceText(name: string, choice: string): string {
  if (UNIT_PARAMS.has(name)) return choice
  // The choice that is not sent: the CLI decides (shortlist_specificity).
  if (choice === '') return 'Automatic'

  if (Object.prototype.hasOwnProperty.call(CHOICE_WORDS, choice)) return CHOICE_WORDS[choice]
  const s = choice.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const listText = (v: unknown): string =>
  (Array.isArray(v) ? v.map((x) => String(x).trim()).filter((x) => x !== '').join('\n') : String(v ?? '').trim())

/// The manifest default as the form shows it: off for a switch, "not set" for
/// an empty one.
export function defaultText(spec: ParamSpec): string {
  if (spec.type === 'bool') return spec.default === 'true' ? 'on' : 'off'
  const d = listText(spec.default).replace(/\n/g, ', ')
  if (d === '' && spec.choices?.includes('')) return 'automatic'
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
  /// The input file (its format: the CLI refuses some options on mzPeak).
  input?: string
  /// The inputs queued in a batch: checked as @p input is, each.
  inputs?: readonly string[]
}

export interface Conflict {
  /// The parameters involved, CLI names. The first is the one to change.
  params: string[]
  /// Why the CLI would refuse, phrased like the CLI's own message.
  note: string
  /// A required input not chosen yet, not a wrong value: shown in a
  /// neutral colour (a fresh form is no error).
  neutral?: true
  /// The one-click change that resolves it.
  fix?: { label: string; values: Record<string, ParamValue> }
  /// Another one, beside it.
  alt?: { label: string; values: Record<string, ParamValue> }
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

/// The longest seed the CLI tags at (tag_lengths replaces tag_length), or
/// null when none is a whole number.
export function longestSeed(values: Record<string, unknown>): number | null {
  const { lengths } = seedLengths(values)
  return lengths.length ? lengths[lengths.length - 1] : null
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

/// The fragment tolerance in Da as the CLI checks it for isotope offsets
/// (PrecursorHypotheses.cpp: ppm at 1000 m/z).
function fragmentDa(values: Record<string, unknown>): number | null {
  const t = Number(textOf(values, 'fragment_tolerance'))
  if (!Number.isFinite(t)) return null
  return textOf(values, 'fragment_tolerance_unit') === 'ppm' ? t * 1000 * 1e-6 : t
}
const ISOTOPE_MAX_FRAGMENT_TOL_DA = 0.05
const isMzPeak = (input: string | undefined): boolean => /\.mzpeak[\\/]?$/i.test(String(input ?? '').trim())
/// The mzPeak files among the single input and a batch's queued inputs.
function mzPeakInputs(ctx: PreflightContext): string[] {
  return [...new Set([ctx.input, ...(ctx.inputs ?? [])].filter((p): p is string => isMzPeak(p)))]
}
/// "an mzPeak file is read in one pass", naming a batch's files.
function onePass(ctx: PreflightContext, files: string[]): string {
  if (!ctx.inputs?.length) return 'an mzPeak file is read in one pass'
  const names = files.map((p) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p)
  const shown = names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ')
  return `mzPeak files are read in one pass (${shown} in this batch)`
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
      ? { params: ['recon_fasta', 'recon_out', 'fasta'], note: 'The placements need a protein database: choose one under Protein database.', neutral: true }
      : null,
  // "-shortlist_out needs a database: give -recon_fasta (or -fasta)."
  (values) =>
    ['shortlist_out', 'fasta_out', 'search_config_out'].some((n) => isActive(n, values)) && !isActive('recon_fasta', values) && !isActive('fasta', values)
      ? { params: ['recon_fasta', 'shortlist_out', 'fasta'], note: 'The shortlist needs a protein database: choose one under Protein database.', neutral: true }
      : null,
  // "-tmt_reporter_filter requires -tmt_pseudo_filter auto or on."
  (values) =>
    isActive('tmt_reporter_filter', values) && textOf(values, 'tmt_pseudo_filter') === 'off'
      ? {
          params: ['tmt_pseudo_filter', 'tmt_reporter_filter'],
          note: 'The TMT reporter filter needs the TMT pseudo-tag filter on auto or on. Set it to auto or on, or turn the reporter filter off.'
        }
      : null,
  // "-census_ids_exact needs every spectrum read: it cannot be combined with subsampling."
  (values) =>
    !inertBecause('census_ids_exact', values) && isActive('census_ids_exact', values) && (isActive('subsample_fraction', values) || isActive('subsample_spectra', values))
      ? {
          params: ['subsample_fraction', 'census_ids_exact', 'subsample_spectra'],
          note: 'census_ids_exact needs every spectrum read: it cannot be combined with subsampling. Set Spectra to read to All, or turn exact matching off.'
        }
      : null,
  // "-search_config_template is a `comet -p` parameter file; it needs
  // -search_engine comet": no entry here, the template depends on Comet
  // (paramUi.ts), so a template left over from Comet is inert and not sent.
  // "-isotope_error other than 0 needs a high-resolution fragment tolerance
  // (below 0.05 Da, or the ppm equivalent at 1000 m/z)".
  (values) => {
    const raw = values['isotope_error']
    const list = (Array.isArray(raw) ? raw : String(raw ?? '').split(/[\s,]+/)).map((x) => String(x).trim()).filter(Boolean)
    if (!list.some((k) => Number(k) !== 0)) return null
    const da = fragmentDa(values)
    if (da === null || da < ISOTOPE_MAX_FRAGMENT_TOL_DA) return null
    return {
      params: ['isotope_error', 'fragment_tolerance'],
      note: `Isotope offsets other than 0 need a high-resolution fragment tolerance, below 0.05 Da (50 ppm at 1000 m/z); this run's is ${Number(da.toPrecision(3))} Da. Set Isotope error to 0, or lower the fragment tolerance.`,
      fix: { label: 'Set Isotope error to 0', values: { isotope_error: ['0'] } }
    }
  },
  // "-complement_tolerance_unit auto needs mzML or MGF input; mzPeak input
  // is read in one pass."
  (values, ctx) => {
    const mz = mzPeakInputs(ctx)
    return mz.length && textOf(values, 'complement_tolerance_unit') === 'auto'
      ? {
          params: ['complement_tolerance_unit'],
          note: `Complement tolerance unit auto needs mzML or MGF input: ${onePass(ctx, mz)}. Choose Da or fragment.`,
          fix: { label: 'Use Da', values: { complement_tolerance_unit: 'Da' } }
        }
      : null
  },
  // "-tmt_pseudo_filter auto needs random-access mzML or MGF input".
  // With the reporter filter on, off alone would raise the reporter-filter
  // conflict: on, or both filters off, in one click.
  (values, ctx) => {
    const mz = mzPeakInputs(ctx)
    if (!mz.length || textOf(values, 'tmt_pseudo_filter') !== 'auto') return null
    const reporter = isActive('tmt_reporter_filter', values)
    return {
      params: ['tmt_pseudo_filter'],
      note: `TMT pseudo-tag filter auto needs mzML or MGF input: ${onePass(ctx, mz)}. Choose on for known TMT6/10 input, or off.`,
      fix: reporter
        ? { label: 'Use on (known TMT6/10)', values: { tmt_pseudo_filter: 'on' } }
        : { label: 'Turn the TMT filter off', values: { tmt_pseudo_filter: 'off' } },
      ...(reporter ? { alt: { label: 'Turn both TMT filters off', values: { tmt_pseudo_filter: 'off', tmt_reporter_filter: false } } } : {})
    }
  },
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
