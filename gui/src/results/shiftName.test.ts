// The best name of a mass-shift row (shiftName.ts bestShiftName) on real
// rows of four FASTag 1.16.2 tables of PXD045734
// (src/fixtures/cli-1.16/pxd045734-lens/README.md), and where it shows: one
// table by residue, the pooled rows, the Overview's Top mass shift.

// @ts-ignore -- node built-in; the app's tsconfig has no node types
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDelta } from './tables'
import { pivotResidues, poolTables, sourceOf } from './shiftMatrix'
import { topShift } from './overview'
import { bestShiftName, cellNames } from './shiftName'

const DIR = 'src/fixtures/cli-1.16/pxd045734-lens/'
const FILES = ['ah_4068_ZW_032115_UIF_N_57yo', 'ah_4068_ZW_032115_UIF_IC_57yo', 'sh_4096_ZW_041615_UIF_N_22yo', 'sh_4096_ZW_041615_UIF_IC_22yo']
const text = (f: string): string => readFileSync(`${DIR}${f}.delta.tsv`, 'utf8') as string
const table = (f: string) => parseDelta(text(f), `/d/${f}.delta.tsv`)

/// The best name of row @p key of table @p f, from its cells as written.
function nameOf(f: string, key: string): string {
  const t = table(f)
  const i = t.keys.indexOf(key)
  expect(i, `${f} ${key}`).toBeGreaterThanOrEqual(0)
  return bestShiftName({ delta: t.delta[i], unimod: t.extra['unimod']?.[i], psimod: t.extra['psimod']?.[i], isotope: t.extra['isotope_error']?.[i] })
}

const [AH_N, AH_IC, , SH_IC] = FILES

describe('bestShiftName on real rows', () => {
  it('an isotope error, not the first Unimod entry (Label:15N(1), Label:18O(1), Label:15N(2))', () => {
    // unimod Label:15N(1)@I/E;Gln->Glu@Q;Deamidated@Q, isotope_error 13C+1(-3.0ppm)
    expect(nameOf(AH_N, '0.9955')).toBe('isotope error +1')
    // unimod Label:15N(1)@V only, isotope_error '-': 0.0154 Da from 1.00336
    expect(nameOf(SH_IC, '0.9880')).toBe('isotope error +1')
    // unimod '-', psimod MOD:00137 L-3-phenyllactic acid@N-term, 13C+1
    expect(nameOf(AH_N, '0.9905')).toBe('isotope error +1')
    // unimod Label:18O(1)@S/T, 13C+2
    expect(nameOf(AH_IC, '1.9960')).toBe('isotope error +2')
    // unimod '-', 13C+2
    expect(nameOf(AH_N, '2.0005')).toBe('isotope error +2')
    // No isotope_error column entry for k = 3: by the gap.
    expect(nameOf(AH_N, '3.0075')).toBe('isotope error +3')
  })

  it('a common modification plus isotopes when that fits closer (Deamidated + 13C = 1.9874 Da)', () => {
    // unimod '-', 13C+2(-6.7ppm): 0.0187 Da from 2 x 1.00336, 0.0006 from Deamidated + 1.00336
    expect(nameOf(AH_N, '1.9880')).toBe('Deamidated + isotope error +1')
    // unimod Label:15N(2)@Q;Label:18O(1)@S, 13C+2
    expect(nameOf(AH_IC, '1.9905')).toBe('Deamidated + isotope error +1')
  })

  it('a common modification over an exotic first entry, with its sites', () => {
    expect(nameOf(AH_N, '0.9860')).toBe('Deamidated@N/Q') // first already; no isotope although 0.0174 Da from 1.00336
    expect(nameOf(SH_IC, '0.9830')).toBe('Deamidated@N') // after Asn->Asp@N
    expect(nameOf(SH_IC, '57.0170')).toBe('Carbamidomethyl@N-term') // after Ala->Gln@A
    expect(nameOf(AH_N, '58.0055')).toBe('Oxidation+Acetyl@M/N-term/Protein N-term') // both parts common
  })

  it('else the first entry; else the first PSI-MOD name; else none', () => {
    const pxd1 = parseDelta(readFileSync('src/fixtures/cli-1.16/pxd000001-survey/run.delta.tsv', 'utf8') as string, '/d/run.delta.tsv')
    const i = pxd1.keys.indexOf('101.0730')
    expect(bestShiftName({ delta: pxd1.delta[i], unimod: pxd1.extra['unimod'][i], psimod: pxd1.extra['psimod']?.[i], isotope: pxd1.extra['isotope_error']?.[i] })).toBe('HN2_mustard@K')
    expect(bestShiftName({ delta: 54.0145, unimod: 'Delta:H(2)C(3)O(1)@R(+1.9ppm);MG-H1@R(+1.9ppm)', psimod: '-', isotope: '-' })).toBe('Delta:H(2)C(3)O(1)@R')
    expect(bestShiftName({ delta: 73.06, unimod: '-', psimod: 'MOD:00001 x@K(+1.0ppm)', isotope: '-' })).toBe('MOD:00001 x@K')
    expect(bestShiftName({ delta: 73.06, unimod: '-', psimod: '-', isotope: '-' })).toBe('')
    expect(cellNames('Oxidation@M/W(+0.4ppm);Dioxidation@C(-3.0mDa)')).toEqual(['Oxidation@M/W', 'Dioxidation@C'])
  })
})

describe('the best name where it shows', () => {
  it('By residue, one table: the row name', () => {
    const m = pivotResidues(table(AH_N))!
    const row = (k: string) => m.rows.find((r) => r.key === k)!
    expect(row('0.9955').name).toBe('isotope error +1')
    expect(row('0.9955').names).toContain('Label:15N(1)@I/E(-0.6ppm)') // the tooltip keeps every entry
    expect(row('1.9880').name).toBe('Deamidated + isotope error +1')
    expect(row('0.9860').name).toBe('Deamidated@N/Q')
  })

  it('By residue, the four tables pooled: no Label:15N(1) or Label:18O(1) best name near 1 and 2 Da', () => {
    const m = poolTables(FILES.map((f) => sourceOf(table(f))!))
    const near = (lo: number, hi: number) => m.rows.filter((r) => r.delta >= lo && r.delta <= hi)
    for (const r of [...near(0.99, 1.03), ...near(1.993, 2.02)]) expect(r.name, r.key).toMatch(/isotope error/)
    expect(m.rows.map((r) => r.name).filter((n) => /^Label:(15N|18O)/.test(n))).toEqual([])
    // The deamidation rows keep their name.
    expect(near(0.982, 0.988).every((r) => r.name.startsWith('Deamidated'))).toBe(true)
  })

  it('the Overview tile: the best name, not the whole unimod cell', () => {
    const t = text(AH_N)
    // Only the 0.9955 row (and a smaller one) left: it is the top shift.
    const lines = t.split('\n')
    const head = lines[0]
    const only = [head, ...lines.filter((l) => l.startsWith('0.9955\t') || l.startsWith('0.9905\t'))].join('\n')
    expect(topShift(only)).toMatchObject({ delta: '0.9955', name: 'isotope error +1' })
    const top = topShift(t)!
    expect(top.name).not.toContain(';')
    expect(top.name).not.toMatch(/ppm\)/)
  })
})
