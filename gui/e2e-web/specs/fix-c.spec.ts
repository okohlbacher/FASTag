// 1.16.2 package C: shell, parameter search, drops, Help popovers. Each test
// names the finding of the 1.16.1 UI test it covers (FINDINGS.md).
import type { Locator, Page } from '@playwright/test'
import { test, expect, openApp, goTo, mockState, toStep, chooseTask } from './fixtures'

test.describe.configure({ timeout: 120_000 })

const runButton = (page: Page): Locator => page.locator('.view-setup .actionbar').getByRole('button', { name: /^Run/ })
const pill = (page: Page): Locator => page.getByRole('group', { name: 'Run status' })
const historyRow = (page: Page, input: string): Locator =>
  page.getByRole('table', { name: 'Run history' }).getByRole('row').filter({ hasText: input })
async function menuAction(row: Locator, name: string): Promise<Locator> {
  const m = row.getByRole('button', { name: /^More actions for / })
  if ((await m.getAttribute('aria-expanded')) !== 'true') await m.click()
  return row.getByRole('menuitem', { name })
}

// shell-1
test('while a History Re-run goes, Setup shows what that run uses, not the form that has moved on', async ({ page }) => {
  await openApp(page, 'slow')
  await chooseTask(page, 'Generate tags')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await toStep(page, 'Settings')
  await page.locator('#p-tag_length').fill('5')
  await runButton(page).click()
  await expect(page.getByRole('region', { name: 'Running' })).toContainText('50%')
  await pill(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(pill(page)).toHaveText('Idle')
  await goTo(page, 'Setup')
  await toStep(page, 'Settings')
  await page.locator('#p-tag_length').fill('3')
  await toStep(page, 'Outputs & run')
  await page.locator('#out-name').fill('elsewhere')
  await goTo(page, 'History')
  await (await menuAction(historyRow(page, 'run01.mzML'), 'Re-run')).click()
  await expect(page.getByRole('region', { name: 'Running' })).toContainText('50%')
  const calls = await mockState<{ out: string; params: Record<string, unknown> }[]>(page, 'runCalls')
  expect(calls[1].out).toBe('/data/run01.tags.tsv')
  await goTo(page, 'Setup')
  const busy = page.locator('.view-setup .setup-busy')
  await expect(busy).toContainText('FASTag is running: the form shows what the run uses.')
  const writing = busy.locator('section.block').filter({ hasText: 'Writing' }).locator('code')
  const changed = busy.locator('section.block').filter({ hasText: 'Changed from defaults' }).locator('code')
  await expect(writing).toHaveText(['run01.tags.tsv'])
  await expect(changed).toContainText(['-tag_length 5'])
  await pill(page).getByRole('button', { name: 'Cancel' }).click()
})

async function search(page: Page, q: string): Promise<Locator> {
  await page.locator('body').press('ControlOrMeta+k')
  const dialog = page.getByRole('dialog', { name: 'Search parameters' })
  await expect(dialog.getByRole('combobox')).toBeFocused()
  await dialog.getByRole('combobox').fill(q)
  return dialog
}
const focusedId = (page: Page): Promise<string> => page.evaluate(() => document.activeElement?.id ?? '')

// database-4 (a)
test('Enter in the parameter search opens the first hit, wherever the pointer was left', async ({ page }) => {
  await openApp(page, 'workflows')
  await chooseTask(page, 'Mass-shift survey')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  // The pointer stays on the step just clicked, as a user's would.
  await toStep(page, 'Outputs & run')
  const dialog = await search(page, 'acquisition_check')
  await expect(dialog.getByRole('option')).toHaveCount(2)
  await page.waitForTimeout(300)
  await expect(dialog.getByRole('option').first()).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  await expect(page.locator('#p-acquisition_check')).toBeFocused()
})

// database-4 (a): a pointer that travels does move the selection.
test('a pointer moved over the hits after the list opened picks the hit Enter takes', async ({ page }) => {
  await openApp(page, 'workflows')
  await chooseTask(page, 'Mass-shift survey')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  const dialog = await search(page, 'acquisition_check')
  const second = dialog.getByRole('option').nth(1)
  const box = (await second.boundingBox())!
  await page.mouse.move(box.x + 10, box.y + box.height / 2)
  await page.mouse.move(box.x + 30, box.y + box.height / 2, { steps: 3 })
  await expect(second).toHaveAttribute('aria-selected', 'true')
})

// database-4 (b)
for (const [q, name] of [['Triage E-value', 'census_triage_evalue'], ['ID q-value', 'census_ids_fdr']] as const) {
  test(`without Identifications, the parameter search for ${q} opens Identifications in Inputs`, async ({ page }) => {
    await openApp(page, 'workflows')
    await chooseTask(page, 'Identifiability triage')
    await page.getByRole('button', { name: 'Choose file…' }).click()
    await toStep(page, 'Settings')
    await page.mouse.move(2, 400)
    const dialog = await search(page, q)
    await expect(dialog.getByRole('option', { selected: true }).locator('code.cli')).toHaveText(name)
    await page.keyboard.press('Enter')
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('#step-2')).toBeVisible()
    await expect.poll(() => focusedId(page)).toBe('p-census_ids')
  })
}

// database-4, the uncounted case: Spectra to read, count, from step 4.
test('the parameter search for Spectra to read, count from Outputs & run lands on its control in Settings', async ({ page }) => {
  await openApp(page, 'workflows')
  await chooseTask(page, 'Mass-shift survey')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await toStep(page, 'Outputs & run')
  await page.mouse.move(2, 400)
  const dialog = await search(page, 'subsample_spectra')
  await expect(dialog.getByRole('option', { selected: true }).locator('code.cli')).toHaveText('subsample_spectra')
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('#step-3')).toBeVisible()
  await expect.poll(() => focusedId(page)).toMatch(/^p-subsample/)
})

// shell-3
test('at 960x600 the docked Feedback panel leaves the app bar and the run\'s Cancel uncovered', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 600 })
  await openApp(page, 'slow')
  await toStep(page, 'Inputs')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await runButton(page).click()
  await expect(page.getByRole('region', { name: 'Running' })).toContainText('50%')
  await page.getByRole('button', { name: 'Feedback', exact: true }).click()
  const d = page.getByRole('dialog', { name: 'Feedback' })
  await expect(d).toBeVisible()
  const covered = await page.evaluate(() => {
    const out: string[] = []
    for (const b of document.querySelectorAll<HTMLElement>('header.topbar button')) {
      const r = b.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      if (hit && hit.closest('.fb-panel')) out.push((b.getAttribute('aria-label') ?? b.textContent ?? '').trim())
    }
    return out
  })
  await d.getByRole('button', { name: 'Close Feedback' }).click()
  await pill(page).getByRole('button', { name: 'Cancel' }).click()
  expect(covered).toEqual([])
})

// shell-6
test('Escape closes a (?) popover opened with the mouse: a field\'s, and "Why the file was not checked"', async ({ page }) => {
  await openApp(page, 'iontrap')
  await toStep(page, 'Inputs')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.getByRole('button', { name: 'About Instrument' }).click()
  const pop = page.getByRole('dialog', { name: 'About Instrument' })
  await expect(pop).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(pop).toHaveCount(0)
  await page.getByRole('button', { name: 'Why the file was not checked' }).click()
  const why = page.getByRole('dialog', { name: 'Not checked before the run' })
  await expect(why).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(why).toHaveCount(0)
})

// shell-8
test('a FASTA and an index dropped while Settings is shown: opened in Inputs and said where they went', async ({ page }) => {
  await openApp(page, 'default')
  await toStep(page, 'Inputs')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await toStep(page, 'Settings')
  await page.evaluate(() => {
    const c = (window as unknown as { __fastagE2E: { drop(x: unknown): void } }).__fastagE2E
    c.drop({ fasta: '/db/human.fasta', taxdb: '/db/mine.taxdb' })
  })
  const note = page.getByRole('alert')
  await expect(note).toContainText('human.fasta went to Filter database in Inputs.')
  await expect(note).toContainText('mine.taxdb went to Your taxonomy in Inputs.')
  await toStep(page, 'Inputs')
  await expect(page.locator('#p-fasta')).toHaveValue('/db/human.fasta')
})
