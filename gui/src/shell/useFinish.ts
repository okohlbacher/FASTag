// The finish of a run or a batch (GUI-DESIGN 2 "Navigation rules", P2a PR
// s): a system notification when the window is in the background, and a
// toast that opens the results, unless they are already shown. A cancelled
// run neither notifies nor toasts. Every end bumps the History.

import { useEffect, useRef } from 'react'
import type { BatchEnd, LastRun } from '../run/useRun'
import { baseName } from '../digestReport'
import { duration } from '../app/format'
import type { Toast } from './Notices'

export interface FinishInputs {
  lastRun: LastRun | null
  // How the last batch pass ended (runReducer.ts BatchEnd).
  batchEnd: BatchEnd | null
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

export function useFinish({ lastRun, batchEnd, view, toast, ended }: FinishInputs): void {
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
  // A batch: what the pass ran, as runBatch counted it (a status diff
  // misses a Retry failed whose jobs fail again).
  const seenBatchEnd = useRef(batchEnd)
  useEffect(() => {
    if (batchEnd === seenBatchEnd.current) return
    seenBatchEnd.current = batchEnd
    if (!batchEnd || batchEnd.ran === 0) return
    if (batchEnd.cancelled) {
      ended()
      return
    }
    const { ran, failed } = batchEnd
    finished(
      failed ? `Batch done, ${failed} of ${ran} failed` : 'Batch finished',
      `${ran - failed} of ${ran} ${ran === 1 ? 'file' : 'files'} finished.`,
      'batch'
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchEnd])
}
