// The chosen tag of a spectrum: its two ladders on their own lines, the
// series called (a terminus only one reading lies at; "b or y?" when not
// told apart), its terminus beside it and on the plot, the error strip, the
// peptide ruler from the run's placements with the residues it confirms.

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SpectrumPanel, { leftMargin } from './SpectrumPanel'
import { PROTON, WATER, residueMasses } from './ladder'
import { installMockBridge } from '../testing/mockBridge'
import type { ResultsPage } from '../types'

const R = residueMasses(undefined).masses
const PEP = 'PEPTIDEK'
const sum = (t: string): number => [...t].reduce((a, r) => a + R[r], 0)
const MASS = sum(PEP) + WATER
// b1..b7 of PEPTIDEK at 1+ and their complements y7..y1; no a ions. A low
// peak at m/z 10 puts b0 in view.
const b: number[] = []
let m = PROTON
for (const r of PEP.slice(0, 7)) b.push((m += R[r]))
const yc = b.map((x) => MASS - (x - PROTON) + PROTON)
const mz = [10, ...b, ...yc].sort((p, q) => p - q)
const dump =
  JSON.stringify({
    record: 'spectrum', format: 1, native_id: 'scan=1', index: 0, ms_level: 2, rt: 1, precursor: (MASS + 2 * PROTON) / 2, charge: 2, charge_given: 2,
    tolerance: 20, tolerance_unit: 'ppm', picked: false, deisotoped: true, tagged: true, n_read: mz.length, n: mz.length, mz, int: mz.map(() => 1000)
  }) + '\n{"record":"end"}\n'
const tagCols = ['spectrum', 'tag', 'length', 'charge', 'nterm_mass', 'cterm_mass', 'extended', 'gapped', 'evalue', 'fasta_hit']
// Flanks as FASTag writes them: nterm + residues + cterm + water = M.
const tag = (t: string, nterm: number, e: string): string[] => ['scan=1', t, String(t.length), '1', String(nterm), String(MASS - WATER - nterm - sum(t)), '0', '0', e, 'fwd']
// EPTIDE from b1: P before it, K after it. PT from b3: no terminus within one residue.
const tagRows = [tag('EPTIDE', sum('P'), '1e-9'), tag('PT', sum('PE'), '1e-3')]
const recCols = ['spectrum', 'tag', 'protein', 'peptide', 'pos', 'reversed', 'nterm_match', 'cterm_match', 'delta_mass', 'region', 'delta_interp']
const recRows = [['scan=1', 'EPTIDE', 'sp|P1|TEST_ECOLI test', PEP, '1', '1', '1', '1', '0.0000', '', '']]
const page = (columns: string[], rows: string[][]): ResultsPage => ({ columns, totalRows: rows.length, matchedRows: rows.length, rows, rowIds: rows.map((_, i) => i), ranked: true, pending: false })
// A plot line's series label, without its tooltip.
const labels = (c: HTMLElement): string[] => Array.from(c.querySelectorAll('.sp-line .sp-series')).map((t) => t.firstChild?.textContent ?? '')

function panel(placements?: string) {
  const mock = installMockBridge()
  mock.spectrumDumps['scan=1'] = dump
  window.fastag.resultsQuery = (path) => (path.endsWith('recon.tsv') ? Promise.reject('cancelled') : Promise.resolve(page(tagCols, tagRows)))
  mock.tables['/d/recon.tsv'] = { columns: recCols, rows: recRows }
  const r = render(
    <SpectrumPanel
      target={{ path: '/d/a.tags.tsv', spectrum: 'scan=1', rowId: 0 }}
      source={{ input: '/d/a.mzML', params: {}, from: 'run' }}
      placements={placements}
      onTarget={vi.fn()}
      onLocate={vi.fn()}
    />
  )
  return { ...r, mock }
}

describe('Spectrum, the chosen tag', () => {
  it('one view: both ladders, the series a terminus settles, the terminus beside the tag and on the plot, the error strip', async () => {
    const { container } = panel()
    const ladder = await screen.findByTestId('ladder')
    // One view: no choice of which tags are drawn.
    expect(screen.queryByRole('group', { name: 'Tags drawn' })).toBeNull()
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    // No a ions: read as b its high peak lies before a C-terminal K (from the
    // precursor), so b, sure; its complement reads y, sure, the same way.
    await waitFor(() => expect(labels(container)).toEqual(['b', 'y']))
    expect(ladder.textContent).toMatch(/^b ions: N–\(P\)EPTIDE\(K\)–C N→C on 7 of 7 positions/)
    expect(ladder.querySelector('strong')?.getAttribute('title')).toMatch(/^Ion series: read as b ions, its low peak is b1 of an N-terminal P and its high peak is b\(n−1\), before a C-terminal K \(from the precursor\)\./)
    expect([...ladder.querySelectorAll('.sp-term')].map((t) => [t.getAttribute('aria-label'), t.className])).toEqual([
      ['one residue (P) from the N terminus', 'sp-term away'],
      ['one residue (K) from the C terminus', 'sp-term away']
    ])
    // The terminus read from the peaks, marked at b0.
    const mark = container.querySelector('[data-testid=terminus-mark]')
    expect(mark?.getAttribute('aria-label')).toMatch(/^N b0 at m\/z 1\.0073: one residue \(P\) from the N terminus$/)
    // The error strip: one dot per step.
    expect(container.querySelectorAll('[data-strip]').length).toBe(1)
    expect(container.querySelectorAll('[data-step-error]').length).toBe(6)
    // No placements: no ruler.
    expect(container.querySelectorAll('[data-ruler]').length).toBe(0)
  })

  it('a tag at no terminus is not told apart: "b or y?" on the plot and in the ladder line', async () => {
    const { container } = panel()
    await screen.findByTestId('ladder')
    fireEvent.click(screen.getAllByRole('row').find((r) => r.textContent?.startsWith('PT')) as HTMLElement)
    await waitFor(() => expect(labels(container)).toEqual(['b or y?', 'b or y?']))
    // Never clipped (report 20261124T073546Z_233cbfac): each label, drawn
    // right-aligned, starts inside the plot, and the plot starts at the margin.
    const margin = leftMargin(['b or y?'])
    expect(margin).toBeGreaterThan(48)
    for (const t of Array.from(container.querySelectorAll<SVGTextElement>('.sp-line .sp-series'))) {
      expect(t.getAttribute('text-anchor')).toBe('end')
      expect(Number(t.getAttribute('x')) - (t.firstChild?.textContent ?? '').length * 0.62 * 12).toBeGreaterThanOrEqual(0)
    }
    expect(Number(container.querySelector('[data-axis]')!.getAttribute('x1'))).toBe(margin)
    expect(screen.getByTestId('ladder').textContent).toMatch(/^b or y\? ions \(read as b\): PT N→C/)
    expect(container.querySelectorAll('[data-testid=terminus-mark]').length).toBe(0)
    // The Ladder column of the tags table says the same.
    const cells = Array.from(container.querySelectorAll('table[aria-label="Tags of this spectrum"] tbody tr')).map((r) => r.lastElementChild?.textContent)
    expect(cells).toEqual(['b on 7/7 peaks', 'b or y? on 3/3 peaks'])
  })

  it("the run's placements: the peptide ruler, the residues the tag confirms in bold, its peaks against the peptide in the strip", async () => {
    const { container, mock } = panel('/d/recon.tsv')
    const peptide = await screen.findByTestId('peptide')
    expect(peptide.textContent).toMatch(/Tags placed on PEPTIDEK \(sp\|P1\|TEST_ECOLI\): 1 tag, 1 exactly\. A candidate/)
    expect(mock.tableQueryCalls.map((c) => [c.path, c.view.spectrum, c.view.spectrumExact])).toEqual([['/d/recon.tsv', 'scan=1', true]])
    await waitFor(() => expect(container.querySelectorAll('[data-ruler]').length).toBe(1))
    expect(Array.from(container.querySelectorAll('.sp-ruler-res.on')).map((t) => t.textContent).join('')).toBe('EPTIDE')
    expect(container.querySelectorAll('.sp-strip-pep').length).toBe(7)
    // The database peptide outranks the peaks: b, sure, on its b ions.
    expect(screen.getByTestId('ladder').querySelector('strong')?.getAttribute('title')).toMatch(/^Ion series: 6 of its steps lie on the database peptide's b ions\./)
  })
})
