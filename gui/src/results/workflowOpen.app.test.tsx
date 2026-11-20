// Use case 8 for the new workflows: a saved QC, shortlist or identifiability
// report opens in its own view (Open report…, a drop), told by its content,
// on a cold start; and a result of another run never sits beside the reports
// of the run shown.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installMockBridge } from '../testing/mockBridge'
import { click, flush, goTo, pickSingle, renderColdApp, runButton } from '../testing/render'
import qcTsv from '../fixtures/cli-1.15/ecoli_ms2_small_0.3da.qc.tsv?raw'
import shortlistTsv from '../fixtures/cli-1.15/ecoli_ms2_small_0.3da.shortlist.tsv?raw'
import censusSortedTsv from '../fixtures/cli-1.15/ecoli_ms2_small_0.3da.census_sorted.tsv?raw'
import { sniffWorkflow } from './workflowReports'

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

  it('a dropped QC report opens in the QC view, not as a tags table', async () => {
    const mock = installMockBridge()
    mock.reportFiles['/old/run07.qc.tsv'] = qcTsv
    await renderColdApp(mock)
    await act(async () => mock.emitDrop({ reports: [{ kind: 'qc', path: '/old/run07.qc.tsv' }] }))
    await flush()
    await waitFor(() => expect(selected()).toBe('QC'))
    expect(mock.resultsQueryCalls).toHaveLength(0)
    await waitFor(() => expect(document.querySelector('.qc-strip')!.textContent).toMatch(/MS\/MS spectra139/))
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
