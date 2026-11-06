import { test, expect, openApp } from './fixtures'

// P1 PR a: each run's events come on its own Channel (the e2e bridge sends
// them the way events.rs does: phase, batched log, progress, Done last).
test('the run bar names the phase the run is in, and the time left once measured', async ({ page }) => {
  await openApp(page, 'slow')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.getByRole('button', { name: 'Run on run01.mzML' }).click()
  await expect(page.locator('.runbar .what')).toHaveText('Tagging spectra')
  await expect(page.locator('.runbar .pct')).toContainText('50% · 70 of 139 spectra')
  await expect(page.locator('.runbar .pct')).toContainText('left')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.locator('.last-run')).toContainText('partial outputs removed')
})

test('a batch keeps each job on its own Channel: run02 fails, run01 and run03 finish', async ({ page }) => {
  await openApp(page, 'batch-fail')
  await page.getByRole('button', { name: 'Add files for a batch…' }).click()
  await page.getByRole('button', { name: /^Run 3 remaining files/ }).click()
  await expect(page.getByText('2/3 done')).toBeVisible()
  // The live log is the last job's alone.
  await page.locator('.logdrawer .drawer-toggle').click()
  await expect(page.locator('pre.log')).toContainText('run03.mzML: 139 MS2 spectra, 2028 tags')
  await expect(page.locator('pre.log')).not.toContainText('run01.mzML')
  await expect(page.locator('pre.log')).not.toContainText('run02.mzML')
})
