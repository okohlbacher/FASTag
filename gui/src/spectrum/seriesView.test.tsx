// What the view says about the series: the ladder line N→C under the judged
// series, "(written X)" exactly when that reverses FASTag's order, and the
// row orders of a gapped tag kept together whatever series their peaks get.
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LadderLine } from './SpectrumPanel'
import { PROTON, WATER, residueMasses, tagRowFrom, type Ladder } from './ladder'
import { buildGraph } from './graph'
import type { SpectrumPeaks } from './dump'

const lad = (series: Ladder['series'], level: 'sure' | 'likely' | 'open', walked: Ladder['series']): Ladder => ({
  series, walked, charge: 1, residues: ['E', 'D', 'I'], matched: 4, complete: true,
  positions: [100, 229, 344, 457].map((x, k) => ({ expected: x, peak: k, mz: x, deltaPpm: 0, deltaMz: 0 })),
  call: { series, level, why: 'test' }
})
const text = (l: Ladder, tag: string, written: string): string => render(<LadderLine ladder={l} tag={tag} unit="ppm" written={written} />).container.textContent ?? ''

describe('ladder line', () => {
  it('walked as b, judged y: read the other way, with the written tag', () => {
    expect(text(lad('y', 'sure', 'b'), 'IDE', 'EDI')).toMatch(/^y ions: IDE N→C \(written EDI\)/)
  })
  it('judged b: as written', () => {
    expect(text(lad('b', 'likely', 'b'), 'EDI', 'EDI')).toMatch(/^b\? ions: EDI N→C on/)
  })
  it('not told apart: says which reading it shows', () => {
    expect(text(lad('b', 'open', 'b'), 'EDI', 'EDI')).toMatch(/^b or y ions \(read as b\): EDI N→C on/)
  })
})

describe('gapped row orders', () => {
  it('stay one placement when their peaks get different series calls', () => {
    const R = residueMasses([]).masses
    const PEP = 'PEPTIDEK'
    const M = [...PEP].reduce((a, r) => a + R[r], 0) + WATER
    const y = (i: number) => [...PEP.slice(PEP.length - i)].reduce((a, r) => a + R[r], 0) + WATER + PROTON
    const b5 = [...PEP.slice(0, 5)].reduce((a, r) => a + R[r], 0) + PROTON
    const mz = [y(2), y(3), y(4), y(5), b5, b5 - 27.9949146].sort((a, c) => a - c)
    const s: SpectrumPeaks = { nativeId: 'scan=1', index: 0, msLevel: 2, rt: null, precursor: (M + 2 * PROTON) / 2, charge: 2, chargeGiven: 2, tolerance: 10, toleranceUnit: 'ppm', picked: false, deisotoped: true, tagged: true, nRead: mz.length, mz, int: mz.map(() => 1) }
    const cols = ['spectrum', 'tag', 'charge', 'nterm_mass', 'cterm_mass', 'gapped', 'evalue']
    const nterm = y(2) - PROTON
    const row = (tag: string) => tagRowFrom(cols, ['scan=1', tag, '1', String(nterm), String(M - WATER - nterm - [...tag].reduce((a, r) => a + R[r], 0)), '1', '0.01'])!
    // DIT finds a peak at every position (y2, y3, y4, y5); IDT crosses the gap between y2 and y4.
    const g = buildGraph([{ row: row('DIT'), evalue: 0.01, index: 0 }, { row: row('IDT'), evalue: 0.01, index: 1 }], s, residueMasses([]), { join: false })
    const withRows = g.placements.filter((p) => p.rows.includes(0) || p.rows.includes(1))
    expect(withRows.filter((p) => p.rows.includes(0) && p.rows.includes(1)).length).toBe(1)
  })
})
