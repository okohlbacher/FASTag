// Shared helpers of the App-level and component tests (GUI-DESIGN 9, P1 PR c).
// The test files had their own copies of these; one copy keeps the queries
// the tests drive the app with in step with the markup.

import { act, fireEvent, render, screen } from '@testing-library/react'
import App from '../App'
import type { MockBridge } from './mockBridge'

/// Let pending promises and the renders they cause settle.
export const flush = (): Promise<void> => act(async () => {})

/// Click inside act, waiting for what the click starts.
export const click = (el: Element): Promise<void> =>
  act(async () => {
    fireEvent.click(el)
  })

/// A keydown on @p target (the window by default), as the keyboard sends it.
export const key = (init: KeyboardEventInit, target: EventTarget = window): Promise<void> =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
  })

/// The view a control sits in (P2a shell): its top-bar button is clicked,
/// synchronously, so a getter can switch before it queries.
export type ShellView = 'setup' | 'results' | 'batch' | 'history'
export function showView(view: ShellView): void {
  const nav = document.querySelector<HTMLElement>(`nav[aria-label="Views"] button[data-view="${view}"]`)
  if (!nav || nav.getAttribute('aria-current') === 'page') return
  act(() => {
    fireEvent.click(nav)
  })
}
/// Go to @p view through the top bar, as a user does.
export const goTo = (view: ShellView): Promise<void> =>
  act(async () => {
    const nav = document.querySelector<HTMLElement>(`nav[aria-label="Views"] button[data-view="${view}"]`)
    if (nav) fireEvent.click(nav)
  })
// The view the run bar is in: Batch while there is a queue, else Setup.
const runBarView = (): ShellView =>
  (document.querySelector('.runbar')?.closest<HTMLElement>('.view')?.dataset.view as ShellView | undefined) ?? 'setup'

/// Render the whole app against the installed bridge and wait until its
/// probe has answered. @p _mock names the bridge the test installed.
export async function renderApp(_mock?: MockBridge): Promise<HTMLElement> {
  const { container } = render(<App />)
  await screen.findByText('FASTag ready')
  await flush()
  return container
}

/// Choose @p path as the single input through the input card.
export async function pickSingle(mock: MockBridge, path: string): Promise<void> {
  showView('setup')
  mock.nextPickInput = path
  await click(screen.getByRole('button', { name: /^(Choose file|Change)…$/ }))
}

/// Add @p files to the batch queue.
export async function addBatch(mock: MockBridge, files: string[]): Promise<void> {
  // The form's "Add files for a batch…" until there is a queue, then the
  // queue's own "Add…" on the Batch view.
  showView(document.querySelector('.view[data-view="batch"] li.job') ? 'batch' : 'setup')
  mock.nextPickInputs = files
  await click(screen.getByRole('button', { name: /^(Add files for a batch|Add)…$/ }))
}

/// Start the queued batch.
export const startBatch = (): Promise<void> => {
  showView('batch')
  return click(screen.getByRole('button', { name: /^Run \d+ remaining file/ }))
}

/// The single Run button, idle or running.
export const runButton = (): HTMLElement => {
  showView(runBarView())
  return screen.getByRole('button', { name: /^(Run( on .+)?|Running…)$/ })
}

/// The text of the log drawer's log.
export const logText = (c: HTMLElement): string => c.querySelector('pre.log')?.textContent ?? ''
