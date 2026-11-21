// Use case 8 for the new workflows: a saved QC, shortlist or identifiability
// report opens in its own view (Open report…, a drop), told by its content,
// on a cold start; and a result of another run never sits beside the reports
// of the run shown.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installMockBridge } from '../testing/mockBridge'
import type { RunRecord } from '../types'
import { click, flush, goTo, pickSingle, renderColdApp, runButton } from '../testing/render'
import qcTsv from '../fixtures/cli-1.15/ecoli_ms2_small_0.3da.qc.tsv?raw'
import shortlistTsv from '../fixtures/cli-1.15/ecoli_ms2_small_0.3da.shortlist.tsv?raw'
import censusSortedTsv from '../fixtures/cli-1.15/ecoli_ms2_small_0.3da.census_sorted.tsv?raw'
import { sniffWorkflow } from './workflowReports'
import humanDelta from '../fixtures/cli/v112-pxd014764-delta-ext3/run.delta.tsv?raw'

const tabs = (): string[] => screen.getAllByRole('tab').map((t) => t.textContent ?? '')
const selected = (): string | undefined => screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')?.textContent ?? undefined

describe('opening a workflow report', () => {
  it('tells QC, shortlist and identifiability reports by their content', () => {
    expect(sniffWorkflow(qcTsv, '/x/a.tsv')).toBe('qc')
    expect(sniffWorkflow(shortlistTsv, '/x/b.tsv')).toBe('shortlist')
    expect(sniffWorkflow(censusSortedTsv, '/x/c.tsv')).toBe('triage')
    expect(sniffWorkflow('section\tkey\tvalue\tn\tdescription\nrun\tversion\t1.15.3\t-\t-\ncensus\tspectra\t10\t-\t-\n')).toBe('censusSummary')
    expect(sniffWorkflow('spectrum\tdelta\trow\tinterp\tpeptide\n')).toBe('deltaSpectra')
    // A digest report is none of them.
    expect(sniffWorkflow('section\tkey\tvalue\tn\tdescription\ncall\tstatus\tTrypsin\t1\t-\n')).toBeNull()
  })

  for (const [what, path, text, tab] of [
    ['a QC report', '/old/run07.qc.tsv', qcTsv, 'QC'],
    ['a protein shortlist', '/old/run07.shortlist.tsv', shortlistTsv, 'Shortlist'],
    ['an identifiability ranking', '/old/run07.census_sorted.tsv', censusSortedTsv, 'Triage']
  ] as const) {
    it(`Open report… on a cold start shows ${what} in its own view`, async () => {
      const mock = installMockBridge()
      mock.reportFiles[path] = text
      mock.nextPickReport = path
      await renderColdApp(mock)
      await goTo('results')
      await click(screen.getByRole('button', { name: 'Open report…' }))
      await waitFor(() => expect(selected()).toBe(tab))
      expect(tabs()).toContain(tab)
      expect(tabs()).not.toContain('Digest')
    })
  }

  it('a renamed mass-shift accounting is told by its keys', () => {
    const counts = 'key\tvalue\nms2_read\t100\nms2_tagged\t80\nms2_placed\t40\ncheck_tagged_le_ms2\tok\n'
    expect(sniffWorkflow(counts, '/x/my-counts.tsv')).toBe('deltaCounts')
    expect(sniffWorkflow('key\tvalue\nfoo\t1\n', '/x/other.tsv')).toBeNull()
  })

  for (const [what, path, text, tab] of [
    ['a QC report', '/old/whatever.tsv', qcTsv, 'QC'],
    ['an identifiability ranking', '/old/ranking.tsv', censusSortedTsv, 'Triage']
  ] as const) {
    it(`Open earlier results… (Setup) shows ${what} under any name in its own view, with no Tags tab`, async () => {
      const mock = installMockBridge()
      mock.reportFiles[path] = text
      mock.nextPickResults = path
      await renderColdApp(mock)
      await click(screen.getByRole('button', { name: 'Open earlier results…' }))
      await goTo('results')
      await waitFor(() => expect(selected()).toBe(tab))
      expect(tabs()).not.toContain('Tags')
      expect(mock.resultsQueryCalls).toHaveLength(0)
    })
  }

  it('a dropped QC report opens in the QC view, not as a tags table', async () => {
    const mock = installMockBridge()
    mock.reportFiles['/old/run07.qc.tsv'] = qcTsv
    await renderColdApp(mock)
    await act(async () => mock.emitDrop({ reports: [{ kind: 'qc', path: '/old/run07.qc.tsv' }] }))
    await flush()
    await waitFor(() => expect(selected()).toBe('QC'))
    expect(mock.resultsQueryCalls).toHaveLength(0)
    await waitFor(() => expect(document.querySelector('.qc-strip')!.textContent).toMatch(/MS2 spectra139/))
  })
})

describe('the run shown and another result', () => {
  it("opening B's tags after a QC run on A closes A's QC tab and Overview", async () => {
    const mock = installMockBridge()
    mock.reportFiles['/d/a.qc.tsv'] = qcTsv
    await renderColdApp(mock)
    await click(screen.getByRole('radio', { name: /^Run QC/ }))
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await act(async () => mock.emitDone({ ok: true, code: 0, runId: mock.lastRunId }))
    await waitFor(() => expect(tabs()).toContain('QC'))
    expect(tabs()).toContain('Overview')
    mock.nextPickResults = '/other/b.tags.tsv'
    await click(screen.getByRole('button', { name: 'Open tags…' }))
    await waitFor(() => expect(tabs()).not.toContain('QC'))
    expect(tabs()).not.toContain('Overview')
  })

  it("opening B's QC report after an Export tags run on A closes A's tags", async () => {
    const mock = installMockBridge()
    mock.reportFiles['/other/b.qc.tsv'] = qcTsv
    await renderColdApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await act(async () => mock.emitDone({ ok: true, code: 0, runId: mock.lastRunId }))
    await waitFor(() => expect(tabs()).toContain('Tags'))
    mock.nextPickReport = '/other/b.qc.tsv'
    await click(screen.getByRole('button', { name: 'Open report…' }))
    await waitFor(() => expect(selected()).toBe('QC'))
    expect(tabs()).not.toContain('Tags')
    expect(tabs()).not.toContain('Overview')
  })

  it('a requested report the run did not write gets no tab; the Overview names it', async () => {
    const mock = installMockBridge()
    // The run asked for the QC report, which is not on disk.
    await renderColdApp(mock)
    await click(screen.getByRole('radio', { name: /^Run QC/ }))
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await act(async () => mock.emitDone({ ok: true, code: 0, runId: mock.lastRunId }))
    await waitFor(() => expect(tabs()).toContain('Overview'))
    expect(tabs()).not.toContain('QC')
    await click(screen.getByRole('tab', { name: 'Overview' }))
    expect(screen.getByText(/Asked for, but not written: QC report/)).toBeDefined()
  })
})

describe('a triage row opens its spectrum', () => {
  it('Enter, a double-click or Open in Spectrum opens the row\'s spectrum, tagged or not', async () => {
    const mock = installMockBridge()
    mock.spectrumSupportResult = { ...mock.spectrumSupportResult, supported: true }
    mock.reportFiles['/old/r.census_sorted.tsv'] = censusSortedTsv
    mock.nextPickReport = '/old/r.census_sorted.tsv'
    await renderColdApp(mock)
    await goTo('results')
    await click(screen.getByRole('button', { name: 'Open report…' }))
    await waitFor(() => expect(selected()).toBe('Triage'))
    const grid = screen.getByRole('grid', { name: 'Spectra ranked by identifiability' })
    // The scan, not the whole native ID; E-values as the Tags table writes them.
    expect(within(grid).getAllByRole('row')[1].textContent).toContain('scan=11518')
    expect(grid.textContent).not.toContain('controllerType=0')
    await act(async () => void fireEvent.keyDown(grid, { key: 'Enter' }))
    await flush()
    expect(selected()).toBe('Spectrum')
    expect(screen.queryByText('No spectrum chosen')).toBeNull()
    await click(screen.getByRole('tab', { name: 'Triage' }))
    await click(screen.getByRole('button', { name: 'Open in Spectrum' }))
    expect(selected()).toBe('Spectrum')
  })
})

describe('the identified column', () => {
  it('counts an empty cell as unknown, not as not identified', async () => {
    const mock = installMockBridge()
    const text = ['ident_rank\tspectrum\tstatus\tn_peaks\tidentified\tident_score', '1\tscan=1\ttagged\t10\t1\t0.9', '2\tscan=2\ttagged\t10\t0\t0.8', '3\tscan=3\ttagged\t10\t\t0.7'].join('\n')
    mock.reportFiles['/old/r.census_sorted.tsv'] = text
    mock.nextPickReport = '/old/r.census_sorted.tsv'
    await renderColdApp(mock)
    await goTo('results')
    await click(screen.getByRole('button', { name: 'Open report…' }))
    await waitFor(() => expect(selected()).toBe('Triage'))
    const radio = (name: RegExp): HTMLElement => screen.getByRole('radio', { name })
    expect(radio(/^Identified/).parentElement!.textContent).toBe('Identified1')
    expect(radio(/^Not identified/).parentElement!.textContent).toBe('Not identified1')
    expect(radio(/^Unknown/).parentElement!.textContent).toBe('Unknown1')
    fireEvent.click(radio(/^Unknown/))
    await flush()
    const grid = screen.getByRole('grid', { name: 'Spectra ranked by identifiability' })
    expect(within(grid).getAllByRole('row')).toHaveLength(2)
    expect(grid.textContent).toContain('unknown')
  })
})

// Round 4, 8 and 9: a report opened shows as what it is, and closes what
// another run left shown.
describe('opening another run\'s report (round 4)', () => {
  it('a species report opened on a cold start shows its taxa whatever Setup\'s species switch says', async () => {
    const mock = installMockBridge()
    const path = '/old/run07.tags.species.tsv'
    mock.reportFiles[path] = 'rank\ttaxid\tname\tobserved\tadjusted\tq\ngenus\t561\tEscherichia\t40\t40\t0.001\n'
    mock.speciesFiles[path] = { path, taxa: [{ rank: 'genus', taxid: 561, name: 'Escherichia', observed: 40, adjusted: 40, q: 0.001 }] }
    mock.nextPickResults = path
    await renderColdApp(mock)
    await click(screen.getByRole('button', { name: 'Open earlier results…' }))
    await goTo('results')
    await waitFor(() => expect(selected()).toMatch(/^Species/))
    const panel = document.querySelector('.tablewrap')!
    expect(panel.textContent).toContain('Escherichia')
    expect(panel.textContent).not.toMatch(/Species detection is off|too short/)
  })

  it("opening B's mass-shift table after A's QC report closes A's QC tab", async () => {
    const mock = installMockBridge()
    mock.reportFiles['/a/a.qc.tsv'] = qcTsv
    mock.reportFiles['/b/b.delta.tsv'] = humanDelta
    mock.nextPickReport = '/a/a.qc.tsv'
    await renderColdApp(mock)
    await goTo('results')
    await click(screen.getByRole('button', { name: 'Open report…' }))
    await waitFor(() => expect(selected()).toBe('QC'))
    mock.nextPickReport = '/b/b.delta.tsv'
    await click(screen.getByRole('button', { name: 'Open report…' }))
    await waitFor(() => expect(tabs()).not.toContain('QC'))
  })
})

// Round 10 minor: a spectrum opened from a ranking alone draws the tags of
// the ranking's run only, never those of a later run that rewrote its path.
describe('round 10 minor: Spectrum from a ranking', () => {
  const rec = (id: string, outputs: string[], end: number): RunRecord => ({
    id, input: '/d/a.mzML', outputs, cwd: '/d', argv: ['FASTag', '-in', '/d/a.mzML', '-out', '/d/a.tags.tsv'], status: 'ok', exitCode: 0, message: null,
    start: end - 1000, end, cleanup: { removed: [], renamed: [], failed: [] }, params: {}, workflow: 'triage'
  })
  for (const [what, later, queried] of [
    ['its own run wrote the tags last: they are read', false, true],
    ['a later run rewrote the tags path: none are read', true, false]
  ] as const) {
    it(what, async () => {
      const mock = installMockBridge()
      mock.reportFiles['/d/a.census_sorted.tsv'] = censusSortedTsv
      const a = rec('A', ['/d/a.tags.tsv', '/d/a.census_sorted.tsv'], 1_000)
      // historyOf: the newest record listing the path first.
      mock.history = later ? [rec('B', ['/d/a.tags.tsv'], 2_000), a] : [a]
      mock.nextPickReport = '/d/a.census_sorted.tsv'
      mock.spectrumSupportResult = { supported: true, probed: true, detail: '' }
      await renderColdApp(mock)
      await goTo('results')
      await click(screen.getByRole('button', { name: 'Open report…' }))
      await waitFor(() => expect(selected()).toBe('Triage'))
      await click(await screen.findByRole('button', { name: 'Open in Spectrum' }))
      await waitFor(() => expect(selected()).toBe('Spectrum'))
      await flush()
      await flush()
      if (queried) await waitFor(() => expect(mock.resultsQueryCalls.some((c) => c.path === '/d/a.tags.tsv')).toBe(true))
      else {
        await waitFor(() => expect(screen.getByText(/^Tags file not opened/)).toBeDefined())
        expect(mock.resultsQueryCalls.some((c) => c.path === '/d/a.tags.tsv')).toBe(false)
      }
    })
  }
})
