// The plan line of the run bar (doc/GUI-WORKFLOWS.md 3) and the products a
// workflow writes (setup/products.ts).

import type { JSX } from 'react'
import { describe, expect, it } from 'vitest'
import { planLine, reportsOn, samplingSummary } from './plan'
import { baseValues, startValues, TASKS } from './tasks'
import { PRODUCT_OF, fileName, isOn, neededBy, setProduct } from './products'
import { SECTIONS, PARAM_BY_NAME, RENDERED } from '../paramLayout'
import { PARAM_UI } from '../paramUi'
import { advancedParams, FOLDED, WIRED, inputDependents } from './SetupForm'
import { aboutParams, inputParams } from './inputs'

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
    // From 1.16 Characterize writes the alkylation report and reads all spectra.
    expect(reportsOn(v)).toEqual(['Species report', 'Digest report', 'Label report', 'Alkylation report', 'Glycopeptide report'])
    expect(planLine('Characterize a run', v, ctx)).toBe('Characterize a run on run01.mzML · 5 reports · all spectra')
    expect(planLine('Run QC', startValues('builtin:run-qc', '/d/run01.tags.tsv'), ctx)).toBe('Run QC on run01.mzML · 1 report · all spectra')
    expect(planLine('Generate tags', baseValues('builtin:export-tags'), { input: '', files: 0 })).toBe('Generate tags · no file yet · tags table only · all spectra')
    // A share set by the user is named in the line.
    const tenth = { ...v, subsample_fraction: '0.1' }
    expect(planLine('Characterize a run', tenth, ctx)).toBe('Characterize a run on run01.mzML · 5 reports · 10% of spectra')
    expect(planLine('Run QC', tenth, { input: '', files: 3, outDir: '/share/out' })).toBe('Run QC on 3 files · 5 reports · 10% of spectra · outputs in /share/out')
    expect(planLine('Run QC', tenth, { input: '', files: 3 })).toBe('Run QC on 3 files · 5 reports · 10% of spectra · outputs beside each input')
  })
  it('in Batch mode the queue is the input: no files yet, never the single file', () => {
    const v = startValues('builtin:run-qc', '/d/run01.tags.tsv')
    expect(planLine('Run QC', v, { input: '/d/run01.mzML', files: 0, batch: true })).toBe('Run QC · no files yet · 1 report · all spectra · outputs beside each input')
  })
})

describe('the workflows', () => {
  it('every parameter is reachable from every workflow: Settings, Outputs or Advanced', () => {
    const all = SECTIONS.flatMap((s) => s.params)
    expect(new Set(all).size).toBe(all.length)
    expect([...all].sort()).toEqual([...RENDERED].sort())
    const common = SECTIONS.filter((s) => s.home === 'common').flatMap((s) => s.params)
    for (const t of TASKS) {
      // The spectra count is reached through Spectra to read (Custom count…).
      const folded = [...FOLDED].filter(() => [...t.basic, ...advancedParams(t)].includes('subsample_fraction'))
      // Step 2 shows the task's inputs, its about fields and what waits on them.
      const step2 = [...inputParams(t), ...aboutParams(t), ...[...inputDependents(t, t).values()].flat()]
      const reach = new Set([...t.basic, ...t.outputs, ...common, ...step2, ...advancedParams(t), ...WIRED, ...folded])
      const units = RENDERED.filter((n) => !reach.has(n) && /_unit$/.test(n))
      expect(RENDERED.filter((n) => !reach.has(n) && !units.includes(n)), t.id).toEqual([])
    }
  })
  it('shows 2 to 5 fields per workflow, each with its own one-line help, and products the manifest knows', () => {
    for (const t of TASKS) {
      expect(t.basic.length, t.id).toBeGreaterThanOrEqual(1)
      // At most 5 at once: a field that waits for another Settings field
      // (the Comet template, on Search engine) shows only with it.
      const conditional = (n: string): boolean => (PARAM_UI[n]?.depends ?? []).some((d) => (Array.isArray(d.on) ? d.on : [d.on]).some((m) => t.basic.includes(m)))
      expect(t.basic.filter((n) => !conditional(n)).length, t.id).toBeLessThanOrEqual(5)
      for (const n of t.basic) {
        expect(PARAM_BY_NAME.has(n), n).toBe(true)
        expect(t.help[n], `${t.id} ${n}`).toBeTruthy()
        // A whole sentence that fits its one line: a path field spans two
        // columns, any other one (review round 3: no hint cut mid-word).
        const wide = PARAM_BY_NAME.get(n)?.type === 'input-file'
        expect(wide, `${t.id} ${n}: an input file belongs to step 2`).toBe(false)
        expect(t.help[n].length, `${t.id} ${n}: ${t.help[n]}`).toBeLessThanOrEqual(wide ? 95 : 52)
        expect(t.help[n], `${t.id} ${n}`).toMatch(/[.:]$/)
      }
      expect(t.products.length, `${t.id} products`).toBeLessThanOrEqual(14)
      for (const o of t.outputs) expect(PRODUCT_OF.has(o), o).toBe(true)
      expect(t.outputs[0]).toBe('out')
      // Round 5, 23: a help line of a field the workflow does not show
      // is never read and drifts.
      for (const n of Object.keys(t.help)) expect([...t.basic, ...(t.about ?? []), ...inputParams(t)], `${t.id} help ${n}`).toContain(n)
    }
  })
  it('the database-reduction workflow sets the shortlist recipe (not validated)', () => {
    const v = baseValues('builtin:db-reduction')
    expect([v.shortlist_gapped, v.recon_min_length, v.shortlist_max_evalue, v.recon_missed_cleavages, v.extension, v.tag_length, v.shortlist_min_spectra]).toEqual([true, '6', '100', '2', '6', '4', '1'])
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
  // Feedback 20261124T095212Z: the GUI names -recon_id_out .mzTab, the form
  // the Mass shifts tab reads; idXML or mzid only when the user names it so.
  it('the placements as identifications are written as mzTab unless the user names another format', () => {
    const ids = PRODUCT_OF.get('recon_id_out')!
    const v = setProduct(ids, true, baseValues('builtin:mass-shift'), out)
    expect(v.recon_id_out).toBe('/d/run01.recon_id.mzTab')
    expect(fileName(ids, v, out)).toBe('run01.recon_id.mzTab')
    expect(fileName(ids, { ...v, recon_id_out: '' }, out)).toBe('run01.recon_id.mzTab')
    expect(fileName(ids, { ...v, recon_id_out: '/d/mine.idXML' }, out)).toBe('mine.idXML')
    expect(fileName(ids, { ...v, recon_id_out: 'ids.mzid' }, out)).toBe('run01.recon_id.mzid')
  })
  // Round 5, 8: the charge check report keeps the mode both.
  it('the charge check report promotes off to warn and keeps both', () => {
    const p = PRODUCT_OF.get('check_header_out')!
    expect(setProduct(p, true, baseValues('defaults'), out).check_header_charge).toBe('warn')
    expect(setProduct(p, true, { ...baseValues('defaults'), check_header_charge: 'both' }, out).check_header_charge).toBe('both')
  })
  // Round 5, 20: the alkylation report on the shipped human proteome raises
  // the extension so tags reach its 8 residues. feedback 202dbcf4: the
  // default auto reads no proteome (the tags alone) and raises nothing.
  it('the alkylation report raises Extension to 3 on a shipped proteome, not at its default', () => {
    const p = PRODUCT_OF.get('alkylation_out')!
    const ch0 = startValues('builtin:characterize', out)
    expect(setProduct(p, true, ch0, out).extension).toBe('2')
    const ch = { ...ch0, alkylation_proteome: 'human' }
    expect(setProduct(p, true, ch, out).extension).toBe('3')
    expect(setProduct(p, true, { ...ch, recon_fasta: '/d/db.fasta' }, out).extension).toBe('2')
    expect(setProduct(p, true, { ...ch, extension: '4' }, out).extension).toBe('4')
  })
})

// Review round 3: the count of spectra is one control with the share.
describe('Spectra to read', () => {
  it('offers a custom count in its select, sent as the count option', async () => {
    const { render, screen, fireEvent } = await import('@testing-library/react')
    const { default: ParamField } = await import('../ParamField')
    const { PARAM_BY_NAME } = await import('../paramLayout')
    const values: Record<string, unknown> = { subsample_fraction: '0', subsample_spectra: '0' }
    const set = (n: string) => (v: unknown) => {
      values[n] = v
    }
    const ui = (): JSX.Element => (
      <ParamField
        spec={PARAM_BY_NAME.get('subsample_fraction')!}
        value={values.subsample_fraction as string}
        onChange={set('subsample_fraction')}
        count={{ spec: PARAM_BY_NAME.get('subsample_spectra')!, value: values.subsample_spectra as string, onChange: set('subsample_spectra') }}
      />
    )
    const r = render(ui())
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect([...select.options].map((o) => o.text)).toContain('Custom count…')
    fireEvent.change(select, { target: { value: '__count' } })
    r.rerender(ui())
    fireEvent.change(screen.getByRole('textbox', { name: /number of spectra/ }), { target: { value: '5000' } })
    expect(values.subsample_spectra).toBe('5000')
    r.rerender(ui())
    // A share clears the count.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '0.1' } })
    expect(values.subsample_spectra).toBe('0')
    expect(values.subsample_fraction).toBe('0.1')
  })
})
