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
import { revealLabel, stripExt } from '../app/paths'
import { pathKey } from '../run/batch'
import { evalueText, spectrumHint } from '../ResultsTable'
import { PARAM_BY_NAME, choiceText, humanName } from '../paramLayout'
import ReportHeader from './ReportHeader'
import { unassessedKits } from './calls'
import { shortlistFacts } from './overview'

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

/// The report at @p path, read again on each @p gen (an explicit open or a
/// finished run bumps it: the file may have been rewritten at that path).
function useReport(path: string, gen = 0): { tsv: Tsv | null; error: string | null } {
  const [state, setState] = useState<{ path: string; gen: number; tsv: Tsv | null; error: string | null }>({ path: '', gen: 0, tsv: null, error: null })
  useEffect(() => {
    let live = true
    window.fastag
      .report(path)
      .then((t) => live && setState({ path, gen, tsv: t == null ? null : parseTsv(t), error: t == null ? 'The run did not write this report.' : null }))
      .catch((e: unknown) => live && setState({ path, gen, tsv: null, error: `Cannot read ${path}: ${e instanceof Error ? e.message : String(e)}` }))
    return () => {
      live = false
    }
  }, [path, gen])
  return state.path === path && state.gen === gen ? state : { tsv: null, error: null }
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
  best_evalue: { label: 'Best E-value', text: evalueText, num: true },
  pre_best_evalue: { label: 'Best E-value before filtering', text: evalueText, num: true },
  evalue: { label: 'E-value', text: evalueText, num: true },
  best_len: { label: 'Best tag length' },
  pre_best_len: { label: 'Best tag length before filtering' },
  best_min_conf: { label: 'Lowest residue confidence' },
  best_mean_conf: { label: 'Mean residue confidence' },
  pre_best_mean_conf: { label: 'Mean residue confidence before filtering' },
  best_tic: { label: 'Tag intensity' },
  tag_cover: { label: 'Tag coverage (m/z)' },
  pre_tag_cover: { label: 'Tag coverage before filtering' },
  charge_given: { label: 'Charge given' },
  charge_used: { label: 'Charge' },
  index: { label: 'Index' },
  n_peaks: { label: 'Peaks' },
  n_peaks_kept: { label: 'Peaks kept' },
  n_edges: { label: 'Residue steps' },
  n_compl: { label: 'Complement pairs' },
  int_gini: { label: 'Intensity spread (Gini)' },
  n_found: { label: 'Tags found' },
  n_reported: { label: 'Tags reported' },
  // The CLI's tag status (tagged, no tags, ...), not the identification.
  status: { label: 'Tag status', text: (v) => v.replace(/_/g, ' ') },
  identified: {
    label: 'Identified',
    text: (v) => {
      const s = idState(v)
      return s === 'identified' ? 'yes' : s === 'not' ? 'no' : 'unknown'
    },
    num: false
  },
  // -census_ids: an unidentified spectrum with a tag at or below the triage E-value.
  triage: { label: 'Triage candidate', text: (v) => (v === '1' ? 'yes' : v === '0' ? 'no' : ''), num: false },
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
      // A blank cell is no value: it sorts last, not as 0 (Number('')).
      key: num ? (i: number) => (raw(i).trim() === '' ? NaN : Number(raw(i))) : undefined,
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

/// Rows that only say which format the report follows.
const FORMAT_KEYS = new Set(['qc_version', 'run_report_version'])

/// QC keys in words. A key not listed reads as its words (headText), with
/// MS1, MS2, TMT and iTRAQ spelt as such.
const QC_WORDS: Record<string, string> = {
  version: 'FASTag version',
  input: 'Input',
  spectra_input: 'Spectra in the input',
  spectra_read: 'Spectra read',
  subsampled: 'Subsampled',
  count_ms1: 'MS1 spectra',
  count_ms2: 'MS2 spectra',
  sps_ms3: 'SPS MS3 spectra',
  ms2_tagged_e001: 'MS2 with a tag at E ≤ 0.01',
  tag_yield: 'Tag yield (E ≤ 0.01)',
  redundancy_ms2: 'MS2 clustered for redundancy',
  redundancy_share: 'Redundant MS2 (spectrum clusters)',
  redundancy_clusters: 'Spectrum clusters',
  redundancy_largest: 'Largest spectrum cluster',
  redundancy_pairs_compared: 'Spectrum pairs compared',
  redundancy_components_split: 'Large groups split',
  redundancy_tag_share: 'Redundant MS2 (same best tag)',
  redundancy_tag_clusters: 'Same-tag clusters',
  redundancy_tag_largest: 'Largest same-tag cluster',
  redundancy_tag_pairs_compared: 'Same-tag pairs compared',
  redundancy_tag_components_split: 'Large same-tag groups split',
  reporter_compatible_kits: 'Compatible isobaric kits',
  instrument_model: 'Instrument',
  instrument_serial_number: 'Serial number',
  start_timestamp: 'Started',
  unknown_charge: 'Precursors without a charge',
  isotope_error: 'Precursor isotope offsets',
  ion_series: 'Ion series',
  ion_series_by: 'Read as b/y ions',
  ion_series_cz: 'Read as c/z ions',
  pick_profile: 'Profile picking',
  profile_ms2_picked: 'Profile MS2 centroided',
  profile_ms2_kept: 'Profile MS2 tagged as profile'
}
const TOKEN_WORDS: Record<string, string> = { ms1: 'MS1', ms2: 'MS2', ms3: 'MS3', tmt: 'TMT', itraq: 'iTRAQ', sps: 'SPS' }

/// A QC key in words: count_ms2_FTMS -> MS2 spectra, FTMS.
export function qcKeyText(key: string): string {
  if (Object.prototype.hasOwnProperty.call(QC_WORDS, key)) return QC_WORDS[key]
  let m = /^precursor_charge_(\d+)$/.exec(key)
  if (m) return m[1] === '0' ? 'Precursor charge unknown' : `Precursor charge ${m[1]}`
  m = /^count_ms(\d)_(.+)$/.exec(key)
  if (m) return `MS${m[1]} spectra, ${m[2]}`
  m = /^analyzer_source_(.+)$/.exec(key)
  if (m) return `Analyzer class from ${m[1] === 'none' ? 'nothing (unknown)' : m[1] === 'run' ? 'the run default' : `the ${m[1]}`}`
  m = /^activation_(.+)$/.exec(key)
  if (m) return `Activation: ${m[1]}`
  m = /^charge_(.+)$/.exec(key)
  if (m) return `Charge ${m[1]}`
  m = /^resolution_(stated|measured|source)_(.+)$/.exec(key)
  if (m) return `Resolution ${m[1]}, ${m[2].replace(/_ms(\d)$/, ' MS$1')}`
  m = /^resolution_(.+)$/.exec(key)
  if (m) return `Resolution, ${m[1].replace(/_ms(\d)$/, ' MS$1')}`
  const words = key.split('_').map((w, i) => TOKEN_WORDS[w.toLowerCase()] ?? (/[A-Z]/.test(w) ? w : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
  return words.join(' ')
}

/// One shown row of the QC table: a count merged with its share
/// (precursor_charge_2 with precursor_charge_2_share: 97 (69.8%)).
export interface QcLine {
  key: string
  label: string
  value: string
  n: string
  desc: string
  empty: boolean
}

const pct = (v: string): string => (isNum(v) ? `${(Number(v) * 100).toFixed(1)}%` : v)

export function qcLines(rows: QcRow[]): QcLine[] {
  const byKey = new Map(rows.map((r) => [r.key, r]))
  const out: QcLine[] = []
  for (const r of rows) {
    if (FORMAT_KEYS.has(r.key)) continue
    // A share row goes with its count.
    if (r.key.endsWith('_share') && byKey.has(r.key.slice(0, -'_share'.length))) continue
    const share = byKey.get(`${r.key}_share`)
    const value = share && isNum(r.value) ? `${fmtInt(Number(r.value))} (${pct(share.value)})` : r.key.endsWith('_share') || r.key === 'tag_yield' ? pct(r.value) : isNum(r.value) && /^\d+$/.test(r.value) ? fmtInt(Number(r.value)) : r.value
    out.push({ key: r.key, label: qcKeyText(r.key), value, n: r.n, desc: share ? `${r.desc} ${share.desc}` : r.desc, empty: empty(r) })
  }
  return out
}

/// The n most rows of @p lines count out of, said once over the section.
function commonN(lines: QcLine[]): string | null {
  const counts = new Map<string, number>()
  for (const l of lines) if (l.n && l.n !== '-') counts.set(l.n, (counts.get(l.n) ?? 0) + 1)
  let best: string | null = null
  for (const [n, c] of counts) if (best === null || c > counts.get(best)!) best = n
  return best
}

/// The headline numbers of a QC report (MS/MS read, tag yield, instrument,
/// serial, start time, isobaric kit), each when the report has it.
export function qcSummary(rows: QcRow[]): { label: string; value: string; title?: string }[] {
  const get = (k: string): QcRow | undefined => rows.find((r) => r.key === k)
  const out: { label: string; value: string; title?: string }[] = []
  const ms2 = get('count_ms2')
  if (ms2) out.push({ label: 'MS2 spectra', value: isNum(ms2.value) ? fmtInt(Number(ms2.value)) : ms2.value, title: ms2.desc })
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
  // "none" also when no kit could be assessed (unassessedKits): that is no
  // call, said as such, with the reason as the tooltip.
  const why = kits ? unassessedKits(kits.value, rows) : null
  if (kits)
    out.push(
      why
        ? { label: 'Isobaric kit', value: 'Not assessable', title: `No kit could be assessed${why.length ? `: ${why.join('; ')}` : ''}.` }
        : { label: 'Isobaric kit', value: kits.value === 'none' ? 'none found' : kits.value.replace(/,/g, ', '), title: kits.desc }
    )
  return out
}

/// The rows the summary strip shows (qcSummary): said there once, not again
/// in the table. The yield's count goes with the yield.
const SUMMARY_KEYS: Record<string, string[]> = {
  'MS2 spectra': ['count_ms2'],
  'Tagged (E ≤ 0.01)': ['tag_yield', 'ms2_tagged_e001'],
  Instrument: ['instrument_model'],
  Serial: ['instrument_serial_number'],
  Started: ['start_timestamp'],
  'Isobaric kit': ['reporter_compatible_kits']
}
export const summaryKeys = (summary: { label: string }[]): Set<string> => new Set(summary.flatMap((x) => SUMMARY_KEYS[x.label] ?? []))

function QcView({ tsv }: { tsv: Tsv }): JSX.Element {
  const rows = useMemo(() => qcRows(tsv), [tsv])
  const lines = useMemo(() => {
    const strip = summaryKeys(qcSummary(rows))
    return qcLines(rows).filter((l) => !strip.has(l.key))
  }, [rows])
  const [all, setAll] = useState(false)
  const summary = qcSummary(rows)
  // The QC section first: the run settings are its context, not its result.
  const sections = [...new Set(rows.map((r) => r.sec))].sort((a, b) => (a === 'qc' ? -1 : b === 'qc' ? 1 : 0))
  const hidden = lines.filter((l) => l.empty).length
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
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show {hidden} empty {hidden === 1 ? 'row' : 'rows'}
        </label>
      )}
      {sections.map((sec) => {
        const secLines = lines.filter((l) => rows.some((r) => r.key === l.key && r.sec === sec))
        const n = commonN(secLines)
        return (
          <section key={sec} className="qc-section" aria-label={sec === 'run' ? 'Run' : sec === 'qc' ? 'Quality' : sec}>
            <h3>
              {sec === 'run' ? 'Run settings and instrument' : sec === 'qc' ? 'Spectra and tags' : sec}
              {n && <span className="muted small"> · counts of {fmtInt(Number(n))} spectra unless stated</span>}
            </h3>
            <table className="kv">
              <tbody>
                {secLines
                  .filter((l) => all || !l.empty)
                  .map((l, i) => (
                    // The row's sentence is its tooltip, not a column.
                    <tr key={`${l.key}-${i}`} title={l.desc || undefined}>
                      <th scope="row">{l.label}</th>
                      <td className="mono">{l.value}</td>
                      <td className="muted">{l.n && l.n !== '-' && l.n !== n ? `of ${isNum(l.n) ? fmtInt(Number(l.n)) : l.n}` : ''}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        )
      })}
    </div>
  )
}

// ---- Shortlist ---------------------------------------------------------------

/// The shortlist's '#' lines as a labelled list in the GUI's words: the
/// caveat as one sentence, "key: value" lines as rows, the settings line
/// split into its options under their field names.
const SETTING_PARAM: Record<string, string> = {
  max_evalue: 'shortlist_max_evalue',
  min_spectra: 'shortlist_min_spectra',
  gapped: 'shortlist_gapped',
  parsimony: 'shortlist_parsimony',
  top: 'shortlist_top'
}
/// A shortlist setting's CLI token in the form's words: 0 proteins kept at
/// most is no limit, a switch is on or off, a choice its name (none: off).
export function settingValue(param: string | undefined, v: string): string {
  const t = v.trim()
  if (!param) return t
  const spec = PARAM_BY_NAME.get(param)
  if (param === 'shortlist_top' && Number(t) === 0) return 'no limit'
  if (t === 'none') return 'off'
  // The CLI writes a switch as yes/no in the settings line (gapped yes).
  if (spec?.type === 'bool' || /^(true|false|yes|no)$/.test(t))
    return /^(true|1|on|yes)$/.test(t) ? 'on' : /^(false|0|off|no)$/.test(t) ? 'off' : t
  if (spec?.choices?.includes(t)) return choiceText(param, t)
  return t
}

export function shortlistNotes(notes: string[]): { caveat: string | null; rows: { label: string; value: string }[] } {
  let caveat: string | null = null
  const rows: { label: string; value: string }[] = []
  for (const n of notes) {
    if (/protein shortlist:/i.test(n)) {
      caveat = 'A search-space reduction from tag placements: not an identification, not protein inference and not FDR-controlled.'
      continue
    }
    const m = /^([a-z_ ]+):\s*(.*)$/i.exec(n)
    if (!m) {
      rows.push({ label: 'Note', value: n })
      continue
    }
    const key = m[1].trim().toLowerCase()
    if (key === 'settings') {
      for (const part of m[2].split(/,\s*/)) {
        const [k, ...v] = part.trim().split(/\s+/)
        const param = SETTING_PARAM[k]
        rows.push({ label: param ? humanName(param) : headText(k), value: settingValue(param, v.join(' ')) })
      }
    } else if (key === 'input') {
      // "input: run01.mzML; database: ecoli.fasta"
      for (const part of n.split(/;\s*/)) {
        const [k, ...v] = part.split(':')
        rows.push({ label: headText(k.trim()), value: v.join(':').trim() })
      }
    } else rows.push({ label: headText(key), value: m[2] })
  }
  return { caveat, rows }
}

function ShortlistNotes({ notes }: { notes: string[] }): JSX.Element | null {
  const { caveat, rows } = useMemo(() => shortlistNotes(notes), [notes])
  if (!caveat && rows.length === 0) return null
  return (
    <div className="report-notes">
      {caveat && <p className="hint">{caveat}</p>}
      {rows.length > 0 && (
        <table className="kv shortlist-notes" aria-label="Shortlist settings">
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.label}-${i}`}>
                <th scope="row">{r.label}</th>
                <td>{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function ShortlistView({ tsv, files }: { tsv: Tsv; files: { label: string; path: string }[] }): JSX.Element {
  const columns = useMemo(() => columnsOf(tsv), [tsv])
  // A file that cannot be revealed says why.
  const [revealErr, setRevealErr] = useState<string | null>(null)
  const kept = tsv.columns.indexOf('kept')
  const reason = tsv.columns.indexOf('reason')
  // Background proteins (-shortlist_background) are rows without evidence:
  // counted apart, never as proteins with evidence. The CLI's header line
  // ("proteins: N with evidence, M kept") is the count, as the Overview's.
  const background = reason >= 0 ? tsv.rows.filter((r) => r[reason] === 'background').length : 0
  const head = shortlistFacts(tsv.notes.map((n) => `# ${n}`).join('\n'))
  const nKept = head ? head.kept : kept >= 0 ? tsv.rows.filter((r) => r[kept] === '1' && r[reason] !== 'background').length : tsv.rows.length - background
  const nOf = head ? head.of : tsv.rows.length - background
  const ids = useMemo(() => Uint32Array.from(tsv.rows.map((_, i) => i)), [tsv])
  // Only a run that wrote the reduced FASTA keeps them in it; a shortlist
  // opened alone, or one without -fasta_out, keeps them on the list.
  const reduced = files.some((f) => f.label === 'reduced FASTA')
  return (
    <>
      <p className="report-sum">
        <strong>{nKept}</strong> of {nOf} proteins with evidence are kept {reduced ? 'in the reduced FASTA' : 'on the shortlist'}
        {background > 0 && <>, plus {background} background {background === 1 ? 'protein' : 'proteins'} kept without evidence</>}.
      </p>
      <ShortlistNotes notes={tsv.notes} />
      {files.length > 0 && (
        <div className="row tight">
          {files.map((f) => (
            <button
              key={f.path}
              type="button"
              className="secondary small"
              title={f.path}
              onClick={() => {
                setRevealErr(null)
                window.fastag.revealOutput(f.path, false).catch((e: unknown) => setRevealErr(`Cannot reveal ${baseName(f.path)}: ${e instanceof Error ? e.message : String(e)}`))
              }}
            >
              {revealLabel()}: {f.label} ({baseName(f.path)})
            </button>
          ))}
        </div>
      )}
      {revealErr && (
        <p className="warn" role="alert">
          {revealErr}
        </p>
      )}
      <DataTable label="Protein shortlist" columns={columns} ids={ids} total={tsv.rows.length} keep={tsv} />
    </>
  )
}

// ---- Triage ------------------------------------------------------------------

const FILTERS = [
  { id: 'all', label: 'All spectra' },
  { id: 'candidates', label: 'Triage candidates' },
  { id: 'identified', label: 'Identified' },
  { id: 'not', label: 'Not identified' },
  { id: 'unknown', label: 'Unknown' }
] as const
type Filter = (typeof FILTERS)[number]['id']

const NO_IDS = 'Give the identifications of this run in Setup to mark identified spectra.'

function TriageView({ tsv, path, openSpectrum }: { tsv: Tsv; path: string; openSpectrum?: (spectrum: string) => void }): JSX.Element {
  // The ranking first: rank, score, identified, candidate, status, then what the spectrum is.
  const columns = useMemo(() => {
    const all = columnsOf(tsv)
    const lead = ['ident_rank', 'ident_score', 'identified', 'triage', 'status', 'spectrum', 'best_evalue', 'best_len', 'charge_used', 'precursor_mz', 'rt']
    const at = (c: Column): number => (lead.includes(c.id) ? lead.indexOf(c.id) : lead.length)
    return all.map((c, i) => ({ c, i })).sort((x, y) => at(x.c) - at(y.c) || x.i - y.i).map((x) => x.c)
  }, [tsv])
  const st = tsv.columns.indexOf('status')
  const idc = tsv.columns.indexOf('identified')
  const trc = tsv.columns.indexOf('triage')
  const sp = tsv.columns.indexOf('spectrum')
  // A census without -census_score has no ranking: it is shown in file
  // order and named as what it is. A scored census not yet sorted
  // (census_out) is sorted by its score.
  const scored = tsv.columns.includes('ident_score')
  const sorted = tsv.columns.includes('ident_rank')
  const [filter, setFilter] = useState<Filter>('all')
  const states = useMemo(() => (idc < 0 ? [] : tsv.rows.map((r) => idState(r[idc]))), [tsv, idc])
  const isCandidate = (i: number): boolean => trc >= 0 && (tsv.rows[i][trc] ?? '').trim() === '1'
  const off = (f: Filter): boolean => f !== 'all' && (f === 'candidates' ? trc < 0 : idc < 0)
  const count = (f: Filter): number =>
    f === 'all' ? tsv.rows.length : f === 'candidates' ? tsv.rows.filter((_, i) => isCandidate(i)).length : states.filter((x) => x === f).length
  const ids = useMemo(() => {
    const keep = tsv.rows
      .map((_, i) => i)
      .filter((i) => filter === 'all' || off(filter) || (filter === 'candidates' ? isCandidate(i) : states[i] === filter))
    return Uint32Array.from(keep)
  }, [tsv, filter, idc, trc, states])
  const counts = st >= 0 ? Object.entries(tsv.rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r[st]]: (m[r[st]] ?? 0) + 1 }), {})) : []
  const label = scored ? 'Spectra ranked by identifiability' : 'Per-spectrum census'
  // The shown rows to a TSV (the candidates for a second search, or any
  // other filter): every column, in the file's order; the table itself is
  // never written over.
  const [saved, setSaved] = useState<{ ok: boolean; text: string } | null>(null)
  async function exportShown(): Promise<void> {
    setSaved(null)
    const suffix = filter === 'candidates' ? 'triage_candidates' : filter === 'all' ? 'all' : filter
    const dest = await window.fastag.saveFile(`${stripExt(path)}.${suffix}.tsv`, ['tsv'])
    if (!dest) return
    if (pathKey(dest) === pathKey(path)) {
      setSaved({ ok: false, text: `Not written: ${dest} is the table shown. Choose another name.` })
      return
    }
    const clean = (v: string): string => v.replace(/[\t\r\n]+/g, ' ')
    const text = [tsv.columns.join('\t'), ...Array.from(ids, (i) => tsv.rows[i].map((v) => clean(v ?? '')).join('\t'))].join('\n') + '\n'
    try {
      await window.fastag.writeSummary(dest, text, [path])
      setSaved({ ok: true, text: `${fmtInt(ids.length)} rows written to ${dest}.` })
    } catch (e) {
      setSaved({ ok: false, text: `Could not write the rows: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
  return (
    <>
      <p className="report-sum">
        {fmtInt(tsv.rows.length)} MS2 spectra{scored ? ', ranked by how identifiable they are' : ' in file order (no identifiability score)'}
        {trc >= 0 && <>; {fmtInt(count('candidates'))} triage candidates</>}
        {counts.length > 0 && <>; tag status: {counts.map(([k, n]) => `${fmtInt(n)} ${k.replace(/_/g, ' ')}`).join(', ')}</>}.
      </p>
      <div className="row tight" role="group" aria-label="Show">
        {FILTERS.map((f) => (
          <label key={f.id} className={`seg-opt small${off(f.id) ? ' off' : ''}`} title={off(f.id) ? NO_IDS : undefined}>
            <input type="radio" name="triage-filter" checked={filter === f.id} disabled={off(f.id)} onChange={() => setFilter(f.id)} />
            {f.label}
            {!off(f.id) && f.id !== 'all' && <span className="count">{fmtInt(count(f.id))}</span>}
          </label>
        ))}
        {idc < 0 && <span className="muted">{NO_IDS}</span>}
        <button type="button" className="secondary small" disabled={ids.length === 0} onClick={() => void exportShown()}>
          {filter === 'candidates' ? 'Export candidates…' : 'Export shown rows…'}
        </button>
      </div>
      {saved && (
        <p className={saved.ok ? 'hint' : 'warn'} role="status">
          {saved.text}
        </p>
      )}
      <p className="hint">
        {scored && 'The score ranks spectra; it is not a quality call and not an error rate.'}
        {trc >= 0 && ' Triage candidates: spectra not identified whose best tag is at or below the Triage E-value, a list for a second (for example semi-specific) search.'}
        {idc >= 0 && ' Unknown: the identifications neither name nor rule out the spectrum.'}
      </p>
      <DataTable
        label={label}
        columns={columns}
        ids={ids}
        total={tsv.rows.length}
        keep={tsv}
        sort={scored && !sorted ? { column: 'ident_score', desc: true } : null}
        onOpen={openSpectrum && sp >= 0 ? (i) => openSpectrum(tsv.rows[i][sp] ?? '') : undefined}
        openLabel="Open in Spectrum"
      />
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
  /// Bumped on each open or run that wrote the file: it is read again.
  gen?: number
  /// Shortlist: the reduced FASTA and the engine configuration, when written.
  files?: { label: string; path: string }[]
  /// Triage: open the spectrum of a row (its native ID) in the Spectrum tab.
  openSpectrum?(spectrum: string): void
}

const REPORT_TITLE: Partial<Record<ReportKind, string>> = {
  qc: 'Run QC',
  shortlist: 'Protein shortlist',
  triage: 'Spectra ranked by identifiability'
}
const REPORT_HELP: Partial<Record<ReportKind, { to: string; label: string }>> = {
  qc: { to: 'workflow-run-qc', label: 'How to read the QC report' },
  shortlist: { to: 'workflow-db-reduction', label: 'How to read the shortlist' },
  triage: { to: 'workflow-triage', label: 'How to read the ranking' }
}

export default function ReportTable({ kind, path, gen, files = [], openSpectrum }: ReportTableProps): JSX.Element {
  const { tsv, error } = useReport(path, gen)
  // A census without a score is no ranking (TriageView says the same).
  const census = kind === 'triage' && !!tsv && !tsv.columns.includes('ident_score')
  const title = census ? 'Per-spectrum census' : (REPORT_TITLE[kind] ?? headText(baseName(path)))
  const help = census ? { to: 'workflow-triage', label: 'How to read the census' } : REPORT_HELP[kind]
  return (
    <div className={`report-view report-${kind}`}>
      <ReportHeader title={title} paths={[path]} help={help} />
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
        <TriageView tsv={tsv} path={path} openSpectrum={openSpectrum} />
      ) : (
        <GenericView tsv={tsv} label={baseName(path)} />
      )}
    </div>
  )
}
