// Mass shifts › By residue in the Mass shifts tab, on the 1.16.2 survey of
// PXD000001 (src/fixtures/cli-1.16/README.md): the view beside the
// Mass-shift table, its filter, columns and export; and where the app names
// it (Help search, parameter search, Outputs, the Overview tile). Counts
// read off the fixture by hand (awk, a Python csv reader).

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
import lensN57 from '../fixtures/cli-1.16/pxd045734-lens/ah_4068_ZW_032115_UIF_N_57yo.delta.tsv?raw'
import lensIC57 from '../fixtures/cli-1.16/pxd045734-lens/ah_4068_ZW_032115_UIF_IC_57yo.delta.tsv?raw'
import lensN22 from '../fixtures/cli-1.16/pxd045734-lens/sh_4096_ZW_041615_UIF_N_22yo.delta.tsv?raw'
import lensIC22 from '../fixtures/cli-1.16/pxd045734-lens/sh_4096_ZW_041615_UIF_IC_22yo.delta.tsv?raw'

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
  it('sits beside the Mass-shift table and shows the 26 shifts with localized spectra, the unshifted rows left out', async () => {
    await openMatrix()
    // The Mass-shift table lists the 217 rows with a gap of 0.5 Da or more.
    expect(screen.getByRole('grid', { name: 'Mass-shift table' }).getAttribute('aria-rowcount')).toBe('218')
    expect(screen.getByText('32 spectra with a gap under 0.5 Da (no shift) not listed.')).toBeTruthy()
    await click(screen.getByRole('button', { name: 'By residue' }))
    const grid = screen.getByRole('grid', { name: 'Mass shifts by residue' })
    // awk: 217 rows with |delta| >= 0.5, 26 of them with localized spectra;
    // 5 rows under 0.5 Da hold 32 spectra (0.0000: 23; 0.0055: 4 localized on C-term|R).
    expect(grid.getAttribute('aria-rowcount')).toBe('27')
    expect(screen.getByText(/^26 of 217 rows/)).toBeTruthy()
    expect(screen.getByText(/Rows with a gap under 0\.5 Da \(unshifted placements\) are left out/)).toBeTruthy()
    expect(screen.getByText('32 spectra with a gap under 0.5 Da (no shift) not listed.')).toBeTruthy()
    expect(within(grid).queryByText('0.0055')).toBeNull()
    // Every site is terminal-ambiguous: N-term and C-term only.
    expect(heads(grid)).toEqual(['Gap (Da)', 'Best name', 'Spectra', 'Localized', 'Unlocalized', 'Localized %', 'N-term', 'C-term'])
    // Most spectra first: 229.1680, 240 spectra, 58 localized.
    const first = within(grid).getAllByRole('row')[1]
    expect(within(first).getAllByRole('gridcell').map((c) => c.textContent)).toEqual(['229.1680', 'TMT6plex@N-term/K/S', '240', '58', '37', '24%', '41', '17'])
    expect(screen.getByText(/26 mass shifts with 562 spectra: 147 localized \(26%\), 193 unlocalized\./)).toBeTruthy()
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

// Four PXD045734 lens runs (src/fixtures/cli-1.16/pxd045734-lens/README.md);
// totals by awk: shifted spectra 2474, 2409, 816, 949; under 0.5 Da 1783,
// 2456, 1463, 1820.
const LENS: Record<string, string> = {
  '/lens/ah_4068_UIF_N.delta.tsv': lensN57,
  '/lens/ah_4068_UIF_IC.delta.tsv': lensIC57,
  '/lens/sh_4096_UIF_N.delta.tsv': lensN22,
  '/lens/sh_4096_UIF_IC.delta.tsv': lensIC22
}
const [L1, L2, L3, L4] = Object.keys(LENS)

async function openLens(batchDeltas?: string[]) {
  const mock = installMockBridge()
  mock.reportFiles = { ...LENS }
  render(<ReconView massgap={null} tables={{ delta: L1 }} onOpen={vi.fn()} batchDeltas={batchDeltas} />)
  await flush()
  await click(screen.getByRole('button', { name: 'By residue' }))
  return mock
}
const sumLine = (): string => document.querySelector('.recon-tables .report-sum')?.textContent ?? ''

describe('Mass shifts › By residue, pooled', () => {
  it('Add tables… pools the picked tables: the caption names them, a Tables column, the counts summed', async () => {
    const mock = await openLens()
    expect(screen.getByText('1,783 spectra with a gap under 0.5 Da (no shift) not listed.')).toBeTruthy()
    // The shown table picked again is not pooled twice.
    mock.nextPickFiles = [L2, L3, L4, L1]
    await click(screen.getByRole('button', { name: 'Add tables…' }))
    await waitFor(() => expect(screen.getByText(/^Pooled:/)).toBeTruthy())
    expect(mock.pickFileCalls[mock.pickFileCalls.length - 1]).toEqual({ kind: 'open', formats: ['tsv'] })
    const files = screen.getByText('4 mass-shift tables')
    expect(files.getAttribute('title')).toBe([L1, L2, L3, L4].join('\n'))
    expect(screen.getByText(/rows of different tables within 0\.004 Da of each other are one row \(the -delta_group default: the tables do not record their own\)/)).toBeTruthy()
    expect(screen.getByText('7,522 spectra with a gap under 0.5 Da (no shift) not listed.')).toBeTruthy()
    const grid = screen.getByRole('grid', { name: 'Mass shifts by residue' })
    expect(heads(grid).slice(0, 4)).toEqual(['Gap (Da)', 'Best name', 'Tables', 'Spectra'])
    // Localized at least 0: every shifted spectrum of the four runs.
    await act(async () => void fireEvent.change(screen.getByRole('spinbutton', { name: 'Localized at least' }), { target: { value: '0' } }))
    expect(sumLine()).toMatch(/ with 6,648 spectra: /)
    await click(screen.getByRole('button', { name: 'This table only' }))
    expect(screen.queryByText(/^Pooled:/)).toBeNull()
    expect(sumLine()).toMatch(/ with 2,474 spectra: /)
  })

  it('names the files it could not pool', async () => {
    const mock = await openLens()
    mock.reportFiles['/lens/pxd000001.delta.tsv'] = humanDelta
    mock.nextPickFiles = [L2, '/lens/missing.delta.tsv', '/lens/pxd000001.delta.tsv']
    await click(screen.getByRole('button', { name: 'Add tables…' }))
    await waitFor(() => expect(screen.getByText(/^Not pooled:/)).toBeTruthy())
    expect(screen.getByText(/^Not pooled:/).textContent).toBe(
      'Not pooled: /lens/missing.delta.tsv (not found); /lens/pxd000001.delta.tsv (no residues column (FASTag 1.15.1 or earlier)).'
    )
    expect(screen.getByText('2 mass-shift tables')).toBeTruthy()
  })

  it("pools a batch's tables, and uses the runs' recorded -delta_group", async () => {
    const mock = installMockBridge()
    mock.reportFiles = { ...LENS }
    const rec = (out: string, i: number) => ({ id: `r${i}`, input: `/in/${i}.mzML`, outputs: [out], cwd: null, argv: ['FASTag', '-delta_out', out, '-delta_group', '0.006'], status: 'ok' as const, exitCode: 0, message: null, start: 0, end: 1, cleanup: { removed: [], failed: [], renamed: [] } })
    mock.history = [L1, L2, L3].map(rec)
    render(<ReconView massgap={null} tables={{ delta: L1 }} onOpen={vi.fn()} batchDeltas={[L1, L2, L3]} />)
    await flush()
    await click(screen.getByRole('button', { name: 'By residue' }))
    await click(screen.getByRole('button', { name: 'Pool the batch (3 tables)' }))
    await waitFor(() => expect(screen.getByText('3 mass-shift tables')).toBeTruthy())
    expect(screen.getByText(/within 0\.006 Da of each other are one row \(the -delta_group of their runs\)/)).toBeTruthy()
    // Every batch table pooled: the button is gone.
    expect(screen.queryByRole('button', { name: /^Pool the batch/ })).toBeNull()
  })

  it('Export matrix… writes the pooled matrix and a sidecar naming its tables', async () => {
    const mock = await openLens()
    mock.nextPickFiles = [L2, L3]
    await click(screen.getByRole('button', { name: 'Add tables…' }))
    await waitFor(() => expect(screen.getByText('3 mass-shift tables')).toBeTruthy())
    await act(async () => void fireEvent.change(screen.getByRole('spinbutton', { name: 'Localized at least' }), { target: { value: '50' } }))
    // A pooled table is never written over.
    mock.nextPickOutput = L3
    await click(screen.getByRole('button', { name: 'Export matrix…' }))
    await flush()
    expect(screen.getByText(/is a pooled mass-shift table/)).toBeTruthy()
    mock.nextPickOutput = '/out/lens.by_residue.tsv'
    await click(screen.getByRole('button', { name: 'Export matrix…' }))
    await waitFor(() => expect(mock.summaryWrites).toHaveLength(2))
    expect(mock.summaryWrites.map((w) => w.dest)).toEqual(['/out/lens.by_residue.tsv', '/out/lens.by_residue.sources.tsv'])
    expect(mock.summaryProtect[mock.summaryProtect.length - 1]).toEqual([L1, L2, L3])
    const [head, ...rows] = mock.summaryWrites[0].text.trim().split('\n').map((l) => l.split('\t'))
    expect(head.slice(0, 7)).toEqual(['delta', 'name', 'tables', 'spectra', 'localized', 'unlocalized', 'localized_pct'])
    for (const r of rows) expect(Number(r[4])).toBeGreaterThanOrEqual(50)
    expect(mock.summaryWrites[1].text).toBe(
      'source\tshift_rows\tshift_spectra\tunshifted_rows\tunshifted_spectra\tdelta_group\n' +
        `${L1}\t709\t2474\t10\t1783\t-\n` +
        `${L2}\t684\t2409\t11\t2456\t-\n` +
        `${L3}\t306\t816\t9\t1463\t-\n`
    )
    expect(screen.getByText(/; the 3 tables pooled \(rows within 0\.004 Da merged\) listed in \/out\/lens\.by_residue\.sources\.tsv\./)).toBeTruthy()
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
