// The user documents against the window (suite-2, tags-6, tags-7, tags-8):
// each test reads the section of gui/README.md, doc/MANUAL.md or
// doc/GUI-WORKFLOWS.md that describes Setup, checks it names no control the
// window lacks, and finds the controls it names.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect, openApp, toStep } from './fixtures'

const doc = (f: string): string => readFileSync(fileURLToPath(new URL(`../../../${f}`, import.meta.url)), 'utf8')
const section = (text: string, from: string, to: string): string => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from) + from.length))

// Names of the 1.15 window that 1.16 does not have.
const STALE = ['Open results / inspect spectra', 'Fragment tolerance preset', 'Run on ', 'Batch QC', 'Reset…', 'extension 0', 'step cards', 'Starting from']

const TASKS = ['Generate tags', 'Run QC', 'Mass-shift survey', 'Species', 'Database reduction', 'Identifiability triage', 'Characterize a run']

test('gui/README.md, doc/MANUAL.md 1 and README.md name no control of the 1.15 window', () => {
  const readme = doc('gui/README.md')
  const parts = {
    'gui/README.md First run': section(readme, '## First run', '## Layout'),
    'gui/README.md The window': section(readme, '## The window', '## Inspector'),
    'doc/MANUAL.md 1': section(doc('doc/MANUAL.md'), '## 1.', '## 2.'),
    'README.md GUI': section(doc('README.md'), 'A **Glyco** tab lists', 'Light, dark and system themes')
  }
  for (const [where, text] of Object.entries(parts)) for (const s of STALE) expect.soft(text, `${where} says "${s}"`).not.toContain(s)
  for (const t of TASKS) expect.soft(parts['gui/README.md The window'], `gui/README.md names the task ${t}`).toContain(`**${t}**`)
  expect(doc('doc/GUI-WORKFLOWS.md'), 'doc/GUI-WORKFLOWS.md: W1 sets extension 3').toContain('| W1 | `res_conf true`, `extension 3`')
})

test('the controls the documents name for a first run are in the window', async ({ page }) => {
  await openApp(page)
  await toStep(page, 'Task')
  await expect(page.getByRole('heading', { name: 'What do you want to do?' })).toBeVisible()
  expect((await page.locator('button.task-tile .task-tile-label').allTextContents()).sort()).toEqual([...TASKS].sort())
  await expect(page.getByRole('button', { name: 'Open earlier results…' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Presets' }).locator('option', { hasText: 'Load FASTag defaults' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Continue with Generate tags ›' })).toBeVisible()
  await toStep(page, 'Inputs')
  await expect(page.getByRole('button', { name: 'Choose file…' })).toBeVisible()
  await expect(page.locator('#instrument option', { hasText: 'Ion trap CID 0.5 Da' })).toHaveCount(1)
  await expect(page.locator('label[for="instrument"]')).toHaveText('Instrument')
  await toStep(page, 'Settings')
  await expect(page.locator('#p-extension')).toHaveValue('3')
  await expect(page.getByRole('combobox', { name: 'Presets' }).locator('option', { hasText: 'Save as preset…' })).toHaveCount(1)
  await toStep(page, 'Outputs & run')
  const bar = page.locator('.view-setup .actionbar')
  await expect(bar.getByRole('button', { name: 'Run', exact: true })).toBeVisible()
  await expect(bar.getByRole('button', { name: 'Export INI…' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Change the output folder' })).toBeVisible()
  await expect(page.getByLabel('Run name')).toBeVisible()
})
