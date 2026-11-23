// Per workflow (doc/GUI-WORKFLOWS.md 1 and 3): the exact tabs a run opens, in
// the workflow's order, with no tab for a report nobody asked for (the e2e
// bridge writes only the outputs a run was sent); and Setup cards 1 to 4 fit
// the default window for every workflow but Database reduction.
import { test, expect, openApp, chooseTask, toStep } from './fixtures'

const RUNS = [
  { name: 'Export tags', fixture: 'gate', tabs: ['Overview', 'Tags', 'Spectrum'] },
  { name: 'Run QC', fixture: 'gate', tabs: ['Overview', 'QC', 'Tags', 'Spectrum'] },
  { name: 'Mass-shift survey', fixture: 'gate-recon', fasta: '/data/human.fasta', tabs: ['Overview', 'Mass shifts', 'Tags', 'Spectrum'] },
  { name: 'Species', fixture: 'gate', tabs: ['Overview', 'Species', 'Tags', 'Spectrum'] },
  { name: 'Database reduction', fixture: 'gate', fasta: '/data/Ecoli_MS2_small.fasta', tabs: ['Overview', 'Shortlist', 'Tags', 'Spectrum'] },
  { name: 'Identifiability triage', fixture: 'gate', tabs: ['Overview', 'Triage', 'Tags', 'Spectrum'] },
  { name: 'Characterize a run', fixture: 'gate', tabs: ['Overview', 'Digest', 'Species', 'Glyco', 'Tags', 'Spectrum'] }
]

for (const w of RUNS) {
  test(`${w.name}: the tabs of its run, in its order`, async ({ page }) => {
    await openApp(page, w.fixture)
    await chooseTask(page, w.name)
    await toStep(page, 'Inputs')
    await page.getByRole('button', { name: 'Choose file…' }).click()
    if (w.fasta) await page.locator('#p-recon_fasta').fill(w.fasta)
    await page.locator('.view-setup .runbar').getByRole('button', { name: /^Run$/ }).click()
    await expect(page.getByRole('region', { name: 'Running' })).toHaveCount(0, { timeout: 20_000 })
    await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible()
    await expect
      .poll(async () => (await page.getByRole('tab').allTextContents()).map((t) => t.replace(/\d+$/, '')))
      .toEqual(w.tabs)
    // The Overview names the workflow.
    await page.getByRole('tab', { name: 'Overview' }).click()
    await expect(page.locator('.overview-sub')).toContainText(w.name)
  })
}

test('each Setup step fits 1280 x 800 (Advanced closed), Outputs & run but for Mass-shift survey and Database reduction', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openApp(page, 'gate')
  const fits = async (what: string): Promise<void> => {
    const body = page.locator('.view-setup .controls-body')
    await body.evaluate((e) => e.scrollTo(0, 0))
    const [scroll, client] = await body.evaluate((e) => [e.scrollHeight, e.clientHeight])
    expect(scroll, `${what}: ${scroll} > ${client}`).toBeLessThanOrEqual(client + 1)
  }
  await fits('Task')
  for (const w of RUNS) {
    await chooseTask(page, w.name)
    await toStep(page, 'Inputs')
    await page.getByRole('button', { name: /^(Choose file|Change)…$/ }).first().click()
    await fits(`${w.name} Inputs`)
    await toStep(page, 'Settings')
    await fits(`${w.name} Settings`)
    if (w.name === 'Mass-shift survey' || w.name === 'Database reduction') continue
    await toStep(page, 'Outputs & run')
    await fits(`${w.name} Outputs & run`)
  }
})
