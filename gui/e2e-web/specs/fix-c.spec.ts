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
