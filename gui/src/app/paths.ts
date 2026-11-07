// Output paths as the GUI names them before a run (moved from App.tsx, P1
// PR c). The paths a run wrote come from the backend (ResolvedOutputs); these
// only seed the form and a batch's per-job outputs.

import type { ResolvedOutputs } from '../types'
import { PARAM_BY_NAME, RENDERED } from '../paramLayout'
import type { ParamValue } from '../ParamField'

// The index of the last path separator, '/' or '\\'; -1 if there is none.
const lastSep = (p: string): number => Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))

// Strip the final extension only when the dot sits inside the basename — a
// dotted directory (`/runs.2026/sample`) must not lose half its path. Mirrors
// the CLI's guard so the GUI reads exactly where the CLI writes.
export function stripExt(p: string): string {
  const dot = p.lastIndexOf('.')
  const slash = lastSep(p)
  return dot > slash ? p.slice(0, dot) : p
}

// Where -species writes when -species_out is not given: <out> minus its final
// extension, plus .species.tsv.
export function defaultSpeciesOut(out: string): string {
  return `${stripExt(out)}.species.tsv`
}

export function defaultOut(input: string): string {
  return `${stripExt(input)}.tags.tsv`
}

// The folder part of a path, separator kept.
export function dirName(p: string): string {
  return p.slice(0, lastSep(p) + 1)
}

// The file manager's own name for "show this file".
export function revealLabel(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  if (/Mac/.test(ua)) return 'Reveal in Finder'
  if (/Win/.test(ua)) return 'Show in Explorer'
  return 'Show in folder'
}

// The report options whose files the Digest tab reads: keys of
// ResolvedOutputs, so a key the backend does not send fails the typecheck.
export const REPORT_PARAMS = ['digest_out', 'label_out', 'massgap_out'] as const satisfies readonly (keyof ResolvedOutputs)[]

// A batch must not write every job's extra outputs to one configured path, or
// each job overwrites the last. Each configured output-file option gets a
// per-job path from the (unique) tags output, keeping the configured
// extension: <stem>.<option without _out>.<ext>, e.g. a.glyco.tsv, and
// a.spectra.mzpeak for out_spectra. species_out is blanked instead, so the CLI
// derives its own per-input default.
export function perJobOutputs(values: Record<string, unknown>, tagsOut: string): Record<string, ParamValue> {
  return { ...rebaseOutputs(values, tagsOut), species_out: '' }
}

// Each run writes its reports beside its own tags output. The configured
// report paths persist across runs, sessions (lastUsed) and presets, so
// without this step sample B would overwrite sample A's digest/recon/...
// files. Each configured output-file option is moved beside the new tags
// output and keeps its extension: /res/A.digest.tsv -> /d/B.digest.tsv.
// Keeping the configured folder is not enough: /runA/sample.mzML and
// /runB/sample.mzML would both write /res/sample.digest.tsv. Unset options
// stay unset.
export function rebaseOutputs(values: Record<string, unknown>, tagsOut: string): Record<string, ParamValue> {
  const stem = tagsOut.endsWith('.tags.tsv') ? tagsOut.slice(0, -'.tags.tsv'.length) : stripExt(tagsOut)
  const o: Record<string, ParamValue> = {}
  for (const name of RENDERED) {
    if (PARAM_BY_NAME.get(name)?.type !== 'output-file') continue
    const cfg = String(values[name] || '')
    if (!cfg) continue
    const ext = cfg.slice(stripExt(cfg).length) || (name === 'out_spectra' ? '.mzML' : '.tsv')
    o[name] = `${stem}.${name.replace(/_out$/, '').replace(/^out_/, '')}${ext}`
  }
  return o
}
