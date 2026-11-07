// Shared shapes between the Rust backend and the React frontend. These mirror
// the serde structs the Tauri commands return (see src-tauri/src/*.rs).

export interface BinaryInfo {
  bin: string
  // 'missing': a release build with no bundled CLI (no dev or PATH fallback).
  source: 'env' | 'bundled' | 'path' | 'missing'
  ok: boolean
  version?: string
  detail: string
}

export interface ResultsSort {
  column: string
  desc: boolean
}

// A sorted/filtered view over a results TSV. Filters bind by column NAME and
// are ignored by the backend when the file lacks that column.
export interface ResultsView {
  sort?: ResultsSort | null
  spectrum?: string | null
  minLength?: number | null
  maxEvalue?: number | null
  // only: a target hit (fwd/rev); none: no target hit (entrapment-only rows
  // included); entrapment: efwd/erev only.
  fastaHit?: 'only' | 'none' | 'entrapment' | null
  // The best N tags per spectrum by E-value (1: the best tag), after the
  // other filters; null: every tag (browser.rs per_spectrum).
  perSpectrum?: number | null
}

// The file format of an export (browser.rs ExportFormat).
export type ExportFormat = 'tsv' | 'csv'

// The events of one export job, on its own Channel (browser.rs ExportEvent).
export type ExportEvent =
  | { kind: 'progress'; jobId: number; done: number; total: number }
  | { kind: 'done'; jobId: number; rows: number; dest: string }
  | { kind: 'failed'; jobId: number; message: string }
  | { kind: 'cancelled'; jobId: number }
  // A reads export (denovo.rs) is complete: the reads written and what
  // tools/tags_to_denovo.py counts. A reads job's progress is in bytes read.
  | {
      kind: 'readsDone'
      jobId: number
      reads: number
      rowsRead: number
      short: number
      malformed: number
      unknownMods: string[]
      dest: string
    }

export interface ResultsPage {
  columns: string[]
  totalRows: number
  matchedRows: number
  rows: string[][]
  // The file row of each row (browser.rs): the active row is kept by it
  // across the D5 swap. Absent from older mocks.
  rowIds?: number[]
  // false: the E-value order is still being built and the rows are in file
  // order (D5). Absent means true.
  ranked?: boolean
  // The E-value order is being built; a 'ranked' event follows.
  pending?: boolean
}

// results_open: the header and first rows from a head read, before the index.
export interface ResultsHead {
  generation: number
  columns: string[]
  rows: string[][]
  // The head read reached the end of the file: rows is every row.
  complete: boolean
}

// Background progress of an open (browser.rs BrowserEvent).
export type BrowserEvent =
  | { kind: 'indexed'; generation: number; totalRows: number }
  | { kind: 'rankProgress'; generation: number; done: number; total: number }
  | { kind: 'ranked'; generation: number; column: string }
  | { kind: 'failed'; generation: number; message: string }

// Every output of a run as the CLI writes them (reveal.rs ResolvedOutputs,
// GUI-DESIGN 6.3): absolute, resolved by the backend from the argv the CLI
// was given. The renderer never resolves an output path itself. A species
// or glyco report the CLI derives from -out is under species_out or
// glyco_out; null: the run does not write it.
export interface ResolvedOutputs {
  out: string | null
  species_out?: string | null
  digest_out?: string | null
  label_out?: string | null
  massgap_out?: string | null
  recon_out?: string | null
  delta_out?: string | null
  recon_id_out?: string | null
  glyco_out?: string | null
  out_spectra?: string | null
}

export interface RunResult {
  ok: boolean
  code: number | null
  // Filled by the backend on failure: 'cancelled', a signal name (SIGSEGV ...)
  // or a Windows NTSTATUS name.
  message?: string | null
  // True when the run ended because Cancel killed it. A killed child has no
  // reliable exit status of its own (null on Unix, 1 from TerminateProcess on
  // Windows), so the renderer must not read a cancel off `code`.
  cancelled?: boolean
  // A run that did not finish: what the backend did with the outputs it had
  // written (fastag.rs / outputs.rs). Absent on a finished run.
  cleanup?: Cleanup
}

// The outputs of a cancelled or failed run, after the backend's cleanup.
export interface Cleanup {
  // Deleted.
  removed: string[]
  // Could not be deleted: renamed to <name>.incomplete (the new names).
  renamed: string[]
  // Neither: still at its path, possibly truncated.
  failed: string[]
}

// The outputs a run would write (as `run` resolves them) and those that
// already exist: the UI confirms overwriting them before the run.
export interface OutputsCheck {
  outputs: string[]
  existing: string[]
}

// One run as the backend records it (history.rs, history.jsonl in app data).
export interface RunRecord {
  id: string
  input: string
  outputs: string[]
  cwd: string | null
  argv: string[]
  status: 'ok' | 'cancelled' | 'failed'
  exitCode: number | null
  message: string | null
  // Unix time in ms.
  start: number
  end: number
  cleanup: Cleanup
  // The parameters the run was sent (Settings into form); absent in records
  // written before P2a.
  params?: Record<string, unknown> | null
  // The tags it wrote (the CLI's summary line); absent when it printed none.
  tags?: number | null
}

// The reply of `run` (fastag.rs RunStarted). The run's events come on the
// job's own Channel (RunEvent), never as global events.
export interface RunStarted {
  started: boolean
  reason?: string | null
  // The -out the CLI was given, absolute (outputs.out).
  out?: string | null
  // Every output of the run (GUI-DESIGN 6.3).
  outputs?: ResolvedOutputs | null
  // The command line, binary first, for the failure banner's Copy command.
  command?: string[] | null
}

// One log line as the CLI wrote it: its text, and true when on stderr.
export type LogLine = [string, boolean]

// One message on a run's Channel (events.rs RunEvent, serde tag "kind").
// The backend batches: one Log carries every line of a flush interval
// (50-100 ms), Progress and Phase the latest of it, and Done is the last
// message of the run.
export type RunEvent =
  | { kind: 'log'; lines: LogLine[] }
  | { kind: 'progress'; done: number; total: number; ratePerSec?: number | null; etaSec?: number | null }
  | { kind: 'phase'; label: string }
  | ({ kind: 'done' } & RunResult)

// A row of the -species report (results/species.ts parses it; P4).
export interface Taxon {
  rank: string
  taxid: number
  name: string
  observed: number
  adjusted: number
  q: number
  // FASTag 1.12 -species_call decoy (D1): present, no_call or not_detected,
  // and why. Absent from a report written without the call.
  call?: string
  callReason?: string
}

export interface SpeciesReport {
  path: string
  taxa: Taxon[]
}

export interface TaxdbInfo {
  path: string
  k: number
}

export interface Settings {
  schemaVersion: number
  lastUsed: Record<string, unknown> | null
  // Schema 2: {v: 2, base, diff} (setup/presetDiff.ts); a v1 preset is the
  // flat record of the form's values. normalizePreset reads both.
  presets: Record<string, Record<string, unknown>>
}

// What Export INI wrote (ini.rs IniExport).
export interface IniExport {
  dest: string
  items: number
}

// An OS file drop, sorted by type (drop.rs DropRoute).
export interface DropRoute {
  spectra: string[]
  // Two or more spectra files, or a folder: the batch queue.
  batch: boolean
  fasta: string | null
  taxdb: string | null
  // A tags table.
  results: string | null
  reports: { kind: string; path: string }[]
  sdrf: string | null
  ignored: string[]
}

// Declared here (not in api.ts) so tests can install a mock bridge without
// importing api.ts, whose module body executes Tauri plumbing.
declare global {
  interface Window {
    fastag: FastagApi
  }
}

export interface FastagApi {
  loadSettings: () => Promise<Settings>
  saveLast: (values: Record<string, unknown>) => Promise<boolean>
  savePreset: (name: string, values: Record<string, unknown>) => Promise<boolean>
  deletePreset: (name: string) => Promise<boolean>
  taxdbInfo: (explicit?: string) => Promise<TaxdbInfo | null>
  // The -species report, parsed in the renderer (results/species.ts); null
  // when it is missing, unreadable or empty.
  species: (path: string) => Promise<SpeciesReport | null>
  // Whether the CLI has -dump_spectrum (spectrum.rs, from --helphelp).
  spectrumSupport: () => Promise<SpectrumSupport>
  // `FASTag <the run's argv> -dump_spectrum <nativeId>` on @p input under
  // the run's @p params (null: the CLI's defaults); its JSON lines in stdout.
  spectrumPeaks: (input: string, nativeId: string, params: Record<string, unknown> | null) => Promise<SpectrumDump>
  // Text of a digest/label/mass-gap report; null when the file does not exist.
  report: (path: string) => Promise<string | null>
  openTaxon: (taxid: number) => Promise<boolean>
  probe: () => Promise<BinaryInfo>
  pickInput: () => Promise<string | null>
  pickInputs: () => Promise<string[]>
  pickOutput: (defaultPath?: string) => Promise<string | null>
  // A parameter's file: filtered by the extensions its manifest entry
  // declares (none = no filter), so a FASTA or an idXML can be picked.
  pickFile: (formats?: string[]) => Promise<string | null>
  saveFile: (defaultPath?: string, formats?: string[]) => Promise<string | null>
  pickResults: () => Promise<string | null>
  pickReport: () => Promise<string | null>
  // A folder (the Batch view's Add folder… and output folder).
  pickFolder: () => Promise<string | null>
  // The spectra files directly inside folder @p dir, sorted by name, as a
  // dropped folder adds them (drop.rs folder_spectra_list). Rejects when
  // @p dir is not a folder.
  folderSpectra: (dir: string) => Promise<string[]>
  // Write the batch summary TSV to @p dest (report.rs summary_write, via a
  // .part file). Rejects with the reason.
  writeSummary: (dest: string, text: string) => Promise<void>
  // The command line a run of these params is, binary first (fastag.rs
  // command_line: the argv `run` replies and History records).
  commandLine: (params: Record<string, unknown>) => Promise<string[]>
  // Export INI (ini.rs): the request a run would be given, through
  // `FASTag -ini <tmp> -write_ini <dest>`. Rejects with the CLI's reason.
  exportIni: (params: Record<string, unknown>, dest: string) => Promise<IniExport>
  // The outputs a run of these params would write, and which exist already.
  outputsCheck: (params: Record<string, unknown>) => Promise<OutputsCheck>
  // params.overwrite: the user confirmed overwriting the existing outputs;
  // without it the backend refuses a run whose outputs exist. The run's
  // events go to onEvent (its own Channel), and may come before the reply.
  run: (params: Record<string, unknown>, onEvent: (e: RunEvent) => void) => Promise<RunStarted>
  // The recorded runs, newest first; the newest run that wrote a path.
  historyList: (limit?: number) => Promise<RunRecord[]>
  historyOf: (path: string) => Promise<RunRecord | null>
  // Delete one record (its files stay); false when no record has that id.
  // Rejects with the reason when the record is kept: it alone marks a file
  // its run left behind as incomplete (history.rs marks_incomplete).
  historyDelete: (id: string) => Promise<boolean>
  // What a Re-run of the record starts: the `run` parameters it was started
  // with ({ in, out, params }); rejects for a record without them.
  historyRerun: (id: string) => Promise<Record<string, unknown>>
  // Files unfinished runs left (sweep.rs): <output>.part, <output>.incomplete
  // and the outputs of a run the app did not see end. Offered at startup;
  // only listed files are removed, and kept ones are not offered again.
  leftovers: () => Promise<string[]>
  sweepLeftovers: (paths: string[]) => Promise<Cleanup>
  keepLeftovers: (paths: string[]) => Promise<void>
  cancel: () => Promise<{ cancelled: boolean }>
  resultsQuery: (path: string, view: ResultsView, offset: number, limit: number) => Promise<ResultsPage>
  // D5: the head rows now; index and E-value order announced through onEvent.
  resultsOpen: (path: string, onEvent: (e: BrowserEvent) => void) => Promise<ResultsHead>
  // Where file row @p row sits in a built view (null: not built).
  resultsPosition: (path: string, view: ResultsView, row: number) => Promise<number | null>
  // Reveal an output of a run of this app (folder: open its folder instead).
  revealOutput: (path: string, folder: boolean) => Promise<void>
  // A native menu item (menu.rs): its action name.
  onMenu: (cb: (action: string) => void) => () => void
  // Start an export job: the rows of a view, only the named columns, to dest
  // as TSV or CSV; resolves with the job's id. Its progress and its end come
  // through onEvent (its own Channel), possibly before the reply.
  exportResults: (
    path: string,
    view: ResultsView,
    columns: string[],
    dest: string,
    format: ExportFormat,
    onEvent: (e: ExportEvent) => void
  ) => Promise<number>
  // Stop an export job; false when it is not running (any more).
  cancelExport: (jobId: number) => Promise<boolean>
  // Start a Stitch/ALPS export job (denovo.rs): the reads of tags file
  // @p path, as tools/tags_to_denovo.py --format F --top-n N --min-length L
  // writes them, to a .csv (never over @p path) through a .part file. The
  // backend reads the file once on a thread of its own; its progress (bytes
  // read of the file's size) and its end come through onEvent, and
  // cancelExport stops it as it does a table export.
  exportReads: (
    path: string,
    dest: string,
    format: 'stitch' | 'alps',
    topN: number,
    minLength: number,
    onEvent: (e: ExportEvent) => void
  ) => Promise<number>
  // Close guard: the window was closed ('close') or the app asked to quit
  // ('quit') while a run or batch is active; the backend prevented it and
  // waits for answerClose.
  onCloseRequested: (cb: (what: 'close' | 'quit') => void) => () => void
  // true: cancel the run and quit; false: keep running.
  answerClose: (quit: boolean) => Promise<void>
  // A batch is running (no CLI child exists between two jobs).
  setBusy: (busy: boolean) => Promise<void>
  // Files dropped on the window, sorted by type (drop.rs).
  onDrop: (cb: (route: DropRoute) => void) => () => void
  // A drag with files is over the window (true) or has left it (false).
  onDragHover: (cb: (over: boolean) => void) => () => void
  // The system notification when a run or batch finishes.
  notify: (title: string, body: string) => Promise<void>
}

// spectrum.rs SpectrumSupport: --helphelp lists -dump_spectrum (supported);
// probed false: the CLI could not be asked.
export interface SpectrumSupport {
  supported: boolean
  probed: boolean
  detail: string
}

// spectrum.rs SpectrumDump: one -dump_spectrum run (or the LRU's copy).
export interface SpectrumDump {
  ok: boolean
  code: number | null
  timedOut: boolean
  // The input does not exist (it moved): "Locate input…".
  missing: boolean
  // The JSON lines (spectrum/dump.ts parses them).
  stdout: string
  // The last stderr line when it failed.
  reason: string | null
  cached: boolean
}
