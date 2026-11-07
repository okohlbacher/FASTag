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

export function useSession() {
  const [input, setInput] = useState('')
  const [out, setOut] = useState('')
  const [values, setValues] = useState<Record<string, ParamValue>>(initialValues)
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
  const [preset, setPreset] = useState('')
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

  async function applyPreset(name: string): Promise<void> {
    setPreset(name)
    if (!name) return
    const st = await window.fastag.loadSettings()
    const pv = st.presets[name]
    // A preset stores the report paths of the sample it was saved with; put
    // them beside the current tags output, or this run overwrites that
    // sample's reports.
    if (pv)
      setValues((v) => {
        const merged = { ...v, ...(pv as Record<string, ParamValue>) }
        return out ? { ...merged, ...rebaseOutputs(merged, out) } : merged
      })
  }
  async function refreshPresets(): Promise<void> {
    const st = await window.fastag.loadSettings()
    setPresets(Object.keys(st.presets).sort())
  }
  async function commitPreset(): Promise<void> {
    const name = (savingName ?? '').trim()
    if (!name) {
      cancelPreset()
      return
    }
    await window.fastag.savePreset(name, values)
    await refreshPresets()
    setPreset(name)
    setSavingName(null)
    focusLater(() => presetRef.current)
  }
  function cancelPreset(): void {
    setSavingName(null)
    focusLater(() => presetRef.current)
  }
  async function removePreset(): Promise<void> {
    if (!preset) return
    await window.fastag.deletePreset(preset)
    await refreshPresets()
    setPreset('')
    focusLater(() => presetRef.current)
  }

  // A built-in instrument preset sets the tolerance and its unit.
  function chooseInstrument(id: string): void {
    const p = INSTRUMENTS.find((x) => x.id === id)
    setInstrument(id)
    if (p) setValues((v) => applyInstrument(v, p))
  }

  // Settings into form (History, GUI-DESIGN 3 S9): the input, output and
  // parameters of a recorded run replace the form's, over the defaults;
  // only parameters the form renders, with a value of a form type. Returns
  // the Undo, which puts the form back as it was.
  function takeRun(runInput: string, runOut: string, params: Record<string, unknown>): () => void {
    const before = { input, out, values }
    const v = initialValues()
    for (const [name, x] of Object.entries(params)) {
      if (!RENDERED.includes(name)) continue
      if (typeof x === 'string' || typeof x === 'boolean') v[name] = x
      else if (typeof x === 'number') v[name] = String(x)
      else if (Array.isArray(x) && x.every((i) => typeof i === 'string')) v[name] = x as string[]
    }
    setInput(runInput)
    setOut(runOut)
    setValues(v)
    return () => {
      setInput(before.input)
      setOut(before.out)
      setValues(before.values)
    }
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
    reset: (): void => setValues(initialValues()),
    takeRun,
    applyFix: (v: Record<string, ParamValue>): void => setValues((cur) => ({ ...cur, ...v })),
    openGroups,
    setOpenGroups,
    lastUsed,
    lastUsedDiff,
    applyLastUsed,
    presetRef,
    presets,
    preset,
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
