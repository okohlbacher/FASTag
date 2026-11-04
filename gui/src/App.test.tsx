// Behavior tests for the run/batch orchestration in App.tsx, driven through the
// real window.fastag seam (see testing/mockBridge.ts). Every emit runs inside
// act() so the settle chains (resolver -> batch loop -> results fetch) flush
// before assertions.

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App, { perJobOutputs } from './App'
import DigestPanel from './DigestPanel'
import { parseReport } from './digestReport'
import { installMockBridge, type MockBridge } from './testing/mockBridge'
import digestTsv from './fixtures/digest.tsv?raw'
import nocallTsv from './fixtures/digest_nocall.tsv?raw'
import labelTsv from './fixtures/label.tsv?raw'
import massgapTsv from './fixtures/massgap.tsv?raw'

async function renderApp(mock: MockBridge): Promise<HTMLElement> {
  const { container } = render(<App />)
  // Settle the mount effects (probe badge, settings, taxdb) before the test
  // interacts -- also keeps React 19 act warnings out of the output.
  await screen.findByText('CLI ready')
  await act(async () => {})
  return container
}

// fireEvent wraps only the synchronous handler in act; the async continuations
// (pick*.then, runOne chains) land on microtasks, so flush them inside act too.
const click = (el: Element): Promise<void> =>
  act(async () => {
    fireEvent.click(el)
  })

const logText = (container: HTMLElement): string => container.querySelector('.log')?.textContent ?? ''
const doneLines = (container: HTMLElement): number => logText(container).split('— done —').length - 1

const runButton = (): HTMLElement => screen.getByRole('button', { name: /^(Run( on .+)?|Running…)$/ })
const outField = (): HTMLInputElement => screen.getByLabelText(/Tags TSV/) as HTMLInputElement

async function pickSingle(mock: MockBridge, path: string): Promise<void> {
  mock.nextPickInput = path
  await click(screen.getByRole('button', { name: /^(Choose file|Change)…$/ }))
}

async function addBatch(mock: MockBridge, files: string[]): Promise<void> {
  mock.nextPickInputs = files
  await click(screen.getByRole('button', { name: /^(Add files for a batch|Add)…$/ }))
}

const startBatch = async (): Promise<void> =>
  click(screen.getByRole('button', { name: /^Run \d+ remaining file/ }))

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
    // An id nothing ever started parks in earlyDone (it cannot be told from
    // the early-race at event time, so it logs) -- but it must never resolve
    // B's awaiter.
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
    // An unclaimed id parks (and logs) but must not start showing results or
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
    await waitFor(() => expect(logText(container)).toContain('could not start: binary vanished'))
    expect(runButton().textContent).toMatch(/^Run( on .+)?$/)
    expect(mock.resultsQueryCalls).toHaveLength(0)
  })

  it('settles a run whose invoke rejects', async () => {
    const mock = installMockBridge()
    const container = await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    mock.rejectNextRun = new Error('ipc down')
    await click(runButton())
    await waitFor(() => expect(logText(container)).toContain('could not start:'))
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
    await addBatch(mock, ['/d/a.mzML', '/d/b.mzML'])
    await startBatch()
    await waitFor(() => expect(mock.runCalls).toHaveLength(1))
    await emitDone(mock, 1, true)
    await waitFor(() => expect(mock.runCalls).toHaveLength(2))
    await emitDone(mock, 2, true)

    await waitFor(() => expect(mock.speciesCalls).toHaveLength(1))
    expect(mock.speciesCalls[0]).toBe('/d/b.tags.species.tsv')
    expect(mock.resultsQueryCalls).toHaveLength(1) // only the last job is previewed
    expect(mock.resultsQueryCalls[0].path).toBe('/d/b.tags.tsv')
  })

  it('numbers colliding batch outputs', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    // sample.mzML and sample.mzpeak both map to sample.tags.tsv; the
    // extensionless third collides with the full-name fallback too.
    await addBatch(mock, ['/d/s.mzML', '/d/s.mzpeak', '/d/s'])
    await startBatch()
    for (let id = 1; id <= 3; id++) {
      await waitFor(() => expect(mock.runCalls).toHaveLength(id))
      await emitDone(mock, id, true)
    }
    expect(mock.runCalls.map((c) => c.out)).toEqual([
      '/d/s.tags.tsv',
      '/d/s.mzpeak.tags.tsv',
      '/d/s.2.tags.tsv'
    ])
  })

  it('dedups batch inputs across picks', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await addBatch(mock, ['/d/a.mzML'])
    await addBatch(mock, ['/d/a.mzML', '/d/b.mzML'])
    expect(screen.getByRole('button', { name: 'Run 2 remaining files' })).toBeDefined()
    expect(document.querySelectorAll('li.job')).toHaveLength(2)
  })

  it('stripExt keeps dotted directories intact on both slash flavors', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await pickSingle(mock, '/runs.2026/sample')
    expect(outField().value).toBe('/runs.2026/sample.tags.tsv')
    await pickSingle(mock, 'C:\\runs.2026\\sample')
    expect(outField().value).toBe('C:\\runs.2026\\sample.tags.tsv')
    await pickSingle(mock, '/d/x.mzML')
    expect(outField().value).toBe('/d/x.tags.tsv')
  })

  it('derives the single-run species path from the tags output', async () => {
    const mock = installMockBridge()
    mock.settings.lastUsed = { species: true }
    await renderApp(mock)
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
    await screen.findByText(/binary not runnable/)
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
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await emitDone(mock, 1, true)
    await waitFor(() => expect(logText(container)).toContain('results: species boom'))
    expect(runButton()).toHaveProperty('disabled', false)
  })

  it('a rejecting species on the last batch job still releases the batch controls', async () => {
    const mock = installMockBridge()
    mock.settings.lastUsed = { species: true }
    mock.speciesError = new Error('species boom')
    const container = await renderApp(mock)
    await addBatch(mock, ['/d/a.mzML'])
    await startBatch()
    await waitFor(() => expect(mock.runCalls).toHaveLength(1))
    await emitDone(mock, 1, true)
    await waitFor(() => expect(screen.getByRole('button', { name: /^Run \d+ remaining file/ })).toBeDefined())
    expect(logText(container)).toContain('results: species boom')
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

describe('digest tab', () => {
  const paths = {
    digest_out: '/r/a.digest.tsv',
    label_out: '/r/a.label.tsv',
    massgap_out: '/r/a.massgap.tsv',
    recon_out: '/r/a.recon.tsv'
  }

  it('is always offered, and selected only when a run writes a report', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await emitDone(mock, 1, true)
    await screen.findByText('Showing 3 of 3')
    expect(screen.getByRole('tab', { name: /Digest/ }).getAttribute('aria-selected')).toBe('false')
  })

  it('shows the call, the logos, the labels and the gaps after a run', async () => {
    const mock = installMockBridge()
    // recon_out needs a database, or the CLI refuses the run (and Run is disabled).
    mock.settings.lastUsed = { ...paths, recon_fasta: '/db/human.fasta' }
    mock.reportFiles = { [paths.digest_out]: digestTsv, [paths.label_out]: labelTsv, [paths.massgap_out]: massgapTsv }
    await renderApp(mock)
    await pickSingle(mock, '/r/a.mzML')
    await click(runButton())
    await emitDone(mock, 1, true)
    const tab = await screen.findByRole('tab', { name: /Digest/ })
    expect(tab.getAttribute('aria-selected')).toBe('true')
    expect(mock.reportCalls).toEqual([paths.digest_out, paths.label_out, paths.massgap_out])
    const stat = (label: string): string | null | undefined => screen.getByText(label).nextElementSibling?.textContent
    expect(stat('Runner-up, other enzyme class')).toBe('Lys-C')
    expect(stat('Margin, log-likelihood per tag')).toBe('1.4788')
    const said = screen.getAllByText('Trypsin fits 1.48 log-likelihood per tag end better than Lys-C.')
    expect(said.map((e) => e.tagName)).toEqual(['LI', 'TD']) // the sentence list, and the raw rows
    const logos = screen.getAllByRole('img').filter((e) => e.tagName === 'svg')
    expect(logos.map((l) => l.getAttribute('aria-label')?.split(':')[0])).toEqual([
      'Observed',
      'Called',
      'Runner-up'
    ])
    expect(logos[0].getAttribute('aria-label')).toMatch(/P1 K /)
    expect(screen.getAllByText('TMTpro')).toHaveLength(1)
    expect(screen.getByText(/the 40 fullest of 2,284 bins/)).toBeDefined()
    await click(screen.getByRole('button', { name: 'Show all 2,284 bins' }))
    expect(screen.queryByText(/fullest of/)).toBeNull()
  })

  it('shows a no-call with its reason', async () => {
    const mock = installMockBridge()
    mock.settings.lastUsed = { digest_out: paths.digest_out }
    mock.reportFiles = { [paths.digest_out]: nocallTsv }
    await renderApp(mock)
    await pickSingle(mock, '/r/a.mzML')
    await click(runButton())
    await emitDone(mock, 1, true)
    await screen.findByText('No call')
    expect(screen.getByText('Reason').nextElementSibling?.textContent).toBe(
      'the fragment tolerance is in Da · also the first MS2 peaks lie above y1 of K, too few terminal tags'
    )
    expect(screen.queryByText(/Metadata absent for/)).toBeNull()
  })

  it('reports a file that is not a report instead of failing', async () => {
    const mock = installMockBridge()
    mock.settings.lastUsed = { digest_out: paths.digest_out }
    mock.reportFiles = { [paths.digest_out]: 'spectrum\ttag\n' }
    await renderApp(mock)
    await pickSingle(mock, '/r/a.mzML')
    await click(runButton())
    await emitDone(mock, 1, true)
    expect((await screen.findByRole('alert')).textContent).toMatch(/Cannot read \/r\/a.digest.tsv: not a FASTag report/)
  })

  it('closes the reports of another input when one is opened', async () => {
    const mock = installMockBridge()
    const other = digestTsv.replace(/^run\tversion.*$/m, (l) => `${l}\nrun\tinput\tother.mzML\t-\tThe spectra were read from other.mzML.`)
    mock.nextPickReport = '/r/b.label.tsv'
    mock.reportFiles = { '/r/b.label.tsv': labelTsv, '/r/o.digest.tsv': other }
    await renderApp(mock)
    await click(screen.getByRole('button', { name: 'Open a digest, label or mass-gap report…' }))
    await screen.findAllByText('TMTpro')
    mock.nextPickReport = '/r/o.digest.tsv'
    await click(screen.getByRole('button', { name: 'Open another report…' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/o.digest.tsv is from another input \(other.mzML\)/)
    expect(screen.queryAllByText('TMTpro')).toHaveLength(0)
    expect(screen.getByText('o.digest.tsv')).toBeDefined()
  })

  it('moves between the tabs with the arrow keys', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    const tags = screen.getByRole('tab', { name: 'Tags' })
    await act(async () => {
      fireEvent.keyDown(tags, { key: 'ArrowRight' })
    })
    expect(screen.getByRole('tab', { name: 'Species' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('tab-species')
  })

  it('opens a report from the empty results pane', async () => {
    const mock = installMockBridge()
    mock.nextPickReport = '/r/b.label.tsv'
    mock.reportFiles = { '/r/b.label.tsv': labelTsv }
    await renderApp(mock)
    await click(screen.getByRole('button', { name: 'Open a digest, label or mass-gap report…' }))
    await screen.findAllByText('TMTpro')
    expect(screen.getByRole('tab', { name: /Digest/ }).getAttribute('aria-selected')).toBe('true')
  })
})

describe('redesign: setup and run bar', () => {
  it('locks the form while a run is in flight and lists what the run writes and changes', async () => {
    const mock = installMockBridge()
    mock.settings.lastUsed = { tag_length: '7' }
    const container = await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    expect(runButton().textContent).toBe('Run on a.mzML')
    await click(runButton())
    const controls = container.querySelector('.controls')!
    expect(controls.textContent).toContain('locked while FASTag runs')
    expect(controls.textContent).toContain('a.tags.tsv')
    expect(controls.textContent).toContain('-tag_length 7')
    expect(container.querySelector('#p-tag_length')).toBeNull() // no editable field mid-run
    await emitDone(mock, 1, true)
    expect(container.querySelector('#p-tag_length')).not.toBeNull()
    expect(controls.textContent).toMatch(/Last run.*a\.mzML.*Finished/)
  })

  it('counts the changed values of a section in its header, and draws a value and its unit as one control', async () => {
    const mock = installMockBridge()
    const container = await renderApp(mock)
    const tagging = screen.getByRole('button', { name: /^Tagging/ })
    expect(tagging.textContent).toMatch(/defaults$/)
    await act(async () => {
      fireEvent.change(document.getElementById('p-tag_length')!, { target: { value: '5' } })
    })
    expect(tagging.textContent).toMatch(/1 changed/)
    expect(document.getElementById('h-tag_length')!.textContent).toMatch(/Default 3 · changed$/)
    const unit = document.getElementById('p-fragment_tolerance_unit')!
    expect(unit.closest('.with-unit')?.querySelector('#p-fragment_tolerance')).not.toBeNull()
    expect(container.querySelectorAll('label[for="p-fragment_tolerance_unit"]')).toHaveLength(0)
    await act(async () => {
      fireEvent.change(unit, { target: { value: 'Da' } })
    })
    expect(tagging.textContent).toMatch(/2 changed/)
  })

  it('an inert field keeps its description and names what it needs', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await click(screen.getByRole('button', { name: /^Sequence matching/ }))
    const help = document.getElementById('h-isobaric_tolerance')!
    expect(help.textContent).toMatch(/^When matching against/)
    expect(help.textContent).toMatch(/Needs -?fasta or -?recon_out/)
    expect((document.getElementById('p-isobaric_tolerance') as HTMLInputElement).disabled).toBe(true)
  })

  it('Reset… asks first; Keep leaves the values, Reset restores the CLI defaults', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    const tl = (): HTMLInputElement => document.getElementById('p-tag_length') as HTMLInputElement
    await act(async () => {
      fireEvent.change(tl(), { target: { value: '6' } })
    })
    await click(screen.getByRole('button', { name: 'Reset…' }))
    await click(screen.getByRole('button', { name: 'Keep' }))
    expect(tl().value).toBe('6')
    await click(screen.getByRole('button', { name: 'Reset…' }))
    await click(screen.getByRole('button', { name: 'Reset' }))
    expect(tl().value).toBe('3')
  })

  it('the failure banner opens the log and copies the command line', async () => {
    const mock = installMockBridge()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const container = await renderApp(mock)
    await pickSingle(mock, '/d/my data/a.mzML')
    await click(runButton())
    await act(async () => mock.emitLog('Error: Unable to read file'))
    await emitDone(mock, 1, false)
    const alert = await screen.findByRole('alert')
    expect(alert.querySelector('code.why')?.textContent).toBe('Error: Unable to read file')
    expect((container.querySelector('pre.log') as HTMLElement).hidden).toBe(true)
    await click(screen.getByRole('button', { name: 'Show full log' }))
    expect((container.querySelector('pre.log') as HTMLElement).hidden).toBe(false)
    await click(screen.getByRole('button', { name: 'Copy command' }))
    expect(writeText).toHaveBeenCalledWith("/mock/FASTag -in '/d/my data/a.mzML' -out '/d/my data/a.tags.tsv'")
    expect(screen.getByRole('button', { name: 'Copied' })).toBeDefined()
  })

  it('Retry failed runs only the failed jobs; a cancelled job does not hide an earlier failure', async () => {
    const mock = installMockBridge()
    const container = await renderApp(mock)
    await addBatch(mock, ['/d/a.mzML', '/d/b.mzML', '/d/c.mzML'])
    await startBatch()
    await emitDone(mock, 1, false)
    await waitFor(() => expect(mock.runCalls).toHaveLength(2))
    await emitDone(mock, 2, true)
    await waitFor(() => expect(mock.runCalls).toHaveLength(3))
    await click(screen.getByRole('button', { name: 'Cancel' }))
    await act(async () => mock.emitDone({ ok: false, code: null, cancelled: true, runId: 3 }))
    expect(container.querySelector('li.job.cancelled')?.textContent).toContain('Cancelled by you')
    expect((await screen.findByRole('alert')).textContent).toMatch(/^1 of 3 batch jobs failed/)
    // The failed job is Retry failed's: only the cancelled one remains.
    expect(screen.getByRole('button', { name: 'Run 1 remaining file' })).toBeDefined()
    await click(screen.getByRole('button', { name: 'Retry failed' }))
    expect(mock.runCalls.map((c) => c.in)).toEqual(['/d/a.mzML', '/d/b.mzML', '/d/c.mzML', '/d/a.mzML'])
    await emitDone(mock, 4, true)
    expect(container.querySelector('li.job.done')?.textContent).toContain('a.mzML')
  })
})

describe('redesign: mass-gap histogram', () => {
  it('cuts the 0 bin at the scale of the other bins, labels its count, and counts what lies outside the range', () => {
    const head = 'section\tkey\tvalue\tn\tdescription'
    const hist = [['0.0000', 1000], ['0.9840', 400], ['15.9949', 200], ['2.0000', 1], ['9000.0', 1]]
    const r = parseReport([head, ...hist.map(([g, n]) => `hist\t${g}\t${n}\t-\td`)].join('\n'), '/r/a.massgap.tsv')
    const { container } = render(<DigestPanel reports={[r]} errors={[]} onOpen={() => {}} />)
    const fig = screen.getByRole('img', { name: /^Spectra by precursor minus peptide mass/ })
    expect(fig.getAttribute('aria-label')).toMatch(/in 1 Da steps from 0 to \+16 Da: 1,000 at 0 \(bar cut\); next \+1 \(400\), \+16 \(200\)/)
    expect(container.querySelector('.hist .bar.cut .cut-label')?.textContent).toBe('1,000')
    expect(container.querySelector('.gap-hist figcaption')?.textContent).toMatch(/1 beyond 0 to \+16 Da are not drawn/)
  })
})
