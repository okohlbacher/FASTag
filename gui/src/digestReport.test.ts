import { describe, expect, it } from 'vitest'
import digestTsv from './fixtures/digest.tsv?raw'
import nocallTsv from './fixtures/digest_nocall.tsv?raw'
import labelTsv from './fixtures/label.tsv?raw'
import massgapTsv from './fixtures/massgap.tsv?raw'
import alkylationTsv from './fixtures/alkylation.tsv?raw'
import {
  ALPHABET,
  alkylationCall,
  backgroundWords,
  baseName,
  digestCall,
  gapHistogram,
  gapPeaks,
  labelFindings,
  logoColumn,
  modelLogo,
  observedLogo,
  parseReport,
  positionCounts,
  smallSampleBias,
  topBins,
  value
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
    expect(c.margin).toBeCloseTo(1.4788, 4)
    expect(c.fired).toEqual([])
  })

  it('reads a no-call with its reason, the rules that fired and the absent metadata', () => {
    const c = digestCall(parseReport(nocallTsv, 'x'))
    expect(c).toMatchObject({ status: 'no_call', reason: 'low_resolution', margin: null })
    expect(c.fired).toEqual(['low_resolution', 'ms2_first_peak', 'few_tags'])
    expect(c.unknown).toEqual([])
  })

  it('reads the 1.10.0 ion_counts rule and its meta row', () => {
    const r = parseReport(nocallTsv, 'x')
    expect(value(r, 'nocall', 'ion_counts')).toBe('no')
    expect(Number(value(r, 'meta', 'ms2_whole_intensity_share'))).toBeLessThan(0.5)
    const fired = digestCall(parseReport(nocallTsv.replace(/^nocall\tion_counts\tno\t/m, 'nocall\tion_counts\tyes\t'), 'x')).fired
    expect(fired).toEqual(['low_resolution', 'ms2_first_peak', 'ion_counts', 'few_tags'])
  })

  it('reads counts per position', () => {
    const p1 = positionCounts(digest, 'C', 'P1')
    expect(Object.keys(p1).sort()).toEqual(ALPHABET)
    expect(p1['K']).toBeGreaterThan(p1['R'])
  })
})

describe('logo', () => {
  const uniform = Object.fromEntries(ALPHABET.map((a) => [a, 1]))

  it('gives two equal residues log2(19/2) bits against a uniform background', () => {
    const c = logoColumn('P1', { K: 10, R: 10 }, uniform, null)
    expect(c.bits).toBeCloseTo(Math.log2(19 / 2), 10)
    expect(c.letters.map((l) => l.aa).sort()).toEqual(['K', 'R'])
    for (const l of c.letters) expect(l.bits).toBeCloseTo(c.bits / 2, 10)
  })

  it('takes the small-sample bias off an observed column', () => {
    const c = logoColumn('P1', { K: 10, R: 10 }, uniform, 20)
    expect(c.raw).toBeCloseTo(Math.log2(19 / 2), 10)
    expect(c.bits).toBeCloseTo(Math.log2(19 / 2) - 18 / (40 * Math.LN2), 10)
    expect(smallSampleBias(20)).toBeCloseTo(18 / (40 * Math.LN2), 12)
  })

  it('draws nothing for a column of one observation', () => {
    const c = logoColumn('P1', { K: 1 }, uniform, 1)
    expect(c.raw).toBeCloseTo(Math.log2(19), 10)
    expect(c.bits).toBe(0)
    expect(c.letters).toEqual([])
  })

  it('greys columns below tag_min and the N end the call leaves out', () => {
    const cols = observedLogo(digest)
    expect(cols.slice(4).every((c) => c.faded)).toBe(true) // uses_nterm no
    expect(cols.slice(0, 4).map((c) => c.faded)).toEqual(cols.slice(0, 4).map((c) => (c.n ?? 0) < 100))
  })

  it('names the background in words', () => {
    expect(backgroundWords('shipped_human')).toMatch(/human reference proteome/)
    expect(backgroundWords('fasta:/d/x/up.fasta')).toBe('the residue composition of up.fasta')
    expect(baseName('C:\\d\\a.tsv')).toBe('a.tsv')
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
    expect(l[1]).toMatchObject({ count: 0, background: 0, share: 0, n: 26909 })
  })

  it('keeps a label report with the 1.12 label_call rows a label report', () => {
    const call = [
      'label_call\tstatus\tcall\t25512\tA label call is made from 25512 C-terminal tag ends and 26909 filtered tags.',
      'label_call\tlabel\tTMT\t26909\tThe run is labelled TMT.',
      'label_call\tbasis\tnterm_gap\t-\tThe call rests on N-terminal label gaps.',
      'label_call\tsilac\tnone\t-\tSILAC needs Lys8 and Arg10 shares of at least 0.2.',
      'label_call\treason\t-\t-\tA label call is made.'
    ].join('\n')
    const r = parseReport(labelTsv.replace(/\n*$/, '\n') + call + '\n', 'l')
    expect(r.kind).toBe('label')
    expect(r.warnings).toEqual([])
    expect(labelFindings(r)).toEqual(labelFindings(parseReport(labelTsv, 'l')))
    expect(value(r, 'label_call', 'label')).toBe('TMT')
  })

  it('reads the histogram in gap order and the peaks', () => {
    const m = parseReport(massgapTsv, 'm')
    const bins = gapHistogram(m)
    for (let i = 1; i < bins.length; i++) expect(bins[i].gap).toBeGreaterThan(bins[i - 1].gap)
    const peaks = gapPeaks(m)
    expect(peaks.map((p) => p.index)).toEqual([1, 2, 3, 4, 5])
    expect(peaks[0]).toMatchObject({ index: 1, spectra: 3, explainedBy: 'none', alternatives: [] })
    expect(peaks[0].delta).toBeCloseTo(-484.592, 3)
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

describe('alkylation (1.12 -alkylation_out)', () => {
  // gui/src/fixtures/alkylation.tsv: FASTag 1.12 on the vendored Ecoli fixture
  // with -alkylation_proteome Ecoli_MS2_small.fasta (no Cys placement: no_call).
  const called = (text: string): string =>
    text
      .replace(/^alkylation_call\tstatus\t[^\n]*$/m, 'alkylation_call\tstatus\tcall\t32\tThe cysteines are alkylated.')
      .replace(/^alkylation_call\treagent\t[^\n]*$/m, 'alkylation_call\treagent\tCarbamidomethyl\t30\tThe call is Carbamidomethyl.')
      .replace(/^alkylation_call\tmass\t[^\n]*$/m, 'alkylation_call\tmass\t57.021464\t-\tCarbamidomethyl adds 57.021464 Da to C.')
      .replace(/^alkylation_call\tshare\t[^\n]*$/m, 'alkylation_call\tshare\t0.9375\t32\tA share of 0.938.')
      .replace(/^alkylation_call\treason\t[^\n]*$/m, 'alkylation_call\treason\t-\t-\tThe call is made.')

  it('is its own kind, never a mass-gap report', () => {
    const r = parseReport(alkylationTsv, 'a')
    expect(r.kind).toBe('alkylation')
    expect(r.warnings).toEqual([])
    // the mass-gap report keeps its kind, and its cys section alone still means mass gap
    expect(parseReport(massgapTsv, 'm').kind).toBe('massgap')
    expect(parseReport('section\tkey\tvalue\tn\tdescription\ncys\tC.57.021\t3\t-\tx\n', 'c').kind).toBe('massgap')
    // an alkylation report that also carried a cys row would still be one
    expect(parseReport(alkylationTsv + 'cys\tx\t1\t-\ty\n', 'a').kind).toBe('alkylation')
  })

  it('reads a no-call with its reason and the database caveat', () => {
    const c = alkylationCall(parseReport(alkylationTsv, 'a'))
    expect(c).toEqual({
      status: 'no_call',
      reagent: undefined,
      mass: null,
      share: null,
      binned: 0,
      reason: 'few_cys_spectra',
      databaseSource: 'proteome',
      format: 1
    })
  })

  it('reads a call', () => {
    const c = alkylationCall(parseReport(called(alkylationTsv), 'a'))
    expect(c).toMatchObject({ status: 'call', reagent: 'Carbamidomethyl', mass: 57.021464, share: 0.9375, binned: 32 })
    expect(c.reason).toBeUndefined()
  })

  it('reads a call of none without a mass', () => {
    const none = called(alkylationTsv)
      .replace(/^alkylation_call\treagent\t[^\n]*$/m, 'alkylation_call\treagent\tnone\t30\tThe call is none.')
      .replace(/^alkylation_call\tmass\t[^\n]*$/m, 'alkylation_call\tmass\t-\t-\tA call of none has no reagent mass.')
    expect(alkylationCall(parseReport(none, 'a'))).toMatchObject({ status: 'call', reagent: 'none', mass: null })
  })
})
