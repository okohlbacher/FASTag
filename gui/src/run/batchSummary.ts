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

export const SUMMARY_COLUMNS = ['genus', 'protease', 'label', 'alkylation'] as const
export type SummaryColumn = (typeof SUMMARY_COLUMNS)[number]

/// The column headers of the table, and the TSV's names for them.
export const COLUMN_LABEL: Record<SummaryColumn, string> = {
  genus: 'Top genus',
  protease: 'Protease',
  label: 'Label',
  alkylation: 'Alkylation'
}
const TSV_NAME: Record<SummaryColumn, string> = { genus: 'top_genus', protease: 'protease', label: 'label', alkylation: 'alkylation' }

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
  return {
    tags: parseLog(d.log).tags,
    cells: {
      genus,
      protease: called(tile('protease'), p.state === 'call' ? p.enzyme : null),
      label: called(tile('label'), l.state === 'call' ? l.label : null),
      // FASTag writes no alkylation call (calls.ts): never counted.
      alkylation: { text: a.value, call: null, note: a.note }
    }
  }
}

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
}

export interface Summary {
  rows: SummaryRow[]
  majority: Record<SummaryColumn, Majority>
}

const none = (text: string, note: string): Record<SummaryColumn, Cell> =>
  Object.fromEntries(SUMMARY_COLUMNS.map((k) => [k, { text, call: null, note }])) as Record<SummaryColumn, Cell>

/// The rows of @p jobs, in queue order; @p data: what each done job wrote,
/// by its input (a done job without an entry is still being read).
export function buildSummary(jobs: readonly BatchJob[], data: ReadonlyMap<string, JobData>): Summary {
  const base = jobs.map((j) => {
    const d = j.status === 'done' ? data.get(j.input) : undefined
    const c = d ? jobCells(d) : null
    return {
      input: j.input,
      file: baseName(j.input),
      status: j.status,
      statusText: jobWords(j),
      ms: j.ms ?? null,
      tags: c ? c.tags : j.status === 'done' ? (j.tags ?? null) : null,
      cells: c
        ? c.cells
        : j.status === 'done'
          ? none('reading…', 'its reports are being read')
          : none('—', j.status === 'failed' ? 'the job failed: no reports' : j.status === 'cancelled' ? 'the job was cancelled' : 'not run yet'),
      tagsPath: j.status === 'done' ? (j.outputs?.out ?? j.out) : null
    }
  })
  const maj = Object.fromEntries(SUMMARY_COLUMNS.map((k) => [k, majority(base.map((r) => r.cells[k].call))])) as Record<SummaryColumn, Majority>
  const rows: SummaryRow[] = base.map((r) => ({
    ...r,
    differs: Object.fromEntries(
      SUMMARY_COLUMNS.map((k) => {
        const m = maj[k].value
        const c = r.cells[k].call
        return [k, m != null && c != null && c !== m]
      })
    ) as Record<SummaryColumn, boolean>
  }))
  return { rows, majority: maj }
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
  const head = ['file', 'input', 'status', 'duration_s', 'tags', ...SUMMARY_COLUMNS.flatMap((k) => [TSV_NAME[k], `${TSV_NAME[k]}_differs`]), 'tags_tsv']
  const lines = s.rows.map((r) =>
    [
      r.file,
      r.input,
      r.statusText,
      r.ms == null ? '' : String(Math.round(r.ms / 100) / 10),
      r.tags == null ? '' : String(r.tags),
      ...SUMMARY_COLUMNS.flatMap((k) => [r.cells[k].text, r.differs[k] ? 'yes' : '']),
      r.tagsPath ?? ''
    ]
      .map(tsvCell)
      .join('\t')
  )
  return [head.join('\t'), ...lines, ''].join('\n')
}
