// The log drawer as a component (P1 PR c). The two window tests moved here
// from p1a.test.tsx ("the log drawer"); the App-level tests still drive the
// log through a run.

import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import LogDrawer, { LOG_WINDOW, type LogDrawerProps } from './LogDrawer'
import { click } from '../testing/render'

function drawer(p: Partial<LogDrawerProps> = {}): { c: HTMLElement; props: LogDrawerProps } {
  const props: LogDrawerProps = {
    log: [],
    live: [],
    open: false,
    job: undefined,
    onToggle: vi.fn(),
    onShowLive: vi.fn(),
    logRef: createRef<HTMLPreElement>(),
    ...p
  }
  const { container } = render(<LogDrawer {...props} />)
  return { c: container, props }
}

describe('the log drawer', () => {
  it(`renders only the last ${LOG_WINDOW} lines and says how many there are`, () => {
    const log = Array.from({ length: 600 }, (_, i) => `line ${i}`)
    const { c } = drawer({ log, live: log, open: true })
    const lines = (c.querySelector('.log')?.textContent ?? '').split('\n')
    expect(lines).toHaveLength(LOG_WINDOW)
    expect(lines[0]).toBe('line 100')
    expect(lines[LOG_WINDOW - 1]).toBe('line 599')
    expect(c.querySelector('.logdrawer .n')?.textContent).toBe('600 lines')
    expect(c.querySelector('.log-window')?.textContent).toBe('Showing the last 500 of 600 lines.')
  })

  it('a short log has no window note', () => {
    const { c } = drawer({ log: ['one line'], live: ['one line'], open: true })
    expect(c.querySelector('.log')?.textContent).toBe('one line')
    expect(c.querySelector('.log-window')).toBeNull()
  })

  it('shut, it shows the last non-empty line and hides the log; the toggle asks to open', async () => {
    const { c, props } = drawer({ log: ['first', 'last', ''] })
    expect(c.querySelector('.drawer-toggle .last')?.textContent).toBe('last')
    expect(c.querySelector('.drawer-toggle .n')?.textContent).toBe('3 lines')
    expect((c.querySelector('pre.log') as HTMLElement).hidden).toBe(true)
    expect(c.querySelector('.drawer-toggle')?.getAttribute('aria-expanded')).toBe('false')
    await click(c.querySelector('.drawer-toggle')!)
    expect(props.onToggle).toHaveBeenCalledTimes(1)
  })

  it('an empty log says where output appears', () => {
    const { c } = drawer({ open: true })
    expect(c.querySelector('pre.log')?.textContent).toBe('Log output appears here.')
    expect(c.querySelector('.drawer-toggle .n')?.textContent).toBe('0 lines')
  })

  it("a batch job's log is named after its input and offers the live log", async () => {
    const { c, props } = drawer({ log: ['b: Error'], live: ['c: ok'], open: true, job: '/d/b.mzML' })
    expect(c.querySelector('.drawer-toggle .lbl')?.textContent).toBe('Log of b.mzML')
    await click(screen.getByRole('button', { name: 'Show the current log' }))
    expect(props.onShowLive).toHaveBeenCalledTimes(1)
  })

  it('the live log alone offers no "Show the current log"', () => {
    drawer({ log: ['x'], live: ['x'], open: true })
    expect(screen.queryByRole('button', { name: 'Show the current log' })).toBeNull()
    expect(document.querySelector('.drawer-toggle .lbl')?.textContent).toBe('Log')
  })
})
