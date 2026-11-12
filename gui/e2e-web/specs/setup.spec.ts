// The Setup screen of P2a PR u in a real browser (GUI-DESIGN 9 layer 3, 10
// P2a): the cold start reaches Run in two actions, the task chooser, hidden
// dependent fields, the plan footer with its diff and Reset, Export INI, and
// presets saved as diffs; screenshots of Setup at both window sizes in both
// themes, kept as test artifacts.
import type { Page } from '@playwright/test'
import { test, expect, goTo, mockState, openApp } from './fixtures'

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
const section = (page: Page, title: string) => page.locator('summary.disclosure', { has: page.locator('.sec-title', { hasText: new RegExp(`^${title}$`) }) })

test('a cold start prioritizes Export tags and reaches all-spectra Tags results in two actions', async ({ page }) => {
  await openApp(page)
  await expect(page.locator('.tasks .task-label')).toHaveText([
    'Export tags', 'Open results / inspect spectra', 'Characterize a run', 'Batch QC vs SDRF'
  ])
  await expect(page.getByRole('radio', { name: /^Export tags/ })).toBeChecked()
  await expect(page.getByLabel('Preset', { exact: true })).toHaveValue('builtin:export-tags')
  await expect(page.locator('#task-export-tags-d')).toContainText('all spectra, with per-residue confidence')
  await expect(plan(page)).toContainText('all spectra')
  // 1: the input. 2: Run.
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.getByRole('button', { name: 'Run on run01.mzML' }).click()
  await expect(page.getByRole('tab', { name: 'Tags' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('Showing 2,028 of 2,028')).toBeVisible()
  const calls = await mockState<RunCall[]>(page, 'runCalls')
  expect(calls).toHaveLength(1)
  const p = calls[0].params
  expect(p.res_conf).toBe(true)
  expect([Number(p.subsample_fraction), Number(p.subsample_spectra)]).toEqual([0, 0])
  expect([p.species, p.glyco, p.digest_out, p.label_out]).toEqual([false, false, '', ''])
})

test('Export tags and Open results leave a previous Species tab for the requested tags', async ({ page }) => {
  await openApp(page, 'gate')
  await page.getByRole('radio', { name: /^Characterize a run/ }).check()
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.getByRole('button', { name: 'Run on run01.mzML' }).click()
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'Species' }).click()
  await expect(page.getByRole('tab', { name: 'Species' })).toHaveAttribute('aria-selected', 'true')

  await goTo(page, 'Setup')
  await page.getByRole('radio', { name: /^Export tags/ }).check()
  await page.getByRole('button', { name: 'Run on run01.mzML' }).click()
  await expect(page.getByRole('tab', { name: 'Tags' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: 'run01.tags.tsv' })).toBeVisible()
  await expect(page.getByText('Showing 2,028 of 2,028')).toBeVisible()
  const calls = await mockState<RunCall[]>(page, 'runCalls')
  expect(calls).toHaveLength(2)
  expect(calls[0].params.species).toBe(true)
  expect(calls[1].params).toMatchObject({ res_conf: true, species: false, digest_out: '', label_out: '' })

  await page.getByRole('tab', { name: 'Species' }).click()
  await goTo(page, 'Setup')
  await page.getByRole('radio', { name: /^Open results/ }).check()
  await setMock(page, 'nextPickResults', '/data/previous.tags.tsv')
  await page.getByRole('button', { name: 'Open results…' }).click()
  await expect(page.getByRole('tab', { name: 'Tags' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: 'previous.tags.tsv' })).toBeVisible()
  await expect(page.getByText('Showing 2,028 of 2,028')).toBeVisible()
  expect(await mockState<RunCall[]>(page, 'runCalls')).toHaveLength(2)
  expect(await mockState<string[]>(page, 'resultsOpenCalls')).toContain('/data/previous.tags.tsv')

  // Open results keeps the previous input, but neither Run shortcut may
  // start it while this task offers no Run control.
  await goTo(page, 'Setup')
  await page.keyboard.press('ControlOrMeta+Enter')
  expect(await mockState<RunCall[]>(page, 'runCalls')).toEqual(calls)
  await page.evaluate(() => {
    const app = (window as unknown as { __fastagE2E: { menu(action: string): void } }).__fastagE2E
    app.menu('view-setup') // reset action deduplication without changing task
    app.menu('run')
  })
  expect(await mockState<RunCall[]>(page, 'runCalls')).toEqual(calls)
  await expect(page.getByRole('button', { name: 'Open results…' })).toBeEnabled()
})

test('four step cards; a section switch hides the settings it turns on', async ({ page }) => {
  await openApp(page)
  await page.getByRole('radio', { name: /^Characterize a run/ }).check()
  await expect(page.locator('section.step-card .card-head h2')).toHaveText(['Spectra', 'Database & taxonomy', 'Tagging', 'Reports'])
  await section(page, 'Species detection').click()
  await expect(page.getByLabel(/^Species rank/)).toBeVisible()
  await page.locator('#p-species').uncheck()
  await expect(page.getByLabel(/^Species rank/)).toBeHidden()
  await expect(page.locator('#h-species')).toContainText('Turns on 11 settings.')
  await expect(page.locator('.step-card').nth(1).locator('.card-summary')).toHaveText('Species off · no FASTA selected (optional)')
})

test('the plan footer counts what differs from the task, and Reset takes it back', async ({ page }) => {
  await openApp(page)
  await page.getByRole('radio', { name: /^Characterize a run/ }).check()
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await expect(plan(page)).toContainText('1 file · 10% of spectra · species on · digest+label+glyco · out: beside input')
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
  expect(settings.presets['Mine']).toEqual({ v: 2, base: 'builtin:export-tags', diff: { tag_length: '4' } })
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
  await page.getByRole('radio', { name: /^Export tags/ }).focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('radio', { name: /^Open results/ })).toBeChecked()
  await expect(page.locator('#p-tag_length')).toHaveCount(0)
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('radio', { name: /^Characterize a run/ })).toBeChecked()
  await expect(page.locator('#p-tag_length')).toHaveValue('3')
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('#p-tag_length')).toHaveValue('5')
  await expect(page.getByRole('radio', { name: /^Export tags/ })).toBeChecked()
})

test('Batch QC asks for the files of a batch first', async ({ page }) => {
  await openApp(page)
  await page.getByRole('radio', { name: /^Batch QC/ }).check()
  await expect(page.getByRole('button', { name: 'Choose file…' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add files for a batch…' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Or choose one file…' })).toBeVisible()
})
