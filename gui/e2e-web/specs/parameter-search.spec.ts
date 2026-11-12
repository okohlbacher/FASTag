import { test, expect, openApp } from './fixtures'

test('parameter search contains focus, scrolls keyboard results and returns focus when closed', async ({ page }) => {
  await openApp(page)
  const trigger = page.getByRole('button', { name: /Search…/ })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Search parameters' })
  const input = dialog.getByRole('combobox')
  await expect(input).toBeFocused()
  await expect(dialog).toHaveJSProperty('open', true)
  // Even a script cannot move focus into the inert form behind the modal.
  await page.locator('#out').evaluate((el) => (el as HTMLInputElement).focus())
  await expect(input).toBeFocused()
  const close = dialog.getByRole('button', { name: 'Close parameter search' })
  // Safari's default tab order may skip buttons; either way Tab cannot
  // reach a control behind the modal.
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement === document.body || !!document.activeElement?.closest('dialog'))).toBe(true)
  }
  await input.focus()
  await expect(input).toBeFocused()
  await input.fill('tag')
  const hits = dialog.getByRole('option')
  for (let i = 1; i < await hits.count(); i++) await input.press('ArrowDown')
  const selected = dialog.getByRole('option', { selected: true })
  const visible = await selected.evaluate((el) => {
    const row = el.getBoundingClientRect()
    const list = el.parentElement!.getBoundingClientRect()
    return row.top >= list.top - 1 && row.bottom <= list.bottom + 1
  })
  expect(visible).toBe(true)
  await close.focus()
  await close.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()

  await trigger.click()
  await page.evaluate(() => {
    (window as unknown as { __fastagE2E: { menu(action: string): void } }).__fastagE2E.menu('view-results')
  })
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'No results yet' })).toBeVisible()
  await page.getByRole('button', { name: 'Setup', exact: true }).click()
  await expect(dialog).toHaveCount(0)
})
