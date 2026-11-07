// The species report as the backend hands it to the renderer (species.rs
// read_species), read here from a TSV for the vitest and e2e fixtures. The
// cargo test species_call_columns_of_the_real_fixture reads the same file
// through read_species and pins the same fields, so the two cannot drift.

import type { SpeciesReport, Taxon } from '../types'

// species.rs `num`: a trailing x is dropped; anything else unparsable is 0.
const num = (s: string | undefined): number => {
  const v = Number((s ?? '').trim().replace(/[xX]$/, ''))
  return Number.isFinite(v) ? v : 0
}

export function speciesFromTsv(text: string, path: string): SpeciesReport {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  const head = (lines[0] ?? '').replace(/^﻿/, '').split('\t')
  const col = (n: string): number => head.indexOf(n)
  const at = (f: string[], n: string): string | undefined => (col(n) >= 0 ? f[col(n)] : undefined)
  const taxa: Taxon[] = []
  for (const line of lines.slice(1)) {
    const f = line.split('\t')
    const qs = at(f, 'qvalue') ?? ''
    const q = qs === '' ? NaN : Number(qs)
    const t: Taxon = {
      rank: at(f, 'rank') ?? '',
      taxid: Number(at(f, 'taxid')) || 0,
      name: at(f, 'name') ?? '',
      observed: num(at(f, 'observed')),
      adjusted: num(at(f, 'adjusted')),
      q: Number.isFinite(q) ? q : 1
    }
    // FASTag 1.12 -species_call decoy appends these columns.
    const call = at(f, 'call')
    if (call !== undefined) t.call = call
    const reason = at(f, 'call_reason')
    if (reason !== undefined) t.callReason = reason
    if (t.observed > 0) taxa.push(t)
  }
  return { path, taxa }
}
