// P3 PR b (GUI-DESIGN 3 S4, 10 P3): the Tags table's keyboard active row
// (arrows, Home/End, PageUp/PageDown, a roving tabindex), copy row and copy
// USI, the spectrum filter's placeholder from the file's first spectrum ID,
// and the Stitch/ALPS export through export/denovo.ts, against the mock
// bridge. denovo.ts itself is pinned to the script's golden files in
// export/denovo.test.ts; the backend side is denovo.rs's cargo tests.

// @ts-ignore -- node built-in; the app's tsconfig has no node types
import { readFileSync } from 'node:fs'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ResultsTable, { spectrumHint } from './ResultsTable'
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
    expect(mock.tagsTextCalls).toEqual(['/d/x.tags.tsv'])
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
