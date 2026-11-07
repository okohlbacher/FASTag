// The Setup screen of P2a PR u in a real browser (GUI-DESIGN 9 layer 3, 10
// P2a): the cold start reaches Run in two actions, the task chooser, hidden
// dependent fields, the plan footer with its diff and Reset, Export INI, and
// presets saved as diffs; screenshots of Setup at both window sizes in both
// themes, kept as test artifacts.
import type { Page } from '@playwright/test'
import { test, expect, mockState, openApp } from './fixtures'

interface RunCall {
  in: string
  out: string
  params: Record<string, unknown>
}

const setMock = (page: Page, key: string, value: unknown): Promise<void> =>
  page.evaluate(
    ([k, v]) => {
      const m = (window as unknown as { __fastagE2E: { mock: Record<string, unknown> } }).__fastagE2E.mock
      m[k as string] = v
    },
    [key, value] as const
  )
const plan = (page: Page) => page.getByRole('region', { name: 'Plan' })
const section = (page: Page, title: string) => page.locator('button.disclosure', { has: page.locator('.sec-title', { hasText: new RegExp(`^${title}$`) }) })

test('a cold start reaches Run in two actions, with the task it lands on', async ({ page }) => {
  await openApp(page)
  await expect(page.getByRole('radio', { name: /^Characterize a run/ })).toBeChecked()
  // 1: the input. 2: Run.
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.getByRole('button', { name: 'Run on run01.mzML' }).click()
  await expect(page.getByRole('tab', { name: /^Digest/ })).toHaveAttribute('aria-selected', 'true')
  const calls = await mockState<RunCall[]>(page, 'runCalls')
  expect(calls).toHaveLength(1)
  const p = calls[0].params
  expect([p.species, p.extension, p.glyco, p.subsample_fraction]).toEqual([true, '2', true, '0.1'])
  expect(String(p.digest_out)).toMatch(/run01\.digest\.tsv$/)
  expect(String(p.label_out)).toMatch(/run01\.label\.tsv$/)
})

test('four step cards; a section switch hides the settings it turns on', async ({ page }) => {
  await openApp(page)
  await expect(page.locator('section.step-card .card-head h2')).toHaveText(['Spectra', 'Database & taxonomy', 'Tagging', 'Reports'])
  await section(page, 'Species detection').click()
  await expect(page.getByLabel(/^Species rank/)).toBeVisible()
  await page.locator('#p-species').uncheck()
  await expect(page.getByLabel(/^Species rank/)).toBeHidden()
  await expect(page.locator('#h-species')).toContainText('Turns on 11 settings.')
  await expect(page.locator('.step-card').nth(1).locator('.card-summary')).toHaveText('Species off · FASTA none')
})

test('the plan footer counts what differs from the task, and Reset takes it back', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await expect(plan(page)).toContainText('1 file · species on · digest+label+glyco · out: beside input')
  await expect(plan(page)).toContainText('Same as Characterize a run')
  await page.locator('#p-tag_length').fill('4')
  await expect(plan(page)).toContainText('Differs from Characterize a run: 1')
  await plan(page).getByRole('button', { name: 'Reset to Characterize a run' }).click()
  await expect(page.locator('#p-tag_length')).toHaveValue('3')
  await expect(plan(page)).toContainText('Same as Characterize a run')
})

test('Export INI writes the request Run sends', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await setMock(page, 'nextPickOutput', '/data/run01.ini')
  await plan(page).getByRole('button', { name: 'Export INI…' }).click()
  await expect(plan(page).getByRole('status')).toHaveText('INI written: run01.ini. Run it with FASTag -ini run01.ini')
  await page.getByRole('button', { name: 'Run on run01.mzML' }).click()
  const exported = await mockState<{ params: RunCall; dest: string }[]>(page, 'exportIniCalls')
  const runs = await mockState<RunCall[]>(page, 'runCalls')
  expect(exported.map((e) => e.dest)).toEqual(['/data/run01.ini'])
  expect(exported[0].params).toEqual(runs[0])
})

test('a preset saves its diff over the task and no paths; Open results needs no run', async ({ page }) => {
  await openApp(page)
  await page.locator('#p-tag_length').fill('4')
  await page.getByRole('button', { name: 'Save…' }).click()
  await page.getByLabel('Preset name').fill('Mine')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const settings = await mockState<{ presets: Record<string, unknown> }>(page, 'settings')
  expect(settings.presets['Mine']).toEqual({ v: 2, base: 'builtin:characterize', diff: { tag_length: '4' } })
  await expect(plan(page)).toContainText('Same as preset Mine')
  await page.getByRole('radio', { name: /^Open results/ }).check()
  await expect(page.locator('#p-tag_length')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Open results…' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Run/ })).toHaveCount(0)
})

for (const [w, h] of [
  [960, 600],
  [1440, 900]
] as const) {
  test(`${w}x${h}: Setup in light and dark, no page scroll`, async ({ page }, info) => {
    await page.setViewportSize({ width: w, height: h })
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await openApp(page)
      await page.getByRole('button', { name: 'Choose file…' }).click()
      const size = await page.evaluate(() => ({ w: document.scrollingElement!.scrollWidth, h: document.scrollingElement!.scrollHeight }))
      expect(size.w).toBeLessThanOrEqual(w)
      expect(size.h).toBeLessThanOrEqual(h)
      // The footer and Run stay on screen below the cards.
      await expect(page.getByRole('button', { name: 'Run on run01.mzML' })).toBeInViewport()
      await expect(plan(page)).toBeInViewport()
      await page.screenshot({ path: info.outputPath(`setup-${w}x${h}-${scheme}.png`) })
    }
  })
}

test('arrowing through the tasks by keyboard keeps the edits for Undo', async ({ page }) => {
  await openApp(page)
  await page.locator('#p-tag_length').fill('5')
  // The native radio group selects on each arrow key: two tasks replace
  // the form in turn, and Undo still brings back the edited values.
  await page.getByRole('radio', { name: /^Characterize a run/ }).focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('radio', { name: /^Batch QC/ })).toBeChecked()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('radio', { name: /^Export tags/ })).toBeChecked()
  await expect(page.locator('#p-tag_length')).toHaveValue('3')
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('#p-tag_length')).toHaveValue('5')
  await expect(page.getByRole('radio', { name: /^Characterize a run/ })).toBeChecked()
})

test('Batch QC asks for the files of a batch first', async ({ page }) => {
  await openApp(page)
  await page.getByRole('radio', { name: /^Batch QC/ }).check()
  await expect(page.getByRole('button', { name: 'Choose file…' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add files for a batch…' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Or choose one file…' })).toBeVisible()
})
