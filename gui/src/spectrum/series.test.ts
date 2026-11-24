// Which ion series a ladder lies on (seriesCall): a ions beside b ions, the
// complement's a ions, a tryptic C terminus, a terminus only one reading of
// its peaks lies at; otherwise not told apart.
import { describe, expect, it } from 'vitest'
import { PROTON, WATER, Z_DOT_OFFSET, laddersFor, residueMasses, seriesCall, seriesText, tagRowFrom, type Ladder } from './ladder'
import { anchorsOf, termContext, withAnchor } from './terminus'
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
    expect(seriesText('y', { series: 'y', level: 'open', why: '' })).toBe('b or y?')
    expect(seriesText('z', { series: 'z', level: 'open', why: '' })).toBe('c or z?')
    expect(seriesText('b', { series: 'b', level: 'likely', why: '' })).toBe('b?')
  })
  it('c and z are not judged', () => {
    const s = spec([b(2), b(3), b(4), b(2) - CO, b(3) - CO])
    expect(seriesCall(idx(s, [b(2), b(3), b(4)]), 1, 'z', s, RES)).toMatchObject({ series: 'z', level: 'open' })
  })
})

describe('series of ladders', () => {
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

  it('at 20 ppm with peaks up to 2000 m/z the rules still apply', () => {
    const s = { ...spec([b(2), b(3), b(4), b(2) - CO, b(3) - CO, 1999.9]), tolerance: 20 }
    expect(seriesCall(idx(s, [b(2), b(3), b(4)]), 1, 'y', s, RES)).toMatchObject({ series: 'b', level: 'sure' })
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

// A terminus only one reading of the peaks (b or y, c or z) lies at settles the series.
describe('series: the terminal anchor', () => {
  const walkedB = (r: ReturnType<typeof row>, s: SpectrumPeaks, res = RES, ctx = termContext({}, res)) => laddersFor(r, s, res, ctx).both.find((l) => l.walked === 'b')!

  it('an open call on y1 of a C-terminal K: y, sure', () => {
    // y1..y3 (K, E, D ascending); an a ion beside y2 and one beside its complement b5: the a ions tell nothing.
    const s = spec([y(1), y(2), y(3), y(2) - CO, b(5), b(5) - CO])
    expect(seriesCall(idx(s, [y(1), y(2), y(3)]), 1, 'b', s, RES).level).toBe('open')
    const l = walkedB(row('ED', y(1) - PROTON, M - (y(3) - PROTON)), s)
    expect(l.call).toMatchObject({ series: 'y', level: 'sure' })
    expect(l.call?.why).toBe('read as y ions, its low peak is y1 of a C-terminal K')
  })

  it('b1 after a fixed N-terminal TMT: b, sure (one residue from the N terminus)', () => {
    const tmt = 229.162932
    const mt = M + tmt
    const bt = (i: number): number => tmt + sum(PEP.slice(0, i)) + PROTON
    const s = { ...spec([bt(1), bt(2), bt(3)]), precursor: (mt + 2 * PROTON) / 2 }
    const r = row('EP', bt(1) - PROTON, mt - WATER - (bt(1) - PROTON) - sum('EP'))
    const ctx = termContext({ fixed_modifications: ['Carbamidomethyl (C)', 'TMT6plex (N-term)'] }, RES)
    const l = walkedB(r, s, RES, ctx)
    expect(l.call).toMatchObject({ series: 'b', level: 'sure', why: 'read as b ions, its low peak is b1 of an N-terminal P' })
    // Without the run's TMT the peaks lie at no terminus: not told apart.
    expect(walkedB(r, s).call?.level).toBe('open')
  })

  it('an anchor against the a ions: open, naming both', () => {
    // a ions beside y2 and y3 say b; read as y its low peak is y1 of a C-terminal K.
    const s = spec([y(1), y(2), y(3), y(2) - CO, y(3) - CO])
    expect(seriesCall(idx(s, [y(1), y(2), y(3)]), 1, 'b', s, RES)).toMatchObject({ series: 'b', level: 'sure' })
    const l = walkedB(row('ED', y(1) - PROTON, M - (y(3) - PROTON)), s)
    expect(l.call?.level).toBe('open')
    expect(l.call?.why).toMatch(/^the a ions say b \(a ions \(b − CO\) beside 2 peaks\), but read as y ions, its low peak is y1 of a C-terminal K: b or y is not told apart$/)
    expect(seriesText(l.series, l.call)).toBe('b or y?')
  })

  it('an anchor that agrees with the a ions makes the call sure', () => {
    const call = { series: 'y' as const, level: 'likely' as const, why: 'an a ion beside 1 complement peak (its b ions)' }
    expect(withAnchor(call, [{ series: 'y', t: { n: null, c: { away: 'K' } } }], 'b')).toMatchObject({ series: 'y', level: 'sure' })
  })

  it('the kinds of anchor measured not to hold change nothing', () => {
    const open = { series: 'b' as const, level: 'open' as const, why: 'x' }
    const sureB = { series: 'b' as const, level: 'sure' as const, why: 'a ions' }
    // b(n-1) of a C-terminal K or R (from the precursor): 87% / 94% when measured.
    expect(withAnchor(open, [{ series: 'b', t: { n: null, c: { away: 'R' } } }], 'b')).toBe(open)
    expect(withAnchor(sureB, [{ series: 'y', t: { n: null, c: { away: 'K' } } }], 'b')).not.toBe(sureB)
    // Another C-terminal residue, on either side (W: GE, AD, SV weigh the same).
    expect(withAnchor(open, [{ series: 'y', t: { n: null, c: { away: 'W' } } }], 'b')).toBe(open)
    expect(withAnchor(open, [{ series: 'b', t: { n: null, c: { away: '[IL]' } } }], 'b')).toBe(open)
    expect(withAnchor(sureB, [{ series: 'y', t: { n: null, c: { away: 'E' } } }], 'b')).toBe(sureB)
    // Used: a set holding K or R ([KQ]), the C terminus itself, an N side.
    expect(withAnchor(open, [{ series: 'b', t: { n: null, c: { away: '[KQ]' } } }], 'b')).toMatchObject({ series: 'b', level: 'sure' })
    expect(withAnchor(open, [{ series: 'b', t: { n: null, c: 'at' } }], 'y')).toMatchObject({ series: 'b', level: 'sure' })
    expect(withAnchor(open, [{ series: 'y', t: { n: { away: 'G' }, c: null } }], 'b')).toMatchObject({ series: 'y', level: 'sure' })
    // An unused C side beside a used N side: used.
    expect(withAnchor(open, [{ series: 'y', t: { n: { away: 'G' }, c: { away: 'W' } } }], 'b')).toMatchObject({ series: 'y', level: 'sure' })
  })

  it('above 25 ppm or 0.02 Da no terminus settles the series', () => {
    // y1 of a C-terminal K as in the first case, at 0.5 Da: the a-ion call (open at this tolerance) stands.
    const s = { ...spec([y(1), y(2), y(3)]), tolerance: 0.5, toleranceUnit: 'Da' as const }
    const l = walkedB(row('ED', y(1) - PROTON, M - (y(3) - PROTON)), s)
    expect(l.call).toEqual(seriesCall(idx(s, [y(1), y(2), y(3)]), 1, 'b', s, RES))
    expect(l.call?.level).toBe('open')
    const s30 = { ...spec([y(1), y(2), y(3)]), tolerance: 30 }
    expect(walkedB(row('ED', y(1) - PROTON, M - (y(3) - PROTON)), s30).call?.level).toBe('open')
    // At 20 ppm the same ladder is y, sure.
    const s20 = { ...spec([y(1), y(2), y(3)]), tolerance: 20 }
    expect(walkedB(row('ED', y(1) - PROTON, M - (y(3) - PROTON)), s20).call).toMatchObject({ series: 'y', level: 'sure' })
  })

  it('both readings at a terminus: only a used one counts, two used ones decide nothing', () => {
    // At 0.02 Da the low peak is b1 of an N-terminal F and, as y, y1 of a C-terminal E (F and E + H2O differ by 0.015 Da).
    // y1 of E is not a used kind (as -terminus), so b1 of F settles the open call.
    const lo = R.F + PROTON
    const s = { ...spec([lo, lo + R.G, lo + R.G + R.A]), tolerance: 0.02, toleranceUnit: 'Da' as const }
    const l = walkedB(rowOn('GA', R.F), s)
    expect(anchorsOf({ ...l, series: 'b' }, s, RES, termContext({}, RES)).map((a) => a.series)).toEqual(['b', 'y'])
    expect(seriesCall(idx(s, [lo, lo + R.G, lo + R.G + R.A]), 1, 'b', s, RES).level).toBe('open')
    expect(l.call).toMatchObject({ series: 'b', level: 'sure', why: 'read as b ions, its low peak is b1 of an N-terminal F' })
    const open = { series: 'b' as const, level: 'open' as const, why: 'x' }
    expect(withAnchor(open, [{ series: 'b', t: { n: { away: 'F' }, c: null } }, { series: 'y', t: { n: null, c: { away: 'E' } } }], 'y')).toMatchObject({ series: 'b', level: 'sure' })
    // Both readings used (b1 of F; y at the N terminus from the precursor): unchanged.
    expect(withAnchor(open, [{ series: 'b', t: { n: { away: 'F' }, c: null } }, { series: 'y', t: { n: 'at', c: { away: 'E' } } }], 'b')).toBe(open)
  })

  it('c and z: a z ladder after a C-terminal K is z, likely at most (no c/z data were measured)', () => {
    const z1 = R.K + Z_DOT_OFFSET + PROTON
    const s = spec([z1, z1 + R.E, z1 + R.E + R.D])
    const l: Ladder = {
      series: 'c', charge: 1, residues: ['E', 'D'], matched: 3, complete: true,
      positions: [z1, z1 + R.E, z1 + R.E + R.D].map((x, k) => ({ expected: x, peak: k, mz: x, deltaPpm: 0, deltaMz: 0 }))
    }
    const a = anchorsOf(l, s, RES, termContext({}, RES))
    expect(a.map((x) => x.series)).toEqual(['z'])
    expect(withAnchor(seriesCall([0, 1, 2], 1, 'c', s, RES), a, 'c')).toMatchObject({
      series: 'z',
      level: 'likely',
      why: 'read as z ions, its low peak is z1 of a C-terminal K (c and z anchors were not measured: likely at most)'
    })
    expect(seriesText('z', withAnchor(seriesCall([0, 1, 2], 1, 'c', s, RES), a, 'c'))).toBe('z?')
    // A sure c/z call it agrees with stays sure; a likely one stays likely.
    expect(withAnchor({ series: 'z', level: 'sure', why: 'db' }, a, 'c').level).toBe('sure')
    expect(withAnchor({ series: 'z', level: 'likely', why: 'x' }, a, 'c').level).toBe('likely')
    expect(seriesText('c', { series: 'c', level: 'open', why: '' })).toBe('c or z?')
  })
})
