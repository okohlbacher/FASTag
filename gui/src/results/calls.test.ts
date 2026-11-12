// calls.ts against real CLI output on the gate PXDs (GUI-DESIGN 9 layer 1,
// 10 P2b): FASTag 1.11.0, where the 1.12 rows and columns are absent, and
// integration/1.12, where they are present. Every expected value below is
// read off the fixture files by hand (src/fixtures/cli), never computed by
// the GUI: calls.ts parses, it decides nothing (Q2).

import { describe, expect, it } from 'vitest'
import { parseReport } from '../digestReport'
import { CLI_CASES, logLines, type CliCase } from '../testing/cliFixtures'
import { speciesFromTsv } from '../testing/speciesTsv'
import { alkylationCall, censusFacts, labelCall, parseLog, proteaseCall, runFacts, speciesCall } from './calls'

const digest = (c: CliCase) => parseReport(c.digest, `/d/${c.name}.digest.tsv`)
const label = (c: CliCase) => parseReport(c.label, `/d/${c.name}.label.tsv`)
const species = (c: CliCase) => speciesFromTsv(c.species, `/d/${c.name}.species.tsv`)

describe('calls.ts: the run log', () => {
  it('reads the summary, glyco, species and subsampling lines of 1.11, and no 1.12 line', () => {
    const f = parseLog(logLines(CLI_CASES.v111))
    expect(f.ms2).toBe(2738)
    expect(f.tags).toBe(128821)
    expect(f.afterFilter).toBeNull()
    expect(f.glyco).toEqual({ flagged: 1318, of: 2738 })
    expect(f.speciesEvidence).toBe(1760)
    expect(f.subsample).toEqual({ tagged: 3251, of: 32513 })
    // Absent in 1.11: no acquisition line, no census, no species call, no activation warning.
    expect(f.acquisition).toBeNull()
    expect(f.census).toBeNull()
    expect(f.speciesCall).toBeNull()
    expect(f.electron).toBeNull()
  })

  it('reads the 1.12 acquisition check line (E7)', () => {
    const f = parseLog(logLines(CLI_CASES.v112))
    expect(f.acquisition?.mode).toBe('DDA')
    expect(f.acquisition?.why).toMatch(/^no repeating window scheme/)
    expect(f.ms2).toBe(2738)
  })

  it('reads the census and species call lines (F11A, D1)', () => {
    const f = parseLog(logLines(CLI_CASES.v112Call))
    expect(f.census).toEqual({ read: 2738, tagged: 2723 })
    expect(f.speciesCall).toEqual({ present: 4, noCall: 21, notDetected: 25 })
  })

  it('reads the electron-activation warning (E15A) and the filter count of a -fasta run', () => {
    expect(parseLog(logLines(CLI_CASES.v112Da)).electron).toEqual({ electron: 328, of: 686 })
    const f = parseLog(logLines(CLI_CASES.v112Fasta))
    expect(f.ms2).toBe(3016)
    expect(f.tags).toBe(107463)
    expect(f.afterFilter).toBe(3464)
  })

  it('reads the recon index minimum tag length of a FASTA run, and none without one', () => {
    expect(parseLog(logLines(CLI_CASES.v112ReconExt2)).reconMinLength).toBe(8)
    expect(parseLog(logLines(CLI_CASES.v112Fasta)).reconMinLength).toBe(8)
    expect(parseLog(logLines(CLI_CASES.v112)).reconMinLength).toBeNull()
  })

  it('the mass-gap report of extension 2 with -recon_fasta places 0 spectra; extension 3 places 475', () => {
    const mg = (c: CliCase) => alkylationCall(parseReport(c.massgap!, `/d/${c.name}.massgap.tsv`))
    expect(mg(CLI_CASES.v112ReconExt2)).toMatchObject({ state: 'counts', placed: 0 })
    expect(mg(CLI_CASES.v112ReconExt3)).toMatchObject({ state: 'counts', placed: 475 })
  })

  it('takes the last summary line and ignores lines it does not know', () => {
    const f = parseLog(['10 MS2 spectra, 5 tags', 'noise', 'Glyco: x of y', '20 MS2 spectra, 7 tags'])
    expect(f.ms2).toBe(20)
    expect(f.tags).toBe(7)
    expect(f.glyco).toBeNull()
  })
})

describe('calls.ts: protease (digest report)', () => {
  it('reads the call with its margin, runner-up and tag ends', () => {
    expect(proteaseCall(digest(CLI_CASES.v111))).toEqual({
      state: 'call',
      enzyme: 'Trypsin',
      cls: 'Trypsin',
      runnerUp: 'Lys-C',
      margin: 1.0837293026191175,
      ends: 4257
    })
  })

  it('reads a no-call with the CLI reason and its own words', () => {
    const c = proteaseCall(digest(CLI_CASES.v112Da))
    expect(c).toEqual({
      state: 'no_call',
      reason: 'low_resolution',
      why: 'No protease is called: the fragment tolerance is in Da, so the residue windows do not hold.'
    })
  })

  it('is absent without a digest report', () => {
    expect(proteaseCall(null)).toEqual({ state: 'absent' })
  })
})

describe('calls.ts: label (label report, label_call rows of 1.12, D3a)', () => {
  it('1.11 writes no label_call rows: not called, and no rule of the GUI fills in', () => {
    // The TMT10 run: the counts plainly show TMT, yet 1.11 makes no call,
    // so neither does the GUI.
    expect(labelCall(label(CLI_CASES.v111Tmt))).toEqual({ state: 'not_called' })
    expect(labelCall(label(CLI_CASES.v111))).toEqual({ state: 'not_called' })
  })

  it('1.12 calls TMT on the TMT10 run and label-free on the label-free one', () => {
    expect(labelCall(label(CLI_CASES.v112Tmt))).toMatchObject({ state: 'call', label: 'TMT', basis: 'nterm_gap', silac: 'none', ends: 7199 })
    expect(labelCall(label(CLI_CASES.v112))).toMatchObject({ state: 'call', label: 'label-free', basis: 'none', silac: 'none' })
  })

  it('1.12 no-call on a Da run, with its reason', () => {
    expect(labelCall(label(CLI_CASES.v112Da))).toEqual({
      state: 'no_call',
      reason: 'low_resolution',
      why: 'No label is called: the fragment tolerance is in Da, so the label windows do not hold.'
    })
  })

  it('1.13: a call from fewer than 175 tag ends keeps the status row caveat; 175 or more has none', () => {
    const rep = (n: number, extra: string) =>
      parseReport(
        'section\tkey\tvalue\tn\tdescription\n' +
          'heavy\tgate\tno\t-\tToo few K and R tag ends.\n' +
          `label_call\tstatus\tcall\t${n}\tA label call is made from ${n} C-terminal tag ends and 900 filtered tags.${extra}\n` +
          'label_call\tlabel\tlabel-free\t900\tNo label passes.\n' +
          'label_call\tbasis\tnone\t-\tNo label rule fired.\n' +
          'label_call\tsilac\tnone\t-\tSILAC needs more.\n' +
          'label_call\treason\t-\t-\tA label call is made.\n',
        '/d/run.label.tsv'
      )
    const weak = labelCall(rep(12, ' These are fewer than 175, so a label-free call means only that no label rule fired.'))
    expect(weak).toMatchObject({ state: 'call', label: 'label-free', ends: 12, weak: true })
    expect(weak.state === 'call' && weak.why).toBe(
      'No label passes. These are fewer than 175, so a label-free call means only that no label rule fired.'
    )
    const full = labelCall(rep(500, ''))
    expect(full.state === 'call' && full.why).toBe('No label passes.')
    expect(full).toMatchObject({ weak: false })
  })

  it('is absent without a label report', () => {
    expect(labelCall(undefined)).toEqual({ state: 'absent' })
  })
})

describe('calls.ts: alkylation (mass-gap report)', () => {
  it('no FASTA, no mass-gap report: absent, never a call', () => {
    expect(alkylationCall(null)).toEqual({ state: 'absent' })
  })

  it('with a FASTA: the Cys gap counts, without turning counts into a call', () => {
    const r = parseReport(CLI_CASES.v112Fasta.massgap!, '/d/run.massgap.tsv')
    expect(alkylationCall(r)).toEqual({
      state: 'counts',
      placed: 475,
      zero: 140,
      sites: [
        { name: 'Carbamidomethyl (C)', spectra: 11 },
        { name: 'Propionamide (C)', spectra: 0 },
        { name: 'Nethylmaleimide (C)', spectra: 0 },
        { name: 'Methylthio (C)', spectra: 0 },
        { name: 'Carboxymethyl (C)', spectra: 0 }
      ]
    })
  })
})

describe('calls.ts: species', () => {
  it('without -species_call: the CLI ranking, first genus row, with its q-value', () => {
    const c = speciesCall(species(CLI_CASES.v111))
    expect(c.state).toBe('ranked')
    if (c.state !== 'ranked') return
    expect(c.top.name).toBe('Homo')
    expect(c.top.q).toBe(0)
    expect(c.genera).toBe(50)
  })

  it('a ranking keeps the CLI order: the first row is the top, whatever its q', () => {
    const c = speciesCall(species(CLI_CASES.v112Da))
    expect(c.state === 'ranked' && c.top.name).toBe('Gallus')
    expect(c.state === 'ranked' && c.top.q).toBe(0.0876374)
  })

  it('with -species_call decoy (D1): the present genera in the CLI order, and the counts of the others', () => {
    const c = speciesCall(species(CLI_CASES.v112Call))
    expect(c.state).toBe('called')
    if (c.state !== 'called') return
    expect(c.present.map((t) => t.name)).toEqual(['Homo', 'Macaca', 'Sus', 'Equus'])
    expect(c.noCall).toBe(21)
    expect(c.notDetected).toBe(25)
    expect(c.runNoCall).toBeNull()
  })

  it('a run-level no-call (every row the same few_spectra reason) names it', () => {
    const c = speciesCall({
      path: '/d/s.tsv',
      taxa: [
        { rank: 'genus', taxid: 1, name: 'A', observed: 9, adjusted: 9, q: 0.5, call: 'no_call', callReason: 'few_spectra' },
        { rank: 'genus', taxid: 2, name: 'B', observed: 3, adjusted: 3, q: 0.9, call: 'no_call', callReason: 'few_spectra' }
      ]
    })
    expect(c).toMatchObject({ state: 'called', present: [], runNoCall: 'few_spectra' })
  })

  it('absent without a report; none with a report of no taxa', () => {
    expect(speciesCall(null)).toEqual({ state: 'absent' })
    expect(speciesCall({ path: '/d/s.tsv', taxa: [] })).toEqual({ state: 'none' })
  })
})

describe('calls.ts: run facts and the census', () => {
  it('reads the instrument and the tolerance from the digest report', () => {
    expect(runFacts(digest(CLI_CASES.v111))).toEqual({ instrument: 'Q Exactive', tolerance: { value: 20, unit: 'ppm' }, subsampleFraction: 0.1 })
    expect(runFacts(digest(CLI_CASES.v112Da))).toEqual({ instrument: 'LTQ Orbitrap XL', tolerance: { value: 0.5, unit: 'Da' }, subsampleFraction: 0.1 })
    expect(runFacts(null)).toEqual({ instrument: null, tolerance: null, subsampleFraction: null })
  })

  it('reads the census summary: spectra read and tagged, and the activation rows of its run section', () => {
    expect(censusFacts(CLI_CASES.v112Call.census!)).toEqual({
      read: 2738,
      tagged: 2723,
      taggedShare: 0.9945215485756026,
      activation: { collisional: 2738, electron: 0, hybrid: 0, unknown: 0 }
    })
    expect(censusFacts('section\tkey\tvalue\tn\tdescription\n')).toBeNull()
  })
})
