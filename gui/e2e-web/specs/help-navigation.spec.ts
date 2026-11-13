import type { Locator, Page } from '@playwright/test'
import { test, expect, goTo, mockState, openApp } from './fixtures'

const helpPanel = (page: Page) => page.getByRole('complementary', { name: 'Help' })

async function fitsWindow(page: Page): Promise<void> {
  const size = await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>('.help-main')!
    const box = main.getBoundingClientRect()
    return {
      pageWidth: document.scrollingElement!.scrollWidth,
      pageHeight: document.scrollingElement!.scrollHeight,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      contentWidth: main.scrollWidth,
      visibleWidth: main.clientWidth,
      contentHeight: box.height,
      right: box.right,
      bottom: box.bottom
    }
  })
  expect(size.pageWidth, 'the page must not scroll sideways').toBeLessThanOrEqual(size.viewportWidth)
  expect(size.pageHeight, 'Help scrolls within its panel').toBeLessThanOrEqual(size.viewportHeight)
  expect(size.contentWidth, 'Help prose and tables fit the reading column').toBeLessThanOrEqual(size.visibleWidth + 1)
  expect(size.contentHeight, 'Help retains a readable scrolling area').toBeGreaterThan(100)
  expect(size.right).toBeLessThanOrEqual(size.viewportWidth + 1)
  expect(size.bottom).toBeLessThanOrEqual(size.viewportHeight + 1)
}

async function focusedInReadingArea(heading: Locator): Promise<void> {
  await expect(heading).toBeFocused()
  const position = await heading.evaluate((el) => {
    const row = el.getBoundingClientRect()
    const main = el.closest('.help-main')!.getBoundingClientRect()
    return { top: row.top - main.top, bottom: main.bottom - row.bottom }
  })
  expect(position.top, 'the requested heading is visible above the scroll').toBeGreaterThanOrEqual(-1)
  expect(position.bottom, 'the requested heading is visible below the scroll').toBeGreaterThanOrEqual(-1)
}

for (const theme of ['light', 'dark'] as const) {
  test(`960x600 ${theme}: every Help page fits and its contents links reveal the right heading`, async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 600 })
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
    await openApp(page)
    await page.getByRole('button', { name: 'Help', exact: true }).click()
    const panel = helpPanel(page)
    const navigation = panel.getByRole('navigation', { name: 'Help pages' })
    const pages = await navigation.locator('ul > li > button').allTextContents()
    expect(pages).toContain('Results and workflows')
    for (const title of pages) {
      await test.step(title, async () => {
        await navigation.getByRole('button', { name: title, exact: true }).click()
        await expect(panel.getByRole('main')).toHaveAccessibleName(title)
        await fitsWindow(page)
        const contents = panel.getByRole('navigation', { name: 'On this page' })
        const ids = await contents.locator('[data-help]').evaluateAll((links) => links.map((link) => link.getAttribute('data-help')!))
        for (const id of ids) {
          await contents.locator(`[data-help="${id}"]`).click()
          await focusedInReadingArea(panel.locator(`#${id}-h`))
        }
      })
    }
  })
}

test('expanded command-line help and an unmatched long query fit the minimum window', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 600 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openApp(page)
  await page.getByRole('button', { name: 'Help', exact: true }).click()
  const panel = helpPanel(page)
  const search = panel.getByRole('searchbox', { name: 'Search Help' })
  for (const name of ['species_call', 'alkylation_tags_out', 'fragment_tolerance']) {
    await search.fill(`-${name}`)
    await search.press('Enter')
    const entry = panel.locator(`#param-${name}`)
    await expect(entry).toHaveJSProperty('open', true)
    await focusedInReadingArea(entry.locator(':scope > summary'))
    await entry.locator('.cli-desc > summary').click()
    await expect(entry.locator('.cli-desc')).toHaveJSProperty('open', true)
    await fitsWindow(page)
  }
  // A path pasted from an error may be one long word, not ordinary prose.
  const query = `C:\\data\\${'unmatched_sample_'.repeat(24)}.mzML`
  await search.fill(query)
  await expect(panel.getByRole('status')).toContainText('Nothing in Help matches')
  await fitsWindow(page)
  await search.press('Escape')
  await expect(search).toHaveValue('')
  await expect(panel).toBeVisible()
})

test('a blocked input links to its FAQ and glossary, then returns without changing the run', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 600 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openApp(page, 'dia-probe', 'defaults')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  const block = page.locator('li.check').filter({ hasText: 'Blocks the run: Raw DIA' })
  const opener = block.getByRole('button', { name: 'What this means' })
  await opener.focus()
  await page.keyboard.press('Enter')
  const panel = helpPanel(page)
  const faq = panel.locator('#faq-raw-dia')
  await expect(faq).toHaveJSProperty('open', true)
  await focusedInReadingArea(faq.locator(':scope > summary'))
  await faq.getByRole('button', { name: 'data-independent acquisition (DIA)' }).click()
  await focusedInReadingArea(panel.locator('#gloss-acquisition'))
  await panel.getByRole('button', { name: 'Back to Troubleshooting' }).click()
  await focusedInReadingArea(faq.locator(':scope > summary'))
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(opener).toBeFocused()
  await expect(page.getByRole('button', { name: 'Run on run01.mzML' })).toBeDisabled()
  expect(await mockState<unknown[]>(page, 'runCalls')).toEqual([])
})

test('closing contextual Help after changing view leaves focus on a usable control', async ({ page }) => {
  await openApp(page)
  await goTo(page, 'History')
  const opener = page.getByRole('button', { name: 'Reopen results or reuse settings' })
  await opener.focus()
  await page.keyboard.press('Enter')
  const panel = helpPanel(page)
  await expect(panel.locator('#workflow-history-h')).toBeFocused()
  await goTo(page, 'Setup')
  await panel.getByRole('button', { name: 'Close Help' }).click()
  await expect(panel).toBeHidden()
  await expect(page.getByRole('button', { name: 'Help', exact: true })).toBeFocused()
})

test('keyboard users can reach every search result and open the last one', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 960, height: 600 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openApp(page)
  await page.getByRole('button', { name: 'Help', exact: true }).click()
  const panel = helpPanel(page)
  const search = panel.getByRole('searchbox', { name: 'Search Help' })
  await search.fill('tag')
  const results = panel.getByRole('list', { name: 'Search results' })
  const buttons = results.getByRole('button')
  await expect(buttons).toHaveCount(20)
  // macOS WebKit follows Safari's default: Option+Tab includes buttons.
  const nextControl = browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab'
  for (let i = 0; i < await buttons.count(); i++) {
    await page.keyboard.press(nextControl)
    await expect(buttons.nth(i)).toBeFocused()
    const visible = await buttons.nth(i).evaluate((button) => {
      const row = button.getBoundingClientRect()
      const list = button.closest('ul')!.getBoundingClientRect()
      return row.top >= list.top - 1 && row.bottom <= list.bottom + 1 && row.top >= 0 && row.bottom <= innerHeight
    })
    expect(visible, `search result ${i + 1} scrolls into view`).toBe(true)
  }
  await page.keyboard.press('Enter')
  await expect(search).toHaveValue('')
  await expect(results).toHaveCount(0)
  await focusedInReadingArea(panel.locator('.help-main :focus'))
})
