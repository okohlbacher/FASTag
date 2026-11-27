// App-level tests of the P4c viewers: the tables reach the Mass gaps &
// recon and Glyco tabs through the App's run and open-report flows, read
// only when their tab is shown.

import { act, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { installMockBridge, type MockBridge } from '../testing/mockBridge'
import { click, flush, goTo, pickSingle, renderApp, runButton } from '../testing/render'
import { applyLastUsed } from '../testing/lastUsed'
import humanRecon from '../fixtures/cli/v112-pxd014764-delta-ext3/run.recon.tsv?raw'
import humanDelta from '../fixtures/cli/v112-pxd014764-delta-ext3/run.delta.tsv?raw'
import humanMassgap from '../fixtures/cli/v112-pxd014764-delta-ext3/run.massgap.tsv?raw'
import humanGlyco from '../fixtures/cli/v112-pxd014764-delta-ext3/run.tags.glyco.tsv?raw'
import ext2Massgap from '../fixtures/cli/v112-pxd014764-recon-ext2/run.massgap.tsv?raw'

const emitDone = (mock: MockBridge, runId: number | undefined, ok: boolean): Promise<void> =>
  act(async () => mock.emitDone({ ok, code: ok ? 0 : 1, runId }))

describe('P4c viewers in the app', () => {
  it('opens a recon table in Mass shifts, and a glyco report in Glyco', async () => {
    const mock = installMockBridge()
    mock.reportFiles = { '/r/run.recon.tsv': humanRecon, '/r/run.tags.glyco.tsv': humanGlyco }
    mock.nextPickReport = '/r/run.recon.tsv'
    await renderApp(mock)
    await goTo('results')
    await click(screen.getByRole('button', { name: 'Open report…' }))
    const recon = await screen.findByRole('tab', { name: 'Mass shifts' })
    expect(recon.getAttribute('aria-selected')).toBe('true')
    expect((await screen.findByRole('grid', { name: 'Placements' })).getAttribute('aria-rowcount')).toBe('3890')
    mock.nextPickReport = '/r/run.tags.glyco.tsv'
    await click(screen.getByRole('button', { name: 'Open report…' }))
    expect((await screen.findByRole('tab', { name: 'Glyco' })).getAttribute('aria-selected')).toBe('true')
    expect((await screen.findByRole('grid', { name: 'Glyco spectra' })).getAttribute('aria-rowcount')).toBe('45')
    // The recon table stays open beside it.
    expect(screen.getByRole('tab', { name: 'Mass shifts' })).toBeTruthy()
  })

  // Feedback 20261124T095212Z: an idXML -recon_id_out is a file of the run,
  // not a read error. Mass shifts lists it with Reveal and Open, no alert.
  it('lists an idXML -recon_id_out it does not show as a file to reveal or open, with no error', async () => {
    const mock = installMockBridge()
    mock.reportFiles = { '/r/run.recon.idXML': '<?xml version="1.0" encoding="UTF-8"?>\n<IdXML version="1.5">' }
    mock.nextPickReport = '/r/run.recon.idXML'
    await renderApp(mock)
    await goTo('results')
    await click(screen.getByRole('button', { name: 'Open report…' }))
    expect((await screen.findByRole('tab', { name: 'Mass shifts' })).getAttribute('aria-selected')).toBe('true')
    const files = await screen.findByRole('group', { name: 'Identification files' })
    expect(files.textContent).toMatch(/idXML, for identification tools\. Only the mzTab form is shown here\./)
    expect(screen.queryByRole('alert')).toBeNull()
    // Not read whole: the viewer does not parse it.
    expect(mock.reportCalls).not.toContain('/r/run.recon.idXML')
    await click(within(files).getByRole('button', { name: /: placements as identifications \(run\.recon\.idXML\)$/ }))
    expect(mock.revealCalls).toEqual([{ path: '/r/run.recon.idXML', folder: false }])
    await click(within(files).getByRole('button', { name: 'Open placements as identifications (run.recon.idXML) with the default app' }))
    expect(mock.openCalls).toEqual(['/r/run.recon.idXML'])
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('lists an mzid -recon_id_out, and a .mzTab that holds XML, as files with no error', async () => {
    const mock = installMockBridge()
    mock.reportFiles = {
      '/r/run.recon_id.mzid': '<?xml version="1.0"?>\n<MzIdentML version="1.2.0">',
      '/r/odd.recon_id.mzTab': '<?xml version="1.0"?>\n<IdXML version="1.5">'
    }
    mock.nextPickReport = '/r/run.recon_id.mzid'
    await renderApp(mock)
    await goTo('results')
    await click(screen.getByRole('button', { name: 'Open report…' }))
    expect((await screen.findByRole('group', { name: 'Identification files' })).textContent).toMatch(/mzIdentML, for identification tools/)
    expect(screen.queryByRole('alert')).toBeNull()
    mock.nextPickReport = '/r/odd.recon_id.mzTab'
    await click(screen.getByRole('button', { name: 'Open report…' }))
    await vi.waitFor(() => expect(screen.getByRole('group', { name: 'Identification files' }).textContent).toMatch(/Not an mzTab file: open it in an identification tool\./))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // The GUI's own choice: a Mass-shift survey run with the identifications
  // product writes the mzTab the tab shows; an idXML a preset kept is listed.
  it('a run whose -recon_id_out is idXML shows the mass shifts and lists the file, with no alert', async () => {
    const mock = installMockBridge()
    const paths = { recon_out: '/r/a.recon.tsv', delta_out: '/r/a.delta.tsv', recon_id_out: '/r/a.recon_id.idXML' }
    mock.settings.lastUsed = { ...paths, recon_fasta: '/db/human.fasta' }
    mock.reportFiles = {
      [paths.recon_out]: humanRecon,
      [paths.delta_out]: humanDelta,
      [paths.recon_id_out]: '<?xml version="1.0"?>\n<IdXML version="1.5">'
    }
    await renderApp(mock)
    await applyLastUsed(4)
    await pickSingle(mock, '/r/a.mzML')
    await click(runButton())
    await emitDone(mock, 1, true)
    await click(await screen.findByRole('tab', { name: 'Mass shifts' }))
    await screen.findByRole('grid', { name: 'Mass-shift table' })
    expect(within(await screen.findByRole('group', { name: 'Identification files' })).getByRole('button', { name: /: placements as identifications \(a\.recon_id\.idXML\)$/ })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    // The table buttons offer no identifications table for an idXML.
    expect(screen.queryByRole('button', { name: 'Identifications (mzTab)' })).toBeNull()
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
    const tab = await screen.findByRole('tab', { name: 'Mass shifts' })
    // Read only when shown: the run read its long-form report, and the
    // mass-shift table for the Overview's top shift; the placements wait.
    expect(mock.reportCalls).toEqual([paths.massgap_out, paths.delta_out])
    await click(tab)
    // Round 11: the mass-shift table leads; the placements are one click away.
    await screen.findByRole('grid', { name: 'Mass-shift table' })
    await click(await screen.findByRole('button', { name: 'Placements' }))
    expect((await screen.findByRole('grid', { name: 'Placements' })).getAttribute('aria-rowcount')).toBe('3890')
    expect(mock.reportCalls).toContain(paths.recon_out)
    expect(mock.reportCalls).toContain(paths.delta_out)
    await click(screen.getByRole('tab', { name: 'Glyco' }))
    expect((await screen.findByRole('grid', { name: 'Glyco spectra' })).getAttribute('aria-rowcount')).toBe('45')
    expect(mock.reportCalls).toContain('/r/a.tags.glyco.tsv')
  })
  // Review fix: a table of another run must not mix with the run shown.
  it("opening B's delta.tsv while A's massgap is shown closes A's report, with a note", async () => {
    const mock = installMockBridge()
    mock.reportFiles = { '/a/run.massgap.tsv': humanMassgap, '/b/run.delta.tsv': humanDelta }
    mock.nextPickReport = '/a/run.massgap.tsv'
    await renderApp(mock)
    await goTo('results')
    await click(screen.getByRole('button', { name: 'Open report…' }))
    await click(await screen.findByRole('tab', { name: 'Mass shifts' }))
    expect(await screen.findByText('run.massgap.tsv', { selector: 'code' })).toBeTruthy()
    mock.nextPickReport = '/b/run.delta.tsv'
    await click(screen.getByRole('button', { name: 'Open report…' }))
    await flush()
    expect(screen.getByRole('tab', { name: 'Mass shifts' }).getAttribute('aria-selected')).toBe('true')
    const view = document.querySelector('.recon-view') as HTMLElement
    // Only B's file is named as a source; A's massgap (and its Placed spectra) is gone.
    expect(within(view).getAllByText(/\.tsv$/, { selector: 'code.src' }).map((c) => c.getAttribute('title'))).toEqual(['/b/run.delta.tsv'])
    expect(within(view).getByRole('status', { name: '' }).textContent).toBe('run.delta.tsv is from another run; /a/run.massgap.tsv was closed.')
    // The note is where report notes are, too.
    await click(screen.getByRole('tab', { name: 'Digest' }))
    expect(screen.getByText(/run\.delta\.tsv is from another run; \/a\/run\.massgap\.tsv was closed\./)).toBeTruthy()
  })

  it("a table of the same run (folder and stem) joins A's report without a note", async () => {
    const mock = installMockBridge()
    mock.reportFiles = { '/a/run.massgap.tsv': humanMassgap, '/a/run.delta.tsv': humanDelta, '/a/other.recon.tsv': humanRecon }
    mock.nextPickReport = '/a/run.massgap.tsv'
    await renderApp(mock)
    await goTo('results')
    await click(screen.getByRole('button', { name: 'Open report…' }))
    mock.nextPickReport = '/a/run.delta.tsv'
    await click(screen.getByRole('button', { name: 'Open report…' }))
    await flush()
    const srcs = (): (string | null)[] => Array.from(document.querySelectorAll('.recon-view code.src')).map((c) => c.getAttribute('title'))
    expect(srcs()).toEqual(['/a/run.massgap.tsv', '/a/run.delta.tsv'])
    expect(document.querySelector('.recon-view .caveat[role="status"]')).toBeNull()
    // Another stem in the same folder is another run.
    mock.nextPickReport = '/a/other.recon.tsv'
    await click(screen.getByRole('button', { name: 'Open report…' }))
    await flush()
    expect(srcs()).toEqual(['/a/other.recon.tsv'])
    expect(document.querySelector('.recon-view .caveat[role="status"]')?.textContent).toBe(
      'other.recon.tsv is from another run; /a/run.massgap.tsv, /a/run.delta.tsv were closed.'
    )
  })

  it("dropping B's recon then B's massgap while A is shown keeps B's recon table", async () => {
    const mock = installMockBridge()
    mock.reportFiles = {
      '/a/run.massgap.tsv': humanMassgap,
      '/a/run.delta.tsv': humanDelta,
      '/b/run.recon.tsv': humanRecon,
      '/b/run.massgap.tsv': humanMassgap
    }
    await renderApp(mock)
    await act(async () => mock.emitDrop({ reports: [{ kind: 'massgap', path: '/a/run.massgap.tsv' }, { kind: 'delta', path: '/a/run.delta.tsv' }] }))
    await flush()
    await click(await screen.findByRole('tab', { name: 'Mass shifts' }))
    const srcs = (): (string | null)[] => Array.from(document.querySelectorAll('.recon-view code.src')).map((c) => c.getAttribute('title'))
    expect(srcs()).toEqual(['/a/run.massgap.tsv', '/a/run.delta.tsv'])
    await act(async () => mock.emitDrop({ reports: [{ kind: 'recon', path: '/b/run.recon.tsv' }, { kind: 'massgap', path: '/b/run.massgap.tsv' }] }))
    await flush()
    await click(screen.getByRole('tab', { name: 'Mass shifts' }))
    expect(srcs()).toEqual(['/b/run.massgap.tsv', '/b/run.recon.tsv'])
    expect((await screen.findByRole('grid', { name: 'Placements' })).getAttribute('aria-rowcount')).toBe('3890')
  })

  it('opening the same recon.tsv again reads it again', async () => {
    const mock = installMockBridge()
    mock.reportFiles = { '/r/run.recon.tsv': humanRecon }
    mock.nextPickReport = '/r/run.recon.tsv'
    await renderApp(mock)
    await goTo('results')
    await click(screen.getByRole('button', { name: 'Open report…' }))
    expect((await screen.findByRole('grid', { name: 'Placements' })).getAttribute('aria-rowcount')).toBe('3890')
    // The CLI wrote the file again: its header and the first ten rows.
    mock.reportFiles = { '/r/run.recon.tsv': humanRecon.split('\n').slice(0, 11).join('\n') + '\n' }
    mock.nextPickReport = '/r/run.recon.tsv'
    await click(screen.getByRole('button', { name: 'Open report…' }))
    await flush()
    expect((await screen.findByRole('grid', { name: 'Placements' })).getAttribute('aria-rowcount')).toBe('11')
  })

  // Review fix: a run that placed nothing writes an mzTab of MTD lines only
  // (OpenMS writes no PSH line for an empty PSM section). The tab shows the
  // 0-placed banner, no error, and the way forward: extension 3.
  it('a 0-placed run (ext2) with an MTD-only mzTab: the banner and its run with extension 3, no alert', async () => {
    const mock = installMockBridge()
    const paths = { recon_out: '/r/a.recon.tsv', delta_out: '/r/a.delta.tsv', massgap_out: '/r/a.massgap.tsv', recon_id_out: '/r/a.recon_id.mzTab' }
    mock.settings.lastUsed = { ...paths, recon_fasta: '/db/human.fasta', extension: '2' }
    mock.reportFiles = {
      [paths.recon_out]: 'spectrum\ttag\tprotein\tpeptide\tpos\treversed\tnterm_match\tcterm_match\tdelta_mass\tregion\tdelta_interp\n',
      [paths.delta_out]: 'delta\tspectra\ttop_interps\n',
      [paths.massgap_out]: ext2Massgap,
      [paths.recon_id_out]: 'MTD\tmzTab-version\t1.0.0\nMTD\tmzTab-mode\tSummary\nMTD\tmzTab-type\tIdentification\n'
    }
    await renderApp(mock)
    await applyLastUsed(6)
    await pickSingle(mock, '/r/a.mzML')
    await click(runButton())
    await emitDone(mock, 1, true)
    await click(await screen.findByRole('tab', { name: 'Mass shifts' }))
    await flush()
    expect(mock.reportCalls).toContain(paths.recon_id_out)
    expect(screen.queryByRole('alert')).toBeNull()
    const banner = document.querySelector('.recon-view .banner.warn') as HTMLElement
    expect(banner.textContent).toMatch(/No spectrum is placed on the database/)
    expect(mock.runCalls).toHaveLength(1)
    await click(within(banner).getByRole('button', { name: 'Run again with extension 3' }))
    await flush()
    expect(mock.runCalls).toHaveLength(2)
    expect(mock.runCalls[1].params.extension).toBe('3')
    expect(mock.runCalls[1].params.recon_fasta).toBe('/db/human.fasta')
  })

  // Review fix (GUI-DESIGN 5): switching tabs neither reads the table again
  // nor resets its filters and sort; the sniff reads only the head.
  it('a tab switch keeps the parsed table, its filters and its sort; opening reads the file once', async () => {
    const mock = installMockBridge()
    mock.reportFiles = { '/r/run.recon.tsv': humanRecon }
    mock.nextPickReport = '/r/run.recon.tsv'
    await renderApp(mock)
    await goTo('results')
    await click(screen.getByRole('button', { name: 'Open report…' }))
    await screen.findByRole('grid', { name: 'Placements' })
    expect(mock.reportHeadCalls).toEqual(['/r/run.recon.tsv'])
    expect(mock.reportCalls).toEqual(['/r/run.recon.tsv'])
    await click(screen.getByRole('checkbox', { name: /One flank off/ }))
    const grid = screen.getByRole('grid', { name: 'Placements' })
    await click(within(grid).getByRole('button', { name: /^Pos/ }))
    const count = document.querySelector('.dt-count')?.textContent
    const firstRow = within(grid).getAllByRole('row')[1].textContent
    expect(count).toMatch(/^3,889 rows/)
    // The table alone has no other tab to switch to (no tags were opened):
    // leave Results and come back.
    await goTo('setup')
    await goTo('results')
    const again = screen.getByRole('grid', { name: 'Placements' })
    expect(mock.reportCalls).toEqual(['/r/run.recon.tsv'])
    expect((screen.getByRole('checkbox', { name: /One flank off/ }) as HTMLInputElement).checked).toBe(true)
    expect(document.querySelector('.dt-count')?.textContent).toBe(count)
    expect(within(again).getAllByRole('row')[1].textContent).toBe(firstRow)
    expect(within(again).getByRole('button', { name: /^Pos/ }).closest('th')?.getAttribute('aria-sort')).toBe('ascending')
  })
})
