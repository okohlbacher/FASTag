// The History view (GUI-DESIGN 3 S9; the list of P2a PR s): one row per
// recorded run, newest first, from the backend's run record (history.rs).
// Re-run, Settings into form, Copy command and Delete record follow with the
// History PR.

import { useEffect, useState, type JSX } from 'react'
import type { RunRecord } from '../types'
import { baseName } from '../digestReport'
import { duration } from '../app/format'
import { JobIcon } from '../icons'

const STATUS: Record<RunRecord['status'], { text: string; icon: 'done' | 'failed' | 'cancelled' }> = {
  ok: { text: 'Finished', icon: 'done' },
  failed: { text: 'Failed', icon: 'failed' },
  cancelled: { text: 'Cancelled', icon: 'cancelled' }
}

export interface HistoryViewProps {
  // Shown: the list is read again each time the view opens, and after a run.
  active: boolean
  // Bumped when a run ends.
  version: number
  busy: boolean
  onOpenResults(): void
}

export default function HistoryView({ active, version, busy, onOpenResults }: HistoryViewProps): JSX.Element {
  const [records, setRecords] = useState<RunRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
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
  }, [active, version])

  return (
    <div className="history">
      <h2 id="history-h">History</h2>
      {error && (
        <p className="warn" role="alert">
          Could not read the run record: {error}
        </p>
      )}
      {records && records.length === 0 && (
        <div className="empty">
          <p>Runs you start appear here.</p>
          <button type="button" className="secondary" onClick={onOpenResults} disabled={busy}>
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
              <th scope="col">Outputs</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => {
              const st = STATUS[r.status]
              return (
                <tr key={r.id}>
                  <td>{new Date(r.start).toLocaleString()}</td>
                  <td title={r.input}>{baseName(r.input)}</td>
                  <td>
                    <span className={`hist-status ${r.status}`}>
                      <JobIcon status={st.icon} /> {st.text}
                      {r.status === 'failed' && r.exitCode != null ? ` (exit ${r.exitCode})` : ''}
                    </span>
                  </td>
                  <td>{duration(r.end - r.start)}</td>
                  <td>
                    {r.outputs.length === 0 ? (
                      <span className="muted">none</span>
                    ) : (
                      <span title={r.outputs.join('\n')}>{r.outputs.map(baseName).join(', ')}</span>
                    )}
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
