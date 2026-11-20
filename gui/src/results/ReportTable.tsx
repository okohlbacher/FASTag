// The reports of the workflows as Results views (doc/GUI-WORKFLOWS.md 3):
// the QC report of Run QC as a summary strip over grouped key/value pairs,
// the protein shortlist of Database reduction as a ranked table with its
// reduced FASTA and engine configuration, the identifiability ranking of
// Identifiability triage with an identified/unknown/not identified filter,
// and any other FASTag TSV (the survey's per-spectrum and accounting tables,
// the census summary) as a generic table. Each reads the file the backend
// resolved for the run; a report that cannot be read says so.

import { useEffect, useMemo, useState, type JSX } from 'react'
import DataTable, { type Column } from './DataTable'
import { baseName } from '../digestReport'
import { revealLabel } from '../app/paths'
import { spectrumHint } from '../ResultsTable'

export type ReportKind = 'qc' | 'shortlist' | 'triage' | 'generic'

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
const fmtInt = (n: number): string => n.toLocaleString('en-US')

/// A header in words: ident_score -> Ident score.
export const headText = (c: string): string => {
  const s = c.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

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

/// How a column of a FASTag table is shown: its header in words, and its
/// cells as the Tags table shows them (scan number with the native ID as a
/// tooltip, m/z to 4 decimals, RT in minutes).
interface Format {
  label?: string
  text?(v: string): string
  title?(v: string): string | undefined
  num?: boolean
}

/// The shortlist's reasons in words.
const REASON_WORDS: Record<string, string> = {
  selected: 'kept',
  below_min_spectra: 'too few spectra',
  below_top: 'beyond the top proteins kept',
  subsumed: 'its spectra belong to a higher-ranked protein',
  decoy: 'a decoy entry'
}

/// The identified column (census_ids): 1 identified, 0 not, empty unknown
/// (the CLI could not tell).
export type IdState = 'identified' | 'not' | 'unknown'
export function idState(v: string | undefined): IdState {
  const t = (v ?? '').trim().toLowerCase()
  if (t === '1' || t === 'true' || t === 'yes') return 'identified'
  if (t === '0' || t === 'false' || t === 'no') return 'not'
  return 'unknown'
}

const FORMATS: Record<string, Format> = {
  spectrum: { label: 'Spectrum', text: (v) => spectrumHint(v) || v, title: (v) => v },
  precursor_mz: { label: 'Precursor m/z', text: (v) => (isNum(v) ? Number(v).toFixed(4) : v), num: true },
  rt: { label: 'RT (min)', text: (v) => (isNum(v) ? (Number(v) / 60).toFixed(2) : v), num: true },
  ident_rank: { label: 'Rank' },
  ident_score: { label: 'Identifiability', text: (v) => (isNum(v) ? Number(v).toFixed(3) : v) },
  best_evalue: { label: 'Best E-value' },
  best_len: { label: 'Best tag length' },
  charge_used: { label: 'Charge' },
  n_peaks: { label: 'Peaks' },
  n_peaks_kept: { label: 'Peaks kept' },
  identified: {
    label: 'Identified',
    text: (v) => {
      const s = idState(v)
      return s === 'identified' ? 'yes' : s === 'not' ? 'no' : 'unknown'
    },
    num: false
  },
  accession: { label: 'Accession' },
  kept: { label: 'Kept', text: (v) => (v === '1' ? '✓' : v === '0' ? '–' : v), num: false },
  reason: { label: 'Reason', text: (v) => REASON_WORDS[v] ?? v.replace(/_/g, ' ') },
  nsaf: { label: 'NSAF', text: (v) => (isNum(v) ? Number(v).toPrecision(3) : v) }
}

/// The columns of a table, numbers right-aligned and sorted as numbers.
function columnsOf(tsv: Tsv): Column[] {
  return tsv.columns.map((c, j) => {
    const f = FORMATS[c] ?? {}
    const num = f.num ?? tsv.rows.slice(0, 50).every((r) => r[j] === undefined || r[j] === '' || r[j] === '-' || isNum(r[j]))
    const raw = (i: number): string => tsv.rows[i][j] ?? ''
    return {
      id: c,
      label: f.label ?? headText(c),
      num,
      mono: c === 'accession',
      text: f.text ? (i: number) => f.text!(raw(i)) : raw,
      key: num ? (i: number) => Number(raw(i)) : undefined,
      cellTitle: f.title ? (i: number) => f.title!(raw(i)) : undefined
    }
  })
}

// ---- QC --------------------------------------------------------------------

export type QcRow = { sec: string; key: string; value: string; n: string; desc: string }

function qcRows(tsv: Tsv): QcRow[] {
  const col = (n: string): number => tsv.columns.indexOf(n)
  const [s, k, v, n, d] = [col('section'), col('key'), col('value'), col('n'), col('description')]
  return tsv.rows.map((r) => ({ sec: r[s] ?? '', key: r[k] ?? '', value: r[v] ?? '', n: n >= 0 ? (r[n] ?? '') : '', desc: d >= 0 ? (r[d] ?? '') : '' }))
}

/// A row that says nothing: a count of 0 out of none ("0 of 0 …").
const empty = (r: QcRow): boolean => /^0(\.0+)?$/.test(r.value) && (r.n === '0' || r.n === '-' || r.n === '')

/// The headline numbers of a QC report (MS/MS read, tag yield, instrument,
/// serial, start time, isobaric kit), each when the report has it.
export function qcSummary(rows: QcRow[]): { label: string; value: string; title?: string }[] {
  const get = (k: string): QcRow | undefined => rows.find((r) => r.key === k)
  const out: { label: string; value: string; title?: string }[] = []
  const ms2 = get('count_ms2')
  if (ms2) out.push({ label: 'MS/MS spectra', value: isNum(ms2.value) ? fmtInt(Number(ms2.value)) : ms2.value, title: ms2.desc })
  const yieldRow = get('tag_yield')
  const tagged = get('ms2_tagged_e001')
  if (yieldRow && isNum(yieldRow.value))
    out.push({
      label: 'Tagged (E ≤ 0.01)',
      value: `${(Number(yieldRow.value) * 100).toFixed(1)}%${tagged && isNum(tagged.value) ? ` (${fmtInt(Number(tagged.value))})` : ''}`,
      title: yieldRow.desc
    })
  for (const [k, label] of [
    ['instrument_model', 'Instrument'],
    ['instrument_serial_number', 'Serial'],
    ['start_timestamp', 'Started']
  ] as const) {
    const r = get(k)
    if (r) out.push({ label, value: r.value, title: r.desc })
  }
  const kits = get('reporter_compatible_kits')
  if (kits) out.push({ label: 'Isobaric kit', value: kits.value === 'none' ? 'none found' : kits.value.replace(/,/g, ', '), title: kits.desc })
  return out
}

function QcView({ tsv }: { tsv: Tsv }): JSX.Element {
  const rows = useMemo(() => qcRows(tsv), [tsv])
  const [all, setAll] = useState(false)
  const summary = qcSummary(rows)
  // The QC section first: the run settings are its context, not its result.
  const sections = [...new Set(rows.map((r) => r.sec))].sort((a, b) => (a === 'qc' ? -1 : b === 'qc' ? 1 : 0))
  const hidden = rows.filter(empty).length
  return (
    <div className="qc-view">
      {summary.length > 0 && (
        <dl className="qc-strip" aria-label="QC summary">
          {summary.map((x) => (
            <div key={x.label} className="stat" title={x.title}>
              <dt>{x.label}</dt>
              <dd>{x.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {hidden > 0 && (
        <label className="check-inline">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show the {hidden} rows that count nothing (0 of 0)
        </label>
      )}
      {sections.map((sec) => (
        <section key={sec} className="qc-section" aria-label={sec === 'run' ? 'Run' : sec === 'qc' ? 'Quality' : sec}>
          <h3>{sec === 'run' ? 'Run settings and instrument' : sec === 'qc' ? 'Spectra and tags' : sec}</h3>
          <table className="kv">
            <tbody>
              {rows
                .filter((r) => r.sec === sec && (all || !empty(r)))
                .map((r, i) => (
                  // The row's sentence is its tooltip, not a column.
                  <tr key={`${r.key}-${i}`} title={r.desc || undefined}>
                    <th scope="row">{headText(r.key)}</th>
                    <td className="mono">{r.value}</td>
                    <td className="muted">{r.n && r.n !== '-' ? `n = ${r.n}` : ''}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  )
}

// ---- Shortlist ---------------------------------------------------------------

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
        <div className="report-notes">
          {tsv.notes.map((n) => (
            <p key={n} className="hint">
              {n.charAt(0).toUpperCase() + n.slice(1)}
            </p>
          ))}
        </div>
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

// ---- Triage ------------------------------------------------------------------

const FILTERS = [
  { id: 'all', label: 'All spectra' },
  { id: 'identified', label: 'Identified' },
  { id: 'not', label: 'Not identified' },
  { id: 'unknown', label: 'Unknown' }
] as const
type Filter = (typeof FILTERS)[number]['id']

function TriageView({ tsv }: { tsv: Tsv }): JSX.Element {
  // The ranking first: rank, score, identified, status, then what the spectrum is.
  const columns = useMemo(() => {
    const all = columnsOf(tsv)
    const lead = ['ident_rank', 'ident_score', 'identified', 'status', 'spectrum', 'best_evalue', 'best_len', 'charge_used', 'precursor_mz', 'rt']
    const at = (c: Column): number => (lead.includes(c.id) ? lead.indexOf(c.id) : lead.length)
    return all.map((c, i) => ({ c, i })).sort((x, y) => at(x.c) - at(y.c) || x.i - y.i).map((x) => x.c)
  }, [tsv])
  const st = tsv.columns.indexOf('status')
  const idc = tsv.columns.indexOf('identified')
  const [filter, setFilter] = useState<Filter>('all')
  const states = useMemo(() => (idc < 0 ? [] : tsv.rows.map((r) => idState(r[idc]))), [tsv, idc])
  const count = (f: Filter): number => (f === 'all' ? tsv.rows.length : states.filter((x) => x === f).length)
  const ids = useMemo(() => {
    const keep = tsv.rows.map((_, i) => i).filter((i) => filter === 'all' || idc < 0 || states[i] === filter)
    return Uint32Array.from(keep)
  }, [tsv, filter, idc, states])
  const counts = st >= 0 ? Object.entries(tsv.rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r[st]]: (m[r[st]] ?? 0) + 1 }), {})) : []
  return (
    <>
      <p className="report-sum">
        {fmtInt(tsv.rows.length)} MS/MS spectra, ranked by how identifiable they are
        {counts.length > 0 && <>: {counts.map(([k, n]) => `${fmtInt(n)} ${k.replace(/_/g, ' ')}`).join(', ')}</>}.
      </p>
      <div className="row tight" role="group" aria-label="Show">
        {FILTERS.map((f) => (
          <label key={f.id} className="seg-opt small">
            <input type="radio" name="triage-filter" checked={filter === f.id} disabled={f.id !== 'all' && idc < 0} onChange={() => setFilter(f.id)} />
            {f.label}
            {idc >= 0 && <span className="count">{fmtInt(count(f.id))}</span>}
          </label>
        ))}
        {idc < 0 && <span className="muted">Give the identifications of this run in Setup to mark identified spectra.</span>}
      </div>
      <p className="hint">
        The score ranks spectra; it is not a quality call and not an error rate.
        {idc >= 0 && ' Unknown: the identifications neither name nor rule out the spectrum.'}
      </p>
      <DataTable label="Spectra ranked by identifiability" columns={columns} ids={ids} total={tsv.rows.length} keep={tsv} />
    </>
  )
}

function GenericView({ tsv, label }: { tsv: Tsv; label: string }): JSX.Element {
  const columns = useMemo(() => columnsOf(tsv), [tsv])
  const ids = useMemo(() => Uint32Array.from(tsv.rows.map((_, i) => i)), [tsv])
  return <DataTable label={label} columns={columns} ids={ids} total={tsv.rows.length} keep={tsv} />
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
      ) : kind === 'triage' ? (
        <TriageView tsv={tsv} />
      ) : (
        <GenericView tsv={tsv} label={baseName(path)} />
      )}
    </div>
  )
}
