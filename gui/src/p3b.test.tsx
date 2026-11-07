// P3 PR b (GUI-DESIGN 3 S4, 10 P3): the Tags table's keyboard active row
// (arrows, Home/End, PageUp/PageDown, a roving tabindex), copy row and copy
// USI, the spectrum filter's placeholder from the file's first spectrum ID,
// and the Stitch/ALPS export as a backend job (denovo.rs) with progress and
// Cancel, against the mock bridge (whose job converts with export/denovo.ts).
// denovo.ts and denovo.rs are each pinned to the script's golden files
// (export/denovo.test.ts, denovo.rs's cargo tests).

// @ts-ignore -- node built-in; the app's tsconfig has no node types
import { readFileSync } from 'node:fs'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ResultsTable, { spectrumHint } from './ResultsTable'
import { goTo, pickSingle, renderApp } from './testing/render'
import { installMockBridge, type MockBridge } from './testing/mockBridge'

const flush = (): Promise<void> => act(async () => {})
const click = (el: Element): Promise<void> =>
  act(async () => {
    fireEvent.click(el)
  })
const key = (el: Element, k: string, mods: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean } = {}): Promise<void> =>
  act(async () => {
    fireEvent.keyDown(el, { key: k, ...mods })
  })
const fixture = (name: string): string => readFileSync(`src/fixtures/denovo/${name}`, 'utf8')

const COLUMNS = ['spectrum', 'tag', 'length', 'charge', 'nterm_mass', 'cterm_mass', 'evalue', 'res_conf', 'usi']
const N = 60
const ROWS: string[][] = Array.from({ length: N }, (_, i) => [
  `frame=${100 + i} scan=${i}`,
  `TAG${i}`,
  '4',
  '2',
  '0',
  '0',
  String(i / 100),
  '1 2 3 4',
  `mzspec:USI000000:run:scan:${i}`
])

/// A table of N rows whose pages carry their file rows (as browser.rs does).
async function renderTable(opts: { columns?: string[]; rows?: string[][] } = {}): Promise<MockBridge> {
  const mock = installMockBridge()
  mock.resultsColumns = opts.columns ?? COLUMNS
  mock.resultsRows = opts.rows ?? ROWS
  mock.resultsQuery = (path, view, offset, limit) => {
    mock.resultsQueryCalls.push({ path, view, offset, limit })
    const rows = mock.resultsRows.slice(offset, offset + limit)
    return Promise.resolve({
      columns: mock.resultsColumns,
      totalRows: mock.resultsRows.length,
      matchedRows: mock.resultsRows.length,
      rows,
      rowIds: rows.map((_, i) => offset + i),
      ranked: true,
      pending: false
    })
  }
  render(<ResultsTable path="/d/x.tags.tsv" />)
  await flush()
  const n = mock.resultsRows.length
  await screen.findByText(`Showing ${n} of ${n}`)
  return mock
}

const table = (): HTMLElement => screen.getByRole('region', { name: 'Tags table' })
const activeRow = (): HTMLElement | null => document.querySelector('.rt-rows .rt-row[aria-selected="true"]')
const activeIndex = (): number | null => {
  const r = activeRow()
  return r ? Number(r.getAttribute('aria-rowindex')) - 2 : null
}

let writeText: ReturnType<typeof vi.fn>
function stubClipboard(fail = false): void {
  writeText = fail ? vi.fn().mockRejectedValue(new Error('denied')) : vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
}
afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
})

describe('keyboard active row', () => {
  it('ArrowDown from the table makes the first row active and focuses it; arrows move by one row', async () => {
    await renderTable()
    expect(activeRow()).toBeNull()
    await key(table(), 'ArrowDown')
    expect(activeIndex()).toBe(0)
    await waitFor(() => expect(document.activeElement).toBe(activeRow()))
    await key(activeRow()!, 'ArrowDown')
    await key(activeRow()!, 'ArrowDown')
    expect(activeIndex()).toBe(2)
    await key(activeRow()!, 'ArrowUp')
    expect(activeIndex()).toBe(1)
    expect(activeRow()!.textContent).toContain('TAG1')
  })

  it('stops at the first and the last row', async () => {
    await renderTable()
    await key(table(), 'ArrowUp')
    expect(activeIndex()).toBe(0)
    await key(activeRow()!, 'ArrowUp')
    expect(activeIndex()).toBe(0)
    await key(activeRow()!, 'End')
    expect(activeIndex()).toBe(N - 1)
    await key(activeRow()!, 'ArrowDown')
    expect(activeIndex()).toBe(N - 1)
  })

  it('Home and End go to the first and the last row, and scroll it into view', async () => {
    await renderTable()
    await key(table(), 'End')
    expect(activeIndex()).toBe(N - 1)
    expect(activeRow()!.textContent).toContain(`TAG${N - 1}`)
    await waitFor(() => expect(document.activeElement).toBe(activeRow()))
    expect(table().scrollTop).toBeGreaterThan(0)
    await key(activeRow()!, 'Home')
    expect(activeIndex()).toBe(0)
    expect(table().scrollTop).toBe(0)
  })

  it('PageDown and PageUp move by a page of rows less one', async () => {
    await renderTable()
    await key(table(), 'Home')
    await key(activeRow()!, 'PageDown')
    const page = activeIndex()!
    expect(page).toBeGreaterThan(1)
    await key(activeRow()!, 'PageDown')
    expect(activeIndex()).toBe(Math.min(N - 1, 2 * page))
    await key(activeRow()!, 'PageUp')
    expect(activeIndex()).toBe(page)
  })

  it('is a roving tabindex: the active row is the one tab stop of the rows', async () => {
    await renderTable()
    expect(table().tabIndex).toBe(0)
    await key(table(), 'ArrowDown')
    await key(activeRow()!, 'ArrowDown')
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.rt-rows .rt-row'))
    expect(rows.filter((r) => r.tabIndex === 0)).toEqual([activeRow()])
    expect(table().tabIndex).toBe(-1)
  })

  it('is a read-only grid of focusable rows, the active one aria-selected (screen readers pass the keys on)', async () => {
    await renderTable()
    expect(screen.queryByRole('table')).toBeNull()
    const grid = screen.getByRole('grid', { name: 'Tags in x.tags.tsv' })
    expect(grid.getAttribute('aria-readonly')).toBe('true')
    expect(grid.getAttribute('aria-rowcount')).toBe(String(N + 1))
    await key(table(), 'ArrowDown')
    await key(activeRow()!, 'ArrowDown')
    const rows = screen.getAllByRole('row')
    // The header row, then the data rows: each in the grid, each with its
    // gridcells; exactly the active one selected.
    expect(rows[0].getAttribute('aria-rowindex')).toBe('1')
    const data = rows.slice(1)
    for (const r of data) {
      expect(grid.contains(r)).toBe(true)
      expect(r.querySelectorAll('[role="gridcell"]').length).toBeGreaterThan(0)
    }
    expect(data.filter((r) => r.getAttribute('aria-selected') === 'true')).toEqual([activeRow()])
    expect(activeRow()!.getAttribute('aria-rowindex')).toBe('3')
    expect(document.activeElement).toBe(activeRow())
    expect(screen.queryByRole('cell')).toBeNull()
  })

  it('says where the active row is while its page is on the way, with focus on the table', async () => {
    const BIG = 3000
    const rows: string[][] = Array.from({ length: BIG }, (_, i) => [`scan=${i}`, `TAG${i}`, '4', '2', '0', '0', '0.1', '1 2 3 4', '-'])
    const mock = installMockBridge()
    mock.resultsColumns = COLUMNS
    mock.resultsRows = rows
    // Only the first page ever arrives.
    mock.resultsQuery = (path, view, offset, limit) => {
      mock.resultsQueryCalls.push({ path, view, offset, limit })
      if (offset > 0) return new Promise(() => {})
      const page = rows.slice(0, limit)
      return Promise.resolve({ columns: COLUMNS, totalRows: BIG, matchedRows: BIG, rows: page, rowIds: page.map((_, i) => i), ranked: true, pending: false })
    }
    render(<ResultsTable path="/d/x.tags.tsv" />)
    await flush()
    await screen.findByText(`Showing 3,000 of 3,000`)
    const pos = screen.getByTestId('rt-pos')
    expect(pos.getAttribute('role')).toBe('status')
    expect(pos.textContent).toBe('')
    await key(table(), 'ArrowDown')
    await key(activeRow()!, 'End')
    await waitFor(() => expect(document.activeElement).toBe(table()))
    expect(activeRow()).toBeNull()
    expect(pos.textContent).toBe('Row 3,000 of 3,000, loading…')
    await key(table(), 'Home')
    expect(activeIndex()).toBe(0)
    expect(pos.textContent).toBe('')
  })

  it('a click makes a row active, and the arrows go on from it', async () => {
    await renderTable()
    const rows = Array.from(document.querySelectorAll('.rt-rows .rt-row'))
    await click(rows[4])
    expect(activeIndex()).toBe(4)
    await key(activeRow()!, 'ArrowDown')
    expect(activeIndex()).toBe(5)
  })

  it('leaves keys alone in a filter field', async () => {
    await renderTable()
    const box = screen.getByLabelText('Spectrum contains')
    await key(box, 'ArrowDown')
    await key(box, 'End')
    expect(activeRow()).toBeNull()
  })
})

describe('copy row and copy USI', () => {
  it('⌘C copies the active row as the shown cells, tab-separated, and says so', async () => {
    stubClipboard()
    await renderTable()
    await key(table(), 'ArrowDown')
    await key(activeRow()!, 'ArrowDown')
    await key(activeRow()!, 'c', { metaKey: true })
    expect(writeText).toHaveBeenCalledWith(ROWS[1].join('\t'))
    expect(await screen.findByText('Copied the row.')).toBeDefined()
  })

  it('Ctrl+C does the same, and hidden columns are not copied', async () => {
    stubClipboard()
    await renderTable()
    await click(screen.getByRole('button', { name: 'Columns…' }))
    await click(screen.getByRole('checkbox', { name: 'Charge' }))
    await key(table(), 'ArrowDown')
    await key(activeRow()!, 'c', { ctrlKey: true })
    const j = COLUMNS.indexOf('charge')
    expect(writeText).toHaveBeenCalledWith(ROWS[0].filter((_, k) => k !== j).join('\t'))
  })

  it('⇧⌘C copies the USI of the active row', async () => {
    stubClipboard()
    await renderTable()
    await key(table(), 'End')
    await key(activeRow()!, 'C', { metaKey: true, shiftKey: true })
    expect(writeText).toHaveBeenCalledWith(`mzspec:USI000000:run:scan:${N - 1}`)
    expect(await screen.findByText('Copied the USI.')).toBeDefined()
  })

  it('the Copy row and Copy USI buttons copy the active row, and wait for one', async () => {
    stubClipboard()
    await renderTable()
    const row = screen.getByRole('button', { name: 'Copy row' })
    const usi = screen.getByRole('button', { name: 'Copy USI' })
    expect(row).toHaveProperty('disabled', true)
    expect(usi).toHaveProperty('disabled', true)
    await click(document.querySelectorAll('.rt-rows .rt-row')[3])
    await click(screen.getByRole('button', { name: 'Copy USI' }))
    expect(writeText).toHaveBeenLastCalledWith('mzspec:USI000000:run:scan:3')
    await click(screen.getByRole('button', { name: 'Copy row' }))
    expect(writeText).toHaveBeenLastCalledWith(ROWS[3].join('\t'))
  })

  it('without a usi column Copy USI says how to get one, and copies nothing', async () => {
    stubClipboard()
    const cols = COLUMNS.slice(0, -1)
    await renderTable({ columns: cols, rows: ROWS.map((r) => r.slice(0, -1)) })
    expect(screen.getByRole('button', { name: 'Copy USI' }).getAttribute('title')).toMatch(/-usi_collection/)
    await key(table(), 'ArrowDown')
    await key(activeRow()!, 'C', { metaKey: true, shiftKey: true })
    expect(writeText).not.toHaveBeenCalled()
    expect(await screen.findByText(/no usi column.*-usi_collection/)).toBeDefined()
  })

  it('a refused clipboard is said, not swallowed', async () => {
    stubClipboard(true)
    await renderTable()
    await key(table(), 'ArrowDown')
    await key(activeRow()!, 'c', { metaKey: true })
    expect(await screen.findByText('The clipboard refused the row.')).toBeDefined()
  })

  it('leaves ⌘C to a text selection', async () => {
    stubClipboard()
    await renderTable()
    await key(table(), 'ArrowDown')
    const sel = vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'TAG0', isCollapsed: false } as unknown as Selection)
    await key(activeRow()!, 'c', { metaKey: true })
    sel.mockRestore()
    expect(writeText).not.toHaveBeenCalled()
  })
})

describe('spectrum filter placeholder', () => {
  it('is built from the first spectrum ID of the file', async () => {
    await renderTable()
    expect(screen.getByLabelText('Spectrum contains').getAttribute('placeholder')).toBe('frame=100')
  })

  it('takes the scan, frame or index part of an ID, else its last key=value, else the ID itself', () => {
    expect(spectrumHint('controllerType=0 controllerNumber=1 scan=11461')).toBe('scan=11461')
    expect(spectrumHint('frame=5 scan=3')).toBe('frame=5')
    expect(spectrumHint('index=17')).toBe('index=17')
    expect(spectrumHint('sample=1 period=1 cycle=12 experiment=3')).toBe('experiment=3')
    expect(spectrumHint('run01.1234.1234.2')).toBe('run01.1234.1234.2')
    expect(spectrumHint('a-very-long-mgf-title-that-goes-on-and-on.1234.1234.2')).toBe('a-very-long-mgf-title-that-goe')
    expect(spectrumHint(undefined)).toBe('')
    expect(spectrumHint('')).toBe('')
  })
})

describe('Stitch and ALPS export', () => {
  const EDGE_COLUMNS = ['usi', 'spectrum', 'tag', 'length', 'charge', 'nterm_mass', 'cterm_mass', 'evalue', 'res_conf', 'extra']

  async function renderReads(): Promise<MockBridge> {
    const mock = await renderTable({ columns: EDGE_COLUMNS, rows: [['-', 'scan=1', 'KKKK', '4', '2', '0', '0', '0.1', '1 2 3 4', 'x']] })
    mock.tagsFiles['/d/x.tags.tsv'] = fixture('edge.tags.tsv')
    return mock
  }
  const format = (): HTMLSelectElement => screen.getByRole('combobox', { name: 'Export as' }) as HTMLSelectElement
  const choose = (v: string): Promise<void> =>
    act(async () => {
      fireEvent.change(format(), { target: { value: v } })
    })

  it('writes the reads the script writes, Stitch with its defaults (best read, at least 8 residues)', async () => {
    const mock = await renderReads()
    await choose('stitch')
    expect((screen.getByLabelText('Min. read length') as HTMLInputElement).value).toBe('8')
    expect((screen.getByLabelText('Reads per spectrum') as HTMLInputElement).value).toBe('1')
    mock.nextPickOutput = '/d/x.stitch.csv'
    await click(screen.getByRole('button', { name: 'Export reads…' }))
    expect(mock.pickFileCalls[mock.pickFileCalls.length - 1]).toEqual({ kind: 'save', formats: ['csv'] })
    // A backend job: the renderer never reads the file.
    expect(mock.readsCalls).toEqual([{ path: '/d/x.tags.tsv', dest: '/d/x.stitch.csv', format: 'stitch', topN: 1, minLength: 8 }])
    expect(mock.readsWrites).toEqual([{ source: '/d/x.tags.tsv', dest: '/d/x.stitch.csv', text: fixture('edge.stitch.csv') }])
    expect(await screen.findByText(/^Wrote 4 Stitch reads to \/d\/x\.stitch\.csv\. 7 malformed rows skipped\.$/)).toBeDefined()
    // The table export is untouched by it.
    expect(mock.exportCalls).toHaveLength(0)
  })

  it('ALPS with other options, as --top-n 2 --min-length 1', async () => {
    const mock = await renderReads()
    await choose('alps')
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Min. read length'), { target: { value: '1' } })
      fireEvent.change(screen.getByLabelText('Reads per spectrum'), { target: { value: '2' } })
    })
    mock.nextPickOutput = '/d/x.alps.csv'
    await click(screen.getByRole('button', { name: 'Export reads…' }))
    expect(mock.readsWrites[0].text).toBe(fixture('edge.alps.top2.csv'))
    expect(await screen.findByText(/^Wrote 10 ALPS reads/)).toBeDefined()
  })

  it('says the table filters do not apply', async () => {
    await renderReads()
    await choose('stitch')
    expect(screen.getByText(/whole file.*filters do not apply/)).toBeDefined()
  })

  it('refuses invalid options before asking for a file', async () => {
    const mock = await renderReads()
    await choose('stitch')
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Reads per spectrum'), { target: { value: '0' } })
    })
    expect(screen.getByRole('button', { name: 'Export reads…' })).toHaveProperty('disabled', true)
    expect(screen.getByText('at least 1')).toBeDefined()
    expect(mock.pickFileCalls).toHaveLength(0)
  })

  it('is not offered without the res_conf column, and says why', async () => {
    await renderTable({ columns: COLUMNS.filter((c) => c !== 'res_conf'), rows: ROWS.map((r) => r.filter((_, k) => k !== 7)) })
    const opts = Array.from(format().options)
    expect(opts.find((o) => o.value === 'stitch')!.disabled).toBe(true)
    expect(opts.find((o) => o.value === 'alps')!.disabled).toBe(true)
    expect(format().getAttribute('title')).toMatch(/-res_conf/)
  })

  it('reports a file the script refuses, and writes nothing', async () => {
    const mock = await renderReads()
    mock.tagsFiles['/d/x.tags.tsv'] = 'spectrum\ttag\n'
    await choose('alps')
    mock.nextPickOutput = '/d/x.alps.csv'
    await click(screen.getByRole('button', { name: 'Export reads…' }))
    expect(await screen.findByText(/^Export failed: the tags file lacks column\(s\)/)).toBeDefined()
    expect(mock.readsWrites).toHaveLength(0)
  })

  it('reports a write the backend refuses', async () => {
    const mock = await renderReads()
    mock.readsWriteError = 'cannot write /d/x.alps.csv: disk full'
    await choose('alps')
    mock.nextPickOutput = '/d/x.alps.csv'
    await click(screen.getByRole('button', { name: 'Export reads…' }))
    expect(await screen.findByText('Export failed: cannot write /d/x.alps.csv: disk full')).toBeDefined()
  })

  it('runs as a job with progress in MB read, its tag count said up front, and Cancel', async () => {
    const mock = await renderReads()
    mock.holdExport = true
    await choose('alps')
    mock.nextPickOutput = '/d/x.alps.csv'
    await click(screen.getByRole('button', { name: 'Export reads…' }))
    expect(screen.getByText('Writing ALPS reads from 1 tag to /d/x.alps.csv…')).toBeDefined()
    await act(async () => mock.emitExport({ kind: 'progress', jobId: mock.lastExportId, done: 250_000_000, total: 1_000_000_000 }))
    const bar = screen.getByRole('progressbar', { name: 'Export progress' })
    expect(bar.getAttribute('aria-valuenow')).toBe('25')
    expect(bar.getAttribute('aria-valuetext')).toBe('25% (250 of 1,000 MB read)')
    expect(bar.textContent).toMatch(/^Writing ALPS reads… 25%/)
    // One job per file: neither export starts while it runs.
    expect(screen.getByRole('button', { name: 'Export reads…' })).toHaveProperty('disabled', true)
    await click(screen.getByRole('button', { name: 'Cancel export' }))
    expect(mock.exportCancelCalls).toEqual([mock.lastExportId])
    await act(async () => mock.emitExport({ kind: 'cancelled', jobId: mock.lastExportId }))
    expect(screen.getByText('Export cancelled; nothing was written.')).toBeDefined()
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(mock.readsWrites).toHaveLength(0)
  })

  it('a cancelled or superseded reads job posts no progress and no result', async () => {
    const mock = await renderReads()
    mock.holdExport = true
    await choose('stitch')
    mock.nextPickOutput = '/d/x.stitch.csv'
    await click(screen.getByRole('button', { name: 'Export reads…' }))
    const first = mock.lastExportId
    const sendFirst = mock.lastExportSend
    await click(screen.getByRole('button', { name: 'Cancel export' }))
    await act(async () => sendFirst({ kind: 'cancelled', jobId: first }))
    // A second job; the first one's late events change nothing.
    mock.nextPickOutput = '/d/y.stitch.csv'
    await click(screen.getByRole('button', { name: 'Export reads…' }))
    expect(mock.lastExportId).toBeGreaterThan(first)
    await act(async () => {
      sendFirst({ kind: 'progress', jobId: first, done: 9, total: 10 })
      sendFirst({ kind: 'readsDone', jobId: first, reads: 4, rowsRead: 25, short: 4, malformed: 7, unknownMods: [], dest: '/d/x.stitch.csv' })
    })
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0')
    expect(screen.getByText('Writing Stitch reads from 1 tag to /d/y.stitch.csv…')).toBeDefined()
    await act(async () => mock.finishReads())
    expect(screen.getByText(/^Wrote 4 Stitch reads to \/d\/y\.stitch\.csv\./)).toBeDefined()
    expect(mock.readsWrites.map((w) => w.dest)).toEqual(['/d/y.stitch.csv'])
  })

  it('offers a re-run with -res_conf for a file without it, when the table has one to give', async () => {
    const cols = COLUMNS.filter((c) => c !== 'res_conf')
    const rows = ROWS.map((r) => r.filter((_, k) => k !== 7))
    const mock = installMockBridge()
    mock.resultsColumns = cols
    mock.resultsRows = rows
    const run = vi.fn()
    const { rerender } = render(<ResultsTable path="/d/x.tags.tsv" rerunResConf={{ run, disabled: false }} />)
    await flush()
    await click(screen.getByRole('button', { name: 'Re-run with per-residue confidence' }))
    expect(run).toHaveBeenCalledTimes(1)
    rerender(<ResultsTable path="/d/x.tags.tsv" rerunResConf={{ run, disabled: true }} />)
    expect(screen.getByRole('button', { name: 'Re-run with per-residue confidence' })).toHaveProperty('disabled', true)
    // Not without a run to repeat, and not for a file that has res_conf.
    rerender(<ResultsTable path="/d/x.tags.tsv" rerunResConf={null} />)
    expect(screen.queryByRole('button', { name: 'Re-run with per-residue confidence' })).toBeNull()
  })

  it('has no re-run for a file with res_conf', async () => {
    await renderTable()
    expect(screen.queryByRole('button', { name: 'Re-run with per-residue confidence' })).toBeNull()
  })

  it('Cmd+E exports reads when reads are chosen', async () => {
    const mock = await renderReads()
    await choose('stitch')
    mock.nextPickOutput = '/d/x.stitch.csv'
    await act(async () => {
      window.dispatchEvent(new CustomEvent('fastag-action', { detail: 'export' }))
    })
    await waitFor(() => expect(mock.readsWrites).toHaveLength(1))
    expect(mock.exportCalls).toHaveLength(0)
  })
})

describe('Re-run with per-residue confidence (S8)', () => {
  it('runs the same input again with -res_conf on, from the Tags table of its output', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    await click(screen.getByRole('button', { name: /^Run on a\.mzML$/ }))
    await waitFor(() => expect(mock.runCalls).toHaveLength(1))
    expect((mock.runCalls[0].params as Record<string, unknown>).res_conf).not.toBe(true)
    await act(async () => mock.emitDone({ ok: true, code: 0, runId: mock.lastRunId }))
    await goTo('results')
    await click(screen.getByRole('tab', { name: 'Tags' }))
    await flush()
    const rerun = await screen.findByRole('button', { name: 'Re-run with per-residue confidence' })
    await click(rerun)
    await waitFor(() => expect(mock.runCalls).toHaveLength(2))
    expect(mock.runCalls[1].in).toBe('/d/a.mzML')
    expect(mock.runCalls[1].params).toMatchObject({ res_conf: true })
    await act(async () => mock.emitDone({ ok: true, code: 0, runId: mock.lastRunId }))
  })
})
