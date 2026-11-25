// 1.16.2, package A (Setup form and session): one test per finding of
// output/ui-test-1.16.1/FINDINGS.md, moved from the lanes of work/ui-test.
import type { Page } from '@playwright/test'
import { test, expect, openApp, chooseTask, toStep, goTo, mockState } from './fixtures'

interface RunCall {
  in: string
  out: string
  params: Record<string, unknown>
}
const runCalls = (page: Page): Promise<RunCall[]> => mockState<RunCall[]>(page, 'runCalls')
const setMock = (page: Page, key: string, value: unknown): Promise<void> =>
  page.evaluate(([k, v]) => void ((window as unknown as { __fastagE2E: { mock: Record<string, unknown> } }).__fastagE2E.mock[k as string] = v), [key, value] as [string, unknown])
const runButton = (page: Page) => page.locator('.view-setup .runbar').getByRole('button', { name: /^Run$/ })
async function clickRun(page: Page): Promise<RunCall> {
  const before = (await runCalls(page)).length
  await runButton(page).click()
  await expect.poll(async () => (await runCalls(page)).length, { timeout: 15_000 }).toBeGreaterThan(before)
  const calls = await runCalls(page)
  return calls[calls.length - 1]
}
const runEnded = (page: Page) => expect(page.getByRole('region', { name: 'Running' })).toHaveCount(0, { timeout: 40_000 })
const productBox = (page: Page, param: string) => page.locator(`#step-4 ul.products input[data-param="${param}"]`)
const productRow = (page: Page, param: string) => page.locator(`#step-4 ul.products li.product:has(input[data-param="${param}"])`)
const textOf = async (l: ReturnType<Page['locator']>): Promise<string> => ((await l.innerText()) ?? '').replace(/\s+/g, ' ').trim()
async function commandLine(page: Page): Promise<string> {
  const d = page.locator('#step-4 details.command-preview')
  if ((await d.getAttribute('open')) === null) await d.locator('summary').click()
  const pre = d.locator('pre.cmd')
  await expect(pre).not.toHaveText('…')
  return (await pre.textContent()) ?? ''
}
async function w1WithFile(page: Page): Promise<void> {
  await openApp(page, 'workflows')
  await page.getByRole('button', { name: 'Continue with Generate tags ›' }).click()
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await expect(page.locator('#step-2 .input-card .fname')).toHaveText('run01.mzML')
}

test.beforeEach(async ({}, info) => info.setTimeout(120_000))

test('database-2: the chosen output folder survives retyping the run name', async ({ page }) => {
  await openApp(page, 'workflows')
  await chooseTask(page, 'Run QC')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await toStep(page, 'Outputs & run')
  await setMock(page, 'nextPickFolder', '/out')
  await page.getByRole('button', { name: 'Change the output folder' }).click()
  const folder = page.locator('#step-4 .out-row').first()
  await expect(folder).toContainText('/out/')
  await page.locator('#out-name').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Backspace')
  await expect(page.locator('#out-name')).toHaveValue('')
  await expect(folder).toContainText('/out/')
  await page.keyboard.type('sampleB')
  const call = await clickRun(page)
  expect(call.out).toBe('/out/sampleB.tags.tsv')
})

test.describe('database-1: a Mass-shift survey without a database can still get one', () => {
  async function ways(page: Page) {
    await toStep(page, 'Inputs')
    const fasta = await page.locator('#step-2 #p-recon_fasta').isEnabled()
    const proteome = await page.locator('#step-2 #p-recon_proteome').isEnabled()
    return { fasta, proteome }
  }
  test('Settings into form of a run without a database', async ({ page }) => {
    await openApp(page, 'workflows')
    await chooseTask(page, 'Mass-shift survey')
    await page.getByRole('button', { name: 'Choose file…' }).click()
    const call = await clickRun(page)
    expect(String(call.params['recon_out'] ?? '')).toBe('')
    await runEnded(page)
    await goTo(page, 'Setup')
    await chooseTask(page, 'Run QC')
    await goTo(page, 'History')
    const row = page.getByRole('table', { name: 'Run history' }).getByRole('row').filter({ hasText: 'run01.mzML' })
    await row.getByRole('button', { name: /^More actions for / }).click()
    await row.getByRole('menuitem', { name: 'Settings into form' }).click()
    await page.getByRole('status', { name: 'History' }).getByRole('button', { name: 'Go to Setup' }).click()
    expect(await ways(page)).toEqual({ fasta: true, proteome: true })
    await page.locator('#p-recon_fasta').fill('/data/ecoli.fasta')
    await toStep(page, 'Outputs & run')
    // The reports came back waiting: the database turns them on.
    await expect(productBox(page, 'recon_out')).toBeChecked()
    await expect(productBox(page, 'delta_out')).toBeChecked()
  })
  test('reports unchecked, then the FASTA removed', async ({ page }) => {
    await openApp(page, 'workflows')
    await chooseTask(page, 'Mass-shift survey')
    await page.getByRole('button', { name: 'Choose file…' }).click()
    await page.locator('#p-recon_fasta').fill('/data/ecoli.fasta')
    await toStep(page, 'Outputs & run')
    for (const n of ['delta_spectra_out', 'delta_counts_out', 'delta_out', 'recon_out']) await productBox(page, n).uncheck()
    await toStep(page, 'Inputs')
    await page.getByRole('button', { name: 'Remove Protein database' }).click()
    expect(await ways(page)).toEqual({ fasta: true, proteome: true })
  })
})

test('database-5: unchecking the ranking takes -census_score out of the run', async ({ page }) => {
  await openApp(page, 'workflows')
  await chooseTask(page, 'Identifiability triage')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await toStep(page, 'Outputs & run')
  await productBox(page, 'census_sorted_out').uncheck()
  expect(await commandLine(page)).not.toContain('-census_score')
  const call = await clickRun(page)
  expect(call.params['census']).toBe(true)
  expect(call.params['census_score'] ?? false).toBe(false)
})

test('database-9: while a triage run goes, Setup names the identifiability table and its summary', async ({ page }) => {
  await openApp(page, 'slow')
  await chooseTask(page, 'Identifiability triage')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await runButton(page).click()
  await expect(page.getByRole('region', { name: 'Running' })).toBeVisible()
  await goTo(page, 'Setup')
  const busy = page.locator('.view-setup .setup-busy')
  const files = (await busy.locator('section.block', { hasText: 'Writing' }).locator('code').allInnerTexts()).map((p) => p.replace(/^.*\//, ''))
  expect(files).toEqual(expect.arrayContaining(['run01.tags.tsv', 'run01.tags.census.tsv', 'run01.tags.census_summary.tsv', 'run01.census_sorted.tsv']))
  await page.getByRole('group', { name: 'Run status' }).getByRole('button', { name: 'Cancel' }).click()
})

test('database-3: after a Species run at rank genus, the Shipped proteome line names the organism', async ({ page }) => {
  await openApp(page, 'gate')
  await chooseTask(page, 'Species')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await clickRun(page)
  await runEnded(page)
  await goTo(page, 'Setup')
  await chooseTask(page, 'Mass-shift survey')
  await toStep(page, 'Inputs')
  await expect(page.locator('#h-recon_proteome')).toContainText(/Species detection names Homo first in this file: choose Human\./)
})

test('database-6: Database reduction sends the whole shortlist recipe, and its texts name it', async ({ page }) => {
  await openApp(page, 'workflows')
  await chooseTask(page, 'Database reduction')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.locator('#p-recon_fasta').fill('/data/ecoli.fasta')
  await toStep(page, 'Settings')
  await expect(page.locator('#step-3 .settings-note')).toContainText('tag length 4, extension 6, at least 1 spectrum per protein')
  const call = await clickRun(page)
  expect([call.params['tag_length'], call.params['extension'], call.params['shortlist_min_spectra']].map(String)).toEqual(['4', '6', '1'])
})

test('database-7: the Comet note names Inputs, where the template is', async ({ page }) => {
  await openApp(page, 'workflows')
  await chooseTask(page, 'Database reduction')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.locator('#p-recon_fasta').fill('/data/ecoli.fasta')
  await page.locator('#p-search_engine').selectOption('comet')
  await toStep(page, 'Outputs & run')
  await expect(productRow(page, 'search_config_out').locator('.product-note')).toContainText('template in Inputs')
})

test('database-8: a Comet preset names its configuration .params when loaded', async ({ page }) => {
  await openApp(page, 'workflows')
  await chooseTask(page, 'Database reduction')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.locator('#p-recon_fasta').fill('/data/ecoli.fasta')
  await page.locator('#p-search_engine').selectOption('comet')
  await toStep(page, 'Settings')
  await page.locator('#origin').selectOption('__save')
  await page.getByLabel('Preset name').fill('Comet')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await chooseTask(page, 'Run QC')
  await toStep(page, 'Task')
  await page.locator('#origin').selectOption('Comet')
  await toStep(page, 'Outputs & run')
  await expect(productRow(page, 'search_config_out').locator('.product-file')).toHaveText('→ run01.search.params')
})

test('tags-2: a report switched on by its flag is counted in "Advanced (n changed)"', async ({ page }) => {
  await w1WithFile(page)
  await toStep(page, 'Settings')
  const adv = page.locator('#step-3 details.advanced')
  await adv.locator('> summary').click()
  await adv.locator('details.sec.other > summary').click()
  for (const [group, id] of [
    ['Species', '#p-species'],
    ['Glycopeptides', '#p-glyco'],
    ['Identifiability', '#p-census']
  ] as const) {
    await adv.locator('summary', { has: page.locator('.sec-title', { hasText: new RegExp(`^${group}$`) }) }).first().click()
    await page.locator(id).check()
    await expect(adv.locator('> summary'), id).toHaveText('Advanced (1 changed)')
    await expect(adv.locator('details.sec.other > summary'), id).toContainText('1 changed')
    await page.locator(id).uncheck()
  }
})

test.describe('tags-4: an input file is no modification', () => {
  test('a FASTA leaves the task unmodified', async ({ page }) => {
    await w1WithFile(page)
    await page.getByRole('combobox', { name: 'Add optional input' }).selectOption('fasta')
    await page.locator('#p-fasta').fill('/data/ecoli.fasta')
    await toStep(page, 'Settings')
    await expect(page.locator('.origin-name')).toHaveText('Generate tags')
    await page.locator('#p-tag_length').fill('4')
    await expect(page.locator('.origin-name')).toHaveText('Generate tags (modified)')
    await page.getByRole('button', { name: 'Reset to Generate tags' }).click()
    await expect(page.locator('.origin-name')).toHaveText('Generate tags')
    await expect(page.locator('#p-fasta')).toHaveValue('/data/ecoli.fasta')
  })
  test('a preset just saved is not modified', async ({ page }) => {
    await w1WithFile(page)
    await page.getByRole('combobox', { name: 'Add optional input' }).selectOption('fasta')
    await page.locator('#p-fasta').fill('/data/ecoli.fasta')
    await toStep(page, 'Settings')
    await page.locator('#p-tag_length').fill('4')
    await page.locator('#origin').selectOption('__save')
    await page.getByLabel('Preset name').fill('Lab default')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.locator('.origin-name')).toHaveText('preset Lab default')
  })
})

test('survey-1: every edited Settings field is marked changed with the default it left', async ({ page }) => {
  await w1WithFile(page)
  await toStep(page, 'Settings')
  for (const [id, value] of [['tag_length', '5'], ['extension', '2'], ['max_evalue', '1'], ['max_tags', '10']] as const) {
    await page.locator(`#p-${id}`).fill(value)
    const field = page.locator('#step-3 .settings > .field', { has: page.locator(`#p-${id}`) })
    await expect(field, id).toContainText(/Default .+ · changed/)
  }
})

test('shell-2: in Batch mode Outputs & run shows the command line its hint speaks of', async ({ page }) => {
  await openApp(page, 'default')
  await toStep(page, 'Inputs')
  await page.getByRole('radio', { name: 'Batch' }).check()
  await page.getByRole('button', { name: 'Add files…' }).click()
  await goTo(page, 'Setup')
  await toStep(page, 'Outputs & run')
  await expect(page.locator('#step-4')).toContainText('Each file of the batch runs this command line')
  expect(await commandLine(page)).toContain('-in ')
  expect(await textOf(page.locator('#step-4 details.command-preview summary'))).toMatch(/^Command line of the first file, /)
})
