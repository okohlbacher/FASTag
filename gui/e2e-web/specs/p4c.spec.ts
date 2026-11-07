// The P4c viewers in a real browser (GUI-DESIGN S7, S8, 9 layer 3, 10 P4):
// Mass gaps & recon and Glyco on the real CLI output of the PXD014764 recon
// run and the E. coli recon run (src/fixtures/cli), checked against oracles
// recomputed here from the files with no GUI code; the keyboard in the
// chart and the tables; the table view; dark mode; the empty state's run.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect, goTo, mockState, openApp } from './fixtures'

const CLI = fileURLToPath(new URL('../../src/fixtures/cli/', import.meta.url))
const read = (c: string, f: string): string => readFileSync(`${CLI}${c}/${f}`, 'utf8')
const body = (t: string): string[][] => t.trim().split('\n').slice(1).map((l) => l.split('\t'))
const en = (n: number): string => n.toLocaleString('en-US')

function oracle(c: string) {
  const recon = body(read(c, 'run.recon.tsv'))
  const delta = body(read(c, 'run.delta.tsv'))
  const glyco = body(read(c, 'run.tags.glyco.tsv'))
  const log = /^Glyco: (\d+) of (\d+) processed/m.exec(read(c, 'run.log'))!
  const placed = Number(body(read(c, 'run.massgap.tsv')).find((r) => r[0] === 'cys' && r[1] === 'spectra')![2])
  return {
    placements: recon.length,
    spectra: new Set(recon.map((r) => r[0])).size,
    gapped: recon.filter((r) => r[6] !== r[7]).length,
    deltaRows: delta.length,
    deltaSum: delta.reduce((n, r) => n + Number(r[1]), 0),
    placed,
    glycoRows: glyco.length,
    flagged: glyco.filter((r) => r[3] === '1').length,
    logFlagged: Number(log[1]),
    logOf: Number(log[2])
  }
}

async function runOn(page: Page, fixture: string): Promise<void> {
  await openApp(page, fixture)
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.getByRole('button', { name: 'Run on run01.mzML' }).click()
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
}

const stat = (page: Page, label: string) => page.locator('.recon-view .stat', { has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd')

test('Mass gaps & recon: figures equal the oracles of the PXD014764 recon run', async ({ page }) => {
  const o = oracle('v112-pxd014764-delta-ext3')
  expect(o.deltaSum).toBe(o.placed) // the histogram counts each placed spectrum once
  await runOn(page, 'gate-recon')
  await page.getByRole('tab', { name: 'Mass gaps & recon' }).click()
  await expect(stat(page, 'Placed spectra')).toHaveText(en(o.placed))
  await expect(stat(page, 'Placements')).toHaveText(en(o.placements))
  await expect(stat(page, 'Spectra with a placement')).toHaveText(en(o.spectra))
  await expect(stat(page, 'Gap peaks')).toHaveText(en(o.deltaRows))
  // Enough placed spectra: no warning.
  await expect(page.locator('.recon-view .banner.warn')).toHaveCount(0)
  const grid = page.getByRole('grid', { name: 'Placements' })
  await expect(grid).toHaveAttribute('aria-rowcount', String(o.placements + 1))
  await page.getByRole('checkbox', { name: /One flank off/ }).check()
  await expect(page.locator('.dt-count').first()).toHaveText(`${en(o.gapped)} of ${en(o.placements)} rows · showing 1–100`)
  // The shared table: the gap peaks.
  await page.getByRole('button', { name: 'Gap peaks', exact: true }).click()
  await expect(page.getByRole('grid', { name: 'Gap peaks' })).toHaveAttribute('aria-rowcount', String(o.deltaRows + 1))
})

test('the mass-gap chart: thin sticks, Unimod marks, legend, hover and keyboard tooltips, and a table view', async ({ page }) => {
  await runOn(page, 'gate-recon')
  await page.getByRole('tab', { name: 'Mass gaps & recon' }).click()
  const chart = page.locator('.mg-chart')
  await expect(chart.locator('.mg-stick')).not.toHaveCount(0)
  // Thin marks: 2 px sticks; hairline marks.
  expect(await chart.locator('.mg-stick').first().evaluate((e) => getComputedStyle(e).strokeWidth)).toBe('2px')
  expect(await chart.locator('.mg-mark').first().evaluate((e) => getComputedStyle(e).strokeWidth)).toBe('1px')
  await expect(chart.getByRole('list', { name: 'Legend' })).toContainText('Spectra per gap peak')
  await expect(chart.getByRole('list', { name: 'Legend' })).toContainText(/Unimod delta at a gap peak \(\d+\)/)
  await expect(chart.locator('.mg-label')).toContainText(['+10.009 Label:13C(6)15N(4)'])
  // Hover a stick: a tooltip with its count.
  const box = (await chart.locator('svg').boundingBox())!
  const stick = chart.locator('.mg-stick.cut').first()
  const x = Number(await stick.getAttribute('x1'))
  await page.mouse.move(box.x + (x / 800) * box.width, box.y + box.height * 0.6)
  await expect(chart.getByRole('tooltip')).toContainText('139 spectra')
  await page.mouse.move(box.x + 2, box.y + 2)
  await expect(chart.getByRole('tooltip')).toHaveCount(0)
  // Keyboard: focus the plot, Home, then step right.
  const plot = chart.getByRole('group', { name: /^Mass-gap chart:/ })
  await plot.focus()
  await page.keyboard.press('Home')
  await expect(chart.getByRole('tooltip')).toBeVisible()
  const first = await chart.getByRole('tooltip').textContent()
  await page.keyboard.press('ArrowRight')
  await expect(chart.getByRole('tooltip')).not.toHaveText(first!)
  await expect(chart.locator('.mg-stick.on')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(chart.getByRole('tooltip')).toHaveCount(0)
  // Unimod marks off and on.
  await page.getByRole('checkbox', { name: 'Unimod marks' }).uncheck()
  await expect(chart.locator('.mg-mark')).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Unimod marks' }).check()
  // The table view has every value.
  await chart.getByRole('button', { name: 'Table' }).click()
  const t = chart.getByRole('grid', { name: 'Gap peaks' })
  await expect(t).toHaveAttribute('aria-rowcount', '274')
  await expect(t.getByRole('row').nth(1)).toContainText('0.0000')
  await expect(t.getByRole('row', { name: /^10\.0090/ })).toContainText('Label:13C(6)15N(4) (R)')
})

test('the shared table by keyboard: arrows, Page Down, End and Home move the active row across pages', async ({ page }) => {
  const o = oracle('v112-pxd014764-delta-ext3')
  await runOn(page, 'gate-recon')
  await page.getByRole('tab', { name: 'Mass gaps & recon' }).click()
  const grid = page.getByRole('grid', { name: 'Placements' })
  await grid.focus()
  const active = grid.locator('tr[aria-selected="true"]')
  await expect(active).toHaveAttribute('aria-rowindex', '2')
  await page.keyboard.press('ArrowDown')
  await expect(active).toHaveAttribute('aria-rowindex', '3')
  await page.keyboard.press('PageDown')
  await expect(active).toHaveAttribute('aria-rowindex', '23')
  await page.keyboard.press('End')
  await expect(active).toHaveAttribute('aria-rowindex', String(o.placements + 1))
  // Never more than one page of rows in the DOM.
  expect(await grid.locator('tbody tr').count()).toBeLessThanOrEqual(100)
  await expect(grid).toHaveAttribute('aria-activedescendant', (await active.getAttribute('id'))!)
  await page.keyboard.press('Home')
  await expect(active).toHaveAttribute('aria-rowindex', '2')
  // Sort by the gap from its header, by keyboard.
  await page.getByRole('button', { name: /^Δ mass \(Da\)/ }).first().focus()
  await page.keyboard.press('Enter')
  await expect(grid.getByRole('columnheader', { name: /Δ mass/ })).toHaveAttribute('aria-sort', 'ascending')
})

test('Glyco: flagged of processed equals the log line, flagged rows by fraction, keyboard rows', async ({ page }) => {
  const o = oracle('v112-pxd014764-delta-ext3')
  expect([o.flagged, o.glycoRows]).toEqual([o.logFlagged, o.logOf])
  await runOn(page, 'gate-recon')
  await page.getByRole('tab', { name: 'Glyco' }).click()
  await expect(page.locator('.glyco-view .stat.big dd')).toContainText(`${en(o.flagged)} of ${en(o.glycoRows)} processed MS2 spectra`)
  const grid = page.getByRole('grid', { name: 'Glyco spectra' })
  await expect(grid).toHaveAttribute('aria-rowcount', String(o.flagged + 1))
  await grid.focus()
  await page.keyboard.press('ArrowDown')
  await expect(grid.locator('tr[aria-selected="true"]')).toHaveAttribute('aria-rowindex', '3')
  await page.getByRole('checkbox', { name: 'Flagged only' }).uncheck()
  await expect(grid).toHaveAttribute('aria-rowcount', String(o.glycoRows + 1))
})

test('E. coli recon run: -recon_localize columns, the mzTab identifications, and the too-few warning', async ({ page }) => {
  const o = oracle('v1111-ecoli-recon-loc')
  const psm = read('v1111-ecoli-recon-loc', 'run.recon.mzTab').split('\n').filter((l) => l.startsWith('PSM\t')).length
  await runOn(page, 'gate-recon-loc')
  await page.getByRole('tab', { name: 'Mass gaps & recon' }).click()
  await expect(page.locator('.recon-view .banner.warn')).toContainText(`Only ${o.placed} spectra are placed with a mass gap`)
  const grid = page.getByRole('grid', { name: 'Placements' })
  await expect(grid).toHaveAttribute('aria-rowcount', String(o.placements + 1))
  await expect(grid.getByRole('columnheader', { name: /Site score/ })).toBeVisible()
  await page.getByRole('button', { name: 'Identifications (mzTab)' }).click()
  await expect(page.getByRole('grid', { name: 'Identifications' })).toHaveAttribute('aria-rowcount', String(psm + 1))
  await expect(page.getByText(/NOT FDR-controlled/)).toBeVisible()
})

test('no FASTA: the empty state offers the FASTA and runs with extension 3 and the three reports', async ({ page }) => {
  await runOn(page, 'gate')
  await page.getByRole('tab', { name: 'Mass gaps & recon' }).click()
  await expect(page.getByRole('heading', { name: 'No mass gaps yet' })).toBeVisible()
  await page.evaluate(() => {
    ;(window as unknown as { __fastagE2E: { mock: { nextPickInput: string } } }).__fastagE2E.mock.nextPickInput = '/db/human.fasta'
  })
  await page.getByRole('button', { name: 'Choose a FASTA and run again' }).click()
  await expect.poll(async () => (await mockState<unknown[]>(page, 'runCalls')).length).toBe(2)
  const calls = await mockState<{ params: Record<string, unknown> }[]>(page, 'runCalls')
  const p = calls[1].params
  expect(p.recon_fasta).toBe('/db/human.fasta')
  expect(p.extension).toBe('3')
  for (const k of ['recon_out', 'delta_out', 'massgap_out']) expect(String(p[k])).toMatch(new RegExp(`/data/.*${k.replace('_out', '')}\\.tsv$`))
})

test('Open report… opens a delta table in Mass gaps & recon', async ({ page }) => {
  await openApp(page, 'gate-recon')
  await page.evaluate(() => {
    ;(window as unknown as { __fastagE2E: { mock: { nextPickReport: string } } }).__fastagE2E.mock.nextPickReport = '/data/run01.delta.tsv'
  })
  await goTo(page, 'Results')
  await page.getByRole('button', { name: 'Open a digest, label or mass-gap report…' }).click()
  await expect(page.getByRole('tab', { name: 'Mass gaps & recon' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('grid', { name: 'Gap peaks' })).toHaveAttribute('aria-rowcount', '274')
  await expect(page.locator('.mg-stick')).not.toHaveCount(0)
})

test('dark mode is its own: the chart and table take the dark tokens, the numbers stay', async ({ page }, info) => {
  const look: Record<string, { stick: string; mark: string; grid: string; text: string }> = {}
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await runOn(page, 'gate-recon')
    await page.getByRole('tab', { name: 'Mass gaps & recon' }).click()
    const chart = page.locator('.mg-chart')
    await expect(chart.locator('.mg-stick')).not.toHaveCount(0)
    look[scheme] = {
      stick: await chart.locator('.mg-stick').first().evaluate((e) => getComputedStyle(e).stroke),
      mark: await chart.locator('.mg-mark').first().evaluate((e) => getComputedStyle(e).stroke),
      grid: await chart.locator('.mg-grid line').first().evaluate((e) => getComputedStyle(e).stroke),
      text: (await page.locator('.recon-view .headline').textContent()) ?? ''
    }
    await page.screenshot({ path: info.outputPath(`p4c-recon-${scheme}.png`), fullPage: true })
  }
  // The --brand-peaks and --flag pairs of the token table (GUI-DESIGN 4).
  expect(look.light.stick).toBe('rgb(95, 104, 120)')
  expect(look.dark.stick).toBe('rgb(147, 156, 171)')
  expect(look.light.mark).toBe('rgb(181, 109, 0)')
  expect(look.dark.mark).toBe('rgb(247, 178, 59)')
  expect(look.dark.grid).not.toBe(look.light.grid)
  expect(look.dark.text).toBe(look.light.text)
})

test('a dropped recon table and glyco report open in their tabs', async ({ page }) => {
  await openApp(page, 'gate-recon')
  await page.evaluate(() => {
    ;(window as unknown as { __fastagE2E: { drop(r: unknown): void } }).__fastagE2E.drop({
      reports: [
        { kind: 'recon', path: '/data/run01.recon.tsv' },
        { kind: 'glyco', path: '/data/run01.tags.glyco.tsv' }
      ]
    })
  })
  await expect(page.getByRole('tab', { name: 'Glyco' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('grid', { name: 'Glyco spectra' })).toBeVisible()
  await page.getByRole('tab', { name: 'Mass gaps & recon' }).click()
  await expect(page.getByRole('grid', { name: 'Placements' })).toHaveAttribute('aria-rowcount', '4707')
  // No "no tab shows" note for them.
  await expect(page.getByText(/No tab shows/)).toHaveCount(0)
})
