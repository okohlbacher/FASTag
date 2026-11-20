import { test, expect, goTo, openApp } from './fixtures'

// The narrow-window freeze (P0a): a 10 M-row file in a small window drew
// every row. The window is at least 960 x 600 (tauri.conf.json); 800 x 600
// is below it and must not break the layout either. P2a: Results is a view
// of its own, full width, so "side by side" became "Setup hidden, the table
// full width".
for (const [w, h] of [
  [800, 600],
  [960, 600]
] as const) {
  test(`${w}x${h}: Results full width, no page scroll, a 10 M-row file draws at most 200 rows and scrolls`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h })
    await openApp(page, 'big')
    await goTo(page, 'Results')
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
        scrollerW: sc.width,
        setupW: setup.width,
        scrollerRight: sc.right,
        rows: document.querySelectorAll('.rt-row').length
      }
    })
    expect(box.pageW).toBeLessThanOrEqual(w) // no horizontal page scroll
    expect(box.pageH).toBeLessThanOrEqual(h) // the page itself does not scroll
    expect(box.setupW).toBe(0) // Setup is hidden, not beside or above the table
    expect(box.scrollerW).toBeGreaterThan(w * 0.8) // the table has the width
    expect(box.scrollerRight).toBeLessThanOrEqual(w)
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
  await goTo(page, 'Results')
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
  await goTo(page, 'Results')
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

// FASTag 1.15.0 screenshots: a long input name wrapped one character per
// line in History and the Outputs ran off the right edge; the recon empty
// state cut its primary button to "Choose a ...".
for (const w of [1000, 1400]) {
  test(`${w} px: History keeps a long input name and its outputs inside the window`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 800 })
    await openApp(page, 'long-names')
    await goTo(page, 'History')
    const table = page.getByRole('table', { name: 'Run history' })
    await expect(table).toBeVisible()
    const name = 'TMT_Erwinia_1uLSike_Top10HCD_isol2_45stepped_60min_01-20141210'
    const input = table.locator('td.hist-input .hist-name')
    await expect(input).toHaveAttribute('title', `/data/PXD001/${name}.mzML`)
    await expect(table.getByRole('list', { name: 'Outputs' }).getByRole('listitem')).toHaveCount(7)
    const m = await page.evaluate(() => {
      const t = document.querySelector('table.history-table')!
      const view = document.querySelector('.view-history')!
      const cell = document.querySelector('td.hist-input .hist-name') as HTMLElement
      const stem = cell.querySelector('.hist-stem') as HTMLElement
      const lh = parseFloat(getComputedStyle(cell).lineHeight) || 20
      const items = [...document.querySelectorAll('td.hist-outputs li')] as HTMLElement[]
      return {
        right: t.getBoundingClientRect().right,
        viewRight: view.getBoundingClientRect().right,
        viewScroll: view.scrollWidth - view.clientWidth,
        pageScroll: document.scrollingElement!.scrollWidth - window.innerWidth,
        inputH: cell.getBoundingClientRect().height,
        lh,
        inputCut: stem.scrollWidth > stem.clientWidth,
        exts: items.map((li) => li.querySelector('.hist-ext')?.textContent),
        itemsOneLine: items.every((li) => li.getBoundingClientRect().height < 2 * lh),
        itemsInside: items.every((li) => li.getBoundingClientRect().right <= t.getBoundingClientRect().right)
      }
    })
    expect(m.right).toBeLessThanOrEqual(m.viewRight)
    expect(m.viewScroll).toBeLessThanOrEqual(0)
    expect(m.pageScroll).toBeLessThanOrEqual(0)
    expect(m.inputH).toBeLessThan(2 * m.lh) // one line, cut with an ellipsis
    expect(m.inputCut).toBe(true)
    expect(m.itemsOneLine).toBe(true)
    // Each output keeps its extensions visible, so they stay apart.
    expect(m.exts).toEqual(['.tags.tsv', '.digest.tsv', '.label.tsv', '.species.tsv', '.massgap.tsv', '.recon.tsv', '.glyco.tsv'])
    const actions = await page.evaluate(() =>
      [...document.querySelectorAll('td.hist-actions button')].every((b) => b.getBoundingClientRect().right <= b.closest('td')!.getBoundingClientRect().right + 0.5)
    )
    expect(actions).toBe(true)
    expect(m.itemsInside).toBe(true)
  })

  test(`${w} px: the Overview's tiles keep their text inside, notes at two lines`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 800 })
    await openApp(page, 'gate')
    await page.getByRole('radio', { name: /^Characterize a run/ }).check()
    await page.getByRole('button', { name: 'Choose file…' }).click()
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    await page.getByRole('tab', { name: 'Overview' }).click()
    await expect(page.locator('.tile').first()).toBeVisible()
    const fits = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.tile')].every((t) => t.scrollWidth <= t.clientWidth + 1 && t.getBoundingClientRect().right <= window.innerWidth)
    )
    expect(fits).toBe(true)
    const lines = await page.evaluate(() =>
      Math.max(...[...document.querySelectorAll<HTMLElement>('.tile-note')].map((n) => Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight))))
    )
    expect(lines).toBeLessThanOrEqual(2)
  })
}
