// Read and parse one P4c table (results/tables.ts) when its viewer is shown,
// through the same backend reader as the long-form reports (report.rs, 32 MB
// cap). A file the run did not write reads as "not written", not an error.

import { useEffect, useState } from 'react'
import { parseTable, type AnyTable, type TableKind } from './tables'

export interface TableState<T extends AnyTable = AnyTable> {
  table: T | null
  error: string | null
  loading: boolean
  /// The path was given, but the file does not exist.
  missing: boolean
}

const NONE: TableState<never> = { table: null, error: null, loading: false, missing: false }

/// @p gen: how often the table was opened (Reports.gen); a new value reads
/// the file again at the same path, as a rerun or a reopened file needs.
export function useTable<K extends TableKind>(path: string | undefined, kind: K, gen = 0): TableState<Extract<AnyTable, { kind: K }>> {
  type T = Extract<AnyTable, { kind: K }>
  const [state, setState] = useState<{ at?: string; s: TableState<T> }>({ s: NONE })
  const at = path ? `${gen}\u0000${path}` : undefined
  useEffect(() => {
    if (!path || !at) return
    let live = true
    setState({ at, s: { ...NONE, loading: true } })
    window.fastag
      .report(path)
      .then((text) => {
        if (!live) return
        if (text == null) return setState({ at, s: { ...NONE, missing: true } })
        const t = parseTable(text, path)
        if (t.kind !== kind) throw new Error(`${path} is a ${t.kind} table, not a ${kind} table`)
        setState({ at, s: { ...NONE, table: t as T } })
      })
      .catch((e: unknown) => {
        if (live) setState({ at, s: { ...NONE, error: `Cannot read ${path}: ${e instanceof Error ? e.message : String(e)}` } })
      })
    return () => {
      live = false
    }
  }, [path, at, kind])
  return path && state.at === at ? state.s : path ? { ...NONE, loading: true } : NONE
}
