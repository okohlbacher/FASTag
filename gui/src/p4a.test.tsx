// P4 PR a (GUI-DESIGN 3 S5, 10 P4): the Spectrum tab, opened from a row of
// the Tags table, with FASTag's processed peaks from -dump_spectrum (the
// real dumps of the E. coli fixture, src/fixtures/cli/v112-ecoli-dump) and
// the tag's ladder on them; hidden with a CLI that has no -dump_spectrum,
// whose row action then says "Spectrum view needs FASTag 1.17 or later".
// Against the mock bridge, the whole App.

// @ts-ignore -- node built-in; the app's tsconfig has no node types
import { readFileSync } from 'node:fs'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { goTo, renderApp } from './testing/render'
import { installMockBridge, type MockBridge } from './testing/mockBridge'
import { viewIds } from './testing/e2eBridge'
import { splitDumps } from './spectrum/dump'
import type { RunRecord } from './types'

const flush = (): Promise<void> => act(async () => {})
const click = (el: Element): Promise<void> =>
  act(async () => {
    fireEvent.click(el)
  })

const tsv = readFileSync('e2e-web/fixtures/ecoli.tags.tsv', 'utf8').split('\n').filter((l: string) => l !== '')
const COLUMNS = tsv[0].split('\t')
const ROWS = tsv.slice(1).map((l: string) => l.split('\t'))
const DUMPS: Record<string, string> = {}
for (const d of splitDumps(readFileSync('src/fixtures/cli/v112-ecoli-dump/dumps.ppm.jsonl', 'utf8'))) {
  DUMPS[(JSON.parse(d.split('\n')[0]) as { native_id: string }).native_id] = d
}
const TAGS = '/data/run01.tags.tsv'
const INPUT = '/data/run01.mzML'
// The tagged spectra in file order, as ◀ ▶ walk them.
const SPECTRA = [...new Set(ROWS.map((r: string[]) => r[0]))] as string[]

const record = (over: Partial<RunRecord> = {}): RunRecord => ({
  id: '1762419600000-1',
  input: INPUT,
  outputs: [TAGS],
  cwd: '/data',
  argv: ['/e2e/FASTag', '-in', INPUT, '-out', TAGS],
  status: 'ok',
  exitCode: 0,
  message: null,
  start: 1762419600000,
  end: 1762419690000,
  cleanup: { removed: [], renamed: [], failed: [] },
  params: { fragment_tolerance: '20' },
  ...over
})

/// The app on the E. coli tags, the views as browser.rs builds them.
function bridge(supported: boolean, history: RunRecord[] = [record()]): MockBridge {
  const mock = installMockBridge()
  mock.spectrumSupportResult = supported
    ? { supported: true, probed: true, detail: 'the CLI has -dump_spectrum' }
    : { supported: false, probed: true, detail: 'the CLI has no -dump_spectrum' }
  mock.spectrumDumps = DUMPS
  mock.history = history
  mock.nextPickResults = TAGS
  mock.resultsColumns = COLUMNS
  mock.resultsRows = ROWS
  mock.resultsQuery = (path, view, offset, limit) => {
    mock.resultsQueryCalls.push({ path, view, offset, limit })
    const all = viewIds(COLUMNS, ROWS, view)
    const sel = all.slice(offset, offset + limit)
    return Promise.resolve({ columns: COLUMNS, totalRows: ROWS.length, matchedRows: all.length, rows: sel.map((i) => ROWS[i]), rowIds: sel, ranked: true, pending: false })
  }
  mock.resultsPosition = (_p, view, row) => Promise.resolve(viewIds(COLUMNS, ROWS, view).indexOf(row))
  return mock
}

async function openTags(mock: MockBridge): Promise<void> {
  await renderApp(mock)
  await goTo('results')
  await click(screen.getByRole('button', { name: 'Open a tags TSV…' }))
  await screen.findByText(`Showing ${ROWS.length.toLocaleString('en-US')} of ${ROWS.length.toLocaleString('en-US')}`)
}

const table = (): HTMLElement => screen.getByRole('region', { name: 'Tags table' })
const firstRow = (): HTMLElement => document.querySelector<HTMLElement>('.rt-rows .rt-row')!
const tabNames = (): string[] => screen.getAllByRole('tab').map((t) => t.textContent ?? '')

describe('P4a: open a row in the Spectrum tab', () => {
  it('Enter on the active row opens its spectrum, dumped under the run\'s parameters, with the ladder on its peaks', async () => {
    const mock = bridge(true)
    await openTags(mock)
    expect(tabNames()).toContain('Spectrum')
    const row = firstRow()
    const spectrum = row.querySelector('[role=gridcell]')!.getAttribute('title')!
    await click(row)
    await act(async () => {
      fireEvent.keyDown(table(), { key: 'Enter' })
    })
    await flush()
    expect(screen.getByRole('tab', { name: 'Spectrum' }).getAttribute('aria-selected')).toBe('true')
    // The run record's input and parameters (History), not FASTag's defaults.
    await waitFor(() => expect(mock.spectrumCalls[0]).toEqual({ input: INPUT, nativeId: spectrum, params: { fragment_tolerance: '20' } }))
    const verdict = await screen.findByTestId('ladder-verdict')
    expect(verdict.textContent).toMatch(/^on \d+ of \d+ positions within the run's tolerance$/)
    expect(screen.getByRole('heading', { level: 2, name: spectrum })).toBeTruthy()
    expect(screen.getByText(/FASTag's processed peaks/)).toBeTruthy()
    // The tags of the spectrum, all of them, each with its ladder.
    const n = ROWS.filter((r: string[]) => r[0] === spectrum).length
    const tags = screen.getByRole('region', { name: 'Tags of this spectrum' })
    expect(within(tags).getByText(new RegExp(`Tags of this spectrum \\(n=${n}\\)`))).toBeTruthy()
    expect(within(tags).getAllByRole('row')).toHaveLength(n + 1)
    expect(within(tags).queryAllByText(/^not on the peaks/)).toHaveLength(0)
    // No caveat: the parameters are known.
    expect(screen.queryByText(/are not known, so the peaks are prepared with FASTag's defaults/)).toBeNull()
  })

  it('another tag of the spectrum redraws the ladder; next ▶ goes to the next tagged spectrum', async () => {
    const mock = bridge(true)
    await openTags(mock)
    await click(firstRow())
    await click(screen.getByRole('button', { name: 'Open in Spectrum' }))
    await screen.findByTestId('ladder-verdict')
    const shown = screen.getByRole('heading', { level: 2 }).textContent
    const tags = screen.getByRole('region', { name: 'Tags of this spectrum' })
    const rows = within(tags).getAllByRole('row').slice(1)
    const second = rows[1]
    const tag = second.querySelector('td')!.textContent!
    await click(second)
    expect(second.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('ladder').textContent).toContain(tag)
    const next = screen.getByRole('button', { name: 'Next tagged spectrum' })
    await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false))
    await click(next)
    await flush()
    const want = SPECTRA[SPECTRA.indexOf(shown!) + 1]
    await waitFor(() => expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(want))
    await screen.findByTestId('ladder-verdict')
    expect(mock.spectrumCalls.length).toBe(2)
  })

  it('a table no run of this app wrote: Locate input…, then the dump at FASTag\'s defaults, with the caveat', async () => {
    const mock = bridge(true, [])
    await openTags(mock)
    await click(firstRow())
    await click(screen.getByRole('button', { name: 'Open in Spectrum' }))
    await screen.findByText('Which spectra file did these tags come from?')
    expect(mock.spectrumCalls).toHaveLength(0)
    mock.nextPickInput = '/elsewhere/run01.mzML'
    await click(screen.getByRole('button', { name: 'Locate input…' }))
    await screen.findByTestId('ladder-verdict')
    expect(mock.spectrumCalls[0].input).toBe('/elsewhere/run01.mzML')
    expect(mock.spectrumCalls[0].params).toBeNull()
    expect(screen.getByText(/are not known, so the peaks are prepared with FASTag's defaults/)).toBeTruthy()
  })

  it('an input that moved or a spectrum it does not have: Locate input…', async () => {
    const mock = bridge(true)
    mock.spectrumMissing = [INPUT]
    await openTags(mock)
    await click(firstRow())
    await click(screen.getByRole('button', { name: 'Open in Spectrum' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Input not found\..*run01\.mzML is not there/)
    mock.spectrumDumps = {}
    mock.nextPickInput = '/data/other.mzML'
    await click(screen.getByRole('button', { name: 'Locate input…' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Spectrum not found\..*other\.mzML has no spectrum/))
    expect(screen.getByRole('button', { name: 'Locate input…' })).toBeTruthy()
  })
})

describe('P4a: a CLI without -dump_spectrum (FASTag 1.11)', () => {
  it('hides the Spectrum tab, and the row action says the view needs FASTag 1.17', async () => {
    const mock = bridge(false)
    await openTags(mock)
    expect(tabNames()).not.toContain('Spectrum')
    const action = screen.getByRole('button', { name: 'Spectrum view needs FASTag 1.17 or later' })
    expect((action as HTMLButtonElement).disabled).toBe(true)
    await click(firstRow())
    await act(async () => {
      fireEvent.keyDown(table(), { key: 'Enter' })
    })
    expect(screen.getByRole('tab', { name: 'Tags' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Spectrum view needs FASTag 1.17 or later.')).toBeTruthy()
    expect(mock.spectrumCalls).toHaveLength(0)
  })
})
