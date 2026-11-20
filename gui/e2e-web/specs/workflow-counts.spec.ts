// Review round 3: each workflow's Results come from one real run (the
// `workflows` scenario of the e2e bridge: src/fixtures/cli-1.15/workflows),
// so the Overview's counts are the counts of the tabs beside it: the tags of
// the Overview are the rows of Tags, the MS2 spectra those of the QC report
// and the identifiability ranking.
import { test, expect, openApp, goTo } from './fixtures'

const RUNS = [
  { name: 'Export tags', tags: '5,937' },
  { name: 'Run QC', tags: '5,937', qc: '139' },
  { name: 'Mass-shift survey', tags: '6,279', fasta: '/data/ecoli.fasta' },
  { name: 'Species', tags: '6,301' },
  { name: 'Database reduction', tags: '6,279', fasta: '/data/ecoli.fasta', shortlist: '2 of 3 proteins kept' },
  { name: 'Identifiability triage', tags: '5,937', ranked: '139' },
  { name: 'Characterize a run', tags: '598' }
]

for (const w of RUNS) {
  test(`${w.name}: the Overview counts what its tabs show`, async ({ page }) => {
    await openApp(page, 'workflows')
    await page.getByRole('radio', { name: new RegExp(`^${w.name}`) }).check()
    await page.getByRole('button', { name: 'Choose file…' }).click()
    await page.locator('#instrument').selectOption('iontrap-cid')
    if (w.fasta) await page.locator('#p-recon_fasta').fill(w.fasta)
    // Species at 0.3 Da is a red flag of the checks before the run: answered.
    const anyway = page.getByRole('button', { name: 'Run anyway' })
    if ((await anyway.count()) > 0) await anyway.first().click()
    await page.locator('.view-setup .runbar').getByRole('button', { name: /^Run$/ }).click()
    await expect(page.getByRole('region', { name: 'Running' })).toHaveCount(0, { timeout: 30_000 })
    await goTo(page, 'Results')
    await page.getByRole('tab', { name: 'Overview' }).click()
    const tile = (label: string) => page.locator(`section.tile[aria-label="${label}"] .tile-value`)
    await expect(tile('Tags')).toHaveText(w.tags)
    if (w.shortlist) await expect(tile('Shortlist')).toHaveText(w.shortlist)
    const ms2 = (await tile('MS2 spectra').textContent())?.trim()
    await page.getByRole('tab', { name: 'Tags' }).click()
    await expect(page.locator('.rt-title .muted')).toContainText(`${w.tags} tags`)
    if (w.qc) {
      await page.getByRole('tab', { name: 'QC' }).click()
      await expect(page.locator('.qc-strip')).toContainText(`MS2 spectra${ms2}`)
      expect(ms2).toBe(w.qc)
    }
    if (w.ranked) {
      await page.getByRole('tab', { name: 'Triage' }).click()
      await expect(page.locator('.report-sum')).toContainText(`${ms2} MS2 spectra`)
    }
  })
}
