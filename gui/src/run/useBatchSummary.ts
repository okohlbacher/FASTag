// What each finished batch job wrote, read once when it ends, for the batch
// summary (batchSummary.ts): its reports and species report at the paths
// the backend resolved for it (ResolvedOutputs), its log and what it was
// sent. Keyed by input; a re-run of an input replaces its entry.

import { useEffect, useMemo, useRef, useState } from 'react'
import { REPORT_PARAMS } from '../app/paths'
import { loadReports } from '../results/reports'
import { NOT_READ, type JobData, type SentReport } from './batchSummary'
import type { Job } from './runReducer'

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

async function readJob(j: Job): Promise<JobData> {
  const o = j.resolvedOutputs!
  const unread: Partial<Record<SentReport, string>> = {}
  // One report at a time, so a read or parse error names its own cell.
  const reads = REPORT_PARAMS.filter((n) => !!o[n]).map(async (n) => {
    const r = await loadReports([o[n]!])
    if (r.errors.length) unread[n] = r.errors.join('; ')
    return r.reports
  })
  const sp = o.species_out
  const [reports, species] = await Promise.all([
    Promise.all(reads).then((rs) => rs.flat()),
    // An unreadable species report costs the genus cell only.
    sp
      ? window.fastag.species(sp).then(
          (r) => {
            // The run was sent -species; the backend reads a missing, empty
            // or malformed report as none.
            if (!r) unread.species_out = `${NOT_READ}the species report ${sp} was not found or could not be parsed`
            return r
          },
          (e: unknown) => {
            unread.species_out = `Cannot read ${sp}: ${message(e)}`
            return null
          }
        )
      : Promise.resolve(null)
  ])
  return {
    log: j.log?.get() ?? [],
    reports,
    species,
    census: null,
    params: (j.params?.['params'] ?? {}) as Record<string, unknown>,
    unread
  }
}

// A job whose reports could not be read at all: its row says so.
const failedRead = (e: unknown): JobData => ({ log: [], reports: [], species: null, census: null, params: {}, failed: message(e) })

export function useBatchData(jobs: readonly Job[]): ReadonlyMap<string, JobData> {
  // input -> the job id the data was read for, and the data.
  const [read, setRead] = useState<ReadonlyMap<string, { id: string; data: JobData }>>(new Map())
  const asked = useRef(new Set<string>())
  useEffect(() => {
    for (const j of jobs) {
      if (!j.batch || j.status !== 'ok' || !j.resolvedOutputs || asked.current.has(j.id)) continue
      asked.current.add(j.id)
      void readJob(j)
        .catch(failedRead)
        .then((data) => setRead((m) => new Map(m).set(j.input, { id: j.id, data })))
    }
  }, [jobs])
  return useMemo(() => {
    const m = new Map<string, JobData>()
    for (const j of jobs) {
      const r = read.get(j.input)
      // Only the data of the job now in the queue: not of an earlier run.
      if (j.batch && r && r.id === j.id) m.set(j.input, r.data)
    }
    return m
  }, [jobs, read])
}
