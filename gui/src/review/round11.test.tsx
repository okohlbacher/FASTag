// Review round 11 (doc/GUI-REVIEW-2026-11-20.md): simplicity and
// intuitiveness per workflow.

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ReportTable from '../results/ReportTable'
import { SPECTRA } from '../api'
import { defaultOut } from '../app/paths'
import { jobOut } from '../run/batch'
import { buildOverview, leadTiles, shownTiles, triageFacts } from '../results/overview'
import { installMockBridge } from '../testing/mockBridge'
import { click, renderColdApp } from '../testing/render'
import { describe, expect, it } from 'vitest'
import DigestPanel from '../DigestPanel'
import { parseReport } from '../digestReport'
import silacLabel from '../fixtures/cli/v112-pxd014764-recon-ext3/run.label.tsv?raw'

describe('round 11: the Labels panel leads with the CLI label call', () => {
  it('a SILAC call is named, not "No label tag ends"', () => {
    const label = parseReport(silacLabel, '/d/run.label.tsv')
    render(<DigestPanel reports={[label]} errors={[]} onOpen={() => {}} />)
    expect(screen.getByText(/^Label call: SILAC$/)).toBeTruthy()
    expect(screen.queryByText('No label tag ends')).toBeNull()
  })
})

describe('round 11: Database reduction shows the protease and, with Comet, its template', () => {
  it('Protease in Settings; the Comet template only with Comet, and the fragment said', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await click(screen.getByRole('radio', { name: /^Database reduction/ }))
    const settings = screen.getByRole('region', { name: '3 Settings' })
    expect(within(settings).queryByLabelText(/^Protease/)).not.toBeNull()
    expect(document.getElementById('p-search_config_template')).toBeNull()
    await act(async () => void fireEvent.change(document.getElementById('p-search_engine')!, { target: { value: 'comet' } }))
    expect(within(settings).getByText(/^Your comet\.params/)).toBeTruthy()
    expect(document.getElementById('p-search_config_template')).not.toBeNull()
    expect(document.getElementById('out-search_config_out-d')!.textContent).toMatch(/a Comet fragment: merge it into your comet\.params/)
  })
})

describe('round 11: Triage shows its candidates; an unscored census is no ranking', () => {
  it('the candidate filter keeps the triage=1 rows and counts them', async () => {
    const mock = installMockBridge()
    mock.reportFiles['/d/a.census_sorted.tsv'] =
      'ident_rank\tspectrum\tstatus\tbest_evalue\tident_score\tidentified\ttriage\n1\ts1\ttagged\t0.1\t0.9\t0\t1\n2\ts2\ttagged\t5\t0.5\t1\t0\n3\ts3\tno_tags\t\t0.1\t0\t0\n'
    render(<ReportTable kind="triage" path="/d/a.census_sorted.tsv" />)
    await waitFor(() => expect(document.querySelector('.report-sum')?.textContent).toMatch(/; 1 triage candidates;/))
    await click(screen.getByRole('radio', { name: /^Triage candidates/ }))
    const grid = screen.getByRole('grid', { name: 'Spectra ranked by identifiability' })
    expect(within(grid).getAllByRole('row')).toHaveLength(2)
    expect(within(grid).getAllByRole('columnheader').map((c) => c.textContent?.replace(/[▴▾ ]+$/, ''))).toContain('Triage candidate')
  })
  it('a census without a score says file order and makes no ranking claim', async () => {
    const mock = installMockBridge()
    mock.reportFiles['/d/a.census.tsv'] = 'index\tspectrum\tstatus\tn_peaks\n0\ts1\ttagged\t10\n1\ts2\tno_tags\t4\n'
    render(<ReportTable kind="triage" path="/d/a.census.tsv" />)
    await waitFor(() => expect(document.querySelector('.report-sum')?.textContent).toMatch(/2 MS2 spectra in file order \(no identifiability score\)/))
    expect(document.body.textContent).not.toMatch(/ranked by how identifiable/)
    expect(screen.getByRole('grid', { name: 'Spectra, one row each' })).toBeTruthy()
  })
})

describe('round 11: the Triage Overview names the candidates', () => {
  it('a Triage candidates tile after Identified', () => {
    const t = 'ident_rank\tident_score\tidentified\ttriage\n1\t0.9\t0\t1\n2\t0.5\t1\t0\n3\t0.1\t0\t1\n'
    expect(triageFacts(t)!.candidates).toBe(2)
    const params = { census: true, census_sorted_out: 'c.tsv', census_ids: '/d/a.idXML' }
    const o = buildOverview({ log: ['3 MS2 spectra, 5 tags'], reports: [], species: null, census: null, params, instrument: null, triage: t })
    const lead = leadTiles(shownTiles(o, params), 'triage')
    expect(lead.figures.slice(0, 3).map((f) => f.id)).toEqual(['ident-score', 'identified', 'candidates'])
    expect(lead.figures[2].value).toBe('2')
  })
})

describe('round 11: vendor input the bundled CLI reads', () => {
  it('the picker offers .raw and .d.zip; a .d run is named as the run', () => {
    expect(SPECTRA[0].extensions).toEqual(expect.arrayContaining(['raw', 'zip']))
    expect(defaultOut('/d/run.raw')).toBe('/d/run.tags.tsv')
    expect(defaultOut('/d/run.d.zip')).toBe('/d/run.tags.tsv')
    expect(defaultOut('/d/run.d')).toBe('/d/run.tags.tsv')
    expect(defaultOut('/d/run.d/')).toBe('/d/run.tags.tsv')
    expect(jobOut('/d/run.d.zip', '/out')).toBe('/out/run.tags.tsv')
    expect(jobOut('/d/run.mzML', '/out')).toBe('/out/run.tags.tsv')
  })
})
