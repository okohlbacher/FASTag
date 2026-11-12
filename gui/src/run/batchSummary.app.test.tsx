// The Batch view's summary, folder input and output folder (GUI-DESIGN 3
// S6, 10 P2b), through the real window.fastag seam (testing/mockBridge.ts).
// The jobs' reports are the real batch output of FASTag integration/1.12 on
// the public gate inputs (testing/batchFixtures.ts).

import { act, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installMockBridge, type MockBridge } from '../testing/mockBridge'
import { addBatch, click, goTo, renderColdApp, renderCharacterizeApp, startBatch } from '../testing/render'
import { BATCH_CASES, DIA_REFUSAL, type BatchCase } from '../testing/batchFixtures'
import { speciesFromTsv } from '../testing/speciesTsv'

// The mock serves @p c as the reports of the job of /d/<stem>.mzML, at the
// paths a batch job resolves (perJobOutputs beside its -out).
function serve(mock: MockBridge, stem: string, c: BatchCase, dir = '/d'): void {
  mock.reportFiles[`${dir}/${stem}.digest.tsv`] = c.digest
  mock.reportFiles[`${dir}/${stem}.label.tsv`] = c.label
  mock.speciesFiles[`${dir}/${stem}.tags.species.tsv`] = speciesFromTsv(c.species, `${dir}/${stem}.tags.species.tsv`)
}

// Run the queued batch; each job prints its case's log and ends ok.
async function runAll(mock: MockBridge, cases: BatchCase[]): Promise<void> {
  await startBatch()
  for (let i = 0; i < cases.length; i++) {
    await waitFor(() => expect(mock.runCalls).toHaveLength(i + 1))
    await act(async () => {
      for (const l of cases[i].log.split('\n').filter(Boolean)) mock.emitLog(l)
      mock.emitDone({ ok: true, code: 0, runId: mock.lastRunId })
    })
  }
}

const table = (): HTMLElement => screen.getByRole('table', { name: /^Batch summary/ })
const bodyRows = (): HTMLElement[] => within(table()).getAllByRole('row').filter((r) => r.closest('tbody'))
const cells = (r: HTMLElement): string[] => within(r).getAllByRole('cell').map((c) => c.getAttribute('data-text') ?? c.textContent ?? '')

describe('the batch summary', () => {
  it('has one row per job with the CLI calls, and flags the one that differs from a majority of 3', async () => {
    const mock = installMockBridge()
    await renderCharacterizeApp(mock)
    const cases = [BATCH_CASES.pxd003531, BATCH_CASES.pxd004541, BATCH_CASES.pxd003531mzpeak]
    ;['a', 'b', 'c'].forEach((s, i) => serve(mock, s, cases[i]))
    await addBatch(mock, ['/d/a.mzML', '/d/b.mzML', '/d/c.mzML'])
    // Before a run: one row per job, nothing called yet.
    await goTo('batch')
    expect(bodyRows()).toHaveLength(3)
    await runAll(mock, cases)
    await waitFor(() => expect(within(bodyRows()[2]).getByText('none (label-free)')).toBeDefined())
    const [a, b, c] = bodyRows().map(cells)
    expect(a.slice(0, 1)).toEqual(['a.mzML'])
    expect(a).toEqual(expect.arrayContaining(['128,821', 'Homo', 'Trypsin', 'none (label-free)', 'not assessed (needs a FASTA)']))
    expect(b).toEqual(expect.arrayContaining(['172,237', 'Homo', 'Trypsin', 'TMT']))
    expect(c).toEqual(expect.arrayContaining(['none (label-free)']))
    // TMT differs from label-free (2 of 3 calls); its cell says so, in words too.
    const tmt = within(bodyRows()[1]).getByText('TMT').closest('td')!
    expect(tmt.className).toContain('differs')
    expect(within(tmt).getByText('differs from the majority label-free')).toBeDefined()
    expect(table().querySelectorAll('td.differs')).toHaveLength(1)
    // The foot names each column's majority.
    const foot = within(table()).getByRole('row', { name: /Majority/ })
    expect(foot.textContent).toContain('label-free (2 of 3 calls)')
    expect(foot.textContent).toContain('Trypsin (3 of 3 calls)')
    expect(foot.textContent).toContain('no majority (no calls)')
  })

  it('with fewer than 3 jobs nothing is flagged, though the calls differ', async () => {
    const mock = installMockBridge()
    await renderCharacterizeApp(mock)
    serve(mock, 'a', BATCH_CASES.pxd003531)
    serve(mock, 'b', BATCH_CASES.pxd004541)
    await addBatch(mock, ['/d/a.mzML', '/d/b.mzML'])
    await runAll(mock, [BATCH_CASES.pxd003531, BATCH_CASES.pxd004541])
    await waitFor(() => expect(within(bodyRows()[1]).getByText('TMT')).toBeDefined())
    expect(table().querySelectorAll('td.differs')).toHaveLength(0)
    expect(within(table()).getByRole('row', { name: /Majority/ }).textContent).toContain('no majority (2 calls, fewer than 3)')
  })

  it('a raw DIA input the CLI refuses (exit 11, FASTag 1.12) fails with the CLI sentence as its reason, and counts nothing', async () => {
    const mock = installMockBridge()
    await renderCharacterizeApp(mock)
    serve(mock, 'a', BATCH_CASES.pxd003531)
    await addBatch(mock, ['/d/a.mzML', '/d/dia.mzML'])
    await startBatch()
    await waitFor(() => expect(mock.runCalls).toHaveLength(1))
    await act(async () => {
      for (const l of BATCH_CASES.pxd003531.log.split('\n').filter(Boolean)) mock.emitLog(l)
      mock.emitDone({ ok: true, code: 0, runId: mock.lastRunId })
    })
    await waitFor(() => expect(mock.runCalls).toHaveLength(2))
    await act(async () => {
      for (const l of DIA_REFUSAL.log.split('\n').filter(Boolean)) mock.emitLog(l)
      mock.emitDone({ ok: false, code: 11, runId: mock.lastRunId })
    })
    await waitFor(() => expect(cells(bodyRows()[1])[1]).toMatch(/^Failed: exit code 11/))
    const status = cells(bodyRows()[1])[1]
    // The machine-readable FASTAG_REFUSED line is not the reason; the CLI's sentence before it is.
    expect(status).toContain('is raw DIA')
    expect(status).not.toContain('FASTAG_REFUSED')
    expect(cells(bodyRows()[1]).slice(3)).toEqual(['—', '—', '—', '—'])
  })

  it('exports the summary TSV: the table, cell for cell, through a .part-safe write', async () => {
    const mock = installMockBridge()
    await renderCharacterizeApp(mock)
    const cases = [BATCH_CASES.pxd003531, BATCH_CASES.pxd004541, BATCH_CASES.pxd014764]
    ;['a', 'b', 'c'].forEach((s, i) => serve(mock, s, cases[i]))
    await addBatch(mock, ['/d/a.mzML', '/d/b.mzML', '/d/c.mzML'])
    await runAll(mock, cases)
    await waitFor(() => expect(within(bodyRows()[2]).getByText('SILAC')).toBeDefined())
    mock.nextPickOutput = '/d/batch-summary.tsv'
    await click(screen.getByRole('button', { name: 'Export summary TSV…' }))
    await waitFor(() => expect(mock.summaryWrites).toHaveLength(1))
    expect(mock.pickFileCalls[mock.pickFileCalls.length - 1]).toEqual({ kind: 'save', formats: ['tsv'] })
    const { dest, text } = mock.summaryWrites[0]
    expect(dest).toBe('/d/batch-summary.tsv')
    const [head, ...body] = text.trimEnd().split('\n').map((l) => l.split('\t'))
    expect(head[0]).toBe('file')
    expect(body).toHaveLength(3)
    body.forEach((b, i) => {
      const shown = cells(bodyRows()[i])
      // file, status, tags, genus, protease, label, alkylation
      expect([b[0], b[2], b[4] === '' ? '—' : Number(b[4]).toLocaleString('en-US'), b[5], b[7], b[9], b[11]]).toEqual(shown)
    })
    expect(await screen.findByText('Summary of 3 jobs written to /d/batch-summary.tsv.')).toBeDefined()
  })

  it('a failed export says why', async () => {
    const mock = installMockBridge()
    await renderCharacterizeApp(mock)
    await addBatch(mock, ['/d/a.mzML'])
    await goTo('batch')
    mock.nextPickOutput = '/ro/s.tsv'
    mock.summaryWriteError = 'cannot write /ro/s.tsv: Read-only file system'
    await click(screen.getByRole('button', { name: 'Export summary TSV…' }))
    expect(await screen.findByText(/Could not write the summary: cannot write \/ro\/s\.tsv/)).toBeDefined()
  })
})

describe('folder input and the output folder', () => {
  it('Add folder… queues the spectra files of a folder, as a dropped folder does', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await goTo('batch')
    mock.nextPickFolder = '/share/runs'
    mock.folderFiles['/share/runs'] = ['/share/runs/a.mzML', '/share/runs/b.mgf']
    await click(screen.getByRole('button', { name: 'Add folder…' }))
    expect(mock.folderSpectraCalls).toEqual(['/share/runs'])
    await waitFor(() => expect(bodyRows()).toHaveLength(2))
    expect(screen.getByText('Batch · 2 files')).toBeDefined()
    // Again, with one more file: the queue keeps each input once.
    mock.folderFiles['/share/runs'] = ['/share/runs/a.mzML', '/share/runs/b.mgf', '/share/runs/c.mzML']
    await click(screen.getByRole('button', { name: 'Add folder…' }))
    await waitFor(() => expect(bodyRows()).toHaveLength(3))
  })

  it('a folder without spectra files adds nothing and says so', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await goTo('batch')
    mock.nextPickFolder = '/empty'
    mock.folderFiles['/empty'] = []
    await click(screen.getByRole('button', { name: 'Add folder…' }))
    expect(await screen.findByText('No spectra files (mzML, mzPeak, MGF) directly in /empty.')).toBeDefined()
    expect(screen.getByText('No batch yet')).toBeDefined()
  })

  it('an output folder takes every output of the batch; Beside inputs puts them back', async () => {
    const mock = installMockBridge()
    await renderCharacterizeApp(mock)
    await addBatch(mock, ['/share/a.mzML', '/share/b.mzML'])
    await goTo('batch')
    const outdir = (): HTMLElement => document.querySelector<HTMLElement>('.view[data-view="batch"] .outdir')!
    expect(within(outdir()).getByText('beside each input')).toBeDefined()
    mock.nextPickFolder = '/out'
    await click(screen.getByRole('button', { name: 'Choose output folder…' }))
    expect(within(outdir()).getByText('/out')).toBeDefined()
    // The plan footer says so too.
    expect(document.querySelector('.view[data-view="setup"]')!.textContent).toContain('out: /out')
    await click(screen.getByRole('button', { name: 'Beside inputs' }))
    expect(within(outdir()).getByText('beside each input')).toBeDefined()
    expect(document.querySelector('.view[data-view="setup"]')!.textContent).toContain('out: beside each input')
    await click(screen.getByRole('button', { name: 'Choose output folder…' }))
    serve(mock, 'a', BATCH_CASES.pxd003531, '/out')
    serve(mock, 'b', BATCH_CASES.pxd004541, '/out')
    await runAll(mock, [BATCH_CASES.pxd003531, BATCH_CASES.pxd004541])
    expect(mock.runCalls.map((c) => c.out)).toEqual(['/out/a.tags.tsv', '/out/b.tags.tsv'])
    // The reports follow the tags (perJobOutputs); the input stays where it is.
    expect(mock.runCalls[0].in).toBe('/share/a.mzML')
    expect(mock.runCalls[0].params['digest_out']).toBe('/out/a.digest.tsv')
    expect(mock.runCalls[1].params['label_out']).toBe('/out/b.label.tsv')
    // The summary reads them there.
    await waitFor(() => expect(within(bodyRows()[1]).getByText('TMT')).toBeDefined())
  })

})

describe('what a summary cell says when a read goes wrong, and where notes show', () => {
  it('a report the job was sent but could not read says "unreadable" with the error, in the cell', async () => {
    const mock = installMockBridge()
    await renderCharacterizeApp(mock)
    serve(mock, 'a', BATCH_CASES.pxd003531)
    // An empty digest report (parseRows: the file is empty), a species read
    // that rejects.
    mock.reportFiles['/d/a.digest.tsv'] = ''
    mock.speciesError = new Error('permission denied')
    await addBatch(mock, ['/d/a.mzML'])
    await runAll(mock, [BATCH_CASES.pxd003531])
    await waitFor(() => expect(within(bodyRows()[0]).getAllByText('unreadable')).toHaveLength(2))
    const [genus, protease] = [...bodyRows()[0].querySelectorAll('td.call-cell')] as HTMLElement[]
    expect(genus.getAttribute('data-text')).toBe('unreadable')
    expect(genus.textContent).toContain('Cannot read /d/a.tags.species.tsv: permission denied')
    expect(genus.textContent).not.toContain('detection was off')
    expect(protease.getAttribute('data-text')).toBe('unreadable')
    expect(protease.textContent).toMatch(/^unreadable; Cannot read \/d\/a\.digest\.tsv: .*empty/)
    expect(protease.textContent).not.toContain('not written')
  })

  it('a job whose reports cannot be read at all says so instead of "reading…" forever', async () => {
    const mock = installMockBridge()
    await renderCharacterizeApp(mock)
    serve(mock, 'a', BATCH_CASES.pxd003531)
    window.fastag.species = () => {
      throw new Error('bridge gone')
    }
    await addBatch(mock, ['/d/a.mzML'])
    await runAll(mock, [BATCH_CASES.pxd003531])
    await waitFor(() => expect(cells(bodyRows()[0]).slice(3)).toEqual(['unreadable', 'unreadable', 'unreadable', 'unreadable']))
    expect(bodyRows()[0].querySelector('td.call-cell')!.textContent).toContain('its reports could not be read: bridge gone')
  })

  it('a done job whose outputs the app never learned is not "reading…", and offers no Open', async () => {
    const mock = installMockBridge()
    await renderCharacterizeApp(mock)
    await addBatch(mock, ['/d/a.mzML'])
    mock.holdRun()
    await startBatch()
    await waitFor(() => expect(mock.runCalls).toHaveLength(1))
    await act(async () => {
      for (const l of BATCH_CASES.pxd003531.log.split('\n').filter(Boolean)) mock.emitLog(l)
      mock.emitDone({ ok: true, code: 0, runId: mock.lastRunId })
    })
    // The reply never comes: the invoke fails after the Done.
    await act(async () => mock.releaseRun(new Error('reply refused')))
    await waitFor(() => expect(cells(bodyRows()[0])[1]).toMatch(/^Done/))
    expect(cells(bodyRows()[0]).slice(3)).toEqual(['—', '—', '—', '—'])
    expect(within(table()).queryByText('reading…')).toBeNull()
    expect(bodyRows()[0].querySelector('td.call-cell')!.textContent).toContain('did not learn where this run wrote its outputs')
    expect(within(table()).queryByRole('button', { name: /^Open .* in Results$/ })).toBeNull()
  })

  it("each call cell shows its cutoff or caveat, not only on hover", async () => {
    const mock = installMockBridge()
    await renderCharacterizeApp(mock)
    serve(mock, 'a', BATCH_CASES.pxd003531)
    await addBatch(mock, ['/d/a.mzML'])
    await runAll(mock, [BATCH_CASES.pxd003531])
    await waitFor(() => expect(within(bodyRows()[0]).getByText('none (label-free)')).toBeDefined())
    // In the cell's text, so a screen reader reads it with the value; no
    // tooltip-only caveat.
    const label = within(bodyRows()[0]).getByText('none (label-free)').closest('td')!
    expect(label.textContent).toMatch(/^none \(label-free\); CLI label call over/)
    for (const td of bodyRows()[0].querySelectorAll<HTMLElement>('td.call-cell')) expect(td.getAttribute('title')).toBeNull()
    // Shown under each value by a keyboard-reachable toggle.
    expect(table().querySelectorAll('.cell-note')).toHaveLength(0)
    const toggle = screen.getByRole('button', { name: 'Show cutoffs and caveats' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    await click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    const notes = [...bodyRows()[0].querySelectorAll<HTMLElement>('td.call-cell .cell-note')]
    expect(notes).toHaveLength(4)
    for (const n of notes) expect(n.textContent!.replace(/^; /, '')).toBeTruthy()
    expect(within(label).getByText(/^CLI label call over/).closest('.cell-note')).not.toBeNull()
  })

  it('an empty folder picked from the Batch QC card on Setup says so there', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await click(screen.getByRole('radio', { name: /^Batch QC/ }))
    mock.nextPickFolder = '/empty'
    mock.folderFiles['/empty'] = []
    await click(screen.getByRole('button', { name: 'Or add a folder…' }))
    const note = await screen.findByText('No spectra files (mzML, mzPeak, MGF) directly in /empty.')
    expect(note.closest('.view')!.getAttribute('data-view')).toBe('setup')
    expect(note.closest('.view')!.hasAttribute('hidden')).toBe(false)
    expect(note.getAttribute('role')).toBe('status')
    // A folder that cannot be listed, too.
    mock.nextPickFolder = '/nope'
    await click(screen.getByRole('button', { name: 'Or add a folder…' }))
    expect(await screen.findByText('Cannot read the folder: /nope is not a folder')).toBeDefined()
  })
})
