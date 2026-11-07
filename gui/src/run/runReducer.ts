// The run state as one reducer (GUI-DESIGN 5 runStore, P2a PR r): every job
// (the single run and the batch queue) with the Job model of section 5, the
// job whose log is live, and what the runs leave for the result tabs. It
// replaces the useState setters P1 PR c moved unchanged into useRun.ts;
// RUN_START does in one step what twenty of them did at a run's start.
//
// The run lifecycle: RUN_START, EVENT, DONE, CANCEL_REQUESTED, BATCH_ADD and
// BATCH_REMOVE. The remaining actions set what the result tabs show.
//
// Job ids are created client-side before `run` is invoked (runJob.ts);
// events and the reply merge into a job by id, so an event of an unknown id
// (a job's earlier run, or one removed) changes nothing. A job's log lines
// are not reducer state: they go to its LogStore (logStore.ts), so a Log
// batch re-renders only the drawer.

import type { ResolvedOutputs, RunResult, SpeciesReport } from '../types'
import type { JobAction } from '../runJob'
import { baseName, type Report } from '../digestReport'
import { addJobs, type BatchJob } from './batch'
import type { Refusal } from '../inspector/checks'
import { createLogStore, type LogStore } from './logStore'

// A run that failed: what failed, and FASTag's own words for why (each failed
// job of a batch has its own), plus the command line to reproduce it.
export interface Failure {
  title: string
  // input: the batch job the reason belongs to, whose log it opens.
  // refusal: FASTag refused the input (exit 11, raw DIA; inspector/checks.ts).
  reasons: { what?: string; text: string; input?: string; refusal?: Refusal }[]
  command?: string[]
  // The batch job whose log "Show full log" opens; none: the live log.
  logOf?: string
}

// The tags TSV the browser pane shows. gen forces a fresh ResultsTable when
// the same path is re-run: the backend cache invalidates on (len, mtime),
// and the frontend view/scroll state must reset with it. input names the
// run that wrote it (none for an opened file). stale: a run that writes
// this path is in flight. The CLI writes <out> in place, so a run that fails
// or is cancelled can leave it truncated or removed (incomplete).
export interface Results {
  path: string
  gen: number
  input?: string
  stale?: boolean
  incomplete?: boolean
  // The backend removed it (or renamed it to .incomplete) after the run
  // stopped part-way: there is nothing left to open.
  removed?: 'removed' | 'renamed'
  // Opened from disk, and the run record says the run that last wrote it
  // did not finish (history.rs): withheld as incomplete.
  recorded?: { status: 'cancelled' | 'failed'; end: number }
}

// The last run that finished, for the summary over the form, with the
// parameters it was given that differ from the defaults.
export interface LastRun {
  input: string
  ok: boolean
  cancelled: boolean
  at: number
  ms: number
  // Not known for a run of an earlier session (read from the run record).
  changed?: string[]
  // Partial outputs the backend removed after a cancel or failure.
  cleaned: number
  // Read from the run record at start: a run of an earlier session.
  earlier?: boolean
  // Its -out as the CLI wrote it (ResolvedOutputs): Reveal and Open folder.
  out?: string
}

// Parsed from the CLI's own summary line, so the panel reports what the run
// actually did rather than a number the GUI guessed.
export interface Evidence {
  contributed: number | null
  ms2: number | null
}

export interface Reports {
  list: Report[]
  errors: string[]
}

export type JobStatus = 'queued' | 'running' | 'ok' | 'failed' | 'cancelled'

// A job's progress (progress.rs): spectra done of total, the phase it is in
// and the rate and time left once measured. done/total are null before the
// first count and after Done.
export interface JobProgress {
  done: number | null
  total: number | null
  phase: string | null
  ratePerSec: number | null
  etaSec: number | null
}

// One run (GUI-DESIGN 5 "Job").
export interface Job {
  // Set by RUN_START, before `run` is invoked; a queued job has a
  // placeholder until then, and a re-run gets a new one.
  id: string
  input: string
  // The -out the queue named for it (a single run: the form's).
  out: string
  // A job of the batch queue; otherwise the single run.
  batch: boolean
  // What `run` was given.
  params?: Record<string, unknown>
  // Every output, as the backend resolved it (the RunStarted reply).
  resolvedOutputs?: ResolvedOutputs
  // The argv, binary first, as the backend ran it.
  command?: string[]
  // Its log (a ring buffer of MAX_LOG lines); none before it first ran.
  log: LogStore | null
  progress: JobProgress
  status: JobStatus
  result?: RunResult
  startedAt?: number
  endedAt?: number
  // The reply of `run` has come (or the invoke failed).
  replied: boolean
  cancelRequested: boolean
  // Why it failed, for its row: the next job clears the live log.
  reason?: string
  // The CLI lines the inspector reads after the run (checks.ts NOTE_LINE).
  notes?: string[]
}

export interface OverwriteAsk {
  files: string[]
  answer: (yes: boolean) => void
}

export interface BatchEnd {
  // The jobs this pass started.
  ran: number
  // Of them, the ones that failed.
  failed: number
  // The pass was cancelled.
  cancelled: boolean
}

export interface RunState {
  jobs: Job[]
  // The job last started: the one running, or the one whose log is live.
  activeJobId: string | null
  // The queue has jobs: the single input and output are hidden.
  batchMode: boolean
  // A batch is being worked through (between two jobs no job runs).
  batchRunning: boolean
  // How the last batch pass ended: the jobs it ran, not the queue's
  // statuses (a Retry failed whose jobs fail again ends as it started).
  batchEnd: BatchEnd | null
  // The log the drawer shows by default: the last started job's.
  liveLog: LogStore
  results: Results | null
  // A batch whose last job wrote no tags: the Tags tab names the job with
  // none, and a done job whose tags can be selected in the batch.
  batchMiss: { input: string; done?: string } | null
  species: SpeciesReport | null
  // The run the Species tab describes, as it was submitted: unticking species
  // or lowering tag_length afterwards must not hide (or re-show) its report.
  // null until the first run; the tab then follows the form.
  speciesRun: { input: string; enabled: boolean } | null
  reports: Reports
  // Why the last run failed, shown above the result tabs.
  failure: Failure | null
  copied: 'yes' | 'no' | null
  lastRun: LastRun | null
  // Outputs of the run about to start that already exist: confirmed before
  // the run, never after (GUI-DESIGN 6.4). answer(true) runs over them.
  overwriteAsk: OverwriteAsk | null
  // What a screen reader hears of a run: started, finished, stopped.
  announce: string
  // Why Reveal did nothing.
  revealErr: string | null
  evidence: Evidence
}

type Update<T> = T | ((cur: T) => T)
const apply = <T,>(u: Update<T>, cur: T): T => (typeof u === 'function' ? (u as (c: T) => T)(cur) : u)

export type RunAction =
  | { type: 'RUN_START'; id: string; input: string; out: string; params: Record<string, unknown>; at: number; log: LogStore; speciesOn: boolean }
  // A Channel event or the reply of `run` (runJob.ts JobAction).
  | { type: 'EVENT'; id: string; action: JobAction }
  // The job is settled (its result and its reply are in). tags: the CLI's
  // summary count; reason: why a failed job failed.
  // notes: the log lines the inspector keeps (checks.ts NOTE_LINE).
  | { type: 'DONE'; id: string; result: RunResult; at: number; tags?: number | null; reason?: string; notes?: string[] }
  | { type: 'CANCEL_REQUESTED' }
  | { type: 'BATCH_ADD'; files: string[] }
  | { type: 'BATCH_REMOVE'; inputs: string[] }
  // ended: when a pass ends, what it ran (none: it ran nothing).
  | { type: 'BATCH_RUNNING'; on: boolean; ended?: BatchEnd }
  | { type: 'RESULTS'; update: Update<Results | null> }
  | { type: 'BATCH_MISS'; miss: RunState['batchMiss'] }
  | { type: 'SPECIES'; species: SpeciesReport | null }
  | { type: 'REPORTS'; update: Update<Reports> }
  | { type: 'FAILURE'; failure: Failure | null }
  | { type: 'COPIED'; copied: RunState['copied'] }
  // ifNone: only when no run of this session is known yet (the run record).
  | { type: 'LAST_RUN'; lastRun: LastRun; ifNone?: boolean }
  | { type: 'ASK'; ask: OverwriteAsk | null }
  | { type: 'REVEAL_ERR'; error: string | null }
  | { type: 'EVIDENCE'; evidence: Partial<Evidence> }

const noProgress: JobProgress = { done: null, total: null, phase: null, ratePerSec: null, etaSec: null }
const noEvidence: Evidence = { contributed: null, ms2: null }

export const initialRunState: RunState = {
  jobs: [],
  activeJobId: null,
  batchMode: false,
  batchRunning: false,
  batchEnd: null,
  liveLog: createLogStore(),
  results: null,
  batchMiss: null,
  species: null,
  speciesRun: null,
  reports: { list: [], errors: [] },
  failure: null,
  copied: null,
  lastRun: null,
  overwriteAsk: null,
  announce: '',
  revealErr: null,
  evidence: noEvidence
}

/// A fresh state, with a log store of its own (one per App instance).
export const createRunState = (): RunState => ({ ...initialRunState, liveLog: createLogStore() })

const ended = (j: Job): boolean => j.status === 'ok' || j.status === 'failed' || j.status === 'cancelled'

// The state with job @p id replaced by @p f of it; the state itself when
// there is no such job or @p f changes nothing.
function withJob(s: RunState, id: string, f: (j: Job) => Job): RunState {
  const i = s.jobs.findIndex((j) => j.id === id)
  if (i < 0) return s
  const next = f(s.jobs[i])
  if (next === s.jobs[i]) return s
  const jobs = s.jobs.slice()
  jobs[i] = next
  return { ...s, jobs }
}

const queuedId = (input: string): string => `queued:${input}`

function event(s: RunState, id: string, a: JobAction): RunState {
  const j = s.jobs.find((x) => x.id === id)
  if (!j) return s
  switch (a.type) {
    case 'REPLY': {
      if (j.replied) return s
      const r = a.reply
      const outputs = r.outputs ?? undefined
      const next = withJob(s, id, (x) => ({ ...x, replied: true, resolvedOutputs: outputs, command: r.command ?? undefined }))
      // The run may replace -out: until it ends, a table of that path may
      // not be what the file will hold. A run already over replaces nothing.
      const o = outputs?.out
      if (!r.started || !o || ended(j) || next.results?.path !== o) return next
      return { ...next, results: { ...next.results, stale: true } }
    }
    case 'REJECTED':
      return j.replied ? s : withJob(s, id, (x) => ({ ...x, replied: true }))
    case 'CANCEL_REQUESTED':
      return cancel(s, id)
    case 'EVENT': {
      if (j.status !== 'running') return s
      const e = a.event
      switch (e.kind) {
        // The lines are the log store's.
        case 'log':
          return s
        case 'progress':
          return withJob(s, id, (x) => ({
            ...x,
            progress: { ...x.progress, done: e.done, total: e.total, ratePerSec: e.ratePerSec ?? null, etaSec: e.etaSec ?? null }
          }))
        case 'phase':
          return e.label === j.progress.phase ? s : withJob(s, id, (x) => ({ ...x, progress: { ...x.progress, phase: e.label } }))
        case 'done':
          return j.progress.done === null && j.progress.total === null
            ? s
            : withJob(s, id, (x) => ({ ...x, progress: { ...x.progress, done: null, total: null } }))
      }
    }
  }
}

function cancel(s: RunState, id: string | null): RunState {
  if (id === null) return s
  return withJob(s, id, (j) => (j.status !== 'running' || j.cancelRequested ? j : { ...j, cancelRequested: true }))
}

function done(s: RunState, a: Extract<RunAction, { type: 'DONE' }>): RunState {
  const j = s.jobs.find((x) => x.id === a.id)
  if (!j || ended(j)) return s
  const r = a.result
  // A killed run's exit status says nothing (Windows reports code 1), so a
  // cancel is read off the backend flag or the Cancel the user pressed. A
  // run that finished ok despite the kill stays ok.
  const status: JobStatus = r.ok ? 'ok' : r.cancelled === true || j.cancelRequested ? 'cancelled' : 'failed'
  const next = withJob(s, a.id, (x) => ({
    ...x,
    status,
    result: r,
    endedAt: a.at,
    reason: status === 'failed' ? a.reason : undefined,
    notes: a.notes
  }))
  // The CLI writes -out in place: a finished run rewrote it, so the table
  // reads it afresh; a failed or cancelled one may have left it truncated or
  // removed, so the table stays withheld as incomplete. The backend removed
  // what the run wrote: the table has nothing left to open, not even
  // "anyway".
  const marked = j.resolvedOutputs?.out
  const gone = (p: string): 'removed' | 'renamed' | undefined =>
    r.cleanup?.removed.includes(p) ? 'removed' : r.cleanup?.renamed.includes(`${p}.incomplete`) ? 'renamed' : undefined
  const x = next.results
  const results =
    x?.stale && marked && x.path === marked
      ? r.ok
        ? { ...x, stale: false, incomplete: false, removed: undefined, gen: x.gen + 1 }
        : { ...x, incomplete: true, removed: gone(x.path) }
      : x
  const name = baseName(j.input)
  const cleaned = r.cleanup?.removed.length ?? 0
  const announce =
    status === 'ok'
      ? `Finished ${name}${a.tags != null ? `: ${a.tags.toLocaleString('en-US')} tags` : ''}.`
      : status === 'cancelled'
        ? `Cancelled ${name}${cleaned ? ', partial outputs removed' : ''}.`
        : `${name} failed${cleaned ? ', partial outputs removed' : ''}.`
  return { ...next, results, announce }
}

function start(s: RunState, a: Extract<RunAction, { type: 'RUN_START' }>): RunState {
  const fresh: Job = {
    id: a.id,
    input: a.input,
    out: a.out,
    batch: false,
    params: a.params,
    log: a.log,
    progress: noProgress,
    status: 'running',
    startedAt: a.at,
    replied: false,
    cancelRequested: false
  }
  const q = s.jobs.findIndex((j) => j.batch && j.input === a.input)
  let jobs: Job[]
  if (q >= 0) {
    // A queued (or re-run) batch job: in place, with its queue's -out.
    jobs = s.jobs.slice()
    jobs[q] = { ...fresh, batch: true, out: s.jobs[q].out }
  } else {
    // The single run replaces the single run before it.
    jobs = [...s.jobs.filter((j) => j.batch), fresh]
  }
  return {
    ...s,
    jobs,
    activeJobId: a.id,
    liveLog: a.log,
    // Nothing of the run before reads as this run's: its counts, reports,
    // species, failure and copy note go.
    evidence: noEvidence,
    reports: { list: [], errors: [] },
    species: null,
    speciesRun: { input: a.input, enabled: a.speciesOn },
    batchMiss: null,
    failure: null,
    copied: null,
    announce: `Run started on ${baseName(a.input)}.`
  }
}

function batchAdd(s: RunState, files: string[]): RunState {
  const queue = s.jobs.filter((j) => j.batch)
  const named = addJobs(queueView(s), files)
  if (named.length === queue.length) return s
  const add: Job[] = named.slice(queue.length).map((b) => ({
    id: queuedId(b.input),
    input: b.input,
    out: b.out,
    batch: true,
    log: null,
    progress: noProgress,
    status: 'queued',
    replied: false,
    cancelRequested: false
  }))
  // The queue first, in order, then the single run (whose log stays live).
  return { ...s, jobs: [...queue, ...add, ...s.jobs.filter((j) => !j.batch)], batchMode: true }
}

function batchRemove(s: RunState, inputs: string[]): RunState {
  const drop = new Set(inputs)
  const jobs = s.jobs.filter((j) => !(j.batch && drop.has(j.input) && j.status !== 'running'))
  if (jobs.length === s.jobs.length) return s
  return { ...s, jobs, batchMode: jobs.some((j) => j.batch) }
}

/// The state after @p a. Returns @p s itself when @p a changes nothing, so
/// React skips the render.
export function runReducer(s: RunState, a: RunAction): RunState {
  switch (a.type) {
    case 'RUN_START':
      return start(s, a)
    case 'EVENT':
      return event(s, a.id, a.action)
    case 'DONE':
      return done(s, a)
    case 'CANCEL_REQUESTED':
      return cancel(s, s.activeJobId)
    case 'BATCH_ADD':
      return batchAdd(s, a.files)
    case 'BATCH_REMOVE':
      return batchRemove(s, a.inputs)
    case 'BATCH_RUNNING':
      if (a.ended) return { ...s, batchRunning: a.on, batchEnd: a.ended }
      return s.batchRunning === a.on ? s : { ...s, batchRunning: a.on }
    case 'RESULTS': {
      const results = apply(a.update, s.results)
      return results === s.results ? s : { ...s, results }
    }
    case 'BATCH_MISS':
      return { ...s, batchMiss: a.miss }
    case 'SPECIES':
      return { ...s, species: a.species }
    case 'REPORTS':
      return { ...s, reports: apply(a.update, s.reports) }
    case 'FAILURE':
      return s.failure === a.failure ? s : { ...s, failure: a.failure }
    case 'COPIED':
      return s.copied === a.copied ? s : { ...s, copied: a.copied }
    case 'LAST_RUN':
      return a.ifNone && s.lastRun ? s : { ...s, lastRun: a.lastRun }
    case 'ASK':
      return { ...s, overwriteAsk: a.ask }
    case 'REVEAL_ERR':
      return s.revealErr === a.error ? s : { ...s, revealErr: a.error }
    case 'EVIDENCE': {
      const e = { ...s.evidence, ...a.evidence }
      return e.contributed === s.evidence.contributed && e.ms2 === s.evidence.ms2 ? s : { ...s, evidence: e }
    }
  }
}

/// The job last started, if it is still listed.
export const activeJob = (s: RunState): Job | undefined =>
  s.activeJobId === null ? undefined : s.jobs.find((j) => j.id === s.activeJobId)

/// The batch queue as its list shows it: status in the queue's words, the
/// time a job ran, the outputs of a done one, and the log of an ended one.
export function queueView(s: RunState): BatchJob[] {
  return s.jobs
    .filter((j) => j.batch)
    .map((j) => {
      const b: BatchJob = { input: j.input, out: j.out, status: j.status === 'ok' ? 'done' : j.status }
      if (j.reason !== undefined) b.reason = j.reason
      if (ended(j)) {
        if (j.startedAt !== undefined && j.endedAt !== undefined) b.ms = j.endedAt - j.startedAt
        if (j.status === 'ok' && j.resolvedOutputs) b.outputs = j.resolvedOutputs
        if (j.log) b.log = j.log
        b.cleaned = j.result?.cleanup?.removed.length ?? 0
      }
      return b
    })
}
