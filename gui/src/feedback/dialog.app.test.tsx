// The Feedback dialog at App level: one capture path (button, menu,
// shortcut), focus and Escape, the sharing defaults, text kept for the
// session, Save local only, the share step with its confirmation, the issue
// URL, the reports list, and the mark-up editor's keyboard path. The
// dialog is a floating, non-modal panel (feedback 2026-11-24): no scrim, the
// app behind stays usable, it moves (pointer and keys), resizes, collapses,
// retakes its screenshot, and every text field keeps the platform's copy,
// cut, paste and select all (report 20261121T143325Z_856491d9).

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installMockBridge, type MockBridge } from '../testing/mockBridge'
import { click, flush, goTo, key, renderApp } from '../testing/render'
import localSchema from './schema/report.schema.json'
import publicSchema from './schema/feedback-public.schema.json'
import { validate } from './schemaCheck'
import { installConsoleRing } from './consoleRing'

const dom = vi.hoisted(() => ({ next: null as null | (() => Promise<HTMLCanvasElement>) }))
vi.mock('./domCapture', () => ({
  MASK: '',
  holdsAcceleratedContent: () => false,
  domCapture: () => (dom.next ? dom.next() : Promise.reject(new Error('no DOM raster in jsdom')))
}))

beforeEach(() => {
  dom.next = null
})
afterEach(() => vi.restoreAllMocks())

const last = <T,>(a: T[]): T => a[a.length - 1]
const feedbackButton = (): HTMLElement => screen.getByRole('button', { name: 'Feedback' })
const dialog = (): HTMLElement => screen.getByRole('dialog', { name: /Feedback/ })

async function open(): Promise<HTMLElement> {
  const b = feedbackButton()
  b.focus()
  await click(b)
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Feedback' })).toBeTruthy())
  await flush()
  return dialog()
}

describe('feedback dialog', () => {
  it('opens from the top bar with focus on the title; Escape closes and focus returns', async () => {
    await renderApp(installMockBridge())
    const d = await open()
    expect(d.getAttribute('aria-modal')).toBe('false')
    expect(document.activeElement).toBe(within(d).getByLabelText('Title'))
    // Text-only: the capture failed in jsdom, and says why.
    expect(within(d).getByText(/No screenshot: .*no native webview.*no DOM raster/)).toBeTruthy()
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(feedbackButton())
  })

  it('shares nothing extra by default: screenshot off, diagnostics on, log off', async () => {
    await renderApp(installMockBridge())
    const d = await open()
    const box = (n: string): HTMLInputElement => d.querySelector<HTMLInputElement>(`input[name="share-${n}"]`)!
    expect(box('screenshot').checked).toBe(false)
    expect(box('screenshot').disabled).toBe(true) // no screenshot to share
    expect(box('diagnostics').checked).toBe(true)
    expect(box('log').checked).toBe(false)
    expect(within(d).getByText(/can identify people/)).toBeTruthy()
    expect(within(d).getByText('Privacy notice')).toBeTruthy()
  })

  it('keeps the text for the session when closed and opened again', async () => {
    await renderApp(installMockBridge())
    let d = await open()
    fireEvent.change(within(d).getByLabelText('Title'), { target: { value: 'Half written' } })
    await click(within(d).getByRole('button', { name: 'Close' }))
    d = await open()
    expect((within(d).getByLabelText('Title') as HTMLInputElement).value).toBe('Half written')
  })

  it('the menu item and Cmd+Shift+F take the same path, one capture at a time', async () => {
    const mock = installMockBridge()
    const spy = vi.spyOn(mock, 'feedbackCapture')
    await renderApp(mock)
    // Help > Send Feedback…
    await act(async () => mock.emitMenu('feedback'))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Feedback' })).toBeTruthy())
    expect(spy).toHaveBeenCalledTimes(1)
    await click(within(dialog()).getByRole('button', { name: 'Close' }))
    spy.mockClear()
    // Past the 300 ms in which a key and a menu item for one shortcut act once (useKeys).
    await act(() => new Promise((r) => setTimeout(r, 350)))
    // Two triggers in one go: one capture.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', metaKey: true, ctrlKey: false, shiftKey: true, bubbles: true }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', ctrlKey: true, metaKey: false, shiftKey: true, bubbles: true }))
    })
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Feedback' })).toBeTruthy())
    expect(spy).toHaveBeenCalledTimes(1)
    // While it is open, another trigger does nothing.
    await click(feedbackButton())
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('Save writes a local report only; sharing needs the public-issue confirmation', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    const d = await open()
    // No title: not saved, and the error is announced.
    await click(within(d).getByRole('button', { name: 'Save' }))
    expect(within(d).getByRole('alert').textContent).toMatch(/title/)
    expect(mock.feedbackReports).toHaveLength(0)
    fireEvent.change(within(d).getByLabelText('Kind'), { target: { value: 'bug' } })
    fireEvent.change(within(d).getByLabelText('Title'), { target: { value: 'Species tab empty' } })
    fireEvent.change(within(d).getByLabelText('Steps to reproduce'), { target: { value: '1. run' } })
    await click(within(d).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(within(dialog()).getByText('Saved. Share it?')).toBeTruthy())
    expect(mock.feedbackReports).toHaveLength(1)
    const saved = mock.feedbackReports[0].report
    expect(validate(localSchema, saved)).toEqual([])
    expect(saved).toMatchObject({ kind: 'bug', title: 'Species tab empty', steps: '1. run', status: 'saved', capture: { status: 'failed' } })
    expect(mock.feedbackIssues).toHaveLength(0)

    // The preview is the export, field by field.
    const json = JSON.parse(last(mock.feedbackExports).json)
    expect(validate(publicSchema, json)).toEqual([])
    expect(last(mock.feedbackExports).include).toEqual({ screenshot: false, diagnostics: true, log: false })
    const shown = [...dialog().querySelectorAll<HTMLElement>('.fb-field')].map((f) => f.dataset.field)
    expect(shown).toEqual(Object.keys(json))

    const openBtn = within(dialog()).getByRole('button', { name: 'Open issue draft' }) as HTMLButtonElement
    expect(openBtn.disabled).toBe(true)
    await click(within(dialog()).getByLabelText(/public GitHub issue, visible to anyone/))
    expect(openBtn.disabled).toBe(false)
    await click(openBtn)
    await flush()
    expect(mock.feedbackIssues).toHaveLength(1)
    const u = new URL(mock.feedbackIssues[0].url)
    expect([...u.searchParams.keys()]).toEqual(['template', 'title', 'report-id', 'kind'])
    expect(u.searchParams.get('report-id')).toBe(saved.id)
    expect(mock.feedbackRevealCalls).toEqual([saved.id])
    expect(mock.feedbackReports[0].report.status).toBe('handoff_opened')

    // The log joins the export only when ticked.
    await click(dialog().querySelector('input[name="share-log"]')!)
    await flush()
    expect(JSON.parse(last(mock.feedbackExports).json).log).toBeDefined()

    // Mark as submitted: only a FASTag issue address.
    const url = within(dialog()).getByLabelText('Issue address')
    fireEvent.change(url, { target: { value: 'https://example.org/1' } })
    await click(within(dialog()).getByRole('button', { name: 'Mark as submitted' }))
    expect(mock.feedbackReports[0].report.status).toBe('handoff_opened')
    fireEvent.change(url, { target: { value: 'https://github.com/okohlbacher/FASTag/issues/321' } })
    await click(within(dialog()).getByRole('button', { name: 'Mark as submitted' }))
    expect(mock.feedbackReports[0].report).toMatchObject({ status: 'submitted', issue_url: 'https://github.com/okohlbacher/FASTag/issues/321' })

    // The next report starts with empty text.
    await click(within(dialog()).getByRole('button', { name: 'Done' }))
    const d2 = await open()
    expect((within(d2).getByLabelText('Title') as HTMLInputElement).value).toBe('')
  })

  it('freezes the view, the allow-listed parameters and the scrubbed log at the moment of asking', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    installConsoleRing()
    console.warn('cannot read /Users/tester/secret/run.mzML for tester@example.org')
    const d = await open()
    fireEvent.change(within(d).getByLabelText('Title'), { target: { value: 't' } })
    await click(within(d).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mock.feedbackReports).toHaveLength(1))
    const r = mock.feedbackReports[0].report
    expect(r.view).toMatchObject({ view: 'setup', dialog: null })
    expect(r.window.theme_setting).toBe('system')
    const text = JSON.stringify(r)
    expect(text).not.toMatch(/\/Users\/tester|tester@example/)
    expect(r.log.some((l) => l.text.includes('<home>/secret/run.mzML') && l.text.includes('<email>'))).toBe(true)
    for (const v of Object.values(r.params)) expect(typeof v === 'string' ? v.includes('/') : false).toBe(false)
  })

  it('lists, reveals and deletes the saved reports (also from About)', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    for (const t of ['one', 'two']) {
      const d = await open()
      fireEvent.change(within(d).getByLabelText('Title'), { target: { value: t } })
      await click(within(d).getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(within(dialog()).getByText('Saved. Share it?')).toBeTruthy())
      await click(within(dialog()).getByRole('button', { name: 'Done' }))
    }
    // Help > About > Feedback reports…: the list alone.
    await act(async () => mock.emitMenu('about'))
    await click(screen.getByRole('button', { name: 'Feedback reports…' }))
    expect(within(dialog()).getByText('Feedback reports on this computer')).toBeTruthy()
    expect(within(dialog()).getAllByRole('listitem')).toHaveLength(2)
    await click(within(dialog()).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    const d = await open()
    await click(within(d).getByRole('button', { name: 'Saved reports…' }))
    const list = await within(dialog()).findAllByRole('listitem')
    expect(list.map((li) => li.querySelector('b')?.textContent)).toEqual(['two', 'one'])
    await click(within(list[0]).getByRole('button', { name: 'Open folder' }))
    expect(mock.feedbackRevealCalls).toHaveLength(1)
    await click(within(list[0]).getByRole('button', { name: 'Delete two' }))
    await click(within(dialog()).getByRole('button', { name: 'Delete for good' }))
    await waitFor(() => expect(mock.feedbackReports.map((r) => r.report.title)).toEqual(['one']))
    await click(within(dialog()).getByRole('button', { name: 'Delete all…' }))
    await click(within(dialog()).getByRole('button', { name: /Delete all 1 for good/ }))
    await waitFor(() => expect(mock.feedbackReports).toHaveLength(0))
    // Back to the report, Escape from the list goes back first.
    await click(within(dialog()).getByRole('button', { name: 'Back' }))
    expect(within(dialog()).getByLabelText('Title')).toBeTruthy()
  })

  it('a screenshot can be marked up by keyboard; a failed flatten drops it', async () => {
    const mock = installMockBridge()
    const img = document.createElement('canvas')
    img.width = 120
    img.height = 80
    dom.next = () => Promise.resolve(img)
    await renderApp(mock)
    const d = await open()
    expect(within(d).getByText(/drawn from the page/)).toBeTruthy()
    expect((d.querySelector('input[name="share-screenshot"]') as HTMLInputElement).disabled).toBe(false)
    expect((d.querySelector('input[name="share-screenshot"]') as HTMLInputElement).checked).toBe(false)
    await click(within(d).getByRole('button', { name: 'Mark up…' }))
    // The keyboard path: choose Redaction, Add, then place it with the fields.
    await click(within(dialog()).getByRole('button', { name: 'Redaction' }))
    await click(within(dialog()).getByRole('button', { name: 'Add redaction' }))
    const row = dialog().querySelector<HTMLElement>('[data-shape-row="1"]')!
    expect(row.getAttribute('aria-label')).toBe('1: Redaction')
    const left = within(row).getByLabelText('Shape 1 left in pixels') as HTMLInputElement
    expect(left.value).toBe('45')
    fireEvent.change(left, { target: { value: '10' } })
    expect((within(row).getByLabelText('Shape 1 left in pixels') as HTMLInputElement).value).toBe('10')
    await click(within(dialog()).getByRole('button', { name: 'Undo' }))
    expect((within(dialog()).getByLabelText('Shape 1 left in pixels') as HTMLInputElement).value).toBe('45')
    await click(within(dialog()).getByRole('button', { name: 'Redo' }))
    await click(within(dialog()).getByRole('button', { name: 'Rectangle' }))
    await click(within(dialog()).getByRole('button', { name: 'Add rectangle' }))
    const rows = (): (string | null)[] => [...dialog().querySelectorAll('[data-shape-row]')].map((li) => li.getAttribute('aria-label'))
    expect(rows()).toEqual(['1: Redaction', '2: Rectangle'])
    await click(within(dialog()).getByRole('button', { name: 'Delete shape 2' }))
    expect(rows()).toEqual(['1: Redaction'])
    // jsdom has no 2D canvas: flattening fails, so the screenshot goes.
    await click(within(dialog()).getByRole('button', { name: 'Done' }))
    expect(within(dialog()).getByRole('alert').textContent).toMatch(/screenshot was dropped/)
    expect(within(dialog()).queryByRole('button', { name: 'Mark up…' })).toBeNull()
    fireEvent.change(within(dialog()).getByLabelText('Title'), { target: { value: 't' } })
    await click(within(dialog()).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mock.feedbackReports).toHaveLength(1))
    expect(mock.feedbackReports[0].png).toBeNull()
    expect(mock.feedbackReports[0].report.capture.status).toBe('removed')
    expect(mock.feedbackReports[0].report.annotations).toEqual([])
  })

  it('Escape while the screenshot is taken opens no dialog', async () => {
    const mock = installMockBridge()
    let release!: () => void
    mock.feedbackCapture = () => new Promise((r) => (release = () => r({ ...mock.nativeCapture })))
    await renderApp(mock)
    await click(feedbackButton())
    expect(feedbackButton().getAttribute('aria-busy')).toBe('true')
    await key({ key: 'Escape' })
    await act(async () => release())
    await flush()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('is a non-modal panel docked bottom-right: no scrim, nothing inert, the app usable behind it with the text kept', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    const d = await open()
    expect(d.getAttribute('aria-modal')).toBe('false')
    expect(document.querySelector('.modal-backdrop')).toBeNull()
    expect(document.querySelectorAll('[inert]')).toHaveLength(0)
    // jsdom's window is 1024 by 768: 420 px wide, 16 px from the right and bottom.
    expect([d.style.left, d.style.top, d.style.width, d.style.height]).toEqual(['588px', '112px', '420px', '640px'])
    fireEvent.change(within(d).getByLabelText('Title'), { target: { value: 'Typed while looking' } })
    // The app behind: another view, and a shortcut the panel used to swallow (About).
    await goTo('results')
    expect(document.querySelector('nav[aria-label="Views"] button[data-view="results"]')!.getAttribute('aria-current')).toBe('page')
    expect(dialog()).toBe(d)
    expect((within(d).getByLabelText('Title') as HTMLInputElement).value).toBe('Typed while looking')
    // Tab is not trapped: the panel's last control does not wrap to its first.
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    within(d).getByRole('button', { name: 'Resize panel' }).dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(false)
    await act(async () => mock.emitMenu('about'))
    expect(screen.getByRole('dialog', { name: 'About FASTag' })).toBeTruthy()
  })

  it('moves by dragging its title bar, stays in the window, and keeps its place for the session', async () => {
    await renderApp(installMockBridge())
    let d = await open()
    const bar = d.querySelector<HTMLElement>('.fb-bar')!
    await act(async () => {
      fireEvent.pointerDown(bar, { clientX: 700, clientY: 130, button: 0, pointerId: 1 })
      fireEvent.pointerMove(bar, { clientX: 500, clientY: 80, pointerId: 1 })
      fireEvent.pointerUp(bar, { clientX: 500, clientY: 80, pointerId: 1 })
    })
    expect([d.style.left, d.style.top]).toEqual(['388px', '62px'])
    // Far past the top-left corner: it stops at the window's edge.
    await act(async () => {
      fireEvent.pointerDown(bar, { clientX: 500, clientY: 80, button: 0, pointerId: 1 })
      fireEvent.pointerMove(bar, { clientX: -4000, clientY: -4000, pointerId: 1 })
      fireEvent.pointerUp(bar, { pointerId: 1 })
    })
    expect([d.style.left, d.style.top]).toEqual(['0px', '0px'])
    // A drag that starts on a field or a button of the bar does not move it.
    await act(async () => {
      fireEvent.pointerDown(within(d).getByRole('button', { name: 'Close Feedback' }), { clientX: 10, clientY: 10, button: 0, pointerId: 1 })
      fireEvent.pointerMove(bar, { clientX: 300, clientY: 300, pointerId: 1 })
    })
    expect([d.style.left, d.style.top]).toEqual(['0px', '0px'])
    await click(within(d).getByRole('button', { name: 'Close' }))
    d = await open()
    expect([d.style.left, d.style.top]).toEqual(['0px', '0px'])
  })

  it('moves and resizes by keyboard, announced', async () => {
    await renderApp(installMockBridge())
    const d = await open()
    const move = within(d).getByRole('button', { name: 'Move panel' })
    move.focus()
    await key({ key: 'ArrowLeft' }, move)
    expect(d.style.left).toBe('572px')
    await key({ key: 'ArrowUp', shiftKey: true }, move)
    expect(d.style.top).toBe('48px')
    expect(within(d).getByText(/^Moved: 572 px from the left, 48 px from the top\.$/)).toBeTruthy()
    // Alt+arrow anywhere on the title bar.
    await key({ key: 'ArrowLeft', altKey: true }, within(d).getByRole('button', { name: 'Collapse Feedback' }))
    expect(d.style.left).toBe('556px')
    // Alt+arrow in a text field is the field's (word by word on macOS).
    const title = within(d).getByLabelText('Title')
    const k = new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true })
    title.dispatchEvent(k)
    expect(k.defaultPrevented).toBe(false)
    expect(d.style.left).toBe('556px')
    const size = within(d).getByRole('button', { name: 'Resize panel' })
    await key({ key: 'ArrowLeft' }, size)
    expect(d.style.width).toBe('404px')
    await key({ key: 'ArrowDown', shiftKey: true }, size)
    expect(d.style.height).toBe('704px')
    expect(within(d).getByText('Size: 404 by 704 px.')).toBeTruthy()
  })

  it('collapses to its title bar toward the bottom and expands with the text kept; a trigger while open expands it', async () => {
    await renderApp(installMockBridge())
    const d = await open()
    fireEvent.change(within(d).getByLabelText('Title'), { target: { value: 'Kept' } })
    const toggle = within(d).getByRole('button', { name: 'Collapse Feedback' })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    await click(toggle)
    expect(d.classList.contains('collapsed')).toBe(true)
    expect((d.querySelector('#fb-body') as HTMLElement).hidden).toBe(true)
    expect(d.style.height).toBe('')
    // The bar (44 px when unmeasured) keeps the panel's bottom edge.
    expect(d.style.top).toBe(`${768 - 16 - 44}px`)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.getAttribute('aria-label')).toBe('Expand Feedback')
    await click(toggle)
    expect([d.style.top, d.style.height]).toEqual(['112px', '640px'])
    expect((within(d).getByLabelText('Title') as HTMLInputElement).value).toBe('Kept')
    // Collapsed, then the Feedback button again: expanded, focus in the panel.
    await click(toggle)
    feedbackButton().focus()
    await click(feedbackButton())
    await act(() => new Promise((r) => setTimeout(r, 0)))
    expect(d.classList.contains('collapsed')).toBe(false)
    expect(document.activeElement).toBe(within(d).getByLabelText('Title'))
  })

  it('Escape closes only from inside the panel; F6 goes between the panel and the app', async () => {
    await renderApp(installMockBridge())
    const d = await open()
    const title = within(d).getByLabelText('Title')
    // F6 from the panel: back to the app (the Feedback button had focus).
    await key({ key: 'F6' }, title)
    expect(document.activeElement).toBe(feedbackButton())
    // Escape in the app leaves the panel open.
    await act(async () => {
      fireEvent.pointerDown(feedbackButton())
    })
    await key({ key: 'Escape' }, feedbackButton())
    expect(screen.getByRole('dialog', { name: 'Feedback' })).toBe(d)
    // F6 from the app: back where focus was in the panel.
    await key({ key: 'F6' }, feedbackButton())
    expect(document.activeElement).toBe(title)
    await act(async () => {
      fireEvent.keyDown(title, { key: 'Escape' })
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(feedbackButton())
  })

  it('Retake screenshot hides the panel and captures the window, and its view, again; the old marks go, saying so', async () => {
    const mock = installMockBridge()
    const spy = vi.spyOn(mock, 'feedbackCapture')
    const first = document.createElement('canvas')
    first.width = 120
    first.height = 80
    dom.next = () => Promise.resolve(first)
    await renderApp(mock)
    const d = await open()
    expect(within(d).getByRole('img', { name: /120 by 80 pixels/ })).toBeTruthy()
    // The screen changes while the report is written.
    await goTo('results')
    let release!: () => void
    const second = document.createElement('canvas')
    second.width = 200
    second.height = 100
    dom.next = () => new Promise((r) => (release = () => r(second)))
    await click(within(d).getByRole('button', { name: 'Retake screenshot' }))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
    // Not in the new screenshot: hidden while it is taken.
    expect(d.hidden).toBe(true)
    await act(async () => release())
    await flush()
    await waitFor(() => expect(d.hidden).toBe(false))
    expect(within(d).getByRole('img', { name: /200 by 100 pixels, 0 marks/ })).toBeTruthy()
    expect(within(d).getByText('New screenshot taken.')).toBeTruthy()
    expect(document.activeElement).toBe(within(d).getByRole('button', { name: 'Retake screenshot' }))
    // jsdom cannot encode a PNG: saved without the image, with the new capture's record and view.
    await click(within(d).getByRole('button', { name: 'Remove screenshot' }))
    fireEvent.change(within(d).getByLabelText('Title'), { target: { value: 'after retake' } })
    await click(within(d).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mock.feedbackReports).toHaveLength(1))
    expect(mock.feedbackReports[0].report.capture.attempt_id).toMatch(/-2$/)
    expect(mock.feedbackReports[0].report.view).toMatchObject({ view: 'results' })
  })

  it('a cancelled retake (Esc) keeps the screenshot it had', async () => {
    const mock = installMockBridge()
    const first = document.createElement('canvas')
    first.width = 120
    first.height = 80
    dom.next = () => Promise.resolve(first)
    await renderApp(mock)
    const d = await open()
    dom.next = () => new Promise(() => {})
    await click(within(d).getByRole('button', { name: 'Retake screenshot' }))
    await waitFor(() => expect(d.hidden).toBe(true))
    await key({ key: 'Escape' })
    await flush()
    await waitFor(() => expect(d.hidden).toBe(false))
    expect(screen.getByRole('dialog', { name: 'Feedback' })).toBe(d)
    expect(within(d).getByRole('img', { name: /120 by 80 pixels/ })).toBeTruthy()
    expect(within(d).getByText(/Retake cancelled/)).toBeTruthy()
  })

  it('copy, cut, paste and select all reach every text field: nothing prevents them', async () => {
    const mock = installMockBridge()
    const img = document.createElement('canvas')
    img.width = 120
    img.height = 80
    dom.next = () => Promise.resolve(img)
    await renderApp(mock)
    const d = await open()
    // The platform's own handling: no handler of the app may cancel it.
    const untouched = (el: HTMLElement): void => {
      for (const k of ['c', 'v', 'x', 'a'])
        for (const mod of [{ metaKey: true }, { ctrlKey: true }]) {
          const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mod })
          el.dispatchEvent(e)
          expect(e.defaultPrevented, `${el.getAttribute('aria-label') ?? el.id} ${k}`).toBe(false)
        }
      for (const type of ['copy', 'cut', 'paste', 'contextmenu']) {
        const e = new Event(type, { bubbles: true, cancelable: true })
        el.dispatchEvent(e)
        expect(e.defaultPrevented, `${type} on ${el.getAttribute('aria-label') ?? el.id}`).toBe(false)
      }
    }
    const paste = (el: HTMLElement, text: string): void => {
      untouched(el)
      fireEvent.change(el, { target: { value: text } })
      expect((el as HTMLInputElement).value).toBe(text)
    }
    for (const label of ['Title', 'Description', 'Steps to reproduce', 'Expected', 'Actual']) paste(within(d).getByLabelText(label), `pasted ${label}`)
    expect(screen.getByRole('dialog', { name: 'Feedback' })).toBe(d)
    // A text label of the mark-up.
    await click(within(d).getByRole('button', { name: 'Mark up…' }))
    await click(within(d).getByRole('button', { name: 'Text label' }))
    await click(within(d).getByRole('button', { name: 'Add text label' }))
    paste(within(d).getByLabelText('Shape 1 label text'), 'pasted label')
    await click(within(d).getByRole('button', { name: 'Cancel' }))
    expect((within(d).getByLabelText('Title') as HTMLInputElement).value).toBe('pasted Title')
    // jsdom cannot encode a PNG.
    await click(within(d).getByRole('button', { name: 'Remove screenshot' }))
    await click(within(d).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(within(dialog()).getByText('Saved. Share it?')).toBeTruthy())
    expect(mock.feedbackReports[0].report).toMatchObject({ title: 'pasted Title', description: 'pasted Description', steps: 'pasted Steps to reproduce', expected: 'pasted Expected', actual: 'pasted Actual' })
    paste(within(dialog()).getByLabelText('Issue address'), 'https://github.com/okohlbacher/FASTag/issues/9')
  })
})
