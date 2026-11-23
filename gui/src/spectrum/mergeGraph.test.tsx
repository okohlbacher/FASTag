// The merge graph view, and the Spectrum tab with FASTag's own tag graph
// (-resolved_out, -tag_graph_out) in place of the GUI's.

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { JSX } from 'react'
import SpectrumPanel, { StickPlot } from './SpectrumPanel'
import { MergeGraph } from './MergeGraph'
import { buildGraph, sequenceOf, type TagIn } from './graph'
import type { SpectrumPeaks } from './dump'
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
function panel(cli: { resolved: CliRows; nodes: CliRows }, params: Record<string, unknown> | null = {}): { container: HTMLElement; mock: ReturnType<typeof installMockBridge>; unmount: () => void } {
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

// The layout around an anchor, on a spectrum of known b and y ions (as graph.test.ts).
const RL = residueMasses([])
const RM = RL.masses
const sumL = (t: string): number => [...t].reduce((a, r) => a + RM[r], 0)
const NF = 100
const CF = 200
const SEQ = 'PEPTIDE'
const ML = NF + sumL(SEQ) + CF + WATER
const ionsL = (start: number, seq: string): number[] => {
  const out = [start + PROTON]
  for (const r of seq) out.push(out[out.length - 1] + RM[r])
  return out
}
const bL = ionsL(NF, SEQ)
const yL = ionsL(CF + WATER, [...SEQ].reverse().join(''))
const specL = (xs: number[]): SpectrumPeaks => {
  const u = [...new Set(xs.map((x) => Math.round(x * 1e6) / 1e6))].sort((p, q) => p - q)
  return { nativeId: 'scan=1', index: 0, msLevel: 2, rt: null, precursor: (ML + 2 * PROTON) / 2, charge: 2, chargeGiven: 2, tolerance: 10, toleranceUnit: 'ppm', picked: false, deisotoped: true, tagged: true, nRead: u.length, mz: u, int: u.map(() => 100) }
}
const colsL = ['spectrum', 'tag', 'charge', 'nterm_mass', 'cterm_mass', 'gapped', 'evalue']
const atL = (index: number, nterm: number, text: string, evalue: number, cterm = 5000): TagIn => ({ row: tagRowFrom(colsL, ['scan=1', text, '1', String(nterm), String(cterm), '0', String(evalue)])!, evalue, index })
const tagL = (index: number, from: number, len: number, evalue: number, text = SEQ.slice(from, from + len)): TagIn => atL(index, NF + sumL(SEQ.slice(0, from)), text, evalue, CF + sumL(SEQ.slice(from + len)))
const barX = (c: Element, sel: string): number => Number(c.querySelector(`${sel} .sp-graph-bar`)?.getAttribute('x'))
const barY = (c: Element, sel: string): number => Number(c.querySelector(`${sel} .sp-graph-bar`)?.getAttribute('y'))

describe('merge graph', () => {
  it('lays the anchor out N to C by residue: a y tag runs against m/z, its tags a staircase under the ruler, the joins bold', () => {
    const s = specL(yL)
    const g = buildGraph([tagL(0, 0, 3, 0.01), tagL(1, 2, 3, 0.02)], s, RL)
    expect(g.paths.map((p) => [p.series, sequenceOf(p)])).toEqual([['y', 'PEPTI']])
    const { container } = render(<MergeGraph graph={g} spectrum={s} chosen={0} onChoose={vi.fn()} />)
    const ruler = screen.getByTestId('merge-graph-ruler')
    expect(ruler.getAttribute('data-sequence')).toBe('PEPTI')
    // The ruler's residues left to right are the sequence N to C.
    expect([...ruler.querySelectorAll('[data-res]')].sort((a, b) => Number(a.getAttribute('x')) - Number(b.getAttribute('x'))).map((t) => t.textContent).join('')).toBe('PEPTI')
    const [pep, pti] = [0, 1].map((r) => g.placements.findIndex((pl) => pl.rows.includes(r)))
    // PTI lies on the lower m/z (y ions grow from the C terminus) and is drawn right of PEP.
    expect(s.mz[g.placements[pti].peaks[0]]).toBeLessThan(s.mz[g.placements[pep].peaks[0]])
    expect(barX(container, `[data-node="${pti}"]`)).toBeGreaterThan(barX(container, `[data-node="${pep}"]`))
    // Each bar spans its residues: PEP three of five, starting at the ruler's start.
    const cells = [...ruler.querySelectorAll('[data-res]')].map((t) => Number(t.getAttribute('x'))).sort((a, b) => a - b)
    const unit = cells[1] - cells[0]
    const w = (i: number): number => Number(container.querySelector(`[data-node="${i}"] .sp-graph-bar`)?.getAttribute('width'))
    expect(w(pep)).toBeCloseTo(3 * unit, 6)
    expect(barX(container, `[data-node="${pti}"]`) - barX(container, `[data-node="${pep}"]`)).toBeCloseTo(2 * unit, 6)
    // Overlapping, so one under the other, both under the ruler; one bold join.
    expect(barY(container, `[data-node="${pti}"]`)).toBeGreaterThan(barY(container, `[data-node="${pep}"]`))
    expect(container.querySelectorAll('[data-arc=used]').length).toBe(1)
    expect(container.querySelector('[data-arc=used]')?.getAttribute('class')).toContain('on')
  })

  it('does not draw a resolved tag again that reads the anchor on its complement peaks: a b+y badge says so', () => {
    const s = specL([...bL, ...yL])
    const g = buildGraph([tagL(0, 1, 3, 0.01)], s, RL)
    expect(g.paths.map((p) => p.series).sort()).toEqual(['b', 'y'])
    // By sameAs, and without it by the complement peaks alone.
    const how = ['the same residues at the same masses', 'on the complement peaks']
    for (const [k, graph2] of [g, { ...g, paths: g.paths.map((p) => ({ ...p, sameAs: [] })) }].entries()) {
      const { container, unmount } = render(<MergeGraph graph={graph2} spectrum={s} chosen={0} onChoose={vi.fn()} />)
      expect(container.querySelectorAll('[data-path="1"]').length).toBe(0)
      expect(container.querySelectorAll('.sp-graph-node').length).toBe(1)
      const dup = screen.getByTestId('merge-graph-dup')
      expect(dup.querySelector('text')?.textContent).toBe('b+y')
      expect(dup.getAttribute('aria-label')).toBe('b+y: read again by #2, not drawn again')
      expect(dup.querySelector('title')?.textContent).toBe(`The same residues read again, not drawn: #2 EPT (b or y 1+, ${how[k]})`)
      // Nor is the complement tag offered as unused.
      expect(screen.queryByTestId('merge-graph-unused')).toBeNull()
      unmount()
    }
  })

  it('places the other resolved tags around the anchor: conflicting above, the rest listed below in rank order', () => {
    // EPTIDE, and W (one weak peak a W above b2): W forks from EPTIDE at b2.
    const { container } = render(<MergeGraph graph={graph} spectrum={S} chosen={0} onChoose={vi.fn()} />)
    expect(graph.paths[1].relations).toMatchObject([{ path: 0, kind: 'fork' }])
    const ruler = Number(screen.getByTestId('merge-graph-ruler').querySelector('line')?.getAttribute('y1'))
    const w = container.querySelector('[data-path="1"]') as Element
    expect(w.getAttribute('data-band')).toBe('fork')
    expect(barY(container, '[data-path="1"]')).toBeLessThan(ruler)
    expect(w.textContent).toContain('#2 W')
    // Unrelated resolved tags: one row each below, left-aligned, in rank order.
    const lone = { ...graph, paths: graph.paths.map((p) => ({ ...p, relations: [] })) }
    const { container: c2 } = render(<MergeGraph graph={lone} spectrum={S} chosen={0} onChoose={vi.fn()} />)
    const other = c2.querySelector('[data-path="1"]') as Element
    expect(other.getAttribute('data-band')).toBe('other')
    expect(barY(c2, '[data-path="1"]')).toBeGreaterThan(ruler)
    expect(c2.querySelectorAll('[data-arc]').length).toBe(graph.paths[0].chain.length - 1)
  })

  it('hides the tags in no resolved tag behind a toggle', () => {
    const one = { ...graph, paths: graph.paths.slice(0, 1).map((p) => ({ ...p, relations: [] })) }
    const free = graph.paths[1].chain.length + graph.paths[1].inside.length
    const { container } = render(<MergeGraph graph={one} spectrum={S} chosen={0} onChoose={vi.fn()} />)
    expect(container.querySelectorAll('[data-band=unused]').length).toBe(0)
    const btn = screen.getByTestId('merge-graph-unused')
    expect(btn.textContent).toBe(`Show ${free} unused tag${free === 1 ? '' : 's'}`)
    fireEvent.click(btn)
    expect(container.querySelectorAll('[data-band=unused]').length).toBe(free)
    expect(btn.textContent).toBe(`Hide ${free} unused tag${free === 1 ? '' : 's'}`)
    // Not a tab stop, an image.
    const none = container.querySelector('[data-band=unused]') as Element
    expect(none.getAttribute('role')).toBe('img')
    expect(none.hasAttribute('tabindex')).toBe(false)
    fireEvent.click(btn)
    expect(container.querySelectorAll('[data-band=unused]').length).toBe(0)
  })

  it('choosing another resolved tag re-anchors on it', () => {
    const choose = vi.fn()
    const { container, rerender } = render(<MergeGraph graph={graph} spectrum={S} chosen={0} onChoose={choose} />)
    expect(screen.getByTestId('merge-graph-ruler').getAttribute('data-sequence')).toBe('EPTIDE')
    fireEvent.click(container.querySelector('[data-path="1"]') as Element)
    expect(choose).toHaveBeenLastCalledWith(1)
    rerender(<MergeGraph graph={graph} spectrum={S} chosen={1} onChoose={choose} />)
    expect(screen.getByTestId('merge-graph-ruler').getAttribute('data-sequence')).toBe('W')
    expect([...container.querySelectorAll('[data-band=chain]')].map((n) => Number(n.getAttribute('data-node')))).toEqual(graph.paths[1].chain)
    // The tags of EPTIDE are now one bar of resolved tag 1, above (it conflicts).
    expect(container.querySelector('[data-path="0"]')?.getAttribute('data-band')).toBe('fork')
    expect(screen.getAllByRole('button', { pressed: true }).every((n) => /resolved tag 2\b/.test(n.getAttribute('aria-label') ?? ''))).toBe(true)
    // A tag of the anchor names how it reads and what it builds.
    const w = screen.getByRole('button', { name: /^W, builds resolved tag 2/ })
    expect(w.querySelector('title')?.textContent).toMatch(/^W \(.*\) · E-value 0\.9 · 1 tag: W · builds resolved tag 2$/)
  })

  it('is one tab stop: the arrows move between the bars, Enter chooses', () => {
    const choose = vi.fn()
    const { container } = render(<MergeGraph graph={graph} spectrum={S} chosen={0} onChoose={choose} />)
    const stops = (): Element[] => [...container.querySelectorAll('[tabindex="0"]')]
    // The stop: the anchor's N-terminal tag.
    expect(stops().length).toBe(1)
    const first = stops()[0]
    const chain = [...container.querySelectorAll('[data-band=chain]')]
    expect(first).toBe(chain.sort((a, b) => Number(a.querySelector('.sp-graph-bar')?.getAttribute('x')) - Number(b.querySelector('.sp-graph-bar')?.getAttribute('x')))[0])
    const focusable = [...container.querySelectorAll('[tabindex]')]
    const seen = new Set<Element>([first])
    for (let round = 0; round < 3; round++)
      for (const el of [...seen])
        for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
          act(() => (el as HTMLElement).focus())
          fireEvent.keyDown(el, { key })
          const to = document.activeElement as Element
          if (!focusable.includes(to)) continue
          seen.add(to)
          expect(stops()).toEqual([to])
        }
    expect(seen.size).toBe(focusable.length)
    // Up from the anchor reaches the conflicting #2, Enter chooses it.
    const w = container.querySelector('[data-path="1"]') as HTMLElement
    act(() => w.focus())
    fireEvent.keyDown(w, { key: 'Enter' })
    expect(choose).toHaveBeenLastCalledWith(1)
  })

  it('marks the termini of the anchor on its ruler and of the others beside their sequence', () => {
    const t = [{ n: 'at' as const, c: { away: 'K' } }, { n: { away: '[IL]' }, c: null }]
    const { container } = render(<MergeGraph graph={graph} spectrum={S} chosen={0} onChoose={vi.fn()} termini={t} />)
    const ruler = screen.getByTestId('merge-graph-ruler')
    const n = ruler.querySelector('[data-term=N]') as Element
    const c = ruler.querySelector('[data-term=C]') as Element
    expect([n.textContent, n.getAttribute('aria-label'), n.getAttribute('class')]).toEqual(['at the peptide N terminusN–', 'at the peptide N terminus', 'sp-graph-term'])
    expect([c.getAttribute('aria-label'), c.getAttribute('class')]).toEqual(['one residue (K) from the C terminus', 'sp-graph-term away'])
    expect(c.textContent).toContain('(K)–C')
    expect(container.querySelector('[data-path="1"] .sp-graph-label')?.textContent).toBe('#2 N–([IL])W')
    expect(container.querySelector('[data-path="1"] title')?.textContent).toContain('one residue ([IL]) from the N terminus')
  })

  it("shows the terminus FASTag wrote in its table, over the GUI's own", async () => {
    const { container } = panel(toCli(graph, S, 'scan=1', { scheme: 'cstar', threshold: '3' }, (_, k) => (k === 1 ? 'N' : '')))
    await screen.findByTestId('ladder')
    fireEvent.click(screen.getByLabelText('Merge graph'))
    await screen.findByTestId('merge-source')
    // Computed it would be N+P and C+K (a test above); FASTag's column says N.
    expect(selected(container)).toMatch(/^#1 N–EPTIDE /)
    expect(screen.getByTestId('ladder').textContent).toMatch(/: N–EPTIDE N→C/)
    const n = screen.getByTestId('merge-graph-ruler').querySelector('[data-term=N]') as Element
    expect([n.getAttribute('aria-label'), screen.getByTestId('merge-graph-ruler').querySelector('[data-term=C]')]).toEqual(['at the peptide N terminus', null])
    // b0 lies below the plotted m/z: no tick.
    expect(screen.queryByTestId('terminus-mark')).toBeNull()
  })

  it('the stick plot ticks the terminus of the selected resolved tag only inside its m/z range', () => {
    const mark = (x: number) => [{ mz: x, label: 'N b0', words: 'one residue (P) from the N terminus', away: true }]
    const { container, rerender } = render(<StickPlot spectrum={S} ladder={null} marks={mark(mz[0] + 1)} />)
    const t = screen.getByTestId('terminus-mark')
    expect([t.getAttribute('aria-label'), t.getAttribute('class'), t.querySelector('text')?.textContent]).toEqual([`N b0 at m/z ${(mz[0] + 1).toFixed(4)}: one residue (P) from the N terminus`, 'sp-term-mark away', 'N b0'])
    rerender(<StickPlot spectrum={S} ladder={null} marks={mark(PROTON)} />)
    expect(container.querySelector('[data-testid=terminus-mark]')).toBeNull()
  })

  it('the Spectrum tab no longer zooms the merge graph with the plot', async () => {
    panel(swapRanks(toCli(graph, S, 'scan=1'), 1, 2))
    await screen.findByTestId('ladder')
    fireEvent.click(screen.getByLabelText('Merge graph'))
    await screen.findByTestId('merge-source')
    const g = screen.getByTestId('merge-graph')
    const before = g.innerHTML
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(g.innerHTML).toBe(before)
  })

  it('the Spectrum tab resolves as FASTag did when the run wrote its tag graph, and its nodes select', async () => {
    // FASTag ranks W first, the GUI EPTIDE: the tab shows FASTag's ranking.
    expect(graph.paths.map(sequenceOf)).toEqual(['EPTIDE', 'W'])
    const { container, mock } = panel(swapRanks(toCli(graph, S, 'scan=1'), 1, 2))
    await screen.findByTestId('ladder')
    fireEvent.click(screen.getByLabelText('Merge graph'))
    expect((await screen.findByTestId('merge-source')).textContent).toBe('Resolved by FASTag (ranking cstar, threshold 3)')
    expect(screen.getByTestId('merge-summary').textContent).toMatch(/^4 tags \(4 distinct\) → 2 resolved/)
    // Read without an open, and not through resultsQuery (browser.rs refuses a file not open).
    expect(mock.tableQueryCalls.map((c) => c.path)).toEqual(['/d/a.resolved.tsv', '/d/a.taggraph.tsv'])
    expect(mock.resultsQueryCalls.some((c) => c.path !== '/d/a.tags.tsv')).toBe(false)
    // The GUI's cutoff and join are not FASTag's.
    expect(screen.queryByLabelText('Largest E-value of the tags used')).toBeNull()
    const g = screen.getByTestId('merge-graph')
    // Anchored on #1 W: its one tag; EPTIDE, which conflicts with it, one bar above.
    expect(g.querySelectorAll('[data-node]').length).toBe(1)
    expect(g.querySelector('[data-path="1"]')?.getAttribute('data-band')).toBe('fork')
    expect(within(container.querySelector('table[aria-label="Resolved tags of this spectrum"]') as HTMLElement).getAllByRole('row').slice(1).map((r) => r.querySelector('td')?.textContent?.split(' ').slice(0, 2).join(' '))).toEqual(['#1 W', '#2 N–(P)EPTIDE(K)–C'])
    expect(selected(container)).toMatch(/^#1 W/)
    // A node's rank and tags are FASTag's rows, named by the panel's (E-value ordered) rows.
    const w = within(g).getByRole('button', { name: /^W, builds resolved tag 1/ })
    expect(within(g).getByTestId('merge-graph-ruler').textContent).toMatch(/^#1/)
    expect(w.querySelector('title')?.textContent).toMatch(/· 1 tag: W · builds resolved tag 1$/)
    const ept = within(g).getByRole('button', { name: /^EPTIDE, resolved tag 2, conflicts with #1/ })
    fireEvent.click(ept)
    // The old table has no terminus column: computed as FASTag does (b1 to b7 of PEPTIDEK, one P before, one K after).
    expect(selected(container)).toMatch(/^#2 N–\(P\)EPTIDE\(K\)–C/)
    // Re-anchored: the tags that build it.
    const tag = within(g).getByRole('button', { name: /^EPT, builds resolved tag 2/ })
    expect(tag.querySelector('title')?.textContent).toMatch(/· 1 tag: EPT · builds resolved tag 2$/)
    // The plot draws the ladder of the tag selected.
    expect(screen.getByTestId('ladder').textContent).toMatch(/: N–\(P\)EPTIDE\(K\)–C N→C/)
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
    fireEvent.click(within(screen.getByTestId('merge-graph')).getByRole('button', { name: /^EPTIDE, resolved tag 2\b/ }))
    expect(selected(container)).toMatch(/^#2 N–\(P\)EPTIDE/)
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

  // Tables dropped without a record of their run (source.params null): the
  // ranking is what FASTag wrote on their rows, or said to be unknown.
  const shown = async (cli: { resolved: CliRows; nodes: CliRows }, params: Record<string, unknown> | null): Promise<string | null> => {
    const { unmount } = panel(cli, params)
    await screen.findByTestId('ladder')
    fireEvent.click(screen.getByLabelText('All tags, resolved'))
    const t = (await screen.findByTestId('merge-source')).textContent
    unmount()
    return t
  }
  it('names the ranking FASTag recorded on its rows, ahead of the run parameters', async () => {
    const sl = { scheme: 'steplogodds', threshold: '2' }
    expect(await shown(swapRanks(toCli(graph, S, 'scan=1', sl), 1, 2), null)).toBe('Resolved by FASTag (ranking steplogodds, threshold 2)')
    expect(await shown(swapRanks(toCli(graph, S, 'scan=1', sl), 1, 2), { resolve_score: 'anchor' })).toBe('Resolved by FASTag (ranking steplogodds, threshold 2)')
    expect(await shown(toCli(graph, S, 'scan=1', { scheme: 'evidence', threshold: '' }), null)).toBe('Resolved by FASTag (ranking evidence)')
    // The run's parameters when the rows do not record it; absent there is the default.
    expect(await shown(toCli(graph, S, 'scan=1'), { resolve_score: 'evidence' })).toBe('Resolved by FASTag (ranking evidence)')
    expect(await shown(toCli(graph, S, 'scan=1'), {})).toBe('Resolved by FASTag (ranking cstar, threshold 3)')
  })
  it('without a record of the run nor of the ranking, says it is not known rather than naming one', async () => {
    expect(await shown(toCli(graph, S, 'scan=1'), null)).toBe("Resolved by FASTag (ranking not recorded; FASTag's default is cstar)")
    const empty = toCli({ ...graph, placements: [], paths: [], arcs: [], offPeaks: [] }, S, 'scan=1')
    expect(await shown(empty, null)).toBe(
      "Resolved in the GUI (ranking cstar, threshold 3; the run's ranking is not recorded, so FASTag's default): FASTag resolved none of the 4 tags (E-value above -resolve_max_evalue 1, or not on the peaks)"
    )
  })
  it('the fallback ranks as FASTag recorded on the table, for a spectrum it wrote no row of', async () => {
    // The tables hold another spectrum's rows, ranked by steplogodds at 2.
    const other = toCli(graph, S, 'scan=2', { scheme: 'steplogodds', threshold: '2' })
    const { mock, unmount } = panel(other, null)
    await screen.findByTestId('ladder')
    fireEvent.click(screen.getByLabelText('All tags, resolved'))
    expect((await screen.findByTestId('merge-source')).textContent).toBe(
      'Resolved in the GUI (ranking steplogodds, threshold 2): FASTag resolved none of the 4 tags (E-value above -resolve_max_evalue 1, or not on the peaks)'
    )
    expect(mock.tableQueryCalls[mock.tableQueryCalls.length - 1]).toMatchObject({ path: '/d/a.resolved.tsv', offset: 0, limit: 1 })
    unmount()
  })
})
