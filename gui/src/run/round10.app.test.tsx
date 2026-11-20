// Review round 10, the run hook: which files are one run (2: the app's run
// record first, then the run name, file stems only for unknown files) and
// what another run left shown, judged in the reducer (3: a report opener
// that started while A was shown must not clear B's tags that landed first).

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useRun, type RunInputs } from './useRun'
import { createViewStore } from '../app/viewStore'
import { initialValues } from '../setup/useSession'
import { installMockBridge, type MockBridge } from '../testing/mockBridge'
import type { RunRecord } from '../types'
import { sameRun, sameRunIn } from '../results/reports'
import { parseReport } from '../digestReport'
import digestTsv from '../fixtures/cli-1.15/ecoli_ms2_small_20ppm.digest.tsv?raw'

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

const rec = (id: string, input: string, outputs: string[], end: number): RunRecord => ({
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
  params: {},
  workflow: 'characterize'
})

function later<T>(): { promise: Promise<T>; resolve(v: T): void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

// The run rows of the digest fixture, as a label report of the same input.
const RUN_ROWS = digestTsv
  .split('\n')
  .filter((l, i) => i === 0 || l.startsWith('run\t'))
  .join('\n')
const LABEL = `${RUN_ROWS}\nnlabel\tdetected\tnone\t-\tNo label was found.\n`
const QC = 'section\tkey\tvalue\tn\tdescription\nrun\tversion\t1.15.3\t-\tFASTag 1.15.3 wrote this report.\nqc\tcount_ms2\t10\t-\tMS2 spectra read.\n'

describe('round 10, 2: one run, told by its record, else its run name', () => {
  it('sameRun: two runs of one input in one folder differ by their run name', () => {
    const a = parseReport(digestTsv, '/d/runA.digest.tsv')
    const b = parseReport(LABEL, '/d/runB.label.tsv')
    const a2 = parseReport(LABEL, '/d/runA.label.tsv')
    expect(sameRun(a, b)).toBe(false)
    expect(sameRun(a, a2)).toBe(true)
    // Custom names have no run name: unknown identity without a record
    // (round 10 minor: the run rows do not tell two runs that differ only
    // in Extension), the record decides with one.
    const q = parseReport(digestTsv, '/d/digest-final.tsv')
    const l = parseReport(LABEL, '/d/label-final.tsv')
    expect(sameRun(q, l)).toBe(false)
    const runs = new Map([
      ['/d/digest-final.tsv', { id: 'R1', outputs: ['/d/digest-final.tsv'] }],
      ['/d/label-final.tsv', { id: 'R2', outputs: ['/d/label-final.tsv'] }]
    ])
    expect(sameRun(q, l, runs)).toBe(false)
    const one = new Map([
      ['/d/digest-final.tsv', { id: 'R1', outputs: ['/d/digest-final.tsv', '/d/label-final.tsv'] }],
      ['/d/label-final.tsv', { id: 'R1', outputs: ['/d/digest-final.tsv', '/d/label-final.tsv'] }]
    ])
    expect(sameRun(q, l, one)).toBe(true)
  })

  it('sameRunIn: the record first, file stems only for unknown files', () => {
    const runs = new Map([
      ['/d/qc-final.tsv', { id: 'R', outputs: ['/d/qc-final.tsv', '/d/taxonomy-final.tsv', '/d/out.tsv'] }],
      ['/d/taxonomy-final.tsv', { id: 'R', outputs: ['/d/qc-final.tsv', '/d/taxonomy-final.tsv', '/d/out.tsv'] }]
    ])
    expect(sameRunIn(runs, '/d/qc-final.tsv', '/d/taxonomy-final.tsv')).toBe(true)
    // One recorded: the other belongs when the record lists it.
    expect(sameRunIn(runs, '/d/qc-final.tsv', '/d/out.tsv')).toBe(true)
    expect(sameRunIn(runs, '/d/qc-final.tsv', '/d/qc-final.digest.tsv')).toBe(false)
    // Neither recorded: the file stems.
    expect(sameRunIn(runs, '/d/x.qc.tsv', '/d/x.digest.tsv')).toBe(true)
  })

  it('sameRunIn: two persisted run ids are two runs, even when one lists the other path', () => {
    // Run B rewrote sample.tags.tsv; A's leftover sample.qc.tsv must not join B.
    const runs = new Map([
      ['/d/sample.qc.tsv', { id: 'A', outputs: ['/d/sample.tags.tsv', '/d/sample.qc.tsv'] }],
      ['/d/sample.tags.tsv', { id: 'B', outputs: ['/d/sample.tags.tsv'] }]
    ])
    expect(sameRunIn(runs, '/d/sample.tags.tsv', '/d/sample.qc.tsv')).toBe(false)
    // The run just shown is known by its outputs.
    const shown = new Map([
      ['/d/sample.qc.tsv', { id: 'A', outputs: ['/d/sample.qc.tsv'] }],
      ['/d/sample.tags.tsv', { id: 'shown:/d/sample.tags.tsv', outputs: ['/d/sample.tags.tsv', '/d/sample.qc.tsv'] }]
    ])
    expect(sameRunIn(shown, '/d/sample.tags.tsv', '/d/sample.qc.tsv')).toBe(true)
  })

  it('two runs of one input in one folder: B\'s label report closes A\'s digest report, with a note', async () => {
    const mock = installMockBridge()
    mock.reportFiles['/d/runA.digest.tsv'] = digestTsv
    mock.reportFiles['/d/runB.label.tsv'] = LABEL
    mock.history = [rec('B', '/d/Ecoli_MS2_small.mzML', ['/d/runB.tags.tsv', '/d/runB.label.tsv'], 2_000), rec('A', '/d/Ecoli_MS2_small.mzML', ['/d/runA.tags.tsv', '/d/runA.digest.tsv'], 1_000)]
    const { result } = hook(mock)
    await act(async () => result.current.openReportPaths(['/d/runA.digest.tsv']))
    await act(async () => result.current.openReportPaths(['/d/runB.label.tsv']))
    expect(result.current.reports.list.map((r) => r.path)).toEqual(['/d/runB.label.tsv'])
    expect(result.current.reports.errors.join(' ')).toMatch(/another run of Ecoli_MS2_small\.mzML; \/d\/runA\.digest\.tsv was closed/)
  })

  it('custom-named outputs of one run stay together', async () => {
    const mock = installMockBridge()
    mock.reportFiles['/d/qc-final.tsv'] = QC
    mock.reportFiles['/d/digest-final.tsv'] = digestTsv
    mock.history = [rec('R', '/d/Ecoli_MS2_small.mzML', ['/d/final.tsv', '/d/qc-final.tsv', '/d/digest-final.tsv'], 1_000)]
    const { result } = hook(mock)
    await act(async () => result.current.openResultsPath('/d/qc-final.tsv'))
    expect(result.current.reports.workflow?.qc).toBe('/d/qc-final.tsv')
    await act(async () => result.current.openReportPaths(['/d/digest-final.tsv']))
    expect(result.current.reports.list.map((r) => r.path)).toEqual(['/d/digest-final.tsv'])
    expect(result.current.reports.workflow?.qc).toBe('/d/qc-final.tsv')
    expect(result.current.reports.errors).toEqual([])
  })
})

describe('round 10 minor: a drop of custom-named files of one run', () => {
  it('the tags and the QC report stay together (one selection per drop)', async () => {
    const mock = installMockBridge()
    mock.reportFiles['/d/qc-final.tsv'] = QC
    mock.history = [rec('R', '/d/Ecoli_MS2_small.mzML', ['/d/final.tsv', '/d/qc-final.tsv'], 1_000)]
    const { result } = hook(mock)
    await act(async () => result.current.openDropped({ results: '/d/final.tsv', reports: ['/d/qc-final.tsv'] }))
    await waitFor(() => expect(result.current.reports.workflow?.qc).toBe('/d/qc-final.tsv'))
    expect(result.current.results?.path).toBe('/d/final.tsv')
  })
})

describe('round 10, 3: what another run left shown goes in the reducer', () => {
  it('with A shown, B\'s tags that land first survive B\'s report read out of order', async () => {
    const mock = installMockBridge()
    mock.reportFiles['/d/a.digest.tsv'] = digestTsv
    mock.reportFiles['/e/b.digest.tsv'] = digestTsv
    const a = rec('A', '/d/a.mzML', ['/d/a.tags.tsv', '/d/a.digest.tsv'], 1_000)
    mock.history = [a]
    const { result } = hook(mock)
    await act(async () => result.current.showRecord(a, '/d/a.tags.tsv'))
    await waitFor(() => expect(result.current.shown?.out).toBe('/d/a.tags.tsv'))
    // B's report starts reading while A is shown; its record lookup waits.
    const slow = later<RunRecord | null>()
    const real = window.fastag.historyOf
    vi.spyOn(window.fastag, 'historyOf').mockImplementation((p) => (p === '/e/b.digest.tsv' ? slow.promise : real(p)))
    let report!: Promise<void>
    const opener = result.current
    await act(async () => {
      report = opener.openReportPaths(['/e/b.digest.tsv'])
    })
    // B's tags land first.
    await act(async () => result.current.openResultsPath('/e/b.tags.tsv'))
    expect(result.current.results?.path).toBe('/e/b.tags.tsv')
    expect(result.current.shown).toBeNull()
    await act(async () => {
      slow.resolve(null)
      await report
    })
    expect(result.current.results?.path).toBe('/e/b.tags.tsv')
    expect(result.current.reports.list.map((r) => r.path)).toEqual(['/e/b.digest.tsv'])
  })
})
