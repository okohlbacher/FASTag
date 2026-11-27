// The mass-shift tables a pooled residue matrix adds (ResidueMatrix.tsx,
// "Add tables…" and "Pool the batch"): each read through the report reader,
// parsed and reduced to the rows the matrix reads (shiftMatrix.ts sourceOf),
// a few at a time, so hundreds of tables never hold the page: between files
// the reads yield, and only the reduced rows are kept, not the text.

import { pathKey } from '../run/batch'
import { parseTable } from './tables'
import { deltaGroupOf, sourceOf, type MatrixSource } from './shiftMatrix'

/// A table read for the pool: its rows, and the -delta_group its run used
/// when the app's History recorded it (null: not recorded).
export interface PoolTable {
  source: MatrixSource
  group: number | null
}

export interface PoolRead {
  tables: PoolTable[]
  /// The files left out, with the reason.
  failed: { path: string; why: string }[]
}

/// Reads at once: enough to overlap the backend's reads, few enough that
/// the progress line moves.
const PARALLEL = 4

/// The longest stretch of parsing without a turn for the page (ms).
const YIELD_MS = 12

/// The -delta_group of the recorded run that wrote @p path; null when no
/// record names it.
export async function recordedGroup(path: string): Promise<number | null> {
  try {
    const r = await window.fastag.historyOf(path)
    return r ? deltaGroupOf(r.argv) : null
  } catch {
    return null
  }
}

/// One table for the pool, or why not.
async function readOne(path: string): Promise<PoolTable | { why: string }> {
  try {
    const [text, group] = await Promise.all([window.fastag.report(path), recordedGroup(path)])
    if (text == null) return { why: 'not found' }
    const t = parseTable(text, path)
    if (t.kind !== 'delta') return { why: `a ${t.kind} table, not a mass-shift table (-delta_out)` }
    const source = sourceOf(t)
    if (!source) return { why: 'no residues column (FASTag 1.15.1 or earlier)' }
    return { source, group }
  } catch (e) {
    return { why: e instanceof Error ? e.message : String(e) }
  }
}

/// The tables @p paths, in that order (a path given twice, as pathKey
/// compares, once); @p onProgress after each file; stops early, with what it
/// has, once @p live() is false.
export async function readPool(paths: readonly string[], onProgress?: (done: number, of: number) => void, live: () => boolean = () => true): Promise<PoolRead> {
  const seen = new Set<string>()
  const list = paths.filter((p) => {
    const k = pathKey(p)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  const got: (PoolTable | { why: string } | undefined)[] = new Array(list.length)
  let next = 0
  let done = 0
  // A read that answers at once (a cached file) chains parses without a
  // task boundary: every YIELD_MS of them, the page gets a turn.
  let since = performance.now()
  async function worker(): Promise<void> {
    while (next < list.length && live()) {
      const k = next++
      got[k] = await readOne(list[k])
      done++
      onProgress?.(done, list.length)
      if (performance.now() - since > YIELD_MS) {
        await new Promise((r) => setTimeout(r, 0))
        since = performance.now()
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, list.length) }, worker))
  const out: PoolRead = { tables: [], failed: [] }
  got.forEach((g, k) => {
    if (!g) return
    if ('why' in g) out.failed.push({ path: list[k], why: g.why })
    else out.tables.push(g)
  })
  return out
}
