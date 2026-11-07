// The step cards' summaries and the plan line (GUI-DESIGN 3 S1, P2a PR u).

import { describe, expect, it } from 'vitest'
import { CARDS, cardSummary, planLine, reportsOn } from './plan'
import { baseValues, startValues } from './tasks'
import { SECTIONS, dependents, hiddenUntilMaster } from '../paramLayout'

const ctx = { input: '/d/run01.mzML', out: '/d/run01.tags.tsv', files: 0 }

describe('the step cards', () => {
  it('the four cards hold every form section once, in the order of the run', () => {
    expect(CARDS.map((c) => `${c.n} ${c.title}`)).toEqual(['1 Spectra', '2 Database & taxonomy', '3 Tagging', '4 Reports'])
    expect(CARDS.flatMap((c) => c.sections).sort()).toEqual(SECTIONS.map((s) => s.title).sort())
  })

  it('each card says what it is set to in one line', () => {
    const v = startValues('builtin:characterize', ctx.out)
    expect(cardSummary('spectra', v, ctx)).toBe('run01.mzML · 10% of spectra')
    expect(cardSummary('database', v, ctx)).toBe('Species on (bundled index) · FASTA none')
    expect(cardSummary('tagging', v, ctx)).toBe('length 3 · extension 2 · 20.0 ppm · max 50 tags')
    expect(cardSummary('reports', v, ctx)).toBe('digest, label, glyco · mass-gap needs a FASTA')
    const d = baseValues('defaults')
    expect(cardSummary('spectra', d, { input: '', out: '', files: 0 })).toBe('no file yet')
    expect(cardSummary('spectra', d, { input: '', out: '', files: 3 })).toBe('3 files in the batch')
    expect(cardSummary('database', { ...d, species: false, fasta: '/db/human.fasta' }, ctx)).toBe('Species off · FASTA human.fasta')
    expect(cardSummary('reports', { ...d, fasta: '/db/h.fasta' }, ctx)).toBe('tags only')
  })

  it('the plan line names files, species, reports and where the outputs go', () => {
    const v = startValues('builtin:characterize', ctx.out)
    expect(planLine(v, ctx)).toBe('1 file · species on · digest+label+glyco · out: beside input')
    expect(planLine(baseValues('defaults'), { input: '', out: '', files: 0 })).toBe('no file · species off · no reports')
    expect(planLine(v, { input: '/d/a.mzML', out: '/elsewhere/x.tsv', files: 0 })).toMatch(/out: x\.tsv$/)
    expect(planLine(v, { input: '', out: '', files: 2 })).toBe('2 files · species on · digest+label+glyco · out: beside each input')
    expect(reportsOn({ ...v, recon_out: '/d/r.tsv', recon_fasta: '/db/x.fasta', massgap_out: '/d/m.tsv' })).toEqual([
      'digest',
      'label',
      'glyco',
      'recon',
      'mass-gap'
    ])
  })
})

describe('hidden dependent fields', () => {
  const species = SECTIONS.find((s) => s.title === 'Species detection')!
  it('the species switch turns on 11 settings, hidden until it is on', () => {
    expect(dependents(species)).toHaveLength(11)
    expect(hiddenUntilMaster('species_rank', species, { species: false })).toBe(true)
    expect(hiddenUntilMaster('species_rank', species, { species: true })).toBe(false)
    // Waiting for gaps, not for species: shown (disabled), not hidden.
    expect(hiddenUntilMaster('species_use_gapped', species, { species: true, gaps: '0' })).toBe(false)
    expect(hiddenUntilMaster('species', species, { species: false })).toBe(false)
  })

  it('a field one of two switches turns on stays visible while the other is on', () => {
    const seq = SECTIONS.find((s) => s.title === 'Sequence matching')!
    expect(hiddenUntilMaster('isobaric_tolerance', seq, {})).toBe(true)
    expect(hiddenUntilMaster('isobaric_tolerance', seq, { recon_out: '/d/r.tsv' })).toBe(false)
    // A section without a switch hides nothing.
    const digest = SECTIONS.find((s) => s.title === 'Digest and labels')!
    expect(dependents(digest)).toEqual([])
    expect(hiddenUntilMaster('digest_models', digest, {})).toBe(false)
  })
})
