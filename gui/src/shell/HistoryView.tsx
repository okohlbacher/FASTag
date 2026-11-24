// The History view (GUI-DESIGN 3 S9, 6.5; the list of P2a PR s, the actions
// of PR h): one row per recorded run, newest first, from the backend's run
// record (history.rs). Each row offers Open (a finished run) and, under
// More (RowMenu), Copy command (the argv the record
// keeps, which is the command line the run was started with), Settings into
// form (with Undo), Re-run (the recorded run again, with the parameters it
// was sent) and Delete record (the record only, never its files; asked
// first, and refused by the backend for a record that alone marks a file
// its run left behind as incomplete); a finished run also Open and Reveal.
// A run that did not finish is marked incomplete and offers neither: its
// outputs were removed, and one its cleanup could not remove opens as
// incomplete wherever it is opened.

import { useEffect, useRef, useState, type JSX } from 'react'
import type { ResolvedOutputs, RunRecord } from '../types'
import { baseName } from '../digestReport'
import { PARAM_BY_NAME } from '../paramLayout'
import { dirName, stripExt } from '../app/paths'
import { duration, shellLine } from '../app/format'
import { JobIcon } from '../icons'
import PageHeader from './PageHeader'
import EmptyState from './EmptyState'
import RowMenu, { type RowMenuItem } from './RowMenu'

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

// The reports the CLI names from -out when on without a path of their own
// (outputs.rs DERIVED): the switch and the suffix.
const DERIVED: [keyof ResolvedOutputs, string, string][] = [
  ['species_out', 'species', '.species.tsv'],
  ['glyco_out', 'glyco', '.glyco.tsv'],
  ['census_out', 'census', '.census.tsv'],
  ['census_summary_out', 'census', '.census_summary.tsv']
]

/// Every output of the recorded run @p r by its option (ResolvedOutputs),
/// its tags at @p out: each output option it was sent, a relative path as
/// the record lists it (else beside the tags), and the reports the CLI
/// derives from -out. A file gone since is named by Results (showResults).
export function recordOutputs(r: RunRecord, out: string): ResolvedOutputs {
  const params = r.params ?? {}
  const o: ResolvedOutputs = { out }
  const absolute = (p: string): boolean => p.startsWith('/') || p.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(p)
  const place = (p: string): string => {
    if (absolute(p)) return p
    const bare = p.replace(/^\.[\\/]/, '')
    return r.outputs.find((x) => x.endsWith(`/${bare}`) || x.endsWith(`\\${bare}`)) ?? `${dirName(out)}${bare}`
  }
  for (const [name, spec] of PARAM_BY_NAME) {
    if (spec.type !== 'output-file') continue
    const v = params[name]
    if (typeof v === 'string' && v.trim()) (o as unknown as Record<string, string>)[name] = place(v.trim())
  }
  for (const [key, on, suffix] of DERIVED) {
    if (params[on] !== true || o[key]) continue
    o[key] = r.outputs.find((x) => x.endsWith(suffix)) ?? `${stripExt(out)}${suffix}`
  }
  return o
}

// What the note under the heading says after an action. Clipboard feedback
// is kept apart (Copied), so a Copy command never drops the Undo of an
// earlier Settings into form.
type Note =
  | { kind: 'settings'; input: string; undo: () => void }
  | { kind: 'deleted'; input: string }
  | { kind: 'error'; text: string }

// What Copy command said: copied, or refused by the clipboard.
interface Copied {
  input: string
  ok: boolean
}

export interface HistoryViewProps {
  // Shown: the list is read again each time the view opens, and after a run.
  active: boolean
  // Bumped when a run ends.
  version: number
  busy: boolean
  onOpenResults(): void
  // Open a recorded run in Results: its tags, its reports and its
  // workflow's views (@p out: its tags file).
  onOpen(r: RunRecord, out: string): void
  // Put a recorded run's input, output and parameters into the form;
  // returns the Undo.
  // @p workflow: the run's own (RunRecord.workflow), null for a record
  // made before workflows were recorded.
  onSettings(input: string, out: string, params: Record<string, unknown>, workflow?: string | null): () => void
  // Start the recorded run @p id again (useRun.rerun).
  onRerun(id: string): Promise<unknown>
  onGoSetup(): void
}

/// A file name split for a narrow cell: the stem, cut with an ellipsis, and
/// its extensions, kept (run01.digest.tsv: "run01" + ".digest.tsv"), so the
/// outputs of one run stay apart when their stems are cut.
export function splitName(name: string): { stem: string; ext: string } {
  const m = /(\.[A-Za-z][\w-]{0,15}){1,2}$/.exec(name)
  if (!m || m.index === 0) return { stem: name, ext: '' }
  return { stem: name.slice(0, m.index), ext: m[0] }
}

/// The base name of @p path on one line, its full path on hover.
function FileName({ path }: { path: string }): JSX.Element {
  const { stem, ext } = splitName(baseName(path))
  return (
    <span className="hist-name" title={path}>
      <span className="hist-stem">{stem}</span>
      {ext && <span className="hist-ext">{ext}</span>}
    </span>
  )
}

/// The most runs the view lists (the newest first).
const HISTORY_LIMIT = 200

export default function HistoryView(p: HistoryViewProps): JSX.Element {
  const { active, version, busy } = p
  const [records, setRecords] = useState<RunRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNoteOnly] = useState<Note | null>(null)
  const [copied, setCopied] = useState<Copied | null>(null)
  // A new note replaces the copy feedback too; a copy leaves the note.
  const setNote = (n: Note | null): void => {
    setNoteOnly(n)
    setCopied(null)
  }
  const [reread, setReread] = useState(0)
  // The record whose Delete record asks for confirmation.
  const [confirming, setConfirming] = useState<string | null>(null)
  // Where keyboard focus goes once the list has re-rendered after a delete
  // (WCAG 2.4.3): a row's first action or its More (where Delete record
  // is), else (the list is empty) the heading.
  const [focusTo, setFocusTo] = useState<{ id: string | null; what: 'first' | 'more' } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const keepRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!active) return
    let live = true
    window.fastag
      .historyList(HISTORY_LIMIT)
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
    const target = row?.querySelector<HTMLElement>(focusTo.what === 'more' ? '[data-action="more"]' : 'button')
    ;(target ?? rootRef.current?.querySelector<HTMLElement>('#history-h'))?.focus()
    setFocusTo(null)
  }, [focusTo, records])

  const fail = (e: unknown): void => setNote({ kind: 'error', text: e instanceof Error ? e.message : String(e) })

  function copy(r: RunRecord): void {
    // Said in the note: the item that did it is gone with the menu.
    navigator.clipboard.writeText(shellLine(r.argv)).then(
      () => setCopied({ input: r.input, ok: true }),
      () => setCopied({ input: r.input, ok: false })
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
        setFocusTo({ id: r.id, what: 'more' })
      }
    )
  }

  function keep(id: string): void {
    setConfirming(null)
    setFocusTo({ id, what: 'more' })
  }

  function settings(r: RunRecord, out: string): void {
    const undo = p.onSettings(r.input, out, r.params ?? {}, r.workflow ?? null)
    setNote({ kind: 'settings', input: r.input, undo })
  }

  // What More lists for @p r (RowMenu), in this order; Delete record last,
  // apart.
  function rowItems(r: RunRecord, out: string | null, finished: boolean): RowMenuItem[] {
    const items: RowMenuItem[] = []
    if (finished && out) items.push({ label: 'Reveal', onSelect: () => void window.fastag.revealOutput(out, false).catch(fail) })
    items.push({ label: 'Copy command', title: shellLine(r.argv), onSelect: () => copy(r) })
    if (r.params && out) {
      items.push({ label: 'Settings into form', disabled: busy, onSelect: () => settings(r, out) })
      items.push({ label: 'Re-run', disabled: busy, onSelect: () => void p.onRerun(r.id).catch(fail) })
    }
    items.push({ label: 'Delete record', action: 'delete', separatorBefore: true, onSelect: () => setConfirming(r.id) })
    return items
  }

  return (
    <div className="history page-col" ref={rootRef}>
      <PageHeader
        title="History"
        titleId="history-h"
        focusable
        context="Earlier runs: open their results, or load their settings into Setup."
        actions={
          <button type="button" className="secondary" onClick={p.onOpenResults} disabled={busy}>
            Open results…
          </button>
        }
      />
      <div className="page-body">
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
        {copied && (
          <span className="history-copied">
            {note && ' '}
            {copied.ok ? (
              <>Copied the command of {baseName(copied.input)}.</>
            ) : (
              <span className="warn">The clipboard refused the command.</span>
            )}
          </span>
        )}
      </div>
      {error && (
        <p className="warn" role="alert">
          Could not read the run record: {error}
        </p>
      )}
      {records && records.length === 0 && <EmptyState title="No runs yet">Runs you start appear here.</EmptyState>}
      {records && records.length >= HISTORY_LIMIT && (
        <p className="hint" role="note">
          The latest {HISTORY_LIMIT} runs are listed; older ones stay in the history file.
        </p>
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
                  <td className="hist-input">
                    <FileName path={r.input} />
                  </td>
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
                  <td className="hist-outputs">
                    {r.outputs.length === 0 ? (
                      <span className="muted">none</span>
                    ) : (
                      <ul aria-label="Outputs">
                        {r.outputs.map((o) => (
                          <li key={o}>
                            <FileName path={o} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="hist-actions">
                    <div className="hist-actions-row">
                      {finished && out && (
                        <button type="button" className="secondary small" disabled={busy} onClick={() => p.onOpen(r, out)}>
                          Open
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
                        <RowMenu label={`More actions for ${baseName(r.input)}`} items={rowItems(r, out, finished)} />
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      </div>
    </div>
  )
}
