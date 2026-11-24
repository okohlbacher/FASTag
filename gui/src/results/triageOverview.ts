// The statistics of the overview at the top of Results > Triage (plan
// "identifiability overview"): headline shares, the peptide length the
// precursor implies against the length of the tags, tags against peaks,
// and the share of the peptide the tags cover. Pure: one pass over the
// census rows the Triage tab already holds, no I/O, no React.
//
// Definitions:
// - processed: a status other than empty and no_precursor (Census::processed);
// - estimated peptide length L = ((precursor_mz - PROTON) * charge_used - WATER)
//   / AVERAGINE_RESIDUE, in residues; a row without a finite precursor m/z
//   > 0 or a charge >= 1 has no length;
// - tagged: status tagged or placed (a tag passed -max_evalue; not a quality
//   call); strong: tagged with best_evalue at or below the Triage E-value;
// - quantiles are type 7 (Census::quantile).

import { PROTON, WATER } from '../spectrum/ladder'

/// The average residue mass of averagine (Senko et al. 1995), in Da.
export const AVERAGINE_RESIDUE = 111.1254
/// The estimated lengths are counted from LEN_MIN to LEN_MAX residues; the
/// others are under- or overflow.
export const LEN_MIN = 4
export const LEN_MAX = 60
/// The Triage E-value when none was given (-census_triage_evalue).
export const DEFAULT_TRIAGE_EVALUE = 0.01
/// Defaults of the options the overview reads, when a run's parameters
/// do not list them (the CLI's own defaults, params.generated.json).
const DEFAULT_MAX_TAGS = 50
/// A peak bin or coverage bin with fewer spectra is drawn hollow.
export const FEW = 10
/// The share of spectra at max(n_found) that makes it a cap when no run
/// parameter gives -max_tags.
const CAP_PILEUP = 0.05

export interface CensusTable {
  columns: string[]
  rows: string[][]
}

/// The precursor's neutral mass and the peptide length it implies, or null.
export function estLength(mz: number, z: number): { mass: number; residues: number } | null {
  if (!(Number.isFinite(mz) && mz > 0) || !(Number.isInteger(z) && z >= 1)) return null
  const mass = (mz - PROTON) * z
  return { mass, residues: (mass - WATER) / AVERAGINE_RESIDUE }
}

/// Quantile type 7 (linear between order statistics) of @p sorted
/// (ascending), as Census::quantile; NaN for no values.
export function quantile7(sorted: readonly number[], p: number): number {
  const n = sorted.length
  if (n === 0) return NaN
  const h = (n - 1) * p
  const lo = Math.floor(h)
  const hi = Math.min(n - 1, lo + 1)
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo])
}

// ---- Run settings --------------------------------------------------------------

export interface TriageSettings {
  /// -max_tags per seed length; null when not known, 0 = no cap.
  maxTags: number | null
  /// Where maxTags comes from.
  maxTagsFrom: 'summary' | 'params' | 'default' | null
  /// Seed lengths in the run: the distinct lengths of the summary's
  /// run/tag_length (the CLI writes "3,4"), else -tag_lengths; at least 1.
  nLengths: number
  /// The Triage E-value of the strong-tag share.
  triageEvalue: number
  /// -max_evalue, if known.
  maxEvalue: number | null
  /// The single seed length, if known; null for a multi-length run.
  tagLength: number | null
  /// -extension, if known.
  extension: number | null
  /// The summary says the spectra were subsampled.
  subsampled: boolean
}

const numOf = (v: unknown): number | null => {
  if (v == null || v === '' || typeof v === 'boolean') return null
  const n = Number(String(v).trim())
  return Number.isFinite(n) ? n : null
}

/// The value of row @p section / @p key of a census summary, if present.
export function summaryValue(summary: CensusTable | null | undefined, section: string, key: string): string | null {
  if (!summary) return null
  const s = summary.columns.indexOf('section')
  const k = summary.columns.indexOf('key')
  const v = summary.columns.indexOf('value')
  if (s < 0 || k < 0 || v < 0) return null
  const r = summary.rows.find((x) => x[s] === section && x[k] === key)
  return r ? (r[v] ?? '') : null
}

/// The settings the overview depends on: the census summary first (what
/// the CLI wrote), then the run's parameters, then the CLI's defaults
/// (only when a parameter set is known: without one nothing is assumed).
/// A summary whose census/ms2_seen is not @p rows belongs to another run
/// (a table opened beside an older summary) and is not read.
export function triageSettings(params?: Record<string, unknown> | null, summary?: CensusTable | null, rows?: number): TriageSettings {
  const p = params ?? null
  const seen = numOf(summaryValue(summary, 'census', 'ms2_seen'))
  if (rows != null && seen != null && seen !== rows) summary = null
  const fromSummary = numOf(summaryValue(summary, 'run', 'max_tags'))
  const fromParams = p ? numOf(p['max_tags']) : null
  const maxTags = fromSummary ?? fromParams ?? (p ? DEFAULT_MAX_TAGS : null)
  const maxTagsFrom = fromSummary != null ? 'summary' : fromParams != null ? 'params' : p ? 'default' : null
  // The seed lengths: the summary's run/tag_length (a comma list for
  // several, RunMeta joinLengths) first, then -tag_lengths, as maxTags is.
  const lenStr = summaryValue(summary, 'run', 'tag_length')
  const sumLens = lenStr
    ? [...new Set(lenStr.split(/[\s,]+/).filter(Boolean).map(Number).filter(Number.isFinite))]
    : []
  const lens = p?.['tag_lengths']
  const paramLens = Array.isArray(lens) && lens.length > 0 ? lens.length : typeof lens === 'string' && lens.trim() ? lens.split(/[\s,]+/).filter(Boolean).length : 0
  const nLengths = sumLens.length > 0 ? sumLens.length : paramLens > 0 ? paramLens : 1
  return {
    maxTags,
    maxTagsFrom,
    nLengths,
    triageEvalue: (p ? numOf(p['census_triage_evalue']) : null) ?? DEFAULT_TRIAGE_EVALUE,
    maxEvalue: p ? numOf(p['max_evalue']) : null,
    tagLength: sumLens.length === 1 ? sumLens[0] : sumLens.length > 1 ? null : p ? numOf(p['tag_length']) : null,
    extension: p ? (numOf(p['extension']) ?? 0) : null,
    subsampled: summaryValue(summary, 'census', 'subsampled') === '1'
  }
}

// ---- Statistics ----------------------------------------------------------------

export type ChargeGroup = 'z1' | 'z2' | 'z3' | 'z4' | 'z5' | 'assumed'
export const CHARGE_GROUPS: readonly ChargeGroup[] = ['z1', 'z2', 'z3', 'z4', 'z5', 'assumed']
export const CHARGE_LABEL: Record<ChargeGroup, string> = {
  z1: '1+',
  z2: '2+',
  z3: '3+',
  z4: '4+',
  z5: '≥5+',
  assumed: 'charge assumed (2+)'
}

/// Counts by residues: counts[r] for r = 0..LEN_MAX.
export interface Hist {
  counts: number[]
  /// Below LEN_MIN (estimated lengths only) and above LEN_MAX.
  under: number
  over: number
  /// Every value counted, under and over included.
  n: number
}

const hist = (): Hist => ({ counts: new Array<number>(LEN_MAX + 1).fill(0), under: 0, over: 0, n: 0 })

export interface LengthGroup {
  /// The estimated peptide lengths of the processed spectra.
  est: Hist
  /// The tag lengths (max_len, else best_len) of the tagged spectra.
  tag: Hist
  /// The same for the identified spectra (with -census_ids), else null.
  idTag: Hist | null
}

/// Bin statistics of a per-spectrum value.
export interface Spread {
  n: number
  median: number
  p25: number
  p75: number
}

export interface PeakBin extends Spread {
  /// Peaks, x0 <= x < x1; x1 is Infinity for an open last bin.
  x0: number
  x1: number
  /// Spectra of the bin with a strong tag.
  strong: number
  /// Spectra of the bin at the cap (0 without a cap).
  atCap: number
}

export interface PeakBins {
  width: number
  bins: PeakBin[]
}

export interface CoverBin {
  /// Rounded estimated length: r0 <= round(L) <= r1 (r0 0 or r1 Infinity: open).
  r0: number
  r1: number
  label: string
  /// The tag series (max_len or best_len over L) and the cover series
  /// (res_cover over L, or the tag_cover proxy); null for no values.
  tag: Spread | null
  cover: Spread | null
}

export interface OverviewStats {
  /// Census rows: one per MS2 spectrum read.
  rows: number
  processed: number
  /// Processed spectra without an estimated length.
  noLength: number
  /// Status tagged or placed.
  tagged: number
  /// Tagged with best_evalue <= threshold; null without best_evalue.
  strong: number | null
  threshold: number
  /// With -census_ids: identified / not identified / unknown, and the
  /// triage candidates (triage = 1; null without the column).
  ids: { identified: number; not: number; unknown: number; candidates: number | null } | null
  /// Length histograms by charge group.
  lengths: Record<ChargeGroup, LengthGroup>
  /// The tag length column used.
  tagLenFrom: 'max_len' | 'best_len' | null
  /// Every tagged spectrum has this one tag length (null: several or none).
  singleLength: number | null
  /// Tags reported per spectrum against its peaks kept and its peaks.
  peaks: { kept: PeakBins | null; all: PeakBins | null }
  /// The cap n_reported stops at, and where it comes from.
  cap: { value: number; from: 'run' | 'data' } | null
  /// Coverage by estimated length.
  coverage: CoverBin[]
  /// What the cover series is: res_cover (residues), the tag_cover m/z
  /// span proxy, or nothing (an old census).
  coverFrom: 'res_cover' | 'proxy' | null
  /// census 3 (res_cover_exact): tagged spectra whose res_cover is a lower
  /// bound (some tag's orientation unresolved, no -fasta, so folded; or a
  /// gap's residues left out), of
  /// the tagged spectra with a res_cover_exact value. null: no such column
  /// (census 2, whose res_cover places every tag as a y read).
  coverFolded: { folded: number; of: number } | null
  /// Columns the overview wanted and did not find.
  missing: string[]
}

const TAGGED = new Set(['tagged', 'placed'])
const UNPROCESSED = new Set(['empty', 'no_precursor'])

function idOf(v: string | undefined): 'identified' | 'not' | 'unknown' {
  const t = (v ?? '').trim().toLowerCase()
  if (t === '1' || t === 'true' || t === 'yes') return 'identified'
  if (t === '0' || t === 'false' || t === 'no') return 'not'
  return 'unknown'
}

function spread(v: number[]): Spread | null {
  if (v.length === 0) return null
  v.sort((a, b) => a - b)
  return { n: v.length, median: quantile7(v, 0.5), p25: quantile7(v, 0.25), p75: quantile7(v, 0.75) }
}

const PEAK_WIDTHS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000]
const MAX_PEAK_BINS = 30

/// Bins of 20 peaks (wider when 30 bins of 20 do not reach the 99th
/// percentile), from the first bin with spectra; the last bin is open when
/// spectra lie beyond it.
function peakBins(xs: number[], ys: number[], strong: boolean[], cap: number | null): PeakBins | null {
  if (xs.length === 0) return null
  const hiX = quantile7([...xs].sort((a, b) => a - b), 0.99)
  const width = PEAK_WIDTHS.find((w) => Math.floor(hiX / w) + 1 <= MAX_PEAK_BINS) ?? PEAK_WIDTHS[PEAK_WIDTHS.length - 1]
  const nb = Math.max(1, Math.floor(hiX / width) + 1)
  const vals: number[][] = Array.from({ length: nb }, () => [])
  const st = new Array<number>(nb).fill(0)
  const at = new Array<number>(nb).fill(0)
  let open = false
  for (let i = 0; i < xs.length; i++) {
    let b = Math.floor(xs[i] / width)
    if (b >= nb) {
      b = nb - 1
      open = true
    }
    vals[b].push(ys[i])
    if (strong[i]) st[b]++
    if (cap != null && cap > 0 && ys[i] >= cap) at[b]++
  }
  const bins: PeakBin[] = vals.map((v, b) => {
    const s = spread(v)
    return {
      x0: b * width,
      x1: open && b === nb - 1 ? Infinity : (b + 1) * width,
      n: v.length,
      median: s?.median ?? NaN,
      p25: s?.p25 ?? NaN,
      p75: s?.p75 ?? NaN,
      strong: st[b],
      atCap: at[b]
    }
  })
  // From the first bin with spectra: no empty run of bins at the left.
  return { width, bins: bins.slice(Math.max(0, bins.findIndex((b) => b.n > 0))) }
}

/// The coverage bins: round(L) <= 7, 8-9, 10-11, ..., 38-39, >= 40.
export function coverBinOf(residues: number): number {
  const r = Math.round(residues)
  if (r <= 7) return 0
  if (r >= 40) return 17
  return Math.floor((r - 8) / 2) + 1
}
const COVER_BINS = 18
function coverLabel(b: number): { r0: number; r1: number; label: string } {
  if (b === 0) return { r0: 0, r1: 7, label: '≤7' }
  if (b === COVER_BINS - 1) return { r0: 40, r1: Infinity, label: '≥40' }
  const r0 = 8 + (b - 1) * 2
  return { r0, r1: r0 + 1, label: `${r0}–${r0 + 1}` }
}

/// The overview of a census: every row, whatever filter the table shows.
export function overviewStats(tsv: CensusTable, settings: TriageSettings): OverviewStats {
  const col = (c: string): number => tsv.columns.indexOf(c)
  const cSt = col('status')
  const cMz = col('precursor_mz')
  const cZ = col('charge_used')
  const cZg = col('charge_given')
  const cEv = col('best_evalue')
  const cBl = col('best_len')
  const cMl = col('max_len')
  const cRc = col('res_cover')
  const cRx = col('res_cover_exact')
  const cTc = col('tag_cover')
  const cKept = col('n_peaks_kept')
  const cPeaks = col('n_peaks')
  const cRep = col('n_reported')
  const cFound = col('n_found')
  const cId = col('identified')
  const cTr = col('triage')
  const missing = ['status', 'precursor_mz', 'charge_used', 'best_evalue', 'best_len', 'n_peaks_kept', 'n_reported', 'tag_cover'].filter(
    (c) => col(c) < 0 && !(c === 'tag_cover' && cRc >= 0)
  )
  const lenCol = cMl >= 0 ? cMl : cBl
  const coverFrom: OverviewStats['coverFrom'] = cRc >= 0 ? 'res_cover' : cTc >= 0 ? 'proxy' : null
  const threshold = settings.triageEvalue

  const lengths = Object.fromEntries(
    CHARGE_GROUPS.map((g) => [g, { est: hist(), tag: hist(), idTag: cId >= 0 ? hist() : null }])
  ) as Record<ChargeGroup, LengthGroup>
  let processed = 0
  let noLength = 0
  let tagged = 0
  let strongN = 0
  const ids = cId >= 0 ? { identified: 0, not: 0, unknown: 0, candidates: cTr >= 0 ? 0 : null } : null
  const tagLens = new Set<number>()
  // Tags vs peaks.
  const keptX: number[] = []
  const allX: number[] = []
  const keptY: number[] = []
  const allY: number[] = []
  const keptS: boolean[] = []
  const allS: boolean[] = []
  let maxFound = -Infinity
  const found: number[] = []
  // Coverage.
  const covTag: number[][] = Array.from({ length: COVER_BINS }, () => [])
  const covCover: number[][] = Array.from({ length: COVER_BINS }, () => [])
  const folded = cRx >= 0 ? { folded: 0, of: 0 } : null

  const add = (h: Hist, r: number, min: number): void => {
    h.n++
    if (r < min) h.under++
    else if (r > LEN_MAX) h.over++
    else h.counts[r]++
  }

  for (const row of tsv.rows) {
    const status = cSt >= 0 ? (row[cSt] ?? '').trim() : ''
    if (ids) {
      const s = idOf(row[cId])
      ids[s]++
      if (ids.candidates != null && (row[cTr] ?? '').trim() === '1') ids.candidates++
    }
    if (UNPROCESSED.has(status)) continue
    processed++
    const isTagged = TAGGED.has(status)
    const ev = cEv >= 0 ? Number(row[cEv]) : NaN
    const strong = isTagged && (row[cEv] ?? '').trim() !== '' && Number.isFinite(ev) && ev <= threshold
    if (isTagged) tagged++
    if (strong) strongN++
    if (folded && isTagged) {
      const x = (row[cRx] ?? '').trim()
      if (x === '0' || x === '1') {
        folded.of++
        if (x === '0') folded.folded++
      }
    }

    const z = cZ >= 0 ? Number(row[cZ]) : NaN
    const est = estLength(cMz >= 0 ? Number(row[cMz]) : NaN, z)
    const assumed = cZg >= 0 && (row[cZg] ?? '').trim() !== '' && Number(row[cZg]) === 0
    const group: ChargeGroup = assumed ? 'assumed' : z >= 5 ? 'z5' : (`z${z}` as ChargeGroup)
    const len = lenCol >= 0 && (row[lenCol] ?? '').trim() !== '' ? Number(row[lenCol]) : NaN
    const hasLen = isTagged && Number.isFinite(len) && len > 0

    if (!est) noLength++
    else {
      const g = lengths[group]
      add(g.est, Math.round(est.residues), LEN_MIN)
      if (hasLen) {
        add(g.tag, Math.round(len), 0)
        if (g.idTag && idOf(row[cId]) === 'identified') add(g.idTag, Math.round(len), 0)
      }
      if (isTagged && est.residues > 0) {
        const b = coverBinOf(est.residues)
        if (hasLen) covTag[b].push(100 * Math.min(1, len / est.residues))
        if (coverFrom === 'res_cover') {
          const rc = Number(row[cRc])
          if ((row[cRc] ?? '').trim() !== '' && Number.isFinite(rc)) covCover[b].push(100 * Math.min(1, rc / est.residues))
        } else if (coverFrom === 'proxy') {
          const tc = Number(row[cTc])
          const body = est.mass - WATER
          if ((row[cTc] ?? '').trim() !== '' && Number.isFinite(tc) && body > 0) covCover[b].push(100 * Math.min(1, tc / body))
        }
      }
    }
    if (hasLen) tagLens.add(Math.round(len))

    const rep = cRep >= 0 && (row[cRep] ?? '').trim() !== '' ? Number(row[cRep]) : NaN
    if (Number.isFinite(rep)) {
      const k = cKept >= 0 && (row[cKept] ?? '').trim() !== '' ? Number(row[cKept]) : NaN
      const a = cPeaks >= 0 && (row[cPeaks] ?? '').trim() !== '' ? Number(row[cPeaks]) : NaN
      if (Number.isFinite(k)) {
        keptX.push(k)
        keptY.push(rep)
        keptS.push(strong)
      }
      if (Number.isFinite(a)) {
        allX.push(a)
        allY.push(rep)
        allS.push(strong)
      }
    }
    const f = cFound >= 0 && (row[cFound] ?? '').trim() !== '' ? Number(row[cFound]) : NaN
    if (Number.isFinite(f)) {
      found.push(f)
      if (f > maxFound) maxFound = f
    }
  }

  // The cap: the run's -max_tags (per seed length), else a pile-up of at
  // least 5 % of the processed spectra at max(n_found).
  let cap: OverviewStats['cap'] = null
  if (settings.maxTags != null) {
    if (settings.maxTags > 0) cap = { value: settings.maxTags * Math.max(1, settings.nLengths), from: 'run' }
  } else if (found.length > 0 && maxFound > 0) {
    const at = found.reduce((n, f) => n + (f === maxFound ? 1 : 0), 0)
    if (at >= CAP_PILEUP * Math.max(1, processed)) cap = { value: maxFound, from: 'data' }
  }
  const capV = cap?.value ?? null

  const coverage: CoverBin[] = Array.from({ length: COVER_BINS }, (_, b) => ({
    ...coverLabel(b),
    tag: spread(covTag[b]),
    cover: spread(covCover[b])
  }))

  return {
    rows: tsv.rows.length,
    processed,
    noLength,
    tagged,
    strong: cEv >= 0 ? strongN : null,
    threshold,
    ids,
    lengths,
    tagLenFrom: cMl >= 0 ? 'max_len' : cBl >= 0 ? 'best_len' : null,
    singleLength: tagLens.size === 1 ? [...tagLens][0] : null,
    peaks: { kept: peakBins(keptX, keptY, keptS, capV), all: peakBins(allX, allY, allS, capV) },
    cap,
    coverage,
    coverFrom,
    coverFolded: folded,
    missing
  }
}

/// The length histograms of @p groups summed (the charge seg's choice).
export function sumGroups(stats: OverviewStats, groups: readonly ChargeGroup[]): { est: Hist; tag: Hist; idTag: Hist | null; assumed: Hist } {
  const sum = (pick: (g: LengthGroup) => Hist | null, gs: readonly ChargeGroup[]): Hist | null => {
    const hs = gs.map((g) => pick(stats.lengths[g])).filter((h): h is Hist => h != null)
    if (hs.length === 0) return null
    const out = hist()
    for (const h of hs) {
      h.counts.forEach((c, i) => (out.counts[i] += c))
      out.under += h.under
      out.over += h.over
      out.n += h.n
    }
    return out
  }
  return {
    est: sum((g) => g.est, groups) ?? hist(),
    tag: sum((g) => g.tag, groups) ?? hist(),
    idTag: stats.ids ? sum((g) => g.idTag, groups) : null,
    assumed: groups.includes('assumed') ? stats.lengths.assumed.est : hist()
  }
}

/// @p n of @p of as a share (0..1), or null for no basis (digestReport pct
/// writes it).
export function share(n: number, of: number): number | null {
  return of > 0 ? n / of : null
}

/// A census summary (section, key, value, n, description) from its text.
export function summaryTable(text: string): CensusTable {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '' && !l.startsWith('#'))
  return { columns: (lines[0] ?? '').split('\t'), rows: lines.slice(1).map((l) => l.split('\t')) }
}
