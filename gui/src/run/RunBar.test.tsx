// The run bar as a component (P1 PR c): progress text, the plan row and the
// actions (Reset moved to the Workflow card, doc/GUI-WORKFLOWS.md 3). "names the phase and, once measured, the time left"
// moved here from p1a.test.tsx ("the run bar"); the events that feed it are
// tested on useRun (useRun.test.tsx). "Reset… asks first" moved here from
// App.test.tsx, with the defaults it restores tested on useSession; the
// App-level test stays too (setup/setup.app.test.tsx) and guards the wiring.

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import RunBar, { type RunBarProps } from './RunBar'
import { click } from '../testing/render'

function bar(p: Partial<RunBarProps> = {}): { c: HTMLElement; props: RunBarProps; rerender: (q: Partial<RunBarProps>) => void } {
  const base: RunBarProps = {
    announce: '',
    running: false,
    busy: false,
    batchRunning: false,
    progress: null,
    phase: null,
    startedAt: 0,
    invalid: {},
    refused: [],
    fixes: [],
    onFix: vi.fn(),
    input: '/d/a.mzML',
    out: '/d/a.tags.tsv',
    jobs: 0,
    remaining: 0,
    failedJobs: 0,
    binOk: true,
    canRun: true,
    onRun: vi.fn(),
    onRunBatch: vi.fn(),
    ...p
  }
  const r = render(<RunBar {...base} />)
  return { c: r.container, props: base, rerender: (q) => r.rerender(<RunBar {...base} {...q} />) }
}

const what = (c: HTMLElement): string => c.querySelector('.runbar .what')?.textContent ?? ''
const pct = (c: HTMLElement): string => c.querySelector('.runbar .pct')?.textContent ?? ''

describe('the run bar', () => {
  it('names the phase and, once measured, the time left', () => {
    const run = { running: true, busy: true, startedAt: Date.now() }
    const { c, rerender } = bar(run)
    expect(what(c)).toBe('Starting FASTag')
    rerender({ ...run, phase: 'Reading spectra' })
    expect(what(c)).toBe('Reading spectra')
    expect(pct(c)).toMatch(/^starting…/)
    rerender({ ...run, phase: 'Tagging spectra', progress: { done: 50, total: 200, ratePerSec: null, etaSec: null } })
    expect(what(c)).toBe('Tagging spectra')
    expect(pct(c)).toMatch(/^25% · 50 of 200 spectra/)
    expect(pct(c)).not.toContain('left')
    rerender({ ...run, phase: 'Tagging spectra', progress: { done: 100, total: 200, ratePerSec: 10, etaSec: 10 } })
    expect(pct(c)).toMatch(/^50% · 100 of 200 spectra .* · about 0:10 left$/)
  })

  it('a progress without a total is an indeterminate bar with a count', () => {
    const { c } = bar({ running: true, busy: true, startedAt: Date.now(), progress: { done: 7, total: 0, ratePerSec: null, etaSec: null } })
    expect(pct(c)).toMatch(/^7 spectra/)
    expect(c.querySelector('.bar.indeterminate')?.getAttribute('aria-valuetext')).toBe('7 spectra')
  })

  it('holds only the plan row, the reasons Run waits and Run: no tolerance preset, no Reset', () => {
    bar({ plan: <p>the plan</p> })
    expect(screen.getByText('the plan')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Reset…' })).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByRole('button', { name: 'Run' })).toBeDefined()
  })

  it('behind a batch queue: Run N remaining, and Retry failed only while idle with a failed job', async () => {
    const { props, rerender } = bar({ jobs: 3, remaining: 2, failedJobs: 1 })
    // Files remain: Run is the filled button, Retry failed secondary.
    expect(screen.getByRole('button', { name: 'Run 2 remaining files' }).classList.contains('primary')).toBe(true)
    expect(screen.getByRole('button', { name: 'Retry failed' }).classList.contains('primary')).toBe(false)
    await click(screen.getByRole('button', { name: 'Run 2 remaining files' }))
    expect(props.onRunBatch).toHaveBeenCalledWith()
    await click(screen.getByRole('button', { name: 'Retry failed' }))
    expect(props.onRunBatch).toHaveBeenCalledWith('failed')
    rerender({ jobs: 3, remaining: 2, failedJobs: 1, busy: true, batchRunning: true, running: true })
    expect(screen.queryByRole('button', { name: 'Retry failed' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Running batch…' }).hasAttribute('disabled')).toBe(true)
  })

  it('after a batch with only failed files left, Retry failed is the one filled button; no Run 0', async () => {
    const { props, rerender } = bar({ jobs: 3, remaining: 0, failedJobs: 2 })
    const retry = screen.getByRole('button', { name: 'Retry failed' })
    expect(retry.classList.contains('primary')).toBe(true)
    expect(screen.queryByRole('button', { name: /^Run \d+ remaining/ })).toBeNull()
    expect(document.querySelectorAll('.runbar button.primary')).toHaveLength(1)
    await click(retry)
    expect(props.onRunBatch).toHaveBeenCalledWith('failed')
    // Nothing failed and nothing left: a disabled All files run.
    rerender({ jobs: 3, remaining: 0, failedJobs: 0 })
    expect(screen.queryByRole('button', { name: 'Retry failed' })).toBeNull()
    expect(screen.getByRole('button', { name: 'All files run' }).hasAttribute('disabled')).toBe(true)
  })

  // Cancel has one home, the run status pill in the app bar
  // (shell/TopBar.tsx, shell.app.test.tsx); the run bar keeps the progress.
  it('while busy, the bar has no Cancel of its own and Running… is not filled', () => {
    bar({ running: true, busy: true, startedAt: Date.now() })
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Running…' }).classList.contains('primary')).toBe(false)
    expect(document.querySelectorAll('.runbar button.primary, .runbar button.danger')).toHaveLength(0)
  })

  it('Run held by checks: a block never offers Run anyway; off Inputs, Review input checks goes there', async () => {
    const onReviewChecks = vi.fn()
    const { rerender } = bar({ inspectorHeld: true, canRun: false, step: 3, onReviewChecks })
    const held = (): string => document.getElementById('run-held')?.textContent ?? ''
    expect(held()).toMatch(/^Run waits for the checks before the run: fix them, or choose Run anyway beside each red flag in Inputs\./)
    await click(screen.getByRole('button', { name: 'Review input checks' }))
    expect(onReviewChecks).toHaveBeenCalledTimes(1)
    rerender({ inspectorHeld: true, canRun: false, step: 4, onReviewChecks, inspectorBlocks: 1 })
    expect(held()).toMatch(/^Run waits for the checks before the run: an input check blocks the run/)
    expect(held()).not.toContain('Run anyway')
    expect(screen.getByRole('button', { name: 'Review input checks' })).toBeDefined()
    // On Inputs the checks are on screen: no link.
    rerender({ inspectorHeld: true, canRun: false, step: 2, onReviewChecks })
    expect(screen.queryByRole('button', { name: 'Review input checks' })).toBeNull()
  })

  it('while busy or between batch jobs: no Cancel and no Reset…, the progress stays', () => {
    const { rerender } = bar({ running: true, busy: true, startedAt: Date.now(), phase: 'Tagging spectra' })
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(what(document.body)).toMatch(/Tagging spectra/)
    rerender({ running: false, busy: true, batchRunning: true, jobs: 2, remaining: 1 })
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reset…' })).toBeNull()
  })

  it('a value to fix blocks Run and says why', () => {
    const { c } = bar({ invalid: { tag_length: 'below 1' }, canRun: false })
    expect(c.querySelector('.preflight .warn')?.textContent).toMatch(/^1 value to fix before running: .+ \(below 1\)\.$/)
    expect(screen.getByRole('button', { name: 'Run' }).hasAttribute('disabled')).toBe(true)
  })

  it('the announcement is always in the page', () => {
    bar({ announce: 'Run started on a.mzML.' })
    expect(screen.getByRole('status').textContent).toBe('Run started on a.mzML.')
  })
})
