import { test, expect, goTo, openApp, mockState, toStep } from './fixtures'

test('last-used is an offer: a fresh start runs with defaults until the chip is clicked', async ({ page }) => {
  await openApp(page, 'lastused', 'defaults')
  const chip = page.getByRole('button', { name: 'Continue last run (2)' })
  await toStep(page, 'Task')
  await expect(chip).toBeVisible()
  await expect(page.locator('#p-tag_length')).toHaveValue('3')
  await toStep(page, 'Inputs')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('Showing 2,028 of 2,028')).toBeVisible()
  let calls = await mockState<{ params: Record<string, unknown> }[]>(page, 'runCalls')
  expect(calls[0].params['tag_length']).toBe('3')
  expect(calls[0].params['species']).toBe(false)
  await goTo(page, 'Setup') // the run moved to Results; the chip is on step 1 of Setup
  await toStep(page, 'Task')
  await chip.click()
  await expect(chip).toBeHidden()
  await expect(page.locator('#p-tag_length')).toHaveValue('7')
  await toStep(page, 'Outputs & run')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('Showing 2,028 of 2,028')).toBeVisible()
  calls = await mockState(page, 'runCalls')
  expect(calls[1].params['tag_length']).toBe('7')
  expect(calls[1].params['species']).toBe(true)
})

test('while a run goes the open buttons are locked; the close guard asks, and Keep running keeps it', async ({ page }) => {
  await openApp(page, 'slow')
  await toStep(page, 'Inputs')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  // P2a: the run moved to Results. Cancel has one home on every view: the
  // run status pill in the app bar; the running state keeps the progress
  // and has no second Cancel (Codex round 2 "Cancel changes region").
  const pillCancel = page.getByRole('group', { name: 'Run status' }).getByRole('button', { name: 'Cancel' })
  await expect(pillCancel).toBeVisible()
  await expect(page.getByRole('region', { name: 'Running' }).getByRole('button', { name: 'Cancel' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Open tags…' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Open report…' })).toBeDisabled()
  // C3: no onboarding under the running state.
  await expect(page.getByRole('heading', { name: 'No results yet' })).toHaveCount(0)

  await page.evaluate(() => (window as unknown as { __fastagE2E: { requestClose(w: string): void } }).__fastagE2E.requestClose('quit'))
  const dlg = page.getByRole('alertdialog')
  await expect(dlg).toContainText('Quitting stops the run')
  await expect(dlg.getByRole('button', { name: 'Keep running' })).toBeFocused()
  await dlg.getByRole('button', { name: 'Keep running' }).click()
  await expect(dlg).toBeHidden()
  await goTo(page, 'Setup')
  await expect(page.getByRole('button', { name: 'Running…' })).toBeVisible()
  // The Setup footer shows the progress, not a second Cancel.
  await expect(page.locator('.view-setup .runbar').getByRole('button', { name: 'Cancel' })).toHaveCount(0)
  await expect(pillCancel).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(1)
  for (const v of ['Batch', 'History'] as const) {
    await goTo(page, v)
    await expect(pillCancel).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(1)
  }
  await goTo(page, 'Setup')

  await page.evaluate(() => (window as unknown as { __fastagE2E: { requestClose(w: string): void } }).__fastagE2E.requestClose('close'))
  await dlg.getByRole('button', { name: 'Cancel run and quit' }).click()
  expect(await mockState<boolean[]>(page, 'closeAnswers')).toEqual([false, true])
})

test('a cancelled run says its partial outputs were removed', async ({ page }) => {
  await openApp(page, 'slow')
  await toStep(page, 'Inputs')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await page.getByRole('group', { name: 'Run status' }).getByRole('button', { name: 'Cancel' }).click()
  await expect(page.locator('#run-status')).toContainText('partial outputs removed')
  await page.getByRole('button', { name: /^Log/ }).first().click()
  await expect(page.locator('pre.log')).toContainText('Removed the partial output /data/run01.tags.tsv')
})

test('an existing output is confirmed before the run; a cancelled run of an earlier session reads as cancelled', async ({ page }) => {
  await openApp(page, 'existing', 'defaults')
  await goTo(page, 'Results')
  await page.getByRole('button', { name: 'Open tags…' }).click()
  await expect(page.locator('.tabpanel')).toContainText('The run that wrote /data/run01.tags.tsv was cancelled')
  await goTo(page, 'Setup')
  await toStep(page, 'Inputs')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  const dlg = page.getByRole('alertdialog')
  await expect(dlg).toContainText('An output already exists')
  await expect(dlg).toContainText('/data/run01.tags.tsv')
  await expect(dlg.getByRole('button', { name: "Don't run" })).toBeFocused()
  expect(await mockState<unknown[]>(page, 'runCalls')).toEqual([])
  await dlg.getByRole('button', { name: 'Overwrite and run' }).click()
  await expect(page.getByText('Showing 2,028 of 2,028')).toBeVisible()
  const calls = await mockState<{ overwrite?: boolean }[]>(page, 'runCalls')
  expect(calls[0].overwrite).toBe(true)
})
