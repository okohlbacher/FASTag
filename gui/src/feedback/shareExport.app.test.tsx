// The share step hands off only the export that matches the choices shown
// (review n6). The screenshot is included by default (user decision; it
// stays so): unticking it after Save regenerates the zip, and until that
// export is there, Open issue draft is off and the confirmation is asked
// again; a failed regeneration keeps it off; an older export answering
// after a newer one is dropped.

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installMockBridge, type MockBridge } from '../testing/mockBridge'
import { click, flush, renderApp } from '../testing/render'
import { CONSENT_TEXT_VERSION } from './draft'
import type { FeedbackExported, Include } from './types'

vi.mock('./domCapture', () => ({
  MASK: '',
  holdsAcceleratedContent: () => false,
  domCapture: () => {
    const c = document.createElement('canvas')
    c.width = 40
    c.height = 20
    return Promise.resolve(c)
  }
}))
// jsdom has no canvas encoder: a PNG header of 40 × 20.
vi.mock('./image', async (orig) => {
  const real = await orig<typeof import('./image')>()
  const png = new Uint8Array(32)
  new DataView(png.buffer).setUint32(16, 40)
  new DataView(png.buffer).setUint32(20, 20)
  return { ...real, encodePng: () => Promise.resolve(png) }
})

afterEach(() => vi.restoreAllMocks())

const dialog = (): HTMLElement => screen.getByRole('dialog', { name: /Feedback/ })
const openBtn = (): HTMLButtonElement => within(dialog()).getByRole('button', { name: 'Open issue draft' }) as HTMLButtonElement
const confirmBox = (): HTMLInputElement => within(dialog()).getByLabelText(/public GitHub issue, visible to anyone/) as HTMLInputElement
const box = (k: keyof Include): HTMLInputElement => dialog().querySelector(`input[name="share-${k}"]`) as HTMLInputElement
const fields = (): (string | undefined)[] => [...dialog().querySelectorAll<HTMLElement>('.fb-field')].map((f) => f.dataset.field)

interface Held {
  include: Include
  go(): void
  fail(why: string): void
}

/// The mock's export, held after Save until a test lets each one go.
function hold(mock: MockBridge): { held: Held[]; on(): void } {
  const real = mock.feedbackExport
  const held: Held[] = []
  let holding = false
  mock.feedbackExport = (id, include, seq) => {
    if (!holding) return real(id, include, seq)
    return new Promise<FeedbackExported>((res, rej) => {
      held.push({ include: { ...include }, go: () => void real(id, include, seq).then(res, rej), fail: (why) => rej(new Error(why)) })
    })
  }
  return { held, on: () => (holding = true) }
}

async function saved(mock: MockBridge, before?: () => void): Promise<void> {
  await renderApp(mock)
  await click(screen.getByRole('button', { name: 'Feedback' }))
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Feedback' })).toBeTruthy())
  await flush()
  const d = dialog()
  expect((d.querySelector('input[name="share-screenshot"]') as HTMLInputElement).checked).toBe(true)
  fireEvent.change(within(d).getByLabelText('Title'), { target: { value: 'Species tab empty' } })
  before?.()
  await click(within(d).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(within(dialog()).getByText('Saved. Share it?')).toBeTruthy())
  await waitFor(() => expect(fields()).toContain('screenshot.png'))
}

describe('the share step hands off the export of the choices shown', () => {
  let mock: MockBridge
  beforeEach(() => {
    mock = installMockBridge()
  })

  it('unticking the screenshot after the confirmation: no handoff until the new export is there and is confirmed again', async () => {
    const h = hold(mock)
    await saved(mock)
    expect(mock.feedbackExports[mock.feedbackExports.length - 1].include.screenshot).toBe(true)
    await click(confirmBox())
    expect(openBtn().disabled).toBe(false)
    h.on()
    await click(box('screenshot'))
    // Regenerating: the old zip (with the screenshot) must not be handed off.
    expect(h.held).toHaveLength(1)
    expect(box('screenshot').checked).toBe(false)
    expect(confirmBox().checked).toBe(false)
    expect(openBtn().disabled).toBe(true)
    await click(openBtn())
    expect(mock.feedbackIssues).toHaveLength(0)
    await act(async () => h.held[0].go())
    await flush()
    // The new export is there, not yet confirmed.
    expect(openBtn().disabled).toBe(true)
    expect(fields()).not.toContain('screenshot.png')
    expect(mock.feedbackExports[mock.feedbackExports.length - 1].include).toEqual({ screenshot: false, diagnostics: true, log: false })
    await click(confirmBox())
    expect(openBtn().disabled).toBe(false)
    await click(openBtn())
    await flush()
    expect(mock.feedbackIssues).toHaveLength(1)
    expect(mock.feedbackRevealCalls).toHaveLength(1)
  })

  it('a regeneration that fails keeps the handoff off: no issue, no zip shown', async () => {
    const h = hold(mock)
    await saved(mock)
    await click(confirmBox())
    h.on()
    await click(box('screenshot'))
    await act(async () => h.held[0].fail('disk full'))
    await flush()
    expect(within(dialog()).getByRole('alert').textContent).toMatch(/Cannot build the export: disk full/)
    expect(openBtn().disabled).toBe(true)
    // Confirming again does not hand off an export that does not match.
    await click(confirmBox())
    expect(openBtn().disabled).toBe(true)
    await click(openBtn())
    await flush()
    expect(mock.feedbackIssues).toHaveLength(0)
    expect(mock.feedbackRevealCalls).toHaveLength(0)
    expect(within(dialog()).getByRole('button', { name: 'Copy diagnostics' }).hasAttribute('disabled')).toBe(true)
  })

  it('two changes, their exports answering out of order: the second one is what is shown and handed off', async () => {
    const h = hold(mock)
    await saved(mock)
    h.on()
    await click(box('screenshot'))
    await click(box('log'))
    expect(h.held.map((x) => x.include)).toEqual([
      { screenshot: false, diagnostics: true, log: false },
      { screenshot: false, diagnostics: true, log: true }
    ])
    // The newer answers first, the older late.
    await act(async () => h.held[1].go())
    await flush()
    await act(async () => h.held[0].go())
    await flush()
    expect(fields()).toContain('log')
    expect(fields()).not.toContain('screenshot.png')
    await click(confirmBox())
    expect(openBtn().disabled).toBe(false)
  })

  // Codex New 6: the older request (screenshot ticked) reaches the store
  // after the newer one (unticked). It is refused there and writes nothing,
  // and the zip revealed for the issue draft holds the newer choices.
  it('an older export reaching the store late does not change the zip revealed', async () => {
    const h = hold(mock)
    await saved(mock)
    h.on()
    await click(box('log'))
    await click(box('screenshot'))
    expect(h.held.map((x) => x.include.screenshot)).toEqual([true, false])
    await act(async () => h.held[1].go())
    await flush()
    await act(async () => h.held[0].go())
    await flush()
    // The store holds the newer request's zip: no screenshot.
    expect(mock.feedbackReports[0].zipOf?.screenshot).toBe(false)
    await click(confirmBox())
    await click(openBtn())
    await flush()
    expect(mock.feedbackIssues).toHaveLength(1)
    const shown = mock.feedbackRevealed[mock.feedbackRevealed.length - 1]
    expect(shown.screenshot).toBe(false)
    expect(JSON.parse(shown.json).log).toBeDefined()
    expect(shown.json).not.toContain('"screenshot.png"')
  })

  it('the privacy notice says what is included by default, under a new version', async () => {
    let notice = ''
    await saved(mock, () => (notice = dialog().querySelector('.fb-privacy')?.textContent ?? ''))
    expect(notice).toMatch(/the screenshot \(with your mark-up and redactions\) and the diagnostics, which are included by default/)
    expect(notice).toMatch(/the log, only if you tick it/)
    expect(CONSENT_TEXT_VERSION).toBe('fastag-feedback-privacy-2')
    expect(notice).toContain('Notice fastag-feedback-privacy-2')
    expect(mock.feedbackReports[0].report.consent_text_version).toBe('fastag-feedback-privacy-2')
  })
})
