// P4 PR a (GUI-DESIGN 3 S5, 10 P4): the Spectrum tab, opened from a row of
// the Tags table, with FASTag's processed peaks from -dump_spectrum (the
// real dumps of the E. coli fixture, src/fixtures/cli/v112-ecoli-dump) and
// the tag's ladder on them; hidden with a CLI that has no -dump_spectrum,
// whose row action then says "Spectrum view needs FASTag 1.12 or later".
// Against the mock bridge, the whole App.

// @ts-ignore -- node built-in; the app's tsconfig has no node types
import { readFileSync } from 'node:fs'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState, type JSX } from 'react'
import { describe, expect, it } from 'vitest'
import { goTo, renderApp } from './testing/render'
import { installMockBridge, type MockBridge } from './testing/mockBridge'
import { MAX_WINDOW, viewIds } from './testing/e2eBridge'
import { splitDumps } from './spectrum/dump'
import SpectrumPanel, { RANK_WAIT, type SpectrumTarget } from './spectrum/SpectrumPanel'
import { spectrumHint } from './ResultsTable'
import type { ResultsView, RunRecord } from './types'

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

// A view spec as browser.rs compares them (ViewSpec: a null field is a missing one).
const specKey = (v: ResultsView): string =>
  JSON.stringify(
    Object.entries(v)
      .filter(([, x]) => x != null && x !== false)
      .sort(([a], [b]) => (a < b ? -1 : 1))
  )

/// The app on the E. coli tags, the views as browser.rs builds them. As
/// browser.rs position(), resultsPosition never builds a view: it answers
/// for the file order, the E-value order without filters, and a view built
/// (queried) before; else null. @p pending: queries of a view other than
/// those two answer pending (the E-value order is not ready, D5) that many
/// times, and are not cached meanwhile; @p waits: which views wait so (by
/// default each but those two).
function bridge(supported: boolean, history: RunRecord[] = [record()], rows: string[][] = ROWS, pending = 0, waits?: (v: ResultsView) => boolean): MockBridge {
  const mock = installMockBridge()
  mock.spectrumSupportResult = supported
    ? { supported: true, probed: true, detail: 'the CLI has -dump_spectrum' }
    : { supported: false, probed: true, detail: 'the CLI has no -dump_spectrum' }
  mock.spectrumDumps = DUMPS
  mock.history = history
  mock.nextPickResults = TAGS
  mock.resultsColumns = COLUMNS
  mock.resultsRows = rows
  const built = new Set<string>()
  const plain = (v: ResultsView): boolean => {
    const k = specKey(v)
    return k === '[]' || k === specKey({ sort: { column: 'evalue', desc: false } }) || k === specKey({ sort: { column: 'evalue', desc: true } })
  }
  let left = pending
  mock.resultsQuery = (path, view, offset, limit) => {
    mock.resultsQueryCalls.push({ path, view, offset, limit })
    const all = viewIds(COLUMNS, rows, view)
    const waiting = (waits ? waits(view) : !plain(view)) && left > 0 && left-- > 0
    if (!waiting) built.add(specKey(view))
    // A page holds at most MAX_WINDOW rows, as browser.rs's.
    const sel = all.slice(offset, offset + Math.min(limit, MAX_WINDOW))
    return Promise.resolve({ columns: COLUMNS, totalRows: rows.length, matchedRows: all.length, rows: sel.map((i) => rows[i]), rowIds: sel, ranked: !waiting, pending: waiting })
  }
  mock.resultsPosition = (_p, view, row) => {
    if (!plain(view) && !built.has(specKey(view))) return Promise.resolve(null)
    const at = viewIds(COLUMNS, rows, view).indexOf(row)
    return Promise.resolve(at < 0 ? null : at)
  }
  return mock
}

async function openTags(mock: MockBridge, n: number = ROWS.length): Promise<void> {
  await renderApp(mock)
  await goTo('results')
  await click(screen.getByRole('button', { name: 'Open tags…' }))
  await screen.findByText(`Showing ${n.toLocaleString('en-US')} of ${n.toLocaleString('en-US')}`)
}

const table = (): HTMLElement => screen.getByRole('region', { name: 'Tags table' })
const firstRow = (): HTMLElement => document.querySelector<HTMLElement>('.rt-rows .rt-row')!
const tabNames = (): string[] => screen.getAllByRole('tab').map((t) => t.textContent ?? '')
const heading = (): string | null => within(screen.getByRole('region', { name: 'Spectrum' })).getByRole('heading', { level: 2 }).getAttribute('title')
/// The view the Tags table last asked for (not one of the Spectrum tab's).
const tableView = (mock: MockBridge): ResultsView => [...mock.resultsQueryCalls].reverse().find((c) => !c.view.spectrumExact)!.view

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
    // The heading is the scan, as Tags and Triage show it (round 4, 15); the
    // native ID is its tooltip.
    expect(within(document.getElementById('tabpanel')!).getByRole('heading', { level: 2, name: spectrumHint(spectrum) }).getAttribute('title')).toBe(spectrum)
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

  it('another tag of the spectrum redraws the ladder; next ▶ goes to the next spectrum in the Tags table order', async () => {
    const mock = bridge(true)
    await openTags(mock)
    await click(firstRow())
    // The view the table shows (its default sort): ◀ ▶ walk its order.
    const shownView = tableView(mock)
    await click(screen.getByRole('button', { name: 'Open in Spectrum' }))
    await screen.findByTestId('ladder-verdict')
    const shown = within(document.getElementById('tabpanel')!).getByRole('heading', { level: 2 }).getAttribute('title')
    const tags = screen.getByRole('region', { name: 'Tags of this spectrum' })
    const rows = within(tags).getAllByRole('row').slice(1)
    const second = rows[1]
    const tag = second.querySelector('td')!.textContent!
    await click(second)
    expect(second.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('ladder').textContent).toContain(tag)
    // Announced: the list is a read-only grid (aria-selected counts there),
    // one row selected and in the tab order, and the redrawn verdict is in a
    // polite live region; the panel is a named region.
    const grid = within(tags).getByRole('grid', { name: 'Tags of this spectrum' })
    expect(grid.getAttribute('aria-readonly')).toBe('true')
    expect(within(grid).getAllByRole('gridcell').length).toBeGreaterThan(0)
    const selected = within(grid).getAllByRole('row', { selected: true })
    expect(selected).toEqual([second])
    expect(second.tabIndex).toBe(0)
    expect(rows.filter((r) => r.tabIndex === 0)).toHaveLength(1)
    expect(screen.getByTestId('ladder-verdict').closest('[aria-live=polite]')).not.toBeNull()
    expect(screen.getByRole('region', { name: 'Spectrum' })).toBeTruthy()
    // The keyboard: ArrowDown chooses the next tag and moves the focus.
    await act(async () => {
      fireEvent.keyDown(second, { key: 'ArrowDown' })
    })
    expect(rows[2].getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(rows[2])
    await click(second)
    const next = screen.getByRole('button', { name: 'Next tagged spectrum' })
    await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false))
    await click(next)
    await flush()
    const order = viewIds(COLUMNS, ROWS, shownView).map((i) => ROWS[i][0])
    expect(order[0]).toBe(shown)
    const want = order.find((sp) => sp !== shown)
    await waitFor(() => expect(heading()).toBe(want))
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

// browser.rs view_token: a query of a new view spec cancels the view build
// in flight, whose query then fails with "cancelled". The panel's own
// queries (its tags, then where ◀ ▶ lead) must not cancel each other, and
// one cancelled by another view (the Tags table's) is asked again.
describe('P4a: the Spectrum panel and the backend\'s view cancel', () => {
  function cancelling(mock: MockBridge, outside = 0): { cancelled: number } {
    const plain = mock.resultsQuery
    let current = ''
    const seen = { cancelled: 0 }
    let left = outside
    mock.resultsQuery = async (path, view, offset, limit) => {
      if (!view.spectrum) return plain(path, view, offset, limit)
      const mine = JSON.stringify(view)
      current = mine
      // The build takes a while; another spec meanwhile cancels it.
      await new Promise((r) => setTimeout(r, 5))
      if (current !== mine || (left > 0 && view.sort != null && left-- > 0)) {
        seen.cancelled += 1
        throw 'cancelled'
      }
      return plain(path, view, offset, limit)
    }
    return seen
  }
  it('the tags of the spectrum load although ◀ ▶ query another view', async () => {
    const mock = bridge(true, [])
    const seen = cancelling(mock)
    await openTags(mock)
    await click(firstRow())
    await click(screen.getByRole('button', { name: 'Open in Spectrum' }))
    mock.nextPickInput = INPUT
    await click(await screen.findByRole('button', { name: 'Locate input…' }))
    await screen.findByTestId('ladder-verdict', {}, { timeout: 3000 })
    expect(screen.queryByText(/Cannot read the tags/)).toBeNull()
    expect(seen.cancelled).toBe(0)
    const next = screen.getByRole('button', { name: 'Next tagged spectrum' })
    await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false))
  })
  it('a tags query cancelled by another view is asked again', async () => {
    const mock = bridge(true, [])
    const seen = cancelling(mock, 2)
    await openTags(mock)
    await click(firstRow())
    await click(screen.getByRole('button', { name: 'Open in Spectrum' }))
    mock.nextPickInput = INPUT
    await click(await screen.findByRole('button', { name: 'Locate input…' }))
    await screen.findByTestId('ladder-verdict', {}, { timeout: 3000 })
    expect(screen.queryByText(/Cannot read the tags/)).toBeNull()
    expect(seen.cancelled).toBe(2)
  })
})

describe('P4a: a native ID that is a prefix of many others', () => {
  it('lists exactly its own tags, draws the opened tag\'s ladder, and ◀ ▶ work, past 1,000 better tags of other spectra', async () => {
    // S (a real spectrum with its real tags and dump) is a substring of
    // S0..S9 and S00..S99 here, as scan=1 is of scan=10..19, 100..199 in a
    // real file: 1,210 tags of those, all better by E-value, come before
    // S's own in a substring view, more than a page (MAX_WINDOW) of them.
    const S = SPECTRA[0]
    const own = ROWS.filter((r: string[]) => r[0] === S)
    const ev = COLUMNS.indexOf('evalue')
    const other = (id: string, k: number): string[] => {
      const r = own[0].slice()
      r[0] = id
      r[ev] = `1e-${30 + (k % 9)}`
      return r
    }
    const ids = [...Array(10).keys()].map((k) => `${S}${k}`).concat([...Array(100).keys()].map((k) => `${S}${String(k).padStart(2, '0')}`))
    const rows = [other(`${S}0`, 0), ...own]
    ids.forEach((id, k) => {
      for (let j = 0; j < 11; j++) rows.push(other(id, k + j))
    })
    expect(viewIds(COLUMNS, rows, { spectrum: S }).length).toBeGreaterThan(MAX_WINDOW + own.length)
    const mock = bridge(true, [record()], rows)
    await openTags(mock, rows.length)
    // Sorted by spectrum, S's tags come first (S sorts before S0), in file
    // order: the first row is S's first tag.
    await click(within(table()).getByTitle(/^Sort by spectrum$/i))
    await waitFor(() => expect(firstRow().querySelector('[role=gridcell]')!.getAttribute('title')).toBe(S))
    await click(firstRow())
    await click(screen.getByRole('button', { name: 'Open in Spectrum' }))
    await screen.findByTestId('ladder-verdict')
    const tags = screen.getByRole('region', { name: 'Tags of this spectrum' })
    expect(within(tags).getByText(new RegExp(`Tags of this spectrum \\(n=${own.length}\\)`))).toBeTruthy()
    // The opened tag is the chosen one and its ladder is drawn.
    const chosen = within(tags).getAllByRole('row').find((r) => r.getAttribute('aria-selected') === 'true')!
    expect(chosen.querySelector('td')!.textContent).toBe(own[0][COLUMNS.indexOf('tag')])
    expect(screen.getByTestId('ladder').textContent).toContain(own[0][COLUMNS.indexOf('tag')])
    expect(screen.getByTestId('ladder-verdict').textContent).toMatch(/^on \d+ of \d+ positions/)
    // ◀ ▶ walk the best tag of each spectrum in file order: S's best is
    // its first row (S0's row 0 is not S0's best), so S is first, and S0
    // (whose best tag is its next row) follows it.
    const prev = (): HTMLButtonElement => screen.getByRole('button', { name: 'Previous tagged spectrum' })
    const next = (): HTMLButtonElement => screen.getByRole('button', { name: 'Next tagged spectrum' })
    await waitFor(() => expect(next().disabled).toBe(false))
    await waitFor(() => expect(prev().disabled).toBe(true))
    await click(next())
    await waitFor(() => expect(within(document.getElementById('tabpanel')!).getByRole('heading', { level: 2 }).getAttribute('title')).toBe(`${S}0`))
    await waitFor(() => expect(prev().disabled).toBe(false))
    await click(prev())
    await waitFor(() => expect(within(document.getElementById('tabpanel')!).getByRole('heading', { level: 2 }).getAttribute('title')).toBe(S))
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Tags of this spectrum' })).getByText(new RegExp(`\\(n=${own.length}\\)`))).toBeTruthy())
  })
})

// ◀ ▶ (feedback 20261124T073446Z_08bc8de4, _102fa0af): both stayed disabled
// after a normal run, because the panel asked resultsPosition about a
// per-spectrum view nothing had built (browser.rs position never builds).
// They walk the Tags table's order as it was sorted and filtered, else each
// tagged spectrum in file order, and answer Alt+← → and Page Up/Down.
/// The spectrum after (+1) or before (-1) row @p pos of @p ids whose
/// spectrum is another than @p sp, as ◀ ▶ step; null at an end.
function stepIn(rows: string[][], ids: number[], pos: number, dir: -1 | 1): { spectrum: string; pos: number } | null {
  const sp = rows[ids[pos]][0]
  for (let k = pos + dir; k >= 0 && k < ids.length; k += dir) if (rows[ids[k]][0] !== sp) return { spectrum: rows[ids[k]][0], pos: k }
  return null
}
const prevBtn = (): HTMLButtonElement => screen.getByRole('button', { name: 'Previous tagged spectrum' })
const nextBtn = (): HTMLButtonElement => screen.getByRole('button', { name: 'Next tagged spectrum' })
const panelKey = async (key: string, alt = false, on?: Element): Promise<void> =>
  act(async () => {
    fireEvent.keyDown(on ?? screen.getByRole('region', { name: 'Spectrum' }), { key, altKey: alt })
  })

describe('P4a: ◀ ▶ walk the Tags table order', () => {
  it('from the default view (no per-spectrum view ever built): enabled, first is first, Page Down and Alt+→ step on', async () => {
    const mock = bridge(true)
    await openTags(mock)
    await click(firstRow())
    const tv = tableView(mock)
    await click(screen.getByRole('button', { name: 'Open in Spectrum' }))
    await screen.findByTestId('ladder-verdict')
    const ids = viewIds(COLUMNS, ROWS, tv)
    expect(heading()).toBe(ROWS[ids[0]][0])
    // The first row of the table: nothing before it.
    await waitFor(() => expect(prevBtn().disabled).toBe(true))
    expect(nextBtn().disabled).toBe(false)
    expect(screen.getByTestId('nav-at').textContent).toBe(`tag 1 of ${ids.length.toLocaleString('en-US')}`)
    await panelKey('PageUp')
    expect(document.querySelector('.sp-head [role=status]')!.textContent).toBe('This is the first spectrum in the Tags table order.')
    const one = stepIn(ROWS, ids, 0, 1)!
    await panelKey('PageDown')
    await waitFor(() => expect(heading()).toBe(one.spectrum))
    await waitFor(() => expect(prevBtn().disabled).toBe(false))
    const two = stepIn(ROWS, ids, one.pos, 1)!
    await panelKey('ArrowRight', true)
    await waitFor(() => expect(heading()).toBe(two.spectrum))
    // Back: Alt+← to the spectrum before.
    const back = stepIn(ROWS, ids, two.pos, -1)!
    await waitFor(() => expect(prevBtn().disabled).toBe(false))
    await panelKey('ArrowLeft', true)
    await waitFor(() => expect(heading()).toBe(back.spectrum))
  })

  it('sorted by tag: next ▶ goes to the next row of another spectrum in that order, and opens on that row', async () => {
    const mock = bridge(true)
    await openTags(mock)
    await click(within(table()).getByTitle(/^Sort by tag$/i))
    await flush()
    const tv = tableView(mock)
    expect(tv.sort).toEqual({ column: 'tag', desc: false })
    const ids = viewIds(COLUMNS, ROWS, tv)
    await waitFor(() => expect(firstRow().querySelector('[role=gridcell]')!.getAttribute('title')).toBe(ROWS[ids[0]][0]))
    // The fourth row of the sorted table.
    const k = 3
    await click(document.querySelectorAll<HTMLElement>('.rt-rows .rt-row')[k])
    await click(screen.getByRole('button', { name: 'Open in Spectrum' }))
    await screen.findByTestId('ladder-verdict')
    expect(heading()).toBe(ROWS[ids[k]][0])
    const want = stepIn(ROWS, ids, k, 1)!
    // Not the next spectrum in file order: the table's order.
    expect(want.spectrum).not.toBe(SPECTRA[SPECTRA.indexOf(ROWS[ids[k]][0]) + 1])
    await waitFor(() => expect(screen.getByTestId('nav-at').textContent).toBe(`tag ${k + 1} of ${ids.length.toLocaleString('en-US')}`))
    await click(nextBtn())
    await waitFor(() => expect(heading()).toBe(want.spectrum))
    // Its tag at that row is the one drawn.
    const tag = ROWS[ids[want.pos]][COLUMNS.indexOf('tag')]
    await waitFor(() => expect(screen.getByTestId('ladder').textContent).toContain(tag))
    await waitFor(() => expect(screen.getByTestId('nav-at').textContent).toBe(`tag ${want.pos + 1} of ${ids.length.toLocaleString('en-US')}`))
  })
})

describe('P4a: ◀ ▶ of a spectrum opened without a table view (Triage)', () => {
  /// The panel alone on @p mock, following its own ◀ ▶.
  function Panel({ first }: { first: SpectrumTarget }): JSX.Element {
    const [t, setT] = useState<SpectrumTarget>(first)
    return <SpectrumPanel target={t} source={{ input: INPUT, params: {}, from: 'run' }} onTarget={setT} onLocate={() => undefined} />
  }
  it('steps through every tagged spectrum in file order; the keys stay out of text fields; ← → still pan the plot', async () => {
    bridge(true)
    render(<Panel first={{ path: TAGS, spectrum: SPECTRA[1], rowId: null }} />)
    await screen.findByTestId('ladder-verdict')
    await waitFor(() => expect(screen.getByTestId('nav-at').textContent).toBe(`spectrum 2 of ${SPECTRA.length.toLocaleString('en-US')}`))
    // A key in a text field is the field's.
    const field = document.createElement('input')
    screen.getByRole('region', { name: 'Spectrum' }).appendChild(field)
    await panelKey('PageDown', false, field)
    await panelKey('ArrowRight', true, field)
    await flush()
    expect(heading()).toBe(SPECTRA[1])
    field.remove()
    // Nor do keys in another part of the window.
    const elsewhere = document.createElement('button')
    document.body.appendChild(elsewhere)
    await panelKey('PageDown', false, elsewhere)
    await flush()
    expect(heading()).toBe(SPECTRA[1])
    elsewhere.remove()
    // ← → on the plot pan it and stay on this spectrum.
    const plot = screen.getByRole('img', { name: /^Stick plot/ })
    await click(screen.getByRole('button', { name: 'Zoom in' }))
    const before = plot.getAttribute('aria-label')
    await panelKey('ArrowRight', false, plot)
    expect(plot.getAttribute('aria-label')).not.toBe(before)
    expect(heading()).toBe(SPECTRA[1])
    // Alt+→ on the plot is the panel's.
    await panelKey('ArrowRight', true, plot)
    await waitFor(() => expect(heading()).toBe(SPECTRA[2]))
    await waitFor(() => expect(prevBtn().disabled).toBe(false))
    await click(prevBtn())
    await waitFor(() => expect(heading()).toBe(SPECTRA[1]))
    await click(await waitFor(() => (prevBtn().disabled ? Promise.reject(new Error('disabled')) : prevBtn())))
    await waitFor(() => expect(heading()).toBe(SPECTRA[0]))
    await waitFor(() => expect(prevBtn().disabled).toBe(true))
  })

  it('the E-value order not ready yet (D5 pending): the buttons wait for it and then lead on', async () => {
    const was = { ...RANK_WAIT }
    RANK_WAIT.ms = 5
    try {
      const mock = bridge(true, [record()], ROWS, 4)
      render(<Panel first={{ path: TAGS, spectrum: SPECTRA[1], rowId: null }} />)
      await screen.findByTestId('ladder-verdict')
      // Not disabled while it is looked up.
      expect(nextBtn().disabled).toBe(false)
      await waitFor(() => expect(screen.getByTestId('nav-at').textContent).toBe(`spectrum 2 of ${SPECTRA.length.toLocaleString('en-US')}`))
      expect(mock.resultsQueryCalls.some((c) => c.view.perSpectrum === 1 && !c.view.spectrum)).toBe(true)
      expect(prevBtn().disabled).toBe(false)
      expect(nextBtn().disabled).toBe(false)
      await click(nextBtn())
      await waitFor(() => expect(heading()).toBe(SPECTRA[2]))
    } finally {
      Object.assign(RANK_WAIT, was)
    }
  })
})

// ◀ ▶ keep "the order is not ready", "the lookup failed" and "the spectrum
// is not in the table's view" apart (review #9): only the last walks each
// tagged spectrum in file order, and says so; the others are no end.
describe('P4a: ◀ ▶ when the Tags table order is pending, failed or leaves the spectrum out', () => {
  function Panel({ first }: { first: SpectrumTarget }): JSX.Element {
    const [t, setT] = useState<SpectrumTarget>(first)
    return <SpectrumPanel target={t} source={{ input: INPUT, params: {}, from: 'run' }} onTarget={setT} onLocate={() => undefined} />
  }
  const BY_TAG: ResultsView = { sort: { column: 'tag', desc: false } }
  const only = (view: ResultsView) => (v: ResultsView): boolean => specKey(v) === specKey(view)
  // The first row of SPECTRA[1] in the file: the tag it was opened on.
  const ROW1 = ROWS.findIndex((r: string[]) => r[0] === SPECTRA[1])
  const status = (): string => document.querySelector('.sp-head [role=status]')!.textContent ?? ''
  const fileOrderQueried = (mock: MockBridge): boolean => mock.resultsQueryCalls.some((c) => c.view.perSpectrum === 1 && !c.view.spectrum)
  async function shrunk(body: () => Promise<void>): Promise<void> {
    const was = { ...RANK_WAIT }
    RANK_WAIT.ms = 1
    RANK_WAIT.tries = 3
    try {
      await body()
    } finally {
      Object.assign(RANK_WAIT, was)
    }
  }

  it('the table order still pending after the wait: no file-order walk, the buttons say it is being built and wait', () =>
    shrunk(async () => {
      // The table's view never gets its E-value order; file order would answer.
      const mock = bridge(true, [record()], ROWS, 1e6, only(BY_TAG))
      render(<Panel first={{ path: TAGS, spectrum: SPECTRA[1], rowId: ROW1, view: BY_TAG }} />)
      await screen.findByTestId('ladder-verdict')
      await waitFor(() => expect(nextBtn().title).toMatch(/E-value order of the Tags table is still being built; try again in a moment/))
      expect(prevBtn().title).toMatch(/still being built/)
      expect(nextBtn().disabled).toBe(true)
      expect(prevBtn().disabled).toBe(true)
      expect(screen.queryByTestId('nav-at')).toBeNull()
      expect(status()).toMatch(/still being built/)
      // Not walked in file order in its place.
      expect(fileOrderQueried(mock)).toBe(false)
      await panelKey('PageDown')
      await panelKey('ArrowLeft', true)
      await flush()
      expect(heading()).toBe(SPECTRA[1])
      expect(status()).toMatch(/still being built/)
      expect(status()).not.toMatch(/first|last/)
      expect(screen.getByRole('button', { name: 'Look up the previous and next spectrum again' })).toBeTruthy()
    }))

  it('the spectrum not in the filtered table view: each tagged spectrum in file order, and the tooltips say so', async () => {
    const ev = COLUMNS.indexOf('evalue')
    const best = (sp: string): number => Math.min(...ROWS.filter((r: string[]) => r[0] === sp).map((r: string[]) => Number(r[ev])))
    const all = Math.min(...SPECTRA.map(best))
    // A spectrum in the middle of the file whose tags all score worse than the best tag of the file.
    const i = SPECTRA.findIndex((sp, k) => k > 0 && k < SPECTRA.length - 1 && best(sp) > all)
    expect(i).toBeGreaterThan(0)
    const view: ResultsView = { sort: { column: 'evalue', desc: false }, maxEvalue: all }
    // The filter leaves rows, none of them of that spectrum.
    expect(viewIds(COLUMNS, ROWS, view).length).toBeGreaterThan(0)
    bridge(true)
    render(<Panel first={{ path: TAGS, spectrum: SPECTRA[i], rowId: ROWS.findIndex((r: string[]) => r[0] === SPECTRA[i]), view }} />)
    await screen.findByTestId('ladder-verdict')
    await waitFor(() => expect(screen.getByTestId('nav-at').textContent).toBe(`spectrum ${i + 1} of ${SPECTRA.length.toLocaleString('en-US')}`))
    const notIn = "in file order (this spectrum is not in the Tags table's filtered view)"
    expect(screen.getByTestId('nav-at').title).toContain(notIn)
    expect(nextBtn().title).toBe(`Next spectrum with tags, ${notIn} (Alt+→ or Page Down)`)
    expect(prevBtn().title).toBe(`Previous spectrum with tags, ${notIn} (Alt+← or Page Up)`)
    expect(nextBtn().title).not.toMatch(/Tags table order/)
    await click(nextBtn())
    await waitFor(() => expect(heading()).toBe(SPECTRA[i + 1]))
  })

  it('resultsPosition failing: the note says the lookup failed, not that this is the last spectrum', async () => {
    const mock = bridge(true)
    mock.resultsPosition = () => Promise.reject(new Error('the index is gone'))
    render(<Panel first={{ path: TAGS, spectrum: SPECTRA[1], rowId: ROW1, view: BY_TAG }} />)
    await screen.findByTestId('ladder-verdict')
    await waitFor(() => expect(nextBtn().title).toBe('Could not look up the neighbouring spectra: the index is gone.'))
    expect(nextBtn().disabled).toBe(true)
    expect(screen.queryByTestId('nav-at')).toBeNull()
    await panelKey('PageDown')
    expect(status()).toBe('Could not look up the neighbouring spectra: the index is gone.')
    expect(status()).not.toMatch(/last spectrum/)
    expect(heading()).toBe(SPECTRA[1])
    expect(fileOrderQueried(mock)).toBe(false)
  })

  it('a position against a view whose head is still pending is not taken; Try again takes it once the order is there', () =>
    shrunk(async () => {
      // Pending for exactly the head reads of one wait; resultsPosition
      // answers a number all along.
      const mock = bridge(true, [record()], ROWS, RANK_WAIT.tries, only(BY_TAG))
      const ids = viewIds(COLUMNS, ROWS, BY_TAG)
      mock.resultsPosition = (_p, view, row) => Promise.resolve(viewIds(COLUMNS, ROWS, view).indexOf(row))
      render(<Panel first={{ path: TAGS, spectrum: SPECTRA[1], rowId: ROW1, view: BY_TAG }} />)
      await screen.findByTestId('ladder-verdict')
      await waitFor(() => expect(nextBtn().title).toMatch(/still being built/))
      expect(screen.queryByTestId('nav-at')).toBeNull()
      expect(nextBtn().disabled).toBe(true)
      await click(screen.getByRole('button', { name: 'Look up the previous and next spectrum again' }))
      const pos = ids.indexOf(ROW1)
      await waitFor(() => expect(screen.getByTestId('nav-at').textContent).toBe(`tag ${pos + 1} of ${ids.length.toLocaleString('en-US')}`))
      expect(nextBtn().title).toBe('Next spectrum in the Tags table order (Alt+→ or Page Down)')
      const want = stepIn(ROWS, ids, pos, 1)!
      await waitFor(() => expect(nextBtn().disabled).toBe(false))
      await click(nextBtn())
      await waitFor(() => expect(heading()).toBe(want.spectrum))
    }))
})

describe('P4a: a CLI without -dump_spectrum (FASTag 1.11)', () => {
  it('hides the Spectrum tab, and the row action says the view needs FASTag 1.12', async () => {
    const mock = bridge(false)
    await openTags(mock)
    expect(tabNames()).not.toContain('Spectrum')
    const action = screen.getByRole('button', { name: 'Spectrum view needs FASTag 1.12 or later' })
    expect((action as HTMLButtonElement).disabled).toBe(true)
    await click(firstRow())
    await act(async () => {
      fireEvent.keyDown(table(), { key: 'Enter' })
    })
    expect(screen.getByRole('tab', { name: 'Tags' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Spectrum view needs FASTag 1.12 or later.')).toBeTruthy()
    expect(mock.spectrumCalls).toHaveLength(0)
  })
})
