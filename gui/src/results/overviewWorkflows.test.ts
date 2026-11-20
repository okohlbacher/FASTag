// Review round 3: the Overview of the workflows that write no digest, label
// or mass-gap report. Run QC names the instrument from its QC report and
// shows its own figures; Database reduction and the Mass-shift survey show
// theirs; a species report at another rank is summarised at that rank; the
// suggested settings and the evidence cutoff appear only where they say
// something about the run.
import { describe, expect, it } from 'vitest'
import qcTsv from '../fixtures/cli-1.15/ecoli_ms2_small_0.3da.qc.tsv?raw'
import shortlistTsv from '../fixtures/cli-1.15/ecoli_ms2_small_0.3da.shortlist.tsv?raw'
import { buildOverview, qcFacts, reportRank, shortlistFacts, shownTiles, topShift, type Overview, type Tile } from './overview'
import type { SpeciesReport } from '../types'

const LOG = ['139 MS2 spectra, 2028 tags']
const base = { log: LOG, reports: [], species: null, census: null, instrument: null }
const tile = (o: Overview, id: string): Tile | undefined => [...o.figures, ...o.calls].find((t) => t.id === id)

const QC_WITH_INSTRUMENT = qcTsv.replace(
  /\nqc\tqc_version/,
  '\nrun\tinstrument_model\tOrbitrap Exploris 480\t-\tThe instrument.\nrun\tinstrument_serial_number\tMA10001\t-\tThe serial.\nrun\tstart_timestamp\t2024-01-02T10:00:00\t-\tThe start.\nqc\tqc_version'
)

const DELTA = ['delta\tspectra\ttop_interps\tlocalized\tresidues\tunlocalized\tunimod\tpsimod', '0.00\t500\t-\t0\t-\t0\t-\t-', '15.99\t42\tOxidation:12\t30\tM\t12\tOxidation\t-', '-17.03\t60\tGln->pyro-Glu:20\t10\tQ\t50\tGln->pyro-Glu\t-'].join('\n')
const COUNTS = 'key\tvalue\nms2_read\t139\nms2_tagged\t100\nms2_placed\t61\ncheck_tagged_le_ms2\tok\n'

describe('the Overview of Run QC', () => {
  it('names the instrument, serial and start time from the QC report', () => {
    const o = buildOverview({ ...base, params: { qc_out: '/d/a.qc.tsv' }, qc: QC_WITH_INSTRUMENT })
    expect(tile(o, 'instrument')).toMatchObject({ value: 'Orbitrap Exploris 480', tone: 'figure' })
    expect(tile(o, 'instrument')!.note).toMatch(/QC report.*serial MA10001.*started 2024-01-02/)
    expect(qcFacts(QC_WITH_INSTRUMENT)!.instrument).toBe('Orbitrap Exploris 480')
  })

  it('shows its tag yield and top charge, and no suggested settings of defaults alone', () => {
    const o = buildOverview({ ...base, params: { qc_out: '/d/a.qc.tsv' }, qc: qcTsv })
    expect(tile(o, 'qc-tagged')!.value).toBe('18.71% (26)')
    expect(tile(o, 'qc-charge')!.value).toMatch(/^2\+ \(69\.78?%\)$/)
    const shown = shownTiles(o, { qc_out: '/d/a.qc.tsv' })
    expect(shown.figures.map((t) => t.id)).toEqual(['spectra', 'instrument', 'tags', 'qc-tagged', 'qc-charge'])
    expect(o.measured).toBe(false)
    // The acquisition line is short; its reasoning is a detail.
    for (const c of o.checks) expect(c.text.length).toBeLessThan(140)
  })
})

describe('the Overview of Database reduction and the Mass-shift survey', () => {
  it('shows how many proteins the shortlist kept and whether the configuration was written', () => {
    expect(shortlistFacts(shortlistTsv)).toEqual({ kept: 1, of: 3 })
    const o = buildOverview({ ...base, params: { shortlist_out: '/d/a.shortlist.tsv' }, shortlist: shortlistTsv, config: true })
    expect(tile(o, 'shortlist')).toMatchObject({ value: '1 of 3 proteins kept' })
    expect(tile(o, 'shortlist')!.note).toMatch(/configuration written/)
    expect(shownTiles(o, { shortlist_out: 'x' }).figures.map((t) => t.id)).toContain('shortlist')
  })

  it('shows the placed spectra and the top shift away from 0, with its UniMod name', () => {
    expect(topShift(DELTA)).toEqual({ delta: '-17.03', spectra: 60, name: 'Gln->pyro-Glu' })
    const o = buildOverview({ ...base, params: { delta_out: 'd', delta_counts_out: 'c' }, delta: DELTA, deltaCounts: COUNTS })
    expect(tile(o, 'placed')).toMatchObject({ value: '61' })
    expect(tile(o, 'placed')!.note).toMatch(/of 100 tagged/)
    expect(tile(o, 'topshift')!.value).toBe('-17.03 Da (Gln->pyro-Glu)')
    expect(shownTiles(o, { delta_out: 'd', delta_counts_out: 'c' }).figures.map((t) => t.id)).toEqual(['spectra', 'tags', 'placed', 'topshift'])
  })
})

describe('a species report at another rank', () => {
  const family: SpeciesReport = {
    path: '/d/a.species.tsv',
    taxa: [
      { rank: 'family', taxid: 543, name: 'Enterobacteriaceae', observed: 30, adjusted: 30, q: 1e-9, call: 'present' },
      { rank: 'family', taxid: 9604, name: 'Hominidae', observed: 3, adjusted: 3, q: 0.4, call: 'not_detected' }
    ]
  } as SpeciesReport

  it('is summarised at its own rank, not as "no genus"', () => {
    expect(reportRank(family, 'family')).toBe('family')
    expect(reportRank(family, undefined)).toBe('family')
    const o = buildOverview({ ...base, species: family, params: { species: true, species_rank: 'family' } })
    expect(tile(o, 'genus')).toMatchObject({ label: 'Top family', value: 'Enterobacteriaceae', tone: 'call' })
  })

  it('names the evidence cutoff only beside a call it gates', () => {
    const o = buildOverview({ ...base, species: family, params: { species: true } })
    expect(o.checks.find((c) => c.gates)).toBeDefined()
    // The panel filters it by the shown calls: none for a QC run.
    expect(shownTiles(o, { qc_out: 'q' }).calls).toHaveLength(0)
  })
})
