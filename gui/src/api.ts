// The single bridge between the React frontend and the Rust backend: the
// `window.fastag` API (see FastagApi in types.ts) over Tauri invoke + events.

import { Channel, invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { open, save } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import type {
  BinaryInfo,
  CliOptions,
  ProbeRun,
  BrowserEvent,
  Cleanup,
  ExportEvent,
  ExportFormat,
  DropRoute,
  IniExport,
  ResultsHead,
  FastagApi,
  ResultsPage,
  OutputsCheck,
  ResultsView,
  RunEvent,
  RunRecord,
  RunStarted,
  Settings,
  SpeciesReport,
  TaxdbInfo
} from './types'

// The spectra the CLI reads as -in (its input-format check is by extension).
export const SPECTRA = [{ name: 'Spectra', extensions: ['mzML', 'mzml', 'mzpeak', 'mzPeak', 'mgf', 'MGF'] }]

// A parameter's declared formats as a dialog filter; none means no filter
// (a .taxdb, the taxonomy dumps), not the spectra one.
const TAGS = [{ name: 'Tags (TSV)', extensions: ['tsv'] }]

async function openOne(filters?: { name: string; extensions: string[] }[]): Promise<string | null> {
  const r = await open({ multiple: false, filters })
  return typeof r === 'string' ? r : null
}

export function fileFilters(formats?: string[]): { name: string; extensions: string[] }[] | undefined {
  if (!formats || formats.length === 0) return undefined
  return [{ name: formats.join(', '), extensions: formats }]
}

// listen() is async but the renderer wants a synchronous unsubscribe (it returns
// one from a useEffect). Hand back a function that unlistens once the async
// subscription resolves, and no-ops safely if it fires before then.
function subscribe<T>(event: string, cb: (payload: T) => void): () => void {
  let un: UnlistenFn | null = null
  let cancelled = false
  listen<T>(event, (e) => cb(e.payload)).then((u) => {
    if (cancelled) u()
    else un = u
  })
  return () => {
    cancelled = true
    if (un) un()
  }
}

const api: FastagApi = {
  probe: () => invoke<BinaryInfo>('probe'),
  cliCapabilities: () => invoke<CliOptions>('cli_capabilities'),
  probeInput: (input: string, fasta?: string | null) => invoke<ProbeRun>('probe_input', { input, fasta: fasta || null }),

  // Native dialogs live in the frontend via the dialog plugin; the backend only
  // ever receives already-chosen paths.
  pickInput: () => openOne(SPECTRA),
  pickInputs: async () => {
    const r = await open({ multiple: true, filters: SPECTRA })
    return Array.isArray(r) ? r : []
  },
  pickOutput: async (defaultPath?: string) => {
    const r = await save({ defaultPath, filters: TAGS })
    return typeof r === 'string' ? r : null
  },
  pickFile: (formats?: string[]) => openOne(fileFilters(formats)),
  saveFile: async (defaultPath?: string, formats?: string[]) => {
    const r = await save({ defaultPath, filters: fileFilters(formats) })
    return typeof r === 'string' ? r : null
  },
  pickResults: () => openOne(TAGS),
  pickReport: () => openOne([{ name: 'Reports (TSV, mzTab)', extensions: ['tsv', 'mzTab', 'mztab'] }]),
  pickFolder: async () => {
    const r = await open({ directory: true, multiple: false })
    return typeof r === 'string' ? r : null
  },
  folderSpectra: (dir: string) => invoke<string[]>('folder_spectra_list', { dir }),
  writeSummary: (dest: string, text: string) => invoke<void>('summary_write', { dest, text }),

  outputsCheck: (params: Record<string, unknown>) => invoke<OutputsCheck>('outputs_check', { params }),
  commandLine: (params: Record<string, unknown>) => invoke<string[]>('command_line', { params }),
  exportIni: (params: Record<string, unknown>, dest: string) => invoke<IniExport>('export_ini', { params, dest }),
  // Each run gets a Channel of its own (GUI-DESIGN 6.2): its events cannot
  // reach another job, and they may arrive before this reply does.
  run: (params: Record<string, unknown>, onEvent: (e: RunEvent) => void) => {
    const ch = new Channel<RunEvent>()
    ch.onmessage = onEvent
    return invoke<RunStarted>('run', { params, onEvent: ch })
  },
  historyList: (limit?: number) => invoke<RunRecord[]>('history_list', { limit }),
  historyOf: (path: string) => invoke<RunRecord | null>('history_of', { path }),
  historyDelete: (id: string) => invoke<boolean>('history_delete', { id }),
  historyRerun: (id: string) => invoke<Record<string, unknown>>('history_rerun', { id }),
  leftovers: () => invoke<string[]>('leftovers_list'),
  sweepLeftovers: (paths: string[]) => invoke<Cleanup>('leftovers_sweep', { paths }),
  keepLeftovers: (paths: string[]) => invoke<void>('leftovers_keep', { paths }),
  cancel: () => invoke<{ cancelled: boolean }>('cancel'),
  resultsQuery: (path: string, view: ResultsView, offset: number, limit: number) =>
    invoke<ResultsPage>('results_query', { path, view, offset, limit }),
  resultsOpen: (path: string, onEvent: (e: BrowserEvent) => void) => {
    const ch = new Channel<BrowserEvent>()
    ch.onmessage = onEvent
    return invoke<ResultsHead>('results_open', { path, onEvent: ch })
  },
  resultsPosition: (path: string, view: ResultsView, row: number) =>
    invoke<number | null>('results_position', { path, view, row }),
  revealOutput: (path: string, folder: boolean) => invoke<void>('reveal_output', { path, folder }),
  onMenu: (cb) => subscribe<string>('fastag:menu', cb),
  // An export is a job (GUI-DESIGN 6.1 item 11) with a Channel of its own.
  exportResults: (
    path: string,
    view: ResultsView,
    columns: string[],
    dest: string,
    format: ExportFormat,
    onEvent: (e: ExportEvent) => void
  ) => {
    const ch = new Channel<ExportEvent>()
    ch.onmessage = onEvent
    return invoke<number>('results_export', { path, view, columns, dest, format, onEvent: ch })
  },
  cancelExport: (jobId: number) => invoke<boolean>('results_cancel', { jobId }),
  exportReads: (path, dest, format, topN, minLength, onEvent) => {
    const ch = new Channel<ExportEvent>()
    ch.onmessage = onEvent
    return invoke<number>('denovo_export', { source: path, dest, format, topN, minLength, onEvent: ch })
  },
  species: (path: string) => invoke<SpeciesReport | null>('species', { path }),
  report: (path: string) => invoke<string | null>('report_text', { path }),
  reportHead: (path: string) => invoke<string | null>('report_head', { path }),
  taxdbInfo: (explicit?: string) => invoke<TaxdbInfo | null>('taxdb_info', { explicit }),

  loadSettings: () => invoke<Settings>('load_settings'),
  saveLast: (values: Record<string, unknown>) => invoke<boolean>('save_last', { values }),
  savePreset: (name: string, values: Record<string, unknown>) =>
    invoke<boolean>('save_preset', { name, values }),
  deletePreset: (name: string) => invoke<boolean>('delete_preset', { name }),

  // Built from a fixed template here (the renderer passes a number, never a URL),
  // so a crafted value cannot redirect the user elsewhere.
  openTaxon: async (taxid: number) => {
    const id = Number(taxid)
    if (!Number.isInteger(id) || id <= 0) return false
    await openUrl(`https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?id=${id}`)
    return true
  },

  onCloseRequested: (cb) => subscribe<'close' | 'quit'>('fastag:close-requested', cb),
  answerClose: (quit: boolean) => invoke<void>('close_answer', { quit }),
  setBusy: (busy: boolean) => invoke<void>('set_ui_busy', { busy }),
  onDrop: (cb) => subscribe<DropRoute>('fastag:drop', cb),
  onDragHover: (cb) => subscribe<boolean>('fastag:drag', cb),
  notify: (title: string, body: string) => invoke<void>('notify_finished', { title, body })
}

export default api

window.fastag = api
