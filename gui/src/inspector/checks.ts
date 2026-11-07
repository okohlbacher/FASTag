// The inspector's checks (GUI-DESIGN 3 S1 "Pre-start checks", P2b): before a
// run from the CLI metadata probe (probe.ts) and the form, after a run from
// the reports and the log lines the CLI wrote. Every check states where its
// evidence comes from. Nothing here reads a spectra file, and nothing here
// makes a call the CLI did not make: an instrument is only proposed, and the
// user chooses.
//
// Levels: block (Run is disabled), flag (Run waits for "Run anyway" or the
// fix), warn (shown, Run unaffected), info.

import type { ParamValue } from '../ParamField'
import { PARAM_BY_NAME } from '../paramLayout'
import { value, type Report } from '../digestReport'
import { INSTRUMENTS, presetText } from '../setup/presets'
import { familyOf, instrumentFromReports, instrumentText, presetFor, type Family } from './instrument'
import { PROBE_FORMAT, type ProbeReport } from './probe'

export type Level = 'block' | 'flag' | 'warn' | 'info'

export interface CheckFix {
  label: string
  // An instrument preset to choose (setup/presets.ts id).
  instrument?: string
  // Run again once the fix is applied (after a run).
  rerun?: boolean
}

export interface Check {
  id: string
  level: Level
  title: string
  detail: string
  // The Help entry (faq.tsx) that explains it.
  faq: string
  // Where the evidence comes from, in words: "the probe", "the digest
  // report", "FASTag's log", "the settings".
  source: string
  fix?: CheckFix
  // A command to copy (the DIAspeXtract call for raw DIA).
  command?: string[]
}

// The instrument the inspector proposes, and from what.
export interface Detected {
  family: Family
  text: string | null
  preset: string | null
  source: string
}

export interface PreStart {
  checks: Check[]
  detected: Detected | null
  // Why the file was not checked before the run; null when it was.
  notChecked: string | null
  // The probe is running.
  pending: boolean
}

const unitOf = (values: Record<string, ParamValue>): string =>
  String(values['fragment_tolerance_unit'] || PARAM_BY_NAME.get('fragment_tolerance_unit')?.default || 'ppm')
const tolOf = (values: Record<string, ParamValue>): string => {
  const t = String(values['fragment_tolerance'] || PARAM_BY_NAME.get('fragment_tolerance')?.default || '').trim()
  // "20.0" (the manifest's default) reads as 20.
  return t !== '' && Number.isFinite(Number(t)) ? String(Number(t)) : t
}
const pct = (n: number, of: number): string => `${Math.round((100 * n) / of)}%`
const IONTRAP = INSTRUMENTS.find((p) => p.id === 'iontrap-cid')!

/// <stem>.pseudo.mzML, the name FASTag's own refusal proposes
/// (Acquisition.cpp pseudoPath): the extension is cut only inside the name.
export function pseudoPath(input: string): string {
  const slash = Math.max(input.lastIndexOf('/'), input.lastIndexOf('\\'))
  const dot = input.lastIndexOf('.')
  return `${dot > slash ? input.slice(0, dot) : input}.pseudo.mzML`
}

/// The DIAspeXtract call for a raw-DIA input.
export const diaspextract = (input: string): string[] => ['DIAspeXtract', '-in', input, '-out', pseudoPath(input)]

export const NOT_CHECKED_NO_PROBE =
  'Not checked before the run: this FASTag has no metadata probe (-probe_input). The instrument and the checks come from the reports after the run.'

/// The checks before a run of @p input with @p values. @p probe: the probe's
/// output, null when there is none (no -probe_input, or not run yet);
/// @p probeError: why the probe failed.
export function preStartChecks(o: {
  input: string
  values: Record<string, ParamValue>
  supported: boolean
  probe: ProbeReport | null
  probeError?: string | null
}): PreStart {
  const { values, probe } = o
  const checks: Check[] = []
  const unit = unitOf(values)

  // From the settings alone: needs no probe.
  if (values['species'] === true && unit === 'Da') {
    checks.push({
      id: 'da-species',
      level: 'flag',
      title: 'Species detection with a tolerance in Da',
      detail: `The fragment tolerance is ${tolOf(values)} Da. Species calls are not validated on ion-trap or other Da-tolerance data and are often wrong there.`,
      faq: 'faq-inspector',
      source: 'the settings'
    })
  }

  let notChecked: string | null = null
  if (!o.supported) notChecked = NOT_CHECKED_NO_PROBE
  else if (o.probeError) notChecked = `Not checked before the run: the probe failed (${o.probeError}).`
  else if (probe && probe.status === 'newer')
    notChecked = `Not checked before the run: the probe writes format ${probe.format}, newer than this app reads (${PROBE_FORMAT}).`
  else if (probe && probe.status !== 'ok') notChecked = 'Not checked before the run: the probe output is incomplete.'
  if (notChecked || !probe || probe.status !== 'ok') return { checks, detected: null, notChecked, pending: !notChecked }

  const sp = probe.spectra
  if (sp && sp.ms2 === 0) {
    checks.push({
      id: 'no-ms2',
      level: 'block',
      title: 'No MS2 spectra',
      detail: `The probe found ${sp.ms1 ?? 0} MS1 and no MS2 spectra. FASTag tags MS2 spectra only, so this run would write no tags.`,
      faq: 'faq-no-ms2',
      source: 'the probe'
    })
  }
  const acq = probe.acquisition
  if (acq?.refuse) {
    checks.push({
      id: 'raw-dia',
      level: 'block',
      title: 'Raw DIA: FASTag will not tag this file',
      detail: `The acquisition check calls it ${acq.mode} (${acq.why}). Its MS2 "precursors" are isolation windows that mix several peptides. Generate pseudo-DDA spectra with DIAspeXtract first (diaTracer also works for .d), then run FASTag on that file.`,
      faq: 'faq-raw-dia',
      source: 'the probe',
      command: diaspextract(probe.input ?? o.input)
    })
  } else if (acq?.warn) {
    checks.push({
      id: 'dia-like',
      level: 'warn',
      title: `Acquisition: ${acq.mode}`,
      detail: `${acq.why}. If this is raw DIA, its tags have wrong flanks and complements; generate pseudo-DDA spectra with DIAspeXtract first.`,
      faq: 'faq-raw-dia',
      source: 'the probe'
    })
  }

  const facts = probe.instrument ?? {}
  const family = familyOf(facts)
  const preset = presetFor(family)
  const detected: Detected = { family, text: instrumentText(facts), preset, source: 'the probe' }
  if (family === 'ion-trap' && unit === 'ppm') {
    checks.push({
      id: 'iontrap-ppm',
      level: 'flag',
      title: `Ion-trap MS2 with a ${tolOf(values)} ppm tolerance`,
      detail: `The probe says the MS2 of ${instrumentText(facts) ?? 'this instrument'} are read in the ion trap. A ppm tolerance finds almost no tags on ion-trap spectra; ${presetText(IONTRAP)} is the preset for them.`,
      faq: 'faq-tolerance-warning',
      source: 'the probe',
      fix: { label: `Use ${presetText(IONTRAP)}`, instrument: IONTRAP.id }
    })
  }
  // FASTag centroids profile MS2 of mzPeak input itself (-pick_profile's
  // default, legacy, as 1.11 did): only mzML and MGF input are flagged.
  const fmt = (probe.fileFormat ?? '').toLowerCase()
  if (fmt !== 'mzpeak' && sp && sp.profile != null && sp.probed && sp.profile * 2 > sp.probed) {
    checks.push({
      id: 'profile',
      level: 'flag',
      title: 'Profile MS2 spectra',
      detail: `${pct(sp.profile, sp.probed)} of the ${sp.probed.toLocaleString('en-US')} MS2 spectra probed are profile data. They give fewer tags than centroided spectra. ${
        fmt === 'mgf'
          ? 'Centroid them first, or convert the run to mzML or mzPeak.'
          : 'FASTag 1.12 centroids them itself with -pick_profile auto (an option of the command line); or centroid them first, or convert the run to mzPeak.'
      }`,
      faq: 'faq-no-tags',
      source: 'the probe'
    })
  }
  // A warning, not a red flag (a deviation from GUI-DESIGN S1, which lists
  // the stale index as one): FASTag scans the file instead, in seconds, and
  // the results are the same.
  if (probe.index && (probe.index.state === 'stale' || probe.index.state === 'absent')) {
    checks.push({
      id: 'stale-index',
      level: 'warn',
      title: probe.index.state === 'stale' ? 'The mzML index does not match the file' : 'The mzML file has no index',
      detail: 'FASTag finds the spectra by reading the whole file once more. The results are not affected; re-indexing the file (for example with OpenMS FileConverter) skips that pass.',
      faq: 'faq-stale-index',
      source: 'the probe'
    })
  }
  const act = probe.activation
  if (act && act.of > 0 && (act.electron + act.hybrid) * 100 > act.of) {
    checks.push({
      id: 'electron',
      level: 'warn',
      title: 'Electron activation',
      detail: `${(act.electron + act.hybrid).toLocaleString('en-US')} of ${act.of.toLocaleString('en-US')} MS2 spectra probed were activated by ETD, ECD or a hybrid method. FASTag reads b/y ions only, so tags from these spectra are unreliable.`,
      faq: 'faq-inspector',
      source: 'the probe'
    })
  }
  const fa = probe.fasta
  if (fa && fa.decoys === 0 && (fa.proteins ?? 0) > 0) {
    checks.push({
      id: 'fasta-decoys',
      level: 'warn',
      title: 'The FASTA has no decoys',
      detail: `${(fa.proteins ?? 0).toLocaleString('en-US')} proteins and no decoy entries. A search with these settings needs a target-decoy database, or an engine that adds the decoys.`,
      faq: 'faq-inspector',
      source: 'the probe'
    })
  }
  return { checks, detected, notChecked: null, pending: false }
}

// The log lines of a run the inspector keeps (useRun): FASTag's own words
// on the acquisition, the tolerance, the activation and the index.
export const NOTE_LINE = /^(Acquisition check: |FASTAG_REFUSED |No two peaks anywhere in this file|Electron activation: )|' is raw DIA[: ]|has no index, or one that no longer matches/

const LOWRES = /^No two peaks anywhere in this file are closer than ([\d.]+) Th/

/// The checks after a run, from its reports (the digest report's meta and
/// run rows) and the CLI lines it kept (NOTE_LINE).
export function postRunChecks(o: { reports: Report[]; notes: string[] }): { checks: Check[]; detected: Detected | null } {
  const checks: Check[] = []
  const inst = instrumentFromReports(o.reports)
  const runReport = o.reports.find((r) => value(r, 'run', 'fragment_tolerance_unit'))
  const unit = runReport ? value(runReport, 'run', 'fragment_tolerance_unit') : undefined
  const tol = runReport ? value(runReport, 'run', 'fragment_tolerance') : undefined
  const lowres = o.notes.map((l) => LOWRES.exec(l)).find((m) => m)
  const detected: Detected | null = inst
    ? { family: inst.family, text: inst.text, preset: presetFor(inst.family), source: 'the digest report' }
    : null
  const iontrapish = inst?.family === 'ion-trap' || (!!lowres && (inst == null || inst.family === 'hybrid-ion-trap' || inst.family === 'unknown'))
  if (unit === 'ppm' && iontrapish) {
    const why: string[] = []
    if (inst) {
      why.push(
        inst.family === 'ion-trap'
          ? `The digest report names the instrument ${inst.text}, an ion trap.`
          : `The digest report names the instrument ${inst.text}, which can read its MS2 in the ion trap.`
      )
    }
    if (lowres) why.push(`FASTag's log says no two peaks in the file are closer than ${Number(lowres[1]).toFixed(3)} Th, as on low-resolution (ion-trap) MS2.`)
    checks.push({
      id: 'iontrap-ppm',
      level: 'flag',
      title: `This run used ${tol ?? ''} ppm; the MS2 look like ion trap`,
      detail: `${why.join(' ')} A ppm tolerance finds almost no tags on ion-trap spectra; ${presetText(IONTRAP)} is the preset for them.`,
      faq: 'faq-tolerance-warning',
      source: [inst ? 'the digest report' : null, lowres ? "FASTag's log" : null].filter(Boolean).join(' and '),
      fix: { label: `Re-run with ${IONTRAP.tolerance} ${IONTRAP.unit}`, instrument: IONTRAP.id, rerun: true }
    })
    if (detected && !detected.preset && lowres) detected.preset = IONTRAP.id
  }
  const electron = o.notes.find((l) => l.startsWith('Electron activation: '))
  if (electron) {
    const m = /^Electron activation: (\d+) of (\d+) MS2 spectra/.exec(electron)
    checks.push({
      id: 'electron',
      level: 'warn',
      title: 'Electron activation',
      detail: m
        ? `${Number(m[1]).toLocaleString('en-US')} of ${Number(m[2]).toLocaleString('en-US')} tagged MS2 spectra were activated by ETD, ECD or a hybrid method; FASTag reads b/y ions only, so their tags and flanks are unreliable.`
        : electron,
      faq: 'faq-inspector',
      source: "FASTag's log"
    })
  }
  return { checks, detected }
}

// A run FASTag refused (exit 11, -acquisition_check refuse).
export interface Refusal {
  kind: 'raw_dia'
  input: string | null
  windows: number | null
  medianWidth: number | null
  // FASTag's own reason (the refusal message), when the log kept it.
  message: string | null
  // The DIAspeXtract call to run first.
  command: string[] | null
}

const SENTINEL = /^FASTAG_REFUSED reason=(\S+)(?: windows=(\d+))?(?: median_width=([\d.]+))?/
const REFUSAL = /^'(.*)' is raw DIA[: ]/
const PROPOSED = /e\.g\. DIAspeXtract -in (.+) -out (.+?) \(diaTracer/

/// The refusal in the kept lines of a run that exited with @p code, or null.
/// The sentinel line (FASTAG_REFUSED reason=raw_dia ...) is what decides;
/// without it, exit 11 with FASTag's raw-DIA message does.
export function refusalOf(notes: string[], code: number | null | undefined): Refusal | null {
  const s = notes.map((l) => SENTINEL.exec(l)).find((m) => m)
  const msgLine = notes.find((l) => REFUSAL.test(l)) ?? null
  if (s ? s[1] !== 'raw_dia' : !(code === 11 && msgLine)) return null
  const input = msgLine ? REFUSAL.exec(msgLine)![1] : null
  const p = msgLine ? PROPOSED.exec(msgLine) : null
  return {
    kind: 'raw_dia',
    input,
    windows: s?.[2] != null ? Number(s[2]) : null,
    medianWidth: s?.[3] != null ? Number(s[3]) : null,
    message: msgLine,
    command: p ? ['DIAspeXtract', '-in', p[1], '-out', p[2]] : input ? diaspextract(input) : null
  }
}
