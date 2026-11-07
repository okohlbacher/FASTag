// The export jobs of one App (GUI-DESIGN 6.1 item 11), by source path. They
// live outside ResultsTable: the table unmounts on every switch to another
// result tab and when a file is opened again, while the job goes on in the
// backend. Its Channel feeds this store, so a table mounted later shows the
// job's progress, its Cancel and its outcome, and cannot start a second
// export of that file over it (browser.rs also refuses a second job to the
// same name while one runs). One store per App, as viewStore: a
// module-level one would be shared by every test.

import { createContext, useContext, useState, useSyncExternalStore } from 'react'
import type { ExportEvent, ExportFormat, ResultsView } from '../types'

export interface ExportJob {
  dest: string
  // null until the backend answered with the job's id.
  jobId: number | null
  done: number
  total: number
  running: boolean
  // The outcome once the job ended.
  result: { ok: boolean; text: string } | null
}

export interface ExportJobs {
  get(path: string): ExportJob | null
  subscribe(listener: () => void): () => void
  start(path: string, view: ResultsView, columns: string[], dest: string, format: ExportFormat, total: number): Promise<void>
  cancel(path: string): void
}

export function createExportJobs(): ExportJobs {
  const jobs = new Map<string, ExportJob>()
  // Per path: the newest export's number (the events of an earlier one are
  // dropped) and whether Cancel was pressed before the backend answered.
  const seq = new Map<string, number>()
  const cancelWanted = new Set<string>()
  let next = 0
  const listeners = new Set<() => void>()
  const set = (path: string, u: (j: ExportJob) => ExportJob): void => {
    const j = jobs.get(path)
    if (!j) return
    jobs.set(path, u(j))
    for (const l of listeners) l()
  }
  const end = (path: string, result: ExportJob['result']): void => set(path, (j) => ({ ...j, running: false, result }))
  return {
    get: (path) => jobs.get(path) ?? null,
    subscribe(l) {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
    async start(path, view, columns, dest, format, total) {
      if (jobs.get(path)?.running) return
      const mine = ++next
      seq.set(path, mine)
      cancelWanted.delete(path)
      jobs.set(path, { dest, jobId: null, done: 0, total, running: true, result: null })
      for (const l of listeners) l()
      const onEvent = (e: ExportEvent): void => {
        if (seq.get(path) !== mine) return
        if (e.kind === 'progress') set(path, (j) => ({ ...j, done: e.done, total: e.total }))
        else if (e.kind === 'done') end(path, { ok: true, text: `Wrote ${e.rows.toLocaleString('en-US')} rows to ${e.dest}.` })
        else if (e.kind === 'cancelled') end(path, { ok: true, text: 'Export cancelled; nothing was written.' })
        else end(path, { ok: false, text: `Export failed: ${e.message}` })
      }
      try {
        const jobId = await window.fastag.exportResults(path, view, columns, dest, format, onEvent)
        if (seq.get(path) !== mine) return
        set(path, (j) => ({ ...j, jobId }))
        // Cancel was pressed before the backend answered.
        if (cancelWanted.has(path)) void window.fastag.cancelExport(jobId)
      } catch (err) {
        if (seq.get(path) !== mine) return
        end(path, { ok: false, text: `Export failed: ${err instanceof Error ? err.message : String(err)}` })
      }
    },
    cancel(path) {
      const j = jobs.get(path)
      if (!j?.running) return
      cancelWanted.add(path)
      if (j.jobId != null) void window.fastag.cancelExport(j.jobId)
    }
  }
}

/// App's store; a table rendered without one (the unit tests) gets its own.
export const ExportJobsContext = createContext<ExportJobs | null>(null)

export function useExportJobs(): ExportJobs {
  const given = useContext(ExportJobsContext)
  const [own] = useState(createExportJobs)
  return given ?? own
}

/// @p path's job in @p store, re-rendering the caller on each change.
export function useExportJob(store: ExportJobs, path: string): ExportJob | null {
  return useSyncExternalStore(store.subscribe, () => store.get(path), () => store.get(path))
}
