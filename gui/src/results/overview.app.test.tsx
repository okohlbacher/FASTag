// The Overview in the app (GUI-DESIGN 10 P2b acceptance): "Characterize a
// run" on a gate fixture reaches the Overview in 3 actions (add file, Run,
// open toast); without a FASTA the alkylation tile says "not assessed (needs
// a FASTA)" and the C+57.021 line says "default"; the Results pane shows the
// running state while the run goes; a tile's action turns its option on and
// runs again. The CLI output is FASTag integration/1.12 on PXD003531
// (src/fixtures/cli/v112-pxd003531).

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installMockBridge, type MockBridge } from '../testing/mockBridge'
import { click, goTo, renderApp, renderColdApp, runButton } from '../testing/render'
import { CLI_CASES, logLines, type CliCase } from '../testing/cliFixtures'
import { speciesFromTsv } from '../testing/speciesTsv'

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
  it('Characterize a run reaches the Overview in 3 actions: add file, Run, open toast', async () => {
    const mock = installMockBridge()
    gate(mock, CLI_CASES.v112)
    await renderColdApp(mock)
    // 1: add the file.
    await click(screen.getByRole('button', { name: 'Choose file…' }))
    // 2: Run.
    await click(runButton())
    expect(mock.runCalls).toHaveLength(1)
    // The user looks at the form while it runs; the run ends elsewhere.
    await goTo('setup')
    await finish(mock, CLI_CASES.v112)
    // 3: the toast's Open results.
    const toast = await screen.findByRole('status', { name: 'Run finished' })
    await click(within(toast).getByRole('button', { name: 'Open results' }))
    expect(shownView()).toBe('results')
    await waitFor(() => expect(selectedTab()).toBe('Overview'))
    expect(within(tile('Protease')).getByText('Trypsin')).toBeDefined()
    expect(within(tile('Top genus')).getByText('Homo')).toBeDefined()
    expect(within(tile('MS2 spectra')).getByText('2,738')).toBeDefined()
  })

  it('without a FASTA: no alkylation call, and the C+57.021 line says "default"', async () => {
    const mock = installMockBridge()
    gate(mock, CLI_CASES.v112)
    await renderColdApp(mock)
    await click(screen.getByRole('button', { name: 'Choose file…' }))
    await click(runButton())
    await finish(mock, CLI_CASES.v112)
    await waitFor(() => expect(selectedTab()).toBe('Overview'))
    expect(mock.runCalls[0].params.fasta ?? '').toBe('') // guard: the run had no FASTA
    expect(within(tile('Alkylation')).getByText('not assessed (needs a FASTA)')).toBeDefined()
    const row = within(screen.getByRole('table', { name: 'Suggested search settings' })).getByRole('row', { name: /fixed C\+57\.021/ })
    expect(within(row).getByText('default')).toBeDefined()
    expect(row.textContent).toMatch(/alkylation not assessed \(no FASTA\)/)
  })

  it('the Results pane shows the running state, then the Overview', async () => {
    const mock = installMockBridge()
    gate(mock, CLI_CASES.v112)
    await renderColdApp(mock)
    await click(screen.getByRole('button', { name: 'Choose file…' }))
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

  it('"Add FASTA and run again" picks a FASTA, turns the mass-gap report on and runs again', async () => {
    const mock = installMockBridge()
    gate(mock, CLI_CASES.v112)
    await renderColdApp(mock)
    await click(screen.getByRole('button', { name: 'Choose file…' }))
    await click(runButton())
    await finish(mock, CLI_CASES.v112)
    await waitFor(() => expect(selectedTab()).toBe('Overview'))
    gate(mock, CLI_CASES.v112Fasta)
    mock.nextPickInput = '/db/human.fasta'
    mock.existingOutputs = []
    await click(within(tile('Alkylation')).getByRole('button', { name: 'Add FASTA and run again' }))
    await waitFor(() => expect(mock.runCalls).toHaveLength(2))
    expect(mock.pickFileCalls[mock.pickFileCalls.length - 1]).toEqual({ kind: 'open', formats: expect.arrayContaining(['fasta']) })
    const p = mock.runCalls[1].params
    expect([p.recon_fasta, p.recon_out, p.massgap_out]).toEqual(['/db/human.fasta', '/d/run01.recon.tsv', '/d/run01.massgap.tsv'])
    await finish(mock, CLI_CASES.v112Fasta, 2)
    await waitFor(() => expect(within(tile('Alkylation')).getByText('no call (counts only)')).toBeDefined())
    // The form holds what the run was given: a plain Run sends it again.
    await click(runButton())
    await waitFor(() => expect(mock.runCalls).toHaveLength(3))
    expect(mock.runCalls[2].params.recon_fasta).toBe('/db/human.fasta')
  })

  it('from the defaults: the old landing tab, the Overview offered, and "Turn on and run again"', async () => {
    const mock = installMockBridge()
    gate(mock, CLI_CASES.v112)
    await renderApp(mock) // FASTag's defaults: no label report
    await click(screen.getByRole('button', { name: /^(Choose file|Change)…$/ }))
    await click(runButton())
    expect(mock.runCalls[0].params.label_out ?? '').toBe('') // guard
    await finish(mock, CLI_CASES.v112)
    // Not a characterizing task: the tab it lands on is as before P2b.
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Overview' })).toBeDefined())
    expect(selectedTab()).not.toBe('Overview')
    await click(screen.getByRole('tab', { name: 'Overview' }))
    expect(within(tile('Label')).getByText('not assessed')).toBeDefined()
    await click(within(tile('Label')).getByRole('button', { name: 'Turn on and run again' }))
    await waitFor(() => expect(mock.runCalls).toHaveLength(2))
    expect(mock.runCalls[1].params.label_out).toBe('/d/run01.label.tsv')
  })
})
