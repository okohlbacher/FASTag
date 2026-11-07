// Instrument families and the preset each proposes, from the probe's
// instrument record and from the digest report's meta rows (real FASTag
// 1.12 reports of the public gate inputs, src/fixtures/cli-1.12/).
import { describe, expect, it } from 'vitest'
import { parseReport } from '../digestReport'
import { familyOf, instrumentFromReports, instrumentText, presetFor } from './instrument'
import ionTrapDigest from '../fixtures/cli-1.12/iontrap_20ppm.digest.tsv?raw'
import orbitrapDigest from '../fixtures/cli-1.12/orbitrap_hcd.digest.tsv?raw'
import lumosDigest from '../fixtures/digest.tsv?raw'
import labelReport from '../fixtures/cli-1.12/iontrap_20ppm.label.tsv?raw'

describe('familyOf', () => {
  it('the MS2 analyser decides where the probe names it', () => {
    expect(familyOf({ name: 'LTQ Orbitrap XL', ms2Analyzer: 'ion trap' })).toBe('ion-trap')
    expect(familyOf({ name: 'LTQ Orbitrap XL', ms2Analyzer: 'radial ejection linear ion trap' })).toBe('ion-trap')
    expect(familyOf({ name: 'Orbitrap Fusion Lumos', ms2Analyzer: 'orbitrap' })).toBe('orbitrap')
    expect(familyOf({ name: 'Orbitrap Astral', ms2Analyzer: 'orbitrap' })).toBe('astral')
    expect(familyOf({ name: 'timsTOF Pro', ms2Analyzer: 'time-of-flight', ionMobility: '1/K0' })).toBe('timstof')
    expect(familyOf({ name: 'TripleTOF 6600', ms2Analyzer: 'time-of-flight' })).toBe('tof')
  })

  it('without the analyser, a hybrid with an ion trap stays undecided', () => {
    expect(familyOf({ name: 'LTQ Orbitrap XL' })).toBe('hybrid-ion-trap')
    expect(familyOf({ name: 'Orbitrap Fusion Lumos' })).toBe('hybrid-ion-trap')
    expect(familyOf({ name: 'Q Exactive HF' })).toBe('orbitrap')
    expect(familyOf({ name: 'Orbitrap Exploris 480' })).toBe('orbitrap')
    expect(familyOf({ name: 'LTQ Velos' })).toBe('ion-trap')
    expect(familyOf({ name: 'LTQ XL' })).toBe('ion-trap')
    expect(familyOf({ name: 'timsTOF HT' })).toBe('timstof')
    expect(familyOf({ name: '-', model: '-' })).toBe('unknown')
    expect(familyOf({})).toBe('unknown')
  })

  it('each family proposes its preset; a hybrid or a plain TOF none', () => {
    expect(presetFor('ion-trap')).toBe('iontrap-cid')
    expect(presetFor('orbitrap')).toBe('orbitrap-hcd')
    expect(presetFor('astral')).toBe('astral')
    expect(presetFor('timstof')).toBe('timstof')
    expect(presetFor('hybrid-ion-trap')).toBeNull()
    expect(presetFor('tof')).toBeNull()
    expect(presetFor('unknown')).toBeNull()
  })

  it('names the instrument without the CLI placeholder', () => {
    expect(instrumentText({ name: 'Q Exactive', model: '-' })).toBe('Q Exactive')
    expect(instrumentText({ name: 'Q Exactive', model: 'QE-1' })).toBe('Q Exactive (QE-1)')
    expect(instrumentText({ name: '-', model: '-' })).toBeNull()
  })
})

describe('instrumentFromReports (the digest meta rows)', () => {
  it('reads the instrument of a real 1.12 digest report', () => {
    const it1 = instrumentFromReports([parseReport(ionTrapDigest, '/d/a.digest.tsv')])
    expect(it1).toMatchObject({ name: 'LTQ Orbitrap XL', text: 'LTQ Orbitrap XL', family: 'hybrid-ion-trap', report: '/d/a.digest.tsv' })
    expect(instrumentFromReports([parseReport(orbitrapDigest, '/d/b.digest.tsv')])).toMatchObject({ text: 'Q Exactive', family: 'orbitrap' })
    expect(instrumentFromReports([parseReport(lumosDigest, '/d/c.digest.tsv')])?.family).toBe('hybrid-ion-trap')
  })

  it('a report without meta rows names none', () => {
    expect(instrumentFromReports([parseReport(labelReport, '/d/a.label.tsv')])).toBeNull()
    expect(instrumentFromReports([])).toBeNull()
  })
})
