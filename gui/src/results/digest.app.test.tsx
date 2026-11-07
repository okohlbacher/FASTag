// App-level tests of the digest tab, moved unchanged from App.test.tsx (GUI P1
// PR c): reports reach the tab through the App's run and open-report flows.

import { act, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installMockBridge, type MockBridge } from '../testing/mockBridge'
import { click, goTo, pickSingle, renderApp, runButton } from '../testing/render'
import { applyLastUsed, formValue } from '../testing/lastUsed'
import digestTsv from '../fixtures/digest.tsv?raw'
import nocallTsv from '../fixtures/digest_nocall.tsv?raw'
import labelTsv from '../fixtures/label.tsv?raw'
import massgapTsv from '../fixtures/massgap.tsv?raw'

const emitDone = (mock: MockBridge, runId: number | undefined, ok: boolean): Promise<void> =>
  act(async () => mock.emitDone({ ok, code: ok ? 0 : 1, runId }))

describe('digest tab', () => {
  const paths = {
    digest_out: '/r/a.digest.tsv',
    label_out: '/r/a.label.tsv',
    massgap_out: '/r/a.massgap.tsv',
    recon_out: '/r/a.recon.tsv'
  }

  it('is always offered, and selected only when a run writes a report', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await emitDone(mock, 1, true)
    await screen.findByText('Showing 3 of 3')
    expect(screen.getByRole('tab', { name: /Digest/ }).getAttribute('aria-selected')).toBe('false')
  })

  it('shows the call, the logos, the labels and the gaps after a run', async () => {
    const mock = installMockBridge()
    // recon_out needs a database, or the CLI refuses the run (and Run is disabled).
    mock.settings.lastUsed = { ...paths, recon_fasta: '/db/human.fasta' }
    mock.reportFiles = { [paths.digest_out]: digestTsv, [paths.label_out]: labelTsv, [paths.massgap_out]: massgapTsv }
    await renderApp(mock)
    await applyLastUsed(5)
    expect(await formValue('label_out')).toBe(paths.label_out) // guard: the report paths are in the form
    await pickSingle(mock, '/r/a.mzML')
    await click(runButton())
    await emitDone(mock, 1, true)
    const tab = await screen.findByRole('tab', { name: /Digest/ })
    expect(tab.getAttribute('aria-selected')).toBe('true')
    expect(mock.reportCalls).toEqual([paths.digest_out, paths.label_out, paths.massgap_out])
    const stat = (label: string): string | null | undefined => screen.getByText(label).nextElementSibling?.textContent
    expect(stat('Runner-up, other enzyme class')).toBe('Lys-C')
    expect(stat('Lead over runner-up (log-likelihood per tag end)')).toBe('1.4788')
    const said = screen.getAllByText('Trypsin fits 1.48 log-likelihood per tag end better than Lys-C.')
    expect(said.map((e) => e.tagName)).toEqual(['LI', 'TD']) // the sentence list, and the raw rows
    const logos = screen.getAllByRole('img').filter((e) => e.tagName === 'svg')
    expect(logos.map((l) => l.getAttribute('aria-label')?.split(':')[0])).toEqual([
      'Observed',
      'Called',
      'Runner-up'
    ])
    expect(logos[0].getAttribute('aria-label')).toMatch(/P1 K /)
    expect(screen.getAllByText('TMTpro')).toHaveLength(1)
    expect(screen.getByText(/the 40 fullest of 2,284 bins/)).toBeDefined()
    await click(screen.getByRole('button', { name: 'Show all 2,284 bins' }))
    expect(screen.queryByText(/fullest of/)).toBeNull()
    // Rendering all 2,284 histogram bins takes ~6 s on a GitHub runner (~2 s locally).
  }, 20000)

  it('shows a no-call with its reason', async () => {
    const mock = installMockBridge()
    mock.settings.lastUsed = { digest_out: paths.digest_out }
    mock.reportFiles = { [paths.digest_out]: nocallTsv }
    await renderApp(mock)
    await applyLastUsed(1)
    expect(await formValue('digest_out')).toBe(paths.digest_out) // guard: the digest report is asked for
    await pickSingle(mock, '/r/a.mzML')
    await click(runButton())
    await emitDone(mock, 1, true)
    await screen.findByText('No call')
    expect(screen.getByText('Reason').nextElementSibling?.textContent).toBe(
      'the fragment tolerance is in Da · also the first MS2 peaks lie above m/z 147.21 (the y1 ion of a C-terminal K, plus 0.1), so a K before the cut is missed, too few terminal tags'
    )
    expect(screen.queryByText(/Could not check/)).toBeNull()
  })

  it('names the ion_counts rule of 1.10.0 when it decides the no-call', async () => {
    // The 1.10.0 no-call fixture with ion_counts as the deciding rule, the
    // state FASTag writes for an MGF of ion-count intensities.
    const tsv = nocallTsv
      .replace(/^call\treason\tlow_resolution\t/m, 'call\treason\tion_counts\t')
      .replace(/^nocall\tlow_resolution\tyes\t/m, 'nocall\tlow_resolution\tno\t')
      .replace(/^nocall\tion_counts\tno\t/m, 'nocall\tion_counts\tyes\t')
    expect(tsv).toMatch(/^nocall\tion_counts\tyes\t/m)
    const mock = installMockBridge()
    mock.settings.lastUsed = { digest_out: paths.digest_out }
    mock.reportFiles = { [paths.digest_out]: tsv }
    await renderApp(mock)
    await applyLastUsed(1)
    expect(await formValue('digest_out')).toBe(paths.digest_out) // guard: the digest report is asked for
    await pickSingle(mock, '/r/a.mzML')
    await click(runButton())
    await emitDone(mock, 1, true)
    await screen.findByText('No call')
    expect(screen.getByText('Reason').nextElementSibling?.textContent).toBe(
      'no instrument is named and the intensities are ion counts, as on a timsTOF · also the first MS2 peaks lie above m/z 147.21 (the y1 ion of a C-terminal K, plus 0.1), so a K before the cut is missed, too few terminal tags'
    )
  })

  it('reports a file that is not a report instead of failing', async () => {
    const mock = installMockBridge()
    mock.settings.lastUsed = { digest_out: paths.digest_out }
    mock.reportFiles = { [paths.digest_out]: 'spectrum\ttag\n' }
    await renderApp(mock)
    await applyLastUsed(1)
    expect(await formValue('digest_out')).toBe(paths.digest_out) // guard: the digest report is asked for
    await pickSingle(mock, '/r/a.mzML')
    await click(runButton())
    await emitDone(mock, 1, true)
    expect((await screen.findByRole('alert')).textContent).toMatch(/Cannot read \/r\/a.digest.tsv: not a FASTag report/)
  })

  it('closes the reports of another input when one is opened', async () => {
    const mock = installMockBridge()
    const other = digestTsv.replace(/^run\tversion.*$/m, (l) => `${l}\nrun\tinput\tother.mzML\t-\tThe spectra were read from other.mzML.`)
    mock.nextPickReport = '/r/b.label.tsv'
    mock.reportFiles = { '/r/b.label.tsv': labelTsv, '/r/o.digest.tsv': other }
    await renderApp(mock)
    await goTo('results') // the empty results pane
    await click(screen.getByRole('button', { name: 'Open a digest, label or mass-gap report…' }))
    await screen.findAllByText('TMTpro')
    mock.nextPickReport = '/r/o.digest.tsv'
    await click(screen.getByRole('button', { name: 'Open another report…' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/o.digest.tsv is from another input \(other.mzML\)/)
    expect(screen.queryAllByText('TMTpro')).toHaveLength(0)
    expect(screen.getByText('o.digest.tsv')).toBeDefined()
  })

  it('opens a report from the empty results pane', async () => {
    const mock = installMockBridge()
    mock.nextPickReport = '/r/b.label.tsv'
    mock.reportFiles = { '/r/b.label.tsv': labelTsv }
    await renderApp(mock)
    await goTo('results') // the empty results pane
    await click(screen.getByRole('button', { name: 'Open a digest, label or mass-gap report…' }))
    await screen.findAllByText('TMTpro')
    expect(screen.getByRole('tab', { name: /Digest/ }).getAttribute('aria-selected')).toBe('true')
  })
})
