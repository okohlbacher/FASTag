// P2b inspector: the checks before a run from the metadata probe (only with
// a CLI that lists -probe_input), the red flags and their fixes, the checks
// after a run from FASTag 1.12's real reports and log of the ion-trap gate
// input with the re-run offer, and the exit-11 raw-DIA refusal.
import { test, expect, goTo, openApp, mockState } from './fixtures'

const checkNamed = (page: import('@playwright/test').Page, title: RegExp) =>
  page.locator('li.check').filter({ has: page.locator('strong', { hasText: title }) })

test('ion-trap probe: the 0.3 Da red flag before the run, fixed in one click (focus moves on to Run); the stale index is a warning', async ({ page }) => {
  await openApp(page, 'iontrap-probe', 'defaults')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  const flag = checkNamed(page, /^Red flag: Ion-trap MS2 with a 20 ppm tolerance/)
  await expect(flag).toBeVisible()
  await expect(flag).toContainText('From the probe.')
  await expect(page.getByText(/Instrument: LTQ Orbitrap XL/)).toBeVisible()
  const run = page.getByRole('button', { name: 'Run on run01.mzML' })
  await expect(run).toBeDisabled()
  await expect(page.locator('#instrument option', { hasText: 'Ion trap CID 0.3 Da (detected)' })).toHaveCount(1)

  await expect(run).toHaveAttribute('aria-describedby', 'run-held')

  // By keyboard: the fix button goes away with its check, focus does not.
  await flag.getByRole('button', { name: 'Use Ion trap CID 0.3 Da' }).focus()
  await page.keyboard.press('Enter')
  await expect(flag).toHaveCount(0)
  await expect(checkNamed(page, /^Warning: The mzML index does not match/)).toBeVisible()
  await expect(run).toBeEnabled()
  await expect(run).toBeFocused()
  await expect(page.getByTestId('checks-summary')).toHaveText('Checks before the run: 2 warnings.')
  await page.keyboard.press('Enter')
  await expect(page.getByText('Showing 2,028 of 2,028')).toBeVisible()
  const calls = await mockState<{ params: Record<string, unknown> }[]>(page, 'runCalls')
  expect(calls[0].params).toMatchObject({ fragment_tolerance: '0.3', fragment_tolerance_unit: 'Da' })
})

test('raw-DIA probe: Run is blocked, with the DIAspeXtract command and no Run anyway', async ({ page }) => {
  await openApp(page, 'dia-probe', 'defaults')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  const block = checkNamed(page, /^Blocks the run: Raw DIA/)
  await expect(block).toBeVisible()
  await expect(block).toContainText('DIAspeXtract -in /data/PXD006096/100815_MM_ABPP_H1993_DMSO_DIA1_new.mzML')
  await expect(block.getByRole('button', { name: 'Copy DIAspeXtract command' })).toBeVisible()
  await expect(block.getByRole('button', { name: 'Run anyway' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Run on run01.mzML' })).toBeDisabled()
})

test('without the probe: "not checked" before the run; after it the ion-trap red flag and the re-run at 0.3 Da', async ({ page }) => {
  await openApp(page, 'iontrap')
  await page.getByRole('radio', { name: /^Characterize a run/ }).check()
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await expect(page.locator('p.not-checked', { hasText: /Not checked before the run: this FASTag has no metadata probe/ })).toBeVisible()
  await page.getByRole('button', { name: 'Run on run01.mzML' }).click()
  const after = page.getByRole('list', { name: 'Checks after the run' })
  const flag = after.locator('li.check').filter({ hasText: 'This run used 20 ppm; the MS2 look like ion trap' })
  await expect(flag).toBeVisible()
  await expect(flag).toContainText('LTQ Orbitrap XL')
  await expect(flag).toContainText("From the digest report and FASTag's log.")

  await flag.getByRole('button', { name: 'Re-run with 0.3 Da' }).click()
  // Characterize a run has species on: its Da red flag waits on Setup.
  const da = checkNamed(page, /^Red flag: Species detection with a tolerance in Da/)
  await expect(da).toBeVisible()
  // By keyboard: Run anyway stays a pressed toggle, and focus moves on to Run.
  await da.getByRole('button', { name: 'Run anyway' }).focus()
  await page.keyboard.press('Enter')
  await expect(da.getByRole('button', { name: 'Run anyway: chosen' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Run on run01.mzML' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await mockState<unknown[]>(page, 'runCalls')).length).toBe(2)
  const calls = await mockState<{ params: Record<string, unknown> }[]>(page, 'runCalls')
  expect(calls[1].params).toMatchObject({ fragment_tolerance: '0.3', fragment_tolerance_unit: 'Da', species: true })
})

test('FASTag 1.12 refuses raw DIA (exit 11): a clear block naming DIAspeXtract, not a generic failure', async ({ page }) => {
  await openApp(page, 'dia-refusal', 'defaults')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.getByRole('button', { name: 'Run on run01.mzML' }).click()
  await goTo(page, 'Results')
  const alert = page.getByRole('alert')
  await expect(alert.getByText('run01.mzML: raw DIA, not tagged (exit code 11)')).toBeVisible()
  await expect(alert).toContainText('FASTag did not tag this file: it is raw DIA (126 isolation windows, median width 8 Th)')
  await expect(alert.getByRole('button', { name: 'Copy DIAspeXtract command' })).toBeVisible()
  await expect(alert).not.toContainText('FASTAG_REFUSED')
  await expect(alert.getByRole('button', { name: 'What to do' })).toHaveAttribute('data-help', 'faq-raw-dia')
})

test('a probe in flight holds Run (no 0.3 Da run slips through before the red flag); its answer then decides', async ({ page }) => {
  await page.goto('/?fixture=iontrap-probe&start=defaults&hold=probes')
  await expect(page.getByText('FASTag ready')).toBeVisible()
  await page.getByRole('button', { name: 'Choose file…' }).click()
  const run = page.getByRole('button', { name: 'Run on run01.mzML' })
  await expect(page.locator('.inspector p.hint', { hasText: 'Checking the file with FASTag…' })).toBeVisible()
  await expect(page.locator('#run-held')).toHaveText(/^Checking the input with FASTag/)
  await expect(run).toBeDisabled()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
  expect(await mockState<unknown[]>(page, 'runCalls')).toEqual([])
  await page.evaluate(() => (window as unknown as { __fastagE2E: { mock: { releaseProbes(): void } } }).__fastagE2E.mock.releaseProbes())
  await expect(checkNamed(page, /^Red flag: Ion-trap MS2 with a 20 ppm tolerance/)).toBeVisible()
  await expect(run).toBeDisabled()
  await expect(page.getByTestId('checks-summary')).toHaveText('Checks before the run: 1 red flag, 2 warnings.')
})

test('the Orbitrap gate input with the probe (stale index, as FASTag 1.12 says): Run in two actions to the results', async ({ page }) => {
  await openApp(page, 'orbitrap-probe', 'defaults')
  // 1: add the file.
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await expect(checkNamed(page, /^Warning: The mzML index does not match/)).toBeVisible()
  await expect(page.locator('li.check[data-check]').filter({ hasText: /^Red flag|^Blocks the run/ })).toHaveCount(0)
  // 2: Run.
  await page.getByRole('button', { name: 'Run on run01.mzML' }).click()
  await expect(page.getByText('Showing 2,028 of 2,028')).toBeVisible()
  expect(await mockState<unknown[]>(page, 'runCalls')).toHaveLength(1)
})
