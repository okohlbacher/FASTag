// #127: which two peaks form each residue step, b and y on separate lines,
// a drop line from the tag line down to every peak the tag lies on.

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StickPlot } from './SpectrumPanel'
import { hasStep, laddersFor, PROTON, residueMasses, tagRowFrom, WATER } from './ladder'
import type { SpectrumPeaks } from './dump'

const G = 57.02146372057
const A = 71.03711378471
const N = 100
const C = 200
const b = [N + PROTON, N + PROTON + G, N + PROTON + G + A]
const y = [C + WATER + PROTON, C + WATER + PROTON + A, C + WATER + PROTON + A + G]

const spec = (mz: number[]): SpectrumPeaks => ({
  nativeId: 'scan=1',
  index: 0,
  msLevel: 2,
  rt: null,
  precursor: 800,
  charge: 2,
  chargeGiven: 2,
  tolerance: 10,
  toleranceUnit: 'ppm',
  picked: false,
  deisotoped: true,
  tagged: true,
  nRead: mz.length,
  mz,
  int: mz.map((_, i) => 100 + i)
})

const columns = ['spectrum', 'tag', 'length', 'charge', 'nterm_mass', 'cterm_mass', 'gapped', 'evalue']
const row = tagRowFrom(columns, ['scan=1', 'GA', '2', '1', String(N), String(C), '0', '0.01'])!

describe('#127 tag lines', () => {
  it('both series on the peaks: two lines, a drop line per peak, residues between the two peaks of their step', () => {
    const s = spec([...b, ...y].sort((p, q) => p - q))
    const { best, both } = laddersFor(row, s, residueMasses([]))
    expect(both.map((l) => [l.series, l.matched])).toEqual([['b', 3], ['y', 3]])
    const { container } = render(<StickPlot spectrum={s} ladder={best} lines={both} />)
    const q = (sel: string): number => container.querySelectorAll(sel).length
    expect(q('[data-series=b]')).toBe(1)
    expect(q('[data-series=y]')).toBe(1)
    expect(q('[data-drop=b]')).toBe(3)
    expect(q('[data-drop=y]')).toBe(3)
    // The chosen ladder's peaks keep data-peak=ladder (e2e), the other's are marked apart.
    expect(q('[data-peak=ladder]')).toBe(3)
    expect(q('[data-peak=other]')).toBe(3)
    // The b line's G step ends on the b peaks, its label in between.
    const line = container.querySelector('[data-series=b]')!
    const drops = Array.from(line.querySelectorAll('[data-drop]')).map((d) => Number(d.getAttribute('x1')))
    const g = Array.from(line.querySelectorAll('text')).find((t) => t.textContent === 'G')!
    expect(Number(g.getAttribute('x'))).toBeCloseTo((drops[0] + drops[1]) / 2, 6)
  })

  it('a series off the peaks gets no line', () => {
    const s = spec(b)
    const { best, both } = laddersFor(row, s, residueMasses([]))
    const lines = both.filter((l) => l === best || hasStep(l))
    expect(lines.map((l) => l.series)).toEqual(['b'])
    const { container } = render(<StickPlot spectrum={s} ladder={best} lines={lines} />)
    expect(container.querySelectorAll('[data-series=y]').length).toBe(0)
    expect(container.querySelectorAll('[data-drop=b]').length).toBe(3)
  })
})
