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

import { fmt, pct, type Report } from '../digestReport'
import type { ParamValue } from '../ParamField'
import type { SpeciesReport } from '../types'
import {
  alkylationCall,
  censusFacts,
  labelCall,
  parseLog,
  proteaseCall,
  runFacts,
  speciesCall,
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
  /// The instrument preset the run's tolerance came from (its label), if any.
  instrument: string | null
}

const ON = 'Turn on and run again'
const enable = (values: Record<string, ParamValue>): TileAction => ({ kind: 'enable', label: ON, values })
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
  const sp = speciesCall(i.species)

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
    facts.instrument
      ? { id: 'instrument', label: 'Instrument', value: facts.instrument, tone: 'figure', note: 'as the input names it, from the report meta rows (no analyzer named)' }
      : { id: 'instrument', label: 'Instrument', value: 'not named', tone: 'off', note: digest || label || massgap ? 'the report meta rows name no instrument' : 'no report with meta rows was written' },
    census || log.census
      ? {
          id: 'tagged',
          label: 'With tags',
          value: `${fmt(tagged)}${census?.taggedShare != null ? ` (${pct(census.taggedShare)})` : ''}`,
          tone: 'figure',
          note: 'spectra with a reported tag (census)'
        }
      : { id: 'tagged', label: 'With tags', value: 'not counted', tone: 'off', note: 'counted by the census (-census, FASTag 1.12)' },
    { id: 'tags', label: 'Tags', value: count(log.tags), tone: 'figure', note: 'every reported tag, gapped ones included' },
    (() => {
      const f = digest ? digest.rows.find((r) => r.section === 'count' && r.key === 'tags_filtered') : undefined
      return f
        ? { id: 'filtered', label: 'Tags E ≤ 1', value: count(f.n ?? null), tone: 'figure' as const, note: 'ungapped tags with an E-value ≤ 1 (the digest filter)' }
        : { id: 'filtered', label: 'Tags E ≤ 1', value: 'not counted', tone: 'off' as const, note: 'counted by the digest report', action: enable({ digest_out: 'digest.tsv' }) }
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
        : { id: 'glyco', label: 'Glyco', value: 'off', tone: 'off', note: 'oxonium flagging was off', action: enable({ glyco: true }) }
  ]

  // ---- calls
  const calls: Tile[] = [
    proteaseTile(protease),
    genusTile(sp, da),
    labelTile(lab),
    alkylationTile(alk, fasta, i.params, log.reconMinLength)
  ]
  for (const t of calls) {
    if (t.id === 'alkylation') continue
    // Only a call the CLI made is held back; its no call stands, with its
    // reason (a run-level rule such as low_resolution is not a count).
    if (lowEvidence && t.tone === 'call') Object.assign(t, { value: 'too little evidence', tone: 'low', note: `${fewer}; CLI: ${t.value} (${t.note})` })
    else if (lowEvidence && t.tone === 'nocall') t.note = `${t.note}; also ${fewer}`
    else if (!cutoffApplied && (t.tone === 'call' || t.tone === 'nocall')) t.note = `${t.note}; ${NOT_APPLIED}`
  }

  // ---- checks
  const checks: Check[] = []
  if (!cutoffApplied)
    checks.push({
      tone: 'muted',
      text: `Evidence cutoff not applied: this run did not count tagged spectra (the census, -census), so calls over fewer than ${fmt(MIN_TAGGED)} tagged spectra are not held back`
    })
  if (log.acquisition)
    checks.push({
      tone: log.acquisition.mode === 'DDA' || log.acquisition.mode === 'pseudo-DDA' ? 'ok' : 'flag',
      text: `Acquisition check: ${log.acquisition.mode} (${log.acquisition.why})`
    })
  else checks.push({ tone: 'muted', text: 'Acquisition not checked: this FASTag writes no acquisition check line (FASTag 1.12 does)' })
  if (da && (i.species != null || given(i.params['species'])))
    checks.push({ tone: 'flag', text: `The fragment tolerance is ${fmt(tol!.value)} Da: species calls are unreliable on ion-trap/Da data.` })
  if (log.electron && log.electron.electron > 0)
    checks.push({
      tone: 'flag',
      text: `${fmt(log.electron.electron)} of ${fmt(log.electron.of)} MS2 spectra were electron-activated (ETD, ECD or hybrid); tags read as b/y ions from them are unreliable.`
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
    {
      setting: 'fixed C+57.021',
      value: 'Carbamidomethyl (C)',
      evidence: 'default',
      note:
        alk.state === 'counts' && !alk.placed
          ? 'default, alkylation not assessed (no tag placed in the FASTA)'
          : alk.state === 'counts'
          ? 'default; the mass-gap report has Cys gap counts, no alkylation call'
          : fasta
            ? 'default, alkylation not assessed (mass-gap report not written)'
            : 'default, alkylation not assessed (no FASTA)'
    },
    lab.state === 'call' && callOk
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
  if (callOk && sp.state === 'called' && sp.present.length > 0)
    suggestions.push({
      setting: 'database',
      value: `${sp.present[0].name} proteome`,
      evidence: 'call',
      note: `from the CLI species call (not validated)${cutoffApplied ? '' : `; ${NOT_APPLIED}`}`
    })
  else if (callOk && sp.state === 'ranked')
    suggestions.push({
      setting: 'database',
      value: `${sp.top.name} proteome`,
      evidence: 'ranking',
      note: `top of the species ranking, not a presence call${cutoffApplied ? '' : `; ${NOT_APPLIED}`}`
    })

  const caveats = [
    'Not validated: these are what FASTag reports, not checked search settings.',
    ...(lab.state === 'call' ? ['The label call is FASTag’s label_call (prose-auto’s rule, ported into the CLI).'] : []),
    'The species calls are unreliable on ion-trap/Da data.'
  ]
  const copyText = [
    ...suggestions.map((s) => `${s.setting}: ${s.value} (${s.note})`),
    ...caveats.map((c) => `* ${c}`)
  ].join('\n')
  return { figures, calls, checks, suggestions, caveats, lowEvidence, cutoffApplied, copyText }
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
  return { ...base, value: 'not assessed', tone: 'off', note: 'the digest report was not written', action: enable({ digest_out: 'digest.tsv' }) }
}

function genusTile(c: SpeciesCall, da: boolean): Tile {
  const base = { id: 'genus', label: 'Top genus' }
  const caveat = da ? ' Species calls are unreliable on ion-trap/Da data.' : ''
  if (c.state === 'called') {
    if (c.present.length === 0)
      return {
        ...base,
        value: 'none present',
        tone: 'nocall',
        note: `${c.runNoCall ? `run-level no call (${c.runNoCall})` : `no genus present by the CLI species call; ${c.noCall} no call, ${c.notDetected} not detected`}.${caveat}`
      }
    const others = c.present.slice(1).map((t) => t.name)
    return {
      ...base,
      value: c.present[0].name,
      tone: 'call',
      note: `present by the CLI species call (decoy null)${others.length ? `; also present: ${others.join(', ')}` : ''}.${caveat}`
    }
  }
  if (c.state === 'ranked')
    return {
      ...base,
      value: c.top.name,
      tone: 'call',
      note: `q = ${c.top.q === null ? 'NA (uncalibrated under -species_orientation both)' : fmt(c.top.q)}; ranked first of ${c.genera} genera by adjusted count, not a presence call.${caveat}`
    }
  if (c.state === 'none') return { ...base, value: 'no genus', tone: 'nocall', note: `the species report lists no genus.${caveat}` }
  return { ...base, value: 'not assessed', tone: 'off', note: 'species detection was off', action: enable({ species: true, extension: '2' }) }
}

function labelTile(c: LabelCall): Tile {
  const base = { id: 'label', label: 'Label' }
  if (c.state === 'call')
    return { ...base, value: c.label === 'label-free' ? 'none (label-free)' : c.label, tone: 'call', note: `CLI label call over ${fmt(c.ends)} C-terminal tag ends*: ${c.why}` }
  if (c.state === 'no_call') return { ...base, value: 'no call', tone: 'nocall', note: c.why || `no label call (${c.reason})` }
  if (c.state === 'not_called')
    return { ...base, value: 'not called', tone: 'off', note: 'this FASTag writes the label counts but no label call (FASTag 1.12 does); the counts are in the Digest tab' }
  return { ...base, value: 'not assessed', tone: 'off', note: 'the label report was not written', action: enable({ label_out: 'label.tsv' }) }
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
      note: `${hits.length ? hits.map((s) => `${s.name} ${fmt(s.spectra)} of ${placed} placed spectra`).join(', ') : `no Cys alkylation gap among ${placed} placed spectra`}; FASTag writes no alkylation call yet`
    }
  }
  if (fasta)
    return {
      ...base,
      value: 'not assessed',
      tone: 'off',
      note: 'the mass-gap report was not written',
      action: enable({ recon_out: 'recon.tsv', massgap_out: 'massgap.tsv' })
    }
  const raise = ext < FASTA_EXTENSION
  return {
    ...base,
    value: 'not assessed (needs a FASTA)',
    tone: 'off',
    note: `the Cys gaps come from placing the tags in a FASTA (the mass-gap report)${
      raise ? `; adding one also sets the extension from ${ext} to ${FASTA_EXTENSION}, so tags reach the length a proteome database needs` : ''
    }`,
    action: { kind: 'add-fasta', label: 'Add FASTA and run again', ...(raise ? { values: { extension: String(FASTA_EXTENSION) } } : {}) }
  }
}
