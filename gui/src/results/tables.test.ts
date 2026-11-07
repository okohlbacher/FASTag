// The P4c table parsers (results/tables.ts) on real CLI output
// (src/fixtures/cli, README there): -recon_out, -delta_out, -recon_id_out
// (mzTab) and -glyco_out. Every expected value below was read off the
// fixture files by hand (awk over the TSVs, the run.log lines), never
// computed by the GUI.

// @ts-ignore -- node built-in; the app's tsconfig has no node types
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  filterRecon,
  parseDelta,
  parseGlyco,
  parseRecon,
  parseReconIds,
  parseTable,
  sniffTable,
  tablePaths,
  type ReconTable
} from './tables'

const FX = 'src/fixtures/cli/'
const read = (dir: string, f: string): string => readFileSync(`${FX}${dir}/${f}`, 'utf8')
const HUMAN = 'v112-pxd014764-delta-ext3'
const ECOLI = 'v1111-ecoli-recon-loc'

describe('tables.ts: -recon_out', () => {
  const r: ReconTable = parseRecon(read(HUMAN, 'run.recon.tsv'), '/d/run.recon.tsv')

  it('reads every placement of the human run into typed columns', () => {
    expect(r.rows).toBe(4706)
    expect(r.delta).toBeInstanceOf(Float64Array)
    expect(r.pos).toBeInstanceOf(Int32Array)
    expect(r.nMatch).toBeInstanceOf(Uint8Array)
    // 482 distinct spectra (awk sort -u), held once each.
    expect(r.spectra.length).toBe(482)
    expect(r.spectrum).toBeInstanceOf(Uint32Array)
    expect(r.loc).toBeNull()
    expect(r.warnings).toEqual([])
  })

  it('keeps the first row exactly as written', () => {
    expect(r.spectra[r.spectrum[0]]).toBe('controllerType=0 controllerNumber=1 scan=7682')
    expect(r.tag[0]).toBe('KDAVEQQG')
    expect(r.protein[0]).toBe('sp|Q9NX58|LYAR_HUMAN')
    expect(r.peptide[0]).toBe('VKDAVEQQGEVK')
    expect(r.pos[0]).toBe(1)
    expect(r.reversed[0]).toBe(0)
    expect([r.nMatch[0], r.cMatch[0]]).toEqual([1, 0])
    expect(r.delta[0]).toBe(526.3322)
    expect(r.region[0]).toBe('9-11')
    expect(r.interp[0]).toBe('?')
  })

  it('counts the interpretations as the file has them (3686 ?, 998 empty, 14 sub:E->H)', () => {
    const count = (v: string): number => r.interp.filter((x) => x === v).length
    expect(count('?')).toBe(3686)
    expect(count('')).toBe(998)
    expect(count('sub:E->H')).toBe(14)
  })

  it('filters on the typed columns: one flank off, |delta| and text', () => {
    // 3905 rows have exactly one flank matched (awk $7 != $8).
    expect(filterRecon(r, { gapped: true }).length).toBe(3905)
    const eh = filterRecon(r, { interp: 'sub:E->H' })
    expect(eh.length).toBe(14)
    expect(r.protein[eh[0]]).toBe('sp|P0CG47|UBB_HUMAN')
    expect(r.delta[eh[0]]).toBe(8.0163)
    // A filter returns row ids in file order, as a typed array.
    expect(eh).toBeInstanceOf(Uint32Array)
    expect([...eh]).toEqual([...eh].sort((a, b) => a - b))
    const text = filterRecon(r, { text: 'ubb_human' })
    expect(text.length).toBeGreaterThan(0)
    for (const i of text) expect(r.protein[i]).toBe('sp|P0CG47|UBB_HUMAN')
    for (const i of filterRecon(r, { minAbsDelta: 100 })) expect(Math.abs(r.delta[i])).toBeGreaterThanOrEqual(100)
    // Filters combine as AND.
    expect(filterRecon(r, { gapped: true, interp: 'sub:E->H' }).length).toBe(14)
  })

  it('reads the -recon_localize columns of the E. coli run', () => {
    const e = parseRecon(read(ECOLI, 'run.recon.tsv'), '/d/e.recon.tsv')
    expect(e.rows).toBe(194)
    expect(e.spectra.length).toBe(8)
    expect(e.loc).not.toBeNull()
    // Row 2 (awk NR==3): -1660.9183, 9-29, ?, R69 26 7.
    expect(e.delta[1]).toBe(-1660.9183)
    expect(e.region[1]).toBe('9-29')
    expect(e.loc!.site[1]).toBe('R69')
    expect(e.loc!.score[1]).toBe(26)
    expect(e.loc!.ties[1]).toBe(7)
    // Row 1 has both flanks matched: no region, no site, the score empty (-1).
    expect(e.region[0]).toBe('')
    expect(e.loc!.site[0]).toBe('')
    expect(e.loc!.score[0]).toBe(-1)
    // 130 rows carry a localized site (awk $12 != "").
    expect(e.loc!.site.filter((s) => s !== '').length).toBe(130)
  })

  it('refuses a file that is not a recon table, naming the missing columns', () => {
    expect(() => parseRecon('spectrum\ttag\n', '/d/x.tsv')).toThrow(/no protein, peptide/)
    expect(() => parseRecon('', '/d/x.tsv')).toThrow(/empty/)
  })

  it('warns about a short row instead of dropping or shifting it', () => {
    const head = read(ECOLI, 'run.recon.tsv').split('\n')[0]
    const t = parseRecon(`${head}\ncontrollerType=0 scan=1\tGWAQ\tP1\n`, '/d/short.recon.tsv')
    expect(t.rows).toBe(1)
    expect(t.warnings[0]).toMatch(/row 2 has 3 of 14 columns/)
  })
})

describe('tables.ts: -delta_out', () => {
  it('reads the 273 peaks of the human run; their spectra sum to the 475 placed', () => {
    const d = parseDelta(read(HUMAN, 'run.delta.tsv'), '/d/run.delta.tsv')
    expect(d.rows).toBe(273)
    expect(d.delta[0]).toBe(-4181.0885)
    expect(d.spectra.reduce((a, b) => a + b, 0)).toBe(475)
    const zero = d.keys.indexOf('0.0000')
    expect(d.spectra[zero]).toBe(139)
    expect(d.interps[zero]).toEqual([])
    const k8 = d.keys.indexOf('8.0150')
    expect(d.spectra[k8]).toBe(12)
    expect(d.interps[k8]).toEqual([{ name: '?', n: 12 }])
  })

  it('reads the E. coli run: two rows', () => {
    const d = parseDelta(read(ECOLI, 'run.delta.tsv'), '/d/e.delta.tsv')
    expect([...d.delta]).toEqual([-1263.576, 0])
    expect([...d.spectra]).toEqual([1, 7])
  })

  it('reads several interpretations in the order written', () => {
    const d = parseDelta('delta\tspectra\ttop_interps\n15.9949\t9\tmod:Oxidation@M:7;?:2\n', '/d/x.tsv')
    expect(d.interps[0]).toEqual([{ name: 'mod:Oxidation@M', n: 7 }, { name: '?', n: 2 }])
  })
})

describe('tables.ts: -glyco_out', () => {
  it('reads 3016 spectra of the human run, 44 flagged as its log says', () => {
    const g = parseGlyco(read(HUMAN, 'run.tags.glyco.tsv'), '/d/run.tags.glyco.tsv')
    const log = /^Glyco: (\d+) of (\d+) processed/m.exec(read(HUMAN, 'run.log'))!
    expect(g.rows).toBe(Number(log[2]))
    expect(g.flaggedCount).toBe(Number(log[1]))
    expect(g.rows).toBe(3016)
    expect(g.flaggedCount).toBe(44)
    // The first row: no oxonium ion, ions '-'.
    expect(g.spectrum[0]).toBe('controllerType=0 controllerNumber=1 scan=2')
    expect(g.ions[0]).toEqual([])
    const i = g.spectrum.indexOf('controllerType=0 controllerNumber=1 scan=8335')
    expect(g.nOxonium[i]).toBe(3)
    expect(g.frac[i]).toBe(0.394)
    expect(g.flagged[i]).toBe(1)
    expect(g.ions[i]).toEqual(['HexNAc-CH6O3', 'Hex', 'HexNAc'])
  })

  it('reads the E. coli run: 35 of 139 flagged, as its log says', () => {
    const g = parseGlyco(read(ECOLI, 'run.tags.glyco.tsv'), '/d/e.glyco.tsv')
    expect(g.rows).toBe(139)
    expect(g.flaggedCount).toBe(35)
  })

  it('counts each ion among the flagged spectra', () => {
    const g = parseGlyco(read(HUMAN, 'run.tags.glyco.tsv'), '/d/g.tsv')
    const hexnac = g.ionCounts.find((c) => c.ion === 'HexNAc')
    expect(hexnac?.flagged).toBeGreaterThan(0)
    expect(hexnac!.flagged).toBeLessThanOrEqual(44)
    // Most frequent first.
    for (let k = 1; k < g.ionCounts.length; k++) expect(g.ionCounts[k - 1].flagged).toBeGreaterThanOrEqual(g.ionCounts[k].flagged)
  })
})

describe('tables.ts: -recon_id_out (mzTab)', () => {
  it('reads the 194 PSM rows, one per -recon_out placement', () => {
    const m = parseReconIds(read(ECOLI, 'run.recon.mzTab'), '/d/run.recon.mzTab')
    const recon = parseRecon(read(ECOLI, 'run.recon.tsv'), '/d/e.recon.tsv')
    expect(m.rows).toBe(194)
    expect(m.rows).toBe(recon.rows)
    expect(m.sequence[0]).toBe('DGYADGWAQAGTAR')
    expect(m.accession[0]).toBe('VIMSS17368')
    expect(m.score[0]).toBeCloseTo(3.0041697794350327e-4, 15)
    expect(m.charge[0]).toBe(2)
    expect(m.expMz[0]).toBeCloseTo(719.823303222656, 9)
    expect(m.spectrum[0]).toBe('controllerType=0 controllerNumber=1 scan=11482')
    expect(m.tag[0]).toBe('GWAQ')
    expect(m.delta[0]).toBe(0)
    // 'null' cells read as missing.
    expect(m.interp[0]).toBe('')
    expect(m.interp[1]).toBe('?')
    expect(m.delta[1]).toBeCloseTo(-1660.918325131976, 9)
    // The same peptide and spectrum as the recon row.
    expect(m.sequence[1]).toBe(recon.peptide[1])
  })

  it('says idXML and mzIdentML are not read here', () => {
    expect(() => parseTable('<?xml version="1.0"?><IdXML>', '/d/run.recon.idXML')).toThrow(/idXML.*mzTab/)
    expect(() => parseTable('<?xml version="1.0"?><MzIdentML>', '/d/run.recon.mzid')).toThrow(/mzIdentML.*mzTab/)
  })
})

describe('tables.ts: sniffing and the run outputs', () => {
  it('names each file by its header, and a long-form report as none', () => {
    expect(sniffTable(read(HUMAN, 'run.recon.tsv'))).toBe('recon')
    expect(sniffTable(read(ECOLI, 'run.recon.tsv'))).toBe('recon')
    expect(sniffTable(read(HUMAN, 'run.delta.tsv'))).toBe('delta')
    expect(sniffTable(read(HUMAN, 'run.tags.glyco.tsv'))).toBe('glyco')
    expect(sniffTable(read(ECOLI, 'run.recon.mzTab'))).toBe('reconIds')
    expect(sniffTable(read(HUMAN, 'run.massgap.tsv'))).toBeNull()
    expect(sniffTable('')).toBeNull()
  })

  it('parseTable dispatches by the header', () => {
    expect(parseTable(read(HUMAN, 'run.delta.tsv'), '/d/a.tsv').kind).toBe('delta')
    expect(parseTable(read(ECOLI, 'run.recon.mzTab'), '/d/a.mzTab').kind).toBe('reconIds')
    expect(() => parseTable('a\tb\n', '/d/a.tsv')).toThrow(/not a recon, delta, glyco or mzTab/)
  })

  it('takes the table paths from the resolved outputs only', () => {
    expect(
      tablePaths({ out: '/d/t.tsv', recon_out: '/d/r.tsv', delta_out: null, recon_id_out: '/d/r.mzTab', glyco_out: '/d/t.glyco.tsv' })
    ).toEqual({ recon: '/d/r.tsv', reconIds: '/d/r.mzTab', glyco: '/d/t.glyco.tsv' })
    expect(tablePaths({ out: '/d/t.tsv' })).toEqual({})
  })
})
