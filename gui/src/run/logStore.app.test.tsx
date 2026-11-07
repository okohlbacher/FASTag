// The open P1 item closed by P2a PR r (GUI-DESIGN 7 "Log line with drawer
// open"): a Log message re-rendered the whole App, where the log state
// lived. With the log in a store outside React state, a Log batch
// re-renders the drawer and nothing else: the form, the run bar and the
// result tabs keep their render counts.

import { act, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { installMockBridge } from '../testing/mockBridge'
import { click, logText, pickSingle, renderApp, runButton } from '../testing/render'

const renders = vi.hoisted(() => ({ SetupForm: 0, RunBar: 0, ResultTabs: 0, LogDrawer: 0 }))

// Each part wrapped with a counter of its renders; what it renders is unchanged.
vi.mock('../setup/SetupForm', async (orig) => {
  const m = await orig<typeof import('../setup/SetupForm')>()
  return { ...m, default: (p: Parameters<typeof m.default>[0]) => (renders.SetupForm++, m.default(p)) }
})
vi.mock('./RunBar', async (orig) => {
  const m = await orig<typeof import('./RunBar')>()
  return { ...m, default: (p: Parameters<typeof m.default>[0]) => (renders.RunBar++, m.default(p)) }
})
vi.mock('../results/ResultTabs', async (orig) => {
  const m = await orig<typeof import('../results/ResultTabs')>()
  return { ...m, default: (p: Parameters<typeof m.default>[0]) => (renders.ResultTabs++, m.default(p)) }
})
vi.mock('./LogDrawer', async (orig) => {
  const m = await orig<typeof import('./LogDrawer')>()
  return { ...m, default: (p: Parameters<typeof m.default>[0]) => (renders.LogDrawer++, m.default(p)) }
})

describe('a Log batch re-renders only the log drawer', () => {
  it('with the drawer open, 500 lines change the drawer and leave the form, run bar and tabs alone', async () => {
    const mock = installMockBridge()
    const c = await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await click(c.querySelector('.logdrawer .drawer-toggle')!)
    expect((c.querySelector('pre.log') as HTMLElement).hidden).toBe(false)
    const before = { ...renders }
    const lines = Array.from({ length: 500 }, (_, i): [string, boolean] => [`Warning: spectrum ${i} has no charge`, true])
    await act(async () => mock.emitEvent(mock.lastRunId, { kind: 'log', lines }))
    expect(logText(c)).toContain('Warning: spectrum 499 has no charge')
    expect(renders.LogDrawer).toBeGreaterThan(before.LogDrawer)
    expect(renders.SetupForm).toBe(before.SetupForm)
    expect(renders.RunBar).toBe(before.RunBar)
    expect(renders.ResultTabs).toBe(before.ResultTabs)
    // And a single line, as a chatty phase sends them.
    const one = { ...renders }
    await act(async () => mock.emitLog('one more line'))
    expect(logText(c)).toContain('one more line')
    expect(renders.SetupForm).toBe(one.SetupForm)
    expect(renders.RunBar).toBe(one.RunBar)
    expect(renders.ResultTabs).toBe(one.ResultTabs)
  })

  it('shut, the drawer still shows the newest line in its header', async () => {
    const mock = installMockBridge()
    const c = await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await act(async () => mock.emitLog('Reading spectra'))
    expect(c.querySelector('.drawer-toggle .last')?.textContent).toBe('Reading spectra')
    expect(c.querySelector('.drawer-toggle .n')?.textContent).toBe('1 line')
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined()
  })
})
