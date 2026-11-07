// P3 metamorphic specs (GUI-DESIGN 9, layer 3): a tighter E-value cutoff
// never adds rows; filters commute (the order they are set in changes
// nothing); an export equals the view the table shows, as TSV and as CSV.
// The view fixture serves the real E. coli tags with browser.rs's view
// semantics (e2eBridge.ts viewIds) and keeps the text of every export.
// In that fixture every tag has length 3 and no database hit, and 129
// spectra share the prefix scan=1: the filters that cut it are the
// spectrum substring, the E-value cutoff and the per-spectrum rule (the
// length and hit filters still take part, as filters that keep every row).
import type { Page } from '@playwright/test'
import { test, expect, goTo, openApp, mockState } from './fixtures'
import type { ResultsView } from '../../src/types'

const PATH = '/data/run01.tags.tsv'

async function openTags(page: Page): Promise<void> {
  await openApp(page, 'view')
  await goTo(page, 'Results')
  await page.getByRole('button', { name: 'Open tags…' }).click()
  await expect(page.getByText('Showing 2,028 of 2,028')).toBeVisible()
}

/// The view the table asked for last.
async function lastView(page: Page): Promise<ResultsView> {
  const calls = await mockState<{ view: ResultsView }[]>(page, 'resultsQueryCalls')
  return calls[calls.length - 1].view
}

/// Every row of @p view, page by page through the bridge the table uses.
function viewRows(page: Page, view: ResultsView): Promise<{ ids: number[]; rows: string[][]; columns: string[] }> {
  return page.evaluate(
    async ([path, v]) => {
      const m = (window as unknown as { __fastagE2E: { mock: { resultsQuery: Function } } }).__fastagE2E.mock
      const ids: number[] = []
      const rows: string[][] = []
      let columns: string[] = []
      for (;;) {
        const p = await m.resultsQuery(path, v, ids.length, 1000)
        columns = p.columns
        if (p.rows.length === 0) break
        ids.push(...p.rowIds)
        rows.push(...p.rows)
        if (ids.length >= p.matchedRows) break
      }
      return { ids, rows, columns }
    },
    [PATH, view] as const
  )
}

async function shownCount(page: Page): Promise<number> {
  const text = (await page.getByText(/^Showing [\d,]+ of 2,028/).textContent()) ?? ''
  return Number(text.replace(/^Showing ([\d,]+) of.*$/s, '$1').replace(/,/g, ''))
}

async function setBox(page: Page, label: string, value: string): Promise<void> {
  const box = page.getByLabel(label, { exact: true })
  await box.fill(value)
  await box.press('Enter')
}

/// The raw cells of the rows in the DOM, top to bottom.
const domRows = (page: Page): Promise<string[][]> =>
  page.$$eval('.rt-rows .rt-row', (rows) =>
    rows.map((r) => Array.from(r.querySelectorAll('[role="cell"]')).map((c) => c.getAttribute('aria-label') ?? ''))
  )

test('a tighter E-value cutoff never adds rows, with and without the best tag per spectrum', async ({ page }) => {
  await openTags(page)
  for (const best of [false, true]) {
    if (best) await page.getByLabel('Per spectrum').selectOption({ label: 'Best tag' })
    let prev: Set<number> | null = null
    let prevCount = Infinity
    for (const cutoff of ['1000', '100', '1', '0.1', '0.01', '0.001', '1e-5']) {
      await setBox(page, 'Max. E-value', cutoff)
      await expect.poll(async () => (await lastView(page)).maxEvalue).toBe(Number(cutoff))
      const view = await lastView(page)
      expect(view.perSpectrum ?? null).toBe(best ? 1 : null)
      const { ids } = await viewRows(page, view)
      await expect.poll(() => shownCount(page)).toBe(ids.length)
      expect(ids.length).toBeLessThanOrEqual(prevCount)
      if (prev) for (const i of ids) expect(prev.has(i), `row ${i} appeared at cutoff ${cutoff}`).toBe(true)
      prev = new Set(ids)
      prevCount = ids.length
    }
    // The cutoffs really cut: the tightest one leaves fewer rows than the first.
    expect(prevCount).toBeLessThan(best ? 1000 : 2028)
    await setBox(page, 'Max. E-value', '')
  }
})

test('filters commute: the order they are set in changes neither the view nor its rows', async ({ page }) => {
  type Step = (p: Page) => Promise<void>
  const steps: Step[] = [
    (p) => setBox(p, 'Min. length', '3'),
    (p) => p.getByRole('button', { name: 'Not in database', exact: true }).click(),
    (p) => setBox(p, 'Spectrum contains', 'SCAN=11'),
    (p) => p.getByLabel('Per spectrum').selectOption({ label: 'Best 2' }),
    (p) => setBox(p, 'Max. E-value', '50')
  ]
  const run = async (order: number[]): Promise<{ view: ResultsView; count: number; ids: number[]; dom: string[][] }> => {
    await openTags(page)
    for (const k of order) await steps[k](page)
    await expect.poll(async () => (await lastView(page)).perSpectrum).toBe(2)
    await expect.poll(async () => (await lastView(page)).maxEvalue).toBe(50)
    const view = await lastView(page)
    const { ids } = await viewRows(page, view)
    await expect.poll(() => shownCount(page)).toBe(ids.length)
    return { view, count: await shownCount(page), ids, dom: (await domRows(page)).slice(0, 10) }
  }
  const a = await run([0, 1, 2, 3, 4])
  const b = await run([4, 3, 2, 1, 0])
  const c = await run([2, 0, 4, 1, 3])
  expect(a.count).toBeGreaterThan(0)
  expect(a.count).toBeLessThan(2028)
  for (const x of [b, c]) {
    expect(x.view).toEqual(a.view)
    expect(x.count).toBe(a.count)
    expect(x.ids).toEqual(a.ids)
    expect(x.dom).toEqual(a.dom)
  }
})

test('an export equals the view: its rows, its order, the shown columns, as TSV and as CSV', async ({ page }) => {
  await openTags(page)
  await setBox(page, 'Spectrum contains', 'scan=115')
  await page.getByLabel('Per spectrum').selectOption({ label: 'Best 3' })
  // Sorted by tag, descending (one click ascending, a second descending).
  const tagHeader = page.getByRole('button', { name: /^Tag/ })
  await tagHeader.click()
  await tagHeader.click()
  await expect.poll(async () => JSON.stringify((await lastView(page)).sort)).toBe(JSON.stringify({ column: 'tag', desc: true }))
  await page.getByRole('button', { name: 'Columns…' }).click()
  await page.getByRole('checkbox', { name: 'Charge' }).uncheck()
  const view = await lastView(page)
  const { rows, columns } = await viewRows(page, view)
  const shown = columns.filter((c) => c !== 'charge')
  const pick = shown.map((c) => columns.indexOf(c))
  const n = rows.length.toLocaleString('en-US')
  for (const [dest, format] of [
    ['/data/run01.view.tsv', 'tsv'],
    ['/data/run01.view.csv', 'csv']
  ] as const) {
    await page.evaluate((d) => {
      ;(window as unknown as { __fastagE2E: { mock: { nextPickOutput: string } } }).__fastagE2E.mock.nextPickOutput = d
    }, dest)
    await page.getByRole('button', { name: 'Export shown rows…' }).click()
    await expect(page.getByText(`Wrote ${n} rows to ${dest}.`)).toBeVisible()
    const exports = await page.evaluate(
      () => (window as unknown as { __fastagE2E: { exports: { dest: string; format: string; text: string }[] } }).__fastagE2E.exports
    )
    const got = exports[exports.length - 1]
    expect(got.dest).toBe(dest)
    expect(got.format).toBe(format)
    const [sep, end] = format === 'tsv' ? ['\t', '\n'] : [',', '\r\n']
    const lines = got.text.split(end)
    expect(lines.pop()).toBe('') // one line end after the last row
    expect(lines[0].split(sep)).toEqual(shown)
    // No cell of this fixture needs CSV quotes: the lines split as TSV does.
    expect(lines.slice(1).map((l) => l.split(sep))).toEqual(rows.map((r) => pick.map((j) => r[j] ?? '')))
  }
  // What the table shows on top is the start of the export.
  const dom = await domRows(page)
  expect(dom.length).toBeGreaterThan(5)
  expect(dom.slice(0, 5)).toEqual(rows.slice(0, 5).map((r) => pick.map((j) => r[j] ?? '')))
})

test('an export outlives a tab switch: its progress, its Cancel and its outcome stay, and a second export cannot start over it', async ({ page }) => {
  await openTags(page)
  await page.evaluate(() => {
    const m = (window as unknown as { __fastagE2E: { mock: { holdExport: boolean; nextPickOutput: string } } }).__fastagE2E.mock
    m.holdExport = true
    m.nextPickOutput = '/data/run01.held.tsv'
  })
  const exportBtn = page.getByRole('button', { name: 'Export shown rows…' })
  await exportBtn.click()
  const bar = page.getByRole('progressbar', { name: 'Export progress' })
  await expect(bar).toHaveAttribute('aria-valuenow', '50')
  // Away to another tab (the table unmounts) and back.
  await page.getByRole('tab', { name: 'Digest' }).click()
  await expect(bar).toHaveCount(0)
  await page.getByRole('tab', { name: 'Tags' }).click()
  await expect(page.getByText('Showing 2,028 of 2,028')).toBeVisible()
  await expect(bar).toHaveAttribute('aria-valuenow', '50')
  await expect(page.getByRole('button', { name: 'Cancel export' })).toBeVisible()
  // No second export over the running one (Cmd+E is the same action).
  await expect(exportBtn).toBeDisabled()
  await page.evaluate(() => (window as unknown as { __fastagE2E: { menu(a: string): void } }).__fastagE2E.menu('export'))
  expect(await mockState<unknown[]>(page, 'exportCalls')).toHaveLength(1)
  await page.evaluate(() => (window as unknown as { __fastagE2E: { finishExport(): void } }).__fastagE2E.finishExport())
  await expect(page.getByText('Wrote 2,028 rows to /data/run01.held.tsv.')).toBeVisible()
  await expect(exportBtn).toBeEnabled()
  // Once more, cancelled after a switch: Cancel reaches the job, focus stays on a control.
  await exportBtn.click()
  await expect(bar).toHaveAttribute('aria-valuenow', '50')
  await page.getByRole('tab', { name: 'Species' }).click()
  await page.getByRole('tab', { name: 'Tags' }).click()
  const cancel = page.getByRole('button', { name: 'Cancel export' })
  await cancel.focus()
  await cancel.press('Enter')
  await expect(page.getByText('Export cancelled; nothing was written.')).toBeVisible()
  await expect(exportBtn).toBeFocused()
  expect(await mockState<number[]>(page, 'exportCancelCalls')).toEqual([2])
})
