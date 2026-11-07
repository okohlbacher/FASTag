// The finish of a run or a batch (GUI-DESIGN 2 "Navigation rules", P2a PR
// s): a system notification when the window is in the background, and a
// toast that opens the results, unless they are already shown. A cancelled
// run neither notifies nor toasts. Every end bumps the History.

import { useEffect, useRef } from 'react'
import type { LastRun } from '../run/useRun'
import type { BatchJob } from '../run/batch'
import { baseName } from '../digestReport'
import { duration } from '../app/format'
import type { Toast } from './Notices'

export interface FinishInputs {
  lastRun: LastRun | null
  batchRunning: boolean
  jobs: BatchJob[]
  // The view shown now.
  view(): string
  toast(t: Toast): void
  // A run ended: the History reads the record again.
  ended(): void
}

function notify(title: string, body: string): void {
  if (typeof document.hasFocus !== 'function' || document.hasFocus()) return
  // A notification that cannot be shown (no permission, no daemon) is not
  // an error of the run: the toast still says it.
  try {
    void Promise.resolve(window.fastag.notify(title, body)).catch(() => {})
  } catch {
    // A bridge without notify.
  }
}

export function useFinish({ lastRun, batchRunning, jobs, view, toast, ended }: FinishInputs): void {
  const finished = (title: string, body: string, to: Toast['to']): void => {
    ended()
    notify(title, body)
    if (view() !== to) toast({ text: title, to })
  }
  const seenLastRun = useRef(lastRun)
  useEffect(() => {
    if (lastRun === seenLastRun.current) return
    seenLastRun.current = lastRun
    if (!lastRun || lastRun.earlier) return
    if (lastRun.cancelled) {
      ended()
      return
    }
    const name = baseName(lastRun.input)
    finished(
      lastRun.ok ? `${name} finished` : `${name} failed`,
      lastRun.ok ? `Finished in ${duration(lastRun.ms)}.` : 'The run failed; see its log.',
      'results'
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastRun])
  // A batch: what its jobs were when it started, to tell what it ran.
  const batchStart = useRef<Map<string, string> | null>(null)
  useEffect(() => {
    if (batchRunning) {
      batchStart.current = new Map(jobs.map((j) => [j.input, j.status]))
      return
    }
    const before = batchStart.current
    batchStart.current = null
    if (!before) return
    const ran = jobs.filter((j) => j.status !== before.get(j.input))
    if (ran.length === 0) return
    if (ran.some((j) => j.status === 'cancelled')) {
      ended()
      return
    }
    const failed = ran.filter((j) => j.status === 'failed').length
    finished(
      failed ? `Batch done, ${failed} of ${ran.length} failed` : 'Batch finished',
      `${ran.length - failed} of ${ran.length} ${ran.length === 1 ? 'file' : 'files'} finished.`,
      'batch'
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchRunning])
}
