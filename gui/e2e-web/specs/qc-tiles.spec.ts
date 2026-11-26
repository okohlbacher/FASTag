// Run QC tiles on the Overview (PLAN-qc-clarity step 4), after
// tile-links.spec.ts: the QC report's values are tiles of the Overview,
// each says what the QC page says, and a click or Enter opens the QC tab.
import type { Page } from '@playwright/test'
import { test, expect, openApp, chooseTask, toStep } from './fixtures'

const tile = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
/// The value of a tile of the QC page's summary strip.
const qcValue = (page: Page, label: string) => page.locator('.qc-tiles .stat', { has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd').first()

async function runQc(page: Page): Promise<void> {
  await openApp(page, 'gate')
  await chooseTask(page, 'Run QC')
  await toStep(page, 'Inputs')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  // Run QC lands on its QC tab; the Overview is one tab away.
  await expect(page.getByRole('tab', { name: 'QC' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'Overview' }).click()
}

test('the QC values are Overview tiles with the values of the QC page', async ({ page }) => {
  await runQc(page)
  const want: Record<string, string> = {}
  for (const name of ['Tagged (E ≤ 0.01)', 'Isobaric kit', 'Redundancy']) want[name] = ((await tile(page, name).locator('.tile-value').textContent()) ?? '').trim()
  await expect(tile(page, 'Top charge')).toBeVisible()
  await page.getByRole('tab', { name: 'QC' }).click()
  for (const [name, v] of Object.entries(want)) await expect(qcValue(page, name.replace(/[()]/g, '\\$&')), name).toHaveText(v)
})

test('a click on a QC tile opens the QC tab', async ({ page }) => {
  await runQc(page)
  for (const name of ['Isobaric kit', 'Redundancy', 'Top charge', 'Tagged (E ≤ 0.01)']) {
    await expect(tile(page, name).locator('.chev-icon')).toHaveCount(1)
    await tile(page, name).locator('.tile-value').click()
    await expect(page.getByRole('tab', { name: 'QC' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('#tabpanel :focus')).toHaveCount(1)
    await page.getByRole('tab', { name: 'Overview' }).click()
  }
})

test('the keyboard: Enter on the Isobaric kit link opens QC', async ({ page }) => {
  await runQc(page)
  await tile(page, 'Isobaric kit').getByRole('button', { name: 'Isobaric kit: open the QC tab' }).press('Enter')
  await expect(page.getByRole('tab', { name: 'QC' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#tabpanel :focus')).toHaveCount(1)
})
