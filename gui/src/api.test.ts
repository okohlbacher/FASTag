// api.ts against Tauri's own IPC mock (GUI-DESIGN 6.2 and 9): the real
// invoke, the real Channel, and the job a run becomes (runJob.ts), at the
// layer where the races of the global fastag:log/progress/done events lived.
// The mock backend sends Channel messages the way Rust does (an index per
// message), before, during and after the `run` reply.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { Channel } from '@tauri-apps/api/core'
import api from './api'
import { isSettled, runJob, type Job, type JobAction } from './runJob'
import type { ResolvedOutputs, RunEvent, RunStarted } from './types'
import runStarted from './testing/fixtures/run-started.json'

interface Internals {
  runCallback: (id: number, data: unknown) => void
}
const internals = (): Internals => (window as unknown as { __TAURI_INTERNALS__: Internals }).__TAURI_INTERNALS__

/// A run's Channel as the backend holds it: send() numbers the messages.
class Wire {
  next = 0
  constructor(readonly ch: Channel<RunEvent>) {}
  send(message: RunEvent, index = this.next++): void {
    internals().runCallback(this.ch.id, { index, message })
  }
}

const OUT = { out: '/d/a.tags.tsv', species_out: '/d/a.tags.species.tsv' }
const STARTED: RunStarted = { started: true, out: OUT.out, outputs: OUT, command: ['/bin/FASTag', '-in', '/d/a.mzML'] }
const DONE: RunEvent = { kind: 'done', ok: true, code: 0, message: null, cancelled: false, cleanup: { removed: [], renamed: [], failed: [] } }
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/// The backend: `run` hands its Channel to @p onRun and answers with what
/// onRun resolves to; `cancel` calls @p onCancel.
function backend(onRun: (w: Wire, args: Record<string, unknown>) => Promise<RunStarted>, onCancel?: () => void): void {
  mockIPC((cmd, args) => {
    const a = args as Record<string, unknown>
    if (cmd === 'run') return onRun(new Wire(a.onEvent as Channel<RunEvent>), a)
    if (cmd === 'cancel') {
      onCancel?.()
      return { cancelled: true }
    }
    throw new Error(`unexpected command ${cmd}`)
  })
}

function start(): { changes: [Job, JobAction][]; run: ReturnType<typeof runJob> } {
  const changes: [Job, JobAction][] = []
  const run = runJob(api, { in: '/d/a.mzML', out: 'a.tags.tsv', params: {} }, 'job-1', (j, a) => changes.push([j, a]))
  return { changes, run }
}

afterEach(() => clearMocks())

describe('api.run over a Channel of its own', () => {
  it('passes the params and a Channel to the run command', async () => {
    let got: Record<string, unknown> = {}
    backend(async (w, args) => {
      got = args
      w.send(DONE)
      return STARTED
    })
    const { run } = start()
    await run.settled
    expect(got.params).toEqual({ in: '/d/a.mzML', out: 'a.tags.tsv', params: {} })
    expect(got.onEvent).toBeInstanceOf(Channel)
  })

  it('done before started: the job has its result first, then settles with the outputs of the reply', async () => {
    let reply: (r: RunStarted) => void = () => {}
    backend(
      (w) =>
        new Promise<RunStarted>((resolve) => {
          w.send({ kind: 'log', lines: [['-threads 0: using 8 of 16 logical cores.', true], ['139 MS2 spectra, 2028 tags', false]] })
          w.send({ kind: 'phase', label: 'Reading spectra' })
          w.send(DONE)
          reply = resolve
        })
    )
    const { changes, run } = start()
    await tick()
    const before = run.job()
    // A defined state: finished, not yet replied, not settled.
    expect(before.status).toBe('ok')
    expect(before.replied).toBe(false)
    expect(before.outputs).toBeUndefined()
    expect(isSettled(before)).toBe(false)
    // The job counts its log lines; the lines reach onChange with their
    // action (from there the log store keeps them, the only copy).
    expect(before.logLines).toBe(2)
    expect(changes.flatMap(([, a]) => (a.type === 'EVENT' && a.event.kind === 'log' ? a.event.lines : []))).toEqual([
      ['-threads 0: using 8 of 16 logical cores.', true],
      ['139 MS2 spectra, 2028 tags', false]
    ])
    let settled = false
    void run.settled.then(() => (settled = true))
    await tick()
    expect(settled).toBe(false)
    reply(STARTED)
    const j = await run.settled
    expect(j.status).toBe('ok')
    expect(j.outputs).toEqual(OUT)
    expect(j.command).toEqual(STARTED.command)
    expect(j.result?.ok).toBe(true)
    expect(changes.map(([, a]) => (a.type === 'EVENT' ? a.event.kind : a.type))).toEqual(['log', 'phase', 'done', 'REPLY'])
  })

  // The contract with fastag.rs: the reply of `run` exactly as the backend
  // serialises it (cargo the_run_reply_names_every_output_by_its_option_name
  // compares it with this fixture), through the real invoke. Every output
  // reaches the job under the key the renderer reads.
  it('the reply as the backend sends it: every output reaches the job under the key the renderer reads', async () => {
    backend(async (w) => {
      w.send(DONE)
      return runStarted as RunStarted
    })
    const { run } = start()
    const j = await run.settled
    const o = j.outputs as ResolvedOutputs
    expect(o).toEqual(runStarted.outputs)
    const read: (keyof ResolvedOutputs)[] = ['out', 'species_out', 'digest_out', 'label_out', 'massgap_out', 'recon_out', 'delta_out', 'recon_id_out', 'glyco_out', 'out_spectra']
    for (const k of read) expect(o[k], k).toMatch(/^\/d\//)
    expect(Object.keys(o).sort()).toEqual([...read].sort())
  })

  it('late log after done: dropped, the job and its result unchanged', async () => {
    backend(async (w) => {
      w.send({ kind: 'log', lines: [['Reading spectra', true]] })
      w.send(DONE)
      w.send({ kind: 'log', lines: [['late', false]] })
      w.send({ kind: 'progress', done: 4, total: 4 })
      w.send({ kind: 'done', ok: false, code: 9, message: 'again', cancelled: false })
      return STARTED
    })
    const { changes, run } = start()
    const j = await run.settled
    await tick()
    expect(j.logLines).toBe(1)
    expect(changes.flatMap(([, a]) => (a.type === 'EVENT' && a.event.kind === 'log' ? a.event.lines : []))).toEqual([['Reading spectra', true]])
    expect(run.job()).toBe(j)
    expect(j.result).toMatchObject({ ok: true, code: 0 })
    expect(j.progress).toBeNull()
    expect(changes.filter(([, a]) => a.type === 'EVENT' && a.event.kind === 'done')).toHaveLength(1)
  })

  it('cancel during a phase without progress: the job ends cancelled, in that phase, with no progress', async () => {
    let wire: Wire | null = null
    // The kill's terminal event as Windows reports it: exit code 1 and no
    // cancelled flag (the kill raced the flag).
    const onCancel = vi.fn(() => wire?.send({ kind: 'done', ok: false, code: 1, message: 'exit code 1', cancelled: false }))
    backend(async (w) => {
      wire = w
      w.send({ kind: 'log', lines: [['-threads 0: using 8 of 16 logical cores.', true]] })
      w.send({ kind: 'phase', label: 'Reading spectra' })
      return STARTED
    }, onCancel)
    const { run } = start()
    await tick()
    expect(run.job()).toMatchObject({ status: 'running', phase: 'Reading spectra', progress: null })
    run.dispatch({ type: 'CANCEL_REQUESTED' })
    await api.cancel()
    const j = await run.settled
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(j.status).toBe('cancelled')
    expect(j.phase).toBe('Reading spectra')
    expect(j.progress).toBeNull()
    expect(j.outputs).toEqual(OUT)
  })

  it('delivers messages in the order the backend numbered them', async () => {
    backend(async (w) => {
      w.send({ kind: 'progress', done: 2, total: 4, ratePerSec: 10, etaSec: 0.2 }, 1)
      w.send({ kind: 'log', lines: [['first', true]] }, 0)
      w.send(DONE, 2)
      return STARTED
    })
    const { changes, run } = start()
    const j = await run.settled
    expect(changes.map(([, a]) => (a.type === 'EVENT' ? a.event.kind : a.type))).toEqual(['log', 'progress', 'done', 'REPLY'])
    expect(j.progress).toEqual({ done: 2, total: 4, ratePerSec: 10, etaSec: 0.2 })
  })

  it('done without outputs: an invoke that fails after Done settles the job with its result', async () => {
    backend(async (w) => {
      w.send(DONE)
      throw new Error('the window went away')
    })
    const { run } = start()
    const j = await run.settled
    expect(j.status).toBe('ok')
    expect(j.outputs).toBeUndefined()
  })

  it('a refused run settles failed with the reason, and a failed invoke with its error', async () => {
    backend(async () => ({ started: false, reason: 'a run is already in progress' }))
    let j = await start().run.settled
    expect(j.status).toBe('failed')
    expect(j.result?.message).toBe('a run is already in progress')
    backend(async () => {
      throw new Error('no such command')
    })
    j = await start().run.settled
    expect(j.status).toBe('failed')
    expect(j.result?.message).toContain('no such command')
  })
})
