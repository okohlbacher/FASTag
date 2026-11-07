// The run log drawer (moved from App.tsx, P1 PR c).

import { useEffect, type JSX, type RefObject } from 'react'
import { baseName } from '../digestReport'

// The log drawer renders only its last LOG_WINDOW lines (GUI-DESIGN P1):
// with all 5,000 lines in the DOM, a log line with the drawer open cost
// 12.8 ms (median; 104 ms at p95, GUI-DESIGN 7). The full log is kept, and
// the drawer header counts it.
export const LOG_WINDOW = 500

export interface LogDrawerProps {
  // The log shown: the live log, or the kept log of a batch job.
  log: string[]
  // The live log: the drawer scrolls to its end as it grows.
  live: string[]
  open: boolean
  // The batch job whose log is shown; none: the live log.
  job: string | undefined
  onToggle(): void
  onShowLive(): void
  logRef: RefObject<HTMLPreElement | null>
}

export default function LogDrawer({ log, live, open, job, onToggle, onShowLive, logRef }: LogDrawerProps): JSX.Element {
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [live, logRef])

  // The lines in the DOM: the last LOG_WINDOW.
  const hiddenLines = Math.max(0, log.length - LOG_WINDOW)
  const windowLog = hiddenLines ? log.slice(hiddenLines) : log
  const lastLog = [...log].reverse().find((l) => l.trim() !== '') ?? ''

  return (
    <section className={`logdrawer${open ? ' open' : ''}`} aria-label="Run log">
      <button className="drawer-toggle" aria-expanded={open} aria-controls="runlog" onClick={onToggle}>
        <span className={`chev ${open ? 'open' : ''}`} aria-hidden="true">▸</span>
        <span className="lbl">{job ? `Log of ${baseName(job)}` : 'Log'}</span>
        <code className="last">{lastLog || 'Log output appears here.'}</code>
        <span className="n">
          {log.length} {log.length === 1 ? 'line' : 'lines'}
        </span>
      </button>
      {job && open && (
        <button type="button" className="link live-log" onClick={onShowLive}>
          Show the current log
        </button>
      )}
      {/* role=log is a polite live region while the drawer is open; a
          collapsed one is display:none and announces nothing, so the
          run bar's status says when a run starts and ends. Focusable,
          so the keyboard can scroll it. */}
      <pre id="runlog" className="log" ref={logRef} role="log" aria-label="Run log" tabIndex={0} hidden={!open}>
        {log.length ? windowLog.join('\n') : 'Log output appears here.'}
      </pre>
      {open && hiddenLines > 0 && (
        <p className="log-window">
          Showing the last {LOG_WINDOW.toLocaleString('en-US')} of {log.length.toLocaleString('en-US')} lines.
        </p>
      )}
    </section>
  )
}
