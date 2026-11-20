// The plan line of the run bar (doc/GUI-WORKFLOWS.md 3): what a run does in
// one line, "Run QC on run01.mzML · 2 reports · 10% of spectra". Pure text
// from the form's values.

import { PARAM_BY_NAME } from '../paramLayout'
import { baseName } from '../digestReport'
import { PRODUCTS, isOn } from './products'

type V = Record<string, unknown>

const shown = (v: unknown, name: string): string => {
  const s = String(v ?? '').trim()
  return s === '' ? String(PARAM_BY_NAME.get(name)?.default ?? '') : s
}

// Match the CLI: an absolute sample count takes precedence over a fraction;
// zero means all. Do not round a small, nonzero fraction down to "0%".
export function samplingSummary(values: V): string {
  const n = Number(shown(values['subsample_spectra'], 'subsample_spectra'))
  const fraction = Number(shown(values['subsample_fraction'], 'subsample_fraction'))
  if (n > 0) return `up to ${n.toLocaleString('en-US')} spectra sampled`
  if (fraction > 0 && fraction < 1) return `${Number((fraction * 100).toPrecision(6))}% of spectra`
  return 'all spectra'
}

/// The reports a run writes besides the tags table, by label, in the order
/// of the products (setup/products.ts).
export function reportsOn(values: V): string[] {
  return PRODUCTS.filter((p) => p.param !== 'out' && !p.column && !p.follows && isOn(p, values as never)).map((p) => p.label)
}

/// "Run QC on run01.mzML · 1 report · 10% of spectra"; a batch counts its
/// files, and names its output folder when it has one.
/// In Batch mode (@p ctx.batch) the queue is the input: "no files yet"
/// until it holds one, never the single file.
export function planLine(label: string, values: V, ctx: { input: string; files: number; outDir?: string | null; batch?: boolean }): string {
  const batch = ctx.batch || ctx.files > 0
  const what = ctx.files > 0 ? `${ctx.files} ${ctx.files === 1 ? 'file' : 'files'}` : batch ? 'no files yet' : ctx.input ? baseName(ctx.input) : 'no file yet'
  const named = ctx.files > 0 || (!batch && !!ctx.input)
  const n = reportsOn(values).length
  const parts = [named ? `${label} on ${what}` : `${label} · ${what}`, n ? `${n} ${n === 1 ? 'report' : 'reports'}` : 'tags table only', samplingSummary(values)]
  if (batch) parts.push(ctx.outDir ? `out: ${ctx.outDir}` : 'out: beside each input')
  return parts.join(' · ')
}
