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
import { alkylationCall as alkylationReportCall } from '../digestReport'
import { censusFacts, labelCall, proteaseCall, speciesCall, parseLog, tiedLeaders, unassessedKits } from '../results/calls'
import { buildOverview, keyValues, reportRank, shortlistFacts, topShift, triageFacts, type Tile } from '../results/overview'
import { jobWords, type BatchJob } from './batch'

/// A column has a majority only over at least this many calls.
export const MIN_CALLS = 3

/// The calls of a characterizing batch (the default columns).
export const SUMMARY_COLUMNS = ['genus', 'protease', 'label', 'alkylation'] as const
/// The key figures of a Run QC batch, from each job's QC report: what a
/// comparison across files needs (doc/GUI-WORKFLOWS.md 1, Batch).
export const QC_COLUMNS = ['ms2', 'yield', 'charge', 'analyzer', 'instrument', 'kit'] as const
/// The key figures of the other workflows, each from its own report: the
/// log's counts (Generate tags), the mass-shift accounting and table, the
/// shortlist, the identifiability summary.
export const WORKFLOW_COLUMNS = ['spectra', 'tagRate', 'placed', 'topShift', 'kept', 'config', 'censusTagged', 'identScore', 'glyco'] as const
export type SummaryColumn = (typeof SUMMARY_COLUMNS)[number] | (typeof QC_COLUMNS)[number] | (typeof WORKFLOW_COLUMNS)[number]

/// The columns of a batch of @p workflow: its key columns.
export function columnsFor(workflow?: string | null): readonly SummaryColumn[] {
  switch (workflow) {
    case 'run-qc':
      return QC_COLUMNS
    case 'species':
      return ['genus']
    case 'export-tags':
      return ['spectra', 'tagRate']
    case 'mass-shift':
      return ['spectra', 'placed', 'topShift']
    case 'db-reduction':
      return ['kept', 'config']
    case 'triage':
      return ['spectra', 'identScore', 'censusTagged']
    default:
      // Characterize: its calls, and the glycopeptide screen it runs by default.
      return ['genus', 'protease', 'label', 'glyco', 'alkylation']
  }
}

/// The column headers of the table, and the TSV's names for them.
export const COLUMN_LABEL: Record<SummaryColumn, string> = {
  genus: 'Top genus',
  protease: 'Protease',
  label: 'Label',
  alkylation: 'Alkylation',
  ms2: 'MS2 spectra',
  yield: 'Tagged (E ≤ 0.01)',
  charge: 'Charges 2+ / 3+ / 4+',
  analyzer: 'Analyzer, resolution',
  instrument: 'Instrument',
  kit: 'Isobaric kit',
  spectra: 'MS2 spectra',
  tagRate: 'Tags per MS2 spectrum',
  placed: 'Placed spectra',
  topShift: 'Top mass shift',
  kept: 'Proteins kept',
  config: 'Engine configuration',
  censusTagged: 'Tagged spectra',
  identScore: 'Median identifiability',
  glyco: 'Glyco flagged'
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
  kit: 'isobaric_kit',
  spectra: 'ms2_processed',
  tagRate: 'tags_per_ms2',
  placed: 'placed_spectra',
  topShift: 'top_mass_shift',
  kept: 'proteins_kept',
  config: 'engine_configuration',
  censusTagged: 'tagged_spectra',
  identScore: 'median_ident_score',
  glyco: 'glyco_flagged'
}

/// The header of column @p k for a batch whose species reports are at
/// @p rank: Top family for a family-rank report.
export function columnLabel(k: SummaryColumn, rank = 'genus'): string {
  return k === 'genus' ? `Top ${rank}` : COLUMN_LABEL[k]
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
  /// The texts of its other workflow reports, when it wrote them: the
  /// mass-shift accounting and table, the protein shortlist; config: its
  /// engine configuration was written (null: none was asked for).
  deltaCounts?: string | null
  delta?: string | null
  shortlist?: string | null
  /// The text of its identifiability ranking (census_sorted_out).
  triage?: string | null
  config?: boolean | null
  /// The reports the job was sent (a path in its resolved outputs) that
  /// could not be read or parsed, with why: their cells say so, not that
  /// the report was not written or the detection was off.
  unread?: Partial<Record<SentReport, string>>
  /// Reading the job's reports failed as a whole, with why.
  failed?: string
}

/// The reports a summary cell reads, by the output that names them.
export type SentReport =
  | 'digest_out'
  | 'label_out'
  | 'massgap_out'
  | 'alkylation_out'
  | 'qc_out'
  | 'species_out'
  | 'delta_out'
  | 'delta_counts_out'
  | 'shortlist_out'
  | 'census_summary_out'
  | 'census_sorted_out'

/// The QC cells of a job, from its QC report (section, key, value, n): the
/// figures as the report states them; only the instrument and the isobaric
/// kit are categories a majority can count.
export function qcCells(text: string | null | undefined): Record<(typeof QC_COLUMNS)[number], Cell> {
  const rows = new Map<string, string>()
  const notes = new Map<string, string>()
  for (const line of (text ?? '').split(/\r?\n/).slice(1)) {
    const f = line.split('\t')
    if (f.length >= 3 && !rows.has(f[1])) {
      rows.set(f[1], f[2])
      if (f[4]) notes.set(f[1], f[4])
    }
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
  // The analyzers that took MS2 spectra, each with its resolution.
  const analyzers = [...rows.keys()].filter((k) => /^count_ms2_./.test(k) && (num(rows.get(k)) ?? 0) > 0).map((k) => k.slice('count_ms2_'.length))
  const res = (a: string): string => {
    const v = get(`resolution_${a}_ms2`)
    return v && v !== 'n/a' ? ` ${v}` : ''
  }
  const instrument = get('instrument_model')
  const kit = get('reporter_compatible_kits')
  // RunQC writes "none" whenever no kit is compatible, also when no kit
  // could be assessed: the reporter_<kit> states tell the two apart. Not
  // assessable is no call, and stays out of the majority.
  const why = unassessedKits(kit, [...rows].map(([key, value]) => ({ key, value, desc: notes.get(key) ?? '' })))
  const kitCell: Cell =
    kit == null
      ? none('isobaric kit row')
      : why
        ? { text: 'Not assessable', call: null, note: `no kit could be assessed${why.length ? `: ${why.join('; ')}` : ''}` }
        : { text: kit, call: kit, note: 'isobaric kits whose reporters are present' }
  return {
    ms2: ms2 == null ? none('MS2 count') : { text: ms2.toLocaleString('en-US'), call: null, note: 'MS2 spectra read' },
    yield: y == null ? none('tag yield') : { text: `${(y * 100).toFixed(1)}%`, call: null, note: 'share of MS2 spectra with a tag of E-value ≤ 0.01' },
    charge: { text: [2, 3, 4].map(share).join(' / '), call: null, note: 'shares of the precursor charges 2, 3 and 4' },
    analyzer: analyzers.length ? { text: analyzers.map((a) => `${a}${res(a)}`).join(', '), call: null, note: 'the analyzers of the MS2 spectra, with the resolution stated or measured' } : none('analyzer counts'),
    instrument: instrument && instrument !== 'n/a' ? { text: instrument, call: instrument, note: 'the instrument model the file names' } : none('instrument model'),
    kit: kitCell
  }
}


const fmtN = (n: number): string => n.toLocaleString('en-US')

/// The cells of the other workflows (WORKFLOW_COLUMNS), each from the
/// report it reads; a report not written says so.
export function workflowCells(d: JobData): Record<(typeof WORKFLOW_COLUMNS)[number], Cell> {
  const log = parseLog(d.log)
  const off = (what: string): Cell => ({ text: 'not written', call: null, note: `the job wrote no ${what}` })
  const spectra: Cell = log.ms2 == null ? { text: '–', call: null, note: 'the log has no summary line' } : { text: fmtN(log.ms2), call: null, note: 'MS2 spectra processed by the tagger' }
  const tagRate: Cell =
    log.ms2 && log.tags != null
      ? { text: (log.tags / log.ms2).toFixed(1), call: null, note: `${fmtN(log.tags)} tags over ${fmtN(log.ms2)} MS2 spectra` }
      : { text: '–', call: null, note: 'the log has no tag count' }
  const dc = keyValues(d.deltaCounts)
  const placedN = dc.get('ms2_placed')
  const placed: Cell = !d.deltaCounts
    ? off('mass-shift accounting')
    : placedN === undefined
      ? { text: 'not in the report', call: null, note: 'the accounting has no ms2_placed row' }
      : { text: `${fmtN(Number(placedN))} of ${fmtN(Number(dc.get('ms2_tagged') ?? 0))}`, call: null, note: 'MS2 spectra placed on the database, of those tagged' }
  const shift = topShift(d.delta)
  const topShiftCell: Cell = !d.delta
    ? off('mass-shift table')
    : shift
      ? {
          text: `${Number(shift.delta) > 0 ? '+' : ''}${shift.delta} Da${shift.name ? ` (${shift.name})` : ''}`,
          // A category the majority can count: the name, else the shift.
          call: shift.name ?? shift.delta,
          note: `${fmtN(shift.spectra)} spectra; a candidate, not an identified modification`
        }
      : { text: 'none', call: null, note: 'the table has no shift away from 0' }
  const sl = shortlistFacts(d.shortlist)
  const kept: Cell = !d.shortlist ? off('protein shortlist') : sl ? { text: `${fmtN(sl.kept)} of ${fmtN(sl.of)}`, call: null, note: 'proteins kept of those with tag evidence; not an identification' } : { text: 'not in the report', call: null, note: 'the shortlist names no protein' }
  const config: Cell =
    d.config == null ? { text: 'not asked for', call: null, note: 'the job was not sent a search-engine configuration' } : d.config ? { text: 'written', call: null, note: 'the search-engine configuration exists' } : { text: 'not written', call: null, note: 'the search-engine configuration was asked for and not written; the log says why' }
  const cf = d.census ? censusFacts(d.census) : null
  const censusTagged: Cell = !d.census
    ? off('identifiability summary')
    : cf
      ? { text: `${fmtN(cf.tagged)} of ${fmtN(cf.read)}${cf.taggedShare != null ? ` (${(cf.taggedShare * 100).toFixed(1)}%)` : ''}`, call: null, note: 'MS2 spectra with a reported tag (identifiability summary); a batch uses no identifications' }
      : { text: 'not in the report', call: null, note: 'the summary has no census counts' }
  const tf = d.triage ? triageFacts(d.triage) : null
  const identScore: Cell = !d.triage
    ? off('identifiability ranking')
    : tf && tf.median != null
      ? { text: tf.median.toFixed(3), call: null, note: `the middle score of ${fmtN(tf.ranked)} ranked MS2 spectra (0 to 1); an experimental ranking, not a quality call` }
      : { text: 'not in the report', call: null, note: 'the ranking has no identifiability score' }
  const g = log.glyco
  const glycoOn = d.params['glyco'] === true || (typeof d.params['glyco_out'] === 'string' && d.params['glyco_out'] !== '')
  const glyco: Cell = g
    ? { text: `${fmtN(g.flagged)} of ${fmtN(g.of)}${g.of ? ` (${((g.flagged / g.of) * 100).toFixed(1)}%)` : ''}`, call: null, note: 'MS2 spectra with oxonium ions; evidence, not an identification' }
    : glycoOn
      ? { text: '–', call: null, note: 'the log has no glyco line' }
      : off('glycopeptide report')
  return { spectra, tagRate, placed, topShift: topShiftCell, kept, config, censusTagged, identScore, glyco }
}

export interface Cell {
  /// What the cell shows, and the TSV writes.
  text: string
  /// The CLI's call the majority counts; null: none (no call, not
  /// assessed, too little evidence, a ranking, a job without reports).
  call: string | null
  /// Its cutoff or caveat (the Overview tile's note).
  note: string
  /// The genus cell: a call of present taxa tied at the top (tiedLeaders),
  /// their names. No single call: it stays out of the majority.
  tied?: string[]
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
  const sp = speciesCall(d.species, reportRank(d.species, d.params['species_rank']))
  const g = tile('genus')
  const genus: Cell =
    sp.state === 'ranked'
      ? // The top of the ranking, not a presence call: shown, never counted.
        { text: g.tone === 'call' ? `${g.value} (ranking)` : g.value, call: null, note: g.note }
      : sp.state === 'called' && tiedLeaders(sp.present).length > 1
        ? // A tie at the top is no single call: its first taxon is arbitrary.
          { ...called(g, null), ...(g.tone === 'call' ? { tied: tiedLeaders(sp.present).map((t) => t.name) } : {}) }
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
  const w = workflowCells(d)
  // The alkylation report's call when one was written (it counts for the
  // majority); else the mass-gap counts, which are no call.
  const alkReport = kind('alkylation')
  const alk = alkReport ? alkylationReportCall(alkReport) : null
  const alkylation: Cell = alkReport || d.unread?.alkylation_out
    ? or('alkylation_out', { text: a.value, call: alk?.status === 'call' && a.tone === 'call' ? (alk.reagent ?? null) : null, note: a.note })
    : or('massgap_out', { text: a.value, call: null, note: a.note })
  return {
    tags: parseLog(d.log).tags,
    cells: {
      ...qc,
      ...w,
      ms2: or('qc_out', qc.ms2),
      placed: or('delta_counts_out', w.placed),
      topShift: or('delta_out', w.topShift),
      kept: or('shortlist_out', w.kept),
      censusTagged: or('census_summary_out', w.censusTagged),
      identScore: or('census_sorted_out', w.identScore),
      genus: or('species_out', genus),
      protease: or('digest_out', called(tile('protease'), p.state === 'call' ? p.enzyme : null)),
      label: or('label_out', called(tile('label'), l.state === 'call' ? l.label : null)),
      alkylation
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
  /// The rank of the species reports (the genus column's header).
  rank?: string
  rows: SummaryRow[]
  majority: Record<SummaryColumn, Majority>
}

const ALL_COLUMNS: readonly SummaryColumn[] = [...SUMMARY_COLUMNS, ...QC_COLUMNS, ...WORKFLOW_COLUMNS]
const none = (text: string, note: string): Record<SummaryColumn, Cell> =>
  Object.fromEntries(ALL_COLUMNS.map((k) => [k, { text, call: null, note }])) as Record<SummaryColumn, Cell>

/// The rows of @p jobs, in queue order; @p data: what each done job wrote,
/// by its input (a done job with outputs and without an entry is still being
/// read).
/// The columns of a batch whose jobs ran with @p workflows: one workflow's
/// own, or for a batch that mixed workflows (the form changed between two
/// passes) the columns of each, in the order they ran, each once.
export function columnsOfRuns(workflows: readonly (string | null)[]): readonly SummaryColumn[] {
  const seen = [...new Set(workflows)]
  if (seen.length <= 1) return columnsFor(seen[0] ?? null)
  return [...new Set(seen.flatMap((w) => columnsFor(w)))]
}

/// @p workflow: the batch's workflow, which picks the columns (columnsFor),
/// or the workflows its jobs ran with (columnsOfRuns).
export function buildSummary(jobs: readonly BatchJob[], data: ReadonlyMap<string, JobData>, workflow?: string | readonly (string | null)[] | null): Summary {
  const all = Array.isArray(workflow) ? columnsOfRuns(workflow) : columnsFor(workflow as string | null | undefined)
  // Alkylation is off by default: its column only when a job asked for the
  // alkylation or mass-gap report (the Overview shows its tile alike).
  const sent = (d: JobData, k: string): boolean => typeof d.params[k] === 'string' && d.params[k] !== ''
  const alkAsked = [...data.values()].some((d) => sent(d, 'alkylation_out') || sent(d, 'massgap_out'))
  const columns = alkAsked ? all : all.filter((c) => c !== 'alkylation')
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
  // The rank of the first species report read (its own, or the asked one).
  const first = [...data.values()].find((d) => d.species)
  const rank = first ? reportRank(first.species, first.params['species_rank']) : 'genus'
  return { columns, rows, majority: maj, rank }
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
  const name = (k: SummaryColumn): string => (k === 'genus' && s.rank && s.rank !== 'genus' ? `top_${s.rank}` : TSV_NAME[k])
  const head = ['file', 'input', 'status', 'duration_s', 'tags', ...cols.flatMap((k) => [name(k), `${name(k)}_differs`]), 'tags_tsv']
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
