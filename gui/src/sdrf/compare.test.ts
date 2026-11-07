// The SDRF comparison table (GUI-DESIGN 3 S6, 10 P4): each batch job's
// SDRF rows (by data file) against what FASTag wrote for it, on organism (by
// NCBI taxid, consistent at genus), cleavage agent, label, modification
// parameters, instrument and fragment mass tolerance. Only the CLI's calls
// count (the calls the batch summary counts: a no call or a call held back
// for too little evidence is "no call", never a mismatch); instrument and
// tolerance are what the CLI's reports say of the run, the modifications its
// log's "Modifications:" line.

// @ts-ignore -- node built-in; the app's tsconfig has no node types
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseReport } from '../digestReport'
import type { JobData } from '../run/batchSummary'
import { BATCH_CASES, type BatchCase } from '../testing/batchFixtures'
import { speciesFromTsv } from '../testing/speciesTsv'
import {
  compareCleavage,
  compareInstrument,
  compareLabel,
  compareModifications,
  compareSdrf,
  compareTolerance,
  FIELDS,
  fileStem,
  type FieldId,
  type SdrfJob
} from './compare'
import { parseSdrf } from './sdrfTable'
import { parseTaxdump } from './taxonomy'

const tx = parseTaxdump(readFileSync('src/fixtures/sdrf/nodes.dmp', 'utf8'), readFileSync('src/fixtures/sdrf/names.dmp', 'utf8'))
const SDRF = parseSdrf(new Uint8Array(readFileSync('src/fixtures/sdrf/gate-batch.sdrf.tsv')))

// What useBatchData reads for a done job (census: the log's census line).
function dataOf(c: BatchCase, dir = '/data'): JobData {
  return {
    log: c.log.split(/\r?\n/).filter((l) => l !== ''),
    reports: [parseReport(c.digest, `${dir}/${c.name}.digest.tsv`), parseReport(c.label, `${dir}/${c.name}.label.tsv`)],
    species: speciesFromTsv(c.species, `${dir}/${c.name}.tags.species.tsv`),
    census: null,
    params: c.params
  }
}
const done = (c: BatchCase): SdrfJob => ({ input: `/data/${c.name}.mzML`, status: 'done', data: dataOf(c) })

// The gate batch in the folder's order, as the Batch view queues it.
const JOBS: SdrfJob[] = [
  done(BATCH_CASES.pxd003531),
  done(BATCH_CASES.pxd003531mzpeak),
  done(BATCH_CASES.pxd004541),
  { input: '/data/pxd006096-dia.mzML', status: 'failed', data: undefined },
  done(BATCH_CASES.pxd006096pseudo),
  done(BATCH_CASES.pxd010783),
  done(BATCH_CASES.pxd014764),
  done(BATCH_CASES.pxd040407)
]

describe('the comparison table of the gate batch against the fixture SDRF', () => {
  const c = compareSdrf(SDRF, JOBS, tx)

  it('matches each job to its SDRF rows by data file (the input, else the input the CLI read)', () => {
    expect(c.dataFileColumn).toBe(true)
    expect(c.jobs.map((j) => [j.file, j.dataFile, j.rows])).toEqual([
      ['pxd003531.mzML', '20130611_QE3_UPLC10_CFR_SA_OC_T_NO_03_01_01.raw', [1]],
      ['pxd003531-mzpeak.mzML', '20130611_QE3_UPLC10_CFR_SA_OC_T_NO_03_01_01.raw', [1]],
      ['pxd004541-tmt.mzML', 'HF1_201501212_GM_RJ1511D_TMT10_hpHRP_DMSO1_2p5ug_4uL_fr02.raw', [2, 3, 4]],
      ['pxd006096-dia.mzML', null, []],
      ['pxd006096-pseudo.mzML', '100815_MM_ABPP_H1993_DMSO_DIA1_new.raw', [9]],
      ['pxd010783.mzML', 'KristenJeff_p53_mod_AspN_03_02_07.raw', [7]],
      ['pxd014764.mzML', '20190412_KEH_HF_SA_ANW_R11_100419_CNOT_R1_f008.raw', [5, 6]],
      ['pxd040407-chymo.mzML', 'Hog1p_WT_Rep3_Chymo_5uL.raw', [8]]
    ])
    // The SDRF row no job ran.
    expect(c.unmatched).toEqual([{ dataFile: 'extra_run_not_in_batch.raw', rows: [10] }])
  })

  it('states every field of every job (the comparison table)', () => {
    const states = Object.fromEntries(c.jobs.map((j) => [j.file, j.fields ? FIELDS.map((f) => j.fields![f].state) : j.verdict.state]))
    // organism, cleavage, label, modifications, instrument, tolerance
    expect(states).toEqual({
      'pxd003531.mzML': ['genus', 'match', 'match', 'match', 'match', 'match'],
      'pxd003531-mzpeak.mzML': ['genus', 'match', 'match', 'match', 'match', 'match'],
      'pxd004541-tmt.mzML': ['genus', 'match', 'match', 'match', 'match', 'mismatch'],
      'pxd006096-dia.mzML': 'not_run',
      // The pseudo-DDA input names no instrument: no call.
      'pxd006096-pseudo.mzML': ['genus', 'match', 'match', 'match', 'no_call', 'match'],
      // Too few tagged spectra: protease and label no call, species a run-level no call.
      'pxd010783.mzML': ['no_call', 'no_call', 'no_call', 'match', 'match', 'mismatch'],
      'pxd014764.mzML': ['mismatch', 'match', 'match', 'match', 'match', 'match'],
      // 916 tagged spectra: the label-free call is held back (too little evidence).
      'pxd040407-chymo.mzML': ['no_call', 'no_call', 'no_call', 'mismatch', 'mismatch', 'match']
    })
  })

  it('a verdict per job: the fields that differ, else consistent, else nothing checked', () => {
    expect(Object.fromEntries(c.jobs.map((j) => [j.file, j.verdict.text]))).toEqual({
      'pxd003531.mzML': '✓ consistent',
      'pxd003531-mzpeak.mzML': '✓ consistent',
      'pxd004541-tmt.mzML': '✗ fragment tolerance',
      'pxd006096-dia.mzML': 'not compared: the job failed',
      'pxd006096-pseudo.mzML': '✓ consistent',
      'pxd010783.mzML': '✗ fragment tolerance',
      'pxd014764.mzML': '✗ organism',
      'pxd040407-chymo.mzML': '✗ modifications, instrument'
    })
  })

  it('genus "Homo" against SDRF "Homo sapiens" is consistent at genus, by taxid', () => {
    const o = c.jobs[0].fields!.organism
    expect(o.state).toBe('genus')
    expect(o.sdrf).toBe('Homo sapiens')
    expect(o.fastag).toBe('Homo (taxid 9605)')
    expect(o.note).toMatch(/Homo sapiens \(taxid 9606\) lies in the called genus Homo \(taxid 9605\)/)
    // SDRF "Mus musculus" against the same call: a mismatch.
    const m = c.jobs[6].fields!.organism
    expect(m.state).toBe('mismatch')
    expect(m.note).toMatch(/Mus musculus \(taxid 10090, genus Mus \(taxid 10088\)\)/)
  })

  it('evidence names the CLI report and row each value came from', () => {
    const f = c.jobs[2].fields!
    expect(f.organism.evidence).toBe('pxd004541-tmt.tags.species.tsv: genus Homo (taxid 9605) present')
    expect(f.cleavage.evidence).toBe('pxd004541-tmt.digest.tsv: call model Trypsin')
    expect(f.label.evidence).toBe('pxd004541-tmt.label.tsv: label_call label TMT')
    expect(f.modifications.evidence).toBe('log: Modifications: Carbamidomethyl (C, fixed)')
    expect(f.instrument.evidence).toBe('pxd004541-tmt.digest.tsv: meta instrument Q Exactive HF')
    expect(f.tolerance.evidence).toBe('pxd004541-tmt.digest.tsv: run fragment_tolerance 20 ppm')
  })

  it('without the taxonomy the organism is not checkable, the other fields still compared', () => {
    const n = compareSdrf(SDRF, JOBS, null)
    expect(n.jobs[6].fields!.organism.state).toBe('not_checkable')
    expect(n.jobs[6].fields!.organism.note).toMatch(/taxonomy/)
    expect(n.jobs[2].fields!.tolerance.state).toBe('mismatch')
  })

  it('a job with no SDRF row, and an SDRF without a data file column', () => {
    const other: SdrfJob = { input: '/data/other.mzML', status: 'done', data: { ...dataOf(BATCH_CASES.pxd003531), reports: [] } }
    const x = compareSdrf(SDRF, [other], tx)
    expect(x.jobs[0].verdict).toMatchObject({ state: 'no_sdrf', text: 'not in the SDRF' })
    const noCol = compareSdrf(parseSdrf('source name\tcharacteristics[organism]\ns1\tHomo sapiens\n'), JOBS, tx)
    expect(noCol.dataFileColumn).toBe(false)
    expect(noCol.jobs.every((j) => j.verdict.state === 'no_sdrf')).toBe(true)
  })

  it('a field whose SDRF column is absent or "not available" is not in the SDRF', () => {
    const t = parseSdrf(
      'source name\tcharacteristics[organism]\tcomment[label]\tcomment[data file]\n' + 's1\tnot available\tlabel free sample\t20130611_QE3_UPLC10_CFR_SA_OC_T_NO_03_01_01.raw\n'
    )
    const j = compareSdrf(t, [JOBS[0]], tx).jobs[0]
    const st = (f: FieldId) => j.fields![f].state
    expect([st('organism'), st('cleavage'), st('label'), st('modifications'), st('instrument'), st('tolerance')]).toEqual([
      'no_sdrf',
      'no_sdrf',
      'match',
      'no_sdrf',
      'no_sdrf',
      'no_sdrf'
    ])
    expect(j.verdict.text).toBe('✓ consistent')
  })

  it('does not depend on the queue order', () => {
    const r = compareSdrf(SDRF, [...JOBS].reverse(), tx)
    expect(r.jobs.map((j) => j.file)).toEqual([...JOBS].reverse().map((j) => j.input.slice(6)))
    for (const j of r.jobs) expect(j).toEqual(c.jobs.find((x) => x.input === j.input))
  })
})

describe('data file matching', () => {
  it('a stem drops the path and the spectra and archive extensions, case aside', () => {
    expect(fileStem('C:\\runs\\Run01.RAW')).toBe('run01')
    expect(fileStem('/d/run01.mzML.gz')).toBe('run01')
    expect(fileStem('run01.point.mzpeak')).toBe('run01')
    expect(fileStem('x_DIA1_new.pseudo.mzML')).toBe('x_dia1_new')
    expect(fileStem('run.d')).toBe('run')
    // A dot that is not an extension FASTag or a vendor uses stays.
    expect(fileStem('sample.v2.raw')).toBe('sample.v2')
  })
})

describe('cleavage agent', () => {
  it('names and PSI-MS accessions to FASTag models; Trypsin/P is trypsin', () => {
    expect(compareCleavage(['NT=Trypsin;AC=MS:1001251'], 'Trypsin').state).toBe('match')
    expect(compareCleavage(['NT=Trypsin/P;AC=MS:1001313'], 'Trypsin').state).toBe('match')
    expect(compareCleavage(['AC=MS:1001309'], 'Lys-C').state).toBe('match')
    expect(compareCleavage(['NT=Lys-C'], 'Trypsin').state).toBe('mismatch')
    expect(compareCleavage(['NT=AspN'], 'Asp-N').state).toBe('match')
  })

  it('several agents: the call is one of them', () => {
    expect(compareCleavage(['NT=Lys-C;AC=MS:1001309', 'NT=Trypsin;AC=MS:1001251'], 'Trypsin').state).toBe('match')
  })

  it('an agent FASTag has no model for is not checkable; no call is no call', () => {
    expect(compareCleavage(['NT=Pepsin A'], 'Trypsin').state).toBe('not_checkable')
    expect(compareCleavage(['NT=Trypsin'], null).state).toBe('no_call')
    expect(compareCleavage(['not available'], 'Trypsin').state).toBe('no_sdrf')
  })
})

describe('label', () => {
  it('label-free, TMT channels, SILAC channels', () => {
    expect(compareLabel(['NT=label free sample;AC=MS:1002038'], [], 'label-free').state).toBe('match')
    expect(compareLabel(['TMT126', 'TMT127N', 'TMT131C'], [], 'TMT').state).toBe('match')
    expect(compareLabel(['SILAC light', 'SILAC heavy'], [], 'SILAC').state).toBe('match')
    expect(compareLabel(['NT=label free sample'], [], 'TMT').state).toBe('mismatch')
    expect(compareLabel(['TMT126'], [], 'label-free').state).toBe('mismatch')
  })

  it('TMT against TMTpro: told apart by the SDRF modifications when they name it', () => {
    expect(compareLabel(['TMT126'], ['NT=TMTpro;AC=UNIMOD:2016;TA=K;MT=Fixed'], 'TMT').state).toBe('mismatch')
    expect(compareLabel(['TMT126'], ['NT=TMTpro;AC=UNIMOD:2016;TA=K;MT=Fixed'], 'TMTpro').state).toBe('match')
    expect(compareLabel(['TMT126'], ['NT=TMT6plex;AC=UNIMOD:737;TA=K;MT=Fixed'], 'TMT').state).toBe('match')
    expect(compareLabel(['TMTpro126'], [], 'TMT').state).toBe('mismatch')
  })

  it('a label this app does not know is not checkable; no call is no call', () => {
    expect(compareLabel(['18O'], [], 'label-free').state).toBe('not_checkable')
    expect(compareLabel(['TMT126'], [], null).state).toBe('no_call')
  })
})

describe('modification parameters', () => {
  const LOG = ['Modifications: Carbamidomethyl (C, fixed)', '2738 MS2 spectra, 128821 tags']
  it('the SDRF fixed residue modifications against the run fixed ones (its log)', () => {
    expect(compareModifications(['NT=Carbamidomethyl;AC=UNIMOD:4;TA=C;MT=Fixed'], LOG).state).toBe('match')
    // By accession when NT is missing.
    expect(compareModifications(['AC=UNIMOD:4;TA=C;MT=fixed'], LOG).state).toBe('match')
    const r = compareModifications(['NT=Oxidation;AC=UNIMOD:35;TA=M;MT=Variable'], LOG)
    expect(r.state).toBe('mismatch')
    expect(r.note).toMatch(/Carbamidomethyl \(C\)/)
    expect(compareModifications(['NT=Carbamidomethyl;TA=C;MT=Fixed', 'NT=Propionamide;TA=C;MT=Fixed'], LOG).state).toBe('mismatch')
  })

  it('label, terminal and variable modifications are not compared', () => {
    expect(
      compareModifications(
        [
          'NT=Carbamidomethyl;AC=UNIMOD:4;TA=C;MT=Fixed',
          'NT=TMT6plex;AC=UNIMOD:737;TA=K;MT=Fixed',
          'NT=TMT6plex;AC=UNIMOD:737;PP=Any N-term;MT=Fixed',
          'NT=Label:13C(6)15N(2);AC=UNIMOD:259;TA=K;MT=Fixed',
          'NT=Acetyl;AC=UNIMOD:1;PP=Protein N-term;MT=Variable',
          'NT=Oxidation;TA=M;MT=Variable'
        ],
        LOG
      ).state
    ).toBe('match')
  })

  it('a run without a Modifications line used none; an unread log is no call', () => {
    expect(compareModifications(['NT=Carbamidomethyl;TA=C;MT=Fixed'], ['139 MS2 spectra, 2028 tags']).state).toBe('mismatch')
    expect(compareModifications(['NT=Oxidation;TA=M;MT=Variable'], ['139 MS2 spectra, 2028 tags']).state).toBe('match')
    expect(compareModifications(['NT=Carbamidomethyl;TA=C;MT=Fixed'], []).state).toBe('no_call')
    expect(compareModifications([], LOG).state).toBe('no_sdrf')
  })
})

describe('instrument and fragment tolerance', () => {
  it('instrument names compared as words, vendor names aside; Q Exactive is not Q Exactive HF', () => {
    expect(compareInstrument(['NT=Q Exactive;AC=MS:1001911'], 'Q Exactive').state).toBe('match')
    expect(compareInstrument(['NT=Thermo Scientific Q Exactive HF'], 'Q Exactive HF').state).toBe('match')
    expect(compareInstrument(['NT=q exactive hf'], 'Q Exactive HF').state).toBe('match')
    expect(compareInstrument(['NT=Q Exactive'], 'Q Exactive HF').state).toBe('mismatch')
    expect(compareInstrument(['NT=Q Exactive'], null).state).toBe('no_call')
  })

  it('tolerances in the same unit compare by value; Da against ppm differs', () => {
    expect(compareTolerance(['20 ppm'], { value: 20, unit: 'ppm' }).state).toBe('match')
    expect(compareTolerance(['20ppm'], { value: 20, unit: 'ppm' }).state).toBe('match')
    expect(compareTolerance(['0.5 Da'], { value: 0.5, unit: 'Da' }).state).toBe('match')
    expect(compareTolerance(['500 mmu'], { value: 0.5, unit: 'Da' }).state).toBe('match')
    expect(compareTolerance(['0.02 Da'], { value: 20, unit: 'ppm' }).state).toBe('mismatch')
    expect(compareTolerance(['10 ppm'], { value: 20, unit: 'ppm' }).state).toBe('mismatch')
    expect(compareTolerance(['about 20'], { value: 20, unit: 'ppm' }).state).toBe('not_checkable')
    expect(compareTolerance(['20 ppm'], null).state).toBe('no_call')
  })
})
