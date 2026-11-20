// What a run sends (paramLayout sentValues): the options of the 1.15.3 GUI
// (ALWAYS_SENT) and the workflow's own values, and every other option only
// when it differs from the CLI default. The CLI reads some options by
// whether they were given at all (optionGiven_), so an explicit default
// changes what it does.
import { describe, expect, it } from 'vitest'
import { ALWAYS_SENT, isChanged, sentValues } from '../paramLayout'
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
})
