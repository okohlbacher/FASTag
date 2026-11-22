// FASTag's -resolved_out and -tag_graph_out rows as a TagGraph (cliGraph.ts):
// a graph buildGraph made, written in the SPEC.md formats, reads back the same.
import { describe, expect, it } from 'vitest'
import { buildGraph, sequenceOf, type GraphOpts, type TagGraph, type TagIn } from './graph'
import { fromCli } from './cliGraph'
import { PROTON, WATER, residueMasses, tagRowFrom } from './ladder'
import { stepWeight } from './stepScore'
import { g6, toCli } from '../testing/cliGraphTsv'
import type { SpectrumPeaks } from './dump'

const RES = residueMasses([])
const R = RES.masses
const sum = (t: string): number => [...t].reduce((a, r) => a + R[r], 0)
const N = 100
const C = 200
const SEQ = 'PEPTIDE'
const M = N + sum(SEQ) + C + WATER
const ions = (start: number, seq: string): number[] => {
  const out = [start + PROTON]
  for (const r of seq) out.push(out[out.length - 1] + R[r])
  return out
}
const b = ions(N, SEQ)
const y = ions(C + WATER, [...SEQ].reverse().join(''))
const spec = (mz: number[]): SpectrumPeaks => {
  const s = [...new Set(mz.map((x) => Math.round(x * 1e6) / 1e6))].sort((p, q) => p - q)
  return {
    nativeId: 'scan=1', index: 0, msLevel: 2, rt: null, precursor: (M + 2 * PROTON) / 2, charge: 2, chargeGiven: 2,
    tolerance: 10, toleranceUnit: 'ppm', picked: false, deisotoped: true, tagged: true, nRead: s.length, mz: s, int: s.map((_, i) => 100 + ((i * 37) % 50))
  }
}
const columns = ['spectrum', 'tag', 'charge', 'nterm_mass', 'cterm_mass', 'gapped', 'evalue']
const at = (index: number, nterm: number, text: string, evalue: number | null, gapped = 0, cterm = 5000): TagIn => ({
  row: tagRowFrom(columns, ['scan=1', text, '1', String(nterm), String(cterm), String(gapped), String(evalue ?? '')])!,
  evalue,
  index
})
const tag = (index: number, from: number, len: number, evalue: number | null, text = SEQ.slice(from, from + len), gapped = 0): TagIn =>
  at(index, N + sum(SEQ.slice(0, from)), text, evalue, gapped, C + sum(SEQ.slice(from + len)))

// What the views read of a graph, without the series reasons and the step errors.
const shape = (g: TagGraph): unknown => ({
  paths: g.paths.map((p) => ({ seq: sequenceOf(p), series: p.series, level: p.call.level, charge: p.charge, peaks: p.peaks, chain: p.chain, inside: p.inside, best: p.best, weakest: p.weakest, joined: p.joined, relations: p.relations, sameAs: p.sameAs, readings: p.steps.map((st) => st.readings.map((r) => [r.label, r.gap, r.evalue])) })),
  placements: g.placements.map((p) => ({ series: p.series, charge: p.charge, peaks: p.peaks, rows: p.rows, evalue: p.evalue, readings: p.steps.map((st) => st.readings.map((r) => [r.label, r.evalue])) })),
  arcs: g.arcs
})

function roundTrip(tags: TagIn[], s: SpectrumPeaks, opts?: GraphOpts): { g: TagGraph; back: TagGraph } {
  const g = buildGraph(tags, s, RES, opts)
  const { resolved, nodes } = toCli(g, s, 'scan=1')
  const back = fromCli(resolved, nodes, s, RES)
  if (!back.ok) throw new Error(back.error)
  return { g, back: back.graph }
}

describe('FASTag tag graph tables', () => {
  it('read back as the graph they were written from', () => {
    const cases: [TagIn[], SpectrumPeaks, GraphOpts?][] = [
      // Overlapping and nested tags: one resolved tag with members inside it.
      [[tag(0, 0, 3, 0.01), tag(1, 2, 3, 0.5), tag(2, 1, 2, 0.1), tag(3, 3, 3, 0.02)], spec(b)],
      // Two that only touch, joined; a bubble that forks.
      [[tag(0, 0, 2, 0.01), tag(1, 2, 3, 0.02)], spec(b), { join: true }],
      [[tag(0, 0, 3, 0.01), tag(1, 0, 3, 0.5, 'EPP')], spec([...b, b[0] + R.E])],
      // A gap and an isobaric reading of one step.
      [[at(0, N, 'PAGP', 0.001, 1), at(1, N, 'PGAP', 0.001, 1), at(2, N, 'PQP', 300)], spec(ions(N, 'PQP'))],
      // b and y of one reading (sameAs), ranked by the step log-odds.
      [[tag(0, 1, 3, 0.01), tag(1, 2, 4, 1e-7)], spec([...b, ...y]), { join: false, weight: stepWeight(spec([...b, ...y])) }]
    ]
    const seen = new Set<string>()
    for (const [tags, s, opts] of cases) {
      const { g, back } = roundTrip(tags, s, opts)
      for (const p of g.paths) {
        if (p.inside.length) seen.add('inside')
        if (p.joined.length) seen.add('joined')
        if (p.sameAs.length) seen.add('sameAs')
        if (p.relations.some((r) => r.kind === 'fork')) seen.add('fork')
        if (p.steps.some((st) => st.readings.length > 1)) seen.add('readings')
      }
      if (g.arcs.some((a) => a.touch && a.used)) seen.add('touch')
      expect(g.paths.length).toBeGreaterThan(0)
      expect(shape(back)).toEqual(shape(g))
      // The step errors come back from the residue masses.
      back.paths.forEach((p, k) => p.steps.forEach((st, j) => expect(st.readings[0].deltaPpm).toBeCloseTo(g.paths[k].steps[j].readings[0].deltaPpm, 6)))
    }
    expect([...seen].sort()).toEqual(['fork', 'inside', 'joined', 'readings', 'sameAs', 'touch'])
  })

  it('names the tags behind a placement by the caller\'s rows', () => {
    const s = spec(b)
    const { resolved, nodes } = toCli(buildGraph([tag(0, 0, 3, 0.01), tag(1, 0, 3, 0.02, 'PEP')], s, RES), s, 'scan=1')
    // The CLI's row 0 is the caller's row 5, its row 1 the caller's row 2.
    const r = fromCli(resolved, nodes, s, RES, [{ index: 5, tag: 'PEP' }, { index: 2, tag: 'PEP*' }])
    expect(r.ok && r.graph.placements.map((p) => [p.rows, p.tags])).toEqual([[[2, 5], ['PEP', 'PEP*']]])
  })

  it('refuses tables that do not fit the peaks', () => {
    const s = spec(b)
    const { resolved, nodes } = toCli(buildGraph([tag(0, 0, 3, 0.01)], s, RES), s, 'scan=1')
    const pk = nodes.columns.indexOf('peaks')
    const moved = { ...nodes, rows: nodes.rows.map((r) => r.map((c, i) => (i === pk ? c.replace(/^[^;]+/, '99.5') : c))) }
    expect(fromCli(resolved, moved, s, RES)).toEqual({ ok: false, error: 'node 0: m/z 99.5 is not a peak of the spectrum' })
    expect(fromCli({ columns: ['spectrum'], rows: [] }, nodes, s, RES)).toMatchObject({ ok: false, error: expect.stringContaining('no rank') })
    // No rows for the spectrum: nothing resolved.
    expect(fromCli({ ...resolved, rows: [] }, { ...nodes, rows: [] }, s, RES)).toMatchObject({ ok: true, graph: { paths: [], placements: [], arcs: [] } })
  })

  it('writes E-values as printf %g does', () => {
    expect([0.001, 1e-7, 1.234567e-5, 300, 0.5, 123456789].map(g6)).toEqual(['0.001', '1e-07', '1.23457e-05', '300', '0.5', '1.23457e+08'])
  })
})
