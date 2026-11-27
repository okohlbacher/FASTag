// Mass shifts › By residue, pooled, in a real browser (Chromium and WebKit):
// four real mass-shift tables of PXD045734 (FASTag 1.16.2, the lens runs of
// src/fixtures/cli-1.16/pxd045734-lens/README.md) pooled through Add
// tables…, checked against an oracle that pools the files here with no GUI
// code; the export and its sidecar; and 200 synthetic tables, timed, with
// the longest frame the page went without while it read them.
//
// LENS_DIR=<dir of *.delta.tsv> SHOT_DIR=<dir> also pools every table in
// LENS_DIR and writes pooled-matrix-{light,dark}.png (1800x1300, the app's
// own layout) to SHOT_DIR (Chromium only); skipped without them.
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect, goTo, mockState, openApp } from './fixtures'

const DIR = fileURLToPath(new URL('../../src/fixtures/cli-1.16/pxd045734-lens/', import.meta.url))
const NAMES = ['ah_4068_ZW_032115_UIF_N_57yo', 'ah_4068_ZW_032115_UIF_IC_57yo', 'sh_4096_ZW_041615_UIF_N_22yo', 'sh_4096_ZW_041615_UIF_IC_22yo']
const LENS = NAMES.map((n) => ({ path: `/data/PXD045734/${n}.delta.tsv`, text: readFileSync(`${DIR}${n}.delta.tsv`, 'utf8') }))

/// The pooled matrix as the Help defines it, from the files alone: rows
/// with |delta| >= 0.5; the row with the most spectra (ties: smaller gap,
/// earlier table, earlier row) takes every row not yet taken within 0.004
/// Da of its gap; counts summed.
function oracle(files: { text: string }[]) {
  const rows: { delta: number; key: string; spectra: number; localized: number; unlocalized: number; s: number; i: number }[] = []
  let unshifted = 0
  files.forEach((f, s) => {
    const [head, ...lines] = f.text.trim().split('\n').map((l) => l.split('\t'))
    const c = (n: string): number => head.indexOf(n)
    lines.forEach((l, i) => {
      const delta = Number(l[c('delta')])
      if (Math.abs(delta) < 0.5) {
        unshifted += Number(l[c('spectra')])
        return
      }
      rows.push({ delta, key: l[c('delta')], spectra: Number(l[c('spectra')]), localized: Number(l[c('localized')]), unlocalized: Number(l[c('unlocalized')]), s, i })
    })
  })
  const seeds = [...rows].sort((a, b) => b.spectra - a.spectra || a.delta - b.delta || a.s - b.s || a.i - b.i)
  const taken = new Set<object>()
  const pooled: { key: string; delta: number; spectra: number; localized: number; unlocalized: number; tables: number }[] = []
  for (const seed of seeds) {
    if (taken.has(seed)) continue
    const g = rows.filter((r) => !taken.has(r) && Math.abs(r.delta - seed.delta) <= 0.004 + 1e-9)
    if (!g.includes(seed)) g.push(seed)
    for (const r of g) taken.add(r)
    pooled.push({
      key: seed.key,
      delta: seed.delta,
      spectra: g.reduce((n, r) => n + r.spectra, 0),
      localized: g.reduce((n, r) => n + r.localized, 0),
      unlocalized: g.reduce((n, r) => n + r.unlocalized, 0),
      tables: new Set(g.map((r) => r.s)).size
    })
  }
  return { pooled, unshifted }
}

const grid = (page: Page) => page.getByRole('grid', { name: 'Mass shifts by residue' })
const cellsOf = async (page: Page, row: number): Promise<string[]> => (await grid(page).getByRole('row').nth(row).getByRole('gridcell').allInnerTexts()).map((s) => s.trim())
const en = (n: number): string => n.toLocaleString('en-US')

/// The first table opened through Open report…, the others in the mock's
/// files and picked by the next Add tables….
async function openPool(page: Page, files: { path: string; text: string }[], fixture = 'gate-recon'): Promise<void> {
  await openApp(page, fixture)
  await page.evaluate((fs) => {
    const m = (window as unknown as { __fastagE2E: { mock: { reportFiles: Record<string, string>; nextPickReport: string; nextPickFiles: string[] } } }).__fastagE2E.mock
    for (const f of fs) m.reportFiles[f.path] = f.text
    m.nextPickReport = fs[0].path
    m.nextPickFiles = fs.slice(1).map((f) => f.path)
  }, files)
  await goTo(page, 'Results')
  await page.getByRole('button', { name: 'Open report…' }).click()
  await page.getByRole('button', { name: 'By residue' }).click()
  await expect(grid(page)).toBeVisible()
}

test('Pooled: four lens tables, rows and sums as the files pool them', async ({ page }) => {
  const o = oracle(LENS)
  await openPool(page, LENS)
  const chart = page.locator('.recon-view .mg-chart')
  await expect(chart).toBeVisible()
  await page.getByRole('button', { name: 'Add tables…' }).click()
  const files = page.locator('.pool-files')
  await expect(files).toHaveText('4 mass-shift tables')
  // The gap chart and its caption show the opened run only: hidden while pooled.
  await expect(chart).toHaveCount(0)
  await expect(page.locator('.recon-view .chart-hidden')).toHaveText(/^The gap chart is hidden while By residue pools 4 mass-shift tables/)
  // Back on the Mass-shift table (one run's rows) the chart is there; By residue is still pooled.
  await page.getByRole('button', { name: 'Mass-shift table', exact: true }).click()
  await expect(chart).toBeVisible()
  await page.getByRole('button', { name: 'By residue' }).click()
  await expect(chart).toHaveCount(0)
  await expect(files).toHaveAttribute('title', LENS.map((f) => f.path).join('\n'))
  await expect(page.locator('.recon-tables .unshifted-note')).toHaveText(`${en(o.unshifted)} spectra with a gap under 0.5 Da (no shift) not listed.`)
  await page.getByRole('spinbutton', { name: 'Localized at least' }).fill('0')
  await expect(grid(page)).toHaveAttribute('aria-rowcount', String(o.pooled.length + 1))
  const spectra = o.pooled.reduce((n, r) => n + r.spectra, 0)
  await expect(page.locator('.recon-tables .report-sum')).toContainText(`with ${en(spectra)} spectra: ${en(o.pooled.reduce((n, r) => n + r.localized, 0))} localized`)
  // Most spectra first: the top rows as the oracle pools them.
  const top = [...o.pooled].sort((a, b) => b.spectra - a.spectra || a.delta - b.delta)
  for (let k = 0; k < 5; k++) {
    const c = await cellsOf(page, k + 1)
    expect([c[0], c[2], c[3], c[4], c[5]]).toEqual([top[k].key, String(top[k].tables), en(top[k].spectra), en(top[k].localized), en(top[k].unlocalized)])
  }
  // The oxidation row is in all four runs, under its pooled name.
  const ox = grid(page).getByRole('row').filter({ hasText: /Oxidation@M/ }).first()
  await expect(ox.getByRole('gridcell').nth(2)).toHaveText('4')
  // Back to the one table.
  await page.getByRole('button', { name: 'This table only' }).click()
  await expect(files).toHaveCount(0)
  await expect(chart).toBeVisible()
  await expect(page.locator('.recon-view .chart-hidden')).toHaveCount(0)
  await expect(grid(page).getByRole('columnheader', { name: /^Tables/ })).toHaveCount(0)
})

test('Pooled: Export matrix… writes the matrix shown and the sources beside it', async ({ page }) => {
  const o = oracle(LENS.slice(0, 3))
  await openPool(page, LENS.slice(0, 3))
  await page.getByRole('button', { name: 'Add tables…' }).click()
  await expect(page.locator('.pool-files')).toHaveText('3 mass-shift tables')
  await page.getByRole('spinbutton', { name: 'Localized at least' }).fill('20')
  await page.evaluate(() => {
    ;(window as unknown as { __fastagE2E: { mock: { nextPickOutput: string } } }).__fastagE2E.mock.nextPickOutput = '/data/lens.by_residue.csv'
  })
  await page.getByRole('button', { name: 'Export matrix…' }).click()
  await expect(page.getByText(/listed in \/data\/lens\.by_residue\.sources\.csv\./)).toBeVisible()
  const writes = await mockState<{ dest: string; text: string }[]>(page, 'summaryWrites')
  expect(writes.map((w) => w.dest)).toEqual(['/data/lens.by_residue.csv', '/data/lens.by_residue.sources.csv'])
  const [head, ...rows] = writes[0].text.trim().split('\n').map((l) => l.split(','))
  expect(head.slice(0, 7)).toEqual(['delta', 'name', 'tables', 'spectra', 'localized', 'unlocalized', 'localized_pct'])
  const want = o.pooled.filter((r) => r.localized >= 20).sort((a, b) => b.spectra - a.spectra || a.delta - b.delta)
  expect(rows.map((r) => [r[0], r[2], r[3], r[4]])).toEqual(want.map((r) => [r.key, String(r.tables), String(r.spectra), String(r.localized)]))
  expect(writes[1].text.split('\n')[0]).toBe('source,shift_rows,shift_spectra,unshifted_rows,unshifted_spectra,delta_group')
  expect(writes[1].text.trim().split('\n').slice(1).map((l) => l.split(',')[0])).toEqual(LENS.slice(0, 3).map((f) => f.path))
})

test('Pooled: 200 synthetic tables stay responsive', async ({ page }) => {
  // 700 rows each, as a lens run's table: a 0 Da row, gaps on a 0.6 Da grid with jitter.
  let seed = 11
  const rnd = (): number => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
  const head = 'delta\tspectra\ttop_interps\tlocalized\tresidues\tunlocalized\tunimod\tpsimod\tisotope_error'
  const files = Array.from({ length: 200 }, (_, k) => {
    const lines = [head, '0.0000\t1800\t?:14\t13\tC-term|K:9,C-term|R:4\t1\t-\t-\t-']
    for (let i = 0; i < 700; i++) {
      const loc = Math.floor(rnd() * 4)
      lines.push(`${(1 + i * 0.6 + Math.floor(rnd() * 3) * 0.0005).toFixed(4)}\t${loc + 2}\t?:${loc + 2}\t${loc}\t${loc ? `${'MKNQS'[i % 5]}:${loc}` : '-'}\t2\t-\t-\t-`)
    }
    return { path: `/runs/run${String(k).padStart(3, '0')}.delta.tsv`, text: lines.join('\n') + '\n' }
  })
  await openPool(page, files)
  // The longest gap between two frames while the tables are read and pooled.
  await page.evaluate(() => {
    const w = window as unknown as { __gap: number; __stop: boolean }
    w.__gap = 0
    w.__stop = false
    let last = performance.now()
    const tick = (now: number): void => {
      w.__gap = Math.max(w.__gap, now - last)
      last = now
      if (!w.__stop) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  const t0 = Date.now()
  await page.getByRole('button', { name: 'Add tables…' }).click()
  await expect(page.locator('.pool-files')).toHaveText('200 mass-shift tables', { timeout: 20_000 })
  const ms = Date.now() - t0
  const gap = await page.evaluate(() => {
    const w = window as unknown as { __gap: number; __stop: boolean }
    w.__stop = true
    return w.__gap
  })
  test.info().annotations.push({ type: 'timing', description: `200 tables pooled in ${ms} ms; longest frame gap ${gap.toFixed(0)} ms` })
  console.info(`200 synthetic tables: pooled in ${ms} ms, longest frame gap ${gap.toFixed(0)} ms`)
  await expect(page.locator('.recon-tables .unshifted-note')).toHaveText('360,000 spectra with a gap under 0.5 Da (no shift) not listed.')
  expect(ms).toBeLessThan(15_000)
  expect(gap).toBeLessThan(1_000)
})

test('Pooled screenshots: every lens table in LENS_DIR, light and dark', async ({ page }, info) => {
  const dir = process.env.LENS_DIR
  test.skip(!dir || !process.env.SHOT_DIR || info.project.name !== 'chromium', 'LENS_DIR and SHOT_DIR name the tables and the output (Chromium)')
  test.setTimeout(120_000)
  const files = readdirSync(dir!)
    .filter((f) => f.endsWith('.delta.tsv'))
    .sort()
    .map((f) => ({ path: `/data/PXD045734/${f}`, text: readFileSync(`${dir}/${f}`, 'utf8') }))
  // The app as it is: the Mass shifts tab takes the window's width.
  await page.setViewportSize({ width: 1800, height: 1300 })
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await openPool(page, files)
    await page.getByRole('button', { name: 'Add tables…' }).click()
    await expect(page.locator('.pool-files')).toHaveText(`${files.length} mass-shift tables`, { timeout: 60_000 })
    await page.getByRole('spinbutton', { name: 'Localized at least' }).fill('100')
    await page.getByRole('checkbox', { name: /Hide empty residue columns/ }).uncheck()
    // From the line that says the one-run chart is hidden, down to the matrix.
    await page.locator('.recon-view .chart-hidden').evaluate((e) => e.scrollIntoView({ block: 'start' }))
    await page.screenshot({ path: `${process.env.SHOT_DIR}/pooled-matrix-${scheme}.png` })
  }
})
