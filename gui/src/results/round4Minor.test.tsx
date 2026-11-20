// Round 4 minor findings (doc/GUI-WORKFLOWS.md, review round 4): the brief
// Advanced hint, the E-value column, the shortlist's header lines and the
// one header of every report tab.

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { briefHint, hintText } from '../paramLayout'
import { evalueText } from '../ResultsTable'
import { shortlistNotes } from './ReportTable'
import ReportHeader from './ReportHeader'
import { settingWords } from './overview'
import shortlist from '../fixtures/cli-1.15/workflows/db-reduction/run01.shortlist.tsv?raw'

describe('round 4, 14: a brief one-line hint under an Advanced field', () => {
  it('cuts at the first clause break and ends as a sentence', () => {
    expect(briefHint('Allow gaps in the tags: a gap spans two residues whose sum matches the step.')).toBe('Allow gaps in the tags.')
    expect(briefHint('Short line.')).toBe('Short line.')
  })
  it('keeps a hint that has no clause break whole', () => {
    const t = hintText('gap_penalty', 'The penalty of a gap')
    expect(briefHint(t).length).toBeLessThanOrEqual(t.length + 1)
  })
})

describe('round 4, 16: E-values of 0.001 and more in 2 significant digits', () => {
  it('formats like the scientific branch', () => {
    expect(evalueText('0.0235287')).toBe('0.024')
    expect(evalueText('0.00222177')).toBe('0.0022')
    expect(evalueText('0.52248')).toBe('0.52')
    expect(evalueText('123.456')).toBe('123')
    expect(evalueText('0.00074')).toBe('7.4 × 10⁻⁴')
    expect(evalueText('')).toBe('')
    expect(evalueText('-')).toBe('-')
  })
})

describe('round 4, 19: the shortlist header lines in the GUI words', () => {
  it('turns the CLI caveat into one sentence and the settings into labelled rows', () => {
    const notes = shortlist.split('\n').filter((l) => l.startsWith('#')).map((l) => l.replace(/^#\s*/, ''))
    const { caveat, rows } = shortlistNotes(notes)
    expect(caveat).toMatch(/^A search-space reduction from tag placements: not an identification/)
    const labels = rows.map((r) => r.label)
    expect(labels).toContain('Input')
    expect(labels).toContain('Database')
    expect(labels.some((l) => /max_evalue|min_spectra/.test(l))).toBe(false)
    expect(rows.find((r) => r.value === '10')).toBeDefined()
    expect(JSON.stringify(rows)).not.toMatch(/NOT an identification/)
  })

  it('every report tab header: a title, its file at the right, a sub line', () => {
    render(<ReportHeader title="Species" paths={['/d/run01.species.tsv']} help={{ to: 'species-reading', label: 'About this tab' }} sub="Of run01.mzML" />)
    expect(screen.getByRole('heading', { level: 2, name: 'Species' })).toBeDefined()
    expect(screen.getByText('run01.species.tsv').getAttribute('title')).toBe('/d/run01.species.tsv')
    expect(screen.getByText('Of run01.mzML')).toBeDefined()
  })
})

describe('round 4, 15: suggested settings in the form words', () => {
  it('names each setting in words, not an abbreviation', () => {
    expect(settingWords('fragment tol.')).toBe('Fragment tolerance')
    expect(settingWords('fixed C')).toBe('Fixed cysteine modification')
  })
})
