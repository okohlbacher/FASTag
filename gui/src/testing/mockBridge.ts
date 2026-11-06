// Control-surface mock of the window.fastag bridge. App.tsx never imports
// api.ts — main.tsx installs the bridge as a global, so the global IS the seam
// the shipped code uses. Tests install this in its place and drive the run
// lifecycle by hand (emit*), including the done-before-run()-resolves race
// (holdRun/releaseRun).

import type {
  BinaryInfo,
  BrowserEvent,
  FastagApi,
  ResultsView,
  RunRecord,
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
  // Set (true) only when the user confirmed overwriting existing outputs.
  overwrite?: boolean
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
  pickFileCalls: { kind: 'open' | 'save'; formats?: string[] }[]
  nextPickResults: string | null
  nextPickReport: string | null
  // path -> report text; a missing path reads as "not written".
  reportFiles: Record<string, string>
  reportCalls: string[]
  resultsColumns: string[]
  resultsRows: string[][]
  resultsError: Error | null
  speciesResult: SpeciesReport | null
  speciesError: Error | null
  taxdbInfoResult: TaxdbInfo | null
  // Output paths that "exist": outputsCheck reports those a run would write.
  existingOutputs: string[]
  // The run record (history.rs), newest first.
  history: RunRecord[]
  // What sweep.rs would offer at startup; the sweep and keep calls, and the
  // paths a sweep fails to remove.
  leftoverFiles: string[]
  sweepCalls: string[][]
  keepCalls: string[][]
  sweepFails: string[]
  failNextRun: string | null // one-shot: run() resolves { started: false, reason }
  rejectNextRun: Error | null // one-shot: run() rejects
  // Recorded calls.
  runCalls: RunCall[]
  outputsCheckCalls: RunCall[]
  resultsQueryCalls: ResultsQueryCall[]
  resultsOpenCalls: string[]
  // The last open's event callback: tests drive the D5 events with it.
  emitBrowser(e: BrowserEvent): void
  revealCalls: { path: string; folder: boolean }[]
  revealError: Error | null
  emitMenu(action: string): void
  exportCalls: { path: string; view: ResultsView; columns: string[]; dest: string }[]
  speciesCalls: string[]
  cancelCalls: number
  savedLast: Record<string, unknown>[]
  // answerClose(quit) calls, and the setBusy values, in order.
  closeAnswers: boolean[]
  busyCalls: boolean[]
  // The id the most recent run() allocated (allocated at call time, so a test
  // can emit its terminal event before releasing the held invoke reply).
  lastRunId: number
  // Control surface.
  emitLog(line: string): void
  emitProgress(p: { done: number; total: number }): void
  emitDone(r: RunResult): void
  // The backend's close guard: a close or quit request while busy.
  emitCloseRequested(what: 'close' | 'quit'): void
  holdRun(): void
  releaseRun(): void
}

export function installMockBridge(): MockBridge {
  const logListeners: ((line: string) => void)[] = []
  const progressListeners: ((p: { done: number; total: number }) => void)[] = []
  const doneListeners: ((r: RunResult) => void)[] = []
  const closeListeners: ((what: 'close' | 'quit') => void)[] = []
  const menuListeners: ((action: string) => void)[] = []
  let browserCb: ((e: BrowserEvent) => void) | null = null
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
    pickFileCalls: [],
    nextPickResults: null,
    nextPickReport: null,
    reportFiles: {},
    reportCalls: [],
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
    existingOutputs: [],
    history: [],
    leftoverFiles: [],
    sweepCalls: [],
    keepCalls: [],
    sweepFails: [],
    failNextRun: null,
    rejectNextRun: null,
    runCalls: [],
    outputsCheckCalls: [],
    resultsQueryCalls: [],
    exportCalls: [],
    resultsOpenCalls: [],
    revealCalls: [],
    revealError: null,
    emitBrowser: (e) => browserCb?.(e),
    emitMenu: (a) => menuListeners.slice().forEach((cb) => cb(a)),
    speciesCalls: [],
    cancelCalls: 0,
    savedLast: [],
    closeAnswers: [],
    busyCalls: [],
    lastRunId: 0,

    emitLog: (line) => logListeners.slice().forEach((cb) => cb(line)),
    emitProgress: (p) => progressListeners.slice().forEach((cb) => cb(p)),
    emitDone: (r) => doneListeners.slice().forEach((cb) => cb(r)),
    emitCloseRequested: (what) => closeListeners.slice().forEach((cb) => cb(what)),
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
    pickFile: (formats) => {
      mock.pickFileCalls.push({ kind: 'open', formats })
      return Promise.resolve(mock.nextPickInput)
    },
    saveFile: (_defaultPath, formats) => {
      mock.pickFileCalls.push({ kind: 'save', formats })
      return Promise.resolve(mock.nextPickOutput)
    },
    pickResults: () => Promise.resolve(mock.nextPickResults),
    pickReport: () => Promise.resolve(mock.nextPickReport),
    report: (path) => {
      mock.reportCalls.push(path)
      return Promise.resolve(mock.reportFiles[path] ?? null)
    },
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
        rows: mock.resultsRows.slice(offset, offset + limit)
      })
    },
    // The head read: the first rows in file order. Generation 1; the mock
    // sends no events of its own (its resultsQuery is always ranked).
    resultsOpen: (path, onEvent) => {
      mock.resultsOpenCalls.push(path)
      browserCb = onEvent
      if (mock.resultsError) return Promise.reject(mock.resultsError)
      return Promise.resolve({
        generation: 1,
        columns: mock.resultsColumns,
        rows: mock.resultsRows.slice(0, 1000),
        complete: mock.resultsRows.length <= 1000
      })
    },
    resultsPosition: () => Promise.resolve(null),
    revealOutput: (path, folder) => {
      mock.revealCalls.push({ path, folder })
      return mock.revealError ? Promise.reject(mock.revealError) : Promise.resolve()
    },
    onMenu: on(menuListeners),
    exportResults: (path, view, columns, dest) => {
      mock.exportCalls.push({ path, view, columns, dest })
      return Promise.resolve(mock.resultsRows.length)
    },
    // Which outputs a run would write: -out (resolved like run() does) and
    // every *_out parameter with a value; those in existingOutputs exist.
    outputsCheck: (params) => {
      const call = params as unknown as RunCall
      mock.outputsCheckCalls.push(call)
      const dir = call.in.startsWith('/') ? call.in.slice(0, call.in.lastIndexOf('/') + 1) : ''
      const abs = (p: string): string => (p.startsWith('/') || !dir ? p : `${dir}${p}`)
      const outputs = [call.out, ...Object.entries(call.params ?? {})
        .filter(([n, v]) => /_out$/.test(n) && typeof v === 'string' && v !== '')
        .map(([, v]) => String(v))].filter((p) => p).map(abs)
      return Promise.resolve({ outputs, existing: outputs.filter((p) => mock.existingOutputs.includes(p)) })
    },
    historyList: (limit) => Promise.resolve(mock.history.slice(0, limit ?? 50)),
    historyOf: (path) => Promise.resolve(mock.history.find((r) => r.outputs.includes(path)) ?? null),
    leftovers: () => Promise.resolve([...mock.leftoverFiles]),
    sweepLeftovers: (paths) => {
      mock.sweepCalls.push(paths)
      const listed = paths.filter((p) => mock.leftoverFiles.includes(p))
      const failed = paths.filter((p) => !listed.includes(p) || mock.sweepFails.includes(p))
      const removed = listed.filter((p) => !failed.includes(p))
      mock.leftoverFiles = mock.leftoverFiles.filter((p) => !removed.includes(p))
      return Promise.resolve({ removed, renamed: [], failed })
    },
    keepLeftovers: (paths) => {
      mock.keepCalls.push(paths)
      mock.leftoverFiles = mock.leftoverFiles.filter((p) => !paths.includes(p))
      return Promise.resolve()
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
      // As fastag.rs does: a relative -out is resolved against the folder of
      // an absolute input, and the resolved path comes back as `out`.
      const { in: inFile, out } = params as unknown as RunCall
      const resolved =
        out && !out.startsWith('/') && inFile.startsWith('/') ? `${inFile.slice(0, inFile.lastIndexOf('/') + 1)}${out}` : out
      const started: RunStarted = { started: true, runId: mock.lastRunId, out: resolved, command: [mock.binaryInfo.bin, '-in', inFile, '-out', resolved] }
      if (held) return new Promise<RunStarted>((resolve) => held!.push(() => resolve(started)))
      return Promise.resolve(started)
    },

    onLog: on(logListeners),
    onProgress: on(progressListeners),
    onDone: on(doneListeners),
    onCloseRequested: on(closeListeners),
    answerClose: (quit) => {
      mock.closeAnswers.push(quit)
      return Promise.resolve()
    },
    setBusy: (busy) => {
      mock.busyCalls.push(busy)
      return Promise.resolve()
    }
  }

  window.fastag = mock
  return mock
}
