// Review round 12 (doc/GUI-REVIEW-2026-11-20.md): simplicity and
// intuitiveness per workflow, and the round-11 fixes checked again.

import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ReportTable from '../results/ReportTable'
import DigestPanel from '../DigestPanel'
import { parseReport } from '../digestReport'
import daLabel from '../fixtures/cli-1.15/workflows/characterize/run01.label.tsv?raw'
import { buildOverview } from '../results/overview'
import { installMockBridge } from '../testing/mockBridge'
import { click, renderColdApp, chooseTask, fileButton } from '../testing/render'

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
    await click(screen.getByRole('button', { name: 'Export candidate table…' }))
    expect(mock.summaryWrites).toHaveLength(0)
    expect(screen.getByRole('status').textContent).toMatch(/^Not written/)
    mock.nextPickOutput = '/d/a.triage_candidates.tsv'
    await click(screen.getByRole('button', { name: 'Export candidate table…' }))
    expect(mock.summaryWrites).toHaveLength(1)
    expect(mock.summaryWrites[0].text).toBe('ident_rank\tspectrum\tstatus\tbest_evalue\tident_score\tidentified\ttriage\n1\ts1\ttagged\t0.1\t0.9\t0\t1\n')
  })

  it('an unscored census is headed as one; blank E-values sort last', async () => {
    const mock = installMockBridge()
    mock.reportFiles['/d/a.census.tsv'] = 'index\tspectrum\tstatus\tbest_evalue\n0\ts1\tno_tags\t\n1\ts2\ttagged\t3\n2\ts3\ttagged\t0.5\n'
    render(<ReportTable kind="triage" path="/d/a.census.tsv" />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Spectra, one row each (no identifiability score)' })).toBeTruthy())
    await click(screen.getByRole('button', { name: /^Best E-value/ }))
    const rows = screen.getByRole('grid', { name: 'Spectra, one row each' }).querySelectorAll('tbody tr')
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
    await waitFor(() => expect(document.querySelector('.report-sum')?.textContent).toMatch(/^1 of 2 proteins with evidence are kept on the shortlist, plus 2 proteins kept as background\.$/))
  })
})

describe('round 12: a Settings value the workflow set off the CLI default says so', () => {
  it('Generate tags: Extension 3, FASTag default 0', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    expect(document.getElementById('h-extension')?.textContent).toBe('3 lets a seed of 3 grow to 9. FASTag default 0.')
    // A field at the CLI default has no such line.
    expect(document.getElementById('h-tag_length-c')).toBeNull()
  })
})

describe('round 12: Database reduction says its recipe is not validated, and what Sage cannot read', () => {
  it('a note under Settings; the Sage note for a .raw input', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await chooseTask('Database reduction')
    expect(document.querySelector('.settings-note')!.textContent).toMatch(/^The shortlist recipe this workflow sets .* is not validated/)
    mock.nextPickInput = '/d/run.raw'
    await click(fileButton('Choose file…'))
    expect(document.getElementById('out-search_config_out-d')!.textContent).toMatch(/Sage cannot read: convert it to mzML/)
  })
  it('a picked .zip that is no .d.zip is refused, with why', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    mock.nextPickInput = '/d/run.mzML.zip'
    await click(fileButton('Choose file…'))
    expect(screen.getByText(/is not a timsTOF \.d\.zip archive/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Choose file…' })).toBeTruthy()
  })
})

describe('round 12: Labels say the Da reason once', () => {
  it('no separate caveat when the call line gives the reason', () => {
    const label = parseReport(daLabel, '/d/run01.label.tsv')
    render(<DigestPanel reports={[label]} errors={[]} onOpen={() => {}} />)
    expect(screen.getByText('No label call')).toBeTruthy()
    expect(document.querySelector('#dg-label')!.closest('section')!.querySelector('.caveat')).toBeNull()
  })
})
