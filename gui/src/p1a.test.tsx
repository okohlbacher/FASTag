// P1 PR a (GUI-DESIGN 6.2, 6.3, 6.6): the run's Channel as the App sees it,
// the outputs the backend resolved, the phase and time left in the run bar,
// and the 500-line window of the log drawer. Through the real window.fastag
// seam; api.ts itself is tested against Tauri's IPC mock (api.test.ts).

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App, { LOG_WINDOW } from './App'
import { installMockBridge, mockOutputs, OUTPUT_KEYS, RUN_STARTED_FIXTURE, type MockBridge, type RunCall } from './testing/mockBridge'
import type { ResolvedOutputs } from './types'

const click = (el: Element): Promise<void> =>
  act(async () => {
    fireEvent.click(el)
  })

async function renderApp(): Promise<HTMLElement> {
  const { container } = render(<App />)
  await screen.findByText('FASTag ready')
  await act(async () => {})
  return container
}

async function pickSingle(mock: MockBridge, path: string): Promise<void> {
  mock.nextPickInput = path
  await click(screen.getByRole('button', { name: /^(Choose file|Change)…$/ }))
}

const runButton = (): HTMLElement => screen.getByRole('button', { name: /^Run( on .+)?$/ })
const what = (c: HTMLElement): string => c.querySelector('.runbar .what')?.textContent ?? ''
const pct = (c: HTMLElement): string => c.querySelector('.runbar .pct')?.textContent ?? ''

describe('the outputs of a run come from the backend', () => {
  it('reads the tags, species and reports where the backend says the CLI wrote them (Windows paths)', async () => {
    const mock = installMockBridge()
    // What fastag.rs answers for a Windows run: a root-relative report path
    // joined to the input's drive, which the renderer's own resolution took
    // for absolute and read from \data\d.tsv.
    const outputs: ResolvedOutputs = {
      out: 'C:\\d\\a.tags.tsv',
      species_out: 'C:\\d\\a.tags.species.tsv',
      digest_out: 'C:\\data\\d.tsv'
    }
    const run = mock.run
    mock.run = async (params, onEvent) => ({ ...(await run(params, onEvent)), out: outputs.out, outputs })
    mock.settings.lastUsed = { species: true }
    await renderApp()
    await click(await screen.findByRole('button', { name: 'Apply last-used (1)' }))
    await pickSingle(mock, 'C:\\d\\a.mzML')
    await click(runButton())
    await act(async () => mock.emitDone({ ok: true, code: 0, runId: mock.lastRunId }))
    await waitFor(() => expect(mock.resultsQueryCalls.length).toBeGreaterThan(0))
    expect(mock.resultsQueryCalls[0].path).toBe('C:\\d\\a.tags.tsv')
    expect(mock.speciesCalls).toEqual(['C:\\d\\a.tags.species.tsv'])
    expect(mock.reportCalls).toEqual(['C:\\data\\d.tsv'])
  })

  // The contract with fastag.rs: the reply exactly as the backend sends it
  // (fixtures/run-started.json, pinned by cargo). A rename_all on
  // ResolvedOutputs once sent speciesOut and digestOut, so the species and
  // Digest reports were never read, while this mock built its own keys.
  it('reads the species and every report the backend reply names, under the keys it sends', async () => {
    const mock = installMockBridge()
    const fixture = RUN_STARTED_FIXTURE
    const run = mock.run
    mock.run = async (params, onEvent) => {
      await run(params, onEvent)
      return fixture
    }
    mock.settings.lastUsed = { species: true }
    await renderApp()
    await click(await screen.findByRole('button', { name: 'Apply last-used (1)' }))
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await act(async () => mock.emitDone({ ok: true, code: 0, runId: mock.lastRunId }))
    await waitFor(() => expect(mock.reportCalls.length).toBe(3))
    const o = fixture.outputs!
    expect(mock.resultsQueryCalls[0].path).toBe(o.out)
    expect(mock.speciesCalls).toEqual([o.species_out])
    expect(mock.reportCalls).toEqual([o.digest_out, o.label_out, o.massgap_out])
  })

  it('the mock resolves outputs under the keys the backend sends', () => {
    const params = Object.fromEntries(OUTPUT_KEYS.filter((k) => k !== 'out').map((k) => [k, `${k}.tsv`]))
    const o = mockOutputs({ in: '/d/a.mzML', out: 'a.tags.tsv', params } satisfies RunCall)
    expect(Object.keys(o).sort()).toEqual(Object.keys(RUN_STARTED_FIXTURE.outputs!).sort())
    for (const k of OUTPUT_KEYS) expect(o[k], k).toMatch(/^\/d\//)
  })

  it('a run whose reply never names its outputs opens nothing', async () => {
    const mock = installMockBridge()
    const run = mock.run
    mock.run = async (params, onEvent) => ({ ...(await run(params, onEvent)), out: null, outputs: null })
    const c = await renderApp()
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await act(async () => mock.emitDone({ ok: true, code: 0, runId: mock.lastRunId }))
    await waitFor(() => expect(c.querySelector('.log')?.textContent).toContain('did not learn where it wrote its outputs'))
    expect(mock.resultsQueryCalls).toEqual([])
  })
})

describe('the run bar', () => {
  it('names the phase and, once measured, the time left', async () => {
    const mock = installMockBridge()
    const c = await renderApp()
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    expect(what(c)).toBe('Starting FASTag')
    await act(async () => mock.emitPhase('Reading spectra'))
    expect(what(c)).toBe('Reading spectra')
    expect(pct(c)).toMatch(/^starting…/)
    await act(async () => mock.emitPhase('Tagging spectra'))
    await act(async () => mock.emitProgress({ done: 50, total: 200, ratePerSec: null, etaSec: null }))
    expect(what(c)).toBe('Tagging spectra')
    expect(pct(c)).toMatch(/^25% · 50 of 200 spectra/)
    expect(pct(c)).not.toContain('left')
    await act(async () => mock.emitProgress({ done: 100, total: 200, ratePerSec: 10, etaSec: 10 }))
    expect(pct(c)).toMatch(/^50% · 100 of 200 spectra .* · about 0:10 left$/)
  })

  it('a cancel in a phase without progress ends the run cancelled, whatever exit code the kill left', async () => {
    const mock = installMockBridge()
    const c = await renderApp()
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await act(async () => mock.emitPhase('Reading spectra'))
    await click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mock.cancelCalls).toBe(1)
    // Windows: TerminateProcess leaves exit code 1, the flag lost the race.
    await act(async () => mock.emitDone({ ok: false, code: 1, cancelled: false, runId: mock.lastRunId }))
    await waitFor(() => expect(c.querySelector('.last-run-name')?.className).toContain('cancelled'))
    expect(c.querySelector('.log')?.textContent).toContain('— cancelled (stopped before it finished) —')
    expect(screen.queryByText(/failed \(exit code 1\)/)).toBeNull()
  })
})

describe('the log drawer', () => {
  it(`renders only the last ${LOG_WINDOW} lines and says how many there are`, async () => {
    const mock = installMockBridge()
    const c = await renderApp()
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await act(async () => {
      for (let i = 0; i < 600; i++) mock.emitLog(`line ${i}`)
    })
    await click(screen.getByRole('button', { name: /^Log/ }))
    const lines = (c.querySelector('.log')?.textContent ?? '').split('\n')
    expect(lines).toHaveLength(LOG_WINDOW)
    expect(lines[0]).toBe('line 100')
    expect(lines[LOG_WINDOW - 1]).toBe('line 599')
    expect(c.querySelector('.logdrawer .n')?.textContent).toBe('600 lines')
    expect(c.querySelector('.log-window')?.textContent).toBe('Showing the last 500 of 600 lines.')
  })

  it('a short log has no window note', async () => {
    const mock = installMockBridge()
    const c = await renderApp()
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await act(async () => mock.emitLog('one line'))
    await click(screen.getByRole('button', { name: /^Log/ }))
    expect(c.querySelector('.log')?.textContent).toBe('one line')
    expect(c.querySelector('.log-window')).toBeNull()
  })
})
