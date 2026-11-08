// P4 PR a (GUI-DESIGN 3 S5, 9 layer 3, 10 P4): the Spectrum tab. The
// `spectrum` fixture serves the real E. coli tags through browser.rs's view
// semantics and, for each spectrum, the real -dump_spectrum output of the
// G1 CLI for those tags (src/fixtures/cli/v112-ecoli-dump); the run record
// of the file names its input. `spectrum-1.11` is the same with a CLI that
// has no -dump_spectrum.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect, goTo, openApp, mockState } from './fixtures'

const TSV = readFileSync(fileURLToPath(new URL('../fixtures/ecoli.tags.tsv', import.meta.url)), 'utf8')
const ROWS = TSV.split('\n').filter(Boolean).slice(1).map((l) => l.split('\t'))
const TOTAL = ROWS.length.toLocaleString('en-US')
// The tagged spectra in file order (◀ ▶), and the tags of each.
const SPECTRA = [...new Set(ROWS.map((r) => r[0]))]
const count = (s: string): number => ROWS.filter((r) => r[0] === s).length

async function openTags(page: Page, fixture: 'spectrum' | 'spectrum-1.11'): Promise<void> {
  await openApp(page, fixture)
  await goTo(page, 'Results')
  await page.getByRole('button', { name: 'Open tags…' }).click()
  await expect(page.getByText(`Showing ${TOTAL} of ${TOTAL}`)).toBeVisible()
}

const firstRow = (page: Page) => page.locator('.rt-rows .rt-row').first()
const heading = (page: Page) => page.locator('.sp-head h2')

test('Enter on a row opens its spectrum: FASTag\'s processed peaks with the tag\'s ladder on them', async ({ page }) => {
  await openTags(page, 'spectrum')
  await expect(page.getByRole('tab', { name: 'Spectrum' })).toBeVisible()
  const spectrum = (await firstRow(page).locator('[role=gridcell]').first().getAttribute('title'))!
  const tag = (await firstRow(page).locator('[role=gridcell]').nth(1).getAttribute('title'))!
  await firstRow(page).click()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tab', { name: 'Spectrum' })).toHaveAttribute('aria-selected', 'true')
  await expect(heading(page)).toHaveText(spectrum)
  await expect(page.getByText(/FASTag's processed peaks/)).toBeVisible()
  // The dump of that spectrum on the recorded input, under the run's params.
  const calls = await mockState<{ input: string; nativeId: string; params: unknown }[]>(page, 'spectrumCalls')
  expect(calls[0]).toEqual({ input: '/data/run01.mzML', nativeId: spectrum, params: { threads: '1' } })
  // The opened tag's ladder, on the peaks: every position on a dumped peak
  // is drawn as a ladder peak.
  await expect(page.getByTestId('ladder')).toContainText(tag)
  const verdict = page.getByTestId('ladder-verdict')
  await expect(verdict).toHaveText(/^on \d+ of \d+ positions within the run's tolerance$/)
  const [, on] = /^on (\d+) of/.exec((await verdict.textContent())!)!
  await expect(page.locator('.sp-svg [data-peak=ladder]')).toHaveCount(Number(on))
  // The tags of this spectrum, every one on the peaks.
  const tags = page.getByRole('region', { name: 'Tags of this spectrum' })
  await expect(tags.getByRole('heading')).toContainText(`Tags of this spectrum (n=${count(spectrum)})`)
  await expect(tags.locator('tbody tr')).toHaveCount(count(spectrum))
  await expect(tags.getByText(/^not on the peaks/)).toHaveCount(0)
})

test('another tag redraws the ladder; zoom; ◀ ▶ walk the tagged spectra in file order', async ({ page }) => {
  await openTags(page, 'spectrum')
  await firstRow(page).click()
  await page.getByRole('button', { name: 'Open in Spectrum' }).click()
  await expect(page.getByTestId('ladder-verdict')).toBeVisible()
  const shown = (await heading(page).textContent())!
  const tags = page.getByRole('region', { name: 'Tags of this spectrum' })
  const second = tags.locator('tbody tr').nth(1)
  const tag = (await second.locator('td').first().textContent())!
  await second.click()
  await expect(second).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('ladder')).toContainText(`-ladder ${tag}`)
  // Zoom to the ladder narrows the m/z range; the whole spectrum restores it.
  const range = page.locator('.sp-plot-tools .hint')
  const whole = await range.textContent()
  await page.getByRole('button', { name: 'Zoom to ladder' }).click()
  await expect(range).not.toHaveText(whole!)
  await page.getByRole('button', { name: 'Whole spectrum' }).click()
  await expect(range).toHaveText(whole!)
  // ▶ then ◀ (by file order of the tagged spectra).
  const i = SPECTRA.indexOf(shown)
  if (i + 1 < SPECTRA.length) {
    await page.getByRole('button', { name: 'Next tagged spectrum' }).click()
    await expect(heading(page)).toHaveText(SPECTRA[i + 1])
    await expect(page.getByTestId('ladder-verdict')).toHaveText(/^on \d+ of/)
    await page.getByRole('button', { name: 'Previous tagged spectrum' }).click()
    await expect(heading(page)).toHaveText(shown)
  }
})

test('five spectra in a row: every tag of each on its peaks, walking ◀ or ▶', async ({ page }) => {
  await openTags(page, 'spectrum')
  await firstRow(page).click()
  await page.getByRole('button', { name: 'Open in Spectrum' }).click()
  // From wherever the best tag is, walk five spectra forward or back.
  const start = SPECTRA.indexOf((await heading(page).textContent())!)
  const dir = start + 5 < SPECTRA.length ? 1 : -1
  for (let k = 1; k <= 5; k++) {
    await page.getByRole('button', { name: dir > 0 ? 'Next tagged spectrum' : 'Previous tagged spectrum' }).click()
    const s = SPECTRA[start + dir * k]
    await expect(heading(page)).toHaveText(s)
    const tags = page.getByRole('region', { name: 'Tags of this spectrum' })
    await expect(tags.locator('tbody tr')).toHaveCount(count(s))
    await expect(page.getByTestId('ladder-verdict')).toHaveText(/^on \d+ of/)
    await expect(tags.getByText(/^not on the peaks/)).toHaveCount(0)
  }
})

test('with FASTag 1.11 (no -dump_spectrum): no Spectrum tab, and the row action says it needs 1.12', async ({ page }) => {
  await openTags(page, 'spectrum-1.11')
  await expect(page.getByRole('tab', { name: 'Tags' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Spectrum' })).toHaveCount(0)
  const action = page.getByRole('button', { name: 'Spectrum view needs FASTag 1.12 or later' })
  await expect(action).toBeVisible()
  await expect(action).toBeDisabled()
  await firstRow(page).click()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Spectrum view needs FASTag 1.12 or later.')).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Tags' })).toHaveAttribute('aria-selected', 'true')
  expect(await mockState<unknown[]>(page, 'spectrumCalls')).toEqual([])
})
