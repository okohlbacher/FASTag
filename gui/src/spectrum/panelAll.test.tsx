// All tags of a spectrum: the peptide ruler from the run's placements, the
// steps of other tags against the selected one, the error strip, the pileup.

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SpectrumPanel from './SpectrumPanel'
import { PROTON, residueMasses } from './ladder'
import { installMockBridge } from '../testing/mockBridge'
import type { ResultsPage } from '../types'

const R = residueMasses(undefined).masses
const PEP = 'PEPTIDEK'
// b ions of PEPTIDEK at 1+ (b1..b7), and a peak a W above b2 for a tag that differs.
const b: number[] = []
let m = PROTON
for (const r of PEP.slice(0, 7)) b.push((m += R[r]))
const mz = [...b, b[1] + R.W].sort((x, y) => x - y)
const dump =
  JSON.stringify({
    record: 'spectrum', format: 1, native_id: 'scan=1', index: 0, ms_level: 2, rt: 1, precursor: 500, charge: 2, charge_given: 2,
    tolerance: 20, tolerance_unit: 'ppm', picked: false, deisotoped: true, tagged: true, n_read: mz.length, n: mz.length, mz, int: mz.map((_, i) => 100 + i)
  }) + '\n{"record":"end"}\n'
const sum = (t: string): number => [...t].reduce((a, r) => a + R[r], 0)
const tagCols = ['spectrum', 'tag', 'length', 'charge', 'nterm_mass', 'cterm_mass', 'extended', 'gapped', 'evalue', 'fasta_hit']
const tag = (t: string, nterm: number, e: string): string[] => ['scan=1', t, String(t.length), '1', String(nterm), '5000', '0', '0', e, 'fwd']
const tagRows = [tag('EPT', sum('P'), '0.001'), tag('PTID', sum('PE'), '0.01'), tag('IDE', sum('PEPT'), '0.5'), tag('W', sum('PE'), '0.9')]
const recCols = ['spectrum', 'tag', 'protein', 'peptide', 'pos', 'reversed', 'nterm_match', 'cterm_match', 'delta_mass', 'region', 'delta_interp']
const recRows = [['scan=1', 'EPT', 'sp|P1|TEST_ECOLI test', PEP, '1', '1', '1', '1', '0.0000', '', ''], ['scan=1', 'PTID', 'sp|P1|TEST_ECOLI test', PEP, '2', '1', '1', '1', '0.0000', '', '']]
const page = (columns: string[], rows: string[][]): ResultsPage => ({ columns, totalRows: rows.length, matchedRows: rows.length, rows, rowIds: rows.map((_, i) => i), ranked: true, pending: false })

describe('Spectrum, all tags', () => {
  it('ruler of the placed peptide, steps against the selected tag, error strip and pileup', async () => {
    const mock = installMockBridge()
    mock.spectrumDumps['scan=1'] = dump
    window.fastag.resultsQuery = (path) => Promise.resolve(path.endsWith('recon.tsv') ? page(recCols, recRows) : page(tagCols, tagRows))
    const { container } = render(
      <SpectrumPanel
        target={{ path: '/d/a.tags.tsv', spectrum: 'scan=1', rowId: 0 }}
        source={{ input: '/d/a.mzML', params: {}, from: 'run' }}
        placements="/d/recon.tsv"
        onTarget={vi.fn()}
        onLocate={vi.fn()}
      />
    )
    const peptide = await screen.findByTestId('peptide')
    expect(peptide.textContent).toMatch(/Tags placed on PEPTIDEK \(sp\|P1\|TEST_ECOLI\): 2 tags, 2 exactly\. A candidate/)
    // One tag drawn: the ruler is there already.
    expect(container.querySelectorAll('[data-ruler]').length).toBe(1)
    fireEvent.click(screen.getByLabelText('All tags, resolved'))
    expect(screen.getByTestId('merge-summary').textContent).toMatch(/4 tags \(4 distinct\) → 2 resolved/)
    // EPT, PTID and IDE assemble; W from b2 differs from them.
    const rows = Array.from(container.querySelectorAll('table[aria-label="Resolved tags of this spectrum"] tbody tr')).map((r) => Array.from(r.querySelectorAll('td')).map((c) => c.textContent))
    expect(rows[0][0]).toBe('#1 EPTIDE')
    expect(rows[0][4]).toBe('6 of 6')
    expect(rows[1][0]).toBe('#2 W')
    expect(rows[1][4]).toBe('0 of 1')
    expect(container.querySelectorAll('[data-kind=differs]').length).toBe(1)
    // Ruler: the residues the selected tag confirms are marked.
    expect(Array.from(container.querySelectorAll('.sp-ruler-res.on')).map((t) => t.textContent).join('')).toBe('EPTIDE')
    // Strip: one dot per step of the selected tag, one hollow for the step that differs.
    expect(container.querySelectorAll('[data-step-error]').length).toBe(6)
    expect(container.querySelectorAll('.sp-strip-other').length).toBe(1)
    // Pileup: the peptide, the resolved tag, its three tags and the one that differs.
    const pile = screen.getByTestId('pileup')
    expect(Array.from(pile.querySelectorAll('.sp-pile-step.pep')).map((c) => c.textContent).join('')).toBe('EPTIDE')
    expect(Array.from(pile.querySelectorAll('button')).map((x) => x.textContent)).toEqual(['EPT', 'PTID', 'IDE', 'W'])
    expect(pile.querySelectorAll('.sp-pile-step.differs').length).toBe(1)
    // A tag of the pileup opens alone.
    fireEvent.click(screen.getByRole('button', { name: 'PTID' }))
    expect((screen.getByLabelText('Chosen tag') as HTMLInputElement).checked).toBe(true)
    expect(screen.getByTestId('ladder').textContent).toContain('PTID')
  })
})
