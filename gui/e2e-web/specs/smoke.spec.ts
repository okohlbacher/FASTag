import { test, expect, goTo, openApp, toStep } from './fixtures'

test('the e2e build starts on its fixture bridge with nothing run yet', async ({ page }) => {
  await openApp(page)
  await expect(page).toHaveTitle(/FASTag/)
  // P2a: the app lands on Setup, on its first step (the task); the empty
  // Results is its own view. No Run before a task and a file are chosen.
  await expect(page.getByRole('heading', { name: 'What do you want to do?' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toHaveCount(0)
  await toStep(page, 'Inputs')
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled()
  await goTo(page, 'Results')
  await expect(page.getByRole('heading', { name: 'No results yet' })).toBeVisible()
  const fixture = await page.evaluate(() => (window as unknown as { __fastagE2E: { fixture: string } }).__fastagE2E.fixture)
  expect(fixture).toBe('default')
})

test('first result in two clicks: choose the file, run it', async ({ page }) => {
  // FASTag's unmodified defaults also open the tags table. setup.spec.ts
  // covers the Export tags landing task, which adds per-residue confidence.
  await openApp(page, 'default', 'defaults')
  await toStep(page, 'Inputs')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  // The real FASTag 1.11.0 tags of the public E. coli fixture.
  await expect(page.getByText('Showing 2,028 of 2,028')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'run01.tags.tsv' })).toBeVisible()
  await expect(page.getByRole('grid').getByRole('row').nth(1)).toContainText('scan=')
})
