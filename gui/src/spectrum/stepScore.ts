// How resolved tags are ranked: each step's log-odds of being right, from its
// peaks, minus a threshold. A chain grows by a tag only when the steps it adds
// are worth more than the threshold, so a doubtful extension lowers the score
// instead of raising it.
//
// The step model is a logistic regression on the steps of tags with E <= 1 of
// PXD003531 (Q Exactive) and PXD000001 (Orbitrap Velos, TMT), against Sage
// identifications (work/tag-score: calib.ts, fitstep.py). Threshold 3 passed
// the preregistered held-out test on PXD076528 (Orbitrap Astral): the first
// resolved tag right in 58.7% of scans against 58.2% for the best single tag,
// with 11% more correct residues; summed E-value evidence was right in 40.3%
// (work/tag-score/PREREG-tag-scoring.md).

import type { SpectrumPeaks } from './dump'
import type { Placement, Step } from './graph'
import { PROTON } from './ladder'

interface Model {
  intercept: number
  coef: Record<string, number>
}
// stepmodel-PXD003531+PXD000001.json and its variant without the mass error.
const FULL: Model = {
  intercept: 1.06978,
  coef: { lE: 0.15432, abs_dppm: 0.20914, dppm2: -2.1797, rank_max: -2.43553, rank_min: -1.16783, comp_any: 0.88343, comp_both: 2.14052, gap: -2.97032, amb: 1.94454, log_np: -0.25137 }
}
const NO_MASS: Model = {
  intercept: 1.05162,
  coef: { lE: 0.15722, rank_max: -2.32288, rank_min: -1.02859, comp_any: 0.84074, comp_both: 2.08892, gap: -2.97643, amb: 1.69824, log_np: -0.21684 }
}
export const STEP_THRESHOLD = 3
// The model was fitted at 20 ppm. ponytail: wider tolerances (a Da run) use the
// variant without the mass error, which is not validated on such data.
const MAX_PPM = 25

/** The log-odds of each step of @p s being right (features as in fitstep.py). */
export function stepLogit(s: SpectrumPeaks): (st: Step, z: number) => number {
  const model = s.toleranceUnit === 'ppm' && s.tolerance <= MAX_PPM ? FULL : NO_MASS
  const order = s.int.map((_, i) => i).sort((a, b) => s.int[b] - s.int[a])
  const rank = new Array<number>(s.mz.length)
  order.forEach((p, r) => (rank[p] = r / Math.max(1, s.mz.length - 1)))
  const M = s.precursor != null && s.charge > 0 ? s.precursor * s.charge - s.charge * PROTON : null
  const tol = (x: number): number => (s.toleranceUnit === 'ppm' ? (x * s.tolerance) / 1e6 : s.tolerance)
  // Whether a 1+ peak lies at @p x (the complement of a fragment, read at 1+ as in the fit).
  const has = (x: number): boolean => {
    let lo = 0
    let hi = s.mz.length
    while (lo < hi) {
      const m = (lo + hi) >> 1
      if (s.mz[m] < x) lo = m + 1
      else hi = m
    }
    return [lo - 1, lo].some((k) => k >= 0 && k < s.mz.length && Math.abs(s.mz[k] - x) <= tol(x))
  }
  const comp = (p: number, z: number): number => (M == null ? 0 : has(M - (s.mz[p] * z - z * PROTON) + PROTON) ? 1 : 0)
  const cache = new Map<Step, number>()
  // A step lies in one layer (one fragment charge), so it is cached on its own.
  return (st: Step, z: number): number => {
    const hit = cache.get(st)
    if (hit !== undefined) return hit
    const r = st.readings[0]
    const ad = Math.abs(r.deltaPpm)
    const f: Record<string, number> = {
      lE: Math.min(12, -Math.log10(Math.max(r.evalue ?? 1e3, 1e-300))),
      abs_dppm: ad,
      dppm2: (ad / 10) ** 2,
      rank_max: Math.max(rank[st.u], rank[st.v]),
      rank_min: Math.min(rank[st.u], rank[st.v]),
      comp_any: Math.max(comp(st.u, z), comp(st.v, z)),
      comp_both: Math.min(comp(st.u, z), comp(st.v, z)),
      gap: r.gap ? 1 : 0,
      amb: st.readings.length > 1 ? 1 : 0,
      log_np: Math.log(s.mz.length)
    }
    const v = model.intercept + Object.entries(model.coef).reduce((a, [k, c]) => a + c * f[k], 0)
    cache.set(st, v)
    return v
  }
}

/** The chain weight of the tag graph: the steps a placement adds, each worth its log-odds less @p t. */
export function stepWeight(s: SpectrumPeaks, t = STEP_THRESHOLD): (p: Placement, prev: Placement | null) => number {
  const logit = stepLogit(s)
  return (p, prev) => {
    const shared = prev ? prev.peaks.length - prev.peaks.indexOf(p.peaks[0]) - 1 : 0
    return p.steps.slice(shared).reduce((a, st) => a + logit(st, p.charge) - t, 0)
  }
}
