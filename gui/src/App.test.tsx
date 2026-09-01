// Behavior tests for the run/batch orchestration in App.tsx, driven through the
// real window.fastag seam (see testing/mockBridge.ts). Every emit runs inside
// act() so the settle chains (resolver -> batch loop -> results fetch) flush
// before assertions.

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import { installMockBridge, type MockBridge } from './testing/mockBridge'

async function renderApp(mock: MockBridge): Promise<HTMLElement> {
  const { container } = render(<App />)
  // Settle the mount effects (probe badge, settings, taxdb) before the test
  // interacts -- also keeps React 19 act warnings out of the output.
  await screen.findByText(mock.binaryInfo.detail)
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

const runButton = (): HTMLElement => screen.getByRole('button', { name: /^Run(ning…)?$/ })
const outField = (): HTMLInputElement => screen.getByLabelText('Output tags (TSV)') as HTMLInputElement

async function pickSingle(mock: MockBridge, path: string): Promise<void> {
  mock.nextPickInput = path
  await click(screen.getByRole('button', { name: 'Choose file…' }))
}

async function addBatch(mock: MockBridge, files: string[]): Promise<void> {
  mock.nextPickInputs = files
  await click(screen.getByRole('button', { name: 'Add batch…' }))
}

const startBatch = async (): Promise<void> =>
  click(screen.getByRole('button', { name: /^Run batch/ }))

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
    expect(runButton().textContent).toBe('Run')
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
    expect(runButton().textContent).toBe('Run')

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
    expect(runButton().textContent).toBe('Run')
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
    expect(runButton().textContent).toBe('Run')
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

    await waitFor(() => expect(screen.getByRole('button', { name: /^Run batch/ })).toBeDefined())
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
    await waitFor(() => expect(screen.getByRole('button', { name: /^Run batch/ })).toBeDefined())
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
    expect(screen.getByRole('button', { name: 'Run batch (2)' })).toBeDefined()
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
    expect(screen.getByRole('button', { name: 'Add batch…' })).toHaveProperty('disabled', true)
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
    await click(screen.getByRole('button', { name: 'Choose file…' }))
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
    await waitFor(() => expect(screen.getByRole('button', { name: /^Run batch/ })).toBeDefined())
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
    await screen.findByText('matched 3 of 3 rows')
    expect(screen.getByText('AQRQAAN')).toBeDefined()
    expect(mock.resultsQueryCalls[0]).toMatchObject({ path: '/d/a.tags.tsv', offset: 0 })
  })
})
