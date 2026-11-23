// Review screenshots (doc/GUI-WORKFLOWS.md 5): the landing screen, every
// workflow's Setup with Advanced closed and open (the whole form: the Setup
// pane scrolls inside itself, so the window is made as tall as its content),
// Batch mode, four (?) popovers (one with a tip, one of the third column), the run bar, and every Results view after a
// run of each workflow. Not a check: it only runs with SCREENS_DIR set, for
// design reviews by people and models.
import type { Page } from '@playwright/test'
import { test, expect, openApp, goTo, toStep, chooseTask } from './fixtures'

const DIR = process.env.SCREENS_DIR
test.skip(!DIR, 'set SCREENS_DIR to write review screenshots')
test.use({ viewport: { width: 1280, height: 800 } })

const shot = (name: string): string => `${DIR}/${name}.png`
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

// Every Results view comes from one real run of its workflow (the
// `workflows` scenario: src/fixtures/cli-1.15/workflows, the E. coli example
// with the Ion trap CID preset), so the Overview and the tabs agree.
const WORKFLOWS = [
  { name: 'Generate tags', fixture: 'workflows' },
  { name: 'Run QC', fixture: 'workflows' },
  { name: 'Mass-shift survey', fixture: 'workflows', fasta: '/data/ecoli.fasta' },
  { name: 'Species', fixture: 'workflows' },
  { name: 'Database reduction', fixture: 'workflows', fasta: '/data/ecoli.fasta' },
  { name: 'Identifiability triage', fixture: 'workflows' },
  { name: 'Characterize a run', fixture: 'workflows' }
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

/// The open (?) popover lies inside the Setup pane, which clips it: no
/// word of its text or flag is cut off at the pane's edge.
async function expectPopoverInPane(page: Page): Promise<void> {
  const pop = await page.locator('.help-pop').boundingBox()
  const pane = await page.locator('.view-setup .controls-body').boundingBox()
  expect(pop && pane).toBeTruthy()
  expect(pop!.x).toBeGreaterThanOrEqual(pane!.x - 1)
  expect(pop!.x + pop!.width).toBeLessThanOrEqual(pane!.x + pane!.width + 1)
}


test('setup screens of every workflow', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium')
  test.setTimeout(120_000)
  await openApp(page, 'gate')
  await page.screenshot({ path: shot('00-landing') })
  for (const [i, w] of WORKFLOWS.entries()) {
    await chooseTask(page, w.name)
    await page.locator('.view-setup .controls-body').evaluate((e) => e.scrollTo(0, 0))
    // The chevron of the Advanced card closed just before turns back.
    await page.waitForTimeout(250)
    await page.screenshot({ path: shot(`10-setup-${i + 1}-${slug(w.name)}`) })
    await fullSetup(page, `11-setup-${i + 1}-${slug(w.name)}-full`)
    await toStep(page, 'Settings')
    await openAdvanced(page)
    await fullSetup(page, `12-setup-${i + 1}-${slug(w.name)}-advanced`)
    await page.locator('details.advanced > summary').click()
  }
  // Characterize with the alkylation report on: the Extension it raises,
  // said beside the report (round 9), at full page (round 10).
  await chooseTask(page, 'Characterize a run')
  await toStep(page, 'Outputs & run')
  const alk = page.locator('#out-alkylation_out')
  if ((await alk.count()) > 0) {
    await alk.scrollIntoViewIfNeeded()
    await alk.check()
    await page.waitForTimeout(150)
    // At full page (round 10): the note beside the report, and the Settings
    // card it refers to.
    await page.locator('.view-setup .controls-body').evaluate((e) => e.scrollTo(0, 0))
    await fullSetup(page, '14-setup-characterize-alkylation-on')
    await alk.uncheck()
  }
  // Batch mode of Inputs.
  await chooseTask(page, 'Characterize a run')
  await toStep(page, 'Inputs')
  await page.getByRole('radio', { name: 'Batch' }).check()
  await page.locator('.view-setup .controls-body').evaluate((e) => e.scrollTo(0, 0))
  await page.screenshot({ path: shot('13-setup-batch-mode') })
  await page.getByRole('radio', { name: 'One file' }).check()
})

test('help popovers and the run bar', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium')
  await openApp(page, 'gate')
  await toStep(page, 'Inputs')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  // tag_length sits in the third column of Settings: its popover opens to
  // the left of its (?).
  for (const name of ['extension', 'max_evalue', 'tag_length']) {
    const q = page.locator(`button[data-param-help="${name}"]`).first()
    if ((await q.count()) === 0) continue
    await q.scrollIntoViewIfNeeded()
    await q.click()
    await expect(page.getByRole('dialog', { name: /^About / })).toBeVisible()
    await expectPopoverInPane(page)
    await page.screenshot({ path: shot(`20-help-popover-${name}`) })
    await page.keyboard.press('Escape')
  }
  // A (?) with a tip below its text (digest_models_version), in the
  // Characterize workflow's own Advanced group.
  await workflow(page, 'Characterize a run').check()
  await openAdvanced(page)
  const tip = page.locator('button[data-param-help="digest_models_version"]').first()
  if ((await tip.count()) > 0) {
    await tip.scrollIntoViewIfNeeded()
    await tip.click()
    await expect(page.getByRole('dialog', { name: /^About / })).toBeVisible()
    await expectPopoverInPane(page)
    await page.screenshot({ path: shot('20-help-popover-digest_models_version') })
    await page.keyboard.press('Escape')
  }
  await page.locator('details.advanced > summary').click()
  await page.locator('.view-setup .runbar').screenshot({ path: shot('21-run-bar') })
  await page.screenshot({ path: shot('22-setup-file-chosen') })
})

for (const [i, w] of WORKFLOWS.entries()) {
  test(`results views after a ${w.name} run`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium')
    test.setTimeout(90_000)
    await openApp(page, w.fixture)
    await workflow(page, w.name).check()
    await toStep(page, 'Inputs')
    await page.getByRole('button', { name: 'Choose file…' }).click()
    // The example's MS2 are ion trap CID, as the recorded runs were.
    await page.locator('#instrument').selectOption('iontrap-cid')
    if (w.fasta) await page.locator('#p-recon_fasta').fill(w.fasta)
    // Species at 0.3 Da is a red flag of the checks before the run: answered.
    const anyway = page.getByRole('button', { name: 'Run anyway' })
    if ((await anyway.count()) > 0) await anyway.first().click()
    const run = page.locator('.view-setup .runbar').getByRole('button', { name: /^Run$/ })
    await expect(run).toBeEnabled({ timeout: 10_000 })
    await run.click()
    await expect(page.getByRole('region', { name: 'Running' })).toHaveCount(0, { timeout: 60_000 })
    await goTo(page, 'Results')
    await page.waitForTimeout(500)
    const tabs = page.getByRole('tab')
    const n = await tabs.count()
    const names: string[] = []
    for (let t = 0; t < n; t++) names.push((await tabs.nth(t).textContent()) || `tab${t}`)
    for (const [t, label] of names.entries()) {
      // The Spectrum tab with a spectrum in it: opened from the Triage
      // ranking or the Tags table (their Open in Spectrum), as a user would.
      if (label === 'Spectrum') {
        const from = names.includes('Triage') ? 'Triage' : 'Tags'
        if (names.includes(from)) {
          await page.getByRole('tab', { name: new RegExp(`^${from}`) }).click()
          await page.waitForTimeout(400)
          const open = page.getByRole('button', { name: 'Open in Spectrum' }).first()
          if ((await open.count()) > 0 && (await open.isEnabled())) await open.click()
          else {
            const row = page.locator('[role="grid"] [role="row"]').nth(1)
            if ((await row.count()) > 0) {
              await row.click()
              await page.keyboard.press('Enter')
            }
          }
        }
      }
      await page.getByRole('tab', { name: new RegExp(`^${label.replace(/\d+$/, '')}`) }).first().click()
      await page.waitForTimeout(500)
      await page.screenshot({ path: shot(`3${i + 1}-results-${slug(w.name)}-${t}-${slug(label)}`) })
    }
  })
}
