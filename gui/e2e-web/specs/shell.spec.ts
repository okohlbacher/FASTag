// The P2a shell in a real browser (GUI-DESIGN 9 layer 3): the four views from
// the top bar, the keyboard and the native menu; Help as a side panel with
// search; the themes on the D9 tokens; drops as drop.rs routes them; and
// screenshots of every view in both themes at both window sizes, kept as
// test artifacts (e2e-web/test-results) for review.
import type { Page } from '@playwright/test'
import { test, expect, goTo, openApp } from './fixtures'

const e2e = (page: Page, f: 'menu' | 'drop', arg: unknown): Promise<void> =>
  page.evaluate(
    ([name, a]) => {
      const c = (window as unknown as { __fastagE2E: Record<string, (x: unknown) => void> }).__fastagE2E
      c[name as string](a)
    },
    [f, arg] as const
  )
const nav = (page: Page) => page.getByRole('navigation', { name: 'Views' })
const shownViews = (page: Page): Promise<string[]> =>
  page.$$eval('.view', (vs) => vs.filter((v) => (v as HTMLElement).offsetParent !== null).map((v) => (v as HTMLElement).dataset.view ?? ''))

test('the top bar, the keyboard and the View menu switch between the four views', async ({ page }) => {
  await openApp(page)
  await expect(nav(page).getByRole('button')).toHaveText(['Setup', 'Results', 'Batch', 'History'])
  expect(await shownViews(page)).toEqual(['setup'])
  await goTo(page, 'Results')
  expect(await shownViews(page)).toEqual(['results'])
  await expect(page.getByRole('heading', { name: 'No results yet' })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+4')
  await expect(page.getByText('Runs you start appear here.')).toBeVisible()
  expect(await shownViews(page)).toEqual(['history'])
  await e2e(page, 'menu', 'view-batch')
  await expect(page.getByRole('heading', { name: 'No batch yet' })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+1')
  expect(await shownViews(page)).toEqual(['setup'])
  await expect(nav(page).getByRole('button', { name: 'Setup' })).toHaveAttribute('aria-current', 'page')
})

test('a run moves to Results with the pill; it finishes into History', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.getByRole('button', { name: 'Run on run01.mzML' }).click()
  await expect(page.getByText('Showing 2,028 of 2,028')).toBeVisible()
  expect(await shownViews(page)).toEqual(['results'])
  await expect(page.getByRole('group', { name: 'Run status' })).toHaveText('Idle')
  await goTo(page, 'History')
  // The e2e bridge keeps no record of its own runs: the list is empty, but
  // read again after the run (no console error, no stale state).
  await expect(page.getByText('Runs you start appear here.')).toBeVisible()
})

test('Help opens beside the view; its search finds a setting and opens it', async ({ page }) => {
  await openApp(page)
  // By keyboard: WebKit does not focus a clicked button, and focus returns
  // to the control that opened Help.
  await page.getByRole('button', { name: 'Help', exact: true }).focus()
  await page.keyboard.press('Enter')
  const panel = page.getByRole('complementary', { name: 'Help' })
  await expect(panel).toBeVisible()
  // The view stays: Setup and Help side by side.
  const setupBox = await page.locator('aside.controls').boundingBox()
  const helpBox = await panel.boundingBox()
  expect(setupBox!.width).toBeGreaterThan(300)
  expect(helpBox!.x).toBeGreaterThanOrEqual(setupBox!.x + setupBox!.width - 1)
  expect(helpBox!.width).toBeGreaterThanOrEqual(380)
  expect(helpBox!.width).toBeLessThanOrEqual(480)
  await panel.getByRole('searchbox', { name: 'Search Help' }).fill('fragment tolerance')
  const hit = panel
    .getByRole('list', { name: 'Search results' })
    .getByRole('button')
    .filter({ has: page.locator('.hit-title', { hasText: /^Fragment tolerance$/ }) })
    .filter({ hasText: 'Settings reference' })
  await expect(hit).toHaveCount(1)
  await hit.click()
  await expect(page.locator('#param-fragment_tolerance')).toHaveJSProperty('open', true)
  await expect(page.locator('#param-fragment_tolerance > summary')).toBeFocused()
  await e2e(page, 'menu', 'faq')
  await expect(panel.getByRole('navigation', { name: 'Help pages' }).locator('[aria-current="page"]')).toHaveText('Troubleshooting')
  await panel.getByRole('button', { name: 'Close Help' }).click()
  await expect(panel).toBeHidden()
  await expect(page.getByRole('button', { name: 'Help', exact: true })).toBeFocused()
})

test('the theme button overrides the system theme with the D9 colours, and changes no number', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await openApp(page)
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.getByRole('button', { name: 'Run on run01.mzML' }).click()
  await expect(page.getByText('Showing 2,028 of 2,028')).toBeVisible()
  const look = async (): Promise<{ bg: string; bar: string; status: string }> => ({
    bg: await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    bar: await page.evaluate(() => getComputedStyle(document.querySelector('header.topbar')!).backgroundColor),
    status: (await page.locator('.rt-status').textContent()) ?? ''
  })
  const sys = await look()
  expect(sys.bg).toBe('rgb(255, 255, 255)') // --background, light
  expect(sys.bar).toBe('rgb(243, 244, 247)') // --panel, light
  const theme = page.getByRole('button', { name: /^Theme: / })
  await theme.click() // System -> Light
  await theme.click() // Light -> Dark
  await expect(theme).toHaveAccessibleName('Theme: Dark')
  const dark = await look()
  expect(dark.bg).toBe('rgb(22, 24, 29)') // --background, dark
  expect(dark.bar).toBe('rgb(29, 32, 38)') // --panel, dark
  expect(dark.status).toBe(sys.status)
  // Remembered for the next start.
  await page.reload()
  await expect(page.getByText('FASTag ready')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
  // The system can still be followed: dark on a dark system, without the attribute.
  await page.getByRole('button', { name: /^Theme: / }).click() // Dark -> System
  await page.emulateMedia({ colorScheme: 'dark' })
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-theme'))).toBe(false)
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(22, 24, 29)')
})

test('drops go where their type belongs', async ({ page }) => {
  await openApp(page)
  await e2e(page, 'drop', { spectra: ['/data/run01.mzML', '/data/run02.mzML'], batch: true })
  await expect(page.getByRole('heading', { name: /Batch · 2 files/ })).toBeVisible()
  expect(await shownViews(page)).toEqual(['batch'])
  await e2e(page, 'drop', { results: '/data/run01.tags.tsv' })
  await expect(page.getByText('Showing 2,028 of 2,028')).toBeVisible()
  expect(await shownViews(page)).toEqual(['results'])
  await e2e(page, 'drop', { ignored: ['/data/notes.txt'] })
  await expect(page.getByRole('alert')).toContainText('notes.txt')
})

test('a view switch that hides the focused control moves focus into the view shown', async ({ page }) => {
  await openApp(page)
  // Where focus is: the view it sits in, or BODY.
  const focusIn = (): Promise<string> =>
    page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null
      if (!a || a === document.body) return 'BODY'
      const v = a.closest<HTMLElement>('.view')
      return v && v.offsetParent !== null ? (v.dataset.view ?? '?') : 'hidden or outside'
    })
  await page.getByRole('button', { name: 'Choose file…' }).click()
  // By keyboard: WebKit does not focus a clicked button.
  await page.getByRole('button', { name: 'Run on run01.mzML' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Showing 2,028 of 2,028')).toBeVisible()
  expect(await shownViews(page)).toEqual(['results'])
  expect(await focusIn()).toBe('results')
  await page.keyboard.press('ControlOrMeta+1')
  expect(await focusIn()).toBe('setup')
  await page.locator('.view[data-view="setup"] button:visible').first().focus()
  await page.keyboard.press('ControlOrMeta+2')
  expect(await shownViews(page)).toEqual(['results'])
  expect(await focusIn()).toBe('results')
  await e2e(page, 'drop', { spectra: ['/data/run01.mzML', '/data/run02.mzML'], batch: true })
  await expect(page.getByRole('heading', { name: /Batch · 2 files/ })).toBeVisible()
  expect(await focusIn()).toBe('batch')
})

// Screenshots for review: every view, both themes, both window sizes.
for (const [w, h] of [
  [960, 600],
  [1440, 900]
] as const) {
  test(`${w}x${h}: every view in light and dark, no page scroll`, async ({ page }, info) => {
    await page.setViewportSize({ width: w, height: h })
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await openApp(page)
      await page.getByRole('button', { name: 'Choose file…' }).click()
      await page.getByRole('button', { name: 'Run on run01.mzML' }).click()
      await expect(page.getByText('Showing 2,028 of 2,028')).toBeVisible()
      for (const v of ['Setup', 'Results', 'Batch', 'History'] as const) {
        await goTo(page, v)
        const size = await page.evaluate(() => ({ w: document.scrollingElement!.scrollWidth, h: document.scrollingElement!.scrollHeight }))
        expect(size.w, `${v} width`).toBeLessThanOrEqual(w)
        expect(size.h, `${v} height`).toBeLessThanOrEqual(h)
        await page.screenshot({ path: info.outputPath(`shell-${v.toLowerCase()}-${w}x${h}-${scheme}.png`) })
      }
      await page.getByRole('button', { name: 'Help', exact: true }).click()
      await page.screenshot({ path: info.outputPath(`shell-help-${w}x${h}-${scheme}.png`) })
    }
  })
}
