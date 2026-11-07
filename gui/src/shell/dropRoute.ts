// Drop routing (GUI-DESIGN 2 "window-wide drop zone", P2a PR s). drop.rs
// sorts the paths of an OS drop by type and sends a DropRoute; planDrop says
// what the app does with it, and App applies the plan:
//   spectra -> the input (Setup), or the batch queue when two or more or a
//              folder (Batch); .fasta -> Database; .taxdb -> Taxonomy;
//   a tags TSV -> Results; digest, label and mass-gap reports -> the Digest
//   tab; recon and delta tables -> Mass gaps & recon, a glyco report ->
//   Glyco (P4c: the report opener sniffs which), a -recon_id_out (.mzTab;
//   .idXML and .mzid are named there) -> Mass gaps & recon; a species report -> the
//   Species tab; .sdrf.tsv -> Batch.
// Nothing is taken while FASTag runs (the Open buttons are disabled then).

import type { View } from '../setup/shortcuts'
import type { DropRoute } from '../types'

export type { DropRoute }

export interface DropPlan {
  input?: string
  batch?: string[]
  values?: Record<string, string>
  results?: string
  /// Reports for the Digest, Mass gaps & recon and Glyco tabs.
  reports: string[]
  species?: string
  view?: View
  /// What was not taken, and why, in the app's words.
  notes: string[]
}

// The report kinds a tab shows (the long-form reports in Digest; P4c: recon
// and delta in Mass gaps & recon, glyco in Glyco).
const REPORT_TABS = new Set(['digest', 'label', 'massgap', 'recon', 'delta', 'glyco', 'recon_ids'])

const base = (p: string): string => p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1)
const names = (ps: string[]): string => ps.map(base).join(', ')

/// @p ctx.queued: a batch queue exists, so spectra join it (one file too).
export function planDrop(r: DropRoute, ctx: { busy: boolean; queued?: boolean }): DropPlan {
  const plan: DropPlan = { reports: [], notes: [] }
  const all = [
    ...r.spectra,
    ...[r.fasta, r.taxdb, r.results, r.sdrf].filter((p): p is string => !!p),
    ...r.reports.map((x) => x.path)
  ]
  if (ctx.busy) {
    if (all.length) plan.notes.push(`Not added while FASTag runs: ${names(all)}.`)
    return plan
  }
  let view: View | undefined
  const land = (v: View): void => {
    // Results, then Batch, then Setup: the most specific place wins.
    const rank: Record<View, number> = { results: 3, batch: 2, setup: 1, history: 0 }
    if (!view || rank[v] > rank[view]) view = v
  }
  if (r.spectra.length && (r.batch || r.spectra.length > 1 || ctx.queued)) {
    plan.batch = r.spectra
    land('batch')
  } else if (r.spectra.length === 1) {
    plan.input = r.spectra[0]
    land('setup')
  }
  const values: Record<string, string> = {}
  if (r.fasta) values.fasta = r.fasta
  if (r.taxdb) values.taxdb = r.taxdb
  if (Object.keys(values).length) {
    plan.values = values
    land('setup')
  }
  if (r.results) {
    plan.results = r.results
    land('results')
  }
  const later: string[] = []
  for (const x of r.reports) {
    if (REPORT_TABS.has(x.kind)) plan.reports.push(x.path)
    else if (x.kind === 'species') plan.species = x.path
    else later.push(x.path)
  }
  if (plan.reports.length || plan.species) land('results')
  if (later.length) plan.notes.push(`No tab shows ${names(later)} yet; open ${later.length === 1 ? 'it' : 'them'} in a spreadsheet.`)
  if (r.sdrf) {
    plan.notes.push(`${base(r.sdrf)}: the SDRF comparison comes in a later release; the file was not read.`)
    land('batch')
  }
  if (r.ignored.length) plan.notes.push(`Not a file FASTag opens: ${names(r.ignored)}.`)
  if (view) plan.view = view
  return plan
}
