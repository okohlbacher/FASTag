// Presets as diffs (GUI-DESIGN 3 S1, 5): a preset stores only what differs
// from its base (FASTag's defaults or a built-in task), and no paths. The
// footer counts the same differences ("Differs from Characterize a run: 2").
//
// Stored (settings.rs schema 2): {v: 2, base, diff}. A v1 preset, a full
// record of the form's values, reads as a diff over the defaults with every
// key kept: applying it gives exactly the values it held.

import type { ParamValue } from '../ParamField'
import { PARAM_BY_NAME, RENDERED } from '../paramLayout'
import { rebaseOutputs, stripExt } from '../app/paths'
import { baseValues, type PresetBase } from './tasks'

export interface StoredPreset {
  v: 2
  base: PresetBase
  diff: Record<string, ParamValue>
}

const RESERVED = new Set(['__proto__', 'constructor', 'prototype'])

const items = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [v]).map((x) => String(x ?? '').trim()).filter((x) => x !== '')

/// The setting @p v of @p name means, for comparing two forms: an empty
/// field is the CLI default, numbers compare as numbers (20 = 20.0), and an
/// output file counts only as on or off (where it goes follows the input).
function effective(name: string, v: unknown): string {
  const spec = PARAM_BY_NAME.get(name)
  if (!spec) return JSON.stringify(v ?? null)
  if (spec.type === 'bool') return v === true ? 'on' : 'off'
  if (spec.type === 'string-list') return JSON.stringify(items(v))
  let s = String(v ?? '').trim()
  if (s === '') s = String(spec.default ?? '').trim()
  if (spec.type === 'output-file') return s === '' ? 'off' : 'on'
  if ((spec.type === 'int' || spec.type === 'double') && s !== '' && Number.isFinite(Number(s))) return String(Number(s))
  return s
}

/// Same setting: what the CLI would run with is the same.
export const sameSetting = (name: string, a: unknown, b: unknown): boolean => effective(name, a) === effective(name, b)

/// The rendered parameters whose setting in @p values differs from @p base.
export function diffNames(base: Record<string, unknown>, values: Record<string, unknown>): string[] {
  return RENDERED.filter((n) => !sameSetting(n, base[n], values[n]))
}

/// An output file as a preset stores it: its option name and extension,
/// no folder and no sample name (digest_out /d/run01.digest.tsv: digest.tsv).
function outputName(name: string, v: string): string {
  const ext = v.slice(stripExt(v).length) || (name === 'out_spectra' ? '.mzML' : '.tsv')
  return `${name.replace(/_out$/, '').replace(/^out_/, '')}${ext}`
}

/// The diff a preset saved from @p values over @p base stores: no input
/// paths (a FASTA, a taxonomy), and output files by name only.
export function presetDiff(base: Record<string, unknown>, values: Record<string, ParamValue>): Record<string, ParamValue> {
  const d: Record<string, ParamValue> = {}
  for (const n of diffNames(base, values)) {
    const type = PARAM_BY_NAME.get(n)?.type
    if (type === 'input-file') continue
    const v = values[n]
    d[n] = type === 'output-file' ? (String(v ?? '').trim() ? outputName(n, String(v).trim()) : '') : v
  }
  return d
}

/// The names of the input paths a preset of @p values leaves out.
export function droppedPaths(base: Record<string, unknown>, values: Record<string, unknown>): string[] {
  return diffNames(base, values).filter((n) => PARAM_BY_NAME.get(n)?.type === 'input-file')
}

/// The form a preset gives: its base, its diff over it, and every report
/// beside @p tagsOut when there is one.
export function applyPreset(p: StoredPreset, tagsOut: string): Record<string, ParamValue> {
  const v = { ...baseValues(p.base), ...p.diff }
  return tagsOut ? { ...v, ...rebaseOutputs(v, tagsOut) } : v
}

const isBase = (b: unknown): b is PresetBase =>
  b === 'defaults' || b === 'builtin:characterize' || b === 'builtin:batch-qc' || b === 'builtin:export-tags' || b === 'builtin:open-results'

function clean(m: Record<string, unknown>): Record<string, ParamValue> {
  const o: Record<string, ParamValue> = {}
  for (const [k, v] of Object.entries(m)) {
    if (RESERVED.has(k)) continue
    if (typeof v === 'boolean' || typeof v === 'string') o[k] = v
    else if (typeof v === 'number') o[k] = String(v)
    else if (Array.isArray(v)) o[k] = v.map((x) => String(x ?? ''))
  }
  return o
}

/// A stored preset as schema 2, whichever schema stored it: a v2 one as it
/// is; a v1 one (the full record of the form's values) as a diff over the
/// defaults that keeps every key, so it applies to the values it held.
/// Null for what is no preset at all.
export function normalizePreset(raw: unknown): StoredPreset | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (r.v === 2 && r.diff && typeof r.diff === 'object' && !Array.isArray(r.diff)) {
    return { v: 2, base: isBase(r.base) ? r.base : 'defaults', diff: clean(r.diff as Record<string, unknown>) }
  }
  return { v: 2, base: 'defaults', diff: clean(r) }
}
