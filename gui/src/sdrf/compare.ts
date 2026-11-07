// The SDRF comparison (GUI-DESIGN 3 S6, 10 P4; Q8 provisional): each batch
// job's SDRF rows against what FASTag wrote for that run, on six fields:
//
// - organism: the genus call, by NCBI taxid (taxonomy.ts): a call that
//   contains the SDRF species is consistent at genus;
// - cleavage agent: the protease call (digest report);
// - label: the label call (label report, label_call rows);
// - modification parameters: the SDRF's fixed residue modifications against
//   the run's fixed ones (the log's "Modifications:" line). FASTag writes no
//   alkylation call, so this says what the run assumed, not what the data
//   show; label modifications are the label field's, terminal and variable
//   ones are not compared;
// - instrument: the instrument the input names (digest report, meta rows);
// - fragment mass tolerance: the run's (the reports' run rows).
//
// Only the CLI's output counts, read through the parsers the Overview and
// the batch summary use (calls.ts, batchSummary.ts jobCells): a no call, and
// a call the summary holds back for too little evidence, is "no call" here,
// never a mismatch, so a cluster user gets the same table from the same
// reports. Nothing here is a call of its own. Pure, for vitest; the
// corrections TSV (correctionsTsv) is the table's mismatches, and it does
// not depend on the queue order.

import { baseName, value, type Report } from '../digestReport'
import { jobCells, type JobData } from '../run/batchSummary'
import type { BatchJob } from '../run/batch'
import { runFacts, speciesCall } from '../results/calls'
import { cellValue, columnsNamed, dataRows, type SdrfTable } from './sdrfTable'
import { matchOrganism, NOT_STATED, type Taxonomy } from './taxonomy'

export const FIELDS = ['organism', 'cleavage', 'label', 'modifications', 'instrument', 'tolerance'] as const
export type FieldId = (typeof FIELDS)[number]

export const FIELD_LABEL: Record<FieldId, string> = {
  organism: 'Organism',
  cleavage: 'Cleavage agent',
  label: 'Label',
  modifications: 'Modifications',
  instrument: 'Instrument',
  tolerance: 'Fragment tolerance'
}

/// The SDRF columns of each field (the first is the specification's name).
export const FIELD_COLUMNS: Record<FieldId, string[]> = {
  organism: ['characteristics[organism]'],
  cleavage: ['comment[cleavage agent details]'],
  label: ['comment[label]', 'characteristics[label]'],
  modifications: ['comment[modification parameters]'],
  instrument: ['comment[instrument]'],
  tolerance: ['comment[fragment mass tolerance]']
}
export const DATA_FILE = 'comment[data file]'

/// match: the same; genus: the SDRF species lies in the called genus;
/// mismatch: they differ; no_call: FASTag made no call (or it is held back,
/// or the report does not say); no_sdrf: the SDRF states nothing;
/// not_checkable: the SDRF value is one FASTag cannot call or this app cannot read.
export type FieldState = 'match' | 'genus' | 'mismatch' | 'no_call' | 'no_sdrf' | 'not_checkable'

export interface FieldResult {
  state: FieldState
  /// The SDRF's distinct values, as written, joined by " | ".
  sdrf: string
  /// FASTag's value, in words ('' when it has none).
  fastag: string
  note: string
  /// The CLI output the value came from.
  evidence: string
  /// The SDRF column read.
  column: string
}

export type Verdict =
  | { state: 'checked'; text: string; mismatches: FieldId[] }
  | { state: 'unchecked' | 'no_sdrf' | 'not_run' | 'pending'; text: string; mismatches: [] }

export interface SdrfJob {
  input: string
  status: BatchJob['status']
  /// What the done job wrote (useBatchData); undefined while it is read.
  data: JobData | undefined
}

export interface JobComparison {
  input: string
  file: string
  /// The SDRF data file the job matched, and its data rows (1 = the first).
  dataFile: string | null
  rows: number[]
  fields: Record<FieldId, FieldResult> | null
  verdict: Verdict
}

export interface SdrfComparison {
  jobs: JobComparison[]
  /// SDRF data files no job of the batch ran.
  unmatched: { dataFile: string; rows: number[] }[]
  dataFileColumn: boolean
  /// The fields the SDRF has no column for.
  missingColumns: FieldId[]
}

type Partial3 = Pick<FieldResult, 'state' | 'sdrf' | 'fastag' | 'note'>

const stated = (v: string): boolean => !NOT_STATED.has(v.trim().toLowerCase())
const distinct = (vs: readonly string[]): string[] => [...new Set(vs.map((v) => v.trim()).filter(stated))]
const join = (vs: readonly string[]): string => vs.join(' | ')

/// key=value pairs of a cell (NT=Trypsin;AC=MS:1001251), keys upper-cased.
export function keyValues(cell: string): Map<string, string> {
  const m = new Map<string, string>()
  for (const part of cell.split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0) m.set(part.slice(0, eq).trim().toUpperCase(), part.slice(eq + 1).trim())
  }
  return m
}
const nameOf = (cell: string): string => {
  const kv = keyValues(cell)
  return kv.get('NT') ?? (kv.size ? '' : cell.trim())
}

// ---- data files ------------------------------------------------------------

// Extensions a spectra file of a run carries (vendor, open, archive), and
// the infixes FASTag's and mzPeak's derived inputs add (.pseudo, .point).
const EXTENSIONS = new Set(['gz', 'bz2', 'xz', 'zip', 'raw', 'mzml', 'mzxml', 'mgf', 'd', 'wiff', 'wiff2', 'mzpeak', 'point', 'pseudo', 'tdf', 'baf'])

/// The name a data file and a job input are matched by: the basename, case
/// aside, without its spectra, archive and derived-input extensions.
export function fileStem(path: string): string {
  let s = baseName(path.replace(/\\/g, '/')).toLowerCase()
  for (;;) {
    const dot = s.lastIndexOf('.')
    if (dot <= 0 || !EXTENSIONS.has(s.slice(dot + 1))) return s
    s = s.slice(0, dot)
  }
}

// ---- the six fields --------------------------------------------------------

// FASTag's protease models (data/digest/digest_models.tsv) by the SDRF's
// names (letters and digits only, case aside) and PSI-MS accessions.
const AGENT_NAMES: Record<string, string> = {
  trypsin: 'Trypsin',
  trypsinp: 'Trypsin',
  lysc: 'Lys-C',
  lyscp: 'Lys-C',
  argc: 'Arg-C',
  argcp: 'Arg-C',
  aspn: 'Asp-N',
  aspnambic: 'Asp-N',
  chymotrypsin: 'Chymotrypsin',
  gluc: 'Glu-C',
  glutamylendopeptidase: 'Glu-C',
  v8e: 'Glu-C',
  v8de: 'Glu-C',
  lysn: 'Lys-N',
  unspecificcleavage: 'unspecific cleavage'
}
const AGENT_ACCESSIONS: Record<string, string> = {
  'MS:1001251': 'Trypsin',
  'MS:1001313': 'Trypsin',
  'MS:1001309': 'Lys-C',
  'MS:1001310': 'Lys-C',
  'MS:1001303': 'Arg-C',
  'MS:1001304': 'Asp-N',
  'MS:1001305': 'Asp-N',
  'MS:1001306': 'Chymotrypsin',
  'MS:1001917': 'Glu-C',
  'MS:1001956': 'unspecific cleavage'
}
const letters = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

function agentModel(cell: string): string | null {
  const name = nameOf(cell)
  const byName = name ? AGENT_NAMES[letters(name)] : undefined
  if (byName) return byName
  const ac = keyValues(cell).get('AC')?.toUpperCase()
  return (ac && AGENT_ACCESSIONS[ac]) || null
}

/// The SDRF cleavage agents against the protease call (null: no call).
export function compareCleavage(values: readonly string[], call: string | null, cls?: string): Partial3 {
  const vs = distinct(values)
  const sdrf = join(vs)
  if (!vs.length) return { state: 'no_sdrf', sdrf, fastag: call ?? '', note: 'the SDRF names no cleavage agent' }
  if (call == null) return { state: 'no_call', sdrf, fastag: '', note: 'FASTag made no protease call' }
  const models = vs.map(agentModel)
  const hit = models.some((m) => m === call || (cls && m === cls))
  if (hit) return { state: 'match', sdrf, fastag: call, note: `FASTag's ${call} model is a cleavage agent the SDRF names` }
  const unknown = vs.filter((_, i) => models[i] == null)
  if (unknown.length) return { state: 'not_checkable', sdrf, fastag: call, note: `FASTag has no protease model for ${unknown.map(nameOf).join(', ')}` }
  return { state: 'mismatch', sdrf, fastag: call, note: `the SDRF names ${[...new Set(models)].join(', ')}; FASTag called ${call}` }
}

interface LabelClass {
  family: string
  /// TMT or TMTpro, iTRAQ4 or iTRAQ8, when the value says.
  variant: string | null
}

function labelClass(v: string): LabelClass | null {
  const s = nameOf(v).toLowerCase()
  if (!s || !stated(s)) return null
  if (/label[\s_-]*free|^lfq$|unlabel/.test(s)) return { family: 'label-free', variant: null }
  if (/tmt\s*pro/.test(s)) return { family: 'TMT', variant: 'TMTpro' }
  if (/^tmt/.test(s)) return { family: 'TMT', variant: s === 'tmt' ? 'TMT' : null }
  if (/itraq/.test(s)) return { family: 'iTRAQ', variant: /8\s*plex|113|118|119|121/.test(s) ? 'iTRAQ8' : /4\s*plex/.test(s) ? 'iTRAQ4' : null }
  if (/silac|heavy|medium|light|lys\s*\d|arg\s*\d|13c|15n/.test(s)) return { family: 'SILAC', variant: null }
  if (/dimethyl/.test(s)) return { family: 'dimethyl', variant: null }
  return null
}

// The label reagent the SDRF modifications name (TMT6plex vs TMTpro).
function labelVariant(mods: readonly string[]): string | null {
  for (const m of mods) {
    const kv = keyValues(m)
    const n = (kv.get('NT') ?? '').toLowerCase()
    const ac = (kv.get('AC') ?? '').toUpperCase()
    if (/tmtpro/.test(n) || ac === 'UNIMOD:2016') return 'TMTpro'
    if (/tmt\d*plex|^tmt$/.test(n) || ac === 'UNIMOD:737') return 'TMT'
    if (/itraq8/.test(n) || ac === 'UNIMOD:730') return 'iTRAQ8'
    if (/itraq4/.test(n) || ac === 'UNIMOD:214') return 'iTRAQ4'
  }
  return null
}

/// The SDRF labels (and the reagent its modifications name) against the
/// label call (null: no call).
export function compareLabel(values: readonly string[], mods: readonly string[], call: string | null): Partial3 {
  const vs = distinct(values)
  const sdrf = join(vs)
  if (!vs.length) return { state: 'no_sdrf', sdrf, fastag: call ?? '', note: 'the SDRF names no label' }
  if (call == null) return { state: 'no_call', sdrf, fastag: '', note: 'FASTag made no label call' }
  const got = labelClass(call) ?? { family: call, variant: null }
  const reagent = labelVariant(mods)
  const classes = vs.map(labelClass)
  const ok = classes.some((c) => {
    if (!c || c.family !== got.family) return false
    const v = c.variant && c.variant !== 'TMT' ? c.variant : (reagent ?? c.variant)
    return !v || !got.variant || v === got.variant
  })
  if (ok) return { state: 'match', sdrf, fastag: call, note: `FASTag's ${call} call agrees with the SDRF's labels` }
  if (classes.every((c) => c == null)) return { state: 'not_checkable', sdrf, fastag: call, note: `this app does not know the label ${sdrf}` }
  const names = [...new Set(classes.filter((c): c is LabelClass => !!c).map((c) => (c.family === 'TMT' ? (c.variant === 'TMTpro' ? 'TMTpro' : (reagent ?? 'TMT')) : c.family)))]
  return { state: 'mismatch', sdrf, fastag: call, note: `the SDRF's labels are ${names.join(', ')}; FASTag called ${call}` }
}

// Label modifications belong to the label field: TMT, TMTpro, iTRAQ, SILAC
// (Label:...) and dimethyl, by name or Unimod accession.
const LABEL_MOD = /^(tmt|itraq|label:|dimethyl|silac)/i
const LABEL_UNIMOD = new Set([36, 188, 199, 214, 259, 267, 510, 730, 737, 738, 739, 2016])
// Unimod names of the accessions an SDRF may give without NT.
const UNIMOD_NAME: Record<number, string> = { 1: 'Acetyl', 4: 'Carbamidomethyl', 21: 'Phospho', 35: 'Oxidation', 39: 'Methylthio' }

interface Mod {
  name: string
  site: string
}
const modKey = (m: Mod): string => `${m.name.toLowerCase()}@${m.site}`
const modWords = (ms: Mod[]): string => (ms.length ? ms.map((m) => `${m.name} (${m.site})`).join(', ') : 'none')

/// The fixed residue modifications of SDRF cells (label, terminal and
/// variable ones left out); null when no cell states a modification.
function sdrfFixed(values: readonly string[]): Mod[] | null {
  let any = false
  const out: Mod[] = []
  for (const v of values) {
    const kv = keyValues(v)
    if (!kv.size) continue
    const unimod = Number(/UNIMOD:(\d+)/i.exec(kv.get('AC') ?? '')?.[1] ?? NaN)
    const name = kv.get('NT') || UNIMOD_NAME[unimod] || ''
    if (!name) continue
    any = true
    if ((kv.get('MT') ?? '').toLowerCase() !== 'fixed') continue
    if (LABEL_MOD.test(name) || LABEL_UNIMOD.has(unimod)) continue
    const sites = (kv.get('TA') ?? '')
      .split(/[,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => /^[A-Z]$/.test(s))
    for (const site of sites) out.push({ name, site })
  }
  return any ? out : null
}

const MOD_LINE = /^Modifications: (.*)$/

/// The run's fixed residue modifications (its log); null when the log was not read.
function runFixed(log: readonly string[]): { mods: Mod[]; line: string | null } | null {
  if (!log.length) return null
  let line: string | null = null
  for (const l of log) if (MOD_LINE.test(l.trim())) line = l.trim()
  const mods: Mod[] = []
  if (line)
    for (const m of MOD_LINE.exec(line)![1].matchAll(/\s*([^,()]+?) \(([A-Z]), (fixed|variable)\)/g)) if (m[3] === 'fixed') mods.push({ name: m[1].trim(), site: m[2] })
  return { mods, line }
}

/// The SDRF modification parameters against the run's fixed modifications.
export function compareModifications(values: readonly string[], log: readonly string[]): Partial3 {
  const vs = distinct(values)
  const sdrf = join(vs)
  const want = sdrfFixed(vs)
  const run = runFixed(log)
  const fastag = run ? modWords(run.mods) : ''
  if (!want) return { state: 'no_sdrf', sdrf, fastag, note: 'the SDRF names no modification' }
  if (!run) return { state: 'no_call', sdrf, fastag, note: "the run's log was not read" }
  const a = new Set(want.map(modKey))
  const b = new Set(run.mods.map(modKey))
  const extra = want.filter((m) => !b.has(modKey(m)))
  const missing = run.mods.filter((m) => !a.has(modKey(m)))
  const scope = 'fixed residue modifications (label, terminal and variable ones are not compared)'
  if (!extra.length && !missing.length) return { state: 'match', sdrf, fastag, note: `the SDRF and the run have the same ${scope}: ${modWords(run.mods)}` }
  return {
    state: 'mismatch',
    sdrf,
    fastag,
    note: `${scope}: the SDRF lists ${modWords(want)}; the run assumed ${modWords(run.mods)}`
  }
}

const VENDOR = new Set(['thermo', 'scientific', 'fisher', 'thermofisher', 'bruker', 'sciex', 'ab', 'waters', 'agilent', 'shimadzu'])
const instrumentKey = (s: string): string =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !VENDOR.has(w))
    .join('')

/// The SDRF instrument against the one the input names (null: none).
export function compareInstrument(values: readonly string[], instrument: string | null): Partial3 {
  const vs = distinct(values)
  const sdrf = join(vs)
  if (!vs.length) return { state: 'no_sdrf', sdrf, fastag: instrument ?? '', note: 'the SDRF names no instrument' }
  if (!instrument) return { state: 'no_call', sdrf, fastag: '', note: 'the input names no instrument' }
  const ok = vs.some((v) => instrumentKey(nameOf(v)) === instrumentKey(instrument))
  return ok
    ? { state: 'match', sdrf, fastag: instrument, note: `the input names the instrument ${instrument}` }
    : { state: 'mismatch', sdrf, fastag: instrument, note: `the SDRF names ${vs.map(nameOf).join(', ')}; the input names ${instrument}` }
}

function tolerance(v: string): { value: number; unit: 'ppm' | 'Da' } | null {
  const m = /^\s*([+]?\d*\.?\d+(?:[eE][+-]?\d+)?)\s*(ppm|da|th|mmu)\s*$/i.exec(nameOf(v))
  if (!m) return null
  const u = m[2].toLowerCase()
  const x = Number(m[1])
  return u === 'ppm' ? { value: x, unit: 'ppm' } : { value: u === 'mmu' ? x / 1000 : x, unit: 'Da' }
}
const tolWords = (t: { value: number; unit: string }): string => `${t.value} ${t.unit}`

/// The SDRF fragment mass tolerance against the run's (null: not reported).
export function compareTolerance(values: readonly string[], run: { value: number; unit: 'ppm' | 'Da' } | null): Partial3 {
  const vs = distinct(values)
  const sdrf = join(vs)
  const fastag = run ? tolWords(run) : ''
  if (!vs.length) return { state: 'no_sdrf', sdrf, fastag, note: 'the SDRF names no fragment mass tolerance' }
  if (!run) return { state: 'no_call', sdrf, fastag, note: "the run's reports do not state its fragment tolerance" }
  const ts = vs.map(tolerance)
  if (ts.some((t) => t == null)) return { state: 'not_checkable', sdrf, fastag, note: `this app cannot read the tolerance ${vs.filter((_, i) => !ts[i]).join(', ')}` }
  const same = ts.some((t) => t!.unit === run.unit && Math.abs(t!.value - run.value) <= 1e-9 * Math.max(1, Math.abs(run.value)))
  return same
    ? { state: 'match', sdrf, fastag, note: `the run used the SDRF's fragment tolerance, ${fastag}` }
    : { state: 'mismatch', sdrf, fastag, note: `the SDRF states ${ts.map((t) => tolWords(t!)).join(', ')}; the run used ${fastag} (a setting, not a measurement)` }
}

// ---- a job against its rows -----------------------------------------------------

const kindOf = (d: JobData, k: Report['kind']): Report | undefined => d.reports.find((r) => r.kind === k)

function compareJob(t: SdrfTable, rows: number[], d: JobData, tx: Taxonomy | null): Record<FieldId, FieldResult> {
  const data = dataRows(t)
  const pick = (f: FieldId): { values: string[]; column: string } => {
    for (const name of FIELD_COLUMNS[f]) {
      const cols = columnsNamed(t, name)
      if (cols.length) return { values: rows.flatMap((r) => cols.map((c) => cellValue(data[r - 1].cells[c]))), column: name }
    }
    return { values: [], column: FIELD_COLUMNS[f][0] }
  }
  const cells = jobCells(d).cells
  const digest = kindOf(d, 'digest')
  const label = kindOf(d, 'label')
  const of = (r: Report | undefined): string => (r ? baseName(r.path) : '')

  // organism: the genus call by taxid
  const org = pick('organism')
  const orgVals = distinct(org.values)
  const sp = speciesCall(d.species)
  const top = cells.genus.call != null && sp.state === 'called' ? sp.present[0] : null
  const spPath = d.species ? baseName(d.species.path) : ''
  let organism: Partial3
  if (!orgVals.length) organism = { state: 'no_sdrf', sdrf: '', fastag: top ? `${top.name} (taxid ${top.taxid})` : '', note: 'the SDRF names no organism' }
  else if (!top) organism = { state: 'no_call', sdrf: join(orgVals), fastag: '', note: `FASTag made no genus call (${cells.genus.text})` }
  else if (!tx)
    organism = { state: 'not_checkable', sdrf: join(orgVals), fastag: `${top.name} (taxid ${top.taxid})`, note: 'the taxonomy (nodes.dmp, names.dmp) was not read' }
  else {
    const m = matchOrganism(tx, orgVals, top.taxid)
    organism = { state: m.state, sdrf: join(orgVals), fastag: `${top.name} (taxid ${top.taxid})`, note: m.note }
  }

  const cleav = pick('cleavage')
  const p = cells.protease.call
  const cls = digest ? value(digest, 'call', 'class') : undefined
  const lab = pick('label')
  const mods = pick('modifications')
  const l = cells.label.call
  // The digest report's run and meta rows, else the label report's.
  const fd = runFacts(digest)
  const fl = runFacts(label)
  const facts = fd.tolerance ? fd : fl
  const factsOf = fd.tolerance ? digest : label
  const instFacts = fd.instrument ? fd : fl
  const instOf = fd.instrument ? digest : label
  const modLine = runFixed(d.log)?.line
  const inst = pick('instrument')
  const tol = pick('tolerance')

  const res = (r: Partial3, column: string, evidence: string): FieldResult => ({ ...r, column, evidence: r.state === 'no_sdrf' || r.fastag === '' ? '' : evidence })
  return {
    organism: res(organism, org.column, top ? `${spPath}: genus ${top.name} (taxid ${top.taxid}) present` : ''),
    cleavage: res(compareCleavage(cleav.values, p, cls), cleav.column, `${of(digest)}: call model ${p}`),
    label: res(compareLabel(lab.values, mods.values, l), lab.column, `${of(label)}: label_call label ${l}`),
    modifications: res(compareModifications(mods.values, d.log), mods.column, `log: ${modLine ?? '(no Modifications line: none)'}`),
    instrument: res(compareInstrument(inst.values, instFacts.instrument), inst.column, `${of(instOf)}: meta instrument ${instFacts.instrument}`),
    tolerance: res(
      compareTolerance(tol.values, facts.tolerance),
      tol.column,
      facts.tolerance ? `${of(factsOf)}: run fragment_tolerance ${facts.tolerance.value} ${facts.tolerance.unit}` : ''
    )
  }
}

const NOT_RUN: Record<string, string> = { failed: 'the job failed', cancelled: 'the job was cancelled', queued: 'not run yet', running: 'running' }

function verdict(fields: Record<FieldId, FieldResult>): Verdict {
  const mismatches = FIELDS.filter((f) => fields[f].state === 'mismatch')
  if (mismatches.length) return { state: 'checked', text: `✗ ${mismatches.map((f) => FIELD_LABEL[f].toLowerCase()).join(', ')}`, mismatches }
  const checked = FIELDS.filter((f) => fields[f].state === 'match' || fields[f].state === 'genus')
  return checked.length ? { state: 'checked', text: '✓ consistent', mismatches: [] } : { state: 'unchecked', text: '? nothing to compare', mismatches: [] }
}

/// The input the CLI read, from its reports' run rows.
function reportInput(d: JobData | undefined): string | null {
  for (const r of d?.reports ?? []) {
    const v = value(r, 'run', 'input')
    if (v && v !== '-') return v
  }
  return null
}

/// The comparison of @p jobs (queue order) with @p t.
export function compareSdrf(t: SdrfTable, jobs: readonly SdrfJob[], tx: Taxonomy | null): SdrfComparison {
  const rows = dataRows(t)
  const dfCol = columnsNamed(t, DATA_FILE)[0]
  const missingColumns = FIELDS.filter((f) => !FIELD_COLUMNS[f].some((n) => columnsNamed(t, n).length))
  // data file -> its rows, in file order; matched by the exact basename
  // first, then by stem.
  const files = new Map<string, number[]>()
  if (dfCol !== undefined)
    for (const r of rows) {
      const f = cellValue(r.cells[dfCol]).trim()
      if (!f || !stated(f)) continue
      files.set(f, [...(files.get(f) ?? []), r.row])
    }
  const lookup = (name: string | null): string | null => {
    if (!name) return null
    const b = baseName(name.replace(/\\/g, '/')).toLowerCase()
    for (const f of files.keys()) if (baseName(f.replace(/\\/g, '/')).toLowerCase() === b) return f
    const s = fileStem(name)
    for (const f of files.keys()) if (fileStem(f) === s) return f
    return null
  }
  const used = new Set<string>()
  const out: JobComparison[] = jobs.map((j) => {
    const file = baseName(j.input.replace(/\\/g, '/'))
    const base = { input: j.input, file, dataFile: null, rows: [], fields: null }
    if (dfCol === undefined) return { ...base, verdict: { state: 'no_sdrf', text: 'the SDRF has no comment[data file] column', mismatches: [] } }
    const df = lookup(j.input) ?? lookup(reportInput(j.data))
    if (df) used.add(df)
    const at = df ? { dataFile: df, rows: files.get(df)! } : {}
    if (j.status !== 'done') return { ...base, ...at, verdict: { state: 'not_run', text: `not compared: ${NOT_RUN[j.status] ?? j.status}`, mismatches: [] } }
    if (!j.data || j.data.failed) return { ...base, ...at, verdict: { state: 'pending', text: j.data?.failed ? 'not compared: its reports could not be read' : 'reading…', mismatches: [] } }
    if (!df) return { ...base, verdict: { state: 'no_sdrf', text: 'not in the SDRF', mismatches: [] } }
    const fields = compareJob(t, files.get(df)!, j.data, tx)
    return { ...base, dataFile: df, rows: files.get(df)!, fields, verdict: verdict(fields) }
  })
  return {
    jobs: out,
    unmatched: [...files].filter(([f]) => !used.has(f)).map(([dataFile, rs]) => ({ dataFile, rows: rs })),
    dataFileColumn: dfCol !== undefined,
    missingColumns
  }
}

// ---- the corrections TSV -------------------------------------------------------

export const CORRECTIONS_HEADER = ['data_file', 'input', 'sdrf_rows', 'field', 'sdrf_column', 'sdrf_value', 'fastag_value', 'note', 'evidence'] as const

const tsvCell = (s: string): string => s.replace(/[\t\r\n]+/g, ' ')

/// The corrections TSV: one line per field that differs, ordered by the
/// SDRF (its first row), then by input name, then by field, so it does not
/// depend on the queue order. The SDRF itself is never rewritten.
export function correctionsTsv(c: SdrfComparison): string {
  const lines: { key: [number, string, number]; cells: string[] }[] = []
  for (const j of c.jobs) {
    if (!j.fields) continue
    FIELDS.forEach((f, k) => {
      const r = j.fields![f]
      if (r.state !== 'mismatch') return
      lines.push({
        key: [j.rows[0] ?? 0, j.file, k],
        cells: [j.dataFile ?? '', j.file, j.rows.join(','), f, r.column, r.sdrf, r.fastag, r.note, r.evidence]
      })
    })
  }
  lines.sort((a, b) => a.key[0] - b.key[0] || (a.key[1] < b.key[1] ? -1 : a.key[1] > b.key[1] ? 1 : 0) || a.key[2] - b.key[2])
  return [CORRECTIONS_HEADER.join('\t'), ...lines.map((l) => l.cells.map(tsvCell).join('\t')), ''].join('\n')
}
