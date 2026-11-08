// The Batch view's SDRF (GUI-DESIGN 3 S6, 10 P4): the file the user loaded
// (SDRF… or a drop), read as bytes and parsed without loss (sdrfTable.ts),
// the taxonomy dumps the species call uses (sdrf.rs taxonomy_dump), and the
// comparison of the batch's jobs with it (compare.ts), recomputed as jobs
// finish. The SDRF is never written.

import { useCallback, useMemo, useRef, useState } from 'react'
import type { BatchJob } from '../run/batch'
import type { JobData } from '../run/batchSummary'
import { compareSdrf, type SdrfComparison } from './compare'
import { dataRows, parseSdrf, type SdrfTable } from './sdrfTable'
import { parseTaxdump, type Taxonomy } from './taxonomy'

export interface SdrfFile {
  path: string
  table: SdrfTable
  rows: number
}

export interface SdrfState {
  file: SdrfFile | null
  error: string | null
  loading: boolean
  /// Why the organism is not compared (no taxonomy found or readable).
  taxonomyNote: string | null
  comparison: SdrfComparison | null
  load(path: string): Promise<void>
  pick(): Promise<void>
  clear(): void
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/// @p taxonomy: the session's -taxonomy_nodes and -taxonomy_names, if set.
export function useSdrf(jobs: readonly BatchJob[], data: ReadonlyMap<string, JobData>, taxonomy: { nodes?: string; names?: string }): SdrfState {
  const [file, setFile] = useState<SdrfFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [tx, setTx] = useState<Taxonomy | null>(null)
  const [taxonomyNote, setTaxonomyNote] = useState<string | null>(null)
  // The newest load wins: an earlier one that ends later is dropped.
  const seq = useRef(0)
  const taxRef = useRef(taxonomy)
  taxRef.current = taxonomy

  const load = useCallback(async (path: string): Promise<void> => {
    const n = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const [bytes, dump] = await Promise.all([
        window.fastag.sdrfRead(path),
        window.fastag.taxonomyDump(taxRef.current.nodes || undefined, taxRef.current.names || undefined).then(
          (d) => ({ d, e: null as string | null }),
          (e: unknown) => ({ d: null, e: message(e) })
        )
      ])
      if (n !== seq.current) return
      const table = parseSdrf(bytes)
      setFile({ path, table, rows: dataRows(table).length })
      setTx(dump.d ? parseTaxdump(dump.d.nodes, dump.d.names) : null)
      setTaxonomyNote(
        dump.e
          ? `The taxonomy could not be read (${dump.e}): the organism is not compared.`
          : dump.d
            ? null
            : 'No taxonomy (nodes.dmp, names.dmp) was found next to FASTag: the organism is not compared.'
      )
    } catch (e) {
      if (n === seq.current) setError(`Could not read the SDRF ${path}: ${message(e)}`)
    } finally {
      if (n === seq.current) setLoading(false)
    }
  }, [])

  const pick = useCallback(async (): Promise<void> => {
    const p = await window.fastag.pickSdrf()
    if (p) await load(p)
  }, [load])

  const clear = useCallback((): void => {
    seq.current++
    setFile(null)
    setError(null)
    setLoading(false)
    setTaxonomyNote(null)
  }, [])

  const comparison = useMemo(
    () => (file ? compareSdrf(file.table, jobs.map((j) => ({ input: j.input, status: j.status, data: data.get(j.input) })), tx) : null),
    [file, jobs, data, tx]
  )

  return { file, error, loading, taxonomyNote, comparison, load, pick, clear }
}
