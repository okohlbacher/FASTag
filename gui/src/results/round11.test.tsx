// Review round 10, the major findings fixed after it: mass-shift bins are named
// from the CLI's assignments, a bundled delta names a bin only within the
// CLI's own window (a mass-gap report), not an assumed one.

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import MassGapChart, { type GapBin } from './MassGapChart'

const bins = (interps?: { name: string; n: number }[]): GapBin[] => [
  { gap: 0, key: '0.00', spectra: 500 },
  { gap: 15.6, key: '15.60', spectra: 40, interps },
  { gap: -17.03, key: '-17.03', spectra: 5 }
]
const labels = (c: HTMLElement): string[] => Array.from(c.querySelectorAll('text')).map((t) => t.textContent ?? '')

describe('round 10 major 3: mass-shift bin labels', () => {
  it('an assumed window does not name a +15.600 bin Oxidation', () => {
    const { container } = render(<MassGapChart bins={bins()} window={0.5} windowAssumed source="run.recon.tsv" />)
    expect(labels(container).some((t) => /15\.6 Oxidation/.test(t))).toBe(false)
    expect(labels(container).some((t) => /^\+15\.6$/.test(t.trim()))).toBe(true)
  })
  it("the CLI's own interpretation names the bin", () => {
    const { container } = render(<MassGapChart bins={bins([{ name: 'Gln->pyro-Glu', n: 3 }, { name: 'Oxidation', n: 30 }])} window={0.5} windowAssumed source="run.recon.tsv" />)
    expect(labels(container).some((t) => /15\.6 Oxidation/.test(t))).toBe(true)
  })
})
