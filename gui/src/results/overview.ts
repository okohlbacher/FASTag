// The Overview's content (GUI-DESIGN 3 S3, D8): key figures, the calls the
// CLI made, checks, and suggested search settings, built from calls.ts. Each
// tile names its cutoff or caveat, each suggested setting its evidence (a
// call, a default, a preset or the run itself); a value that was not measured
// says so. A tile whose report the run did not write offers to turn it on.
//
// The only thresholds here are display rules of the design, never calls: a
// call over fewer than MIN_TAGGED tagged spectra reads "too little evidence"
// (the CLI's own result stays in the note). Tagged spectra are counted by the
// census only; without one the cutoff is not applied and the Overview says
// so (the MS2 spectra processed are an upper bound, not a stand-in). A CLI
// no call is never overridden. The acquisition and tolerance checks repeat
// what the CLI wrote or was given. Pure, for vitest.

import { alkylationCall as alkylationReportCall, fmt, fmtQ, pct, type AlkylationCall as AlkylationReport, type Report } from '../digestReport'
import type { ParamValue } from '../ParamField'
import type { SpeciesReport } from '../types'
import { electronReadAsBy, noActivationMeta } from '../inspector/checks'
import {
  alkylationCall,
  censusFacts,
  labelCall,
  parseLog,
  proteaseCall,
  runFacts,
  speciesCall,
  tiedLeaders,
  type AlkylationCall,
  type LabelCall,
  type ProteaseCall,
  type SpeciesCall
} from './calls'

/// Calls over fewer tagged spectra than this read "too little evidence".
export const MIN_TAGGED = 1000

export type TileAction =
  | { kind: 'enable'; label: string; values: Record<string, ParamValue> }
  // Picks a FASTA, turns the mass-gap report on and runs again, with the
  // values beside (the extension raised so tags can be placed), if any.
  | { kind: 'add-fasta'; label: string; values?: Record<string, ParamValue> }

export interface Tile {
  id: string
  label: string
  value: string
  /// Its cutoff or caveat, in words: never empty.
  note: string
  /// figure: a count; call / nocall: what the CLI said; off: not assessed;
  /// low: too little evidence.
  tone: 'figure' | 'call' | 'nocall' | 'off' | 'low'
  action?: TileAction
}

export interface Check {
  tone: 'ok' | 'flag' | 'muted'
  text: string
  /// The CLI's reasoning behind a short text, shown on request.
  detail?: string
  /// Only said next to a call it gates (the evidence cutoff).
  gates?: true
}

export interface Suggestion {
  setting: string
  value: string
  evidence: 'call' | 'ranking' | 'default' | 'preset' | 'run'
  note: string
}

export interface Overview {
  figures: Tile[]
  calls: Tile[]
  checks: Check[]
  suggestions: Suggestion[]
  caveats: string[]
  lowEvidence: boolean
  /// Whether the evidence cutoff could be applied: only with a census count
  /// of tagged spectra.
  cutoffApplied: boolean
  /// The suggested settings as plain text for Copy.
  copyText: string
  /// At least one suggested setting comes from a measured call or ranking:
  /// only then is the table worth showing.
  measured: boolean
  /// One warning above the tiles for a cause several calls share (a
  /// fragment tolerance in Da): said once, the tiles say only "no call".
  warning?: string
}

export interface OverviewInputs {
  /// The run's log, in order.
  log: readonly string[]
  /// The reports the run wrote (digest, label, mass gap).
  reports: readonly Report[]
  species: SpeciesReport | null
  /// The census summary's text (FASTag 1.12 -census), if one was written.
  census: string | null
  /// The parameters the run was sent.
  params: Record<string, unknown>
  /// The input the run read (its format decides how Ion series auto reads
  /// ETD spectra); left out, an mzML is assumed.
  input?: string
  /// The instrument preset the run's tolerance came from (its label), if any.
  instrument: string | null
  /// The workflow reports' texts, when the run wrote them: the QC report,
  /// the protein shortlist, the mass-shift accounting and table.
  qc?: string | null
  shortlist?: string | null
  deltaCounts?: string | null
  delta?: string | null
  /// The shortlist's engine configuration was written.
  config?: boolean
}

/// The value column of a key/value report (QC: section key value n ...;
/// the mass-shift accounting: key value), by key.
export function keyValues(text: string | null | undefined): Map<string, string> {
  const m = new Map<string, string>()
  if (!text) return m
  const lines = text.split(/\r?\n/).filter((l) => l !== '' && !l.startsWith('#'))
  const head = (lines[0] ?? '').split('\t')
  const k = head.indexOf('key')
  const v = head.indexOf('value')
  if (k < 0 || v < 0) return m
  for (const l of lines.slice(1)) {
    const f = l.split('\t')
    if (f[k] !== undefined && !m.has(f[k])) m.set(f[k], f[v] ?? '')
  }
  return m
}

const numOf = (s: string | undefined): number | null => (s !== undefined && s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : null)

/// What a QC report says: instrument, tag yield, the most frequent charge.
export function qcFacts(text: string | null | undefined): {
  instrument: string | null
  serial: string | null
  started: string | null
  /// The run rows' fragment tolerance.
  tolerance: { value: number; unit: 'ppm' | 'Da' } | null
  tagYield: number | null
  tagged: number | null
  topCharge: { z: number; share: number | null } | null
} | null {
  const kv = keyValues(text)
  if (kv.size === 0) return null
  const real = (s: string | undefined): string | null => (s && s !== '-' && s !== 'n/a' && s !== 'unknown' ? s : null)
  let top: { z: number; n: number; share: number | null } | null = null
  for (const [key, val] of kv) {
    const m = /^precursor_charge_(\d+)$/.exec(key)
    const n = numOf(val)
    if (!m || m[1] === '0' || n === null) continue
    if (!top || n > top.n) top = { z: Number(m[1]), n, share: numOf(kv.get(`${key}_share`)) }
  }
  return {
    instrument: real(kv.get('instrument_model')),
    serial: real(kv.get('instrument_serial_number')),
    started: real(kv.get('start_timestamp')),
    tolerance: ((): { value: number; unit: 'ppm' | 'Da' } | null => {
      const v = numOf(kv.get('fragment_tolerance'))
      const u = kv.get('fragment_tolerance_unit')
      return v != null && (u === 'ppm' || u === 'Da') ? { value: v, unit: u } : null
    })(),
    tagYield: numOf(kv.get('tag_yield')),
    tagged: numOf(kv.get('ms2_tagged_e001')),
    topCharge: top ? { z: top.z, share: top.share } : null
  }
}

/// What a protein shortlist says: proteins kept of those with evidence.
export function shortlistFacts(text: string | null | undefined): { kept: number; of: number } | null {
  if (!text) return null
  const m = /proteins:\s*(\d+) with evidence,\s*(\d+) kept/.exec(text)
  if (m) return { kept: Number(m[2]), of: Number(m[1]) }
  const lines = text.split(/\r?\n/).filter((l) => l !== '' && !l.startsWith('#'))
  const head = (lines[0] ?? '').split('\t')
  const k = head.indexOf('kept')
  if (k < 0) return null
  const rows = lines.slice(1).map((l) => l.split('\t'))
  return { kept: rows.filter((r) => r[k] === '1').length, of: rows.length }
}

/// The most frequent mass shift of a mass-shift table (-delta_out) away
/// from 0, with its UniMod name (or first interpretation) when it has one.
export function topShift(text: string | null | undefined): { delta: string; spectra: number; name: string | null } | null {
  if (!text) return null
  const lines = text.split(/\r?\n/).filter((l) => l !== '' && !l.startsWith('#'))
  const head = (lines[0] ?? '').split('\t').map((h) => h.trim())
  const [d, sp, un, ti] = ['delta', 'spectra', 'unimod', 'top_interps'].map((c) => head.indexOf(c))
  if (d < 0 || sp < 0) return null
  let best: { delta: string; spectra: number; name: string | null } | null = null
  for (const l of lines.slice(1)) {
    const f = l.split('\t')
    const delta = Number(f[d])
    const n = Number(f[sp])
    if (!Number.isFinite(delta) || !Number.isFinite(n) || Math.abs(delta) < 0.5) continue
    if (best && n <= best.spectra) continue
    const named = (un >= 0 ? f[un] : '')?.trim()
    const interp = (ti >= 0 ? f[ti] : '')?.trim().split(/[;,]/)[0]?.replace(/:\d+$/, '').trim()
    const name = named && named !== '-' ? named : interp && interp !== '-' ? interp : null
    best = { delta: f[d].trim(), spectra: n, name }
  }
  return best
}

/// The rank a species report reports at: @p asked (the run's species_rank)
/// when it has rows there, else the rank of its first row.
export function reportRank(sp: SpeciesReport | null | undefined, asked?: unknown): string {
  const want = typeof asked === 'string' && asked.trim() !== '' ? asked.trim() : 'genus'
  if (!sp || sp.taxa.length === 0 || sp.taxa.some((t) => t.rank === want)) return want
  return sp.taxa[0].rank
}

/// An action that turns a report on and runs again, named after it
/// ("Add Digest report and run again").
const enable = (what: string, values: Record<string, ParamValue>): TileAction => ({ kind: 'enable', label: `Add ${what} and run again`, values })
const given = (v: unknown): boolean => (typeof v === 'string' ? v.trim() !== '' : v === true)
const count = (v: number | null): string => (v == null ? '–' : fmt(v))

// What a label call means for a search, as Unimod names; a lookup, not a rule.
const LABEL_MODS: Record<string, string> = {
  TMT: 'TMT6plex (K, N-term)',
  TMTpro: 'TMTpro (K, N-term)',
  iTRAQ4: 'iTRAQ4plex (K, N-term)',
  SILAC: 'Label:13C(6)15N(2) (K), Label:13C(6)15N(4) (R), variable'
}
const labelMods = (label: string): string =>
  label === 'label-free' ? 'none' : label.split('+').map((l) => LABEL_MODS[l] ?? l).join('; ')

export function buildOverview(i: OverviewInputs): Overview {
  const log = parseLog(i.log)
  const kind = (k: Report['kind']): Report | undefined => i.reports.find((r) => r.kind === k)
  const digest = kind('digest')
  const label = kind('label')
  const massgap = kind('massgap')
  const census = i.census ? censusFacts(i.census) : null
  const facts = runFacts(digest ?? label ?? massgap)
  const tol = facts.tolerance ?? paramTolerance(i.params)
  const da = tol?.unit === 'Da'
  const fasta = given(i.params['fasta']) || given(i.params['recon_fasta'])

  const protease = proteaseCall(digest)
  const lab = labelCall(label)
  const alk = alkylationCall(massgap)
  const alkReport = kind('alkylation')
  const alkCall = alkReport ? alkylationReportCall(alkReport) : null
  const rank = reportRank(i.species, i.params['species_rank'])
  const sp = speciesCall(i.species, rank)
  const qc = qcFacts(i.qc)
  const instrument = facts.instrument ?? qc?.instrument ?? null

  // The evidence the calls rest on: spectra with a tag, as the census
  // counted them. Without a census the cutoff is not applied: the MS2
  // spectra processed are an upper bound on the tagged ones.
  const tagged = census?.tagged ?? log.census?.tagged ?? null
  const cutoffApplied = tagged != null
  const lowEvidence = tagged != null && tagged < MIN_TAGGED
  const fewer = `${fmt(tagged)} tagged spectra, fewer than ${fmt(MIN_TAGGED)}`
  const NOT_APPLIED = `evidence cutoff (${fmt(MIN_TAGGED)} tagged spectra) not applied: tagged spectra not counted`

  // ---- key figures
  const figures: Tile[] = [
    {
      id: 'spectra',
      label: 'MS2 spectra',
      value: count(log.ms2),
      tone: 'figure',
      note:
        log.ms2 == null
          ? 'not in the log (no summary line)'
          : log.subsample
            ? `processed by the tagger; subsampled: ${fmt(log.subsample.tagged)} of ${fmt(log.subsample.of)} input spectra`
            : 'processed by the tagger (peaks and a precursor)'
    },
    instrument
      ? {
          id: 'instrument',
          label: 'Instrument',
          value: instrument,
          tone: 'figure',
          note:
            !facts.instrument && qc
              ? `as the input names it (QC report)${qc.serial ? `; serial ${qc.serial}` : ''}${qc.started ? `; started ${qc.started}` : ''}`
              : 'as the input names it, from the report meta rows (no analyzer named)'
        }
      : { id: 'instrument', label: 'Instrument', value: 'not named', tone: 'off', note: digest || label || massgap || qc ? 'the input names no instrument' : 'no report with meta rows was written' },
    census || log.census
      ? {
          id: 'tagged',
          label: 'With tags',
          value: `${fmt(tagged)}${census?.taggedShare != null ? ` (${pct(census.taggedShare)})` : ''}`,
          tone: 'figure',
          note: 'spectra with a reported tag (identifiability table)'
        }
      : { id: 'tagged', label: 'With tags', value: 'not counted', tone: 'off', note: 'counted by the identifiability table (Identifiability triage)' },
    { id: 'tags', label: 'Tags', value: count(log.tags), tone: 'figure', note: 'every reported tag, gapped ones included' },
    (() => {
      const f = digest ? digest.rows.find((r) => r.section === 'count' && r.key === 'tags_filtered') : undefined
      return f
        ? { id: 'filtered', label: 'Tags E ≤ 1', value: count(f.n ?? null), tone: 'figure' as const, note: 'ungapped tags with an E-value ≤ 1 (the digest filter)' }
        : { id: 'filtered', label: 'Tags E ≤ 1', value: 'not counted', tone: 'off' as const, note: 'counted by the digest report', action: enable('Digest report', { digest_out: 'digest.tsv' }) }
    })(),
    log.glyco
      ? {
          id: 'glyco',
          label: 'Glyco',
          value: `${fmt(log.glyco.flagged)} flagged`,
          tone: 'figure',
          note: `of ${fmt(log.glyco.of)} MS2 spectra carry oxonium ions; evidence, not an identification`
        }
      : given(i.params['glyco'])
        ? { id: 'glyco', label: 'Glyco', value: '–', tone: 'off', note: 'the log has no glyco line' }
        : { id: 'glyco', label: 'Glyco', value: 'off', tone: 'off', note: 'oxonium flagging was off', action: enable('Glycopeptide report', { glyco: true }) }
  ]
  // ---- the workflows' own figures
  if (qc) {
    figures.push({
      id: 'qc-tagged',
      label: 'Tagged',
      // To one decimal, as the QC view's summary strip writes it.
      value: qc.tagYield != null ? `${(qc.tagYield * 100).toFixed(1)}%${qc.tagged != null ? ` (${fmt(qc.tagged)})` : ''}` : '–',
      tone: qc.tagYield != null ? 'figure' : 'off',
      note: 'MS2 spectra read with a tag at E ≤ 0.01 (QC report)'
    })
    figures.push({
      id: 'qc-charge',
      label: 'Top charge',
      value: qc.topCharge ? `${qc.topCharge.z}+${qc.topCharge.share != null ? ` (${(qc.topCharge.share * 100).toFixed(1)}%)` : ''}` : 'none given',
      tone: qc.topCharge ? 'figure' : 'off',
      note: qc.topCharge ? 'the most frequent precursor charge of the MS2 spectra (QC report)' : 'no MS2 spectrum states its precursor charge'
    })
  }
  const sl = shortlistFacts(i.shortlist)
  if (sl)
    figures.push({
      id: 'shortlist',
      label: 'Shortlist',
      value: `${fmt(sl.kept)} of ${fmt(sl.of)} proteins kept`,
      tone: 'figure',
      note: `proteins with tag evidence kept for the reduced FASTA; ${i.config ? 'search-engine configuration written' : 'no search-engine configuration written'}. A search-space reduction, not an identification`
    })
  const dc = keyValues(i.deltaCounts)
  const placed = numOf(dc.get('ms2_placed'))
  if (placed != null)
    figures.push({
      id: 'placed',
      label: 'Placed spectra',
      value: fmt(placed),
      tone: 'figure',
      note: `of ${fmt(numOf(dc.get('ms2_tagged')))} tagged MS2 spectra, placed on the database (mass-shift accounting)`
    })
  const shift = topShift(i.delta)
  if (shift)
    figures.push({
      id: 'topshift',
      label: 'Top mass shift',
      value: `${Number(shift.delta) > 0 ? '+' : ''}${shift.delta} Da${shift.name ? ` (${shift.name})` : ''}`,
      tone: 'figure',
      note: `${fmt(shift.spectra)} spectra, away from 0; a candidate, not an identified modification`
    })

  // ---- calls
  const calls: Tile[] = [
    proteaseTile(protease),
    genusTile(sp, rank),
    labelTile(lab),
    alkCall ? alkylationReportTile(alkCall, i.params) : alkylationTile(alk, fasta, i.params, log.reconMinLength)
  ]
  // A tolerance in Da: the protease and label no calls (rule
  // low_resolution) and the species caveat share one cause, said once
  // above the tiles; their tiles say only "no call".
  const lowRes: string[] = []
  if (da) {
    for (const [t, c, what] of [
      [calls[0], protease, 'protease'],
      [calls[2], lab, 'label']
    ] as const)
      if (c.state === 'no_call' && c.reason === 'low_resolution') {
        t.note = 'no call at a fragment tolerance in Da (see above)'
        lowRes.push(what)
      }
  }
  const daSpecies = da && (i.species != null || given(i.params['species']))
  const warning =
    lowRes.length || daSpecies
      ? `The fragment tolerance is ${fmt(tol!.value)} Da: ${[
          lowRes.length ? `FASTag makes no ${lowRes.join(' or ')} call at a tolerance in Da` : '',
          daSpecies ? 'species calls are unreliable on ion-trap/Da data' : ''
        ]
          .filter(Boolean)
          .join(', and ')}.`
      : undefined
  for (const t of calls) {
    if (t.id === 'alkylation') continue
    // Only a call the CLI made is held back; its no call stands, with its
    // reason (a run-level rule such as low_resolution is not a count).
    if (lowEvidence && t.tone === 'call')
      Object.assign(t, { value: 'too little evidence', tone: 'low', note: `${fewer}; CLI: ${t.value} (${t.note.replace(/\.$/, '')})` })
    else if (lowEvidence && t.tone === 'nocall') t.note = addNote(t.note, `also ${fewer}`)
    // The cutoff not applied is said once, by the check line below, not
    // in every call tile.
  }

  // ---- checks
  const checks: Check[] = []
  if (!cutoffApplied)
    checks.push({
      tone: 'muted',
      gates: true,
      text: `Evidence cutoff not applied: this run did not count tagged spectra, so calls over fewer than ${fmt(MIN_TAGGED)} tagged spectra are not held back.`
    })
  if (log.acquisition)
    checks.push({
      tone: log.acquisition.mode === 'DDA' || log.acquisition.mode === 'pseudo-DDA' ? 'ok' : 'flag',
      text: `Acquisition: ${log.acquisition.mode}`,
      detail: log.acquisition.why
    })
  else checks.push({ tone: 'muted', text: 'Acquisition not checked: this FASTag writes no acquisition check line (FASTag 1.12 does)' })
  // The species report counts b/y tags only: a c/z run's left-out rows
  // explain a sparse or empty report (the CLI says so in its log only).
  const czExcluded = ((): number | null => {
    for (const l of i.log) {
      const m = /Ion series: (\d+) tag rows read as c\/z-dot ions were left out of -species/.exec(l)
      if (m) return Number(m[1])
    }
    return null
  })()
  if (czExcluded)
    checks.push({
      tone: 'flag',
      text: `${fmt(czExcluded)} tag rows read as c/z ions were left out of the species report, which counts b/y tags only.`
    })
  // Only when they were read as b/y (Ion series by, or auto without
  // activation metadata): under cz or auto on mzML they are c/z tags.
  if (log.electron && log.electron.electron > 0 && electronReadAsBy(i.params['ion_series'], i.input ?? ''))
    checks.push({
      tone: 'flag',
      text: `${fmt(log.electron.electron)} of ${fmt(log.electron.of)} MS2 spectra were electron-activated (ETD, ECD or hybrid) and read as b/y ions; their tags are unreliable. ${
        noActivationMeta(i.input ?? '')
          ? 'This format carries no activation per spectrum: set Ion series to cz, or convert the run to mzML and use auto.'
          : 'Choose the Orbitrap ETD preset (Ion series auto), or the EThcD preset for hybrid spectra.'
      }`
    })

  // ---- suggested settings
  const callOk = !lowEvidence
  const suggestions: Suggestion[] = [
    protease.state === 'call' && callOk
      ? {
          setting: 'enzyme',
          value: protease.enzyme,
          evidence: 'call',
          note: `from the digest call${protease.margin != null && protease.runnerUp ? ` (margin ${fmt(protease.margin, 2)} over ${protease.runnerUp})` : ''}${cutoffApplied ? '' : `; ${NOT_APPLIED}`}`
        }
      : {
          setting: 'enzyme',
          value: 'Trypsin/P',
          evidence: 'default',
          note:
            protease.state === 'absent'
              ? 'default; digest report not written'
              : `default; no digest call (${protease.state === 'no_call' ? protease.reason : 'too little evidence'})`
        },
    { setting: 'missed cleavages', value: '2', evidence: 'default', note: 'default, not measured' },
    alkCall?.status === 'call' && alkCall.reagent && callOk
      ? {
          setting: 'fixed C',
          value: alkCall.reagent === 'none' ? 'None (cysteines not alkylated)' : `${alkCall.reagent} (C${alkCall.mass != null ? `, +${fmt(alkCall.mass, 3)}` : ''})`,
          evidence: 'call',
          note: `from the alkylation call (not validated)${cutoffApplied ? '' : `; ${NOT_APPLIED}`}`
        }
      : {
      setting: 'fixed C',
      value: 'Carbamidomethyl (C, +57.021)',
      evidence: 'default',
      note:
        alkCall
          ? `default; no alkylation call (${alkylationReason(alkCall.reason)})`
          : alk.state === 'counts' && !alk.placed
          ? 'default, alkylation not assessed (no tag placed in the FASTA)'
          : alk.state === 'counts'
          ? 'default; the mass-gap report has Cys gap counts, no alkylation call'
          : fasta
            ? 'default, alkylation not assessed (mass-gap report not written)'
            : 'default, alkylation not assessed (alkylation report not written)'
    },
    lab.state === 'call' && callOk && !(lab.weak && lab.label === 'label-free')
      ? { setting: 'label', value: labelMods(lab.label), evidence: 'call', note: `from the label call (${lab.label})${cutoffApplied ? '' : `; ${NOT_APPLIED}`}` }
      : {
          setting: 'label',
          value: 'none',
          evidence: 'default',
          note:
            lab.state === 'absent'
              ? 'default; label report not written'
              : lab.state === 'not_called'
                ? 'default; this FASTag makes no label call (FASTag 1.12 does)'
                : lab.state === 'call' && lab.weak
                ? `default; label-free from ${fmt(lab.ends)} C-terminal tag ends only (no label rule fired)`
                : `default; no label call (${lab.state === 'no_call' ? lab.reason : 'too little evidence'})`
        },
    {
      setting: 'variable M+15.995',
      value: 'Oxidation (M)',
      evidence: 'default',
      note: massgap
        ? 'default; see the mass-gap peaks in the Digest tab'
        : fasta
          ? 'default; mass gaps not assessed (mass-gap report not written)'
          : 'default; mass gaps not assessed (no FASTA)'
    }
  ]
  if (tol)
    suggestions.push(
      i.instrument
        ? { setting: 'fragment tol.', value: `${fmt(tol.value)} ${tol.unit}`, evidence: 'preset', note: `from instrument preset ${i.instrument}` }
        : { setting: 'fragment tol.', value: `${fmt(tol.value)} ${tol.unit}`, evidence: 'run', note: 'as this run used; no instrument preset chosen' }
    )
  // A tie at the top names no proteome, called or ranked: which one would
  // be arbitrary (the Species tab says No single leader).
  if (callOk && sp.state === 'called' && sp.present.length > 0 && tiedLeaders(sp.present).length < 2)
    suggestions.push({
      setting: 'database',
      value: `${sp.present[0].name} proteome`,
      evidence: 'call',
      note: `from the CLI species call (not validated)${cutoffApplied ? '' : `; ${NOT_APPLIED}`}`
    })
  else if (callOk && sp.state === 'ranked' && sp.tied.length < 2)
    suggestions.push({
      setting: 'database',
      value: `${sp.top.name} proteome`,
      evidence: 'ranking',
      note: `top of the species ranking, not a presence call${cutoffApplied ? '' : `; ${NOT_APPLIED}`}`
    })

  const caveats = [
    'Not validated: these are what FASTag reports, not checked search settings.',
    ...(lab.state === 'call' ? ['The label call is FASTag’s label_call (prose-auto’s rule, ported into the CLI).'] : []),
    // Only where the check line says so: a tolerance in Da, or none known.
    ...((da || !tol) && (i.species != null || given(i.params['species'])) ? ['The species calls are unreliable on ion-trap/Da data.'] : [])
  ]
  const copyText = [
    ...suggestions.map((s) => `${settingWords(s.setting)}: ${s.value} (${s.note})`),
    ...caveats.map((c) => `* ${c}`)
  ].join('\n')
  const measured = suggestions.some((x) => x.evidence === 'call' || x.evidence === 'ranking')
  return { figures, calls, checks, suggestions, caveats, lowEvidence, cutoffApplied, copyText, measured, ...(warning ? { warning } : {}) }
}

/// @p note with @p more after it: "a; more", or, when the note ends a
/// sentence, "a. More." (never "a.; more").
export function addNote(note: string, more: string): string {
  if (!/[.!?]$/.test(note)) return `${note}; ${more}`
  return `${note} ${more.charAt(0).toUpperCase()}${more.slice(1)}${/[.!?]$/.test(more) ? '' : '.'}`
}

function paramTolerance(p: Record<string, unknown>): { value: number; unit: 'ppm' | 'Da' } | null {
  const v = Number(p['fragment_tolerance'])
  const u = p['fragment_tolerance_unit']
  return Number.isFinite(v) && v > 0 && (u === 'ppm' || u === 'Da') ? { value: v, unit: u } : null
}

function proteaseTile(c: ProteaseCall): Tile {
  const base = { id: 'protease', label: 'Protease' }
  if (c.state === 'call')
    return {
      ...base,
      value: c.enzyme,
      tone: 'call',
      note: `digest call over ${fmt(c.ends)} C-terminal tag ends${c.margin != null && c.runnerUp ? `, margin ${fmt(c.margin, 2)} log-likelihood per end over ${c.runnerUp}` : ''}`
    }
  if (c.state === 'no_call') return { ...base, value: 'no call', tone: 'nocall', note: c.why || `no digest call (${c.reason})` }
  return { ...base, value: 'not assessed', tone: 'off', note: 'the digest report was not written', action: enable('Digest report', { digest_out: 'digest.tsv' }) }
}

function genusTile(c: SpeciesCall, rank = 'genus'): Tile {
  const base = { id: 'genus', label: `Top ${rank}` }
  // The Da caveat is the check line's (said once), not the tile's.
  const caveat = ''
  if (c.state === 'called') {
    if (c.present.length === 0)
      return {
        ...base,
        value: c.noCall > 0 ? 'no presence call' : 'none detected',
        tone: 'nocall',
        note: `${c.runNoCall ? `run-level no call (${c.runNoCall})` : `the CLI did not call any ${rank} present; ${c.noCall} no call, ${c.notDetected} not detected`}. This does not establish absence.${caveat}`
      }
    // Present taxa level at the top: the calls stand, no single leader.
    const tied = tiedLeaders(c.present)
    if (tied.length > 1)
      return {
        ...base,
        value: 'No single leader',
        tone: 'call',
        note: `present by the CLI species call (decoy null), tied at the top: ${tied.map((t) => t.name).join(', ')}${
          c.present.length > tied.length ? `; also present: ${c.present.filter((t) => !tied.includes(t)).map((t) => t.name).join(', ')}` : ''
        }.${caveat}`
      }
    const others = c.present.slice(1).map((t) => t.name)
    return {
      ...base,
      value: c.present[0].name,
      tone: 'call',
      note: `present by the CLI species call (decoy null)${others.length ? `; also present: ${others.join(', ')}` : ''}.${caveat}`
    }
  }
  if (c.state === 'ranked' && c.tied.length > 1)
    return {
      ...base,
      value: 'No single leader',
      tone: 'nocall',
      note: `tie between ${c.tied.length} taxa at ${rank} rank: ${c.tied.map((t) => t.name).join(', ')}; not a presence call.${caveat}`
    }
  if (c.state === 'ranked')
    return {
      ...base,
      value: c.top.name,
      tone: 'call',
      note: `q = ${c.top.q === null ? 'NA (uncalibrated with tag orientation both)' : fmtQ(c.top.q)}; ranked first of ${c.genera} taxa at ${rank} rank by adjusted count, not a presence call.${caveat}`
    }
  if (c.state === 'none') return { ...base, value: `no ${rank}`, tone: 'nocall', note: `the species report lists no ${rank}.${caveat}` }
  return { ...base, value: 'not assessed', tone: 'off', note: 'species detection was off', action: enable('Species report', { species: true, extension: '2' }) }
}

function labelTile(c: LabelCall): Tile {
  const base = { id: 'label', label: 'Label' }
  if (c.state === 'call')
    return { ...base, value: c.label === 'label-free' ? 'none (label-free)' : c.label, tone: 'call', note: `Label call over ${fmt(c.ends)} C-terminal tag ends: ${c.why}` }
  if (c.state === 'no_call') return { ...base, value: 'no call', tone: 'nocall', note: c.why || `no label call (${c.reason})` }
  if (c.state === 'not_called')
    return { ...base, value: 'not called', tone: 'off', note: 'this FASTag writes the label counts but no label call (FASTag 1.12 does); the counts are in the Digest tab' }
  return { ...base, value: 'not assessed', tone: 'off', note: 'the label report was not written', action: enable('Label report', { label_out: 'label.tsv' }) }
}

/// The extension "Add FASTA and run again" runs with: tags of tag_length +
/// 2 x extension residues must reach the minimum length the recon index
/// derives for the database (8 for the human proteome on the gate, its log
/// says; the gate's fasta_recon case uses extension 3). Characterize's 2
/// gives 7 with the default tag length 3, and the CLI then places nothing.
export const FASTA_EXTENSION = 3

const intParam = (v: unknown, dflt: number): number => {
  const x = typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(x) ? x : dflt
}

function alkylationTile(c: AlkylationCall, fasta: boolean, params: Record<string, unknown>, reconMin: number | null): Tile {
  const base = { id: 'alkylation', label: 'Alkylation' }
  const ext = intParam(params['extension'], 0)
  const len = intParam(params['tag_length'], 3)
  if (c.state === 'counts' && !c.placed) {
    // Nothing placed: no measurement, not an absence of alkylation.
    const longest = len + 2 * ext
    const short = reconMin != null && longest < reconMin
    const need = reconMin != null ? Math.ceil((reconMin - len) / 2) : null
    return {
      ...base,
      value: 'not assessed (no tag placed in the FASTA)',
      tone: 'off',
      note: short
        ? `tags reach at most ${longest} residues (tag length ${len} + 2 × extension ${ext}); the recon index needs ${reconMin} (its log line)`
        : 'the mass-gap report counts no placed spectrum',
      ...(short && need != null ? { action: { kind: 'enable' as const, label: `Run again with extension ${need}`, values: { extension: String(need) } } } : {})
    }
  }
  if (c.state === 'counts') {
    const hits = c.sites.filter((s) => (s.spectra ?? 0) > 0)
    const placed = fmt(c.placed)
    return {
      ...base,
      value: 'no call (counts only)',
      tone: 'nocall',
      note: `${hits.length ? hits.map((s) => `${s.name} ${fmt(s.spectra)} of ${placed} placed spectra`).join(', ') : `no Cys alkylation gap among ${placed} placed spectra`}; this mass-gap report contains counts, not an alkylation call. The alkylation report (Characterize a run) makes that call`
    }
  }
  // Asked for and not written: the log says why; no action to add it.
  if (given(params['alkylation_out'])) return { ...base, value: 'not assessed', tone: 'off', note: 'the alkylation report was asked for but not written; the log says why' }
  const raise = ext < FASTA_EXTENSION
  // The alkylation report places tags on a shipped proteome (or the FASTA
  // given): tags of 8 residues for the human one, so the extension goes to
  // 3 with it.
  return {
    ...base,
    value: 'not assessed',
    tone: 'off',
    note: `the alkylation report was not written${raise ? `; adding it raises the extension from ${ext} to ${FASTA_EXTENSION}, so tags reach the 8 residues a proteome needs` : ''}`,
    action: enable('Alkylation report', { alkylation_out: 'alkylation.tsv', ...(raise ? { extension: String(FASTA_EXTENSION) } : {}) })
  }
}

/// The reasons of an alkylation no call, in words.
export function alkylationReason(reason: string | undefined): string {
  switch (reason) {
    case 'tags_too_short':
      return 'no tag reaches the length the proteome needs (8 residues for human or mouse)'
    case 'few_cys_spectra':
      return 'too few spectra with one cysteine'
    case 'ambiguous':
      return 'no reagent has a clear majority'
    default:
      return reason ? reason.replace(/_/g, ' ') : 'no reason given'
  }
}

/// The tile of an alkylation report (-alkylation_out): its call or its no
/// call with the reason; too short tags offer the run with extension 3.
function alkylationReportTile(c: AlkylationReport, params: Record<string, unknown>): Tile {
  const base = { id: 'alkylation', label: 'Alkylation' }
  const db = c.databaseSource ? ` on ${c.databaseSource.replace(/^bundled:/, 'the shipped ').replace(/^proteome$/, 'the proteome given')}` : ''
  if (c.status === 'call')
    return {
      ...base,
      value: c.reagent === 'none' ? 'none (not alkylated)' : (c.reagent ?? 'call'),
      tone: 'call',
      note: `${c.share != null ? `${pct(c.share)} of ` : ''}${fmt(c.binned)} spectra with one cysteine${db}; not validated`
    }
  const ext = intParam(params['extension'], 0)
  const short = c.reason === 'tags_too_short' && ext < FASTA_EXTENSION
  return {
    ...base,
    value: 'no call',
    tone: 'nocall',
    note: alkylationReason(c.reason),
    ...(short ? { action: { kind: 'enable' as const, label: `Run again with extension ${FASTA_EXTENSION}`, values: { extension: String(FASTA_EXTENSION) } } } : {})
  }
}

// ---- what the Overview shows of a workflow ---------------------------------

/// The tiles of @p o worth showing for a run sent @p params: MS2 spectra and
/// tags always, every other only when the run asked for its report
/// (doc/GUI-WORKFLOWS.md 3: no "not assessed" tile for a report nobody
/// asked for).
export function shownTiles(o: Overview, params: Record<string, unknown>): { figures: Tile[]; calls: Tile[] } {
  const on = (n: string): boolean => given(params[n])
  const want: Record<string, boolean> = {
    spectra: true,
    tags: true,
    instrument: on('digest_out') || on('label_out') || on('massgap_out') || on('qc_out'),
    'qc-tagged': on('qc_out'),
    'qc-charge': on('qc_out'),
    shortlist: on('shortlist_out'),
    placed: on('delta_counts_out'),
    topshift: on('delta_out'),
    tagged: on('census') || on('census_sorted_out'),
    filtered: on('digest_out'),
    glyco: on('glyco'),
    protease: on('digest_out'),
    genus: on('species'),
    label: on('label_out'),
    alkylation: on('alkylation_out') || on('massgap_out')
  }
  return { figures: o.figures.filter((t) => want[t.id]), calls: o.calls.filter((t) => want[t.id]) }
}

// A suggested setting in the words of the search engine forms (the key
// stays the short token the tests and exports match on).
const SETTING_WORDS: Record<string, string> = {
  enzyme: 'Enzyme',
  'missed cleavages': 'Missed cleavages',
  'fixed C': 'Fixed cysteine modification',
  label: 'Label',
  'variable M+15.995': 'Variable modification (M +15.995)',
  'fragment tol.': 'Fragment tolerance',
  database: 'Database'
}
export const settingWords = (s: string): string => SETTING_WORDS[s] ?? s
