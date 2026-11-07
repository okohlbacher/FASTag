// The bundled Unimod deltas the mass-gap chart marks (results/unimod.ts,
// GUI-DESIGN S7: "a bundled subset of about 60 common deltas"). Three
// oracles that need no GUI code: each mass recomputed from its elemental
// composition; every modification the CLI combines (data/digest/
// massgap_mods.tsv) is in the table; and the masses the CLI prints in its
// own mass-gap report agree with the table to the 4 decimals printed.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compositionMass, marksIn, nearestMark, UNIMOD_MARKS } from './unimod'

const CLI = 'src/fixtures/cli/'

describe('unimod.ts', () => {
  it('holds about 60 deltas, each named once', () => {
    expect(UNIMOD_MARKS.length).toBeGreaterThanOrEqual(55)
    expect(UNIMOD_MARKS.length).toBeLessThanOrEqual(70)
    const names = UNIMOD_MARKS.map((m) => m.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('every mass equals its elemental composition within 2e-5 Da', () => {
    for (const m of UNIMOD_MARKS) expect(Math.abs(compositionMass(m.composition) - m.mass), m.name).toBeLessThan(2e-5)
  })

  it('compositionMass knows the isotopes and negative counts', () => {
    expect(compositionMass('O')).toBeCloseTo(15.9949146, 6)
    expect(compositionMass('H(-2) O(-1)')).toBeCloseTo(-18.0105647, 6)
    expect(compositionMass('13C(6) 15N(2) C(-6) N(-2)')).toBeCloseTo(8.0141988, 6)
    expect(() => compositionMass('Xx(2)')).toThrow(/Xx/)
  })

  it('carries every modification the CLI combines (data/digest/massgap_mods.tsv)', () => {
    const tsv = readFileSync('../data/digest/massgap_mods.tsv', 'utf8')
    const names = tsv
      .split('\n')
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('name\t'))
      .map((l) => l.split('\t')[0])
    expect(names.length).toBe(38)
    const have = new Set(UNIMOD_MARKS.map((m) => m.name))
    for (const n of names) expect(have.has(n), n).toBe(true)
  })

  it('agrees with the Cys masses the CLI prints in its mass-gap report', () => {
    const text = readFileSync(`${CLI}v112-pxd014764-delta-ext3/run.massgap.tsv`, 'utf8')
    const re = /of (-?\d+\.\d{4}) Da \(([^)]+) \(C\)\)/g
    const seen: string[] = []
    for (const m of text.matchAll(re)) {
      const mark = UNIMOD_MARKS.find((x) => x.name === m[2])
      expect(mark, m[2]).toBeDefined()
      expect(mark!.mass.toFixed(4)).toBe(m[1])
      seen.push(m[2])
    }
    expect(seen).toEqual(['Carbamidomethyl', 'Propionamide', 'Nethylmaleimide', 'Methylthio', 'Carboxymethyl'])
  })

  it('names the modification the CLI explains a peak by, within the report window', () => {
    // run.massgap.tsv: peak 1 at 10.00905 is Label:13C(6)15N(4) within 0.02 Da.
    expect(nearestMark(10.00905, 0.02)?.name).toBe('Label:13C(6)15N(4)')
    // run.delta.tsv: the 8.0150 bin; Lys8 is 8.0142.
    expect(nearestMark(8.015, 0.02)?.name).toBe('Label:13C(6)15N(2)')
    expect(nearestMark(0.5, 0.02)).toBeNull()
  })

  it('marksIn lists the marks of a range in mass order', () => {
    const r = marksIn(-20, 60)
    expect(r.map((m) => m.mass)).toEqual([...r.map((m) => m.mass)].sort((a, b) => a - b))
    expect(r.some((m) => m.name === 'Oxidation')).toBe(true)
    expect(r.every((m) => m.mass >= -20 && m.mass <= 60)).toBe(true)
  })
})
