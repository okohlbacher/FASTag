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
}

export interface ResultsPage {
  columns: string[]
  totalRows: number
  matchedRows: number
  rows: string[][]
}

export interface RunResult {
  ok: boolean
  code: number | null
  // Filled by the backend on failure: 'cancelled', a signal name (SIGSEGV ...)
  // or a Windows NTSTATUS name.
  message?: string
  // True when the run ended because Cancel killed it. A killed child has no
  // reliable exit status of its own (null on Unix, 1 from TerminateProcess on
  // Windows), so the renderer must not read a cancel off `code`.
  cancelled?: boolean
  // Set on results delivered via the fastag:done event; correlates the terminal
  // event to the run the renderer is awaiting. Absent on synthetic failures the
  // renderer builds itself (a run that never started).
  runId?: number
}

export interface RunStarted {
  started: boolean
  reason?: string
  runId?: number
  // The -out the CLI was actually given: a relative Output is resolved against
  // the input's folder, which is also the child's working directory.
  out?: string
  // The command line, binary first, for the failure banner's Copy command.
  command?: string[]
}

export interface Taxon {
  rank: string
  taxid: number
  name: string
  observed: number
  adjusted: number
  // null: the CLI wrote NA (-species_orientation both): uncalibrated, not q = 1.
  q: number | null
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
  presets: Record<string, Record<string, unknown>>
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
  species: (path: string) => Promise<SpeciesReport | null>
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
  run: (params: Record<string, unknown>) => Promise<RunStarted>
  cancel: () => Promise<{ cancelled: boolean }>
  resultsQuery: (path: string, view: ResultsView, offset: number, limit: number) => Promise<ResultsPage>
  // Write the rows of a view, only the named columns, to dest; resolves with
  // the number of rows written.
  exportResults: (path: string, view: ResultsView, columns: string[], dest: string) => Promise<number>
  onLog: (cb: (line: string) => void) => () => void
  onProgress: (cb: (p: { done: number; total: number }) => void) => () => void
  onDone: (cb: (result: RunResult) => void) => () => void
}
