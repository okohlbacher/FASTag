// Shared helpers of the App-level and component tests (GUI-DESIGN 9, P1 PR c).
// The test files had their own copies of these; one copy keeps the queries
// the tests drive the app with in step with the markup.

import { act, fireEvent, render, screen } from '@testing-library/react'
import App from '../App'
import type { MockBridge } from './mockBridge'
import { DEFAULTS } from '../setup/tasks'

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

/// The Setup wizard's steps (doc/GUI-SETUP-WIZARD.md 2.1), by number or name.
export type SetupStep = 1 | 2 | 3 | 4 | 'Task' | 'Inputs' | 'Settings' | 'Outputs & run'
const STEP_N: Record<string, number> = { Task: 1, Inputs: 2, Settings: 3, 'Outputs & run': 4 }
/// The step Setup shows now (0 while the form is locked by a run).
export const currentStep = (): number => Number(document.querySelector('nav[aria-label="Setup steps"] button[aria-current="step"]')?.getAttribute('data-step-btn') ?? 0)
/// Confirm the selected task when none is confirmed yet (Continue).
export function confirmTask(): void {
  showView('setup')
  const locked = document.querySelector('nav[aria-label="Setup steps"] button[data-step-btn="2"]')?.getAttribute('aria-disabled') === 'true'
  const cont = document.querySelector<HTMLButtonElement>('.wizard-foot button.continue')
  if (locked && cont) act(() => void fireEvent.click(cont))
}
/// Show step @p step of Setup, synchronously (confirming the selected task
/// first when none is), so a getter can switch before it queries.
export function showStep(step: SetupStep): void {
  showView('setup')
  const n = typeof step === 'number' ? step : STEP_N[step]
  if (n > 1) confirmTask()
  const b = document.querySelector<HTMLElement>(`nav[aria-label="Setup steps"] button[data-step-btn="${n}"]`)
  if (!b || b.getAttribute('aria-current') === 'step') return
  act(() => void fireEvent.click(b))
}
/// Go to step @p step of Setup, as a user does.
export const goToStep = (step: SetupStep): Promise<void> => act(async () => showStep(step))
/// Choose workflow @p label on step 1: its tile, then Continue.
export async function chooseTask(label: string): Promise<void> {
  showStep(1)
  const tile = [...document.querySelectorAll<HTMLElement>('button.tile')].find((b) => b.querySelector('.tile-label')?.textContent === label)
  if (!tile) throw new Error(`no tile ${label}`)
  await click(tile)
  await click(screen.getByRole('button', { name: /^Continue with / }))
}

/// Render the whole app against the installed bridge and wait until its
/// probe has answered. @p _mock names the bridge the test installed.
///
/// The session starts from FASTag's own defaults. Use renderColdApp to
/// exercise the actual startup task, which adds per-residue confidence.
export async function renderApp(_mock?: MockBridge): Promise<HTMLElement> {
  const { container } = render(<App start={DEFAULTS} />)
  await screen.findByText('FASTag ready')
  await flush()
  return container
}

/// The app as it starts, without overriding its task.
export async function renderColdApp(_mock?: MockBridge): Promise<HTMLElement> {
  const { container } = render(<App />)
  await screen.findByText('FASTag ready')
  await flush()
  return container
}

/// Select the optional survey workflow explicitly, as a user does.
export async function renderCharacterizeApp(mock?: MockBridge): Promise<HTMLElement> {
  const container = await renderColdApp(mock)
  await chooseTask('Characterize a run')
  return container
}

/// The spectra file button of step 2 (Choose file… or Change…), shown.
export function fileButton(name: string | RegExp = /^(Choose file|Change)…$/): HTMLElement {
  showStep(2)
  return screen.getByRole('button', { name })
}

/// Choose @p path as the single input through the input card.
export async function pickSingle(mock: MockBridge, path: string): Promise<void> {
  showStep(2)
  mock.nextPickInput = path
  await click(screen.getByRole('button', { name: /^(Choose file|Change)…$/ }))
}

/// Add @p files to the batch queue.
export async function addBatch(mock: MockBridge, files: string[]): Promise<void> {
  // The form's "Add files for a batch…" until there is a queue, then the
  // queue's own "Add…" on the Batch view.
  const queued = !!document.querySelector('.view[data-view="batch"] li.job')
  if (queued) showView('batch')
  else showStep(2)
  // Setup's Inputs step in Batch mode.
  if (!queued) {
    const batch = screen.getByRole('radio', { name: 'Batch' }) as HTMLInputElement
    if (!batch.checked) await click(batch)
  }
  mock.nextPickInputs = files
  await click(screen.getByRole('button', { name: /^(Add files|Add)…$/ }))
}

/// The button that adds files to the batch: Setup's Inputs step in Batch
/// mode (switched to, synchronously) until there is a queue, then the
/// queue's own "Add…" on the Batch view.
export function batchAddButton(): HTMLElement {
  const queued = !!document.querySelector('.view[data-view="batch"] li.job')
  if (queued) showView('batch')
  else showStep(2)
  if (!queued) {
    const batch = screen.getByRole('radio', { name: 'Batch' }) as HTMLInputElement
    if (!batch.checked) act(() => void fireEvent.click(batch))
  }
  return screen.getByRole('button', { name: /^(Add files|Add)…$/ })
}

/// Open the Advanced group @p title of Setup (its body is built only while
/// open); a no-op when it is open or shown elsewhere.
export async function openGroup(title: string): Promise<void> {
  showStep(3)
  const sum = [...document.querySelectorAll<HTMLElement>('summary.disclosure')].find((e) => e.querySelector('.sec-title')?.textContent === title)
  if (sum && sum.getAttribute('aria-expanded') !== 'true') await click(sum)
}

/// Start the queued batch.
export const startBatch = (): Promise<void> => {
  showView('batch')
  return click(screen.getByRole('button', { name: /^Run \d+ remaining file/ }))
}

/// The single Run button, idle or running.
export const runButton = (): HTMLElement => {
  const v = runBarView()
  showView(v)
  // No run bar on step 1 of Setup.
  if (v === 'setup' && !document.querySelector('.runbar')) showStep(2)
  return screen.getByRole('button', { name: /^(Run( on .+)?|Running…)$/ })
}

/// The text of the log drawer's log.
export const logText = (c: HTMLElement): string => c.querySelector('pre.log')?.textContent ?? ''
