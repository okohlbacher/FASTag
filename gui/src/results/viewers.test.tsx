// The P4c viewers as components (GUI-DESIGN S7, S8): MassGapChart,
// ReconView with its shared DataTable, GlycoTable, and the tabs that show
// them. Real CLI output (src/fixtures/cli); expected counts read off the
// files by hand (see tables.test.ts).

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useState, type JSX } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { gapPeaks as gapPeaksOf, parseReport } from '../digestReport'
import { installMockBridge } from '../testing/mockBridge'
import { click, flush } from '../testing/render'
import type { Tab } from '../app/viewStore'
import ResultTabs, { type ResultTabsProps } from './ResultTabs'
import ReconView, { LOW_PLACED, reconExtend, reconRerun } from './ReconView'
import GlycoTable from './GlycoTable'
import MassGapChart, { gapDomain, type GapBin } from './MassGapChart'
import DataTable, { sortIds, type Column } from './DataTable'
import humanMassgap from '../fixtures/cli/v112-pxd014764-delta-ext3/run.massgap.tsv?raw'
import humanDelta from '../fixtures/cli/v112-pxd014764-delta-ext3/run.delta.tsv?raw'
import humanRecon from '../fixtures/cli/v112-pxd014764-delta-ext3/run.recon.tsv?raw'
import humanGlyco from '../fixtures/cli/v112-pxd014764-delta-ext3/run.tags.glyco.tsv?raw'
import ext2Massgap from '../fixtures/cli/v112-pxd014764-recon-ext2/run.massgap.tsv?raw'
import ecoliMassgap from '../fixtures/cli/v1111-ecoli-recon-loc/run.massgap.tsv?raw'
import ecoliMzTab from '../fixtures/cli/v1111-ecoli-recon-loc/run.recon.mzTab?raw'
import ecoliRecon from '../fixtures/cli/v1111-ecoli-recon-loc/run.recon.tsv?raw'
import { parseDelta } from './tables'

const P = {
  massgap: '/r/run.massgap.tsv',
  recon: '/r/run.recon.tsv',
  delta: '/r/run.delta.tsv',
  glyco: '/r/run.tags.glyco.tsv',
  ids: '/r/run.recon.mzTab'
}
const human = () => parseReport(humanMassgap, P.massgap)

function deltaBins(): GapBin[] {
  const d = parseDelta(humanDelta, P.delta)
  return Array.from(d.delta, (gap, i) => ({ gap, key: d.keys[i], spectra: d.spectra[i], interps: d.interps[i] }))
}

describe('MassGapChart', () => {
  it('draws one thin stick per gap peak in range, the zero bin cut and labelled', () => {
    const bins = deltaBins()
    const [lo, hi] = gapDomain(bins, 'mods') // the default range
    const inRange = bins.filter((b) => b.gap >= lo && b.gap <= hi)
    const { container } = render(<MassGapChart bins={bins} window={0.02} source="run.delta.tsv" />)
    expect(container.querySelectorAll('.mg-stick').length).toBe(inRange.length)
    // The 0.0000 bin holds 139 of 475; the scale comes from the shifted bins.
    expect(container.querySelector('.mg-stick.cut')).not.toBeNull()
    expect([...container.querySelectorAll('.mg-cut')].map((t) => t.textContent)).toContain('⫽ 139')
    // Hairline grid and a legend of the two layers.
    expect(container.querySelectorAll('.mg-grid line').length).toBeGreaterThanOrEqual(3)
    const legend = screen.getByRole('list', { name: 'Legend' })
    expect(legend.textContent).toMatch(/Spectra per gap peak/)
    expect(legend.textContent).toMatch(/Unimod delta at a gap peak \(\d+\)/)
  })

  it('marks the bundled Unimod deltas, and hides them on request', async () => {
    const { container } = render(<MassGapChart bins={deltaBins()} window={0.02} source="d" />)
    const marks = container.querySelectorAll('.mg-mark')
    expect(marks.length).toBeGreaterThan(0)
    expect([...marks].map((m) => m.querySelector('title')?.textContent)).toContain('Oxidation (M) +15.9949 Da')
    await click(screen.getByRole('checkbox', { name: 'Unimod marks' }))
    expect(container.querySelectorAll('.mg-mark').length).toBe(0)
  })

  it('labels the peak the CLI explains, with its explanation', () => {
    const r = human()
    const { container } = render(<MassGapChart bins={deltaBins()} peaks={[...gapPeaksOf(r)]} window={0.02} source="d" />)
    expect([...container.querySelectorAll('.mg-label')].map((t) => t.textContent)).toContain('+10.009 Label:13C(6)15N(4)')
  })

  it('steps through the sticks with the keyboard, with a tooltip and a spoken description', async () => {
    render(<MassGapChart bins={deltaBins()} peaks={gapPeaksOf(human())} window={0.02} source="d" />)
    const plot = screen.getByRole('group', { name: /^Mass-gap chart: 475 placed spectra in 273 gap peaks/ })
    await act(async () => void fireEvent.keyDown(plot, { key: 'Home' }))
    expect(screen.getByRole('tooltip').textContent).toMatch(/spectra/)
    // Step to the 10.0090 peak: the tooltip names the CLI's explanation and the mark.
    for (let i = 0; i < 400 && !/at \+10\.009/.test(screen.getByRole('tooltip').textContent ?? ''); i++)
      await act(async () => void fireEvent.keyDown(plot, { key: 'ArrowRight' }))
    const tip = screen.getByRole('tooltip').textContent ?? ''
    expect(tip).toMatch(/10 spectra/)
    expect(tip).toMatch(/CLI peak 1: Label:13C\(6\)15N\(4\)/)
    expect(tip).toMatch(/Label:13C\(6\)15N\(4\) \(R\), 0\.7 mDa off/)
    expect(document.querySelector('.sr-only[aria-live]')?.textContent).toMatch(/^\+10\.009 Da: 10 spectra; peak 1, explained by Label:13C\(6\)15N\(4\)/)
    await act(async () => void fireEvent.keyDown(plot, { key: 'Escape' }))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('has a table view with every peak, the mark within the window and the CLI peak', async () => {
    render(<MassGapChart bins={deltaBins()} peaks={gapPeaksOf(human())} window={0.02} source="d" />)
    await click(screen.getByRole('button', { name: 'Table' }))
    const grid = screen.getByRole('grid', { name: 'Gap peaks' })
    expect(grid.getAttribute('aria-rowcount')).toBe('274')
    // Sorted by spectra, descending: the zero bin first.
    const first = within(grid).getAllByRole('row')[1]
    expect(first.textContent).toMatch(/^0\.0000139/)
    const row = within(grid).getAllByRole('row').find((r) => r.textContent?.startsWith('10.0090'))
    expect(row?.textContent).toMatch(/Label:13C\(6\)15N\(4\) \(R\)0\.71: Label:13C\(6\)15N\(4\)\? 10/)
  })

  it('the three ranges: the modification window (default), central and all', async () => {
    const bins = deltaBins()
    const { container } = render(<MassGapChart bins={bins} window={0.02} source="d" />)
    expect(screen.getByRole('button', { name: '−150 to +400 Da' }).getAttribute('aria-pressed')).toBe('true')
    await click(screen.getByRole('button', { name: 'Central 98 %' }))
    const [lo, hi] = gapDomain(bins, 'central')
    expect(container.querySelectorAll('.mg-stick').length).toBe(bins.filter((b) => b.gap >= lo && b.gap <= hi).length)
    await click(screen.getByRole('button', { name: 'All gaps' }))
    expect(container.querySelectorAll('.mg-stick').length).toBe(bins.length)
    await click(screen.getByRole('button', { name: '−150 to +400 Da' }))
    expect(container.querySelectorAll('.mg-stick').length).toBe(bins.filter((b) => b.gap >= -150 && b.gap <= 400).length)
    expect(screen.getByRole('button', { name: '−150 to +400 Da' }).getAttribute('aria-pressed')).toBe('true')
  })
})


describe('DataTable', () => {
  const rows = ['b', 'a', 'c', 'a']
  const cols: Column[] = [
    { id: 'name', label: 'Name', text: (i) => rows[i] },
    { id: 'n', label: 'N', num: true, text: (i) => String(i), key: (i) => [3, NaN, 1, 2][i] }
  ]
  it('sorts stably, numbers with NaN last in both directions', () => {
    expect(sortIds([0, 1, 2, 3], cols[0], false)).toEqual([1, 3, 0, 2])
    expect(sortIds([0, 1, 2, 3], cols[0], true)).toEqual([2, 0, 1, 3])
    expect(sortIds([0, 1, 2, 3], cols[1], false)).toEqual([2, 3, 0, 1])
    expect(sortIds([0, 1, 2, 3], cols[1], true)).toEqual([0, 3, 2, 1])
  })

  it('moves the active row with the keyboard and sorts from the header', async () => {
    const ids = Uint32Array.from({ length: 250 }, (_, i) => i)
    const many: Column[] = [{ id: 'i', label: 'Row', num: true, text: (i) => `r${i}`, key: (i) => i }]
    render(<DataTable label="Rows" columns={many} ids={ids} total={300} />)
    const grid = screen.getByRole('grid', { name: 'Rows' })
    expect(screen.getByText(/250 of 300 rows · showing 1–100/)).toBeTruthy()
    const sel = (): string | undefined => within(grid).getAllByRole('row').find((r) => r.getAttribute('aria-selected') === 'true')?.textContent ?? undefined
    expect(sel()).toBe('r0')
    await act(async () => void fireEvent.keyDown(grid, { key: 'ArrowDown' }))
    expect(sel()).toBe('r1')
    await act(async () => void fireEvent.keyDown(grid, { key: 'PageDown' }))
    expect(sel()).toBe('r21')
    await act(async () => void fireEvent.keyDown(grid, { key: 'End' }))
    expect(sel()).toBe('r249')
    // At most one page of rows in the DOM.
    expect(within(grid).getAllByRole('row').length).toBeLessThanOrEqual(101)
    expect(screen.getByText(/showing 201–250/)).toBeTruthy()
    expect(grid.getAttribute('aria-activedescendant')).toBe(within(grid).getAllByRole('row').find((r) => r.getAttribute('aria-selected') === 'true')?.id)
    await act(async () => void fireEvent.keyDown(grid, { key: 'Home' }))
    expect(sel()).toBe('r0')
    await click(screen.getByRole('button', { name: /^Row/ }))
    expect(screen.getByRole('columnheader').getAttribute('aria-sort')).toBe('ascending')
    await click(screen.getByRole('button', { name: /^Row/ }))
    expect(screen.getByRole('columnheader').getAttribute('aria-sort')).toBe('descending')
    expect(sel()).toBe('r249')
  })
})

describe('DataTable: no re-sort and no page scroll on a move (review fixes)', () => {
  it('a re-render of its caller or a move of the active row does not sort all rows again', async () => {
    const key = vi.fn((i: number) => (i * 7919) % 1000)
    const ids = Uint32Array.from({ length: 500 }, (_, i) => i)
    // Like every caller: the columns are a new array of new objects each
    // render, and the caller re-renders for its own reasons (the chart's
    // hover above its table view, a sibling table that finished loading).
    function Host(): JSX.Element {
      const [, setHover] = useState(0)
      const cols: Column[] = [{ id: 'k', label: 'Key', num: true, text: (i) => String(i), key }]
      return (
        <>
          <button type="button" onClick={() => setHover((h) => h + 1)}>
            hover
          </button>
          <DataTable label="Keys" columns={cols} ids={ids} total={500} sort={{ column: 'k', desc: false }} />
        </>
      )
    }
    render(<Host />)
    const sorted = key.mock.calls.length
    expect(sorted).toBe(500)
    const grid = screen.getByRole('grid', { name: 'Keys' })
    for (const k of ['ArrowDown', 'ArrowDown', 'PageDown', 'End', 'Home']) {
      await act(async () => void fireEvent.keyDown(grid, { key: k }))
      await click(screen.getByRole('button', { name: 'hover' }))
    }
    expect(key.mock.calls.length).toBe(sorted)
    // A new sort does sort.
    await click(screen.getByRole('button', { name: /^Key/ }))
    expect(key.mock.calls.length).toBe(2 * sorted)
  })

  it('scrolls only its own box, and only when the keyboard moved the row: not on mount or a filter change', async () => {
    const mock = installMockBridge()
    mock.reportFiles = { [P.recon]: humanRecon, [P.delta]: humanDelta }
    const scroll = vi.fn()
    const proto = Element.prototype as { scrollIntoView?: unknown }
    proto.scrollIntoView = scroll
    // jsdom lays nothing out: a 100 px box under a 20 px header, rows of 20 px
    // placed by their aria-rowindex.
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const box = (top: number, h: number): DOMRect => ({ top, bottom: top + h, height: h, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) })
      if (this.classList.contains('dt-wrap')) return box(0, 100)
      if (this.tagName === 'THEAD') return box(0, 20)
      const idx = Number(this.getAttribute('aria-rowindex'))
      if (this.tagName === 'TR' && idx) return box((idx - 1) * 20 - (this.closest('.dt-wrap')?.scrollTop ?? 0), 20)
      return box(0, 0)
    })
    try {
      render(<ReconView massgap={human()} tables={{ recon: P.recon, delta: P.delta }} onOpen={vi.fn()} />)
      await flush()
      const grid = screen.getByRole('grid', { name: 'Placements' })
      const wrap = grid.closest('.dt-wrap') as HTMLElement
      expect(scroll).not.toHaveBeenCalled()
      expect(wrap.scrollTop).toBe(0)
      await act(async () => void fireEvent.change(screen.getByRole('searchbox', { name: 'Contains' }), { target: { value: 'HUMAN' } }))
      await click(screen.getByRole('checkbox', { name: /One flank off/ }))
      expect(wrap.scrollTop).toBe(0)
      // Rows 1-4 fit under the header; row 5 needs 20 px more.
      for (let k = 0; k < 4; k++) await act(async () => void fireEvent.keyDown(grid, { key: 'ArrowDown' }))
      expect(wrap.scrollTop).toBe(20)
      await act(async () => void fireEvent.keyDown(grid, { key: 'Home' }))
      expect(wrap.scrollTop).toBe(0)
      expect(scroll).not.toHaveBeenCalled()
    } finally {
      rect.mockRestore()
      delete proto.scrollIntoView
    }
  })
})

describe('ReconView', () => {
  it('shows the human run: placed spectra, placements, the chart and the placement table', async () => {
    const mock = installMockBridge()
    mock.reportFiles = { [P.recon]: humanRecon, [P.delta]: humanDelta }
    render(<ReconView massgap={human()} tables={{ recon: P.recon, delta: P.delta }} onOpen={vi.fn()} />)
    await flush()
    const stat = (l: string): string | null | undefined => screen.getByText(l, { selector: 'dt' }).nextElementSibling?.textContent
    expect(stat('Placed spectra')).toBe('475')
    expect(stat('Placements')).toBe('4,706')
    expect(stat('Spectra with a placement')).toBe('482')
    expect(stat('Gap peaks')).toBe('273')
    expect(screen.queryByRole('status')).toBeNull() // 475 >= LOW_PLACED: no warning
    expect(screen.getByRole('group', { name: /^Mass-gap chart/ })).toBeTruthy()
    const grid = screen.getByRole('grid', { name: 'Placements' })
    expect(grid.getAttribute('aria-rowcount')).toBe('4707')
    await click(screen.getByRole('checkbox', { name: /One flank off/ }))
    expect(screen.getByText(/^3,905 of 4,706 rows/)).toBeTruthy()
    await act(async () => void fireEvent.change(screen.getByRole('combobox', { name: 'Interpretation' }), { target: { value: 'sub:' } }))
    // awk: one flank off and a sub: interpretation, 22 rows; 3 of them in UBB_HUMAN.
    expect(screen.getByText(/^22 of 4,706 rows/)).toBeTruthy()
    const subs = within(screen.getByRole('grid', { name: 'Placements' })).getAllByRole('row').slice(1)
    for (const r of subs) expect(r.textContent).toMatch(/sub:/)
    await act(async () => void fireEvent.change(screen.getByRole('searchbox', { name: 'Contains' }), { target: { value: 'UBB_HUMAN' } }))
    expect(screen.getByText(/^3 of 4,706 rows/)).toBeTruthy()
    // The shared table: the gap peaks.
    await click(screen.getByRole('button', { name: 'Gap peaks' }))
    expect(screen.getByRole('grid', { name: 'Gap peaks' }).getAttribute('aria-rowcount')).toBe('274')
  })

  it('warns when too few spectra are placed: 0 (ext2) and 8 (E. coli)', async () => {
    installMockBridge()
    const { unmount } = render(<ReconView massgap={parseReport(ext2Massgap, '/r/e2.massgap.tsv')} tables={{}} onOpen={vi.fn()} />)
    expect(screen.getByRole('status').textContent).toMatch(/No spectrum is placed with a mass gap\..*too few for any conclusion/)
    unmount()
    render(<ReconView massgap={parseReport(ecoliMassgap, '/r/e.massgap.tsv')} tables={{}} onOpen={vi.fn()} />)
    expect(screen.getByRole('status').textContent).toMatch(new RegExp(`Only 8 spectra are placed.*asks for ${LOW_PLACED}`))
  })

  it('shows the -recon_localize columns and the mzTab identifications of the E. coli run', async () => {
    const mock = installMockBridge()
    mock.reportFiles = { [P.recon]: ecoliRecon, [P.ids]: ecoliMzTab }
    render(<ReconView massgap={parseReport(ecoliMassgap, P.massgap)} tables={{ recon: P.recon, reconIds: P.ids }} onOpen={vi.fn()} />)
    await flush()
    const grid = screen.getByRole('grid', { name: 'Placements' })
    expect(within(grid).getByRole('button', { name: /^Site score/ })).toBeTruthy()
    expect(within(grid).getAllByRole('row')[2].textContent).toMatch(/−1660\.9183.*9-29\?R69267/)
    await click(screen.getByRole('button', { name: 'Identifications (mzTab)' }))
    const ids = screen.getByRole('grid', { name: 'Identifications' })
    expect(ids.getAttribute('aria-rowcount')).toBe('195')
    expect(screen.getByText(/NOT FDR-controlled/)).toBeTruthy()
  })

  it('names a table it cannot read, and keeps the rest', async () => {
    const mock = installMockBridge()
    mock.reportFiles = { [P.recon]: '<?xml version="1.0"?><IdXML/>', [P.delta]: humanDelta }
    render(<ReconView massgap={null} tables={{ recon: P.recon, delta: P.delta }} onOpen={vi.fn()} />)
    await flush()
    expect(screen.getByRole('alert').textContent).toMatch(/Cannot read \/r\/run\.recon\.tsv: .*idXML/)
    expect(screen.getByRole('grid', { name: 'Gap peaks' })).toBeTruthy()
  })

  it('empty: offers the FASTA and the run, and opening a report', async () => {
    installMockBridge()
    const run = vi.fn()
    const onOpen = vi.fn()
    const { rerender } = render(<ReconView massgap={null} tables={{}} action={{ label: 'Choose a FASTA and run again', run, disabled: false }} onOpen={onOpen} />)
    expect(screen.getByRole('heading', { name: 'No mass gaps yet' })).toBeTruthy()
    expect(screen.getByText(/choose a FASTA and write these reports/)).toBeTruthy()
    await click(screen.getByRole('button', { name: 'Choose a FASTA and run again' }))
    expect(run).toHaveBeenCalledTimes(1)
    await click(screen.getByRole('button', { name: 'Open a recon, delta or mass-gap report…' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    rerender(<ReconView massgap={null} tables={{}} action={{ label: 'Choose a FASTA and run again', run, disabled: true }} onOpen={onOpen} />)
    expect(screen.getByRole('button', { name: 'Choose a FASTA and run again' }).hasAttribute('disabled')).toBe(true)
  })

  it('reconRerun: a FASTA and extension 3 without one, the reports with one', () => {
    expect(reconRerun({ extension: '2' })).toEqual({
      kind: 'add-fasta',
      label: 'Choose a FASTA and run again',
      values: { delta_out: 'delta.tsv', extension: '3' }
    })
    expect(reconRerun({ extension: '4' })).toEqual({ kind: 'add-fasta', label: 'Choose a FASTA and run again', values: { delta_out: 'delta.tsv' } })
    // With a FASTA and extension 3 or more: the reports only.
    expect(reconRerun({ fasta: '/db/h.fasta', extension: '3' })).toEqual({
      kind: 'enable',
      label: 'Write these reports and run again',
      values: { recon_out: 'recon.tsv', delta_out: 'delta.tsv', massgap_out: 'massgap.tsv' }
    })
    // Review fix: with a FASTA and a shorter extension (2, or the CLI's
    // default 0) the run would place nothing again (ext2): extension 3 too.
    for (const params of [{ fasta: '/db/h.fasta', extension: '2' }, { recon_fasta: '/db/h.fasta' }])
      expect(reconRerun(params)).toEqual({
        kind: 'enable',
        label: 'Write these reports and run again',
        values: { recon_out: 'recon.tsv', delta_out: 'delta.tsv', massgap_out: 'massgap.tsv', extension: '3' }
      })
  })

  it('reconExtend: extension 3 for a FASTA run with a shorter one, else nothing', () => {
    expect(reconExtend({ fasta: '/db/h.fasta', extension: '2' })).toEqual({ kind: 'enable', label: 'Run again with extension 3', values: { extension: '3' } })
    expect(reconExtend({ recon_fasta: '/db/h.fasta' })).toEqual({ kind: 'enable', label: 'Run again with extension 3', values: { extension: '3' } })
    expect(reconExtend({ fasta: '/db/h.fasta', extension: '3' })).toBeNull()
    expect(reconExtend({ extension: '2' })).toBeNull()
  })

  // Review fix: the 0-placed case (ext2) has a way forward in the banner.
  it('the low-placed banner offers the run with extension 3', async () => {
    installMockBridge()
    const run = vi.fn()
    const { rerender } = render(
      <ReconView massgap={parseReport(ext2Massgap, '/r/e2.massgap.tsv')} tables={{}} extend={{ label: 'Run again with extension 3', run, disabled: false }} onOpen={vi.fn()} />
    )
    const banner = screen.getByRole('status')
    expect(banner.textContent).toMatch(/No spectrum is placed/)
    await click(within(banner).getByRole('button', { name: 'Run again with extension 3' }))
    expect(run).toHaveBeenCalledTimes(1)
    // Not offered: no button.
    rerender(<ReconView massgap={parseReport(ext2Massgap, '/r/e2.massgap.tsv')} tables={{}} extend={null} onOpen={vi.fn()} />)
    expect(within(screen.getByRole('status')).queryByRole('button')).toBeNull()
  })

  // Review fix: a delta.tsv alone carries no window; the CLI's depends on the
  // run (0.02 Da on ppm, 0.5 Da on a Da tolerance, as the E. coli run).
  it('a delta.tsv opened alone takes the window of its sibling mass-gap report', async () => {
    const mock = installMockBridge()
    const ecoliDelta = '/e/run.delta.tsv'
    mock.reportFiles = { [ecoliDelta]: 'delta\tspectra\ttop_interps\n15.8000\t30\t?:30\n', '/e/run.massgap.tsv': ecoliMassgap }
    render(<ReconView massgap={null} tables={{ delta: ecoliDelta }} onOpen={vi.fn()} />)
    await flush()
    expect(mock.reportCalls).toContain('/e/run.massgap.tsv')
    expect(document.querySelector('figcaption')?.textContent).not.toMatch(/assumed/)
    await click(screen.getAllByRole('button', { name: 'Table' })[0])
    const grid = screen.getAllByRole('grid', { name: 'Gap peaks' })[0]
    // 15.80 is 0.19 Da off Oxidation: within the run's 0.5 Da, not 0.02.
    expect(within(grid).getAllByRole('row')[1].textContent).toMatch(/^15\.800030Oxidation \(M\)/)
  })

  it('a delta.tsv with no mass-gap report beside it: the window is assumed 0.5 Da, and said so', async () => {
    const mock = installMockBridge()
    const real = '/e/run.delta.tsv'
    mock.reportFiles = { [real]: 'delta\tspectra\ttop_interps\n15.8000\t30\t?:30\n' }
    render(<ReconView massgap={null} tables={{ delta: real }} onOpen={vi.fn()} />)
    await flush()
    expect(document.querySelector('figcaption')?.textContent).toMatch(/window assumed 0\.5 Da \(no mass-gap report\)/)
    const plot = screen.getByRole('group', { name: /^Mass-gap chart/ })
    await act(async () => void fireEvent.keyDown(plot, { key: 'Home' }))
    const tip = screen.getByRole('tooltip').textContent ?? ''
    expect(tip).toMatch(/Oxidation \(M\), 194\.9 mDa off/)
    expect(tip).toMatch(/window assumed 0\.5 Da/)
  })
})

describe('GlycoTable', () => {
  it('shows 44 of 3,016 flagged, the flagged rows by fraction, and every row on request', async () => {
    const mock = installMockBridge()
    mock.reportFiles = { [P.glyco]: humanGlyco }
    render(<GlycoTable path={P.glyco} />)
    await flush()
    expect(screen.getByText('Flagged spectra', { selector: 'dt' }).nextElementSibling?.textContent).toMatch(/^44 of 3,016 processed MS2 spectra/)
    const grid = screen.getByRole('grid', { name: 'Glyco spectra' })
    expect(grid.getAttribute('aria-rowcount')).toBe('45')
    // Sorted by the oxonium fraction, highest first.
    const fr = within(grid).getAllByRole('row').slice(1).map((r) => Number(r.children[2].textContent))
    expect(fr).toEqual([...fr].sort((a, b) => b - a))
    await click(screen.getByRole('checkbox', { name: 'Flagged only' }))
    expect(screen.getByRole('grid', { name: 'Glyco spectra' }).getAttribute('aria-rowcount')).toBe('3017')
    await act(async () => void fireEvent.change(screen.getByRole('combobox', { name: 'With ion' }), { target: { value: 'HexNAc' } }))
    for (const r of within(screen.getByRole('grid', { name: 'Glyco spectra' })).getAllByRole('row').slice(1)) expect(r.children[4].textContent).toMatch(/HexNAc/)
  })

  it('names a missing file', async () => {
    installMockBridge()
    render(<GlycoTable path="/r/none.glyco.tsv" />)
    await flush()
    expect(screen.getByText(/The run named \/r\/none\.glyco\.tsv, but the file does not exist/)).toBeTruthy()
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

describe('result tabs: the P4c viewers', () => {
  it('offers Mass gaps & recon with a mass-gap report and Glyco with a glyco table, last in the arrow order', async () => {
    const mock = installMockBridge()
    mock.reportFiles = { [P.glyco]: humanGlyco }
    render(<Harness reports={{ list: [human()], errors: [], tables: { glyco: P.glyco } }} />)
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Tags', 'Species', 'Digest1', 'Mass gaps & recon', 'Glyco'])
    await act(async () => void fireEvent.keyDown(screen.getByRole('tablist'), { key: 'End' }))
    await flush()
    expect(screen.getByRole('tab', { name: 'Glyco' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('heading', { name: 'Glyco: oxonium ions per spectrum' })).toBeTruthy()
    await act(async () => void fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' }))
    expect(screen.getByRole('heading', { name: 'Mass gaps and reconciliation' })).toBeTruthy()
  })

  it('no viewer tab without a run, a report or a table', () => {
    installMockBridge()
    render(<Harness />)
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Tags', 'Species', 'Digest'])
  })

  it('a recon tab whose content went away shows the Tags', () => {
    installMockBridge()
    render(<Harness tab="recon" />)
    expect(screen.getByRole('tab', { name: 'Tags' }).getAttribute('aria-selected')).toBe('true')
  })
})
