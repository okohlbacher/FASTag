// The mass-gap histogram tests, moved unchanged from App.test.tsx (GUI P1 PR c).

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import DigestPanel from '../DigestPanel'
import { parseReport } from '../digestReport'

describe('redesign: mass-gap histogram', () => {
  it('cuts the 0 bin at the scale of the other bins, labels its count, and counts what lies outside the range', () => {
    const head = 'section\tkey\tvalue\tn\tdescription'
    const hist = [['0.0000', 1000], ['0.9840', 400], ['15.9949', 200], ['2.0000', 1], ['9000.0', 1]]
    const r = parseReport([head, ...hist.map(([g, n]) => `hist\t${g}\t${n}\t-\td`)].join('\n'), '/r/a.massgap.tsv')
    const { container } = render(<DigestPanel reports={[r]} errors={[]} onOpen={() => {}} />)
    const fig = screen.getByRole('img', { name: /^Spectra by precursor minus peptide mass/ })
    expect(fig.getAttribute('aria-label')).toMatch(/in 1 Da steps from 0 to \+16 Da: 1,000 at 0 \(bar cut\); next \+1 \(400\), \+16 \(200\)/)
    expect(container.querySelector('.hist .bar.cut .cut-label')?.textContent).toBe('1,000')
    expect(container.querySelector('.gap-hist figcaption')?.textContent).toMatch(/1 beyond 0 to \+16 Da are not drawn/)
  })
})
