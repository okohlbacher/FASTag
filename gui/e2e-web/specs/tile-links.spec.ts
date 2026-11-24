// Overview tiles as links (feedback 20261124T125609Z_a8f957f6) in a real
// browser: a click or Enter on a tile opens its tab at its section, focus
// on that heading; a tile without a tab is no link.
import type { Page } from '@playwright/test'
import { test, expect, openApp, chooseTask, toStep } from './fixtures'

const tile = (page: Page, name: string) => page.getByRole('region', { name, exact: true })

async function characterize(page: Page): Promise<void> {
  await openApp(page, 'gate')
  await chooseTask(page, 'Characterize a run')
  await toStep(page, 'Inputs')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
}

test('a click on the Protease card opens Digest with focus on its Protease heading', async ({ page }) => {
  await characterize(page)
  await tile(page, 'Protease').locator('.tile-value').click()
  await expect(page.getByRole('tab', { name: /^Digest/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#dg-digest')).toBeFocused()
})

test('the keyboard: Enter on the Label link opens Digest at Labels', async ({ page }) => {
  await characterize(page)
  const link = tile(page, 'Label').getByRole('button', { name: 'Label: open the Digest tab' })
  await link.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tab', { name: /^Digest/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#dg-label')).toBeFocused()
  await page.getByRole('tab', { name: 'Overview' }).click()
  await tile(page, 'Top genus').getByRole('button', { name: /open the Species tab/ }).press('Enter')
  await expect(page.getByRole('tab', { name: /^Species/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#tabpanel h2').first()).toBeFocused()
})

test('a linked tile shows a pointer and a chevron; MS2 spectra (no QC tab) is no link', async ({ page }) => {
  await characterize(page)
  const p = tile(page, 'Protease')
  await expect(p.locator('.chev-icon')).toHaveCount(1)
  expect(await p.evaluate((e) => getComputedStyle(e).cursor)).toBe('pointer')
  const ms2 = tile(page, 'MS2 spectra')
  await expect(ms2.getByRole('button')).toHaveCount(0)
  expect(await ms2.evaluate((e) => getComputedStyle(e).cursor)).not.toBe('pointer')
})
