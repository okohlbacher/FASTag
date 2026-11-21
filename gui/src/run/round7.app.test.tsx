// Review round 7, the run hook: a History record whose report a later run
// overwrote at the same path (3), a report opened again read again (7),
// one selection for a drop (9), and the workflow's groups open (18).

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useRun, type RunInputs } from './useRun'
import { createViewStore } from '../app/viewStore'
import { initialValues, useSession } from '../setup/useSession'
import { installMockBridge, type MockBridge } from '../testing/mockBridge'
import type { RunRecord } from '../types'

afterEach(() => {
  vi.restoreAllMocks()
})

function hook(mock: MockBridge) {
  void mock
  const view = createViewStore({ tab: 'digest', logJob: null })
  const inputs: RunInputs = { values: initialValues(), input: '/d/a.mzML', out: '/d/a.tags.tsv', blocked: false, speciesOn: false, changedParams: [] }
  const r = renderHook(() => useRun(inputs, view))
  return { ...r, view }
}

const QC = (n: number): string => `section\tkey\tvalue\tn\tdescription\nrun\tversion\t1.15.3\t-\tFASTag 1.15.3 wrote this report.\nqc\tcount_ms2\t${n}\t-\tMS2 spectra read.\n`

const rec = (id: string, input: string, outputs: string[], end: number, params: Record<string, unknown>): RunRecord => ({
  id,
  input,
  outputs,
  cwd: '/d',
  argv: ['FASTag', '-in', input, '-out', outputs[0]],
  status: 'ok',
  exitCode: 0,
  message: null,
  start: end - 1000,
  end,
  cleanup: { removed: [], renamed: [], failed: [] },
  params,
  workflow: 'run-qc'
})

/// A promise and its resolver, to delay one bridge reply.
function later<T>(): { promise: Promise<T>; resolve(v: T): void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('round 7, 3: a report a later run wrote over at the same path', () => {
  it('is withheld from the record, and the banner names that run', async () => {
    const mock = installMockBridge()
    mock.reportFiles['/d/shared.qc.tsv'] = QC(7)
    const a = rec('A', '/d/a.mzML', ['/d/a.tags.tsv', '/d/shared.qc.tsv'], 1_000_000, { qc_out: '/d/shared.qc.tsv' })
    const b = rec('B', '/d/b.mzML', ['/d/b.tags.tsv', '/d/shared.qc.tsv'], 2_000_000, { qc_out: '/d/shared.qc.tsv' })
    mock.history = [b, a]
    const { result } = hook(mock)
    await act(async () => result.current.showRecord(a, '/d/a.tags.tsv'))
    await waitFor(() => expect(result.current.results?.path).toBe('/d/a.tags.tsv'))
    // A's tags, not B's QC beside them.
    expect(result.current.results?.input).toBe('/d/a.mzML')
    expect(result.current.reports.workflow?.qc).toBeUndefined()
    expect(result.current.results?.reportsReplaced).toEqual([{ path: '/d/shared.qc.tsv', by: '/d/b.mzML', end: 2_000_000 }])
    // B wrote it last: shown, with no notice.
    await act(async () => result.current.showRecord(b, '/d/b.tags.tsv'))
    await waitFor(() => expect(result.current.reports.workflow?.qc).toBe('/d/shared.qc.tsv'))
    expect(result.current.results?.reportsReplaced).toBeUndefined()
  })
})

describe('round 7, 7: a workflow report opened again is read again', () => {
  it('bumps its generation on each open', async () => {
    const mock = installMockBridge()
    mock.reportFiles['/d/a.qc.tsv'] = QC(10)
    const { result } = hook(mock)
    await act(async () => result.current.openResultsPath('/d/a.qc.tsv'))
    const g1 = result.current.reports.workflowGen?.qc ?? 0
    expect(g1).toBeGreaterThan(0)
    await act(async () => result.current.openResultsPath('/d/a.qc.tsv'))
    expect(result.current.reports.workflowGen?.qc).toBe(g1 + 1)
  })
})

describe('round 7, 9: one selection for a whole drop', () => {
  it('a later choice stops the rest of the drop', async () => {
    const mock = installMockBridge()
    mock.reportFiles['/d/a.qc.tsv'] = QC(10)
    mock.reportFiles['/d/a.census_sorted.tsv'] = 'spectrum\tident_rank\tident_score\nscan=1\t1\t0.9\n'
    const slow = later<string | null>()
    const real = window.fastag.reportHead
    vi.spyOn(window.fastag, 'reportHead').mockImplementation((p) => (p === '/d/a.qc.tsv' ? slow.promise : real(p)))
    const { result, view } = hook(mock)
    let drop!: Promise<void>
    await act(async () => {
      drop = result.current.openReportPaths(['/d/a.qc.tsv', '/d/a.census_sorted.tsv'])
    })
    // The user opens B's tags while A's first report is still being read.
    await act(async () => result.current.openResultsPath('/e/b.tags.tsv'))
    await act(async () => {
      slow.resolve(mock.reportFiles['/d/a.qc.tsv'])
      await drop
    })
    expect(result.current.results?.path).toBe('/e/b.tags.tsv')
    expect(result.current.reports.workflow?.triage).toBeUndefined()
    expect(view.get().tab).toBe('results')
  })
})

describe('round 7, 18: only the user\'s own group toggles are stored', () => {
  it('openGroups starts empty, so a workflow group falls back to its default', () => {
    installMockBridge()
    const { result } = renderHook(() => useSession())
    expect(result.current.openGroups).toEqual({})
  })
})
