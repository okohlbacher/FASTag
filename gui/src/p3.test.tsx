// P3 (GUI-DESIGN 6.1 items 9 and 11): export as a job with progress and
// cancel, TSV or CSV by the chosen name, and the per-spectrum filter (best
// tag, best N), against the mock bridge. The backend side is browser.rs's
// cargo tests; api.ts's Channel wiring is in api.test.ts.

import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ResultsTable, { headServes } from './ResultsTable'
import { installMockBridge } from './testing/mockBridge'

const flush = (): Promise<void> => act(async () => {})
const clickIn = (el: Element): Promise<void> =>
  act(async () => {
    fireEvent.click(el)
  })

async function renderTable(): Promise<ReturnType<typeof installMockBridge>> {
  const mock = installMockBridge()
  render(<ResultsTable path="/d/x.tags.tsv" />)
  await flush()
  await screen.findByText('Showing 3 of 3')
  return mock
}

const lastView = (mock: ReturnType<typeof installMockBridge>) => mock.resultsQueryCalls[mock.resultsQueryCalls.length - 1].view

describe('export as a job', () => {
  it('shows its progress, and Cancel stops that job and says nothing was written', async () => {
    const mock = await renderTable()
    mock.holdExport = true
    mock.nextPickOutput = '/d/x.shown.tsv'
    await clickIn(screen.getByRole('button', { name: 'Export shown rows…' }))
    const id = mock.lastExportId
    expect(screen.getByRole('button', { name: 'Export shown rows…' })).toHaveProperty('disabled', true)
    await act(async () => mock.emitExport({ kind: 'progress', jobId: id, done: 1, total: 3 }))
    expect(screen.getByText(/Exporting… 33%/)).toBeDefined()
    await clickIn(screen.getByRole('button', { name: 'Cancel export' }))
    expect(mock.exportCancelCalls).toEqual([id])
    await act(async () => mock.emitExport({ kind: 'cancelled', jobId: id }))
    expect(screen.getByText('Export cancelled; nothing was written.')).toBeDefined()
    expect(screen.queryByText(/Exporting…/)).toBeNull()
    expect(screen.queryByText(/^Wrote /)).toBeNull()
    expect(screen.getByRole('button', { name: 'Export shown rows…' })).toHaveProperty('disabled', false)
  })

  it('reports a failed job with its reason', async () => {
    const mock = await renderTable()
    mock.holdExport = true
    mock.nextPickOutput = '/d/x.shown.tsv'
    await clickIn(screen.getByRole('button', { name: 'Export shown rows…' }))
    await act(async () => mock.emitExport({ kind: 'failed', jobId: mock.lastExportId, message: 'disk full' }))
    expect(screen.getByText('Export failed: disk full')).toBeDefined()
  })

  it('drops the events of an earlier job', async () => {
    const mock = await renderTable()
    mock.holdExport = true
    mock.nextPickOutput = '/d/a.tsv'
    await clickIn(screen.getByRole('button', { name: 'Export shown rows…' }))
    const first = mock.lastExportSend
    await act(async () => first({ kind: 'cancelled', jobId: mock.lastExportId }))
    mock.nextPickOutput = '/d/b.tsv'
    await clickIn(screen.getByRole('button', { name: 'Export shown rows…' }))
    // The first job's Channel speaks again: nobody listens any more.
    await act(async () => first({ kind: 'done', jobId: 1, rows: 99, dest: '/d/a.tsv' }))
    expect(screen.queryByText(/Wrote 99 rows/)).toBeNull()
    await act(async () => mock.emitExport({ kind: 'done', jobId: mock.lastExportId, rows: 3, dest: '/d/b.tsv' }))
    expect(screen.getByText('Wrote 3 rows to /d/b.tsv.')).toBeDefined()
  })

  it('writes CSV when the chosen name ends in .csv, and offers both formats', async () => {
    const mock = await renderTable()
    mock.nextPickOutput = '/d/x.shown.CSV'
    await clickIn(screen.getByRole('button', { name: 'Export shown rows…' }))
    expect(mock.pickFileCalls[mock.pickFileCalls.length - 1]).toEqual({ kind: 'save', formats: ['tsv', 'csv'] })
    expect(mock.exportFormats).toEqual(['csv'])
    mock.nextPickOutput = '/d/x.shown.tsv'
    await clickIn(screen.getByRole('button', { name: 'Export shown rows…' }))
    expect(mock.exportFormats).toEqual(['csv', 'tsv'])
    expect(screen.getByText('Wrote 3 rows to /d/x.shown.tsv.')).toBeDefined()
  })
})

describe('per-spectrum filter', () => {
  it('sends the best tag or the best N per spectrum, and All turns it off', async () => {
    const mock = await renderTable()
    const box = screen.getByRole('combobox', { name: 'Per spectrum' })
    await act(async () => {
      fireEvent.change(box, { target: { value: '1' } })
    })
    expect(lastView(mock).perSpectrum).toBe(1)
    await act(async () => {
      fireEvent.change(box, { target: { value: '3' } })
    })
    expect(lastView(mock).perSpectrum).toBe(3)
    await act(async () => {
      fireEvent.change(box, { target: { value: '' } })
    })
    expect(lastView(mock).perSpectrum).toBeNull()
    // Export takes the view as shown, the rule included.
    await act(async () => {
      fireEvent.change(box, { target: { value: '1' } })
    })
    mock.nextPickOutput = '/d/x.best.tsv'
    await clickIn(screen.getByRole('button', { name: 'Export shown rows…' }))
    expect(mock.exportCalls[0].view.perSpectrum).toBe(1)
  })

  it('is offered only with a spectrum and an E-value column', async () => {
    const mock = installMockBridge()
    mock.resultsColumns = ['spectrum', 'tag']
    mock.resultsRows = [['scan=1', 'AAA']]
    render(<ResultsTable path="/d/y.tags.tsv" />)
    await flush()
    await screen.findByText('Showing 1 of 1')
    expect(screen.queryByRole('combobox', { name: 'Per spectrum' })).toBeNull()
  })

  it('keeps the head rows from standing in for a per-spectrum view', () => {
    expect(headServes({ sort: { column: 'evalue', desc: false } })).toBe(true)
    expect(headServes({ sort: { column: 'evalue', desc: false }, perSpectrum: 1 })).toBe(false)
  })
})
