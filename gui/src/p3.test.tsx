// P3 (GUI-DESIGN 6.1 items 9 and 11): export as a job with progress and
// cancel, TSV or CSV by the chosen name, and the per-spectrum filter (best
// tag, best N), against the mock bridge. The backend side is browser.rs's
// cargo tests; api.ts's Channel wiring is in api.test.ts.

import type { JSX } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ResultsTable, { headServes } from './ResultsTable'
import { installMockBridge } from './testing/mockBridge'
import { createExportJobs, ExportJobsContext } from './results/exportJobs'

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

describe('export job state and accessibility', () => {
  it('announces only the start and the end; progress is a progress bar, Cancel is outside the live region', async () => {
    const mock = await renderTable()
    mock.holdExport = true
    mock.nextPickOutput = '/d/x.shown.tsv'
    const live = screen.getAllByRole('status')
    const said: string[] = []
    const note = (): void => {
      const t = live.map((s) => s.textContent ?? '').join('|')
      if (said[said.length - 1] !== t) said.push(t)
    }
    note()
    await clickIn(screen.getByRole('button', { name: 'Export shown rows…' }))
    note()
    const id = mock.lastExportId
    for (let k = 0; k <= 3; k++) {
      await act(async () => mock.emitExport({ kind: 'progress', jobId: id, done: k, total: 3 }))
      note()
    }
    const bar = screen.getByRole('progressbar', { name: 'Export progress' })
    expect(bar.getAttribute('aria-valuenow')).toBe('100')
    expect(bar.getAttribute('aria-valuetext')).toBe('100% (3 of 3 rows)')
    expect(bar.closest('[role="status"]')).toBeNull()
    const cancel = screen.getByRole('button', { name: 'Cancel export' })
    expect(cancel.closest('[role="status"], [aria-live]')).toBeNull()
    cancel.focus()
    await clickIn(cancel)
    await act(async () => mock.emitExport({ kind: 'cancelled', jobId: id }))
    note()
    // Before, the start, the end: two changes for the whole job.
    expect(said.length).toBe(3)
    expect(screen.getByText('Export cancelled; nothing was written.').getAttribute('role')).toBe('status')
    expect(said[1]).toContain('Exporting to /d/x.shown.tsv…')
    // Focus does not fall to the page when Cancel goes away.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Export shown rows…' }))
  })

  it('outlives the table: a table mounted again shows the running job, its Cancel and its outcome', async () => {
    const mock = installMockBridge()
    const jobs = createExportJobs()
    const table = (): JSX.Element => (
      <ExportJobsContext.Provider value={jobs}>
        <ResultsTable path="/d/x.tags.tsv" />
      </ExportJobsContext.Provider>
    )
    const first = render(table())
    await flush()
    await screen.findByText('Showing 3 of 3')
    mock.holdExport = true
    mock.nextPickOutput = '/d/x.shown.tsv'
    await clickIn(screen.getByRole('button', { name: 'Export shown rows…' }))
    const id = mock.lastExportId
    // A switch to another tab, or the file opened again: the table goes.
    first.unmount()
    await act(async () => mock.emitExport({ kind: 'progress', jobId: id, done: 2, total: 3 }))
    render(table())
    await flush()
    await screen.findByText('Showing 3 of 3')
    expect(screen.getByText(/Exporting… 66%/)).toBeDefined()
    // No second export of this file over the running one.
    expect(screen.getByRole('button', { name: 'Export shown rows…' })).toHaveProperty('disabled', true)
    expect(mock.exportCalls).toHaveLength(1)
    await clickIn(screen.getByRole('button', { name: 'Cancel export' }))
    expect(mock.exportCancelCalls).toEqual([id])
    await act(async () => mock.emitExport({ kind: 'done', jobId: id, rows: 3, dest: '/d/x.shown.tsv' }))
    expect(screen.getByText('Wrote 3 rows to /d/x.shown.tsv.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Export shown rows…' })).toHaveProperty('disabled', false)
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
