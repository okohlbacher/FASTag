// Shared shapes between the Rust backend and the React frontend. These mirror
// the serde structs the Tauri commands return (see src-tauri/src/*.rs).

export interface BinaryInfo {
  bin: string
  dataPath?: string
  source: 'env' | 'bundled' | 'path'
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
  fastaHit?: 'only' | 'none' | null
}

export interface ResultsPage {
  columns: string[]
  totalRows: number
  matchedRows: number
  offset: number
  rows: string[][]
}

export interface RunResult {
  ok: boolean
  code: number | null
  message?: string
  // Set on results delivered via the fastag:done event; correlates the terminal
  // event to the run the renderer is awaiting. Absent on synthetic failures the
  // renderer builds itself (a run that never started).
  runId?: number
}

export interface RunStarted {
  started: boolean
  reason?: string
  runId?: number
}

export interface Taxon {
  rank: string
  taxid: number
  name: string
  observed: number
  expected: number
  enrichment: number
  logP: number
  q: number
}

export interface SpeciesReport {
  path: string
  taxa: Taxon[]
  empty: boolean
}

export interface TaxdbInfo {
  path: string
  k: number
  kmers: number
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
  openTaxon: (taxid: number) => Promise<boolean>
  probe: () => Promise<BinaryInfo>
  pickInput: () => Promise<string | null>
  pickInputs: () => Promise<string[]>
  pickOutput: (defaultPath?: string) => Promise<string | null>
  pickResults: () => Promise<string | null>
  run: (params: Record<string, unknown>) => Promise<RunStarted>
  cancel: () => Promise<{ cancelled: boolean }>
  resultsQuery: (path: string, view: ResultsView, offset: number, limit: number) => Promise<ResultsPage>
  onLog: (cb: (line: string) => void) => () => void
  onProgress: (cb: (p: { done: number; total: number }) => void) => () => void
  onDone: (cb: (result: RunResult) => void) => () => void
}
