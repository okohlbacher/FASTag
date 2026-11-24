// The Overview in the app (GUI-DESIGN 10 P2b acceptance): "Characterize a
// run" on a gate fixture reaches the Overview in 4 actions (select task,
// add file, Run, open toast); without a FASTA the alkylation tile says "not assessed (needs
// a FASTA)" and the C+57.021 line says "default"; the Results pane shows the
// running state while the run goes; a tile's action turns its option on and
// runs again. The CLI output is FASTag integration/1.12 on PXD003531
// (src/fixtures/cli/v112-pxd003531).

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installMockBridge, type MockBridge } from '../testing/mockBridge'
import { click, goTo, renderApp, renderCharacterizeApp, runButton, fileButton } from '../testing/render'
import { CLI_CASES, logLines, type CliCase } from '../testing/cliFixtures'
import { applyLastUsed } from '../testing/lastUsed'
import { speciesFromTsv } from '../testing/speciesTsv'
import ALKYLATION from '../fixtures/alkylation.tsv?raw'

function gate(mock: MockBridge, c: CliCase, stem = '/d/run01'): void {
  mock.nextPickInput = `${stem}.mzML`
  mock.reportFiles = { [`${stem}.digest.tsv`]: c.digest, [`${stem}.label.tsv`]: c.label }
  if (c.massgap) mock.reportFiles[`${stem}.massgap.tsv`] = c.massgap
  mock.speciesResult = speciesFromTsv(c.species, `${stem}.tags.species.tsv`)
}

// The simulated CLI: the fixture's log, then a successful exit.
const finish = (mock: MockBridge, c: CliCase, runId?: number): Promise<void> =>
  act(async () => {
    for (const l of logLines(c)) mock.emitLog(l)
    mock.emitDone({ ok: true, code: 0, runId: runId ?? mock.lastRunId })
  })

const selectedTab = (): string | null => screen.getByRole('tab', { selected: true }).textContent
const tile = (name: string): HTMLElement => screen.getByRole('region', { name })
const shownView = (): string | undefined =>
  [...document.querySelectorAll<HTMLElement>('.view')].find((v) => !v.hidden)?.dataset.view

describe('Overview in the app', () => {
  it('Characterize a run reaches the Overview in 4 actions: select task, add file, Run, open toast', async () => {
    const mock = installMockBridge()
    gate(mock, CLI_CASES.v112)
    await renderCharacterizeApp(mock)
    // 1: select Characterize (in the helper). 2: add the file.
    await click(fileButton('Choose file…'))
    // 3: Run.
    await click(runButton())
    expect(mock.runCalls).toHaveLength(1)
    // The user looks at the form while it runs; the run ends elsewhere.
    await goTo('setup')
    await finish(mock, CLI_CASES.v112)
    // 4: the toast's Open results.
    const toast = await screen.findByRole('status', { name: 'Run finished' })
    await click(within(toast).getByRole('button', { name: 'Open results' }))
    expect(shownView()).toBe('results')
    await waitFor(() => expect(selectedTab()).toBe('Overview'))
    expect(within(tile('Protease')).getByText('Trypsin')).toBeDefined()
    expect(within(tile('Top genus')).getByText('Homo')).toBeDefined()
    expect(within(tile('MS2 spectra')).getByText('2,738')).toBeDefined()
  })

  it('Characterize: no alkylation tile once its report is turned off; the C+57.021 line says "default"', async () => {
    const mock = installMockBridge()
    gate(mock, CLI_CASES.v112)
    await renderCharacterizeApp(mock)
    await click(fileButton('Choose file…'))
    // On by default from 1.16: the user turns it off.
    await click(document.getElementById('out-alkylation_out')!)
    await click(runButton())
    await finish(mock, CLI_CASES.v112)
    await waitFor(() => expect(selectedTab()).toBe('Overview'))
    expect(mock.runCalls[0].params.alkylation_out ?? '').toBe('') // guard: turned off
    // The Overview names the workflow (in the page header) and shows no tile for a report nobody asked for.
    expect(document.querySelector('.view-results .page-header .run-workflow')!.textContent).toContain('Characterize a run')
    expect(screen.queryByRole('region', { name: 'Alkylation' })).toBeNull()
    const row = within(screen.getByRole('table', { name: 'Suggested search settings' })).getByRole('row', { name: /Fixed cysteine modification/ })
    expect(within(row).getByText('default')).toBeDefined()
    expect(row.textContent).toMatch(/alkylation not assessed \(alkylation report not written\)/)
  })

  it('the Results pane shows the running state, then the Overview', async () => {
    const mock = installMockBridge()
    gate(mock, CLI_CASES.v112)
    await renderCharacterizeApp(mock)
    await click(fileButton('Choose file…'))
    await click(runButton())
    expect(shownView()).toBe('results')
    await act(async () => {
      mock.emitPhase('Tagging spectra')
      mock.emitProgress({ done: 50, total: 200, ratePerSec: 100, etaSec: 2 })
    })
    const running = screen.getByRole('region', { name: 'Running' })
    expect(running.textContent).toMatch(/run01\.mzML — Tagging spectra 25%/)
    expect(within(running).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50')
    // Outside Setup one progress element: the pane's, not a second in the pill.
    expect(screen.getAllByRole('progressbar')).toHaveLength(1)
    await finish(mock, CLI_CASES.v112)
    expect(screen.queryByRole('region', { name: 'Running' })).toBeNull()
    await waitFor(() => expect(selectedTab()).toBe('Overview'))
  })

  it('the alkylation report, on by default, is read: its no call and the reason in the tile and the Digest tab', async () => {
    const mock = installMockBridge()
    gate(mock, CLI_CASES.v112)
    mock.reportFiles['/d/run01.alkylation.tsv'] = ALKYLATION
    await renderCharacterizeApp(mock)
    await click(fileButton('Choose file…'))
    // No click: Characterize writes it by default (1.16).
    await click(runButton())
    expect(mock.runCalls[0].params.alkylation_out).toBe('/d/run01.alkylation.tsv')
    await finish(mock, CLI_CASES.v112)
    await waitFor(() => expect(selectedTab()).toBe('Overview'))
    expect(within(tile('Alkylation')).getByText('no call')).toBeDefined()
    expect(tile('Alkylation').textContent).toMatch(/too few spectra with one cysteine/)
    // No FASTA action: the report places tags on a shipped proteome.
    expect(within(tile('Alkylation')).queryByRole('button', { name: /FASTA/ })).toBeNull()
    await click(screen.getByRole('tab', { name: /^Digest/ }))
    expect(screen.getByRole('region', { name: 'Alkylation' }).textContent).toMatch(/too few spectra with one cysteine/)
  })

  it('a FASTA run that placed no tag says "not assessed", never an absence of alkylation', async () => {
    // What the action sent before the fix: Characterize's extension 2 with
    // -recon_fasta (here set by the last-used offer). The CLI output is that
    // exact command's (v112-pxd014764-recon-ext2/cmd.txt): 0 placed spectra.
    const mock = installMockBridge()
    const c = CLI_CASES.v112ReconExt2
    mock.settings.lastUsed = { ...c.params, recon_fasta: '/db/human.fasta' }
    gate(mock, c)
    await renderApp(mock)
    await click(fileButton())
    await applyLastUsed(9)
    await goTo('setup')
    await click(runButton())
    const p = mock.runCalls[0].params
    expect([p.extension, p.recon_fasta, p.massgap_out]).toEqual(['2', '/db/human.fasta', '/d/run01.massgap.tsv'])
    await finish(mock, c)
    await click(await screen.findByRole('tab', { name: 'Overview' }))
    expect(within(tile('Alkylation')).getByText('not assessed (no tag placed in the FASTA)')).toBeDefined()
    expect(within(tile('Alkylation')).queryByText('no call (counts only)')).toBeNull()
    expect(tile('Alkylation').textContent).toMatch(/tags reach at most 7 residues .* the recon index needs 8/)
    await click(within(tile('Alkylation')).getByRole('button', { name: 'Run again with extension 3' }))
    await waitFor(() => expect(mock.runCalls).toHaveLength(2))
    expect(mock.runCalls[1].params.extension).toBe('3')
  })

  it('focus does not fall to the page body when the run ends: the selected tab gets it', async () => {
    const mock = installMockBridge()
    gate(mock, CLI_CASES.v112)
    await renderCharacterizeApp(mock)
    await click(fileButton('Choose file…'))
    await click(runButton())
    const showLog = within(screen.getByRole('region', { name: 'Running' })).getByRole('button', { name: 'Show log' })
    showLog.focus()
    expect(document.activeElement).toBe(showLog)
    await finish(mock, CLI_CASES.v112)
    await waitFor(() => expect(selectedTab()).toBe('Overview'))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Overview' })))
  })

  // Cancel is the run status pill's (the run's one Cancel on every view).
  it('focus does not fall to the page body after Cancel: the Results view gets it', async () => {
    const mock = installMockBridge()
    gate(mock, CLI_CASES.v112)
    await renderCharacterizeApp(mock)
    await click(fileButton('Choose file…'))
    await click(runButton())
    expect(within(screen.getByRole('region', { name: 'Running' })).queryByRole('button', { name: 'Cancel' })).toBeNull()
    const cancel = within(screen.getByRole('group', { name: 'Run status' })).getByRole('button', { name: 'Cancel' })
    cancel.focus()
    await click(cancel)
    await act(async () => {
      mock.emitDone({ ok: false, code: null, cancelled: true, runId: mock.lastRunId })
    })
    expect(screen.queryByRole('region', { name: 'Running' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector('.view[data-view="results"]')))
  })

  it('from the defaults: the Tags tab, an Overview of the spectra and tags only', async () => {
    const mock = installMockBridge()
    gate(mock, CLI_CASES.v112)
    await renderApp(mock) // FASTag's defaults: no label report
    await click(fileButton())
    await click(runButton())
    expect(mock.runCalls[0].params.label_out ?? '').toBe('') // guard
    await finish(mock, CLI_CASES.v112)
    // Not a characterizing task: the tab it lands on is as before P2b.
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Overview' })).toBeDefined())
    expect(selectedTab()).not.toBe('Overview')
    await click(screen.getByRole('tab', { name: 'Overview' }))
    // No "not assessed" tile for a report nobody asked for.
    expect(screen.queryByRole('region', { name: 'Label' })).toBeNull()
    expect(within(tile('MS2 spectra')).getByText('2,738')).toBeDefined()
    expect(tile('Tags')).toBeDefined()
  })
})
