// Which ion series a ladder lies on (seriesCall): a ions beside b ions, the
// complement's a ions, a tryptic C terminus; otherwise not told apart.
import { describe, expect, it } from 'vitest'
import { PROTON, WATER, laddersFor, residueMasses, seriesCall, seriesText, tagRowFrom } from './ladder'
import { buildGraph, sequenceOf } from './graph'
import { dbCall, ladderSteps, likelyPeptide } from './peptide'
import type { SpectrumPeaks } from './dump'

const RES = residueMasses([])
const R = RES.masses
const CO = 27.9949146
const sum = (t: string): number => [...t].reduce((a, r) => a + R[r], 0)
// Peptide PEPTIDEK at 2+: b and y ions at 1+.
const PEP = 'PEPTIDEK'
const M = sum(PEP) + WATER
const b = (i: number): number => sum(PEP.slice(0, i)) + PROTON
const y = (i: number): number => sum(PEP.slice(PEP.length - i)) + WATER + PROTON
const spec = (mz: number[]): SpectrumPeaks => {
  const s = [...new Set(mz.map((x) => Math.round(x * 1e6) / 1e6))].sort((p, q) => p - q)
  return {
    nativeId: 'scan=1', index: 0, msLevel: 2, rt: null, precursor: (M + 2 * PROTON) / 2, charge: 2, chargeGiven: 2,
    tolerance: 10, toleranceUnit: 'ppm', picked: false, deisotoped: true, tagged: true, nRead: s.length, mz: s, int: s.map(() => 100)
  }
}
const idx = (s: SpectrumPeaks, xs: number[]): number[] => xs.map((x) => s.mz.findIndex((m) => Math.abs(m - x) < 1e-4))
const cols = ['spectrum', 'tag', 'charge', 'nterm_mass', 'cterm_mass', 'gapped', 'evalue']
// A tag as FASTag writes it: residues in ascending m/z, flanks for that order.
const row = (tag: string, nterm: number, cterm: number, e = '0.01') => tagRowFrom(cols, ['scan=1', tag, '1', String(nterm), String(cterm), '0', e])!

describe('series call', () => {
  it('a ions beside two b peaks: b, sure', () => {
    const s = spec([b(2), b(3), b(4), b(2) - CO, b(3) - CO])
    expect(seriesCall(idx(s, [b(2), b(3), b(4)]), 1, 'y', s, RES)).toMatchObject({ series: 'b', level: 'sure' })
  })
  it('a ions beside two complement peaks: y, sure, even when walked as b', () => {
    // y3..y5 = 'IDEK' end; complements are b5, b4, b3 (with a ions).
    const s = spec([y(3), y(4), y(5), b(5), b(4), b(3), b(4) - CO, b(3) - CO])
    expect(seriesCall(idx(s, [y(3), y(4), y(5)]), 1, 'b', s, RES)).toMatchObject({ series: 'y', level: 'sure' })
  })
  it('read as y, a ladder starting right after a C-terminal K is y, sure', () => {
    const s = spec([y(1), y(2), y(3)])
    expect(seriesCall(idx(s, [y(1), y(2), y(3)]), 1, 'b', s, RES)).toMatchObject({ series: 'y', level: 'sure' })
  })
  it('one a ion: b, likely; none: not told apart, as walked', () => {
    const s1 = spec([b(2), b(3), b(4), b(3) - CO])
    expect(seriesCall(idx(s1, [b(2), b(3), b(4)]), 1, 'y', s1, RES)).toMatchObject({ series: 'b', level: 'likely' })
    const s0 = spec([b(2), b(3), b(4)])
    expect(seriesCall(idx(s0, [b(2), b(3), b(4)]), 1, 'y', s0, RES)).toMatchObject({ series: 'y', level: 'open' })
    expect(seriesCall(idx(s0, [b(2), b(3), b(4)]), 1, 'b', s0, RES)).toMatchObject({ series: 'b', level: 'open' })
    expect(seriesText('y', { series: 'y', level: 'open', why: '' })).toBe('b or y')
    expect(seriesText('b', { series: 'b', level: 'likely', why: '' })).toBe('b?')
  })
  it('c and z are not judged', () => {
    const s = spec([b(2), b(3), b(4), b(2) - CO, b(3) - CO])
    expect(seriesCall(idx(s, [b(2), b(3), b(4)]), 1, 'z', s, RES)).toMatchObject({ series: 'z', level: 'open' })
  })
})

describe('series of ladders and resolved tags', () => {
  it('a tag on y ions walked from its N-terminal flank is shown as y, read the other way N to C', () => {
    // FASTag wrote the ascending residues K|E|D? Take y1..y4 = K, E, D, I ascending: the tag "EDI" from y1.
    const s = spec([y(1), y(2), y(3), y(4)])
    const r = row('EDI', y(1) - PROTON, M - (y(4) - PROTON))
    const { both } = laddersFor(r, s, RES)
    const walkedB = both.find((l) => l.walked === 'b')!
    expect(walkedB.complete).toBe(true)
    expect(walkedB.series).toBe('y')
    expect(walkedB.call?.level).toBe('sure')
    // Ascending residues E, D, I; as y ions that reads I D E from N to C (…IDEK).
    expect(walkedB.residues).toEqual(['E', 'D', 'I'])
  })

  it('tags on the same peaks meet whichever flank they were walked from', () => {
    // Two tags on y1..y5 (K, E, D, I, T ascending): "EDI" from the N-terminal flank, "TID" read
    // the other way round (its C-terminal walk lands on the same ascending peaks).
    const s = spec([y(1), y(2), y(3), y(4), y(5)])
    const a = row('EDI', y(1) - PROTON, M - (y(4) - PROTON), '0.001')
    const c = row('TID', M - (y(5) - PROTON) - WATER, y(2) - PROTON - WATER, '0.002')
    const g = buildGraph([{ row: a, evalue: 0.001, index: 0 }, { row: c, evalue: 0.002, index: 1 }], s, RES, { join: false })
    const top = g.paths[0]
    expect(top.peaks.length).toBe(5)
    expect(top.series).toBe('y')
    expect(sequenceOf(top)).toBe('TIDE')
  })

  it('the database peptide decides the series of a ladder', () => {
    const s = spec([b(2), b(3), b(4), b(5)])
    const r = row('PTI', b(2) - PROTON, M - (b(5) - PROTON))
    const l = laddersFor(r, s, RES).both.find((x) => x.walked === 'b')!
    expect(l.call?.level).toBe('open')
    const cand = likelyPeptide(['spectrum', 'tag', 'protein', 'peptide', 'nterm_match', 'cterm_match', 'delta_mass', 'region'], [['scan=1', 'PTI', 'P1', PEP, '1', '1', '0', '']])!
    expect(dbCall(cand, ladderSteps(l), 1, l.series, RES, s)).toMatchObject({ series: 'b', level: 'sure' })
  })
})

// Flanks as FASTag writes them: nterm + residues + cterm + water = M.
const rowOn = (tag: string, nterm: number, e = '0.01', gapped = '0') =>
  tagRowFrom(cols, ['scan=1', tag, '1', String(nterm), String(M - WATER - nterm - sum(tag)), gapped, e])!
const yAsc = (from: number, to: number): string => [...PEP].reverse().slice(from, to).join('') // residues between y_from and y_to, ascending

describe('series: review findings', () => {
  it('at a wide (Da) tolerance nothing is called', () => {
    const s = { ...spec([b(2), b(3), b(4), b(2) - CO, b(3) - CO]), tolerance: 0.5, toleranceUnit: 'Da' as const }
    expect(seriesCall(idx(s, [b(2), b(3), b(4)]), 1, 'b', s, RES)).toMatchObject({ series: 'b', level: 'open' })
  })

  it('the K/R rule uses the run\'s K (TMT6plex on K) and no charge-widened window', () => {
    const tmt = residueMasses(['TMT6plex (K)'])
    const yK = tmt.masses.K + WATER + PROTON
    const s = spec([yK, yK + R.E, yK + R.E + R.D])
    expect(seriesCall(idx(s, [yK, yK + R.E, yK + R.E + R.D]), 1, 'b', s, tmt)).toMatchObject({ series: 'y', level: 'sure' })
    // Bare K at 147.11 with TMT on K is not a C-terminal K.
    const s2 = spec([y(1), y(2), y(3)])
    expect(seriesCall(idx(s2, [y(1), y(2), y(3)]), 1, 'b', s2, tmt).level).toBe('open')
  })

  it('the two walks of one tag are opposite series and read the same N to C', () => {
    // y1..y4 (K|E|D|I ascending) and their complements b4..b7: a tag "EDI" read up from y1.
    const s = spec([y(1), y(2), y(3), y(4), b(4), b(5), b(6), b(7)])
    const { both } = laddersFor(rowOn('EDI', y(1) - PROTON), s, RES)
    const [w1, w2] = both
    expect(w1.complete && w2.complete).toBe(true)
    expect(new Set([w1.series, w2.series])).toEqual(new Set(['b', 'y']))
    const n2c = (l: typeof w1) => (l.series === 'b' ? l.residues : [...l.residues].reverse()).join('')
    expect(n2c(w1)).toBe('IDE')
    expect(n2c(w2)).toBe('IDE')
    expect(w1.call?.level).toBe('sure')
    expect(w2.call?.level).toBe('sure')
  })

  it('a b tag and its complement y tag are not "differs"; a fork on the same peaks is', async () => {
    const { kindOf } = await import('./graph')
    // b2..b5 with a ions, and y3..y6 (their complements).
    const s = spec([b(2), b(3), b(4), b(5), b(2) - CO, b(3) - CO, y(3), y(4), y(5), y(6)])
    const g = buildGraph([{ row: rowOn('PTI', b(2) - PROTON, '0.001'), evalue: 0.001, index: 0 }], s, RES, { join: false })
    const bPath = g.paths.find((p) => p.series === 'b')!
    const yPath = g.paths.find((p) => p.series === 'y')!
    expect(bPath.call.level).toBe('sure')
    expect(yPath.call.level).toBe('sure')
    expect(sequenceOf(bPath)).toBe('PTI')
    expect(sequenceOf(yPath)).toBe('PTI')
    expect(yPath.steps.map((st) => kindOf(st, yPath, bPath, s))).toEqual(['other', 'other', 'other'])
    expect(bPath.sameAs.map((q) => q.path)).toContain(g.paths.indexOf(yPath))
  })

  it('an open tag reads the same whatever the order of its rows', () => {
    // y3..y7 with no a ions and no complements: A is read up from y3 from its N-terminal flank,
    // B is the reversed text whose C-terminal walk lands on the same peaks.
    const s = spec([y(3), y(4), y(5), y(6), y(7)])
    const lo = y(3) - PROTON
    const A = { row: rowOn(yAsc(3, 7), lo, '0.001'), evalue: 0.001, index: 0 }
    const rev = [...yAsc(3, 7)].reverse().join('')
    const B = { row: tagRowFrom(cols, ['scan=1', rev, '1', String(M - lo - sum(rev)), String(lo - WATER), '0', '0.002'])!, evalue: 0.002, index: 1 }
    const g1 = buildGraph([A, B], s, RES, { join: false })
    const g2 = buildGraph([{ ...B, index: 0 }, { ...A, index: 1 }], s, RES, { join: false })
    const top1 = g1.paths[0], top2 = g2.paths[0]
    expect(top1.call.level).toBe('open')
    expect([top1.series, sequenceOf(top1)]).toEqual([top2.series, sequenceOf(top2)])
  })

  it('the database decides against the walked flank; a tie decides nothing', () => {
    const s = spec([y(2), y(3), y(4), y(5)])
    const l = laddersFor(rowOn(yAsc(2, 5), y(2) - PROTON), s, RES).both.find((x) => x.walked === 'b')!
    const cand = likelyPeptide(['spectrum', 'tag', 'protein', 'peptide', 'nterm_match', 'cterm_match', 'delta_mass', 'region'], [['scan=1', 'x', 'P1', PEP, '1', '1', '0', '']])!
    expect(dbCall(cand, ladderSteps(l), 1, 'b', RES, s)).toMatchObject({ series: 'y', level: 'sure' })
    const off = spec([500, 500 + R.G, 500 + R.G + R.G])
    const l2 = laddersFor(rowOn('GG', 500 - PROTON), off, RES).both.find((x) => x.walked === 'b')!
    expect(dbCall(cand, ladderSteps(l2), 1, 'b', RES, off)).toBeNull()
  })
})
