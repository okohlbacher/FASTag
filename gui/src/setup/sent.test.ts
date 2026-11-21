// What a run sends (paramLayout sentValues): the options of the 1.15.3 GUI
// (ALWAYS_SENT) and the workflow's own values, and every other option only
// when it differs from the CLI default. The CLI reads some options by
// whether they were given at all (optionGiven_), so an explicit default
// changes what it does.
import { describe, expect, it } from 'vitest'
import { ALWAYS_SENT, RECIPE_FIELDS, fillRecipe, forcedValue, isChanged, recipeNote, sentValues, sentValues as sentValuesFrom, syncRecipe } from '../paramLayout'
import { TASKS, baseValues, startValues } from './tasks'
import { applyPreset, presetDiff } from './presetDiff'
import type { ParamValue } from '../ParamField'

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

  // Round 4, 3: under the MSFragger recipe the form shows what runs. An
  // untouched recipe field shows 10/6/2 (syncRecipe) and is not named; an
  // explicit 0.1/0/1 is the user's and is sent, though it is the manifest
  // default.
  it('shows the MSFragger recipe in untouched fields outside Database reduction, and sends an explicit 0.1/0/1', () => {
    const base = startValues('builtin:export-tags', '/d/a.tags.tsv')
    const before = { ...base, recon_fasta: '/d/h.fasta', shortlist_out: '/d/a.shortlist.tsv', search_config_out: '/d/a.search.json' }
    const v = syncRecipe(before, { ...before, search_engine: 'msfragger' }, new Set(), base)
    expect([v['shortlist_max_evalue'], v['recon_min_length'], v['recon_missed_cleavages']]).toEqual(['10', '6', '2'])
    expect(recipeNote('shortlist_max_evalue', v)).toMatch(/^MSFragger default/)
    const sent = sentValuesFrom(v, base)
    expect(sent['search_engine']).toBe('msfragger')
    for (const n of ['recon_min_length', 'recon_missed_cleavages', 'shortlist_gapped', 'shortlist_max_evalue']) expect(n in sent, n).toBe(false)
    // The static defaults, entered on purpose: the CLI would use 10/6/2.
    const explicit = sentValuesFrom({ ...v, shortlist_max_evalue: '0.1', recon_min_length: '0', recon_missed_cleavages: '1' }, base)
    expect(explicit).toMatchObject({ shortlist_max_evalue: '0.1', recon_min_length: '0', recon_missed_cleavages: '1' })
    // The recipe off again: untouched fields go back to the origin's value,
    // an edited one keeps its own.
    const off = syncRecipe({ ...v, shortlist_max_evalue: '0.5' }, { ...v, shortlist_max_evalue: '0.5', search_engine: 'sage' }, new Set(['shortlist_max_evalue']), base)
    expect([off['shortlist_max_evalue'], off['recon_min_length'], off['recon_missed_cleavages']]).toEqual(['0.5', '0', '1'])
    expect(recipeNote('shortlist_max_evalue', off)).toBeNull()
  })

  it('keeps an explicit 0.1 under the MSFragger recipe through a saved and loaded preset', () => {
    const base = baseValues('builtin:export-tags')
    const shown = syncRecipe(base, { ...base, recon_fasta: '/d/h.fasta', shortlist_out: 'shortlist.tsv', search_config_out: 'search.params', search_engine: 'msfragger' }, new Set(), base)
    const edited: Record<string, ParamValue> = { ...shown, shortlist_max_evalue: '0.1' }
    // Saved as useSession commitPreset does: the recipe fields as shown.
    const diff = presetDiff(base, edited)
    for (const n of RECIPE_FIELDS) diff[n] = edited[n]
    const loaded = fillRecipe(applyPreset({ v: 2, base: 'builtin:export-tags', diff }, ''), new Set(Object.keys(diff)))
    expect(loaded['shortlist_max_evalue']).toBe('0.1')
    expect(loaded['recon_min_length']).toBe('6')
    // Loaded, its values are the origin: 0.1 still goes, 6 still does not.
    const sent = sentValuesFrom(loaded, loaded)
    expect(sent['shortlist_max_evalue']).toBe('0.1')
    expect('recon_min_length' in sent).toBe(false)
    // A preset saved before the recipe fields were stored ran the recipe.
    const old = fillRecipe(applyPreset({ v: 2, base: 'builtin:export-tags', diff: { shortlist_out: 'shortlist.tsv', search_config_out: 'search.params', search_engine: 'msfragger' } }, ''), new Set(['shortlist_out', 'search_config_out', 'search_engine']))
    expect(old['shortlist_max_evalue']).toBe('10')
    expect('shortlist_max_evalue' in sentValuesFrom(old, old)).toBe(false)
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
