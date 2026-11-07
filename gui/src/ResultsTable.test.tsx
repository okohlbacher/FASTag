// ResultsTable behavior against the mock bridge: header-driven columns, view
// building (sort cycling, name-bound filters), and the error pane.

import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ResultsTable, { autoWidths, columnLabel } from './ResultsTable'
import { installMockBridge } from './testing/mockBridge'

const flush = (): Promise<void> => act(async () => {})

async function renderTable(path = '/d/x.tags.tsv'): Promise<ReturnType<typeof installMockBridge>> {
  const mock = installMockBridge()
  render(<ResultsTable path={path} />)
  await flush()
  return mock
}

const lastCall = (mock: ReturnType<typeof installMockBridge>) =>
  mock.resultsQueryCalls[mock.resultsQueryCalls.length - 1]

const clickIn = (el: Element): Promise<void> =>
  act(async () => {
    fireEvent.click(el)
  })

describe('ResultsTable', () => {
  it('renders header-driven columns, rows and the status line', async () => {
    const mock = await renderTable()
    await screen.findByText('Showing 3 of 3')
    // Headers in words, not the TSV names.
    for (const c of mock.resultsColumns) expect(screen.getByRole('button', { name: columnLabel(c) })).toBeDefined()
    expect(screen.getAllByRole('columnheader').map((h) => h.getAttribute('aria-label'))).toEqual([
      'Spectrum',
      'Tag',
      'Length',
      'E-value',
      'Database hit'
    ])
    expect(screen.getByText('AQRQAAN')).toBeDefined()
    expect(screen.getByText('LNDLAAK')).toBeDefined()
    expect(mock.resultsQueryCalls[0]).toMatchObject({ path: '/d/x.tags.tsv', offset: 0 })
  })

  it('opens sorted by E-value ascending; header clicks cycle sort desc, off, asc', async () => {
    const mock = await renderTable()
    await screen.findByText('Showing 3 of 3')
    expect(mock.resultsQueryCalls[0].view.sort).toEqual({ column: 'evalue', desc: false })
    expect(screen.getAllByRole('columnheader').find((h) => h.getAttribute('aria-label') === 'E-value')?.getAttribute('aria-sort')).toBe(
      'ascending'
    )
    const header = (): HTMLElement => screen.getByRole('button', { name: /^E-value/ })
    await clickIn(header())
    expect(lastCall(mock)?.view.sort).toEqual({ column: 'evalue', desc: true })
    await clickIn(header())
    expect(lastCall(mock)?.view.sort).toBeNull()
    await clickIn(header())
    expect(lastCall(mock)?.view.sort).toEqual({ column: 'evalue', desc: false })
  })

  it('fits the default tags columns in about 840 px, and words the hits as the filter does', async () => {
    // The columns and the longest values of a 1280x820 window.
    const cols = ['spectrum', 'tag', 'length', 'nterm_mass', 'cterm_mass', 'evalue', 'fasta_hit']
    const w = autoWidths(cols, [['controllerType=0 controllerNumber=1 scan=11482', 'ADGWAQ', '6', '1234.5678', '1234.5678', '4.17e-08', 'efwd']])
    expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(838)
    const mock = installMockBridge()
    mock.resultsColumns = ['spectrum', 'fasta_hit']
    mock.resultsRows = [['a', 'fwd'], ['b', 'erev'], ['c', '-']]
    render(<ResultsTable path="/d/y.tags.tsv" />)
    await flush()
    expect(screen.getByRole('gridcell', { name: 'fwd' }).textContent).toBe('In database')
    expect(screen.getByRole('gridcell', { name: 'erev' }).textContent).toBe('Entrapment')
    expect(screen.getByRole('gridcell', { name: '-' }).textContent).toBe('No match')
  })

  it('filters commit on Enter, not per keystroke', async () => {
    const mock = await renderTable()
    await screen.findByText('Showing 3 of 3')
    const before = mock.resultsQueryCalls.length
    const input = screen.getByLabelText('Spectrum contains')
    await act(async () => {
      fireEvent.change(input, { target: { value: 'frame=5' } })
    })
    expect(mock.resultsQueryCalls).toHaveLength(before) // draft only
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    expect(lastCall(mock)?.view.spectrum).toBe('frame=5')

    const evalue = screen.getByLabelText('Max. E-value')
    await act(async () => {
      fireEvent.change(evalue, { target: { value: '1e-3' } })
      fireEvent.blur(evalue)
    })
    expect(lastCall(mock)?.view.maxEvalue).toBe(0.001)
  })

  it('renders only the filter controls whose columns exist', async () => {
    const mock = installMockBridge()
    mock.resultsColumns = ['a', 'b']
    mock.resultsRows = [['1', '2']]
    render(<ResultsTable path="/d/x.tsv" />)
    await flush()
    await screen.findByText('Showing 1 of 1')
    expect(screen.queryByLabelText('Spectrum contains')).toBeNull()
    expect(screen.queryByLabelText('Min. length')).toBeNull()
    expect(screen.queryByLabelText('Max. E-value')).toBeNull()
    expect(screen.queryByTitle('fasta_hit filter')).toBeNull()
  })

  it('shows the backend error instead of a table', async () => {
    const mock = installMockBridge()
    mock.resultsError = new Error('cannot open /gone.tsv: No such file')
    render(<ResultsTable path="/gone.tsv" />)
    await flush()
    await screen.findByText(/Cannot read results: cannot open/)
    expect(mock.resultsQueryCalls).toHaveLength(1)
  })

  it('filters fasta_hit with a segmented control, and draws a small E-value as a × 10^n', async () => {
    const mock = installMockBridge()
    mock.resultsColumns = ['spectrum', 'tag', 'evalue', 'fasta_hit']
    mock.resultsRows = [['scan=1', 'PEPTIDE', '4.17011e-08', 'efwd']]
    render(<ResultsTable path="/d/x.tags.tsv" />)
    await flush()
    const cell = screen.getByRole('gridcell', { name: '4.17011e-08' })
    expect(cell.textContent).toBe('4.2 × 10−8')
    expect(cell.className).toContain(' n') // numeric: right-aligned
    const ent = screen.getByRole('button', { name: 'Entrapment' })
    await clickIn(ent)
    expect(ent.getAttribute('aria-pressed')).toBe('true')
    expect(lastCall(mock).view.fastaHit).toBe('entrapment')
    await clickIn(screen.getByRole('button', { name: 'All' }))
    expect(lastCall(mock).view.fastaHit).toBeNull()
  })

  it('Columns… hides a column, and Export shown rows… writes the view in the shown columns', async () => {
    const mock = await renderTable()
    await screen.findByText('Showing 3 of 3')
    await clickIn(screen.getByRole('button', { name: 'Columns…' }))
    await clickIn(screen.getByRole('checkbox', { name: 'Length' }))
    expect(screen.queryByRole('button', { name: 'Length' })).toBeNull()
    await clickIn(screen.getByRole('button', { name: 'In database' }))
    mock.nextPickOutput = '/d/x.shown.tsv'
    await clickIn(screen.getByRole('button', { name: 'Export shown rows…' }))
    expect(mock.exportCalls).toEqual([
      { path: '/d/x.tags.tsv', view: lastCall(mock).view, columns: ['spectrum', 'tag', 'evalue', 'fasta_hit'], dest: '/d/x.shown.tsv' }
    ])
    expect(mock.exportCalls[0].view.fastaHit).toBe('only')
    expect(screen.getByText('Wrote 3 rows to /d/x.shown.tsv.')).toBeDefined()
  })
})
