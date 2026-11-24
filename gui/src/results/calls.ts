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
  /// Under Ion series auto: "Hybrid activation: 12 of 686 MS2 spectra ...".
  hybridAuto: { hybrid: number; of: number } | null
  /// Under auto on MGF or mzPeak: "Ion series: 40 electron-activated MS2
  /// spectra were tagged as b/y ions ...".
  autoNoColumn: number | null
  /// Under cz: "Collisional activation: 300 of 686 MS2 spectra ...".
  collisionalCz: { collisional: number; of: number } | null
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
    hybridAuto: null,
    autoNoColumn: null,
    collisionalCz: null,
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
    else if ((m = /^Hybrid activation: (\d+) of (\d+) MS2 spectra/.exec(l))) f.hybridAuto = { hybrid: n(m[1]), of: n(m[2]) }
    else if ((m = /^Ion series: (\d+) electron-activated MS2 spectra were tagged as b\/y/.exec(l))) f.autoNoColumn = n(m[1])
    else if ((m = /^Collisional activation: (\d+) of (\d+) MS2 spectra/.exec(l))) f.collisionalCz = { collisional: n(m[1]), of: n(m[2]) }
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
  // (a 1.13 report made with -label_call_min_tags below 175, an option removed in 1.14), so
  // label-free only means no rule fired.
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
  // No call columns: the CLI's ranking, its first row at the rank; tied:
  // the taxa level with it on both sort keys (more than one: no single
  // leader, tiedLeaders).
  | { state: 'ranked'; top: Taxon; genera: number; tied: Taxon[]; counted: 'adjusted' | 'observed' }
  | { state: 'none' }
  | { state: 'absent' }

/// The taxa of @p rows (the CLI's order) level with the first on both
/// sort keys, the adjusted and the observed count: more than one is no
/// single leader, since the order inside the tied block is only the CLI's
/// taxid order. One helper for the Species tab and the Overview.
export function tiedLeaders(rows: readonly Taxon[]): Taxon[] {
  const top = rows[0]
  return top ? rows.filter((t) => t.adjusted === top.adjusted && t.observed === top.observed) : []
}

/// The count the ranking is by, as the Species tab and the Overview say
/// it: without -species_deconvolve the CLI writes adjusted = observed for
/// every taxon, so nothing was subtracted and the ranking is by observed
/// spectra.
export function rankedBy(taxa: readonly Taxon[]): 'adjusted' | 'observed' {
  return taxa.some((t) => t.adjusted !== t.observed) ? 'adjusted' : 'observed'
}

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
  return { state: 'ranked', top: rows[0], genera: rows.length, tied: tiedLeaders(rows), counted: rankedBy(sp.taxa) }
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

// ---- isobaric kits (QC report) ---------------------------------------------------

/// The states of a reporter_<kit> row (RunQC.cpp KitCall).
export const KIT_STATES = ['present', 'absent', 'not_assessable']

/// RunQC writes reporter_compatible_kits "none" whenever no kit is
/// compatible, also when no kit could be assessed: the reporter_<kit> states
/// tell the two apart. @p rows: the QC rows (key, value, description);
/// null when @p kits is not such a "none", else why no kit was assessable.
export function unassessedKits(kits: string | undefined, rows: Iterable<{ key: string; value: string; desc: string }>): string[] | null {
  if (kits !== 'none') return null
  const states = [...rows].filter((r) => /^reporter_/.test(r.key) && KIT_STATES.includes(r.value))
  if (states.length === 0 || !states.every((r) => r.value === 'not_assessable')) return null
  return [...new Set(states.map((r) => r.desc.replace(/^Not assessable: /, '').replace(/\.$/, '')).filter(Boolean))]
}

// ---- the kit call of qc_version 3 (RunQC.cpp decideKit) --------------------

/// The kits as their makers name them.
const KIT_WORDS: Record<string, string> = {
  tmt6plex: 'TMT 6-plex',
  tmt10plex: 'TMT 10-plex',
  tmt11plex: 'TMT 11-plex',
  tmt16plex: 'TMTpro 16-plex',
  tmt18plex: 'TMTpro 18-plex',
  itraq4plex: 'iTRAQ 4-plex',
  itraq8plex: 'iTRAQ 8-plex'
}
export const kitText = (kit: string): string => KIT_WORDS[kit] ?? kit

export interface KitCall {
  // What the run shows: the kit, "Ambiguous: A or B", "Conflict: …", "None found" or "Not assessable".
  text: string
  // The kit called, or "none"; null when there is no call (ambiguous,
  // conflict, not assessable, a kit value this GUI does not know).
  call: string | null
  // How the call was made: the label mass, the reporter channels only, or
  // neither because the two disagree (label_conflict).
  evidence: 'label_mass' | 'reporters_only' | 'label_conflict' | null
  // The report's reason, in its words.
  note: string
}

type QcGet = (key: string) => { value: string; desc: string } | undefined

/** The kit call of a QC report (reporter_kit, qc_version 3 and later):
 *  one kit, or the short list the channels leave when the label mass does
 *  not decide the family. null for an older report, which has only
 *  reporter_compatible_kits. */
export function kitCallOf(get: QcGet): KitCall | null {
  const kit = get('reporter_kit')
  if (!kit) return null
  const ev = get('reporter_family_evidence')
  const evidence = ev?.value === 'label_mass' || ev?.value === 'reporters_only' || ev?.value === 'label_conflict' ? ev.value : null
  const cands = (get('reporter_kit_candidates')?.value ?? '').split(',').map((c) => c.trim()).filter((c) => c !== '' && c !== 'none')
  const note = [kit.desc, ev?.desc].filter((t) => t && t.trim() !== '').join(' ')
  if (kit.value === 'ambiguous') return { text: `Ambiguous: ${cands.map(kitText).join(' or ') || 'no kit named'}`, call: null, evidence, note }
  if (kit.value === 'not_assessable') return { text: 'Not assessable', call: null, evidence: null, note }
  if (kit.value === 'none') return { text: 'None found', call: 'none', evidence: null, note }
  // The label mass and the channels disagree: both said, no kit called, so
  // the run neither counts towards nor flips a batch majority.
  if (kit.value === 'conflict')
    return {
      text: `Conflict: ${conflictLabel(get) ?? 'the'} label, reporters fit ${cands.map(kitText).join(' or ') || 'no kit'}`,
      call: null,
      evidence: 'label_conflict',
      note
    }
  // A kit value this GUI does not know is shown, but is no call.
  return { text: kitText(kit.value), call: Object.prototype.hasOwnProperty.call(KIT_WORDS, kit.value) ? kit.value : null, evidence, note }
}

/// The label masses of Digest::labelKeys(), by reporter_label_delta.
const LABEL_MASSES: [number, string][] = [
  [229.162932, 'TMT'],
  [304.207146, 'TMTpro'],
  [144.102063, 'iTRAQ4']
]

/// The label a conflict names: from reporter_label_delta, else from the
/// reporter_kit description ("the label mass says TMT (…").
function conflictLabel(get: QcGet): string | null {
  const delta = Number(get('reporter_label_delta')?.value)
  if (Number.isFinite(delta)) {
    const hit = LABEL_MASSES.find(([m]) => Math.abs(m - delta) < 0.01)
    if (hit) return hit[1]
  }
  return /label mass says (\S+)/.exec(get('reporter_kit')?.desc ?? '')?.[1] ?? null
}

/// How a kit call was made, in words.
export const evidenceText = (e: KitCall['evidence']): string =>
  e === 'label_mass'
    ? 'decided by the label mass on the tags'
    : e === 'reporters_only'
      ? 'from the reporter channels only; the label mass did not decide'
      : e === 'label_conflict'
        ? 'the label mass and the reporter channels disagree'
        : ''

export interface ReporterChannel {
  label: string
  // From the row's description; null when it names none.
  mz: number | null
  // Assessable MS2 with the reporter above the noise threshold; null when the
  // report gives only a rounded share (older reports, reporter_observed_*).
  seen: number | null
  // The family's assessable MS2.
  assessable: number
  // seen / assessable; null when nothing was assessable.
  share: number | null
  // Among the channels the report calls seen (reporter_observed_<family>: in
  // at least 20% of the assessable MS2); null in a report without that row.
  observed: boolean | null
}

const CHANNEL = /^reporter_channel_(.+)$/

/** The per-channel counts of a QC report (reporter_channel_<label> with
 *  its _share row), in report order; none in an older report. */
export function reporterChannels(rows: Iterable<{ key: string; value: string; n: string; desc: string }>): ReporterChannel[] {
  const list = [...rows]
  const byKey = new Map(list.map((r) => [r.key, r]))
  const num = (v: string | undefined): number | null => (v != null && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
  // reporter_observed_TMT: 126:0.7632,128C:0.7849,... (or none).
  const observedRows = list.filter((r) => r.key.startsWith('reporter_observed_'))
  const observed = new Set(observedRows.flatMap((r) => r.value.split(',').map((x) => x.split(':')[0].trim())))
  const out: ReporterChannel[] = []
  for (const r of list) {
    const m = CHANNEL.exec(r.key)
    if (!m || r.key.endsWith('_share')) continue
    const seen = num(r.value)
    if (seen == null) continue
    const mz = /m\/z ([0-9.]+)/.exec(r.desc)
    const assessable = num(r.n) ?? 0
    const sh = num(byKey.get(`${r.key}_share`)?.value)
    out.push({ label: m[1], mz: mz ? Number(mz[1]) : null, seen, assessable, share: sh ?? (assessable > 0 ? seen / assessable : null), observed: observedRows.length > 0 ? observed.has(m[1]) : null })
  }
  return out
}

/// The rows of the kit call and the channel counts: shown as the call and
/// its table, not again as key-value rows.
export const isKitCallKey = (key: string): boolean =>
  key === 'reporter_kit' || key === 'reporter_kit_candidates' || key === 'reporter_family_evidence' || key === 'reporter_label_delta' || CHANNEL.test(key)
