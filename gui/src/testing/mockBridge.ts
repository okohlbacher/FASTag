// Control-surface mock of the window.fastag bridge. App.tsx never imports
// api.ts — main.tsx installs the bridge as a global, so the global IS the seam
// the shipped code uses. Tests install this in its place and drive the run
// lifecycle by hand (emit*), including the done-before-run()-resolves race
// (holdRun/releaseRun).
//
// Like the backend, every run has a Channel of its own (the onEvent its
// run() call was given). The mock numbers the runs it started, 1, 2, ...
// (lastRunId): emitDone({runId}) and emitEvent(runId, ...) send to that
// run's Channel, emitLog/emitProgress/emitPhase to the newest run's. A
// runId no run has, or none, reaches no Channel, as nothing can on the
// backend. This fake Channel only feeds App-level tests; api.ts itself is
// tested against Tauri's IPC mock (api.test.ts).

import type {
  BinaryInfo,
  BrowserEvent,
  DropRoute,
  FastagApi,
  ResolvedOutputs,
  ResultsView,
  RunEvent,
  RunRecord,
  RunResult,
  RunStarted,
  Settings,
  SpeciesReport,
  TaxdbInfo
} from '../types'
import runStartedFixture from './fixtures/run-started.json'

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
  /// False: savePreset and deletePreset refuse, as the app does when the
  /// settings file cannot be written.
  settingsWritable: boolean
  nextPickInput: string | null
  nextPickInputs: string[]
  nextPickOutput: string | null
  pickFileCalls: { kind: 'open' | 'save'; formats?: string[] }[]
  nextPickResults: string | null
  nextPickReport: string | null
  nextPickFolder: string | null
  // folder -> the spectra files folderSpectra lists; a folder not named
  // here is not a folder.
  folderFiles: Record<string, string[]>
  folderSpectraCalls: string[]
  // writeSummary() calls; summaryWriteError: the next writes reject.
  summaryWrites: { dest: string; text: string }[]
  summaryWriteError: string | null
  // path -> report text; a missing path reads as "not written".
  reportFiles: Record<string, string>
  reportCalls: string[]
  resultsColumns: string[]
  resultsRows: string[][]
  resultsError: Error | null
  speciesResult: SpeciesReport | null
  // path -> species report; a path not named here reads speciesResult.
  speciesFiles: Record<string, SpeciesReport>
  speciesError: Error | null
  taxdbInfoResult: TaxdbInfo | null
  // Output paths that "exist": outputsCheck reports those a run would write.
  existingOutputs: string[]
  // The run record (history.rs), newest first.
  history: RunRecord[]
  // commandLine() and exportIni() calls; exportIniError: the next exports reject.
  commandLineCalls: RunCall[]
  exportIniCalls: { params: RunCall; dest: string }[]
  exportIniError: string | null
  // The command line of a run request, binary first, as commandLine()
  // answers it. (run()'s reply keeps its short -in/-out command, which the
  // failure-banner tests pin; fastag.rs builds both from one function.)
  commandOf(call: RunCall): string[]
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
  // The number of the most recent run() that started (allocated at call
  // time, so a test can emit its terminal event before releasing the held
  // invoke reply).
  lastRunId: number
  // Control surface: messages on a run's Channel (see the header).
  emitLog(line: string): void
  emitProgress(p: { done: number; total: number; ratePerSec?: number | null; etaSec?: number | null }): void
  emitPhase(label: string): void
  emitDone(r: RunResult & { runId?: number }): void
  emitEvent(runId: number, e: RunEvent): void
  // The backend's close guard: a close or quit request while busy.
  emitCloseRequested(what: 'close' | 'quit'): void
  // An OS file drop (drop.rs DropRoute), and a drag over the window.
  emitDrop(route: Partial<DropRoute>): void
  emitDragHover(over: boolean): void
  notifyCalls: { title: string; body: string }[]
  holdRun(): void
  releaseRun(): void
}

/// The reply of `run` exactly as fastag.rs serialises it (cargo test
/// the_run_reply_names_every_output_by_its_option_name compares the two).
export const RUN_STARTED_FIXTURE: RunStarted = runStartedFixture
/// Every key of ResolvedOutputs on the wire.
export const OUTPUT_KEYS = Object.keys(runStartedFixture.outputs) as (keyof ResolvedOutputs)[]

const isAbs = (p: string): boolean => p.startsWith('/')
const dirOf = (p: string): string => p.slice(0, p.lastIndexOf('/') + 1)

/// The outputs a run of @p call writes, as fastag.rs resolves them (the
/// same rules on Unix paths): relative against the folder of an absolute
/// input, the species and glyco reports derived from -out when on without a
/// path of their own.
export function mockOutputs(call: RunCall): ResolvedOutputs {
  const dir = isAbs(call.in) ? dirOf(call.in) : ''
  const abs = (p: string): string => (isAbs(p) || !dir ? p : `${dir}${p}`)
  const params = call.params ?? {}
  const str = (n: string): string => (typeof params[n] === 'string' ? String(params[n]).trim() : '')
  const out = call.out ? abs(call.out) : null
  const derive = (suffix: string): string | null => {
    if (!out) return null
    const slash = out.lastIndexOf('/')
    const dot = out.lastIndexOf('.')
    return `${dot > slash ? out.slice(0, dot) : out}${suffix}`
  }
  const o: ResolvedOutputs = { out }
  // The keys the backend sends (fixtures/run-started.json, which cargo pins
  // to the JSON of `run`'s reply), never a list of this mock's own.
  for (const n of OUTPUT_KEYS) {
    if (n !== 'out') o[n] = str(n) ? abs(str(n)) : null
  }
  if (params['species'] === true && !o.species_out) o.species_out = derive('.species.tsv')
  if (params['glyco'] === true && !o.glyco_out) o.glyco_out = derive('.glyco.tsv')
  return o
}

/// The argv of a run request as the mock spells it: -in, -out, then each
/// parameter that has a value (switches as presence), in request order.
function mockArgv(call: RunCall): string[] {
  const a = ['-in', call.in, '-out', call.out]
  for (const [n, v] of Object.entries(call.params ?? {})) {
    if (v === true) a.push(`-${n}`)
    else if (Array.isArray(v)) {
      const items = v.map((x) => String(x).trim()).filter(Boolean)
      if (items.length) a.push(`-${n}`, ...items)
    } else if (typeof v === 'string' && v.trim() !== '') a.push(`-${n}`, v.trim())
  }
  return a
}

export function installMockBridge(): MockBridge {
  // Each started run's Channel, by its number.
  const channels = new Map<number, (e: RunEvent) => void>()
  const send = (id: number | undefined, e: RunEvent): void => {
    if (id != null) channels.get(id)?.(e)
  }
  const closeListeners: ((what: 'close' | 'quit') => void)[] = []
  const menuListeners: ((action: string) => void)[] = []
  const dropListeners: ((r: DropRoute) => void)[] = []
  const hoverListeners: ((over: boolean) => void)[] = []
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
    settingsWritable: true,
    nextPickInput: null,
    nextPickInputs: [],
    nextPickOutput: null,
    pickFileCalls: [],
    nextPickResults: null,
    nextPickReport: null,
    nextPickFolder: null,
    folderFiles: {},
    folderSpectraCalls: [],
    summaryWrites: [],
    summaryWriteError: null,
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
    speciesFiles: {},
    speciesError: null,
    taxdbInfoResult: null,
    existingOutputs: [],
    history: [],
    commandLineCalls: [],
    exportIniCalls: [],
    exportIniError: null,
    commandOf: (call) => [mock.binaryInfo.bin, ...mockArgv(call)],
    commandLine: (params) => {
      const call = params as unknown as RunCall
      mock.commandLineCalls.push(call)
      return Promise.resolve(mock.commandOf(call))
    },
    exportIni: (params, dest) => {
      mock.exportIniCalls.push({ params: params as unknown as RunCall, dest })
      if (mock.exportIniError) return Promise.reject(mock.exportIniError)
      return Promise.resolve({ dest, items: mockArgv(params as unknown as RunCall).filter((a) => a.startsWith('-')).length })
    },
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

    emitLog: (line) => send(mock.lastRunId, { kind: 'log', lines: [[line, true]] }),
    emitProgress: (p) => send(mock.lastRunId, { kind: 'progress', ...p }),
    emitPhase: (label) => send(mock.lastRunId, { kind: 'phase', label }),
    emitDone: ({ runId, ...r }) => send(runId, { kind: 'done', ...r }),
    emitEvent: (runId, e) => send(runId, e),
    emitCloseRequested: (what) => closeListeners.slice().forEach((cb) => cb(what)),
    emitDrop: (r) => {
      const route: DropRoute = {
        spectra: [],
        batch: false,
        fasta: null,
        taxdb: null,
        results: null,
        reports: [],
        sdrf: null,
        ignored: [],
        ...r
      }
      dropListeners.slice().forEach((cb) => cb(route))
    },
    emitDragHover: (over) => hoverListeners.slice().forEach((cb) => cb(over)),
    notifyCalls: [],
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
      if (!mock.settingsWritable) return Promise.resolve(false)
      mock.settings.presets[name] = values
      return Promise.resolve(true)
    },
    deletePreset: (name) => {
      if (!mock.settingsWritable || !(name in mock.settings.presets)) return Promise.resolve(false)
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
    pickFolder: () => Promise.resolve(mock.nextPickFolder),
    folderSpectra: (dir) => {
      mock.folderSpectraCalls.push(dir)
      const f = mock.folderFiles[dir]
      return f ? Promise.resolve(f.slice()) : Promise.reject(new Error(`${dir} is not a folder`))
    },
    writeSummary: (dest, text) => {
      if (mock.summaryWriteError) return Promise.reject(new Error(mock.summaryWriteError))
      mock.summaryWrites.push({ dest, text })
      return Promise.resolve()
    },
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
      return mock.speciesError ? Promise.reject(mock.speciesError) : Promise.resolve(mock.speciesFiles[path] ?? mock.speciesResult)
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
    run: (params, onEvent) => {
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
      channels.set(mock.lastRunId, onEvent)
      // As fastag.rs does: every output resolved (a relative one against the
      // folder of an absolute input) comes back in `outputs`.
      const call = params as unknown as RunCall
      const outputs = mockOutputs(call)
      const started: RunStarted = {
        started: true,
        out: outputs.out,
        outputs,
        command: [mock.binaryInfo.bin, '-in', call.in, '-out', outputs.out ?? '']
      }
      if (held) return new Promise<RunStarted>((resolve) => held!.push(() => resolve(started)))
      return Promise.resolve(started)
    },

    onCloseRequested: on(closeListeners),
    answerClose: (quit) => {
      mock.closeAnswers.push(quit)
      return Promise.resolve()
    },
    setBusy: (busy) => {
      mock.busyCalls.push(busy)
      return Promise.resolve()
    },
    onDrop: on(dropListeners),
    onDragHover: on(hoverListeners),
    notify: (title, body) => {
      mock.notifyCalls.push({ title, body })
      return Promise.resolve()
    }
  }

  window.fastag = mock
  return mock
}
