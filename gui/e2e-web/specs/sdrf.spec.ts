// The Batch view's SDRF comparison in a real browser (GUI-DESIGN 3 S6, 9
// layer 3, 10 P4): the real gate batch (src/fixtures/cli/batch) against the
// synthetic SDRF of src/fixtures/sdrf. The table's states are the
// fixture's design (each SDRF row was written to hit one state; a run
// setting that differs is ≠, never a correction), the genus-level rule is
// checked on its own, the export never targets the SDRF, and the exported corrections TSV
// must equal the golden file the vitest golden test builds from the CLI
// reports alone, byte for byte.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect, goTo, mockState, openApp } from './fixtures'

const SDRF_DIR = fileURLToPath(new URL('../../src/fixtures/sdrf/', import.meta.url))
const GOLDEN = readFileSync(`${SDRF_DIR}gate-batch.corrections.tsv`, 'utf8')

const NAMES = [
  'pxd003531',
  'pxd003531-mzpeak',
  'pxd004541-tmt',
  'pxd006096-dia',
  'pxd006096-pseudo',
  'pxd010783',
  'pxd014764',
  'pxd040407-chymo'
]

const sdrfTable = (page: Page) => page.getByRole('table', { name: /^SDRF comparison/ })

async function runAndLoad(page: Page): Promise<void> {
  await openApp(page, 'gate-batch')
  await page.getByRole('radio', { name: /^Batch QC/ }).check()
  await goTo(page, 'Batch')
  await page.getByRole('button', { name: 'Add folder…' }).click()
  await page.getByRole('button', { name: `Run ${NAMES.length} remaining files` }).click()
  await expect(page.getByText(`${NAMES.length - 1}/${NAMES.length} done`)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('table', { name: /^Batch summary/ }).getByText('reading…')).toHaveCount(0)
  await page.getByRole('button', { name: 'Load SDRF…' }).click()
  await expect(sdrfTable(page).locator('tbody tr')).toHaveCount(NAMES.length)
}

async function shown(page: Page): Promise<{ file: string; states: string[]; verdict: string }[]> {
  return sdrfTable(page)
    .locator('tbody tr')
    .evaluateAll((trs) =>
      trs.map((tr) => {
        const tds = [...tr.querySelectorAll('td')]
        return {
          file: tds[0].getAttribute('data-text') ?? '',
          states: tds.flatMap((td) => (td.dataset.state ? [td.dataset.state] : [])),
          verdict: tds[tds.length - 1].getAttribute('data-text') ?? ''
        }
      })
    )
}

test('Batch SDRF: each job against its SDRF rows, field by field', async ({ page }) => {
  await runAndLoad(page)
  // organism, cleavage agent, label, modifications, instrument, fragment tolerance
  expect(await shown(page)).toEqual([
    { file: 'pxd003531.mzML', states: ['genus', 'match', 'match', 'match', 'match', 'match'], verdict: '✓ consistent' },
    { file: 'pxd003531-mzpeak.mzML', states: ['genus', 'match', 'match', 'match', 'match', 'match'], verdict: '✓ consistent' },
    // A run setting (fragment tolerance, modifications) that differs is ≠, never ✗.
    { file: 'pxd004541-tmt.mzML', states: ['genus', 'match', 'match', 'match', 'match', 'setting_differs'], verdict: '✓ consistent; ≠ run setting: fragment tolerance' },
    { file: 'pxd006096-dia.mzML', states: [], verdict: 'not compared: the job failed' },
    { file: 'pxd006096-pseudo.mzML', states: ['genus', 'match', 'match', 'match', 'no_call', 'match'], verdict: '✓ consistent' },
    { file: 'pxd010783.mzML', states: ['no_call', 'no_call', 'no_call', 'match', 'match', 'setting_differs'], verdict: '✓ consistent; ≠ run setting: fragment tolerance' },
    { file: 'pxd014764.mzML', states: ['mismatch', 'match', 'match', 'match', 'match', 'match'], verdict: '✗ organism' },
    { file: 'pxd040407-chymo.mzML', states: ['no_call', 'no_call', 'no_call', 'setting_differs', 'mismatch', 'match'], verdict: '✗ instrument; ≠ run setting: modifications' }
  ])
  // The summary table carries the same verdicts in its SDRF column.
  const sum = page.getByRole('table', { name: /^Batch summary/ })
  await expect(sum.getByRole('columnheader', { name: 'SDRF' })).toBeVisible()
  const last = await sum.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => tr.querySelector('td:last-child')?.getAttribute('data-text')))
  expect(last).toEqual((await shown(page)).map((r) => r.verdict))
  // The SDRF row no job ran.
  await page.getByText('SDRF data files no job ran (1)').click()
  await expect(page.getByText('extra_run_not_in_batch.raw (row 10)')).toBeVisible()
})

test('Batch SDRF: genus "Homo" against SDRF "Homo sapiens" is consistent at genus, not a mismatch', async ({ page }) => {
  await runAndLoad(page)
  const row = sdrfTable(page).locator('tbody tr').first()
  const organism = row.locator('td[data-state]').first()
  await expect(organism).toHaveAttribute('data-state', 'genus')
  await expect(organism).toHaveAttribute('data-text', '✓ consistent at genus: FASTag Homo (taxid 9605) · SDRF Homo sapiens')
  await expect(organism).toHaveAttribute('title', /Homo sapiens \(taxid 9606\) lies in the called genus Homo \(taxid 9605\)/)
})

test('Batch SDRF: the corrections TSV equals the golden file built from the CLI reports alone', async ({ page }) => {
  await runAndLoad(page)
  await page.evaluate(() => {
    ;(window as unknown as { __fastagE2E: { mock: { nextPickOutput: string } } }).__fastagE2E.mock.nextPickOutput = '/data/gate-batch.corrections.tsv'
  })
  await page.getByRole('button', { name: 'Export SDRF corrections TSV…' }).click()
  await expect(page.getByText('2 corrections written to /data/gate-batch.corrections.tsv. The SDRF was not changed.')).toBeVisible()
  const writes = await mockState<{ dest: string; text: string }[]>(page, 'summaryWrites')
  expect(writes).toHaveLength(1)
  expect(writes[0].dest).toBe('/data/gate-batch.corrections.tsv')
  expect(writes[0].text).toBe(GOLDEN)
  // The SDRF was read once and never written.
  expect(await mockState<string[]>(page, 'sdrfReadCalls')).toEqual(['/data/gate-batch.sdrf.tsv'])
  expect(writes.map((w) => w.dest)).not.toContain('/data/gate-batch.sdrf.tsv')
})

test('Batch SDRF: the corrections export refuses the SDRF itself as its destination', async ({ page }) => {
  await runAndLoad(page)
  await page.evaluate(() => {
    ;(window as unknown as { __fastagE2E: { mock: { nextPickOutput: string } } }).__fastagE2E.mock.nextPickOutput = '/data/gate-batch.sdrf.tsv'
  })
  await page.getByRole('button', { name: 'Export SDRF corrections TSV…' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Not written: /data/gate-batch.sdrf.tsv is the loaded SDRF' })).toBeVisible()
  expect(await mockState<{ dest: string }[]>(page, 'summaryWrites')).toEqual([])
})
