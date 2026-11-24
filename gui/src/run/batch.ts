// A batch job as the queue's list shows it (runReducer.ts queueView) and the
// queue's naming of its outputs (moved from App.tsx, P1 PR c).

import type { ResolvedOutputs } from '../types'
import type { JobStatus } from '../icons'
import { defaultOut } from '../app/paths'
import { baseName } from '../digestReport'
import { duration } from '../app/format'
import type { LogStore } from './logStore'
import type { Refusal } from '../inspector/checks'

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
  // A failed job FASTag refused (raw DIA, exit 11): the conversion to run
  // first, shown beside the job in the queue.
  refusal?: Refusal
}

// Folder @p dir with a trailing separator, its own: a Windows folder has no '/'.
export function folderPath(dir: string): string {
  if (/[/\\]$/.test(dir)) return dir
  return dir + (dir.includes('/') || !dir.includes('\\') ? '/' : '\\')
}

// The -out a job of @p input writes: beside the input, or in @p outDir (the
// batch's output folder, for inputs on a read-only share), by the input's
// name. @p n numbers a collision (1: the full input name, 2..: numbered).
export function jobOut(input: string, outDir: string | null, n = 0): string {
  const cut = Math.max(input.lastIndexOf('/'), input.lastIndexOf('\\')) + 1
  const name = input.slice(cut)
  const dir = outDir ? folderPath(outDir) : input.slice(0, cut)
  if (n === 0) return outDir ? `${dir}${baseName(defaultOut(name))}` : defaultOut(input)
  return n === 1 ? `${dir}${name}.tags.tsv` : `${dir}${name}.${n}.tags.tsv`
}

// A path as a case-insensitive volume compares it (the default macOS and
// Windows volumes): sample.tags.tsv and SAMPLE.tags.tsv are one file there.
export const pathKey = (p: string): string => p.replace(/\\/g, '/').toLowerCase()

// The first of @p input's names (jobOut) that no other job uses, compared
// case-insensitively (@p used holds pathKey()s).
function freeOut(input: string, outDir: string | null, used: Set<string>): string {
  // sample.mzML and sample.mzpeak both map to sample.tags.tsv — on a
  // collision keep the full input name, then number, so outputs stay
  // distinct even when the fallback collides too.
  let out = jobOut(input, outDir)
  if (used.has(pathKey(out))) out = jobOut(input, outDir, 1)
  for (let n = 2; used.has(pathKey(out)); n++) out = jobOut(input, outDir, n)
  used.add(pathKey(out))
  return out
}

/// The outputs two or more jobs of a batch would write (compared as
/// pathKey does), from each job's resolved outputs: the later job would
/// overwrite the earlier one's results while both show Done.
export function sharedOutputs(outputs: string[][]): string[] {
  const first = new Map<string, number>()
  const shared = new Set<string>()
  outputs.forEach((os, i) => {
    for (const o of new Set(os.map(pathKey))) {
      const j = first.get(o)
      if (j === undefined) first.set(o, i)
      else if (j !== i) shared.add(o)
    }
  })
  return outputs.flat().filter((o, k, all) => shared.has(pathKey(o)) && all.findIndex((x) => pathKey(x) === pathKey(o)) === k)
}

// The queue with @p files added: an input already queued is skipped. Their
// outputs go to @p outDir when the batch has an output folder.
export function addJobs(js: BatchJob[], files: string[], outDir: string | null = null): BatchJob[] {
  const have = new Set(js.map((j) => j.input))
  const used = new Set(js.map((j) => pathKey(j.out)))
  const add: BatchJob[] = []
  for (const f of files) {
    if (have.has(f)) continue
    have.add(f)
    add.push({ input: f, out: freeOut(f, outDir, used), status: 'queued' as const })
  }
  return [...js, ...add]
}

// The queue after the output folder became @p outDir (null: beside each
// input): a done or running job keeps the -out it wrote or writes; every
// other job is named again, in queue order.
export function renameJobs(js: BatchJob[], outDir: string | null): BatchJob[] {
  const keep = (j: BatchJob): boolean => j.status === 'done' || j.status === 'running'
  const used = new Set(js.filter(keep).map((j) => pathKey(j.out)))
  return js.map((j) => (keep(j) ? j : { ...j, out: freeOut(j.input, outDir, used) }))
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
