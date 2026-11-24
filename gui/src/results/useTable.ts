// Read and parse one P4c table (results/tables.ts) when its viewer is shown,
// through the same backend reader as the long-form reports (report.rs). A
// file the run did not write reads as "not written", not an error. A table
// read once is kept (tableStore.ts): showing its tab again reads nothing.

import { useEffect, useState } from 'react'
import { NotShownFormat, parseTable, type AnyTable, type TableKind } from './tables'
import { keepTable, keptTable } from './tableStore'

export interface TableState<T extends AnyTable = AnyTable> {
  table: T | null
  error: string | null
  loading: boolean
  /// The path was given, but the file does not exist.
  missing: boolean
  /// An identifications file in a format this viewer does not show
  /// (NotShownFormat): listed as a file, not an error.
  notShown: boolean
  /// The file is over the viewer's size limit (report.rs read_report,
  /// TOO_LARGE_PREFIX): an identifications file is then listed as a file.
  tooLarge: boolean
}

// report.rs TOO_LARGE_PREFIX: the start of the error for a file over its limit.
export const TOO_LARGE_PREFIX = 'too large to show'

const NONE: TableState<never> = { table: null, error: null, loading: false, missing: false, notShown: false, tooLarge: false }

/// @p gen: how often the table was opened (Reports.gen); a new value reads
/// the file again at the same path, as a rerun or a reopened file needs.
export function useTable<K extends TableKind>(path: string | undefined, kind: K, gen = 0): TableState<Extract<AnyTable, { kind: K }>> {
  type T = Extract<AnyTable, { kind: K }>
  const at = path ? `${kind}\u0000${gen}\u0000${path}` : undefined
  const kept = (): TableState<T> | null => {
    const t = at ? keptTable(at) : undefined
    return t && t.kind === kind ? { ...NONE, table: t as T } : null
  }
  const [state, setState] = useState<{ at?: string; s: TableState<T> }>(() => {
    const k = kept()
    return k ? { at, s: k } : { s: NONE }
  })
  useEffect(() => {
    if (!path || !at) return
    const k = kept()
    if (k) {
      setState((cur) => (cur.at === at && cur.s.table === k.table ? cur : { at, s: k }))
      return
    }
    let live = true
    setState({ at, s: { ...NONE, loading: true } })
    window.fastag
      .report(path)
      .then((text) => {
        if (!live) return
        if (text == null) return setState({ at, s: { ...NONE, missing: true } })
        const t = parseTable(text, path)
        if (t.kind !== kind) throw new Error(`${path} is a ${t.kind} table, not a ${kind} table`)
        keepTable(at, t)
        setState({ at, s: { ...NONE, table: t as T } })
      })
      .catch((e: unknown) => {
        if (!live) return
        // Only the identifications have a format not shown (idXML, mzid); XML
        // in a recon, delta or glyco table is a broken file, named in red.
        const m = e instanceof Error ? e.message : String(e)
        if (e instanceof NotShownFormat && kind === 'reconIds') setState({ at, s: { ...NONE, notShown: true } })
        else if (m.startsWith(TOO_LARGE_PREFIX)) setState({ at, s: { ...NONE, tooLarge: true, error: `Cannot show ${path} here: ${m}` } })
        else setState({ at, s: { ...NONE, error: `Cannot read ${path}: ${m}` } })
      })
    return () => {
      live = false
    }
  }, [path, at, kind])
  return path && state.at === at ? state.s : path ? { ...NONE, loading: true } : NONE
}
