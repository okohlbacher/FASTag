// What a run sends (paramLayout sentValues): the options of the 1.15.3 GUI
// (ALWAYS_SENT) and the workflow's own values, and every other option only
// when it differs from the CLI default. The CLI reads some options by
// whether they were given at all (optionGiven_), so an explicit default
// changes what it does.
import { describe, expect, it } from 'vitest'
import { ALWAYS_SENT, forcedValue, isChanged, sentValues, sentValues as sentValuesFrom } from '../paramLayout'
import { TASKS, startValues } from './tasks'

describe('the parameters a run sends', () => {
  for (const t of TASKS) {
    it(`a default ${t.label} run sends ALWAYS_SENT options and the workflow's values only`, () => {
      const v = startValues(`builtin:${t.id}`, '/d/a.tags.tsv')
      const sent = sentValues(v)
      const own = new Set(Object.keys(t.values))
      const extra = Object.keys(sent).filter((n) => !ALWAYS_SENT.has(n) && !own.has(n))
      expect(extra, t.id).toEqual([])
      // Every value the workflow changes goes (unless it is the default).
      for (const n of own) if (isChanged(n, v[n])) expect(Object.keys(sent), `${t.id}: ${n}`).toContain(n)
    })
  }

  it('leaves shortlist_specificity out under shortlist_protease auto, so the CLI picks semi for Asp-N', () => {
    const v = { ...startValues('builtin:db-reduction', '/d/a.tags.tsv'), recon_fasta: '/d/h.fasta', shortlist_protease: 'auto' }
    const sent = sentValues(v)
    expect(sent['shortlist_protease']).toBe('auto')
    expect('shortlist_specificity' in sent).toBe(false)
    // Given on purpose, it goes.
    expect(sentValues({ ...v, shortlist_specificity: 'semi' })['shortlist_specificity']).toBe('semi')
  })

  it('keeps the MSFragger conditional defaults: no search option at its default is named', () => {
    const v = { ...startValues('builtin:db-reduction', '/d/a.tags.tsv'), recon_fasta: '/d/h.fasta', search_engine: 'msfragger' }
    const sent = sentValues(v)
    for (const n of ['search_precursor_tolerance', 'search_precursor_unit', 'search_missed_cleavages', 'search_isotope_errors', 'shortlist_specificity', 'charge_min', 'complement_rule', 'ion_series_hybrid', 'pick_profile'])
      expect(n in sent, n).toBe(false)
  })

  it('sends a value and its unit as one', () => {
    const v = startValues('builtin:mass-shift', '/d/a.tags.tsv')
    expect('recon_sub_tolerance_unit' in sentValues(v)).toBe(false)
    // 5 Da is not 5 ppm: a changed unit sends its value too.
    const da = sentValues({ ...v, recon_sub_tolerance_unit: 'Da' })
    expect([da['recon_sub_tolerance'], da['recon_sub_tolerance_unit']]).toEqual(['5.0', 'Da'])
    const s = sentValues({ ...v, recon_sub_tolerance: '0.05', recon_sub_tolerance_unit: 'Da' })
    expect(s['recon_sub_tolerance']).toBe('0.05')
    expect(s['recon_sub_tolerance_unit']).toBe('Da')
    // The fragment tolerance (ALWAYS_SENT) goes with its unit.
    expect(s['fragment_tolerance_unit']).toBeDefined()
  })

  it('sends neither a cleared value nor its unit, whichever unit is chosen', () => {
    const v = startValues('builtin:export-tags', '/d/a.tags.tsv')
    for (const unit of ['Da', 'ppm']) {
      const sent = sentValues({ ...v, fragment_tolerance: '', fragment_tolerance_unit: unit })
      expect('fragment_tolerance' in sent, unit).toBe(false)
      expect('fragment_tolerance_unit' in sent, unit).toBe(false)
      const sub = sentValues({ ...startValues('builtin:mass-shift', '/d/a.tags.tsv'), recon_fasta: '/d/h.fasta', recon_sub_tolerance: ' ', recon_sub_tolerance_unit: unit })
      expect('recon_sub_tolerance_unit' in sub, unit).toBe(false)
    }
    // A value with its unit still goes as a pair.
    const da = sentValues({ ...v, fragment_tolerance: '0.02', fragment_tolerance_unit: 'Da' })
    expect([da['fragment_tolerance'], da['fragment_tolerance_unit']]).toEqual(['0.02', 'Da'])
  })

  it('names none of the MSFragger recipe options at their defaults outside Database reduction', () => {
    const v = {
      ...startValues('builtin:export-tags', '/d/a.tags.tsv'),
      recon_fasta: '/d/h.fasta',
      search_config_out: '/d/a.search.json',
      search_engine: 'msfragger'
    }
    const sent = sentValues(v)
    expect(sent['search_engine']).toBe('msfragger')
    for (const n of ['recon_min_length', 'recon_missed_cleavages', 'shortlist_gapped', 'shortlist_max_evalue']) expect(n in sent, n).toBe(false)
  })

  it('sends a value that differs from the MSFragger recipe, even when it is the static default', () => {
    const base = startValues('builtin:db-reduction', '/d/a.tags.tsv')
    const v = { ...base, recon_fasta: '/d/h.fasta', search_engine: 'msfragger' }
    const sentValues = (x: Record<string, unknown>): Record<string, unknown> => sentValuesFrom(x, base)
    // The workflow's values are the recipe: none needs naming.
    const sent = sentValues(v)
    for (const n of ['recon_min_length', 'recon_missed_cleavages', 'shortlist_max_evalue', 'shortlist_gapped']) expect(n in sent, n).toBe(false)
    // E-value back to 0.1 (the static default): the CLI would use 10.
    expect(sentValues({ ...v, shortlist_max_evalue: '0.1' })['shortlist_max_evalue']).toBe('0.1')
    expect(sentValues({ ...v, recon_min_length: '0', recon_missed_cleavages: '1' })).toMatchObject({ recon_min_length: '0', recon_missed_cleavages: '1' })
    // Gapped placements cannot be turned off under the recipe: shown on, not sent.
    expect(forcedValue('shortlist_gapped', { ...v, shortlist_gapped: false })?.value).toBe(true)
    expect('shortlist_gapped' in sentValues({ ...v, shortlist_gapped: false })).toBe(false)
    // With Sage the recipe is the workflow's: every value is named.
    const sage = sentValues({ ...v, search_engine: 'sage' })
    expect(sage).toMatchObject({ recon_min_length: '6', recon_missed_cleavages: '2', shortlist_max_evalue: '10', shortlist_gapped: true })
    expect(forcedValue('shortlist_gapped', { ...v, search_engine: 'sage' })).toBeNull()
  })

  it('sends an explicit Full specificity, and nothing for Automatic', () => {
    const v: Record<string, unknown> = { ...startValues('builtin:db-reduction', '/d/a.tags.tsv'), recon_fasta: '/d/h.fasta', shortlist_protease: 'auto' }
    expect(v['shortlist_specificity']).toBe('')
    expect(sentValues({ ...v, shortlist_specificity: 'full' })['shortlist_specificity']).toBe('full')
  })
})
