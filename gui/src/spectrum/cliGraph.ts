// The tag graph of one spectrum as FASTag wrote it (-resolved_out, one row
// per resolved tag in rank order; -tag_graph_out, one row per placement),
// turned into the TagGraph that buildGraph makes, so the views draw both
// the same way. Peaks are written as m/z and mapped back to the dump's peaks
// (nearest within the run's tolerance); a peak that does not map means the
// tables and the dump disagree, and the caller resolves in the GUI instead.

import type { SpectrumPeaks } from './dump'
import { sameAsOf, type Arc, type GPath, type Placement, type Reading, type Step, type TagGraph } from './graph'
import { nearest, readingMass, seriesCall, type Ladder, type Residues, type SeriesCall } from './ladder'

/** The rows of one spectrum in one of the two tables, with its header. */
export interface CliRows {
  columns: string[]
  rows: string[][]
}

export type CliGraph = { ok: true; graph: TagGraph } | { ok: false; error: string }

export const RESOLVED_COLUMNS = ['spectrum', 'rank', 'sequence', 'length', 'series', 'call', 'charge', 'nterm_mass', 'cterm_mass', 'score', 'best_e', 'weakest_e', 'n_tags', 'peaks', 'steps', 'members', 'inside', 'joined', 'relations'] as const
export const TAG_GRAPH_COLUMNS = ['spectrum', 'node', 'layer', 'charge', 'series', 'peaks', 'steps', 'evalue', 'rows', 'path', 'role', 'next'] as const

const SERIES = new Set(['b', 'y', 'c', 'z'])
const LEVELS = new Set(['sure', 'likely', 'open'])
const WHY = 'as FASTag judged it'

const tolAt = (s: SpectrumPeaks, x: number): number => (s.toleranceUnit === 'ppm' ? (x * s.tolerance) / 1e6 : s.tolerance)
const eOf = (c: string): number | null => (c.trim() === '' || !Number.isFinite(Number(c)) ? null : Number(c))
const list = (c: string, sep: RegExp): string[] => c.split(sep).map((x) => x.trim()).filter((x) => x !== '')

/** @p rows of -resolved_out and @p nodes of -tag_graph_out for the spectrum
 *  @p s (both in file order). @p tags: the spectrum's tags in -out order
 *  (the CLI's row indices), as the caller's index and text; without them a
 *  placement's rows are the CLI's indices. */
export function fromCli(resolved: CliRows, nodes: CliRows, s: SpectrumPeaks, residues: Residues, tags?: { index: number; tag: string }[]): CliGraph {
  const fail = (error: string): CliGraph => ({ ok: false, error })
  for (const [t, need, what] of [[resolved, RESOLVED_COLUMNS, 'resolved tags'], [nodes, TAG_GRAPH_COLUMNS, 'tag graph']] as const) {
    const missing = need.filter((c) => !t.columns.includes(c))
    if (missing.length) return fail(`the ${what} table has no ${missing.join(', ')} column`)
  }
  const cell = (t: CliRows, r: string[], c: string): string => r[t.columns.indexOf(c)] ?? ''
  const peaksOf = (text: string): number[] | string => {
    const out: number[] = []
    for (const t of list(text, /[;,]/)) {
      const x = Number(t)
      const i = Number.isFinite(x) ? nearest(s.mz, x, tolAt(s, x)) : -1
      if (i < 0) return `m/z ${t} is not a peak of the spectrum`
      out.push(i)
    }
    return out
  }
  // Steps as `label:E|label:E;...`; the error of each reading from its mass.
  const stepsOf = (text: string, peaks: number[], z: number): Step[] | string => {
    const cells = list(text, /;/)
    if (cells.length !== peaks.length - 1) return `${cells.length} steps over ${peaks.length} peaks`
    return cells.map((c, k): Step => {
      const u = peaks[k]
      const v = peaks[k + 1]
      const readings = c.split('|').map((r): Reading => {
        const at = r.lastIndexOf(':')
        const label = at < 0 ? r : r.slice(0, at)
        const m = readingMass(label, residues)
        const x = m == null ? s.mz[v] : s.mz[u] + m / z
        return { label, gap: label.startsWith('['), evalue: at < 0 ? null : eOf(r.slice(at + 1)), deltaMz: s.mz[v] - x, deltaPpm: ((s.mz[v] - x) / x) * 1e6 }
      })
      return { u, v, readings }
    })
  }

  const order = [...nodes.rows].sort((a, b) => Number(cell(nodes, a, 'node')) - Number(cell(nodes, b, 'node')))
  const placements: Placement[] = []
  const role: { path: number | null; role: string }[] = []
  const arcs: Arc[] = []
  for (const [i, r] of order.entries()) {
    if (Number(cell(nodes, r, 'node')) !== i) return fail(`the tag graph has no node ${i}`)
    const series = cell(nodes, r, 'series') as Ladder['series']
    const charge = Number(cell(nodes, r, 'charge'))
    if (!SERIES.has(series) || !(charge >= 1)) return fail(`node ${i} has no series or charge`)
    const peaks = peaksOf(cell(nodes, r, 'peaks'))
    if (typeof peaks === 'string') return fail(`node ${i}: ${peaks}`)
    const steps = stepsOf(cell(nodes, r, 'steps'), peaks, charge)
    if (typeof steps === 'string') return fail(`node ${i}: ${steps}`)
    const cli = list(cell(nodes, r, 'rows'), /,/).map(Number)
    const evalue = eOf(cell(nodes, r, 'evalue'))
    const judged = seriesCall(peaks, charge, series, s, residues)
    const call: SeriesCall = judged.series === series ? judged : { series, level: 'open', why: WHY }
    placements.push({
      series,
      call,
      flank: series,
      flankE: [evalue ?? Infinity, Math.min(...cli)],
      charge,
      peaks,
      steps,
      rows: cli.map((k) => tags?.[k]?.index ?? k).sort((a, b) => a - b),
      tags: cli.map((k) => tags?.[k]?.tag).filter((t): t is string => t != null),
      evalue,
      gapUnresolved: false
    })
    const p = cell(nodes, r, 'path').trim()
    role.push({ path: p === '' ? null : Number(p) - 1, role: cell(nodes, r, 'role').trim() })
    for (const a of list(cell(nodes, r, 'next'), /,/)) {
      const m = /^(\d+)([~*]*)$/.exec(a)
      if (!m) return fail(`node ${i}: arc ${a} is not a node`)
      arcs.push({ from: i, to: Number(m[1]), touch: m[2].includes('~'), used: m[2].includes('*') })
    }
  }
  if (arcs.some((a) => a.to <= a.from || a.to >= placements.length)) return fail('an arc of the tag graph leads to no later node')
  arcs.sort((a, b) => a.from - b.from || a.to - b.to)

  const ranked = [...resolved.rows].sort((a, b) => Number(cell(resolved, a, 'rank')) - Number(cell(resolved, b, 'rank')))
  const paths: GPath[] = []
  for (const [k, r] of ranked.entries()) {
    if (Number(cell(resolved, r, 'rank')) !== k + 1) return fail(`no resolved tag of rank ${k + 1}`)
    const series = cell(resolved, r, 'series') as Ladder['series']
    const level = cell(resolved, r, 'call') as SeriesCall['level']
    const charge = Number(cell(resolved, r, 'charge'))
    if (!SERIES.has(series) || !LEVELS.has(level) || !(charge >= 1)) return fail(`resolved tag #${k + 1} has no series, call or charge`)
    const peaks = peaksOf(cell(resolved, r, 'peaks'))
    if (typeof peaks === 'string') return fail(`resolved tag #${k + 1}: ${peaks}`)
    const steps = stepsOf(cell(resolved, r, 'steps'), peaks, charge)
    if (typeof steps === 'string') return fail(`resolved tag #${k + 1}: ${steps}`)
    const joined = peaksOf(cell(resolved, r, 'joined'))
    if (typeof joined === 'string') return fail(`resolved tag #${k + 1}: ${joined}`)
    const members = (what: string): number[] => role.map((x, i) => (x.path === k && x.role === what ? i : -1)).filter((i) => i >= 0)
    // The chain in m/z order; the tags inside it as they were subsumed (best E-value first).
    const chain = members('chain').sort((a, b) => placements[a].peaks[0] - placements[b].peaks[0] || a - b)
    const inside = members('inside').sort((a, b) => (placements[a].evalue ?? Infinity) - (placements[b].evalue ?? Infinity) || a - b)
    if (chain.length === 0) return fail(`no node of the tag graph builds resolved tag #${k + 1}`)
    const relations: GPath['relations'] = []
    for (const x of list(cell(resolved, r, 'relations'), /;/)) {
      const [to, kind, shared] = x.split(':')
      if (!(Number(to) >= 1) || (kind !== 'fork' && kind !== 'touch')) return fail(`resolved tag #${k + 1}: relation ${x} is not one`)
      relations.push({ path: Number(to) - 1, kind, shared: Number(shared) || 0 })
    }
    paths.push({ series, call: { series, level, why: WHY }, charge, peaks, steps, chain, inside, best: eOf(cell(resolved, r, 'best_e')), weakest: eOf(cell(resolved, r, 'weakest_e')), joined, relations, sameAs: [] })
  }
  if (paths.some((p) => p.relations.some((x) => x.path >= paths.length))) return fail('a relation names a resolved tag that is not there')
  const graph: TagGraph = { placements, paths, offPeaks: [], arcs }
  // Which tags read the same residues in another layer (not in the tables);
  // the calls FASTag settled stay as they are (no second pairCalls pass).
  sameAsOf(graph, s)
  return { ok: true, graph }
}
