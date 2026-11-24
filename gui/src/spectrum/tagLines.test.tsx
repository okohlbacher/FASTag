// #127: which two peaks form each residue step, b and y on separate lines,
// a drop line from the tag line down to every peak the tag lies on.

import { act, fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StickPlot, leftMargin, stepWords } from './SpectrumPanel'
import { hasStep, laddersFor, PROTON, residueMasses, seriesText, tagRowFrom, WATER } from './ladder'
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

  it('a position with no peak is marked on every line drawn, not only the chosen one', () => {
    // y's last peak is not there: the y line has one step and one gap (a
    // higher peak keeps where it should be in view).
    const s = spec([...b, y[0], y[1], y[2] + 40].sort((p, q) => p - q))
    const { best, both } = laddersFor(row, s, residueMasses([]))
    const lines = both.filter((l) => l === best || hasStep(l))
    expect(lines.map((l) => [l.series, l.matched])).toEqual([['b', 3], ['y', 2]])
    expect(best.series).toBe('b')
    const { container } = render(<StickPlot spectrum={s} ladder={best} lines={lines} />)
    expect(container.querySelectorAll('[data-missing=b]').length).toBe(0)
    const miss = container.querySelectorAll('[data-missing=y]')
    expect(miss.length).toBe(1)
    expect(miss[0].getAttribute('class')).toBe('sp-missing alt')
    // From the y line down to the axis, at the m/z the step expected.
    const yLine = Number(container.querySelector('[data-series=y] .sp-step')!.getAttribute('y1'))
    expect(Number(miss[0].getAttribute('y2'))).toBe(yLine)
    expect(miss[0].querySelector('title')!.textContent).toBe(`No peak at m/z ${lines[1].positions[2].expected.toFixed(4)} (${seriesText('y', lines[1].call)})`)
  })

  it('focusing a residue step picks out its two peaks and their drop lines; its title gives both m/z and the delta', () => {
    const s = spec([...b, ...y].sort((p, q) => p - q))
    const { best, both } = laddersFor(row, s, residueMasses([]))
    const { container } = render(<StickPlot spectrum={s} ladder={best} lines={both} />)
    const step = container.querySelector<SVGGElement>('[data-series=b] [data-step="1"]')!
    const words = step.querySelector('title')!.textContent!
    // The A step of the b line: b1 → b2.
    expect(words).toMatch(new RegExp(`^A: m/z ${b[1].toFixed(4)} → ${b[2].toFixed(4)}, Δ [+−]\\d+\\.\\d ppm \\([+−]0\\.\\d{4} Da\\)$`))
    expect(step.getAttribute('aria-label')).toBe(words)
    expect(step.getAttribute('tabindex')).toBe('0')
    expect(container.querySelectorAll('.sp-peak.hl').length).toBe(0)
    act(() => {
      fireEvent.focus(step)
    })
    const lit = Array.from(container.querySelectorAll('.sp-peak.hl')).map((l) => Number(l.getAttribute('x1')))
    const ends = Array.from(step.querySelectorAll('.sp-step')).slice(1).map((l) => Number(l.getAttribute('x1')))
    expect(lit.sort((p, q) => p - q)).toEqual(ends.sort((p, q) => p - q))
    const drops = Array.from(container.querySelectorAll('[data-series=b] .sp-drop.hl')).map((l) => Number(l.getAttribute('x1')))
    expect(drops.sort((p, q) => p - q)).toEqual(ends)
    expect(container.querySelectorAll('[data-series=y] .sp-drop.hl').length).toBe(0)
    expect(step.getAttribute('class')).toBe('sp-step-g hl')
    act(() => {
      fireEvent.blur(step)
    })
    expect(container.querySelectorAll('.sp-peak.hl').length).toBe(0)
    // Hover does the same.
    act(() => {
      fireEvent.pointerOver(step)
    })
    expect(container.querySelectorAll('.sp-peak.hl').length).toBe(2)
  })

  it('a step with a missing peak says so; a Da run gives the delta in Da first', () => {
    const p = (mz: number | null, expected: number, d: number | null) => ({ expected, peak: mz == null ? null : 1, mz, deltaPpm: d == null ? null : (d / expected) * 1e6, deltaMz: d })
    expect(stepWords('G', p(100, 100, null), p(null, 157.0215, null), 'ppm')).toBe('G: m/z 100.0000 → 157.0215 (no peak)')
    expect(stepWords('G', p(100, 100, null), p(157.03, 157.0215, 0.0085), 'Da')).toBe('G: m/z 100.0000 → 157.0300, Δ +0.0085 Da (+54.1 ppm)')
  })
})

// Report 20261124T073546Z_233cbfac: "b or y?" was cut to "or y?" at the
// plot's left edge (a fixed margin of 48 units, the label right-aligned at 42).
describe('the left margin fits the widest label', () => {
  const CHAR = 0.62 * 12
  it('short labels keep the frame; "b or y?", "c or z?" and the ruler\'s "y 2+ DB" widen it', () => {
    expect(leftMargin(['b', 'y?'])).toBe(48)
    expect(leftMargin([])).toBe(48)
    for (const t of ['b or y?', 'c or z?', 'y 2+ DB']) expect(leftMargin([t])).toBeGreaterThanOrEqual(t.length * CHAR + 10)
    expect(leftMargin(['b', 'b or y?'])).toBe(leftMargin(['b or y?']))
    // A label the browser drew wider than the estimate.
    expect(leftMargin(['b'], 80)).toBe(90)
  })
})
