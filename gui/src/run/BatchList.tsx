// The batch queue (moved from App.tsx, P1 PR c).

import type { JSX, RefObject } from 'react'
import { useRef } from 'react'
import { baseName } from '../digestReport'
import { IconClose, JobIcon } from '../icons'
import { HelpLink } from '../help/HelpLink'
import { focusLater } from '../app/focus'
import { jobWords, type BatchJob } from './batch'
import type { Results } from './useRun'

export interface BatchListProps {
  jobs: BatchJob[]
  busy: boolean
  // The table the Tags tab shows: its job's row is marked.
  results: Results | null
  // The batch job whose log the drawer shows; null: the live log.
  logJob: string | null
  logOpen: boolean
  onAdd(): void
  onClear(): void
  onRemove(index: number): void
  onShow(job: BatchJob): void
  onLog(input: string): void
  // The form's "Add files for a batch…", where focus goes when the queue is
  // cleared.
  addBatchRef: RefObject<HTMLButtonElement | null>
}

export default function BatchList(p: BatchListProps): JSX.Element {
  const { jobs, busy, results, logOpen, addBatchRef } = p
  const addRef = useRef<HTMLButtonElement>(null)
  // The drawer shows the kept log of this job.
  const logJobEntry = p.logJob ? jobs.find((j) => j.input === p.logJob && j.log) : undefined
  return (
    <section className="block" aria-labelledby="batch-label">
      <div className="block-head">
        <h2 id="batch-label">
          Batch · {jobs.length} {jobs.length === 1 ? 'file' : 'files'}
        </h2>
        <span className="count">
          {jobs.filter((j) => j.status === 'done').length}/{jobs.length} done
        </span>
        {!busy && (
          <>
            <button className="secondary small" ref={addRef} onClick={p.onAdd}>
              Add…
            </button>
            <button
              className="secondary small"
              onClick={() => {
                p.onClear()
                focusLater(() => addBatchRef.current)
              }}
            >
              Clear
            </button>
          </>
        )}
      </div>
      {/* Focusable: while a batch runs nothing in it is, and it scrolls. */}
      <ul className="jobs" tabIndex={0} aria-labelledby="batch-label">
        {jobs.map((j, i) => {
          const body = (
            <>
              <span className="jn" title={j.input}>
                {baseName(j.input)}
              </span>
              <span className="js">{jobWords(j)}</span>
            </>
          )
          const shown = j.status === 'done' && results?.input === j.input && results.path === (j.outputs?.out ?? j.out)
          return (
            <li key={j.input} className={`job ${j.status}${shown ? ' shown' : ''}`}>
              <span className="st" role="img" aria-label={j.status} title={j.reason ?? j.status}>
                <JobIcon status={j.status} />
              </span>
              {j.status === 'done' && !busy ? (
                // A done job's tags and reports are one click away.
                <button
                  type="button"
                  className="jbody pick"
                  aria-current={shown || undefined}
                  title={`Show the results of ${j.input}`}
                  onClick={() => p.onShow(j)}
                >
                  {body}
                </button>
              ) : (
                <span className="jbody">{body}</span>
              )}
              {j.log && (
                // This job's own log, also once later jobs have run.
                <button
                  type="button"
                  className="jlog"
                  aria-label={`Log of ${baseName(j.input)}`}
                  aria-pressed={logJobEntry === j && logOpen}
                  title={`Show the log of ${j.input}`}
                  onClick={() => p.onLog(j.input)}
                >
                  Log
                </button>
              )}
              {!busy && (
                <button
                  className="rm"
                  title="Remove"
                  aria-label={`Remove ${j.input}`}
                  onClick={() => {
                    p.onRemove(i)
                    // The next job's remove button, else the previous one's,
                    // else whichever Add button the form then shows.
                    focusLater(() => {
                      const rms = document.querySelectorAll<HTMLButtonElement>('ul.jobs button.rm')
                      return rms[Math.min(i, rms.length - 1)] ?? addRef.current ?? addBatchRef.current
                    })
                  }}
                >
                  <IconClose />
                </button>
              )}
            </li>
          )
        })}
      </ul>
      <p className="hint">
        Each file writes its own <code>&lt;name&gt;.tags.tsv</code> and reports next to the input.{' '}
        <HelpLink to="start-batch">About batch runs</HelpLink>
      </p>
    </section>
  )
}
