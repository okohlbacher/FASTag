// The overview at the top of Results > Triage (TriagePanel.tsx): tiles,
// the three charts, their Bins views and tooltips, the notes of a single
// tag length and of the approximate coverage, and independence from the
// table's filter.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import ReportTable from './ReportTable'
import { resetTriageOverview } from './TriagePanel'
import { installMockBridge } from '../testing/mockBridge'
import censusTsv from '../fixtures/cli-1.15/ecoli_ms2_small_0.3da.census_sorted.tsv?raw'
import panelSrc from './TriagePanel.tsx?raw'
import statsSrc from './triageOverview.ts?raw'
import cssSrc from './triageOverview.css?raw'

const PATH = '/d/run01.census_sorted.tsv'
const COLS = ['ident_rank', 'spectrum', 'status', 'precursor_mz', 'charge_given', 'charge_used', 'n_peaks', 'n_peaks_kept', 'n_found', 'n_reported', 'best_evalue', 'best_len', 'tag_cover', 'ident_score']

/// A census of @p n rows, row i made by @p f.
function census(n: number, f: (i: number) => Record<string, string | number>, extra: string[] = []): string {
  const cols = [...COLS, ...extra]
  const rows = Array.from({ length: n }, (_, i) => {
    const r: Record<string, string | number> = {
      ident_rank: i + 1,
      spectrum: `scan=${i + 1}`,
      status: 'tagged',
      precursor_mz: 500 + i,
      charge_given: 2,
      charge_used: 2,
      n_peaks: 200,
      n_peaks_kept: 40 + (i % 60),
      n_found: 50,
      n_reported: 50,
      best_evalue: 0.001,
      best_len: 3,
      tag_cover: 400,
      ident_score: 1 - i / n,
      ...f(i)
    }
    return cols.map((c) => String(r[c] ?? '')).join('\t')
  })
  return [cols.join('\t'), ...rows].join('\n') + '\n'
}

const tile = (name: string): HTMLElement => screen.getByRole('region', { name })
const value = (name: string): string => tile(name).querySelector('.tri-tile-value')!.textContent ?? ''

beforeEach(() => resetTriageOverview())

describe('Triage overview', () => {
  it('reads the real census: tiles, three charts, the overview above the table, no IDs', async () => {
    const mock = installMockBridge()
    mock.reportFiles[PATH] = censusTsv
    render(<ReportTable kind="triage" path={PATH} params={{ max_tags: 50 }} />)
    const ov = await screen.findByRole('region', { name: 'Identifiability overview' })
    expect(value('MS2 spectra')).toBe('139')
    expect(value('Processed')).toBe('139')
    // 26 of 139 processed spectra are tagged with best_evalue <= 0.01.
    expect(value('Strong tag (E ≤ 0.01)')).toBe('18.71%')
    expect(within(tile('Strong tag (E ≤ 0.01)')).getByText('26 of 139 processed spectra.')).toBeDefined()
    expect(value('Tagged')).toBe('98.56%')
    expect(tile('Tagged').textContent).toMatch(/not a quality call/)
    expect(value('Identified')).toBe('—')
    expect(tile('Identified').textContent).toMatch(/Give the identifications of this run in Setup/)
    expect(ov.querySelectorAll('figure.tri-chart')).toHaveLength(3)
    // Above the ranked table.
    const table = screen.getByRole('grid', { name: 'Spectra ranked by identifiability' })
    expect(ov.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Several tag lengths (3 to 9): no single-length note; the coverage is approximate.
    expect(ov.textContent).not.toMatch(/All tags have length/)
    expect(ov.textContent).toMatch(/Approximate: this table has no res_cover column/)
    // The cap from the run's -max_tags.
    expect(screen.getByText('Cap (-max_tags) 50')).toBeDefined()
  })

  it('the Bins view lists every bin of the chart', async () => {
    const mock = installMockBridge()
    mock.reportFiles[PATH] = census(100, (i) => ({ n_peaks_kept: i * 2 }))
    render(<ReportTable kind="triage" path={PATH} params={{}} />)
    await screen.findByRole('region', { name: 'Identifiability overview' })
    fireEvent.click(within(screen.getByRole('group', { name: 'Peaks chart view' })).getByRole('button', { name: 'Bins' }))
    // n_peaks_kept 0..198 in bins of 20: 10 bins.
    const grid = await screen.findByRole('grid', { name: 'Peaks chart bins' })
    expect(grid.querySelectorAll('tbody tr')).toHaveLength(10)
    expect(grid.textContent).toContain('180–199')
  })

  it('a tooltip on the keyboard, and the live summary sentence', async () => {
    const mock = installMockBridge()
    mock.reportFiles[PATH] = census(30, () => ({}))
    render(<ReportTable kind="triage" path={PATH} params={{}} />)
    await screen.findByRole('region', { name: 'Identifiability overview' })
    const plot = screen.getByRole('group', { name: /^Peaks chart:/ })
    expect(screen.queryByRole('tooltip')).toBeNull()
    plot.focus()
    fireEvent.keyDown(plot, { key: 'ArrowRight' })
    const tip = await screen.findByRole('tooltip')
    expect(tip.textContent).toMatch(/^40–59 peaks kept/)
    expect(tip.textContent).toMatch(/tags reported: median 50/)
    expect(tip.textContent).toMatch(/at the cap \(50\): 100%/)
    expect(plot.nextElementSibling?.textContent).toMatch(/^40–59 peaks kept; 20 spectra/)
  })

  it('one tag length: a marker and the note, seeded at -tag_length without -extension', async () => {
    const mock = installMockBridge()
    mock.reportFiles[PATH] = census(40, () => ({}))
    render(<ReportTable kind="triage" path={PATH} params={{ tag_length: 3, extension: 0 }} />)
    await screen.findByRole('region', { name: 'Identifiability overview' })
    expect(document.querySelector('.tri-note')?.textContent).toMatch(/^All tags have length 3 \(seeded at -tag_length 3, no -extension\), so tag length says nothing here\. Run with -extension or several -tag_length values to see it\.$/)
    expect(document.querySelector('.tri-marker')?.textContent).toBe('all 40 tags: 3')
    expect(screen.getByText(/With one tag length the best tag line is just 3 \/ length/)).toBeDefined()
  })

  it('with -census_ids: the identified tile and series; the overview ignores the table filter', async () => {
    const mock = installMockBridge()
    // 10 rows: 4 identified, 4 not, 2 unknown; 3 triage candidates.
    mock.reportFiles[PATH] = census(
      10,
      (i) => ({ identified: i < 4 ? 1 : i < 8 ? 0 : '', triage: i >= 4 && i < 7 ? 1 : 0, best_len: 3 + (i % 3) }),
      ['identified', 'triage']
    )
    render(<ReportTable kind="triage" path={PATH} params={{}} />)
    await screen.findByRole('region', { name: 'Identifiability overview' })
    expect(value('Identified')).toBe('50%')
    expect(tile('Identified').textContent).toMatch(/4 of 8 with a known state; 2 unknown; 3 triage candidates\./)
    expect(screen.getByText(/Best tag length of identified spectra \(4\)/)).toBeDefined()
    const before = document.querySelector('.tri-overview')!.textContent
    fireEvent.click(screen.getByRole('radio', { name: /^Identified/ }))
    await waitFor(() => expect(screen.getByRole('grid', { name: 'Spectra ranked by identifiability' }).querySelectorAll('tbody tr')).toHaveLength(4))
    expect(document.querySelector('.tri-overview')!.textContent).toBe(before)
    expect(value('MS2 spectra')).toBe('10')
  })

  it('census 2: max_len and res_cover; the summary gives the cap', async () => {
    const mock = installMockBridge()
    mock.reportFiles[PATH] = census(20, (i) => ({ max_len: 5 + (i % 4), res_cover: 7 }), ['max_len', 'res_cover'])
    mock.reportFiles['/d/run01.census_summary.tsv'] = 'section\tkey\tvalue\tn\tdescription\nrun\tmax_tags\t30\t-\tx\ncensus\tsubsampled\t1\t-\tx\n'
    render(<ReportTable kind="triage" path={PATH} params={{ max_tags: 50 }} summaryPath="/d/run01.census_summary.tsv" />)
    await screen.findByRole('region', { name: 'Identifiability overview' })
    expect(await screen.findByText('Cap (-max_tags) 30')).toBeDefined()
    expect(screen.getByText(/From all 20 sampled spectra/)).toBeDefined()
    const ov = screen.getByRole('region', { name: 'Identifiability overview' })
    // Format 2 placed every tag as a y read: its res_cover is flagged, nothing else is.
    expect(ov.textContent).toMatch(/Approximate: this census \(format 2\) placed every tag as a y read/)
    expect(ov.textContent).not.toMatch(/no res_cover column|orientation unresolved/)
    expect(ov.textContent).toMatch(/Longest tag: median, middle half/)
    expect(ov.textContent).toMatch(/All tags, residues covered: median, middle half/)
  })

  it('census 3: res_cover_exact 1 is exact; 0 is labelled folded, lower bound', async () => {
    const mock = installMockBridge()
    mock.reportFiles[PATH] = census(20, () => ({ max_len: 5, res_cover: 7, res_cover_exact: 1 }), ['max_len', 'res_cover', 'res_cover_exact'])
    const { unmount } = render(<ReportTable kind="triage" path={PATH} params={{ max_tags: 50 }} />)
    let ov = await screen.findByRole('region', { name: 'Identifiability overview' })
    expect(ov.textContent).not.toMatch(/Approximate/)
    expect(ov.textContent).not.toMatch(/orientation unresolved/)
    unmount()
    resetTriageOverview()
    mock.reportFiles[PATH] = census(20, (i) => ({ max_len: 5, res_cover: 7, res_cover_exact: i < 15 ? 0 : 1 }), ['max_len', 'res_cover', 'res_cover_exact'])
    render(<ReportTable kind="triage" path={PATH} params={{ max_tags: 50 }} />)
    ov = await screen.findByRole('region', { name: 'Identifiability overview' })
    expect(ov.textContent).toMatch(/Approximate: orientation unresolved \(folded, lower bound\) for 15 of 20 tagged spectra/)
    expect(ov.textContent).toMatch(/\(res_cover\) \/ estimated length; approximate: orientation unresolved \(folded, lower bound\)\./)
  })

  it('collapses, and stays collapsed when the tab is shown again', async () => {
    const mock = installMockBridge()
    mock.reportFiles[PATH] = census(5, () => ({}))
    const { unmount } = render(<ReportTable kind="triage" path={PATH} />)
    await screen.findByRole('region', { name: 'Identifiability overview' })
    const det = document.querySelector('details.tri-overview') as HTMLDetailsElement
    expect(det.open).toBe(true)
    det.open = false
    fireEvent(det, new Event('toggle'))
    unmount()
    render(<ReportTable kind="triage" path={PATH} />)
    await waitFor(() => expect(document.querySelector('details.tri-overview')).not.toBeNull())
    expect((document.querySelector('details.tri-overview') as HTMLDetailsElement).open).toBe(false)
  })

  it('no processed spectrum: a hint, no charts', async () => {
    const mock = installMockBridge()
    mock.reportFiles[PATH] = census(3, () => ({ status: 'empty' }))
    render(<ReportTable kind="triage" path={PATH} />)
    await screen.findByRole('region', { name: 'Identifiability overview' })
    expect(screen.getByText(/No spectrum was processed/)).toBeDefined()
    expect(document.querySelectorAll('figure.tri-chart')).toHaveLength(0)
  })

  it('takes every colour from a token', () => {
    for (const src of [panelSrc, statsSrc, cssSrc]) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      expect(code.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g) ?? []).toEqual([])
    }
  })
})
