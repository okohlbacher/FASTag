// Review round 10 minors (doc/GUI-REVIEW-2026-11-20.md section 4).

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import SpeciesPanel from '../SpeciesPanel'
import { TASKS } from '../setup/tasks'
import { PRODUCTS } from '../setup/products'
import { PARAM_UI } from '../paramUi'
import { buildOverview } from './overview'

describe('round 10 minor: Species tab, empty report', () => {
  it('says the caveat of a tolerance in Da on an empty report too', () => {
    const { container } = render(
      <SpeciesPanel report={{ path: '/d/a.tags.species.tsv', taxa: [] }} enabled tooShort={null} contributed={null} totalMs2={null} daTolerance={0.5} />
    )
    expect(container.querySelector('.banner.warn')!.textContent).toMatch(/fragment tolerance is 0\.5 Da/)
    expect(container.textContent).toMatch(/No taxon in the report/)
  })
  it('no banner at ppm', () => {
    const { container } = render(
      <SpeciesPanel report={{ path: '/d/a.tags.species.tsv', taxa: [] }} enabled tooShort={null} contributed={null} totalMs2={null} daTolerance={null} />
    )
    expect(container.querySelector('.banner.warn')).toBeNull()
  })
})

describe('round 10 minor: the identifiability score is experimental', () => {
  it('says so in the task, the product, the option help and the Overview tile', () => {
    expect(TASKS.find((t) => t.id === 'triage')!.blurb).toMatch(/experimental/)
    expect(PRODUCTS.find((p) => p.param === 'census_sorted_out')!.what).toMatch(/experimental/)
    expect(PARAM_UI.census_score.help!.text).toMatch(/Experimental/)
    const ids = 'ident_rank\tident_score\tidentified\n1\t0.9\t1\n2\t0.5\t0\n'
    const o = buildOverview({ log: ['2 MS2 spectra, 5 tags'], reports: [], species: null, census: null, params: { census: true }, instrument: null, triage: ids })
    expect(o.figures.find((f) => f.id === 'ident-score')!.note).toMatch(/experimental ranking/)
  })
})
