// Pooling mass-shift tables into one residue matrix (shiftMatrix.ts
// poolTables): the mass tolerance at its edges, no chaining, the sums, the
// terminal sites, the best name, the rows under 0.5 Da left out; then four
// real tables of PXD045734 (src/fixtures/cli-1.16/pxd045734-lens/README.md,
// totals read off the files with awk) and 200 synthetic tables for the time.

// @ts-ignore -- node built-in; the app's tsconfig has no node types
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDelta } from './tables'
import { DELTA_GROUP_DA, deltaGroupOf, nameParts, pivotResidues, poolTables, poolTolerance, sourceOf, type MatrixSource } from './shiftMatrix'

const HEAD = 'delta\tspectra\ttop_interps\tlocalized\tresidues\tunlocalized\tunimod\tpsimod\tisotope_error\n'
/// A synthetic table: [delta, spectra, localized, residues, unlocalized, unimod].
type Row = [string, number, number, string, number, string?]
const table = (path: string, rows: Row[]): MatrixSource =>
  sourceOf(parseDelta(HEAD + rows.map(([d, s, l, r, u, n]) => `${d}\t${s}\t?:${s}\t${l}\t${r}\t${u}\t${n ?? '-'}\t-\t-\n`).join(''), path))!
const keys = (m: ReturnType<typeof poolTables>): string[] => m.rows.map((r) => r.key)

describe('poolTables: the mass tolerance', () => {
  it('merges rows of different tables 0.0040 Da apart, not 0.0045 (the -delta_group default)', () => {
    const a = table('/a', [['100.0000', 10, 0, '-', 10]])
    const b = table('/b', [['100.0040', 5, 0, '-', 5], ['99.9960', 4, 0, '-', 4]])
    const c = table('/c', [['100.0045', 3, 0, '-', 3], ['99.9955', 2, 0, '-', 2]])
    const m = poolTables([a, b, c])
    expect(m.tolerance).toBe(DELTA_GROUP_DA)
    expect(keys(m)).toEqual(['99.9955', '100.0000', '100.0045'])
    const mid = m.rows[1]
    expect([mid.spectra, mid.members, mid.tables, mid.lo, mid.hi]).toEqual([19, 3, 2, 99.996, 100.004])
  })

  it('does not chain: a row taken by a larger one stays there, and the next seed takes only what is left', () => {
    // 100.0040 is within 0.004 of both 100.0000 (10 spectra) and 100.0075 (8): the larger takes it.
    const m = poolTables([table('/a', [['100.0000', 10, 0, '-', 10]]), table('/b', [['100.0040', 5, 0, '-', 5]]), table('/c', [['100.0075', 8, 0, '-', 8]])])
    expect(m.rows.map((r) => [r.key, r.spectra, r.members])).toEqual([
      ['100.0000', 15, 2],
      ['100.0075', 8, 1]
    ])
  })

  it('may take two rows of one table into one pooled row (as -delta_group takes bins)', () => {
    const m = poolTables([table('/a', [['200.0000', 20, 0, '-', 20]]), table('/b', [['199.9975', 3, 0, '-', 3], ['200.0030', 4, 0, '-', 4]])])
    expect(m.rows).toHaveLength(1)
    expect([m.rows[0].spectra, m.rows[0].members, m.rows[0].tables]).toEqual([27, 3, 2])
  })

  it('takes a wider tolerance when given, and a tolerance of 0 merges nothing', () => {
    const t = [table('/a', [['50.0000', 4, 0, '-', 4]]), table('/b', [['50.0080', 3, 0, '-', 3]])]
    expect(poolTables(t, 'terminus', 0.01).rows).toHaveLength(1)
    expect(poolTables(t, 'terminus', 0).rows).toHaveLength(2)
  })

  it('gives the same rows whatever the order of the tables', () => {
    const t = [table('/a', [['100.0000', 5, 0, '-', 5], ['300.0000', 2, 0, '-', 2]]), table('/b', [['100.0030', 5, 0, '-', 5]]), table('/c', [['99.9970', 5, 0, '-', 5], ['300.0035', 2, 0, '-', 2]])]
    const shape = (m: ReturnType<typeof poolTables>) => m.rows.map((r) => [r.key, r.spectra, r.members])
    expect(shape(poolTables([t[2], t[0], t[1]]))).toEqual(shape(poolTables(t)))
    // Ties of spectra: the smaller gap seeds, and takes 100.0000 (0.0030 away) but not 100.0030 (0.0060).
    expect(keys(poolTables(t))).toEqual(['99.9970', '100.0030', '300.0000'])
  })
})

describe('poolTables: sums and sites', () => {
  const a = table('/a', [['15.9950', 9, 7, 'M:5,W:1,N-term|M:1', 2, 'Oxidation@M/W(+0.4ppm)']])
  const b = table('/b', [['15.9960', 6, 4, 'M:3,Protein N-term|M:1', 2, 'Oxidation@M(+1.0ppm)']])

  it('sums spectra, localized, unlocalized and the site counts, and keeps the sites behind each cell', () => {
    const m = poolTables([a, b])
    const r = m.rows[0]
    expect([r.key, r.spectra, r.localized, r.unlocalized, r.sum]).toEqual(['15.9950', 15, 11, 4, 11])
    expect(Object.fromEntries(r.counts)).toEqual({ M: 8, W: 1, 'N-term': 2 })
    expect(r.detail.get('N-term')).toEqual([
      { site: 'N-term|M', n: 1 },
      { site: 'Protein N-term|M', n: 1 }
    ])
    expect(m.mismatched).toEqual([])
    expect(m.terminal).toBe(true)
    expect(m.columns).toEqual(['N-term', 'M', 'W', 'C-term'].filter((c) => r.counts.has(c)))
  })

  it('counts terminal sites under their residue on request', () => {
    const r = poolTables([a, b], 'residue').rows[0]
    expect(Object.fromEntries(r.counts)).toEqual({ M: 10, W: 1 })
    expect(r.detail.get('M')).toEqual([
      { site: 'M', n: 8 },
      { site: 'N-term|M', n: 1 },
      { site: 'Protein N-term|M', n: 1 }
    ])
  })

  it('says when a pooled row does not add up', () => {
    const m = poolTables([a, table('/c', [['15.9955', 3, 3, 'M:1', 0]])])
    expect(m.mismatched).toEqual([0])
  })
})

describe('poolTables: the best name', () => {
  it('one row keeps its own name and names', () => {
    const m = poolTables([table('/a', [['42.0106', 5, 3, 'N-term|K:3', 2, 'Acetyl@N-term/K(+0.1ppm);Trimethyl@K(-3.0mDa)']])])
    expect(m.rows[0].name).toBe('Acetyl@N-term/K')
    expect(m.rows[0].names).toBe('Acetyl@N-term/K(+0.1ppm);Trimethyl@K(-3.0mDa)')
  })

  it('votes by entry with the spectra; rows without a name do not vote; the sites of the voters, most-supported first', () => {
    const m = poolTables([
      table('/a', [['0.9840', 6, 3, 'N:2,Q:1', 3, 'Deamidated@N/Q(+0.1ppm)']]),
      table('/b', [['0.9850', 4, 2, 'Q:2', 2, 'Deamidated@Q(+1.0ppm)']]),
      table('/c', [['0.9845', 9, 1, 'N:1', 8, 'Asn->Asp@N(+0.5ppm)']]),
      table('/d', [['0.9830', 50, 0, '-', 50]])
    ])
    const r = m.rows[0]
    // Deamidated 10 spectra, Asn->Asp 9: Deamidated, with N (3) and Q (3), tie in the order named.
    expect(r.name).toBe('Deamidated@N/Q')
    expect(r.names).toBe('Best names of the pooled rows: Deamidated@N/Q: 10 spectra in 2 tables; Asn->Asp@N: 9 spectra in 1 table')
  })

  it('orders the sites by the pooled support and shows three', () => {
    const m = poolTables([
      table('/a', [['15.9950', 10, 10, 'W:6,M:4', 0, 'Oxidation@W/M(+0.1ppm)']]),
      table('/b', [['15.9950', 10, 10, 'M:5,F:3,Y:2', 0, 'Oxidation@M/F/Y(+0.1ppm)']]),
      table('/c', [['15.9950', 2, 2, 'H:1,N-term|M:1', 0, 'Oxidation@H/M(+0.1ppm)']])
    ])
    // M 4+5 (N-term|M is the terminus's), W 6, F 3, Y 2, H 1.
    expect(m.rows[0].name).toBe('Oxidation@M/W/F/…')
    expect(m.rows[0].names).toMatch(/Oxidation@M\/W\/F\/Y\/H: 22 spectra in 3 tables$/)
  })

  it('ties between entries go by name; an isotope error has no sites; no name at all is empty', () => {
    const iso = poolTables([table('/a', [['1.0030', 4, 0, '-', 4, '13C+1']]), table('/b', [['1.0035', 4, 0, '-', 4, 'Label:15N(1)@L(+2ppm)']])])
    // 1.16.4: both rows are an isotope error (bestShiftName), one by the gap.
    expect(iso.rows[0].name).toBe('isotope error +1')
    const none = poolTables([table('/a', [['77.0000', 4, 0, '-', 4]]), table('/b', [['77.0010', 4, 0, '-', 4]])])
    expect([none.rows[0].name, none.rows[0].names]).toEqual(['', ''])
    expect(nameParts('Methyl@C[-Carbamidomethyl]')).toEqual({ entry: 'Methyl', sites: ['C[-Carbamidomethyl]'] })
  })
})

describe('poolTables: the unshifted rows', () => {
  it('leaves out |delta| under 0.5 Da, keeps 0.5 itself, and counts what it left out per table', () => {
    const a = table('/a', [['-0.5000', 2, 0, '-', 2], ['-0.4995', 3, 0, '-', 3], ['0.0000', 1769, 13, 'C-term|K:8,C-term|R:4,Protein C-term|K:1', 1], ['0.4995', 4, 0, '-', 4], ['0.5000', 5, 0, '-', 5]])
    const b = table('/b', [['0.0005', 100, 2, 'C-term|R:2', 0], ['15.9950', 7, 1, 'M:1', 6]])
    const m = poolTables([a, b])
    expect(keys(m)).toEqual(['-0.5000', '0.5000', '15.9950'])
    expect([m.unshiftedRows, m.unshiftedSpectra]).toEqual([4, 1876])
    expect(m.parts).toEqual([
      { path: '/a', rows: 2, spectra: 7, unshiftedRows: 3, unshiftedSpectra: 1776 },
      { path: '/b', rows: 1, spectra: 7, unshiftedRows: 1, unshiftedSpectra: 100 }
    ])
    // The 0 Da row's C-term sites are gone with it.
    expect(m.columns).toEqual(['M'])
  })
})

const LENS = ['ah_4068_ZW_032115_UIF_N_57yo', 'ah_4068_ZW_032115_UIF_IC_57yo', 'sh_4096_ZW_041615_UIF_N_22yo', 'sh_4096_ZW_041615_UIF_IC_22yo']
const lens = LENS.map((n) => sourceOf(parseDelta(readFileSync(`src/fixtures/cli-1.16/pxd045734-lens/${n}.delta.tsv`, 'utf8'), `/data/${n}.delta.tsv`))!)

describe('poolTables on four PXD045734 lens runs (FASTag 1.16.2)', () => {
  it('one table at the default tolerance is its own shifted rows', () => {
    const one = poolTables([lens[0]], 'terminus', DELTA_GROUP_DA)
    const all = pivotResidues(parseDelta(readFileSync(`src/fixtures/cli-1.16/pxd045734-lens/${LENS[0]}.delta.tsv`, 'utf8'), '/x'))!
    const shifted = all.rows.filter((r) => Math.abs(r.delta) >= 0.5)
    // awk: 719 rows, 10 under 0.5 Da with 1783 spectra (0.0000: 1769).
    expect(one.rows).toHaveLength(709)
    expect([one.unshiftedRows, one.unshiftedSpectra]).toEqual([10, 1783])
    expect(one.rows.map((r) => [r.key, r.spectra, r.localized, r.name])).toEqual(shifted.map((r) => [r.key, r.spectra, r.localized, r.name]))
  })

  it('keeps every shifted spectrum: each row in exactly one pooled row, no pooled row wider than twice the tolerance', () => {
    const m = poolTables(lens)
    // awk: shifted spectra 2474 + 2409 + 816 + 949, rows 709 + 684 + 306 + 336.
    expect(m.rows.reduce((n, r) => n + r.spectra, 0)).toBe(6648)
    expect(m.rows.reduce((n, r) => n + r.members, 0)).toBe(2035)
    expect(m.unshiftedSpectra).toBe(1783 + 2456 + 1463 + 1820)
    const loc = lens.flatMap((s) => s.rows.filter((r) => Math.abs(r.delta) >= 0.5)).reduce((n, r) => n + r.localized, 0)
    expect(m.rows.reduce((n, r) => n + r.localized, 0)).toBe(loc)
    expect(m.mismatched).toEqual([])
    for (const r of m.rows) {
      expect(r.hi - r.lo).toBeLessThanOrEqual(2 * DELTA_GROUP_DA + 1e-9)
      expect(r.tables).toBeLessThanOrEqual(4)
    }
    expect(m.rows.length).toBeLessThan(2035)
    // The oxidation row is in all four runs.
    const ox = m.rows.reduce((b, r) => (r.name.startsWith('Oxidation@') && r.spectra > b.spectra ? r : b))
    expect(ox.tables).toBe(4)
    expect(Math.abs(ox.delta - 15.9949)).toBeLessThan(0.005)
  })
})

describe('pool tolerance', () => {
  it('reads -delta_group off a command line: the default when absent', () => {
    expect(deltaGroupOf(['FASTag', '-in', 'x.mzML'])).toBe(0.004)
    expect(deltaGroupOf(['FASTag', '-delta_group', '0.01'])).toBe(0.01)
    expect(deltaGroupOf(['FASTag', '-delta_group', 'x'])).toBeNull()
  })

  it("uses the runs' -delta_group when every run is recorded with the same one above 0, else the default", () => {
    expect(poolTolerance([0.01, 0.01])).toEqual({ tolerance: 0.01, recorded: true })
    expect(poolTolerance([0.004, 0.004])).toEqual({ tolerance: 0.004, recorded: true })
    expect(poolTolerance([0.01, null])).toEqual({ tolerance: 0.004, recorded: false })
    expect(poolTolerance([0.01, 0.02])).toEqual({ tolerance: 0.004, recorded: false })
    expect(poolTolerance([0, 0])).toEqual({ tolerance: 0.004, recorded: false })
    expect(poolTolerance([null, null])).toEqual({ tolerance: 0.004, recorded: false })
  })
})

describe('200 synthetic tables', () => {
  it('parse and pool in well under a few seconds', () => {
    // 700 rows each, as a lens run's table: gaps on a 0.0045 Da grid with jitter, a 0 Da row, sites on 5 residues.
    let seed = 7
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    const texts = Array.from({ length: 200 }, (_, k) => {
      const lines = [HEAD.trimEnd()]
      lines.push(`0.0000\t1800\t?:14\t13\tC-term|K:9,C-term|R:4\t1\t-\t-\t-`)
      for (let i = 0; i < 700; i++) {
        const d = (1 + i * 0.6 + Math.floor(rnd() * 3) * 0.0005).toFixed(4)
        const loc = Math.floor(rnd() * 4)
        const res = loc ? `${'MKNQS'[i % 5]}:${loc}` : '-'
        lines.push(`${d}\t${loc + 2}\t?:${loc + 2}\t${loc}\t${res}\t2\t${i % 7 ? '-' : `Mod${i % 3}@${'MKNQS'[i % 5]}(+1ppm)`}\t-\t-`)
      }
      return { path: `/runs/run${k}.delta.tsv`, text: lines.join('\n') + '\n' }
    })
    const t0 = performance.now()
    const sources = texts.map((x) => sourceOf(parseDelta(x.text, x.path))!)
    const t1 = performance.now()
    const m = poolTables(sources)
    const t2 = performance.now()
    console.info(`200 synthetic tables: parse ${(t1 - t0).toFixed(0)} ms, pool ${(t2 - t1).toFixed(0)} ms, ${m.rows.length} rows`)
    expect(m.unshiftedSpectra).toBe(200 * 1800)
    expect(m.rows.reduce((n, r) => n + r.members, 0)).toBe(200 * 700)
    expect(t2 - t0).toBeLessThan(5000)
  })
})
