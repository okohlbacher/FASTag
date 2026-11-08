// App-level behaviour tests for the run/batch orchestration, moved unchanged
// from App.test.tsx (GUI P1 PR c). They drive the real window.fastag seam (see
// testing/mockBridge.ts); every emit runs inside act() so the settle chains
// (resolver -> batch loop -> results fetch) flush before assertions.

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { perJobOutputs } from '../app/paths'
import { SPECTRA } from '../api'
import { installMockBridge, type MockBridge } from '../testing/mockBridge'
import { addBatch, click, goTo, logText, pickSingle, renderApp, runButton, startBatch } from '../testing/render'
import { applyLastUsed, formValue } from '../testing/lastUsed'

// fireEvent wraps only the synchronous handler in act; the async continuations
// (pick*.then, runOne chains) land on microtasks, so flush them inside act too.

const doneLines = (container: HTMLElement): number => logText(container).split('— done —').length - 1

const outField = (): HTMLInputElement => screen.getByLabelText(/Tags TSV/) as HTMLInputElement

const emitDone = (mock: MockBridge, runId: number | undefined, ok: boolean): Promise<void> =>
  act(async () => mock.emitDone({ ok, code: ok ? 0 : 1, runId }))

describe('run/batch orchestration', () => {
  it('drops duplicate and unknown-id terminal events instead of settling another job', async () => {
    const mock = installMockBridge()
    const container = await renderApp(mock)
    await addBatch(mock, ['/d/a.mzML', '/d/b.mzML'])
    await startBatch()
    await waitFor(() => expect(mock.runCalls).toHaveLength(1))

    await emitDone(mock, 1, true) // job A settles; loop starts job B
    await waitFor(() => expect(mock.runCalls).toHaveLength(2))
    expect(doneLines(container)).toBe(0) // B's runOne cleared the log

    await emitDone(mock, 1, true) // duplicate of A's event: dropped outright
    expect(doneLines(container)).toBe(0)
    // An id nothing ever started reaches no run's Channel: it must never
    // resolve B's job.
    await emitDone(mock, 99, true)
    expect(screen.getByRole('button', { name: 'Running batch…' })).toBeDefined()
    expect(mock.runCalls).toHaveLength(2)

    await emitDone(mock, 2, true)
    await waitFor(() => expect(screen.getByText('2/2 done')).toBeDefined())
  })

  it('ignores terminal events when nothing is running', async () => {
    const mock = installMockBridge()
    const container = await renderApp(mock)
    // No run id at all: dropped before it can touch anything.
    await emitDone(mock, undefined, false)
    expect(logText(container)).toBe('Log output appears here.')
    // An id no run has reaches no Channel: it must not start showing results or
    // flip the run state.
    await emitDone(mock, 42, true)
    expect(mock.resultsQueryCalls).toHaveLength(0)
    expect(runButton().textContent).toMatch(/^Run( on .+)?$/)
  })

  it('buffers a done event that beats the run() reply, and consumes it exactly once', async () => {
    const mock = installMockBridge()
    const container = await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    mock.holdRun()
    await click(runButton())
    expect(mock.runCalls).toHaveLength(1)

    await emitDone(mock, mock.lastRunId, true) // terminal event before the invoke reply
    expect(doneLines(container)).toBe(1)

    await act(async () => mock.releaseRun())
    await waitFor(() => expect(mock.resultsQueryCalls).toHaveLength(1))
    expect(mock.resultsQueryCalls[0].path).toBe('/d/a.tags.tsv')
    expect(runButton().textContent).toMatch(/^Run( on .+)?$/)

    // The parked result was consumed and the run marked settled: a late
    // duplicate must not log a second done line.
    await emitDone(mock, mock.lastRunId, true)
    expect(doneLines(container)).toBe(1)
  })

  it('settles a run the backend refuses to start', async () => {
    const mock = installMockBridge()
    const container = await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    mock.failNextRun = 'binary vanished'
    await click(runButton())
    await waitFor(() => expect(logText(container)).toContain('FASTag could not start: binary vanished'))
    expect(runButton().textContent).toMatch(/^Run( on .+)?$/)
    expect(mock.resultsQueryCalls).toHaveLength(0)
  })

  it('settles a run whose invoke rejects', async () => {
    const mock = installMockBridge()
    const container = await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    mock.rejectNextRun = new Error('ipc down')
    await click(runButton())
    await waitFor(() => expect(logText(container)).toContain('FASTag could not start:'))
    expect(logText(container)).toContain('ipc down')
    expect(runButton().textContent).toMatch(/^Run( on .+)?$/)
  })

  it('cancel during a batch stops the queue', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await addBatch(mock, ['/d/a.mzML', '/d/b.mzML', '/d/c.mzML'])
    await startBatch()
    await waitFor(() => expect(mock.runCalls).toHaveLength(1))

    await click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mock.cancelCalls).toBe(1)
    await emitDone(mock, 1, false) // the killed child's terminal event

    await waitFor(() => expect(screen.getByRole('button', { name: /^Run \d+ remaining file/ })).toBeDefined())
    expect(mock.runCalls).toHaveLength(1) // b and c never started
    expect(screen.getByText('0/3 done')).toBeDefined()
  })

  it('cancel during the last job suppresses the results preview', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await addBatch(mock, ['/d/a.mzML'])
    await startBatch()
    await waitFor(() => expect(mock.runCalls).toHaveLength(1))

    await click(screen.getByRole('button', { name: 'Cancel' }))
    // The kill missed: the run finished ok anyway. Cancel still means
    // "don't show me results".
    await emitDone(mock, 1, true)
    await waitFor(() => expect(screen.getByRole('button', { name: /^Run \d+ remaining file/ })).toBeDefined())
    expect(mock.resultsQueryCalls).toHaveLength(0)
    expect(screen.getByText('1/1 done')).toBeDefined()
  })

  it('derives per-job species_out and out_spectra overrides in a batch', async () => {
    const mock = installMockBridge()
    mock.settings.lastUsed = { out_spectra: '/tmp/all.mzpeak', species_out: '/tmp/shared.species.tsv' }
    await renderApp(mock)
    await applyLastUsed(2)
    // Guard: the shared paths are in the form, so the per-job ones below are derived from them.
    expect(await formValue('out_spectra')).toBe('/tmp/all.mzpeak')
    expect(await formValue('species_out')).toBe('/tmp/shared.species.tsv')
    await addBatch(mock, ['/d/a.mzML', '/d/b.mzML'])
    await startBatch()
    await waitFor(() => expect(mock.runCalls).toHaveLength(1))
    await emitDone(mock, 1, true)
    await waitFor(() => expect(mock.runCalls).toHaveLength(2))
    await emitDone(mock, 2, true)

    for (const [i, spectra] of [
      [0, '/d/a.spectra.mzpeak'],
      [1, '/d/b.spectra.mzpeak']
    ] as const) {
      expect(mock.runCalls[i].params['species_out']).toBe('') // CLI derives its per-input default
      expect(mock.runCalls[i].params['out_spectra']).toBe(spectra)
    }
    expect(mock.runCalls[0].params['tag_length']).toBeDefined() // regular params still flow
  })

  it('reads the last batch job species report from its derived path', async () => {
    const mock = installMockBridge()
    mock.settings.lastUsed = { species: true }
    await renderApp(mock)
    await applyLastUsed(1)
    expect(await formValue('species')).toBe(true) // guard: species is on
    await addBatch(mock, ['/d/a.mzML', '/d/b.mzML'])
    await startBatch()
    await waitFor(() => expect(mock.runCalls).toHaveLength(1))
    await emitDone(mock, 1, true)
    await waitFor(() => expect(mock.runCalls).toHaveLength(2))
    await emitDone(mock, 2, true)

    // Each job's report is its own derived path. The Species tab reads the
    // last job's; the batch summary (P2b) reads every done job's once for its
    // genus column: b's twice, a's once, never another path.
    await waitFor(() => expect(mock.speciesCalls).toHaveLength(3))
    expect(new Set(mock.speciesCalls)).toEqual(new Set(['/d/a.tags.species.tsv', '/d/b.tags.species.tsv']))
    expect(mock.speciesCalls.filter((p) => p === '/d/b.tags.species.tsv')).toHaveLength(2)
    expect(mock.speciesCalls.filter((p) => p === '/d/a.tags.species.tsv')).toHaveLength(1)
    await waitFor(() => expect(mock.resultsQueryCalls).toHaveLength(1)) // only the last job is previewed
    expect(mock.resultsQueryCalls[0].path).toBe('/d/b.tags.tsv')
  })

  it('takes an MGF input like an mzML: offered by the dialogs, named on the empty card, run with its own outputs', async () => {
    expect(SPECTRA[0].extensions).toEqual(expect.arrayContaining(['mzML', 'mzpeak', 'mgf', 'MGF']))
    const mock = installMockBridge()
    await renderApp(mock)
    expect(screen.getByText('Spectra as mzML, mzPeak or MGF')).toBeDefined()
    await pickSingle(mock, '/d/run.mgf')
    expect(outField().value).toBe('/d/run.tags.tsv')
    await click(runButton())
    await waitFor(() => expect(mock.runCalls).toHaveLength(1))
    expect(mock.runCalls[0].in).toBe('/d/run.mgf')
    expect(mock.runCalls[0].out).toBe('/d/run.tags.tsv')
    // In a batch, run.mzML and run.mgf of one sample keep distinct outputs.
    await emitDone(mock, 1, true)
    await addBatch(mock, ['/e/s.mzML', '/e/s.mgf'])
    await startBatch()
    for (let id = 2; id <= 3; id++) {
      await waitFor(() => expect(mock.runCalls).toHaveLength(id))
      await emitDone(mock, id, true)
    }
    expect(mock.runCalls.slice(1).map((c) => c.out)).toEqual(['/e/s.tags.tsv', '/e/s.mgf.tags.tsv'])
  })

  it('derives the single-run species path from the tags output', async () => {
    const mock = installMockBridge()
    mock.settings.lastUsed = { species: true }
    await renderApp(mock)
    await applyLastUsed(1)
    expect(await formValue('species')).toBe(true) // guard: species is on
    await pickSingle(mock, '/runs.2026/sample.mzML')
    await click(runButton())
    await emitDone(mock, 1, true)
    await waitFor(() => expect(mock.speciesCalls).toHaveLength(1))
    expect(mock.speciesCalls[0]).toBe('/runs.2026/sample.tags.species.tsv')
    expect(mock.resultsQueryCalls[0].path).toBe('/runs.2026/sample.tags.tsv')
  })

  it('gates Run on having an input and no run in flight', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    expect(runButton()).toHaveProperty('disabled', true)
    await pickSingle(mock, '/d/a.mzML')
    expect(runButton()).toHaveProperty('disabled', false)
    await click(runButton())
    await goTo('setup') // the run bar and the form (P2a: a run moves to Results)
    expect(screen.getByRole('button', { name: 'Running…' })).toHaveProperty('disabled', true)
    // The form is locked mid-run: the input controls give way to a summary.
    expect(screen.queryByRole('button', { name: /^(Add files for a batch|Add)…$/ })).toBeNull()
    await emitDone(mock, 1, true)
    await waitFor(() => expect(runButton()).toHaveProperty('disabled', false))
  })

  it('gates Run on a runnable binary', async () => {
    const mock = installMockBridge()
    mock.binaryInfo = { bin: '/mock/FASTag', source: 'env', ok: false, detail: 'missing' }
    const { container } = render(<App />)
    await screen.findByText(/FASTag cannot start/)
    await act(async () => {})
    mock.nextPickInput = '/d/a.mzML'
    await click(screen.getByRole('button', { name: /^(Choose file|Change)…$/ }))
    expect(runButton()).toHaveProperty('disabled', true)
    void container
  })

  it('a rejecting species report is logged, not an unhandled rejection', async () => {
    const mock = installMockBridge()
    mock.settings.lastUsed = { species: true }
    mock.speciesError = new Error('species boom')
    const container = await renderApp(mock)
    await applyLastUsed(1)
    expect(await formValue('species')).toBe(true) // guard: species is on, so the species report is read
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await emitDone(mock, 1, true)
    await waitFor(() => expect(logText(container)).toContain('Could not show the results: species boom'))
    expect(runButton()).toHaveProperty('disabled', false)
  })

  it('a rejecting species on the last batch job still releases the batch controls', async () => {
    const mock = installMockBridge()
    mock.settings.lastUsed = { species: true }
    mock.speciesError = new Error('species boom')
    const container = await renderApp(mock)
    await applyLastUsed(1)
    expect(await formValue('species')).toBe(true) // guard: species is on, so the species report is read
    await addBatch(mock, ['/d/a.mzML'])
    await startBatch()
    await waitFor(() => expect(mock.runCalls).toHaveLength(1))
    await emitDone(mock, 1, true)
    await waitFor(() => expect(screen.getByRole('button', { name: /^Run \d+ remaining file/ })).toBeDefined())
    expect(logText(container)).toContain('Could not show the results: species boom')
    expect(screen.getByText('1/1 done')).toBeDefined()
  })

  it('a failing results fetch is shown in the results pane, not an unhandled rejection', async () => {
    const mock = installMockBridge()
    mock.resultsError = new Error('file vanished')
    await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await emitDone(mock, 1, true)
    await waitFor(() => expect(screen.getByText(/Cannot read results: file vanished/)).toBeDefined())
    expect(runButton()).toHaveProperty('disabled', false)
  })

  it('shows the browser for a run and its rows come from resultsQuery', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await emitDone(mock, 1, true)
    await screen.findByText('Showing 3 of 3')
    expect(screen.getByText('AQRQAAN')).toBeDefined()
    expect(mock.resultsQueryCalls[0]).toMatchObject({ path: '/d/a.tags.tsv', offset: 0 })
  })

  it('derives a per-job path for every configured output file in a batch', async () => {
    const values = { glyco_out: '/tmp/all.glyco.tsv', recon_out: '/tmp/r.tsv', recon_id_out: '/tmp/r.idXML', out_spectra: '/tmp/s' }
    expect(perJobOutputs(values, '/d/a.tags.tsv')).toEqual({
      species_out: '',
      glyco_out: '/d/a.glyco.tsv',
      recon_out: '/d/a.recon.tsv',
      recon_id_out: '/d/a.recon_id.idXML',
      out_spectra: '/d/a.spectra.mzML'
    })
    expect(perJobOutputs({}, '/d/b.out.tsv')).toEqual({ species_out: '' })
  })

  it('shows the failure and the last error line when the CLI fails', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await act(async () => mock.emitLog('Error: Unable to read file (in: /d/a.mzML)'))
    await act(async () => mock.emitLog('some later line'))
    await emitDone(mock, 1, false)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/a\.mzML failed \(exit code 1\)FASTag's reason:Error: Unable to read file/)
  })

  it('falls back to the last log line when no line names an error', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await act(async () => mock.emitLog('-massgap_out requires -recon_out (the gaps are those of the reconciliations).'))
    await act(async () => mock.emitDone({ ok: false, code: 6, runId: 1 }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/failed \(exit code 6\)FASTag's reason:-massgap_out requires -recon_out/)
  })

  it('leaves inert options out of the command line', async () => {
    const mock = installMockBridge()
    mock.settings.lastUsed = { massgap_out: '/r/a.massgap.tsv' }
    await renderApp(mock)
    await applyLastUsed(1)
    // Guard: the form holds massgap_out (inert without recon_out), so leaving it out is the GUI's choice.
    expect(await formValue('massgap_out')).toBe('/r/a.massgap.tsv')
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    const sent = mock.runCalls[mock.runCalls.length - 1].params
    expect(sent).not.toHaveProperty('massgap_out')
    expect(sent).toHaveProperty('digest_out')
  })

  it('re-bases the configured reports on a new input instead of overwriting the last one', async () => {
    const mock = installMockBridge()
    mock.settings.lastUsed = { digest_out: '/res/old.digest.tsv', recon_out: '/res/old.recon.tsv', recon_fasta: '/db/human.fasta' }
    await renderApp(mock)
    await applyLastUsed(3)
    expect(await formValue('digest_out')).toBe('/res/old.digest.tsv') // guard: the old report path is in the form
    await pickSingle(mock, '/d/b.mzML')
    await click(runButton())
    const sent = mock.runCalls[mock.runCalls.length - 1].params
    // Beside the tags output, so a same-named input in another folder gets its own.
    expect(sent['digest_out']).toBe('/d/b.digest.tsv')
  })

  it('keeps Run disabled while a value or a combination would be refused by the CLI, and says why', async () => {
    const mock = installMockBridge()
    mock.settings.lastUsed = { recon_out: '/res/old.recon.tsv', max_peaks: '2000' }
    await renderApp(mock)
    await applyLastUsed(2)
    expect(await formValue('max_peaks')).toBe('2000') // guard: the refused values are in the form
    expect(await formValue('recon_out')).toBe('/res/old.recon.tsv')
    await pickSingle(mock, '/d/b.mzML')
    expect((runButton() as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('recon_out needs a database: set recon_fasta (or fasta).')).toBeDefined()
    expect(screen.getByText(/1 value to fix before running: Max peaks \(must be at most 1024\)/)).toBeDefined()
    await click(runButton())
    expect(mock.runCalls).toHaveLength(0)
  })

  it('reads a relative Output where the backend resolved it, beside the input', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await pickSingle(mock, '/d/b.mzML')
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Tags TSV/), { target: { value: 'run.tags.tsv' } })
    })
    await click(runButton())
    expect(mock.runCalls[mock.runCalls.length - 1].out).toBe('run.tags.tsv')
    await emitDone(mock, 1, true)
    await screen.findByText('Showing 3 of 3')
    expect(mock.resultsQueryCalls[mock.resultsQueryCalls.length - 1].path).toBe('/d/run.tags.tsv')
  })

  it('browses a parameter file with its own formats, not the spectra filter', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    const browse = (name: string): Element => {
      const field = document.getElementById(`p-${name}`)
      const b = field?.parentElement?.querySelector('button')
      if (!b) throw new Error(`no Browse button for ${name}`)
      return b
    }
    await click(screen.getByRole('button', { name: /Sequence matching/ }))
    await click(screen.getByRole('button', { name: /Reconciliation/ }))
    mock.nextPickInput = '/db/human.fasta'
    await click(browse('fasta'))
    expect(mock.pickFileCalls[mock.pickFileCalls.length - 1]).toEqual({ kind: 'open', formats: ['fasta', 'fa', 'faa'] })
    expect((document.getElementById('p-fasta') as HTMLInputElement).value).toBe('/db/human.fasta')
    mock.nextPickOutput = '/r/a.recon.tsv'
    await click(browse('recon_out'))
    expect(mock.pickFileCalls[mock.pickFileCalls.length - 1]).toEqual({ kind: 'save', formats: ['tsv'] })
    // With -recon_out set, -recon_id_out is live and offers its own formats.
    mock.nextPickOutput = '/r/ids.idXML'
    await click(browse('recon_id_out'))
    expect(mock.pickFileCalls[mock.pickFileCalls.length - 1]).toEqual({
      kind: 'save',
      formats: ['idXML', 'mzid', 'mzTab']
    })
  })

  it('says a cancelled run was stopped and raises no failure', async () => {
    const mock = installMockBridge()
    const container = await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await click(screen.getByRole('button', { name: 'Cancel' }))
    await act(async () => mock.emitDone({ ok: false, code: null, runId: 1 }))
    expect(logText(container)).toMatch(/stopped before it finished/)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
