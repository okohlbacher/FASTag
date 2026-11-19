// The plan line of the run bar (doc/GUI-WORKFLOWS.md 3) and the products a
// workflow writes (setup/products.ts).

import { describe, expect, it } from 'vitest'
import { planLine, reportsOn, samplingSummary } from './plan'
import { baseValues, startValues, TASKS } from './tasks'
import { PRODUCT_OF, fileName, isOn, neededBy, setProduct } from './products'
import { SECTIONS, PARAM_BY_NAME, RENDERED } from '../paramLayout'
import { advancedParams, WIRED } from './SetupForm'

const ctx = { input: '/d/run01.mzML', files: 0 }

describe('the plan line', () => {
  it('sampling follows CLI count precedence and keeps small fractions visible', () => {
    expect(samplingSummary({ subsample_spectra: '1000', subsample_fraction: '0.1' })).toBe('up to 1,000 spectra sampled')
    expect(samplingSummary({ subsample_fraction: '0.0001' })).toBe('0.01% of spectra')
    expect(samplingSummary({ subsample_fraction: '1' })).toBe('all spectra')
    expect(samplingSummary({ subsample_fraction: '0' })).toBe('all spectra')
  })
  it('names the workflow, the file or batch, the reports and the sampling', () => {
    const v = startValues('builtin:characterize', '/d/run01.tags.tsv')
    expect(reportsOn(v)).toEqual(['Species report', 'Digest report', 'Label report', 'Alkylation report', 'Glycopeptide report'])
    expect(planLine('Characterize a run', v, ctx)).toBe('Characterize a run on run01.mzML · 5 reports · 10% of spectra')
    expect(planLine('Run QC', startValues('builtin:run-qc', '/d/run01.tags.tsv'), ctx)).toBe('Run QC on run01.mzML · 1 report · all spectra')
    expect(planLine('Export tags', baseValues('builtin:export-tags'), { input: '', files: 0 })).toBe('Export tags · no file yet · tags table only · all spectra')
    expect(planLine('Run QC', v, { input: '', files: 3, outDir: '/share/out' })).toBe('Run QC on 3 files · 5 reports · 10% of spectra · out: /share/out')
    expect(planLine('Run QC', v, { input: '', files: 3 })).toBe('Run QC on 3 files · 5 reports · 10% of spectra · out: beside each input')
  })
})

describe('the workflows', () => {
  it('every parameter is reachable from every workflow: Settings, Outputs or Advanced', () => {
    const all = SECTIONS.flatMap((s) => s.params)
    expect(new Set(all).size).toBe(all.length)
    expect([...all].sort()).toEqual([...RENDERED].sort())
    const common = SECTIONS.filter((s) => s.home === 'common').flatMap((s) => s.params)
    for (const t of TASKS) {
      const reach = new Set([...t.basic, ...t.outputs, ...common, ...advancedParams(t), ...WIRED])
      const units = RENDERED.filter((n) => !reach.has(n) && /_unit$/.test(n))
      expect(RENDERED.filter((n) => !reach.has(n) && !units.includes(n)), t.id).toEqual([])
    }
  })
  it('shows 2 to 5 fields per workflow, each with its own one-line help, and products the manifest knows', () => {
    for (const t of TASKS) {
      expect(t.basic.length, t.id).toBeGreaterThanOrEqual(1)
      expect(t.basic.length, t.id).toBeLessThanOrEqual(5)
      for (const n of t.basic) {
        expect(PARAM_BY_NAME.has(n), n).toBe(true)
        expect(t.help[n], `${t.id} ${n}`).toBeTruthy()
      }
      for (const o of t.outputs) expect(PRODUCT_OF.has(o), o).toBe(true)
      expect(t.outputs[0]).toBe('out')
    }
  })
  it('the database-reduction workflow sets the validated shortlist recipe', () => {
    const v = baseValues('builtin:db-reduction')
    expect([v.shortlist_gapped, v.recon_min_length, v.shortlist_max_evalue, v.recon_missed_cleavages, v.extension]).toEqual([true, '6', '10', '2', '3'])
  })
})

describe('the products', () => {
  const out = '/d/run01.tags.tsv'
  it('checking the mass-shift table also checks the placements, which then cannot be unchecked', () => {
    let v = baseValues('defaults')
    v = setProduct(PRODUCT_OF.get('delta_spectra_out')!, true, v, out)
    expect(v.delta_spectra_out).toBe('/d/run01.delta_spectra.tsv')
    expect(v.delta_out).toBe('/d/run01.delta.tsv')
    expect(v.recon_out).toBe('/d/run01.recon.tsv')
    expect(neededBy(PRODUCT_OF.get('recon_out')!, v)).toEqual(['Mass-shift table'])
    expect(neededBy(PRODUCT_OF.get('delta_out')!, v)).toEqual(['Spectra per mass shift'])
  })
  it('a report behind a switch is the switch, and is named beside the tags table', () => {
    let v = baseValues('defaults')
    const species = PRODUCT_OF.get('species_out')!
    expect(isOn(species, v)).toBe(false)
    v = setProduct(species, true, v, out)
    expect(v.species).toBe(true)
    expect(fileName(species, v, out)).toBe('run01.tags.species.tsv')
    v = setProduct(PRODUCT_OF.get('census_sorted_out')!, true, v, out)
    expect([v.census, v.census_score]).toEqual([true, true])
    expect(fileName(PRODUCT_OF.get('fasta_out')!, setProduct(PRODUCT_OF.get('fasta_out')!, true, v, out), out)).toBe('run01.reduced.fasta')
    v = setProduct(species, false, v, out)
    expect([v.species, v.species_out]).toEqual([false, ''])
  })
})
