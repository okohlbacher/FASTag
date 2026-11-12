// The calls FASTag made, read from what it wrote (GUI-DESIGN 3 S3, 10 P2b;
// Q2): the protease from the digest report, the label from the label_call
// rows of -label_out (FASTag 1.12, D3a), the species from the -species report
// (with the -species_call columns of 1.12, D1), the Cys gap counts from the
// mass-gap report, and the facts of the run's log (the summary line, the
// 1.12 acquisition check line, census and activation lines).
//
// A parser, never a rule engine: a value the CLI did not write is "absent"
// or "not called", and nothing here thresholds a count into a call. What the
// CLI version can write is detected from the rows and columns present, never
// from its version string (the 1.12 integration builds still say 1.11.0).
// Pure functions, so the gate-PXD fixtures test them without the bridge.

import { num, parseRows, row, section, value, type Report } from '../digestReport'
import type { SpeciesReport, Taxon } from '../types'

// ---- the run log ----------------------------------------------------------

export interface LogFacts {
  /// "2738 MS2 spectra, 128821 tags[ -> 3464 after filtering]": the last one.
  ms2: number | null
  tags: number | null
  /// Tags left after the -fasta filter; null without one.
  afterFilter: number | null
  /// "Subsampling: tagging 3251 of 32513 input spectra".
  subsample: { tagged: number; of: number } | null
  /// "Glyco: 1318 of 2738 processed MS2 spectra carry oxonium evidence".
  glyco: { flagged: number; of: number } | null
  /// "Species: 1760 spectra contributed taxon evidence".
  speciesEvidence: number | null
  /// FASTag 1.12 (E7): "Acquisition check: DDA (why)".
  acquisition: { mode: string; why: string } | null
  /// FASTag 1.12 (F11A): "Census: 2738 MS2 spectra read, 2723 with a reported tag".
  census: { read: number; tagged: number } | null
  /// FASTag 1.12 (D1): "Species call (...): 4 present, 21 no_call, 25 not_detected".
  speciesCall: { present: number; noCall: number; notDetected: number } | null
  /// FASTag 1.12 (E15A): "Electron activation: 328 of 686 MS2 spectra were activated ...".
  electron: { electron: number; of: number } | null
  /// "Recon index: ... min tag length 8 (derived)": the shortest tag the
  /// -recon_out index places.
  reconMinLength: number | null
}

const n = (s: string): number => Number(s)

/// The facts of a run's log; a line it does not know is skipped, and a
/// repeated line (a batch log, a re-run) counts as its last occurrence.
export function parseLog(lines: readonly string[]): LogFacts {
  const f: LogFacts = {
    ms2: null,
    tags: null,
    afterFilter: null,
    subsample: null,
    glyco: null,
    speciesEvidence: null,
    acquisition: null,
    census: null,
    speciesCall: null,
    electron: null,
    reconMinLength: null
  }
  for (const raw of lines) {
    const l = raw.trim()
    let m: RegExpExecArray | null
    if ((m = /^(\d+) MS2 spectra, (\d+) tags(?: -> (\d+) after filtering)?/.exec(l))) {
      f.ms2 = n(m[1])
      f.tags = n(m[2])
      f.afterFilter = m[3] ? n(m[3]) : null
    } else if ((m = /^Subsampling: tagging (\d+) of (\d+) input spectra/.exec(l))) f.subsample = { tagged: n(m[1]), of: n(m[2]) }
    else if ((m = /^Glyco: (\d+) of (\d+) processed MS2 spectra carry oxonium/.exec(l))) f.glyco = { flagged: n(m[1]), of: n(m[2]) }
    else if ((m = /^Species: (\d+) spectra contributed taxon evidence/.exec(l))) f.speciesEvidence = n(m[1])
    else if ((m = /^Acquisition check: (\S+) \((.*)\)$/.exec(l))) f.acquisition = { mode: m[1], why: m[2] }
    else if ((m = /^Census: (\d+) MS2 spectra read, (\d+) with a reported tag/.exec(l))) f.census = { read: n(m[1]), tagged: n(m[2]) }
    else if ((m = /^Species call \([^)]*\): (\d+) present, (\d+) no_call, (\d+) not_detected/.exec(l)))
      f.speciesCall = { present: n(m[1]), noCall: n(m[2]), notDetected: n(m[3]) }
    else if ((m = /^Recon index: .*\bmin tag length (\d+)/.exec(l))) f.reconMinLength = n(m[1])
    else if ((m = /^Electron activation: (\d+) of (\d+) MS2 spectra were activated/.exec(l))) f.electron = { electron: n(m[1]), of: n(m[2]) }
  }
  return f
}

// ---- protease (digest report) ------------------------------------------------

export type ProteaseCall =
  | { state: 'call'; enzyme: string; cls?: string; runnerUp?: string; margin: number | null; ends: number | null }
  | { state: 'no_call'; reason: string; why: string }
  | { state: 'absent' }

export function proteaseCall(digest: Report | null | undefined): ProteaseCall {
  if (!digest) return { state: 'absent' }
  const st = row(digest, 'call', 'status')
  if (st?.value === 'call') {
    const runnerUp = value(digest, 'call', 'runner_up')
    return {
      state: 'call',
      enzyme: value(digest, 'call', 'model') ?? '',
      cls: value(digest, 'call', 'class'),
      runnerUp: runnerUp && runnerUp !== 'none' ? runnerUp : undefined,
      margin: num(value(digest, 'call', 'margin')),
      ends: st.n
    }
  }
  return { state: 'no_call', reason: value(digest, 'call', 'reason') ?? 'unknown', why: st?.description ?? '' }
}

// ---- label (label report, label_call rows) --------------------------------------

export type LabelCall =
  // weak: the status row says the call rests on fewer tag ends than 1.12 required
  // (1.13 -label_call_min_tags below 175), so label-free only means no rule fired.
  | { state: 'call'; label: string; basis: string; silac: string; ends: number | null; why: string; weak: boolean }
  | { state: 'no_call'; reason: string; why: string }
  // A label report without label_call rows: FASTag before 1.12 makes no call.
  | { state: 'not_called' }
  | { state: 'absent' }

export function labelCall(label: Report | null | undefined): LabelCall {
  if (!label) return { state: 'absent' }
  const st = row(label, 'label_call', 'status')
  if (!st) return { state: 'not_called' }
  if (st.value === 'call') {
    const l = row(label, 'label_call', 'label')
    const caveat = st.description.match(/These are fewer than \d+[^.]*\./)?.[0]
    return {
      state: 'call',
      label: l?.value ?? '',
      basis: value(label, 'label_call', 'basis') ?? '',
      silac: value(label, 'label_call', 'silac') ?? '',
      ends: st.n,
      // 1.13 (backlog #8): a call from few tag ends carries a caveat in the
      // status row ("These are fewer than 175, ..."); keep it with the label.
      why: [l?.description ?? st.description, caveat].filter((x): x is string => !!x).join(' '),
      weak: caveat !== undefined
    }
  }
  return { state: 'no_call', reason: value(label, 'label_call', 'reason') ?? 'unknown', why: st.description }
}

// ---- alkylation (mass-gap report) ------------------------------------------------

export type AlkylationCall =
  // The mass-gap report's Cys gap counts, not a call. The separate
  // CLI-only -alkylation_out report is parsed in digestReport.ts.
  | { state: 'counts'; placed: number | null; zero: number | null; sites: { name: string; spectra: number | null }[] }
  // No mass-gap report: it needs reconciliation against a FASTA.
  | { state: 'absent' }

export function alkylationCall(massgap: Report | null | undefined): AlkylationCall {
  const cys = massgap ? section(massgap, 'cys') : []
  if (!massgap || cys.length === 0) return { state: 'absent' }
  return {
    state: 'counts',
    placed: num(value(massgap, 'cys', 'spectra')),
    zero: num(value(massgap, 'cys', 'zero_bin')),
    sites: cys.filter((r) => r.key !== 'spectra' && r.key !== 'zero_bin').map((r) => ({ name: r.key, spectra: num(r.value) }))
  }
}

// ---- species ----------------------------------------------------------------

export type SpeciesCall =
  // FASTag 1.12 -species_call decoy: the present taxa in the CLI's order;
  // runNoCall when every row is a no_call for one run-level reason
  // (few_spectra, low_resolution).
  | { state: 'called'; present: Taxon[]; noCall: number; notDetected: number; runNoCall: string | null }
  // No call columns: the CLI's ranking, its first row at the rank.
  | { state: 'ranked'; top: Taxon; genera: number }
  | { state: 'none' }
  | { state: 'absent' }

export function speciesCall(sp: SpeciesReport | null | undefined, rank = 'genus'): SpeciesCall {
  if (!sp) return { state: 'absent' }
  const rows = sp.taxa.filter((t) => t.rank === rank)
  if (rows.length === 0) return { state: 'none' }
  if (rows.some((t) => t.call !== undefined)) {
    const reasons = new Set(rows.map((t) => (t.call === 'no_call' ? (t.callReason ?? '') : '#')))
    const only = reasons.size === 1 ? [...reasons][0] : null
    return {
      state: 'called',
      present: rows.filter((t) => t.call === 'present'),
      noCall: rows.filter((t) => t.call === 'no_call').length,
      notDetected: rows.filter((t) => t.call === 'not_detected').length,
      runNoCall: only === 'few_spectra' || only === 'low_resolution' ? only : null
    }
  }
  // species.rs keeps the CLI's order (ranked by the adjusted count).
  return { state: 'ranked', top: rows[0], genera: rows.length }
}

// ---- run facts ------------------------------------------------------------------

export interface RunFacts {
  /// The input's instrument name (DigestReport meta instrument), if it names one.
  instrument: string | null
  tolerance: { value: number; unit: 'ppm' | 'Da' } | null
  subsampleFraction: number | null
}

/// What a report's run and meta rows say about the run.
export function runFacts(r: Report | null | undefined): RunFacts {
  if (!r) return { instrument: null, tolerance: null, subsampleFraction: null }
  const inst = value(r, 'meta', 'instrument')
  const tol = num(value(r, 'run', 'fragment_tolerance'))
  const unit = value(r, 'run', 'fragment_tolerance_unit')
  return {
    instrument: inst && inst !== '-' ? inst : null,
    tolerance: tol != null && (unit === 'ppm' || unit === 'Da') ? { value: tol, unit } : null,
    subsampleFraction: num(value(r, 'run', 'subsample_fraction'))
  }
}

// ---- census summary (FASTag 1.12 -census_summary_out, F11A) -----------------------

export interface CensusFacts {
  read: number
  /// Spectra with a reported tag: status tagged or placed.
  tagged: number
  taggedShare: number | null
  /// The run section's activation rows (RunMeta format 3, E15A), if written.
  activation: { collisional: number; electron: number; hybrid: number; unknown: number } | null
}

const share = (a: number | null, b: number | null): number | null => (a == null ? null : a + (b ?? 0))

export function censusFacts(text: string): CensusFacts | null {
  const rows = parseRows(text)
  const get = (sec: string, key: string): number | null => num(rows.find((r) => r.section === sec && r.key === key)?.value)
  const read = get('census', 'ms2_seen')
  const tagged = get('census', 'count_tagged')
  if (read == null || tagged == null) return null
  const act = ['collisional', 'electron', 'hybrid', 'unknown'].map((k) => get('run', `activation_${k}`))
  return {
    read,
    tagged: tagged + (get('census', 'count_placed') ?? 0),
    taggedShare: share(get('census', 'share_tagged'), get('census', 'share_placed')),
    activation: act.every((v) => v != null) ? { collisional: act[0]!, electron: act[1]!, hybrid: act[2]!, unknown: act[3]! } : null
  }
}
