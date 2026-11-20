// Reading the reports a run wrote (moved from App.tsx, P1 PR c).

import { baseName, parseReport, value, type Report } from '../digestReport'
import { dirName, stripExt } from '../app/paths'
import { parseTable, sniffTable, type TableKind } from './tables'

/// The run that wrote a file, as the app recorded it (history.rs
/// RunRecord): its id and every output it wrote.
export interface RunOf {
  id: string
  outputs: readonly string[]
}
/// The runs the app knows the opened files by (a path's historyOf record).
export type RunsOf = ReadonlyMap<string, RunOf>
/// Two paths of one run (useRun keeps the record map behind it).
export type SameRun = (a: string, b: string) => boolean

/// Two files of one run, by the app's own record first: both recorded, the
/// same run id (or one record lists the other file among its outputs: the
/// run shown after a run is known by its outputs); one recorded, the other
/// among its outputs; neither recorded, their folder and file stems
/// (sameRunFiles).
export function sameRunIn(runs: RunsOf, a: string, b: string): boolean {
  if (a === b) return true
  const ra = runs.get(a)
  const rb = runs.get(b)
  if (ra && rb) return ra.id === rb.id || ra.outputs.includes(b) || rb.outputs.includes(a)
  if (ra) return ra.outputs.includes(b)
  if (rb) return rb.outputs.includes(a)
  return sameRunFiles(a, b)
}

// Two runs wrote the same report when the run rows they share agree and the
// files sit in one folder. run.input is only a basename (sample.mzML from two
// folders, or one file run with two tag lengths, would otherwise read as one).
// Two runs of one input in one folder differ in their run name: where both
// names have one (<stem>.<kind>.tsv), the stems must agree too. A custom
// name (qc-final.tsv) has none, and the run rows decide. A file the app
// recorded is told by its record (@p runs, sameRunIn) instead.
const RUN_KEYS = ['input', 'version', 'fragment_tolerance', 'fragment_tolerance_unit', 'tag_length', 'subsample_fraction', 'subsample_spectra']
export function sameRun(a: Report, b: Report, runs?: RunsOf): boolean {
  if (runs && (runs.has(a.path) || runs.has(b.path))) return sameRunIn(runs, a.path, b.path)
  if (dirName(a.path) !== dirName(b.path) || !RUN_KEYS.every((k) => value(a, 'run', k) === value(b, 'run', k))) return false
  const sa = runStem(a.path)
  const sb = runStem(b.path)
  return sa == null || sb == null || sa === sb
}

/// The run a file belongs to by its name, <stem>.<kind>.<ext> as the GUI
/// and the CLI name a run's outputs (a.massgap.tsv, a.recon.mzTab, and the
/// tags output's a.tags.tsv and a.tags.glyco.tsv): the stem; null for a name
/// with no kind part (recon.tsv), which only its folder places.
export function runStem(p: string): string | null {
  const parts = baseName(p).split('.')
  if (parts.length < 3) return null
  parts.splice(-2)
  if (parts.length > 1 && parts[parts.length - 1] === 'tags') parts.pop()
  return parts.join('.')
}

/// Two files of one run: one folder (the folder half of sameRun) and the
/// same stem. A name without a kind part (A.tsv, recon.tsv) has its name
/// without the extension as its stem: the tags A.tsv go with A.qc.tsv, and
/// a stem that cannot be told is another run, never any run (A's tags
/// beside B's QC would read as one run).
export function sameRunFiles(a: string, b: string): boolean {
  if (dirName(a) !== dirName(b)) return false
  if (a === b) return true
  const stem = (p: string): string => runStem(p) ?? stripExt(baseName(p))
  return stem(a) === stem(b)
}

// Read and parse whichever reports exist; a report the run did not write is
// skipped, one that cannot be read or parsed becomes a message.
export async function loadReports(paths: string[]): Promise<{ reports: Report[]; errors: string[] }> {
  const reports: Report[] = []
  const errors: string[] = []
  for (const p of paths) {
    try {
      const text = await window.fastag.report(p)
      if (text != null) reports.push(parseReport(text, p))
    } catch (e) {
      errors.push(`Cannot read ${p}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { reports, errors }
}

/// What a file the user opens holds when it is one of the wide tables
/// (results/tables.ts): its kind, or why it cannot be shown (an idXML or
/// mzIdentML -recon_id_out); null for anything else, which is read as a
/// long-form report.
/// @p head: the head when the caller has read it already (one read per open).
export async function sniffPath(path: string, head?: string | null): Promise<{ kind: TableKind } | { error: string } | null> {
  // The head only (report.rs HEAD_BYTES): the header line, the mzTab
  // prefixes and the XML root are at the start, and the file is read whole
  // once, by its viewer or loadReports.
  let text: string | null
  if (head !== undefined) text = head
  else
    try {
      text = await window.fastag.reportHead(path)
    } catch {
      return null
    }
  if (text == null) return null
  const kind = sniffTable(text)
  if (kind) return { kind }
  if (/^\s*</.test(text)) {
    try {
      parseTable(text, path)
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }
  return null
}
