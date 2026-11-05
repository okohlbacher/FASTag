// @ts-nocheck -- test-only file; uses node APIs and ES2022 helpers outside the app tsconfig
// The frontend half of the contracts whose backend half lives in src-tauri
// (fastag.rs run/cancel/build_args): paths, cancels and crashes.

import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { installMockBridge, type MockBridge } from '../testing/mockBridge'
import manifest from '../params.generated.json'

async function renderApp(mock: MockBridge): Promise<HTMLElement> {
  const { container } = render(<App />)
  await screen.findByText('FASTag ready')
  await act(async () => {})
  return container
}
const click = (el: Element): Promise<void> =>
  act(async () => {
    fireEvent.click(el)
  })
const logText = (c: HTMLElement): string => c.querySelector('.log')?.textContent ?? ''
const runButton = (): HTMLElement => screen.getByRole('button', { name: /^(Run( on .+)?|Running…)$/ })

describe('rust-security: working directory', () => {
  it('a bare Output name is resolved beside the input by fastag.rs, and the renderer reads the results there', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    mock.nextPickInput = '/d/a.mzML'
    await click(screen.getByRole('button', { name: /^(Choose file|Change)…$/ }))
    const outField = screen.getByLabelText(/Tags TSV/) as HTMLInputElement
    expect(outField.placeholder).toBe('tags.tsv')
    await act(async () => {
      fireEvent.change(outField, { target: { value: 'run.tags.tsv' } })
    })
    await click(runButton())
    // Sent as typed; the backend resolves it against the input's folder (its
    // cwd for the child) and hands back the resolved path as RunStarted.out.
    expect(mock.runCalls.at(-1)?.out).toBe('run.tags.tsv')
    await act(async () => mock.emitDone({ ok: true, code: 0, runId: mock.lastRunId }))
    await screen.findByText(/Showing \d+ of \d+/)
    expect(mock.resultsQueryCalls.at(-1)?.path).toBe('/d/run.tags.tsv')
  })
})

describe('rust-security: cancel exit status', () => {
  it('Child::kill = TerminateProcess(h, 1) gives code 1, yet a cancelled run logs "cancelled", not "failed (exit code 1)"', async () => {
    const mock = installMockBridge()
    const c = await renderApp(mock)
    mock.nextPickInput = '/d/a.mzML'
    await click(screen.getByRole('button', { name: /^(Choose file|Change)…$/ }))
    await click(runButton())
    await click(screen.getByRole('button', { name: /Cancel/ }))
    expect(mock.cancelCalls).toBe(1)
    await act(async () => mock.emitDone({ ok: false, code: 1, cancelled: true, message: 'cancelled', runId: mock.lastRunId }))
    expect(logText(c)).toContain('— cancelled (stopped before it finished) —')
    expect(logText(c)).not.toContain('exit code 1')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a crash by signal with no message from the backend (code null, no Cancel) is reported as "stopped before it finished"', async () => {
    const mock = installMockBridge()
    const c = await renderApp(mock)
    mock.nextPickInput = '/d/a.mzML'
    await click(screen.getByRole('button', { name: /^(Choose file|Change)…$/ }))
    await click(runButton())
    await act(async () => mock.emitDone({ ok: false, code: null, runId: mock.lastRunId }))
    expect(logText(c)).toContain('stopped before it finished')
    expect((await screen.findByRole('alert')).textContent).toContain('a.mzML failed (stopped before it finished)')
  })
})

describe('rust-security: crash cause', () => {
  it('a crash by signal names the signal fastag.rs read off the exit status', async () => {
    const mock = installMockBridge()
    const c = await renderApp(mock)
    mock.nextPickInput = '/d/a.mzML'
    await click(screen.getByRole('button', { name: /^(Choose file|Change)…$/ }))
    await click(runButton())
    await act(async () =>
      mock.emitDone({ ok: false, code: null, message: 'killed by signal 11 (SIGSEGV; the program crashed)', runId: mock.lastRunId })
    )
    expect(logText(c)).toContain('SIGSEGV')
    expect((await screen.findByRole('alert')).textContent).toContain('SIGSEGV')
  })
})

describe('rust-security: build_args allowlist vs app-managed flags', () => {
  // fastag.rs NOT_SETTABLE now lists both, so the app sends exactly one
  // -progress (cargo test build_args_progress_and_stream_are_app_managed).
  it('stream and progress are in the manifest, so the backend must manage them', () => {
    const names = (manifest.params as { name: string }[]).map((p) => p.name)
    expect(names).toContain('stream')
    expect(names).toContain('progress')
  })
})
