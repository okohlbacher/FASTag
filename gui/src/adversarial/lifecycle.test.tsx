// Run lifecycle: what the GUI shows before, during and after a run, driven
// through the mock bridge.
// CLI line sequences are copied from real FASTag 1.9.0 runs on the public
// E. coli fixture (scratch/lifecycle/*_combined.txt).

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { installMockBridge, type MockBridge } from '../testing/mockBridge'
import type { SpeciesReport } from '../types'

async function renderApp(mock: MockBridge): Promise<HTMLElement> {
  const { container } = render(<App />)
  await screen.findByText('FASTag ready')
  await act(async () => {})
  return container
}
const click = (el: Element): Promise<void> =>
  act(async () => {
    fireEvent.click(el)
  })
const logText = (c: HTMLElement): string => c.querySelector('.log')?.textContent ?? ''
const runButton = (): HTMLElement => screen.getByRole('button', { name: /^(Run( on .+)?|Running…)$/ })
async function pickSingle(mock: MockBridge, path: string): Promise<void> {
  mock.nextPickInput = path
  await click(screen.getByRole('button', { name: /^(Choose file|Change)…$/ }))
}
async function addBatch(mock: MockBridge, files: string[]): Promise<void> {
  mock.nextPickInputs = files
  await click(screen.getByRole('button', { name: /^(Add files for a batch|Add)…$/ }))
}
const done = (mock: MockBridge, runId: number, ok: boolean, code: number | null = ok ? 0 : 1): Promise<void> =>
  act(async () => mock.emitDone({ ok, code, runId }))
const log = (mock: MockBridge, line: string): Promise<void> => act(async () => mock.emitLog(line))

const speciesA: SpeciesReport = {
  path: '/d/a.tags.species.tsv',
  taxa: [{ rank: 'genus', taxid: 561, name: 'Escherichia', observed: 7, adjusted: 7, q: 1e-13 }]
}

describe('lifecycle: failure banner', () => {
  it('a FASTag refusal, not the trailing "FASTag took" timing line, is quoted in the banner', async () => {
    // Real 1.9.0 output of `-species` with the default tag_length 3 (rc 6),
    // stdout and stderr merged in write order (c1_combined.txt).
    const mock = installMockBridge()
    await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await log(mock, '-threads 0: using 8 of 16 logical cores.')
    await log(
      mock,
      '-species: tag_length (3) + 2*extension (0) = 3 cannot reach the index k = 7, so every tag would be too short to look up and the report would be empty. Set -tag_length 7 (or raise -extension).'
    )
    await log(mock, 'FASTag took 0.00 s (wall), 0.00 s (CPU), 0.00 s (system), 0.00 s (user); Peak Memory Usage: 39 MB.')
    await done(mock, 1, false, 6)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain("a.mzML failed (exit code 6)FASTag's reason:-species: tag_length (3)")
    expect(alert.textContent).toContain('cannot reach the index')
    expect(alert.textContent).not.toContain('FASTag took')
  })

  it('same for -massgap_out without -recon_out (the case App.test pins without the timing line)', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await log(mock, '-massgap_out requires -recon_out (the gaps are those of the reconciliations, as in -delta_out).')
    await log(mock, 'FASTag took 0.01 s (wall), 0.03 s (CPU), 0.00 s (system), 0.03 s (user); Peak Memory Usage: 57 MB.')
    await done(mock, 1, false, 6)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('requires -recon_out')
    expect(alert.textContent).not.toContain('Peak Memory Usage')
  })

  it('a batch job failure keeps its reason although the next job clears the log', async () => {
    const mock = installMockBridge()
    const c = await renderApp(mock)
    await addBatch(mock, ['/d/a.mzML', '/d/b.mzML'])
    await click(screen.getByRole('button', { name: /^Run \d+ remaining file/ }))
    await log(mock, 'Error: File not found (the file /d/a.mzML could not be found)')
    await done(mock, 1, false, 1)
    await waitFor(() => expect(mock.runCalls).toHaveLength(2))
    await done(mock, 2, true)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(
      "1 of 2 batch jobs faileda.mzML (exit code 1)FASTag's reason:Error: File not found (the file /d/a.mzML could not be found)What to doShow full logCopy command"
    )
    expect(logText(c)).not.toContain('File not found') // the log is job b's
    expect(c.querySelector('li.job.failed .st')?.getAttribute('title')).toContain('File not found')
  })

  it('a cancelled batch job is marked cancelled, not failed, and Cancel is sent once', async () => {
    const mock = installMockBridge()
    const c = await renderApp(mock)
    await addBatch(mock, ['/d/a.mzML', '/d/b.mzML'])
    await click(screen.getByRole('button', { name: /^Run \d+ remaining file/ }))
    await click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true)
    await click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mock.cancelCalls).toBe(1)
    await done(mock, 1, false, null)
    await waitFor(() => expect(screen.getByRole('button', { name: /^Run \d+ remaining file/ })).toBeDefined())
    expect(c.querySelector('li.job.failed')).toBeNull()
    expect(c.querySelector('li.job.cancelled')?.textContent).toContain('a.mzML')
    expect(c.querySelector('li.job.cancelled .st')?.getAttribute('aria-label')).toBe('cancelled')
    expect(logText(c)).toContain('— cancelled')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('lifecycle: stale state across runs', () => {
  it('a run on sample B clears sample A species calls, and the pane names its input', async () => {
    const mock = installMockBridge()
    mock.settings.lastUsed = { species: true, tag_length: '7' }
    mock.speciesResult = speciesA
    await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await done(mock, 1, true)
    await waitFor(() => expect(screen.queryAllByText('Escherichia').length).toBeGreaterThan(0))

    await pickSingle(mock, '/d/b.mzML')
    await click(runButton())
    // While B runs, A's species table is gone.
    expect(screen.queryAllByText('Escherichia')).toHaveLength(0)
    await done(mock, 2, false, 6)
    await screen.findByRole('alert')
    expect(screen.getByRole('tab', { name: /Species/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryAllByText('Escherichia')).toHaveLength(0)
    expect(document.querySelector('.tabpanel')?.textContent).toContain('Species of /d/b.mzML')
    expect(document.querySelector('.path')?.getAttribute('title')).toBe('/d/b.mzML')
  })

  it('a rejecting species read clears the previous species and still reads the Digest reports', async () => {
    const mock = installMockBridge()
    mock.settings.lastUsed = { species: true, tag_length: '7', digest_out: '/r/a.digest.tsv' }
    mock.speciesResult = speciesA
    await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await done(mock, 1, true)
    await waitFor(() => expect(screen.queryAllByText('Escherichia').length).toBeGreaterThan(0))
    const reportReadsAfterA = mock.reportCalls.length

    await pickSingle(mock, '/d/b.mzML')
    mock.speciesError = new Error('species.tsv: permission denied')
    await click(runButton())
    await done(mock, 2, true)
    await waitFor(() => expect(document.querySelector('.log')?.textContent).toContain('permission denied'))
    expect(mock.reportCalls.length).toBe(reportReadsAfterA + 1)
    expect(mock.reportCalls[mock.reportCalls.length - 1]).toBe('/d/b.digest.tsv') // beside B's tags
    await click(screen.getByRole('tab', { name: /Species/ }))
    expect(screen.queryAllByText('Escherichia')).toHaveLength(0)
  })

  it('the Species tab follows the run, not the form: unticking keeps the report, re-ticking shows no stale one', async () => {
    const mock = installMockBridge()
    mock.settings.lastUsed = { species: true, tag_length: '7' }
    mock.speciesResult = speciesA
    await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await done(mock, 1, true)
    await waitFor(() => expect(screen.queryAllByText('Escherichia').length).toBeGreaterThan(0))
    // Unticking species after A's run keeps A's report: it is what A's run did.
    await click(screen.getByRole('button', { name: /Species detection/ }))
    const speciesBox = document.getElementById('p-species') as HTMLInputElement
    await act(async () => {
      fireEvent.click(speciesBox)
    })
    expect(screen.queryByText(/Species detection is off/)).toBeNull()
    expect(screen.queryAllByText('Escherichia').length).toBeGreaterThan(0)
    expect(screen.getByRole('tab', { name: /Species/ }).textContent).toBe('Species1')
    // Run B with species off: A's report is cleared, and the badge with it.
    await pickSingle(mock, '/d/b.mzML')
    await click(runButton())
    await done(mock, 2, true)
    expect(screen.getByRole('tab', { name: /Species/ }).textContent).toBe('Species')
    await act(async () => {
      fireEvent.click(document.getElementById('p-species') as HTMLInputElement)
    })
    await click(screen.getByRole('tab', { name: /Species/ }))
    expect(screen.queryAllByText('Escherichia')).toHaveLength(0) // no sample A call beside sample B's tags
    // B's run had it off, but the switch is on now: the tab says to run
    // again, not to enable what is already enabled.
    expect(screen.queryByText(/Species detection is off/)).toBeNull()
    expect(document.querySelector('.tabpanel')?.textContent).toContain('The last run (b.mzML) did not detect species; run again')
    expect(mock.speciesCalls).toEqual(['/d/a.tags.species.tsv'])
  })

  it('lowering tag_length after a valid species run keeps showing its report', async () => {
    const mock = installMockBridge()
    mock.settings.lastUsed = { species: true, tag_length: '7' }
    mock.speciesResult = speciesA
    mock.taxdbInfoResult = { path: '/tax/tax_k7.taxdb', k: 7 }
    await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await done(mock, 1, true)
    await waitFor(() => expect(screen.queryAllByText('Escherichia').length).toBeGreaterThan(0))
    await act(async () => {
      fireEvent.change(document.getElementById('p-tag_length') as HTMLInputElement, { target: { value: '3' } })
    })
    expect(screen.queryByText('No tag can reach the index.')).toBeNull()
    expect(screen.queryAllByText('Escherichia').length).toBeGreaterThan(0)
  })

  it('Choose file and Output are locked mid-run; the run of A finishes under input A', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    // Locked: the input and output controls give way to a summary of the run.
    expect(screen.queryByRole('button', { name: /^(Choose file|Change)…$/ })).toBeNull()
    expect(screen.queryByLabelText(/Tags TSV/)).toBeNull()
    expect(document.querySelector('.controls')?.textContent).toContain('locked while FASTag runs')
    mock.nextPickInput = '/d/b.mzML' // nothing can pick it now
    await done(mock, 1, true)
    await screen.findByText('Showing 3 of 3')
    expect(mock.resultsQueryCalls[0].path).toBe('/d/a.tags.tsv') // A's tags
    expect(document.querySelector('.path')?.getAttribute('title')).toBe('/d/a.mzML') // shown input: A
    expect((screen.getByLabelText(/Tags TSV/) as HTMLInputElement).value).toBe('/d/a.tags.tsv')
    expect(screen.getByRole('heading', { name: 'a.tags.tsv' })).toBeDefined()
    expect(document.querySelector('.tabpanel')?.textContent).toContain('from the run of /d/a.mzML')
  })

  it('re-running the same output takes the old table down while it runs; after a cancel or failure it stays withheld as incomplete', async () => {
    // The CLI writes -out in place (as in 1.9.0), so a cancelled or failed
    // re-run may leave a truncated file: the table is withheld until the user
    // opens it anyway.
    const mock = installMockBridge()
    await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await done(mock, 1, true)
    await screen.findByText('Showing 3 of 3')

    await click(runButton())
    expect(screen.queryByText('AQRQAAN')).toBeNull() // no old rows during the re-run
    expect(document.querySelector('.tabpanel')?.textContent).toContain('This run is rewriting /d/a.tags.tsv')
    await click(screen.getByRole('button', { name: 'Cancel' }))
    await done(mock, 2, false, null)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('AQRQAAN')).toBeNull() // the file may be truncated: no rows shown as if whole
    expect(document.querySelector('.tabpanel')?.textContent).toContain('Incomplete.')
    expect(document.querySelector('.tabpanel')?.textContent).not.toContain('Outdated')
    await click(screen.getByRole('button', { name: 'Open it anyway' }))
    await screen.findByText('AQRQAAN') // the mock file is intact, so its rows load

    // A refused or failed re-run likewise.
    await click(runButton())
    expect(screen.queryByText('AQRQAAN')).toBeNull()
    await done(mock, 3, false, 6)
    expect(screen.queryByText('AQRQAAN')).toBeNull()
    expect(document.querySelector('.tabpanel')?.textContent).toContain('Incomplete.')

    // A finished re-run reads the file afresh.
    await click(runButton())
    await done(mock, 4, true)
    await screen.findByText('AQRQAAN')
    expect(document.querySelector('.tabpanel')?.textContent).not.toContain('Incomplete.')
  })

  it('a batch job that rewrote the table on screen clears it; a failed last job names the file with no tags', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await done(mock, 1, true)
    await screen.findByText('Showing 3 of 3')
    await addBatch(mock, ['/d/a.mzML', '/d/b.mzML', '/d/c.mzML'])
    await click(screen.getByRole('button', { name: /^Run \d+ remaining files?$/ }))
    await done(mock, 2, true) // a.mzML rewrote /d/a.tags.tsv
    await waitFor(() => expect(mock.runCalls).toHaveLength(3))
    expect(document.querySelector('.tabpanel')?.textContent).not.toContain('did not finish')
    await done(mock, 3, false, 6) // b.mzML failed
    await waitFor(() => expect(mock.runCalls).toHaveLength(4))
    await click(screen.getByRole('button', { name: 'Cancel' }))
    await done(mock, 4, false, null) // c.mzML cancelled
    const pane = (): string => document.querySelector('.tabpanel')?.textContent ?? ''
    await waitFor(() => expect(pane()).toContain('No tags for b.mzML'))
    expect(pane()).toContain('Select a.mzML in the batch to see its results.')
    expect(pane()).not.toContain('did not finish')
    // Failed jobs are Retry failed's: only c is left to run.
    expect(screen.getByRole('button', { name: 'Run 1 remaining file' })).toBeDefined()

    // A done row is selectable and shows that job's tags.
    const before = mock.resultsQueryCalls.length
    await click(screen.getByRole('button', { name: /Show the results of \/d\/a\.mzML|^a\.mzML/ }))
    await screen.findByText('Showing 3 of 3')
    expect(mock.resultsQueryCalls.slice(before).every((q) => q.path === '/d/a.tags.tsv')).toBe(true)
    expect(document.querySelector('li.job.shown')?.textContent).toContain('a.mzML')
  })
})

describe('lifecycle: last-run summary', () => {
  it('the Last run block names the parameters the run was given, not the edited form', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    await act(async () => {
      fireEvent.change(document.getElementById('p-tag_length') as HTMLInputElement, { target: { value: '4' } })
    })
    await click(runButton())
    await done(mock, 1, true)
    const params = (): string => document.querySelector('.last-run-params')?.textContent ?? ''
    expect(params()).toContain('-tag_length 4')
    await act(async () => {
      fireEvent.change(document.getElementById('p-tag_length') as HTMLInputElement, { target: { value: '6' } })
    })
    expect(params()).toContain('-tag_length 4')
  })
})

describe('lifecycle: run gating races', () => {
  it('the single Run button is disabled behind a batch queue', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await pickSingle(mock, '/d/hidden.mzML')
    await addBatch(mock, ['/d/b1.mzML', '/d/b2.mzML'])
    expect(document.querySelector('.path')).toBeNull() // the single input is no longer shown
    expect(screen.queryByLabelText(/Tags TSV/)).toBeNull() // nor its output
    // No single Run at all: the run bar runs the queue.
    expect(screen.queryByRole('button', { name: /^(Run( on .+)?|Running…)$/ })).toBeNull()
    expect(screen.getByRole('button', { name: /^Run \d+ remaining file/ })).toBeDefined()
    expect(mock.runCalls).toHaveLength(0)
  })

  it('a done event that beats the invoke reply leaves Run disabled until the run settled', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    mock.holdRun()
    await click(runButton())
    await done(mock, mock.lastRunId, true) // parked in earlyDone, pending is empty
    expect(runButton().textContent).toBe('Running…')
    expect(runButton()).toHaveProperty('disabled', true)
    await click(runButton())
    expect(mock.runCalls).toHaveLength(1)
    await act(async () => mock.releaseRun())
    expect(runButton().textContent).toMatch(/^Run( on .+)?$/)
    expect(runButton()).toHaveProperty('disabled', false)
  })

  it('a refused start keeps the reason in the banner', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    mock.failNextRun = 'No such file or directory (os error 2)'
    await click(runButton())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('No such file or directory')
  })

  it('progress: completion line then done hides the bar; total=0 shows indeterminate count', async () => {
    const mock = installMockBridge()
    const c = await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await act(async () => mock.emitProgress({ done: 5, total: 0 }))
    expect(c.querySelector('.bar.indeterminate')).not.toBeNull()
    await act(async () => mock.emitProgress({ done: 139, total: 139 }))
    expect(c.querySelector('.pct')?.textContent).toContain('100%')
    await done(mock, 1, true)
    expect(c.querySelector('.progress')).toBeNull()
  })

  it('paths with spaces, quotes and non-ASCII reach run() verbatim', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    const p = `/d/dir with space/ünï cödé 'q"/s a'm"p.mzML`
    await pickSingle(mock, p)
    await click(runButton())
    expect(mock.runCalls[0]).toMatchObject({ in: p, out: `/d/dir with space/ünï cödé 'q"/s a'm"p.tags.tsv` })
  })

  it('a done event the backend flags cancelled is no failure, whatever its exit code', async () => {
    const mock = installMockBridge()
    const c = await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await act(async () => mock.emitDone({ ok: false, code: 1, runId: 1, cancelled: true }))
    expect(logText(c)).toContain('— cancelled')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('the log keeps a bounded tail, so a chatty run does not grow it without limit', async () => {
    const mock = installMockBridge()
    const c = await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await act(async () => {
      for (let i = 0; i < 6000; i++) mock.emitLog(`line ${i}`)
    })
    const lines = logText(c).split('\n')
    expect(lines.length).toBeLessThanOrEqual(5000)
    expect(lines[0]).toBe('… earlier lines dropped …')
    expect(lines[lines.length - 1]).toBe('line 5999')
  })
})
