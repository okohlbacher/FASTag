// The rankings: a step's log-odds from its peaks, less the threshold (stepWeight,
// the 1.15 default, and cstar, the default since).
import { describe, expect, it } from 'vitest'
import { CSTAR_THRESHOLD, STEP_THRESHOLD, cstarGraph, cstarLogits, cstarWeight, noselfPick, stepLogit, stepMassError, stepWeight } from './stepScore'
import type { SpectrumPeaks } from './dump'
import { buildGraph, layerOf, placementsOf, sequenceOf, type GPath, type Placement, type Step, type TagIn } from './graph'
import { residueMasses, tagRowFrom } from './ladder'
import { X_CASES } from '../testing/cstarCases'

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

// cstar (scheme X1 = CstarNS_t3): the values the frozen reference
// (work/tag-score/heldout3/bench3.ts) computes on synthetic cases.
describe('cstar ranking', () => {
  for (const x of X_CASES) {
    const s: SpectrumPeaks = {
      nativeId: 'scan=1', index: 0, msLevel: 2, rt: null, precursor: x.precursor, charge: x.charge, chargeGiven: x.charge,
      tolerance: x.tolerance, toleranceUnit: x.unit, picked: false, deisotoped: true, tagged: true, nRead: x.mz.length, mz: x.mz, int: x.int
    }
    const cols = ['spectrum', 'tag', 'charge', 'nterm_mass', 'cterm_mass', 'gapped']
    const ins: TagIn[] = x.tags.map(([t, z, n, c, g, e], i) => ({ row: tagRowFrom(cols, ['scan=1', t, String(z), String(n), String(c), String(g)])!, evalue: e, index: i }))
    const res = residueMasses(undefined)
    const key = (p: GPath): string => `${sequenceOf(p)}/${p.series}/${p.peaks.join(',')}`
    it(`${x.name}: the C* logits and mass errors of every placement step`, () => {
      const pl = placementsOf(ins, s, res)
      const tab = cstarLogits(s, pl)
      const err = stepMassError(s)
      expect(pl.map((p) => `${layerOf(p)}|${p.peaks.join(',')}`)).toEqual(x.placements.map((p) => `${p.layer}|${p.peaks.join(',')}`))
      pl.forEach((p, i) =>
        p.steps.forEach((st, k) => {
          expect(tab.get(`${layerOf(p)}|${p.peaks.join(',')}|${k}`)).toBe(x.placements[i].logits[k])
          expect(err(st)).toBe(x.placements[i].d[k])
        })
      )
    })
    it(`${x.name}: the X1 graph order, its noself pick first`, () => {
      const g = buildGraph(ins, s, res, { join: false, weight: cstarWeight(s, placementsOf(ins, s, res)) })
      expect(g.paths.map(key)).toEqual(x.paths)
      expect(noselfPick(s, g)).toBe(x.pick)
      const want = [x.paths[x.pick], ...x.paths.filter((_, r) => r !== x.pick)]
      const c = cstarGraph(ins, s, res, false)
      expect(c.paths.map(key)).toEqual(want)
      // Relations and sameAs still name the same tags.
      const to = (r: number): number => (r === x.pick ? 0 : r < x.pick ? r + 1 : r)
      g.paths.forEach((p, r) => {
        const q = c.paths[to(r)]
        expect(q.relations.map((y) => key(c.paths[y.path]))).toEqual(p.relations.map((y) => key(g.paths[y.path])))
        expect(q.sameAs.map((y) => key(c.paths[y.path]))).toEqual(p.sameAs.map((y) => key(g.paths[y.path])))
      })
    })
  }
  it('at a Da tolerance the mass error is in tolerance units scaled to 20', () => {
    const x = X_CASES.find((c) => c.name === 'da')!
    const s = { mz: x.mz, tolerance: 0.3, toleranceUnit: 'Da' } as unknown as SpectrumPeaks
    const st = { u: 0, v: 1, readings: [{ label: 'G', gap: false, evalue: 1, deltaMz: 0.06, deltaPpm: 99 }] } as Step
    expect(stepMassError(s)(st)).toBeCloseTo(4, 12)
    expect(stepMassError({ ...s, tolerance: 20, toleranceUnit: 'ppm' })(st)).toBe(99)
    expect(stepMassError({ ...s, tolerance: 50, toleranceUnit: 'ppm' })(st)).toBeCloseTo((20 * 0.06) / (((x.mz[1] - 0.06) * 50) / 1e6), 9)
  })
  it('noself: rank 1 is the first tag without a peak and its own complement', () => {
    const x = X_CASES.find((c) => c.name === 'noself')!
    expect(x.pick).toBe(1)
    expect(x.paths[0].startsWith('PEPTI/')).toBe(true)
  })
  it('a threshold lowers every new step by itself', () => {
    const x = X_CASES[0]
    const s = { ...spec(x.mz, x.int), precursor: x.precursor, charge: x.charge, tolerance: x.tolerance }
    const cols = ['spectrum', 'tag', 'charge', 'nterm_mass', 'cterm_mass', 'gapped']
    const ins: TagIn[] = x.tags.map(([t, z, n, c, g, e], i) => ({ row: tagRowFrom(cols, ['scan=1', t, String(z), String(n), String(c), String(g)])!, evalue: e, index: i }))
    const pl = placementsOf(ins, s, residueMasses(undefined))
    expect(cstarWeight(s, pl, 3)(pl[0], null) - cstarWeight(s, pl, 4)(pl[0], null)).toBeCloseTo(pl[0].steps.length, 9)
    expect(CSTAR_THRESHOLD).toBe(3)
  })
})
