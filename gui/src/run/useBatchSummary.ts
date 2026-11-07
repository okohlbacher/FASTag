// What each finished batch job wrote, read once when it ends, for the batch
// summary (batchSummary.ts): its reports and species report at the paths
// the backend resolved for it (ResolvedOutputs), its log and what it was
// sent. Keyed by input; a re-run of an input replaces its entry.

import { useEffect, useMemo, useRef, useState } from 'react'
import { REPORT_PARAMS } from '../app/paths'
import { loadReports } from '../results/reports'
import type { JobData } from './batchSummary'
import type { Job } from './runReducer'

async function readJob(j: Job): Promise<JobData> {
  const o = j.resolvedOutputs!
  const sent = REPORT_PARAMS.map((n) => o[n]).filter((p): p is string => !!p)
  const [rep, species] = await Promise.all([
    loadReports(sent),
    // An unreadable species report costs the genus cell only.
    o.species_out ? window.fastag.species(o.species_out).catch(() => null) : Promise.resolve(null)
  ])
  return {
    log: j.log?.get() ?? [],
    reports: rep.reports,
    species,
    census: null,
    params: (j.params?.['params'] ?? {}) as Record<string, unknown>
  }
}

export function useBatchData(jobs: readonly Job[]): ReadonlyMap<string, JobData> {
  // input -> the job id the data was read for, and the data.
  const [read, setRead] = useState<ReadonlyMap<string, { id: string; data: JobData }>>(new Map())
  const asked = useRef(new Set<string>())
  useEffect(() => {
    for (const j of jobs) {
      if (!j.batch || j.status !== 'ok' || !j.resolvedOutputs || asked.current.has(j.id)) continue
      asked.current.add(j.id)
      void readJob(j)
        .then((data) => setRead((m) => new Map(m).set(j.input, { id: j.id, data })))
        .catch(() => asked.current.delete(j.id))
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
