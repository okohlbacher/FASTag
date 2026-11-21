// Review round 5, minor findings: the shortlist settings in the form's
// words, the brief hints cut at a word, the c/z rows the species report
// leaves out, the Digest title row and the empty Species tab.
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { settingValue } from './ReportTable'
import { BRIEF_MAX, briefHint } from '../paramLayout'
import { buildOverview } from './overview'
import { evidenceOfLog } from '../run/useRun'
import { preStartChecks } from '../inspector/checks'
import SpeciesPanel from '../SpeciesPanel'
import { hitWords } from '../ResultsTable'

const CZ = 'Warning: Ion series: 812 tag rows read as c/z-dot ions were left out of -species, which counts b/y tags only.'

describe('round 5', () => {
  it('17: shortlist settings read as the form says them', () => {
    expect(settingValue('shortlist_top', '0')).toBe('no limit')
    expect(settingValue('shortlist_top', '50')).toBe('50')
    expect(settingValue('shortlist_parsimony', 'none')).toBe('off')
    expect(settingValue('shortlist_parsimony', 'greedy')).toBe('Greedy')
    expect(settingValue('shortlist_gapped', 'true')).toBe('on')
    expect(settingValue('shortlist_max_evalue', '10')).toBe('10')
  })

  // Round 6, 11: no fragment cut at a word any more; a hint that does not
  // fit one line is not shown (the full text stays the tooltip).
  it('16: a hint without a clause break that does not fit is not shown', () => {
    const t = 'The factor on the fragment tolerance when the complement window follows it, at both partners of a pair.'
    expect(t.length).toBeGreaterThan(BRIEF_MAX)
    expect(briefHint(t)).toBe('')
    expect(briefHint('Short line.')).toBe('Short line.')
  })

  it('7: a run without a database filter is not checked, not a failed match', () => {
    expect(hitWords('-')).toBe('Not checked')
    expect(hitWords('fwd')).toBe('In database')
  })

  it('28: the c/z rows left out of the species report are counted and said', () => {
    expect(evidenceOfLog([CZ]).czExcluded).toBe(812)
    const o = buildOverview({ log: [CZ], reports: [], species: null, census: null, params: { ion_series: 'cz' }, instrument: null })
    expect(o.checks.map((c) => c.text).join(' ')).toMatch(/812 tag rows read as c\/z ions were left out of the species report/)
    const pre = preStartChecks({ input: '/d/a.mzML', values: { species: true, ion_series: 'cz' }, supported: false, probe: null })
    expect(pre.checks.map((c) => c.id)).toContain('cz-species')
    render(<SpeciesPanel report={{ path: '/d/a.species.tsv', taxa: [] }} enabled tooShort={null} contributed={null} totalMs2={null} czExcluded={812} />)
    expect(screen.getByText(/812 tag rows read as c\/z ions were left out/)).toBeDefined()
  })

  it('19: an empty Species tab has its title row', () => {
    render(<SpeciesPanel report={{ path: '/d/a.species.tsv', taxa: [] }} enabled tooShort={null} contributed={null} totalMs2={null} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Species' })).toBeDefined()
    expect(screen.getByText('a.species.tsv')).toBeDefined()
  })
})
