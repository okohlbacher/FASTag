import { test, expect, openApp } from './fixtures'

// The narrow-window freeze (P0a): a 10 M-row file in a small window drew
// every row. The window is at least 960 x 600 (tauri.conf.json); 800 x 600
// is below it and must not break the layout either.
for (const [w, h] of [
  [800, 600],
  [960, 600]
] as const) {
  test(`${w}x${h}: side by side, no page scroll, a 10 M-row file draws at most 200 rows and scrolls`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h })
    await openApp(page, 'big')
    await page.getByRole('button', { name: 'Open a tags TSV…' }).click()
    await expect(page.getByText('Showing 10,000,000 of 10,000,000')).toBeVisible()
    const box = await page.evaluate(() => {
      const se = document.scrollingElement!
      const sc = document.querySelector('.rt-scroll')!.getBoundingClientRect()
      const setup = document.querySelector('aside.controls')!.getBoundingClientRect()
      return {
        pageW: se.scrollWidth,
        pageH: se.scrollHeight,
        scrollerBottom: sc.bottom,
        scrollerH: sc.height,
        setupRight: setup.right,
        scrollerLeft: sc.left,
        rows: document.querySelectorAll('.rt-row').length
      }
    })
    expect(box.pageW).toBeLessThanOrEqual(w) // no horizontal page scroll
    expect(box.pageH).toBeLessThanOrEqual(h) // the page itself does not scroll
    expect(box.scrollerLeft).toBeGreaterThanOrEqual(box.setupRight - 1) // not stacked
    expect(box.scrollerH).toBeGreaterThan(100)
    expect(box.scrollerBottom).toBeLessThanOrEqual(h)
    expect(box.rows).toBeLessThanOrEqual(200)

    // Jump to the end: the last row arrives and the DOM stays small.
    const t0 = Date.now()
    await page.locator('.rt-scroll').evaluate((el) => (el.scrollTop = el.scrollHeight))
    await expect(page.locator('.rt-row').last()).toContainText('scan=9999999')
    expect(Date.now() - t0).toBeLessThan(5000)
    expect(await page.locator('.rt-row').count()).toBeLessThanOrEqual(200)
    // Still responsive: a click on a header sorts at once.
    await page.getByRole('columnheader', { name: 'Tag' }).getByRole('button').click()
    await expect(page.getByRole('columnheader', { name: 'Tag' })).toHaveAttribute('aria-sort', 'ascending')
  })
}

test('a fling sends at most one page request per animation frame', async ({ page }) => {
  await openApp(page, 'big')
  await page.getByRole('button', { name: 'Open a tags TSV…' }).click()
  await expect(page.getByText('Showing 10,000,000 of 10,000,000')).toBeVisible()
  const result = await page.evaluate(async () => {
    const mock = (window as unknown as { __fastagE2E: { mock: { resultsQueryCalls: unknown[] } } }).__fastagE2E.mock
    const el = document.querySelector('.rt-scroll') as HTMLElement
    const before = mock.resultsQueryCalls.length
    let frames = 0
    // 240 scroll steps, four per frame, over 60 frames.
    for (let f = 0; f < 60; f++) {
      for (let k = 0; k < 4; k++) el.scrollTop += 50_000
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      frames++
    }
    await new Promise((r) => setTimeout(r, 200))
    return { requests: mock.resultsQueryCalls.length - before, frames }
  })
  expect(result.requests).toBeLessThanOrEqual(result.frames + 1)
  expect(result.requests).toBeGreaterThan(0)
})
