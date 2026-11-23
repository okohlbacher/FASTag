// What a task needs as input (doc/GUI-SETUP-WIZARD.md 3, step 2, and 5.2):
// pure functions over tasks.ts, the manifest and the form's values. Nothing
// here is state: the wizard derives the inputs step 2 shows, the step badges
// and the carry-over of a form replacement from these on every render.

import { PARAM_BY_NAME, PARAMS, SECTIONS, dependsOf, humanName, masters, sectionByTitle } from '../paramLayout'
import type { ParamValue } from '../ParamField'
import { sameValue } from '../app/format'
import type { Task } from './tasks'
import { diffNames, sameSetting } from './presetDiff'
import { PRODUCTS, isOn } from './products'

type V = Record<string, ParamValue | unknown>

/// Where an input file of the CLI lives in the wizard. `step2`: an input
/// step 2 may show (required, optional or "Also set"); `setting`: beside the
/// setting it depends on (the Comet template, under Search engine);
/// `advanced`: a model or parameter table, under Advanced only; `hidden`:
/// no field (the spectra have their own control; probe_input is the
/// inspector's; species_reagents is removed).
export type InputPlace = 'step2' | 'setting' | 'advanced' | 'hidden'

export interface InputInfo {
  place: InputPlace
  /// The name in the Add optional input menu (default: the field's label).
  label?: string
  /// Its effect on the results, first: the line under the field and in the
  /// menu. Absent where the field's own hint says it (PARAM_UI, tasks.ts).
  why?: string
  /// Other inputs that are one set with it (the CLI takes all or none):
  /// revealed and removed together.
  also?: string[]
  /// A member of the set of another input.
  partOf?: string
  /// Offered only once this input is set.
  after?: string
  /// Not used in Batch mode, and why.
  oneFileOnly?: string
}

/// Every input-file parameter of the manifest, classified once (a unit test
/// checks that none is missing).
export const INPUTS: Record<string, InputInfo> = {
  in: { place: 'hidden' },
  probe_input: { place: 'hidden' },
  species_reagents: { place: 'hidden' },
  fasta: { place: 'step2', label: 'Filter database', why: 'Removes tags not found in these proteins.' },
  entrapment_fasta: {
    place: 'step2',
    label: 'Entrapment database',
    why: 'Adds a false-match rate from proteins the sample cannot contain.',
    after: 'fasta'
  },
  recon_fasta: { place: 'step2', label: 'Protein database', why: 'A protein FASTA of your organism, for example its UniProt reference proteome.' },
  shortlist_background: { place: 'step2', label: 'Background proteins', why: 'Always kept in the reduced FASTA: host and contaminant proteins.' },
  census_ids: {
    place: 'step2',
    label: 'Identifications',
    why: "Marks the spectra your search identified: this run's idXML or mzIdentML, with q-values.",
    oneFileOnly: 'Not used in Batch mode: one ID file cannot belong to every input.'
  },
  // The Taxonomy group's own blurb says what the set does.
  taxdb: { place: 'step2', label: 'Your taxonomy', why: sectionByTitle('Taxonomy')?.blurb, also: ['taxonomy_nodes', 'taxonomy_names'] },
  taxonomy_nodes: { place: 'step2', partOf: 'taxdb' },
  taxonomy_names: { place: 'step2', partOf: 'taxdb' },
  search_config_template: { place: 'setting' },
  digest_models: { place: 'advanced' },
  digest_calibration: { place: 'advanced' },
  species_call_params: { place: 'advanced' }
}

/// The CLI's rule "give -recon_fasta (or -fasta)": the Filter database
/// stands in for the Protein database (paramLayout CONFLICTS).
export const STANDS_IN: Record<string, string> = { recon_fasta: 'fasta' }

/// The first inputs of their set that step 2 offers (taxdb, not its nodes).
const PRIMARY_STEP2 = Object.keys(INPUTS).filter((n) => INPUTS[n].place === 'step2' && !INPUTS[n].partOf)

/// The set of @p name: itself and the inputs it goes with.
export const setOf = (name: string): string[] => [name, ...(INPUTS[name]?.also ?? [])]
const primaryOf = (name: string): string => INPUTS[name]?.partOf ?? name

export const hasValue = (values: V, name: string): boolean => {
  const v = values[name]
  return Array.isArray(v) ? v.some((x) => String(x).trim() !== '') : typeof v === 'string' ? v.trim() !== '' : false
}
const setHasValue = (values: V, name: string): boolean => setOf(name).some((n) => hasValue(values, n))

/// The products on in @p values that need the protein database (products.ts db).
const dbProductsOn = (values: V): string[] => PRODUCTS.filter((p) => p.db && isOn(p, values as never)).map((p) => p.label)

/// The inputs @p task requires: its own and, with @p values, the Protein
/// database while a report that needs it is on (Tag placements turned on
/// under Advanced in Characterize): what is needed follows the products,
/// not only the task.
export function requiredInputs(task: Task | null, values?: V): string[] {
  const req = task?.required ?? []
  if (!values || req.includes('recon_fasta') || !dbProductsOn(values).length) return req
  return [...req, 'recon_fasta']
}

/// What requires the input @p name: the task, or the reports that need it.
export function requiredBy(task: Task | null, values: V, name: string): string {
  if ((task?.required ?? []).includes(name)) return task!.label
  return name === 'recon_fasta' ? dbProductsOn(values).join(', ') || (task?.label ?? 'this run') : (task?.label ?? 'this run')
}

/// The input @p name stands in for in @p task (fasta for its required
/// recon_fasta), or null.
const standsInFor = (task: Task | null, name: string): string | null => (task?.required ?? []).find((r) => STANDS_IN[r] === name) ?? null

/// The menu and field label of an input. With @p task, a stand-in says
/// what it also does there.
export const inputLabel = (name: string, task: Task | null = null): string => {
  const label = INPUTS[name]?.label ?? humanName(name)
  const forName = standsInFor(task, name)
  return forName ? `${label} (also the ${inputLabel(forName)} while that is empty)` : label
}

/// The primary inputs @p task shows in step 2: required (with @p values:
/// also what its reports need), the stand-ins of its own required inputs,
/// the optional ones and the inputs offered after one of these (the
/// entrapment database after the Filter database). No task (the FASTag
/// defaults): every step-2 input.
export function primaryInputs(task: Task | null, values?: V): string[] {
  if (!task) return PRIMARY_STEP2
  const req = task.required ?? []
  const own = [...requiredInputs(task, values), ...req.flatMap((n) => (STANDS_IN[n] ? [STANDS_IN[n]] : [])), ...(task.optionalInputs ?? [])]
  const later = PRIMARY_STEP2.filter((n) => !own.includes(n) && !!INPUTS[n].after && own.includes(INPUTS[n].after!))
  return [...own, ...later]
}

/// Every input-file parameter step 2 owns for @p task (with @p values:
/// also what its reports need), sets expanded.
export function inputParams(task: Task | null, values?: V): Set<string> {
  return new Set(primaryInputs(task, values).flatMap(setOf))
}

/// The settings that describe the sample, step 2's "About these spectra":
/// the common block (as the Instrument select and Fixed modifications) and
/// the task's own about fields.
export const COMMON_BLOCK = ['fragment_tolerance', 'fragment_tolerance_unit', 'ion_series', 'ion_series_hybrid', 'fixed_modifications']
export const aboutParams = (task: Task | null): string[] => task?.about ?? []

/// Settings under Advanced that depend on nothing but a step-2 input of
/// @p task (Shortest tag matched on the Filter database): they render under
/// that input in step 2 once it is set, and leave Advanced. Keyed by input.
export function stepTwoDependents(task: Task | null, candidates: readonly string[], values?: V): Map<string, string[]> {
  const own = inputParams(task, values)
  const out = new Map<string, string[]>()
  for (const n of candidates) {
    if (own.has(n)) continue
    const deps = dependsOf(n)
    if (!deps.length) continue
    const ms = [...new Set(deps.flatMap(masters))]
    if (ms.length !== 1 || !own.has(ms[0]) || deps.some((d) => d.replaced || d.say)) continue
    const key = primaryOf(ms[0])
    out.set(key, [...(out.get(key) ?? []), n])
  }
  return out
}

export interface TaskInputs {
  /// Required inputs, in order.
  required: string[]
  /// Optional inputs (and stand-ins) that hold a value, or were revealed.
  shown: string[]
  /// Optional inputs the Add optional input menu offers now.
  addable: string[]
  /// Inputs that hold a value but have no control for the task, or are not
  /// usable in this mode, with why.
  extraneous: { name: string; why: string }[]
}

/// The inputs step 2 shows for @p task. @p revealed: optional inputs the
/// user opened that hold no value yet. @p elsewhere: the inputs with a
/// field in another step (advancedParams): a value there is the user's
/// setting, sent and shown where it is set, not an "Also set" entry.
export function taskInputs(
  task: Task | null,
  values: V,
  mode: 'one' | 'batch',
  revealed: ReadonlySet<string> = new Set(),
  elsewhere: ReadonlySet<string> = new Set()
): TaskInputs {
  const required = requiredInputs(task, values)
  const own = primaryInputs(task, values)
  const shown: string[] = []
  const addable: string[] = []
  const extraneous: { name: string; why: string }[] = []
  for (const n of own) {
    if (required.includes(n)) continue
    const info = INPUTS[n]
    const set = setHasValue(values, n)
    if (mode === 'batch' && info?.oneFileOnly) {
      if (set) extraneous.push({ name: n, why: info.oneFileOnly })
      continue
    }
    // A stand-in (the Filter database of Mass-shift survey) is an optional
    // input like any other: its menu entry says that it stands in.
    if (set || revealed.has(n)) shown.push(n)
    else if (!info?.after || setHasValue(values, info.after)) addable.push(n)
  }
  for (const n of PRIMARY_STEP2) {
    if (own.includes(n) || !setHasValue(values, n)) continue
    const info = INPUTS[n]
    if (mode === 'batch' && info.oneFileOnly) {
      extraneous.push({ name: n, why: info.oneFileOnly })
      continue
    }
    if (setOf(n).some((m) => elsewhere.has(m))) continue
    extraneous.push({ name: n, why: `Not used by ${task?.label ?? 'this run'}, but sent: ${INPUTS[n].why ?? humanName(n)}` })
  }
  return { required, shown, addable, extraneous }
}

/// A required input is satisfied: set, or its stand-in is.
export const satisfied = (values: V, name: string): boolean => hasValue(values, name) || (!!STANDS_IN[name] && hasValue(values, STANDS_IN[name]))

/// What a run of @p task still needs, by name ('in' for the spectra).
export function missingInputs(task: Task | null, values: V, ctx: { input: string; jobs: number; mode: 'one' | 'batch' }): string[] {
  const miss: string[] = []
  if (ctx.mode === 'batch' || ctx.jobs > 0 ? ctx.jobs === 0 : !ctx.input) miss.push('in')
  for (const n of requiredInputs(task, values)) if (!satisfied(values, n)) miss.push(n)
  return miss
}

/// The one-word names of what is missing ("spectra", "Protein database").
export const missingText = (names: string[]): string => names.map((n) => (n === 'in' ? 'spectra' : inputLabel(n))).join(', ')

/// A warning when @p path does not end in one of the formats the manifest
/// lists for @p name (a .gz of them allowed). Not a block: the CLI decides.
export function extensionWarning(name: string, path: string): string | null {
  const formats = PARAM_BY_NAME.get(name)?.formats
  const p = path.trim()
  if (!formats?.length || !p) return null
  const lower = p.toLowerCase().replace(/\.gz$/, '')
  if (formats.some((f) => lower.endsWith(`.${f.toLowerCase()}`))) return null
  const file = p.split(/[\\/]/).pop() ?? p
  const kind = formats.every((f) => /^(fasta|fa|faa)$/i.test(f)) ? 'a FASTA file' : `a ${formats.join(' or ')} file`
  return `${file} is not ${kind} (${formats.map((f) => `.${f}`).join(', ')}).`
}

export type Step = 1 | 2 | 3 | 4
export const STEPS: readonly { n: Step; name: string }[] = [
  { n: 1, name: 'Task' },
  { n: 2, name: 'Inputs' },
  { n: 3, name: 'Settings' },
  { n: 4, name: 'Outputs & run' }
]
export type StepState = 'current' | 'done' | 'blocked' | 'todo' | 'locked'

/// Each step's state. Only "no task confirmed" locks a step; a step with
/// an error shows it (blocked) and stays reachable.
export function stepState(ctx: {
  confirmed: boolean
  step: Step
  /// Step 2's errors: missing inputs, inputs not found, inputs not part of the task.
  inputErrors: number
  /// Step 3's: values the CLI would refuse.
  settingErrors: number
  /// Step 4's: no run name for the one file.
  outputErrors: number
}): Record<Step, StepState> {
  const errs: Record<Step, number> = { 1: 0, 2: ctx.inputErrors, 3: ctx.settingErrors, 4: ctx.outputErrors }
  const st = {} as Record<Step, StepState>
  for (const { n } of STEPS) {
    if (n > 1 && !ctx.confirmed) st[n] = 'locked'
    else if (n === ctx.step) st[n] = errs[n] > 0 ? 'blocked' : 'current'
    else if (errs[n] > 0) st[n] = 'blocked'
    else if (n === 1 ? ctx.confirmed : n < ctx.step) st[n] = 'done'
    else st[n] = 'todo'
  }
  return st
}

export interface Carried {
  values: Record<string, ParamValue>
  /// Labels of what was kept, dropped and how many settings were replaced.
  kept: string[]
  dropped: string[]
  replaced: number
}

/// A form replacement (a task, preset, last-used, defaults, Reset) keeps
/// what does not belong to the workflow (doc/GUI-SETUP-WIZARD.md 4): the
/// input files @p task uses, when @p next holds none; with @p common, the
/// common block the user changed from @p prevOrigin. The rest of @p next
/// replaces @p prev; @p replaced counts the user's changes it replaced.
export function carryInputs(
  prev: Record<string, ParamValue>,
  next: Record<string, ParamValue>,
  task: Task | null,
  prevOrigin: Record<string, ParamValue>,
  common = true
): Carried {
  const values = { ...next }
  const kept: string[] = []
  const dropped: string[] = []
  const own = inputParams(task)
  for (const n of PRIMARY_STEP2) {
    const set = setOf(n)
    if (!set.some((m) => hasValue(prev, m))) continue
    if (set.some((m) => hasValue(next, m))) continue
    if (set.some((m) => own.has(m))) {
      for (const m of set) values[m] = prev[m]
      kept.push(inputLabel(n))
    } else dropped.push(inputLabel(n))
  }
  const keptCommon: string[] = []
  if (common)
    for (const n of COMMON_BLOCK) {
      if (sameValue(prev[n], prevOrigin[n]) || sameValue(prev[n], next[n])) continue
      values[n] = prev[n]
      keptCommon.push(n)
    }
  if (keptCommon.some((n) => n !== 'fixed_modifications')) kept.unshift('instrument')
  if (keptCommon.includes('fixed_modifications')) kept.splice(kept[0] === 'instrument' ? 1 : 0, 0, 'fixed modifications')
  // The user's own changes (as the footer counts them) that the new values
  // do not hold.
  const changed = diffNames(prevOrigin, prev).filter((n) => !INPUTS[n] && !COMMON_BLOCK.includes(n) && !sameSetting(n, prev[n], values[n]))
  return { values, kept, dropped, replaced: changed.length }
}

/// The status line of a replacement: "Kept: … Dropped for Species: …
/// Replaced: 3 settings of Generate tags."
export function carriedText(c: Omit<Carried, 'values'>, to: string, from: string): string {
  const parts: string[] = []
  if (c.kept.length) parts.push(`Kept: ${c.kept.join(', ')}.`)
  if (c.dropped.length) parts.push(`Dropped for ${to}: ${c.dropped.join(', ')}.`)
  if (c.replaced) parts.push(`Replaced: ${c.replaced} ${c.replaced === 1 ? 'setting' : 'settings'} of ${from}.`)
  return parts.join(' ')
}

/// Every input-file parameter of the manifest (for the coverage test).
export const MANIFEST_INPUTS = PARAMS.filter((p) => p.type === 'input-file').map((p) => p.name)
/// The Advanced sections, re-exported for the dependents' candidates.
export const ALL_SECTION_PARAMS = SECTIONS.flatMap((s) => s.params)
