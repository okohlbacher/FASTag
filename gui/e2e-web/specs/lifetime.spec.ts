import { test, expect, openApp, mockState } from './fixtures'

// P1 PR b: a run the app did not see end (it was killed) reads as failed at
// the next start, and the files it left are offered for removal, once.
test('the files an interrupted run left are offered at startup and removed on the click', async ({ page }) => {
  await openApp(page, 'interrupted')
  await expect(page.locator('.last-run')).toContainText('Failed in an earlier session')
  const box = page.getByRole('region', { name: 'Files left by an unfinished run' })
  await expect(box).toContainText('/data/run01.tags.tsv')
  await expect(box).toContainText('/data/run01.digest.tsv.part')
  expect(await mockState<string[][]>(page, 'sweepCalls')).toEqual([])
  await box.getByRole('button', { name: 'Remove them' }).click()
  await expect(box).toBeHidden()
  expect(await mockState<string[][]>(page, 'sweepCalls')).toEqual([['/data/run01.tags.tsv', '/data/run01.digest.tsv.part']])
})
