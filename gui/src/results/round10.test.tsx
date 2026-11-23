// Review round 10, the minor findings: the alkylation note (4), the
// Triage Overview (5), one wording per count (6), the changed line and
// Seed length (7), the needs sentence (8), the confidence scales (9), the
// Characterize Overview rows and the tab badges (10), one Extension example
// (11), the alkylation texts (12, 13), the TMT reporter text (14), the
// modal questions (15), the Spectrum tab without a tags table (17), the
// shortlist wording (18) and the tag status (19).

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { buildOverview, leadTiles, shownTiles, triageFacts, type OverviewInputs } from './overview'
import OverviewPanel from './OverviewPanel'
import ReportTable from './ReportTable'
import { PARAM_UI } from '../paramUi'
import { TASKS } from '../setup/tasks'
import { columnLabel } from '../ResultsTable'
import { popoverTexts } from '../help/HelpPopover'
import ParamField from '../ParamField'
import { BRIEF_HINT, PARAM_BY_NAME } from '../paramLayout'
import { OverwriteQuestion } from '../shell/Questions'
import SpectrumPanel from '../spectrum/SpectrumPanel'
import { installMockBridge } from '../testing/mockBridge'
import { click, flush, openGroup, renderCharacterizeApp, showStep } from '../testing/render'
import triageTsv from '../fixtures/cli-1.15/workflows/triage/run01.census_sorted.tsv?raw'
import shortlistTsv from '../fixtures/cli-1.15/ecoli_ms2_small_0.3da.shortlist.tsv?raw'

const base = (over: Partial<OverviewInputs> = {}): OverviewInputs => ({
  log: ['139 MS2 spectra, 500 tags'],
  reports: [],
  species: null,
  census: null,
  params: {},
  instrument: null,
  ...over
})

describe('round 10, 4: the alkylation note says where Extension is and what the raise changes', () => {
  it('before and after the tick, with a link to the field', async () => {
    const mock = installMockBridge()
    await renderCharacterizeApp(mock)
    showStep(4)
    const note = (): HTMLElement => document.getElementById('out-alkylation_out-d')!
    // Off: nothing is raised yet, so the note says what turning it on would do (round 10 major 1).
    expect(note().textContent).toBe('Turning it on raises Extension 2 → 3 (Advanced › Tagging); that changes every tag; species and digest are validated at 2.')
    await click(document.getElementById('out-alkylation_out')!)
    expect(note().textContent).toBe('Extension 2 → 3 (Advanced › Tagging); changes every tag; species and digest are validated at 2.')
    await click(within(note()).getByRole('button', { name: 'Extension' }))
    await flush()
    await new Promise((r) => setTimeout(r, 0))
    expect(document.activeElement?.id).toBe('p-extension')
  })
})

describe('round 10, 5: the Triage Overview leads with the ranking', () => {
  it('the median score, then identified and with any tag', () => {
    const f = triageFacts(triageTsv)!
    expect(f.ranked).toBe(139)
    expect(f.median).toBeGreaterThan(0)
    expect(f.ids).toBeNull()
    const ids = 'ident_rank\tident_score\tidentified\n1\t0.9\t1\n2\t0.5\t0\n3\t0.1\t\n'
    expect(triageFacts(ids)).toEqual({ ranked: 3, median: 0.5, ids: { identified: 1, not: 1, unknown: 1 } })
    const params = { census: true, census_sorted_out: 'c.tsv', census_ids: '/d/a.idXML' }
    const o = buildOverview(base({ params, triage: ids, census: null }))
    const t = leadTiles(shownTiles(o, params), 'triage')
    expect(t.figures.slice(0, 3).map((x) => x.id)).toEqual(['ident-score', 'identified', 'tagged'])
    expect(t.figures[0].value).toBe('0.500')
    expect(t.figures[1].value).toBe('1 of 3')
    expect(t.figures[1].note).toMatch(/1 not identified, 1 unknown/)
    expect(t.lead).toBe(3)
  })
})

describe('round 10, 6: one wording per count', () => {
  it('Tagged (E ≤ 0.01), With any tag, MS2 spectra with any tag', () => {
    const qc = 'section\tkey\tvalue\tn\tdescription\nqc\ttag_yield\t0.5\t-\t-\nqc\tms2_tagged_e001\t70\t-\t-\n'
    const o = buildOverview(base({ qc, deltaCounts: 'key\tvalue\nms2_placed\t40\nms2_tagged\t90\n', params: { census: true } }))
    expect(o.figures.find((t) => t.id === 'qc-tagged')!.label).toBe('Tagged (E ≤ 0.01)')
    expect(o.figures.find((t) => t.id === 'tagged')!.label).toBe('With any tag')
    expect(o.figures.find((t) => t.id === 'placed')!.note).toMatch(/^of 90 MS2 spectra with any tag/)
  })
})

describe('round 10, 7: Seed length, and the changed note on its own line', () => {
  it('names the real label; the note is a line of its own, in the description', () => {
    expect(BRIEF_HINT['tag_lengths']).toBe('Several seed lengths in one pass, in place of Seed length.')
    expect(PARAM_UI['tag_length'].label).toBe('Seed length')
    const spec = PARAM_BY_NAME.get('extension')!
    render(<ParamField spec={spec} value="3" onChange={vi.fn()} setBy="Characterize a run" />)
    expect(document.getElementById('h-extension')!.textContent).not.toMatch(/Default/)
    expect(document.getElementById('h-extension-c')!.textContent).toBe('Default 0 · set by Characterize a run')
    expect(document.getElementById('p-extension')!.getAttribute('aria-describedby')).toBe('h-extension h-extension-c')
  })
})

describe('round 10, 8: the needs sentence names what its buttons turn on', () => {
  it('Shortlist, advanced: Reduced FASTA in words and on its one button; no "(see ?)" anywhere', async () => {
    const mock = installMockBridge()
    await renderCharacterizeApp(mock)
    const adv = [...document.querySelectorAll<HTMLElement>('summary')].find((s) => /Advanced/.test(s.textContent ?? ''))!
    await click(adv)
    await openGroup('Other analyses')
    await openGroup('Shortlist, advanced')
    await openGroup('Placement on the database')
    const g = document.querySelector('[data-group="Shortlist, advanced"] .group-needs')!
    expect(g.querySelector('.needs-text')!.textContent).toMatch(/^8 more settings need Reduced FASTA\./)
    expect([...g.querySelectorAll('button.secondary')].map((b) => b.textContent)).toEqual(['Turn on Reduced FASTA'])
    for (const n of document.querySelectorAll('.group-needs')) expect(n.textContent).not.toMatch(/see \?|one of \d+ reports/)
    expect(document.querySelector('[data-group="Placement on the database"] .group-needs')!.textContent).toMatch(/need Tag placements, Protein shortlist, Reduced FASTA or 2 more\./)
  })
})

describe('round 10, 9: each confidence column names its scale', () => {
  it('percent for the residues, 0–1 for the steps', () => {
    expect(columnLabel('res_conf')).toBe('Residue conf. (%)')
    expect(columnLabel('min_conf')).toBe('Min. conf. (0–1)')
    expect(columnLabel('mean_conf')).toBe('Mean conf. (0–1)')
  })
})

describe('round 10, 10: Characterize puts its calls on a row of their own', () => {
  it('a Main result list of calls, the run facts below, no Tags E ≤ 1 tile', () => {
    const params = { digest_out: 'd', label_out: 'l', species: true, glyco: true }
    const o = buildOverview(base({ params }))
    render(<OverviewPanel overview={o} input="/d/a.mzML" busy={false} onAction={vi.fn()} params={params} workflowId="characterize" />)
    const lead = screen.getByRole('list', { name: 'Main result' })
    expect(within(lead).getAllByRole('heading').map((h) => h.textContent)).toEqual(['Protease', 'Label', 'Top genus', 'Glyco'])
    const facts = screen.getByRole('list', { name: 'Key figures' })
    expect(within(facts).getAllByRole('heading').map((h) => h.textContent)).toEqual(['MS2 spectra', 'Instrument', 'Tags'])
  })
})

describe('round 10, 11 to 14: help texts', () => {
  it('11: one Extension example, the CLI line covered', () => {
    expect(PARAM_UI['extension'].help!.tip).toMatch(/3 to let a seed of 3 grow to 9/)
    expect(TASKS.find((t) => t.id === 'export-tags')!.help!['extension']).toMatch(/3 lets a seed of 3 grow to 9/)
    const t = popoverTexts(PARAM_BY_NAME.get('extension')!.description, PARAM_UI['extension'].help!.text, PARAM_UI['extension'].help!.tip, PARAM_UI['extension'].help!.cliCovered)
    expect(t.cli).toBeUndefined()
    expect(t.off).toBe('0')
  })
  it('12, 13: the real label of the shortest placed tag, and that it replaces 8 or 7', () => {
    const text = PARAM_UI['alkylation_proteome'].help!.text
    expect(text).toMatch(/Shortest tag placed sets that length; it is in Advanced, group “Placement, advanced”/)
    expect(text).toMatch(/7 \(yeast, E\. coli\) \(or Shortest tag placed, when set above 0\)/)
    expect(text).not.toMatch(/Minimum tag length/)
    expect(TASKS.find((t) => t.id === 'characterize')!.productNotes!['alkylation_out']).toMatch(/\(or Shortest tag placed, when set above 0\)/)
  })
  it('14: the reporter filter needs auto to detect TMT', () => {
    expect(PARAM_UI['tmt_reporter_filter'].help!.text).toMatch(/on, or auto when auto detects TMT labelling\.$/)
  })
})

describe('round 10, 15: a question is modal', () => {
  it('the background is inert, Escape gives the safe answer, focus goes back', () => {
    const answer = vi.fn()
    const onAnswer = vi.fn()
    const { rerender } = render(
      <div>
        <button type="button">Behind</button>
      </div>
    )
    const behind = screen.getByRole('button', { name: 'Behind' })
    behind.focus()
    rerender(
      <div>
        <button type="button">Behind</button>
        <OverwriteQuestion ask={{ files: ['/d/a.tags.tsv'], answer }} onAnswer={onAnswer} />
      </div>
    )
    expect(behind.hasAttribute('inert')).toBe(true)
    expect(document.activeElement?.textContent).toBe("Don't run")
    // Tab stays inside: from the last control to the first.
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
    expect(document.activeElement?.textContent).toBe('Overwrite and run')
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true })
    expect(document.activeElement?.textContent).toBe("Don't run")
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(onAnswer).toHaveBeenCalledWith(false)
    rerender(
      <div>
        <button type="button">Behind</button>
      </div>
    )
    expect(behind.hasAttribute('inert')).toBe(false)
    expect(document.activeElement).toBe(behind)
  })
})

describe('round 10, 17: the Spectrum tab reads no tags from a ranking', () => {
  it('without a tags table it says so and queries nothing', () => {
    const mock = installMockBridge()
    render(
      <SpectrumPanel
        target={{ path: '/d/run01.census_sorted.tsv', spectrum: 'scan=11523', rowId: null }}
        source={{ input: null, params: null, from: 'none' }}
        tags={null}
        onTarget={vi.fn()}
        onLocate={vi.fn()}
      />
    )
    expect(screen.getByText(/^Tags file not opened/)).toBeDefined()
    expect(mock.resultsQueryCalls).toEqual([])
  })
})

describe('round 10, 18 and 19: shortlist and triage wording', () => {
  it('18: kept on the shortlist without a reduced FASTA, in it with one', async () => {
    const mock = installMockBridge()
    mock.reportFiles['/d/a.shortlist.tsv'] = shortlistTsv
    const { rerender } = render(<ReportTable kind="shortlist" path="/d/a.shortlist.tsv" />)
    expect(await screen.findByText(/proteins with evidence are kept on the shortlist\./)).toBeDefined()
    rerender(<ReportTable kind="shortlist" path="/d/a.shortlist.tsv" files={[{ label: 'reduced FASTA', path: '/d/a.fasta' }]} />)
    expect(await screen.findByText(/proteins with evidence are kept in the reduced FASTA\./)).toBeDefined()
    const o = buildOverview(base({ shortlist: shortlistTsv }))
    expect(o.figures.find((t) => t.id === 'shortlist')!.note).toMatch(/kept on the shortlist/)
    expect(buildOverview(base({ shortlist: shortlistTsv, reducedFasta: true })).figures.find((t) => t.id === 'shortlist')!.note).toMatch(/kept for the reduced FASTA/)
  })
  it('19: the status column is the tag status', async () => {
    const mock = installMockBridge()
    mock.reportFiles['/d/run01.census_sorted.tsv'] = triageTsv
    render(<ReportTable kind="triage" path="/d/run01.census_sorted.tsv" />)
    await waitFor(() => expect(document.querySelector('.report-sum')?.textContent).toMatch(/ranked by how identifiable they are; tag status: 139 tagged\.$/))
    expect(document.body.textContent).toContain('Tag status')
  })
})
