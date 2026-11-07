// The P4c tables outside their components (GUI-DESIGN 5: filters and sort
// survive tab switches). A parsed table is kept by its read (the per-table
// generation and the path, useTable), so switching back to its tab neither
// reads the file again nor parses it; its view state (filters, the sort, the
// dataset shown) is kept by the table object, so it lasts exactly as long as
// that read: a rerun or a reopen (a new generation) starts afresh.

import { useState } from 'react'
import type { AnyTable } from './tables'

// One run's four tables, and a few of the run before.
const MAX_TABLES = 6
const tables = new Map<string, AnyTable>()

/// The table read under @p key, if kept (and now the most recent).
export function keptTable(key: string): AnyTable | undefined {
  const t = tables.get(key)
  if (t) {
    tables.delete(key)
    tables.set(key, t)
  }
  return t
}

export function keepTable(key: string, t: AnyTable): void {
  tables.delete(key)
  tables.set(key, t)
  while (tables.size > MAX_TABLES) tables.delete(tables.keys().next().value as string)
}

/// Forget every table and its view state (tests: one bridge per test).
export function forgetTables(): void {
  tables.clear()
  views = new WeakMap()
}

let views = new WeakMap<object, Map<string, unknown>>()

/// useState whose value is kept with @p owner (a parsed table) under
/// @p name: a remount with the same owner starts where the last one left.
/// Without an owner it is plain useState.
export function useSticky<T>(owner: object | null | undefined, name: string, init: T | (() => T)): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    const m = owner ? views.get(owner) : undefined
    if (m && m.has(name)) return m.get(name) as T
    return typeof init === 'function' ? (init as () => T)() : init
  })
  const set = (x: T): void => {
    if (owner) {
      let m = views.get(owner)
      if (!m) views.set(owner, (m = new Map()))
      m.set(name, x)
    }
    setV(x)
  }
  return [v, set]
}
