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
  CliOptions,
  DropRoute,
  ExportEvent,
  ExportFormat,
  FastagApi,
  ProbeRun,
  ResolvedOutputs,
  NavAnswer,
  ResultsView,
  RunEvent,
  RunRecord,
  RunResult,
  RunStarted,
  Settings,
  SpeciesReport,
  SpectrumDump,
  FastaDatabase,
  FastaSegment,
  SpectrumSupport,
  TaxdbInfo,
  TaxonomyStatus,
  DataStatus,
  TaxonomyDump
} from '../types'
import runStartedFixture from './fixtures/run-started.json'
import manifest from '../params.generated.json'
import { tagsToDenovo } from '../export/denovo'
import { forgetTables } from '../results/tableStore'
import { publicExport } from '../feedback/publicExport'
import { issueUrl } from '../feedback/issueUrl'
import type { FeedbackPlatform, FeedbackReport, Include, NativeCapture, ReportStatus, RunInfo } from '../feedback/types'

/// A UUID v4 for the mock's reports (the backend makes them in feedback.rs).
function uuid4(): string {
  const b = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(b)
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

// As outputs.rs is_proteome_file: -alkylation_proteome names a FASTA unless
// it is a shipped proteome's name.
const proteomeFile = (v: unknown): string[] =>
  typeof v === 'string' && v.trim() !== '' && !['auto', 'human', 'mouse', 'yeast', 'ecoli'].includes(v.trim().toLowerCase()) ? [v] : []

export interface RunCall {
  in: string
  out: string
  params: Record<string, unknown>
  // Set (true) only when the user confirmed overwriting existing outputs.
  overwrite?: boolean
  // The inputs of the other jobs of a batch (fastag.rs RunParams.protect).
  protect?: string[]
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
  // exampleInput's answer; null: the install has no example data.
  nextExampleInput: string | null
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
  // The protect list of each writeSummary() call (undefined: none).
  summaryProtect: (string[] | undefined)[]
  summaryWriteError: string | null
  // pickSdrf() answers nextPickSdrf; sdrfRead() serves sdrfFiles (a path
  // not named there rejects as missing); taxonomyDump() answers
  // taxonomyResult (or rejects with taxonomyError) and records its calls.
  nextPickSdrf: string | null
  sdrfFiles: Record<string, Uint8Array>
  sdrfReadCalls: string[]
  taxonomyResult: TaxonomyDump | null
  taxonomyError: string | null
  taxonomyCalls: { nodes?: string; names?: string }[]
  // path -> report text; a missing path reads as "not written".
  reportFiles: Record<string, string>
  // path -> the error report() rejects with (report.rs read_report: too large, unreadable).
  reportErrors: Record<string, string>
  reportCalls: string[]
  // reportHead() calls (the sniff of an opened or dropped file).
  reportHeadCalls: string[]
  resultsColumns: string[]
  resultsRows: string[][]
  resultsError: Error | null
  // As browser.rs: resultsQuery refuses ("cancelled") a path resultsOpen
  // never opened. Off by default (most tests query without an open).
  resultsOpenOnly: boolean
  // path -> a table tableQuery serves (filtered by spectrum, in file order);
  // a path not named here does not open.
  tables: Record<string, { columns: string[]; rows: string[][] }>
  tableQueryCalls: ResultsQueryCall[]
  speciesResult: SpeciesReport | null
  // path -> species report; a path not named here reads speciesResult.
  speciesFiles: Record<string, SpeciesReport>
  speciesError: Error | null
  // The Spectrum tab (P4): what spectrumSupport answers, and nativeId ->
  // the dump text spectrumPeaks serves (an ID not here: exit 6 as the CLI;
  // an input in spectrumMissing: moved).
  spectrumSupportResult: SpectrumSupport
  spectrumDumps: Record<string, string>
  spectrumMissing: string[]
  spectrumCalls: { input: string; nativeId: string; params: Record<string, unknown> | null }[]
  // fasta_segment: path -> identifier -> "description\tsequence" (or the
  // sequence alone; an identifier given twice: a list of both). The file
  // read is the run's: fastaRuns[tags][database], else the database in the
  // parameters of the record that wrote @p tags (historyOf); a tags table
  // of no run, or a run without that database, is refused as fasta.rs
  // refuses it.
  fastaFiles: Record<string, Record<string, string | string[]>>
  fastaRuns: Record<string, Partial<Record<FastaDatabase, string>>>
  fastaCalls: { tags: string; database: FastaDatabase; path: string | null; identifier: string; start: number; end: number }[]
  taxdbInfoResult: TaxdbInfo | null
  // Where a -species run finds the index (default: found, as an install
  // with the taxonomy asset unpacked); taxonomyStatusCalls: the -taxdb asked.
  taxonomyStatusResult: TaxonomyStatus
  taxonomyStatusCalls: (string | undefined)[]
  // Where a run finds the shipped digest data and proteomes (default: all
  // there, as in an installed FASTag); dataStatusCalls: how often it was asked.
  dataStatusResult: DataStatus
  dataStatusCalls: number
  // The CLI's --helphelp options. The default is a CLI without
  // -probe_input, as every released FASTag is.
  cliOptions: CliOptions
  // input path -> the probe's stdout (the CLI has -probe_input only when
  // cliOptions lists it); a path without one fails as the CLI does (exit 5).
  probeOutputs: Record<string, string>
  probeCalls: { input: string; fasta?: string | null }[]
  // Held probes answer only when releaseProbes() is called.
  holdProbes: boolean
  releaseProbes(): void
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
  // Record every run that ends in `history`, as fastag.rs does (argv = the
  // run reply's command). Off by default: most tests set `history` by hand.
  recordRuns: boolean
  historyDeleteCalls: string[]
  historyRerunCalls: string[]
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
  openCalls: string[]
  revealError: Error | null
  emitMenu(action: string): void
  exportCalls: { path: string; view: ResultsView; columns: string[]; dest: string }[]
  // The format of each export, in exportCalls' order.
  exportFormats: ExportFormat[]
  // An export job: true holds its events (the test sends them with
  // emitExport); false (the default) ends each job at once with Done.
  holdExport: boolean
  // The id of the newest export job, and its Channel; cancelExport calls.
  lastExportId: number
  lastExportSend: (e: ExportEvent) => void
  emitExport(e: ExportEvent): void
  exportCancelCalls: number[]
  // Stitch/ALPS export, a job as denovo.rs runs it: path -> the tags file's
  // text (a job of a path not named here fails as missing); each
  // exportReads call; the reads written (export/denovo.ts, the port the
  // golden files check, stands in for denovo.rs). readsWriteError: the next
  // jobs fail with it. holdExport holds a reads job's end as a table job's:
  // emitExport sends its events, and finishReads ends it as denovo.rs would
  // (it writes the reads and sends readsDone).
  tagsFiles: Record<string, string>
  readsCalls: { path: string; dest: string; format: 'stitch' | 'alps'; topN: number; minLength: number }[]
  readsWrites: { source: string; dest: string; text: string }[]
  readsWriteError: string | null
  finishReads(): void
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
  // In-app feedback: what feedbackCapture answers (default: no native
  // webview, as in a browser, so the DOM rasteriser draws the screenshot),
  // the platform and run record, the saved reports (report.json as the
  // backend would write it, and the PNG), every export (its JSON) and the
  // issue drafts opened.
  nativeCapture: NativeCapture
  feedbackPlatformResult: FeedbackPlatform
  feedbackRunResult: RunInfo | null
  feedbackRunCalls: (string | null)[]
  // zipOf: what the report's zip holds (feedback.rs export_ordered), and for which request.
  feedbackReports: { report: FeedbackReport; png: Uint8Array | null; folder: string; zip: string | null; zipOf?: { seq: number; json: string; screenshot: boolean } }[]
  feedbackSaveError: string | null
  feedbackExports: { id: string; include: Include; json: string }[]
  feedbackIssues: { title: string; reportId: string; kind: string; url: string }[]
  feedbackRevealCalls: string[]
  // Each zip revealed: its request and what it holds.
  feedbackRevealed: { id: string; seq: number; json: string; screenshot: boolean }[]
  holdRun(): void
  // With @p error: the held invoke replies fail (an invoke that fails after
  // its Done: the job settles without outputs, runJob.ts).
  releaseRun(error?: Error): void
}

/// The reply of `run` exactly as fastag.rs serialises it (cargo test
/// the_run_reply_names_every_output_by_its_option_name compares the two).
export const RUN_STARTED_FIXTURE: RunStarted = runStartedFixture
/// Every key of ResolvedOutputs on the wire: the output-file options of the
/// manifest (outputs.rs output_options), less the two removed in 1.14.
export const OUTPUT_KEYS = (manifest.params as { name: string; type: string }[])
  .filter((p) => p.type === 'output-file' && p.name !== 'label_discovery_out' && p.name !== 'search_shifts_out')
  .map((p) => p.name) as (keyof ResolvedOutputs)[]

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
  // outputs.rs DERIVED.
  if (params['species'] === true && !o.species_out) o.species_out = derive('.species.tsv')
  if (params['glyco'] === true && !o.glyco_out) o.glyco_out = derive('.glyco.tsv')
  if (params['census'] === true && !o.census_out) o.census_out = derive('.census.tsv')
  if (params['census'] === true && !o.census_summary_out) o.census_summary_out = derive('.census_summary.tsv')
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
  // One bridge per test: no table read under another test's files.
  forgetTables()
  // Each started run's Channel, by its number.
  const channels = new Map<number, (e: RunEvent) => void>()
  // What each started run was sent and replied, for recordRuns.
  const runs = new Map<number, { call: RunCall; started: RunStarted; start: number }>()
  const send = (id: number | undefined, e: RunEvent): void => {
    if (id == null) return
    const ch = channels.get(id)
    if (e.kind === 'done' && ch && mock.recordRuns) record(id, e)
    ch?.(e)
  }
  // The record fastag.rs writes when a run ends (record_of).
  const record = (id: number, r: RunResult): void => {
    const run = runs.get(id)
    if (!run || mock.history.some((h) => h.id === `mock-${id}`)) return
    const o = run.started.outputs ?? {}
    mock.history.unshift({
      id: `mock-${id}`,
      input: run.call.in,
      outputs: Object.values(o).filter((p): p is string => !!p),
      cwd: run.call.in.startsWith('/') ? run.call.in.slice(0, run.call.in.lastIndexOf('/')) : null,
      argv: run.started.command ?? [],
      status: r.ok ? 'ok' : r.cancelled ? 'cancelled' : 'failed',
      exitCode: r.code ?? null,
      message: r.message ?? null,
      start: run.start,
      end: Date.now(),
      cleanup: r.cleanup ?? { removed: [], renamed: [], failed: [] },
      params: run.call.params,
      tags: null,
      ...(typeof (run.call as { workflow?: unknown }).workflow === 'string' ? { workflow: (run.call as { workflow?: string }).workflow } : {})
    })
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
  let exportSeq = 0
  let finishReads: (() => void) | null = null
  let held: ((error?: Error) => void)[] | null = null
  const heldProbes: (() => void)[] = []

  const mock: MockBridge = {
    binaryInfo: { bin: '/mock/FASTag', source: 'env', ok: true, detail: 'FASTag 9.9.9 (mock)' },
    settings: { schemaVersion: 1, lastUsed: null, presets: {} },
    settingsWritable: true,
    nextPickInput: null,
    nextPickInputs: [],
    nextExampleInput: '/local/examples/Ecoli_MS2_small.mzML',
    nextPickOutput: null,
    pickFileCalls: [],
    nextPickResults: null,
    nextPickReport: null,
    nextPickFolder: null,
    folderFiles: {},
    folderSpectraCalls: [],
    summaryWrites: [],
    summaryProtect: [],
    summaryWriteError: null,
    nextPickSdrf: null,
    sdrfFiles: {},
    sdrfReadCalls: [],
    taxonomyResult: null,
    taxonomyError: null,
    taxonomyCalls: [],
    reportFiles: {},
    reportErrors: {},
    reportCalls: [],
    reportHeadCalls: [],
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
    spectrumSupportResult: { supported: false, probed: true, detail: 'the CLI has no -dump_spectrum' },
    spectrumDumps: {},
    spectrumMissing: [],
    spectrumCalls: [],
    fastaFiles: {},
    fastaRuns: {},
    fastaCalls: [],
    taxdbInfoResult: null,
    taxonomyStatusResult: { index: '/app/taxonomy/tax_k7.taxdb', dir: '/app/taxonomy', expected: '/app/taxonomy/tax_k7.taxdb', fromEnv: false },
    taxonomyStatusCalls: [],
    dataStatusResult: {
      digestDir: '/app/share/FASTag/digest',
      files: { digestModels: true, digestModelsV2: true, massgapMods: true, calibration: true },
      alkylationDir: '/app/share/FASTag/alkylation',
      proteomes: ['human', 'mouse', 'yeast', 'ecoli'],
      searched: ['/app/share/FASTag/digest', '/app/bin/share-FASTag-digest', '/app/bin/digest'],
      fromEnv: false,
      autoDbFree: true
    },
    dataStatusCalls: 0,
    cliOptions: { options: ['in', 'out', 'fasta', 'fragment_tolerance', 'fragment_tolerance_unit', 'recon_proteome'], ok: true, detail: '6 options' },
    probeOutputs: {},
    probeCalls: [],
    holdProbes: false,
    releaseProbes: () => {
      const q = heldProbes.splice(0)
      q.forEach((f) => f())
    },
    existingOutputs: [],
    history: [],
    commandLineCalls: [],
    exportIniCalls: [],
    exportIniError: null,
    commandOf: (call) => [mock.binaryInfo.bin, ...mockArgv(call)],
    // Every path exists but one whose name says it is missing.
    pathStatus: (paths) => Promise.resolve(paths.map((path) => ({ path, exists: !/missing/i.test(path), kind: /missing/i.test(path) ? null : ('file' as const) }))),
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
    recordRuns: false,
    historyDeleteCalls: [],
    historyRerunCalls: [],
    leftoverFiles: [],
    sweepCalls: [],
    keepCalls: [],
    sweepFails: [],
    failNextRun: null,
    rejectNextRun: null,
    runCalls: [],
    outputsCheckCalls: [],
    resultsQueryCalls: [],
    resultsOpenOnly: false,
    tables: {},
    tableQueryCalls: [],
    exportCalls: [],
    exportFormats: [],
    holdExport: false,
    lastExportId: 0,
    lastExportSend: () => {},
    exportCancelCalls: [],
    tagsFiles: {},
    readsCalls: [],
    readsWrites: [],
    readsWriteError: null,
    finishReads: () => finishReads?.(),
    resultsOpenCalls: [],
    revealCalls: [],
    openCalls: [],
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
    nativeCapture: { status: 'failed', method: 'none', api: null, width: 0, height: 0, scale: 0, error: 'no native webview in the browser build', png: null },
    feedbackPlatformResult: {
      os: 'other',
      os_version: '',
      arch: 'x86_64',
      webview: 'browser',
      webview_version: '',
      display_scale: 1,
      engine_source: 'bundled',
      engine_bin_size: 1234,
      home: '/Users/tester',
      user: 'tester'
    },
    feedbackRunResult: null,
    feedbackRunCalls: [],
    feedbackReports: [],
    feedbackSaveError: null,
    feedbackExports: [],
    feedbackIssues: [],
    feedbackRevealCalls: [],
    feedbackRevealed: [],
    holdRun: () => {
      held = held ?? []
    },
    releaseRun: (error) => {
      const q = held ?? []
      held = null
      q.forEach((release) => release(error))
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
    taxonomyStatus: (explicit) => {
      mock.taxonomyStatusCalls.push(explicit)
      return Promise.resolve(mock.taxonomyStatusResult)
    },
    dataStatus: () => {
      mock.dataStatusCalls += 1
      return Promise.resolve(mock.dataStatusResult)
    },
    cliCapabilities: () => Promise.resolve(mock.cliOptions),
    probeInput: (input, fasta) => {
      mock.probeCalls.push({ input, fasta })
      const supported = mock.cliOptions.options.includes('probe_input')
      const out = mock.probeOutputs[input]
      const reply: ProbeRun = !supported
        ? { supported: false, ok: false, code: null, timed_out: false, stdout: '', reason: 'this FASTag has no -probe_input' }
        : out != null
          ? { supported: true, ok: true, code: 0, timed_out: false, stdout: out, reason: null }
          : { supported: true, ok: false, code: 5, timed_out: false, stdout: '', reason: `Error: cannot read ${input}` }
      if (!mock.holdProbes) return Promise.resolve(reply)
      return new Promise((resolve) => heldProbes.push(() => resolve(reply)))
    },
    openTaxon: () => Promise.resolve(true),
    pickInput: () => Promise.resolve(mock.nextPickInput),
    pickInputs: () => Promise.resolve(mock.nextPickInputs),
    exampleInput: () =>
      mock.nextExampleInput
        ? Promise.resolve(mock.nextExampleInput)
        : Promise.reject(new Error('this installation has no example data (resources/fastag/examples)')),
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
    writeSummary: (dest, text, protect) => {
      mock.summaryProtect.push(protect)
      if (mock.summaryWriteError) return Promise.reject(new Error(mock.summaryWriteError))
      // As report.rs write_summary: never over a protected file (the SDRF).
      if (protect?.includes(dest)) return Promise.reject(new Error(`cannot write ${dest}: it is the loaded SDRF, which is never written`))
      mock.summaryWrites.push({ dest, text })
      return Promise.resolve()
    },
    pickSdrf: () => Promise.resolve(mock.nextPickSdrf),
    sdrfRead: (path) => {
      mock.sdrfReadCalls.push(path)
      const b = mock.sdrfFiles[path]
      return b ? Promise.resolve(b.slice()) : Promise.reject(new Error(`${path} does not exist`))
    },
    taxonomyDump: (nodes, names) => {
      mock.taxonomyCalls.push({ nodes, names })
      return mock.taxonomyError ? Promise.reject(new Error(mock.taxonomyError)) : Promise.resolve(mock.taxonomyResult)
    },
    report: (path) => {
      mock.reportCalls.push(path)
      // As report.rs read_report's errors (over its size limit, a read that failed).
      if (mock.reportErrors[path] != null) return Promise.reject(new Error(mock.reportErrors[path]))
      return Promise.resolve(mock.reportFiles[path] ?? null)
    },
    reportHead: (path) => {
      mock.reportHeadCalls.push(path)
      const t = mock.reportFiles[path]
      return Promise.resolve(t == null ? null : t.slice(0, 64 << 10))
    },
    cancel: () => {
      mock.cancelCalls++
      return Promise.resolve({ cancelled: true })
    },
    species: (path) => {
      mock.speciesCalls.push(path)
      return mock.speciesError ? Promise.reject(mock.speciesError) : Promise.resolve(mock.speciesFiles[path] ?? mock.speciesResult)
    },
    spectrumSupport: () => Promise.resolve({ ...mock.spectrumSupportResult }),
    spectrumPeaks: (input, nativeId, params) => {
      mock.spectrumCalls.push({ input, nativeId, params })
      const base = { timedOut: false, cached: false }
      let d: SpectrumDump
      if (mock.spectrumMissing.includes(input)) d = { ...base, ok: false, code: null, missing: true, stdout: '', reason: `${input} does not exist` }
      else if (nativeId in mock.spectrumDumps) d = { ...base, ok: true, code: 0, missing: false, stdout: mock.spectrumDumps[nativeId], reason: null }
      else d = { ...base, ok: false, code: 6, missing: false, stdout: '', reason: `-dump_spectrum: no spectrum of '${input}' has the native ID '${nativeId}'.` }
      return Promise.resolve(d)
    },
    fastaSegment: (tags, database, identifier, start, end) => {
      const run = mock.fastaRuns[tags] ?? (mock.history.find((r) => r.outputs.includes(tags))?.params as Record<string, unknown> | undefined)
      const given = run?.[database]
      const path = typeof given === 'string' && given !== '' ? given : null
      mock.fastaCalls.push({ tags, database, path, identifier, start, end })
      if (!run) return Promise.reject(`${tags} was not written by a run of this app`)
      const db = path ? mock.fastaFiles[path] : undefined
      if (!path || !db) return Promise.reject(`the run that wrote ${tags} recorded no -${database} database it read`)
      const e = db[identifier]
      if (e == null) return Promise.reject(`${identifier} is not in ${path}`)
      if (Array.isArray(e)) return Promise.resolve({ identifier, description: '', length: 0, start, end, sequence: '', occurrences: e.length })
      const tab = e.indexOf('\t')
      const description = tab >= 0 ? e.slice(0, tab) : ''
      const seq = tab >= 0 ? e.slice(tab + 1) : e
      const s = Math.min(Math.max(1, start), seq.length)
      const t = Math.min(Math.max(s, end), seq.length)
      const out: FastaSegment = { identifier, description, length: seq.length, start: s, end: t, sequence: seq.slice(s - 1, t), occurrences: 1 }
      return Promise.resolve(out)
    },
    resultsQuery: (path, view, offset, limit) => {
      mock.resultsQueryCalls.push({ path, view, offset, limit })
      if (mock.resultsError) return Promise.reject(mock.resultsError)
      if (mock.resultsOpenOnly && !mock.resultsOpenCalls.includes(path)) return Promise.reject('cancelled')
      return Promise.resolve({
        columns: mock.resultsColumns,
        totalRows: mock.resultsRows.length,
        matchedRows: mock.resultsRows.length,
        rows: mock.resultsRows.slice(offset, offset + limit)
      })
    },
    tableQuery: (path, view, offset, limit) => {
      mock.tableQueryCalls.push({ path, view, offset, limit })
      const t = mock.tables[path]
      if (!t) return Promise.reject(`cannot open ${path}`)
      const sp = t.columns.indexOf('spectrum')
      const want = view.spectrum
      const ids = t.rows.map((_, i) => i).filter((i) => want == null || (view.spectrumExact ? t.rows[i][sp] === want : (t.rows[i][sp] ?? '').toLowerCase().includes(want.toLowerCase())))
      const sel = ids.slice(offset, offset + limit)
      return Promise.resolve({ columns: t.columns, totalRows: t.rows.length, matchedRows: ids.length, rows: sel.map((i) => t.rows[i]), rowIds: sel, ranked: true, pending: false })
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
    // As browser.rs neighbours(), built from this mock's own resultsQuery
    // and resultsPosition, so a test's views, D5 waits and failures apply.
    // The backend answers from one snapshot; the mock's table changes
    // between these calls only when a test changes it (and a test of that
    // replaces resultsNeighbours). Snapshot 0: the mock has one.
    resultsNeighbours: async (path, view, row, spectrum): Promise<NavAnswer> => {
      const snapshot = 0
      const pending: NavAnswer = { status: 'pending', snapshot }
      const absent: NavAnswer = { status: 'absent', snapshot }
      const at = async (r: number): Promise<{ pos: number; matched: number } | 'pending' | null> => {
        const head = await mock.resultsQuery(path, view, 0, 1)
        if (head.ranked === false) return 'pending'
        const pos = await mock.resultsPosition(path, view, r)
        return pos != null && pos >= 0 ? { pos, matched: head.matchedRows } : null
      }
      let found = row != null ? await at(row) : null
      if (found === 'pending') return pending
      let rowId = row ?? -1
      if (!found) {
        const mine = await mock.resultsQuery(path, { ...view, spectrum, spectrumExact: true }, 0, 1)
        if (mine.rows.length === 0) return absent
        if (mine.ranked === false) return pending
        const first = mine.rowIds?.[0]
        if (first == null || first === row) return absent
        found = await at(first)
        if (found === 'pending') return pending
        if (!found) return absent
        rowId = first
      }
      const { pos, matched } = found
      const step = async (dir: -1 | 1): Promise<{ spectrum: string; rowId: number } | null | 'pending'> => {
        for (let n = 0; n < 50; n++) {
          const a = dir > 0 ? pos + 1 + n * 200 : Math.max(0, pos - (n + 1) * 200)
          const b = dir > 0 ? Math.min(matched, a + 200) : pos - n * 200
          if (a >= b) return null
          const pg = await mock.resultsQuery(path, view, a, b - a)
          if (pg.ranked === false) return 'pending'
          if (pg.rows.length === 0) return null
          const sc = pg.columns.indexOf('spectrum')
          for (let k = 0; k < pg.rows.length; k++) {
            const i = dir > 0 ? k : pg.rows.length - 1 - k
            const sp = pg.rows[i]?.[sc]
            if (sp != null && sp !== spectrum) return { spectrum: sp, rowId: pg.rowIds?.[i] ?? -1 }
          }
        }
        return null
      }
      const prev = await step(-1)
      if (prev === 'pending') return pending
      const next = await step(1)
      if (next === 'pending') return pending
      return { status: 'at', snapshot, pos, matched, rowId, prev, next }
    },
    revealOutput: (path, folder) => {
      mock.revealCalls.push({ path, folder })
      return mock.revealError ? Promise.reject(mock.revealError) : Promise.resolve()
    },
    openOutput: (path) => {
      mock.openCalls.push(path)
      return mock.revealError ? Promise.reject(mock.revealError) : Promise.resolve()
    },
    onMenu: on(menuListeners),
    // A job per export (browser.rs start_export): its id now, its events
    // on its own Channel after the reply.
    exportResults: (path, view, columns, dest, format, onEvent) => {
      mock.exportCalls.push({ path, view, columns, dest })
      mock.exportFormats.push(format)
      const jobId = ++exportSeq
      mock.lastExportId = jobId
      mock.lastExportSend = onEvent
      if (!mock.holdExport) {
        const rows = mock.resultsRows.length
        queueMicrotask(() => {
          onEvent({ kind: 'progress', jobId, done: rows, total: rows })
          onEvent({ kind: 'done', jobId, rows, dest })
        })
      }
      return Promise.resolve(jobId)
    },
    emitExport: (e) => mock.lastExportSend(e),
    cancelExport: (jobId) => {
      mock.exportCancelCalls.push(jobId)
      return Promise.resolve(jobId === mock.lastExportId)
    },
    // A reads job (denovo.rs start_reads): its id now; progress in bytes of
    // the file, then readsDone (the reads in readsWrites) or failed.
    exportReads: (path, dest, format, topN, minLength, onEvent) => {
      mock.readsCalls.push({ path, dest, format, topN, minLength })
      const jobId = ++exportSeq
      mock.lastExportId = jobId
      mock.lastExportSend = onEvent
      const finish = (): void => {
        finishReads = null
        const text = mock.tagsFiles[path]
        if (text == null) return onEvent({ kind: 'failed', jobId, message: `${path} does not exist` })
        if (mock.readsWriteError) return onEvent({ kind: 'failed', jobId, message: mock.readsWriteError })
        let out
        try {
          out = tagsToDenovo(text, { format, topN, minLength })
        } catch (err) {
          return onEvent({ kind: 'failed', jobId, message: err instanceof Error ? err.message : String(err) })
        }
        mock.readsWrites.push({ source: path, dest, text: out.text })
        onEvent({ kind: 'progress', jobId, done: text.length, total: text.length })
        onEvent({
          kind: 'readsDone',
          jobId,
          reads: out.reads,
          rowsRead: out.rowsRead,
          short: out.short,
          malformed: out.malformed,
          unknownMods: Object.keys(out.unknownMods),
          dest
        })
      }
      if (mock.holdExport) finishReads = finish
      else queueMicrotask(finish)
      return Promise.resolve(jobId)
    },
    // Which outputs a run would write: -out (resolved like run() does) and
    // every *_out parameter with a value; those in existingOutputs exist.
    outputsCheck: (params) => {
      const call = params as unknown as RunCall
      mock.outputsCheckCalls.push(call)
      // As fastag.rs outputs_check: every output resolved like run() does.
      const outputs = [...new Set(Object.values(mockOutputs(call)).filter((p): p is string => !!p))]
      // As outputs.rs clashes: an output that is one of the run's inputs.
      const inputs = new Set([call.in, ...(manifest.params as { name: string; type: string }[])
        .filter((p) => p.type === 'input-file')
        .map((p) => call.params?.[p.name])
        .filter((v): v is string => typeof v === 'string' && v !== ''), ...proteomeFile(call.params?.['alkylation_proteome']), ...(call.protect ?? [])])
      return Promise.resolve({
        outputs,
        existing: outputs.filter((p) => mock.existingOutputs.includes(p) && !inputs.has(p)),
        clashes: outputs.filter((p) => inputs.has(p))
      })
    },
    historyList: (limit) => Promise.resolve(mock.history.slice(0, limit ?? 50)),
    historyOf: (path) => Promise.resolve(mock.history.find((r) => r.outputs.includes(path)) ?? null),
    // As history.rs delete: a record that did not finish and is the newest
    // of an output still on disk (existingOutputs) is kept.
    historyDelete: (id) => {
      mock.historyDeleteCalls.push(id)
      const r = mock.history.find((h) => h.id === id)
      const marked =
        r && r.status !== 'ok'
          ? [...r.outputs, ...r.cleanup.failed].find(
              (p) => mock.existingOutputs.includes(p) && mock.history.find((h) => h.outputs.includes(p))?.id === id
            )
          : undefined
      if (marked)
        return Promise.reject(
          new Error(
            `The record was kept: it is what marks ${marked} as incomplete (the run did not finish, and its cleanup could not remove the file). Delete or replace that file first.`
          )
        )
      const n = mock.history.length
      mock.history = mock.history.filter((h) => h.id !== id)
      return Promise.resolve(mock.history.length < n)
    },
    // As history.rs rerun_params.
    historyRerun: (id) => {
      mock.historyRerunCalls.push(id)
      const r = mock.history.find((h) => h.id === id)
      const i = r ? r.argv.indexOf('-out', 1) : -1
      if (!r?.params || i < 0 || i + 1 >= r.argv.length) return Promise.reject(new Error('no parameters'))
      return Promise.resolve({ in: r.input, out: r.argv[i + 1], params: r.params, ...(r.workflow ? { workflow: r.workflow } : {}) })
    },
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
      runs.set(mock.lastRunId, { call, started, start: Date.now() })
      if (held) return new Promise<RunStarted>((resolve, reject) => held!.push((e) => (e ? reject(e) : resolve(started))))
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
    },

    feedbackCapture: () => Promise.resolve({ ...mock.nativeCapture }),
    feedbackPlatform: () => Promise.resolve({ ...mock.feedbackPlatformResult }),
    feedbackRun: (out) => {
      mock.feedbackRunCalls.push(out)
      return Promise.resolve(mock.feedbackRunResult)
    },
    // As feedback.rs save: the backend's fields set here, never taken from
    // the draft.
    feedbackSave: (draft, png) => {
      if (mock.feedbackSaveError) return Promise.reject(new Error(mock.feedbackSaveError))
      if (!draft.title.trim()) return Promise.reject(new Error('the title is empty'))
      const now = new Date()
      const id = uuid4()
      const stamp = now.toISOString().replace(/\.\d+Z$/, 'Z')
      const report: FeedbackReport = {
        ...JSON.parse(JSON.stringify(draft)),
        schema: 'fastag-feedback/1',
        id,
        created_utc: stamp,
        tz_offset_min: -now.getTimezoneOffset(),
        status: 'saved',
        issue_url: null
      }
      const folder = `/feedback/${stamp.replace(/[-:]/g, '')}_${id.slice(0, 8)}`
      mock.feedbackReports.unshift({ report, png: png ? png.slice() : null, folder, zip: null })
      return Promise.resolve({ id, folder, created_utc: stamp, status: 'saved' as ReportStatus })
    },
    feedbackList: () =>
      Promise.resolve(
        mock.feedbackReports.map((r) => ({
          id: r.report.id,
          folder: r.folder,
          created_utc: r.report.created_utc,
          kind: r.report.kind,
          title: r.report.title,
          status: r.report.status,
          issue_url: r.report.issue_url,
          screenshot: !!r.png,
          zip: r.zip,
          bytes: JSON.stringify(r.report).length + (r.png?.length ?? 0)
        }))
      ),
    feedbackDelete: (id) => {
      const i = mock.feedbackReports.findIndex((r) => r.report.id === id)
      if (i < 0) return Promise.reject(new Error(`no feedback report ${id}`))
      mock.feedbackReports.splice(i, 1)
      return Promise.resolve()
    },
    feedbackDeleteAll: () => {
      const n = mock.feedbackReports.length
      mock.feedbackReports = []
      return Promise.resolve(n)
    },
    // As feedback.rs reveal_target: with a request number, only the zip that
    // request built; the zip revealed is recorded with its bytes (the json
    // and the screenshot it holds).
    feedbackReveal: (id, seq) => {
      const r = mock.feedbackReports.find((x) => x.report.id === id)
      if (seq !== undefined && (!r?.zipOf || r.zipOf.seq !== seq)) return Promise.reject(new Error('the export shown is no longer the zip'))
      mock.feedbackRevealCalls.push(id)
      if (r?.zipOf) mock.feedbackRevealed.push({ id, ...r.zipOf })
      return Promise.resolve()
    },
    // As feedback.rs export_ordered (publicExport is its port): a request
    // older than the one whose zip is there is refused and writes nothing.
    feedbackExport: (id, include, seq) => {
      const r = mock.feedbackReports.find((x) => x.report.id === id)
      if (!r) return Promise.reject(new Error(`no feedback report ${id}`))
      const n = seq ?? (r.zipOf?.seq ?? 0) + 1
      if (r.zipOf && n < r.zipOf.seq) return Promise.reject(new Error('a newer export of this report was built after this request'))
      const json = JSON.stringify(publicExport(r.report, include, !!r.png), null, 2)
      r.zip = `${r.folder}/${id}.feedback.zip`
      r.zipOf = { seq: n, json, screenshot: include.screenshot && !!r.png }
      mock.feedbackExports.push({ id, include: { ...include }, json })
      const size = (png: Uint8Array): { width: number; height: number } => {
        const v = new DataView(png.buffer, png.byteOffset, png.byteLength)
        return png.length >= 24 ? { width: v.getUint32(16), height: v.getUint32(20) } : { width: 0, height: 0 }
      }
      return Promise.resolve({ zip: r.zip, json, image: include.screenshot && r.png ? { bytes: r.png.length, ...size(r.png) } : null, seq: n })
    },
    feedbackSetStatus: (id, status, url) => {
      const r = mock.feedbackReports.find((x) => x.report.id === id)
      if (!r) return Promise.reject(new Error(`no feedback report ${id}`))
      const rank = ['saved', 'handoff_opened', 'submitted']
      if (rank.indexOf(status) < rank.indexOf(r.report.status)) return Promise.reject(new Error('a report cannot go back'))
      if (status === 'submitted') {
        if (!url || !/^https:\/\/github\.com\/okohlbacher\/FASTag\/issues\/[0-9]{1,9}$/.test(url.trim()))
          return Promise.reject(new Error('paste the issue’s address (https://github.com/okohlbacher/FASTag/issues/<number>)'))
        r.report.issue_url = url.trim()
      }
      r.report.status = status
      return Promise.resolve()
    },
    openFeedbackIssue: (d) => {
      const url = issueUrl(d)
      if (!url) return Promise.resolve(false)
      mock.feedbackIssues.push({ ...d, url })
      return Promise.resolve(true)
    }
  }

  window.fastag = mock
  return mock
}
