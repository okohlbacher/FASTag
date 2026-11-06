// One run as the renderer tracks it (GUI-DESIGN 5 "Job", 6.2): created here,
// with its id, before `run` is invoked, so its Channel events and the later
// RunStarted reply merge into the same job by construction. Each job has its
// own Channel, so no event can reach another job, and the run-id and
// early-done bookkeeping the global events needed is gone.
//
// Defined states the old event plumbing had to special-case:
//  - Done before the reply: the job has its result and waits for the reply
//    (its outputs) before it settles.
//  - Done without outputs: the reply was refused or the invoke failed after
//    a Done; the job settles with its result and no outputs.
//  - An event after Done (none should come, events.rs sends Done last) is
//    dropped and changes nothing.
//  - Cancel during a phase without progress: the job keeps its phase, and a
//    failed exit after a requested cancel counts as cancelled (a killed
//    child's exit code says nothing; Windows reports 1).

import type { FastagApi, LogLine, ResolvedOutputs, RunEvent, RunResult, RunStarted } from './types'

/// The log a job keeps: its last MAX_LOG lines.
export const MAX_LOG = 5000

export interface Progress {
  done: number
  total: number
  ratePerSec: number | null
  etaSec: number | null
}

export interface Job {
  id: string
  status: 'starting' | 'running' | 'ok' | 'failed' | 'cancelled'
  // The reply of `run` has come (or the invoke failed).
  replied: boolean
  started?: RunStarted
  outputs?: ResolvedOutputs
  command?: string[]
  result?: RunResult
  log: LogLine[]
  // Lines dropped from the front of log to keep it at MAX_LOG.
  dropped: number
  progress: Progress | null
  phase: string | null
  cancelRequested: boolean
}

export type JobAction =
  | { type: 'REPLY'; reply: RunStarted }
  | { type: 'REJECTED'; error: string }
  | { type: 'EVENT'; event: RunEvent }
  | { type: 'CANCEL_REQUESTED' }

let seq = 0
/// A job id, unique in this session.
export function newJobId(): string {
  seq += 1
  return `job-${Date.now().toString(36)}-${seq}`
}

export function newJob(id: string): Job {
  return { id, status: 'starting', replied: false, log: [], dropped: 0, progress: null, phase: null, cancelRequested: false }
}

/// The result is known and so is the reply: nothing more will change.
export const isSettled = (j: Job): boolean => j.result !== undefined && j.replied

function ended(j: Job, r: RunResult): Job {
  const status = r.ok ? 'ok' : r.cancelled === true || j.cancelRequested ? 'cancelled' : 'failed'
  return { ...j, result: r, status }
}

/// The job after @p a. Returns @p j itself when @p a changes nothing.
export function jobReducer(j: Job, a: JobAction): Job {
  switch (a.type) {
    case 'REPLY': {
      if (j.replied) return j
      const r = a.reply
      const next: Job = {
        ...j,
        replied: true,
        started: r,
        outputs: r.outputs ?? undefined,
        command: r.command ?? undefined
      }
      if (next.result) return next
      if (!r.started) return ended(next, { ok: false, code: null, message: r.reason ?? 'no reason given' })
      return { ...next, status: 'running' }
    }
    case 'REJECTED': {
      if (j.replied) return j
      const next: Job = { ...j, replied: true }
      return next.result ? next : ended(next, { ok: false, code: null, message: a.error })
    }
    case 'CANCEL_REQUESTED':
      return j.result || j.cancelRequested ? j : { ...j, cancelRequested: true }
    case 'EVENT': {
      if (j.result) return j
      const e = a.event
      switch (e.kind) {
        case 'log': {
          if (e.lines.length === 0) return j
          const all = j.log.concat(e.lines)
          const cut = Math.max(0, all.length - MAX_LOG)
          return { ...j, log: cut ? all.slice(cut) : all, dropped: j.dropped + cut }
        }
        case 'progress':
          return { ...j, progress: { done: e.done, total: e.total, ratePerSec: e.ratePerSec ?? null, etaSec: e.etaSec ?? null } }
        case 'phase':
          return e.label === j.phase ? j : { ...j, phase: e.label }
        case 'done': {
          const { kind: _kind, ...r } = e
          return ended(j, r)
        }
      }
    }
  }
}

/// Start a job: invoke `run` with a Channel of its own and feed its events
/// and the reply through jobReducer. @p onChange sees every change, with the
/// action that made it; the promise resolves once the job is settled.
export function runJob(
  api: Pick<FastagApi, 'run'>,
  params: Record<string, unknown>,
  id: string,
  onChange: (job: Job, a: JobAction) => void
): { job: () => Job; dispatch: (a: JobAction) => void; settled: Promise<Job> } {
  let job = newJob(id)
  let settle: (j: Job) => void = () => {}
  const settled = new Promise<Job>((resolve) => (settle = resolve))
  const dispatch = (a: JobAction): void => {
    const next = jobReducer(job, a)
    if (next === job) return
    job = next
    onChange(job, a)
    if (isSettled(job)) settle(job)
  }
  let reply: Promise<RunStarted>
  try {
    reply = api.run(params, (event) => dispatch({ type: 'EVENT', event }))
  } catch (err) {
    reply = Promise.reject(err)
  }
  reply.then(
    (r) => dispatch({ type: 'REPLY', reply: r }),
    (err: unknown) => dispatch({ type: 'REJECTED', error: err instanceof Error ? err.message : String(err) })
  )
  return { job: () => job, dispatch, settled }
}
