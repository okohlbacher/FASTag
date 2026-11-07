// A batch job as the queue's list shows it (runReducer.ts queueView) and the
// queue's naming of its outputs (moved from App.tsx, P1 PR c).

import type { ResolvedOutputs } from '../types'
import type { JobStatus } from '../icons'
import { defaultOut } from '../app/paths'
import { duration } from '../app/format'
import type { LogStore } from './logStore'

export interface BatchJob {
  input: string
  out: string
  status: JobStatus
  tags?: number
  // Why the job failed: the next job clears the log.
  reason?: string
  // How long the job ran, in ms.
  ms?: number
  // Every output of a done job, as the backend resolved them (its tags are
  // outputs.out).
  outputs?: ResolvedOutputs
  // This job's own log, kept when the next job starts (the live log moves
  // to that job then): a failed job's banner and its [Log] button open it.
  log?: LogStore
  // A job that did not finish: the partial outputs the backend removed.
  cleaned?: number
}

// The queue with @p files added: an input already queued is skipped.
export function addJobs(js: BatchJob[], files: string[]): BatchJob[] {
  const have = new Set(js.map((j) => j.input))
  const used = new Set(js.map((j) => j.out))
  const add: BatchJob[] = []
  for (const f of files) {
    if (have.has(f)) continue
    have.add(f)
    // sample.mzML and sample.mzpeak both map to sample.tags.tsv — on a
    // collision keep the full input name, then number, so outputs stay
    // distinct even when the fallback collides too.
    let out = defaultOut(f)
    if (used.has(out)) out = `${f}.tags.tsv`
    for (let n = 2; used.has(out); n++) out = `${f}.${n}.tags.tsv`
    used.add(out)
    add.push({ input: f, out, status: 'queued' as const })
  }
  return [...js, ...add]
}

// A job's status in words, for its row.
export const jobWords = (j: BatchJob): string =>
  j.status === 'done'
    ? `Done${j.ms != null ? ` · ${duration(j.ms)}` : ''}`
    : j.status === 'failed'
      ? `Failed: ${j.reason ?? 'no reason given'}`
      : j.status === 'cancelled'
        ? `Cancelled by you${j.cleaned ? ', partial outputs removed' : ''}`
        : j.status === 'running'
          ? 'Running…'
          : 'Not run'
