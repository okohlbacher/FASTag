// The run log drawer (moved from App.tsx, P1 PR c). It reads the log from
// the job's log store (P2a PR r), so a Log batch re-renders the drawer and
// nothing else.

import { useEffect, type JSX, type RefObject } from 'react'
import { baseName } from '../digestReport'
import { createLogStore, useLog, type LogStore } from './logStore'
import { disclosure } from '../disclosure'

// The log drawer renders only its last LOG_WINDOW lines (GUI-DESIGN P1):
// with all 5,000 lines in the DOM, a log line with the drawer open cost
// 12.8 ms (median; 104 ms at p95, GUI-DESIGN 7). The full log is kept, and
// the drawer header counts it.
export const LOG_WINDOW = 500

// The window is drawn in chunks of LOG_CHUNK lines, numbered by line (P2a
// PR r): a chunk keeps its lines and its DOM node while the log grows, so a
// new line changes only the last chunk. Laying out 500 new lines in one text
// node cost 1.6 ms in Chromium on its own, against the < 1 ms per 500-line
// batch of GUI-DESIGN 7. Only the last chunk, where the drawer is scrolled
// to, is laid out at once; the others are content-visibility: auto
// (index.css .log-chunk.far): the browser lays them out when they come into
// view and skips them while off screen. Fewer, larger chunks are cheaper in
// WebKit, which pays per element (20-line chunks: 1.1-1.3 ms per batch; 50:
// 0.7-0.9 ms), and a second eager chunk cost 0.3 ms there. index.css sizes
// a chunk not yet laid out by this number of lines.
export const LOG_CHUNK = 50

// What the drawer follows when the shown log is the live one.
const NO_LOG = createLogStore()

interface Chunk {
  key: number
  text: string
}

// The last LOG_WINDOW lines of @p log in chunks. @p total counts the lines
// appended since the store's reset, so log[i] is line total - log.length + i.
// Each chunk but the last ends with its newline: the log's text is the
// lines joined by newlines, as one text node had it.
function chunksOf(log: readonly string[], total: number): Chunk[] {
  const base = total - log.length
  const out: Chunk[] = []
  for (let i = Math.max(0, log.length - LOG_WINDOW); i < log.length; ) {
    const key = Math.floor((base + i) / LOG_CHUNK)
    const end = Math.min(log.length, (key + 1) * LOG_CHUNK - base)
    out.push({ key, text: log.slice(i, end).join('\n') + (end < log.length ? '\n' : '') })
    i = end
  }
  return out
}

export interface LogDrawerProps {
  // The log shown: the live log, or the kept log of a batch job.
  log: LogStore
  // The live log: the drawer scrolls to its end as it grows.
  live: LogStore
  open: boolean
  // The batch job whose log is shown; none: the live log.
  job: string | undefined
  onToggle(): void
  onShowLive(): void
  logRef: RefObject<HTMLPreElement | null>
}

// The last line with text in it, for the shut drawer's header.
function lastText(log: readonly string[]): string {
  for (let i = log.length - 1; i >= 0; i--) if (log[i].trim() !== '') return log[i]
  return ''
}

export default function LogDrawer({ log: logStore, live: liveStore, open, job, onToggle, onShowLive, logRef }: LogDrawerProps): JSX.Element {
  const shown = useLog(logStore)
  const { lines: log, total } = shown
  // The live log, when another is shown (one subscription when it is the
  // one shown).
  const other = useLog(liveStore === logStore ? NO_LOG : liveStore)
  const live = liveStore === logStore ? shown : other
  // Scrolled to the end as the live log grows, once per frame however many
  // Log messages the frame brings.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
    })
    return () => cancelAnimationFrame(id)
  }, [live, logRef])

  // The lines in the DOM: the last LOG_WINDOW.
  const hiddenLines = Math.max(0, log.length - LOG_WINDOW)
  const chunks = chunksOf(log, total)
  // The last chunk is laid out at once.
  const eagerFrom = chunks.length ? chunks[chunks.length - 1].key : 0
  const lastLog = lastText(log)

  // A native <details> (P5) inside the "Run log" region: the summary is the
  // header, the log its body.
  const d = disclosure(open, onToggle)
  return (
    <section className={`logdrawer${open ? ' open' : ''}`} aria-label="Run log">
      <details className="drawer" {...d.details}>
        <summary className="drawer-toggle" aria-controls="runlog" {...d.summary}>
          <span className={`chev ${open ? 'open' : ''}`} aria-hidden="true">▸</span>
          <span className="lbl">{job ? `Log of ${baseName(job)}` : 'Log'}</span>
          <code className="last">{lastLog || 'Log output appears here.'}</code>
          <span className="n">
            {log.length} {log.length === 1 ? 'line' : 'lines'}
          </span>
        </summary>
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
          {log.length
            ? chunks.map((c) => (
                <span key={c.key} className={c.key < eagerFrom ? 'log-chunk far' : 'log-chunk'}>
                  {c.text}
                </span>
              ))
            : 'Log output appears here.'}
        </pre>
        {open && hiddenLines > 0 && (
          <p className="log-window">
            Showing the last {LOG_WINDOW.toLocaleString('en-US')} of {log.length.toLocaleString('en-US')} lines.
          </p>
        )}
      </details>
    </section>
  )
}
