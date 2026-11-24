// The Run QC page as a model (pure): headline tiles, the data of the small
// charts (spectra per MS level by analyser, precursor charges, resolution by
// m/z band, reporter assessability, reporter channels), the caveats worth a
// line, and every other row grouped for the "All values" disclosure. The
// kit is the existing kit call (calls.ts kitCallOf, reporterChannels and
// ReportTable qcSummary), not decided again here. Older reports (qc_version
// 1 and 2) have no kit call and no per-channel rows: the kit tile is the
// compatible-kits fallback and the channels come from reporter_observed_*.

import { evidenceText, kitCallOf, reporterChannels, type ReporterChannel } from './calls'

export interface Row {
  sec: string
  key: string
  value: string
  n: string
  desc: string
}
/// One entry of qcSummary (ReportTable.tsx).
export interface SummaryItem {
  label: string
  value: string
  title?: string
  /// A conflict of label mass and reporter channels: a warning, not a kit.
  warn?: boolean
}
/// One line of qcLines (ReportTable.tsx): a count merged with its share.
export interface Line {
  key: string
  label: string
  value: string
  n: string
  desc: string
  empty: boolean
}

export type Tone = 'tag' | 'peaks' | 'gap' | 'muted'

const num = (v: string | undefined): number | null => (v != null && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
export const int = (n: number): string => Math.round(n).toLocaleString('en-US')
export const pctText = (share: number, d = 1): string => `${(share * 100).toFixed(d)}%`

// ---- tiles ---------------------------------------------------------------------

export interface Tile {
  label: string
  value: string
  title?: string
  /// A line under the value (context, not a second headline).
  sub?: string
  /// A share drawn as a thin bar (0..1).
  meter?: number
  /// Said with the flag colour: no kit call (ambiguous, not assessable).
  low?: boolean
  /// Said as a warning: the label mass and the reporter channels disagree.
  warn?: boolean
}

/// "2010-06-15T19:01:07Z" as "2010-06-15 19:01".
export const shortTime = (t: string): string => {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(t)
  return m ? `${m[1]} ${m[2]}` : t
}

/** The headline tiles: qcSummary's entries, the serial number and start time
 *  folded under the instrument, plus redundancy. @p summary is
 *  qcSummary(rows); the values of its entries are kept as they are. */
export function qcTiles(rows: Row[], summary: SummaryItem[]): Tile[] {
  const get = (k: string): Row | undefined => rows.find((r) => r.key === k)
  const has = (label: string): boolean => summary.some((s) => s.label === label)
  const out: Tile[] = []
  for (const s of summary) {
    const t: Tile = { ...s }
    if (s.label === 'MS2 spectra') {
      const read = num(get('spectra_read')?.value)
      const input = num(get('spectra_input')?.value)
      if (read != null) t.sub = get('subsampled')?.value === '1' && input != null ? `of ${int(read)} read (subsampled from ${int(input)})` : `of ${int(read)} spectra read`
    } else if (s.label === 'Tagged (E ≤ 0.01)') {
      const y = num(get('tag_yield')?.value)
      if (y != null) t.meter = Math.max(0, Math.min(1, y))
    } else if (s.label === 'Instrument') {
      const serial = get('instrument_serial_number')?.value
      const start = get('start_timestamp')?.value
      t.sub = [serial && `serial ${serial}`, start && `started ${shortTime(start)}`].filter(Boolean).join(' · ') || undefined
      t.title = [s.title, serial && `Serial number ${serial}.`, start && `Started ${start}.`].filter(Boolean).join(' ')
    } else if ((s.label === 'Serial' || s.label === 'Started') && has('Instrument')) continue
    else if (s.label === 'Isobaric kit') t.low = s.value === 'Not assessable' || s.value.startsWith('Ambiguous')
    out.push(t)
  }
  const red = num(get('redundancy_share')?.value)
  if (red != null) {
    const tag = num(get('redundancy_tag_share')?.value)
    const v = (k: string): string => get(k)?.value ?? '?'
    out.push({
      label: 'Redundancy',
      value: pctText(red),
      meter: Math.max(0, Math.min(1, red)),
      sub: tag != null ? `same best tag: ${pctText(tag)}` : undefined,
      title:
        `Redundant MS2 in spectrum clusters: ${v('redundancy_clusters')} clusters, the largest of ${v('redundancy_largest')} spectra.` +
        (tag != null ? ` Same best tag: ${v('redundancy_tag_clusters')} clusters, the largest of ${v('redundancy_tag_largest')}.` : '')
    })
  }
  return out
}

/// The rows the tiles say (besides qcSummary's own, summaryKeys).
export const TILE_KEYS = ['instrument_serial_number', 'start_timestamp', 'redundancy_share', 'redundancy_tag_share']

// ---- MS levels by analyser -----------------------------------------------------

export interface Segment {
  id: string
  label: string
  value: number
  tone: Tone
}
export interface Stack {
  label: string
  total: number
  segments: Segment[]
  note?: string
}

const ANALYZER_TONE: Record<string, Tone> = { FTMS: 'tag', ITMS: 'peaks', TOF: 'gap' }
const ANALYZER_WORDS: Record<string, string> = { FTMS: 'FTMS (Orbitrap, FT-ICR)', ITMS: 'ITMS (ion trap)', TOF: 'TOF', unknown: 'unknown analyser' }
export const analyzerText = (a: string): string => ANALYZER_WORDS[a] ?? a

/** One bar per MS level with spectra (count_ms<L>), split by analyser class
 *  (count_ms<L>_<class>); what the classes leave is "unknown". */
export function msLevels(rows: Row[]): Stack[] {
  const out: Stack[] = []
  for (const r of rows) {
    const m = /^count_ms(\d+)$/.exec(r.key)
    const total = num(r.value)
    if (!m || total == null || total <= 0) continue
    const segments: Segment[] = rows.flatMap((s) => {
      const a = new RegExp(`^count_ms${m[1]}_(.+)$`).exec(s.key)
      const v = num(s.value)
      return a && v != null && v > 0 ? [{ id: a[1], label: a[1], value: v, tone: ANALYZER_TONE[a[1]] ?? 'muted' }] : []
    })
    const rest = total - segments.reduce((n, s) => n + s.value, 0)
    if (rest > 0) segments.push({ id: 'unknown', label: 'unknown', value: rest, tone: 'muted' })
    const sps = m[1] === '3' ? num(rows.find((x) => x.key === 'sps_ms3')?.value) : null
    out.push({ label: `MS${m[1]}`, total, segments, note: sps ? `SPS ${int(sps)}` : undefined })
  }
  return out
}

// ---- precursor charge ----------------------------------------------------------

export interface Bar {
  id: string
  label: string
  value: number
  share: number | null
  n: number | null
  muted?: boolean
  desc?: string
}

/** One bar per precursor charge (precursor_charge_<z>), "?" for 0 (no charge
 *  in the file); 6 and above as one "6+" bar when the run has charges above 6. */
export function chargeBars(rows: Row[]): Bar[] {
  const list = rows.flatMap((r) => {
    const m = /^precursor_charge_(\d+)$/.exec(r.key)
    const v = num(r.value)
    return m && v != null ? [{ z: Number(m[1]), v, n: num(r.n) }] : []
  })
  if (list.length === 0) return []
  const fold = list.some((c) => c.z > 6)
  const bars: Bar[] = []
  for (const c of list.sort((a, b) => a.z - b.z)) {
    const id = c.z === 0 ? '?' : fold && c.z >= 6 ? '6+' : String(c.z)
    const b = bars.find((x) => x.id === id)
    if (b) b.value += c.v
    else bars.push({ id, label: id === '?' ? '?' : `${id}`, value: c.v, share: null, n: c.n, muted: c.z === 0 })
  }
  for (const b of bars) b.share = b.n ? b.value / b.n : null
  // A "?" bar of 0 says nothing.
  return bars.filter((b) => !(b.id === '?' && b.value === 0))
}

// ---- resolution ----------------------------------------------------------------

export interface Band {
  band: string
  value: number
  n: number | null
}
export interface ResClass {
  cls: string
  label: string
  /// resolution_<cls>: the stated value, else the median measured.
  value: number | null
  source: string | null
  stated: number | null
  bands: Band[]
  /// Why nothing was measured, in words (from resolution_measured_<cls>).
  why: string | null
}

/// FTMS_ms1 as FTMS MS1.
export const classText = (cls: string): string => cls.replace(/_ms(\d)$/, ' MS$1')
/// mz400-800 as 400–800, mz2000+ as 2000+.
export const bandText = (b: string): string => b.replace(/^mz/, '').replace('-', '–')
const bandLow = (b: string): number => Number(/^mz(\d+)/.exec(b)?.[1] ?? Infinity)

export function resolutionClasses(rows: Row[]): ResClass[] {
  const out: ResClass[] = []
  for (const r of rows) {
    const m = /^resolution_(.+_ms\d+)$/.exec(r.key)
    if (!m || /^(stated|measured|source)_/.test(m[1])) continue
    const cls = m[1]
    const get = (k: string): Row | undefined => rows.find((x) => x.key === k)
    const bands = rows.flatMap((x) => {
      const b = x.key.startsWith(`resolution_measured_${cls}_`) ? x.key.slice(`resolution_measured_${cls}_`.length) : null
      const v = num(x.value)
      return b && v != null ? [{ band: b, value: v, n: num(x.n) }] : []
    })
    const measured = get(`resolution_measured_${cls}`)
    const why = measured && num(measured.value) == null ? (/Not measured: ([a-z_]+)/i.exec(measured.desc)?.[1].replace(/_/g, ' ') ?? 'not measured') : null
    const source = get(`resolution_source_${cls}`)?.value
    out.push({
      cls,
      label: classText(cls),
      value: num(r.value),
      source: source && source !== 'n/a' ? source : null,
      stated: num(get(`resolution_stated_${cls}`)?.value),
      bands: bands.sort((a, b) => bandLow(a.band) - bandLow(b.band)),
      why
    })
  }
  return out
}

/// Every band of @p classes, by m/z.
export const bandsOf = (classes: ResClass[]): string[] => [...new Set(classes.flatMap((c) => c.bands.map((b) => b.band)))].sort((a, b) => bandLow(a) - bandLow(b))

/// Fewer peaks than this in a band: drawn hollow, "few peaks".
export const FEW_PEAKS = 20

// ---- reporter ions -------------------------------------------------------------

const REASON_WORDS: Record<string, string> = {
  ion_trap_ms2: 'ion-trap MS2',
  low_mass_cutoff: 'scan starts above the reporters',
  no_peaks: 'no peaks'
}
const REASON_TONE: Record<string, Tone> = { low_mass_cutoff: 'gap', ion_trap_ms2: 'peaks' }
export const reasonText = (r: string): string => REASON_WORDS[r] ?? r.replace(/_/g, ' ')

/** One 100 % bar per reporter family (reporter_assessable_<family>): the MS2
 *  that can show its reporters and why the others cannot. */
export function assessability(rows: Row[]): Stack[] {
  const out: Stack[] = []
  for (const r of rows) {
    const m = /^reporter_assessable_(.+)$/.exec(r.key)
    const v = num(r.value)
    if (!m || v == null) continue
    const fam = m[1]
    const segments: Segment[] = [{ id: 'assessable', label: 'assessable', value: v, tone: 'tag' }]
    for (const x of rows) {
      const reason = x.key.startsWith(`reporter_${fam}_`) ? x.key.slice(`reporter_${fam}_`.length) : null
      const c = num(x.value)
      if (reason && c != null && c > 0) segments.push({ id: reason, label: reasonText(reason), value: c, tone: REASON_TONE[reason] ?? 'muted' })
    }
    const sum = segments.reduce((n, s) => n + s.value, 0)
    const total = Math.max(num(r.n) ?? sum, sum)
    if (total <= 0) continue
    if (total > sum) segments.push({ id: 'other', label: 'other', value: total - sum, tone: 'muted' })
    out.push({ label: fam, total, segments: segments.filter((s) => s.value > 0) })
  }
  return out
}

export interface Channels {
  channels: ReporterChannel[]
  /// From reporter_observed_* of an older report: only the channels seen in
  /// at least 20 % of the assessable MS2, without their m/z.
  partial: boolean
}

/** The reporter channels: the per-channel counts of qc_version 3
 *  (reporterChannels), else the channels an older report lists as seen. */
export function qcChannels(rows: Row[]): Channels {
  const channels = reporterChannels(rows)
  if (channels.length > 0) return { channels, partial: false }
  const old = rows.flatMap((r) => {
    if (!r.key.startsWith('reporter_observed_') || r.value === 'none') return []
    const n = num(r.n) ?? 0
    return r.value.split(',').flatMap((p) => {
      const [label, s] = p.split(':').map((x) => x.trim())
      const share = num(s)
      return label && share != null ? [{ label, mz: null, seen: Math.round(share * n), assessable: n, share, observed: true }] : []
    })
  })
  return { channels: old, partial: old.length > 0 }
}

/// The share above which the report calls a channel seen.
export const OBSERVED_SHARE = 0.2

/** The kit as the reporter section says it: the kit call and how it was
 *  made (kitCallOf), else the kit tile of an older report. */
export function kitLine(rows: Row[], summary: SummaryItem[]): string | null {
  const call = kitCallOf((k) => rows.find((r) => r.key === k))
  if (call) {
    const ev = rows.find((r) => r.key === 'reporter_family_evidence')
    const ends = call.evidence === 'label_mass' && num(ev?.n) ? ` (${int(num(ev!.n)!)} tag ends)` : ''
    return `${call.text}${call.evidence ? `, ${evidenceText(call.evidence)}${ends}` : ''}`
  }
  const kit = summary.find((s) => s.label === 'Isobaric kit')
  return kit ? kit.value : null
}

// ---- caveats -------------------------------------------------------------------

/** Facts about the spectra worth a line, only when they say something: spectra
 *  with no analyser class, a subsampled run, mixed activation. */
export function caveats(rows: Row[]): string[] {
  const v = (k: string): number | null => num(rows.find((r) => r.key === k)?.value)
  const out: string[] = []
  const none = v('analyzer_source_none')
  if (none) out.push(`${int(none)} spectra have no analyser class: the file does not say.`)
  const read = v('spectra_read')
  const input = v('spectra_input')
  if (rows.find((r) => r.key === 'subsampled')?.value === '1' && read != null && input != null)
    out.push(`Subsampled: ${int(read)} of ${int(input)} spectra read; the counts describe that share.`)
  const act = ['collisional', 'electron', 'hybrid', 'unknown'].map((k) => ({ k, n: v(`activation_${k}`) ?? 0 })).filter((a) => a.n > 0)
  const all = act.reduce((n, a) => n + a.n, 0)
  if (act.length > 1) out.push(`Activation: ${act.map((a) => `${pctText(a.n / all, 0)} ${a.k}`).join(', ')}.`)
  return out
}

// ---- All values ----------------------------------------------------------------

export interface Group {
  name: string
  lines: Line[]
}

const GROUPS: [string, RegExp][] = [
  ['Instrument', /^(instrument_|start_timestamp$)/],
  ['Spectra', /^(spectra_|subsampled$|count_ms|analyzer_source_|sps_)/],
  ['Resolution', /^resolution_/],
  ['Precursor charge', /^precursor_charge_/],
  ['Reporter ions', /^reporter_/],
  ['Tags', /^(ms2_tagged|tag_yield$)/],
  ['Redundancy', /^redundancy_/]
]

/** The rows of @p lines (qcLines) the page does not say elsewhere, in
 *  groups: the qc section by topic, then the run settings and any other
 *  section. @p said: a key a tile or the kit call already says. */
export function valueGroups(rows: Row[], lines: Line[], said: (key: string) => boolean): Group[] {
  const secOf = new Map(rows.map((r) => [r.key, r.sec]))
  const shown = lines.filter((l) => !said(l.key))
  const groups = new Map<string, Line[]>()
  const add = (name: string, l: Line): void => void groups.set(name, [...(groups.get(name) ?? []), l])
  for (const l of shown) {
    const sec = secOf.get(l.key) ?? ''
    if (sec === 'qc') add(GROUPS.find(([, re]) => re.test(l.key))?.[0] ?? 'Other', l)
    else add(sec === 'run' ? 'Run settings' : sec || 'Other', l)
  }
  const order = [...GROUPS.map(([g]) => g), 'Other', 'Run settings']
  return [...groups.entries()]
    .sort(([a], [b]) => (order.indexOf(a) < 0 ? order.length : order.indexOf(a)) - (order.indexOf(b) < 0 ? order.length : order.indexOf(b)))
    .map(([name, ls]) => ({ name, lines: ls }))
}
