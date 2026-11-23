// Shared spec setup: every spec fails on a console error or an uncaught
// page error, and opens the app on an e2e fixture.
import { test as base, expect, type Page } from '@playwright/test'

export const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text())
      })
      page.on('pageerror', (e) => errors.push(String(e)))
      await use(errors)
      expect(errors, 'console errors').toEqual([])
    },
    { auto: true }
  ]
})
export { expect }

/// Open the app on the e2e @p fixture and wait for the probe badge.
/// @p from 'defaults': the session starts from FASTag's defaults, not from
/// the task the app lands on (D1), for the specs that check what a run from
/// the defaults sends.
export async function openApp(page: Page, fixture = 'default', from: 'landing' | 'defaults' = 'landing'): Promise<void> {
  await page.goto(`/?fixture=${fixture}${from === 'defaults' ? '&start=defaults' : ''}`)
  await expect(page.getByText('FASTag ready')).toBeVisible()
}

/// The e2e mock's recorded calls (src/testing/e2eBridge.ts).
export function mockState<T>(page: Page, pick: string): Promise<T> {
  return page.evaluate((p) => {
    const m = (window as unknown as { __fastagE2E: { mock: Record<string, unknown> } }).__fastagE2E.mock
    return JSON.parse(JSON.stringify(m[p]))
  }, pick)
}

/// Go to one of the four views (P2a shell) through the top bar.
export async function goTo(page: Page, view: 'Setup' | 'Results' | 'Batch' | 'History'): Promise<void> {
  await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: new RegExp(`^${view}`) }).click()
}

/// The Setup wizard (doc/GUI-SETUP-WIZARD.md): its stepper.
const steps = (page: Page) => page.getByRole('navigation', { name: 'Setup steps' })

/// Confirm the selected task (Continue) when none is confirmed yet.
export async function confirmTask(page: Page): Promise<void> {
  const locked = await steps(page).locator('button[data-step-btn="2"]').getAttribute('aria-disabled')
  if (locked === 'true') await page.locator('.wizard-foot button.continue').click()
}

/// Go to Setup step @p name, confirming the selected task first.
export async function toStep(page: Page, name: 'Task' | 'Inputs' | 'Settings' | 'Outputs & run'): Promise<void> {
  const n = { Task: 1, Inputs: 2, Settings: 3, 'Outputs & run': 4 }[name]
  if (n > 1) await confirmTask(page)
  const b = steps(page).locator(`button[data-step-btn="${n}"]`)
  if ((await b.getAttribute('aria-current')) !== 'step') await b.click()
  await expect(page.locator(`#step-${n}`)).toBeVisible()
}

/// Choose workflow @p label on step 1: its tile, then Continue.
export async function chooseTask(page: Page, label: string): Promise<void> {
  await toStep(page, 'Task')
  await page.locator('button.task-tile', { has: page.locator('.task-tile-label', { hasText: new RegExp(`^${label}$`) }) }).click()
  await page.getByRole('button', { name: `Continue with ${label} ›` }).click()
  await expect(page.getByRole('heading', { name: /^(Inputs|Settings) for |^Outputs and run$/ })).toBeVisible()
}
