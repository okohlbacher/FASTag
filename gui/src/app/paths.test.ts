// The output-path helpers (P1 PR c moved them out of App.tsx). The stripExt
// test moved here from App.test.tsx ("run/batch orchestration"), which drove
// it through the input picker; that wiring stays covered by the App-level
// tests that pick an input and read the Output field.

import { describe, expect, it } from 'vitest'
import { defaultOut, defaultSpeciesOut, dirName, stripExt } from './paths'

describe('output paths', () => {
  it('stripExt keeps dotted directories intact on both slash flavors', () => {
    expect(defaultOut('/runs.2026/sample')).toBe('/runs.2026/sample.tags.tsv')
    expect(defaultOut('C:\\runs.2026\\sample')).toBe('C:\\runs.2026\\sample.tags.tsv')
    expect(defaultOut('/d/x.mzML')).toBe('/d/x.tags.tsv')
    expect(stripExt('/runs.2026/sample')).toBe('/runs.2026/sample')
    expect(stripExt('C:\\runs.2026\\sample.mzML')).toBe('C:\\runs.2026\\sample')
  })

  it('the species report goes beside -out when no path is given', () => {
    expect(defaultSpeciesOut('/d/a.tags.tsv')).toBe('/d/a.tags.species.tsv')
  })

  it('dirName keeps the separator, of either flavor', () => {
    expect(dirName('/d/a.mzML')).toBe('/d/')
    expect(dirName('C:\\d\\a.mzML')).toBe('C:\\d\\')
    expect(dirName('a.mzML')).toBe('')
  })
})
