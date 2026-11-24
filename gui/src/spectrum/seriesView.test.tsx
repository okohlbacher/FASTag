// What the view says about the series: the ladder line N→C under the judged
// series, "(written X)" exactly when that reverses FASTag's order.
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LadderLine } from './SpectrumPanel'
import type { Ladder } from './ladder'

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
    expect(text(lad('b', 'open', 'b'), 'EDI', 'EDI')).toMatch(/^b or y\? ions \(read as b\): EDI N→C on/)
  })
})
