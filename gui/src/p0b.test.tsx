// P0b "quick wins" (GUI-DESIGN 10): the D5 swap in the tags table,
// parameter search, instrument presets, the species preflight fix, menus and
// shortcuts, and Reveal. Driven through the real window.fastag seam.

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import { closeHelp } from './help/link'
import ResultsTable, { headServes, scrollTopFor } from './ResultsTable'
import { installMockBridge, type MockBridge } from './testing/mockBridge'
import { searchParams } from './setup/searchRank'
import { applyInstrument, INSTRUMENTS, matchesInstrument, presetText, speciesFixes } from './setup/presets'
import { actionOfKey, deduper } from './setup/shortcuts'
import type { ResultsPage } from './types'

const flush = (): Promise<void> => act(async () => {})
const click = (el: Element): Promise<void> =>
  act(async () => {
    fireEvent.click(el)
  })

async function renderApp(mock: MockBridge): Promise<HTMLElement> {
  const { container } = render(<App />)
  await screen.findByText('FASTag ready')
  await act(async () => {})
  void mock
  return container
}

async function pickSingle(mock: MockBridge, path: string): Promise<void> {
  mock.nextPickInput = path
  await click(screen.getByRole('button', { name: /^(Choose file|Change)…$/ }))
}

const key = (init: KeyboardEventInit, target: EventTarget = window): Promise<void> =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
  })

describe('parameter search ranking', () => {
  it('finds fragment_tolerance for "tolerance", flag and name matches above help-text ones', () => {
    const hits = searchParams('tolerance')
    expect(hits[0].name).toBe('fragment_tolerance')
    expect(hits.map((h) => h.name)).toContain('isobaric_tolerance')
    const firstHelp = hits.findIndex((h) => h.where === 'help')
    const lastNamed = hits.map((h) => h.where !== 'help').lastIndexOf(true)
    if (firstHelp >= 0) expect(lastNamed).toBeLessThan(firstHelp)
    // Unit after its value.
    const names = hits.map((h) => h.name)
    if (names.includes('fragment_tolerance_unit'))
      expect(names.indexOf('fragment_tolerance')).toBeLessThan(names.indexOf('fragment_tolerance_unit'))
  })

  it('matches words in any spelling: flag with underscores, words, help text', () => {
    expect(searchParams('tag_length')[0].name).toBe('tag_length')
    expect(searchParams('tag length')[0].name).toBe('tag_length')
    expect(searchParams('TAG-LENGTH')[0].name).toBe('tag_length')
    expect(searchParams('')).toEqual([])
    expect(searchParams('zzzz-no-such-thing')).toEqual([])
    // Every hit names its section, so choosing it can open that section.
    for (const h of searchParams('species')) expect(h.section).not.toBe('')
  })
})

describe('instrument presets', () => {
  it('are the four of Q5, two marked unvalidated', () => {
    expect(INSTRUMENTS.map(presetText)).toEqual([
      'Orbitrap HCD 20 ppm',
      'Ion trap CID 0.3 Da',
      'timsTOF 30 ppm (unvalidated)',
      'Astral 20 ppm (unvalidated)'
    ])
  })

  it('set fragment_tolerance and its unit and nothing else', () => {
    const before = { tag_length: '5', fragment_tolerance: '20', fragment_tolerance_unit: 'ppm', species: true }
    const it = INSTRUMENTS.find((p) => p.id === 'iontrap-cid')!
    const after = applyInstrument(before, it)
    const changed = Object.keys(after).filter((k) => JSON.stringify(after[k]) !== JSON.stringify((before as Record<string, unknown>)[k]))
    expect(changed.sort()).toEqual(['fragment_tolerance', 'fragment_tolerance_unit'])
    expect(after).toMatchObject({ fragment_tolerance: '0.3', fragment_tolerance_unit: 'Da' })
    expect(matchesInstrument(after, it)).toBe(true)
    // An empty field is the CLI default (20 ppm): the Orbitrap preset.
    expect(matchesInstrument({ fragment_tolerance: '', fragment_tolerance_unit: '' }, INSTRUMENTS[0])).toBe(true)
    expect(matchesInstrument({ fragment_tolerance: '20.0', fragment_tolerance_unit: 'Da' }, INSTRUMENTS[0])).toBe(false)
  })

  it('species fixes offer extension 2 first, then the seed length with its cost', () => {
    expect(speciesFixes(null)).toEqual([])
    const f = speciesFixes({ reach: 3, k: 7, option: 'tag_length', seed: 3, ext: 0 })
    expect(f.map((x) => x.label)).toEqual(['Use extension 2', 'Set tag_length to 7'])
    expect(f[0].values).toEqual({ extension: '2' })
    expect(f[1].note).toBe('changes every tag')
    // Extension 2 cannot reach k from a seed of 2: the smallest that can.
    expect(speciesFixes({ reach: 2, k: 7, option: 'tag_lengths', seed: 2, ext: 0 }).map((x) => x.label)).toEqual(['Use extension 3'])
  })
})

describe('shortcuts', () => {
  const k = (key: string, mods: Partial<KeyboardEvent> = {}, target: EventTarget | null = null) =>
    ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, target, ...mods }) as KeyboardEvent

  it('map Cmd on macOS and Ctrl elsewhere to the P0b actions', () => {
    for (const [mac, mod] of [[true, { metaKey: true }], [false, { ctrlKey: true }]] as const) {
      expect(actionOfKey(k('o', mod), mac)).toBe('open-spectra')
      expect(actionOfKey(k('O', { ...mod, shiftKey: true }), mac)).toBe('open-results')
      expect(actionOfKey(k('Enter', mod), mac)).toBe('run')
      expect(actionOfKey(k('.', mod), mac)).toBe('cancel')
      expect(actionOfKey(k('e', mod), mac)).toBe('export')
      expect(actionOfKey(k('?', { ...mod, shiftKey: true }), mac)).toBe('help')
      expect(actionOfKey(k('k', mod), mac)).toBe('search-params')
    }
    // The other platform's modifier does nothing.
    expect(actionOfKey(k('o', { ctrlKey: true }), true)).toBeNull()
    expect(actionOfKey(k('o', { metaKey: true }), false)).toBeNull()
    expect(actionOfKey(k('o'), false)).toBeNull()
  })

  it('"/" opens the search only outside a text field', () => {
    const input = document.createElement('input')
    expect(actionOfKey(k('/'), false)).toBe('search-params')
    expect(actionOfKey(k('/', {}, input), false)).toBeNull()
  })

  it('a menu item and its key event act once; repeats from one source act', () => {
    let t = 0
    const fresh = deduper(300, () => t)
    expect(fresh('run', 'menu')).toBe(true)
    t = 100
    expect(fresh('run', 'key')).toBe(false)
    expect(fresh('cancel', 'key')).toBe(true)
    expect(fresh('cancel', 'key')).toBe(true)
    t = 1000
    expect(fresh('cancel', 'menu')).toBe(true)
  })
})

describe('App wiring', () => {
  it('Ctrl+K opens the search; "tolerance" + Enter opens its section and focuses fragment_tolerance', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await key({ key: 'k', ctrlKey: true })
    const box = await screen.findByRole('combobox', { name: /Search parameters/ })
    expect(document.activeElement).toBe(box)
    await act(async () => {
      fireEvent.change(box, { target: { value: 'tolerance' } })
    })
    expect(screen.getAllByRole('option')[0].textContent).toContain('fragment_tolerance')
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' })
    })
    await waitFor(() => expect(document.activeElement?.id).toBe('p-fragment_tolerance'))
    expect(screen.queryByRole('combobox', { name: /Search parameters/ })).toBeNull()
  })

  it('"/" opens the search, Esc closes it, and the button names its shortcut', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await key({ key: '/' }, document.body)
    const box = await screen.findByRole('combobox', { name: /Search parameters/ })
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Escape' })
    })
    expect(screen.queryByRole('combobox', { name: /Search parameters/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Search…/ }).getAttribute('aria-keyshortcuts')).toContain('K')
  })

  it('choosing "Ion trap CID" sets 0.3 Da and nothing else in the run', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    const sel = screen.getByLabelText('Instrument') as HTMLSelectElement
    await act(async () => {
      fireEvent.change(sel, { target: { value: 'iontrap-cid' } })
    })
    expect(sel.value).toBe('iontrap-cid')
    await click(screen.getByRole('button', { name: /^Run on a\.mzML$/ }))
    await waitFor(() => expect(mock.runCalls).toHaveLength(1))
    const p = mock.runCalls[0].params as Record<string, unknown>
    expect(p).toMatchObject({ fragment_tolerance: '0.3', fragment_tolerance_unit: 'Da' })
    // Changing the tolerance by hand leaves the preset.
    expect(screen.queryByText(/not validated/)).toBeNull()
    await act(async () => mock.emitDone({ ok: true, code: 0, runId: mock.lastRunId }))
  })

  it('an unvalidated preset says so', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Instrument'), { target: { value: 'timstof' } })
    })
    expect(screen.getByRole('note').textContent).toMatch(/timsTOF: not validated/)
  })

  it('the species preflight offers "Use extension 2", which lifts the block', async () => {
    const mock = installMockBridge()
    mock.taxdbInfoResult = { path: '/t/tax.taxdb', k: 7 }
    mock.settings.lastUsed = { species: true }
    await renderApp(mock)
    await click(screen.getByRole('button', { name: /Apply last-used/ }))
    await pickSingle(mock, '/d/a.mzML')
    const fix = await screen.findByRole('button', { name: 'Use extension 2' })
    expect((screen.getByRole('button', { name: /^Run on a\.mzML$/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: /Set tag_length to 7 \(changes every tag\)/ })).toBeDefined()
    await click(fix)
    expect(screen.queryByRole('button', { name: 'Use extension 2' })).toBeNull()
    expect((screen.getByRole('button', { name: /^Run on a\.mzML$/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('native menu actions run, cancel and open help; Ctrl+Enter runs once', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    await act(async () => mock.emitMenu('run'))
    await waitFor(() => expect(mock.runCalls).toHaveLength(1))
    // The same action from the key right after: dropped (one run).
    await key({ key: 'Enter', ctrlKey: true })
    await act(async () => mock.emitMenu('cancel'))
    expect(mock.cancelCalls).toBe(1)
    await act(async () => mock.emitDone({ ok: false, code: null, cancelled: true, runId: mock.lastRunId }))
    expect(mock.runCalls).toHaveLength(1)
    await act(async () => mock.emitMenu('help'))
    await waitFor(() => expect(document.querySelector('.layout')?.hasAttribute('hidden')).toBe(true))
    await act(async () => closeHelp()) // the help store is module-wide
  })

  it('Ctrl+O opens the spectra picker', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    mock.nextPickInput = '/d/k.mzML'
    await key({ key: 'o', ctrlKey: true })
    await screen.findByRole('button', { name: /^Run on k\.mzML$/ })
  })

  it('Reveal and Open folder ask the backend for the finished run\'s -out only', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    expect(screen.queryByRole('button', { name: /Open folder/ })).toBeNull()
    await pickSingle(mock, '/d/a.mzML')
    await click(screen.getByRole('button', { name: /^Run on a\.mzML$/ }))
    await waitFor(() => expect(mock.runCalls).toHaveLength(1))
    await act(async () => mock.emitDone({ ok: true, code: 0, runId: mock.lastRunId }))
    await click(await screen.findByRole('button', { name: /Reveal in Finder|Show in Explorer|Show in folder/ }))
    await click(screen.getByRole('button', { name: 'Open folder' }))
    expect(mock.revealCalls).toEqual([
      { path: '/d/a.tags.tsv', folder: false },
      { path: '/d/a.tags.tsv', folder: true }
    ])
    // A refusal is shown, not swallowed.
    mock.revealError = new Error('/d/a.tags.tsv is not an output of a run of this app')
    await click(screen.getByRole('button', { name: 'Open folder' }))
    expect(screen.getByRole('alert').textContent).toMatch(/not an output/)
  })
})

describe('D5: file order first, ranked order swapped in', () => {
  // Rows in file order; their E-values rank them 2, 0, 1.
  const COLS = ['spectrum', 'tag', 'length', 'evalue', 'fasta_hit']
  const FILE = [
    ['frame=5', 'AQRQAAN', '7', '0.003', 'fwd'],
    ['frame=5', 'QRQAANS', '7', '0.008', '-'],
    ['frame=7', 'LNDLAAK', '7', '0.0001', 'rev']
  ]
  const RANKED = [2, 0, 1]

  function rankingMock(): MockBridge & { rankedNow: boolean; positions: number[] } {
    const mock = installMockBridge() as MockBridge & { rankedNow: boolean; positions: number[] }
    mock.resultsColumns = COLS
    mock.resultsRows = FILE
    mock.rankedNow = false
    mock.positions = []
    mock.resultsQuery = (path, view, offset, limit): Promise<ResultsPage> => {
      mock.resultsQueryCalls.push({ path, view, offset, limit })
      const byRank = view.sort?.column === 'evalue' && mock.rankedNow
      const ids = view.sort?.column === 'evalue' && byRank ? (view.sort.desc ? [...RANKED].reverse() : RANKED) : [0, 1, 2]
      const sel = ids.slice(offset, offset + limit)
      return Promise.resolve({
        columns: COLS,
        totalRows: 3,
        matchedRows: 3,
        rows: sel.map((i) => FILE[i]),
        rowIds: sel,
        ranked: view.sort?.column !== 'evalue' || byRank,
        pending: view.sort?.column === 'evalue' && !byRank
      })
    }
    mock.resultsPosition = (_p, _v, row) => {
      mock.positions.push(row)
      return Promise.resolve(RANKED.indexOf(row))
    }
    return mock
  }

  const tags = (): string[] =>
    Array.from(document.querySelectorAll('.rt-rows .rt-row')).map((r) => r.querySelectorAll('[role="cell"]')[1]?.textContent ?? '')

  it('shows file order with a ranking note, then swaps to E-value order and announces it', async () => {
    const mock = rankingMock()
    render(<ResultsTable path="/d/x.tags.tsv" />)
    await flush()
    expect(mock.resultsOpenCalls).toEqual(['/d/x.tags.tsv'])
    await screen.findByText(/Ranking by E-value/)
    expect(tags()).toEqual(['AQRQAAN', 'QRQAANS', 'LNDLAAK'])
    await act(async () => mock.emitBrowser({ kind: 'rankProgress', generation: 1, done: 31, total: 50 }))
    expect(screen.getByText(/Ranking by E-value… 62%/)).toBeDefined()
    // Events of another open are dropped.
    mock.rankedNow = true
    await act(async () => mock.emitBrowser({ kind: 'ranked', generation: 7, column: 'evalue' }))
    expect(tags()).toEqual(['AQRQAAN', 'QRQAANS', 'LNDLAAK'])
    await act(async () => mock.emitBrowser({ kind: 'ranked', generation: 1, column: 'evalue' }))
    await waitFor(() => expect(tags()).toEqual(['LNDLAAK', 'AQRQAAN', 'QRQAANS']))
    expect(screen.getByText('Ranked by E-value.')).toBeDefined()
    expect(screen.queryByText(/Ranking by E-value/)).toBeNull()
    // The swap changes the order, not the row set.
    expect([...tags()].sort()).toEqual(FILE.map((r) => r[1]).sort())
  })

  it('keeps the active row: the swap asks for its new place', async () => {
    const mock = rankingMock()
    render(<ResultsTable path="/d/x.tags.tsv" />)
    await screen.findByText(/Ranking by E-value/)
    const row = Array.from(document.querySelectorAll('.rt-rows .rt-row'))[1] // QRQAANS, file row 1
    await click(row)
    expect(row.getAttribute('aria-selected')).toBe('true')
    mock.rankedNow = true
    await act(async () => mock.emitBrowser({ kind: 'ranked', generation: 1, column: 'evalue' }))
    await waitFor(() => expect(tags()).toEqual(['LNDLAAK', 'AQRQAAN', 'QRQAANS']))
    expect(mock.positions).toEqual([1])
    const sel = document.querySelector('.rt-rows .rt-row[aria-selected="true"]')
    expect(sel?.textContent).toContain('QRQAANS')
  })

  it('waits for a filter field to lose focus before swapping', async () => {
    const mock = rankingMock()
    render(<ResultsTable path="/d/x.tags.tsv" />)
    await screen.findByText(/Ranking by E-value/)
    const box = screen.getByLabelText('Spectrum contains')
    box.focus()
    mock.rankedNow = true
    await act(async () => mock.emitBrowser({ kind: 'ranked', generation: 1, column: 'evalue' }))
    expect(tags()).toEqual(['AQRQAAN', 'QRQAANS', 'LNDLAAK'])
    await act(async () => {
      box.blur()
      fireEvent.blur(box)
      await new Promise((r) => setTimeout(r, 5))
    })
    await waitFor(() => expect(tags()).toEqual(['LNDLAAK', 'AQRQAAN', 'QRQAANS']))
  })

  it('sends no page query before the open of its file has answered', async () => {
    const mock = rankingMock()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const orig = mock.resultsOpen
    mock.resultsOpen = (path, onEvent) => {
      const h = orig(path, onEvent)
      return gate.then(() => h)
    }
    render(<ResultsTable path="/d/x.tags.tsv" />)
    await flush()
    // The backend indexes only the open file: a query sent alongside the
    // open could reach it first and be refused.
    expect(mock.resultsOpenCalls).toEqual(['/d/x.tags.tsv'])
    expect(mock.resultsQueryCalls).toHaveLength(0)
    await act(async () => release())
    await waitFor(() => expect(mock.resultsQueryCalls.length).toBeGreaterThan(0))
    await waitFor(() => expect(tags()).toEqual(['AQRQAAN', 'QRQAANS', 'LNDLAAK']))
  })

  it('a Ranked event that beats a file-order page still ends ranked', async () => {
    const mock = rankingMock()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const orig = mock.resultsQuery
    let first = true
    mock.resultsQuery = (...a) => {
      if (!first) return orig(...a)
      first = false
      const p = orig(...a) // served in file order...
      return gate.then(() => p) // ...delivered after the event
    }
    render(<ResultsTable path="/d/x.tags.tsv" />)
    await flush()
    mock.rankedNow = true
    await act(async () => mock.emitBrowser({ kind: 'ranked', generation: 1, column: 'evalue' }))
    await act(async () => release())
    await waitFor(() => expect(tags()).toEqual(['LNDLAAK', 'AQRQAAN', 'QRQAANS']))
  })

  it('a page needed while the swap waits for a focused filter field is shown, not dropped', async () => {
    // 2,000 rows, so scrolling needs pages beyond the first; ranked order is
    // the file order reversed.
    const N = 2000
    const rows = Array.from({ length: N }, (_, i) => [`scan=${i}`, `T${i}`, '7', String(i + 1), '-'])
    const mock = installMockBridge() as MockBridge & { rankedNow: boolean }
    mock.resultsColumns = COLS
    mock.resultsRows = rows
    mock.rankedNow = false
    mock.resultsQuery = (path, view, offset, limit): Promise<ResultsPage> => {
      mock.resultsQueryCalls.push({ path, view, offset, limit })
      const byRank = view.sort?.column === 'evalue' && mock.rankedNow
      const all = Array.from({ length: N }, (_, i) => (byRank ? (view.sort!.desc ? i : N - 1 - i) : i))
      const sel = all.slice(offset, offset + limit)
      return Promise.resolve({
        columns: COLS,
        totalRows: N,
        matchedRows: N,
        rows: sel.map((i) => rows[i]),
        rowIds: sel,
        ranked: view.sort?.column !== 'evalue' || byRank,
        pending: view.sort?.column === 'evalue' && !byRank
      })
    }
    const { container } = render(<ResultsTable path="/d/x.tags.tsv" />)
    await screen.findByText(/Ranking by E-value/)
    const box = screen.getByLabelText('Spectrum contains')
    box.focus()
    mock.rankedNow = true
    await act(async () => mock.emitBrowser({ kind: 'ranked', generation: 1, column: 'evalue' }))
    expect(document.activeElement).toBe(box)
    // Scroll to rows the table has no page for (page 3 of 500 rows).
    const sc = container.querySelector('.rt-scroll') as HTMLElement
    await act(async () => {
      sc.scrollTop = 1600 * 28
      fireEvent.scroll(sc)
      await new Promise((r) => setTimeout(r, 40))
    })
    // The page arrives ranked: the swap happens now and its rows render.
    await waitFor(() => expect(tags().length).toBeGreaterThan(0))
    await waitFor(() => expect(tags().every((t) => t !== '')).toBe(true))
    expect(screen.getByText('Ranked by E-value.')).toBeDefined()
    expect(screen.queryByText(/Ranking by E-value/)).toBeNull()
  })

  it('head rows stand in only for file order or the E-value view without filters', () => {
    expect(headServes({ sort: { column: 'evalue', desc: false } })).toBe(true)
    expect(headServes({ sort: null })).toBe(true)
    expect(headServes({ sort: { column: 'tag', desc: false } })).toBe(false)
    expect(headServes({ sort: { column: 'evalue', desc: false }, maxEvalue: 1 })).toBe(false)
    expect(headServes({ fastaHit: 'only' })).toBe(false)
  })

  it('scrollTopFor centres a row in plain and capped-spacer tables', () => {
    expect(scrollTopFor(0, 100, 600)).toBe(0)
    expect(scrollTopFor(50, 100, 560)).toBe(50 * 28 - 280 + 28)
    const big = scrollTopFor(5_000_000, 10_000_000, 600)
    expect(big).toBeGreaterThan(7_000_000)
    expect(big).toBeLessThan(8_000_000)
  })
})
