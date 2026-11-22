// The merge graph view, and the Spectrum tab with FASTag's own tag graph
// (-resolved_out, -tag_graph_out) in place of the GUI's.

import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SpectrumPanel from './SpectrumPanel'
import { MergeGraph } from './MergeGraph'
import { buildGraph, type TagIn } from './graph'
import { parseDump } from './dump'
import { PROTON, WATER, residueMasses, tagRowFrom } from './ladder'
import { stepWeight } from './stepScore'
import { toCli } from '../testing/cliGraphTsv'
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
const tagRows = [tag('EPT', sum('P'), '1e-9'), tag('PTID', sum('PE'), '1e-8'), tag('IDE', sum('PEPT'), '1e-7'), tag('W', sum('PE'), '0.9')]
const ins: TagIn[] = tagRows.map((r, i) => ({ row: tagRowFrom(tagCols, r)!, evalue: Number(r[8]), index: i }))
const graph = buildGraph(ins, S, RES, { join: false, weight: stepWeight(S) })
const page = (t: CliRows): ResultsPage => ({ columns: t.columns, totalRows: t.rows.length, matchedRows: t.rows.length, rows: t.rows, rowIds: t.rows.map((_, i) => i), ranked: true, pending: false })

function panel(cli: { resolved: CliRows; nodes: CliRows }): ReturnType<typeof render> {
  installMockBridge().spectrumDumps['scan=1'] = dump
  window.fastag.resultsQuery = (path) =>
    Promise.resolve(page(path.endsWith('.resolved.tsv') ? cli.resolved : path.endsWith('.taggraph.tsv') ? cli.nodes : { columns: tagCols, rows: tagRows }))
  return render(
    <SpectrumPanel
      target={{ path: '/d/a.tags.tsv', spectrum: 'scan=1', rowId: 0 }}
      source={{ input: '/d/a.mzML', params: {}, from: 'run' }}
      resolved="/d/a.resolved.tsv"
      tagGraph="/d/a.taggraph.tsv"
      onTarget={vi.fn()}
      onLocate={vi.fn()}
    />
  )
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

  it('the Spectrum tab resolves as FASTag did when the run wrote its tag graph, and its nodes select', async () => {
    const { container } = panel(toCli(graph, S, 'scan=1'))
    await screen.findByTestId('ladder')
    fireEvent.click(screen.getByLabelText('Merge graph'))
    expect((await screen.findByTestId('merge-source')).textContent).toBe('Resolved by FASTag (ranking steplogodds)')
    expect(screen.getByTestId('merge-summary').textContent).toMatch(/^4 tags \(4 distinct\) → 2 resolved/)
    // The GUI's cutoff and join are not FASTag's.
    expect(screen.queryByLabelText('Largest E-value of the tags used')).toBeNull()
    const g = screen.getByTestId('merge-graph')
    expect(g.querySelectorAll('[data-node]').length).toBe(4)
    expect(selected(container)).toMatch(/^#1 EPTIDE/)
    fireEvent.click(within(g).getByRole('button', { name: /^W, / }))
    expect(selected(container)).toMatch(/^#2 W/)
    // The plot draws the ladder of the tag selected.
    expect(screen.getByTestId('ladder').textContent).toMatch(/: W N→C/)
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
