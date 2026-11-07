// The run hook (P1 PR c): one run's lifecycle as state, driven through the
// mock bridge's Channel. The events behind the run bar's text (RunBar.test,
// moved from p1a.test.tsx "names the phase and, once measured, the time
// left") are tested here.

import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useRun, appendLog, type RunInputs } from './useRun'
import { createViewStore } from '../app/viewStore'
import { initialValues } from '../setup/useSession'
import { installMockBridge, type MockBridge } from '../testing/mockBridge'

function hook(mock: MockBridge, over: Partial<RunInputs> = {}) {
  void mock
  const view = createViewStore({ tab: 'digest', logJob: '/d/old.mzML' })
  const inputs: RunInputs = {
    values: initialValues(),
    input: '/d/a.mzML',
    out: '/d/a.tags.tsv',
    blocked: false,
    speciesOn: false,
    changedParams: [],
    ...over
  }
  const r = renderHook(() => useRun(inputs, view))
  return { ...r, view }
}

describe('useRun', () => {
  it('phase and progress events reach the run state; Done ends the run', async () => {
    const mock = installMockBridge()
    const { result, view } = hook(mock)
    await act(async () => void result.current.run())
    await waitFor(() => expect(mock.runCalls).toHaveLength(1))
    expect(result.current.running).toBe(true)
    // A run leaves the Digest tab and shows the live log.
    expect(view.get().tab).toBe('results')
    expect(view.get().logJob).toBeNull()
    expect(result.current.announce).toBe('Run started on a.mzML.')
    await act(async () => mock.emitPhase('Tagging spectra'))
    await act(async () => mock.emitProgress({ done: 100, total: 200, ratePerSec: 10, etaSec: 10 }))
    expect(result.current.phase).toBe('Tagging spectra')
    expect(result.current.progress).toEqual({ done: 100, total: 200, ratePerSec: 10, etaSec: 10 })
    await act(async () => mock.emitLog('42 MS2 spectra, 7 tags'))
    expect(result.current.log).toEqual(['42 MS2 spectra, 7 tags'])
    expect(result.current.evidence.ms2).toBe(42)
    await act(async () => mock.emitDone({ ok: true, code: 0, runId: mock.lastRunId }))
    await waitFor(() => expect(result.current.running).toBe(false))
    expect(result.current.progress).toBeNull()
    expect(result.current.log[result.current.log.length - 1]).toBe('— done —')
    expect(result.current.announce).toBe('Finished a.mzML: 7 tags.')
    expect(result.current.lastRun?.ok).toBe(true)
  })

  it('Cancel is sent once per run, and the run ends cancelled, not failed', async () => {
    const mock = installMockBridge()
    const { result } = hook(mock)
    await act(async () => void result.current.run())
    await waitFor(() => expect(mock.runCalls).toHaveLength(1))
    act(() => result.current.cancelRun())
    act(() => result.current.cancelRun())
    expect(mock.cancelCalls).toBe(1)
    expect(result.current.cancelling).toBe(true)
    await act(async () => mock.emitDone({ ok: false, code: 1, runId: mock.lastRunId }))
    await waitFor(() => expect(result.current.running).toBe(false))
    expect(result.current.lastRun?.cancelled).toBe(true)
    expect(result.current.failure).toBeNull()
  })

  it('a failed run raises a failure with the last error line and its command', async () => {
    const mock = installMockBridge()
    const { result } = hook(mock)
    await act(async () => void result.current.run())
    await waitFor(() => expect(mock.runCalls).toHaveLength(1))
    await act(async () => mock.emitLog('Error: Unable to read file a.mzML'))
    await act(async () => mock.emitDone({ ok: false, code: 1, runId: mock.lastRunId }))
    await waitFor(() => expect(result.current.failure).not.toBeNull())
    expect(result.current.failure?.title).toBe('a.mzML failed (exit code 1)')
    expect(result.current.failure?.reasons).toEqual([{ text: 'Error: Unable to read file a.mzML' }])
  })

  it('adds batch files once each, and a blocked form runs no batch', async () => {
    const mock = installMockBridge()
    const { result } = hook(mock, { blocked: true })
    mock.nextPickInputs = ['/d/a.mzML', '/d/b.mzML', '/d/a.mzML']
    await act(async () => result.current.addBatchFiles())
    expect(result.current.jobs.map((j) => j.input)).toEqual(['/d/a.mzML', '/d/b.mzML'])
    expect(result.current.remaining).toBe(2)
    await act(async () => result.current.runBatch())
    expect(mock.runCalls).toHaveLength(0)
  })

  it('appendLog keeps a bounded tail with a marker of what it dropped', () => {
    const kept = appendLog([], Array.from({ length: 6000 }, (_, i) => `line ${i}`))
    expect(kept).toHaveLength(5000)
    expect(kept[0]).toBe('… earlier lines dropped …')
    expect(kept[kept.length - 1]).toBe('line 5999')
  })
})
