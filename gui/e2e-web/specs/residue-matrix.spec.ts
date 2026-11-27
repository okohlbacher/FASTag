// Mass shifts › By residue in a real browser (Chromium and WebKit), on the
// gate-recon scenario with the 1.16.2 survey of PXD000001 opened through
// Open report… (src/fixtures/cli-1.16/README.md): the view, its filter, the
// keyboard, the export's content against an oracle recomputed here from the
// file with no GUI code, 960x600, and both themes.
//
// SHOT_DIR=<dir> also writes the two 1200x800 screenshots there.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect, goTo, mockState, openApp } from './fixtures'

const FILE = fileURLToPath(new URL('../../src/fixtures/cli-1.16/pxd000001-survey/run.delta.tsv', import.meta.url))
const TEXT = readFileSync(FILE, 'utf8')
const PATH = '/data/pxd000001.delta.tsv'

/// The matrix as the README defines it: rows with a gap of 0.5 Da or more
/// (nearer 0 is the unshifted placement, not listed) and at least @p min
/// localized spectra, most spectra first (ties in file order), a terminal
/// site under N-term or C-term.
function oracle(min: number) {
  const [head, ...lines] = TEXT.trim().split('\n').map((l) => l.split('\t'))
  const col = (name: string): number => head.indexOf(name)
  const all = lines
    .map((f, i) => {
      const cells: Record<string, number> = {}
      if (f[col('residues')] !== '-')
        for (const pair of f[col('residues')].split(',')) {
          const [site, n] = [pair.slice(0, pair.lastIndexOf(':')), Number(pair.slice(pair.lastIndexOf(':') + 1))]
          const c = site.includes('N-term|') ? 'N-term' : site.includes('C-term|') ? 'C-term' : site
          cells[c] = (cells[c] ?? 0) + n
        }
      return { i, delta: f[col('delta')], spectra: Number(f[col('spectra')]), localized: Number(f[col('localized')]), unlocalized: Number(f[col('unlocalized')]), unimod: f[col('unimod')], cells }
    })
  const shifted = all.filter((r) => Math.abs(Number(r.delta)) >= 0.5)
  const rows = shifted.filter((r) => r.localized >= min).sort((a, b) => b.spectra - a.spectra || a.i - b.i)
  const unshifted = all.filter((r) => Math.abs(Number(r.delta)) < 0.5).reduce((n, r) => n + r.spectra, 0)
  return { rows, total: shifted.length, unshifted }
}

async function openMatrix(page: Page): Promise<void> {
  await openApp(page, 'gate-recon')
  await page.evaluate(
    ([p, t]) => {
      const m = (window as unknown as { __fastagE2E: { mock: { reportFiles: Record<string, string>; nextPickReport: string } } }).__fastagE2E.mock
      m.reportFiles[p] = t
      m.nextPickReport = p
    },
    [PATH, TEXT]
  )
  await goTo(page, 'Results')
  await page.getByRole('button', { name: 'Open report…' }).click()
  await expect(page.getByRole('tab', { name: 'Mass shifts' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: 'By residue' }).click()
  await expect(grid(page)).toBeVisible()
}

const grid = (page: Page) => page.getByRole('grid', { name: 'Mass shifts by residue' })
const cellsOf = async (page: Page, row: number): Promise<string[]> => (await grid(page).getByRole('row').nth(row).getByRole('gridcell').allInnerTexts()).map((s) => s.trim())

test('By residue: the rows and totals of the survey, most spectra first', async ({ page }) => {
  const o = oracle(1)
  await openMatrix(page)
  await expect(grid(page)).toHaveAttribute('aria-rowcount', String(o.rows.length + 1))
  await expect(page.locator('.recon-tables .dt-count')).toHaveText(`${o.rows.length} of ${o.total} rows`)
  await expect(page.locator('.recon-tables .unshifted-note')).toHaveText(`${o.unshifted} spectra with a gap under 0.5 Da (no shift) not listed.`)
  const heads = (await grid(page).getByRole('columnheader').allInnerTexts()).map((h) => h.replace(/[↑↓]/g, '').trim())
  expect(heads).toEqual(['Gap (Da)', 'Best name', 'Spectra', 'Localized', 'Unlocalized', 'Localized %', 'N-term', 'C-term'])
  const top = o.rows[0]
  const c = await cellsOf(page, 1)
  expect([c[0], c[2], c[3], c[4]]).toEqual([top.delta, String(top.spectra), String(top.localized), String(top.unlocalized)])
  expect(c[1]).toBe(top.unimod.split(';')[0].replace(/\([^)]*\)$/, ''))
  expect(Number(c[6]) + Number(c[7] || 0)).toBe(top.localized)
  const loc = o.rows.reduce((n, r) => n + r.localized, 0)
  await expect(page.locator('.recon-tables .report-sum')).toContainText(`${loc} localized`)
})

test('By residue: the minimum-count filter and the empty columns', async ({ page }) => {
  await openMatrix(page)
  await page.getByRole('spinbutton', { name: 'Localized at least' }).fill('10')
  await expect(grid(page)).toHaveAttribute('aria-rowcount', String(oracle(10).rows.length + 1))
  await page.getByRole('checkbox', { name: /Hide empty residue columns/ }).uncheck()
  await expect(grid(page).getByRole('columnheader')).toHaveCount(6 + 22)
  await page.getByRole('checkbox', { name: /Terminal sites under their residue/ }).check()
  await expect(grid(page).getByRole('columnheader')).toHaveCount(6 + 20)
  await page.getByRole('spinbutton', { name: 'Localized at least' }).fill('1000')
  await expect(page.getByText('No mass shift has that many localized spectra: lower Localized at least.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export matrix…' })).toBeDisabled()
})

test('By residue: the keyboard moves the active row and sorts by gap', async ({ page, browserName }) => {
  // Safari moves Tab to text fields only, unless asked for every control.
  const nextControl = browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab'
  const o = oracle(1)
  await openMatrix(page)
  // From the count field, Tab reaches the next filter.
  await page.getByRole('spinbutton', { name: 'Localized at least' }).focus()
  await page.keyboard.press(nextControl)
  await expect(page.getByRole('checkbox', { name: /Hide empty residue columns/ })).toBeFocused()
  await page.keyboard.press('Space')
  await expect(page.getByRole('checkbox', { name: /Hide empty residue columns/ })).not.toBeChecked()
  await page.keyboard.press('Space')
  await grid(page).focus()
  const rows = grid(page).getByRole('row')
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowDown')
  await expect(rows.nth(2)).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('End')
  await expect(rows.nth(o.rows.length)).toHaveAttribute('aria-selected', 'true')
  // A heading is a button: Enter sorts by it.
  const gap = grid(page).getByRole('columnheader', { name: /^Gap \(Da\)/ })
  await gap.getByRole('button').focus()
  await page.keyboard.press('Enter')
  await expect(gap).toHaveAttribute('aria-sort', 'ascending')
  const asc = [...o.rows].sort((a, b) => Number(a.delta) - Number(b.delta))
  expect((await cellsOf(page, 1))[0]).toBe(asc[0].delta)
  await page.keyboard.press('Enter')
  await expect(gap).toHaveAttribute('aria-sort', 'descending')
  expect((await cellsOf(page, 1))[0]).toBe(asc.at(-1)!.delta)
})

test('By residue: Export matrix… writes the rows and columns shown, in the order shown', async ({ page }) => {
  await openMatrix(page)
  await page.getByRole('spinbutton', { name: 'Localized at least' }).fill('5')
  const o = oracle(5)
  await page.evaluate(() => {
    ;(window as unknown as { __fastagE2E: { mock: { nextPickOutput: string } } }).__fastagE2E.mock.nextPickOutput = '/data/pxd000001.delta.by_residue.tsv'
  })
  await page.getByRole('button', { name: 'Export matrix…' }).click()
  await expect(page.getByText(/written to \/data\/pxd000001\.delta\.by_residue\.tsv, in the order shown/)).toBeVisible()
  const writes = await mockState<{ dest: string; text: string }[]>(page, 'summaryWrites')
  expect(writes.map((w) => w.dest)).toEqual(['/data/pxd000001.delta.by_residue.tsv'])
  const sites = ['N-term', 'C-term'].filter((s) => o.rows.some((r) => r.cells[s]))
  const want =
    [
      ['delta', 'name', 'spectra', 'localized', 'unlocalized', 'localized_pct', ...sites],
      ...o.rows.map((r) => [
        r.delta,
        r.unimod === '-' ? '' : r.unimod.split(';')[0].replace(/\([^)]*\)$/, ''),
        String(r.spectra),
        String(r.localized),
        String(r.unlocalized),
        String(Math.round((100 * r.localized) / r.spectra)),
        ...sites.map((s) => String(r.cells[s] ?? 0))
      ])
    ]
      .map((l) => l.join('\t'))
      .join('\n') + '\n'
  expect(writes[0].text).toBe(want)
  // The table shown is never written over.
  await page.evaluate((p) => {
    ;(window as unknown as { __fastagE2E: { mock: { nextPickOutput: string } } }).__fastagE2E.mock.nextPickOutput = p
  }, PATH)
  await page.getByRole('button', { name: 'Export matrix…' }).click()
  await expect(page.getByText(/is the mass-shift table shown/)).toBeVisible()
  expect(await mockState<unknown[]>(page, 'summaryWrites')).toHaveLength(1)
})

test('By residue at 960x600: the table scrolls sideways in its own box, the gap column stays', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 600 })
  await openMatrix(page)
  await page.getByRole('checkbox', { name: /Hide empty residue columns/ }).uncheck()
  await expect(grid(page).getByRole('columnheader')).toHaveCount(28)
  const wrap = page.locator('.recon-tables .dt-wrap')
  const box = await wrap.evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }))
  expect(box.sw).toBeGreaterThan(box.cw)
  // No page scroll sideways: neither the document nor the results pane.
  const page2 = await page.evaluate(() => {
    const d = document.scrollingElement!
    const t = document.querySelector('.tablewrap') as HTMLElement | null
    return { doc: d.scrollWidth - d.clientWidth, pane: t ? t.scrollWidth - t.clientWidth : 0 }
  })
  expect(page2).toEqual({ doc: 0, pane: 0 })
  // The gap column is sticky: after a scroll to the right it is still at the box's left edge.
  await wrap.evaluate((e) => {
    e.scrollLeft = e.scrollWidth
  })
  const first = grid(page).getByRole('row').nth(1).getByRole('gridcell').first()
  const [w, f] = await Promise.all([wrap.boundingBox(), first.boundingBox()])
  expect(Math.abs(f!.x - w!.x)).toBeLessThan(2)
})

test('By residue in both themes: shaded cells take the theme tokens, the numbers stay', async ({ page }, info) => {
  const look: Record<string, { heat: string; text: string; cells: string[] }> = {}
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await openMatrix(page)
    await page.getByRole('checkbox', { name: /Terminal sites under their residue/ }).check()
    const hot = grid(page).locator('td.heat').first()
    await expect(hot).toBeVisible()
    look[scheme] = {
      heat: await hot.evaluate((e) => getComputedStyle(e).backgroundImage),
      text: await hot.evaluate((e) => getComputedStyle(e).color),
      cells: await cellsOf(page, 1)
    }
    await grid(page).scrollIntoViewIfNeeded()
    await page.locator('.recon-tables').evaluate((e) => e.scrollIntoView({ block: 'start' }))
    const shot = `residue-matrix-${scheme}.png`
    await page.screenshot({ path: info.outputPath(shot) })
    if (process.env.SHOT_DIR && info.project.name === 'chromium') await page.screenshot({ path: `${process.env.SHOT_DIR}/${shot}` })
  }
  expect(look.light.heat).toMatch(/gradient/)
  expect(look.dark.heat).not.toBe(look.light.heat)
  expect(look.dark.text).not.toBe(look.light.text)
  expect(look.dark.cells).toEqual(look.light.cells)
})
