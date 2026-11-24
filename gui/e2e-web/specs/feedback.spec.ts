// In-app feedback in Chromium and WebKit (e2e build; the DOM rasteriser
// takes the screenshot, as the browser has no native webview snapshot):
// open, mark up, redact, save (the mock records report.json as the backend
// would write it: validated against the local schema here), the share
// preview equals the export (validated against the public schema), and the
// sharing defaults (a captured screenshot and diagnostics on, the log off).
// The redaction is checked in the saved PNG
// itself: every pixel of the redact box, rounded outward, is opaque black.
import { test, expect, goTo, openApp, mockState } from './fixtures'
import localSchema from '../../src/feedback/schema/report.schema.json' with { type: 'json' }
import publicSchema from '../../src/feedback/schema/feedback-public.schema.json' with { type: 'json' }
import { validate } from '../../src/feedback/schemaCheck'

interface Saved {
  report: Record<string, unknown> & { id: string; capture: { status: string; method: string; width: number; height: number }; annotations: { n: number; type: string; px: number[] }[] }
  png: Record<string, number> | null
}

test('feedback: mark up, redact, save locally, preview equals the export', async ({ page }) => {
  await openApp(page)
  const button = page.getByRole('button', { name: 'Feedback', exact: true })
  await button.click()
  const dialog = page.getByRole('dialog', { name: 'Feedback' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Title')).toBeFocused()
  // The DOM rasteriser drew it, and says so.
  await expect(dialog.getByText(/drawn from the page/)).toBeVisible()
  // Sharing defaults: a captured screenshot and diagnostics on, the log off
  // (report 20261124T113631Z_a8b7e2e7).
  await expect(dialog.locator('input[name="share-screenshot"]')).toBeChecked()
  await expect(dialog.locator('input[name="share-log"]')).not.toBeChecked()
  await expect(dialog.locator('input[name="share-diagnostics"]')).toBeChecked()

  await dialog.getByRole('button', { name: 'Mark up…' }).click()
  const canvas = dialog.locator('canvas.fb-canvas')
  await expect(canvas).toBeVisible()
  const box = (await canvas.boundingBox())!
  // A rectangle by dragging, then a redaction by two clicks.
  await page.mouse.move(box.x + 20, box.y + 20)
  await page.mouse.down()
  await page.mouse.move(box.x + 120, box.y + 80, { steps: 5 })
  await page.mouse.up()
  await dialog.getByRole('button', { name: 'Redaction' }).click()
  await dialog.getByLabel('Click two corners').check()
  await canvas.click({ position: { x: 150.5, y: 30.25 } })
  await canvas.click({ position: { x: 260.75, y: 95.5 } })
  await expect(dialog.locator('[data-shape-row]')).toHaveCount(2)
  await expect(dialog.locator('[data-shape-row="2"]')).toHaveAttribute('aria-label', '2: Redaction')
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(dialog.getByRole('button', { name: 'Mark up…' })).toBeVisible()

  await dialog.getByLabel('Title').fill('Species tab empty')
  await dialog.getByLabel('Description').fill('See 1; my sample name is under 2.')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog.getByText('Saved. Share it?')).toBeVisible()

  const saved = await mockState<Saved[]>(page, 'feedbackReports')
  expect(saved).toHaveLength(1)
  const r = saved[0].report
  expect(validate(localSchema, r)).toEqual([])
  expect(r.capture).toMatchObject({ status: 'degraded', method: 'dom' })
  expect(r.annotations.map((a) => a.type)).toEqual(['rect', 'redact'])
  expect(saved[0].png).not.toBeNull()

  // The redaction is in the saved pixels: opaque black over the whole box.
  const redact = r.annotations[1].px
  const bad = await page.evaluate(async ([x, y, w, h]) => {
    const m = (window as unknown as { __fastagE2E: { mock: { feedbackReports: { png: Uint8Array }[] } } }).__fastagE2E.mock
    const bmp = await createImageBitmap(new Blob([m.feedbackReports[0].png as BlobPart], { type: 'image/png' }))
    const c = document.createElement('canvas')
    c.width = bmp.width
    c.height = bmp.height
    const ctx = c.getContext('2d')!
    ctx.drawImage(bmp, 0, 0)
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const x1 = Math.ceil(x + w)
    const y1 = Math.ceil(y + h)
    const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] !== 0 || d[i + 1] !== 0 || d[i + 2] !== 0 || d[i + 3] !== 255) n++
    return { n, size: d.length / 4, width: bmp.width, height: bmp.height }
  }, redact)
  expect(bad.size).toBeGreaterThan(100)
  expect(bad.n).toBe(0)
  expect([bad.width, bad.height]).toEqual([r.capture.width, r.capture.height])

  // The screenshot is in the first export by default: the preview shows it
  // by size, and the export validates against the public schema.
  const first = await mockState<{ json: string; include: Record<string, boolean> }[]>(page, 'feedbackExports')
  expect(first[first.length - 1].include).toEqual({ screenshot: true, diagnostics: true, log: false })
  await expect(dialog.locator('.fb-field[data-field="screenshot.png"]')).toContainText(`${r.capture.width}×${r.capture.height} px`)
  const j1 = JSON.parse(first[first.length - 1].json)
  expect(validate(publicSchema, j1)).toEqual([])
  expect(j1.annotations).toBe(2)
  expect(j1.log).toBeUndefined()

  // Unticked, the preview is the export the backend would zip, field by
  // field, and it validates against the public schema; no screenshot, no log.
  await dialog.locator('input[name="share-screenshot"]').uncheck()
  await expect(dialog.locator('.fb-field[data-field="screenshot.png"]')).toHaveCount(0)
  const exports = await mockState<{ json: string; include: Record<string, boolean> }[]>(page, 'feedbackExports')
  const last = exports[exports.length - 1]
  expect(last.include).toEqual({ screenshot: false, diagnostics: true, log: false })
  const json = JSON.parse(last.json)
  expect(validate(publicSchema, json)).toEqual([])
  expect(json.capture).toBeUndefined()
  expect(json.log).toBeUndefined()
  const fields = await dialog.locator('.fb-field').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.field))
  expect(fields).toEqual(Object.keys(json))
  await expect(dialog.locator('.fb-field[data-field="title"] dd')).toHaveText('Species tab empty')
  expect(last.json).not.toContain('sample name')

  // Ticked again, the screenshot joins: the preview shows it by size.
  await dialog.locator('input[name="share-screenshot"]').check()
  await expect(dialog.locator('.fb-field[data-field="screenshot.png"]')).toContainText(`${r.capture.width}×${r.capture.height} px`)
  const withShot = await mockState<{ json: string }[]>(page, 'feedbackExports')
  const j2 = JSON.parse(withShot[withShot.length - 1].json)
  expect(validate(publicSchema, j2)).toEqual([])
  expect(j2.annotations).toBe(2)

  // The public route needs its own confirmation.
  const openDraft = dialog.getByRole('button', { name: 'Open issue draft' })
  await expect(openDraft).toBeDisabled()
  await dialog.getByLabel(/public GitHub issue, visible to anyone/).check()
  await openDraft.click()
  await expect(dialog.getByText(/issue form is open/)).toBeVisible()
  const issues = await mockState<{ url: string }[]>(page, 'feedbackIssues')
  const u = new URL(issues[0].url)
  expect(issues[0].url.length).toBeLessThanOrEqual(2048)
  expect([...u.searchParams.keys()]).toEqual(['template', 'title', 'report-id', 'kind'])
  expect(u.searchParams.get('report-id')).toBe(r.id)

  // Done closes and gives focus back to the button.
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(button).toBeFocused()
})

test('feedback: Escape closes, the text stays for the session, the shortcut opens it', async ({ page }) => {
  await openApp(page)
  await page.keyboard.press('ControlOrMeta+Shift+F')
  const dialog = page.getByRole('dialog', { name: 'Feedback' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Title').fill('Half a thought')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await page.getByRole('button', { name: 'Feedback', exact: true }).click()
  await expect(dialog.getByLabel('Title')).toHaveValue('Half a thought')
  // Mark-up by keyboard: Add, then the fields.
  await dialog.getByRole('button', { name: 'Mark up…' }).click()
  await dialog.getByRole('button', { name: 'Redaction' }).click()
  await dialog.getByRole('button', { name: 'Add redaction' }).click()
  await expect(dialog.getByLabel('Shape 1 left in pixels')).toBeVisible()
  // Escape in the editor goes back to the report, not out of the dialog.
  await page.keyboard.press('Escape')
  await expect(dialog.getByLabel('Title')).toBeVisible()
})

// Feedback 2026-11-24: the form is a floating, non-modal panel, docked
// bottom-right, so the screen it reports on stays visible and usable.
test('feedback: a non-modal panel over the Spectrum tab, movable and collapsible, the app usable behind it', async ({ page }, info) => {
  await openApp(page, 'spectrum')
  await goTo(page, 'Results')
  await page.getByRole('button', { name: 'Open tags…' }).click()
  await page.locator('.rt-rows .rt-row').first().click()
  await page.keyboard.press('Enter')
  const spectrumTab = page.getByRole('tab', { name: 'Spectrum' })
  await expect(spectrumTab).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: 'Feedback', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Feedback' })
  await expect(panel).toBeVisible()
  await expect(panel).toHaveAttribute('aria-modal', 'false')
  await expect(page.locator('.modal-backdrop')).toHaveCount(0)
  // Docked bottom-right, 420 px wide, in the 1200 by 800 window.
  const docked = (await panel.boundingBox())!
  expect(Math.round(docked.width)).toBe(420)
  expect(Math.round(docked.x + docked.width)).toBe(1200 - 16)
  expect(Math.round(docked.y + docked.height)).toBe(800 - 16)
  await panel.getByLabel('Title').fill('Ladder labels cut off')
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.screenshot({ path: info.outputPath(`feedback-panel-spectrum-${scheme}.png`) })
  }
  await page.emulateMedia({ colorScheme: 'light' })

  // The app behind is usable: another tab and back; Escape there is the app's.
  await page.getByRole('tab', { name: 'Tags' }).click()
  await expect(page.getByRole('tab', { name: 'Tags' })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Escape')
  await expect(panel).toBeVisible()
  await spectrumTab.click()
  await expect(spectrumTab).toHaveAttribute('aria-selected', 'true')
  await expect(panel.getByLabel('Title')).toHaveValue('Ladder labels cut off')

  // Dragged by its title bar, and kept in the window.
  const bar = panel.locator('.fb-bar h2')
  const b = (await bar.boundingBox())!
  const mid = b.y + b.height / 2
  await page.mouse.move(b.x + 20, mid)
  await page.mouse.down()
  await page.mouse.move(b.x - 280, mid - 60, { steps: 6 })
  await page.mouse.up()
  const moved = (await panel.boundingBox())!
  expect(Math.round(moved.x)).toBe(Math.round(docked.x) - 300)
  expect(Math.round(moved.y)).toBe(Math.round(docked.y) - 60)
  await page.mouse.move(b.x - 280, mid - 60)
  await page.mouse.down()
  await page.mouse.move(-500, -500, { steps: 4 })
  await page.mouse.up()
  const corner = (await panel.boundingBox())!
  expect([Math.round(corner.x), Math.round(corner.y)]).toEqual([0, 0])

  // Collapsed to its title bar, then expanded with the text kept.
  await panel.getByRole('button', { name: 'Collapse Feedback' }).click()
  await expect(panel.getByLabel('Title')).toBeHidden()
  expect((await panel.boundingBox())!.height).toBeLessThan(60)
  await panel.getByRole('button', { name: 'Expand Feedback' }).click()
  await expect(panel.getByLabel('Title')).toHaveValue('Ladder labels cut off')

  // Retake screenshot: a new capture, without the panel on it.
  await panel.getByRole('button', { name: 'Retake screenshot' }).click()
  await expect(panel.getByText('New screenshot taken.')).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Retake screenshot' })).toBeFocused()
})

// Report 20261121T143325Z_856491d9: copy and paste work in the fields.
test('feedback: select all, copy and paste by keyboard in the text fields', async ({ page, browserName, context }) => {
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openApp(page)
  await page.getByRole('button', { name: 'Feedback', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Feedback' })
  const title = panel.getByLabel('Title')
  await title.fill('copied text')
  await title.press('ControlOrMeta+A')
  await title.press('ControlOrMeta+C')
  const description = panel.getByLabel('Description')
  await description.click()
  await description.press('ControlOrMeta+V')
  await expect(description).toHaveValue('copied text')
  await description.press('ControlOrMeta+A')
  await description.press('ControlOrMeta+X')
  await expect(description).toHaveValue('')
  await panel.getByLabel('Steps to reproduce').press('ControlOrMeta+V')
  await expect(panel.getByLabel('Steps to reproduce')).toHaveValue('copied text')
})
