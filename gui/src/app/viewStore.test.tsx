// The view store (P1 PR c): the tab and the log drawer, outside React, read
// with useSyncExternalStore. One store per App, so tests and windows never
// share it.

import { act, render } from '@testing-library/react'
import type { JSX } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createViewStore, useView, type ViewStore } from './viewStore'

describe('viewStore', () => {
  it('starts on the Tags tab with the live log shut', () => {
    expect(createViewStore().get()).toEqual({ tab: 'results', logOpen: false, logJob: null })
  })

  it('notifies once per change, not for a value it already holds, and stops after unsubscribe', () => {
    const s = createViewStore()
    const seen = vi.fn()
    const off = s.subscribe(seen)
    s.setTab('digest')
    s.setTab('digest')
    s.setLogOpen(true)
    expect(seen).toHaveBeenCalledTimes(2)
    off()
    s.setLogJob('/d/a.mzML')
    expect(seen).toHaveBeenCalledTimes(2)
    expect(s.get()).toEqual({ tab: 'digest', logOpen: true, logJob: '/d/a.mzML' })
  })

  it('a functional update reads the current state', () => {
    const s = createViewStore({ tab: 'digest' })
    s.setTab((t) => (t === 'digest' ? 'results' : t))
    expect(s.get().tab).toBe('results')
    s.setLogOpen((o) => !o)
    s.setLogOpen((o) => !o)
    expect(s.get().logOpen).toBe(false)
  })

  it('an unchanged state keeps its snapshot; a change makes a new one', () => {
    const s = createViewStore()
    const a = s.get()
    s.setTab('results')
    expect(s.get()).toBe(a)
    s.setTab('species')
    expect(s.get()).not.toBe(a)
  })

  it('two stores are independent', () => {
    const a = createViewStore()
    const b = createViewStore()
    a.setTab('species')
    expect(b.get().tab).toBe('results')
  })

  it('useView re-renders its component on a change', () => {
    const s: ViewStore = createViewStore()
    const Show = (): JSX.Element => <span>{useView(s).tab}</span>
    const { container } = render(<Show />)
    expect(container.textContent).toBe('results')
    act(() => s.setTab('species'))
    expect(container.textContent).toBe('species')
  })
})
