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
  mock.nextPickInput = path
  await click(screen.getByRole('button', { name: /^(Choose file|Change)…$/ }))
}

/// Add @p files to the batch queue.
export async function addBatch(mock: MockBridge, files: string[]): Promise<void> {
  mock.nextPickInputs = files
  await click(screen.getByRole('button', { name: /^(Add files for a batch|Add)…$/ }))
}

/// Start the queued batch.
export const startBatch = (): Promise<void> => click(screen.getByRole('button', { name: /^Run \d+ remaining file/ }))

/// The single Run button, idle or running.
export const runButton = (): HTMLElement => screen.getByRole('button', { name: /^(Run( on .+)?|Running…)$/ })

/// The text of the log drawer's log.
export const logText = (c: HTMLElement): string => c.querySelector('pre.log')?.textContent ?? ''
