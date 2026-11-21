// The workflow Setup in a real browser (doc/GUI-WORKFLOWS.md): the cold start
// reaches Run in two actions, the seven workflows, the five cards, the
// Outputs checklist and its wiring, the run bar's plan with Export INI,
// Reset in the Workflow card, presets saved as diffs, Batch as an input
// mode; screenshots of Setup at both window sizes in both themes, kept as
// test artifacts.
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
    'Export tags', 'Run QC', 'Mass-shift survey', 'Species', 'Database reduction', 'Identifiability triage', 'Characterize a run'
  ])
  await expect(page.getByRole('radio', { name: /^Export tags/ })).toBeChecked()
  await expect(page.locator('.task-blurb-line')).toContainText('per-residue confidence')
  await expect(page.locator('.step-card > .card-head h2')).toHaveText(['Input', 'Workflow', 'Settings', 'Outputs', 'Advanced (0 changed)'])
  await expect(page.locator('details.advanced')).not.toHaveAttribute('open', '')
  await expect(plan(page)).toContainText('all spectra')
  // 1: the input. 2: Run.
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

test('Export tags after Characterize leaves the Species tab for the requested tags; Open earlier results… opens a table', async ({ page }) => {
  await openApp(page, 'gate')
  await page.getByRole('radio', { name: /^Characterize a run/ }).check()
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: /^Species/ }).click()

  await goTo(page, 'Setup')
  await page.getByRole('radio', { name: /^Export tags/ }).check()
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
  await page.getByRole('button', { name: 'Open earlier results…' }).click()
  await expect(page.getByRole('heading', { name: 'previous.tags.tsv' })).toBeVisible()
  expect(await mockState<RunCall[]>(page, 'runCalls')).toHaveLength(2)
})

test('Mass-shift survey: the database is required, and the placements cannot be unchecked while the mass-shift table needs them', async ({ page }) => {
  await openApp(page)
  await page.getByRole('radio', { name: /^Mass-shift survey/ }).check()
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await expect(page.locator('#card-settings')).toContainText('Protein database')
  await expect(page.locator('#card-settings .badge.todo')).toHaveText('required')
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled()
  await expect(page.locator('.runbar')).toContainText('The placements need a protein database')
  await expect(page.locator('#out-recon_out')).toBeDisabled()
  await expect(page.locator('#out-recon_out-d')).toContainText('needed by Mass-shift table')
  await expect(page.locator('#card-outputs')).toContainText('run01.delta.tsv')
  await page.locator('#p-recon_fasta').fill('/data/human.fasta')
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled()
  // Unchecking the mass-shift table frees the placements.
  await page.locator('#out-delta_spectra_out').uncheck()
  await page.locator('#out-delta_counts_out').uncheck()
  await page.locator('#out-delta_out').uncheck()
  await expect(page.locator('#out-recon_out')).toBeEnabled()
})

test('the workflow row counts what differs, and Reset takes it back', async ({ page }) => {
  await openApp(page)
  await page.getByRole('radio', { name: /^Characterize a run/ }).check()
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await expect(plan(page)).toContainText('Characterize a run on run01.mzML · 4 reports · 10% of spectra')
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
      await page.getByRole('button', { name: 'Choose file…' }).click()
      const size = await page.evaluate(() => ({ w: document.scrollingElement!.scrollWidth, h: document.scrollingElement!.scrollHeight }))
      expect(size.w).toBeLessThanOrEqual(w)
      expect(size.h).toBeLessThanOrEqual(h)
      // The footer and Run stay on screen below the cards.
      await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeInViewport()
      await expect(plan(page)).toBeInViewport()
      await page.screenshot({ path: info.outputPath(`setup-${w}x${h}-${scheme}.png`) })
    }
  })
}

test('arrowing through the workflows by keyboard keeps the edits for Undo', async ({ page }) => {
  await openApp(page)
  await page.locator('#p-tag_length').fill('5')
  // The native radio group selects on each arrow key: two workflows replace
  // the form in turn, and Undo still brings back the edited values.
  await page.getByRole('radio', { name: /^Export tags/ }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('radio', { name: /^Run QC/ })).toBeChecked()
  await expect(page.locator('#p-tag_length')).toHaveCount(0)
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('radio', { name: /^Export tags/ })).toBeChecked()
  await expect(page.locator('#p-tag_length')).toHaveValue('3')
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('#p-tag_length')).toHaveValue('5')
  await expect(page.getByRole('radio', { name: /^Export tags/ })).toBeChecked()
})

test('Batch is an input mode: Add files/folder, an output folder and an optional SDRF, no run name', async ({ page }) => {
  await openApp(page)
  await page.getByRole('radio', { name: /^Characterize a run/ }).check()
  await page.getByRole('radio', { name: 'Batch' }).check()
  await expect(page.getByRole('button', { name: 'Choose file…' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add files…' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add folder…' })).toBeVisible()
  await expect(page.getByText('SDRF file (optional)')).toBeVisible()
  await expect(page.locator('#card-input')).toContainText('beside each input file')
  await expect(page.locator('#out-name')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Or choose one file…' })).toHaveCount(0)
})
