// Feedback 20261124T073747Z_65cd1856: the Database hit column said only "In
// database". With -fasta the GUI asks for -fasta_proteins 3: the Tags and
// Spectrum tables name the protein and the tag's range, and the Spectrum
// tab aligns the tags that hit one protein uniquely on its residues. The
// `dbhit` fixture (src/testing/e2eBridge.ts) serves a real -fasta
// -fasta_proteins 3 run of the development CLI on the E. coli example
// (src/fixtures/cli-dev), and the qc_version 3 Run QC of PXD000001.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect, goTo, openApp, mockState } from './fixtures'

const TSV = readFileSync(fileURLToPath(new URL('../../src/fixtures/cli-dev/ecoli-fasta-proteins/run01.tags.tsv', import.meta.url)), 'utf8')
const COLS = TSV.split('\n')[0].split('\t')
const ROWS = TSV.trimEnd().split('\n').slice(1).map((l) => l.split('\t'))
const SCAN = 'controllerType=0 controllerNumber=1 scan=11539'

async function openTags(page: Page): Promise<void> {
  await openApp(page, 'dbhit')
  await goTo(page, 'Results')
  await page.getByRole('button', { name: 'Open tags…' }).click()
  await expect(page.getByText(`Showing ${ROWS.length} of ${ROWS.length}`)).toBeVisible()
}

for (const scheme of ['light', 'dark'] as const) {
  test(`the Tags table names the protein; the Spectrum tab aligns the tags on it (${scheme})`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme })
    await openTags(page)
    // Every Database hit cell names its protein and range, none says In database.
    const hitCol = (await page.locator('.rt-head [role=columnheader]').allTextContents()).findIndex((t) => t.startsWith('Database hit'))
    expect(hitCol).toBeGreaterThanOrEqual(0)
    const cells = page.locator('.rt-rows .rt-row').locator(`[role=gridcell]:nth-child(${hitCol + 1})`)
    await expect(cells.first()).toHaveText(/^VIMSS\d+@\d+–\d+$/)
    expect(await cells.allTextContents()).not.toContain('In database')
    // The db_* columns are in the Columns picker, hidden by default.
    await expect(page.locator('.rt-head [role=columnheader]', { hasText: 'Proteins (position)' })).toHaveCount(0)

    // Scan 11539: four tags, forward and reversed, all on VIMSS17368.
    const row = page.locator('.rt-rows .rt-row').filter({ has: page.locator(`[role=gridcell][title="${SCAN}"]`) }).first()
    await row.dblclick()
    await expect(page.getByRole('tab', { name: 'Spectrum' })).toHaveAttribute('aria-selected', 'true')
    const al = page.getByRole('region', { name: 'Alignment on the database' })
    const block = al.getByTestId('align-block')
    await expect(block).toHaveCount(1)
    await expect(block.locator('h4')).toContainText('VIMSS17368')
    await expect(block.locator('h4')).toContainText(`${ROWS.filter((r) => r[0] === SCAN).length} tags`)
    // Read from the run's -fasta.
    const calls = await mockState<{ path: string; identifier: string }[]>(page, 'fastaCalls')
    expect(calls.map((c) => [c.path, c.identifier])).toEqual([['/data/ecoli.fasta', 'VIMSS17368']])
    const lines = block.locator('.sp-al-row')
    await expect(lines).toHaveCount(1 + ROWS.filter((r) => r[0] === SCAN).length)
    await expect(block.getByText('reversed')).not.toHaveCount(0)
    // Each tag sits on the residues: its cells line up under the protein's.
    const x = async (k: number, pos: number): Promise<number> => (await lines.nth(k).locator('.sp-al-seq .sp-al-res').nth(pos).boundingBox())!.x
    expect(Math.abs((await x(0, 4)) - (await x(1, 4)))).toBeLessThan(0.5)
    // Nothing scrolls sideways at this width.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    // The Spectrum tags table names the protein too.
    const tags = page.getByRole('grid', { name: 'Tags of this spectrum' })
    await expect(tags.locator('tbody tr').first()).toContainText('VIMSS17368@')
    await block.scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath(`dbhit-spectrum-${scheme}.png`), fullPage: true })
    expect(COLS).toContain('db_protein_count')
  })

  test(`Run QC names one isobaric kit and counts each reporter channel (${scheme})`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme })
    await openApp(page, 'dbhit')
    await page.evaluate(() => {
      ;(window as unknown as { __fastagE2E: { mock: { nextPickReport: string } } }).__fastagE2E.mock.nextPickReport = '/data/run01.qc.tsv'
    })
    await goTo(page, 'Results')
    await page.getByRole('button', { name: 'Open report…' }).click()
    const kit = page.locator('.qc-strip .stat').filter({ has: page.locator('dt', { hasText: 'Isobaric kit' }) })
    await expect(kit.locator('dd').first()).toHaveText('TMT 6-plex')
    await page.screenshot({ path: info.outputPath(`dbhit-qc-chart-${scheme}.png`), fullPage: true })
    // The channels are a chart; its Table view is the channel table.
    await page.locator('figure', { hasText: 'each reporter channel' }).getByRole('button', { name: 'Table' }).click()
    const channels = page.getByRole('region', { name: 'Reporter channels' })
    await expect(channels.locator('tbody tr')).toHaveCount(11)
    await expect(channels.locator('tbody tr').first()).toContainText('4,658')
    await expect(page.getByText('Compatible isobaric kits')).toHaveCount(0)
    await page.screenshot({ path: info.outputPath(`dbhit-qc-${scheme}.png`), fullPage: true })
  })
}
