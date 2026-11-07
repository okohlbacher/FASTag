// The History view (GUI-DESIGN 3 S9, 6.5; the list of P2a PR s, the actions
// of PR h): one row per recorded run, newest first, from the backend's run
// record (history.rs). Each row offers Copy command (the argv the record
// keeps, which is the command line the run was started with), Settings into
// form (with Undo), Re-run (the recorded run again, with the parameters it
// was sent) and Delete record (the record only, never its files; asked
// first, and refused by the backend for a record that alone marks a file
// its run left behind as incomplete); a finished run also Open and Reveal.
// A run that did not finish is marked incomplete and offers neither: its
// outputs were removed, and one its cleanup could not remove opens as
// incomplete wherever it is opened.

import { useEffect, useRef, useState, type JSX } from 'react'
import type { RunRecord } from '../types'
import { baseName } from '../digestReport'
import { duration, shellLine } from '../app/format'
import { JobIcon } from '../icons'

const STATUS: Record<RunRecord['status'], { text: string; icon: 'done' | 'failed' | 'cancelled' }> = {
  ok: { text: 'Finished', icon: 'done' },
  failed: { text: 'Failed', icon: 'failed' },
  cancelled: { text: 'Cancelled', icon: 'cancelled' }
}

/// The tags file of @p r: the -out the CLI was given (absolute for a run the
/// GUI started; a relative one is joined to the run's folder), else its
/// first output.
export function recordOut(r: RunRecord): string | null {
  const i = r.argv.indexOf('-out')
  const p = i > 0 && i + 1 < r.argv.length ? r.argv[i + 1] : (r.outputs[0] ?? null)
  if (!p) return null
  const absolute = p.startsWith('/') || p.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(p)
  if (absolute || !r.cwd) return p
  const sep = r.cwd.includes('\\') && !r.cwd.includes('/') ? '\\' : '/'
  return `${r.cwd.replace(/[\\/]+$/, '')}${sep}${p.replace(/^\.[\\/]/, '')}`
}

// What the note under the heading says after an action.
type Note =
  | { kind: 'settings'; input: string; undo: () => void }
  | { kind: 'deleted'; input: string }
  | { kind: 'error'; text: string }

export interface HistoryViewProps {
  // Shown: the list is read again each time the view opens, and after a run.
  active: boolean
  // Bumped when a run ends.
  version: number
  busy: boolean
  onOpenResults(): void
  // Open a recorded run's tags file in Results.
  onOpen(path: string): void
  // Put a recorded run's input, output and parameters into the form;
  // returns the Undo.
  onSettings(input: string, out: string, params: Record<string, unknown>): () => void
  // Start the recorded run @p id again (useRun.rerun).
  onRerun(id: string): Promise<unknown>
  onGoSetup(): void
}

export default function HistoryView(p: HistoryViewProps): JSX.Element {
  const { active, version, busy } = p
  const [records, setRecords] = useState<RunRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The record whose command was copied (or refused by the clipboard).
  const [copied, setCopied] = useState<{ id: string; ok: boolean } | null>(null)
  const [note, setNote] = useState<Note | null>(null)
  const [reread, setReread] = useState(0)
  // The record whose Delete record asks for confirmation.
  const [confirming, setConfirming] = useState<string | null>(null)
  // Where keyboard focus goes once the list has re-rendered after a delete
  // (WCAG 2.4.3): a row's first action or its Delete record, else (the list
  // is empty) the heading.
  const [focusTo, setFocusTo] = useState<{ id: string | null; what: 'first' | 'delete' } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const keepRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!active) return
    let live = true
    window.fastag
      .historyList(200)
      .then((r) => {
        if (!live) return
        setRecords(r)
        setError(null)
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      live = false
    }
  }, [active, version, reread])

  useEffect(() => {
    if (confirming) keepRef.current?.focus()
  }, [confirming])

  useEffect(() => {
    if (!focusTo) return
    const row = focusTo.id ? rootRef.current?.querySelector(`tr[data-id="${CSS.escape(focusTo.id)}"]`) : null
    const target = row?.querySelector<HTMLElement>(focusTo.what === 'delete' ? '[data-action="delete"]' : 'button')
    ;(target ?? headingRef.current)?.focus()
    setFocusTo(null)
  }, [focusTo, records])

  const fail = (e: unknown): void => setNote({ kind: 'error', text: e instanceof Error ? e.message : String(e) })

  function copy(r: RunRecord): void {
    navigator.clipboard.writeText(shellLine(r.argv)).then(
      () => setCopied({ id: r.id, ok: true }),
      () => setCopied({ id: r.id, ok: false })
    )
  }

  function remove(r: RunRecord): void {
    // The row that takes its place: the next one, else the one before.
    const rs = records ?? []
    const i = rs.findIndex((x) => x.id === r.id)
    const next = rs[i + 1]?.id ?? rs[i - 1]?.id ?? null
    window.fastag.historyDelete(r.id).then(
      () => {
        setConfirming(null)
        setRecords((list) => list?.filter((x) => x.id !== r.id) ?? list)
        setNote({ kind: 'deleted', input: r.input })
        setFocusTo({ id: next, what: 'first' })
        setReread((n) => n + 1)
      },
      (e: unknown) => {
        // Kept (or the delete failed): the row stays, and so does focus.
        setConfirming(null)
        fail(e)
        setFocusTo({ id: r.id, what: 'delete' })
      }
    )
  }

  function keep(id: string): void {
    setConfirming(null)
    setFocusTo({ id, what: 'delete' })
  }

  function settings(r: RunRecord, out: string): void {
    const undo = p.onSettings(r.input, out, r.params ?? {})
    setNote({ kind: 'settings', input: r.input, undo })
  }

  return (
    <div className="history" ref={rootRef}>
      <h2 id="history-h" ref={headingRef} tabIndex={-1}>
        History
      </h2>
      <div className="history-note" role="status" aria-label="History">
        {note?.kind === 'settings' && (
          <>
            The settings of {baseName(note.input)} are in the form.{' '}
            <button
              type="button"
              className="link"
              onClick={() => {
                note.undo()
                setNote(null)
              }}
            >
              Undo
            </button>{' '}
            <button type="button" className="link" onClick={p.onGoSetup}>
              Go to Setup
            </button>
          </>
        )}
        {note?.kind === 'deleted' && <>The record of {baseName(note.input)} was deleted; its files were kept.</>}
        {note?.kind === 'error' && <span className="warn">{note.text}</span>}
      </div>
      {error && (
        <p className="warn" role="alert">
          Could not read the run record: {error}
        </p>
      )}
      {records && records.length === 0 && (
        <div className="empty">
          <p>Runs you start appear here.</p>
          <button type="button" className="secondary" onClick={p.onOpenResults} disabled={busy}>
            Open results…
          </button>
        </div>
      )}
      {records && records.length > 0 && (
        <table className="history-table" aria-label="Run history">
          <thead>
            <tr>
              <th scope="col">Started</th>
              <th scope="col">Input</th>
              <th scope="col">Status</th>
              <th scope="col">Duration</th>
              <th scope="col">Tags</th>
              <th scope="col">Outputs</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => {
              const st = STATUS[r.status]
              const out = recordOut(r)
              const finished = r.status === 'ok'
              return (
                <tr key={r.id} data-id={r.id}>
                  <td>{new Date(r.start).toLocaleString()}</td>
                  <td title={r.input}>{baseName(r.input)}</td>
                  <td>
                    <span className={`hist-status ${r.status}`}>
                      <JobIcon status={st.icon} /> {st.text}
                      {r.status === 'failed' && r.exitCode != null ? ` (exit ${r.exitCode})` : ''}
                    </span>
                    {!finished && (
                      <span className="hist-incomplete" title="This run did not finish: its outputs are not complete.">
                        incomplete
                      </span>
                    )}
                  </td>
                  <td>{duration(r.end - r.start)}</td>
                  <td className="num">{finished && r.tags != null ? r.tags.toLocaleString('en-US') : '—'}</td>
                  <td>
                    {r.outputs.length === 0 ? (
                      <span className="muted">none</span>
                    ) : (
                      <span title={r.outputs.join('\n')}>{r.outputs.map(baseName).join(', ')}</span>
                    )}
                  </td>
                  <td className="hist-actions">
                    {finished && out && (
                      <>
                        <button type="button" className="secondary small" disabled={busy} onClick={() => p.onOpen(out)}>
                          Open
                        </button>
                        <button
                          type="button"
                          className="secondary small"
                          onClick={() => window.fastag.revealOutput(out, false).catch(fail)}
                        >
                          Reveal
                        </button>
                      </>
                    )}
                    <button type="button" className="secondary small" onClick={() => copy(r)} title={shellLine(r.argv)}>
                      {copied?.id === r.id && copied.ok ? 'Copied' : 'Copy command'}
                    </button>
                    {r.params && out && (
                      <button type="button" className="secondary small" disabled={busy} onClick={() => settings(r, out)}>
                        Settings into form
                      </button>
                    )}
                    {r.params && out && (
                      <button
                        type="button"
                        className="secondary small"
                        disabled={busy}
                        onClick={() => void p.onRerun(r.id).catch(fail)}
                      >
                        Re-run
                      </button>
                    )}
                    {confirming === r.id ? (
                      <span
                        className="hist-confirm"
                        role="group"
                        aria-label="Delete this record?"
                        onKeyDown={(e) => {
                          if (e.key !== 'Escape') return
                          e.preventDefault()
                          keep(r.id)
                        }}
                      >
                        Delete this record? Its files stay.{' '}
                        <button type="button" className="danger small" onClick={() => remove(r)}>
                          Delete
                        </button>{' '}
                        <button type="button" className="secondary small" ref={keepRef} onClick={() => keep(r.id)}>
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="secondary small" data-action="delete" onClick={() => setConfirming(r.id)}>
                        Delete record
                      </button>
                    )}
                    {copied?.id === r.id && !copied.ok && <span className="muted">The clipboard refused the command.</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
