// The Batch view's SDRF comparison (GUI-DESIGN 3 S6, 10 P4): load the
// project's SDRF, see each job against its SDRF rows field by field
// (compare.ts), and export the mismatches as a corrections TSV. The SDRF
// is never rewritten: the export refuses the SDRF's own path, here and in
// the backend (report.rs write_summary's protect list).

import { useState, type JSX } from 'react'
import { dirName } from '../app/paths'
import { baseName } from '../digestReport'
import { folderPath } from '../run/batch'
import { correctionsTsv, FIELD_LABEL, FIELDS, type FieldResult, type FieldState, type JobComparison } from './compare'
import type { SdrfState } from './useSdrf'

/// A path as compared with another: separators unified, repeated and
/// trailing ones dropped, "." segments gone, case aside (macOS and Windows
/// file names are case-insensitive by default).
export function samePath(a: string, b: string): boolean {
  const norm = (p: string): string =>
    p
      .replace(/\\/g, '/')
      .split('/')
      .filter((s, i) => s !== '.' && (s !== '' || i === 0))
      .join('/')
      .toLowerCase()
  return norm(a) === norm(b)
}

export interface SdrfPanelProps {
  sdrf: SdrfState
  busy: boolean
  outDir: string | null
  onShow(input: string): void
}

/// The mark and word of a field's state, as the table and its legend show them.
export const STATE_WORDS: Record<FieldState, { mark: string; word: string }> = {
  match: { mark: '✓', word: 'consistent' },
  genus: { mark: '✓', word: 'consistent at genus' },
  mismatch: { mark: '✗', word: 'differs' },
  setting_differs: { mark: '≠', word: 'run setting differs' },
  no_call: { mark: '–', word: 'no call' },
  no_sdrf: { mark: '–', word: 'not in the SDRF' },
  not_checkable: { mark: '?', word: 'not checkable' }
}

/// A field cell's text: its state, then FASTag's value against the SDRF's.
export function fieldText(r: FieldResult): string {
  const s = STATE_WORDS[r.state]
  const vs = r.state === 'no_sdrf' ? '' : [r.fastag && `FASTag ${r.fastag}`, r.sdrf && `SDRF ${r.sdrf}`].filter(Boolean).join(' · ')
  return vs ? `${s.mark} ${s.word}: ${vs}` : `${s.mark} ${s.word}`
}

function Field({ r }: { r: FieldResult }): JSX.Element {
  const s = STATE_WORDS[r.state]
  return (
    <td data-text={fieldText(r)} data-state={r.state} className={`sdrf-cell st-${r.state}`} title={r.note}>
      <span className="cell-value">
        <span aria-hidden="true">{s.mark} </span>
        {s.word}
      </span>
      {r.state !== 'no_sdrf' && (r.fastag || r.sdrf) && (
        <span className="cell-note">
          {r.fastag && <span>FASTag {r.fastag}</span>}
          {r.fastag && r.sdrf && <span aria-hidden="true"> · </span>}
          {r.sdrf && <span>SDRF {r.sdrf}</span>}
        </span>
      )}
      {r.note && <span className="sr-only">; {r.note}</span>}
    </td>
  )
}

function Row({ j, busy, onShow }: { j: JobComparison; busy: boolean; onShow(input: string): void }): JSX.Element {
  const bad = j.verdict.state === 'checked' && j.verdict.mismatches.length > 0
  return (
    <tr className={bad ? 'differs' : undefined}>
      <td data-text={j.file} title={j.input}>
        {j.fields && !busy ? (
          <button type="button" className="link" aria-label={`Open ${j.file} in Results`} onClick={() => onShow(j.input)}>
            {j.file}
          </button>
        ) : (
          j.file
        )}
      </td>
      <td data-text={j.dataFile ? `${j.dataFile} (${j.rows.length === 1 ? 'row' : 'rows'} ${j.rows.join(', ')})` : '—'} title={j.dataFile ?? undefined}>
        {j.dataFile ? (
          <>
            {j.dataFile}
            <span className="cell-note">
              {j.rows.length === 1 ? 'row' : 'rows'} {j.rows.join(', ')}
            </span>
          </>
        ) : (
          '—'
        )}
      </td>
      {j.fields ? (
        FIELDS.map((f) => <Field key={f} r={j.fields![f]} />)
      ) : (
        <td colSpan={FIELDS.length} data-text={j.verdict.text} className="muted">
          {j.verdict.text}
        </td>
      )}
      <td data-text={j.verdict.text} className={`verdict${bad ? ' differs' : ''}`}>
        {j.verdict.text}
      </td>
    </tr>
  )
}

export default function SdrfPanel({ sdrf, busy, outDir, onShow }: SdrfPanelProps): JSX.Element {
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const { file, comparison: c } = sdrf
  const mismatches = c ? c.jobs.reduce((n, j) => n + (j.verdict.state === 'checked' ? j.verdict.mismatches.length : 0), 0) : 0
  const settings = c ? c.jobs.reduce((n, j) => n + (j.verdict.state === 'checked' ? j.verdict.settings.length : 0), 0) : 0

  async function exportTsv(): Promise<void> {
    if (!c || !file) return
    setNote(null)
    const dir = outDir ? folderPath(outDir) : dirName(file.path)
    const stem = baseName(file.path).replace(/\.(tsv|txt|sdrf)$/i, '').replace(/\.sdrf$/i, '')
    const dest = await window.fastag.saveFile(`${dir}${stem}.corrections.tsv`, ['tsv'])
    if (!dest) return
    if (samePath(dest, file.path)) {
      setNote({ ok: false, text: `Not written: ${dest} is the loaded SDRF, which is never changed. Choose another name for the corrections.` })
      return
    }
    try {
      await window.fastag.writeSummary(dest, correctionsTsv(c), [file.path])
      setNote({ ok: true, text: `${mismatches} ${mismatches === 1 ? 'correction' : 'corrections'} written to ${dest}. The SDRF was not changed.` })
    } catch (e) {
      setNote({ ok: false, text: `Could not write the corrections: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  return (
    <section className="block sdrf-block" aria-labelledby="sdrf-h">
      <div className="block-head">
        <h2 id="sdrf-h">SDRF</h2>
        <button type="button" className="secondary small" onClick={() => void sdrf.pick()} disabled={busy || sdrf.loading}>
          {file ? 'Replace SDRF…' : 'Load SDRF…'}
        </button>
        {file && (
          <>
            <button type="button" className="secondary small" onClick={() => void exportTsv()} disabled={!c}>
              Export SDRF corrections TSV…
            </button>
            <button type="button" className="secondary small" onClick={sdrf.clear}>
              Close SDRF
            </button>
          </>
        )}
      </div>
      {sdrf.loading && (
        <p className="hint" role="status">
          Reading the SDRF…
        </p>
      )}
      {sdrf.error && (
        <p className="hint note-flag" role="alert">
          {sdrf.error}
        </p>
      )}
      {!file && !sdrf.loading && (
        <p className="hint">
          Load the project's SDRF (or drop it on the window) to compare each run with what FASTag found: organism, cleavage agent,
          label, modifications, instrument and fragment tolerance. The SDRF is never changed; differences go to a corrections TSV.
        </p>
      )}
      {file && c && (
        <>
          <p className="hint sdrf-summary" title={file.path}>
            {baseName(file.path)} · {file.rows} {file.rows === 1 ? 'row' : 'rows'} ·{' '}
            {mismatches === 0 ? 'no differences' : `${mismatches} ${mismatches === 1 ? 'difference' : 'differences'}`}
            {settings > 0 && ` · ${settings} run ${settings === 1 ? 'setting differs' : 'settings differ'} (not a correction)`}
            {c.unmatched.length > 0 && ` · ${c.unmatched.length} SDRF data ${c.unmatched.length === 1 ? 'file' : 'files'} not in the batch`}
          </p>
          {!c.dataFileColumn && (
            <p className="hint note-flag" role="alert">
              This SDRF has no comment[data file] column, so no run can be matched to its rows.
            </p>
          )}
          {c.missingColumns.length > 0 && c.dataFileColumn && (
            <p className="hint">The SDRF has no column for: {c.missingColumns.map((f) => FIELD_LABEL[f].toLowerCase()).join(', ')}.</p>
          )}
          {sdrf.taxonomyNote && <p className="hint note-flag">{sdrf.taxonomyNote}</p>}
          {c.jobs.length > 0 && (
            <div className="summary-wrap" tabIndex={0} role="group" aria-label="SDRF comparison table">
              <table className="summary-table sdrf-table">
                <caption className="sr-only">
                  SDRF comparison · {c.jobs.length} {c.jobs.length === 1 ? 'job' : 'jobs'}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">File</th>
                    <th scope="col">SDRF data file</th>
                    {FIELDS.map((f) => (
                      <th scope="col" key={f}>
                        {FIELD_LABEL[f]}
                      </th>
                    ))}
                    <th scope="col">SDRF</th>
                  </tr>
                </thead>
                <tbody>
                  {c.jobs.map((j) => (
                    <Row key={j.input} j={j} busy={busy} onShow={onShow} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {c.unmatched.length > 0 && (
            <details className="sdrf-unmatched">
              <summary>
                SDRF data files no job ran ({c.unmatched.length})
              </summary>
              <ul>
                {c.unmatched.map((u) => (
                  <li key={u.dataFile}>
                    {u.dataFile} ({u.rows.length === 1 ? 'row' : 'rows'} {u.rows.join(', ')})
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="hint">
            Compared against FASTag's output only: the calls of the summary (a no call or too little evidence is never a difference),
            the instrument the input names (its reports), the run's fragment tolerance (its reports) and the run's fixed modifications
            (its log; FASTag writes no alkylation call). The last two are settings of the run, not measurements: where they differ
            from the SDRF the table shows ≠ run setting differs, a hint on how the run was set up, and no correction is written. The
            organism is matched by NCBI taxid: a genus call that contains the SDRF species, an SDRF taxon above genus that contains
            the call, or an SDRF genus the species report also calls present is consistent. Not validated: the corrections are
            FASTag's view of each run, for a curator to check.
          </p>
        </>
      )}
      {note && (
        <p className={note.ok ? 'hint' : 'hint note-flag'} role={note.ok ? 'status' : 'alert'}>
          {note.text}
        </p>
      )}
    </section>
  )
}
