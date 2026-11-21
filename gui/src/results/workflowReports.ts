// The reports of the workflows that have a view of their own (doc/GUI-WORKFLOWS.md
// 3): the QC report, the protein shortlist with its reduced FASTA and engine
// configuration, the identifiability table or ranking, and the mass-shift
// survey's per-spectrum and accounting tables. They come from the outputs the
// backend resolved for a run (never from the form: a census path derived from
// another file's name would be another run's), or from a file the user opens,
// told by its content.

import type { ResolvedOutputs } from '../types'
import { baseName } from '../digestReport'

export interface WorkflowReports {
  qc?: string
  shortlist?: string
  /// The identifiability ranking (census_sorted_out), else the table.
  triage?: string
  /// The census run summary, shown with the triage view.
  censusSummary?: string
  /// The shortlist's reduced FASTA and engine configuration.
  files?: { label: string; path: string }[]
  deltaSpectra?: string
  deltaCounts?: string
}

export type WorkflowKind = 'qc' | 'shortlist' | 'triage' | 'censusSummary' | 'deltaSpectra' | 'deltaCounts'

/// The workflow reports among @p o, the outputs of one run.
export function workflowReportsOf(o: ResolvedOutputs): WorkflowReports {
  const files = [
    { label: 'reduced FASTA', path: o.fasta_out },
    { label: 'engine configuration', path: o.search_config_out }
  ].filter((f): f is { label: string; path: string } => !!f.path)
  const w: WorkflowReports = {}
  if (o.qc_out) w.qc = o.qc_out
  if (o.shortlist_out) w.shortlist = o.shortlist_out
  const triage = o.census_sorted_out ?? o.census_out
  if (triage) w.triage = triage
  if (o.census_summary_out) w.censusSummary = o.census_summary_out
  if (files.length) w.files = files
  if (o.delta_spectra_out) w.deltaSpectra = o.delta_spectra_out
  if (o.delta_counts_out) w.deltaCounts = o.delta_counts_out
  return w
}

/// The shortlist's reduced FASTA and engine configuration of @p w that
/// exist (@p exists), and the labels of those that do not: a file the run
/// did not write gets no Reveal button, and the Overview names it.
export async function workflowFiles(
  w: WorkflowReports,
  exists: (p: string) => Promise<boolean>
): Promise<{ files: { label: string; path: string }[]; missing: string[] }> {
  const files: { label: string; path: string }[] = []
  const missing: string[] = []
  for (const f of w.files ?? []) {
    if (await exists(f.path)) files.push(f)
    else missing.push(f.label.charAt(0).toUpperCase() + f.label.slice(1))
  }
  return { files, missing }
}

/// The paths of @p w, by kind (files excluded: workflowFiles checks them).
export function workflowPaths(w: WorkflowReports): [WorkflowKind, string][] {
  return (['qc', 'shortlist', 'triage', 'censusSummary', 'deltaSpectra', 'deltaCounts'] as const)
    .filter((k) => !!w[k])
    .map((k) => [k, w[k]!])
}

const headerOf = (text: string): string[] => {
  const line = text.split(/\r?\n/).find((l) => l !== '' && !l.startsWith('#')) ?? ''
  return line.split('\t').map((h) => h.trim())
}

/// Which workflow report @p text (the head of a file) is, by its content:
/// the QC report by its qc section, the shortlist by its comment line or
/// rank/accession header, the identifiability table by its per-spectrum
/// columns and the census summary by its census section; the survey tables
/// by their columns, or by their name (@p path) for the key/value
/// accounting. null for anything else.
export function sniffWorkflow(text: string, path = ''): WorkflowKind | null {
  const head = headerOf(text)
  const has = (...c: string[]): boolean => c.every((x) => head.includes(x))
  const sections = (): Set<string> => new Set(text.split(/\r?\n/).slice(1).map((l) => l.split('\t')[0]))
  if (has('section', 'key', 'value')) {
    const s = sections()
    if (s.has('qc')) return 'qc'
    if ([...s].some((x) => x.startsWith('census'))) return 'censusSummary'
    if (/\.delta_counts\.tsv$/i.test(baseName(path))) return 'deltaCounts'
    return null
  }
  if (/^#[^\n]*protein shortlist/i.test(text) || has('rank', 'accession', 'kept')) return 'shortlist'
  if (has('spectrum', 'status', 'n_peaks')) return 'triage'
  if (has('spectrum', 'delta', 'row', 'interp')) return 'deltaSpectra'
  if (has('key', 'value')) {
    // The accounting by its keys (FASTag.cpp -delta_counts_out): the MS2 it
    // counts and its sum checks; a renamed file is still one.
    const keys = new Set(text.split(/\r?\n/).slice(1).map((l) => l.split('\t')[0]))
    if (keys.has('ms2_placed') && keys.has('ms2_tagged') && [...keys].some((k) => k.startsWith('check_'))) return 'deltaCounts'
    return /\.delta_counts\.tsv$/i.test(baseName(path)) ? 'deltaCounts' : null
  }
  return null
}

/// A tags table (-out) by its header: spectrum and tag.
export function sniffTags(text: string): boolean {
  const head = headerOf(text)
  return head.includes('spectrum') && head.includes('tag')
}

/// A species report (-species_out) by its header: rank, taxid and name.
export function sniffSpecies(text: string): boolean {
  const head = headerOf(text)
  return ['rank', 'taxid', 'name'].every((c) => head.includes(c))
}

/// A long-form report of the Digest tab (digest, label, mass-gap,
/// alkylation): section, key and value, and none of the workflow reports.
export function sniffLongForm(text: string): boolean {
  const head = headerOf(text)
  return ['section', 'key', 'value'].every((c) => head.includes(c))
}

/// The tab a workflow report opens in.
export const TAB_OF: Record<WorkflowKind, 'qc' | 'shortlist' | 'triage' | 'recon'> = {
  qc: 'qc',
  shortlist: 'shortlist',
  triage: 'triage',
  censusSummary: 'triage',
  deltaSpectra: 'recon',
  deltaCounts: 'recon'
}
