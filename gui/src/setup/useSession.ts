// The session (GUI-DESIGN 5 sessionStore, P1 PR c; moved from App.tsx): the
// input and output, the form's values, the last-used offer (D6), presets and
// what a run with these values would send.

import { useEffect, useRef, useState } from 'react'
import {
  SECTIONS,
  PARAM_BY_NAME,
  RENDERED,
  conflicts,
  inertBecause,
  invalidParams,
  isChanged,
  speciesReach,
  type ParamSpec
} from '../paramLayout'
import type { ParamValue } from '../ParamField'
import { baseName } from '../digestReport'
import { applyInstrument, INSTRUMENTS, speciesFixes } from './presets'
import { defaultSpeciesOut, rebaseOutputs, stripExt } from '../app/paths'
import { cliText, sameValue } from '../app/format'
import { focusLater } from '../app/focus'
import { DEFAULTS, baseOf, baseValues, originText, taskById, taskOf, type Origin, type TaskId } from './tasks'
import { applyPreset as presetValues, diffNames, droppedPaths, normalizePreset, presetDiff } from './presetDiff'

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
}

/// @p start: where the session's values come from (D1: the app passes the
/// task "Characterize a run"; the hook alone starts from the defaults).
export function useSession(start: Origin = DEFAULTS) {
  const [input, setInput] = useState('')
  const [out, setOut] = useState('')
  // Where the form's values came from, and the values that origin gives
  // (before reports are moved beside the input): the footer's diff is the
  // form against these.
  const [origin, setOrigin] = useState<Origin>(start)
  const [originValues, setOriginValues] = useState<Record<string, ParamValue>>(() => baseValues(baseOf(start)))
  const [values, setValues] = useState<Record<string, ParamValue>>(() => baseValues(baseOf(start)))
  const [undoSnapshot, setUndoSnapshot] = useState<Snapshot | null>(null)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SECTIONS.map((s) => [s.title, s.open]))
  )
  // The parameters of the last session's run (D6): offered with "Apply
  // last-used (n)", never applied on their own. null once applied.
  const [lastUsed, setLastUsed] = useState<Record<string, ParamValue> | null>(null)
  const [taxdbK, setTaxdbK] = useState<number | null>(null)
  // The instrument preset last chosen (read-only built-ins, presets.ts).
  const [instrument, setInstrument] = useState('')
  const [presets, setPresets] = useState<string[]>([])
  const [savingName, setSavingName] = useState<string | null>(null) // non-null = the 'save as' input is open
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

  const setValue = (name: string, v: ParamValue): void => setValues((s) => ({ ...s, [name]: v }))

  // The last session's values that differ from the form's (D6).
  const lastUsedDiff = lastUsed ? Object.keys(lastUsed).filter((n) => !sameValue(lastUsed[n], values[n])) : []
  // Apply the offer. Report paths go beside the current tags output, as a
  // preset's do, or this run would overwrite the last session's reports.
  function applyLastUsed(): void {
    if (!lastUsed) return
    const lu = lastUsed
    setValues((v) => {
      const merged = { ...v, ...lu }
      return out ? { ...merged, ...rebaseOutputs(merged, out) } : merged
    })
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
  // when it held changes of the user's own.
  function replaceForm(o: Origin, ov: Record<string, ParamValue>): void {
    setUndoSnapshot(diffNames(originValues, values).length > 0 ? { values, origin, originValues } : null)
    setOrigin(o)
    setOriginValues(ov)
    setValues(beside(ov))
  }
  function undo(): void {
    if (!undoSnapshot) return
    setOrigin(undoSnapshot.origin)
    setOriginValues(undoSnapshot.originValues)
    setValues(beside(undoSnapshot.values))
    setUndoSnapshot(null)
  }
  function chooseTask(id: TaskId): void {
    if (!taskById(id)) return
    replaceForm({ kind: 'builtin', id }, baseValues(`builtin:${id}`))
  }
  function chooseDefaults(): void {
    replaceForm(DEFAULTS, baseValues('defaults'))
  }
  // Back to where the form started: the task, preset or defaults.
  function resetToOrigin(): void {
    setValues(beside(originValues))
    setUndoSnapshot(null)
  }

  async function applyPreset(name: string): Promise<void> {
    if (!name) return chooseDefaults()
    if (name.startsWith('builtin:')) return chooseTask(name.slice('builtin:'.length) as TaskId)
    const st = await window.fastag.loadSettings()
    // A v1 preset is the full record of the form's values, a v2 one a diff
    // over its base (presetDiff.ts); either way its report paths go beside
    // the current tags output, or this run overwrites that sample's reports.
    const p = normalizePreset(st.presets[name])
    if (!p) return
    replaceForm({ kind: 'preset', name, base: p.base }, presetValues(p, ''))
  }
  async function refreshPresets(): Promise<void> {
    const st = await window.fastag.loadSettings()
    setPresets(Object.keys(st.presets).sort())
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
    await window.fastag.savePreset(name, { v: 2, base: presetBase, diff })
    await refreshPresets()
    setOrigin({ kind: 'preset', name, base: presetBase })
    setOriginValues({ ...baseValues(presetBase), ...diff })
    setSavingName(null)
    focusLater(() => presetRef.current)
  }
  function cancelPreset(): void {
    setSavingName(null)
    focusLater(() => presetRef.current)
  }
  async function removePreset(): Promise<void> {
    if (origin.kind !== 'preset') return
    await window.fastag.deletePreset(origin.name)
    await refreshPresets()
    // The form stays; it now starts from what the preset was saved over.
    const base = origin.base
    setOrigin(base === 'defaults' ? DEFAULTS : { kind: 'builtin', id: base.slice('builtin:'.length) as TaskId })
    setOriginValues(baseValues(base))
    focusLater(() => presetRef.current)
  }

  // A built-in instrument preset sets the tolerance and its unit.
  function chooseInstrument(id: string): void {
    const p = INSTRUMENTS.find((x) => x.id === id)
    setInstrument(id)
    if (p) setValues((v) => applyInstrument(v, p))
  }

  // Values the CLI would refuse, field by field, and combinations it refuses
  // before reading a spectrum (rc 6): either keeps Run and Run batch disabled.
  const invalid = invalidParams(values)
  const refused = conflicts(values, { taxdbK })
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
    values,
    setValues,
    setValue,
    // Reset… (RunBar): every parameter to FASTag's default.
    reset: (): void => {
      setOrigin(DEFAULTS)
      setOriginValues(initialValues())
      setValues(initialValues())
      setUndoSnapshot(null)
    },
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
    presetBaseText: originText(presetBase === 'defaults' ? DEFAULTS : { kind: 'builtin', id: presetBase.slice('builtin:'.length) as TaskId }),
    // The input paths a preset saved now would leave out.
    droppedPaths: droppedPaths(baseValues(presetBase), values),
    savingName,
    setSavingName,
    applyPreset,
    commitPreset,
    cancelPreset,
    removePreset,
    instrument,
    chooseInstrument,
    taxdbK,
    speciesOn,
    tooShort,
    fixes,
    pickFor,
    invalid,
    refused,
    blocked,
    writingFiles,
    changedParams
  }
}

export type Session = ReturnType<typeof useSession>
