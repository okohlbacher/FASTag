// Whether a resolved tag lies at a peptide terminus (terminus.ts), the cases
// the C++ tests of the terminus column check.
import { describe, expect, it } from 'vitest'
import type { SpectrumPeaks } from './dump'
import type { Ladder } from './ladder'
import { PROTON, WATER, Z_DOT_OFFSET, residueMasses } from './ladder'
import { C13, flanksOf, terminusFromFlanks, parseTerminus, termContext, termText, terminiOf, terminusMark, terminusOf, terminusText, type Terminus } from './terminus'
import type { GPath, Step } from './graph'

const RES = residueMasses(undefined)
const R = RES.masses
const sum = (t: string): number => [...t].reduce((a, r) => a + R[r], 0)

function spectrum(mz: number[], M: number | null, tol = 10, unit: 'ppm' | 'Da' = 'ppm', z = 2): SpectrumPeaks {
  const s = [...mz].sort((a, b) => a - b)
  return {
    nativeId: 'scan=1', index: 0, msLevel: 2, rt: null, precursor: M == null ? null : (M + z * PROTON) / z, charge: z, chargeGiven: z,
    tolerance: tol, toleranceUnit: unit, picked: false, deisotoped: true, tagged: true, nRead: s.length, mz: s, int: s.map(() => 100)
  }
}
/** A resolved tag over the peaks at @p mz (ascending), reading @p labels between them (in m/z order). */
function tagOn(s: SpectrumPeaks, series: Ladder['series'], mz: number[], labels: string[], charge = 1): Pick<GPath, 'series' | 'charge' | 'peaks' | 'steps'> {
  const peaks = mz.map((x) => s.mz.findIndex((y) => Math.abs(y - x) < 1e-9))
  if (peaks.some((i) => i < 0)) throw new Error('not a peak')
  const steps: Step[] = labels.map((label, k) => ({ u: peaks[k], v: peaks[k + 1], readings: [{ label, gap: label.startsWith('['), evalue: 0.01, deltaMz: 0, deltaPpm: 0 }] }))
  return { series, charge, peaks, steps }
}
/** Ions of @p seq from @p start (neutral), at charge @p z. */
const ions = (start: number, seq: string, z = 1): number[] => {
  const out = [start]
  for (const r of seq) out.push(out[out.length - 1] + R[r])
  return out.map((m) => (m + z * PROTON) / z)
}
const token = (t: Terminus): string => terminusText(t)
const DEF = termContext({}, RES)

const PEP = 'PEPTIDEK'
const M = sum(PEP) + WATER

describe('terminus of a resolved tag', () => {
  it('N: a b ladder from b0', () => {
    const b = ions(0, 'PEP')
    const s = spectrum(b, M)
    expect(token(terminusOf(tagOn(s, 'b', b, ['P', 'E', 'P']), s, RES, DEF))).toBe('N')
  })

  it('C: a y ladder from y0', () => {
    const y = ions(WATER, 'KED')
    const s = spectrum(y, M)
    const t = tagOn(s, 'y', y, ['K', 'E', 'D'])
    expect(flanksOf(t, s, RES).c).toBeCloseTo(0, 6)
    expect(token(terminusOf(t, s, RES, DEF))).toBe('C')
  })

  it('N,C: a b ladder over the whole peptide', () => {
    const b = ions(0, PEP)
    const s = spectrum(b, M)
    expect(token(terminusOf(tagOn(s, 'b', b, [...PEP]), s, RES, DEF))).toBe('N,C')
  })

  it('one residue away: N+[IL] (I and L alike), C+K from the precursor', () => {
    const pep = 'LEPTIDEK'
    const m = sum(pep) + WATER
    // b2..b7: one L before it, one K after it.
    const b = ions(R.L, 'EPTIDE')
    const s = spectrum(b, m)
    expect(token(terminusOf(tagOn(s, 'b', b, [...'EPTIDE']), s, RES, DEF))).toBe('N+[IL],C+K')
  })

  it('under a Da tolerance K and Q both fit: C+[KQ]', () => {
    const y = ions(WATER + R.K, 'EDI')
    const s = spectrum(y, M + 500, 0.3, 'Da')
    const t = tagOn(s, 'y', y, ['E', 'D', 'I'])
    expect(token(terminusOf(t, s, RES, DEF))).toBe('C+[KQ]')
    // At 10 ppm only K.
    const s2 = spectrum(y, M + 500)
    expect(token(terminusOf(tagOn(s2, 'y', y, ['E', 'D', 'I']), s2, RES, DEF))).toBe('C+K')
  })

  it("the precursor's side: its tolerance, the isotope offsets of -isotope_error, nothing without a precursor", () => {
    // b2..b7 of PEPTIDEK: N+P from the peaks, C+K from the precursor.
    const b = ions(R.P, 'EPTIDE')
    const t = (s: SpectrumPeaks): string => token(terminusOf(tagOn(s, 'b', b, [...'EPTIDE']), s, RES, DEF))
    expect(t(spectrum(b, M))).toBe('N+P,C+K')
    // The fragment tolerance at the low peak (10 ppm of ~227) is ~0.002 Da; the
    // precursor's at its m/z times its charge adds ~0.009 Da.
    const fragTol = (b[0] * 10) / 1e6
    const precTol = (((M + 2 * PROTON) / 2) * 10 * 2) / 1e6
    expect(t(spectrum(b, M + fragTol + precTol * 0.8))).toBe('N+P,C+K')
    expect(t(spectrum(b, M + fragTol + precTol * 1.2))).toBe('N+P')
    // A precursor one isotope high: only with -isotope_error 1.
    const iso = spectrum(b, M + C13)
    expect(t(iso)).toBe('N+P')
    expect(token(terminusOf(tagOn(iso, 'b', b, [...'EPTIDE']), iso, RES, termContext({ isotope_error: ['0', '1'] }, RES)))).toBe('N+P,C+K')
    // Without a precursor the C side of a b tag is not known.
    expect(t(spectrum(b, null))).toBe('N+P')
  })

  it("the run's terminal modifications are targets: a fixed TMT, a variable protein N-terminal acetyl", () => {
    const tmt = 229.162932
    const b = ions(tmt, 'PEP')
    const s = spectrum(b, M + tmt)
    const t = tagOn(s, 'b', b, ['P', 'E', 'P'])
    expect(token(terminusOf(t, s, RES, DEF))).toBe('')
    expect(token(terminusOf(t, s, RES, termContext({ fixed_modifications: ['Carbamidomethyl (C)', 'TMT6plex (N-term)'] }, RES)))).toBe('N')
    const ac = 42.010565
    const a = ions(ac + R.P, 'EP')
    const s2 = spectrum(a, M + ac)
    const t2 = tagOn(s2, 'b', a, ['E', 'P'])
    expect(token(terminusOf(t2, s2, RES, DEF))).toBe('')
    expect(token(terminusOf(t2, s2, RES, termContext({ variable_modifications: ['Acetyl (Protein N-term)'] }, RES)))).toBe('N+P')
  })

  it('a variable residue modification is a residue: N+M[Oxidation]', () => {
    const b = ions(R.M + 15.994915, 'EP')
    const s = spectrum(b, null)
    const t = tagOn(s, 'b', b, ['E', 'P'])
    expect(token(terminusOf(t, s, RES, DEF))).toBe('')
    expect(token(terminusOf(t, s, RES, termContext({ variable_modifications: ['Oxidation (M)'] }, RES)))).toBe('N+M[Oxidation]')
  })

  it('never two residues away', () => {
    const b = ions(R.P + R.E, 'PTI')
    const s = spectrum(b, null)
    expect(token(terminusOf(tagOn(s, 'b', b, [...'PTI']), s, RES, DEF))).toBe('')
  })

  it('reads the column back, and prefers it for the series it was written for', () => {
    for (const x of ['', 'N', 'C', 'N,C', 'N+[IL]', 'N,C+K', 'N+M[Oxidation],C+[KQ]']) expect(terminusText(parseTerminus(x) as Terminus)).toBe(x)
    expect(parseTerminus('X')).toBeNull()
    expect(parseTerminus('N+')).toBeNull()
    const b = ions(0, 'PEP')
    const s = spectrum(b, M)
    const p = { ...tagOn(s, 'b', b, ['P', 'E', 'P']), call: { series: 'b' as const, level: 'sure' as const, why: '' }, chain: [], inside: [], best: null, weakest: null, joined: [], relations: [], sameAs: [] }
    expect(terminiOf([p], s, RES, DEF).map(token)).toEqual(['N'])
    expect(terminiOf([{ ...p, terminus: { series: 'b', text: 'C+K' } }], s, RES, DEF).map(token)).toEqual(['C+K'])
    // Written for y, read as b now (the peptide settled it): computed here.
    expect(terminiOf([{ ...p, terminus: { series: 'y', text: 'C+K' } }], s, RES, DEF).map(token)).toEqual(['N'])
  })
})

// The cases of test/taggraph_test.cpp terminusCases, on the flanks as there.
describe('terminus from the flanks, as the C++ tests', () => {
  const P = (tol: number, ppm: boolean, prec: number | null = null, charge = 2): SpectrumPeaks => ({ ...spectrum([100], null, tol, ppm ? 'ppm' : 'Da', charge), precursor: prec })
  const T = (series: Ladder['series'], z: number, low: number, n: number, c: number, s: SpectrumPeaks, ctx = DEF): string => token(terminusFromFlanks(series, z, low, n, c, s, ctx))
  it('at a terminus, on the peak side and the precursor side', () => {
    const da = P(0.02, false, 600, 2)
    expect(T('b', 1, 200, 0.01, 300, da)).toBe('N')
    expect(T('b', 1, 200, 0.03, 300, da)).toBe('')
    expect(T('b', 2, 200, 0.03, 300, da)).toBe('N')
    expect(T('b', 1, 200, 300, 0.05, da)).toBe('C')
    expect(T('b', 1, 200, 300, 0.07, da)).toBe('')
    expect(T('b', 1, 200, 0, 0, da)).toBe('N,C')
    expect(T('y', 1, 200, 0.05, 300, da)).toBe('N')
    expect(T('y', 1, 200, 300, 0.05, da)).toBe('')
    expect(T('z', 1, 200, 300, 0.01, da)).toBe('C')
    expect(T('b', 1, 200, 300, 0, P(0.02, false))).toBe('')
  })
  it('one residue away', () => {
    const ppm = P(10, true, 800, 2)
    expect(T('b', 1, R.L + PROTON, R.L, 500, ppm)).toBe('N+[IL]')
    expect(T('b', 1, R.K + PROTON, R.K, 500, ppm)).toBe('N+K')
    expect(T('b', 1, R.K + PROTON, R.K, 500, P(0.05, false, 800, 2))).toBe('N+[KQ]')
    expect(T('y', 1, 300, 500, R.K, ppm)).toBe('C+K')
    expect(T('b', 1, 200, 0, R.K, ppm)).toBe('N,C+K')
    expect(T('b', 1, 300, R.A + R.S, 500, ppm)).toBe('')
    const tp = 300 * 10e-6 + 800 * 10e-6 * 2
    expect(T('b', 1, 300, 500, 0.98 * tp, ppm)).toBe('C')
    expect(T('b', 1, 300, 500, 1.02 * tp, ppm)).toBe('')
  })
  it('modifications and isotope offsets', () => {
    const ppm = P(10, true, 800, 2)
    expect(T('b', 1, 200, R.M + 15.994915, 500, ppm, termContext({ variable_modifications: ['Oxidation (M)'] }, RES))).toBe('N+M[Oxidation]')
    const acetyl = 42.010565
    const tac = termContext({ variable_modifications: ['Acetyl (N-term)'] }, RES)
    expect(T('b', 1, 200, acetyl, 500, ppm)).toBe('')
    expect(T('b', 1, 200, acetyl, 500, ppm, tac)).toBe('N')
    expect(T('b', 1, 200, acetyl + R.S, 500, ppm, tac)).toBe('N+[ES]')
    expect(T('b', 1, 200, acetyl + R.A, 500, ppm, tac)).toBe('N+A')
    expect(T('b', 1, 200, 0, 500, ppm, tac)).toBe('N')
    expect(T('y', 1, 200, 500, R.K - 0.984016, ppm, termContext({ variable_modifications: ['Amidated (C-term)'] }, RES))).toBe('C+K')
    const tiso = termContext({ isotope_error: [0, 1] }, RES)
    expect(T('b', 1, 300, 500, C13, ppm)).toBe('')
    expect(T('b', 1, 300, 500, C13, ppm, tiso)).toBe('C')
    expect(T('b', 1, 300, C13, 500, ppm, tiso)).toBe('')
  })
})

describe('the terminus in the display', () => {
  it('as text beside a sequence: N–, –C, muted one residue away, in words', () => {
    expect(termText({ n: 'at', c: null })).toEqual({ pre: 'N–', post: '', words: 'at the peptide N terminus' })
    expect(termText({ n: null, c: { away: 'K' } })).toEqual({ pre: '', post: '(K)–C', words: 'one residue (K) from the C terminus' })
    expect(termText({ n: { away: '[IL]' }, c: 'at' })).toEqual({ pre: 'N–([IL])', post: '–C', words: 'one residue ([IL]) from the N terminus; at the peptide C terminus' })
  })

  it("marks b0/c0 or y0/z0 of the tag's reading and charge, the terminal target it matched included", () => {
    // b2..b4 of PEPTIDEK at 1+: N+P, marked at b0.
    const b = ions(R.P, 'EPT')
    const s = spectrum(b, M)
    const t = tagOn(s, 'b', b, [...'EPT'])
    const tb = terminusOf(t, s, RES, DEF)
    expect(terminusMark(t, tb, s, RES, DEF)).toEqual({ mz: PROTON, side: 'N', label: 'N b0', words: 'one residue (P) from the N terminus', away: true })
    // y1.. of ...DEK at 2+: C+K, marked at y0 2+.
    const y = ions(WATER + R.K, 'ED', 2)
    const s2 = spectrum(y, M)
    const t2 = tagOn(s2, 'y', y, ['E', 'D'], 2)
    const ty = terminusOf(t2, s2, RES, DEF)
    expect(terminusText(ty)).toBe('C+K')
    const mk = terminusMark(t2, ty, s2, RES, DEF)
    expect(mk).toMatchObject({ side: 'C', label: 'C y0 2+', away: true })
    expect(mk?.mz).toBeCloseTo((WATER + 2 * PROTON) / 2, 9)
    // A z reading at its z0, a fixed N-terminal TMT in b0.
    const z = ions(Z_DOT_OFFSET + R.K, 'ED')
    const s3 = spectrum(z, M)
    const t3 = tagOn(s3, 'z', z, ['E', 'D'])
    const tz = terminusOf(t3, s3, RES, DEF)
    expect(terminusText(tz)).toBe('C+K')
    expect(terminusMark(t3, tz, s3, RES, DEF)?.mz).toBeCloseTo(Z_DOT_OFFSET + PROTON, 9)
    const tmt = 229.162932
    const bt = ions(tmt, 'PEP')
    const st = spectrum(bt, M + tmt)
    const ctx = termContext({ fixed_modifications: ['TMT6plex (N-term)'] }, RES)
    const tt = tagOn(st, 'b', bt, [...'PEP'])
    expect(terminusMark(tt, terminusOf(tt, st, RES, ctx), st, RES, ctx)?.mz).toBeCloseTo(tmt + PROTON, 9)
    // Nothing on the side read from the precursor, nor without a terminus.
    expect(terminusMark(t, { n: null, c: 'at' }, s, RES, DEF)).toBeNull()
    expect(terminusMark(t, { n: null, c: null }, s, RES, DEF)).toBeNull()
  })
})
