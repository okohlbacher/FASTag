// The session (GUI-DESIGN 5 sessionStore, P1 PR c; moved from App.tsx): the
// input and output, the form's values, the last-used offer (D6), presets and
// what a run with these values would send.

import { useEffect, useRef, useState, type SetStateAction } from 'react'
import {
  PARAM_BY_NAME,
  RENDERED,
  RECIPE_FIELDS,
  conflicts,
  fillRecipe,
  inertBecause,
  invalidParams,
  isChanged,
  msfRecipeOn,
  speciesReach,
  syncRecipe,
  type ParamSpec
} from '../paramLayout'
import type { ParamValue } from '../ParamField'
import { baseName } from '../digestReport'
import { applyInstrument, INSTRUMENTS, speciesFixes } from './presets'
import { renameSearchConfig } from './products'
import { defaultSpeciesOut, dirName, rebaseOutputs, stripExt } from '../app/paths'
import { cliText, sameValue } from '../app/format'
import { focusLater } from '../app/focus'
import { DEFAULTS, LAST_WORKFLOW, baseOf, baseValues, originText, startValues, taskById, taskOf, type Origin, type TaskId } from './tasks'
import { applyPreset as presetValues, diffNames, droppedPaths, normalizePreset, presetDiff } from './presetDiff'
import { carryInputs, carriedText, missingInputs, setOf, type Step } from './inputs'
import { LANDING_TASK } from './tasks'

// Initial form state IS the tool's own defaults, straight from the manifest.
export function initialValues(): Record<string, ParamValue> {
  const v: Record<string, ParamValue> = {}
  for (const [name, spec] of PARAM_BY_NAME) {
    if (spec.type === 'string-list') v[name] = Array.isArray(spec.default) ? spec.default : []
    else if (spec.type === 'bool') v[name] = spec.default === 'true'
    else v[name] = String(spec.default ?? '')
  }
  return v
}

/// The value of the "Starting from" select for @p o: '' for the defaults,
/// builtin:<task>, or a preset's own name.
export function originKey(o: Origin): string {
  return o.kind === 'defaults' ? '' : o.kind === 'builtin' ? `builtin:${o.id}` : o.name
}

// What a task or preset replaced, for Undo (GUI-DESIGN 5 undoSnapshot).
interface Snapshot {
  values: Record<string, ParamValue>
  origin: Origin
  originValues: Record<string, ParamValue>
  // The recipe fields the user edited (fillRecipe keeps them).
  edited: Set<string>
}

/// @p start: where the session's values come from (D1: the app passes the
/// task "Export tags"; the hook alone starts from the defaults).
/// What the last form replacement kept and dropped (step 2's status line).
export interface CarryNote {
  text: string
  /// A gen of the form: the note goes with the next replacement.
  gen: number
}

export function useSession(start: Origin = DEFAULTS, opts: { confirmed?: boolean } = {}) {
  const [input, setInput] = useState('')
  const [out, setOut] = useState('')
  // The Input card: one file, or a batch of files run in turn (doc/GUI-WORKFLOWS.md 1).
  const [mode, setMode] = useState<'one' | 'batch'>('one')
  // The inputs a batch has queued (App keeps them in step with the queue):
  // the CLI refuses some options on each mzPeak file of a batch too.
  const [batchInputs, setBatchInputs] = useState<readonly string[]>([])
  // The Advanced disclosure of Setup is open.
  const [advancedOpen, setAdvancedOpen] = useState(false)
  // The Setup wizard (doc/GUI-SETUP-WIZARD.md 5.3): the step shown, whether
  // a task was confirmed on this launch (a launch that names its origin
  // counts), the tile selected in step 1, the optional inputs opened but
  // still empty, and the step the task was changed from.
  const [step, setRawStep] = useState<Step>(opts.confirmed ? 2 : 1)
  const [taskConfirmed, setTaskConfirmed] = useState(!!opts.confirmed)
  const [tile, setTile] = useState<TaskId>(() => taskOf(start)?.id ?? LANDING_TASK)
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set())
  const cameFrom = useRef<Step>(2)
  const setStep = (n: Step): void => {
    setRawStep((cur) => {
      if (n === 1 && cur !== 1) cameFrom.current = cur
      return n
    })
  }
  const [carried, setCarried] = useState<CarryNote | null>(null)
  // Where the form's values came from, and the values that origin gives
  // (before reports are moved beside the input): the footer's diff is the
  // form against these.
  const [origin, setOrigin] = useState<Origin>(start)
  const [originValues, setOriginValues] = useState<Record<string, ParamValue>>(() => baseValues(baseOf(start)))
  const [values, setRawValues] = useState<Record<string, ParamValue>>(() => baseValues(baseOf(start)))
  // The MSFragger recipe fields the user has edited since the form was last
  // replaced: they keep their value when the recipe turns on or off
  // (paramLayout syncRecipe); the others show what the CLI would use.
  const edited = useRef<Set<string>>(new Set())
  const originRef = useRef<Record<string, ParamValue>>({})
  // Every edit of the form goes through here: a change that turns the
  // recipe on or off updates the recipe fields not edited.
  const setValues = (u: SetStateAction<Record<string, ParamValue>>): void =>
    setRawValues((s) => syncRecipe(s, typeof u === 'function' ? u(s) : u, edited.current, originRef.current))
  // A task, preset or run replaces the form: no field is the user's yet.
  // formGen counts the replacements (workflow, preset, reset, undo, a run
  // taken over): what the form remembered of the values before (the
  // Extension the alkylation report raised) is forgotten with them.
  const [formGen, setFormGen] = useState(0)
  const replaceValues = (v: Record<string, ParamValue>): void => {
    edited.current = new Set()
    setFormGen((g) => g + 1)
    setRawValues(v)
  }
  const [undoSnapshot, setUndoSnapshot] = useState<Snapshot | null>(null)
  // Only the user's own toggles: a group not toggled yet opens as its
  // place says (a workflow's own groups open, SetupForm renderGroup).
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  // The parameters of the last session's run (D6): offered with "Apply
  // last-used (n)", never applied on their own. null once applied.
  const [lastUsed, setLastUsed] = useState<Record<string, ParamValue> | null>(null)
  // The workflow those values ran in, when the run recorded one.
  const [lastWorkflow, setLastWorkflow] = useState<TaskId | null>(null)
  const [taxdbK, setTaxdbK] = useState<number | null>(null)
  // The instrument preset last chosen (read-only built-ins, presets.ts).
  const [instrument, setInstrument] = useState('')
  const [presets, setPresets] = useState<string[]>([])
  const [savingName, setSavingName] = useState<string | null>(null) // non-null = the 'save as' input is open
  // Why the last save or delete of a preset was refused (the settings file
  // cannot be written, the name is not allowed); null when it was not.
  const [presetError, setPresetError] = useState<string | null>(null)
  // Where focus goes when the control that had it disappears.
  const presetRef = useRef<HTMLSelectElement>(null)

  useEffect(() => {
    window.fastag.loadSettings().then((st) => {
      setPresets(Object.keys(st.presets).sort())
      // The last session's parameters are an offer (D6): a fresh start runs
      // with FASTag's defaults unless "Apply last-used" is clicked. Only
      // parameters the form renders count; in/out paths are never stored.
      if (st.lastUsed) {
        const known = Object.entries(st.lastUsed).filter(([n]) => RENDERED.includes(n)) as [string, ParamValue][]
        if (known.length) setLastUsed(Object.fromEntries(known))
        const wf = st.lastUsed[LAST_WORKFLOW]
        if (typeof wf === 'string' && taskById(wf)) setLastWorkflow(taskById(wf)!.id)
      }
    })
  }, [])

  // Re-read whenever the user points at a different index.
  const taxdbPath = String(values['taxdb'] || '')
  useEffect(() => {
    window.fastag.taxdbInfo(taxdbPath || undefined).then((i) => setTaxdbK(i ? i.k : null))
  }, [taxdbPath])

  const speciesOn = values['species'] === true
  // k comes from the index header, not an assumption: a differently-built index
  // would make a hardcoded 7 quietly wrong. The CLI refuses such a run up front
  // (rc 6); conflicts() below keeps Run disabled for it, and this tells the
  // Species tab why it is empty. The same rule as that conflict.
  const tooShort = speciesReach(values, taxdbK)

  // A changed engine renames its unedited configuration file (.json for
  // Sage, .params for Comet and MSFragger).
  originRef.current = originValues
  const setValue = (name: string, v: ParamValue): void => {
    if (RECIPE_FIELDS.includes(name)) edited.current.add(name)
    setValues((s) => (name === 'search_engine' ? renameSearchConfig({ ...s, [name]: v }, v) : { ...s, [name]: v }))
  }

  // The last session's values that differ from the form's (D6).
  const lastUsedDiff = lastUsed ? Object.keys(lastUsed).filter((n) => !sameValue(lastUsed[n], values[n])) : []
  // Apply the offer. It replaces the form as a preset does (Undo, formGen,
  // no field the user's yet) and keeps the origin: the saved values are
  // set as they ran, so a recipe field they hold is not overwritten by the
  // MSFragger recipe (fillRecipe treats every saved key as given). A
  // changed engine renames its unedited configuration file. Report paths go
  // beside the current tags output, or this run would overwrite the last
  // session's reports.
  // The workflow the values ran in comes back with them: its label, the
  // record and the Overview's lead tiles name it, not the form's.
  function applyLastUsed(): void {
    if (!lastUsed) return
    const lu = lastUsed
    let merged: Record<string, ParamValue> = { ...values, ...lu }
    if ('search_engine' in lu && !('search_config_out' in lu)) merged = renameSearchConfig(merged, lu['search_engine'])
    const o: Origin = lastWorkflow ? { kind: 'builtin', id: lastWorkflow } : origin
    const ov = lastWorkflow ? baseValues(`builtin:${lastWorkflow}`) : originValues
    replaceForm(o, ov, fillRecipe(merged, new Set(Object.keys(lu))), true)
    setTaskConfirmed(true)
    if (lastWorkflow) setTile(lastWorkflow)
    setLastUsed(null)
    focusLater(() => presetRef.current)
  }

  async function pickFor(spec: ParamSpec): Promise<void> {
    // Offer the parameter's own formats (FASTA, idXML/mzid/mzTab, TSV, taxdb),
    // not the spectra filter used for inputs or 'Tags (TSV)' for every output.
    const p =
      spec.type === 'output-file'
        ? await window.fastag.saveFile(String(values[spec.name] || ''), spec.formats)
        : await window.fastag.pickFile(spec.formats)
    if (p) setValue(spec.name, p)
  }

  // The reports of @p v beside the current tags output, when there is one.
  const beside = (v: Record<string, ParamValue>): Record<string, ParamValue> => (out ? { ...v, ...rebaseOutputs(v, out) } : v)

  // A task or preset replaces the form. What it replaced can be undone,
  // when it held changes of the user's own. A form without such changes
  // keeps the snapshot taken before it: arrowing through the task radios
  // replaces the form once per task, and the edits made before the first
  // one must survive the second.
  // @p v: the form's new values when they are not the origin's (the
  // last-used offer); @p always: take the snapshot even over a form without
  // edits of the user's, since @p v differs from the origin it keeps.
  // Every replacement keeps the input files the new workflow uses and the
  // common block the user changed (setup/inputs.ts carryInputs), and says
  // so in step 2's status line.
  function replaceForm(o: Origin, ov: Record<string, ParamValue>, v: Record<string, ParamValue> = ov, always = false, common = true): void {
    if (always || diffNames(originValues, values).length > 0) setUndoSnapshot({ values, origin, originValues, edited: new Set(edited.current) })
    setPresetError(null)
    const c = carryInputs(values, v, taskOf(o) ?? null, originValues, common)
    const text = carriedText(c, originText(o), originText(origin)) || `Now ${originText(o)}.`
    setCarried(text ? { text, gen: formGen + 1 } : null)
    setRevealed(new Set())
    setOrigin(o)
    setOriginValues(ov)
    replaceValues(beside(c.values))
  }
  // The form as it was, unchanged: its output paths (custom ones too) and
  // the recipe fields the user had edited.
  function undo(): void {
    if (!undoSnapshot) return
    setOrigin(undoSnapshot.origin)
    setOriginValues(undoSnapshot.originValues)
    replaceValues(undoSnapshot.values)
    edited.current = new Set(undoSnapshot.edited)
    setUndoSnapshot(null)
    setCarried(null)
  }
  // The task already chosen keeps the form as it is, edits and all.
  function chooseTask(id: TaskId): void {
    if (!taskById(id)) return
    setTile(id)
    if (origin.kind === 'builtin' && origin.id === id) return
    replaceForm({ kind: 'builtin', id }, baseValues(`builtin:${id}`))
  }
  function chooseDefaults(): void {
    replaceForm(DEFAULTS, baseValues('defaults'))
  }
  // Back to where the form started: the task, preset or defaults. The input
  // files stay; the instrument goes back too.
  function resetToOrigin(): void {
    const c = carryInputs(values, originValues, taskOf(origin) ?? null, originValues, false)
    setCarried(null)
    replaceValues(beside(c.values))
    setUndoSnapshot(null)
  }
  // An optional input of step 2: opened, or removed with its set.
  function revealInput(name: string): void {
    setRevealed((r) => new Set([...r, name]))
  }
  function removeInput(name: string): void {
    setRevealed((r) => new Set([...r].filter((n) => n !== name)))
    setValues((v) => ({ ...v, ...Object.fromEntries(setOf(name).map((n) => [n, initialValues()[n]])) }))
  }

  async function applyPreset(name: string): Promise<void> {
    if (!name) {
      setTaskConfirmed(true)
      return chooseDefaults()
    }
    if (name.startsWith('builtin:')) {
      setTaskConfirmed(true)
      return chooseTask(name.slice('builtin:'.length) as TaskId)
    }
    const st = await window.fastag.loadSettings()
    // A v1 preset is the full record of the form's values, a v2 one a diff
    // over its base (presetDiff.ts); either way its report paths go beside
    // the current tags output, or this run overwrites that sample's reports.
    const p = normalizePreset(st.presets[name])
    if (!p) return
    // A recipe field the preset does not store ran at the recipe's value.
    replaceForm({ kind: 'preset', name, base: p.base }, fillRecipe(presetValues(p, ''), new Set(Object.keys(p.diff))))
    setTaskConfirmed(true)
    const t = taskOf({ kind: 'preset', name, base: p.base })
    if (t) setTile(t.id)
    // Saved over Batch QC: Characterize on a batch.
    if (p.batch) setMode('batch')
  }
  async function refreshPresets(): Promise<string[]> {
    const st = await window.fastag.loadSettings()
    const names = Object.keys(st.presets).sort()
    setPresets(names)
    return names
  }
  // A preset stores its diff over its base and no paths (presetDiff.ts).
  const presetBase = baseOf(origin)
  async function commitPreset(): Promise<void> {
    const name = (savingName ?? '').trim()
    if (!name || name.startsWith('builtin:')) {
      cancelPreset()
      return
    }
    const diff = presetDiff(baseValues(presetBase), values)
    // Under the MSFragger recipe its fields are stored as shown, so a
    // loaded preset runs what was saved (fillRecipe reads a missing one as
    // the recipe's).
    if (msfRecipeOn(values)) for (const n of RECIPE_FIELDS) diff[n] = values[n]
    setPresetError(null)
    const saved = await window.fastag.savePreset(name, { v: 2, base: presetBase, diff })
    await refreshPresets()
    if (!saved) {
      // Nothing was stored: the form keeps its origin and the name input
      // stays open, so the values are not taken for a saved preset.
      setPresetError(`The preset “${name}” could not be saved: the settings file cannot be written, or the name is not allowed.`)
      return
    }
    setOrigin({ kind: 'preset', name, base: presetBase })
    setOriginValues({ ...baseValues(presetBase), ...diff })
    setSavingName(null)
    focusLater(() => presetRef.current)
  }
  function cancelPreset(): void {
    setSavingName(null)
    setPresetError(null)
    focusLater(() => presetRef.current)
  }
  async function removePreset(): Promise<void> {
    if (origin.kind !== 'preset') return
    setPresetError(null)
    const deleted = await window.fastag.deletePreset(origin.name)
    // A preset already gone from the file counts as deleted.
    const left = await refreshPresets()
    if (!deleted && left.includes(origin.name)) {
      setPresetError(`The preset “${origin.name}” could not be deleted: the settings file cannot be written.`)
      return
    }
    // The form stays; it now starts from what the preset was saved over.
    const base = origin.base
    setOrigin(base === 'defaults' ? DEFAULTS : { kind: 'builtin', id: base.slice('builtin:'.length) as TaskId })
    setOriginValues(baseValues(base))
    focusLater(() => presetRef.current)
  }

  // The tags output moved (Outputs: folder or run name): every report goes
  // beside it.
  function moveOut(next: string): void {
    setOut(next)
    if (next) setValues((v) => ({ ...v, ...rebaseOutputs(v, next) }))
  }
  // Outputs' folder and run name, from the tags output.
  const outDir = out ? dirName(out) : ''
  const runName = out ? baseName(out).replace(/\.tags\.tsv$/, '').replace(/\.tsv$/, '') : ''

  // A built-in instrument preset sets the tolerance and its unit.
  function chooseInstrument(id: string): void {
    const p = INSTRUMENTS.find((x) => x.id === id)
    setInstrument(id)
    if (p) setValues((v) => applyInstrument(v, p))
  }

  // Settings into form (History, GUI-DESIGN 3 S9): the input, output and
  // parameters of a recorded run replace the form's; only parameters the
  // form renders, with a value of a form type. The form is rebuilt from
  // FASTag's defaults (params.generated.json), not from the workflow's
  // values: a run sends only what differs from what the CLI would use
  // (sentValues), so an option it was not sent ran at the CLI's default (a
  // Database reduction with its E-value put back to 0.1 ran at 0.1, not at
  // the workflow's 10), and a recipe field it was not sent at the recipe's
  // value (fillRecipe). A run recorded with its workflow (@p workflow,
  // history.rs RunRecord.workflow) keeps it as origin only: its label,
  // landing tab and views. A record without one (before 1.15.4) is over
  // FASTag's defaults and stays unlabelled. Returns the Undo, which puts
  // the form, its origin and base back as they were.
  function takeRun(runInput: string, runOut: string, params: Record<string, unknown>, workflow?: string | null): () => void {
    const before = { input, out, values, origin, originValues, edited: new Set(edited.current) }
    const task = workflow ? taskById(workflow) : undefined
    const o: Origin = task ? { kind: 'builtin', id: task.id } : DEFAULTS
    const ov = startValues(baseOf(o), runOut)
    const v: Record<string, ParamValue> = initialValues()
    for (const [name, x] of Object.entries(params)) {
      if (!RENDERED.includes(name)) continue
      if (typeof x === 'string' || typeof x === 'boolean') v[name] = x
      else if (typeof x === 'number') v[name] = String(x)
      else if (Array.isArray(x) && x.every((i) => typeof i === 'string')) v[name] = x as string[]
    }
    setInput(runInput)
    setOut(runOut)
    setOrigin(o)
    setOriginValues(ov)
    // A recipe field the run did not send ran at the recipe's value.
    replaceValues(fillRecipe(v, new Set(Object.keys(params))))
    setUndoSnapshot(null)
    setCarried(null)
    setRevealed(new Set())
    setTaskConfirmed(true)
    if (task) setTile(task.id)
    // Outputs & run, unless an input of the run is missing (step 2).
    setRawStep(missingInputs(task ?? null, v, { input: runInput, jobs: 0, mode: 'one' }).length ? 2 : 4)
    return () => {
      setInput(before.input)
      setOut(before.out)
      setOrigin(before.origin)
      setOriginValues(before.originValues)
      setRawValues(before.values)
      setFormGen((g) => g + 1)
      edited.current = before.edited
    }
  }

  // Values the CLI would refuse, field by field, and combinations it refuses
  // before reading a spectrum (rc 6): either keeps Run and Run batch disabled.
  const invalid = invalidParams(values)
  const refused = conflicts(values, { taxdbK, input: mode === 'one' ? input : undefined, inputs: batchInputs })
  const blocked = Object.keys(invalid).length > 0 || refused.length > 0

  // What a run writes, by file name: the tags, then each output it is sent.
  // Species and glyco reports go beside <out> when no path is given.
  const writingFiles: string[] = (() => {
    const files = [out]
    if (speciesOn) files.push(String(values['species_out'] || '') || defaultSpeciesOut(out))
    if (values['glyco'] === true) files.push(String(values['glyco_out'] || '') || `${stripExt(out)}.glyco.tsv`)
    for (const name of RENDERED) {
      if (name === 'species_out' || name === 'glyco_out' || PARAM_BY_NAME.get(name)?.type !== 'output-file') continue
      const v = String(values[name] || '')
      if (v && !inertBecause(name, values)) files.push(v)
    }
    return files.filter(Boolean).map(baseName)
  })()
  // The parameters a run sends that differ from the defaults.
  const changedParams = RENDERED.filter((n) => !inertBecause(n, values) && isChanged(n, values[n])).map((n) =>
    cliText(n, values[n])
  )

  const fixes = speciesFixes(tooShort)

  return {
    input,
    setInput,
    out,
    setOut,
    moveOut,
    outDir,
    runName,
    mode,
    setMode,
    advancedOpen,
    setAdvancedOpen,
    step,
    setStep,
    // The step the task was changed from (step 1 returns there).
    cameFrom: (): Step => cameFrom.current,
    taskConfirmed,
    setTaskConfirmed,
    tile,
    setTile,
    revealed,
    revealInput,
    removeInput,
    // The status line of the last replacement, while the form is still it.
    carried: carried && carried.gen === formGen ? carried.text : null,
    lastWorkflow,
    values,
    setValues,
    setValue,
    formGen,
    // Reset… (RunBar): every parameter to FASTag's default.
    reset: (): void => {
      setOrigin(DEFAULTS)
      setOriginValues(initialValues())
      replaceValues(initialValues())
      setUndoSnapshot(null)
    },
    takeRun,
    applyFix: (v: Record<string, ParamValue>): void => setValues((cur) => ({ ...cur, ...v })),
    openGroups,
    setOpenGroups,
    lastUsed,
    lastUsedDiff,
    applyLastUsed,
    presetRef,
    presets,
    // The preset the form started from, by name ('' when none).
    preset: origin.kind === 'preset' ? origin.name : '',
    origin,
    originKey: originKey(origin),
    originText: originText(origin),
    task: taskOf(origin)?.id ?? null,
    chooseTask,
    resetToOrigin,
    undo,
    canUndo: undoSnapshot !== null,
    // What differs from where the form started (the footer).
    diff: diffNames(originValues, values),
    // The values the form started from, which a run's command line is
    // measured against (paramLayout sentValues).
    originValues,
    presetBaseText: originText(presetBase === 'defaults' ? DEFAULTS : { kind: 'builtin', id: presetBase.slice('builtin:'.length) as TaskId }),
    // The input paths a preset saved now would leave out.
    droppedPaths: droppedPaths(baseValues(presetBase), values),
    savingName,
    setSavingName,
    applyPreset,
    commitPreset,
    cancelPreset,
    removePreset,
    presetError,
    instrument,
    chooseInstrument,
    taxdbK,
    speciesOn,
    tooShort,
    fixes,
    pickFor,
    invalid,
    refused,
    setBatchInputs,
    blocked,
    writingFiles,
    changedParams
  }
}

export type Session = ReturnType<typeof useSession>
