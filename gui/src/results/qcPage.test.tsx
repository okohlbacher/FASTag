// The Run QC page (feedback 20261124T075255Z_1ea229c2: "just a long list of
// numbers ... make it more intuitive, graphical and concise"): headline
// tiles, small charts of the distributions with a Table view each, and every
// other row behind one closed "All values" disclosure. Real runs of the CLI:
// qc_version 3 (TMT Velos, ion-trap E. coli), 2 and 1.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ReportTable, { qcLines, qcSummary, summaryKeys } from './ReportTable'
import { isKitCallKey } from './calls'
import { TILE_KEYS, assessability, chargeBars, kitLine, msLevels, qcChannels, qcTiles, resolutionClasses, valueGroups, type Row } from './qcModel'
import { installMockBridge } from '../testing/mockBridge'
import { CONFLICT_QC } from '../testing/kitFixtures'
import tmtQc from '../fixtures/cli-dev/pxd000001-qc/run.qc.tsv?raw'
import ecoliQc from '../fixtures/cli-dev/ecoli-run-qc/run01.qc.tsv?raw'
import v2Qc from '../fixtures/cli-1.15/workflows/run-qc/run01.qc.tsv?raw'
import v1Qc from '../fixtures/cli-1.15/ecoli_ms2_small_0.3da.qc.tsv?raw'

const rowsOf = (text: string): Row[] =>
  text
    .trimEnd()
    .split('\n')
    .slice(1)
    .map((l) => {
      const [sec, key, value, n, desc] = l.split('\t')
      return { sec, key, value, n: n ?? '', desc: desc ?? '' }
    })

async function open(text: string): Promise<void> {
  const mock = installMockBridge()
  mock.reportFiles['/d/run.qc.tsv'] = text
  render(<ReportTable kind="qc" path="/d/run.qc.tsv" />)
  await waitFor(() => expect(screen.getByLabelText('QC summary')).toBeDefined())
}

const tile = (label: string): Element => [...document.querySelectorAll('.qc-strip .stat')].find((s) => s.querySelector('dt')!.textContent === label)!

describe('the headline tiles', () => {
  it('TMT Velos: five tiles in the order of the questions, serial and start under the instrument', () => {
    const rows = rowsOf(tmtQc)
    const tiles = qcTiles(rows, qcSummary(rows))
    expect(tiles.map((t) => t.label)).toEqual(['MS2 spectra', 'Tagged (E ≤ 0.01)', 'Instrument', 'Isobaric kit', 'Redundancy'])
    const [ms2, tagged, inst, kit, red] = tiles
    expect(ms2).toMatchObject({ value: '6,103', sub: 'of 7,534 spectra read' })
    expect(tagged).toMatchObject({ value: '48.9% (2,982)', meter: 0.4886 })
    expect(inst).toMatchObject({ value: 'LTQ Orbitrap Velos', sub: 'serial Slot 144 · started 2010-06-15 19:01' })
    expect(inst.title).toContain('Started 2010-06-15T19:01:07Z.')
    expect(kit).toMatchObject({ value: 'TMT 6-plex', low: false })
    expect(red).toMatchObject({ value: '10.4%', sub: 'same best tag: 0.9%' })
    expect(red.title).toMatch(/286 clusters, the largest of 4 spectra.*28 clusters, the largest of 2/)
  })

  it('a kit without a call is flagged; an older report keeps its compatible-kits tile', async () => {
    const eco = rowsOf(ecoliQc)
    expect(qcTiles(eco, qcSummary(eco)).find((t) => t.label === 'Isobaric kit')).toMatchObject({ value: 'Not assessable', low: true })
    const old = rowsOf(v2Qc)
    expect(qcTiles(old, qcSummary(old)).find((t) => t.label === 'Isobaric kit')).toMatchObject({ value: 'none found', low: false })
    await open(ecoliQc)
    expect(tile('Isobaric kit').className).toBe('stat low')
    expect(tile('Isobaric kit').querySelector('dd')!.textContent).toBe('Not assessable')
  })

  it('a conflict of label mass and channels is a warning on the tile and in the reporter section', async () => {
    const rows = rowsOf(CONFLICT_QC)
    expect(qcTiles(rows, qcSummary(rows)).find((t) => t.label === 'Isobaric kit')).toMatchObject({ value: 'Conflict: TMT label, reporters fit TMTpro 18-plex', warn: true, low: false })
    expect(kitLine(rows, qcSummary(rows))).toBe('Conflict: TMT label, reporters fit TMTpro 18-plex, the label mass and the reporter channels disagree')
    await open(CONFLICT_QC)
    expect(tile('Isobaric kit').querySelector('dd')!.className).toBe('warn-text')
    expect(document.querySelector('.qc-kit strong')!.className).toBe('warn-text')
  })
})

describe('the charts', () => {
  it('spectra per MS level by analyser', () => {
    expect(msLevels(rowsOf(tmtQc))).toEqual([
      { label: 'MS1', total: 1431, segments: [{ id: 'FTMS', label: 'FTMS', value: 1431, tone: 'tag' }], note: undefined },
      { label: 'MS2', total: 6103, segments: [{ id: 'FTMS', label: 'FTMS', value: 6103, tone: 'tag' }], note: undefined }
    ])
    // No MS1 in the file: no MS1 bar.
    expect(msLevels(rowsOf(ecoliQc)).map((s) => s.label)).toEqual(['MS2'])
  })

  it('precursor charges as shares; an empty "?" bar is left out', () => {
    const bars = chargeBars(rowsOf(tmtQc))
    expect(bars.map((b) => b.label)).toEqual(['2', '3', '4', '5', '6'])
    expect(bars[0]).toMatchObject({ value: 3749, n: 6103, share: 3749 / 6103 })
    const folded = chargeBars([
      { sec: 'qc', key: 'precursor_charge_0', value: '5', n: '100', desc: '' },
      { sec: 'qc', key: 'precursor_charge_2', value: '80', n: '100', desc: '' },
      { sec: 'qc', key: 'precursor_charge_6', value: '3', n: '100', desc: '' },
      { sec: 'qc', key: 'precursor_charge_8', value: '2', n: '100', desc: '' }
    ])
    expect(folded.map((b) => [b.label, b.value, b.muted])).toEqual([
      ['?', 5, true],
      ['2', 80, false],
      ['6+', 5, false]
    ])
  })

  it('resolution: the measured bands of a class, and why a class has none', () => {
    const [ms1, ms2] = resolutionClasses(rowsOf(tmtQc))
    expect(ms1).toMatchObject({ label: 'FTMS MS1', value: 56450, source: 'measured', stated: null })
    expect(ms1.bands).toEqual([
      { band: 'mz400-800', value: 58802, n: 338 },
      { band: 'mz800-1200', value: 44750, n: 76 },
      { band: 'mz1200-2000', value: 38635, n: 6 }
    ])
    expect(ms2).toMatchObject({ label: 'FTMS MS2', value: null, bands: [], why: 'centroid only' })
  })

  it('reporter assessability: one 100 % bar per family, with the reasons', () => {
    const [tmt] = assessability(rowsOf(ecoliQc))
    expect(tmt.label).toBe('TMT')
    expect(tmt.total).toBe(139)
    expect(tmt.segments.map((s) => [s.label, s.value])).toEqual([
      ['ion-trap MS2', 66],
      ['scan starts above the reporters', 73]
    ])
  })

  it('reporter channels: the counts of qc_version 3, the seen channels of an older report', () => {
    expect(qcChannels(rowsOf(tmtQc))).toMatchObject({ partial: false })
    expect(qcChannels(rowsOf(tmtQc)).channels).toHaveLength(11)
    expect(qcChannels(rowsOf(v2Qc)).channels).toEqual([])
    const old = qcChannels([{ sec: 'qc', key: 'reporter_observed_TMT', value: '126:0.7632,131:0.5000', n: '1000', desc: '' }])
    expect(old).toEqual({
      partial: true,
      channels: [
        { label: '126', mz: null, seen: 763, assessable: 1000, share: 0.7632, observed: true },
        { label: '131', mz: null, seen: 500, assessable: 1000, share: 0.5, observed: true }
      ]
    })
  })

  it('the kit with how it was decided, from the kit call', () => {
    const rows = rowsOf(tmtQc)
    expect(kitLine(rows, qcSummary(rows))).toBe('TMT 6-plex, decided by the label mass on the tags (2,251 tag ends)')
    const old = rowsOf(v2Qc)
    expect(kitLine(old, qcSummary(old))).toBe('none found')
  })
})

describe('the page', () => {
  it('opens on tiles and charts; the long list is closed under All values', async () => {
    await open(tmtQc)
    for (const name of ['Spectra', 'Precursor charge', 'Resolution', 'Reporter ions']) expect(screen.getByRole('region', { name })).toBeDefined()
    // Every MS2 can show reporters: a sentence in place of two full bars.
    expect(document.querySelectorAll('figure.qc-chart')).toHaveLength(4)
    expect(screen.getByRole('region', { name: 'Reporter ions' }).textContent).toContain('Every MS2 can show TMT and iTRAQ reporters (6,103 MS2).')
    const all = document.querySelector('details.qc-all') as HTMLDetailsElement
    expect(all.open).toBe(false)
    expect(all.querySelector('summary')!.textContent).toMatch(/^All values \(\d+\)$/)
    // Every key-value table of the page is inside All values.
    for (const t of document.querySelectorAll('table.kv')) expect(all.contains(t)).toBe(true)
    expect(screen.getByRole('region', { name: 'Reporter ions' }).textContent).toContain('Isobaric kit: TMT 6-plex, decided by the label mass')
    expect(screen.getByRole('region', { name: 'Resolution' }).textContent).toContain('FTMS MS2: not measured (centroid only)')
  })

  it('a chart steps through its marks with the keyboard and says the active one', async () => {
    await open(tmtQc)
    const plot = within(screen.getByRole('region', { name: 'Precursor charge' })).getByRole('group', { name: /^Precursor charges: 2 61\.4%/ })
    fireEvent.keyDown(plot, { key: 'ArrowRight' })
    const tip = screen.getByRole('tooltip')
    expect(tip.textContent).toBe('Charge 23,749 of 6,103 MS2 (61.4%)')
    fireEvent.keyDown(plot, { key: 'End' })
    expect(screen.getByRole('tooltip').textContent).toBe('Charge 66 of 6,103 MS2 (0.1%)')
  })

  it("each chart's Table view lists the values it draws", async () => {
    await open(tmtQc)
    const charge = screen.getByRole('region', { name: 'Precursor charge' })
    fireEvent.click(within(charge).getByRole('button', { name: 'Table' }))
    const rows = within(within(charge).getByRole('grid', { name: 'Precursor charge' })).getAllByRole('row').slice(1)
    expect(rows.map((r) => [...r.querySelectorAll('td')].map((c) => c.textContent))).toEqual([
      ['2', '3,749', '61.4%'],
      ['3', '1,955', '32.0%'],
      ['4', '368', '6.0%'],
      ['5', '25', '0.4%'],
      ['6', '6', '0.1%']
    ])
    const rep = screen.getByRole('region', { name: 'Reporter ions' })
    const channelChart = [...rep.querySelectorAll('figure')].find((f) => /reporter channel/.test(f.querySelector('figcaption')!.textContent!))!
    fireEvent.click(within(channelChart as HTMLElement).getByRole('button', { name: 'Table' }))
    const table = within(screen.getByRole('region', { name: 'Reporter channels' })).getByRole('table')
    const ch = within(table).getAllByRole('row').slice(1)
    expect(ch).toHaveLength(11)
    expect(ch[0].textContent).toBe('126126.12774,6586,10376.3%')
    // The chart and its table dim the same channels: those the report does not call seen.
    expect(ch.filter((r) => r.className === 'muted').map((r) => r.querySelector('th')!.textContent)).toEqual(['127N', '128N', '129N', '130N', '131C'])
    expect(qcChannels(rowsOf(tmtQc)).channels.filter((c) => c.observed === false).map((c) => c.label)).toEqual(['127N', '128N', '129N', '130N', '131C'])
  })

  it('an older report (qc_version 2) gets the same page, the kit from its compatible kits', async () => {
    await open(v2Qc)
    expect(tile('Isobaric kit').querySelector('dd')!.textContent).toBe('none found')
    expect(tile('Instrument').querySelector('.qc-sub')!.textContent).toBe('serial 01579B · started 2010-02-22 16:21')
    expect(screen.getByRole('region', { name: 'Reporter ions' }).textContent).toContain('Isobaric kit: none found')
    // No per-channel rows and no channel seen: no channel chart.
    expect(document.querySelectorAll('figure.qc-chart')).toHaveLength(3)
  })
})

describe('an ion-trap run (qc_version 3)', () => {
  it('why no reporters can be seen, as one bar per family; resolution in words only', async () => {
    await open(ecoliQc)
    const rep = screen.getByRole('region', { name: 'Reporter ions' })
    expect(rep.querySelector('figcaption')!.textContent).toBe('MS2 that can show reporter ions')
    expect([...rep.querySelectorAll('.qc-legend li')].map((l) => l.textContent!.trim())).toEqual(['ion-trap MS2', 'scan starts above the reporters'])
    expect(rep.textContent).toContain('Isobaric kit: Not assessable')
    const res = screen.getByRole('region', { name: 'Resolution' })
    expect(res.querySelector('figure')).toBeNull()
    expect(res.textContent).toContain('ITMS MS2: not measured (centroid only)')
  })
})

describe('nothing is lost', () => {
  for (const [name, text] of [
    ['qc_version 3, TMT', tmtQc],
    ['qc_version 3, ion trap', ecoliQc],
    ['qc_version 2', v2Qc],
    ['qc_version 1', v1Qc]
  ] as const) {
    it(`${name}: every row is on a tile, the kit call or under All values`, async () => {
      const rows = rowsOf(text)
      const said = summaryKeys(qcSummary(rows))
      for (const k of TILE_KEYS) said.add(k)
      const v3 = rows.some((r) => r.key === 'reporter_kit')
      const kitCall = (k: string): boolean => v3 && (isKitCallKey(k) || k === 'reporter_compatible_kits')
      const lines = qcLines(rows)
      const listed = valueGroups(rows, lines, (k) => said.has(k) || kitCall(k)).flatMap((g) => g.lines.map((l) => l.key))
      for (const l of lines) expect(listed.includes(l.key) || said.has(l.key) || kitCall(l.key), l.key).toBe(true)
      // ... and on the page, with the empty rows shown.
      await open(text)
      const all = document.querySelector('details.qc-all')!
      const box = within(all as HTMLElement).queryByRole('checkbox')
      if (box) fireEvent.click(box)
      const shown = [...all.querySelectorAll('table.kv:not(.qc-channels) th')].map((t) => t.textContent)
      expect(shown).toHaveLength(listed.length)
      // The run settings are there too, not only the qc section.
      expect(shown).toContain('FASTag version')
    })
  }

  it('the filter narrows All values', async () => {
    await open(tmtQc)
    const all = document.querySelector('details.qc-all') as HTMLElement
    fireEvent.change(within(all).getByRole('searchbox', { name: 'Filter the values' }), { target: { value: 'redundancy' } })
    const shown = [...all.querySelectorAll('table.kv:not(.qc-channels) th')].map((t) => t.textContent)
    expect(shown.length).toBeGreaterThan(0)
    expect(shown.every((s) => /redundan|cluster|same-tag|split|pairs/i.test(s!))).toBe(true)
  })
})
