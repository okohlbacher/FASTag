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
import { PROBE_FORMAT, type ProbeInstrument, type ProbeReport } from './probe'
import type { TaxonomyStatus } from '../types'
import { TAXONOMY_ASSET } from '../releaseAssets'

export type Level = 'block' | 'flag' | 'warn' | 'info'

export interface CheckFix {
  label: string
  // An instrument preset to choose (setup/presets.ts id).
  instrument?: string
  // Parameters to set instead (the form's values).
  params?: Record<string, ParamValue>
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

export const NOT_CHECKED_NO_PROBE = 'The instrument and checks come from the reports after the run.'

/// The release asset with the taxonomy k-mer index (versioned, see releaseAssets.ts).
export { TAXONOMY_ASSET }

/// The species report without its index (a fresh install: the index is a
/// separate release asset): FASTag would stop with exit 6, "-species: no
/// taxdb". Null when the index is there or not known yet.
export function noTaxdbCheck(values: Record<string, ParamValue>, taxonomy: TaxonomyStatus | null | undefined): Check | null {
  if (values['species'] !== true || !taxonomy || taxonomy.index) return null
  const explicit = String(values['taxdb'] ?? '').trim() !== ''
  const where = taxonomy.expected ? `at ${taxonomy.expected}` : 'beside FASTag (there is no taxonomy folder)'
  const how = explicit
    ? 'Point the taxonomy index field at an existing tax_k7.taxdb, or clear it to use the one beside FASTag.'
    : `Download ${TAXONOMY_ASSET} from the FASTag release page, unpack it, and copy tax_k7.taxdb from its share-FASTag-taxonomy folder into ${
        taxonomy.dir ?? 'a folder of your choice'
      }${taxonomy.fromEnv ? ' (the folder FASTAG_TAXONOMY_DIR names)' : ''}${
        /^[A-Za-z]:\\Program Files/i.test(taxonomy.dir ?? '') ? ' (writing there needs an administrator)' : ''
      } and press Check again. Or keep it in a folder of your own, set the environment variable FASTAG_TAXONOMY_DIR to that folder and start FASTag again.`
  return {
    id: 'no-taxdb',
    level: 'block',
    title: 'The species report needs the taxonomy index',
    detail: `The species report needs the taxonomy k-mer index (tax_k7.taxdb, about 1.1 GB), and it is not found ${where}. FASTag would stop with "-species: no taxdb". ${how} Or run without the species report.`,
    faq: 'faq-species-reference',
    source: 'the settings and the installed files',
    fix: { label: 'Run without the species report', params: { species: false } }
  }
}

/// ETD/ECD spectra are read as b/y ions, so their tags are unreliable:
/// under the ion series by (the default; ax, removed, reads by too), or
/// under auto on an input without activation metadata (MGF and mzPeak are
/// read as b/y). Under cz, or auto on mzML, the CLI reads them as c/z.
export function electronReadAsBy(ionSeries: unknown, input: string): boolean {
  const s = String(ionSeries ?? '').trim() || 'by'
  if (s === 'auto') return /\.(mgf|mzpeak)$/i.test(input.trim())
  return s !== 'cz'
}

/// An input without activation per spectrum: MGF and mzPeak, read as b/y
/// under Ion series auto, and without -ion_series_hybrid (mzML only).
export const noActivationMeta = (input: string): boolean => /\.(mgf|mzpeak)$/i.test(input.trim())

/// Hybrid-activated spectra (EThcD, ETciD) are read as b/y alone: under by,
/// under auto with Hybrid ion series by (the default) on mzML, and under
/// auto on MGF or mzPeak. Under cz, or auto with hybrid both on mzML, their
/// c/z ions are read too.
export function hybridReadAsByOnly(ionSeries: unknown, ionSeriesHybrid: unknown, input: string): boolean {
  const s = String(ionSeries ?? '').trim() || 'by'
  if (s === 'cz') return false
  if (s !== 'auto') return true
  if (noActivationMeta(input)) return true
  return (String(ionSeriesHybrid ?? '').trim() || 'by') !== 'both'
}

/// Which activated spectra a run of @p input with @p values reads wrongly,
/// from counts of electron- and hybrid-activated spectra.
function misread(values: Record<string, unknown>, input: string, electron: number, hybrid: number): { electron: boolean; hybrid: boolean } {
  return {
    electron: electron > 0 && electronReadAsBy(values['ion_series'], input),
    hybrid: hybrid > 0 && hybridReadAsByOnly(values['ion_series'], values['ion_series_hybrid'], input)
  }
}

/// The fix for ETD/ECD or hybrid spectra read as b/y alone. It sets the ion
/// settings only, never the tolerance. On mzML: Ion series auto (ETD/ECD
/// as c/z), with Hybrid ion series both when hybrid spectra are there
/// (the Orbitrap EThcD preset's reading). On MGF or mzPeak auto reads b/y,
/// so the fix is cz, which reads every spectrum as c/z.
function etdFix(input: string, hybrid: boolean): CheckFix {
  if (noActivationMeta(input)) return { label: 'Read every spectrum as c/z (Ion series cz)', params: { ion_series: 'cz' } }
  return hybrid
    ? { label: 'Read ETD as c/z, EThcD as both (Ion series auto, Hybrid both)', params: { ion_series: 'auto', ion_series_hybrid: 'both' } }
    : { label: 'Read ETD/ECD spectra as c/z (Ion series auto)', params: { ion_series: 'auto' } }
}

/// What to change, by input format. MGF and mzPeak carry no activation per
/// spectrum: auto reads them as b/y, and cz reads the HCD spectra of a
/// mixed run as c/z too.
function etdAdvice(input: string, hybrid: boolean): string {
  if (noActivationMeta(input))
    return 'This format carries no activation per spectrum, so Ion series auto reads them as b/y too. Set Ion series to cz if the run is all electron-activated (cz reads every spectrum as c/z, collisional ones included), or convert the run to mzML and use auto.'
  return hybrid
    ? 'Choose the Orbitrap EThcD preset under Instrument, or set Ion series to auto and Hybrid ion series to both (Advanced, Charge and ions).'
    : 'Choose the Orbitrap ETD preset under Instrument, or set Ion series to auto or cz (Advanced, Charge and ions).'
}

/// The checks before a run of @p input with @p values. @p probe: the probe's
/// output, null when there is none (no -probe_input, or not run yet);
/// @p probeError: why the probe failed; @p taxonomy: where the taxonomy index
/// is (species.rs taxonomy_status), undefined while unknown.
export function preStartChecks(o: {
  input: string
  values: Record<string, ParamValue>
  supported: boolean
  probe: ProbeReport | null
  probeError?: string | null
  taxonomy?: TaxonomyStatus | null
}): PreStart {
  const { values, probe } = o
  const checks: Check[] = []
  const unit = unitOf(values)

  // From the settings and the install: needs no probe.
  const taxdb = noTaxdbCheck(values, o.taxonomy)
  if (taxdb) checks.push(taxdb)

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

  // The species report counts b/y tags only (FASTag.cpp species_cz_excluded):
  // under Ion series cz every tag is c/z, so the report stays empty. Under
  // auto on mzML the ETD/ECD spectra are read as c/z and left out too (the
  // probe's counts say how many); on MGF and mzPeak auto stays b/y.
  const series = String(values['ion_series'] ?? '').trim()
  if (values['species'] === true && series === 'cz') {
    checks.push({
      id: 'cz-species',
      level: 'warn',
      title: 'Species detection with c/z ions',
      detail: 'Ion series cz reads every spectrum as c/z ions, and the species report counts b/y tags only: it will be empty. Use Ion series auto (ETD spectra as c/z, the others as b/y), or run species detection separately with b/y ions.',
      faq: 'faq-inspector',
      source: 'the settings'
    })
  } else if (values['species'] === true && series === 'auto' && !noActivationMeta(o.input) && probe?.status === 'ok' && probe.activation) {
    const a = probe.activation
    // Hybrid spectra keep their b/y tags (under Hybrid both as well).
    const cz = a.electron
    // Over 1% of the MS2, as the electron check and the CLI judge.
    if (a.of > 0 && cz * 100 > a.of) {
      const all = cz >= a.of - a.unknown
      checks.push({
        id: 'cz-species',
        level: 'warn',
        title: all ? 'Species detection with c/z ions' : 'Species detection leaves the ETD spectra out',
        detail: all
          ? `All ${a.of.toLocaleString('en-US')} MS2 spectra probed were activated by ETD or ECD. Ion series auto reads them as c/z ions, and the species report counts b/y tags only: it will be empty. Run species detection on a collisionally activated run instead.`
          : `${cz.toLocaleString('en-US')} of ${a.of.toLocaleString('en-US')} MS2 spectra probed were activated by ETD or ECD. Ion series auto reads them as c/z ions, and the species report counts b/y tags only, so it rests on the other ${pct(a.of - cz, a.of)}.`,
        faq: 'faq-inspector',
        source: 'the probe and the settings'
      })
    }
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
  // The probe judges under the default policy (refuse); the run uses the
  // form's DIA input setting: refuse blocks, warn tags with a warning, off
  // does not check.
  const policy = String(values['acquisition_check'] ?? '').trim() || String(PARAM_BY_NAME.get('acquisition_check')?.default ?? 'refuse')
  if (acq?.refuse && policy === 'warn') {
    checks.push({
      id: 'raw-dia',
      level: 'warn',
      title: 'Raw DIA: tagged with a warning',
      detail: `The acquisition check calls it ${acq.mode} (${acq.why}). DIA input is set to Warn, so FASTag tags it anyway, but its MS2 "precursors" are isolation windows that mix several peptides: the tags get wrong flanks and complements. Generate pseudo-DDA spectra with DIAspeXtract first (diaTracer also works for .d).`,
      faq: 'faq-raw-dia',
      source: 'the probe and the settings',
      command: diaspextract(probe.input ?? o.input)
    })
  } else if (acq?.refuse && policy === 'off') {
    checks.push({
      id: 'raw-dia',
      level: 'info',
      title: 'Raw DIA: not checked by the run',
      detail: `The probe calls it ${acq.mode} (${acq.why}). DIA input is set to Off, so the run does not check the acquisition and tags the isolation windows as precursors.`,
      faq: 'faq-raw-dia',
      source: 'the probe and the settings'
    })
  } else if (acq?.refuse) {
    checks.push({
      id: 'raw-dia',
      level: 'block',
      title: 'Raw DIA: FASTag will not tag this file',
      detail: `The acquisition check calls it ${acq.mode} (${acq.why}). Its MS2 "precursors" are isolation windows that mix several peptides. Generate pseudo-DDA spectra with DIAspeXtract first (diaTracer also works for .d), then run FASTag on that file.`,
      faq: 'faq-raw-dia',
      source: 'the probe',
      command: diaspextract(probe.input ?? o.input)
    })
  } else if (acq?.warn && policy !== 'off') {
    checks.push({
      id: 'dia-like',
      level: 'warn',
      title: `Acquisition: ${acq.mode}`,
      detail: `${acq.why}. If this is raw DIA, its tags have wrong flanks and complements; generate pseudo-DDA spectra with DIAspeXtract first.`,
      faq: 'faq-raw-dia',
      source: 'the probe'
    })
  }

  const facts: Partial<ProbeInstrument> = probe.instrument ?? {}
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
  } else if (family === 'hybrid-ion-trap' && unit === 'ppm') {
    // A hybrid whose metadata do not say where the MS2 were read (no
    // configuration per MS2, or none at all): nothing is "detected", and the
    // ppm tolerance is only questioned. FASTag's run checks the peak spacing
    // and says after the run whether the MS2 look like ion trap.
    const runDefault = facts.ms2AnalyzerFrom === 'run_default' && !!facts.ms2Analyzer
    checks.push({
      id: 'hybrid-ppm',
      level: 'warn',
      title: 'The MS2 may be read in the ion trap',
      detail: `${instrumentText(facts) ?? 'This instrument'} can read its MS2 in the ion trap or in the high-resolution analyser, and the file's metadata do not say which${
        runDefault ? ` (the run's only instrument configuration names the ${facts.ms2Analyzer}, but no MS2 spectrum references it)` : ''
      }. If they are ion-trap MS2, a ${tolOf(values)} ppm tolerance finds almost no tags; ${presetText(IONTRAP)} is the preset for them. The run checks the peak spacing and says so after it.`,
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
          : 'FASTag does not centroid profile mzML: centroid them first (e.g. msconvert with the vendor peakPicking filter), or convert the run to mzPeak, which FASTag centroids on read.'
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
  // Electron (ETD, ECD) and hybrid (EThcD, ETciD) spectra are judged
  // apart: Ion series auto reads the first as c/z on mzML, the second only
  // with Hybrid ion series both. Over 1% of the MS2, as the CLI warns.
  const act = probe.activation
  const wrong = act && act.of > 0 ? misread(values, o.input, act.electron, act.hybrid) : null
  const n = act && wrong ? (wrong.electron ? act.electron : 0) + (wrong.hybrid ? act.hybrid : 0) : 0
  if (act && wrong && n * 100 > act.of) {
    const what = wrong.electron && wrong.hybrid ? 'ETD, ECD or a hybrid method (EThcD, ETciD)' : wrong.electron ? 'ETD or ECD' : 'a hybrid method (EThcD, ETciD)'
    const how =
      series === 'auto'
        ? noActivationMeta(o.input)
          ? 'This file carries no activation per spectrum, so Ion series auto reads them as b/y ions'
          : 'Ion series auto with Hybrid ion series by reads the hybrid spectra as b/y ions only'
        : 'Ion series by reads them as b/y ions'
    checks.push({
      id: 'electron',
      level: 'warn',
      title: wrong.electron ? 'Electron activation' : 'Hybrid activation',
      detail: `${n.toLocaleString('en-US')} of ${act.of.toLocaleString('en-US')} MS2 spectra probed were activated by ${what}. ${how}, and their tags are unreliable. ${etdAdvice(o.input, wrong.hybrid)}`,
      faq: 'faq-inspector',
      source: 'the probe',
      fix: etdFix(o.input, wrong.hybrid)
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
export const NOTE_LINE =
  /^(Acquisition check: |FASTAG_REFUSED |No two peaks anywhere in this file|Electron activation: |Hybrid activation: |Collisional activation: |Ion series: \d+ electron-activated MS2 spectra were tagged as b\/y)|' is raw DIA[: ]|has no index, or one that no longer matches/

/// The CLI's activation warnings under Ion series auto and cz (IonSeries.h
/// hybridAutoWarning, autoNoColumnWarning, collisionalCzWarning).
export const HYBRID_AUTO_LINE = /^Hybrid activation: (\d+) of (\d+) MS2 spectra/
export const AUTO_NO_COLUMN_LINE = /^Ion series: (\d+) electron-activated MS2 spectra were tagged as b\/y/
export const COLLISIONAL_CZ_LINE = /^Collisional activation: (\d+) of (\d+) MS2 spectra/

/// The fix for collisional spectra read as c/z under Ion series cz: auto on
/// mzML (each spectrum by its activation), by on MGF or mzPeak.
export function collisionalCzFix(input: string): CheckFix {
  return noActivationMeta(input)
    ? { label: 'Read every spectrum as b/y (Ion series by)', params: { ion_series: 'by' } }
    : { label: 'Read each spectrum by its activation (Ion series auto)', params: { ion_series: 'auto' } }
}

const LOWRES = /^No two peaks anywhere in this file are closer than ([\d.]+) Th/

/// The checks after a run, from its reports (the digest report's meta and
/// run rows) and the CLI lines it kept (NOTE_LINE). @p species: the form
/// asks for the species report; a re-run in Da then leaves it out, as
/// species calls are not validated with a tolerance in Da (the da-species
/// check would hold that re-run otherwise).
/// @p ionSeries and @p input: the run's (electronReadAsBy); left out, the
/// default b/y reading.
export function postRunChecks(o: {
  reports: Report[]
  notes: string[]
  species?: boolean
  ionSeries?: unknown
  ionSeriesHybrid?: unknown
  input?: string
  /// The MS2 spectra the run tagged (its summary line), when known: Ion
  /// series cz is offered as a re-run only for a run all electron-activated.
  ms2?: number | null
}): { checks: Check[]; detected: Detected | null } {
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
  // Without a report (a plain tags run) the log note alone counts: FASTag
  // writes it only when the tolerance is far narrower than the tightest
  // peak spacing in the file.
  if ((unit === 'ppm' && iontrapish) || (!runReport && !!lowres)) {
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
      title: unit === 'ppm' ? `This run used ${tol ?? ''} ppm; the MS2 look like ion trap` : 'The fragment tolerance is too narrow; the MS2 look like ion trap',
      detail: `${why.join(' ')} A ppm tolerance finds almost no tags on ion-trap spectra; ${presetText(IONTRAP)} is the preset for them.${
        o.species ? ' Species calls are not validated with a tolerance in Da, so the re-run leaves the species report out.' : ''
      }`,
      faq: 'faq-tolerance-warning',
      source: [inst ? 'the digest report' : null, lowres ? "FASTag's log" : null].filter(Boolean).join(' and '),
      fix: o.species
        ? {
            label: `Re-run with ${IONTRAP.tolerance} ${IONTRAP.unit}, without species`,
            instrument: IONTRAP.id,
            params: { species: false },
            rerun: true
          }
        : { label: `Re-run with ${IONTRAP.tolerance} ${IONTRAP.unit}`, instrument: IONTRAP.id, rerun: true }
    })
    if (detected && !detected.preset && lowres) detected.preset = IONTRAP.id
  }
  const electron = o.notes.find((l) => l.startsWith('Electron activation: '))
  // The line names the counts per class (IonSeries.h byModeWarning):
  // electron and hybrid spectra are judged apart, as before the run.
  const per = electron ? /(\d+) collisional, (\d+) electron, (\d+) hybrid/.exec(electron) : null
  const input = o.input ?? ''
  const wrong = per
    ? misread({ ion_series: o.ionSeries, ion_series_hybrid: o.ionSeriesHybrid }, input, Number(per[2]), Number(per[3]))
    : { electron: electronReadAsBy(o.ionSeries, input), hybrid: false }
  if (electron && (wrong.electron || wrong.hybrid)) {
    const m = /^Electron activation: (\d+) of (\d+) MS2 spectra/.exec(electron)
    checks.push({
      id: 'electron',
      level: 'warn',
      title: 'Electron activation',
      detail: m
        ? `${Number(m[1]).toLocaleString('en-US')} of ${Number(m[2]).toLocaleString('en-US')} tagged MS2 spectra were activated by ETD, ECD or a hybrid method and read as b/y ions, so their tags and flanks are unreliable. ${etdAdvice(input, wrong.hybrid)}`
        : electron,
      faq: 'faq-inspector',
      source: "FASTag's log",
      fix: { ...etdFix(input, wrong.hybrid), rerun: true }
    })
  }
  // Under Ion series auto and cz the CLI warns in lines of its own.
  const find = (re: RegExp): RegExpExecArray | null => o.notes.map((l) => re.exec(l)).find((m) => m) ?? null
  const of = (a: string, b: string): string => `${Number(a).toLocaleString('en-US')} of ${Number(b).toLocaleString('en-US')}`
  const hyb = find(HYBRID_AUTO_LINE)
  if (hyb)
    checks.push({
      id: 'hybrid-auto',
      level: 'warn',
      title: 'Hybrid activation',
      detail: `${of(hyb[1], hyb[2])} MS2 spectra were activated by a hybrid method (EThcD, ETciD) and tagged as b/y ions only: under Ion series auto their c/z ions were not read. ${etdAdvice(input, true)}`,
      faq: 'faq-inspector',
      source: "FASTag's log",
      fix: { ...etdFix(input, true), rerun: true }
    })
  const noCol = find(AUTO_NO_COLUMN_LINE)
  // cz reads every spectrum as c/z: a fix only for a run that is all
  // electron-activated; a mixed run would go to the collisional warning.
  const allElectron = !!noCol && o.ms2 != null && Number(noCol[1]) === o.ms2
  if (noCol)
    checks.push({
      id: 'auto-no-column',
      level: 'warn',
      title: 'Electron activation read as b/y',
      detail: `${Number(noCol[1]).toLocaleString('en-US')} electron-activated MS2 spectra were tagged as b/y ions: Ion series auto reads the activation of mzML input only, so their tags are unreliable. Set Ion series to cz if the run is all electron-activated (cz reads every spectrum as c/z), or convert the run to mzML and use auto.`,
      faq: 'faq-inspector',
      source: "FASTag's log",
      ...(allElectron ? { fix: { label: 'Read every spectrum as c/z (Ion series cz)', params: { ion_series: 'cz' }, rerun: true } } : {})
    })
  const coll = find(COLLISIONAL_CZ_LINE)
  if (coll)
    checks.push({
      id: 'collisional-cz',
      level: 'warn',
      title: 'Collisional activation read as c/z',
      detail: `${of(coll[1], coll[2])} MS2 spectra were activated by collision (CID, HCD), which yields b/y ions, but Ion series cz reads every spectrum as c/z ions, so their tags are unreliable. ${
        noActivationMeta(input)
          ? 'This format carries no activation per spectrum: use Ion series by, or convert the run to mzML and use auto.'
          : 'Use Ion series auto, which reads each spectrum by its activation.'
      }`,
      faq: 'faq-inspector',
      source: "FASTag's log",
      fix: { ...collisionalCzFix(input), rerun: true }
    })
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
