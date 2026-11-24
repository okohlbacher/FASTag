// The Setup wizard end to end (doc/GUI-SETUP-WIZARD.md 9): step 1 says what
// FASTag is not and fits one screen, the inputs each audit task asks for,
// the file checks, presets without a file, a batch in two actions after the
// tile, and screenshots of every step (WIZARD_SHOTS=<dir> writes
// after-<task>-<n>-<step>[-dark].png there; else into the test output).
import type { Page } from '@playwright/test'
import { test, expect, mockState, openApp, chooseTask, toStep } from './fixtures'

const SHOTS = process.env.WIZARD_SHOTS
const shot = (page: Page, info: { outputPath(n: string): string }, name: string): Promise<Buffer> =>
  page.screenshot({ path: SHOTS ? `${SHOTS}/${name}.png` : info.outputPath(`${name}.png`) })
const addInput = (page: Page, name: string) => page.getByRole('combobox', { name: 'Add optional input' }).selectOption(name)

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
})

const TILES = ['export-tags', 'characterize', 'species', 'mass-shift', 'db-reduction', 'run-qc', 'triage']
const stepOneFits = async (page: Page): Promise<void> => {
  const [scroll, client] = await page.locator('.view-setup .controls-body').evaluate((e) => [e.scrollHeight, e.clientHeight])
  expect(scroll).toBeLessThanOrEqual(client + 1)
  for (const id of TILES) await expect(page.locator(`button.task-tile[data-task="${id}"]`)).toBeInViewport()
}

test('step 1 says FASTag is no search engine, recommends a start, and fits 1280 x 800 without scrolling', async ({ page }) => {
  await openApp(page)
  await expect(page.locator('#not-search-engine')).toContainText('It is not a search engine.')
  // The recommendation is the tile's chip, not a paragraph above the tiles.
  await expect(page.locator('button.task-tile[data-task="characterize"]')).toContainText('Start here')
  // ...on the label's line, as the other chips are: no line of its own.
  const [label, chip] = await Promise.all(
    ['.task-tile-label', '.chip.accent'].map((s) => page.locator(`button.task-tile[data-task="characterize"] ${s}`).boundingBox())
  )
  expect(Math.abs(label!.y + label!.height / 2 - (chip!.y + chip!.height / 2))).toBeLessThan(6)
  await stepOneFits(page)
})

test('step 1 still fits 1280 x 800 with the notice of an interrupted run; its files sit behind a closed disclosure', async ({ page }) => {
  await openApp(page, 'interrupted')
  const notice = page.getByRole('region', { name: 'Files left by an unfinished run' })
  await expect(notice).toBeInViewport()
  for (const name of ['Remove them', 'Keep']) await expect(notice.getByRole('button', { name })).toBeInViewport()
  const files = notice.locator('details.leftovers-files')
  await expect(files).not.toHaveAttribute('open', /.*/)
  await expect(notice.locator('code', { hasText: '/data/run01.tags.tsv' })).toBeHidden()
  await stepOneFits(page)
  // One click shows every path.
  await files.locator('summary').click()
  for (const f of ['/data/run01.tags.tsv', '/data/run01.digest.tsv.part'])
    await expect(notice.locator('code', { hasText: f })).toBeVisible()
})

test('Inputs: the Instrument select and the one-entry Fixed modifications list beside it are one height', async ({ page }) => {
  await openApp(page)
  await chooseTask(page, 'Characterize a run')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  const [sel, list] = await Promise.all(['#instrument', '#p-fixed_modifications'].map((s) => page.locator(s).boundingBox()))
  expect(Math.abs(sel!.height - list!.height)).toBeLessThanOrEqual(1)
  expect(Math.abs(sel!.y - list!.y)).toBeLessThanOrEqual(1)
})

test('Generate tags: no FASTA field in Inputs; the Filter database is an optional input', async ({ page }) => {
  await openApp(page)
  await chooseTask(page, 'Generate tags')
  await expect(page.locator('#step-2 #p-recon_fasta')).toHaveCount(0)
  await expect(page.locator('#step-2 #p-fasta')).toHaveCount(0)
  await addInput(page, 'fasta')
  await expect(page.locator('#p-fasta')).toBeFocused()
})

test('Mass-shift survey: the FASTA is optional, a wrong extension warns, a missing file is named and blocks Run', async ({ page }) => {
  await openApp(page)
  await chooseTask(page, 'Mass-shift survey')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  // Feedback 422372a2: no database needed to run (the shift reports wait for one).
  await expect(page.locator('#step-2 .badge.todo')).toHaveCount(0)
  await expect(page.locator('.still-missing')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled()
  await page.locator('#p-recon_fasta').fill('/data/proteins.txt')
  await expect(page.locator('#step-2')).toContainText('proteins.txt is not a FASTA file (.fasta, .fa, .faa).')
  await page.locator('#p-recon_fasta').fill('/data/missing.fasta')
  await expect(page.locator('#step-2')).toContainText('Not found: /data/missing.fasta')
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled()
  await page.locator('#p-recon_fasta').fill('/data/human.fasta')
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled()
})

test('Characterize: Tag placements turned on under Advanced make the protein database a required input; the run bar leads to it', async ({ page }) => {
  await openApp(page)
  await chooseTask(page, 'Characterize a run')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await expect(page.locator('#p-recon_fasta')).toHaveCount(0)
  await toStep(page, 'Settings')
  await page.locator('#step-3 details.advanced > summary').click()
  for (const title of ['Other analyses', 'Placement on the database'])
    await page.locator('#step-3 summary', { has: page.locator('.sec-title', { hasText: new RegExp(`^${title}$`) }) }).click()
  await page.locator('#out-recon_out').check()
  const run = page.getByRole('button', { name: 'Run', exact: true })
  await expect(run).toBeDisabled()
  await expect(page.locator('nav[aria-label="Setup steps"] button[data-step-btn="2"]').locator('xpath=ancestor::li')).toHaveClass(/blocked/)
  await page.getByRole('button', { name: 'Go to Inputs' }).click()
  await expect(page.locator('#step-2 #p-recon_fasta')).toBeVisible()
  await page.locator('#step-2 #p-recon_fasta').fill('/data/human.fasta')
  await expect(run).toBeEnabled()
})

test('Mass-shift survey: the Filter database is an optional input that says it stands in', async ({ page }) => {
  await openApp(page)
  await chooseTask(page, 'Mass-shift survey')
  await expect(page.getByRole('combobox', { name: 'Add optional input' }).locator('option')).toHaveText(['Choose…', /^Filter database \(also the Protein database while that is empty\): /])
  await addInput(page, 'fasta')
  await page.locator('#p-fasta').fill('/data/human.fasta')
  await expect(page.locator('#step-2')).toContainText('Using your Filter database: human.fasta')
  await expect(page.getByRole('combobox', { name: 'Add optional input' }).locator('option')).toHaveText(['Choose…', /^Entrapment database: /])
})

test('Species: no FASTA; Add optional input offers the taxonomy only', async ({ page }) => {
  await openApp(page)
  await chooseTask(page, 'Species')
  await expect(page.locator('#step-2 #p-recon_fasta')).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Add optional input' }).locator('option')).toHaveText(['Choose…', /^Your taxonomy: /])
})

test('Mass-shift survey without a file: Settings, Save as preset, Export INI', async ({ page }) => {
  await openApp(page)
  await chooseTask(page, 'Mass-shift survey')
  await toStep(page, 'Settings')
  await page.locator('#origin').selectOption('__save')
  await page.getByLabel('Preset name').fill('Survey')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const settings = await mockState<{ presets: Record<string, { base: string }> }>(page, 'settings')
  expect(settings.presets['Survey'].base).toBe('builtin:mass-shift')
  await page.evaluate(() => {
    ;(window as unknown as { __fastagE2E: { mock: Record<string, unknown> } }).__fastagE2E.mock.nextPickOutput = '/data/survey.ini'
  })
  await page.getByRole('button', { name: 'Export INI…' }).click()
  await expect(page.getByRole('region', { name: 'Plan' }).getByRole('status')).toContainText('INI written: survey.ini')
})

test('a batch: after Continue, Batch, Add folder… and Run', async ({ page }) => {
  await openApp(page, 'gate-batch')
  await chooseTask(page, 'Characterize a run')
  await page.getByRole('radio', { name: 'Batch' }).check()
  await page.getByRole('button', { name: 'Add folder…' }).click()
  // Adding moves to the Batch view (the first queued file does); its run bar runs it.
  await page.getByRole('button', { name: /^Run \d+ remaining files?$/ }).click()
  await expect.poll(async () => (await mockState<unknown[]>(page, 'runCalls')).length).toBeGreaterThan(0)
})

const STEPS = ['Task', 'Inputs', 'Settings', 'Outputs & run'] as const
for (const [label, slug] of [
  ['Generate tags', 'export-tags'],
  ['Mass-shift survey', 'mass-shift'],
  ['Species', 'species'],
  ['Database reduction', 'db-reduction']
] as const) {
  test(`screenshots of every step: ${label}`, async ({ page, browserName }, info) => {
    test.skip(browserName !== 'chromium')
    await openApp(page)
    await page.locator(`button.task-tile[data-task="${slug}"]`).click()
    await shot(page, info, `after-${slug}-1-task`)
    await page.getByRole('button', { name: `Continue with ${label} ›` }).click()
    await page.getByRole('button', { name: 'Choose file…' }).click()
    if (slug === 'mass-shift' || slug === 'db-reduction') await page.locator('#p-recon_fasta').fill('/data/human.fasta')
    for (const [i, s] of STEPS.entries()) {
      if (i === 0) continue
      await toStep(page, s)
      if (i === 3) await expect(page.locator('pre.cmd')).toContainText('run01.mzML')
      await page.locator('.view-setup .controls-body').evaluate((e) => e.scrollTo(0, 0))
      await shot(page, info, `after-${slug}-${i + 1}-${s === 'Outputs & run' ? 'outputs' : s.toLowerCase()}`)
    }
    if (slug === 'mass-shift') {
      await page.emulateMedia({ colorScheme: 'dark' })
      for (const [i, s] of STEPS.entries()) {
        await toStep(page, s)
        await shot(page, info, `after-${slug}-${i + 1}-${s === 'Outputs & run' ? 'outputs' : s.toLowerCase()}-dark`)
      }
    }
  })
}
