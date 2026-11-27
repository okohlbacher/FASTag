// FASTag 1.16.2, package B (Results): the findings of the 1.16.1 tests
// (output/ui-test-1.16.1/FINDINGS.md) on the Tags table, the Overview and
// the report tables, from the lanes' failing specs (work/ui-test/lanes/
// tags, survey, shell, database).
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect, openApp, chooseTask, toStep, goTo } from './fixtures'

const FIX = new URL('../../src/fixtures/', import.meta.url)
const read = (p: string): string => readFileSync(new URL(p, FIX), 'utf8')
const tile = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const runButton = (page: Page) => page.locator('.view-setup .actionbar').getByRole('button', { name: 'Run', exact: true })
const setMock = (page: Page, key: string, value: unknown): Promise<void> =>
  page.evaluate(([k, v]) => {
    ;(window as unknown as { __fastagE2E: { mock: Record<string, unknown> } }).__fastagE2E.mock[k as string] = v
  }, [key, value] as [string, unknown])

/// Generate tags on run01.mzML (or @p input), run, and wait for its Tags table.
async function w1Tags(page: Page, input?: string): Promise<void> {
  await openApp(page, 'workflows')
  if (input) await setMock(page, 'nextPickInput', input)
  await page.getByRole('button', { name: 'Continue with Generate tags ›' }).click()
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await runButton(page).click()
  await expect(page.locator('#run-status')).toContainText('Finished', { timeout: 20_000 })
  await expect(page.locator('.rt-status')).toContainText('Showing 6,279 of 6,279')
}

/// Run a workflow from Inputs and wait for its result tabs.
async function runWorkflow(page: Page, fixture: string, label: string, instrument?: string): Promise<void> {
  await openApp(page, fixture)
  await chooseTask(page, label)
  await toStep(page, 'Inputs')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  if (instrument) await page.locator('#instrument').selectOption(instrument)
  const anyway = page.getByRole('button', { name: 'Run anyway' })
  if ((await anyway.count()) > 0) await anyway.first().click()
  await runButton(page).click()
  await expect(page.getByRole('region', { name: 'Running' })).toHaveCount(0, { timeout: 20_000 })
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible({ timeout: 20_000 })
}

test.describe('tags-1: a double-click on a Tags row opens that row', () => {
  test('choosing a row does not move the table, at 960, 1200 and 1440 px', async ({ page }) => {
    test.setTimeout(60_000)
    const moved: Record<string, number> = {}
    for (const w of [960, 1200, 1440]) {
      await page.setViewportSize({ width: w, height: 800 })
      await w1Tags(page)
      const row = page.locator('.rt-rows .rt-row').nth(2)
      const before = (await row.boundingBox())!
      await row.click()
      await expect(page.getByRole('button', { name: 'Copy row' })).toBeVisible()
      moved[`${w} px`] = Math.round(((await row.boundingBox())!.y - before.y) * 10) / 10
    }
    expect(moved).toEqual({ '960 px': 0, '1200 px': 0, '1440 px': 0 })
  })

  test('nor with a long input path in the title', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 800 })
    await w1Tags(page)
    // A long path in the title bar (the heading wraps; a row choice must not re-wrap it).
    await page.locator('.rt-title h2 code').evaluate((e) => (e.textContent = `${'very_long_directory_name/'.repeat(6)}run01_with_a_long_name.tags.tsv`))
    const row = page.locator('.rt-rows .rt-row').nth(2)
    const before = (await row.boundingBox())!
    await row.click()
    await expect(page.getByRole('button', { name: 'Copy row' })).toBeVisible()
    expect((await row.boundingBox())!.y - before.y).toBe(0)
  })

  test('a double-click on the sixth row opens its spectrum and tag', async ({ page }) => {
    await w1Tags(page)
    const row = page.locator('.rt-rows .rt-row').nth(5)
    const spectrum = await row.locator('[role=gridcell]').first().getAttribute('title')
    const tag = await row.locator('[role=gridcell]').nth(1).getAttribute('title')
    await row.locator('[role=gridcell]').nth(1).dblclick()
    await expect(page.getByRole('tab', { name: 'Spectrum' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('ladder-verdict')).toBeVisible()
    const opened = await page.locator('.sp-head h2').getAttribute('title')
    const chosen = await page.getByRole('region', { name: 'Tags of this spectrum' }).locator('tbody tr[aria-selected="true"] td').first().textContent()
    expect({ spectrum: opened, tag: chosen }).toEqual({ spectrum, tag })
  })

  test('a double-click on the first row opens its spectrum and leaves the sort alone', async ({ page }) => {
    await w1Tags(page)
    await page.locator('.rt-rows .rt-row').first().locator('[role=gridcell]').nth(1).dblclick()
    await expect(page.getByRole('tab', { name: 'Spectrum' })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('tab', { name: 'Tags' }).click()
    const sorted = await page.locator('.rt-head [role="columnheader"][aria-sort]').evaluateAll((els) => els.map((e) => `${e.getAttribute('aria-label')}: ${e.getAttribute('aria-sort')}`))
    expect(sorted).toEqual(['E-value: ascending'])
  })
})

test('tags-10: with a CLI without -dump_spectrum the scan of a Tags row is plain text that says why', async ({ page }) => {
  await openApp(page, 'spectrum-1.11')
  await goTo(page, 'Results')
  await page.getByRole('button', { name: 'Open tags…' }).click()
  await expect(page.locator('.rt-status')).toContainText('Showing 2,028 of 2,028')
  await expect(page.locator('.rt-rows .rt-row button.rt-spec')).toHaveCount(0)
  await expect(page.locator('.rt-rows .rt-row').first().locator('[role=gridcell]').first()).toHaveAttribute('title', /Spectrum view needs FASTag 1\.12 or later/)
})

test('shell-5: the notice on a table a failed run left reads as a sentence', async ({ page }) => {
  await openApp(page, 'interrupted')
  await goTo(page, 'Results')
  await page.getByRole('button', { name: 'Open tags…' }).click()
  const panel = page.locator('.view-results .tabpanel')
  await expect(panel).toContainText('Incomplete. The run that wrote /data/run01.tags.tsv')
  const text = ((await panel.textContent()) ?? '').replace(/\s+/g, ' ')
  expect(text).not.toMatch(/was failed/)
  expect(text).toMatch(/run01\.tags\.tsv (failed|was cancelled) \(/)
})

test('survey-3: the evidence notes of the suggested search settings wrap inside the page', async ({ page }) => {
  await runWorkflow(page, 'gate', 'Characterize a run')
  const table = page.getByRole('table', { name: 'Suggested search settings' })
  for (const w of [960, 1200, 1440]) {
    await page.setViewportSize({ width: w, height: 800 })
    await table.scrollIntoViewIfNeeded()
    const over = await table.locator('td').evaluateAll((cells) =>
      (cells as HTMLElement[])
        .map((c) => {
          const r = document.createRange()
          r.selectNodeContents(c)
          let limit = document.documentElement.clientWidth
          for (let a: HTMLElement | null = c; a; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') limit = Math.min(limit, a.getBoundingClientRect().right)
          return Math.round(r.getBoundingClientRect().right - limit)
        })
        .filter((px) => px > 1)
    )
    expect(over, `${w} px`).toEqual([])
  }
})

test('survey-5: the Top genus tile says the decoy presence call is experimental', async ({ page }) => {
  await runWorkflow(page, 'gate-call', 'Characterize a run')
  await expect(tile(page, 'Top genus').locator('.tile-value')).toHaveText('Homo')
  await expect(tile(page, 'Top genus').locator('.tile-note')).toHaveAttribute('title', /experimental/i)
})

test.describe('the reports of a Mass-shift survey (workflows)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 1700 })
    await openApp(page, 'workflows')
    await chooseTask(page, 'Mass-shift survey')
    await page.getByRole('button', { name: 'Choose file…' }).click()
    await page.locator('#instrument').selectOption('iontrap-cid')
    await page.locator('#p-recon_fasta').fill('/data/ecoli.fasta')
    await runButton(page).click()
    await expect(page.getByRole('region', { name: 'Running' })).toHaveCount(0, { timeout: 20_000 })
    await expect(page.getByRole('tab', { name: 'Mass shifts' })).toBeVisible()
  })

  test('database-12: the spectra-per-shift and accounting tables have headings in words', async ({ page }) => {
    for (const s of await page.locator('#tabpanel details.raw > summary').all()) if (!(await s.evaluate((e) => (e.parentElement as HTMLDetailsElement).open))) await s.click()
    const titles = await page.locator('#tabpanel details.raw .report-head h2').allInnerTexts()
    expect(titles).toEqual(['Spectra per mass shift', 'Mass-shift accounting'])
  })

  test('database-13: counts of one are singular (1 gap peak); the one 0 Da row is not listed', async ({ page }) => {
    // The survey's one row is at 0.0000 Da (5 spectra): no shift, so the table lists none and says why.
    await expect(page.getByText('No mass shift: every row has a gap under 0.5 Da.')).toBeVisible()
    await expect(page.locator('.recon-tables .unshifted-note')).toHaveText('5 spectra with a gap under 0.5 Da (no shift) not listed.')
    const count = (await page.locator('.recon-tables .dt-count').innerText()).trim()
    const chart = (await page.locator('.mg-chart').innerText()).replace(/\s+/g, ' ')
    expect(`${count} | ${/\d+ placed spectr(a|um) in \d+ gap peaks?/.exec(chart)?.[0]}`).toBe('0 rows | 5 placed spectra in 1 gap peak')
  })
})

test('database-10: a census with max_len and res_cover names both columns in words', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1400 })
  await openApp(page, 'workflows')
  const text = read('cli-dev/ecoli-triage/run01.census_sorted.tsv')
  await page.evaluate((t) => {
    const m = (window as unknown as { __fastagE2E: { mock: { reportFiles: Record<string, string>; nextPickReport: string } } }).__fastagE2E.mock
    m.reportFiles['/data/dev.census_sorted.tsv'] = t
    m.nextPickReport = '/data/dev.census_sorted.tsv'
  }, text)
  await goTo(page, 'Results')
  await page.getByRole('button', { name: 'Open report…' }).click()
  await expect(page.getByRole('tab', { name: 'Triage' })).toHaveAttribute('aria-selected', 'true')
  const heads = (await page.getByRole('grid', { name: 'Spectra ranked by identifiability' }).getByRole('columnheader').allInnerTexts()).map((h) => h.trim())
  expect(heads.filter((h) => /^(Max len|Res cover)/.test(h))).toEqual([])
  expect(heads.some((h) => h.startsWith('Longest tag'))).toBe(true)
  expect(heads.some((h) => h.startsWith('Residues covered'))).toBe(true)
})
