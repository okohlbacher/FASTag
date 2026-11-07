// The log store (P2a PR r): a job's log outside React state, read with
// useSyncExternalStore, so a Log batch re-renders only what shows the log.

import { describe, expect, it, vi } from 'vitest'
import { createLogStore } from './logStore'
import { appendLog } from './useRun'
import { MAX_LOG } from '../runJob'

describe('the log store', () => {
  it('starts with the lines it is given, or none', () => {
    expect(createLogStore().get()).toEqual([])
    expect(createLogStore(['a', 'b']).get()).toEqual(['a', 'b'])
  })

  it('appends a batch at a time and keeps the same bounded tail as appendLog', () => {
    const s = createLogStore()
    let ref: string[] = []
    for (let b = 0; b < 13; b++) {
      const lines = Array.from({ length: 500 }, (_, i) => `line ${b * 500 + i}`)
      s.append(lines)
      ref = appendLog(ref, lines)
    }
    expect(s.get()).toEqual(ref)
    expect(s.get()).toHaveLength(MAX_LOG)
    expect(s.get()[0]).toBe('… earlier lines dropped …')
    expect(s.get()[MAX_LOG - 1]).toBe('line 6499')
  })

  it('a snapshot is the same array until the log changes, and is never changed after', () => {
    const s = createLogStore(['a'])
    const first = s.get()
    expect(s.get()).toBe(first)
    s.append(['b'])
    expect(s.get()).not.toBe(first)
    expect(first).toEqual(['a'])
    expect(s.get()).toEqual(['a', 'b'])
  })

  it('tells each listener once per change, and nothing for an empty batch', () => {
    const s = createLogStore()
    const l = vi.fn()
    const off = s.subscribe(l)
    s.append(['a', 'b', 'c'])
    expect(l).toHaveBeenCalledTimes(1)
    s.append([])
    expect(l).toHaveBeenCalledTimes(1)
    s.reset(['x'])
    expect(l).toHaveBeenCalledTimes(2)
    expect(s.get()).toEqual(['x'])
    off()
    s.append(['y'])
    expect(l).toHaveBeenCalledTimes(2)
  })

  it('reset with no lines empties it; resetting an empty log tells nobody', () => {
    const s = createLogStore(['a'])
    const l = vi.fn()
    s.subscribe(l)
    s.reset()
    expect(s.get()).toEqual([])
    expect(l).toHaveBeenCalledTimes(1)
    s.reset()
    expect(l).toHaveBeenCalledTimes(1)
  })

  it('counts every line appended since the last reset, also those it dropped', () => {
    const s = createLogStore(['a'])
    s.append(Array.from({ length: 6000 }, (_, i) => `l${i}`))
    expect(s.snapshot().total).toBe(6001)
    expect(s.snapshot().lines).toBe(s.get())
    expect(s.snapshot()).toBe(s.snapshot())
    s.reset(['x', 'y'])
    expect(s.snapshot()).toEqual({ lines: ['x', 'y'], total: 2 })
  })
})
