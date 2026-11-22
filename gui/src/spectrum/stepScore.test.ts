// The adopted ranking: a step's log-odds from its peaks, less the threshold.
import { describe, expect, it } from 'vitest'
import { STEP_THRESHOLD, stepLogit, stepWeight } from './stepScore'
import type { SpectrumPeaks } from './dump'
import type { Placement, Step } from './graph'

const spec = (mz: number[], int: number[]): SpectrumPeaks => ({
  nativeId: 'scan=1', index: 0, msLevel: 2, rt: null, precursor: 600, charge: 2, chargeGiven: 2,
  tolerance: 20, toleranceUnit: 'ppm', picked: false, deisotoped: true, tagged: true, nRead: mz.length, mz, int
})
const step = (u: number, v: number, ppm: number, e: number, gap = false): Step => ({ u, v, readings: [{ label: gap ? '[AG]' : 'G', gap, evalue: e, deltaMz: 0, deltaPpm: ppm }] })

describe('step log-odds', () => {
  const s = spec([200, 257.02, 314.04, 400, 500], [1000, 900, 800, 10, 5])
  const logit = stepLogit(s)
  it('an intense, accurate step is worth more than a weak, off one; a gap step less', () => {
    expect(logit(step(0, 1, 1, 0.001), 1)).toBeGreaterThan(logit(step(3, 4, 15, 0.001), 1))
    expect(logit(step(0, 1, 1, 0.001), 1)).toBeGreaterThan(logit(step(0, 1, 1, 0.001, true), 1))
  })
  it('a placement adds only the steps it does not share with the one before it', () => {
    const w = stepWeight(s)
    const a = { peaks: [0, 1, 2], steps: [step(0, 1, 1, 0.001), step(1, 2, 1, 0.001)], charge: 1 } as unknown as Placement
    const b = { peaks: [1, 2, 3], steps: [a.steps[1], step(2, 3, 1, 0.001)], charge: 1 } as unknown as Placement
    expect(w(b, a)).toBeCloseTo(logit(b.steps[1], 1) - STEP_THRESHOLD, 9)
    expect(w(a, null)).toBeCloseTo(logit(a.steps[0], 1) + logit(a.steps[1], 1) - 2 * STEP_THRESHOLD, 9)
  })
})
