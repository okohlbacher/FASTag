import { test, expect, openApp } from './fixtures'

test('a three-file batch where run02 fails: its banner opens run02 own log after run03 finished', async ({ page }) => {
  await openApp(page, 'batch-fail')
  await page.getByRole('button', { name: 'Add files for a batch…' }).click()
  await page.getByRole('button', { name: 'Run 3 remaining files' }).click()
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('1 of 3 batch jobs failed')
  await expect(page.getByText('2/3 done')).toBeVisible()
  // run03 ran last: the live log is its own.
  const log = page.locator('pre.log')
  await alert.getByRole('button', { name: 'Show full log' }).click()
  await expect(log).toBeVisible()
  await expect(page.locator('.drawer-toggle .lbl')).toHaveText('Log of run02.mzML')
  await expect(log).toContainText('run02.mzML: Error: Unable to read file')
  await expect(log).not.toContainText('run03.mzML')
  await expect(log).not.toContainText('run01.mzML')
  // Each job row opens its own log.
  await page.getByRole('button', { name: 'Log of run03.mzML' }).click()
  await expect(log).toContainText('run03.mzML: 139 MS2 spectra')
  await expect(log).not.toContainText('run02.mzML')
})
