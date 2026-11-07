// The run reducer (GUI-DESIGN 5 runStore, 9 layer 1; P2a PR r): one
// useReducer for every run and the batch queue, with the Job model of
// section 5. Pure: each test freezes the state it starts from.

import { describe, expect, it } from 'vitest'
import { initialRunState, queueView, runReducer, type Job, type RunAction, type RunState } from './runReducer'
import { createLogStore } from './logStore'
import type { RunResult } from '../types'

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o as Record<string, unknown>)) {
      // The log store is the job's mutable ring buffer, not reducer state.
      if (v && typeof v === 'object' && !('subscribe' in (v as object))) deepFreeze(v)
    }
  }
  return o
}

// Each action applied to a frozen copy of the state before it.
function apply(s: RunState, ...as: RunAction[]): RunState {
  return as.reduce((cur, a) => runReducer(deepFreeze(cur), a), s)
}

const start = (id: string, input = '/d/a.mzML', at = 1000): RunAction => ({
  type: 'RUN_START',
  id,
  input,
  out: input.replace(/\.mzML$/, '.tags.tsv'),
  params: { in: input },
  at,
  log: createLogStore(),
  speciesOn: false
})
const reply = (id: string, out = '/d/a.tags.tsv'): RunAction => ({
  type: 'EVENT',
  id,
  action: { type: 'REPLY', reply: { started: true, out, outputs: { out }, command: ['FASTag', '-in', '/d/a.mzML'] } }
})
const ev = (id: string, event: Extract<RunAction, { type: 'EVENT' }>['action'] & { type: 'EVENT' }): RunAction => ({
  type: 'EVENT',
  id,
  action: event
})
const progress = (id: string, done: number, total: number): RunAction =>
  ev(id, { type: 'EVENT', event: { kind: 'progress', done, total, ratePerSec: 10, etaSec: 5 } })
const phase = (id: string, label: string): RunAction => ev(id, { type: 'EVENT', event: { kind: 'phase', label } })
const done = (id: string, result: RunResult, at = 5000, extra: Partial<Extract<RunAction, { type: 'DONE' }>> = {}): RunAction => ({
  type: 'DONE',
  id,
  result,
  at,
  ...extra
})
const job = (s: RunState, id: string): Job => {
  const j = s.jobs.find((x) => x.id === id)
  if (!j) throw new Error(`no job ${id}`)
  return j
}

describe('runReducer: RUN_START', () => {
  it('creates the job client-side with its id, input, params, log and start time, and makes it active', () => {
    const a = start('job-1')
    const s = apply(initialRunState, a)
    const j = job(s, 'job-1')
    expect(j).toMatchObject({ id: 'job-1', input: '/d/a.mzML', out: '/d/a.tags.tsv', status: 'running', startedAt: 1000 })
    expect(j.params).toEqual({ in: '/d/a.mzML' })
    expect(j.log).toBe((a as Extract<RunAction, { type: 'RUN_START' }>).log)
    expect(j.progress).toEqual({ done: null, total: null, phase: null, ratePerSec: null, etaSec: null })
    expect(j.endedAt).toBeUndefined()
    expect(s.activeJobId).toBe('job-1')
    expect(s.liveLog).toBe(j.log)
    expect(s.batchMode).toBe(false)
    expect(s.announce).toBe('Run started on a.mzML.')
  })

  it("replaces the setters of a run's start: the last run's failure, species, reports, counts and copy note are cleared", () => {
    const dirty: RunState = {
      ...initialRunState,
      failure: { title: 'x failed', reasons: [] },
      species: { taxa: [] } as unknown as RunState['species'],
      reports: { list: [], errors: ['old'] },
      evidence: { contributed: 3, ms2: 4 },
      batchMiss: { input: '/d/x.mzML' },
      copied: 'yes'
    }
    const s = apply(dirty, { ...(start('job-1') as Extract<RunAction, { type: 'RUN_START' }>), speciesOn: true })
    expect(s.failure).toBeNull()
    expect(s.species).toBeNull()
    expect(s.reports).toEqual({ list: [], errors: [] })
    expect(s.evidence).toEqual({ contributed: null, ms2: null })
    expect(s.batchMiss).toBeNull()
    expect(s.copied).toBeNull()
    expect(s.speciesRun).toEqual({ input: '/d/a.mzML', enabled: true })
  })

  it('a second single run replaces the first job; the queue is untouched', () => {
    const s = apply(initialRunState, start('job-1'), done('job-1', { ok: true, code: 0 }), start('job-2', '/d/b.mzML'))
    expect(s.jobs.map((j) => j.id)).toEqual(['job-2'])
    expect(s.activeJobId).toBe('job-2')
  })
})

describe('runReducer: EVENT', () => {
  it('merges the reply (outputs, command) into its job by id', () => {
    const s = apply(initialRunState, start('job-1'), reply('job-1'))
    const j = job(s, 'job-1')
    expect(j.resolvedOutputs).toEqual({ out: '/d/a.tags.tsv' })
    expect(j.command).toEqual(['FASTag', '-in', '/d/a.mzML'])
    expect(j.replied).toBe(true)
  })

  it('progress and phase go to the job\'s progress {done, total, phase, ratePerSec, etaSec}', () => {
    const s = apply(initialRunState, start('job-1'), phase('job-1', 'Tagging spectra'), progress('job-1', 100, 200))
    expect(job(s, 'job-1').progress).toEqual({ done: 100, total: 200, phase: 'Tagging spectra', ratePerSec: 10, etaSec: 5 })
  })

  it('a Done event clears the count but keeps the phase; the job runs until DONE', () => {
    const s = apply(
      initialRunState,
      start('job-1'),
      phase('job-1', 'Writing reports'),
      progress('job-1', 1, 2),
      ev('job-1', { type: 'EVENT', event: { kind: 'done', ok: true, code: 0 } })
    )
    expect(job(s, 'job-1').progress).toMatchObject({ done: null, total: null, phase: 'Writing reports' })
    expect(job(s, 'job-1').status).toBe('running')
  })

  it('a Log event changes no reducer state: the lines live in the job\'s log store', () => {
    const s0 = apply(initialRunState, start('job-1'))
    const s1 = runReducer(deepFreeze(s0), ev('job-1', { type: 'EVENT', event: { kind: 'log', lines: [['x', true]] } }))
    expect(s1).toBe(s0)
  })

  it('an event of an unknown job, or of a job that has ended, changes nothing', () => {
    const s0 = apply(initialRunState, start('job-1'))
    expect(runReducer(deepFreeze(s0), progress('job-9', 1, 2))).toBe(s0)
    const s1 = apply(s0, reply('job-1'), done('job-1', { ok: true, code: 0 }))
    expect(runReducer(deepFreeze(s1), progress('job-1', 1, 2))).toBe(s1)
    expect(runReducer(deepFreeze(s1), phase('job-1', 'late'))).toBe(s1)
  })

  it('a reply naming the -out the table shows marks the table stale until the run ends', () => {
    const shown: RunState = { ...initialRunState, results: { path: '/d/a.tags.tsv', gen: 1 } }
    const s = apply(shown, start('job-1'), reply('job-1'))
    expect(s.results).toMatchObject({ path: '/d/a.tags.tsv', stale: true })
    const other = apply({ ...initialRunState, results: { path: '/d/z.tags.tsv', gen: 1 } }, start('job-1'), reply('job-1'))
    expect(other.results?.stale).toBeUndefined()
  })
})

describe('runReducer: DONE', () => {
  it('ends the job ok with its result and end time; the table it rewrote reads afresh', () => {
    const shown: RunState = { ...initialRunState, results: { path: '/d/a.tags.tsv', gen: 1 } }
    const s = apply(shown, start('job-1'), reply('job-1'), done('job-1', { ok: true, code: 0 }, 7000, { tags: 1234 }))
    const j = job(s, 'job-1')
    expect(j.status).toBe('ok')
    expect(j.result).toEqual({ ok: true, code: 0 })
    expect(j.endedAt).toBe(7000)
    expect(s.results).toMatchObject({ stale: false, incomplete: false, gen: 2 })
    expect(s.announce).toBe('Finished a.mzML: 1,234 tags.')
  })

  it('a failed run is failed, with its reason; the table it may have truncated is withheld', () => {
    const shown: RunState = { ...initialRunState, results: { path: '/d/a.tags.tsv', gen: 1 } }
    const cleanup = { removed: ['/d/a.tags.tsv'], renamed: [], failed: [] }
    const s = apply(shown, start('job-1'), reply('job-1'), done('job-1', { ok: false, code: 1, cleanup }, 5000, { reason: 'exit code 1: Error' }))
    expect(job(s, 'job-1')).toMatchObject({ status: 'failed', reason: 'exit code 1: Error' })
    expect(s.results).toMatchObject({ stale: true, incomplete: true, removed: 'removed', gen: 1 })
    expect(s.announce).toBe('a.mzML failed, partial outputs removed.')
  })

  it('a failed exit after a requested cancel is cancelled; a run that finished despite it stays ok', () => {
    const c = apply(initialRunState, start('job-1'), { type: 'CANCEL_REQUESTED' }, done('job-1', { ok: false, code: 1 }))
    expect(job(c, 'job-1').status).toBe('cancelled')
    expect(c.announce).toBe('Cancelled a.mzML.')
    const ok = apply(initialRunState, start('job-1'), { type: 'CANCEL_REQUESTED' }, done('job-1', { ok: true, code: 0 }))
    expect(job(ok, 'job-1').status).toBe('ok')
    // The backend's own flag counts without a click (the close guard).
    const flagged = apply(initialRunState, start('job-1'), done('job-1', { ok: false, code: null, cancelled: true }))
    expect(job(flagged, 'job-1').status).toBe('cancelled')
  })

  it('Done before RunStarted is a defined state: the late reply still merges its outputs', () => {
    const s = apply(initialRunState, start('job-1'), done('job-1', { ok: true, code: 0 }), reply('job-1'))
    const j = job(s, 'job-1')
    expect(j.status).toBe('ok')
    expect(j.resolvedOutputs).toEqual({ out: '/d/a.tags.tsv' })
    // A second reply, or a second DONE, changes nothing.
    expect(runReducer(deepFreeze(s), reply('job-1', '/d/other.tsv'))).toBe(s)
    expect(runReducer(deepFreeze(s), done('job-1', { ok: false, code: 1 }))).toBe(s)
  })

  it('the active job stays the live one after it ends: its log is the live log until the next run', () => {
    const s = apply(initialRunState, start('job-1'), done('job-1', { ok: true, code: 0 }))
    expect(s.activeJobId).toBe('job-1')
    expect(s.liveLog).toBe(job(s, 'job-1').log)
  })
})

describe('runReducer: CANCEL_REQUESTED', () => {
  it('marks the running job once, and nothing when no job runs', () => {
    expect(runReducer(deepFreeze(initialRunState), { type: 'CANCEL_REQUESTED' })).toBe(initialRunState)
    const s = apply(initialRunState, start('job-1'), { type: 'CANCEL_REQUESTED' })
    expect(job(s, 'job-1').cancelRequested).toBe(true)
    expect(runReducer(deepFreeze(s), { type: 'CANCEL_REQUESTED' })).toBe(s)
    const ended = apply(initialRunState, start('job-1'), done('job-1', { ok: true, code: 0 }))
    expect(runReducer(deepFreeze(ended), { type: 'CANCEL_REQUESTED' })).toBe(ended)
  })
})

describe('runReducer: BATCH_ADD and BATCH_REMOVE', () => {
  it('queues each input once, with distinct outputs, and turns batch mode on', () => {
    const s = apply(initialRunState, { type: 'BATCH_ADD', files: ['/d/s.mzML', '/d/s.mzpeak', '/d/s.mzML'] })
    expect(s.batchMode).toBe(true)
    expect(queueView(s).map((j) => [j.input, j.out, j.status])).toEqual([
      ['/d/s.mzML', '/d/s.tags.tsv', 'queued'],
      ['/d/s.mzpeak', '/d/s.mzpeak.tags.tsv', 'queued']
    ])
    expect(new Set(s.jobs.map((j) => j.id)).size).toBe(2)
    // Nothing new: the same state.
    expect(runReducer(deepFreeze(s), { type: 'BATCH_ADD', files: ['/d/s.mzML'] })).toBe(s)
  })

  it('a single run before the batch keeps its log as the live log; the queue holds only batch jobs', () => {
    const s = apply(initialRunState, start('job-1'), done('job-1', { ok: true, code: 0 }), { type: 'BATCH_ADD', files: ['/d/b.mzML'] })
    expect(queueView(s).map((j) => j.input)).toEqual(['/d/b.mzML'])
    expect(s.liveLog).toBe(job(s, 'job-1').log)
  })

  it('removes queued jobs by input; an empty queue ends batch mode; a running job stays', () => {
    const q = apply(initialRunState, { type: 'BATCH_ADD', files: ['/d/a.mzML', '/d/b.mzML', '/d/c.mzML'] })
    const s = apply(q, { type: 'BATCH_REMOVE', inputs: ['/d/b.mzML'] })
    expect(queueView(s).map((j) => j.input)).toEqual(['/d/a.mzML', '/d/c.mzML'])
    const running = apply(s, start('job-1', '/d/a.mzML'))
    const cleared = apply(running, { type: 'BATCH_REMOVE', inputs: ['/d/a.mzML', '/d/c.mzML'] })
    expect(queueView(cleared).map((j) => j.input)).toEqual(['/d/a.mzML'])
    const none = apply(q, { type: 'BATCH_REMOVE', inputs: ['/d/a.mzML', '/d/b.mzML', '/d/c.mzML'] })
    expect(none.batchMode).toBe(false)
    expect(none.jobs).toEqual([])
  })

  it('a queued job that starts gets its new id in place; its end shows in the queue with time, outputs and log', () => {
    const q = apply(initialRunState, { type: 'BATCH_ADD', files: ['/d/a.mzML', '/d/b.mzML'] })
    const s = apply(q, start('job-7', '/d/b.mzML', 2000))
    expect(s.jobs.map((j) => j.input)).toEqual(['/d/a.mzML', '/d/b.mzML'])
    expect(job(s, 'job-7')).toMatchObject({ status: 'running', out: '/d/b.tags.tsv' })
    expect(queueView(s)[1]).toMatchObject({ status: 'running' })
    expect(queueView(s)[1].log).toBeUndefined()
    const d = apply(s, reply('job-7', '/d/b.tags.tsv'), done('job-7', { ok: true, code: 0 }, 63_000))
    const v = queueView(d)[1]
    expect(v).toMatchObject({ status: 'done', ms: 61_000, outputs: { out: '/d/b.tags.tsv' } })
    expect(v.log).toBe(job(d, 'job-7').log)
    // A failed job keeps its reason and log, but offers no outputs.
    const f = apply(q, start('job-8', '/d/a.mzML'), done('job-8', { ok: false, code: 1, cleanup: { removed: ['x'], renamed: [], failed: [] } }, 9000, { reason: 'exit code 1' }))
    expect(queueView(f)[0]).toMatchObject({ status: 'failed', reason: 'exit code 1', cleaned: 1 })
    expect(queueView(f)[0].outputs).toBeUndefined()
  })

  it('a retried job starts clean: no reason, result or end from the run before', () => {
    const q = apply(initialRunState, { type: 'BATCH_ADD', files: ['/d/a.mzML'] })
    const f = apply(q, start('job-1', '/d/a.mzML'), done('job-1', { ok: false, code: 1 }, 3000, { reason: 'exit code 1' }))
    const r = apply(f, start('job-2', '/d/a.mzML', 4000))
    expect(r.jobs).toHaveLength(1)
    expect(job(r, 'job-2')).toMatchObject({ status: 'running', startedAt: 4000 })
    expect(job(r, 'job-2').reason).toBeUndefined()
    expect(job(r, 'job-2').result).toBeUndefined()
    expect(job(r, 'job-2').endedAt).toBeUndefined()
    // Events of the run before, by its old id, reach nothing.
    expect(runReducer(deepFreeze(r), progress('job-1', 1, 2))).toBe(r)
  })
})
