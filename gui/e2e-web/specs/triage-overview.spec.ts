// The overview at the top of Results > Triage: above the ranked table, three
// charts, no sideways scroll at 1024 and 1280 px, in light and dark. Two real
// censuses: `gate` (E. coli, best tag lengths 3 to 9) and `workflows` (the
// triage run of the Setup workflow: every tag has length 3). With
// SCREENS_DIR set it also writes review screenshots.
import type { Page } from '@playwright/test'
import { test, expect, openApp, chooseTask, toStep } from './fixtures'

const DIR = process.env.SCREENS_DIR

async function runTriage(page: Page, fixture: string): Promise<void> {
  await openApp(page, fixture)
  await chooseTask(page, 'Identifiability triage')
  await toStep(page, 'Inputs')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.locator('.view-setup .runbar').getByRole('button', { name: /^Run$/ }).click()
  await expect(page.getByRole('region', { name: 'Running' })).toHaveCount(0, { timeout: 20_000 })
  await page.getByRole('tab', { name: /^Triage/ }).click()
  await expect(page.getByRole('region', { name: 'Identifiability overview' })).toBeVisible()
}

for (const fixture of ['gate', 'workflows']) {
  for (const width of [1280, 1024]) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`${fixture}: the overview above the table at ${width} px, ${scheme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 1280 ? 800 : 768 })
        await page.emulateMedia({ colorScheme: scheme })
        await runTriage(page, fixture)
        const ov = page.getByRole('region', { name: 'Identifiability overview' })
        await expect(ov.locator('figure.tri-chart')).toHaveCount(3)
        await expect(ov.getByRole('region', { name: /^Strong tag/ })).toBeVisible()
        // Above the ranked table.
        const table = page.getByRole('grid', { name: 'Spectra ranked by identifiability' })
        const [a, b] = [await ov.boundingBox(), await table.boundingBox()]
        expect(a && b && a.y + a.height <= b.y + 1).toBeTruthy()
        if (fixture === 'workflows') await expect(ov.getByText(/All tags have length 3/)).toBeVisible()
        else await expect(ov.getByText(/All tags have length/)).toHaveCount(0)
        // Nothing scrolls sideways, and every chart fits its card.
        const over = await page.evaluate(() => {
          const out: string[] = []
          for (const el of document.querySelectorAll<HTMLElement>('.tabpanel, .tablewrap, .tri-overview, .tri-chart')) {
            if (el.scrollWidth > el.clientWidth + 1) out.push(`${el.className}: ${el.scrollWidth} > ${el.clientWidth}`)
          }
          const doc = document.documentElement
          if (doc.scrollWidth > doc.clientWidth + 1) out.push(`page: ${doc.scrollWidth} > ${doc.clientWidth}`)
          return out
        })
        expect(over).toEqual([])
        // The tooltip on hover.
        const plot = ov.locator('.tri-plot').nth(1)
        await plot.scrollIntoViewIfNeeded()
        const box = (await plot.boundingBox())!
        await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5)
        await expect(page.getByRole('tooltip')).toBeVisible()
        if (DIR) {
          await page.mouse.move(0, 0)
          const name = `${DIR}/3x-results-identifiability-triage-overview-${fixture}-${width}-${scheme}`
          await page.locator('.tablewrap').evaluate((e) => e.scrollTo(0, 0))
          await page.screenshot({ path: `${name}.png` })
          // The whole overview: the Results pane scrolls inside itself, so the
          // window is made as tall as the overview and the table's head.
          await page.setViewportSize({ width, height: 2000 })
          await page.waitForTimeout(150)
          await page.screenshot({ path: `${name}-full.png` })
        }
      })
    }
  }
}
