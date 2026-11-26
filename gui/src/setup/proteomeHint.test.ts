// database-3: the line under Shipped proteome names the organism of a species
// report at rank genus too (the Species workflow's default).
import { describe, expect, it } from 'vitest'
import { proteomeHint, PROTEOME_HELP, topSpecies } from './proteomeHint'
import type { SpeciesReport } from '../types'

const report = (...taxa: SpeciesReport['taxa']): SpeciesReport => ({ path: '/d/a.tags.species.tsv', taxa })
const genus = (taxid: number, name: string, call?: string): SpeciesReport['taxa'][number] => ({ rank: 'genus', taxid, name, observed: 9, adjusted: 9, q: 0, ...(call ? { call } : {}) })

describe('proteomeHint at rank genus (database-3)', () => {
  it('maps the genus of each shipped proteome', () => {
    expect(topSpecies(report(genus(9605, 'Homo')))).toEqual({ name: 'Homo', proteome: 'human' })
    expect(topSpecies(report(genus(10088, 'Mus')))).toEqual({ name: 'Mus', proteome: 'mouse' })
    expect(topSpecies(report(genus(4930, 'Saccharomyces')))).toEqual({ name: 'Saccharomyces', proteome: 'yeast' })
    expect(topSpecies(report(genus(561, 'Escherichia')))).toEqual({ name: 'Escherichia', proteome: 'ecoli' })
  })
  it('names the first genus and the proteome to choose', () => {
    const sp = report(genus(9605, 'Homo'), genus(9541, 'Macaca'))
    expect(proteomeHint(sp, '')).toBe('Species detection names Homo first in this file: choose Human.')
    expect(proteomeHint(sp, 'human')).toBe('Species detection names Homo first in this file.')
  })
  it('a genus without a shipped proteome asks for its FASTA', () => {
    expect(proteomeHint(report(genus(9913, 'Bos')), '')).toBe('Species detection names Bos first in this file; no shipped proteome fits: give its FASTA as Protein database.')
  })
  it('skips a genus called not detected, and prefers a species row', () => {
    expect(topSpecies(report(genus(9605, 'Homo', 'not_detected'), genus(10088, 'Mus')))?.proteome).toBe('mouse')
    const both = report(genus(9605, 'Homo'), { rank: 'species', taxid: 10090, name: 'Mus musculus', observed: 9, adjusted: 9, q: 0 })
    expect(topSpecies(both)).toEqual({ name: 'Mus musculus', proteome: 'mouse' })
  })
  it('no report, or one without genus or species rows: the default line', () => {
    expect(proteomeHint(null, '')).toBe(PROTEOME_HELP)
    expect(proteomeHint(report({ rank: 'family', taxid: 9604, name: 'Hominidae', observed: 9, adjusted: 9, q: 0 }), '')).toBe(PROTEOME_HELP)
  })
})
