// The tag graph (DESIGN-tag-graph.md v3): placements, resolved tags, relations.
import { describe, expect, it } from 'vitest'
import { buildGraph, packRows, sequenceOf, type TagIn } from './graph'
import { PROTON, WATER, residueMasses, tagRowFrom } from './ladder'
import type { SpectrumPeaks } from './dump'

const RES = residueMasses([])
const R = RES.masses
const sum = (t: string): number => [...t].reduce((a, r) => a + R[r], 0)
const N = 100
const C = 200
const SEQ = 'PEPTIDE'
const M = N + sum(SEQ) + C + WATER
// The b ions of @p seq after a flank of @p start (neutral), as m/z at 1+.
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
    tolerance: 10, toleranceUnit: 'ppm', picked: false, deisotoped: true, tagged: true, nRead: s.length, mz: s, int: s.map(() => 100)
  }
}
const columns = ['spectrum', 'tag', 'charge', 'nterm_mass', 'cterm_mass', 'gapped', 'evalue']
// A tag @p text whose b ladder starts at the neutral flank @p nterm.
const at = (index: number, nterm: number, text: string, evalue: number | null, gapped = 0, cterm = 5000): TagIn => ({
  row: tagRowFrom(columns, ['scan=1', text, '1', String(nterm), String(cterm), String(gapped), String(evalue ?? '')])!,
  evalue,
  index
})
// The tag reading SEQ[from, from+len) (as @p text for another order), b and y flanks right.
const tag = (index: number, from: number, len: number, evalue: number | null, text = SEQ.slice(from, from + len), gapped = 0): TagIn =>
  at(index, N + sum(SEQ.slice(0, from)), text, evalue, gapped, C + sum(SEQ.slice(from + len)))
const seqs = (g: ReturnType<typeof buildGraph>): string[] => g.paths.map(sequenceOf)

describe('tag graph', () => {
  it('overlapping and nested tags are one resolved tag; its weakest link is reported', () => {
    const g = buildGraph([tag(0, 0, 3, 0.01), tag(1, 2, 3, 0.5), tag(2, 1, 2, 0.1), tag(3, 3, 3, 0.02)], spec(b), RES)
    expect(seqs(g)).toEqual(['PEPTID'])
    const p = g.paths[0]
    expect([...p.chain, ...p.inside].flatMap((i) => g.placements[i].rows).sort()).toEqual([0, 1, 2, 3])
    expect(p.best).toBe(0.01)
    // The junction from P to T is spanned only by the 0.5 tag.
    expect(p.weakest).toBe(0.5)
  })

  it('a weak tag that alone bridges two strong ones is the weakest link (Astra 6)', () => {
    // PEP and TID only touch; PT spans the junction.
    const g = buildGraph([tag(0, 0, 3, 0.001), tag(1, 3, 3, 0.001), tag(2, 2, 2, 999)], spec(b), RES)
    expect(seqs(g)).toEqual(['PEPTID'])
    expect(g.paths[0].weakest).toBe(999)
    expect(g.paths[0].joined).toEqual([])
  })

  it('tags that only touch join only when asked, and the junction is marked', () => {
    const tags = [tag(0, 0, 2, 0.01), tag(1, 2, 3, 0.02)]
    const apart = buildGraph(tags, spec(b), RES)
    expect(seqs(apart).sort()).toEqual(['PE', 'PTI'])
    expect(apart.paths[0].relations).toEqual([{ path: 1, kind: 'touch', shared: 0 }])
    const g = buildGraph(tags, spec(b), RES, { join: true })
    expect(seqs(g)).toEqual(['PEPTI'])
    expect(g.paths[0].joined).toHaveLength(1)
  })

  it('two tags that cross on one step are never recombined (Astra 1)', () => {
    // PPPAG and VASSS share the A step and fork on both sides of it.
    const one = ions(N, 'PPPAG')
    const start2 = N + sum('PPP') - R.V
    const two = ions(start2, 'VASSS')
    const g = buildGraph([at(0, N, 'PPPAG', 0.01), at(1, start2, 'VASSS', 0.02)], spec([...one, ...two]), RES)
    expect(seqs(g)).toEqual(['PPPAG', 'VASSS'])
    expect(g.paths[0].relations).toEqual([{ path: 1, kind: 'fork', shared: 1 }])
    expect(g.paths.every((p) => p.chain.length === 1)).toBe(true)
  })

  it('isobaric readings of a step stay apart, each with its own evidence (Astra 2)', () => {
    // No peak inside the A+G span: P [AG] P (gapped, strong) and P Q P (weak) on the same peaks.
    const peaks = ions(N, 'PQP')
    const g = buildGraph([at(0, N, 'PAGP', 0.001, 1), at(1, N, 'PGAP', 0.001, 1), at(2, N, 'PQP', 300)], spec(peaks), RES)
    expect(g.placements).toHaveLength(1)
    expect(seqs(g)).toEqual(['P{[AG]|Q}P'])
    expect(g.paths[0].steps[1].readings.map((r) => [r.label, r.evalue])).toEqual([['[AG]', 0.001], ['Q', 300]])
  })

  it('a gapped tag stays a gap although one row order finds an incidental peak (Astra 4)', () => {
    // The T peak is there, the I peak (P I T order) is not: the rows say gapped.
    const g = buildGraph([tag(0, 2, 3, 0.3, 'PTI', 1), tag(1, 2, 3, 0.3, 'PIT', 1)], spec(b), RES)
    expect(seqs(g)).toEqual(['P[IT]'])
    expect(g.placements[0].rows).toEqual([0, 1])
  })

  it('a link that contradicts what the chain left open is not assembled (Astra, pass 3)', () => {
    // PPQP, then P{Q|[AG]}PP on the same peaks, then [AG]PPP: the last needs [AG] where the first fixed Q.
    const peaks = ions(N, 'PPQPPP')
    const n1 = N + R.P
    const n2 = n1 + R.P
    const g = buildGraph(
      [at(0, N, 'PPQP', 0.01), at(1, n1, 'PQPP', 0.02), at(2, n1, 'PAGPP', 0.02, 1), at(3, n1, 'PGAPP', 0.02, 1), at(4, n2, 'AGPPP', 0.03, 1), at(5, n2, 'GAPPP', 0.03, 1)],
      spec(peaks),
      RES
    )
    for (const p of g.paths)
      for (const i of [...p.chain, ...p.inside]) {
        const pl = g.placements[i]
        const k0 = p.peaks.indexOf(pl.peaks[0])
        // Every member has a reading of each of its steps that the path still shows.
        pl.steps.forEach((st, k) => expect(st.readings.some((r) => p.steps[k0 + k].readings.some((x) => x.label === r.label))).toBe(true))
      }
    expect(seqs(g)[0]).toBe('PPQPP')
    expect(seqs(g)).toContain('[AG]PPP')
  })

  it('evidence counts only for the reading it supports (Astra, pass 3)', () => {
    // P{[AG]|Q}P at 0.001 for [AG] and 300 for Q, continued by QPP (300): the path reads Q.
    const peaks = ions(N, 'PQPP')
    const g = buildGraph([at(0, N, 'PAGP', 0.001, 1), at(1, N, 'PGAP', 0.001, 1), at(2, N, 'PQP', 300), at(3, N + R.P, 'QPP', 300)], spec(peaks), RES)
    expect(seqs(g)[0]).toBe('PQPP')
    expect(g.paths[0].steps[1].readings.map((r) => r.label)).toEqual(['Q'])
    expect(g.paths[0].weakest).toBe(300)
  })

  it('a bubble: the better reading leads, the other is a whole alternative that forks from it', () => {
    const s = spec([...b, b[0] + R.E])
    const g = buildGraph([tag(0, 0, 3, 0.01), tag(1, 0, 3, 0.5, 'EPP')], s, RES)
    expect(seqs(g)).toEqual(['PEP', 'EPP'])
    expect(g.paths[1].relations).toEqual([{ path: 0, kind: 'fork', shared: 1 }])
    expect(packRows(g, s, 1).count).toBe(2)
  })

  it('evidence decides a bubble, and an unrelated tag does not change it (Astra 5)', () => {
    const s = spec([...b, b[0] + R.E, ...ions(3000, 'SSS')])
    const strongFirst = [tag(0, 0, 3, 0.01), tag(1, 0, 3, 0.5, 'EPP')]
    const weakFirst = [tag(0, 0, 3, 0.5), tag(1, 0, 3, 0.01, 'EPP')]
    expect(seqs(buildGraph(strongFirst, s, RES))[0]).toBe('PEP')
    expect(seqs(buildGraph(weakFirst, s, RES))[0]).toBe('EPP')
    const more = buildGraph([...strongFirst, at(2, 3000, 'SSS', 1000)], s, RES)
    expect(seqs(more)).toEqual(['PEP', 'EPP', 'SSS'])
  })

  it('does not depend on the order or the numbering of the rows (Astra 3)', () => {
    const s = spec([...b, b[0] + R.E])
    const tags = [tag(0, 0, 3, 0.01), tag(1, 0, 3, 0.5, 'EPP'), tag(2, 2, 3, 0.5), tag(3, 4, 3, 0.2), tag(4, 1, 2, 0.5)]
    const a = buildGraph(tags, s, RES)
    const r = buildGraph([...tags].reverse().map((t, i) => ({ ...t, index: i })), s, RES)
    expect(seqs(r)).toEqual(seqs(a))
    expect(r.paths.map((p) => p.peaks)).toEqual(a.paths.map((p) => p.peaks))
  })

  it('b and y of one reading are the same reading; opposite orders are not (Astra 7)', () => {
    const g = buildGraph([tag(0, 1, 3, 0.01)], spec([...b, ...y]), RES)
    expect(g.paths.map((p) => p.series).sort()).toEqual(['b', 'y'])
    expect(seqs(g)).toEqual(['EPT', 'EPT'])
    expect(g.paths[0].sameAs).toEqual([{ path: 1, steps: 3 }])
    // b reads P E, y reads E P over the same span: the inner cleavage differs.
    const s2 = spec([b[0], b[1], b[2], y[5], y[5] + R.P, y[7]])
    const g2 = buildGraph([tag(0, 0, 2, 0.01), tag(1, 0, 2, 0.01, 'EP')], s2, RES)
    expect(g2.paths.length).toBeGreaterThan(1)
    expect(g2.paths.every((p) => p.sameAs.length === 0)).toBe(true)
  })

  it('unscored and off-peak tags: counted apart, never the best evidence (Astra 9)', () => {
    const off = tag(0, 0, 3, 0.01)
    off.row.ntermMass += 3
    off.row.ctermMass += 3
    const g = buildGraph([off, tag(1, 0, 3, null), tag(2, 3, 3, 0.5)], spec(b), RES)
    expect(g.offPeaks).toEqual([0])
    expect(seqs(g)).toEqual(['TID', 'PEP'])
    expect(g.paths[1].best).toBeNull()
    // An invalid E-value is no evidence either.
    expect(seqs(buildGraph([tag(0, 0, 3, NaN), tag(1, 3, 3, 0.5)], spec(b), RES))[0]).toBe('TID')
    expect(buildGraph([], spec(b), RES).paths).toEqual([])
  })
})
