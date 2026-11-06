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

// The CSS height alone keeps the DOM small in the tests above. Here the
// scroller loses its definite height (as the old stacked layout did) and
// reports the whole canvas: only MAX_DOM_ROWS keeps the rows at 200.
test('without a definite scroller height, MAX_DOM_ROWS alone keeps a 10 M-row file at 200 rows', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 600 })
  await openApp(page, 'big')
  await page.addStyleTag({
    content: '.rt-scroll { flex: none !important; height: auto !important; min-height: 0 !important; overflow: visible !important; }'
  })
  await page.getByRole('button', { name: 'Open a tags TSV…' }).click()
  await expect(page.getByText('Showing 10,000,000 of 10,000,000')).toBeVisible()
  await expect(page.locator('.rt-row').first()).toBeVisible()
  const box = await page.evaluate(() => ({
    scrollerH: (document.querySelector('.rt-scroll') as HTMLElement).clientHeight,
    rows: document.querySelectorAll('.rt-row').length
  }))
  // The precondition: the scroller really reports far more than 200 rows.
  expect(box.scrollerH).toBeGreaterThan(200 * 28 * 10)
  expect(box.rows).toBeGreaterThan(0)
  expect(box.rows).toBeLessThanOrEqual(200)
})

// Each page request is tagged with the animation frame it was sent in: the
// timestamp of the last requestAnimationFrame callback run before it (all
// callbacks of one frame get the same one). The table frees its request slot
// only in such a callback, so two requests with one tag are two in a frame.
test('a fling sends at most one page request per animation frame', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __frame: number; requestAnimationFrame: typeof requestAnimationFrame }
    w.__frame = -1
    const raf = window.requestAnimationFrame.bind(window)
    w.requestAnimationFrame = (cb: FrameRequestCallback): number =>
      raf((ts) => {
        w.__frame = ts
        cb(ts)
      })
  })
  await openApp(page, 'big')
  await page.getByRole('button', { name: 'Open a tags TSV…' }).click()
  await expect(page.getByText('Showing 10,000,000 of 10,000,000')).toBeVisible()
  const result = await page.evaluate(async () => {
    const w = window as unknown as {
      __frame: number
      __fastagE2E: { mock: { resultsQuery: (...a: unknown[]) => Promise<unknown> } }
    }
    const mock = w.__fastagE2E.mock
    const tags: number[] = []
    const orig = mock.resultsQuery
    mock.resultsQuery = (...a: unknown[]) => {
      tags.push(w.__frame)
      return orig(...a)
    }
    const el = document.querySelector('.rt-scroll') as HTMLElement
    // 240 scroll steps, four per frame, over 60 frames.
    for (let f = 0; f < 60; f++) {
      for (let k = 0; k < 4; k++) el.scrollTop += 50_000
      await new Promise((r) => requestAnimationFrame(() => r(null)))
    }
    await new Promise((r) => setTimeout(r, 200))
    mock.resultsQuery = orig
    const perFrame = new Map<number, number>()
    for (const t of tags) perFrame.set(t, (perFrame.get(t) ?? 0) + 1)
    return { requests: tags.length, frames: perFrame.size, most: Math.max(0, ...perFrame.values()) }
  })
  expect(result.requests).toBeGreaterThan(1)
  expect(result.frames).toBe(result.requests)
  expect(result.most).toBe(1)
})
