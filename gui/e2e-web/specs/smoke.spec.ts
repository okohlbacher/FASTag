import { test, expect, goTo, openApp } from './fixtures'

test('the e2e build starts on its fixture bridge with nothing run yet', async ({ page }) => {
  await openApp(page)
  await expect(page).toHaveTitle(/FASTag/)
  // P2a: the app lands on Setup; the empty Results is its own view.
  await expect(page.getByRole('button', { name: 'Run' })).toBeDisabled()
  await goTo(page, 'Results')
  await expect(page.getByRole('heading', { name: 'No results yet' })).toBeVisible()
  const fixture = await page.evaluate(() => (window as unknown as { __fastagE2E: { fixture: string } }).__fastagE2E.fixture)
  expect(fixture).toBe('default')
})

test('first result in two clicks: choose the file, run it', async ({ page }) => {
  // From FASTag's defaults: the tags table is the first result (the landing
  // task's run opens on its digest report, setup.spec.ts).
  await openApp(page, 'default', 'defaults')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.getByRole('button', { name: 'Run on run01.mzML' }).click()
  // The real FASTag 1.11.0 tags of the public E. coli fixture.
  await expect(page.getByText('Showing 2,028 of 2,028')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'run01.tags.tsv' })).toBeVisible()
  await expect(page.getByRole('table').getByRole('row').nth(1)).toContainText('scan=')
})
