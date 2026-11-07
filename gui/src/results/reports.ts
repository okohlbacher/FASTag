// Reading the reports a run wrote (moved from App.tsx, P1 PR c).

import { parseReport, value, type Report } from '../digestReport'
import { dirName } from '../app/paths'
import { parseTable, sniffTable, type TableKind } from './tables'

// Two runs wrote the same report when the run rows they share agree and the
// files sit in one folder. run.input is only a basename (sample.mzML from two
// folders, or one file run with two tag lengths, would otherwise read as one).
const RUN_KEYS = ['input', 'version', 'fragment_tolerance', 'fragment_tolerance_unit', 'tag_length', 'subsample_fraction', 'subsample_spectra']
export function sameRun(a: Report, b: Report): boolean {
  return dirName(a.path) === dirName(b.path) && RUN_KEYS.every((k) => value(a, 'run', k) === value(b, 'run', k))
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
export async function sniffPath(path: string): Promise<{ kind: TableKind } | { error: string } | null> {
  let text: string | null
  try {
    text = await window.fastag.report(path)
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
