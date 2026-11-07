// The batch summary (GUI-DESIGN 3 S6, 10 P2b): the majority rule and the
// rows of a real batch (src/fixtures/cli/batch, one FASTag integration/1.12
// command over the public gate inputs), read through calls.ts and the
// Overview's tiles; the TSV export equals the rows.

import { describe, expect, it } from 'vitest'
import { parseReport } from '../digestReport'
import type { BatchJob } from './batch'
import { buildSummary, jobCells, majority, MIN_CALLS, NOT_READ, summaryTsv, SUMMARY_COLUMNS, type JobData } from './batchSummary'
import { BATCH_CASES, type BatchCase } from '../testing/batchFixtures'
import { speciesFromTsv } from '../testing/speciesTsv'
import { CLI_CASES, logLines } from '../testing/cliFixtures'

describe('majority (the n >= 3 rule)', () => {
  it('needs at least 3 runs with a call', () => {
    expect(MIN_CALLS).toBe(3)
    expect(majority([])).toEqual({ value: null, calls: 0, count: 0, why: 'few' })
    expect(majority(['Trypsin'])).toMatchObject({ value: null, calls: 1, why: 'few' })
    expect(majority(['Trypsin', 'Trypsin'])).toMatchObject({ value: null, calls: 2, why: 'few' })
    expect(majority(['Trypsin', 'Trypsin', 'Trypsin'])).toEqual({ value: 'Trypsin', calls: 3, count: 3, why: 'majority' })
  })

  it('counts no-calls as nothing: they neither make nor break a majority', () => {
    // No calls at all: no majority, whatever the number of runs.
    expect(majority([null, null, null, null])).toEqual({ value: null, calls: 0, count: 0, why: 'few' })
    // Five runs, two calls: still fewer than 3.
    expect(majority(['Homo', null, 'Homo', null, null])).toMatchObject({ value: null, calls: 2, why: 'few' })
    // Three calls among five runs.
    expect(majority(['Homo', null, 'Homo', null, 'Mus'])).toEqual({ value: 'Homo', calls: 3, count: 2, why: 'majority' })
  })

  it('is more than half of the calls: a tie or a plurality is no majority', () => {
    expect(majority(['TMT', 'label-free', 'TMT', 'label-free'])).toMatchObject({ value: null, calls: 4, why: 'split' })
    expect(majority(['a', 'b', 'c'])).toMatchObject({ value: null, calls: 3, why: 'split' })
    expect(majority(['a', 'a', 'b', 'c', 'd'])).toMatchObject({ value: null, calls: 5, count: 2, why: 'split' })
    expect(majority(['a', 'a', 'b'])).toEqual({ value: 'a', calls: 3, count: 2, why: 'majority' })
    expect(majority(['a', 'a', 'a', 'b', 'c'])).toEqual({ value: 'a', calls: 5, count: 3, why: 'majority' })
  })
})

const job = (input: string, status: BatchJob['status'], extra: Partial<BatchJob> = {}): BatchJob => ({
  input,
  out: input.replace(/\.[^.]+$/, '.tags.tsv'),
  status,
  ...extra
})

function dataOf(c: BatchCase): JobData {
  return {
    log: c.log.split(/\r?\n/).filter((l) => l !== ''),
    reports: [parseReport(c.digest, `/b/${c.name}.digest.tsv`), parseReport(c.label, `/b/${c.name}.label.tsv`)],
    species: speciesFromTsv(c.species, `/b/${c.name}.tags.species.tsv`),
    census: c.census,
    params: c.params
  }
}

// The rows of a long-form report: section, key, value.
const cell = (text: string, sec: string, key: string): string | undefined =>
  text
    .trim()
    .split('\n')
    .map((l) => l.split('\t'))
    .find((r) => r[0] === sec && r[1] === key)?.[2]

describe('a job row, from the reports the CLI wrote', () => {
  it('states the CLI calls and counts only them', () => {
    const c = jobCells(dataOf(BATCH_CASES.pxd004541))
    expect(c.tags).toBe(172237)
    expect(c.cells.protease).toMatchObject({ text: 'Trypsin', call: 'Trypsin' })
    expect(c.cells.label).toMatchObject({ text: 'TMT', call: 'TMT' })
    // -species_call decoy: the first present genus.
    expect(c.cells.genus).toMatchObject({ text: 'Homo', call: 'Homo' })
    // 1.12 writes no alkylation call; without a FASTA it is not assessed.
    expect(c.cells.alkylation).toMatchObject({ text: 'not assessed (needs a FASTA)', call: null })
    for (const k of SUMMARY_COLUMNS) expect(c.cells[k].note.trim()).not.toBe('')
  })

  it('a CLI no call is "no call", never a value', () => {
    const c = jobCells(dataOf(BATCH_CASES.pxd010783))
    expect(cell(BATCH_CASES.pxd010783.digest, 'call', 'status')).toBe('no_call')
    expect(c.cells.protease).toMatchObject({ text: 'no call', call: null })
    expect(c.cells.label).toMatchObject({ text: 'no call', call: null })
    // A run-level species no call (few_spectra): the report lists no genus.
    expect(c.cells.genus).toMatchObject({ text: 'no genus', call: null })
  })

  it('a call over fewer than 1,000 tagged spectra is "too little evidence" and not counted', () => {
    // PXD040407 (chymotrypsin, a tenth of the spectra): the CLI calls the
    // label, but the census counts 916 tagged spectra.
    expect(cell(BATCH_CASES.pxd040407.label, 'label_call', 'status')).toBe('call')
    const c = jobCells(dataOf(BATCH_CASES.pxd040407))
    expect(c.cells.label).toMatchObject({ text: 'too little evidence', call: null })
    expect(c.cells.label.note).toContain('916 tagged spectra')
    expect(c.cells.protease).toMatchObject({ text: 'no call', call: null })
  })

  it('a ranking without call columns is shown, not counted (FASTag 1.11, or 1.12 without -species_call)', () => {
    const v = CLI_CASES.v111
    const c = jobCells({
      log: logLines(v),
      reports: [parseReport(v.digest, '/b/a.digest.tsv'), parseReport(v.label, '/b/a.label.tsv')],
      species: speciesFromTsv(v.species, '/b/a.tags.species.tsv'),
      census: null,
      params: v.params
    })
    expect(c.cells.genus.text).toMatch(/ \(ranking\)$/)
    expect(c.cells.genus.call).toBeNull()
    // 1.11 writes no label_call rows.
    expect(c.cells.label).toMatchObject({ text: 'not called', call: null })
    expect(c.cells.protease.call).toBe('Trypsin')
  })
})

describe('the summary of a batch', () => {
  const order = ['pxd003531', 'pxd004541', 'pxd014764', 'pxd010783', 'pxd040407', 'pxd003531mzpeak', 'pxd006096pseudo'] as const
  const jobs = [
    ...order.map((k, i) => job(`/b/run0${i + 1}.mzML`, 'done', { ms: 1000 * (i + 2), outputs: { out: `/b/run0${i + 1}.tags.tsv` } })),
    job('/b/run08.mzML', 'failed', { reason: 'exit 11: raw DIA', ms: 900 }),
    job('/b/run09.mzML', 'queued')
  ]
  const data = new Map(order.map((k, i) => [`/b/run0${i + 1}.mzML`, dataOf(BATCH_CASES[k])]))
  const s = buildSummary(jobs, data)

  it('has one row per job, in queue order', () => {
    expect(s.rows.map((r) => r.file)).toEqual(jobs.map((j) => j.input.slice(3)))
    expect(s.rows[7]).toMatchObject({ status: 'failed', tags: null })
    expect(s.rows[7].cells.protease.text).toBe('—')
    expect(s.rows[8]).toMatchObject({ status: 'queued', statusText: 'Not run' })
  })

  it('flags a call that differs from the majority, and never a no call', () => {
    // Labels called: label-free (PXD003531, its mzPeak copy, PXD006096
    // pseudo-DDA), TMT (PXD004541), SILAC (PXD014764): label-free is 3 of 5.
    expect(s.majority.label).toMatchObject({ value: 'label-free', calls: 5, count: 3, why: 'majority' })
    const differs = s.rows.filter((r) => r.differs.label).map((r) => r.file)
    expect(differs).toEqual(['run02.mzML', 'run03.mzML'])
    // The protease: Trypsin wherever the CLI made a call.
    expect(s.majority.protease.value).toBe('Trypsin')
    expect(s.rows.some((r) => r.differs.protease)).toBe(false)
    // No calls, low evidence, a failed and a queued job: never "differs".
    for (const i of [3, 4, 7, 8]) expect(Object.values(s.rows[i].differs).some(Boolean)).toBe(false)
    // Alkylation: no call anywhere.
    expect(s.majority.alkylation).toMatchObject({ value: null, calls: 0, why: 'few' })
  })

  it('shows no majority for fewer than 3 jobs', () => {
    const two = buildSummary(jobs.slice(0, 2), data)
    for (const k of SUMMARY_COLUMNS) expect(two.majority[k].value).toBeNull()
    expect(two.rows.some((r) => Object.values(r.differs).some(Boolean))).toBe(false)
    // TMT and label-free, two calls: no flag although they differ.
    expect(two.rows.map((r) => r.cells.label.call)).toEqual(['label-free', 'TMT'])
  })

  it('a done job whose reports are still being read says so, and counts nothing', () => {
    const partial = buildSummary(jobs.slice(0, 3), new Map([...data].slice(0, 2)))
    expect(partial.rows[2].cells.label).toMatchObject({ text: 'reading…', call: null })
    expect(partial.majority.label.calls).toBe(2)
  })

  it('a done job without outputs (the reply never came) is not "reading…" and cannot be opened', () => {
    const lost = buildSummary([job('/b/lost.mzML', 'done', { ms: 1000 })], new Map())
    for (const k of SUMMARY_COLUMNS) {
      expect(lost.rows[0].cells[k]).toEqual({ text: '—', call: null, note: expect.stringContaining('did not learn where this run wrote its outputs') })
    }
    expect(lost.rows[0].canOpen).toBe(false)
    expect(s.rows[0].canOpen).toBe(true)
    expect(s.rows[7].canOpen).toBe(false)
  })

  it('a job whose reports could not be read at all says so, with why, and counts nothing', () => {
    const d: JobData = { log: [], reports: [], species: null, census: null, params: {}, failed: 'invoke failed' }
    const r = buildSummary([jobs[0]], new Map([[jobs[0].input, d]])).rows[0]
    for (const k of SUMMARY_COLUMNS) expect(r.cells[k]).toEqual({ text: 'unreadable', call: null, note: 'its reports could not be read: invoke failed' })
  })

  it('the TSV has the table: a header and one line per row, the same text', () => {
    const tsv = summaryTsv(s)
    const lines = tsv.split('\n')
    expect(lines[lines.length - 1]).toBe('')
    const [head, ...body] = lines.slice(0, -1).map((l) => l.split('\t'))
    expect(head).toEqual([
      'file',
      'input',
      'status',
      'duration_s',
      'tags',
      'top_genus',
      'top_genus_differs',
      'protease',
      'protease_differs',
      'label',
      'label_differs',
      'alkylation',
      'alkylation_differs',
      'tags_tsv'
    ])
    expect(body).toHaveLength(s.rows.length)
    body.forEach((b, i) => {
      const r = s.rows[i]
      expect(b[0]).toBe(r.file)
      expect(b[1]).toBe(r.input)
      expect(b[2]).toBe(r.statusText)
      expect(b[4]).toBe(r.tags == null ? '' : String(r.tags))
      expect([b[5], b[7], b[9], b[11]]).toEqual([r.cells.genus.text, r.cells.protease.text, r.cells.label.text, r.cells.alkylation.text])
      expect([b[6], b[8], b[10], b[12]]).toEqual(
        [r.differs.genus, r.differs.protease, r.differs.label, r.differs.alkylation].map((d) => (d ? 'yes' : ''))
      )
    })
    expect(body[0][3]).toBe('2')
    expect(body[0][13]).toBe('/b/run01.tags.tsv')
    expect(body[1][10]).toBe('yes')
  })

  it('a tab or line break inside a value cannot break the TSV', () => {
    const odd = buildSummary([job('/b/a\tb\nc.mzML', 'failed', { reason: 'x' })], new Map())
    const lines = summaryTsv(odd).split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[1].split('\t')).toHaveLength(14)
  })
})

describe('a report the job was sent but could not read', () => {
  it('says "unreadable" with the read or parse error, not "not written" or "detection was off"', () => {
    const c = BATCH_CASES.pxd003531
    const d: JobData = {
      ...dataOf(c),
      // The digest report parsed as empty, the species read rejected.
      reports: [parseReport(c.label, `/b/x.label.tsv`)],
      species: null,
      unread: {
        digest_out: 'Cannot read /b/x.digest.tsv: the file is empty',
        species_out: 'Cannot read /b/x.tags.species.tsv: permission denied'
      }
    }
    const { cells } = jobCells(d)
    expect(cells.protease).toEqual({ text: 'unreadable', call: null, note: 'Cannot read /b/x.digest.tsv: the file is empty' })
    expect(cells.genus).toEqual({ text: 'unreadable', call: null, note: 'Cannot read /b/x.tags.species.tsv: permission denied' })
    // The label report was read: its call stands.
    expect(cells.label.call).toBe('label-free')
  })

  it('a species report the backend gave nothing for is "not read", with the path', () => {
    const d: JobData = { ...dataOf(BATCH_CASES.pxd003531), species: null, unread: { species_out: `${NOT_READ}the species report /b/x.tags.species.tsv was not found or could not be parsed` } }
    expect(jobCells(d).cells.genus).toEqual({ text: 'not read', call: null, note: 'the species report /b/x.tags.species.tsv was not found or could not be parsed' })
  })
})
