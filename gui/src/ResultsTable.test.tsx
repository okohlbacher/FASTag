// ResultsTable behavior against the mock bridge: header-driven columns, view
// building (sort cycling, name-bound filters), and the error pane.

import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ResultsTable from './ResultsTable'
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
    await screen.findByText('matched 3 of 3 rows')
    for (const c of mock.resultsColumns) expect(screen.getByRole('button', { name: c })).toBeDefined()
    expect(screen.getByText('AQRQAAN')).toBeDefined()
    expect(screen.getByText('LNDLAAK')).toBeDefined()
    expect(mock.resultsQueryCalls[0]).toMatchObject({ path: '/d/x.tags.tsv', offset: 0 })
  })

  it('header clicks cycle sort asc, desc, off', async () => {
    const mock = await renderTable()
    await screen.findByText('matched 3 of 3 rows')
    const header = (): HTMLElement => screen.getByRole('button', { name: /^evalue/ })
    await clickIn(header())
    expect(lastCall(mock)?.view.sort).toEqual({ column: 'evalue', desc: false })
    await clickIn(header())
    expect(lastCall(mock)?.view.sort).toEqual({ column: 'evalue', desc: true })
    await clickIn(header())
    expect(lastCall(mock)?.view.sort).toBeNull()
  })

  it('filters commit on Enter, not per keystroke', async () => {
    const mock = await renderTable()
    await screen.findByText('matched 3 of 3 rows')
    const before = mock.resultsQueryCalls.length
    const input = screen.getByPlaceholderText(/spectrum contains/)
    await act(async () => {
      fireEvent.change(input, { target: { value: 'frame=5' } })
    })
    expect(mock.resultsQueryCalls).toHaveLength(before) // draft only
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    expect(lastCall(mock)?.view.spectrum).toBe('frame=5')

    const evalue = screen.getByPlaceholderText('max evalue')
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
    await screen.findByText('matched 1 of 1 rows')
    expect(screen.queryByPlaceholderText(/spectrum contains/)).toBeNull()
    expect(screen.queryByPlaceholderText('min length')).toBeNull()
    expect(screen.queryByPlaceholderText('max evalue')).toBeNull()
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
})
