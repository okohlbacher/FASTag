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
// TOPPBase boilerplate (log, debug, force, test, ...) and FASTag options such
// as digest_*, massgap_* and mzpeak_read_memory, yet leaves deep internals like
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
  /// Its parameters, in form order: the PARAM_UI entries naming this
  /// section, in table order.
  params: string[]
}

/// The form, in the order the run happens: what is read, what is tagged, what
/// the tags are then compared against, and what comes out.
///
/// One flat list of sections, grouped by content. There is no core-vs-advanced
/// split: nothing in the tool supports that judgement.
const SECTION_DEFS: Omit<Section, 'params'>[] = [
  {
    title: 'Spectra',
    blurb: 'Which spectra are read, and which peaks survive preprocessing.',
    open: false
  },
  {
    title: 'Tagging',
    blurb: 'The tags themselves: how long, how tolerant, how many per spectrum.',
    open: true
  },
  {
    title: 'Sequence matching',
    blurb: 'Keep only tags that occur in sequences you supply.',
    open: false,
    master: 'fasta'
  },
  {
    title: 'Species detection',
    blurb: 'Infer which taxa are present from the tags, using the species index bundled with FASTag (or one you supply).',
    open: false,
    master: 'species'
  },
  {
    title: 'Glycopeptides',
    blurb: 'Flag spectra carrying oxonium ions.',
    open: false,
    master: 'glyco'
  },
  {
    title: 'Digest and labels',
    blurb: 'Report the terminal residues of the tags, the protease they fit and the labels they carry. Both reports are shown in the Digest tab.',
    open: false
  },
  {
    title: 'Reconciliation',
    blurb: 'Place tags in database peptides and report the mass left over. The mass-gap report (massgap_out) is shown in the Digest tab.',
    open: false,
    master: 'recon_out'
  },
  {
    title: 'Modifications',
    blurb: 'Residue masses used when spelling and matching tags.',
    open: false
  },
  {
    title: 'Output',
    blurb: 'Extra columns and extra files beside the tag list.',
    open: false
  },
  {
    title: 'Performance',
    blurb: 'How much of the computer a run may use.',
    open: false
  }
]

export const SECTIONS: Section[] = SECTION_DEFS.map((s) => ({
  ...s,
  params: Object.keys(PARAM_UI).filter((n) => PARAM_UI[n].section === s.title)
}))

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
  const titles = new Set(SECTION_DEFS.map((s) => s.title))
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
    ...SECTION_DEFS.flatMap((s) => (s.master ? [s.master] : []))
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

// ---------------------------------------------------------------------------
// Hidden dependent fields (GUI-DESIGN 3 S1, P2a): a field that waits for its
// section's switch (species, glyco, fasta, recon_out) stays hidden until the
// switch is on, and the switch says once what it turns on, in place of one
// "Needs species" line per field. A field that waits for anything else
// (gap_penalty for gaps, digest_models for digest_out) is still shown,
// disabled, with what it needs.

/// The parameters of @p sec that its master switch turns on: those with a
/// dependency on it.
export function dependents(sec: Section): string[] {
  if (!sec.master) return []
  return sec.params.filter((n) => n !== sec.master && dependsOf(n).some((d) => !d.replaced && masters(d).includes(sec.master!)))
}

/// @p name is hidden right now: its first unmet dependency names the master
/// of @p sec.
export function hiddenUntilMaster(name: string, sec: Section, values: Record<string, unknown>): boolean {
  if (!sec.master || name === sec.master) return false
  const d = inertDependency(name, values)
  return !!d && !d.replaced && masters(d).includes(sec.master)
}

/// The section a parameter is in.
export const SECTION_OF: Map<string, Section> = new Map(SECTIONS.flatMap((s) => s.params.map((n) => [n, s] as [string, Section])))
