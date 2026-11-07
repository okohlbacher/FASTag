// A job's log (GUI-DESIGN 5 Job.log; P2a PR r): its last MAX_LOG lines,
// kept outside React state and read with useSyncExternalStore. A Log batch
// then re-renders only the parts that show the log (the drawer), not the
// App: with the log in App state every Log message re-rendered the whole
// tree, 1.6 ms per 500-line batch in Chromium against the < 1 ms target of
// section 7 (bench-1.13.0.json).
//
// Each change makes a new snapshot array, which is never changed after: a
// batch job's [Log] and the drawer can hold one while the log grows.

import { useSyncExternalStore } from 'react'
import { MAX_LOG } from '../runJob'

export const DROPPED_MARKER = '… earlier lines dropped …'

// The log keeps its last MAX_LOG lines, appended a batch at a time: the
// backend sends one Log message per flush interval. Once lines are dropped,
// the first line says so.
export function appendLog(l: readonly string[], lines: readonly string[]): string[] {
  const all = l.concat(lines)
  return all.length <= MAX_LOG ? all : [DROPPED_MARKER, ...all.slice(all.length - MAX_LOG + 1)]
}

// The log at one moment: its lines, and how many lines were appended since
// the last reset (the drawer numbers its chunks by it, so a line keeps its
// chunk while the log grows).
export interface LogSnapshot {
  lines: readonly string[]
  total: number
}

export interface LogStore {
  /// The log now; the same array until it changes.
  get(): readonly string[]
  /// The log now with its line count; the same object until it changes.
  snapshot(): LogSnapshot
  append(lines: readonly string[]): void
  /// Replace the whole log (none: empty it).
  reset(lines?: readonly string[]): void
  subscribe(listener: () => void): () => void
}

export function createLogStore(init: readonly string[] = []): LogStore {
  let snap: LogSnapshot = { lines: init.slice(), total: init.length }
  const listeners = new Set<() => void>()
  const changed = (next: LogSnapshot): void => {
    snap = next
    for (const l of listeners) l()
  }
  return {
    get: () => snap.lines,
    snapshot: () => snap,
    append(add) {
      if (add.length > 0) changed({ lines: appendLog(snap.lines, add), total: snap.total + add.length })
    },
    reset(to = []) {
      if (to.length === 0 && snap.lines.length === 0) return
      changed({ lines: to.slice(), total: to.length })
    },
    subscribe(l) {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    }
  }
}

/// The log of @p store, re-rendering the caller (and only the caller) on
/// each change.
export function useLog(store: LogStore): LogSnapshot {
  return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot)
}
