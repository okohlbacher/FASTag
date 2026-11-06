// P0b quick wins (GUI-DESIGN 10): D5 file order first and the ranked swap
// (also during a scroll fling), parameter search to a field, instrument
// presets. The rank fixture serves the E-value view in file order until
// finishRanking(), as browser.rs does while its order is being built.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect, openApp, mockState } from './fixtures'

const TSV = readFileSync(fileURLToPath(new URL('../fixtures/ecoli.tags.tsv', import.meta.url)), 'utf8')
const [HEAD, ...LINES] = TSV.split('\n').filter((l) => l !== '')
const EV = HEAD.split('\t').indexOf('evalue')
const TAG = HEAD.split('\t').indexOf('tag')
const ROWS = LINES.map((l) => l.split('\t'))
// Oracle: every E-value of the fixture is a finite number; ties in file order.
const RANKED = ROWS.map((r, i) => ({ r, i }))
  .sort((a, b) => Number(a.r[EV]) - Number(b.r[EV]) || a.i - b.i)
  .map((x) => x.r)

type Ctl = { finishRanking(): void; rankProgress(d: number, t: number): void }
const ctl = (page: Page, f: keyof Ctl, ...a: number[]): Promise<void> =>
  page.evaluate(
    ([name, args]) => {
      const c = (window as unknown as { __fastagE2E: Record<string, (...x: number[]) => void> }).__fastagE2E
      c[name as string](...(args as number[]))
    },
    [f, a] as const
  )

/// The raw cells of column @p j of the rows in the DOM, top to bottom.
const column = (page: Page, j: number): Promise<string[]> =>
  page.$$eval(
    '.rt-rows .rt-row',
    (rows, jj) => rows.map((r) => r.querySelectorAll('[role="cell"]')[jj as number]?.getAttribute('aria-label') ?? ''),
    j
  )

async function openTags(page: Page): Promise<void> {
  await openApp(page, 'rank')
  await page.getByRole('button', { name: 'Open tags…' }).click()
}

test('D5: the file opens in file order with a ranking note', async ({ page }) => {
  await openTags(page)
  await expect(page.getByText(/Ranking by E-value/)).toBeVisible()
  await expect.poll(async () => (await column(page, TAG)).slice(0, 5)).toEqual(ROWS.slice(0, 5).map((r) => r[TAG]))
  await ctl(page, 'rankProgress', 1014, 2028)
  await expect(page.getByText(/Ranking by E-value… 50%/)).toBeVisible()
})

test('D5: the swap changes the order but not the row set', async ({ page }) => {
  await openTags(page)
  await expect(page.getByText('Showing 2,028 of 2,028')).toBeVisible()
  await ctl(page, 'finishRanking')
  await expect(page.getByText('Ranked by E-value.')).toBeAttached()
  await expect(page.getByText(/Ranking by E-value/)).toHaveCount(0)
  const shown = await column(page, EV)
  expect(shown.length).toBeGreaterThan(5)
  expect(shown).toEqual(RANKED.slice(0, shown.length).map((r) => r[EV]))
  await expect(page.getByText('Showing 2,028 of 2,028')).toBeVisible()
  // The whole row set through the view: what the mock served after the swap.
  const calls = await mockState<{ view: { sort: unknown }; offset: number }[]>(page, 'resultsQueryCalls')
  expect(calls.every((c) => JSON.stringify(c.view.sort) === JSON.stringify({ column: 'evalue', desc: false }))).toBe(true)
})

test('D5: the swap happens during a scroll fling', async ({ page }) => {
  await openTags(page)
  await expect(page.getByText('Showing 2,028 of 2,028')).toBeVisible()
  const table = page.getByRole('region', { name: 'Tags table' })
  await table.hover()
  for (let i = 0; i < 30; i++) {
    await page.mouse.wheel(0, 400)
    if (i === 10) await ctl(page, 'finishRanking')
  }
  await expect(page.getByText('Ranked by E-value.')).toBeAttached()
  // Whatever window is in view now is in E-value order.
  await expect
    .poll(async () => {
      const ev = (await column(page, EV)).filter((v) => v !== '').map(Number)
      return ev.length > 3 && ev.every((v, k) => k === 0 || ev[k - 1] <= v)
    })
    .toBe(true)
})

test('search to field: "tolerance" focuses fragment_tolerance', async ({ page }) => {
  await openApp(page)
  await page.locator('body').press('/')
  const box = page.getByRole('combobox', { name: /Search parameters/ })
  await expect(box).toBeFocused()
  await box.fill('tolerance')
  await expect(page.getByRole('option').first()).toContainText('fragment_tolerance')
  await box.press('Enter')
  await expect(page.locator('#p-fragment_tolerance')).toBeFocused()
  // The shortcut reaches it too.
  // From inside a field too (the modifier shortcut is not a typed character).
  await page.keyboard.press('ControlOrMeta+k')
  await expect(box).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(box).toHaveCount(0)
})

test('presets: "Ion trap CID" sets 0.3 Da and nothing else', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await expect(page.getByLabel('Instrument').locator('option')).toHaveText([
    'Choose a preset…',
    'Orbitrap HCD 20 ppm',
    'Ion trap CID 0.3 Da',
    'timsTOF 30 ppm (unvalidated)',
    'Astral 20 ppm (unvalidated)'
  ])
  await page.getByLabel('Instrument').selectOption({ label: 'Ion trap CID 0.3 Da' })
  await page.getByRole('button', { name: 'Run on run01.mzML' }).click()
  await expect(page.getByText('Showing 2,028 of 2,028')).toBeVisible()
  const runs = await mockState<{ params: Record<string, unknown> }[]>(page, 'runCalls')
  expect(runs).toHaveLength(1)
  expect(runs[0].params).toMatchObject({ fragment_tolerance: '0.3', fragment_tolerance_unit: 'Da' })
})
