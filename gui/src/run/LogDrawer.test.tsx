// The log drawer as a component (P1 PR c). The two window tests moved here
// from p1a.test.tsx ("the log drawer"); the App-level tests still drive the
// log through a run.

import { act, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import LogDrawer, { LOG_CHUNK, LOG_WINDOW, type LogDrawerProps } from './LogDrawer'
import { click } from '../testing/render'
import { createLogStore } from './logStore'

// The props, with the logs given as lines (the drawer reads them from log
// stores, P2a PR r).
type DrawerInit = Partial<Omit<LogDrawerProps, 'log' | 'live'>> & { log?: string[]; live?: string[] }

function drawer({ log = [], live = log, ...p }: DrawerInit = {}): { c: HTMLElement; props: LogDrawerProps } {
  const props: LogDrawerProps = {
    log: createLogStore(log),
    live: createLogStore(live),
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

  it('follows its log store: a batch appended shows without new props', () => {
    const { c, props } = drawer({ log: ['a'], open: true })
    act(() => props.log.append(['b', 'c']))
    expect(c.querySelector('pre.log')?.textContent).toBe('a\nb\nc')
    expect(c.querySelector('.drawer-toggle .n')?.textContent).toBe('3 lines')
  })

  // GUI-DESIGN 7 "Log line with drawer open" (< 1 ms per 500-line batch):
  // laying out 500 new lines in one text node cost 1.6 ms in Chromium on
  // its own, so the window is drawn in chunks of LOG_CHUNK lines numbered by
  // line, and only the last chunk is laid out eagerly; the others are
  // content-visibility: auto (index.css .log-chunk.far).
  it('draws the window in chunks of whole lines; a new line changes only the last chunk', () => {
    const log = Array.from({ length: 3 * LOG_CHUNK + 5 }, (_, i) => `line ${i}`)
    const { c, props } = drawer({ log, open: true })
    const chunks = (): HTMLElement[] => [...c.querySelectorAll<HTMLElement>('pre.log > .log-chunk')]
    const before = chunks()
    expect(before).toHaveLength(4)
    expect(before[0].textContent).toBe(log.slice(0, LOG_CHUNK).join('\n') + '\n')
    expect(before[3].textContent).toBe(log.slice(3 * LOG_CHUNK).join('\n'))
    // The chunks before the last skip layout while off screen.
    expect(before.map((e) => e.classList.contains('far'))).toEqual([true, true, true, false])
    act(() => props.log.append(['line new']))
    const after = chunks()
    expect(after.slice(0, 3)).toEqual(before.slice(0, 3))
    expect(after[0].firstChild).toBe(before[0].firstChild)
    expect(after[3].textContent).toBe(log.slice(3 * LOG_CHUNK).join('\n') + '\nline new')
  })

  it('a chunk that stops being the last one skips layout from then on', () => {
    const { c, props } = drawer({ log: Array.from({ length: LOG_CHUNK }, (_, i) => `line ${i}`), open: true })
    const first = c.querySelector('pre.log > .log-chunk')!
    expect(first.classList.contains('far')).toBe(false)
    act(() => props.log.append(['line next']))
    expect(c.querySelector('pre.log > .log-chunk')).toBe(first)
    expect(first.classList.contains('far')).toBe(true)
    expect([...c.querySelectorAll('pre.log > .log-chunk')].map((e) => e.classList.contains('far'))).toEqual([true, false])
  })

  it('as the window slides, a chunk keeps its lines: the lines that stay keep their node', () => {
    const log = Array.from({ length: LOG_WINDOW }, (_, i) => `line ${i}`)
    const { c, props } = drawer({ log, open: true })
    const chunkOf = (text: string): Element | undefined =>
      [...c.querySelectorAll('pre.log > .log-chunk')].find((e) => (e.textContent ?? '').split('\n').includes(text))
    const kept = chunkOf(`line ${LOG_WINDOW - 1}`)
    act(() => props.log.append(Array.from({ length: LOG_CHUNK }, (_, i) => `next ${i}`)))
    expect(chunkOf(`line ${LOG_WINDOW - 1}`)).toBe(kept)
    expect((c.querySelector('pre.log')?.textContent ?? '').split('\n')).toHaveLength(LOG_WINDOW)
  })
})
