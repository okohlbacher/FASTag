import { test, expect, openApp } from './fixtures'

// Screenshots at both window sizes in both themes, kept as test artifacts
// (e2e-web/test-results) for review; the assertion is that the theme
// changes the colours and nothing else.
for (const [w, h] of [
  [960, 600],
  [1440, 900]
] as const) {
  test(`${w}x${h}: light and dark show the same results in different colours`, async ({ page }, info) => {
    await page.setViewportSize({ width: w, height: h })
    const look: Record<string, { bg: string; status: string }> = {}
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await openApp(page)
      await page.getByRole('button', { name: 'Choose file…' }).click()
      await page.getByRole('button', { name: 'Run on run01.mzML' }).click()
      await expect(page.getByText('Showing 2,028 of 2,028')).toBeVisible()
      look[scheme] = {
        bg: await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
        status: (await page.locator('.rt-status').textContent()) ?? ''
      }
      await page.screenshot({ path: info.outputPath(`fastag-${w}x${h}-${scheme}.png`) })
    }
    expect(look.dark.status).toBe(look.light.status) // the theme changes no number
    expect(look.dark.bg).not.toBe(look.light.bg)
  })
}
