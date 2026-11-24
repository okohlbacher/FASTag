// The statistics of the Triage overview, against values computed by hand
// (plan "identifiability overview" 1.3, PROTON 1.007276466812, WATER
// 18.0105646837, averagine residue 111.1254 Da).
import { describe, expect, it } from 'vitest'
import censusText from '../fixtures/cli-1.15/ecoli_ms2_small_0.3da.census_sorted.tsv?raw'
import lensCensusText from '../fixtures/cli-dev/pxd000001-census-lengths/run.census.tsv?raw'
import lensSummaryText from '../fixtures/cli-dev/pxd000001-census-lengths/run.census_summary.tsv?raw'
import {
  coverBinOf,
  estLength,
  overviewStats,
  quantile7,
  sumGroups,
  triageSettings,
  type CensusTable,
  type TriageSettings
} from './triageOverview'

const COLS = ['status', 'precursor_mz', 'charge_given', 'charge_used', 'n_peaks', 'n_peaks_kept', 'n_found', 'n_reported', 'best_evalue', 'best_len', 'tag_cover']
type R = Partial<Record<string, string | number>>
const table = (rows: R[], cols = COLS): CensusTable => ({ columns: cols, rows: rows.map((r) => cols.map((c) => (r[c] == null ? '' : String(r[c])))) })
const row = (o: R = {}): R => ({
  status: 'tagged',
  precursor_mz: 500.7737,
  charge_given: 2,
  charge_used: 2,
  n_peaks: 100,
  n_peaks_kept: 50,
  n_found: 10,
  n_reported: 10,
  best_evalue: 0.001,
  best_len: 4,
  tag_cover: 500,
  ...o
})
const S: TriageSettings = triageSettings({})

describe('estLength', () => {
  it('mz 500.7737, 2+: M 999.532847, L 8.8326', () => {
    const e = estLength(500.7737, 2)!
    expect(e.mass).toBeCloseTo(999.532847, 5)
    expect(e.residues).toBeCloseTo(8.8326, 4)
  })
  it('mz 600, 3+: M 1796.978171, L 16.0087', () => {
    const e = estLength(600, 3)!
    expect(e.mass).toBeCloseTo(1796.978171, 5)
    expect(e.residues).toBeCloseTo(16.0087, 3)
  })
  it('fixture row 1: mz 560.663513, 3+: L 14.947', () => {
    expect(estLength(560.663513183594, 3)!.residues).toBeCloseTo(14.947, 3)
  })
  it('no length without a finite m/z > 0 or a charge >= 1', () => {
    expect(estLength(NaN, 2)).toBeNull()
    expect(estLength(0, 2)).toBeNull()
    expect(estLength(500, 0)).toBeNull()
    expect(estLength(500, 1.5)).toBeNull()
  })
})

describe('quantile7', () => {
  it('[1, 2, 3, 4]: median 2.5, p25 1.75, p75 3.25', () => {
    expect(quantile7([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(quantile7([1, 2, 3, 4], 0.25)).toBe(1.75)
    expect(quantile7([1, 2, 3, 4], 0.75)).toBe(3.25)
    expect(quantile7([7], 0.25)).toBe(7)
    expect(quantile7([], 0.5)).toBeNaN()
  })
})

describe('overviewStats', () => {
  it('coverage 4 / 8.8326 = 45.29 % in the 8-9 bin; the tag_cover proxy 1032.3321 / 1660.958144 = 62.15 %', () => {
    const s = overviewStats(
      table([row(), row({ precursor_mz: 560.663513183594, charge_given: 3, charge_used: 3, tag_cover: 1032.3321, best_len: 3 })]),
      S
    )
    const b9 = s.coverage[coverBinOf(8.8326)]
    expect(b9.label).toBe('8–9')
    expect(b9.tag!.median).toBeCloseTo(45.29, 2)
    const b15 = s.coverage[coverBinOf(14.947)]
    expect(b15.label).toBe('14–15')
    expect(b15.cover!.median).toBeCloseTo(62.15, 2)
    expect(s.coverFrom).toBe('proxy')
    expect(s.tagLenFrom).toBe('best_len')
  })

  it('bins the estimated length by round(L): 8.83 -> 9, 16.01 -> 16, by charge', () => {
    const s = overviewStats(table([row(), row({ precursor_mz: 600, charge_given: 3, charge_used: 3 })]), S)
    expect(s.lengths.z2.est.counts[9]).toBe(1)
    expect(s.lengths.z3.est.counts[16]).toBe(1)
    expect(s.lengths.z2.tag.counts[4]).toBe(1)
  })

  it('leaves empty and no_precursor out of the processed spectra; a bad precursor has no length', () => {
    const s = overviewStats(
      table([row(), row({ status: 'empty' }), row({ status: 'no_precursor' }), row({ status: 'bad_precursor', precursor_mz: 0 }), row({ status: 'no_tags', best_evalue: '' })]),
      S
    )
    expect(s.rows).toBe(5)
    expect(s.processed).toBe(3)
    expect(s.noLength).toBe(1)
    expect(s.tagged).toBe(1)
    expect(s.strong).toBe(1)
  })

  it('a charge not given goes to "assumed", not to 2+', () => {
    const s = overviewStats(table([row({ charge_given: 0 }), row()]), S)
    expect(s.lengths.assumed.est.n).toBe(1)
    expect(s.lengths.z2.est.n).toBe(1)
    const all = sumGroups(s, ['z1', 'z2', 'z3', 'z4', 'z5', 'assumed'])
    expect(all.est.counts[9]).toBe(2)
    expect(all.assumed.counts[9]).toBe(1)
    expect(sumGroups(s, ['z2']).assumed.n).toBe(0)
  })

  it('counts lengths below 4 and above 60 as under- and overflow; 5+ and up in one group', () => {
    // L ~ 2.2 (mz 140, 2+) and L ~ 89 (mz 2000, 5+).
    const s = overviewStats(table([row({ precursor_mz: 140 }), row({ precursor_mz: 2000, charge_given: 5, charge_used: 5 })]), S)
    expect(s.lengths.z2.est.under).toBe(1)
    expect(s.lengths.z5.est.over).toBe(1)
    expect(s.lengths.z5.est.counts.reduce((a, b) => a + b, 0)).toBe(0)
  })

  it('strong: tagged or placed with best_evalue at or below the Triage E-value', () => {
    const rows = [row({ best_evalue: 0.01 }), row({ best_evalue: 0.02 }), row({ status: 'placed', best_evalue: 0.005 }), row({ status: 'filtered', best_evalue: 0.001 })]
    expect(overviewStats(table(rows), S).strong).toBe(2)
    expect(overviewStats(table(rows), triageSettings({ census_triage_evalue: '0.05' })).strong).toBe(3)
    expect(overviewStats(table(rows, COLS.filter((c) => c !== 'best_evalue')), S).strong).toBeNull()
  })

  it('the cap: -max_tags per seed length from the run, the summary first', () => {
    const t = table([row({ n_found: 50, n_reported: 50 })])
    expect(overviewStats(t, triageSettings({ max_tags: 20 })).cap).toEqual({ value: 20, from: 'run' })
    expect(overviewStats(t, triageSettings({ max_tags: 20, tag_lengths: [3, 4] })).cap).toEqual({ value: 40, from: 'run' })
    const summary: CensusTable = { columns: ['section', 'key', 'value', 'n', 'description'], rows: [['run', 'max_tags', '30', '-', '']] }
    expect(overviewStats(t, triageSettings({ max_tags: 20 }, summary)).cap).toEqual({ value: 30, from: 'run' })
    // A summary of another run (ms2_seen is not the row count) is not read.
    const other: CensusTable = { ...summary, rows: [...summary.rows, ['census', 'ms2_seen', '999', '-', '']] }
    expect(overviewStats(t, triageSettings({ max_tags: 20 }, other, 1)).cap).toEqual({ value: 20, from: 'run' })
    expect(overviewStats(t, triageSettings({ max_tags: 20 }, other, 999)).cap).toEqual({ value: 30, from: 'run' })
    // A parameter set without max_tags: the CLI default, 50.
    expect(triageSettings({}).maxTags).toBe(50)
    expect(overviewStats(t, triageSettings({ max_tags: 0 })).cap).toBeNull()
  })

  it('the cap without run settings: max(n_found) when at least 5 % of the spectra sit at it', () => {
    const none = triageSettings(null)
    expect(none.maxTags).toBeNull()
    const pile = [row({ n_found: 50 }), ...Array.from({ length: 19 }, () => row({ n_found: 10 }))]
    expect(overviewStats(table(pile), none).cap).toEqual({ value: 50, from: 'data' })
    const lone = [row({ n_found: 50 }), ...Array.from({ length: 20 }, () => row({ n_found: 10 }))]
    expect(overviewStats(table(lone), none).cap).toBeNull()
  })

  it('tags vs peaks: bins of 20 peaks kept with the median, IQR, strong and at-cap counts', () => {
    const rows = [1, 2, 3, 4].map((n) => row({ n_peaks_kept: 25, n_reported: n, best_evalue: n === 4 ? 1 : 0.001 }))
    rows.push(row({ n_peaks_kept: 5, n_reported: 20 }))
    const s = overviewStats(table(rows), triageSettings({ max_tags: 20 }))
    const p = s.peaks.kept!
    expect(p.width).toBe(20)
    expect(p.bins[0]).toMatchObject({ x0: 0, x1: 20, n: 1, median: 20, atCap: 1 })
    expect(p.bins[1]).toMatchObject({ x0: 20, x1: 40, n: 4, median: 2.5, p25: 1.75, p75: 3.25, strong: 3, atCap: 0 })
    expect(s.peaks.all!.bins.length).toBeGreaterThan(0)
  })

  it('peak bins start at the first bin with spectra', () => {
    const p = overviewStats(table([row({ n_peaks_kept: 45 }), row({ n_peaks_kept: 85 })]), S).peaks.kept!
    expect(p.bins.map((b) => [b.x0, b.n])).toEqual([[40, 1], [60, 0], [80, 1]])
  })

  it('wider peak bins when 30 bins of 20 do not reach the 99th percentile', () => {
    const rows = Array.from({ length: 200 }, (_, i) => row({ n_peaks: i * 10 }))
    expect(overviewStats(table(rows), S).peaks.all!.width).toBe(100)
  })

  it('detects a single tag length, and several', () => {
    expect(overviewStats(table([row({ best_len: 3 }), row({ best_len: 3 })]), S).singleLength).toBe(3)
    expect(overviewStats(table([row({ best_len: 3 }), row({ best_len: 5 })]), S).singleLength).toBeNull()
    expect(overviewStats(table([row({ status: 'no_tags', best_len: '' })]), S).singleLength).toBeNull()
  })

  it('without identified and triage columns there are no ids; with them, identified / not / unknown and candidates', () => {
    expect(overviewStats(table([row()]), S).ids).toBeNull()
    const cols = [...COLS, 'identified', 'triage']
    const s = overviewStats(
      table([row({ identified: 1, triage: 0 }), row({ identified: 0, triage: 1 }), row({ identified: '', triage: 0 }), row({ identified: 1, triage: 0, best_len: 6 })], cols),
      S
    )
    expect(s.ids).toEqual({ identified: 2, not: 1, unknown: 1, candidates: 1 })
    expect(s.lengths.z2.idTag!.counts[4]).toBe(1)
    expect(s.lengths.z2.idTag!.counts[6]).toBe(1)
    expect(overviewStats(table([row({ identified: 1 })], [...COLS, 'identified']), S).ids!.candidates).toBeNull()
  })

  it('an old census without tag_cover: no cover series, and the column is named missing', () => {
    const s = overviewStats(table([row()], COLS.filter((c) => c !== 'tag_cover')), S)
    expect(s.coverFrom).toBeNull()
    expect(s.missing).toContain('tag_cover')
    expect(s.coverage.every((b) => b.cover == null)).toBe(true)
  })

  it('a standalone multi-length census (CLI: -tag_lengths 3 4 -max_tags 7): the summary gives two lengths, cap 14', () => {
    const parse = (text: string): CensusTable => {
      const lines = text.trim().split('\n')
      return { columns: lines[0].split('\t'), rows: lines.slice(1).map((l: string) => l.split('\t')) }
    }
    const t = parse(lensCensusText)
    const summary = parse(lensSummaryText)
    expect(t.rows.length).toBe(52)
    // No session parameters: the summary's run/tag_length "3,4" and run/max_tags 7.
    const set = triageSettings(null, summary, t.rows.length)
    expect(set.nLengths).toBe(2)
    expect(set.tagLength).toBeNull()
    expect(set.maxTags).toBe(7)
    expect(overviewStats(t, set).cap).toEqual({ value: 14, from: 'run' })
    // n_found reaches the cap of two lengths: 7 would be below the data.
    const cNf = t.columns.indexOf('n_found')
    expect(Math.max(...t.rows.map((r) => Number(r[cNf]) || 0))).toBe(14)
    // The summary wins over conflicting parameters.
    const conflict = triageSettings({ tag_lengths: [3], tag_length: 3 }, summary, t.rows.length)
    expect(conflict.nLengths).toBe(2)
    expect(conflict.tagLength).toBeNull()
    expect(overviewStats(t, conflict).cap).toEqual({ value: 14, from: 'run' })
    // A single-length summary gives its length; params fill in without one.
    const one: CensusTable = { columns: summary.columns, rows: [['run', 'tag_length', '4', '-', '']] }
    expect(triageSettings({ tag_lengths: [3, 4] }, one)).toMatchObject({ nLengths: 1, tagLength: 4 })
    expect(triageSettings({ tag_lengths: [3, 4] })).toMatchObject({ nLengths: 2 })
    expect(triageSettings(null).nLengths).toBe(1)
    // census 3: without -fasta every tagged row's res_cover is the folded lower bound.
    const st = overviewStats(t, set)
    expect(st.coverFrom).toBe('res_cover')
    expect(st.coverFolded).toEqual({ folded: st.tagged, of: st.tagged })
    expect(st.tagged).toBe(49)
  })

  it('census 3: res_cover_exact counts the folded (orientation unresolved) spectra; census 2 has none', () => {
    const cols = [...COLS, 'max_len', 'res_cover', 'res_cover_exact']
    const s = overviewStats(
      table(
        [
          row({ max_len: 6, res_cover: 8, res_cover_exact: 0 }),
          row({ max_len: 6, res_cover: 8, res_cover_exact: 1 }),
          row({ max_len: 6, res_cover: 8, res_cover_exact: 1 }),
          row({ status: 'no_tags', best_evalue: '' })
        ],
        cols
      ),
      S
    )
    expect(s.coverFolded).toEqual({ folded: 1, of: 3 })
    expect(overviewStats(table([row({ max_len: 6, res_cover: 8 })], [...COLS, 'max_len', 'res_cover']), S).coverFolded).toBeNull()
  })

  it('census 2: max_len and res_cover replace best_len and the proxy', () => {
    const cols = [...COLS, 'max_len', 'res_cover']
    // L 8.8326: max_len 6 -> 67.93 %, res_cover 8 -> 90.57 %.
    const s = overviewStats(table([row({ best_len: 3, max_len: 6, res_cover: 8 })], cols), S)
    expect(s.tagLenFrom).toBe('max_len')
    expect(s.coverFrom).toBe('res_cover')
    expect(s.lengths.z2.tag.counts[6]).toBe(1)
    const b = s.coverage[coverBinOf(8.8326)]
    expect(b.tag!.median).toBeCloseTo(67.93, 2)
    expect(b.cover!.median).toBeCloseTo(90.57, 2)
    expect(s.missing).not.toContain('tag_cover')
  })

  it('clamps coverage at 100 %', () => {
    const s = overviewStats(table([row({ best_len: 12, tag_cover: 5000 })]), S)
    const b = s.coverage[coverBinOf(8.8326)]
    expect(b.tag!.median).toBe(100)
    expect(b.cover!.median).toBe(100)
  })

  it('the coverage bins: <= 7, 8-9 ... 38-39, >= 40', () => {
    expect(coverBinOf(5)).toBe(0)
    expect(coverBinOf(7.4)).toBe(0)
    expect(coverBinOf(7.6)).toBe(1)
    expect(coverBinOf(39.4)).toBe(16)
    expect(coverBinOf(55)).toBe(17)
  })

  it('the real census fixture: 139 rows, 137 tagged (5 placed), best_len 3 to 9', () => {
    const lines = censusText.trim().split('\n')
    const t: CensusTable = { columns: lines[0].split('\t'), rows: lines.slice(1).map((l: string) => l.split('\t')) }
    const s = overviewStats(t, triageSettings({ max_tags: 50 }))
    expect(s.rows).toBe(139)
    expect(s.processed).toBe(139)
    expect(s.tagged).toBe(137)
    expect(s.singleLength).toBeNull()
    expect(s.cap).toEqual({ value: 50, from: 'run' })
  })

  it('500k rows in well under a second', () => {
    const base = table([row()]).rows[0]
    const t: CensusTable = { columns: COLS, rows: Array.from({ length: 500_000 }, (_, i) => { const r = [...base]; r[1] = String(400 + (i % 900)); r[5] = String(i % 300); return r }) }
    const t0 = performance.now()
    overviewStats(t, S)
    expect(performance.now() - t0).toBeLessThan(1500)
  })
})
