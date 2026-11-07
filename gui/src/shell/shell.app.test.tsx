// The P2a shell (GUI-DESIGN 2 and 3, P2a PR s), App-level: the top bar with
// the four views and the progress pill, Help as a side panel with search,
// the full native menus, drop routing, the notification and toast on finish,
// and the themes. Driven through the window.fastag seam (mockBridge).

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installMockBridge, type MockBridge } from '../testing/mockBridge'
import { addBatch, click, flush, key, pickSingle, renderApp, runButton, startBatch } from '../testing/render'
import { closeHelp, resetHelp } from '../help/link'

afterEach(() => {
  resetHelp()
  document.documentElement.removeAttribute('data-theme')
  vi.restoreAllMocks()
})

const views = (): HTMLElement => screen.getByRole('navigation', { name: 'Views' })
const viewButton = (name: string): HTMLElement => within(views()).getByRole('button', { name: new RegExp(`^${name}`) })
const current = (): string | null | undefined =>
  views().querySelector('[aria-current="page"]')?.getAttribute('data-view')
const shown = (c: HTMLElement): string[] =>
  [...c.querySelectorAll<HTMLElement>('.view')].filter((v) => !v.hidden).map((v) => v.dataset.view ?? '')
const pill = (): HTMLElement => screen.getByRole('group', { name: 'Run status' })

async function finishRun(mock: MockBridge, ok = true): Promise<void> {
  await act(async () => mock.emitDone({ ok, code: ok ? 0 : 1, runId: mock.lastRunId }))
  await flush()
}

describe('shell: views', () => {
  it('starts on Setup; the top bar switches between the four views, one shown at a time', async () => {
    const c = await renderApp(installMockBridge())
    expect(within(views()).getAllByRole('button').map((b) => b.dataset.view)).toEqual(['setup', 'results', 'batch', 'history'])
    expect(current()).toBe('setup')
    expect(shown(c)).toEqual(['setup'])
    await click(viewButton('Results'))
    expect(current()).toBe('results')
    expect(shown(c)).toEqual(['results'])
    expect(screen.getByRole('heading', { name: 'No results yet' })).toBeDefined()
    await click(viewButton('History'))
    expect(shown(c)).toEqual(['history'])
    await click(viewButton('Batch'))
    expect(shown(c)).toEqual(['batch'])
    // Hidden, not unmounted: the form keeps what was typed.
    await click(viewButton('Setup'))
    expect(shown(c)).toEqual(['setup'])
  })

  it('Ctrl+1..4 and the View menu switch views; each button names its shortcut', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await key({ key: '2', ctrlKey: true })
    expect(current()).toBe('results')
    await key({ key: '4', ctrlKey: true })
    expect(current()).toBe('history')
    await act(async () => mock.emitMenu('view-batch'))
    expect(current()).toBe('batch')
    await act(async () => mock.emitMenu('view-setup'))
    expect(current()).toBe('setup')
    expect(viewButton('Results').getAttribute('aria-keyshortcuts')).toMatch(/2$/)
  })

  it('Run moves to Results; the pill shows the phase, the percentage and Cancel there', async () => {
    const mock = installMockBridge()
    const c = await renderApp(mock)
    expect(within(pill()).getByText('Idle')).toBeDefined()
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await waitFor(() => expect(mock.runCalls).toHaveLength(1))
    expect(shown(c)).toEqual(['results'])
    await act(async () => {
      mock.emitPhase('Tagging spectra')
      mock.emitProgress({ done: 50, total: 200, etaSec: 30 })
    })
    await flush()
    const p = pill()
    expect(p.textContent).toMatch(/a\.mzML/)
    expect(p.textContent).toMatch(/Tagging spectra/)
    expect(p.textContent).toMatch(/25%/)
    // Outside Setup the pill is the only progress element.
    expect(screen.getAllByRole('progressbar')).toHaveLength(1)
    expect(within(p).getByRole('progressbar')).toBeDefined()
    await click(within(p).getByRole('button', { name: 'Cancel' }))
    expect(mock.cancelCalls).toBe(1)
    // In Setup the run bar shows the progress, and the pill no second Cancel.
    await click(viewButton('Setup'))
    expect(within(pill()).queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(within(pill()).queryByRole('progressbar')).toBeNull()
  })

  it('Esc cancels a run when nothing else is open', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await waitFor(() => expect(mock.runCalls).toHaveLength(1))
    await key({ key: 'Escape' })
    expect(mock.cancelCalls).toBe(1)
  })

  it('Esc first dismisses a drop note shown during a run, and cancels nothing', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await waitFor(() => expect(mock.runCalls).toHaveLength(1))
    await act(async () => mock.emitDrop({ spectra: ['/d/other.mzML'] }))
    expect(screen.getByRole('alert').textContent).toMatch(/while FASTag runs/)
    await key({ key: 'Escape' })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(mock.cancelCalls).toBe(0)
    // The next Esc, with no notice shown, cancels.
    await key({ key: 'Escape' })
    expect(mock.cancelCalls).toBe(1)
  })

  it('Esc dismisses the finish toast', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await waitFor(() => expect(mock.runCalls).toHaveLength(1))
    await click(viewButton('Setup'))
    await finishRun(mock)
    expect(screen.getByRole('status', { name: 'Run finished' })).toBeDefined()
    await key({ key: 'Escape' })
    expect(screen.queryByRole('status', { name: 'Run finished' })).toBeNull()
  })

  it('a view switch that hides the focused control moves focus into the view shown', async () => {
    const mock = installMockBridge()
    const c = await renderApp(mock)
    const inShown = (): boolean => {
      const a = document.activeElement
      return !!a && a !== document.body && !a.closest('[hidden]') && !!a.closest('.view')
    }
    // Run (focused, on Setup) moves to Results.
    await pickSingle(mock, '/d/a.mzML')
    runButton().focus()
    await click(runButton())
    await waitFor(() => expect(mock.runCalls).toHaveLength(1))
    expect(shown(c)).toEqual(['results'])
    expect(inShown()).toBe(true)
    expect((document.activeElement as HTMLElement).closest('.view')?.getAttribute('data-view')).toBe('results')
    await finishRun(mock)
    // Ctrl+2 from a focused control on Setup.
    await click(viewButton('Setup'))
    ;(c.querySelector('.view[data-view="setup"] button') as HTMLElement).focus()
    await key({ key: '2', ctrlKey: true })
    expect(current()).toBe('results')
    expect(inShown()).toBe(true)
    // A drop of two spectra files moves to Batch.
    ;(c.querySelector('.view[data-view="results"]') as HTMLElement).querySelector<HTMLElement>('button, [tabindex]')?.focus()
    await act(async () => mock.emitDrop({ spectra: ['/d/x.mzML', '/d/y.mzML'], batch: true }))
    await flush()
    expect(shown(c)).toEqual(['batch'])
    expect(inShown()).toBe(true)
    expect((document.activeElement as HTMLElement).closest('.view')?.getAttribute('data-view')).toBe('batch')
  })

  it('opening a results file lands on Results', async () => {
    const mock = installMockBridge()
    const c = await renderApp(mock)
    mock.nextPickResults = '/d/x.tags.tsv'
    await act(async () => mock.emitMenu('open-results'))
    await flush()
    expect(shown(c)).toEqual(['results'])
    await waitFor(() => expect([...mock.resultsOpenCalls, ...mock.resultsQueryCalls.map((q) => q.path)]).toContain('/d/x.tags.tsv'))
  })

  it('adding batch files lands on Batch, which holds the queue and its Run', async () => {
    const mock = installMockBridge()
    const c = await renderApp(mock)
    mock.nextPickInputs = ['/d/a.mzML', '/d/b.mzML']
    await click(screen.getByRole('button', { name: /^Add files for a batch…$/ }))
    expect(shown(c)).toEqual(['batch'])
    const batch = c.querySelector<HTMLElement>('.view[data-view="batch"]')!
    expect(within(batch).getByRole('heading', { name: /Batch · 2 files/ })).toBeDefined()
    expect(within(batch).getByRole('button', { name: /^Run 2 remaining files/ })).toBeDefined()
  })

  it('History lists the recorded runs, newest first, and says so when there are none', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await click(viewButton('History'))
    expect(screen.getByText('Runs you start appear here.')).toBeDefined()
    mock.history = [
      {
        id: '2',
        input: '/d/b.mzML',
        outputs: ['/d/b.tags.tsv'],
        cwd: '/d',
        argv: ['/mock/FASTag', '-in', '/d/b.mzML'],
        status: 'failed',
        exitCode: 1,
        message: null,
        start: 1762419600000,
        end: 1762419641000,
        cleanup: { removed: [], renamed: [], failed: [] }
      },
      {
        id: '1',
        input: '/d/a.mzML',
        outputs: ['/d/a.tags.tsv'],
        cwd: '/d',
        argv: ['/mock/FASTag', '-in', '/d/a.mzML'],
        status: 'ok',
        exitCode: 0,
        message: null,
        start: 1762419500000,
        end: 1762419512000,
        cleanup: { removed: [], renamed: [], failed: [] }
      }
    ]
    await click(viewButton('Setup'))
    await click(viewButton('History'))
    const table = await screen.findByRole('table', { name: 'Run history' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((r) => within(r).getAllByRole('cell')[1].textContent)).toEqual(['b.mzML', 'a.mzML'])
    expect(rows[0].textContent).toMatch(/Failed/)
    expect(rows[1].textContent).toMatch(/Finished/)
    expect(rows[0].textContent).toMatch(/0:41/)
  })
})

describe('shell: Help panel', () => {
  it('opens beside the view, which stays shown; Close Help gives focus back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const c = await renderApp(installMockBridge())
    const helpBtn = screen.getByRole('button', { name: 'Help' })
    helpBtn.focus()
    await click(helpBtn)
    const panel = screen.getByRole('complementary', { name: 'Help' })
    expect(within(panel).getByRole('navigation', { name: 'Help pages' })).toBeDefined()
    expect(shown(c)).toEqual(['setup'])
    expect(screen.getByLabelText('Tag length tag_length')).toBeDefined()
    expect(helpBtn.getAttribute('aria-expanded')).toBe('true')
    await click(within(panel).getByRole('button', { name: 'Close Help' }))
    await act(async () => {
      vi.runAllTimers()
    })
    expect(screen.queryByRole('complementary', { name: 'Help' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Help' }))
    vi.useRealTimers()
  })

  it('searches the pages, the FAQ and the settings; a hit opens its entry', async () => {
    await renderApp(installMockBridge())
    await click(screen.getByRole('button', { name: 'Help' }))
    const box = screen.getByRole('searchbox', { name: 'Search Help' })
    await act(async () => {
      fireEvent.change(box, { target: { value: 'tag length' } })
    })
    const hits = screen.getByRole('list', { name: 'Search results' })
    const hit = within(hits)
      .getAllByRole('button')
      .find((b) => b.querySelector('.hit-title')?.textContent === 'Tag length')
    expect(hit).toBeDefined()
    await click(hit!)
    const entry = document.getElementById('param-tag_length') as HTMLDetailsElement
    expect(entry.open).toBe(true)
    expect((screen.getByRole('searchbox', { name: 'Search Help' }) as HTMLInputElement).value).toBe('')
    await act(async () => {
      fireEvent.change(screen.getByRole('searchbox', { name: 'Search Help' }), { target: { value: 'qqqzz' } })
    })
    expect(screen.getByText('Nothing in Help matches “qqqzz”.')).toBeDefined()
  })

  it('the FAQ menu opens Troubleshooting; About shows the version', async () => {
    const mock = installMockBridge()
    mock.binaryInfo = { ...mock.binaryInfo, version: '1.11.1' }
    await renderApp(mock)
    await act(async () => mock.emitMenu('faq'))
    await flush()
    const nav = screen.getByRole('navigation', { name: 'Help pages' })
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('Troubleshooting')
    await act(async () => closeHelp())
    await act(async () => mock.emitMenu('about'))
    const about = screen.getByRole('dialog', { name: 'About FASTag' })
    expect(about.textContent).toMatch(/1\.11\.1/)
    expect(about.textContent).toMatch(/OpenMS/)
    await click(within(about).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: 'About FASTag' })).toBeNull()
  })
})

describe('shell: drop routing', () => {
  it('one spectra file becomes the input; a FASTA and a taxonomy fill their fields', async () => {
    const mock = installMockBridge()
    const c = await renderApp(mock)
    await click(viewButton('History'))
    await act(async () => mock.emitDrop({ spectra: ['/d/drop.mzML'], fasta: '/d/h.fasta', taxdb: '/d/t.taxdb' }))
    await flush()
    expect(shown(c)).toEqual(['setup'])
    expect(runButton().textContent).toBe('Run on drop.mzML')
    expect((screen.getByLabelText(/Tags TSV/) as HTMLInputElement).value).toBe('/d/drop.tags.tsv')
    expect((c.querySelector('#p-fasta') as HTMLInputElement).value).toBe('/d/h.fasta')
    expect((c.querySelector('#p-taxdb') as HTMLInputElement).value).toBe('/d/t.taxdb')
  })

  it('two spectra files go to the batch queue', async () => {
    const mock = installMockBridge()
    const c = await renderApp(mock)
    await act(async () => mock.emitDrop({ spectra: ['/d/a.mzML', '/d/b.mzML'], batch: true }))
    await flush()
    expect(shown(c)).toEqual(['batch'])
    expect(screen.getByRole('heading', { name: /Batch · 2 files/ })).toBeDefined()
  })

  it('a tags table opens in Results, a digest report in its tab', async () => {
    const mock = installMockBridge()
    const c = await renderApp(mock)
    mock.reportFiles['/d/r.digest.tsv'] = 'run\tversion\t1.11.0\n'
    await act(async () =>
      mock.emitDrop({ results: '/d/r.tags.tsv', reports: [{ kind: 'digest', path: '/d/r.digest.tsv' }] })
    )
    await flush()
    expect(shown(c)).toEqual(['results'])
    expect(mock.reportCalls).toContain('/d/r.digest.tsv')
    expect(screen.getByRole('tab', { selected: true }).id).toBe('tab-digest')
    await click(c.querySelector('#tab-results')!)
    await waitFor(() => expect(mock.resultsOpenCalls.concat(mock.resultsQueryCalls.map((q) => q.path))).toContain('/d/r.tags.tsv'))
  })

  it('says what it did not take; takes nothing while a run is on', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await act(async () => mock.emitDrop({ ignored: ['/d/readme.txt'] }))
    expect(screen.getByRole('alert').textContent).toMatch(/readme\.txt/)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await waitFor(() => expect(mock.runCalls).toHaveLength(1))
    await act(async () => mock.emitDrop({ spectra: ['/d/other.mzML'] }))
    expect(screen.getByRole('alert').textContent).toMatch(/while FASTag runs/)
    await click(viewButton('Setup'))
    expect(screen.getByRole('button', { name: /^Running…$/ })).toBeDefined()
    expect(mock.runCalls).toHaveLength(1)
  })

  it('shows the drop target while files are dragged over the window', async () => {
    const mock = installMockBridge()
    const c = await renderApp(mock)
    await act(async () => mock.emitDragHover(true))
    expect(c.querySelector('.drop-overlay')).not.toBeNull()
    await act(async () => mock.emitDragHover(false))
    expect(c.querySelector('.drop-overlay')).toBeNull()
  })
})

describe('shell: finish', () => {
  it('a finished run notifies the system when the window is in the background, and offers Open results', async () => {
    const mock = installMockBridge()
    const c = await renderApp(mock)
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await waitFor(() => expect(mock.runCalls).toHaveLength(1))
    await click(viewButton('Setup'))
    await finishRun(mock)
    expect(mock.notifyCalls).toHaveLength(1)
    expect(mock.notifyCalls[0].title).toBe('a.mzML finished')
    const toast = screen.getByRole('status', { name: 'Run finished' })
    await click(within(toast).getByRole('button', { name: 'Open results' }))
    expect(shown(c)).toEqual(['results'])
    expect(screen.queryByRole('status', { name: 'Run finished' })).toBeNull()
  })

  it('no system notification while the window has focus; a failure says so', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await waitFor(() => expect(mock.runCalls).toHaveLength(1))
    await click(viewButton('Setup'))
    await finishRun(mock, false)
    expect(mock.notifyCalls).toHaveLength(0)
    expect(screen.getByRole('status', { name: 'Run finished' }).textContent).toMatch(/a\.mzML failed/)
  })

  it('a cancelled run neither notifies nor toasts', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await waitFor(() => expect(mock.runCalls).toHaveLength(1))
    await click(within(pill()).getByRole('button', { name: 'Cancel' }))
    await act(async () => mock.emitDone({ ok: false, code: null, cancelled: true, runId: mock.lastRunId }))
    await flush()
    expect(mock.notifyCalls).toHaveLength(0)
    expect(screen.queryByRole('status', { name: 'Run finished' })).toBeNull()
  })
})

// A batch's finish, watched from History: the toast offers Open batch there,
// and History reads the record again (historyList) when a pass ends.
describe('shell: batch finish', () => {
  const toastText = (): string | null => screen.queryByRole('status', { name: 'Run finished' })?.textContent ?? null
  async function pass(mock: MockBridge, outcomes: boolean[], start: () => Promise<void>): Promise<void> {
    await start()
    await click(viewButton('History'))
    for (let i = 0; i < outcomes.length; i++) {
      const n = mock.runCalls.length
      await waitFor(() => expect(mock.runCalls.length).toBeGreaterThan(0))
      const ok = outcomes[i]
      await act(async () => mock.emitDone({ ok, code: ok ? 0 : 1, runId: mock.lastRunId }))
      await flush()
      if (i < outcomes.length - 1) await waitFor(() => expect(mock.runCalls.length).toBe(n + 1))
    }
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Running batch…' })).toBeNull())
    await flush()
  }
  const retry = (): Promise<void> => {
    fireEvent.click(viewButton('Batch'))
    return click(screen.getByRole('button', { name: /^Retry failed/ }))
  }
  async function setup(files: string[]): Promise<{ mock: MockBridge; reads: () => number }> {
    const mock = installMockBridge()
    await renderApp(mock)
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    const list = vi.spyOn(window.fastag, 'historyList')
    await addBatch(mock, files)
    return { mock, reads: () => list.mock.calls.length }
  }

  it('all done: Batch finished, notified, toast, History read again', async () => {
    const { mock, reads } = await setup(['/d/a.mzML', '/d/b.mzML'])
    await pass(mock, [true, true], startBatch)
    expect(mock.notifyCalls).toEqual([{ title: 'Batch finished', body: '2 of 2 files finished.' }])
    expect(toastText()).toMatch(/Batch finished/)
    expect(within(screen.getByRole('status', { name: 'Run finished' })).getByRole('button', { name: 'Open batch' })).toBeDefined()
    // Once on entering History, once more when the pass ended.
    expect(reads()).toBeGreaterThanOrEqual(2)
  })

  it('some failed: the title counts them', async () => {
    const { mock, reads } = await setup(['/d/a.mzML', '/d/b.mzML'])
    await pass(mock, [false, true], startBatch)
    expect(mock.notifyCalls).toEqual([{ title: 'Batch done, 1 of 2 failed', body: '1 of 2 files finished.' }])
    expect(toastText()).toMatch(/Batch done, 1 of 2 failed/)
    expect(reads()).toBeGreaterThanOrEqual(2)
  })

  it('Retry failed whose job fails again still notifies, toasts and bumps History', async () => {
    const { mock, reads } = await setup(['/d/a.mzML', '/d/b.mzML'])
    await pass(mock, [false, true], startBatch)
    await click(screen.getByRole('button', { name: 'Dismiss' }))
    const before = reads()
    await pass(mock, [false], retry)
    expect(mock.notifyCalls).toHaveLength(2)
    expect(mock.notifyCalls[1]).toEqual({ title: 'Batch done, 1 of 1 failed', body: '0 of 1 file finished.' })
    expect(toastText()).toMatch(/Batch done, 1 of 1 failed/)
    expect(reads()).toBeGreaterThan(before)
  })

  it('Retry failed with mixed results counts both jobs it ran', async () => {
    const { mock, reads } = await setup(['/d/a.mzML', '/d/b.mzML', '/d/c.mzML'])
    await pass(mock, [false, false, true], startBatch)
    await click(screen.getByRole('button', { name: 'Dismiss' }))
    const before = reads()
    await pass(mock, [false, true], retry)
    expect(mock.notifyCalls).toHaveLength(2)
    expect(mock.notifyCalls[1]).toEqual({ title: 'Batch done, 1 of 2 failed', body: '1 of 2 files finished.' })
    expect(toastText()).toMatch(/Batch done, 1 of 2 failed/)
    expect(reads()).toBeGreaterThan(before)
  })
})

describe('shell: themes', () => {
  it('the theme button and the View menu set data-theme; System removes it', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    const btn = (): HTMLElement => screen.getByRole('button', { name: /^Theme: / })
    expect(btn().getAttribute('aria-label')).toBe('Theme: System')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    await click(btn())
    expect(document.documentElement.dataset.theme).toBe('light')
    await click(btn())
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(btn().getAttribute('aria-label')).toBe('Theme: Dark')
    await act(async () => mock.emitMenu('theme-light'))
    expect(document.documentElement.dataset.theme).toBe('light')
    await act(async () => mock.emitMenu('theme-system'))
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(btn().getAttribute('aria-label')).toBe('Theme: System')
  })
})
