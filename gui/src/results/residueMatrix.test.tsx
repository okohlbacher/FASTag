// Mass shifts › By residue in the Mass shifts tab, on the 1.16.2 survey of
// PXD000001 (src/fixtures/cli-1.16/README.md): the view beside the
// Mass-shift table, its filter, columns and export; and where the app names
// it (Help search, parameter search, Outputs, the Overview tile). Counts
// read off the fixture by hand (awk, a Python csv reader).

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { installMockBridge } from '../testing/mockBridge'
import { click, flush } from '../testing/render'
import ReconView from './ReconView'
import { heatOf } from './ResidueMatrix'
import { buildOverview, byResidueNote, type OverviewInputs } from './overview'
import { searchHelp } from '../help/search'
import { searchParams } from '../setup/searchRank'
import { PRODUCT_OF } from '../setup/products'
import { taskById } from '../setup/tasks'
import pxd1Delta from '../fixtures/cli-1.16/pxd000001-survey/run.delta.tsv?raw'
import humanDelta from '../fixtures/cli/v112-pxd014764-delta-ext3/run.delta.tsv?raw'

const DELTA = '/d/run01.delta.tsv'
const heads = (grid: HTMLElement): string[] => within(grid).getAllByRole('columnheader').map((h) => (h.textContent ?? '').replace(/[↑↓]/g, '').trim())

async function openMatrix(text = pxd1Delta) {
  const mock = installMockBridge()
  mock.reportFiles = { [DELTA]: text }
  render(<ReconView massgap={null} tables={{ delta: DELTA }} onOpen={vi.fn()} />)
  await flush()
  return mock
}

describe('Mass shifts › By residue', () => {
  it('sits beside the Mass-shift table and shows the 27 shifts with localized spectra', async () => {
    await openMatrix()
    expect(screen.getByRole('grid', { name: 'Mass-shift table' }).getAttribute('aria-rowcount')).toBe('223')
    await click(screen.getByRole('button', { name: 'By residue' }))
    const grid = screen.getByRole('grid', { name: 'Mass shifts by residue' })
    expect(grid.getAttribute('aria-rowcount')).toBe('28')
    expect(screen.getByText(/^27 of 222 rows/)).toBeTruthy()
    // Every site is terminal-ambiguous: N-term and C-term only.
    expect(heads(grid)).toEqual(['Gap (Da)', 'Best name', 'Spectra', 'Localized', 'Unlocalized', 'Localized %', 'N-term', 'C-term'])
    // Most spectra first: 229.1680, 240 spectra, 58 localized.
    const first = within(grid).getAllByRole('row')[1]
    expect(within(first).getAllByRole('gridcell').map((c) => c.textContent)).toEqual(['229.1680', 'TMT6plex@N-term/K/S', '240', '58', '37', '24%', '41', '17'])
    expect(screen.getByText(/27 mass shifts with 567 spectra: 151 localized \(27%\), 194 unlocalized\./)).toBeTruthy()
  })

  it('filters by localized count, shows every residue on request, and counts terminal sites under their residue', async () => {
    await openMatrix()
    await click(screen.getByRole('button', { name: 'By residue' }))
    const grid = (): HTMLElement => screen.getByRole('grid', { name: 'Mass shifts by residue' })
    await act(async () => void fireEvent.change(screen.getByRole('spinbutton', { name: 'Localized at least' }), { target: { value: '5' } }))
    // awk: localized >= 5 in 8 rows.
    expect(grid().getAttribute('aria-rowcount')).toBe('9')
    await click(screen.getByRole('checkbox', { name: /Hide empty residue columns/ }))
    expect(heads(grid()).slice(6)).toEqual(['N-term', 'A', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'K', 'L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'V', 'W', 'Y', 'C-term'])
    await click(screen.getByRole('checkbox', { name: /Hide empty residue columns/ }))
    await click(screen.getByRole('checkbox', { name: /Terminal sites under their residue/ }))
    // The 8 rows' sites under their residues.
    expect(heads(grid()).slice(6)).toEqual(['A', 'D', 'E', 'F', 'G', 'H', 'I', 'K', 'L', 'Q', 'R', 'S', 'T', 'V', 'Y'])
    const k = within(grid()).getAllByRole('row')[1]
    // 229.1680: K holds C-term|K 15 and Protein C-term|K 2.
    expect(within(k).getAllByRole('gridcell')[13].textContent).toBe('17')
    expect(within(k).getAllByRole('gridcell')[13].getAttribute('title')).toBe('K at 229.1680 Da: 17 localized (C-term|K 15, Protein C-term|K 2)')
  })

  it('exports the rows and columns shown, in the order shown, as CSV', async () => {
    const mock = await openMatrix()
    await click(screen.getByRole('button', { name: 'By residue' }))
    await act(async () => void fireEvent.change(screen.getByRole('spinbutton', { name: 'Localized at least' }), { target: { value: '10' } }))
    // Sorted by gap, ascending.
    await click(screen.getByRole('button', { name: /^Gap \(Da\)/ }))
    mock.nextPickOutput = '/d/run01.delta.by_residue.csv'
    await click(screen.getByRole('button', { name: 'Export matrix…' }))
    await flush()
    expect(mock.pickFileCalls[mock.pickFileCalls.length - 1]).toEqual({ kind: 'save', formats: ['tsv', 'csv'] })
    expect(mock.summaryWrites).toHaveLength(1)
    expect(mock.summaryWrites[0].dest).toBe('/d/run01.delta.by_residue.csv')
    expect(mock.summaryWrites[0].text).toBe(
      'delta,name,spectra,localized,unlocalized,localized_pct,N-term,C-term\n' +
        '101.0730,HN2_mustard@K,15,11,4,73,11,0\n' +
        '229.1620,TMT6plex@N-term/K/T/H,135,26,48,19,17,9\n' +
        '229.1680,TMT6plex@N-term/K/S,240,58,37,24,41,17\n'
    )
    expect(mock.summaryProtect[mock.summaryProtect.length - 1]).toEqual([DELTA])
    expect(screen.getByText(/^3 rows and 2 site columns written to/)).toBeTruthy()
  })

  it('never writes over the table shown, and names a .tsv or .csv', async () => {
    const mock = await openMatrix()
    await click(screen.getByRole('button', { name: 'By residue' }))
    mock.nextPickOutput = DELTA
    await click(screen.getByRole('button', { name: 'Export matrix…' }))
    await flush()
    expect(screen.getByText(/is the mass-shift table shown/)).toBeTruthy()
    mock.nextPickOutput = '/d/m.txt'
    await click(screen.getByRole('button', { name: 'Export matrix…' }))
    await flush()
    expect(screen.getByText(/name the file \.tsv or \.csv/)).toBeTruthy()
    expect(mock.summaryWrites).toEqual([])
  })

  it('a table without a residues column (FASTag 1.12) has no By residue view', async () => {
    await openMatrix(humanDelta)
    expect(screen.getByRole('grid', { name: 'Mass-shift table' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'By residue' })).toBeNull()
  })
})

describe('the residue matrix is findable', () => {
  it('Help search finds it by "residue matrix" and by "mass shifts by residue"', () => {
    expect(searchHelp('residue matrix')[0].id).toBe('workflow-shift-residues')
    expect(searchHelp('mass shifts by residue')[0].id).toBe('workflow-shift-residues')
    expect(searchHelp('residue matrix').some((h) => h.id === 'param-delta_out')).toBe(true)
  })

  it('the parameter search finds the Mass-shift table by "residue matrix"', () => {
    expect(searchParams('residue matrix')[0]).toMatchObject({ name: 'delta_out', where: 'help' })
    expect(searchParams('mass shifts by residue')[0].name).toBe('delta_out')
  })

  it('the survey says so in its product list and its text', () => {
    expect(PRODUCT_OF.get('delta_out')!.what).toMatch(/mass shifts by residue \(Mass shifts › By residue\)/)
    expect(taskById('mass-shift')!.gets).toMatch(/mass shifts by residue/)
    expect(taskById('mass-shift')!.blurb).toMatch(/mass shifts by residue/)
  })

  it('the Top mass shift tile names the view, the file and the column', () => {
    const base: OverviewInputs = { log: ['6103 MS2 spectra, 223912 tags'], reports: [], species: null, census: null, params: { delta_out: DELTA }, instrument: null, delta: pxd1Delta }
    const t = buildOverview(base).figures.find((x) => x.id === 'topshift')!
    expect(t.value).toBe('+229.1680 Da (TMT6plex@N-term/K/S(+3.9ppm))')
    expect(t.note).toMatch(/; mass shifts by residue: Mass shifts › By residue \(the residues column of run01\.delta\.tsv\)$/)
    // A 1.12 table has no residues column: no such note.
    expect(byResidueNote(humanDelta, DELTA)).toBeNull()
    expect(byResidueNote(pxd1Delta, undefined)).toMatch(/<run>\.delta\.tsv/)
  })
})

describe('heatOf: the shade follows the log of the count', () => {
  it('is 0 for no count, 1 for the largest, and on a log scale between', () => {
    expect(heatOf(0, 100)).toBe(0)
    expect(heatOf(5, 0)).toBe(0)
    expect(heatOf(100, 100)).toBe(1)
    // A count of 10 next to 1,000: about a third of the full shade, not 1 %.
    expect(heatOf(10, 1000)).toBeCloseTo(Math.log1p(10) / Math.log1p(1000), 12)
    expect(heatOf(10, 1000)).toBeGreaterThan(0.3)
    expect(heatOf(1, 2)).toBeLessThan(heatOf(2, 2))
  })
})
