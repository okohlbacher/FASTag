// Tag resolution by a compatibility graph (data/DESIGN-tag-graph.md, v3).
//
// Nodes are the ions the tags of a spectrum lie on: a peak in one layer
// (series, fragment charge). A tag placed on the peaks is a chain of nodes;
// two nodes adjacent in a chain are joined by a step (one residue, or the two
// residues a gapped tag read across a missing peak, unordered).
//
// A resolved tag is an assembly of WHOLE placed tags: each next one overlaps
// the assembly's end by at least one step (or, with `join`, touches it at a
// peak) and agrees with it on every shared step. So a resolved tag never
// reads a sequence that recombines parts of tags that fork, and every placed
// tag belongs to exactly one resolved tag: as a link of its chain or lying
// wholly inside it (subsumed).
//
// - Rows that land on the same chain of peaks are one placement; different
//   readings of a step (Q or [AG]) stay apart on it, each with its own
//   evidence. FASTag writes a gapped tag once per order of its gap residues:
//   those rows land on the same chain and become one placement.
// - Evidence is per placement (its best E-value) against a fixed reference,
//   so another, unrelated tag never changes a ranking.
// - Resolved tags are taken best first; what is left over forms the
//   alternatives, each again a whole assembly with its shared steps.

import type { SpectrumPeaks } from './dump'
import { C_OFFSET, PROTON, WATER, Z_DOT_OFFSET, laddersFor, parseTag, type Ladder, type Residues, type TagRow } from './ladder'

export interface TagIn {
  row: TagRow
  // null: the row has no usable E-value.
  evalue: number | null
  // The tag's index in the spectrum's tags.
  index: number
}

export interface Reading {
  // One residue, or a gap's residues in alphabetical order: [CW].
  label: string
  gap: boolean
  // Best E-value of the rows that read the step so (null: unscored).
  evalue: number | null
  // The step's error under this reading: observed minus expected distance.
  deltaMz: number
  deltaPpm: number
}

export interface Step {
  // Peak indices, u below v in m/z.
  u: number
  v: number
  // Best evidence first.
  readings: Reading[]
}

/** The rows that lie on one chain of peaks of one layer. */
export interface Placement {
  series: Ladder['series']
  charge: number
  peaks: number[]
  steps: Step[]
  rows: number[]
  tags: string[]
  evalue: number | null
  // A gapped tag all of whose positions are on peaks: which two residues it
  // read across a gap is not known.
  gapUnresolved: boolean
}

export interface Relation {
  path: number
  // fork: the two share a peak and continue differently from it (at most one
  // is right there). touch: they meet without contradicting each other.
  kind: 'fork' | 'touch'
  // Steps the two have in common.
  shared: number
}

export interface GPath {
  series: Ladder['series']
  charge: number
  peaks: number[]
  steps: Step[]
  // Placements: the chain that builds it (in m/z order) and those inside it.
  chain: number[]
  inside: number[]
  // Evidence along it, from the tags that read it as it is reported: the
  // best E-value on any step, and the weakest step or junction (a junction's
  // evidence is the best tag spanning its two steps; a joined one has none).
  best: number | null
  weakest: number | null
  // Peaks at which two tags that only touch were joined.
  joined: number[]
  relations: Relation[]
  // Resolved tags of another layer with the same steps at the same prefix masses.
  sameAs: { path: number; steps: number }[]
}

export interface TagGraph {
  placements: Placement[]
  paths: GPath[]
  // Tags whose ladder is not on the peaks.
  offPeaks: number[]
}

const il = (s: string): string => s.replace(/I/g, 'L')
const layerOf = (e: { series: string; charge: number }): string => `${e.series}${e.charge}`
const nTerminal = (s: Ladder['series']): boolean => s === 'b' || s === 'c'
const tolAt = (s: SpectrumPeaks, x: number): number => (s.toleranceUnit === 'ppm' ? (x * s.tolerance) / 1e6 : s.tolerance)
const byE = (a: number | null, b: number | null): number => (a ?? Infinity) - (b ?? Infinity)
const minE = (a: number | null, b: number | null): number | null => (a == null ? b : b == null ? a : Math.min(a, b))

// A placement's evidence against a fixed reference (E = 1000): at least 1,
// 1000 per decade below it; an unscored (or invalid) one counts nothing.
const EVIDENCE_REF = 3
export const evidence = (e: number | null): number => (e == null || !(e >= 0) ? 0 : Math.max(1, Math.round(1000 * (EVIDENCE_REF - Math.log10(Math.max(e, 1e-300))))))

const compatible = (a: Step, b: Step): boolean => a.readings.some((x) => b.readings.some((y) => il(x.label) === il(y.label)))

function place(tags: TagIn[], s: SpectrumPeaks, residues: Residues): { placements: Placement[]; offPeaks: number[] } {
  interface Cand {
    t: TagIn
    l: Ladder
    family: string
    full: boolean
  }
  const cands: Cand[] = []
  const offPeaks: number[] = []
  for (const t of [...tags].sort((a, b) => a.index - b.index)) {
    const parsed = parseTag(t.row.tag)
    const comp = parsed ? parsed.map((r) => il(r.residue) + (r.mod ? `[${r.mod}]` : '')).sort().join('') : t.row.tag
    const family = [t.row.charge, t.row.ntermMass, t.row.ctermMass, t.row.ionSeries, t.evalue, comp].join('|')
    const ls = laddersFor(t.row, s, residues).both.filter((l) => l.complete)
    if (ls.length === 0) offPeaks.push(t.index)
    for (const l of ls) cands.push({ t, l, family: `${family}|${l.series}`, full: l.positions.every((p) => p.peak != null) })
  }
  // A gapped tag read across a missing peak. If one row order of it found a
  // peak at every position while another has the gap, the gap is the reading.
  const withGap = new Set(cands.filter((c) => c.t.row.gapped && !c.full).map((c) => c.family))
  const byChain = new Map<string, Placement>()
  const gapOf = new Map<string, string>() // family -> the chain of its gap reading
  const dropped: Cand[] = []
  for (const c of cands) {
    if (c.t.row.gapped && c.full && withGap.has(c.family)) {
      dropped.push(c)
      continue
    }
    const { l, t } = c
    const peaks: number[] = []
    const steps: Step[] = []
    let from = 0
    l.positions.forEach((p, k) => {
      if (p.peak == null) return
      peaks.push(p.peak)
      if (k > 0) {
        const res = l.residues.slice(from, k)
        const gap = res.length > 1
        const label = gap ? `[${[...res].sort((x, y) => il(x).localeCompare(il(y)) || x.localeCompare(y)).join('')}]` : res[0]
        steps.push({ u: l.positions[from].peak as number, v: p.peak, readings: [{ label, gap, evalue: t.evalue, deltaMz: p.deltaMz ?? 0, deltaPpm: p.deltaPpm ?? 0 }] })
      }
      from = k
    })
    const key = `${layerOf(l)}|${peaks.join(',')}`
    if (t.row.gapped && !c.full && !gapOf.has(c.family)) gapOf.set(c.family, key)
    const have = byChain.get(key)
    if (!have) {
      byChain.set(key, { series: l.series, charge: l.charge, peaks, steps, rows: [t.index], tags: [t.row.tag], evalue: t.evalue, gapUnresolved: t.row.gapped && c.full })
      continue
    }
    if (!have.rows.includes(t.index)) {
      have.rows.push(t.index)
      have.tags.push(t.row.tag)
    }
    have.evalue = minE(have.evalue, t.evalue)
    have.gapUnresolved = have.gapUnresolved && t.row.gapped && c.full
    steps.forEach((st, k) => {
      const r = st.readings[0]
      const same = have.steps[k].readings.find((x) => il(x.label) === il(r.label))
      if (same) same.evalue = minE(same.evalue, r.evalue)
      else have.steps[k].readings.push(r)
    })
  }
  // The dropped row order is still a row of that gapped tag.
  for (const c of dropped) {
    const p = byChain.get(gapOf.get(c.family) as string)
    if (p && !p.rows.includes(c.t.index)) {
      p.rows.push(c.t.index)
      p.tags.push(c.t.row.tag)
    }
  }
  const placements = [...byChain.values()]
  for (const p of placements) p.rows.sort((a, b) => a - b)
  for (const p of placements) for (const st of p.steps) st.readings.sort((a, b) => byE(a.evalue, b.evalue) || il(a.label).localeCompare(il(b.label)))
  // Canonical order: by layer, then by peaks.
  placements.sort((a, b) => layerOf(a).localeCompare(layerOf(b)) || a.peaks[0] - b.peaks[0] || a.peaks.join(',').localeCompare(b.peaks.join(',')))
  return { placements, offPeaks }
}

/** Where @p b continues @p a: the index in a.peaks of b.peaks[0], or -1.
 *  b starts inside a (not at its start), agrees with it to a's end and ends beyond it. */
function continues(a: Placement, b: Placement, join: boolean, minOverlap: number): number {
  if (layerOf(a) !== layerOf(b)) return -1
  const i = a.peaks.indexOf(b.peaks[0])
  if (i <= 0) return -1
  const over = a.peaks.length - i // peaks in common
  if (b.peaks.length <= over) return -1
  for (let k = 0; k < over; k++) if (a.peaks[i + k] !== b.peaks[k]) return -1
  for (let k = 0; k + 1 < over; k++) if (!compatible(a.steps[i + k], b.steps[k])) return -1
  if (over === 1) {
    // They only touch.
    if (!join) return -1
    if (a.steps[a.steps.length - 1].readings.every((r) => r.gap) && b.steps[0].readings.every((r) => r.gap)) return -1
  }
  else if (over - 1 < minOverlap) return -1
  return i
}

/** The graph of @p tags on the peaks of @p s, resolved. */
export function buildGraph(tags: TagIn[], s: SpectrumPeaks, residues: Residues, opts: { join: boolean; minOverlap?: number } = { join: false }): TagGraph {
  const { placements, offPeaks } = place(tags, s, residues)
  const n = placements.length
  // arcs[b]: the placements b continues (they come before b in canonical order).
  const arcs: number[][] = placements.map(() => [])
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n && layerOf(placements[b]) === layerOf(placements[a]); b++) if (continues(placements[a], placements[b], opts.join, opts.minOverlap ?? 1) > 0) arcs[b].push(a)

  const alive = new Array<boolean>(n).fill(true)
  const paths: GPath[] = []
  for (;;) {
    // The best chain of placements still unassigned. Score: summed evidence,
    // then steps covered.
    const f: ({ score: number; first: number; prev: number } | null)[] = placements.map(() => null)
    let end = -1
    // Of equal scores the chain covering more m/z wins, then the earlier placement.
    const reach = (i: number): number => s.mz[placements[i].peaks[placements[i].peaks.length - 1]] - s.mz[placements[(f[i] as { first: number }).first].peaks[0]]
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue
      const w = evidence(placements[i].evalue)
      let best = { score: w, first: i, prev: -1 }
      for (const a of arcs[i]) {
        const fa = f[a]
        if (!alive[a] || !fa) continue
        const c = { score: fa.score + w, first: fa.first, prev: a }
        if (c.score > best.score || (c.score === best.score && placements[c.first].peaks[0] < placements[best.first].peaks[0])) best = c
      }
      f[i] = best
      const fe = end < 0 ? null : (f[end] as { score: number })
      if (!fe || best.score > fe.score || (best.score === fe.score && reach(i) > reach(end))) end = i
    }
    if (end < 0) break
    const chain: number[] = []
    for (let i = end; i >= 0; i = (f[i] as { prev: number }).prev) chain.unshift(i)

    const head = placements[chain[0]]
    const peaks = [...head.peaks]
    const steps: Step[] = head.steps.map((st) => ({ ...st, readings: st.readings.map((r) => ({ ...r })) }))
    const joined: number[] = []
    // Take p into the path: false (and nothing changed) when p reads a
    // shared step in a way no longer open on the path.
    const absorb = (p: Placement): boolean => {
      const at = peaks.indexOf(p.peaks[0])
      if (p.steps.some((st, k) => steps[at + k] && !compatible(st, steps[at + k]))) return false
      p.steps.forEach((st, k) => {
        const mine = steps[at + k]
        if (!mine) {
          peaks.push(st.v)
          steps.push({ ...st, readings: st.readings.map((r) => ({ ...r })) })
          return
        }
        // A shared step keeps the readings both have, each with its better evidence.
        mine.readings = mine.readings.filter((r) => st.readings.some((x) => il(x.label) === il(r.label)))
        for (const r of mine.readings) r.evalue = minE(r.evalue, (st.readings.find((x) => il(x.label) === il(r.label)) as Reading).evalue)
        mine.readings.sort((a, b) => byE(a.evalue, b.evalue) || il(a.label).localeCompare(il(b.label)))
      })
      return true
    }
    // ponytail: the DP checks each link against its predecessor only; a link
    // that contradicts what earlier links left open ends the chain here (it
    // stays for a later resolved tag). Carry reading sets in the DP state if
    // the cut ever costs good assemblies.
    for (let k = 1; k < chain.length; k++) {
      const p = placements[chain[k]]
      const touching = peaks[peaks.length - 1] === p.peaks[0]
      if (!absorb(p)) {
        chain.length = k
        break
      }
      if (touching) joined.push(p.peaks[0])
    }
    for (const i of chain) alive[i] = false
    // Placements wholly inside it that agree with it are subsumed, best evidence first.
    const inside: number[] = []
    const cands = placements.map((_, i) => i).filter((i) => alive[i] && layerOf(placements[i]) === layerOf(head))
    cands.sort((x, y) => byE(placements[x].evalue, placements[y].evalue) || x - y)
    for (const i of cands) {
      const p = placements[i]
      const at = peaks.indexOf(p.peaks[0])
      if (at < 0 || !p.peaks.every((x, k) => peaks[at + k] === x) || !absorb(p)) continue
      inside.push(i)
      alive[i] = false
    }
    // Evidence per step and per junction, from the members' readings that survived.
    const stepE: (number | null)[] = steps.map(() => null)
    const junctionE: (number | null | undefined)[] = steps.slice(1).map(() => undefined)
    for (const i of [...chain, ...inside]) {
      const p = placements[i]
      const at = peaks.indexOf(p.peaks[0])
      const e = p.steps.map((st, k) => st.readings.filter((r) => steps[at + k].readings.some((x) => il(x.label) === il(r.label))).reduce((m: number | null, r) => minE(m, r.evalue), null))
      e.forEach((x, k) => {
        stepE[at + k] = minE(stepE[at + k], x)
        if (k > 0) junctionE[at + k - 1] = minE(junctionE[at + k - 1] ?? null, x == null || e[k - 1] == null ? null : Math.max(x, e[k - 1] as number))
      })
    }
    const all = [...stepE, ...junctionE.filter((x) => x !== undefined)] as (number | null)[]
    paths.push({
      series: head.series,
      charge: head.charge,
      peaks,
      steps,
      chain,
      inside,
      best: stepE.reduce(minE, null),
      weakest: all.some((e) => e == null) ? null : Math.max(...(all as number[])),
      joined,
      relations: [],
      sameAs: []
    })
  }

  // How the resolved tags of a layer meet.
  for (let a = 0; a < paths.length; a++)
    for (let b = a + 1; b < paths.length; b++) {
      const A = paths[a]
      const B = paths[b]
      if (layerOf(A) !== layerOf(B)) continue
      let fork = false
      let touch = false
      for (const p of A.peaks) {
        const j = B.peaks.indexOf(p)
        if (j < 0) continue
        const i = A.peaks.indexOf(p)
        const differ = (x: number | undefined, y: number | undefined): boolean => x !== undefined && y !== undefined && x !== y
        if (differ(A.peaks[i + 1], B.peaks[j + 1]) || differ(A.peaks[i - 1], B.peaks[j - 1])) fork = true
        else touch = true
      }
      const shared = A.steps.filter((x) => B.steps.some((y) => x.u === y.u && x.v === y.v)).length
      if (!fork && !touch) continue
      const kind = fork ? 'fork' : 'touch'
      A.relations.push({ path: b, kind, shared })
      B.relations.push({ path: a, kind, shared })
    }

  // The same reading in another layer (b and y, or two charges): consecutive
  // cleavages at the same prefix masses with a common reading between them.
  const M = s.precursor != null && s.charge > 0 ? s.precursor * s.charge - s.charge * PROTON : null
  const cleavages = (p: GPath): { m: number; tol: number }[] | null => {
    const out = p.peaks.map((i) => {
      const neutral = s.mz[i] * p.charge - p.charge * PROTON
      const tol = tolAt(s, s.mz[i]) * p.charge
      if (p.series === 'b') return { m: neutral, tol }
      if (p.series === 'c') return { m: neutral - C_OFFSET, tol }
      // From the C terminus: the precursor mass and its error come in.
      if (M == null || s.precursor == null) return null
      return { m: M - WATER - (neutral - (p.series === 'y' ? WATER : Z_DOT_OFFSET)), tol: tol + tolAt(s, s.precursor) * s.charge }
    })
    return out.some((x) => x == null) ? null : (out as { m: number; tol: number }[])
  }
  // Steps in N-to-C order with the prefix masses of their two cleavages.
  const oriented = (p: GPath): { a: { m: number; tol: number }; b: { m: number; tol: number }; step: Step }[] | null => {
    const c = cleavages(p)
    if (!c) return null
    const st = p.steps.map((step, k) => (nTerminal(p.series) ? { a: c[k], b: c[k + 1], step } : { a: c[k + 1], b: c[k], step }))
    return nTerminal(p.series) ? st : st.reverse()
  }
  const or = paths.map(oriented)
  const near = (x: { m: number; tol: number }, y: { m: number; tol: number }): boolean => Math.abs(x.m - y.m) <= x.tol + y.tol
  for (let a = 0; a < paths.length; a++)
    for (let b = a + 1; b < paths.length; b++) {
      const A = or[a]
      const B = or[b]
      if (!A || !B || layerOf(paths[a]) === layerOf(paths[b])) continue
      const same = A.filter((x) => B.some((y) => near(x.a, y.a) && near(x.b, y.b) && compatible(x.step, y.step))).length
      if (same > 0) {
        paths[a].sameAs.push({ path: b, steps: same })
        paths[b].sameAs.push({ path: a, steps: same })
      }
    }

  return { placements, paths, offPeaks }
}

/** A step as text: its reading, or its readings when they are not told apart: {Q|[AG]}. */
export const stepLabel = (st: Step): string => (st.readings.length > 1 ? `{${st.readings.map((r) => r.label).join('|')}}` : st.readings[0].label)

/** Residues from N to C terminus; a gap's residues are unordered. */
export function sequenceOf(p: { series: Ladder['series']; steps: Step[] }): string {
  const labels = p.steps.map(stepLabel)
  return (nTerminal(p.series) ? labels : labels.reverse()).join('')
}

/** A resolved tag as a ladder, for the plot. */
export function ladderOf(p: GPath, s: SpectrumPeaks): Ladder {
  const pos = (i: number, st?: Step): Ladder['positions'][number] => {
    const r = st?.readings[0]
    return { expected: s.mz[i] - (r?.deltaMz ?? 0), peak: i, mz: s.mz[i], deltaMz: r?.deltaMz ?? 0, deltaPpm: r?.deltaPpm ?? 0 }
  }
  return {
    series: p.series,
    charge: p.charge,
    positions: [pos(p.peaks[0]), ...p.steps.map((st) => pos(st.v, st))],
    residues: p.steps.map(stepLabel),
    matched: p.peaks.length,
    complete: true
  }
}

/** One plot row per resolved tag, in rank order, N-terminal series above
 *  C-terminal; tags that do not overlap in m/z share a row. */
export function packRows(g: TagGraph, s: SpectrumPeaks, gap: number): { rows: number[]; count: number } {
  const span = (p: GPath): [number, number] => [s.mz[p.peaks[0]], s.mz[p.peaks[p.peaks.length - 1]]]
  const rows = new Array<number>(g.paths.length).fill(0)
  let base = 0
  for (const side of [true, false]) {
    const taken: [number, number][][] = []
    g.paths.forEach((p, i) => {
      if (nTerminal(p.series) !== side) return
      const [a, b] = span(p)
      let r = taken.findIndex((row) => row.every(([x, y]) => b + gap < x || y + gap < a))
      if (r < 0) r = taken.push([]) - 1
      taken[r].push([a, b])
      rows[i] = base + r
    })
    base += taken.length
  }
  return { rows, count: base }
}

/** How a step stands to the resolved tag @p sel: `same` (sel has the step
 *  with a common reading), `differs` (same layer, another step over part of
 *  sel's m/z span: at most one of the two is right there), else `other`. */
export type StepKind = 'same' | 'differs' | 'other'
export function kindOf(st: Step, layer: { series: string; charge: number }, sel: GPath, s: SpectrumPeaks): StepKind {
  if (layerOf(layer) !== layerOf(sel)) return 'other'
  const mine = sel.steps.find((x) => x.u === st.u && x.v === st.v)
  if (mine && compatible(mine, st)) return 'same'
  return s.mz[st.v] > s.mz[sel.peaks[0]] && s.mz[st.u] < s.mz[sel.peaks[sel.peaks.length - 1]] ? 'differs' : 'other'
}
