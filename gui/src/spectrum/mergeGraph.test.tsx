// The merge graph view, and the Spectrum tab with FASTag's own tag graph
// (-resolved_out, -tag_graph_out) in place of the GUI's.

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SpectrumPanel from './SpectrumPanel'
import { MergeGraph } from './MergeGraph'
import { buildGraph, sequenceOf, type TagIn } from './graph'
import { parseDump } from './dump'
import { PROTON, WATER, residueMasses, tagRowFrom } from './ladder'
import { stepWeight } from './stepScore'
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
const graph = buildGraph(ins, S, RES, { join: false, weight: stepWeight(S) })
// The panel asks for the spectrum's tags best E-value first, as browser.rs serves them.
const byE = tagRows.map((_, i) => i).sort((a, b) => Number(tagRows[a][8]) - Number(tagRows[b][8]))
const tagsPage: ResultsPage = { columns: tagCols, totalRows: 20, matchedRows: 4, rows: byE.map((i) => tagRows[i]), rowIds: byE.map((i) => FIRST_ROW + i), ranked: true, pending: false }

function panel(cli: { resolved: CliRows; nodes: CliRows }): { container: HTMLElement; mock: ReturnType<typeof installMockBridge> } {
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
  const { container } = render(
    <SpectrumPanel
      target={{ path: '/d/a.tags.tsv', spectrum: 'scan=1', rowId: FIRST_ROW + 2 }}
      source={{ input: '/d/a.mzML', params: {}, from: 'run' }}
      resolved="/d/a.resolved.tsv"
      tagGraph="/d/a.taggraph.tsv"
      onTarget={vi.fn()}
      onLocate={vi.fn()}
    />
  )
  return { container, mock }
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
    expect((await screen.findByTestId('merge-source')).textContent).toBe('Resolved by FASTag (ranking steplogodds)')
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

  it('resolves in the GUI, and says why, when FASTag\'s tables do not fit the peaks', async () => {
    const cli = toCli(graph, S, 'scan=1')
    const pk = cli.nodes.columns.indexOf('peaks')
    cli.nodes.rows[0] = cli.nodes.rows[0].map((c, i) => (i === pk ? c.replace(/^[^;]+/, '50.000000') : c))
    panel(cli)
    await screen.findByTestId('ladder')
    fireEvent.click(screen.getByLabelText('All tags, resolved'))
    expect((await screen.findByTestId('merge-source')).textContent).toBe("Resolved in the GUI: FASTag's tag graph does not fit the peaks (node 0: m/z 50.000000 is not a peak of the spectrum)")
    expect(screen.getByLabelText('Largest E-value of the tags used')).toBeTruthy()
    expect(screen.queryByTestId('merge-graph')).toBeNull()
  })
})
