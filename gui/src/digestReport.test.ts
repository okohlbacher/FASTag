import { describe, expect, it } from 'vitest'
import digestTsv from './fixtures/digest.tsv?raw'
import nocallTsv from './fixtures/digest_nocall.tsv?raw'
import labelTsv from './fixtures/label.tsv?raw'
import massgapTsv from './fixtures/massgap.tsv?raw'
import {
  ALPHABET,
  digestCall,
  gapHistogram,
  gapPeaks,
  labelFindings,
  logoColumn,
  modelLogo,
  modelScores,
  observedLogo,
  parseReport,
  positionCounts,
  topBins
} from './digestReport'

const digest = parseReport(digestTsv, '/r/a.digest.tsv')

describe('parseReport', () => {
  it('tells the three reports apart by their sections', () => {
    expect(digest.kind).toBe('digest')
    expect(parseReport(labelTsv, 'l').kind).toBe('label')
    expect(parseReport(massgapTsv, 'm').kind).toBe('massgap')
  })

  it('reads columns by name and n as a number or null', () => {
    const r = parseReport('description\tn\tvalue\tkey\tsection\nsix\t-\t6\tC.K\tresidue\nfive\t12\t5\tC.R\tresidue\n', 'x')
    expect(r.rows[0]).toEqual({ section: 'residue', key: 'C.K', value: '6', n: null, description: 'six' })
    expect(r.rows[1].n).toBe(12)
  })

  it('rejects a file that is not a report', () => {
    expect(() => parseReport('', 'x')).toThrow(/empty/)
    expect(() => parseReport('spectrum\ttag\n', 'x')).toThrow(/no section, key, value, n, description column/)
    expect(() => parseReport('section\tkey\tvalue\tn\tdescription\nrun\tversion\t1.8.0\t-\tv\n', 'x')).toThrow(
      /none of their sections/
    )
  })
})

describe('digest', () => {
  it('reads the call', () => {
    const c = digestCall(digest)
    expect(c).toMatchObject({ status: 'call', model: 'Trypsin', runnerUp: 'Lys-C', usesNterm: false })
    expect(c.margin).toBe(0.3788)
    expect(c.fired).toEqual([])
  })

  it('reads a no-call with its reason, the rules that fired and the absent metadata', () => {
    const c = digestCall(parseReport(nocallTsv, 'x'))
    expect(c).toMatchObject({ status: 'no_call', reason: 'low_resolution', margin: null })
    expect(c.fired).toEqual(['low_resolution', 'few_tags'])
    expect(c.unknown).toEqual(['timstof', 'ms2_scan_window'])
  })

  it('reads counts per position and models in report order', () => {
    const p1 = positionCounts(digest, 'C', 'P1')
    expect(Object.keys(p1)).toEqual(ALPHABET)
    expect(p1['K']).toBeGreaterThan(p1['R'])
    expect(modelScores(digest).map((m) => m.model)).toEqual([
      'Trypsin', 'Lys-C', 'Arg-C', 'Glu-C', 'Chymotrypsin', 'Asp-N', 'Lys-N', 'unspecific'
    ])
    expect(modelScores(digest)[7].cls).toBe('unspecific cleavage')
  })
})

describe('logo', () => {
  const uniform = Object.fromEntries(ALPHABET.map((a) => [a, 1]))

  it('gives two equal residues log2(19/2) bits against a uniform background', () => {
    const c = logoColumn('P1', { K: 10, R: 10 }, uniform, 20)
    expect(c.bits).toBeCloseTo(Math.log2(19 / 2), 10)
    expect(c.letters.map((l) => l.aa).sort()).toEqual(['K', 'R'])
    for (const l of c.letters) expect(l.bits).toBeCloseTo(c.bits / 2, 10)
  })

  it('draws nothing where the column equals the background', () => {
    const c = logoColumn('P2', { A: 3, C: 1 }, { A: 30, C: 10 }, 4)
    expect(c.bits).toBeCloseTo(0, 12)
  })

  it('stacks the largest letter on top', () => {
    const c = logoColumn('P1', { K: 30, R: 10 }, uniform, 40)
    expect(c.letters.map((l) => l.aa)).toEqual(['R', 'K'])
  })

  it('draws a model only at P1 and P1′', () => {
    const cols = modelLogo(digest, 'Trypsin')!
    expect(cols.map((c) => c.label)).toEqual(['P4', 'P3', 'P2', 'P1', "P1'", "P2'", "P3'", "P4'"])
    expect(cols.filter((c) => c.letters.length).map((c) => c.label)).toEqual(['P1'])
    // K and R share P1 equally; the N end is the background.
    expect(cols[3].letters.map((l) => l.aa).sort()).toEqual(['K', 'R'])
    expect(cols[4].bits).toBe(0)
  })

  it('has eight observed columns with their n', () => {
    const cols = observedLogo(digest)
    expect(cols).toHaveLength(8)
    expect(cols[3].n).toBe(Object.values(positionCounts(digest, 'C', 'P1')).reduce((a, b) => a + b, 0))
    expect(cols[3].bits).toBeGreaterThan(cols[2].bits)
  })

  it('returns null for a model the report has no distribution of', () => {
    expect(modelLogo(digest, 'HLA-I')).toBeNull()
  })
})

describe('label and mass gaps', () => {
  it('reads the label rows', () => {
    const l = labelFindings(parseReport(labelTsv, 'l'))
    expect(l.map((x) => x.label)).toEqual(['TMT', 'TMTpro', 'iTRAQ4'])
    expect(l[1]).toMatchObject({ count: 1210, background: 9 })
  })

  it('reads the histogram in gap order and the peaks', () => {
    const m = parseReport(massgapTsv, 'm')
    const bins = gapHistogram(m)
    for (let i = 1; i < bins.length; i++) expect(bins[i].gap).toBeGreaterThan(bins[i - 1].gap)
    const peaks = gapPeaks(m)
    expect(peaks[0]).toMatchObject({ index: 1, explainedBy: 'Oxidation', alternatives: [] })
    expect(peaks[2]).toMatchObject({ explainedBy: 'none', alternatives: ['Deamidated'] })
  })

  it('keeps the fullest bins, in gap order', () => {
    const bins = [
      { gap: -1, key: '-1', spectra: 5 },
      { gap: 0, key: '0', spectra: 1 },
      { gap: 1, key: '1', spectra: 9 },
      { gap: 2, key: '2', spectra: 5 }
    ]
    expect(topBins(bins, 2).map((b) => b.gap)).toEqual([-1, 1])
    expect(topBins(bins, null)).toBe(bins)
  })
})
