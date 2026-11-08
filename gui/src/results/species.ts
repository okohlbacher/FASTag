// The ranked-taxa TSV that -species writes, parsed in the renderer
// (GUI-DESIGN 6.7, P4; it replaces species.rs read_species). The backend
// reads it as text through report_text (report.rs: size-capped, lossy UTF-8,
// regular files only), so a species TSV reopens from disk like any report.

import type { SpeciesReport, Taxon } from '../types'

// A count may carry a trailing unit (1.4x); anything else unparsable or not
// finite is 0.
const num = (s: string | undefined): number => {
  const v = Number((s ?? '').trim().replace(/[xX]+$/, ''))
  return (s ?? '').trim() !== '' && Number.isFinite(v) ? v : 0
}

/** The report in @p text (read from @p path); null when it has no lines. */
export function parseSpecies(text: string, path: string): SpeciesReport | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0) return null
  // A header re-saved with a UTF-8 BOM must still bind its first column.
  const head = lines[0].replace(/^﻿/, '').split('\t')
  const col = (n: string): number => head.indexOf(n)
  const at = (f: string[], n: string): string | undefined => (col(n) >= 0 ? (f[col(n)] ?? '') : undefined)
  const taxa: Taxon[] = []
  for (const line of lines.slice(1)) {
    const f = line.split('\t')
    const qs = (at(f, 'qvalue') ?? '').trim()
    // "NA" (1.12 #10, -species_orientation both): the analytic q-value is
    // withheld (uncalibrated), kept as null, never read as q = 1. Anything
    // else unparsable falls back to 1 as before.
    const q = qs === 'NA' ? null : qs === '' ? NaN : Number(qs)
    const id = Number((at(f, 'taxid') ?? '').trim())
    const t: Taxon = {
      rank: at(f, 'rank') ?? '',
      taxid: Number.isInteger(id) ? id : 0,
      name: at(f, 'name') ?? '',
      observed: num(at(f, 'observed')),
      adjusted: num(at(f, 'adjusted')),
      q: q === null ? null : Number.isFinite(q) ? q : 1
    }
    // FASTag 1.12 -species_call decoy (D1) appends these columns.
    const call = at(f, 'call')
    if (call !== undefined) t.call = call
    const reason = at(f, 'call_reason')
    if (reason !== undefined) t.callReason = reason
    // Only taxa with hits: the CLI writes a row for every reference taxon.
    if (t.observed > 0) taxa.push(t)
  }
  // The CLI's order (by the adjusted count): never re-ranked here.
  return { path, taxa }
}
