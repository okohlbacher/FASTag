// The Batch view's SDRF comparison (GUI-DESIGN 3 S6, 10 P4) through the
// real window.fastag seam (testing/mockBridge.ts): Load SDRF… or a drop
// reads the file's bytes and the taxonomy, the table compares each job's
// reports with its SDRF rows, the summary gains an SDRF column, and the
// corrections export writes the mismatches; the SDRF is never written.

// @ts-ignore -- node built-in; the app's tsconfig has no node types
import { readFileSync } from 'node:fs'
import { act, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installMockBridge, type MockBridge } from '../testing/mockBridge'
import { addBatch, click, goTo, renderColdApp, startBatch } from '../testing/render'
import { BATCH_CASES, type BatchCase } from '../testing/batchFixtures'
import { speciesFromTsv } from '../testing/speciesTsv'

const SDRF_PATH = '/proj/gate-batch.sdrf.tsv'
const SDRF_BYTES = new Uint8Array(readFileSync('src/fixtures/sdrf/gate-batch.sdrf.tsv'))
const TAXONOMY = {
  nodesPath: '/opt/FASTag/share/FASTag/taxonomy/nodes.dmp',
  namesPath: '/opt/FASTag/share/FASTag/taxonomy/names.dmp',
  nodes: readFileSync('src/fixtures/sdrf/nodes.dmp', 'utf8') as string,
  names: readFileSync('src/fixtures/sdrf/names.dmp', 'utf8') as string
}

function serve(mock: MockBridge, stem: string, c: BatchCase, dir = '/d'): void {
  mock.reportFiles[`${dir}/${stem}.digest.tsv`] = c.digest
  mock.reportFiles[`${dir}/${stem}.label.tsv`] = c.label
  mock.speciesFiles[`${dir}/${stem}.tags.species.tsv`] = speciesFromTsv(c.species, `${dir}/${stem}.tags.species.tsv`)
}

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

const CASES = [BATCH_CASES.pxd003531, BATCH_CASES.pxd004541, BATCH_CASES.pxd014764]

async function batchOfThree(): Promise<MockBridge> {
  const mock = installMockBridge()
  mock.sdrfFiles[SDRF_PATH] = SDRF_BYTES
  mock.taxonomyResult = TAXONOMY
  await renderColdApp(mock)
  ;['a', 'b', 'c'].forEach((s, i) => serve(mock, s, CASES[i]))
  await addBatch(mock, ['/d/a.mzML', '/d/b.mzML', '/d/c.mzML'])
  await runAll(mock, CASES)
  await goTo('batch')
  await waitFor(() => expect(screen.getByRole('table', { name: /^Batch summary/ }).textContent).toContain('SILAC'))
  return mock
}

const sdrfTable = (): HTMLElement => screen.getByRole('table', { name: /^SDRF comparison/ })
const rows = (t: HTMLElement): HTMLElement[] => within(t).getAllByRole('row').filter((r) => r.closest('tbody'))
const texts = (r: HTMLElement): string[] => within(r).getAllByRole('cell').map((c) => c.getAttribute('data-text') ?? '')
const last = (a: string[]): string => a[a.length - 1]
const states = (r: HTMLElement): string[] => within(r).getAllByRole('cell').flatMap((c) => (c.dataset.state ? [c.dataset.state] : []))

describe('the SDRF comparison in the Batch view', () => {
  it('Load SDRF… reads the file and the taxonomy and compares each job field by field', async () => {
    const mock = await batchOfThree()
    // Before an SDRF: the summary has no SDRF column.
    expect(within(screen.getByRole('table', { name: /^Batch summary/ })).queryByRole('columnheader', { name: 'SDRF' })).toBeNull()
    mock.nextPickSdrf = SDRF_PATH
    await click(screen.getByRole('button', { name: 'Load SDRF…' }))
    await waitFor(() => expect(sdrfTable()).toBeDefined())
    expect(mock.sdrfReadCalls).toEqual([SDRF_PATH])
    expect(mock.taxonomyCalls).toEqual([{ nodes: undefined, names: undefined }])
    const [a, b, c] = rows(sdrfTable())
    expect(texts(a)[1]).toBe('20130611_QE3_UPLC10_CFR_SA_OC_T_NO_03_01_01.raw (row 1)')
    expect(states(a)).toEqual(['genus', 'match', 'match', 'match', 'match', 'match'])
    // b's fragment tolerance: the run's setting differs, not a mismatch.
    expect(states(b)).toEqual(['genus', 'match', 'match', 'match', 'match', 'setting_differs'])
    expect(last(texts(b))).toBe('✓ consistent; ≠ run setting: fragment tolerance')
    expect(texts(b)[7]).toBe('≠ run setting differs: FASTag 20 ppm · SDRF 0.02 Da')
    expect(states(c)).toEqual(['mismatch', 'match', 'match', 'match', 'match', 'match'])
    // Genus "Homo" against SDRF "Homo sapiens": consistent at genus.
    expect(texts(a)[2]).toBe('✓ consistent at genus: FASTag Homo (taxid 9605) · SDRF Homo sapiens')
    expect(texts(c)[2]).toBe('✗ differs: FASTag Homo (taxid 9605) · SDRF Mus musculus')
    expect(last(texts(c))).toBe('✗ organism')
    // The summary gains the SDRF verdict column.
    const sum = screen.getByRole('table', { name: /^Batch summary/ })
    expect(within(sum).getByRole('columnheader', { name: 'SDRF' })).toBeDefined()
    expect(rows(sum).map((r) => last(texts(r)))).toEqual(['✓ consistent', '✓ consistent; ≠ run setting: fragment tolerance', '✗ organism'])
    // The SDRF row no job ran is listed.
    expect(screen.getByText(/gate-batch\.sdrf\.tsv · 10 rows · 1 difference · 1 run setting differs \(not a correction\) · 4 SDRF data files not in the batch/)).toBeDefined()
  })

  it('exports the corrections TSV beside the SDRF; the SDRF itself is never written', async () => {
    const mock = await batchOfThree()
    mock.nextPickSdrf = SDRF_PATH
    await click(screen.getByRole('button', { name: 'Load SDRF…' }))
    await waitFor(() => expect(sdrfTable()).toBeDefined())
    mock.nextPickOutput = '/proj/gate-batch.corrections.tsv'
    await click(screen.getByRole('button', { name: 'Export SDRF corrections TSV…' }))
    await waitFor(() => expect(mock.summaryWrites).toHaveLength(1))
    const { dest, text } = mock.summaryWrites[0]
    expect(dest).toBe('/proj/gate-batch.corrections.tsv')
    const lines = text.trimEnd().split('\n').map((l) => l.split('\t'))
    expect(lines[0][0]).toBe('data_file')
    // b's tolerance is a run setting that differs: no correction.
    expect(lines.slice(1).map((l) => [l[1], l[3]])).toEqual([['c.mzML', 'organism']])
    expect(await screen.findByText('1 correction written to /proj/gate-batch.corrections.tsv. The SDRF was not changed.')).toBeDefined()
    expect(mock.summaryWrites.map((w) => w.dest)).not.toContain(SDRF_PATH)
  })

  it('refuses to export over the loaded SDRF: an error note, the SDRF bytes unchanged', async () => {
    const mock = await batchOfThree()
    mock.nextPickSdrf = SDRF_PATH
    await click(screen.getByRole('button', { name: 'Load SDRF…' }))
    await waitFor(() => expect(sdrfTable()).toBeDefined())
    const before = Array.from(mock.sdrfFiles[SDRF_PATH])
    // The SDRF's own path, and another spelling of it.
    for (const pick of [SDRF_PATH, '/proj/./Gate-Batch.SDRF.tsv']) {
      mock.nextPickOutput = pick
      await click(screen.getByRole('button', { name: 'Export SDRF corrections TSV…' }))
      expect((await screen.findByRole('alert')).textContent).toBe(
        `Not written: ${pick} is the loaded SDRF, which is never changed. Choose another name for the corrections.`
      )
    }
    expect(mock.summaryWrites).toEqual([])
    expect(Array.from(mock.sdrfFiles[SDRF_PATH])).toEqual(before)
    // Another name is written, and the backend is told to protect the SDRF.
    mock.nextPickOutput = '/proj/gate-batch.corrections.tsv'
    await click(screen.getByRole('button', { name: 'Export SDRF corrections TSV…' }))
    await waitFor(() => expect(mock.summaryWrites).toHaveLength(1))
    expect(mock.summaryProtect).toEqual([[SDRF_PATH]])
  })

  it('the batch summary export refuses the loaded SDRF too: its bytes unchanged, the backend told to protect it', async () => {
    const mock = await batchOfThree()
    mock.nextPickSdrf = SDRF_PATH
    await click(screen.getByRole('button', { name: 'Load SDRF…' }))
    await waitFor(() => expect(sdrfTable()).toBeDefined())
    const before = Array.from(mock.sdrfFiles[SDRF_PATH])
    for (const pick of [SDRF_PATH, '/proj/./Gate-Batch.SDRF.tsv']) {
      mock.nextPickOutput = pick
      await click(screen.getByRole('button', { name: 'Export summary TSV…' }))
      expect((await screen.findByRole('alert')).textContent).toBe(
        `Not written: ${pick} is the loaded SDRF, which is never changed. Choose another name for the summary.`
      )
    }
    expect(mock.summaryWrites).toEqual([])
    expect(Array.from(mock.sdrfFiles[SDRF_PATH])).toEqual(before)
    // Another name is written, and the backend is told to protect the SDRF.
    mock.nextPickOutput = '/proj/batch-summary.tsv'
    await click(screen.getByRole('button', { name: 'Export summary TSV…' }))
    await waitFor(() => expect(mock.summaryWrites).toHaveLength(1))
    expect(mock.summaryWrites[0].dest).toBe('/proj/batch-summary.tsv')
    expect(mock.summaryProtect).toEqual([[SDRF_PATH]])
  })

  it('a dropped SDRF is loaded and lands on Batch', async () => {
    const mock = await batchOfThree()
    await goTo('setup')
    await act(async () => mock.emitDrop({ sdrf: SDRF_PATH }))
    await waitFor(() => expect(sdrfTable()).toBeDefined())
    expect(mock.sdrfReadCalls).toEqual([SDRF_PATH])
    expect(document.querySelector('[data-view="batch"]')!.hasAttribute('hidden')).toBe(false)
  })

  it('without a taxonomy the organism is not checkable and the panel says why', async () => {
    const mock = await batchOfThree()
    mock.taxonomyResult = null
    mock.nextPickSdrf = SDRF_PATH
    await click(screen.getByRole('button', { name: 'Load SDRF…' }))
    await waitFor(() => expect(sdrfTable()).toBeDefined())
    expect(states(rows(sdrfTable())[2])[0]).toBe('not_checkable')
    expect(screen.getByText(/No taxonomy \(nodes\.dmp, names\.dmp\) was found next to FASTag/)).toBeDefined()
  })

  it('an SDRF that cannot be read says why, and leaves the batch as it was', async () => {
    const mock = await batchOfThree()
    mock.nextPickSdrf = '/proj/missing.sdrf.tsv'
    await click(screen.getByRole('button', { name: 'Load SDRF…' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not read the SDRF \/proj\/missing\.sdrf\.tsv: .*does not exist/)
    expect(screen.queryByRole('table', { name: /^SDRF comparison/ })).toBeNull()
  })

  it('a queued job is not compared yet; Close SDRF drops the file', async () => {
    const mock = installMockBridge()
    mock.sdrfFiles[SDRF_PATH] = SDRF_BYTES
    mock.settings.lastUsed = null
    await renderColdApp(mock)
    await addBatch(mock, ['/d/a.mzML'])
    await goTo('batch')
    // Close SDRF drops it again.
    mock.nextPickSdrf = SDRF_PATH
    await click(screen.getByRole('button', { name: 'Load SDRF…' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close SDRF' })).toBeDefined())
    expect(last(texts(rows(sdrfTable())[0]))).toBe('not compared: not run yet')
    await click(screen.getByRole('button', { name: 'Close SDRF' }))
    expect(screen.queryByRole('table', { name: /^SDRF comparison/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Load SDRF…' })).toBeDefined()
  })
})
