// Review round 12 (doc/GUI-REVIEW-2026-11-20.md): simplicity and
// intuitiveness per workflow, and the round-11 fixes checked again.

import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ReportTable from '../results/ReportTable'
import { buildOverview } from '../results/overview'
import { installMockBridge } from '../testing/mockBridge'
import { click, renderColdApp } from '../testing/render'

const TRIAGE =
  'ident_rank\tspectrum\tstatus\tbest_evalue\tident_score\tidentified\ttriage\n1\ts1\ttagged\t0.1\t0.9\t0\t1\n2\ts2\ttagged\t5\t0.5\t1\t0\n3\ts3\tno_tags\t\t0.1\t0\t0\n'

describe('round 12: Triage candidates go to a file for the second search', () => {
  it('Export candidates… writes the candidate rows, never over the table', async () => {
    const mock = installMockBridge()
    mock.reportFiles['/d/a.census_sorted.tsv'] = TRIAGE
    render(<ReportTable kind="triage" path="/d/a.census_sorted.tsv" />)
    await waitFor(() => expect(document.querySelector('.report-sum')).not.toBeNull())
    await click(screen.getByRole('radio', { name: /^Triage candidates/ }))
    mock.nextPickOutput = '/d/a.census_sorted.tsv'
    await click(screen.getByRole('button', { name: 'Export candidates…' }))
    expect(mock.summaryWrites).toHaveLength(0)
    expect(screen.getByRole('status').textContent).toMatch(/^Not written/)
    mock.nextPickOutput = '/d/a.triage_candidates.tsv'
    await click(screen.getByRole('button', { name: 'Export candidates…' }))
    expect(mock.summaryWrites).toHaveLength(1)
    expect(mock.summaryWrites[0].text).toBe('ident_rank\tspectrum\tstatus\tbest_evalue\tident_score\tidentified\ttriage\n1\ts1\ttagged\t0.1\t0.9\t0\t1\n')
  })

  it('an unscored census is headed as one; blank E-values sort last', async () => {
    const mock = installMockBridge()
    mock.reportFiles['/d/a.census.tsv'] = 'index\tspectrum\tstatus\tbest_evalue\n0\ts1\tno_tags\t\n1\ts2\ttagged\t3\n2\ts3\ttagged\t0.5\n'
    render(<ReportTable kind="triage" path="/d/a.census.tsv" />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Per-spectrum census' })).toBeTruthy())
    await click(screen.getByRole('button', { name: /^Best E-value/ }))
    const rows = screen.getByRole('grid', { name: 'Per-spectrum census' }).querySelectorAll('tbody tr')
    expect(rows[rows.length - 1].textContent).toMatch(/s1/)
  })
})

describe('round 12: the suggested fixed cysteine modification follows the run', () => {
  const o = (fixed: unknown) =>
    buildOverview({ log: ['10 MS2 spectra, 50 tags'], reports: [], species: null, census: null, params: { fixed_modifications: fixed }, instrument: null }).suggestions.find((x) => x.setting === 'fixed C')!
  it('as run when the run had another or none; the default with Carbamidomethyl', () => {
    expect(o(['Propionamide (C)'])).toMatchObject({ value: 'Propionamide (C)', evidence: 'run' })
    expect(o([])).toMatchObject({ value: 'None (no fixed cysteine modification)', evidence: 'run' })
    expect(o(['Carbamidomethyl (C)'])).toMatchObject({ evidence: 'default' })
  })
})

describe('round 12: Shortlist counts proteins with evidence as the CLI does', () => {
  it('background proteins are counted apart', async () => {
    const mock = installMockBridge()
    mock.reportFiles['/d/a.shortlist.tsv'] =
      '# proteins: 2 with evidence, 1 kept\nrank\taccession\tkept\treason\n1\tP1\t1\tkept\n2\tP2\t0\tbelow_cut\n3\tH1\t1\tbackground\n4\tH2\t1\tbackground\n'
    render(<ReportTable kind="shortlist" path="/d/a.shortlist.tsv" />)
    await waitFor(() => expect(document.querySelector('.report-sum')?.textContent).toMatch(/^1 of 2 proteins with evidence are kept on the shortlist, plus 2 background proteins kept without evidence\.$/))
  })
})

describe('round 12: a Settings value the workflow set off the CLI default says so', () => {
  it('Export tags: Extension 3, FASTag default 0', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    expect(document.getElementById('h-extension-c')?.textContent).toBe('FASTag default 0 · set by Export tags')
    // A field at the CLI default has no such line.
    expect(document.getElementById('h-tag_length-c')).toBeNull()
  })
})
