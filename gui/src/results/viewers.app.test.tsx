// App-level tests of the P4c viewers: the tables reach the Mass gaps &
// recon and Glyco tabs through the App's run and open-report flows, read
// only when their tab is shown.

import { act, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installMockBridge, type MockBridge } from '../testing/mockBridge'
import { click, goTo, pickSingle, renderApp, runButton } from '../testing/render'
import { applyLastUsed } from '../testing/lastUsed'
import humanRecon from '../fixtures/cli/v112-pxd014764-delta-ext3/run.recon.tsv?raw'
import humanDelta from '../fixtures/cli/v112-pxd014764-delta-ext3/run.delta.tsv?raw'
import humanMassgap from '../fixtures/cli/v112-pxd014764-delta-ext3/run.massgap.tsv?raw'
import humanGlyco from '../fixtures/cli/v112-pxd014764-delta-ext3/run.tags.glyco.tsv?raw'

const emitDone = (mock: MockBridge, runId: number | undefined, ok: boolean): Promise<void> =>
  act(async () => mock.emitDone({ ok, code: ok ? 0 : 1, runId }))

describe('P4c viewers in the app', () => {
  it('opens a recon table in Mass gaps & recon, and a glyco report in Glyco', async () => {
    const mock = installMockBridge()
    mock.reportFiles = { '/r/run.recon.tsv': humanRecon, '/r/run.tags.glyco.tsv': humanGlyco }
    mock.nextPickReport = '/r/run.recon.tsv'
    await renderApp(mock)
    await goTo('results')
    await click(screen.getByRole('button', { name: 'Open a digest, label or mass-gap report…' }))
    const recon = await screen.findByRole('tab', { name: 'Mass gaps & recon' })
    expect(recon.getAttribute('aria-selected')).toBe('true')
    expect((await screen.findByRole('grid', { name: 'Placements' })).getAttribute('aria-rowcount')).toBe('4707')
    mock.nextPickReport = '/r/run.tags.glyco.tsv'
    await click(screen.getByRole('button', { name: 'Open report…' }))
    expect((await screen.findByRole('tab', { name: 'Glyco' })).getAttribute('aria-selected')).toBe('true')
    expect((await screen.findByRole('grid', { name: 'Glyco spectra' })).getAttribute('aria-rowcount')).toBe('45')
    // The recon table stays open beside it.
    expect(screen.getByRole('tab', { name: 'Mass gaps & recon' })).toBeTruthy()
  })

  it('names an idXML -recon_id_out it cannot show', async () => {
    const mock = installMockBridge()
    mock.reportFiles = { '/r/run.recon.idXML': '<?xml version="1.0" encoding="UTF-8"?>\n<IdXML version="1.5">' }
    mock.nextPickReport = '/r/run.recon.idXML'
    await renderApp(mock)
    await goTo('results')
    await click(screen.getByRole('button', { name: 'Open a digest, label or mass-gap report…' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/run\.recon\.idXML is idXML; this viewer reads the mzTab form/)
  })

  it('a run with -recon_out, -delta_out, -massgap_out and -glyco: the tabs read the outputs the run resolved', async () => {
    const mock = installMockBridge()
    const paths = { recon_out: '/r/a.recon.tsv', delta_out: '/r/a.delta.tsv', massgap_out: '/r/a.massgap.tsv' }
    mock.settings.lastUsed = { ...paths, recon_fasta: '/db/human.fasta', glyco: true }
    mock.reportFiles = {
      [paths.recon_out]: humanRecon,
      [paths.delta_out]: humanDelta,
      [paths.massgap_out]: humanMassgap,
      '/r/a.tags.glyco.tsv': humanGlyco
    }
    await renderApp(mock)
    await applyLastUsed(5)
    await pickSingle(mock, '/r/a.mzML')
    await click(runButton())
    await emitDone(mock, 1, true)
    const tab = await screen.findByRole('tab', { name: 'Mass gaps & recon' })
    // Read only when shown: the run read its long-form report alone.
    expect(mock.reportCalls).toEqual([paths.massgap_out])
    await click(tab)
    expect((await screen.findByRole('grid', { name: 'Placements' })).getAttribute('aria-rowcount')).toBe('4707')
    expect(mock.reportCalls).toContain(paths.recon_out)
    expect(mock.reportCalls).toContain(paths.delta_out)
    await click(screen.getByRole('tab', { name: 'Glyco' }))
    expect((await screen.findByRole('grid', { name: 'Glyco spectra' })).getAttribute('aria-rowcount')).toBe('45')
    expect(mock.reportCalls).toContain('/r/a.tags.glyco.tsv')
  })
})
