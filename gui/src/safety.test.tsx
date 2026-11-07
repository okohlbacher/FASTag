// P0a "safety fixes" (GUI-DESIGN section 10): the row cap and per-frame
// scroll requests of the tags table, one log per batch job, partial outputs
// removed after a cancel or failure, the close guard's question, last-used
// as an offer only (D6), and the open buttons locked while a run writes.

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ResultsTable, { MAX_DOM_ROWS } from './ResultsTable'
import { installMockBridge, type MockBridge } from './testing/mockBridge'
import { addBatch, click, goTo, logText, pickSingle, renderApp, runButton } from './testing/render'
import { applyLastUsed, formValue } from './testing/lastUsed'
import type { ResultsPage, RunRecord } from './types'

const drawerLabel = (c: HTMLElement): string => c.querySelector('.drawer-toggle .lbl')?.textContent ?? ''

describe('P0a: last-used is an offer, never applied on its own (D6)', () => {
  it('a fresh start runs with the defaults; the chip names what it would change and applies it on click', async () => {
    const mock = installMockBridge()
    mock.settings.lastUsed = { tag_length: '7', species: true, max_tags: '50', version: '9.9' }
    await renderApp()
    // Nothing applied: the form shows FASTag's defaults.
    expect(await formValue('tag_length')).toBe('3')
    expect(await formValue('species')).toBe(false)
    const chip = screen.getByRole('button', { name: 'Apply last-used (2)' }) // max_tags 50 is the default; version is not rendered
    expect(chip.getAttribute('title')).toBe('The settings of your last run: -tag_length 7 -species')
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    expect(mock.runCalls[0].params['tag_length']).toBe('3')
    expect(mock.runCalls[0].params['species']).toBe(false)
    await act(async () => mock.emitDone({ ok: true, code: 0, runId: 1 }))

    await applyLastUsed(2)
    expect(await formValue('tag_length')).toBe('7')
    expect(await formValue('species')).toBe(true)
    await click(runButton())
    expect(mock.runCalls[1].params['tag_length']).toBe('7')
    expect(mock.runCalls[1].params['species']).toBe(true)
  })

  it('applied after an input is chosen, the last session report paths move beside the new tags output', async () => {
    const mock = installMockBridge()
    mock.settings.lastUsed = { digest_out: '/old/x.digest.tsv' }
    await renderApp()
    await pickSingle(mock, '/d/b.mzML')
    await applyLastUsed(1)
    expect(await formValue('digest_out')).toBe('/d/b.digest.tsv')
  })

  it('offers nothing when the last session ran with the defaults, or there was none', async () => {
    const mock = installMockBridge()
    mock.settings.lastUsed = { tag_length: '3', species: false }
    await renderApp()
    expect(screen.queryByRole('button', { name: /^Apply last-used/ })).toBeNull()
    expect(await formValue('tag_length')).toBe('3')
  })
})

describe('P0a: one log per batch job', () => {
  async function batchWhereB_Fails(): Promise<{ mock: MockBridge; c: HTMLElement }> {
    const mock = installMockBridge()
    const c = await renderApp()
    await addBatch(mock, ['/d/a.mzML', '/d/b.mzML', '/d/c.mzML'])
    await click(screen.getByRole('button', { name: /^Run 3 remaining files$/ }))
    await act(async () => mock.emitLog('a: reading spectra'))
    await act(async () => mock.emitDone({ ok: true, code: 0, runId: 1 }))
    await waitFor(() => expect(mock.runCalls).toHaveLength(2))
    await act(async () => mock.emitLog('b: Error: Unable to read file b.mzML'))
    await act(async () => mock.emitDone({ ok: false, code: 1, runId: 2 }))
    await waitFor(() => expect(mock.runCalls).toHaveLength(3))
    await act(async () => mock.emitLog('c: reading spectra'))
    await act(async () => mock.emitLog('c: 4 MS2 spectra, 1 tags'))
    await act(async () => mock.emitDone({ ok: true, code: 0, runId: 3 }))
    await screen.findByRole('alert')
    return { mock, c }
  }

  it('after run03 finished, the banner of the failed run02 opens run02 own log', async () => {
    const { c } = await batchWhereB_Fails()
    // The live log is run03's.
    expect(logText(c)).toContain('c: 4 MS2 spectra')
    expect(logText(c)).not.toContain('b: Error')
    await click(screen.getByRole('button', { name: 'Show full log' }))
    expect((c.querySelector('pre.log') as HTMLElement).hidden).toBe(false)
    expect(drawerLabel(c)).toBe('Log of b.mzML')
    expect(logText(c)).toContain('b: Error: Unable to read file b.mzML')
    expect(logText(c)).toContain('— failed (exit code 1) —')
    expect(logText(c)).not.toContain('c: ')
    expect(logText(c)).not.toContain('a: ')
    // Back to the live log.
    await click(screen.getByRole('button', { name: 'Show the current log' }))
    expect(drawerLabel(c)).toBe('Log')
    expect(logText(c)).toContain('c: 4 MS2 spectra')
  })

  it('each run job row has a Log button for its own log', async () => {
    const { c } = await batchWhereB_Fails()
    const logButtons = [...c.querySelectorAll('li.job button.jlog')].map((b) => b.getAttribute('aria-label'))
    expect(logButtons).toEqual(['Log of a.mzML', 'Log of b.mzML', 'Log of c.mzML'])
    await click(screen.getByRole('button', { name: 'Log of a.mzML' }))
    expect(drawerLabel(c)).toBe('Log of a.mzML')
    expect(logText(c)).toContain('a: reading spectra')
    expect(logText(c)).not.toContain('b: ')
    await click(screen.getByRole('button', { name: 'Log of c.mzML' }))
    expect(logText(c)).toContain('c: 4 MS2 spectra')
  })

  it('with two failed jobs each reason links its own log', async () => {
    const mock = installMockBridge()
    const c = await renderApp()
    await addBatch(mock, ['/d/a.mzML', '/d/b.mzML'])
    await click(screen.getByRole('button', { name: /^Run 2 remaining files$/ }))
    await act(async () => mock.emitLog('a: Error: one'))
    await act(async () => mock.emitDone({ ok: false, code: 1, runId: 1 }))
    await waitFor(() => expect(mock.runCalls).toHaveLength(2))
    await act(async () => mock.emitLog('b: Error: two'))
    await act(async () => mock.emitDone({ ok: false, code: 2, runId: 2 }))
    await screen.findByRole('alert')
    // "Show full log" opens the first failed job's log; each reason its own.
    await click(screen.getByRole('button', { name: 'Show full log' }))
    expect(logText(c)).toContain('a: Error: one')
    await click(within(screen.getByRole('alert')).getByRole('button', { name: 'Log of b.mzML' }))
    expect(drawerLabel(c)).toBe('Log of b.mzML')
    expect(logText(c)).toContain('b: Error: two')
    expect(logText(c)).not.toContain('a: Error')
  })
})

describe('P0a: partial outputs after a cancel or failure', () => {
  it('a cancelled run whose outputs the backend removed says so, and offers no "Open it anyway"', async () => {
    const mock = installMockBridge()
    const c = await renderApp()
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await act(async () => mock.emitDone({ ok: true, code: 0, runId: 1 }))
    await screen.findByText('Showing 3 of 3')
    // Re-run into the same -out, then cancel: the backend deleted it.
    await click(runButton())
    await click(screen.getByRole('button', { name: 'Cancel' }))
    await act(async () =>
      mock.emitDone({
        ok: false,
        code: null,
        cancelled: true,
        runId: 2,
        cleanup: { removed: ['/d/a.tags.tsv', '/d/a.digest.tsv'], renamed: [], failed: [] }
      })
    )
    const panel = c.querySelector('.tabpanel')?.textContent ?? ''
    expect(panel).toContain('Removed.')
    expect(panel).toContain('/d/a.tags.tsv no longer exists')
    expect(screen.queryByRole('button', { name: 'Open it anyway' })).toBeNull()
    expect(logText(c)).toContain('Removed the partial output /d/a.tags.tsv')
    expect(logText(c)).toContain('Removed the partial output /d/a.digest.tsv')
    expect(c.querySelector('.last-run')?.textContent).toMatch(/Cancelled .* · partial outputs removed/)
    expect(c.querySelector('[role="status"].sr-only')?.textContent).toBe('Cancelled a.mzML, partial outputs removed.')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('names a renamed and an unremovable output in the log', async () => {
    const mock = installMockBridge()
    const c = await renderApp()
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await act(async () =>
      mock.emitDone({
        ok: false,
        code: 1,
        runId: 1,
        cleanup: { removed: [], renamed: ['/d/a.tags.tsv.incomplete'], failed: ['/d/a.digest.tsv'] }
      })
    )
    expect(logText(c)).toContain('Could not remove a partial output; renamed it to /d/a.tags.tsv.incomplete')
    expect(logText(c)).toContain('Could not remove the partial output /d/a.digest.tsv: it may be incomplete')
  })

  it('a cancelled batch job with removed outputs says so in its row', async () => {
    const mock = installMockBridge()
    const c = await renderApp()
    await addBatch(mock, ['/d/a.mzML'])
    await click(screen.getByRole('button', { name: /^Run 1 remaining file$/ }))
    await click(screen.getByRole('button', { name: 'Cancel' }))
    await act(async () =>
      mock.emitDone({ ok: false, code: null, cancelled: true, runId: 1, cleanup: { removed: ['/d/a.tags.tsv'], renamed: [], failed: [] } })
    )
    expect(c.querySelector('li.job.cancelled')?.textContent).toContain('Cancelled by you, partial outputs removed')
  })
})

describe('P0a: existing outputs are confirmed before the run, never after', () => {
  const rec = (status: 'ok' | 'cancelled' | 'failed', out: string): RunRecord => ({
    id: '1-1',
    input: '/d/a.mzML',
    outputs: [out],
    cwd: '/d',
    argv: ['FASTag', '-in', '/d/a.mzML', '-out', out],
    status,
    exitCode: status === 'ok' ? 0 : null,
    message: status === 'cancelled' ? 'cancelled' : null,
    start: Date.UTC(2026, 10, 5, 9, 0, 0),
    end: Date.UTC(2026, 10, 5, 9, 1, 30),
    cleanup: { removed: status === 'ok' ? [] : ['/d/a.digest.tsv'], renamed: [], failed: [] }
  })

  it('asks before a run over an existing -out; "Don\'t run" runs nothing', async () => {
    const mock = installMockBridge()
    mock.existingOutputs = ['/d/a.tags.tsv']
    await renderApp()
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    const ask = screen.getByRole('alertdialog')
    expect(ask.textContent).toContain('An output already exists')
    expect(ask.textContent).toContain('/d/a.tags.tsv')
    expect(ask.textContent).toContain('If it is cancelled or fails, it is removed, not restored.')
    expect(mock.runCalls).toHaveLength(0)
    await click(within(ask).getByRole('button', { name: "Don't run" }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(mock.runCalls).toHaveLength(0)
    expect(mock.savedLast).toHaveLength(0)
  })

  it('"Overwrite and run" sends overwrite: true; with nothing on disk no question and no overwrite flag', async () => {
    const mock = installMockBridge()
    mock.existingOutputs = ['/d/a.tags.tsv']
    await renderApp()
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Overwrite and run' }))
    expect(mock.runCalls).toHaveLength(1)
    expect(mock.runCalls[0].overwrite).toBe(true)
    // The check saw what run() is given.
    expect(mock.outputsCheckCalls[0]).toEqual({ in: '/d/a.mzML', out: mock.runCalls[0].out, params: mock.runCalls[0].params })
    await act(async () => mock.emitDone({ ok: true, code: 0, runId: 1 }))
    mock.existingOutputs = []
    await click(runButton())
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(mock.runCalls).toHaveLength(2)
    expect('overwrite' in mock.runCalls[1]).toBe(false)
  })

  it('a batch asks once, for the existing outputs of all its jobs, before its first job', async () => {
    const mock = installMockBridge()
    mock.existingOutputs = ['/d/a.tags.tsv', '/d/c.tags.tsv']
    await renderApp()
    await addBatch(mock, ['/d/a.mzML', '/d/b.mzML', '/d/c.mzML'])
    await click(screen.getByRole('button', { name: /^Run 3 remaining files$/ }))
    const ask = screen.getByRole('alertdialog')
    expect(ask.textContent).toContain('2 outputs already exist')
    expect(ask.textContent).toContain('/d/a.tags.tsv')
    expect(ask.textContent).toContain('/d/c.tags.tsv')
    expect(mock.outputsCheckCalls.map((c) => c.in)).toEqual(['/d/a.mzML', '/d/b.mzML', '/d/c.mzML'])
    expect(mock.runCalls).toHaveLength(0)
    await click(within(ask).getByRole('button', { name: 'Overwrite and run' }))
    expect(mock.runCalls).toHaveLength(1)
    expect(mock.runCalls[0].overwrite).toBe(true)
  })

  it('declining a batch leaves its jobs queued and Run enabled', async () => {
    const mock = installMockBridge()
    mock.existingOutputs = ['/d/a.tags.tsv']
    const c = await renderApp()
    await addBatch(mock, ['/d/a.mzML'])
    await click(screen.getByRole('button', { name: /^Run 1 remaining file$/ }))
    await click(within(screen.getByRole('alertdialog')).getByRole('button', { name: "Don't run" }))
    expect(mock.runCalls).toHaveLength(0)
    expect(c.querySelector('li.job.queued')).not.toBeNull()
    expect((screen.getByRole('button', { name: /^Run 1 remaining file$/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('after a restart, the last run reads as cancelled from the run record', async () => {
    const mock = installMockBridge()
    mock.history = [rec('cancelled', '/d/a.tags.tsv')]
    const c = await renderApp()
    const last = c.querySelector('.last-run')?.textContent ?? ''
    expect(last).toContain('a.mzML')
    expect(last).toMatch(/Cancelled in an earlier session, .* · 1:30 · partial outputs removed/)
    expect(c.querySelector('.last-run-name.cancelled')).not.toBeNull()
    // Its parameters are not known: no "all defaults" claim.
    expect(c.querySelector('.last-run-params')).toBeNull()
  })

  it('a tags file whose recorded run was cancelled opens as incomplete, not as a table', async () => {
    const mock = installMockBridge()
    mock.history = [rec('cancelled', '/d/a.tags.tsv')]
    const c = await renderApp()
    mock.nextPickResults = '/d/a.tags.tsv'
    await goTo('results') // the empty Tags pane (P2a: its own view)
    await click(screen.getByRole('button', { name: 'Open a tags TSV…' }))
    const panel = c.querySelector('.tabpanel')?.textContent ?? ''
    expect(panel).toContain('The run that wrote /d/a.tags.tsv was cancelled')
    expect(mock.resultsQueryCalls).toHaveLength(0)
    await click(screen.getByRole('button', { name: 'Open it anyway' }))
    await screen.findByText('Showing 3 of 3')
  })

  it('a tags file whose recorded run finished opens as usual', async () => {
    const mock = installMockBridge()
    mock.history = [rec('ok', '/d/a.tags.tsv')]
    await renderApp()
    mock.nextPickResults = '/d/a.tags.tsv'
    await goTo('results') // the empty Tags pane (P2a: its own view)
    await click(screen.getByRole('button', { name: 'Open a tags TSV…' }))
    await screen.findByText('Showing 3 of 3')
  })
})

describe('P0a: close guard', () => {
  it('asks "Cancel run and quit" or "Keep running" when the backend prevented a quit', async () => {
    const mock = installMockBridge()
    await renderApp()
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await act(async () => mock.emitCloseRequested('quit'))
    const dlg = screen.getByRole('alertdialog')
    expect(dlg.textContent).toMatch(/Quitting stops the run, and removes the files it has written so far/)
    expect(document.activeElement?.textContent).toBe('Keep running') // the safe answer has focus
    await click(screen.getByRole('button', { name: 'Keep running' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(mock.closeAnswers).toEqual([false])
    expect(mock.cancelCalls).toBe(0) // still running
    await goTo('setup') // the run bar (P2a: a run moves to Results)
    expect(screen.getByRole('button', { name: 'Running…' })).toBeDefined()

    await act(async () => mock.emitCloseRequested('close'))
    expect(screen.getByRole('alertdialog').textContent).toMatch(/Closing the window stops the run/)
    await click(screen.getByRole('button', { name: 'Cancel run and quit' }))
    expect(mock.closeAnswers).toEqual([false, true])
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('"Cancel run and quit" during a batch starts no further job', async () => {
    const mock = installMockBridge()
    await renderApp()
    await addBatch(mock, ['/d/a.mzML', '/d/b.mzML'])
    await click(screen.getByRole('button', { name: /^Run 2 remaining files$/ }))
    expect(mock.busyCalls[mock.busyCalls.length - 1]).toBe(true) // the backend knows a batch is on
    await act(async () => mock.emitCloseRequested('quit'))
    expect(screen.getByRole('alertdialog').textContent).toMatch(/and the rest of the batch/)
    await click(screen.getByRole('button', { name: 'Cancel run and quit' }))
    await act(async () => mock.emitDone({ ok: false, code: null, cancelled: true, runId: 1 }))
    await waitFor(() => expect(mock.busyCalls[mock.busyCalls.length - 1]).toBe(false))
    expect(mock.runCalls).toHaveLength(1)
  })
})

describe('P0a: open buttons while busy', () => {
  it('the empty pane cannot open a tags file or a report while a run writes', async () => {
    const mock = installMockBridge()
    await renderApp()
    const openTags = (): HTMLButtonElement => screen.getByRole('button', { name: 'Open a tags TSV…' }) as HTMLButtonElement
    const openReport = (): HTMLButtonElement =>
      screen.getByRole('button', { name: 'Open a digest, label or mass-gap report…' }) as HTMLButtonElement
    await goTo('results') // the empty Tags pane (P2a: its own view)
    expect(openTags().disabled).toBe(false)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await goTo('results')
    expect(openTags().disabled).toBe(true)
    expect(openReport().disabled).toBe(true)
    mock.nextPickResults = '/d/other.tags.tsv'
    await click(openTags())
    expect(mock.resultsQueryCalls).toHaveLength(0)
    await act(async () => mock.emitDone({ ok: false, code: 6, runId: 1 }))
    expect(openTags().disabled).toBe(false)
    expect(openReport().disabled).toBe(false)
  })
})

describe('P0a: tags table row cap and scroll requests', () => {
  afterEach(() => {
    // The override below shadows jsdom's Element.prototype.clientHeight.
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
    vi.restoreAllMocks()
  })

  // A 10 M-row file, served page by page without building it.
  function tenMillion(mock: MockBridge): void {
    const N = 10_000_000
    mock.resultsQuery = (path, view, offset, limit): Promise<ResultsPage> => {
      mock.resultsQueryCalls.push({ path, view, offset, limit })
      const rows: string[][] = []
      for (let i = offset; i < Math.min(N, offset + limit); i++) rows.push([`scan=${i}`, 'PEPTK', '5', '0.01', '-'])
      return Promise.resolve({ columns: mock.resultsColumns, totalRows: N, matchedRows: N, rows })
    }
  }

  it(`never puts more than ${MAX_DOM_ROWS} rows in the DOM, even when the scroller reports the whole canvas`, async () => {
    // The old stacked layout gave the scroller no definite height: it
    // reported its content, 15 M px, and every row of the window was drawn.
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('rt-scroll') ? 15_000_028 : 0
      }
    })
    const mock = installMockBridge()
    tenMillion(mock)
    const { container } = render(<ResultsTable path="/d/big.tags.tsv" />)
    await screen.findByText('Showing 10,000,000 of 10,000,000')
    await waitFor(() => expect(container.querySelector('.rt-row .rt-cell:not(.dim)')).not.toBeNull())
    expect(container.querySelectorAll('.rt-row').length).toBe(MAX_DOM_ROWS)
    // A window of 200 rows needs at most one 500-row page (two at a seam).
    expect(mock.resultsQueryCalls.length).toBeLessThanOrEqual(2)
  })

  it('coalesces a fling to one update and at most one page request per animation frame, for the latest position', async () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb)
      return frames.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    const runFrame = (): Promise<void> =>
      act(async () => {
        const now = frames.splice(0)
        now.forEach((cb) => cb(performance.now()))
      })
    const mock = installMockBridge()
    tenMillion(mock)
    const { container } = render(<ResultsTable path="/d/big.tags.tsv" />)
    await screen.findByText('Showing 10,000,000 of 10,000,000')
    await runFrame()
    const before = mock.resultsQueryCalls.length
    const sc = container.querySelector('.rt-scroll') as HTMLElement
    // A fling: 40 scroll events inside one frame, ending far down the file.
    await act(async () => {
      for (let k = 1; k <= 40; k++) {
        sc.scrollTop = k * 250_000
        fireEvent.scroll(sc)
      }
    })
    expect(mock.resultsQueryCalls.length).toBe(before) // nothing until the frame
    await runFrame()
    // One request, for where the fling ended, not for the 39 positions it passed.
    expect(mock.resultsQueryCalls.length).toBe(before + 1)
    const firstShown = (): string | null | undefined => container.querySelector('.rt-row .rt-cell')?.textContent
    const offset = mock.resultsQueryCalls[mock.resultsQueryCalls.length - 1].offset
    await waitFor(() => expect(firstShown()).toMatch(/^scan=\d+$/))
    const shown = Number(firstShown()!.slice(5))
    expect(shown).toBeGreaterThanOrEqual(offset)
    expect(shown).toBeLessThan(offset + 500)
    // Every later frame sends at most one request.
    for (let f = 0; f < 5; f++) {
      const n = mock.resultsQueryCalls.length
      await act(async () => {
        sc.scrollTop = 14_000_000 - f * 3_000_000
        fireEvent.scroll(sc)
      })
      await runFrame()
      await runFrame()
      expect(mock.resultsQueryCalls.length - n).toBeLessThanOrEqual(2)
    }
  })
})
