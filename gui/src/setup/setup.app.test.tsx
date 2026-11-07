// App-level tests of the setup form and run bar, moved unchanged from
// App.test.tsx (GUI P1 PR c), plus the wiring checks that the component
// successors (RunBar.test, useSession.test) cannot see.

import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { installMockBridge, type MockBridge } from '../testing/mockBridge'
import { addBatch, click, pickSingle, renderApp, runButton, startBatch } from '../testing/render'
import { applyLastUsed, formValue } from '../testing/lastUsed'

const emitDone = (mock: MockBridge, runId: number | undefined, ok: boolean): Promise<void> =>
  act(async () => mock.emitDone({ ok, code: ok ? 0 : 1, runId }))

describe('redesign: setup and run bar', () => {
  it('locks the form while a run is in flight and lists what the run writes and changes', async () => {
    const mock = installMockBridge()
    mock.settings.lastUsed = { tag_length: '7' }
    const container = await renderApp(mock)
    await applyLastUsed(1)
    expect(await formValue('tag_length')).toBe('7') // guard: the changed value is in the form
    await pickSingle(mock, '/d/a.mzML')
    expect(runButton().textContent).toBe('Run on a.mzML')
    await click(runButton())
    const controls = container.querySelector('.controls')!
    expect(controls.textContent).toContain('locked while FASTag runs')
    expect(controls.textContent).toContain('a.tags.tsv')
    expect(controls.textContent).toContain('-tag_length 7')
    expect(container.querySelector('#p-tag_length')).toBeNull() // no editable field mid-run
    await emitDone(mock, 1, true)
    expect(container.querySelector('#p-tag_length')).not.toBeNull()
    expect(controls.textContent).toMatch(/Last run.*a\.mzML.*Finished/)
  })

  it('counts the changed values of a section in its header, and draws a value and its unit as one control', async () => {
    const mock = installMockBridge()
    const container = await renderApp(mock)
    const tagging = screen.getByRole('button', { name: /^Tagging/ })
    expect(tagging.textContent).toMatch(/defaults$/)
    await act(async () => {
      fireEvent.change(document.getElementById('p-tag_length')!, { target: { value: '5' } })
    })
    expect(tagging.textContent).toMatch(/1 changed/)
    expect(document.getElementById('h-tag_length')!.textContent).toMatch(/Default 3 · changed$/)
    const unit = document.getElementById('p-fragment_tolerance_unit')!
    expect(unit.closest('.with-unit')?.querySelector('#p-fragment_tolerance')).not.toBeNull()
    expect(container.querySelectorAll('label[for="p-fragment_tolerance_unit"]')).toHaveLength(0)
    await act(async () => {
      fireEvent.change(unit, { target: { value: 'Da' } })
    })
    expect(tagging.textContent).toMatch(/2 changed/)
  })

  it('an inert field keeps its description and names what it needs', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await click(screen.getByRole('button', { name: /^Sequence matching/ }))
    const help = document.getElementById('h-isobaric_tolerance')!
    expect(help.textContent).toMatch(/^When matching against/)
    expect(help.textContent).toMatch(/Needs -?fasta or -?recon_out/)
    expect((document.getElementById('p-isobaric_tolerance') as HTMLInputElement).disabled).toBe(true)
  })

  it('the failure banner opens the log and copies the command line', async () => {
    const mock = installMockBridge()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const container = await renderApp(mock)
    await pickSingle(mock, '/d/my data/a.mzML')
    await click(runButton())
    await act(async () => mock.emitLog('Error: Unable to read file'))
    await emitDone(mock, 1, false)
    const alert = await screen.findByRole('alert')
    expect(alert.querySelector('code.why')?.textContent).toBe('Error: Unable to read file')
    expect((container.querySelector('pre.log') as HTMLElement).hidden).toBe(true)
    await click(screen.getByRole('button', { name: 'Show full log' }))
    expect((container.querySelector('pre.log') as HTMLElement).hidden).toBe(false)
    await click(screen.getByRole('button', { name: 'Copy command' }))
    expect(writeText).toHaveBeenCalledWith("/mock/FASTag -in '/d/my data/a.mzML' -out '/d/my data/a.tags.tsv'")
    expect(screen.getByRole('button', { name: 'Copied' })).toBeDefined()
  })

  it('Retry failed runs only the failed jobs; a cancelled job does not hide an earlier failure', async () => {
    const mock = installMockBridge()
    const container = await renderApp(mock)
    await addBatch(mock, ['/d/a.mzML', '/d/b.mzML', '/d/c.mzML'])
    await startBatch()
    await emitDone(mock, 1, false)
    await waitFor(() => expect(mock.runCalls).toHaveLength(2))
    await emitDone(mock, 2, true)
    await waitFor(() => expect(mock.runCalls).toHaveLength(3))
    await click(screen.getByRole('button', { name: 'Cancel' }))
    await act(async () => mock.emitDone({ ok: false, code: null, cancelled: true, runId: 3 }))
    expect(container.querySelector('li.job.cancelled')?.textContent).toContain('Cancelled by you')
    expect((await screen.findByRole('alert')).textContent).toMatch(/^1 of 3 batch jobs failed/)
    // The failed job is Retry failed's: only the cancelled one remains.
    expect(screen.getByRole('button', { name: 'Run 1 remaining file' })).toBeDefined()
    await click(screen.getByRole('button', { name: 'Retry failed' }))
    expect(mock.runCalls.map((c) => c.in)).toEqual(['/d/a.mzML', '/d/b.mzML', '/d/c.mzML', '/d/a.mzML'])
    await emitDone(mock, 4, true)
    expect(container.querySelector('li.job.done')?.textContent).toContain('a.mzML')
  })

  // The App-level guard of the Reset wiring (App.tsx onReset={session.reset}):
  // RunBar.test checks the confirmation with a stub, useSession.test the
  // defaults reset restores; only this test sees the two joined.
  it('Reset… asks first; Keep leaves the values, Reset restores the CLI defaults', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    const tl = (): HTMLInputElement => document.getElementById('p-tag_length') as HTMLInputElement
    await act(async () => {
      fireEvent.change(tl(), { target: { value: '6' } })
    })
    await click(screen.getByRole('button', { name: 'Reset…' }))
    await click(screen.getByRole('button', { name: 'Keep' }))
    expect(tl().value).toBe('6')
    await click(screen.getByRole('button', { name: 'Reset…' }))
    await click(screen.getByRole('button', { name: 'Reset' }))
    expect(tl().value).toBe('3')
  })

  // The App-level guard of the run bar wiring (phase={run.phase},
  // startedAt={run.startedAt}, progress={run.progress}): a phase event and the
  // time since the run started reach the run bar.
  it('a phase event and the elapsed time reach the run bar', async () => {
    const mock = installMockBridge()
    const container = await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    try {
      await click(runButton())
      await waitFor(() => expect(mock.runCalls).toHaveLength(1))
      const what = (): string => container.querySelector('.runbar .what')?.textContent ?? ''
      const pct = (): string => container.querySelector('.runbar .pct')?.textContent ?? ''
      expect(what()).toBe('Starting FASTag')
      await act(async () => mock.emitPhase('Reading spectra'))
      expect(what()).toBe('Reading spectra')
      now.mockReturnValue(1_065_000)
      await act(async () => mock.emitProgress({ done: 5, total: 0 }))
      expect(pct()).toBe('5 spectra · 1:05 elapsed')
    } finally {
      now.mockRestore()
    }
    await emitDone(mock, 1, true)
    expect(container.querySelector('.runbar .what')).toBeNull()
  })
})
