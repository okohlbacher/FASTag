// Review round 6, the run hook and the batch: a History record whose
// outputs a later run overwrote (1), a slow read of an earlier selection
// that must not land beside a later one (2), outputs two batch jobs would
// share (6) and the mzPeak refusals of a batch's queued files (9).

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useRun, type RunInputs } from './useRun'
import { createViewStore } from '../app/viewStore'
import { initialValues } from '../setup/useSession'
import { installMockBridge, type MockBridge } from '../testing/mockBridge'
import { addBatch, renderApp, showView } from '../testing/render'
import { applyLastUsed } from '../testing/lastUsed'
import type { RunRecord, SpeciesReport } from '../types'
import digestTsv from '../fixtures/cli-1.15/ecoli_ms2_small_20ppm.digest.tsv?raw'

afterEach(() => {
  vi.restoreAllMocks()
})

function hook(mock: MockBridge, over: Partial<RunInputs> = {}) {
  void mock
  const view = createViewStore({ tab: 'digest', logJob: null })
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

const rec = (id: string, input: string, out: string, end: number): RunRecord => ({
  id,
  input,
  outputs: [out],
  cwd: '/d',
  argv: ['FASTag', '-in', input, '-out', out],
  status: 'ok',
  exitCode: 0,
  message: null,
  start: end - 1000,
  end,
  cleanup: { removed: [], renamed: [], failed: [] },
  params: {},
  workflow: 'export-tags'
})

/// A promise and its resolver, to delay one bridge reply.
function later<T>(): { promise: Promise<T>; resolve(v: T): void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('round 6, 1: a History record whose outputs a later run overwrote', () => {
  it('opens the run that wrote the files last, and says so', async () => {
    const mock = installMockBridge()
    const out = '/d/x.tags.tsv'
    const a = rec('A', '/d/a.mzML', out, 1_000_000)
    const b = rec('B', '/d/b.mzML', out, 2_000_000)
    mock.history = [b, a]
    const { result } = hook(mock)
    await act(async () => result.current.showRecord(a, out))
    await waitFor(() => expect(result.current.results?.path).toBe(out))
    expect(result.current.results?.input).toBe('/d/b.mzML')
    expect(result.current.results?.replaced).toEqual({ input: '/d/a.mzML', by: '/d/b.mzML', end: 2_000_000 })
    expect(result.current.shown?.input).toBe('/d/b.mzML')
    // The newest record itself: no notice.
    await act(async () => result.current.showRecord(b, out))
    await waitFor(() => expect(result.current.results?.replaced).toBeUndefined())
    expect(result.current.results?.input).toBe('/d/b.mzML')
  })
})

describe('round 6, 2: a slow read of an earlier selection does not land', () => {
  it('a delayed history lookup of A leaves B\'s tags in place', async () => {
    const mock = installMockBridge()
    const slow = later<RunRecord | null>()
    const real = window.fastag.historyOf
    vi.spyOn(window.fastag, 'historyOf').mockImplementation((p) => (p === '/d/a.tags.tsv' ? slow.promise : real(p)))
    const { result } = hook(mock)
    let first!: Promise<void>
    await act(async () => {
      first = result.current.openResultsPath('/d/a.tags.tsv')
    })
    await act(async () => result.current.openResultsPath('/e/b.tags.tsv'))
    expect(result.current.results?.path).toBe('/e/b.tags.tsv')
    await act(async () => {
      slow.resolve(null)
      await first
    })
    expect(result.current.results?.path).toBe('/e/b.tags.tsv')
  })

  it('a delayed species report of A does not replace B or take the tab', async () => {
    const mock = installMockBridge()
    const slow = later<SpeciesReport>()
    vi.spyOn(window.fastag, 'species').mockImplementationOnce(() => slow.promise)
    const { result, view } = hook(mock)
    let first!: Promise<void>
    await act(async () => {
      first = result.current.openSpeciesPath('/d/a.tags.species.tsv')
    })
    await act(async () => result.current.openResultsPath('/e/b.tags.tsv'))
    expect(view.get().tab).toBe('results')
    await act(async () => {
      slow.resolve({ path: '/d/a.tags.species.tsv', taxa: [{ rank: 'genus', taxid: 9605, name: 'Homo', observed: 9, adjusted: 9, q: 0.01 }] })
      await first
    })
    expect(result.current.species).toBeNull()
    expect(view.get().tab).toBe('results')
    expect(result.current.results?.path).toBe('/e/b.tags.tsv')
  })

  it('a delayed sniff of A\'s QC report does not open it over B', async () => {
    const mock = installMockBridge()
    mock.reportFiles['/d/a.qc.tsv'] = 'section\tkey\tvalue\tn\tdescription\nrun\tversion\t1.15.3\t-\tFASTag 1.15.3 wrote this report.\nqc\tcount_ms2\t10\t-\tMS2 spectra read.\n'
    const slow = later<string | null>()
    const real = window.fastag.reportHead
    vi.spyOn(window.fastag, 'reportHead').mockImplementation((p) => (p === '/d/a.qc.tsv' ? slow.promise : real(p)))
    const { result, view } = hook(mock)
    let first!: Promise<void>
    await act(async () => {
      first = result.current.openResultsPath('/d/a.qc.tsv')
    })
    await act(async () => result.current.openResultsPath('/e/b.tags.tsv'))
    await act(async () => {
      slow.resolve(mock.reportFiles['/d/a.qc.tsv'])
      await first
    })
    expect(result.current.reports.workflow?.qc).toBeUndefined()
    expect(view.get().tab).toBe('results')
    expect(result.current.results?.path).toBe('/e/b.tags.tsv')
  })

  it('files of one run dropped together still all open', async () => {
    const mock = installMockBridge()
    mock.reportFiles['/d/r.digest.tsv'] = digestTsv
    const slow = later<RunRecord | null>()
    vi.spyOn(window.fastag, 'historyOf').mockImplementationOnce(() => slow.promise)
    const { result, view } = hook(mock)
    let tags!: Promise<void>
    await act(async () => {
      tags = result.current.openResultsPath('/d/r.tags.tsv')
    })
    await act(async () => result.current.openReportPaths(['/d/r.digest.tsv']))
    await act(async () => {
      slow.resolve(null)
      await tags
    })
    expect(result.current.results?.path).toBe('/d/r.tags.tsv')
    expect(result.current.reports.list.map((r) => r.path)).toContain('/d/r.digest.tsv')
    expect(view.get().tab).toBe('digest')
  })
})

describe('round 6, 6: two batch jobs writing one file', () => {
  it('refuses the batch before its first job', async () => {
    const mock = installMockBridge()
    vi.spyOn(window.fastag, 'outputsCheck').mockImplementation(() => Promise.resolve({ outputs: ['/d/Sample.qc.tsv'], existing: [], clashes: [] }))
    const { result } = hook(mock)
    act(() => result.current.addBatchPaths(['/d/sample.mzML', '/d/SAMPLE.mzML']))
    expect(result.current.jobs[0].out.toLowerCase()).not.toBe(result.current.jobs[1].out.toLowerCase())
    await act(async () => result.current.runBatch())
    expect(mock.runCalls).toHaveLength(0)
    expect(result.current.failure?.title).toBe('Not started: two jobs of this batch would write the same file')
    expect(result.current.failure?.reasons[0].text).toMatch(/differ only in case/)
  })
})

describe('round 6, 9: the mzPeak refusals of a batch', () => {
  it('runBatch checks the queued files again', async () => {
    const mock = installMockBridge()
    const { result } = hook(mock, { values: { ...initialValues(), complement_tolerance_unit: 'auto' } })
    act(() => result.current.addBatchPaths(['/d/a.mzML', '/d/b.mzpeak']))
    await act(async () => result.current.runBatch())
    expect(mock.runCalls).toHaveLength(0)
    expect(result.current.failure?.reasons[0].text).toMatch(/b\.mzpeak in this batch/)
  })

  it('the run bar names the mzPeak files of the queue, with the fix', async () => {
    const mock = installMockBridge()
    mock.settings.lastUsed = { complement_tolerance_unit: 'auto' }
    await renderApp(mock)
    await applyLastUsed(1)
    await addBatch(mock, ['/d/a.mzML', '/d/b.mzpeak'])
    showView('setup')
    await waitFor(() => expect(document.body.textContent).toMatch(/b\.mzpeak in this batch/))
    expect([...document.querySelectorAll('button')].some((b) => b.textContent === 'Use Da')).toBe(true)
  })
})
