// Mass shifts by residue (shiftMatrix.ts) on real CLI output: the 1.16.2
// survey of PXD000001 (src/fixtures/cli-1.16/README.md), the 1.15 Mass-shift
// workflow run (a residues column of '-' only) and a 1.12 table without
// survey columns. Every expected value was read off the files by hand (awk
// and a Python csv reader over run.delta.tsv), never computed by the GUI.
// The few synthetic rows are marked as such: no recorded file has a plain
// residue site or an unreadable pair.

// @ts-ignore -- node built-in; the app's tsconfig has no node types
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDelta } from './tables'
import { AMINO_ACIDS, columnOrder, delimited, firstName, localizedPct, parseSites, pivotResidues, shownColumns, siteColumn } from './shiftMatrix'

const read = (p: string): string => readFileSync(`src/fixtures/${p}`, 'utf8')
const PXD1 = parseDelta(read('cli-1.16/pxd000001-survey/run.delta.tsv'), '/d/run.delta.tsv')
const rowOf = (m: NonNullable<ReturnType<typeof pivotResidues>>, key: string) => m.rows.find((r) => r.key === key)!

describe('shiftMatrix: parseSites', () => {
  it('reads the pairs in the file order, ties by name as the CLI writes them', () => {
    const cell = PXD1.extra.residues[PXD1.keys.indexOf('229.1620')]
    expect(parseSites(cell)).toEqual([
      { site: 'C-term|K', n: 8 },
      { site: 'N-term|A', n: 3 },
      { site: 'N-term|I', n: 3 },
      { site: 'N-term|T', n: 3 },
      { site: 'N-term|L', n: 2 },
      { site: 'N-term|V', n: 2 },
      { site: 'N-term|D', n: 1 },
      { site: 'N-term|E', n: 1 },
      { site: 'N-term|H', n: 1 },
      { site: 'N-term|Q', n: 1 },
      { site: 'Protein C-term|K', n: 1 }
    ])
  })

  it("is empty for '-' and ''", () => {
    expect(parseSites('-')).toEqual([])
    expect(parseSites('')).toEqual([])
    expect(parseSites(' - ')).toEqual([])
  })

  it('leaves out a pair without a count and says how many (synthetic)', () => {
    const bad = { n: 0 }
    expect(parseSites('M:6,K,W:x,Protein N-term|M:2', bad)).toEqual([
      { site: 'M', n: 6 },
      { site: 'Protein N-term|M', n: 2 }
    ])
    expect(bad.n).toBe(2)
  })
})

describe('shiftMatrix: site columns', () => {
  it('puts a terminal site under its terminus, or under its residue', () => {
    expect(siteColumn('K')).toBe('K')
    expect(siteColumn('N-term|K')).toBe('N-term')
    expect(siteColumn('Protein N-term|M')).toBe('N-term')
    expect(siteColumn('C-term|R')).toBe('C-term')
    expect(siteColumn('Protein C-term|L')).toBe('C-term')
    expect(siteColumn('N-term|K', 'residue')).toBe('K')
    expect(siteColumn('Protein C-term|L', 'residue')).toBe('L')
    expect(siteColumn('U', 'residue')).toBe('U')
  })

  it('orders N-term, the 20 residues, C-term, then any other site', () => {
    expect(columnOrder(['U', 'C-term', 'Y', 'A', 'N-term', 'K', 'B'])).toEqual(['N-term', 'A', 'K', 'Y', 'C-term', 'B', 'U'])
    expect(AMINO_ACIDS).toHaveLength(20)
  })
})

describe('shiftMatrix: pivotResidues on the PXD000001 survey (FASTag 1.16.2)', () => {
  const m = pivotResidues(PXD1)!

  it('has a row per mass shift and the totals of the file', () => {
    expect(m.rows).toHaveLength(222)
    expect(m.rows.reduce((n, r) => n + r.spectra, 0)).toBe(847)
    expect(m.rows.reduce((n, r) => n + r.localized, 0)).toBe(151)
    expect(m.rows.reduce((n, r) => n + r.unlocalized, 0)).toBe(449)
    expect(m.rows.filter((r) => r.localized > 0)).toHaveLength(27)
    expect(m.unreadable).toBe(0)
  })

  it("sums every row's cells to its localized column", () => {
    expect(m.mismatched).toEqual([])
    for (const r of m.rows) expect([...r.counts.values()].reduce((a, b) => a + b, 0)).toBe(r.localized)
    // In either terminal mode.
    for (const r of pivotResidues(PXD1, 'residue')!.rows) expect(r.sum).toBe(r.localized)
  })

  it('has terminal sites only: N-term and C-term columns', () => {
    expect(m.terminal).toBe(true)
    expect(m.columns).toEqual(['N-term', 'C-term'])
    const r = rowOf(m, '229.1620')
    expect([r.spectra, r.localized, r.unlocalized]).toEqual([135, 26, 48])
    expect(Object.fromEntries(r.counts)).toEqual({ 'C-term': 9, 'N-term': 17 })
    expect(r.detail.get('C-term')).toEqual([
      { site: 'C-term|K', n: 8 },
      { site: 'Protein C-term|K', n: 1 }
    ])
    expect(Object.fromEntries(rowOf(m, '98.1295').counts)).toEqual({ 'N-term': 1 })
    expect(Object.fromEntries(rowOf(m, '0.0055').counts)).toEqual({ 'C-term': 4 })
  })

  it('counts terminal sites under their residue on request: ties stay apart', () => {
    const byRes = pivotResidues(PXD1, 'residue')!
    expect(byRes.columns).toEqual(['A', 'D', 'E', 'F', 'G', 'H', 'I', 'K', 'L', 'M', 'N', 'Q', 'R', 'S', 'T', 'V', 'Y'])
    const r = rowOf(byRes, '229.1620')
    expect(Object.fromEntries(r.counts)).toEqual({ K: 9, A: 3, I: 3, T: 3, L: 2, V: 2, D: 1, E: 1, H: 1, Q: 1 })
    expect(Object.fromEntries(rowOf(byRes, '98.1295').counts)).toEqual({ M: 1 })
    // 116.0760: I and L, one each (the CLI tells them apart by name only).
    expect(Object.fromEntries(rowOf(byRes, '116.0760').counts)).toEqual({ I: 1, L: 1 })
  })

  it('names a row by its first UniMod entry, without the mass error', () => {
    expect(rowOf(m, '229.1620').name).toBe('TMT6plex@N-term/K/T/H')
    expect(rowOf(m, '229.1620').names).toBe('TMT6plex@N-term/K/T/H(-0.5ppm)')
    expect(rowOf(m, '101.0730').name).toBe('HN2_mustard@K')
    expect(rowOf(m, '73.0600').name).toBe('')
  })

  it('gives the localized share of the spectra', () => {
    expect(localizedPct(rowOf(m, '229.1620'))).toBe(19) // 26 of 135
    expect(localizedPct(rowOf(m, '98.1295'))).toBe(100)
  })

  it('shows the 20 residues and both termini unless empty columns are hidden', () => {
    const all = shownColumns(m, m.rows, false, 'terminus')
    expect(all).toEqual(['N-term', ...AMINO_ACIDS, 'C-term'])
    expect(shownColumns(m, m.rows, true, 'terminus')).toEqual(['N-term', 'C-term'])
    // The rows a filter keeps decide which columns have counts.
    expect(shownColumns(m, [rowOf(m, '98.1295')], true, 'terminus')).toEqual(['N-term'])
    const byRes = pivotResidues(PXD1, 'residue')!
    expect(shownColumns(byRes, byRes.rows, false, 'residue')).toEqual([...AMINO_ACIDS])
  })
})

describe('shiftMatrix: other recorded tables', () => {
  it("the 1.15 Mass-shift workflow run: one row, residues '-'", () => {
    const d = parseDelta(read('cli-1.15/workflows/mass-shift/run01.delta.tsv'), '/d/run01.delta.tsv')
    const m = pivotResidues(d)!
    expect(m.rows).toHaveLength(1)
    expect(m.rows[0]).toMatchObject({ key: '0.0000', spectra: 5, localized: 0, unlocalized: 0, sum: 0, name: '' })
    expect(m.rows[0].counts.size).toBe(0)
    expect(m.columns).toEqual([])
    expect(m.terminal).toBe(false)
    expect(shownColumns(m, m.rows, true, 'terminus')).toEqual([])
    expect(shownColumns(m, m.rows, false, 'terminus')).toEqual([...AMINO_ACIDS])
  })

  it('a 1.12 table has no residues column: no matrix', () => {
    const d = parseDelta(read('cli/v112-pxd014764-delta-ext3/run.delta.tsv'), '/d/run.delta.tsv')
    expect(pivotResidues(d)).toBeNull()
  })

  it('plain residues, a PSI-MOD name and a row that does not add up (synthetic)', () => {
    const text =
      'delta\tspectra\ttop_interps\tlocalized\tresidues\tunlocalized\tunimod\tpsimod\tisotope_error\n' +
      '15.9950\t9\tmod:Oxidation@M:7;?:2\t8\tM:6,W:2\t1\t-\tMOD:00719 oxidation to L-methionine sulfoxide@M(+0.4ppm)\t-\n' +
      '1.0030\t4\t?:4\t3\tK:1\t1\t-\t-\t13C+1(+2.0ppm)\n'
    const m = pivotResidues(parseDelta(text, '/d/x.tsv'))!
    expect(m.columns).toEqual(['K', 'M', 'W'])
    expect(m.terminal).toBe(false)
    expect(m.rows[0].name).toBe('MOD:00719 oxidation to L-methionine sulfoxide@M')
    expect(m.rows[1].name).toBe('isotope error +1')
    // 1 of 3 localized spectra has a site: said, not hidden.
    expect(m.mismatched).toEqual([1])
  })
})

describe('shiftMatrix: delimited', () => {
  it('writes TSV with tabs in values made spaces, CSV with quotes where needed', () => {
    expect(delimited(['a', 'b'], [['x\ty', '1']], 'tsv')).toBe('a\tb\nx y\t1\n')
    expect(delimited(['delta', 'name'], [['229.1620', 'Gln->pyro-Glu@N-term Q, "x"']], 'csv')).toBe('delta,name\n229.1620,"Gln->pyro-Glu@N-term Q, ""x"""\n')
  })
})

describe('shiftMatrix: firstName', () => {
  it('takes the first entry and drops its error', () => {
    expect(firstName('Oxidation@M/W(+0.4ppm);Dioxidation@C(-3.0mDa)')).toBe('Oxidation@M/W')
    expect(firstName('-')).toBe('')
    expect(firstName(undefined)).toBe('')
  })
})
