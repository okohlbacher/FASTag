// The Results pane while a run is going (GUI-DESIGN 3 S2).

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { click } from '../testing/render'
import RunningPanel from './RunningPanel'

describe('Results running state', () => {
  it('names the file and the phase, with %, counts, rate and ETA', () => {
    render(
      <RunningPanel
        input="/d/run01.mzML"
        phase="Tagging spectra"
        progress={{ done: 61204, total: 127551, ratePerSec: 1850, etaSec: 36 }}
        startedAt={Date.now() - 5000}
        cancelling={false}
        onCancel={vi.fn()}
        onShowLog={vi.fn()}
      />
    )
    const s = screen.getByRole('region', { name: 'Running' })
    expect(s.textContent).toMatch(/run01\.mzML — Tagging spectra 48%/)
    expect(s.textContent).toMatch(/61,204 \/ 127,551 · 1,850\/s · ETA 0:36/)
    const bar = screen.getByRole('progressbar', { name: 'Run progress' })
    expect(bar.getAttribute('aria-valuenow')).toBe('61204')
  })

  it('a phase without progress: an indeterminate bar, the step and the elapsed time', () => {
    render(
      <RunningPanel input="/d/a.mzML" phase="Loading the taxonomy" progress={null} startedAt={Date.now() - 65000} cancelling={false} onCancel={vi.fn()} onShowLog={vi.fn()} />
    )
    const s = screen.getByRole('region', { name: 'Running' })
    expect(s.textContent).toMatch(/a\.mzML — Loading the taxonomy/)
    expect(s.textContent).toMatch(/1:0\d elapsed/)
    expect(screen.getByRole('progressbar').hasAttribute('aria-valuenow')).toBe(false)
  })

  it('Cancel and Show log; Cancel locked while cancelling', async () => {
    const onCancel = vi.fn()
    const onShowLog = vi.fn()
    const { rerender } = render(
      <RunningPanel input="/d/a.mzML" phase={null} progress={null} startedAt={0} cancelling={false} onCancel={onCancel} onShowLog={onShowLog} />
    )
    await click(screen.getByRole('button', { name: 'Cancel' }))
    await click(screen.getByRole('button', { name: 'Show log' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onShowLog).toHaveBeenCalledTimes(1)
    rerender(<RunningPanel input="/d/a.mzML" phase={null} progress={null} startedAt={0} cancelling onCancel={onCancel} onShowLog={onShowLog} />)
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('region', { name: 'Running' }).textContent).toMatch(/Cancelling…/)
  })
})
