// The likely peptide from the tag placements, and its ruler.
import { describe, expect, it } from 'vitest'
import { likelyPeptide, rulerOf, stepOnRuler, ticksOf } from './peptide'
import { PROTON, WATER, residueMasses } from './ladder'
import type { SpectrumPeaks } from './dump'
import type { Step } from './step'

const RES = residueMasses([])
const R = RES.masses
const columns = ['spectrum', 'tag', 'protein', 'peptide', 'pos', 'reversed', 'nterm_match', 'cterm_match', 'delta_mass', 'region', 'delta_interp']
const row = (tag: string, peptide: string, exact: boolean, delta = '0.0000', region = ''): string[] => ['scan=1', tag, 'sp|P1|X', peptide, '0', '0', exact ? '1' : '0', '1', delta, region, '']
const spec = (mz: number[]): SpectrumPeaks => ({
  nativeId: 'scan=1', index: 0, msLevel: 2, rt: null, precursor: 500, charge: 2, chargeGiven: 2,
  tolerance: 10, toleranceUnit: 'ppm', picked: false, deisotoped: true, tagged: true, nRead: mz.length, mz, int: mz.map(() => 1)
})
const step = (u: number, v: number, label: string, gap = false): Step => ({ u, v, readings: [{ label, gap, evalue: 1, deltaMz: 0, deltaPpm: 0 }] })

describe('likely peptide', () => {
  it('takes the peptide most distinct tags are placed on, exact placements first', () => {
    const c = likelyPeptide(columns, [row('PEP', 'PEPTIDEK', true), row('PEP', 'PEPTIDEK', true), row('TID', 'PEPTIDEK', false, '15.9949', '0-2'), row('PEP', 'APEPR', true)])
    expect(c).toMatchObject({ peptide: 'PEPTIDEK', tags: 2, exact: 1, of: 2, delta: 0, region: null })
    expect(likelyPeptide(columns, [])).toBeNull()
    expect(likelyPeptide(['spectrum', 'tag'], [['scan=1', 'PEP']])).toBeNull()
  })

  it('of the windows a tag is placed on, the one with the smaller gap; its region is where every tag allows it', () => {
    const c = likelyPeptide(columns, [row('GDAPP', 'AGSSTPGDAPPK', false, '79.9760', '0-4'), row('TPGDA', 'AGSSTPGDAPPK', false, '79.9758', '0-3'), row('GDAPP', 'XRAGSSTPGDAPPK', false, '-4516.0480', '0-6')])
    expect(c).toMatchObject({ peptide: 'AGSSTPGDAPPK', tags: 2, exact: 0, delta: 79.9758, region: [0, 3] })
  })

  it('b and y rulers: residues between consecutive fragments, y from the C terminus', () => {
    const c = likelyPeptide(columns, [row('PEP', 'PEPK', true)])!
    const b = rulerOf(c, 'b', 1, RES)
    expect(b.residues.join('')).toBe('PEPK')
    expect(b.ticks[1]).toBeCloseTo(R.P + PROTON, 6)
    const y = rulerOf(c, 'y', 2, RES)
    expect(y.residues.join('')).toBe('KPEP')
    expect(y.ticks[1]).toBeCloseTo((R.K + WATER + 2 * PROTON) / 2, 6)
    expect(y.ticks[4]).toBeCloseTo((R.P * 2 + R.E + R.K + WATER + 2 * PROTON) / 2, 6)
  })

  it('a mass gap shifts the fragments past its region; inside it there is no tick', () => {
    const c = likelyPeptide(columns, [row('TID', 'PEPTIDEK', false, '15.9949', '1-2')])!
    const b = rulerOf(c, 'b', 1, RES)
    expect(b.ticks[1]).toBeCloseTo(R.P + PROTON, 6)
    expect(b.ticks[2]).toBeNull()
    expect(b.ticks[3]).toBeCloseTo(R.P * 2 + R.E + 15.9949 + PROTON, 6)
    // y1 holds no residue of the region; the whole peptide holds the gap.
    const y = rulerOf(c, 'y', 1, RES)
    expect(y.ticks[1]).toBeCloseTo(R.K + WATER + PROTON, 6)
    expect(y.ticks[7]).toBeCloseTo(b.ticks[8]! - PROTON - R.P + WATER + PROTON, 6)
  })

  it('a step is on the peptide when its peaks are its fragments and the residue is the same (I = L, gaps unordered)', () => {
    const c = likelyPeptide(columns, [row('PEL', 'PELTK', true)])!
    const b = rulerOf(c, 'b', 1, RES)
    const s = spec([b.ticks[1]!, b.ticks[2]!, b.ticks[3]! + 0.0005, b.ticks[4]!, 900])
    expect(ticksOf(b, [0, 1, 2, 3, 4], s)).toEqual([1, 2, 3, 4, -1])
    expect(stepOnRuler(step(0, 1, 'E'), b, s)).toBe(true)
    expect(stepOnRuler(step(1, 2, 'I'), b, s)).toBe(true)
    expect(stepOnRuler(step(1, 2, 'N'), b, s)).toBe(false)
    expect(stepOnRuler(step(1, 3, '[LT]', true), b, s)).toBe(true)
    expect(stepOnRuler(step(1, 3, 'W'), b, s)).toBe(false)
    expect(stepOnRuler(step(3, 4, 'K'), b, s)).toBe(false)
  })
})
