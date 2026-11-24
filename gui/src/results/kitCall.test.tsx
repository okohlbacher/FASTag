// Run QC, qc_version 3: the isobaric kit call (one kit, or the short list
// the channels leave) replaces the list of compatible kits, and the reporter
// channels are counted per channel. Real runs of the CLI (fixtures/cli-dev).

import { render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ReportTable, { qcSummary } from './ReportTable'
import { kitCallOf, kitText, reporterChannels } from './calls'
import { qcCells } from '../run/batchSummary'
import { installMockBridge } from '../testing/mockBridge'
import { CONFLICT_QC, CONFLICT_ROWS } from '../testing/kitFixtures'
import tmtQc from '../fixtures/cli-dev/pxd000001-qc/run.qc.tsv?raw'
import ecoliQc from '../fixtures/cli-dev/ecoli-run-qc/run01.qc.tsv?raw'
import oldQc from '../fixtures/cli-1.15/workflows/run-qc/run01.qc.tsv?raw'

type Row = { sec: string; key: string; value: string; n: string; desc: string }
const rowsOf = (text: string): Row[] =>
  text
    .trimEnd()
    .split('\n')
    .slice(1)
    .map((l) => {
      const [sec, key, value, n, desc] = l.split('\t')
      return { sec, key, value, n, desc }
    })
const getter = (rows: Row[]) => (k: string) => rows.find((r) => r.key === k)

// A synthetic qc_version 3 report: reporters only, two labels left.
const AMBIGUOUS = rowsOf(
  [
    'section\tkey\tvalue\tn\tdescription',
    'qc\treporter_compatible_kits\ttmt10plex,tmt11plex,tmt16plex,tmt18plex\t-\tKits compatible with the observed reporters.',
    'qc\treporter_kit\tambiguous\t40\tAmbiguous: the family is not decided by label mass (the fragment tolerance is in Da, so the label windows do not hold).',
    'qc\treporter_kit_candidates\ttmt10plex,tmt16plex\t-\tThe smallest kit per label.',
    'qc\treporter_family_evidence\treporters_only\t-\tReporter channels only: the fragment tolerance is in Da, so the label windows do not hold.',
    'qc\treporter_label_delta\tn/a\t-\tNo label mass decides the family.'
  ].join('\n')
)

const CONFLICT = rowsOf(['section\tkey\tvalue\tn\tdescription', ...CONFLICT_ROWS].join('\n'))

describe('the isobaric kit call', () => {
  it('label mass and channels disagree: Conflict, both pieces of evidence, no call', () => {
    const call = kitCallOf(getter(CONFLICT))!
    expect(call).toMatchObject({ text: 'Conflict: TMT label, reporters fit TMTpro 18-plex', call: null, evidence: 'label_conflict' })
    expect(call.note).toMatch(/label mass says TMT .*fit only tmt18plex/)
    const kit = qcSummary(CONFLICT).find((x) => x.label === 'Isobaric kit')!
    expect(kit).toMatchObject({ value: 'Conflict: TMT label, reporters fit TMTpro 18-plex', warn: true })
    expect(kit.title).toMatch(/^the label mass and the reporter channels disagree\./)
    // Without the delta row the label comes from the description.
    const noDelta = CONFLICT.filter((r) => r.key !== 'reporter_label_delta')
    expect(kitCallOf(getter(noDelta))!.text).toBe('Conflict: TMT label, reporters fit TMTpro 18-plex')
  })

  it('a kit value this GUI does not know is shown, but is no call', () => {
    const odd = AMBIGUOUS.map((r) => (r.key === 'reporter_kit' ? { ...r, value: 'tmt35plex' } : r))
    expect(kitCallOf(getter(odd))).toMatchObject({ text: 'tmt35plex', call: null })
  })

  it('the QC strip shows a conflict as a warning', async () => {
    const mock = installMockBridge()
    mock.reportFiles['/d/c.qc.tsv'] = CONFLICT_QC
    render(<ReportTable kind="qc" path="/d/c.qc.tsv" />)
    await waitFor(() => expect(screen.getByLabelText('QC summary')).toBeDefined())
    const kit = [...document.querySelectorAll('.qc-strip .stat')].find((s) => s.querySelector('dt')!.textContent === 'Isobaric kit')!
    const dd = kit.querySelector('dd')!
    expect(dd.textContent).toBe('Conflict: TMT label, reporters fit TMTpro 18-plex')
    expect(dd.className).toBe('warn-text')
  })

  it('PXD000001 (original TMT 6-plex, 127C/129C): one kit, decided by the label mass; no larger kit named', () => {
    const rows = rowsOf(tmtQc)
    const call = kitCallOf(getter(rows))!
    expect(call).toMatchObject({ text: 'TMT 6-plex', call: 'tmt6plex', evidence: 'label_mass' })
    expect(call.note).toMatch(/TMT on 2251 tag ends of 43584 filtered tags/)
    const kit = qcSummary(rows).find((x) => x.label === 'Isobaric kit')!
    expect(kit.value).toBe('TMT 6-plex')
    expect(kit.warn).toBeUndefined()
    expect(kit.title).toMatch(/^decided by the label mass on the tags\. The kit: the smallest kit of the TMT label/)
    // The list of compatible kits is in the file, not on the screen.
    expect(rows.find((r) => r.key === 'reporter_compatible_kits')!.value).toBe('tmt6plex,tmt10plex,tmt11plex,tmt16plex,tmt18plex')
    expect(qcCells(tmtQc).kit).toMatchObject({ text: 'TMT 6-plex', call: 'tmt6plex' })
  })

  it('reporters only: Ambiguous, with the kits the channels leave', () => {
    const call = kitCallOf(getter(AMBIGUOUS))!
    expect(call).toMatchObject({ text: 'Ambiguous: TMT 10-plex or TMTpro 16-plex', call: null, evidence: 'reporters_only' })
    expect(qcSummary(AMBIGUOUS).find((x) => x.label === 'Isobaric kit')!.title).toMatch(/^from the reporter channels only; the label mass did not decide\./)
  })

  it('an unlabelled ion-trap run: Not assessable; an older report keeps its compatible kits', () => {
    expect(kitCallOf(getter(rowsOf(ecoliQc)))).toMatchObject({ text: 'Not assessable', call: null })
    expect(qcCells(ecoliQc).kit).toMatchObject({ text: 'Not assessable', call: null })
    expect(kitCallOf(getter(rowsOf(oldQc)))).toBeNull()
    expect(qcSummary(rowsOf(oldQc)).find((x) => x.label === 'Isobaric kit')).toBeDefined()
    expect(kitText('tmt18plex')).toBe('TMTpro 18-plex')
    expect(kitText('unknown_kit')).toBe('unknown_kit')
  })
})

describe('reporter channel counts', () => {
  it('PXD000001: every TMT 10/11 channel with its m/z and count, the unused ones at 0', () => {
    const ch = reporterChannels(rowsOf(tmtQc))
    expect(ch.map((c) => c.label)).toEqual(['126', '127N', '127C', '128N', '128C', '129N', '129C', '130N', '130C', '131N', '131C'])
    expect(ch[0]).toEqual({ label: '126', mz: 126.127725, seen: 4658, assessable: 6103, share: expect.closeTo(4658 / 6103, 4), observed: true })
    expect(ch.filter((c) => c.seen === 0).map((c) => c.label)).toEqual(['129N', '130N', '131C'])
    // The six channels reporter_observed_TMT names (the TMT6 set of this run);
    // 127N and 128N have one MS2 each and are not among them.
    expect(ch.filter((c) => c.observed).map((c) => c.label)).toEqual(['126', '127C', '128C', '129C', '130C', '131N'])
    expect(reporterChannels(rowsOf(oldQc))).toEqual([])
    expect(reporterChannels(rowsOf(ecoliQc))).toEqual([])
  })

  it('the QC view: the kit in the strip, the channel table under it, no compatible-kits or channel rows elsewhere', async () => {
    const mock = installMockBridge()
    mock.reportFiles['/d/run.qc.tsv'] = tmtQc
    render(<ReportTable kind="qc" path="/d/run.qc.tsv" />)
    await waitFor(() => expect(screen.getByLabelText('QC summary')).toBeDefined())
    const kit = [...document.querySelectorAll('.qc-strip .stat')].find((s) => s.querySelector('dt')!.textContent === 'Isobaric kit')!
    expect(kit.querySelector('dd')!.textContent).toBe('TMT 6-plex')
    const table = within(screen.getByRole('region', { name: 'Reporter channels' })).getByRole('table')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(11)
    expect(rows[0].textContent).toBe('126126.12774,6586,10376.3%')
    expect(rows[5].textContent).toBe('129N129.13150' + '6,103' + '0.0%')
    expect(rows[5].className).toBe('muted')
    // Dimmed: every channel the report does not call seen, 127N and 128N (one MS2 each) too.
    expect(rows.filter((r) => r.className === 'muted').map((r) => r.querySelector('th')!.textContent)).toEqual(['127N', '128N', '129N', '130N', '131C'])
    expect(screen.getByRole('region', { name: 'Reporter channels' }).textContent).toContain('of 6,103 assessable MS2')
    const keys = [...document.querySelectorAll('.qc-section table.kv:not(.qc-channels) th')].map((t) => t.textContent)
    expect(keys).not.toContain('Compatible isobaric kits')
    expect(keys.some((k) => /Reporter channel|Reporter kit|Reporter family|Reporter label/.test(k ?? ''))).toBe(false)
  })
})
