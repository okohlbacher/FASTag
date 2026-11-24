// A tag's steps on the peaks: the shape the peptide ruler (peptide.ts) and
// the terminus test (terminus.ts) read a ladder in.

import type { Ladder } from './ladder'

export interface Reading {
  // One residue, or a gap's residues in alphabetical order: [CW].
  label: string
  gap: boolean
  // Best E-value of the rows that read the step so (null: unscored).
  evalue: number | null
  // The step's error under this reading: observed minus expected distance.
  deltaMz: number
  deltaPpm: number
}

export interface Step {
  // Peak indices, u below v in m/z.
  u: number
  v: number
  // Best evidence first.
  readings: Reading[]
}

/** A ladder as its series, fragment charge, the peaks it lies on (ascending
 *  m/z) and the steps between them. */
export interface StepPath {
  series: Ladder['series']
  charge: number
  peaks: number[]
  steps: Step[]
}

/** A ladder's steps between the peaks it lies on (a gap step across a missing position). */
export function ladderSteps(l: Ladder): Step[] {
  const out: Step[] = []
  let from = -1
  l.positions.forEach((p, k) => {
    if (p.peak == null) return
    if (from >= 0) {
      const res = l.residues.slice(from, k)
      out.push({ u: l.positions[from].peak as number, v: p.peak, readings: [{ label: res.length > 1 ? `[${res.join('')}]` : res[0], gap: res.length > 1, evalue: null, deltaMz: 0, deltaPpm: 0 }] })
    }
    from = k
  })
  return out
}

/** @p l as a StepPath, read as @p series (its own by default). */
export function pathOf(l: Ladder, series: Ladder['series'] = l.series): StepPath {
  return { series, charge: l.charge, peaks: l.positions.map((p) => p.peak).filter((p): p is number => p != null), steps: ladderSteps(l) }
}
