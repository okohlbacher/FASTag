// The Overview in a real browser (GUI-DESIGN 3 S3, 9 layer 3, 10 P2b): the
// figures and calls of a run, checked against oracles recomputed here from
// the real CLI output of the gate PXDs (src/fixtures/cli) with no GUI code,
// and "no FASTA, no alkylation call".
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect, goTo, mockState, openApp } from './fixtures'

const CLI = fileURLToPath(new URL('../../src/fixtures/cli/', import.meta.url))
const read = (c: string, f: string): string => readFileSync(`${CLI}${c}/${f}`, 'utf8')
// The rows of a long-form report: section, key, value, n.
const rows = (text: string): string[][] => text.trim().split('\n').slice(1).map((l) => l.split('\t'))
const cell = (text: string, sec: string, key: string, col = 2): string | undefined =>
  rows(text).find((r) => r[0] === sec && r[1] === key)?.[col]
const en = (n: number): string => n.toLocaleString('en-US')

// Oracles of one fixture, from its files alone.
function oracle(c: string) {
  const log = read(c, 'run.log')
  const sum = /^(\d+) MS2 spectra, (\d+) tags/m.exec(log)!
  const glyco = /^Glyco: (\d+) of (\d+) processed/m.exec(log)!
  const digest = read(c, 'run.digest.tsv')
  const label = read(c, 'run.label.tsv')
  const species = read(c, 'run.tags.species.tsv').trim().split('\n').slice(1).map((l) => l.split('\t'))
  return {
    ms2: Number(sum[1]),
    tags: Number(sum[2]),
    glyco: Number(glyco[1]),
    filtered: Number(cell(digest, 'count', 'tags_filtered')),
    protease: cell(digest, 'call', 'status') === 'call' ? cell(digest, 'call', 'model') : null,
    label: cell(label, 'label_call', 'status') === 'call' ? cell(label, 'label_call', 'label') : null,
    hasLabelCall: cell(label, 'label_call', 'status') != null,
    topGenus: species.find((r) => r[0] === 'genus')![2],
    massgap: existsSync(`${CLI}${c}/run.massgap.tsv`)
  }
}

const tile = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const value = (page: Page, name: string) => tile(page, name).locator('.tile-value')

async function characterize(page: Page, fixture: string): Promise<void> {
  await openApp(page, fixture)
  await expect(page.getByRole('radio', { name: /^Characterize a run/ })).toBeChecked()
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.getByRole('button', { name: 'Run on run01.mzML' }).click()
}

test('Characterize a run reaches the Overview in at most 3 actions: add file, Run, open toast', async ({ page }) => {
  await characterize(page, 'gate') // actions 1 and 2
  // The run moves to Results; its running state shows while it goes.
  await expect(page.getByRole('region', { name: 'Running' })).toBeVisible()
  // Looking at the form while it runs, the toast is the way back (action 3).
  await goTo(page, 'Setup')
  const toast = page.getByRole('status', { name: 'Run finished' })
  await toast.getByRole('button', { name: 'Open results' }).click()
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: 'Overview of run01.mzML' })).toBeVisible()
})

test('Overview figures and calls equal the oracles of the 1.12 gate output', async ({ page }) => {
  const o = oracle('v112-pxd003531')
  await characterize(page, 'gate')
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
  await expect(value(page, 'MS2 spectra')).toHaveText(en(o.ms2))
  await expect(value(page, 'Tags')).toHaveText(en(o.tags))
  await expect(value(page, 'Tags E ≤ 1')).toHaveText(en(o.filtered))
  await expect(value(page, 'Glyco')).toHaveText(`${en(o.glyco)} flagged`)
  await expect(value(page, 'Protease')).toHaveText(o.protease!)
  await expect(value(page, 'Top genus')).toHaveText(o.topGenus)
  expect(o.label).toBe('label-free')
  await expect(value(page, 'Label')).toHaveText('none (label-free)')
  // Every tile names its cutoff or caveat.
  for (const note of await page.locator('.tile .tile-note').allTextContents()) expect(note.trim()).not.toBe('')
  await expect(page.getByRole('list', { name: 'Checks', exact: true })).toContainText('Acquisition check: DDA')
})

test('no FASTA, no alkylation call: "not assessed (needs a FASTA)", and C+57.021 a default', async ({ page }) => {
  for (const fixture of ['gate', 'gate-1.11']) {
    await characterize(page, fixture)
    await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    // Oracle: the run had no FASTA and no report has a Cys section.
    const calls = await mockState<{ params: Record<string, unknown> }[]>(page, 'runCalls')
    expect(calls[0].params.fasta ?? '').toBe('')
    expect(calls[0].params.recon_fasta ?? '').toBe('')
    expect(oracle(fixture === 'gate' ? 'v112-pxd003531' : 'v111-pxd003531').massgap).toBe(false)
    await expect(value(page, 'Alkylation')).toHaveText('not assessed (needs a FASTA)')
    await expect(tile(page, 'Alkylation').getByRole('button', { name: 'Add FASTA and run again' })).toBeEnabled()
    const row = page.getByRole('table', { name: 'Suggested search settings' }).getByRole('row', { name: /fixed C\+57\.021/ })
    await expect(row.locator('.evidence')).toHaveText('default')
    await expect(row).toContainText('alkylation not assessed (no FASTA)')
  }
})

test('FASTag 1.11 output: no label call and no acquisition check, never filled in by the GUI', async ({ page }) => {
  const o = oracle('v111-pxd003531')
  expect(o.hasLabelCall).toBe(false)
  await characterize(page, 'gate-1.11')
  await expect(value(page, 'Label')).toHaveText('not called')
  await expect(value(page, 'Protease')).toHaveText(o.protease!)
  await expect(page.getByRole('list', { name: 'Checks', exact: true })).toContainText('Acquisition not checked')
})

test('a Da run without a census: the CLI no calls with their reason, the cutoff not applied, Da and ETD flagged', async ({ page }) => {
  const o = oracle('v112-pxd010783-da')
  // Oracle: fewer than 1,000 MS2 spectra, no Census line, and the CLI's own
  // no call with its reason in the digest and label reports.
  expect(o.ms2).toBeLessThan(1000)
  expect(read('v112-pxd010783-da', 'run.log')).not.toMatch(/^Census:/m)
  const digest = read('v112-pxd010783-da', 'run.digest.tsv')
  expect(cell(digest, 'call', 'reason')).toBe('low_resolution')
  const why = cell(digest, 'call', 'status', 4)!
  await characterize(page, 'gate-da')
  await expect(value(page, 'MS2 spectra')).toHaveText(en(o.ms2))
  // The MS2 count is not a stand-in for tagged spectra: no GUI verdict.
  for (const t of ['Protease', 'Label']) await expect(value(page, t)).toHaveText('no call')
  await expect(tile(page, 'Protease')).toContainText(why)
  for (const t of ['Protease', 'Top genus', 'Label']) await expect(value(page, t)).not.toHaveText('too little evidence')
  // The Overview's own checks: the Inspector's "Checks after the run" (#24)
  // is a second list beside it, so the name is matched exactly.
  const checks = page.getByRole('list', { name: 'Checks', exact: true })
  await expect(checks).toContainText('Evidence cutoff not applied: this run did not count tagged spectra')
  await expect(checks).toContainText('species calls are unreliable on ion-trap/Da data')
  await expect(checks).toContainText('electron-activated')
  // The instrument as the meta rows name it, no ion-trap inference.
  await expect(value(page, 'Instrument')).toHaveText(cell(digest, 'meta', 'instrument')!)
})

test('focus does not fall to the page body when the run ends or is cancelled', async ({ page }) => {
  await characterize(page, 'gate')
  await page.getByRole('region', { name: 'Running' }).getByRole('button', { name: 'Show log' }).focus()
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('region', { name: 'Running' })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeFocused()

  await openApp(page, 'slow')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.getByRole('button', { name: 'Run on run01.mzML' }).click()
  const cancel = page.getByRole('region', { name: 'Running' }).getByRole('button', { name: 'Cancel' })
  await cancel.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: 'Running' })).toHaveCount(0)
  await expect(page.locator('.view[data-view="results"]')).toBeFocused()
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY')
})

test('-species_call decoy: the top genus is the first present one, the others named', async ({ page }) => {
  await characterize(page, 'gate-call')
  await expect(value(page, 'Top genus')).toHaveText('Homo')
  await expect(tile(page, 'Top genus')).toContainText('also present: Macaca, Sus, Equus')
})
