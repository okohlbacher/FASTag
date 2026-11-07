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
