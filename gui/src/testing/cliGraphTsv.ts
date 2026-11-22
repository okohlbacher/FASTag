// A TagGraph written as FASTag writes -resolved_out and -tag_graph_out
// (work/tag-merge-cli/SPEC.md), for the cliGraph tests and the e2e
// fixture until the CLI writes them itself. Row indices are the TagIn
// indices (the spectrum's tags in -out order).

import type { SpectrumPeaks } from '../spectrum/dump'
import { layerOf, sequenceOf, type GPath, type Step, type TagGraph } from '../spectrum/graph'
import { PROTON, WATER, C_OFFSET, Z_DOT_OFFSET } from '../spectrum/ladder'
import { RESOLVED_COLUMNS, TAG_GRAPH_COLUMNS, type CliRows } from '../spectrum/cliGraph'

/** printf %g: six significant digits, a two-digit exponent. */
export function g6(x: number): string {
  const e = Math.floor(Math.log10(Math.abs(x)))
  if (!Number.isFinite(x)) return String(x)
  if (x === 0 || (e >= -4 && e < 6)) return String(Number(x.toPrecision(6)))
  const [m, ex] = x.toExponential(5).split('e')
  return `${String(Number(m))}e${ex[0]}${ex.slice(1).padStart(2, '0')}`
}

const E = (e: number | null): string => (e == null ? '' : g6(e))
const mzs = (s: SpectrumPeaks, peaks: number[]): string => peaks.map((i) => s.mz[i].toFixed(6)).join(';')
const steps = (st: Step[]): string => st.map((x) => x.readings.map((r) => `${r.label}:${E(r.evalue)}`).join('|')).join(';')
const residuesOf = (st: Step): number => (st.readings[0].label.startsWith('[') ? 2 : 1)

/** The flanks of @p p in the tag convention (residues + flanks + water = M). */
function flanks(p: GPath, s: SpectrumPeaks): [string, string] {
  const neutral = (i: number): number => s.mz[i] * p.charge - p.charge * PROTON
  const first = neutral(p.peaks[0])
  const last = neutral(p.peaks[p.peaks.length - 1])
  const M = s.precursor != null ? s.precursor * s.charge - s.charge * PROTON : null
  const n = p.series === 'b' ? first : p.series === 'c' ? first - C_OFFSET : M == null ? null : M - last + (p.series === 'z' ? Z_DOT_OFFSET - WATER : 0)
  const c = M == null || n == null ? null : M - WATER - n - (last - first)
  return [n == null ? '' : n.toFixed(4), c == null ? '' : c.toFixed(4)]
}

/** The two tables of @p g for the spectrum @p spectrum. */
export function toCli(g: TagGraph, s: SpectrumPeaks, spectrum: string): { resolved: CliRows; nodes: CliRows } {
  const resolved = g.paths.map((p, k) => {
    const [n, c] = flanks(p, s)
    const rows = (of: number[]): number[] => of.flatMap((i) => g.placements[i].rows)
    const cells: Record<(typeof RESOLVED_COLUMNS)[number], string> = {
      spectrum,
      rank: String(k + 1),
      sequence: sequenceOf(p),
      length: String(p.steps.reduce((a, st) => a + residuesOf(st), 0)),
      series: p.series,
      call: p.call.level,
      charge: String(p.charge),
      nterm_mass: n,
      cterm_mass: c,
      score: '',
      best_e: E(p.best),
      weakest_e: E(p.weakest),
      n_tags: String(new Set(rows([...p.chain, ...p.inside])).size),
      peaks: mzs(s, p.peaks),
      steps: steps(p.steps),
      members: rows(p.chain).join(','),
      inside: rows(p.inside).join(','),
      joined: mzs(s, p.joined),
      relations: p.relations.map((r) => `${r.path + 1}:${r.kind}:${r.shared}`).join(';')
    }
    return RESOLVED_COLUMNS.map((x) => cells[x])
  })
  const nodes = g.placements.map((pl, i) => {
    const k = g.paths.findIndex((p) => p.chain.includes(i) || p.inside.includes(i))
    const cells: Record<(typeof TAG_GRAPH_COLUMNS)[number], string> = {
      spectrum,
      node: String(i),
      layer: layerOf(pl),
      charge: String(pl.charge),
      series: pl.series,
      peaks: mzs(s, pl.peaks),
      steps: steps(pl.steps),
      evalue: E(pl.evalue),
      rows: pl.rows.join(','),
      path: k < 0 ? '' : String(k + 1),
      role: k < 0 ? 'none' : g.paths[k].chain.includes(i) ? 'chain' : 'inside',
      next: g.arcs
        .filter((a) => a.from === i)
        .map((a) => `${a.to}${a.touch ? '~' : ''}${a.used ? '*' : ''}`)
        .join(',')
    }
    return TAG_GRAPH_COLUMNS.map((x) => cells[x])
  })
  return { resolved: { columns: [...RESOLVED_COLUMNS], rows: resolved }, nodes: { columns: [...TAG_GRAPH_COLUMNS], rows: nodes } }
}

/** @p t as a TSV file. */
export const tsv = (t: CliRows): string => [t.columns, ...t.rows].map((r) => r.join('\t')).join('\n') + '\n'
