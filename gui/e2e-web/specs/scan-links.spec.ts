// Feedback 20261124T125757Z_882babf9: a scan in the Glyco and Mass shifts
// tables opens the Spectrum tab at that spectrum, as in Tags: the spectrum
// icon and the scan are one button, and Enter on the row opens it too.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect, openApp, chooseTask, toStep } from './fixtures'

const CLI = fileURLToPath(new URL('../../src/fixtures/cli/v112-pxd014764-delta-ext3/', import.meta.url))
const body = (f: string): string[][] => readFileSync(`${CLI}${f}`, 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t'))
const scan = (id: string): string => /scan=\d+/.exec(id)![0]

// The Mass-shift survey of the recon gate run with the glyco report (as p4c.spec.ts).
async function runOn(page: Page): Promise<void> {
  await openApp(page, 'gate-recon')
  await chooseTask(page, 'Mass-shift survey')
  await toStep(page, 'Inputs')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.locator('#p-recon_fasta').fill('/data/human.fasta')
  await toStep(page, 'Settings')
  await page.locator('details.advanced > summary').click()
  await page.locator('summary', { hasText: 'Other analyses' }).click()
  await page.locator('summary', { has: page.locator('.sec-title', { hasText: /^Glycopeptides$/ }) }).click()
  await page.locator('#p-glyco').check()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Mass shifts' })).toHaveAttribute('aria-selected', 'true')
}

test('Glyco: a click on the scan opens it in Spectrum', async ({ page }) => {
  // The first flagged row by oxonium share, as the table sorts it.
  const top = body('run.tags.glyco.tsv').filter((r) => r[3] === '1').sort((a, b) => Number(b[2]) - Number(a[2]))[0][0]
  await runOn(page)
  await page.getByRole('tab', { name: 'Glyco' }).click()
  const grid = page.getByRole('grid', { name: 'Glyco spectra' })
  const link = grid.getByRole('button', { name: `Open spectrum ${scan(top)}` }).first()
  await expect(link.locator('svg')).toBeVisible()
  await link.click()
  await expect(page.getByRole('tab', { name: 'Spectrum' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#tabpanel .sp-head h2')).toContainText(scan(top))
})

test('Glyco: Enter on the active row opens its spectrum', async ({ page }) => {
  await runOn(page)
  await page.getByRole('tab', { name: 'Glyco' }).click()
  const grid = page.getByRole('grid', { name: 'Glyco spectra' })
  await grid.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tab', { name: 'Spectrum' })).toHaveAttribute('aria-selected', 'true')
})

test('Mass shifts placements: a click on the scan opens it in Spectrum', async ({ page }) => {
  const first = body('run.recon.tsv')[0][0]
  await runOn(page)
  await page.getByRole('button', { name: 'Placements', exact: true }).click()
  const grid = page.getByRole('grid', { name: 'Placements' })
  await grid.getByRole('button', { name: /^Open spectrum / }).first().click()
  await expect(page.getByRole('tab', { name: 'Spectrum' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#tabpanel .sp-head h2')).toContainText(scan(first))
})
