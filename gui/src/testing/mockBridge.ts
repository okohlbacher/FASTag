// Control-surface mock of the window.fastag bridge. App.tsx never imports
// api.ts — main.tsx installs the bridge as a global, so the global IS the seam
// the shipped code uses. Tests install this in its place and drive the run
// lifecycle by hand (emit*), including the done-before-run()-resolves race
// (holdRun/releaseRun).

import type {
  BinaryInfo,
  FastagApi,
  ResultsView,
  RunResult,
  RunStarted,
  Settings,
  SpeciesReport,
  TaxdbInfo
} from '../types'

export interface RunCall {
  in: string
  out: string
  params: Record<string, unknown>
}

export interface ResultsQueryCall {
  path: string
  view: ResultsView
  offset: number
  limit: number
}

export interface MockBridge extends FastagApi {
  // Programmable returns.
  binaryInfo: BinaryInfo
  settings: Settings
  nextPickInput: string | null
  nextPickInputs: string[]
  nextPickOutput: string | null
  nextPickResults: string | null
  resultsColumns: string[]
  resultsRows: string[][]
  resultsError: Error | null
  speciesResult: SpeciesReport | null
  speciesError: Error | null
  taxdbInfoResult: TaxdbInfo | null
  failNextRun: string | null // one-shot: run() resolves { started: false, reason }
  rejectNextRun: Error | null // one-shot: run() rejects
  // Recorded calls.
  runCalls: RunCall[]
  resultsQueryCalls: ResultsQueryCall[]
  speciesCalls: string[]
  cancelCalls: number
  savedLast: Record<string, unknown>[]
  // The id the most recent run() allocated (allocated at call time, so a test
  // can emit its terminal event before releasing the held invoke reply).
  lastRunId: number
  // Control surface.
  emitLog(line: string): void
  emitProgress(p: { done: number; total: number }): void
  emitDone(r: RunResult): void
  holdRun(): void
  releaseRun(): void
}

export function installMockBridge(): MockBridge {
  const logListeners: ((line: string) => void)[] = []
  const progressListeners: ((p: { done: number; total: number }) => void)[] = []
  const doneListeners: ((r: RunResult) => void)[] = []
  const on = <T>(list: ((v: T) => void)[]) => {
    return (cb: (v: T) => void): (() => void) => {
      list.push(cb)
      return () => {
        const i = list.indexOf(cb)
        if (i >= 0) list.splice(i, 1)
      }
    }
  }

  let seq = 0
  let held: (() => void)[] | null = null

  const mock: MockBridge = {
    binaryInfo: { bin: '/mock/FASTag', source: 'env', ok: true, detail: 'FASTag 9.9.9 (mock)' },
    settings: { schemaVersion: 1, lastUsed: null, presets: {} },
    nextPickInput: null,
    nextPickInputs: [],
    nextPickOutput: null,
    nextPickResults: null,
    resultsColumns: ['spectrum', 'tag', 'length', 'evalue', 'fasta_hit'],
    resultsRows: [
      ['frame=5', 'AQRQAAN', '7', '0.003', 'fwd'],
      ['frame=5', 'QRQAANS', '7', '0.008', '-'],
      ['frame=7', 'LNDLAAK', '7', '0.0001', 'rev']
    ],
    resultsError: null,
    speciesResult: null,
    speciesError: null,
    taxdbInfoResult: null,
    failNextRun: null,
    rejectNextRun: null,
    runCalls: [],
    resultsQueryCalls: [],
    speciesCalls: [],
    cancelCalls: 0,
    savedLast: [],
    lastRunId: 0,

    emitLog: (line) => logListeners.slice().forEach((cb) => cb(line)),
    emitProgress: (p) => progressListeners.slice().forEach((cb) => cb(p)),
    emitDone: (r) => doneListeners.slice().forEach((cb) => cb(r)),
    holdRun: () => {
      held = held ?? []
    },
    releaseRun: () => {
      const q = held ?? []
      held = null
      q.forEach((release) => release())
    },

    probe: () => Promise.resolve(mock.binaryInfo),
    loadSettings: () => Promise.resolve(mock.settings),
    saveLast: (values) => {
      mock.savedLast.push(values)
      return Promise.resolve(true)
    },
    savePreset: (name, values) => {
      mock.settings.presets[name] = values
      return Promise.resolve(true)
    },
    deletePreset: (name) => {
      delete mock.settings.presets[name]
      return Promise.resolve(true)
    },
    taxdbInfo: () => Promise.resolve(mock.taxdbInfoResult),
    openTaxon: () => Promise.resolve(true),
    pickInput: () => Promise.resolve(mock.nextPickInput),
    pickInputs: () => Promise.resolve(mock.nextPickInputs),
    pickOutput: () => Promise.resolve(mock.nextPickOutput),
    pickResults: () => Promise.resolve(mock.nextPickResults),
    cancel: () => {
      mock.cancelCalls++
      return Promise.resolve({ cancelled: true })
    },
    species: (path) => {
      mock.speciesCalls.push(path)
      return mock.speciesError ? Promise.reject(mock.speciesError) : Promise.resolve(mock.speciesResult)
    },
    resultsQuery: (path, view, offset, limit) => {
      mock.resultsQueryCalls.push({ path, view, offset, limit })
      if (mock.resultsError) return Promise.reject(mock.resultsError)
      return Promise.resolve({
        columns: mock.resultsColumns,
        totalRows: mock.resultsRows.length,
        matchedRows: mock.resultsRows.length,
        offset,
        rows: mock.resultsRows.slice(offset, offset + limit)
      })
    },
    run: (params) => {
      mock.runCalls.push(params as unknown as RunCall)
      if (mock.rejectNextRun) {
        const e = mock.rejectNextRun
        mock.rejectNextRun = null
        return Promise.reject(e)
      }
      if (mock.failNextRun) {
        const reason = mock.failNextRun
        mock.failNextRun = null
        return Promise.resolve({ started: false, reason })
      }
      mock.lastRunId = ++seq
      const started: RunStarted = { started: true, runId: mock.lastRunId }
      if (held) return new Promise<RunStarted>((resolve) => held!.push(() => resolve(started)))
      return Promise.resolve(started)
    },

    onLog: on(logListeners),
    onProgress: on(progressListeners),
    onDone: on(doneListeners)
  }

  window.fastag = mock
  return mock
}
