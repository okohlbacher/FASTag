// Review round 10 minors (doc/GUI-REVIEW-2026-11-20.md section 4).

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import SpeciesPanel from '../SpeciesPanel'

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
