// The Setup wizard in a real browser (doc/GUI-SETUP-WIZARD.md): the cold
// start reaches Run in three actions, the seven task tiles, the four steps,
// the Outputs checklist and its wiring, the run bar's plan with Export INI,
// Reset in Settings, presets saved as diffs, Batch as an input mode;
// screenshots of Setup at both window sizes in both themes, kept as test
// artifacts.
import type { Page } from '@playwright/test'
import { test, expect, goTo, mockState, openApp, chooseTask, toStep } from './fixtures'

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

test('a cold start selects Generate tags and reaches all-spectra Tags results in three actions', async ({ page }) => {
  await openApp(page)
  await expect(page.locator('button.task-tile .task-tile-label')).toHaveText([
    'Generate tags', 'Characterize a run', 'Species', 'Mass-shift survey', 'Database reduction', 'Run QC', 'Identifiability triage'
  ])
  await expect(page.locator('button.task-tile[data-task="export-tags"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#task-detail')).toContainText('confidence per residue')
  await expect(page.getByRole('navigation', { name: 'Setup steps' }).getByRole('button')).toHaveText(['1Task', '2Inputs', '3Settings', '4Outputs & run'])
  await expect(page.locator('details.advanced')).not.toHaveAttribute('open', '')
  // 1: Continue (a deliberate design change from two actions). 2: the input. 3: Run.
  await page.getByRole('button', { name: 'Continue with Generate tags ›' }).click()
  await expect(plan(page)).toContainText('all spectra')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Tags' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('Showing 2,028 of 2,028')).toBeVisible()
  const calls = await mockState<RunCall[]>(page, 'runCalls')
  expect(calls).toHaveLength(1)
  const p = calls[0].params
  expect(p.res_conf).toBe(true)
  expect(p.threads).toBe('0')
  expect([Number(p.subsample_fraction), Number(p.subsample_spectra)]).toEqual([0, 0])
  expect([p.species, p.glyco, p.digest_out, p.label_out]).toEqual([false, false, '', ''])
})

test('Generate tags after Characterize leaves the Species tab for the requested tags; Open earlier results… opens a table', async ({ page }) => {
  await openApp(page, 'gate')
  await chooseTask(page, 'Characterize a run')
  await toStep(page, 'Inputs')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: /^Species/ }).click()

  await goTo(page, 'Setup')
  await chooseTask(page, 'Generate tags')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Tags' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: 'run01.tags.tsv' })).toBeVisible()
  const calls = await mockState<RunCall[]>(page, 'runCalls')
  expect(calls).toHaveLength(2)
  expect(calls[0].params).toMatchObject({ species: true })
  // Off by default: the shipped proteome needs tags of 8+ residues.
  expect(calls[0].params.alkylation_out ?? '').toBe('')
  expect(calls[1].params).toMatchObject({ res_conf: true, species: false, digest_out: '', label_out: '' })

  await goTo(page, 'Setup')
  await setMock(page, 'nextPickResults', '/data/previous.tags.tsv')
  await toStep(page, 'Task')
  await page.getByRole('button', { name: 'Open earlier results…' }).click()
  await expect(page.getByRole('heading', { name: 'previous.tags.tsv' })).toBeVisible()
  expect(await mockState<RunCall[]>(page, 'runCalls')).toHaveLength(2)
})

test('Mass-shift survey: the database is required, and the placements cannot be unchecked while the mass-shift table needs them', async ({ page }) => {
  await openApp(page)
  await chooseTask(page, 'Mass-shift survey')
  await toStep(page, 'Inputs')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  // The database sits beside the spectra, in Inputs.
  await expect(page.locator('#step-2')).toContainText('Protein database')
  await expect(page.locator('#step-2 .badge.todo')).toHaveText('required')
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled()
  await expect(page.locator('.runbar')).toContainText('The placements need a protein database')
  await page.locator('.runbar').getByRole('button', { name: 'Go to Inputs' }).click()
  // The one step path: the Inputs heading takes focus.
  await expect(page.locator('#step-h-2')).toBeFocused()
  await toStep(page, 'Outputs & run')
  await expect(page.locator('#out-recon_out')).toBeDisabled()
  await expect(page.locator('#out-recon_out-d')).toContainText('needed by Mass-shift table')
  await expect(page.locator('#step-4')).toContainText('run01.delta.tsv')
  await toStep(page, 'Inputs')
  await page.locator('#p-recon_fasta').fill('/data/human.fasta')
  await toStep(page, 'Outputs & run')
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled()
  // Unchecking the mass-shift table frees the placements.
  await page.locator('#out-delta_spectra_out').uncheck()
  await page.locator('#out-delta_counts_out').uncheck()
  await page.locator('#out-delta_out').uncheck()
  await expect(page.locator('#out-recon_out')).toBeEnabled()
})

test('the workflow row counts what differs, and Reset takes it back', async ({ page }) => {
  await openApp(page)
  await chooseTask(page, 'Characterize a run')
  await toStep(page, 'Inputs')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await expect(plan(page)).toContainText('Characterize a run on run01.mzML · 4 reports · 10% of spectra')
  await toStep(page, 'Settings')
  await expect(page.locator('.origin-name')).toHaveText('Characterize a run')
  // Spectra to read is a select: All spectra, 10%, 25%, Custom.
  await page.locator('#p-subsample_fraction').selectOption({ label: '25%' })
  await expect(page.locator('.origin-name')).toContainText('(modified)')
  await page.getByRole('button', { name: 'Reset to Characterize a run' }).click()
  await expect(page.locator('#p-subsample_fraction')).toHaveValue('0.1')
  await expect(page.locator('.origin-name')).toHaveText('Characterize a run')
})

test('Export INI writes the request Run sends', async ({ page }) => {
  await openApp(page)
  await toStep(page, 'Inputs')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await setMock(page, 'nextPickOutput', '/data/run01.ini')
  await plan(page).getByRole('button', { name: 'Export INI…' }).click()
  await expect(plan(page).getByRole('status')).toHaveText('INI written: run01.ini. The command line runs it with FASTag -ini run01.ini')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  const exported = await mockState<{ params: RunCall; dest: string }[]>(page, 'exportIniCalls')
  const runs = await mockState<RunCall[]>(page, 'runCalls')
  expect(exported.map((e) => e.dest)).toEqual(['/data/run01.ini'])
  expect(exported[0].params).toEqual(runs[0])
})

test('a preset saves its diff over the workflow and no paths', async ({ page }) => {
  await openApp(page)
  await toStep(page, 'Settings')
  await page.locator('#p-tag_length').fill('4')
  await page.locator('#origin').selectOption('__save')
  await page.getByLabel('Preset name').fill('Mine')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const settings = await mockState<{ presets: Record<string, unknown> }>(page, 'settings')
  expect(settings.presets['Mine']).toEqual({ v: 2, base: 'builtin:export-tags', diff: { tag_length: '4' } })
  await expect(page.locator('.origin-name')).toHaveText('preset Mine')
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
      await toStep(page, 'Inputs')
      await page.getByRole('button', { name: 'Choose file…' }).click()
      const size = await page.evaluate(() => ({ w: document.scrollingElement!.scrollWidth, h: document.scrollingElement!.scrollHeight }))
      expect(size.w).toBeLessThanOrEqual(w)
      expect(size.h).toBeLessThanOrEqual(h)
      // The footer and Run stay on screen below the step.
      await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeInViewport()
      await expect(plan(page)).toBeInViewport()
      await page.screenshot({ path: info.outputPath(`setup-${w}x${h}-${scheme}.png`) })
    }
  })
}

test('arrowing through the tiles by keyboard browses them; only Continue replaces the form, and Undo brings the edits back', async ({ page }) => {
  await openApp(page)
  await toStep(page, 'Settings')
  await page.locator('#p-tag_length').fill('5')
  await toStep(page, 'Task')
  await page.locator('button.task-tile[data-task="export-tags"]').focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('button.task-tile[data-task="species"]')).toBeFocused()
  await expect(page.locator('#task-detail')).toContainText('Only the species, ranked at a rank you choose.')
  // Browsing changed nothing.
  await expect(page.locator('#p-tag_length')).toHaveValue('5')
  await expect(page.locator('button.task-tile[data-task="export-tags"]')).toHaveAttribute('aria-current', 'true')
  await page.keyboard.press('Enter')
  await expect(page.locator('button.task-tile[data-task="species"]')).toHaveAttribute('aria-current', 'true')
  await expect(page.locator('.carried')).toContainText('Replaced: 1 setting of Generate tags.')
  await page.locator('.carried').getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('#p-tag_length')).toHaveValue('5')
  await expect(page.locator('button.task-tile[data-task="export-tags"]')).toHaveAttribute('aria-current', 'true')
})

test('Batch is an input mode: Add files/folder, an output folder and an optional SDRF, no run name', async ({ page }) => {
  await openApp(page)
  await chooseTask(page, 'Characterize a run')
  await toStep(page, 'Inputs')
  await page.getByRole('radio', { name: 'Batch' }).check()
  await expect(page.getByRole('button', { name: 'Choose file…' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add files…' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add folder…' })).toBeVisible()
  await expect(page.getByText('SDRF file (optional)')).toBeVisible()
  await expect(page.locator('#step-2')).toContainText('beside each input file')
  await expect(page.locator('#out-name')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Or choose one file…' })).toHaveCount(0)
})

// C11: with Help open at 1024x700 the action bar has no room for the
// still-missing chip, the plan and Back/Run/Next in one row. The left group
// (chip and plan) takes its own row; nothing overlaps; the three buttons stay
// together in one row. A toast floats above the bar, never over Run.
test('the action bar wraps the plan above Back, Run and Next with Help open at 1024x700, and toasts sit above it', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 })
  await openApp(page)
  await chooseTask(page, 'Mass-shift survey')
  await page.getByRole('button', { name: 'Help', exact: true }).click()
  await expect(page.locator('#help-panel')).toBeVisible()
  const bar = page.locator('.view-setup .actionbar')
  await expect(bar.locator('.still-missing')).toBeVisible()
  await expect(plan(page)).toBeVisible()
  const box = async (sel: string) => (await bar.locator(sel).boundingBox())!
  const nav = await Promise.all(['button.back', 'button.run-btn', 'button.next'].map(box))
  const planButtons = await Promise.all(
    ['Copy command line', 'Export INI…'].map(async (name) => (await plan(page).getByRole('button', { name }).boundingBox())!)
  )
  const chip = await box('.still-missing')
  const hit = (a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  for (const n of nav) {
    for (const p of [...planButtons, chip]) expect(hit(n, p)).toBe(false)
  }
  // One row: the same top for Back, Run and Next, left to right.
  expect(Math.abs(nav[0].y - nav[1].y)).toBeLessThan(2)
  expect(Math.abs(nav[1].y - nav[2].y)).toBeLessThan(2)
  expect(nav[0].x + nav[0].width).toBeLessThanOrEqual(nav[1].x)
  expect(nav[1].x + nav[1].width).toBeLessThanOrEqual(nav[2].x)
  // The plan stays inside the bar, not drawn past its right edge.
  const barBox = (await bar.boundingBox())!
  for (const p of planButtons) expect(p.x + p.width).toBeLessThanOrEqual(barBox.x + barBox.width)

  // A finished run's toast over Setup: above the bar, not over Next or Run.
  await page.getByRole('button', { name: 'Close Help' }).click()
  await chooseTask(page, 'Generate tags')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await goTo(page, 'Setup')
  const toast = page.getByRole('status', { name: 'Run finished' })
  await expect(toast).toBeVisible()
  const t = (await toast.boundingBox())!
  const b2 = (await bar.boundingBox())!
  expect(t.y + t.height).toBeLessThanOrEqual(b2.y + 0.5)
})
