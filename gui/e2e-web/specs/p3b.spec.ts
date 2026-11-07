// P3 PR b (GUI-DESIGN 3 S4, 9 layer 3, 10 P3): the Tags table by keyboard
// (an active row moved by the arrows, PageUp/PageDown and Home/End, with a
// roving tabindex), copy row and copy USI, the first-ID placeholder, and the
// Stitch/ALPS export. The `denovo` fixture serves the real E. coli tags with
// the res_conf and usi columns (src/fixtures/denovo/ecoli.res_conf.tags.tsv)
// through browser.rs's view semantics; the reads must equal the golden files
// tools/tags_to_denovo.py writes (scripts/denovo-golden.mjs checks those in
// CI). The clipboard is a recorder (Playwright's WebKit cannot read it).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect, goTo, openApp, mockState } from './fixtures'

const DIR = fileURLToPath(new URL('../../src/fixtures/denovo/', import.meta.url))
const TSV = readFileSync(`${DIR}ecoli.res_conf.tags.tsv`, 'utf8')
const golden = (name: string): string => readFileSync(`${DIR}${name}`, 'utf8')
const LINES = TSV.split('\n').filter(Boolean)
const COLUMNS = LINES[0].split('\t')
const ROWS = LINES.slice(1).map((l) => l.split('\t'))
const SPECTRA = new Set(ROWS.map((r) => r[0]))
const TOTAL = ROWS.length.toLocaleString('en-US')

async function openTags(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __copied: string[] }
    w.__copied = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (t: string) => (w.__copied.push(t), Promise.resolve()) }
    })
  })
  await openApp(page, 'denovo')
  await goTo(page, 'Results')
  await page.getByRole('button', { name: 'Open tags…' }).click()
  await expect(page.getByText(`Showing ${TOTAL} of ${TOTAL}`)).toBeVisible()
}

const copied = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)
const active = (page: Page) => page.locator('.rt-rows .rt-row[aria-selected="true"]')
const activeIndex = async (page: Page): Promise<number> => Number(await active(page).getAttribute('aria-rowindex')) - 2
/// The raw cells of the active row.
const activeCells = (page: Page): Promise<string[]> =>
  active(page).evaluate((r) => Array.from(r.querySelectorAll('[role="gridcell"]')).map((c) => c.getAttribute('aria-label') ?? ''))

/// The view's rows in the order the table shows them (E-value ascending).
function viewRows(page: Page): Promise<string[][]> {
  return page.evaluate(async () => {
    const m = (window as unknown as { __fastagE2E: { mock: { resultsQuery: Function; resultsQueryCalls: { view: unknown }[] } } }).__fastagE2E.mock
    const view = m.resultsQueryCalls[m.resultsQueryCalls.length - 1].view
    const rows: string[][] = []
    for (;;) {
      const p = await m.resultsQuery('/data/run01.tags.tsv', view, rows.length, 1000)
      rows.push(...p.rows)
      if (p.rows.length === 0 || rows.length >= p.matchedRows) break
    }
    return rows
  })
}

test('the active row moves by keyboard: arrows, PageDown/PageUp, Home/End, with focus on it and in view', async ({ page }) => {
  await openTags(page)
  const rows = await viewRows(page)
  const region = page.getByRole('region', { name: 'Tags table' })
  await region.focus()
  await page.keyboard.press('ArrowDown')
  await expect(active(page)).toBeFocused()
  expect(await activeIndex(page)).toBe(0)
  expect(await activeCells(page)).toEqual(rows[0])
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowUp')
  expect(await activeIndex(page)).toBe(1)
  await page.keyboard.press('PageDown')
  const page1 = await activeIndex(page)
  expect(page1).toBeGreaterThan(5)
  await page.keyboard.press('PageUp')
  expect(await activeIndex(page)).toBe(1)
  await page.keyboard.press('End')
  await expect(active(page)).toBeFocused()
  expect(await activeIndex(page)).toBe(ROWS.length - 1)
  await expect(active(page)).toBeInViewport()
  expect(await activeCells(page)).toEqual(rows[ROWS.length - 1])
  await page.keyboard.press('ArrowDown')
  expect(await activeIndex(page)).toBe(ROWS.length - 1)
  await page.keyboard.press('Home')
  await expect(active(page)).toBeFocused()
  await expect(active(page)).toBeInViewport()
  expect(await activeIndex(page)).toBe(0)
  // One tab stop: Shift+Tab leaves the table, Tab comes back to the active row.
  await page.keyboard.press('Shift+Tab')
  await expect(active(page)).not.toBeFocused()
  await page.keyboard.press('Tab')
  await expect(active(page)).toBeFocused()
})

test('copy row copies the shown cells of the active row, and copy USI its USI, by key and by button', async ({ page }) => {
  await openTags(page)
  const rows = await viewRows(page)
  await page.getByRole('region', { name: 'Tags table' }).focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ControlOrMeta+c')
  await expect(page.getByText('Copied the row.')).toBeVisible()
  await page.keyboard.press('ControlOrMeta+Shift+c')
  await expect(page.getByText('Copied the USI.')).toBeVisible()
  const usi = COLUMNS.indexOf('usi')
  expect(await copied(page)).toEqual([rows[1].join('\t'), rows[1][usi]])
  expect(rows[1][usi]).toMatch(/^mzspec:USI000000:Ecoli_MS2_small:scan:\d+$/)
  // Hidden columns are not copied; the buttons copy the active row too.
  await page.getByRole('button', { name: 'Columns…' }).click()
  await page.getByRole('checkbox', { name: 'Residue conf.' }).uncheck()
  await page.locator('.rt-rows .rt-row').nth(4).click()
  await page.getByRole('button', { name: 'Copy row' }).click()
  await page.getByRole('button', { name: 'Copy USI' }).click()
  const rc = COLUMNS.indexOf('res_conf')
  expect((await copied(page)).slice(2)).toEqual([rows[4].filter((_, j) => j !== rc).join('\t'), rows[4][usi]])
})

test('the spectrum filter placeholder comes from the first spectrum ID of the file', async ({ page }) => {
  await openTags(page)
  expect(ROWS[0][0]).toBe('controllerType=0 controllerNumber=1 scan=11461')
  await expect(page.getByLabel('Spectrum contains', { exact: true })).toHaveAttribute('placeholder', 'scan=11461')
})

test('Stitch and ALPS reads equal what tools/tags_to_denovo.py writes, and the best tag is one read per tagged spectrum', async ({ page }) => {
  await openTags(page)
  const format = page.getByLabel('Export as')
  const cases = [
    { format: 'stitch', min: '8', top: '1', dest: '/data/run01.stitch.csv', golden: 'ecoli.stitch.csv' },
    { format: 'alps', min: '6', top: '3', dest: '/data/run01.alps.csv', golden: 'ecoli.alps.top3.csv' },
    { format: 'stitch', min: '1', top: '1', dest: '/data/run01.best.stitch.csv', golden: 'ecoli.stitch.best.csv' }
  ]
  for (const c of cases) {
    await format.selectOption(c.format)
    await page.getByLabel('Min. read length').fill(c.min)
    await page.getByLabel('Reads per spectrum').fill(c.top)
    await page.evaluate((d) => {
      ;(window as unknown as { __fastagE2E: { mock: { nextPickOutput: string } } }).__fastagE2E.mock.nextPickOutput = d
    }, c.dest)
    await page.getByRole('button', { name: 'Export reads…' }).click()
    await expect(page.getByText(new RegExp(`^Wrote [\\d,]+ (Stitch|ALPS) reads to ${c.dest.replace(/\./g, '\\.')}\\.`))).toBeVisible()
    const writes = await mockState<{ source: string; dest: string; text: string }[]>(page, 'readsWrites')
    const w = writes[writes.length - 1]
    expect(w.source).toBe('/data/run01.tags.tsv')
    expect(w.dest).toBe(c.dest)
    expect(w.text === golden(c.golden), `${c.golden} differs`).toBe(true)
  }
  // The best read of every spectrum: one line per tagged spectrum.
  const best = golden('ecoli.stitch.best.csv').split('\n').slice(1, -1).map((l) => l.split(',')[0])
  expect(best.length).toBe(SPECTRA.size)
  expect(new Set(best)).toEqual(SPECTRA)
  // The table export of the best tag per spectrum says the same.
  await format.selectOption('table')
  await page.getByLabel('Per spectrum').selectOption({ label: 'Best tag' })
  await expect(page.getByText(`Showing ${SPECTRA.size.toLocaleString('en-US')} of ${TOTAL}`)).toBeVisible()
  await page.evaluate(() => {
    ;(window as unknown as { __fastagE2E: { mock: { nextPickOutput: string } } }).__fastagE2E.mock.nextPickOutput = '/data/run01.best.tsv'
  })
  await page.getByRole('button', { name: 'Export shown rows…' }).click()
  await expect(page.getByText(`Wrote ${SPECTRA.size} rows to /data/run01.best.tsv.`)).toBeVisible()
  const exports = await page.evaluate(
    () => (window as unknown as { __fastagE2E: { exports: { text: string }[] } }).__fastagE2E.exports
  )
  const lines = exports[exports.length - 1].text.split('\n').slice(1, -1)
  expect(lines.length).toBe(SPECTRA.size)
  expect(new Set(lines.map((l) => l.split('\t')[0]))).toEqual(SPECTRA)
})

test('a file without res_conf offers no reads export', async ({ page }) => {
  await openApp(page, 'view')
  await goTo(page, 'Results')
  await page.getByRole('button', { name: 'Open tags…' }).click()
  await expect(page.getByText('Showing 2,028 of 2,028')).toBeVisible()
  const format = page.getByLabel('Export as')
  await expect(format.locator('option[value="stitch"]')).toBeDisabled()
  await expect(format.locator('option[value="alps"]')).toBeDisabled()
  await expect(format).toHaveAttribute('title', /-res_conf/)
})
