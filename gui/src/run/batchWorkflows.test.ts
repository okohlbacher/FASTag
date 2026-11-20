// Review round 3: each workflow's batch gets its own key columns, read from
// its own reports (not Characterize's calls, mostly "not assessed"), and the
// alkylation cell holds the alkylation report's call, which the majority
// counts.
import { describe, expect, it } from 'vitest'
import { parseReport } from '../digestReport'
import type { BatchJob } from './batch'
import { buildSummary, columnLabel, columnsFor, columnsOfRuns, jobCells, summaryTsv, workflowCells, type JobData } from './batchSummary'
import shortlistTsv from '../fixtures/cli-1.15/ecoli_ms2_small_0.3da.shortlist.tsv?raw'
import censusSummary from '../fixtures/cli/batch/pxd003531/run.tags.census_summary.tsv?raw'
import alkylationTsv from '../fixtures/alkylation.tsv?raw'

const DELTA = ['delta\tspectra\ttop_interps', '0.00\t500\t-', '15.99\t42\tOxidation:12'].join('\n')
const COUNTS = 'key\tvalue\nms2_read\t139\nms2_tagged\t100\nms2_placed\t61\ncheck_tagged_le_ms2\tok\n'
const data = (over: Partial<JobData> = {}): JobData => ({ log: ['2000 MS2 spectra, 5000 tags'], reports: [], species: null, census: null, params: {}, ...over })

describe('the key columns of each workflow', () => {
  it('none of them falls back to the Characterize calls', () => {
    expect(columnsFor('export-tags')).toEqual(['spectra', 'tagRate'])
    expect(columnsFor('mass-shift')).toEqual(['spectra', 'placed', 'topShift'])
    expect(columnsFor('db-reduction')).toEqual(['kept', 'config'])
    expect(columnsFor('triage')).toEqual(['spectra', 'censusTagged'])
    expect(columnsFor('characterize')).toEqual(['genus', 'protease', 'label', 'alkylation'])
  })

  it('reads each from its own report', () => {
    const w = workflowCells(
      data({ deltaCounts: COUNTS, delta: DELTA, shortlist: shortlistTsv, config: true, census: censusSummary })
    )
    expect(w.spectra.text).toBe('2,000')
    expect(w.tagRate.text).toBe('2.5')
    expect(w.placed.text).toBe('61 of 100')
    expect(w.topShift).toMatchObject({ text: '+15.99 Da (Oxidation)', call: 'Oxidation' })
    expect(w.kept.text).toBe('1 of 3')
    expect(w.config.text).toBe('written')
    expect(w.censusTagged.text).toMatch(/ of 2,738 \(/)
  })

  it('says which report a job did not write', () => {
    const w = workflowCells(data({ config: false }))
    expect(w.placed.text).toBe('not written')
    expect(w.kept.text).toBe('not written')
    expect(w.config.text).toBe('not written')
    expect(workflowCells(data()).config.text).toBe('not asked for')
  })

  it('a Mass-shift batch flags a job whose top shift differs from the majority', () => {
    const jobs = ['a', 'b', 'c', 'd'].map((n) => ({ input: `/d/${n}.mzML`, out: `/d/${n}.tags.tsv`, status: 'done', outputs: { out: `/d/${n}.tags.tsv` } }) as unknown as BatchJob)
    const odd = DELTA.replace('Oxidation:12', 'Deamidated:12')
    const m = new Map(jobs.map((j, i) => [j.input, data({ delta: i === 3 ? odd : DELTA, deltaCounts: COUNTS })]))
    const s = buildSummary(jobs, m, 'mass-shift')
    expect(s.columns).toEqual(['spectra', 'placed', 'topShift'])
    expect(s.majority.topShift.value).toBe('Oxidation')
    expect(s.rows.map((r) => r.differs.topShift)).toEqual([false, false, false, true])
    expect(summaryTsv(s).split('\n')[0]).toContain('top_mass_shift')
  })
})

// Round 4, 11: the columns are those of the workflow the jobs ran with.
describe('the columns of a batch that ran', () => {
  it('keeps the recorded workflow\'s columns, and shows each workflow\'s for a mixed batch', () => {
    expect(columnsOfRuns(['run-qc', 'run-qc'])).toEqual(columnsFor('run-qc'))
    expect(columnsOfRuns([])).toEqual(columnsFor(null))
    expect(columnsOfRuns(['export-tags', 'db-reduction'])).toEqual(['spectra', 'tagRate', 'kept', 'config'])
    const jobs = [{ input: '/d/a.mzML', out: '/d/a.tags.tsv', status: 'done' } as unknown as BatchJob]
    expect(buildSummary(jobs, new Map(), ['run-qc']).columns).toEqual(columnsFor('run-qc'))
  })
})

describe('the alkylation cell', () => {
  const called = alkylationTsv
    .replace('alkylation_call\tstatus\tno_call\t0', 'alkylation_call\tstatus\tcall\t120')
    .replace('alkylation_call\treagent\t-', 'alkylation_call\treagent\tiodoacetamide')
    .replace('alkylation_call\tshare\t-\t0', 'alkylation_call\tshare\t0.95\t120')
    .replace('alkylation_call\treason\tfew_cys_spectra', 'alkylation_call\treason\t-')

  it('holds the alkylation report\'s call, which the majority counts', () => {
    const c = jobCells(data({ reports: [parseReport(called, '/d/a.alkylation.tsv')], params: { alkylation_out: '/d/a.alkylation.tsv' } }))
    expect(c.cells.alkylation.call).toBe('iodoacetamide')
    expect(c.cells.alkylation.text).toBe('iodoacetamide')
  })

  it('names the alkylation report when it could not be read, not the mass-gap report', () => {
    const c = jobCells(data({ params: { alkylation_out: '/d/a.alkylation.tsv' }, unread: { alkylation_out: 'Cannot read /d/a.alkylation.tsv: denied' } }))
    expect(c.cells.alkylation).toMatchObject({ text: 'unreadable', call: null })
    expect(c.cells.alkylation.note).toContain('a.alkylation.tsv')
  })

  it('falls back to the mass-gap counts, never a call, without an alkylation report', () => {
    const c = jobCells(data({ params: {} }))
    expect(c.cells.alkylation.call).toBeNull()
  })
})

describe('the species column at the report\'s rank', () => {
  it('is headed Top family for a family-rank batch', () => {
    expect(columnLabel('genus', 'family')).toBe('Top family')
    expect(columnLabel('genus')).toBe('Top genus')
  })
})
