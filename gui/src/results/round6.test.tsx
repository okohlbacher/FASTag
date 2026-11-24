// Review round 6 (doc/GUI-WORKFLOWS.md): the c/z ladder, case-insensitive
// batch outputs, the isobaric kit that could not be assessed, the tie at
// the top of the species calls, the Database column of a run without a
// filter, the alkylation extension, the SDRF verdict's qualifier, the
// shortlist's yes/no, the QC strip, MS2 wording, the triage filters, the
// workflow tabs and the digest sentences.

import { render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { C_OFFSET, PROTON, Z_DOT_OFFSET, ladderFor, residueMasses, tagRowFrom } from '../spectrum/ladder'
import type { SpectrumPeaks } from '../spectrum/dump'
import { addJobs, sharedOutputs } from '../run/batch'
import { COLUMN_LABEL, qcCells } from '../run/batchSummary'
import { buildOverview } from './overview'
import type { SpeciesReport, Taxon } from '../types'
import { alkylationExtension, PRODUCT_OF, toggleProduct } from '../setup/products'
import { FIELDS, verdict, type FieldId, type FieldResult } from '../sdrf/compare'
import ReportTable, { qcSummary, settingValue, summaryKeys } from './ReportTable'
import { tabsOf, WORKFLOW_TABS } from './ResultTabs'
import { TASKS } from '../setup/tasks'
import DigestPanel from '../DigestPanel'
import { parseReport } from '../digestReport'
import { installMockBridge } from '../testing/mockBridge'
import { BRIEF_HINT, briefHint, PARAM_BY_NAME } from '../paramLayout'
import qcTsv from '../fixtures/cli-1.15/ecoli_ms2_small_0.3da.qc.tsv?raw'
import triageTsv from '../fixtures/cli-1.15/workflows/triage/run01.census_sorted.tsv?raw'
import charDigest from '../fixtures/cli-1.15/workflows/characterize/run01.digest.tsv?raw'

// ---- 4: the c/z-dot ladder ---------------------------------------------------

const RES = residueMasses([])
const peaks = (mz: number[]): SpectrumPeaks => ({
  nativeId: 'scan=1',
  index: 0,
  msLevel: 2,
  rt: null,
  precursor: 800,
  charge: 2,
  chargeGiven: 2,
  tolerance: 10,
  toleranceUnit: 'ppm',
  picked: false,
  deisotoped: true,
  tagged: true,
  nRead: mz.length,
  mz: [...mz].sort((a, b) => a - b),
  int: mz.map(() => 100)
})

describe('round 6, 4: a c/z tag is drawn on c/z-dot ions', () => {
  // PEPT after an N-terminal residue sum of 200: c ions at sum + NH3 + H+.
  const nterm = 200
  const steps = ['P', 'E', 'P', 'T'].map((r) => RES.masses[r])
  const cIons = steps.reduce<number[]>((acc, m) => [...acc, acc[acc.length - 1] + m], [nterm + C_OFFSET + PROTON])
  const columns = ['spectrum', 'tag', 'length', 'charge', 'nterm_mass', 'cterm_mass', 'extended', 'gapped', 'evalue', 'ion_series']
  const cells = (series: string): string[] => ['scan=1', 'PEPT', '4', '1', String(nterm), '300', '0', '0', '0.01', series]

  it('keeps the row ion_series and finds the c ladder on the peaks', () => {
    const row = tagRowFrom(columns, cells('cz'))!
    expect(row.ionSeries).toBe('cz')
    const lad = ladderFor(row, peaks(cIons), RES)
    expect(lad.series).toBe('c')
    expect(lad.complete).toBe(true)
    expect(lad.matched).toBe(5)
  })

  it('the same peaks drawn as b/y (the row read as by) are not a ladder', () => {
    const row = tagRowFrom(columns, cells('by'))!
    expect(row.ionSeries).toBe('by')
    const lad = ladderFor(row, peaks(cIons), RES)
    expect(lad.complete).toBe(false)
    expect(['b', 'y']).toContain(lad.series)
  })

  it('a z-dot ladder from cterm_mass, and a row without the column reads as b/y', () => {
    const cterm = 300
    const z = [...steps].reverse().reduce<number[]>((acc, m) => [...acc, acc[acc.length - 1] + m], [cterm + Z_DOT_OFFSET + PROTON])
    const row = tagRowFrom(columns, ['scan=1', 'PEPT', '4', '1', '999', String(cterm), '0', '0', '0.01', 'cz'])!
    const lad = ladderFor(row, peaks(z), RES)
    expect(lad).toMatchObject({ series: 'z', complete: true })
    expect(tagRowFrom(columns.slice(0, -1), cells('cz').slice(0, -1))!.ionSeries).toBe('by')
  })
})

// ---- 6: case-insensitive batch outputs -------------------------------------

describe('round 6, 6: outputs that differ only in case are one file', () => {
  it('names sample.mzML and SAMPLE.mzML apart', () => {
    const js = addJobs([], ['/d/sample.mzML', '/d/SAMPLE.mzML'])
    expect(js[0].out.toLowerCase()).not.toBe(js[1].out.toLowerCase())
    const more = addJobs(js, ['/d/Sample.mzML'])
    expect(new Set(more.map((j) => j.out.toLowerCase())).size).toBe(3)
  })

  it('finds outputs two jobs would both write, reports included', () => {
    expect(sharedOutputs([['/d/a.tags.tsv', '/d/a.qc.tsv'], ['/d/b.tags.tsv', '/d/A.QC.tsv']])).toEqual(['/d/a.qc.tsv'])
    expect(sharedOutputs([['/d/a.tags.tsv', '/d/a.tags.tsv'], ['/d/b.tags.tsv']])).toEqual([])
  })
})

// ---- 7: an isobaric kit that could not be assessed --------------------------

describe('round 6, 7: Not assessable is no call', () => {
  const unassessable = qcTsv
    .split('\n')
    .map((l) => l.replace(/^(qc\treporter_(?:tmt|itraq)\w+)\tabsent\t(\d+)\tAbsent\.$/, '$1\tnot_assessable\t$2\tNot assessable: too few assessable MS2.'))
    .join('\n')

  it('a definite none stays a call', () => {
    expect(qcCells(qcTsv).kit).toMatchObject({ text: 'none', call: 'none' })
  })

  it('all kits not assessable: no call, with the reason', () => {
    const k = qcCells(unassessable).kit
    expect(k.text).toBe('Not assessable')
    expect(k.call).toBeNull()
    expect(k.note).toMatch(/too few assessable MS2/)
  })

  it('MS2 wording in the batch columns (21)', () => {
    expect(COLUMN_LABEL.ms2).toBe('MS2 spectra')
    expect(qcCells(qcTsv).ms2.note).toBe('MS2 spectra read')
  })
})

// ---- 8: a tie among the called taxa -----------------------------------------

const taxon = (name: string, taxid: number, n: number, call = 'present'): Taxon => ({ rank: 'genus', taxid, name, observed: n, adjusted: n, q: 0.001, call })

describe('round 6, 8: a tie at the top of the species call names no proteome', () => {
  const sp = (taxa: Taxon[]): SpeciesReport => ({ path: '/d/a.species.tsv', taxa })
  const o = (taxa: Taxon[]) => buildOverview({ log: [], reports: [], species: sp(taxa), census: null, params: { species: true }, instrument: null })

  it('two present taxa level at the top: calls kept, no database suggested', () => {
    const tied = o([taxon('Homo', 9605, 40), taxon('Mus', 10088, 40), taxon('Bos', 9903, 5)])
    const t = tied.calls.find((c) => c.id === 'genus')!
    expect(t.value).toBe('No single leader')
    expect(t.note).toMatch(/tied at the top: Homo, Mus; also present: Bos/)
    expect(tied.suggestions.find((s) => s.setting === 'database')).toBeUndefined()
  })

  it('one leader: its proteome is suggested', () => {
    const one = o([taxon('Homo', 9605, 40), taxon('Mus', 10088, 20)])
    expect(one.calls.find((c) => c.id === 'genus')!.value).toBe('Homo')
    expect(one.suggestions.find((s) => s.setting === 'database')?.value).toBe('Homo proteome')
  })
})

// ---- 15, 17: the alkylation extension ---------------------------------------

describe('round 6, 15: the alkylation report raises Extension only where the CLI places on a shipped proteome', () => {
  const alk = PRODUCT_OF.get('alkylation_out')!
  const base = { tag_length: '3', extension: '2', alkylation_out: '', alkylation_proteome: 'human' }

  it('raises to 3 alone; not with placements, a hand-off output or a protein database', () => {
    expect(alkylationExtension(base)).toBe('3')
    // feedback 202dbcf4: the default auto reads no proteome and raises nothing.
    expect(alkylationExtension({ ...base, alkylation_proteome: 'auto' })).toBeNull()
    expect(alkylationExtension({ tag_length: '3', extension: '2', alkylation_out: '' })).toBeNull()
    expect(alkylationExtension({ ...base, alkylation_proteome: 'auto', fasta: '/d/x' })).toBeNull()
    for (const n of ['recon_out', 'shortlist_out', 'fasta_out', 'search_config_out', 'recon_fasta'])
      expect(alkylationExtension({ ...base, [n]: '/d/x' }), n).toBeNull()
  })

  it('unticking restores the extension it raised, unless it was edited since', () => {
    const on = toggleProduct(alk, true, base, '/d/a.tags.tsv', null)
    expect(on.values['extension']).toBe('3')
    expect(on.raised).toEqual({ from: '2', to: '3' })
    const off = toggleProduct(alk, false, on.values, '/d/a.tags.tsv', on.raised)
    expect(off.values['extension']).toBe('2')
    const edited = toggleProduct(alk, false, { ...on.values, extension: '4' }, '/d/a.tags.tsv', on.raised)
    expect(edited.values['extension']).toBe('4')
    // With placements on, ticking changes nothing.
    expect(toggleProduct(alk, true, { ...base, recon_out: '/d/a.recon.tsv' }, '/d/a.tags.tsv', null).values['extension']).toBe('2')
  })

  it('the Characterize product note says what the calls are validated at', () => {
    expect(TASKS.find((t) => t.id === 'characterize')!.productNotes!['alkylation_out']).toMatch(/validated at Extension 2/)
  })
})

// ---- 18: the SDRF verdict ----------------------------------------------------

describe('round 6, 18: an organism present below the top call qualifies the verdict', () => {
  const f = (state: FieldResult['state']): FieldResult => ({ state, sdrf: '', fastag: '', note: '', evidence: '', column: '' })
  const fields = (over: Partial<Record<FieldId, FieldResult['state']>>): Record<FieldId, FieldResult> =>
    Object.fromEntries(FIELDS.map((k) => [k, f(over[k] ?? 'no_sdrf')])) as Record<FieldId, FieldResult>

  it('not an unqualified ✓ consistent', () => {
    const v = verdict(fields({ organism: 'present_not_called', cleavage: 'match' }))
    expect(v.text).toBe('✓ other fields consistent; annotated organism present but below the top call')
    expect(verdict(fields({ cleavage: 'match' })).text).toBe('✓ consistent')
    expect(verdict(fields({ organism: 'present_not_called' })).text).toBe('Annotated organism present but below the top call')
  })
})

// ---- 19, 20: shortlist yes/no, the QC strip --------------------------------

describe('round 6, 19 and 20', () => {
  it('the CLI writes gapped yes|no: shown as on/off', () => {
    expect(settingValue('shortlist_gapped', 'yes')).toBe('on')
    expect(settingValue('shortlist_gapped', 'no')).toBe('off')
  })

  it('what the QC strip shows is not repeated as table rows', () => {
    const rows = qcTsv
      .split('\n')
      .slice(1)
      .filter(Boolean)
      .map((l) => {
        const [sec, key, value, n, desc] = l.split('\t')
        return { sec, key, value, n, desc }
      })
    const keys = summaryKeys(qcSummary(rows))
    for (const k of ['count_ms2', 'tag_yield', 'ms2_tagged_e001', 'reporter_compatible_kits']) expect(keys.has(k), k).toBe(true)
  })

  it('the QC view lists MS2 spectra once', async () => {
    const mock = installMockBridge()
    mock.reportFiles['/d/a.qc.tsv'] = qcTsv
    render(<ReportTable kind="qc" path="/d/a.qc.tsv" />)
    await waitFor(() => expect(screen.getByLabelText('QC summary')).toBeDefined())
    const tables = document.querySelectorAll('table.kv th')
    expect([...tables].map((t) => t.textContent)).not.toContain('MS2 spectra')
  })
})

// ---- 21, 22: the triage view -----------------------------------------------

describe('round 6, 21 and 22: the triage view', () => {
  it('says MS2 spectra, and its ID filters are disabled without identifications', async () => {
    const mock = installMockBridge()
    mock.reportFiles['/d/a.census_sorted.tsv'] = triageTsv
    render(<ReportTable kind="triage" path="/d/a.census_sorted.tsv" />)
    await waitFor(() => expect(document.querySelector('.report-sum')?.textContent).toMatch(/MS2 spectra, ranked/))
    const group = screen.getByRole('group', { name: 'Show' })
    for (const name of ['Identified', 'Not identified', 'Unknown']) {
      const radio = within(group).getByRole('radio', { name })
      expect((radio as HTMLInputElement).disabled, name).toBe(true)
      expect(radio.closest('label')!.getAttribute('title')).toMatch(/Give the identifications of this run/)
    }
    expect((within(group).getByRole('radio', { name: 'All spectra' }) as HTMLInputElement).disabled).toBe(false)
  })
})

// ---- 23: the tabs of every workflow -----------------------------------------

describe('round 6, 23: each workflow opens its tabs, then Tags and Spectrum', () => {
  it('every workflow is covered, in the order of doc/GUI-WORKFLOWS.md', () => {
    expect(Object.keys(WORKFLOW_TABS).sort()).toEqual(TASKS.map((t) => t.id).sort())
    const all = { overview: true, results: true, spectrum: true, qc: true, recon: true, species: true, shortlist: true, triage: true, digest: true, glyco: true }
    const first = (wf: string): string[] => tabsOf(all, wf).slice(0, WORKFLOW_TABS[wf].length)
    expect(first('export-tags')).toEqual(['overview', 'results', 'spectrum'])
    expect(first('run-qc')).toEqual(['overview', 'qc', 'results', 'spectrum'])
    expect(first('mass-shift')).toEqual(['overview', 'recon', 'results', 'spectrum'])
    expect(first('species')).toEqual(['overview', 'species', 'results', 'spectrum'])
    expect(first('db-reduction')).toEqual(['overview', 'shortlist', 'results', 'spectrum'])
    expect(first('triage')).toEqual(['overview', 'triage', 'results', 'spectrum'])
    expect(first('characterize')).toEqual(['overview', 'digest', 'species', 'glyco', 'results', 'spectrum'])
  })
})

// ---- 25: the digest no call's sentences ------------------------------------

describe('round 6, 25: the digest card does not name the rule id or repeat the reason', () => {
  it('no "first no-call rule" sentence, no repeated Da sentence', () => {
    const r = parseReport(charDigest, '/d/run01.digest.tsv')
    render(<DigestPanel reports={[r]} errors={[]} onOpen={() => {}} />)
    const says = [...document.querySelectorAll('.sentences li')].map((l) => l.textContent ?? '')
    expect(says.join(' ')).not.toMatch(/first no-call rule/)
    expect(says.join(' ')).not.toMatch(/low_resolution/)
    expect(says).not.toContain('The fragment tolerance is in Da.')
  })
})

// ---- 11: one hint per field --------------------------------------------------

describe('round 6, 11: curated hints, never a fragment', () => {
  it('every curated hint names a real option and fits one line', () => {
    for (const [n, h] of Object.entries(BRIEF_HINT)) {
      expect(PARAM_BY_NAME.has(n), n).toBe(true)
      expect(h.length, n).toBeLessThanOrEqual(72)
      expect(h.endsWith('…'), n).toBe(false)
    }
  })

  it('a fallback is a whole clause or nothing, and a quoted name is not cut', () => {
    expect(briefHint('The option named "decoy: prefix" sets a rule for entries.')).toBe('The option named "decoy: prefix" sets a rule for entries.')
    expect(briefHint('Allow gaps in the tags: a gap spans two residues.')).toBe('Allow gaps in the tags.')
    expect(briefHint('x'.repeat(90))).toBe('')
  })
})
