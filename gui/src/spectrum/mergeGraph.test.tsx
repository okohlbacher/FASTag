// The merge graph view, and the Spectrum tab with FASTag's own tag graph
// (-resolved_out, -tag_graph_out) in place of the GUI's.

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { JSX } from 'react'
import SpectrumPanel from './SpectrumPanel'
import { MergeGraph } from './MergeGraph'
import { sequenceOf, type TagIn } from './graph'
import { parseDump } from './dump'
import { PROTON, WATER, residueMasses, seriesText, tagRowFrom } from './ladder'
import { cstarGraph } from './stepScore'
import { PAD, W } from './plotScale'
import { swapRanks, toCli } from '../testing/cliGraphTsv'
import { installMockBridge } from '../testing/mockBridge'
import type { CliRows } from './cliGraph'
import type { ResultsPage } from '../types'

const RES = residueMasses(undefined)
const R = RES.masses
const PEP = 'PEPTIDEK'
// b ions of PEPTIDEK at 1+ with their complements, and a weak peak a W above b2 (as panelAll.test.tsx).
const b: number[] = []
let m = PROTON
for (const r of PEP.slice(0, 7)) b.push((m += R[r]))
const MASS = [...PEP].reduce((a, r) => a + R[r], 0) + WATER
const yc = b.map((x) => MASS - (x - PROTON) + PROTON)
const peaks = [...b.map((x) => [x, 1000]), ...yc.map((x) => [x, 800]), [b[1] + R.W, 10]].sort((p, q) => p[0] - q[0])
const mz = peaks.map((p) => p[0])
const dump =
  JSON.stringify({
    record: 'spectrum', format: 1, native_id: 'scan=1', index: 0, ms_level: 2, rt: 1, precursor: (MASS + 2 * PROTON) / 2, charge: 2, charge_given: 2,
    tolerance: 20, tolerance_unit: 'ppm', picked: false, deisotoped: true, tagged: true, n_read: mz.length, n: mz.length, mz, int: peaks.map((p) => p[1])
  }) + '\n{"record":"end"}\n'
const parsed = parseDump(dump)
if (!parsed.ok) throw new Error(parsed.error)
const S = parsed.spectrum
const sum = (t: string): number => [...t].reduce((a, r) => a + R[r], 0)
const tagCols = ['spectrum', 'tag', 'length', 'charge', 'nterm_mass', 'cterm_mass', 'extended', 'gapped', 'evalue', 'fasta_hit']
const tag = (t: string, nterm: number, e: string): string[] => ['scan=1', t, String(t.length), '1', String(nterm), '5000', '0', '0', e, 'fwd']
// In -out (file) order, which is not the order of their E-values; the file has 7 rows of other spectra before them.
const tagRows = [tag('W', sum('PE'), '0.9'), tag('IDE', sum('PEPT'), '1e-7'), tag('EPT', sum('P'), '1e-9'), tag('PTID', sum('PE'), '1e-8')]
const FIRST_ROW = 7
const ins: TagIn[] = tagRows.map((r, i) => ({ row: tagRowFrom(tagCols, r)!, evalue: Number(r[8]), index: i }))
// Ranked as the GUI ranks it when it resolves itself (FASTag's default, cstar).
const graph = cstarGraph(ins, S, RES, false)
// The panel asks for the spectrum's tags best E-value first, as browser.rs serves them.
const byE = tagRows.map((_, i) => i).sort((a, b) => Number(tagRows[a][8]) - Number(tagRows[b][8]))
const tagsPage: ResultsPage = { columns: tagCols, totalRows: 20, matchedRows: 4, rows: byE.map((i) => tagRows[i]), rowIds: byE.map((i) => FIRST_ROW + i), ranked: true, pending: false }

const SOURCE = { input: '/d/a.mzML', params: {}, from: 'run' as const }
let rerenderTo: (spectrum: string, rowId: number) => void = () => undefined
function panel(cli: { resolved: CliRows; nodes: CliRows }, params: Record<string, unknown> = {}): { container: HTMLElement; mock: ReturnType<typeof installMockBridge>; unmount: () => void } {
  const mock = installMockBridge()
  mock.spectrumDumps['scan=1'] = dump
  // As browser.rs: only the open tags file answers resultsQuery; the run's
  // other tables are read with tableQuery.
  mock.resultsOpenOnly = true
  mock.resultsOpenCalls.push('/d/a.tags.tsv')
  mock.tables['/d/a.resolved.tsv'] = cli.resolved
  mock.tables['/d/a.taggraph.tsv'] = cli.nodes
  const query = window.fastag.resultsQuery
  window.fastag.resultsQuery = (path, ...a) => (path === '/d/a.tags.tsv' ? Promise.resolve(tagsPage) : query(path, ...a))
  const at = (spectrum: string, rowId: number): JSX.Element => (
    <SpectrumPanel
      target={{ path: '/d/a.tags.tsv', spectrum, rowId }}
      source={{ ...SOURCE, params }}
      resolved="/d/a.resolved.tsv"
      tagGraph="/d/a.taggraph.tsv"
      onTarget={vi.fn()}
      onLocate={vi.fn()}
    />
  )
  const { container, rerender, unmount } = render(at('scan=1', FIRST_ROW + 2))
  rerenderTo = (spectrum, rowId) => rerender(at(spectrum, rowId))
  return { container, mock, unmount }
}
const selected = (c: HTMLElement): string | null | undefined => c.querySelector('table[aria-label="Resolved tags of this spectrum"] tr[aria-selected=true] td')?.textContent

describe('merge graph', () => {
  it('draws a node per distinct tag and an arc per join; a node selects its resolved tag', () => {
    const choose = vi.fn()
    const { container } = render(<MergeGraph graph={graph} spectrum={S} chosen={0} onChoose={choose} />)
    expect(container.querySelectorAll('[data-node]').length).toBe(graph.placements.length)
    expect(container.querySelectorAll('[data-arc=used]').length).toBe(graph.arcs.filter((a) => a.used).length)
    expect(container.querySelectorAll('[data-arc]').length).toBe(graph.arcs.length)
    // The rank is written on the nodes of a chain, not only coloured.
    const w = screen.getByRole('button', { name: /^W, builds resolved tag 2/ })
    expect(w.textContent).toContain('#2')
    expect(w.querySelector('title')?.textContent).toMatch(/^W \(.*\) · E-value 0\.9 · 1 tag: W · builds resolved tag 2$/)
    fireEvent.click(w)
    expect(choose).toHaveBeenLastCalledWith(1)
    fireEvent.keyDown(screen.getByRole('button', { name: /^EPT, builds resolved tag 1/ }), { key: 'Enter' })
    expect(choose).toHaveBeenLastCalledWith(0)
    expect(screen.getAllByRole('button', { pressed: true }).every((n) => /resolved tag 1/.test(n.getAttribute('aria-label') ?? ''))).toBe(true)
  })

  it('is one tab stop: the arrows move between the nodes that select, the others are not focusable', () => {
    const { container } = render(<MergeGraph graph={graph} spectrum={S} chosen={1} onChoose={vi.fn()} />)
    const stops = (): string[] => [...container.querySelectorAll('[data-node][tabindex="0"]')].map((n) => n.getAttribute('data-node') ?? '')
    // The stop is the first node of the chosen resolved tag.
    expect(stops()).toEqual([String(graph.paths[1].chain[0])])
    expect(container.querySelectorAll('[data-node][tabindex="-1"]').length).toBe(graph.placements.length - 1)
    // From the stop the arrows reach every node, and the stop follows the focus.
    const node = (i: string): HTMLElement => container.querySelector(`[data-node="${i}"]`) as HTMLElement
    const seen = new Set(stops())
    for (const i of seen) {
      for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
        act(() => node(i).focus())
        fireEvent.keyDown(node(i), { key })
        const to = document.activeElement?.getAttribute('data-node')
        if (to == null) continue
        expect(stops()).toEqual([to])
        seen.add(to)
      }
    }
    expect([...seen].sort()).toEqual(graph.placements.map((_, i) => String(i)).sort())
    // A node in no resolved tag selects nothing: an image, not a tab stop.
    const { container: c2 } = render(<MergeGraph graph={{ ...graph, paths: graph.paths.slice(0, 1) }} spectrum={S} chosen={0} onChoose={vi.fn()} />)
    const none = c2.querySelector('.sp-graph-node.none') as Element
    expect(none.getAttribute('role')).toBe('img')
    expect(none.hasAttribute('tabindex')).toBe(false)
    expect(c2.querySelectorAll('[tabindex="0"]').length).toBe(1)
  })

  it("follows the plot's m/z range: bars outside are not drawn nor a tab stop, arcs run to the edge, the lanes stay", () => {
    const whole = render(<MergeGraph graph={graph} spectrum={S} chosen={0} onChoose={vi.fn()} />)
    const lanes = (c: HTMLElement): Record<string, string | null> =>
      Object.fromEntries([...c.querySelectorAll('[data-node]')].map((n) => [n.getAttribute('data-node') ?? '', n.querySelector('.sp-graph-bar')?.getAttribute('y') ?? null]))
    const all = lanes(whole.container)
    whole.unmount()
    // From below the first peak to between b2 and b3: the tags that start above it are out of view.
    const range: [number, number] = [mz[0] - 5, (b[1] + b[2]) / 2]
    const seen = graph.placements.map((p, i) => ({ i, on: S.mz[p.peaks[p.peaks.length - 1]] >= range[0] && S.mz[p.peaks[0]] <= range[1] }))
    const out = seen.filter((x) => !x.on).map((x) => String(x.i))
    expect(out.length).toBeGreaterThan(0)
    expect(seen.some((x) => x.on)).toBe(true)
    const { container } = render(<MergeGraph graph={graph} spectrum={S} range={range} chosen={0} onChoose={vi.fn()} />)
    const drawn = lanes(container)
    expect(Object.keys(drawn).sort()).toEqual(seen.filter((x) => x.on).map((x) => String(x.i)).sort())
    // A drawn bar keeps its lane.
    for (const [i, y] of Object.entries(drawn)) expect(y, i).toBe(all[i])
    // Every arc is still drawn, clipped to the plot's width (an arc to a bar out of view runs to the edge).
    expect(container.querySelectorAll('[data-arc]').length).toBe(graph.arcs.length)
    const clip = container.querySelector('clipPath rect') as Element
    expect([clip.getAttribute('x'), clip.getAttribute('width')]).toEqual([String(PAD.l), String(W - PAD.l - PAD.r)])
    expect(container.querySelector('[data-arc]')?.closest('g[clip-path]')).not.toBeNull()
    // One tab stop, in view.
    const stops = [...container.querySelectorAll('[data-node][tabindex="0"]')].map((n) => n.getAttribute('data-node'))
    expect(stops.length).toBe(1)
    expect(out).not.toContain(stops[0])
    expect(screen.getByRole('group', { name: /Merge graph/ }).getAttribute('aria-label')).toContain(`; ${out.length} outside m/z`)
  })

  it('zooms with the stick plot of the Spectrum tab', async () => {
    panel(swapRanks(toCli(graph, S, 'scan=1'), 1, 2))
    await screen.findByTestId('ladder')
    fireEvent.click(screen.getByLabelText('Merge graph'))
    await screen.findByTestId('merge-source')
    const g = screen.getByTestId('merge-graph')
    const bar = (): number => Number(g.querySelector(`[data-node="${graph.paths[0].chain[0]}"] .sp-graph-bar`)?.getAttribute('width'))
    const before = bar()
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(bar()).toBeCloseTo(before / 0.8, 6)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(bar()).toBeCloseTo(before / 0.64, 6)
    fireEvent.click(screen.getByRole('button', { name: 'Whole spectrum' }))
    expect(bar()).toBeCloseTo(before, 6)
  })

  it('the Spectrum tab resolves as FASTag did when the run wrote its tag graph, and its nodes select', async () => {
    // FASTag ranks W first, the GUI EPTIDE: the tab shows FASTag's ranking.
    expect(graph.paths.map(sequenceOf)).toEqual(['EPTIDE', 'W'])
    const { container, mock } = panel(swapRanks(toCli(graph, S, 'scan=1'), 1, 2))
    await screen.findByTestId('ladder')
    fireEvent.click(screen.getByLabelText('Merge graph'))
    expect((await screen.findByTestId('merge-source')).textContent).toBe('Resolved by FASTag (ranking cstar)')
    expect(screen.getByTestId('merge-summary').textContent).toMatch(/^4 tags \(4 distinct\) → 2 resolved/)
    // Read without an open, and not through resultsQuery (browser.rs refuses a file not open).
    expect(mock.tableQueryCalls.map((c) => c.path)).toEqual(['/d/a.resolved.tsv', '/d/a.taggraph.tsv'])
    expect(mock.resultsQueryCalls.some((c) => c.path !== '/d/a.tags.tsv')).toBe(false)
    // The GUI's cutoff and join are not FASTag's.
    expect(screen.queryByLabelText('Largest E-value of the tags used')).toBeNull()
    const g = screen.getByTestId('merge-graph')
    expect(g.querySelectorAll('[data-node]').length).toBe(4)
    expect(within(container.querySelector('table[aria-label="Resolved tags of this spectrum"]') as HTMLElement).getAllByRole('row').slice(1).map((r) => r.querySelector('td')?.textContent?.split(' ').slice(0, 2).join(' '))).toEqual(['#1 W', '#2 EPTIDE'])
    expect(selected(container)).toMatch(/^#1 W/)
    // A node's rank and tags are FASTag's rows, named by the panel's (E-value ordered) rows.
    const w = within(g).getByRole('button', { name: /^W, builds resolved tag 1/ })
    expect(w.textContent).toContain('#1')
    expect(w.querySelector('title')?.textContent).toMatch(/· 1 tag: W · builds resolved tag 1$/)
    const ept = within(g).getByRole('button', { name: /^EPT, builds resolved tag 2/ })
    expect(ept.querySelector('title')?.textContent).toMatch(/· 1 tag: EPT · builds resolved tag 2$/)
    fireEvent.click(ept)
    expect(selected(container)).toMatch(/^#2 EPTIDE/)
    // The plot draws the ladder of the tag selected.
    expect(screen.getByTestId('ladder').textContent).toMatch(/: EPTIDE N→C/)
  })

  it('a node reads as its resolved tag reads the same peaks, and says how it reads on its own', () => {
    // Complement pairing (settleSeries) or the peptide can settle a resolved tag on the other series of the pair than its placements' own call.
    const k = 0
    const p0 = graph.paths[k]
    const other = p0.series === 'b' ? 'y' : 'b'
    const settled = { ...graph, paths: graph.paths.map((p, i) => (i === k ? { ...p, series: other as typeof p.series, call: { series: other as typeof p.series, level: 'sure' as const, why: 'complement' } } : p)) }
    const at = p0.chain[0]
    const own = graph.placements[at]
    expect(own.series).toBe(p0.series)
    const { container } = render(<MergeGraph graph={settled} spectrum={S} chosen={0} onChoose={vi.fn()} />)
    const node = container.querySelector(`[data-node="${at}"]`) as Element
    const read = sequenceOf({ series: other as typeof p0.series, steps: own.steps })
    expect(read).not.toBe(sequenceOf(own))
    expect(node.getAttribute('aria-label')).toMatch(new RegExp(`^${read}, builds resolved tag 1`))
    expect(node.querySelector('title')?.textContent).toContain(`${read} (${other} 1+; on its own peaks ${seriesText(own.series, own.call)}, ${sequenceOf(own)})`)
    // A node that reads as its resolved tag says nothing more.
    const { container: c2 } = render(<MergeGraph graph={graph} spectrum={S} chosen={0} onChoose={vi.fn()} />)
    expect(c2.querySelector(`[data-node="${at}"] title`)?.textContent).not.toContain('on its own peaks')
  })

  it('an empty graph says so, not a blank box', () => {
    render(<MergeGraph graph={{ ...graph, placements: [], paths: [], arcs: [], offPeaks: [] }} spectrum={S} chosen={0} onChoose={vi.fn()} />)
    expect(screen.getByTestId('merge-graph-empty').textContent).toBe('No resolved tags for this spectrum.')
    expect(screen.getByTestId('merge-graph').querySelector('svg')).toBeNull()
  })

  it('a spectrum with tags but no rows in FASTag\'s tables is resolved in the GUI, with its cutoff, and says why', async () => {
    const empty = toCli({ ...graph, placements: [], paths: [], arcs: [], offPeaks: [] }, S, 'scan=1')
    expect(empty.resolved.rows.length + empty.nodes.rows.length).toBe(0)
    const { container } = panel(empty)
    await screen.findByTestId('ladder')
    fireEvent.click(screen.getByLabelText('Merge graph'))
    expect((await screen.findByTestId('merge-source')).textContent).toBe(
      'Resolved in the GUI (ranking cstar, threshold 3): FASTag resolved none of the 4 tags (E-value above -resolve_max_evalue 1, or not on the peaks)'
    )
    // The GUI's cutoff, which can let them in.
    const cut = screen.getByLabelText('Largest E-value of the tags used')
    expect(screen.getByTestId('merge-summary').textContent).toMatch(/^4 tags \(4 distinct\) → 2 resolved/)
    // A cutoff that keeps none: no ladder at all, not the chosen tag's.
    fireEvent.change(cut, { target: { value: '1e-12' } })
    expect(screen.getByTestId('merge-summary').textContent).toMatch(/^0 tags \(0 distinct\) → 0 resolved · 4 above the cutoff/)
    expect(screen.getByTestId('merge-graph-empty')).toBeTruthy()
    expect(screen.queryByTestId('ladder')).toBeNull()
    expect(container.querySelectorAll('.sp-step').length).toBe(0)
  })

  it('a resolved tag chosen on one spectrum is not carried to the next: the next selects its best', async () => {
    // Two spectra alike, FASTag's tables for both.
    const one = swapRanks(toCli(graph, S, 'scan=1'), 1, 2)
    const two = swapRanks(toCli(graph, S, 'scan=2'), 1, 2)
    const both = { resolved: { ...one.resolved, rows: [...one.resolved.rows, ...two.resolved.rows] }, nodes: { ...one.nodes, rows: [...one.nodes.rows, ...two.nodes.rows] } }
    const { container, mock } = panel(both)
    mock.spectrumDumps['scan=2'] = dump.replace('"native_id":"scan=1"', '"native_id":"scan=2"')
    const query = window.fastag.resultsQuery
    window.fastag.resultsQuery = (path, view, ...a) =>
      path === '/d/a.tags.tsv' && view.spectrum === 'scan=2'
        ? Promise.resolve({ ...tagsPage, rows: tagsPage.rows.map((r) => ['scan=2', ...r.slice(1)]), rowIds: tagsPage.rowIds?.map((i) => i + 4) })
        : query(path, view, ...a)
    await screen.findByTestId('ladder')
    fireEvent.click(screen.getByLabelText('Merge graph'))
    await screen.findByTestId('merge-source')
    fireEvent.click(within(screen.getByTestId('merge-graph')).getByRole('button', { name: /^EPT, builds resolved tag 2/ }))
    expect(selected(container)).toMatch(/^#2 EPTIDE/)
    // ▶: the panel shows the next spectrum (as ResultTabs does, the same panel).
    rerenderTo('scan=2', FIRST_ROW + 4 + 2)
    await screen.findByText(/scan=2/)
    await screen.findByTestId('merge-graph')
    await vi.waitFor(() => expect(selected(container)).toMatch(/^#1 W/))
    expect(within(screen.getByTestId('merge-graph')).getAllByRole('button', { pressed: true }).every((n) => /resolved tag 1\b/.test(n.getAttribute('aria-label') ?? ''))).toBe(true)
  })

  it('resolves in the GUI, and says why, when FASTag\'s tables do not fit the peaks', async () => {
    const cli = toCli(graph, S, 'scan=1')
    const pk = cli.nodes.columns.indexOf('peaks')
    cli.nodes.rows[0] = cli.nodes.rows[0].map((c, i) => (i === pk ? c.replace(/^[^;]+/, '50.000000') : c))
    panel(cli)
    await screen.findByTestId('ladder')
    fireEvent.click(screen.getByLabelText('All tags, resolved'))
    expect((await screen.findByTestId('merge-source')).textContent).toBe("Resolved in the GUI (ranking cstar, threshold 3): FASTag's tag graph does not fit the peaks (node 0: m/z 50.000000 is not a peak of the spectrum)")
    expect(screen.getByLabelText('Largest E-value of the tags used')).toBeTruthy()
    expect(screen.queryByTestId('merge-graph')).toBeNull()
  })

  it("resolves in the GUI by the run's -resolve_score and -resolve_threshold, and says which", async () => {
    const cli = toCli(graph, S, 'scan=1')
    const pk = cli.nodes.columns.indexOf('peaks')
    cli.nodes.rows[0] = cli.nodes.rows[0].map((c, i) => (i === pk ? c.replace(/^[^;]+/, '50.000000') : c))
    const source = async (params: Record<string, unknown>): Promise<string | null> => {
      const { unmount } = panel(cli, params)
      await screen.findByTestId('ladder')
      fireEvent.click(screen.getByLabelText('All tags, resolved'))
      const t = (await screen.findByTestId('merge-source')).textContent
      unmount()
      return t
    }
    const why = ": FASTag's tag graph does not fit the peaks (node 0: m/z 50.000000 is not a peak of the spectrum)"
    expect(await source({ resolve_score: 'steplogodds', resolve_threshold: 2 })).toBe(`Resolved in the GUI (ranking steplogodds, threshold 2)${why}`)
    expect(await source({ resolve_score: 'evidence', resolve_threshold: '2' })).toBe(`Resolved in the GUI (ranking evidence)${why}`)
    expect(await source({ resolve_score: 'anchor' })).toBe(`Resolved in the GUI (ranking anchor, threshold 3)${why}`)
    expect(await source({ resolve_score: 'cstar', resolve_threshold: '4.5' })).toBe(`Resolved in the GUI (ranking cstar, threshold 4.5)${why}`)
    expect(await source({ resolve_score: 'bogus' })).toBe(`Resolved in the GUI (ranking cstar, threshold 3; -resolve_score bogus is not a ranking the GUI knows, so cstar)${why}`)
  })
})
