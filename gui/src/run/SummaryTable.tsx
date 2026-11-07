// The batch summary table (GUI-DESIGN 3 S6, 10 P2b): one row per job with
// the calls FASTag made for it, ≠ where a call differs from its column's
// majority (batchSummary.ts: at least 3 calls, more than half), and the
// summary TSV export, which writes the table's text.

import { useState, type JSX } from 'react'
import { dirName } from '../app/paths'
import { folderPath } from './batch'
import { COLUMN_LABEL, majorityWords, MIN_CALLS, SUMMARY_COLUMNS, summaryTsv, type Summary } from './batchSummary'

export interface SummaryTableProps {
  summary: Summary
  busy: boolean
  // The batch's output folder, where the export is offered first.
  outDir: string | null
  // A done job's results, in Results.
  onShow(input: string): void
}

const count = (n: number | null): string => (n == null ? '—' : n.toLocaleString('en-US'))

export default function SummaryTable({ summary, busy, outDir, onShow }: SummaryTableProps): JSX.Element {
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  // Each cell's cutoff or caveat: always in the cell's text for a screen
  // reader, shown under its value on request (they make rows tall).
  const [showNotes, setShowNotes] = useState(false)
  const { rows } = summary

  async function exportTsv(): Promise<void> {
    setNote(null)
    const dir = outDir ? folderPath(outDir) : rows[0] ? dirName(rows[0].input) : ''
    const dest = await window.fastag.saveFile(`${dir}batch-summary.tsv`, ['tsv'])
    if (!dest) return
    try {
      await window.fastag.writeSummary(dest, summaryTsv(summary))
      setNote({ ok: true, text: `Summary of ${rows.length} ${rows.length === 1 ? 'job' : 'jobs'} written to ${dest}.` })
    } catch (e) {
      setNote({ ok: false, text: `Could not write the summary: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  return (
    <section className="block batch-table" aria-labelledby="sum-h">
      <div className="block-head">
        {/* Focusable: focus lands here when a batch pass ends (App.tsx). */}
        <h2 id="sum-h" tabIndex={-1}>
          Summary
        </h2>
        <button type="button" className="secondary small" aria-pressed={showNotes} onClick={() => setShowNotes((v) => !v)}>
          Show cutoffs and caveats
        </button>
        <button type="button" className="secondary small" onClick={() => void exportTsv()} disabled={rows.length === 0}>
          Export summary TSV…
        </button>
      </div>
      <div className="summary-wrap" tabIndex={0} role="group" aria-label="Batch summary table">
        <table className="summary-table">
          <caption className="sr-only">Batch summary · {rows.length} {rows.length === 1 ? 'job' : 'jobs'}</caption>
          <thead>
            <tr>
              <th scope="col">File</th>
              <th scope="col">Status</th>
              <th scope="col" className="num">
                Tags
              </th>
              {SUMMARY_COLUMNS.map((k) => (
                <th scope="col" key={k}>
                  {COLUMN_LABEL[k]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.input} className={`st-${r.status}`}>
                <td data-text={r.file} title={r.input}>
                  {r.canOpen && !busy ? (
                    <button type="button" className="link" aria-label={`Open ${r.file} in Results`} title={r.input} onClick={() => onShow(r.input)}>
                      {r.file}
                    </button>
                  ) : (
                    r.file
                  )}
                </td>
                <td data-text={r.statusText} className="status" title={r.statusText}>
                  {r.statusText}
                </td>
                <td data-text={count(r.tags)} className="num">
                  {count(r.tags)}
                </td>
                {SUMMARY_COLUMNS.map((k) => {
                  const c = r.cells[k]
                  const differs = r.differs[k]
                  return (
                    <td key={k} data-text={c.text} className={`call-cell ${c.call != null ? 'called' : 'muted'}${differs ? ' differs' : ''}`}>
                      <span className="cell-value">{c.text}</span>
                      {differs && (
                        <>
                          <span className="flag-mark" aria-hidden="true">
                            {' '}≠
                          </span>
                          <span className="sr-only"> differs from the majority {summary.majority[k].value}</span>
                        </>
                      )}
                      {/* Its cutoff or caveat, not only on hover: every call names it. */}
                      {c.note && (
                        <span className={showNotes ? 'cell-note' : 'sr-only'}>
                          <span className="sr-only">; </span>
                          {c.note}
                        </span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={3}>
                Majority (n ≥ {MIN_CALLS} calls)
              </th>
              {SUMMARY_COLUMNS.map((k) => (
                <td key={k}>{majorityWords(summary.majority[k])}</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      {note && (
        <p className={note.ok ? 'hint' : 'hint note-flag'} role={note.ok ? 'status' : 'alert'}>
          {note.text}
        </p>
      )}
      <p className="hint">
        ≠: the call differs from the majority of its column, which needs at least {MIN_CALLS} jobs with a call and more than half of
        them. A no call, too little evidence, a ranking and a job without reports never count. Not validated: these are the calls
        FASTag wrote; each cell's cutoff or caveat is read with it by a screen reader and shown under it with Show cutoffs and caveats,
        as the run's Overview states them.
      </p>
    </section>
  )
}
