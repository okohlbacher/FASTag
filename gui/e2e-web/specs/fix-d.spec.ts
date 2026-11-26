// 1.16.2 package D: styles. Each test names the finding of the 1.16.1 UI
// test it covers (FINDINGS.md).
import type { Locator, Page } from '@playwright/test'
import { test, expect, openApp, goTo, toStep, chooseTask } from './fixtures'

test.describe.configure({ timeout: 180_000 })

const runButton = (page: Page): Locator => page.locator('.view-setup .actionbar').getByRole('button', { name: /^Run/ })
const pill = (page: Page): Locator => page.getByRole('group', { name: 'Run status' })

/// WCAG contrast of @p el's text on the first opaque background behind it.
function contrastOf(el: Locator): Promise<number> {
  return el.evaluate((e) => {
    const rgb = (s: string): number[] => (s.match(/[\d.]+/g) ?? []).map(Number)
    let bg: number[] = [255, 255, 255]
    for (let n: Element | null = e; n; n = n.parentElement) {
      const c = rgb(getComputedStyle(n).backgroundColor)
      if (c.length === 3 || (c.length === 4 && c[3] === 1)) {
        bg = c.slice(0, 3)
        break
      }
    }
    const lum = (c: number[]): number => {
      const [r, g, b] = c.slice(0, 3).map((x) => {
        const v = x / 255
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const [a, b] = [lum(rgb(getComputedStyle(e).color)), lum(bg)].sort((p, q) => q - p)
    return (a + 0.05) / (b + 0.05)
  })
}

// shell-4
test('light theme: muted text on the accent tint (selected task tile, active search hit) reaches 4.5:1', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await openApp(page)
  const q = page.locator('button.task-tile.selected .task-tile-q').first()
  await expect(q).toBeVisible()
  expect(await contrastOf(q), 'selected task tile').toBeGreaterThanOrEqual(4.5)
  await page.getByRole('button', { name: /Search settings…/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Search parameters' })
  await dialog.getByRole('combobox').fill('tag')
  const where = dialog.locator('li.active .where').first()
  await expect(where).toBeVisible()
  expect(await contrastOf(where), 'active search hit').toBeGreaterThanOrEqual(4.5)
})

// shell-7
test('a run going: the run status pill names "run01.mzML" whole from 960 to 1440 px on every view', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 600 })
  await openApp(page, 'slow')
  await toStep(page, 'Inputs')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await runButton(page).click()
  await expect(page.getByRole('region', { name: 'Running' })).toContainText('50%')
  const cut: string[] = []
  for (const width of [960, 1024, 1100, 1200, 1280, 1440]) {
    await page.setViewportSize({ width, height: 600 })
    for (const v of ['Results', 'Setup', 'Batch', 'History'] as const) {
      await goTo(page, v)
      const f = pill(page).locator('.pill-file')
      await expect(f).toHaveText('run01.mzML')
      const [cw, sw] = await f.evaluate((e) => [e.clientWidth, e.scrollWidth])
      if (sw > cw) cut.push(`${width} ${v}: ${cw}/${sw} px`)
    }
  }
  await pill(page).getByRole('button', { name: 'Cancel' }).click()
  expect(cut, 'the file name run01.mzML is cut in the pill').toEqual([])
})

// suite-3
test('search, number and URL inputs get the field styling of a text input', async ({ page }) => {
  await openApp(page)
  const looks = await page.evaluate(() => {
    const out: Record<string, string> = {}
    for (const type of ['text', 'search', 'number', 'url']) {
      const i = document.createElement('input')
      i.type = type
      document.querySelector('main, #root')!.appendChild(i)
      const s = getComputedStyle(i)
      out[type] = [s.height, s.borderTopColor, s.borderTopWidth, s.borderRadius, s.backgroundColor, s.paddingLeft].join(' ')
      i.remove()
    }
    return out
  })
  for (const t of ['search', 'number', 'url']) expect(looks[t], t).toBe(looks.text)
})

// suite-4
test('960x600 with Help open: History keeps a readable stem and the whole extension of each file name', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 600 })
  await openApp(page, 'gate')
  await chooseTask(page, 'Characterize a run')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await runButton(page).click()
  await expect(page.locator('#run-status')).toContainText('Finished', { timeout: 60_000 })
  await goTo(page, 'History')
  await page.getByRole('button', { name: 'Help', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Help' })).toBeVisible()
  await expect(page.getByRole('table', { name: 'Run history' })).toBeVisible()
  const m = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('table.history-table .hist-name')].map((n) => {
      const stem = n.querySelector<HTMLElement>('.hist-stem')!
      const ext = n.querySelector<HTMLElement>('.hist-ext')
      const td = (n.closest('td') as HTMLElement).getBoundingClientRect()
      return {
        name: n.title.slice(n.title.lastIndexOf('/') + 1),
        stemShown: Math.round(stem.clientWidth),
        stemFull: Math.round(stem.scrollWidth),
        extOutside: !!ext && ext.getBoundingClientRect().right > td.right + 0.5
      }
    })
  )
  expect(m.length).toBeGreaterThan(0)
  // Four characters of a stem at least (about 28 px), and no extension cut by the cell.
  expect(m.filter((x) => x.stemShown < Math.min(28, x.stemFull)).map((x) => `${x.name}: ${x.stemShown} of ${x.stemFull} px`), 'stems cut to a letter or two').toEqual([])
  expect(m.filter((x) => x.extOutside).map((x) => x.name), 'extensions cut by the cell').toEqual([])
})

// survey-2
test('Characterize, Outputs & run: the alkylation report\'s Change… sits beside its file name', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await openApp(page)
  await chooseTask(page, 'Characterize a run')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await toStep(page, 'Outputs & run')
  const row = page.locator('li.product', { has: page.locator('input[data-param="alkylation_out"]') })
  await expect(row.locator('.product-note')).not.toBeEmpty()
  const file = await row.locator('.product-file').boundingBox()
  const change = await row.getByRole('button', { name: 'Change the file of Alkylation report' }).boundingBox()
  expect(Math.abs(file!.y + file!.height / 2 - (change!.y + change!.height / 2)), 'Change… on the file name\'s line').toBeLessThan(6)
  expect(change!.x).toBeGreaterThan(file!.x)
})

// tags-9
test('the chevron of the Command line disclosure turns when it is open', async ({ page }) => {
  await openApp(page)
  await toStep(page, 'Inputs')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await toStep(page, 'Outputs & run')
  const chev = page.locator('details.command-preview > summary .chev')
  const closed = await chev.evaluate((e) => getComputedStyle(e).transform)
  await page.locator('details.command-preview > summary').click()
  await expect(page.locator('details.command-preview')).toHaveAttribute('open', '')
  await expect.poll(() => chev.evaluate((e) => getComputedStyle(e).transform)).not.toBe(closed)
})
