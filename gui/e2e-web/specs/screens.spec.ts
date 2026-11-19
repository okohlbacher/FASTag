// Review screenshots (doc/GUI-WORKFLOWS.md 5): the landing screen, every
// workflow's Setup with Advanced closed and open (the whole form: the Setup
// pane scrolls inside itself, so the window is made as tall as its content),
// Batch mode, two (?) popovers, the run bar, and every Results view after a
// run of each workflow. Not a check: it only runs with SCREENS_DIR set, for
// design reviews by people and models.
import type { Page } from '@playwright/test'
import { test, expect, openApp, goTo } from './fixtures'

const DIR = process.env.SCREENS_DIR
test.skip(!DIR, 'set SCREENS_DIR to write review screenshots')
test.use({ viewport: { width: 1280, height: 800 } })

const shot = (name: string): string => `${DIR}/${name}.png`
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

const WORKFLOWS = [
  { name: 'Export tags', fixture: 'gate' },
  { name: 'Run QC', fixture: 'gate' },
  { name: 'Mass-shift survey', fixture: 'gate-recon', fasta: '/data/human.fasta' },
  { name: 'Species', fixture: 'gate' },
  { name: 'Database reduction', fixture: 'gate', fasta: '/data/Ecoli_MS2_small.fasta' },
  { name: 'Identifiability triage', fixture: 'gate' },
  { name: 'Characterize a run', fixture: 'gate' }
]

/// The whole Setup form in one picture: the window as tall as the pane's
/// content, then back to the default size.
async function fullSetup(page: Page, name: string): Promise<void> {
  const h = await page.evaluate(() => {
    const body = document.querySelector('.view-setup .controls-body')
    const bar = document.querySelector('.view-setup .runbar')
    return (body?.scrollHeight ?? 800) + (bar?.scrollHeight ?? 0) + 120
  })
  await page.setViewportSize({ width: 1280, height: Math.min(Math.max(800, h), 16000) })
  await page.waitForTimeout(150)
  await page.screenshot({ path: shot(name), fullPage: true })
  await page.setViewportSize({ width: 1280, height: 800 })
}

/// Advanced open, with every group of it open (summaries only: no button
/// that would leave the Setup view).
async function openAdvanced(page: Page): Promise<void> {
  const adv = page.locator('details.advanced > summary')
  if ((await adv.getAttribute('aria-expanded')) !== 'true') await adv.click()
  // Outer groups first: a closed group hides the summaries inside it.
  const closed = page.locator('details.advanced details:not([open]) > summary:visible')
  for (let k = 0; k < 80 && (await closed.count()) > 0; k++) await closed.first().click()
}

const workflow = (page: Page, name: string) => page.getByRole('radio', { name: new RegExp(`^${name}`) })

test('setup screens of every workflow', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium')
  test.setTimeout(120_000)
  await openApp(page, 'gate')
  await page.screenshot({ path: shot('00-landing') })
  for (const [i, w] of WORKFLOWS.entries()) {
    await workflow(page, w.name).check()
    await page.locator('.view-setup .controls-body').evaluate((e) => e.scrollTo(0, 0))
    await page.screenshot({ path: shot(`10-setup-${i + 1}-${slug(w.name)}`) })
    await fullSetup(page, `11-setup-${i + 1}-${slug(w.name)}-full`)
    await openAdvanced(page)
    await fullSetup(page, `12-setup-${i + 1}-${slug(w.name)}-advanced`)
    await page.locator('details.advanced > summary').click()
  }
  // Batch mode of the Input card.
  await workflow(page, 'Characterize a run').check()
  await page.getByRole('radio', { name: 'Batch' }).check()
  await page.locator('.view-setup .controls-body').evaluate((e) => e.scrollTo(0, 0))
  await page.screenshot({ path: shot('13-setup-batch-mode') })
  await page.getByRole('radio', { name: 'One file' }).check()
})

test('help popovers and the run bar', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium')
  await openApp(page, 'gate')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  for (const name of ['extension', 'max_evalue']) {
    const q = page.locator(`button[data-param-help="${name}"]`).first()
    await q.scrollIntoViewIfNeeded()
    await q.click()
    await expect(page.getByRole('dialog', { name: /^About / })).toBeVisible()
    await page.screenshot({ path: shot(`20-help-popover-${name}`) })
    await page.keyboard.press('Escape')
  }
  await page.locator('.view-setup .runbar').screenshot({ path: shot('21-run-bar') })
  await page.screenshot({ path: shot('22-setup-file-chosen') })
})

for (const [i, w] of WORKFLOWS.entries()) {
  test(`results views after a ${w.name} run`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium')
    test.setTimeout(90_000)
    await openApp(page, w.fixture)
    await workflow(page, w.name).check()
    await page.getByRole('button', { name: 'Choose file…' }).click()
    if (w.fasta) await page.locator('#p-recon_fasta').fill(w.fasta)
    const run = page.locator('.view-setup .runbar').getByRole('button', { name: /^Run$/ })
    await expect(run).toBeEnabled({ timeout: 10_000 })
    await run.click()
    await expect(page.getByRole('region', { name: 'Running' })).toHaveCount(0, { timeout: 60_000 })
    await goTo(page, 'Results')
    await page.waitForTimeout(500)
    const tabs = page.getByRole('tab')
    const n = await tabs.count()
    for (let t = 0; t < n; t++) {
      const tab = tabs.nth(t)
      const name = slug((await tab.textContent()) || `tab${t}`)
      await tab.click()
      await page.waitForTimeout(400)
      await page.screenshot({ path: shot(`3${i + 1}-results-${slug(w.name)}-${t}-${name}`) })
    }
  })
}
