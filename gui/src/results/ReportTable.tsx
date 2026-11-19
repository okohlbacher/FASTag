// The reports of three workflows as Results views (doc/GUI-WORKFLOWS.md 3):
// the QC report of Run QC as grouped key/value pairs, the protein shortlist
// of Database reduction as a ranked table with its reduced FASTA and engine
// configuration, and the identifiability ranking of Identifiability triage
// with a status filter. Each reads the file the run was sent (its path is in
// the run's parameters); a report that cannot be read says so.

import { useEffect, useMemo, useState, type JSX } from 'react'
import DataTable, { type Column } from './DataTable'
import { baseName } from '../digestReport'
import { revealLabel } from '../app/paths'

export type ReportKind = 'qc' | 'shortlist' | 'triage'

interface Tsv {
  /// Lines starting with '#' before the header (the shortlist's caveats).
  notes: string[]
  columns: string[]
  rows: string[][]
}

/// A TSV as FASTag writes its reports: '#' comment lines, a header, rows.
export function parseTsv(text: string): Tsv {
  const lines = text.replace(/\r/g, '').split('\n')
  const notes: string[] = []
  let i = 0
  for (; i < lines.length && lines[i].startsWith('#'); i++) notes.push(lines[i].replace(/^#\s*/, ''))
  const columns = (lines[i] ?? '').split('\t').filter((c, j, a) => c !== '' || j < a.length - 1)
  const rows = lines
    .slice(i + 1)
    .filter((l) => l.trim() !== '' && !l.startsWith('#'))
    .map((l) => l.split('\t'))
  return { notes, columns, rows }
}

const isNum = (s: string): boolean => s.trim() !== '' && Number.isFinite(Number(s))

function useReport(path: string): { tsv: Tsv | null; error: string | null } {
  const [state, setState] = useState<{ path: string; tsv: Tsv | null; error: string | null }>({ path: '', tsv: null, error: null })
  useEffect(() => {
    let live = true
    window.fastag
      .report(path)
      .then((t) => live && setState({ path, tsv: t == null ? null : parseTsv(t), error: t == null ? 'The run did not write this report.' : null }))
      .catch((e: unknown) => live && setState({ path, tsv: null, error: `Cannot read ${path}: ${e instanceof Error ? e.message : String(e)}` }))
    return () => {
      live = false
    }
  }, [path])
  return state.path === path ? state : { tsv: null, error: null }
}

/// The columns of a table, numbers right-aligned and sorted as numbers.
function columnsOf(tsv: Tsv, labels: Record<string, string> = {}): Column[] {
  return tsv.columns.map((c, j) => {
    const num = tsv.rows.slice(0, 50).every((r) => r[j] === undefined || r[j] === '' || r[j] === '-' || isNum(r[j]))
    return {
      id: c,
      label: labels[c] ?? c.replace(/_/g, ' '),
      num,
      mono: c === 'spectrum' || c === 'accession',
      text: (i: number) => tsv.rows[i][j] ?? '',
      key: num ? (i: number) => Number(tsv.rows[i][j]) : undefined
    }
  })
}

function QcView({ tsv }: { tsv: Tsv }): JSX.Element {
  const col = (n: string): number => tsv.columns.indexOf(n)
  const [s, k, v, n, d] = [col('section'), col('key'), col('value'), col('n'), col('description')]
  const sections = [...new Set(tsv.rows.map((r) => r[s]))]
  return (
    <div className="qc-view">
      {sections.map((sec) => (
        <section key={sec} className="qc-section" aria-label={sec === 'run' ? 'Run' : sec === 'qc' ? 'Quality' : sec}>
          <h3>{sec === 'run' ? 'Run and instrument' : sec === 'qc' ? 'Spectra and tags' : sec}</h3>
          <table className="kv">
            <tbody>
              {tsv.rows
                .filter((r) => r[s] === sec)
                .map((r, i) => (
                  <tr key={`${r[k]}-${i}`} title={d >= 0 ? r[d] : undefined}>
                    <th scope="row">{(r[k] ?? '').replace(/_/g, ' ')}</th>
                    <td className="mono">{r[v]}</td>
                    <td className="muted">{n >= 0 && r[n] && r[n] !== '-' ? `n = ${r[n]}` : ''}</td>
                    <td className="muted desc">{d >= 0 ? r[d] : ''}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  )
}

function ShortlistView({ tsv, files }: { tsv: Tsv; files: { label: string; path: string }[] }): JSX.Element {
  const columns = useMemo(() => columnsOf(tsv), [tsv])
  const kept = tsv.columns.indexOf('kept')
  const nKept = kept >= 0 ? tsv.rows.filter((r) => r[kept] === '1').length : tsv.rows.length
  const ids = useMemo(() => Uint32Array.from(tsv.rows.map((_, i) => i)), [tsv])
  return (
    <>
      <p className="report-sum">
        <strong>{nKept}</strong> of {tsv.rows.length} proteins with evidence are kept in the reduced FASTA.
      </p>
      {tsv.notes.length > 0 && (
        <ul className="caveat report-notes">
          {tsv.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <div className="row tight">
          {files.map((f) => (
            <button key={f.path} type="button" className="secondary small" title={f.path} onClick={() => void window.fastag.revealOutput(f.path, false).catch(() => {})}>
              {revealLabel()}: {f.label} ({baseName(f.path)})
            </button>
          ))}
        </div>
      )}
      <DataTable label="Protein shortlist" columns={columns} ids={ids} total={tsv.rows.length} keep={tsv} />
    </>
  )
}

function TriageView({ tsv }: { tsv: Tsv }): JSX.Element {
  // The ranking first: rank, score, status, then what the spectrum is.
  const columns = useMemo(() => {
    const all = columnsOf(tsv, { ident_rank: 'rank', ident_score: 'identifiability', best_evalue: 'best E-value', best_len: 'best tag length' })
    const lead = ['ident_rank', 'ident_score', 'identified', 'status', 'spectrum', 'best_evalue', 'best_len', 'charge_used', 'precursor_mz', 'rt']
    const at = (c: Column): number => (lead.includes(c.id) ? lead.indexOf(c.id) : lead.length)
    return all.map((c, i) => ({ c, i })).sort((x, y) => at(x.c) - at(y.c) || x.i - y.i).map((x) => x.c)
  }, [tsv])
  const st = tsv.columns.indexOf('status')
  const idc = tsv.columns.indexOf('identified')
  const [filter, setFilter] = useState<'all' | 'identified' | 'unidentified'>('all')
  const ids = useMemo(() => {
    const keep = tsv.rows
      .map((_, i) => i)
      .filter((i) => {
        if (filter === 'all' || idc < 0) return true
        const v = tsv.rows[i][idc]
        const yes = v === '1' || v === 'true' || v === 'yes'
        return filter === 'identified' ? yes : !yes
      })
    return Uint32Array.from(keep)
  }, [tsv, filter, idc])
  const counts = st >= 0 ? Object.entries(tsv.rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r[st]]: (m[r[st]] ?? 0) + 1 }), {})) : []
  return (
    <>
      <p className="report-sum">
        {tsv.rows.length.toLocaleString('en-US')} MS/MS spectra, ranked by how identifiable they are
        {counts.length > 0 && <>: {counts.map(([k, n]) => `${n.toLocaleString('en-US')} ${k.replace(/_/g, ' ')}`).join(', ')}</>}.
      </p>
      <div className="row tight" role="group" aria-label="Show">
        {(['all', 'identified', 'unidentified'] as const).map((f) => (
          <label key={f} className="seg-opt small">
            <input type="radio" name="triage-filter" checked={filter === f} disabled={f !== 'all' && idc < 0} onChange={() => setFilter(f)} />
            {f === 'all' ? 'All spectra' : f === 'identified' ? 'Identified' : 'Not identified'}
          </label>
        ))}
        {idc < 0 && <span className="muted">Give the identifications of this run in Setup to mark identified spectra.</span>}
      </div>
      <p className="hint">The score ranks spectra; it is not a quality call and not an error rate.</p>
      <DataTable label="Spectra ranked by identifiability" columns={columns} ids={ids} total={tsv.rows.length} keep={tsv} />
    </>
  )
}

export interface ReportTableProps {
  kind: ReportKind
  path: string
  /// Shortlist: the reduced FASTA and the engine configuration, when written.
  files?: { label: string; path: string }[]
}

export default function ReportTable({ kind, path, files = [] }: ReportTableProps): JSX.Element {
  const { tsv, error } = useReport(path)
  return (
    <div className={`report-view report-${kind}`}>
      <p className="src" title={path}>
        <span className="mono">{baseName(path)}</span>
      </p>
      {error ? (
        <p className="warn" role="alert">
          {error}
        </p>
      ) : !tsv ? (
        <p className="muted">Reading…</p>
      ) : kind === 'qc' ? (
        <QcView tsv={tsv} />
      ) : kind === 'shortlist' ? (
        <ShortlistView tsv={tsv} files={files} />
      ) : (
        <TriageView tsv={tsv} />
      )}
    </div>
  )
}
