// History (GUI-DESIGN 3 S9, 9 layer 3; P2a PR h): Copy command equals the
// argv the run record keeps, which is the command line the run was started
// with, with no staging or temporary paths; a run that did not finish is
// marked incomplete and never opens as if complete. The e2e bridge records
// each run as fastag.rs does (src/testing/e2eBridge.ts).
import type { Page } from '@playwright/test'
import { test, expect, openApp, goTo, mockState } from './fixtures'
import type { RunRecord } from '../../src/types'

// The clipboard as the page writes it: every text, in order.
async function recordClipboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __copied: string[] }
    w.__copied = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (t: string) => {
          w.__copied.push(t)
          return Promise.resolve()
        }
      }
    })
  })
}
const copied = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)

// A command line a POSIX shell reads back as the same argv (app/format.ts).
const shellLine = (argv: string[]): string =>
  argv.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(' ')

// No path the GUI made up: no staging folder, no partial or temporary file.
const TEMPORARY = /(^|\/)(tmp|temp|staging)\/|\.part$|\.incomplete$|\.tmp$|AppTranslocation|\.mount_/i

const historyRow = (page: Page, input: string) =>
  page.getByRole('table', { name: 'Run history' }).getByRole('row').filter({ hasText: input })

test('Copy command in History equals the argv the run was started with', async ({ page }) => {
  await recordClipboard(page)
  await openApp(page)
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.getByRole('button', { name: 'Run on run01.mzML' }).click()
  await expect(page.locator('.last-run')).toContainText('run01.mzML')
  await goTo(page, 'History')
  const row = historyRow(page, 'run01.mzML')
  await expect(row).toContainText('Finished')
  await expect(row).not.toContainText('incomplete')
  await row.getByRole('button', { name: 'Copy command' }).click()
  await expect(row.getByRole('button', { name: 'Copied' })).toBeVisible()
  const [rec] = await mockState<RunRecord[]>(page, 'history')
  const calls = await mockState<{ in: string; out: string }[]>(page, 'runCalls')
  expect(rec.argv.slice(0, 5)).toEqual(['/e2e/FASTag', '-in', calls[0].in, '-out', '/data/run01.tags.tsv'])
  expect(rec.argv[rec.argv.length - 1]).toBe('-progress')
  expect(rec.argv.filter((a) => TEMPORARY.test(a))).toEqual([])
  expect(await copied(page)).toEqual([shellLine(rec.argv)])
})

test('a failed batch job: the failure banner and History copy the same command line', async ({ page }) => {
  await recordClipboard(page)
  await openApp(page, 'batch-fail')
  await page.getByRole('button', { name: 'Add files for a batch…' }).click()
  await page.getByRole('button', { name: 'Run 3 remaining files' }).click()
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('1 of 3 batch jobs failed')
  await alert.getByRole('button', { name: 'Copy command' }).click()
  await expect(alert.getByRole('button', { name: 'Copied' })).toBeVisible()
  const [fromBanner] = await copied(page)
  expect(fromBanner).toContain('/data/run02.mzML')

  await goTo(page, 'History')
  const failed = historyRow(page, 'run02.mzML')
  await expect(failed).toContainText('Failed (exit 1)')
  await expect(failed).toContainText('incomplete')
  await expect(failed.getByRole('button', { name: 'Open' })).toHaveCount(0)
  await failed.getByRole('button', { name: 'Copy command' }).click()
  expect((await copied(page))[1]).toBe(fromBanner)
  for (const name of ['run01.mzML', 'run03.mzML']) await expect(historyRow(page, name)).toContainText('Finished')
  const recs = await mockState<RunRecord[]>(page, 'history')
  for (const r of recs) expect(r.argv.filter((a) => TEMPORARY.test(a))).toEqual([])
})

test('a cancelled run is marked incomplete in History and never opens as if complete', async ({ page }) => {
  await openApp(page, 'slow')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.getByRole('button', { name: 'Run on run01.mzML' }).click()
  // P2b: Cancel is the Results running state's (GUI-DESIGN 3 S2; was the
  // pill's, safety.spec). Click it once the run is under way.
  const running = page.getByRole('region', { name: 'Running' })
  await expect(running).toContainText(/Tagging spectra.*50%/)
  await running.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.locator('.last-run')).toContainText('partial outputs removed')
  await goTo(page, 'History')
  const row = historyRow(page, 'run01.mzML')
  await expect(row).toContainText('Cancelled')
  await expect(row).toContainText('incomplete')
  await expect(row.getByRole('button', { name: 'Open' })).toHaveCount(0)
  await expect(row.getByRole('button', { name: 'Reveal' })).toHaveCount(0)
  // Its tags file, opened from Results, says the run was cancelled.
  await goTo(page, 'Results')
  await page.getByRole('button', { name: 'Open a tags TSV…' }).click()
  await expect(page.locator('.tabpanel')).toContainText('The run that wrote /data/run01.tags.tsv was cancelled')
})

test('Settings into form puts a recorded run back into Setup, and Undo takes it out again', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.getByRole('button', { name: 'Run on run01.mzML' }).click()
  await expect(page.locator('.last-run')).toContainText('run01.mzML')
  // The form has moved on since that run.
  await goTo(page, 'Setup')
  await page.locator('#out').fill('/data/elsewhere.tags.tsv')
  await goTo(page, 'History')
  await historyRow(page, 'run01.mzML').getByRole('button', { name: 'Settings into form' }).click()
  const note = page.getByRole('status', { name: 'History' })
  await expect(note).toContainText('The settings of run01.mzML are in the form.')
  await note.getByRole('button', { name: 'Go to Setup' }).click()
  await expect(page.locator('#out')).toHaveValue('/data/run01.tags.tsv')
  await goTo(page, 'History')
  await note.getByRole('button', { name: 'Undo' }).click()
  await goTo(page, 'Setup')
  await expect(page.locator('#out')).toHaveValue('/data/elsewhere.tags.tsv')
})

// Review of PR h (P0a): the record that alone marks a left-over tags file as
// incomplete is not deleted, so the file never opens as complete.
test('Delete record asks first, and keeps the record that marks a left-over tags file incomplete', async ({ page }) => {
  await openApp(page, 'existing')
  await goTo(page, 'History')
  const row = historyRow(page, 'run01.mzML')
  await expect(row).toContainText('Cancelled')
  await row.getByRole('button', { name: 'Delete record' }).click()
  const ask = row.getByRole('group', { name: 'Delete this record?' })
  await expect(ask.getByRole('button', { name: 'Keep' })).toBeFocused()
  await ask.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByRole('status', { name: 'History' })).toContainText(
    'The record was kept: it is what marks /data/run01.tags.tsv as incomplete'
  )
  await expect(row).toHaveCount(1)
  await expect(row.getByRole('button', { name: 'Delete record' })).toBeFocused()
  expect((await mockState<RunRecord[]>(page, 'history')).map((r) => r.id)).toEqual(['1762419600000-1'])
  await goTo(page, 'Results')
  await page.getByRole('button', { name: 'Open a tags TSV…' }).click()
  await expect(page.locator('.tabpanel')).toContainText('The run that wrote /data/run01.tags.tsv was cancelled')
})

// Review of PR h (GUI-DESIGN 3 S9, 6.5): Re-run starts the recorded run
// again with its own parameters; its record keeps the same command line,
// and a deleted record hands keyboard focus to the row that takes its place.
test('Re-run records the same command line; Delete record keeps focus in the list', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.getByRole('button', { name: 'Run on run01.mzML' }).click()
  await expect(page.locator('.last-run')).toContainText('run01.mzML')
  // The form moves on; the Re-run does not use it.
  await goTo(page, 'Setup')
  await page.locator('#out').fill('/data/elsewhere.tags.tsv')
  await goTo(page, 'History')
  await historyRow(page, 'run01.mzML').getByRole('button', { name: 'Re-run' }).click()
  await expect(page.locator('nav[aria-label="Views"] [aria-current="page"]')).toHaveAttribute('data-view', 'results')
  await expect(page.locator('.last-run')).toContainText('run01.mzML')
  await goTo(page, 'History')
  await expect(historyRow(page, 'run01.mzML')).toHaveCount(2)
  const recs = await mockState<RunRecord[]>(page, 'history')
  expect(recs).toHaveLength(2)
  expect(recs[0].argv).toEqual(recs[1].argv)
  expect(recs[0].params).toEqual(recs[1].params)
  expect(recs[0].argv).toContain('/data/run01.tags.tsv')
  // Delete the newer record: focus moves to the remaining row.
  const first = page.getByRole('table', { name: 'Run history' }).getByRole('row').nth(1)
  await first.getByRole('button', { name: 'Delete record' }).click()
  await first.getByRole('group', { name: 'Delete this record?' }).getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByRole('status', { name: 'History' })).toContainText('files were kept')
  await expect(historyRow(page, 'run01.mzML')).toHaveCount(1)
  await expect(historyRow(page, 'run01.mzML').getByRole('button').first()).toBeFocused()
})
