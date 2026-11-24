// Feedback 20261124T125757Z_882babf9 (Glyco tab): "if you click on the scan,
// open the spectrum view, analog to the Tag view, include the spectrum icon".
// Every results table with a spectrum column links its scan to the Spectrum
// tab (spectrumLink.ts, DataTable.tsx): Glyco, Triage, Recon placements and
// identifications, the spectra per mass shift. Without spectra the scan is
// plain text and its tooltip says why.

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useState, type JSX } from 'react'
import { describe, expect, it, vi } from 'vitest'
import ResultTabs, { type ResultTabsProps } from './ResultTabs'
import GlycoTable from './GlycoTable'
import ReconView from './ReconView'
import ReportTable from './ReportTable'
import { NO_SPECTRA_FILE, SpectrumLinkContext, type SpectrumLink } from './spectrumLink'
import { SPECTRUM_NEEDS } from '../spectrum/support'
import type { Tab } from '../app/viewStore'
import { installMockBridge } from '../testing/mockBridge'
import { click, flush } from '../testing/render'
import humanGlyco from '../fixtures/cli/v112-pxd014764-delta-ext3/run.tags.glyco.tsv?raw'
import humanRecon from '../fixtures/cli/v112-pxd014764-delta-ext3/run.recon.tsv?raw'
import deltaSpectra from '../fixtures/cli-1.15/workflows/mass-shift/run01.delta_spectra.tsv?raw'

const GLYCO = '/r/run.tags.glyco.tsv'
const RECON = '/r/run.recon.tsv'
const DS = '/r/run01.delta_spectra.tsv'
const TRIAGE = '/r/run01.census_sorted.tsv'
const CENSUS = 'ident_rank\tspectrum\tstatus\tident_score\n1\tcontrollerType=0 controllerNumber=1 scan=11\ttagged\t0.9\n2\tcontrollerType=0 controllerNumber=1 scan=12\tno_tags\t0.1\n'

/// The first glyco row in the table's order (by oxonium share, highest first).
const firstGlyco = (): string => {
  const rows = humanGlyco.trim().split('\n').slice(1).map((l) => l.split('\t'))
  let best = rows[0]
  for (const r of rows) if (Number(r[2]) > Number(best[2])) best = r
  return best[0]
}

function withLink(link: SpectrumLink | null, el: JSX.Element): JSX.Element {
  return link ? <SpectrumLinkContext.Provider value={link}>{el}</SpectrumLinkContext.Provider> : el
}

describe('scan links (feedback 882babf9)', () => {
  it('Glyco: the scan has the spectrum icon and a click opens it', async () => {
    const mock = installMockBridge()
    mock.reportFiles = { [GLYCO]: humanGlyco }
    const open = vi.fn()
    render(withLink({ open }, <GlycoTable path={GLYCO} />))
    await flush()
    const grid = screen.getByRole('grid', { name: 'Glyco spectra' })
    const btns = within(grid).getAllByRole('button', { name: /^Open spectrum / })
    expect(btns.length).toBeGreaterThan(0)
    expect(btns[0].querySelector('svg')).not.toBeNull()
    await click(btns[0])
    expect(open).toHaveBeenCalledWith(firstGlyco())
  })

  it('Glyco: Enter on the grid and the Open in Spectrum button open the active row', async () => {
    const mock = installMockBridge()
    mock.reportFiles = { [GLYCO]: humanGlyco }
    const open = vi.fn()
    render(withLink({ open }, <GlycoTable path={GLYCO} />))
    await flush()
    const grid = screen.getByRole('grid', { name: 'Glyco spectra' })
    await act(async () => void fireEvent.keyDown(grid, { key: 'Enter' }))
    expect(open).toHaveBeenLastCalledWith(firstGlyco())
    await click(screen.getByRole('button', { name: 'Open in Spectrum' }))
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('no spectra: the scan is plain text and the tooltip says why', async () => {
    const mock = installMockBridge()
    mock.reportFiles = { [GLYCO]: humanGlyco }
    render(withLink({ off: NO_SPECTRA_FILE }, <GlycoTable path={GLYCO} />))
    await flush()
    const grid = screen.getByRole('grid', { name: 'Glyco spectra' })
    expect(within(grid).queryAllByRole('button', { name: /^Open spectrum / })).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Open in Spectrum' })).toBeNull()
    const cell = within(grid).getAllByRole('gridcell')[0]
    expect(cell.getAttribute('title')).toBe(`${firstGlyco()}\n${NO_SPECTRA_FILE}.`)
  })

  it('a table outside the Results page shows the scan plain, with the native ID as tooltip', async () => {
    const mock = installMockBridge()
    mock.reportFiles = { [GLYCO]: humanGlyco }
    render(<GlycoTable path={GLYCO} />)
    await flush()
    const grid = screen.getByRole('grid', { name: 'Glyco spectra' })
    expect(within(grid).queryAllByRole('button', { name: /^Open spectrum / })).toHaveLength(0)
    expect(within(grid).getAllByRole('gridcell')[0].getAttribute('title')).toBe(firstGlyco())
  })

  it('Recon placements link their scans', async () => {
    const mock = installMockBridge()
    mock.reportFiles = { [RECON]: humanRecon }
    const open = vi.fn()
    render(withLink({ open }, <ReconView massgap={null} tables={{ recon: RECON }} onOpen={vi.fn()} />))
    await flush()
    const grid = screen.getByRole('grid', { name: 'Placements' })
    await click(within(grid).getAllByRole('button', { name: /^Open spectrum / })[0])
    expect(open).toHaveBeenCalledWith(humanRecon.split('\n')[1].split('\t')[0])
  })

  it('the spectra per mass shift (a generic table) link their scans', async () => {
    const mock = installMockBridge()
    mock.reportFiles = { [DS]: deltaSpectra }
    const open = vi.fn()
    render(withLink({ open }, <ReportTable kind="generic" path={DS} />))
    await flush()
    const grid = screen.getByRole('grid')
    const b = within(grid).getAllByRole('button', { name: /^Open spectrum / })[0]
    // The scan number shows; the native ID opens.
    expect(b.textContent).toBe('scan=11482')
    await click(b)
    expect(open).toHaveBeenCalledWith('controllerType=0 controllerNumber=1 scan=11482')
  })

  it('Triage: the scan icon opens the row, as Enter does', async () => {
    const mock = installMockBridge()
    mock.reportFiles = { [TRIAGE]: CENSUS }
    const open = vi.fn()
    const openSpectrum = vi.fn()
    render(withLink({ open }, <ReportTable kind="triage" path={TRIAGE} openSpectrum={openSpectrum} params={{}} />))
    await flush()
    const grid = screen.getByRole('grid', { name: /Spectra ranked/ })
    await click(within(grid).getAllByRole('button', { name: /^Open spectrum / })[1])
    expect(open).toHaveBeenCalledWith('controllerType=0 controllerNumber=1 scan=12')
  })
})

function Harness(p: Partial<ResultTabsProps>): JSX.Element {
  const [tab, setTab] = useState<Tab>(p.tab ?? 'results')
  const props: ResultTabsProps = {
    species: null,
    speciesRun: null,
    speciesOn: false,
    tooShort: null,
    evidence: { contributed: null, ms2: null },
    reports: { list: [], errors: [] },
    batchMiss: null,
    results: null,
    setResults: vi.fn(),
    running: false,
    busy: false,
    failure: null,
    setFailure: vi.fn(),
    copied: null,
    setCopied: vi.fn(),
    openResults: vi.fn(),
    openReport: vi.fn(),
    openLog: vi.fn(),
    ...p,
    tab,
    setTab
  }
  return <ResultTabs {...props} />
}

describe('scan links on the Results page', () => {
  const reports = { list: [], errors: [], tables: { glyco: GLYCO } }

  it('a Glyco scan opens the Spectrum tab at that spectrum', async () => {
    const mock = installMockBridge()
    mock.reportFiles = { [GLYCO]: humanGlyco }
    render(
      <Harness
        tab="glyco"
        reports={reports}
        results={{ path: '/r/run.tags.tsv', gen: 1, input: '/r/run.mzML' }}
        spectrumSupport={{ supported: true, probed: true, detail: '' }}
        spectrumRun={{ input: '/r/run.mzML', params: {} }}
      />
    )
    await flush()
    const grid = screen.getByRole('grid', { name: 'Glyco spectra' })
    await click(within(grid).getAllByRole('button', { name: /^Open spectrum / })[0])
    await flush()
    expect(screen.getByRole('tab', { name: 'Spectrum' }).getAttribute('aria-selected')).toBe('true')
    expect(mock.spectrumCalls[mock.spectrumCalls.length - 1]?.nativeId).toBe(firstGlyco())
  })

  it('a CLI without -dump_spectrum: plain scans that say so', async () => {
    const mock = installMockBridge()
    mock.reportFiles = { [GLYCO]: humanGlyco }
    render(<Harness tab="glyco" reports={reports} results={{ path: '/r/run.tags.tsv', gen: 1 }} spectrumSupport={{ supported: false, probed: true, detail: '' }} />)
    await flush()
    const grid = screen.getByRole('grid', { name: 'Glyco spectra' })
    expect(within(grid).queryAllByRole('button', { name: /^Open spectrum / })).toHaveLength(0)
    expect(within(grid).getAllByRole('gridcell')[0].getAttribute('title')).toBe(`${firstGlyco()}\n${SPECTRUM_NEEDS}.`)
  })

  it('a glyco report opened alone: no spectra file, plain scans that say so', async () => {
    const mock = installMockBridge()
    mock.reportFiles = { [GLYCO]: humanGlyco }
    render(<Harness tab="glyco" reports={reports} spectrumSupport={{ supported: true, probed: true, detail: '' }} />)
    await flush()
    const grid = screen.getByRole('grid', { name: 'Glyco spectra' })
    expect(within(grid).queryAllByRole('button', { name: /^Open spectrum / })).toHaveLength(0)
    expect(within(grid).getAllByRole('gridcell')[0].getAttribute('title')).toBe(`${firstGlyco()}\n${NO_SPECTRA_FILE}.`)
  })
})
