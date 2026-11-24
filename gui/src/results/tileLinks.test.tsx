// Overview and Run QC tiles as links (feedback 20261124T125609Z_a8f957f6:
// "when you click on a tile, nav to the tab associated with it"): a tile
// with a detail tab opens it, at its section, and focus moves to that
// heading; a tile without a tab is no link.

import { act, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { parseReport } from '../digestReport'
import { CLI_CASES, logLines, type CliCase } from '../testing/cliFixtures'
import { speciesFromTsv } from '../testing/speciesTsv'
import { installMockBridge, type MockBridge } from '../testing/mockBridge'
import { click, renderCharacterizeApp, runButton, fileButton } from '../testing/render'
import { buildOverview, type Tile } from './overview'
import OverviewPanel from './OverviewPanel'
import ReportTable from './ReportTable'
import { QC_SECTION, tileTarget } from './tileLinks'
import tmtQc from '../fixtures/cli-dev/pxd000001-qc/run.qc.tsv?raw'

const model = (c: CliCase) =>
  buildOverview({
    log: logLines(c),
    reports: [parseReport(c.digest, '/d/r.digest.tsv'), parseReport(c.label, '/d/r.label.tsv')],
    species: speciesFromTsv(c.species, '/d/r.species.tsv'),
    census: null,
    params: c.params,
    instrument: null
  })
const tile = (name: string): HTMLElement => screen.getByRole('region', { name })
const t = (id: string, tone: Tile['tone'] = 'call', action?: Tile['action']): Tile => ({ id, label: id, value: 'v', note: 'n', tone, action })

describe('tileTarget', () => {
  it('leads each tile to the tab of its detail, at its section', () => {
    const all = ['overview', 'results', 'qc', 'recon', 'species', 'shortlist', 'triage', 'digest', 'glyco'] as const
    expect(tileTarget(t('protease'), all)).toEqual({ tab: 'digest', sections: ['dg-digest'] })
    expect(tileTarget(t('label'), all)).toEqual({ tab: 'digest', sections: ['dg-label'] })
    expect(tileTarget(t('alkylation'), all)).toEqual({ tab: 'digest', sections: ['dg-alk', 'dg-gap'] })
    expect(tileTarget(t('genus'), all)).toEqual({ tab: 'species' })
    expect(tileTarget(t('glyco', 'figure'), all)).toEqual({ tab: 'glyco' })
    expect(tileTarget(t('qc-tagged', 'figure'), all)).toEqual({ tab: 'qc' })
    expect(tileTarget(t('qc-charge', 'figure'), all)).toEqual({ tab: 'qc', sections: [QC_SECTION.charge] })
    expect(tileTarget(t('spectra', 'figure'), all)).toEqual({ tab: 'qc', sections: [QC_SECTION.spectra] })
    for (const id of ['ident-score', 'identified', 'candidates', 'tagged']) expect(tileTarget(t(id, 'figure'), all)?.tab).toBe('triage')
    expect(tileTarget(t('topshift', 'nocall'), all)?.tab).toBe('recon')
    expect(tileTarget(t('shortlist', 'figure'), all)?.tab).toBe('shortlist')
    expect(tileTarget(t('tags', 'figure'), all)?.tab).toBe('results')
  })

  it('no link where the tab is not shown, nor for a tile that only offers to add its report', () => {
    expect(tileTarget(t('protease'), ['overview', 'results'])).toBeNull()
    expect(tileTarget(t('spectra', 'figure'), ['overview', 'results', 'digest'])).toBeNull()
    expect(tileTarget(t('unknown'), ['overview', 'digest'])).toBeNull()
    const add = { kind: 'enable' as const, label: 'Add', values: {} }
    expect(tileTarget(t('protease', 'off', add), ['overview', 'digest'])).toBeNull()
    // "not called": the counts are in the Digest tab, so it leads there.
    expect(tileTarget(t('label', 'off'), ['overview', 'digest'])).toEqual({ tab: 'digest', sections: ['dg-label'] })
  })
})

describe('Overview tiles as links', () => {
  it('a tile with a tab has a labelled button in its heading; the others have none', () => {
    render(<OverviewPanel overview={model(CLI_CASES.v112)} input="/d/a.mzML" busy={false} onAction={vi.fn()} tabs={['overview', 'digest', 'species', 'results']} onOpen={vi.fn()} />)
    const b = within(tile('Protease')).getByRole('button', { name: 'Protease: open the Digest tab' })
    expect(b.closest('h3')).not.toBeNull()
    expect(b.hasAttribute('tabindex')).toBe(false)
    expect(within(tile('Top genus')).getByRole('button', { name: 'Top genus: open the Species tab' })).toBeDefined()
    expect(within(tile('Tags')).getByRole('button', { name: 'Tags: open the Tags tab' })).toBeDefined()
    expect(tile('Protease').hasAttribute('data-link')).toBe(true)
    // No Glyco tab: no link; Alkylation only offers to add its report.
    expect(within(tile('Glyco')).queryByRole('button', { name: /open the/ })).toBeNull()
    expect(tile('Glyco').hasAttribute('data-link')).toBe(false)
    expect(within(tile('Alkylation')).queryByRole('button', { name: /open the/ })).toBeNull()
  })

  it('the button and a click on the card open the tab; the tile action does not', async () => {
    const onOpen = vi.fn()
    const onAction = vi.fn()
    render(<OverviewPanel overview={model(CLI_CASES.v112)} input="/d/a.mzML" busy={false} onAction={onAction} tabs={['overview', 'digest', 'glyco']} onOpen={onOpen} />)
    await click(within(tile('Label')).getByRole('button', { name: /open the Digest tab/ }))
    expect(onOpen).toHaveBeenLastCalledWith({ tab: 'digest', sections: ['dg-label'] })
    await click(within(tile('Protease')).getByText('Trypsin'))
    expect(onOpen).toHaveBeenLastCalledWith({ tab: 'digest', sections: ['dg-digest'] })
    expect(onOpen).toHaveBeenCalledTimes(2)
    await click(within(tile('Alkylation')).getByRole('button', { name: 'Add Alkylation report and run again' }))
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('without tabs no tile is a link', () => {
    render(<OverviewPanel overview={model(CLI_CASES.v112)} input="/d/a.mzML" busy={false} onAction={vi.fn()} />)
    expect(screen.queryAllByRole('button', { name: /open the .* tab/ })).toHaveLength(0)
  })
})

function gate(mock: MockBridge, c: CliCase, stem = '/d/run01'): void {
  mock.nextPickInput = `${stem}.mzML`
  mock.reportFiles = { [`${stem}.digest.tsv`]: c.digest, [`${stem}.label.tsv`]: c.label }
  if (c.massgap) mock.reportFiles[`${stem}.massgap.tsv`] = c.massgap
  mock.speciesResult = speciesFromTsv(c.species, `${stem}.tags.species.tsv`)
}
const selectedTab = (): string | null => screen.getByRole('tab', { selected: true }).textContent

describe('Overview tiles in the app', () => {
  it('Protease opens Digest at its section, Label at Labels, Top genus the Species tab; focus moves to the heading', async () => {
    const mock = installMockBridge()
    const c = CLI_CASES.v112
    gate(mock, c)
    await renderCharacterizeApp(mock)
    await click(fileButton('Choose file…'))
    await click(runButton())
    await act(async () => {
      for (const l of logLines(c)) mock.emitLog(l)
      mock.emitDone({ ok: true, code: 0, runId: mock.lastRunId })
    })
    await waitFor(() => expect(selectedTab()).toBe('Overview'))

    await click(within(tile('Protease')).getByRole('button', { name: 'Protease: open the Digest tab' }))
    expect(selectedTab()).toMatch(/^Digest/)
    await waitFor(() => expect(document.activeElement?.id).toBe('dg-digest'))
    expect(document.activeElement?.tagName).toBe('H2')

    await click(screen.getByRole('tab', { name: 'Overview' }))
    await click(within(tile('Label')).getByRole('button', { name: /open the Digest tab/ }))
    await waitFor(() => expect(document.activeElement?.id).toBe('dg-label'))

    await click(screen.getByRole('tab', { name: 'Overview' }))
    await click(within(tile('Top genus')).getByRole('button', { name: /open the Species tab/ }))
    expect(selectedTab()).toMatch(/^Species/)
    await waitFor(() => expect(document.activeElement?.tagName).toBe('H2'))
    expect(document.getElementById('tabpanel')!.contains(document.activeElement)).toBe(true)
  })
})

describe('Run QC tiles as links', () => {
  it('MS2 spectra moves to Spectra, Isobaric kit to Reporter ions; the other tiles are no link', async () => {
    const mock = installMockBridge()
    mock.reportFiles['/d/run.qc.tsv'] = tmtQc
    render(<ReportTable kind="qc" path="/d/run.qc.tsv" />)
    const strip = await screen.findByLabelText('QC summary')
    const ms2 = within(strip).getByRole('button', { name: 'MS2 spectra: go to its section' })
    await click(ms2)
    expect(document.activeElement?.id).toBe(QC_SECTION.spectra)
    expect(document.activeElement?.textContent).toBe('Spectra')
    await click(within(strip).getByRole('button', { name: 'Isobaric kit: go to its section' }))
    expect(document.activeElement?.id).toBe(QC_SECTION.reporters)
    // A click on the card does the same.
    await click(within(strip).getByText('6,103'))
    expect(document.activeElement?.id).toBe(QC_SECTION.spectra)
    expect(within(strip).getAllByRole('button')).toHaveLength(2)
    const dts = [...strip.querySelectorAll('dt')].map((d) => d.textContent)
    expect(dts).toEqual(['MS2 spectra', 'Tagged (E ≤ 0.01)', 'Instrument', 'Isobaric kit', 'Redundancy'])
  })
})
