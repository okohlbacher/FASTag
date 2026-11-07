// The run bar as a component (P1 PR c): progress text, the actions and the
// Reset confirmation. "names the phase and, once measured, the time left"
// moved here from p1a.test.tsx ("the run bar"); the events that feed it are
// tested on useRun (useRun.test.tsx). "Reset… asks first" moved here from
// App.test.tsx, with the defaults it restores tested on useSession.

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import RunBar, { type RunBarProps } from './RunBar'
import { initialValues } from '../setup/useSession'
import { click } from '../testing/render'

function bar(p: Partial<RunBarProps> = {}): { c: HTMLElement; props: RunBarProps; rerender: (q: Partial<RunBarProps>) => void } {
  const base: RunBarProps = {
    announce: '',
    running: false,
    busy: false,
    batchRunning: false,
    cancelling: false,
    progress: null,
    phase: null,
    startedAt: 0,
    invalid: {},
    refused: [],
    fixes: [],
    onFix: vi.fn(),
    input: '/d/a.mzML',
    jobs: 0,
    remaining: 0,
    failedJobs: 0,
    binOk: true,
    canRun: true,
    instrument: '',
    values: initialValues(),
    onInstrument: vi.fn(),
    onRun: vi.fn(),
    onRunBatch: vi.fn(),
    onCancel: vi.fn(),
    onReset: vi.fn(),
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

  it('Reset… asks first; Keep calls nothing, Reset calls onReset', async () => {
    const { props } = bar()
    await click(screen.getByRole('button', { name: 'Reset…' }))
    await click(screen.getByRole('button', { name: 'Keep' }))
    expect(props.onReset).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Reset…' })).toBeDefined()
    await click(screen.getByRole('button', { name: 'Reset…' }))
    await click(screen.getByRole('button', { name: 'Reset' }))
    expect(props.onReset).toHaveBeenCalledTimes(1)
  })

  it('behind a batch queue: Run N remaining, and Retry failed only while idle with a failed job', async () => {
    const { props, rerender } = bar({ jobs: 3, remaining: 2, failedJobs: 1 })
    await click(screen.getByRole('button', { name: 'Run 2 remaining files' }))
    expect(props.onRunBatch).toHaveBeenCalledWith()
    await click(screen.getByRole('button', { name: 'Retry failed' }))
    expect(props.onRunBatch).toHaveBeenCalledWith('failed')
    rerender({ jobs: 3, remaining: 2, failedJobs: 1, busy: true, batchRunning: true, running: true })
    expect(screen.queryByRole('button', { name: 'Retry failed' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Running batch…' }).hasAttribute('disabled')).toBe(true)
  })

  it('Cancel is offered while busy and disabled once pressed', () => {
    const { rerender } = bar({ running: true, busy: true, startedAt: Date.now() })
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(false)
    rerender({ running: true, busy: true, startedAt: Date.now(), cancelling: true })
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByRole('button', { name: 'Reset…' })).toBeNull()
  })

  it('a value to fix blocks Run and says why', () => {
    const { c } = bar({ invalid: { tag_length: 'below 1' }, canRun: false })
    expect(c.querySelector('.preflight .warn')?.textContent).toMatch(/^1 value to fix before running: .+ \(below 1\)\.$/)
    expect(screen.getByRole('button', { name: 'Run on a.mzML' }).hasAttribute('disabled')).toBe(true)
  })

  it('the announcement is always in the page', () => {
    bar({ announce: 'Run started on a.mzML.' })
    expect(screen.getByRole('status').textContent).toBe('Run started on a.mzML.')
  })
})
