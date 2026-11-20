// The batch summary table (GUI-DESIGN 3 S6, 10 P2b): one row per job, read
// from the reports that job wrote, with the calls the Overview states for
// it (results/overview.ts over calls.ts), so a row says what that run's
// Overview says. The GUI makes no call of its own (Q2): a cell holds the
// CLI's call, its no call, or "not assessed"; the only rule here is the
// design's majority flag:
//
// - a column has a majority when at least MIN_CALLS jobs have a call in it
//   and one value is more than half of those calls (a tie or a plurality is
//   no majority);
// - a call that differs from that majority is flagged; a no call, a call
//   held back for too little evidence, a ranking that is not a presence
//   call, a failed or a queued job is never flagged and never counts.
//
// Pure, for vitest; the summary TSV is the table's text, cell for cell.

import { baseName, type Report } from '../digestReport'
import type { SpeciesReport } from '../types'
import { labelCall, proteaseCall, speciesCall, parseLog } from '../results/calls'
import { buildOverview, type Tile } from '../results/overview'
import { jobWords, type BatchJob } from './batch'

/// A column has a majority only over at least this many calls.
export const MIN_CALLS = 3

/// The calls of a characterizing batch (the default columns).
export const SUMMARY_COLUMNS = ['genus', 'protease', 'label', 'alkylation'] as const
/// The key figures of a Run QC batch, from each job's QC report: what a
/// comparison across files needs (doc/GUI-WORKFLOWS.md 1, Batch).
export const QC_COLUMNS = ['ms2', 'yield', 'charge', 'analyzer', 'instrument', 'kit'] as const
export type SummaryColumn = (typeof SUMMARY_COLUMNS)[number] | (typeof QC_COLUMNS)[number]

/// The columns of a batch of @p workflow: its key columns.
export function columnsFor(workflow?: string | null): readonly SummaryColumn[] {
  if (workflow === 'run-qc') return QC_COLUMNS
  if (workflow === 'species') return ['genus']
  return SUMMARY_COLUMNS
}

/// The column headers of the table, and the TSV's names for them.
export const COLUMN_LABEL: Record<SummaryColumn, string> = {
  genus: 'Top genus',
  protease: 'Protease',
  label: 'Label',
  alkylation: 'Alkylation',
  ms2: 'MS/MS spectra',
  yield: 'Tagged (E ≤ 0.01)',
  charge: 'Charges 2+ / 3+ / 4+',
  analyzer: 'Analyzer, resolution',
  instrument: 'Instrument',
  kit: 'Isobaric kit'
}
const TSV_NAME: Record<SummaryColumn, string> = {
  genus: 'top_genus',
  protease: 'protease',
  label: 'label',
  alkylation: 'alkylation',
  ms2: 'ms2_spectra',
  yield: 'tag_yield',
  charge: 'charge_2_3_4',
  analyzer: 'analyzer_resolution',
  instrument: 'instrument',
  kit: 'isobaric_kit'
}

/// What one finished job wrote, as useRun read it.
export interface JobData {
  log: readonly string[]
  reports: readonly Report[]
  species: SpeciesReport | null
  /// The census summary's text (-census), if read; the log's census line
  /// counts the tagged spectra otherwise.
  census: string | null
  /// The parameters the job was sent.
  params: Record<string, unknown>
  /// The text of its QC report (qc_out), when it wrote one.
  qc?: string | null
  /// The reports the job was sent (a path in its resolved outputs) that
  /// could not be read or parsed, with why: their cells say so, not that
  /// the report was not written or the detection was off.
  unread?: Partial<Record<SentReport, string>>
  /// Reading the job's reports failed as a whole, with why.
  failed?: string
}

/// The reports a summary cell reads, by the output that names them.
export type SentReport = 'digest_out' | 'label_out' | 'massgap_out' | 'alkylation_out' | 'qc_out' | 'species_out'

/// The QC cells of a job, from its QC report (section, key, value, n): the
/// figures as the report states them; only the instrument and the isobaric
/// kit are categories a majority can count.
export function qcCells(text: string | null | undefined): Record<(typeof QC_COLUMNS)[number], Cell> {
  const rows = new Map<string, string>()
  for (const line of (text ?? '').split(/\r?\n/).slice(1)) {
    const f = line.split('\t')
    if (f.length >= 3 && !rows.has(f[1])) rows.set(f[1], f[2])
  }
  const get = (k: string): string | undefined => rows.get(k)
  const none = (what: string): Cell => ({ text: 'not in the report', call: null, note: `the QC report has no ${what}` })
  if (!text) {
    const off: Cell = { text: 'not written', call: null, note: 'the job wrote no QC report' }
    return { ms2: off, yield: off, charge: off, analyzer: off, instrument: off, kit: off }
  }
  const num = (v: string | undefined): number | null => (v != null && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
  const ms2 = num(get('count_ms2'))
  const y = num(get('tag_yield'))
  const share = (z: number): string => {
    const v = num(get(`precursor_charge_${z}_share`))
    return v == null ? '–' : `${Math.round(v * 100)}%`
  }
  // The analyzers that took MS/MS spectra, each with its resolution.
  const analyzers = [...rows.keys()].filter((k) => /^count_ms2_./.test(k) && (num(rows.get(k)) ?? 0) > 0).map((k) => k.slice('count_ms2_'.length))
  const res = (a: string): string => {
    const v = get(`resolution_${a}_ms2`)
    return v && v !== 'n/a' ? ` ${v}` : ''
  }
  const instrument = get('instrument_model')
  const kit = get('reporter_compatible_kits')
  return {
    ms2: ms2 == null ? none('MS/MS count') : { text: ms2.toLocaleString('en-US'), call: null, note: 'MS/MS spectra read' },
    yield: y == null ? none('tag yield') : { text: `${(y * 100).toFixed(1)}%`, call: null, note: 'share of MS/MS spectra with a tag of E-value ≤ 0.01' },
    charge: { text: [2, 3, 4].map(share).join(' / '), call: null, note: 'shares of the precursor charges 2, 3 and 4' },
    analyzer: analyzers.length ? { text: analyzers.map((a) => `${a}${res(a)}`).join(', '), call: null, note: 'the analyzers of the MS/MS spectra, with the resolution stated or measured' } : none('analyzer counts'),
    instrument: instrument && instrument !== 'n/a' ? { text: instrument, call: instrument, note: 'the instrument model the file names' } : none('instrument model'),
    kit: kit != null ? { text: kit === 'none' ? 'none' : kit, call: kit, note: 'isobaric kits whose reporters are present' } : none('isobaric kit row')
  }
}

export interface Cell {
  /// What the cell shows, and the TSV writes.
  text: string
  /// The CLI's call the majority counts; null: none (no call, not
  /// assessed, too little evidence, a ranking, a job without reports).
  call: string | null
  /// Its cutoff or caveat (the Overview tile's note).
  note: string
}

export interface Majority {
  value: string | null
  /// The jobs with a call in the column, and how many of them have value.
  calls: number
  count: number
  /// few: fewer than MIN_CALLS calls; split: no value has more than half.
  why: 'majority' | 'few' | 'split'
}

/// The majority of @p calls (null: no call), by the n >= 3 rule.
export function majority(calls: readonly (string | null)[]): Majority {
  const have = calls.filter((c): c is string => c != null)
  if (have.length < MIN_CALLS) return { value: null, calls: have.length, count: 0, why: 'few' }
  const n = new Map<string, number>()
  for (const c of have) n.set(c, (n.get(c) ?? 0) + 1)
  let best: string | null = null
  let count = 0
  for (const [v, k] of n)
    if (k > count) {
      best = v
      count = k
    }
  return 2 * count > have.length ? { value: best, calls: have.length, count, why: 'majority' } : { value: null, calls: have.length, count, why: 'split' }
}

/// The cells of a finished job, from what it wrote.
export function jobCells(d: JobData): { tags: number | null; cells: Record<SummaryColumn, Cell> } {
  const o = buildOverview({ log: d.log, reports: d.reports, species: d.species, census: d.census, params: d.params, instrument: null })
  const tile = (id: string): Tile => o.calls.find((t) => t.id === id)!
  const kind = (k: Report['kind']): Report | undefined => d.reports.find((r) => r.kind === k)
  // Only a call the Overview states as one (tone call: not held back).
  const called = (t: Tile, key: string | null): Cell => ({ text: t.value, call: t.tone === 'call' ? key : null, note: t.note })

  const p = proteaseCall(kind('digest'))
  const l = labelCall(kind('label'))
  const sp = speciesCall(d.species)
  const g = tile('genus')
  const genus: Cell =
    sp.state === 'ranked'
      ? // The top of the ranking, not a presence call: shown, never counted.
        { text: g.tone === 'call' ? `${g.value} (ranking)` : g.value, call: null, note: g.note }
      : called(g, sp.state === 'called' && sp.present.length > 0 ? sp.present[0].name : null)
  const a = tile('alkylation')
  // A report the job was sent that could not be read: its cell says that,
  // with the reason, and never counts.
  const or = (k: SentReport, c: Cell): Cell => {
    const why = d.unread?.[k]
    if (!why) return c
    return why.startsWith(NOT_READ) ? { text: 'not read', call: null, note: why.slice(NOT_READ.length) } : { text: 'unreadable', call: null, note: why }
  }
  const qc = qcCells(d.qc)
  return {
    tags: parseLog(d.log).tags,
    cells: {
      ...qc,
      ms2: or('qc_out', qc.ms2),
      genus: or('species_out', genus),
      protease: or('digest_out', called(tile('protease'), p.state === 'call' ? p.enzyme : null)),
      label: or('label_out', called(tile('label'), l.state === 'call' ? l.label : null)),
      // FASTag writes no alkylation call (calls.ts): never counted.
      alkylation: or('massgap_out', { text: a.value, call: null, note: a.note })
    }
  }
}

/// The start of an unread entry for a report the job was sent that gave no
/// content (the backend does not say whether it is missing or unreadable).
export const NOT_READ = 'not read: '

export interface SummaryRow {
  input: string
  file: string
  status: BatchJob['status']
  /// The queue's words for the status (batch.ts jobWords).
  statusText: string
  ms: number | null
  tags: number | null
  cells: Record<SummaryColumn, Cell>
  differs: Record<SummaryColumn, boolean>
  /// The job's tags table, once it is done.
  tagsPath: string | null
  /// A done job whose outputs the app knows: it can be opened in Results.
  canOpen: boolean
}

export interface Summary {
  /// The columns shown and exported: the workflow's key columns.
  columns: readonly SummaryColumn[]
  rows: SummaryRow[]
  majority: Record<SummaryColumn, Majority>
}

const ALL_COLUMNS: readonly SummaryColumn[] = [...SUMMARY_COLUMNS, ...QC_COLUMNS]
const none = (text: string, note: string): Record<SummaryColumn, Cell> =>
  Object.fromEntries(ALL_COLUMNS.map((k) => [k, { text, call: null, note }])) as Record<SummaryColumn, Cell>

/// The rows of @p jobs, in queue order; @p data: what each done job wrote,
/// by its input (a done job with outputs and without an entry is still being
/// read).
/// @p workflow: the batch's workflow, which picks the columns (columnsFor).
export function buildSummary(jobs: readonly BatchJob[], data: ReadonlyMap<string, JobData>, workflow?: string | null): Summary {
  const columns = columnsFor(workflow)
  const base = jobs.map((j) => {
    const done = j.status === 'done'
    const d = done && j.outputs ? data.get(j.input) : undefined
    const c = d && !d.failed ? jobCells(d) : null
    const doneCells = (): Record<SummaryColumn, Cell> =>
      // Done without outputs (runJob.ts): the reply naming them never came.
      !j.outputs
        ? none('—', 'the app did not learn where this run wrote its outputs; open them with Open a tags TSV…')
        : d?.failed
          ? none('unreadable', `its reports could not be read: ${d.failed}`)
          : none('reading…', 'its reports are being read')
    return {
      input: j.input,
      file: baseName(j.input),
      status: j.status,
      statusText: jobWords(j),
      ms: j.ms ?? null,
      tags: c ? c.tags : j.status === 'done' ? (j.tags ?? null) : null,
      cells: c
        ? c.cells
        : done
          ? doneCells()
          : none('—', j.status === 'failed' ? 'the job failed: no reports' : j.status === 'cancelled' ? 'the job was cancelled' : 'not run yet'),
      tagsPath: done ? (j.outputs?.out ?? j.out) : null,
      canOpen: done && !!j.outputs?.out
    }
  })
  const maj = Object.fromEntries(ALL_COLUMNS.map((k) => [k, majority(base.map((r) => r.cells[k].call))])) as Record<SummaryColumn, Majority>
  const rows: SummaryRow[] = base.map((r) => ({
    ...r,
    differs: Object.fromEntries(
      ALL_COLUMNS.map((k) => {
        const m = maj[k].value
        const c = r.cells[k].call
        return [k, m != null && c != null && c !== m]
      })
    ) as Record<SummaryColumn, boolean>
  }))
  return { columns, rows, majority: maj }
}

/// The majority of a column in words, for the table's foot.
export function majorityWords(m: Majority): string {
  if (m.why === 'majority') return `${m.value} (${m.count} of ${m.calls} calls)`
  if (m.why === 'split') return `no majority (${m.calls} calls, none more than half)`
  return m.calls === 0 ? 'no majority (no calls)' : `no majority (${m.calls} ${m.calls === 1 ? 'call' : 'calls'}, fewer than ${MIN_CALLS})`
}

// A TSV cell: a tab or a line break would split it.
const tsvCell = (s: string): string => s.replace(/[\t\r\n]+/g, ' ')

/// The summary TSV: a header, then one line per row with the table's text;
/// each call column is followed by "yes" where it differs from the majority.
export function summaryTsv(s: Summary): string {
  const cols = s.columns ?? SUMMARY_COLUMNS
  const head = ['file', 'input', 'status', 'duration_s', 'tags', ...cols.flatMap((k) => [TSV_NAME[k], `${TSV_NAME[k]}_differs`]), 'tags_tsv']
  const lines = s.rows.map((r) =>
    [
      r.file,
      r.input,
      r.statusText,
      r.ms == null ? '' : String(Math.round(r.ms / 100) / 10),
      r.tags == null ? '' : String(r.tags),
      ...cols.flatMap((k) => [r.cells[k].text, r.differs[k] ? 'yes' : '']),
      r.tagsPath ?? ''
    ]
      .map(tsvCell)
      .join('\t')
  )
  return [head.join('\t'), ...lines, ''].join('\n')
}
