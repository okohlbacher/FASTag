// Readers for FASTag's long-form reports (-digest_out, -label_out,
// -massgap_out; doc/DESIGN-digest.md; and, from 1.12, -alkylation_out;
// doc/ALKYLATION-REPORT.md). Every file has the header
// `section key value n description`; the reports differ only in their sections.
// Everything here is pure so it can be tested without the bridge.

export type ReportKind = 'digest' | 'label' | 'massgap' | 'alkylation'

export interface ReportRow {
  section: string
  key: string
  value: string
  /// Tags or spectra the value is based on; null for `-`.
  n: number | null
  description: string
}

export interface Report {
  kind: ReportKind
  path: string
  rows: ReportRow[]
  /// What a reader should know about a malformed file, e.g. a repeated key.
  warnings: string[]
}

const COLUMNS = ['section', 'key', 'value', 'n', 'description'] as const

/// The 19 residues the counts use (I is counted as L).
export const ALPHABET = 'ACDEFGHKLMNPQRSTVWY'.split('')

export const C_POSITIONS = ['P4', 'P3', 'P2', 'P1'] as const
export const N_POSITIONS = ["P1'", "P2'", "P3'", "P4'"] as const

/// The rows of any long-form FASTag report (`section key value n
/// description`), whatever its sections: the reports below, and the 1.12
/// census summary (results/calls.ts). Throws when the header is not one.
export function parseRows(text: string): ReportRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0) throw new Error('the file is empty')
  const head = lines[0].split('\t').map((h) => h.trim())
  const idx = COLUMNS.map((c) => head.indexOf(c))
  const missing = COLUMNS.filter((_, i) => idx[i] < 0)
  if (missing.length) throw new Error(`not a FASTag report: no ${missing.join(', ')} column`)
  return lines.slice(1).map((line) => {
    const f = line.split('\t')
    const at = (i: number): string => (f[idx[i]] ?? '').trim()
    return { section: at(0), key: at(1), value: at(2), n: num(at(3)), description: at(4) }
  })
}

/// Parse one report. Throws with a readable message when the file is not one.
export function parseReport(text: string, path: string): Report {
  const rows = parseRows(text)
  const seen = new Set<string>()
  const repeated = new Set<string>()
  for (const r of rows) {
    const id = `${r.section} ${r.key}`
    if (seen.has(id)) repeated.add(id)
    seen.add(id)
  }
  // The writer never repeats a key; the first row is the one read.
  const warnings = [...repeated].map((id) => `${baseName(path)} has more than one ${id} row; the first one is used.`)
  const sections = new Set(rows.map((r) => r.section))
  let kind: ReportKind
  // The alkylation report's sections (alk_run, alk_cys, alkylation_call) are
  // tested first: they never collide with the others' names, and a mass-gap
  // report is recognised by its `cys` section.
  if (sections.has('alkylation_call')) kind = 'alkylation'
  else if (['call', 'pos', 'residue', 'model', 'nocall'].some((x) => sections.has(x))) kind = 'digest'
  else if (sections.has('nlabel') || sections.has('heavy')) kind = 'label'
  else if (sections.has('hist') || sections.has('peak') || sections.has('cys')) kind = 'massgap'
  else throw new Error('not a digest, label, mass-gap or alkylation report: none of their sections is present')
  return { kind, path, rows, warnings }
}

export function section(r: Report, name: string): ReportRow[] {
  return r.rows.filter((x) => x.section === name)
}

export function row(r: Report, sec: string, key: string): ReportRow | undefined {
  return r.rows.find((x) => x.section === sec && x.key === key)
}

export function value(r: Report, sec: string, key: string): string | undefined {
  return row(r, sec, key)?.value
}

/// A decimal number as the CLI writes it; hex, binary and octal literals,
/// which Number() would accept, are not numbers here.
export const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

export function num(s: string | undefined): number | null {
  if (s == null || !DECIMAL.test(s)) return null
  const v = Number(s)
  return Number.isFinite(v) ? v : null
}

// ---- digest --------------------------------------------------------------

export interface DigestCall {
  status: 'call' | 'no_call' | 'unknown'
  model?: string
  cls?: string
  /// Absent when the model table has no model of another class (`none`).
  runnerUp?: string
  runnerUpClass?: string
  margin: number | null
  usesNterm: boolean | null
  reason?: string
  /// Rules that fired (`yes`) and rules whose metadata was absent (`unknown`).
  fired: string[]
  unknown: string[]
}

export function digestCall(r: Report): DigestCall {
  const v = (k: string): string | undefined => value(r, 'call', k)
  const st = v('status')
  const nocall = section(r, 'nocall')
  const runnerUp = v('runner_up') === 'none' ? undefined : v('runner_up')
  return {
    status: st === 'call' || st === 'no_call' ? st : 'unknown',
    model: v('model'),
    cls: v('class'),
    runnerUp,
    runnerUpClass: runnerUp == null || v('runner_up_class') === 'none' ? undefined : v('runner_up_class'),
    margin: num(v('margin')),
    usesNterm: v('uses_nterm') == null ? null : v('uses_nterm') === 'yes',
    reason: v('reason'),
    fired: nocall.filter((x) => x.value === 'yes').map((x) => x.key),
    unknown: nocall.filter((x) => x.value === 'unknown').map((x) => x.key)
  }
}

export type Dist = Record<string, number>

function endDist(rows: ReportRow[], prefix: string): Dist | null {
  const out: Dist = {}
  for (const x of rows) {
    if (!x.key.startsWith(prefix)) continue
    const aa = x.key.slice(prefix.length)
    const v = num(x.value)
    if (v != null && ALPHABET.includes(aa)) out[aa] = v
  }
  return Object.keys(out).length ? out : null
}

/// Counts at one position, e.g. positionCounts(r, 'C', 'P1') -> { K: 1003, R: 781, ... }.
export function positionCounts(r: Report, end: 'C' | 'N', pos: string): Dist {
  return endDist(section(r, 'pos'), `${end}.${pos}.`) ?? {}
}

/// The background of one end (`background` section, `C.<aa>` / `N.<aa>`).
export function background(r: Report, end: 'C' | 'N'): Dist | null {
  return endDist(section(r, 'background'), `${end}.`)
}

/// A model's residue distribution at one end (`model` section, `<model>.C.<aa>`).
export function modelDist(r: Report, model: string, end: 'C' | 'N'): Dist | null {
  return endDist(section(r, 'model'), `${model}.${end}.`)
}

// ---- sequence logo -------------------------------------------------------

export interface LogoLetter {
  aa: string
  bits: number
}

export interface LogoColumn {
  label: string
  /// Letters from the bottom of the stack to the top (smallest first).
  letters: LogoLetter[]
  /// Information content of the column, Σ f_b log2(f_b / q_b).
  bits: number
  /// Observations under the column; null for a model column.
  n: number | null
  /// Information before the small-sample correction (equals bits for a model).
  raw: number
  /// Fewer observations than the call needs (or an N-end column the call
  /// leaves out): drawn greyed.
  faded: boolean
  /// Why the column is greyed, in words; null when it is not.
  fadedBecause: string | null
}

const uniform: Dist = Object.fromEntries(ALPHABET.map((a) => [a, 1 / ALPHABET.length]))

function normalize(d: Dist): Dist {
  const s = ALPHABET.reduce((t, a) => t + (d[a] > 0 ? d[a] : 0), 0)
  if (s <= 0) return {}
  return Object.fromEntries(ALPHABET.map((a) => [a, d[a] > 0 ? d[a] / s : 0]))
}

/// Expected information of a column of @p n draws from the background itself,
/// (s − 1) / (2 n ln 2) bits over s residues (Schneider et al. 1986): what a
/// small sample shows with no motif at all.
export function smallSampleBias(n: number, s = ALPHABET.length): number {
  return n > 0 ? (s - 1) / (2 * n * Math.LN2) : 0
}

/// One logo column against background q: letter height f_a · I, where
/// I = Σ_b f_b log2(f_b/q_b) less the small-sample bias for an observed
/// column (n not null), clamped at 0. Residues with no background share are
/// left out of the sum and the stack.
export function logoColumn(label: string, weights: Dist | null, q: Dist | null, n: number | null): LogoColumn {
  const blank = (raw = 0): LogoColumn => ({ label, letters: [], bits: 0, n, raw, faded: false, fadedBecause: null })
  if (!weights) return blank()
  const f = normalize(weights)
  const bg = normalize(q ?? uniform)
  const s = ALPHABET.filter((a) => bg[a] > 0).length
  let raw = 0
  for (const a of ALPHABET) if (f[a] > 0 && bg[a] > 0) raw += f[a] * Math.log2(f[a] / bg[a])
  const bits = n == null ? raw : Math.max(0, raw - smallSampleBias(n, s))
  // A model end copied from the background differs from it only by rounding.
  if (!(bits > 1e-9)) return blank(raw > 1e-9 ? raw : 0)
  const letters = ALPHABET.filter((a) => f[a] > 0 && bg[a] > 0)
    .map((a) => ({ aa: a, bits: f[a] * bits }))
    .sort((x, y) => x.bits - y.bits || (x.aa < y.aa ? 1 : -1))
  return { label, letters, bits, n, raw, faded: false, fadedBecause: null }
}

const sum = (d: Dist): number => Object.values(d).reduce((t, v) => t + v, 0)

/// The observed logo P4..P1 | P1'..P4'. P positions use the C-end background,
/// P' positions the N-end background. Columns with fewer than the report's
/// tag_min observations are faded, and so are the P' columns when the call
/// leaves out the N end.
export function observedLogo(r: Report): LogoColumn[] {
  const qc = background(r, 'C')
  const qn = background(r, 'N')
  const tagMin = num(value(r, 'run', 'tag_min')) ?? 0
  const nUnused = value(r, 'call', 'uses_nterm') === 'no'
  const col = (end: 'C' | 'N', p: string, q: Dist | null): LogoColumn => {
    const c = positionCounts(r, end, p)
    const n = sum(c)
    const out = logoColumn(p, n > 0 ? c : null, q, n)
    const because = end === 'N' && nUnused ? 'N end not used by the call' : n < tagMin ? 'few tag ends' : null
    return { ...out, faded: because != null, fadedBecause: because }
  }
  return [...C_POSITIONS.map((p) => col('C', p, qc)), ...N_POSITIONS.map((p) => col('N', p, qn))]
}

/// A model's logo drawn like the observed one: only P1 and P1' carry the
/// model; the other positions are the background and stay empty.
export function modelLogo(r: Report, model: string): LogoColumn[] | null {
  const c = modelDist(r, model, 'C')
  const n = modelDist(r, model, 'N')
  if (!c && !n) return null
  const empty = (p: string): LogoColumn => ({ label: p, letters: [], bits: 0, n: null, raw: 0, faded: false, fadedBecause: null })
  return [
    ...C_POSITIONS.map((p) => (p === 'P1' ? logoColumn(p, c, background(r, 'C'), null) : empty(p))),
    ...N_POSITIONS.map((p) => (p === "P1'" ? logoColumn(p, n, background(r, 'N'), null) : empty(p)))
  ]
}

// ---- label ---------------------------------------------------------------

export interface LabelFinding {
  label: string
  count: number | null
  background: number | null
  share: number | null
  n: number | null
}

export function labelFindings(r: Report): LabelFinding[] {
  const names: string[] = []
  for (const x of section(r, 'nlabel')) {
    // Keys are <label>.<field>; one without a dot names no label.
    const dot = x.key.lastIndexOf('.')
    const name = dot > 0 ? x.key.slice(0, dot) : ''
    if (name && !names.includes(name)) names.push(name)
  }
  return names.map((label) => ({
    label,
    count: num(value(r, 'nlabel', `${label}.count`)),
    background: num(value(r, 'nlabel', `${label}.background`)),
    share: num(value(r, 'nlabel', `${label}.share`)),
    n: row(r, 'nlabel', `${label}.count`)?.n ?? null
  }))
}

// ---- alkylation (1.12, -alkylation_out format 1) ---------------------------

export interface AlkylationCall {
  status: 'call' | 'no_call' | 'unknown'
  /// Unimod name of the reagent, or `none` (not alkylated); absent on no_call.
  reagent?: string
  /// Mass on C in Da; null for `none` and on no_call.
  mass: number | null
  /// Share of the binned spectra (the leading class's on no_call).
  share: number | null
  /// Binned spectra the call is based on.
  binned: number | null
  /// `few_cys_spectra` or `ambiguous` on no_call.
  reason?: string
  /// `recon_fasta`, `fasta`, `proteome` or `bundled:<name>`.
  databaseSource?: string
  /// The `alk_run format` value; a reader knows format 1.
  format: number | null
}

/// The call of an -alkylation_out report, read by (section, key) as
/// doc/ALKYLATION-REPORT.md requires.
export function alkylationCall(r: Report): AlkylationCall {
  const v = (k: string): string | undefined => value(r, 'alkylation_call', k)
  const st = v('status')
  const called = st === 'call'
  const reagent = v('reagent')
  return {
    status: called || st === 'no_call' ? st : 'unknown',
    reagent: called && reagent != null && reagent !== '-' ? reagent : undefined,
    mass: called ? num(v('mass')) : null,
    share: num(v('share')),
    binned: row(r, 'alkylation_call', 'status')?.n ?? null,
    reason: v('reason') == null || v('reason') === '-' ? undefined : v('reason'),
    databaseSource: value(r, 'alk_run', 'database_source'),
    format: num(value(r, 'alk_run', 'format'))
  }
}

// ---- mass gaps -----------------------------------------------------------

export interface GapBin {
  gap: number
  key: string
  spectra: number
}

export function gapHistogram(r: Report): GapBin[] {
  const out: GapBin[] = []
  for (const x of section(r, 'hist')) {
    const gap = num(x.key)
    const spectra = num(x.value)
    if (gap != null && spectra != null) out.push({ gap, key: x.key, spectra })
  }
  return out.sort((a, b) => a.gap - b.gap)
}

/// The @p limit most populated bins, back in gap order; all when limit is null.
export function topBins(bins: GapBin[], limit: number | null): GapBin[] {
  if (limit == null || bins.length <= limit) return bins
  const keep = new Set([...bins].sort((a, b) => b.spectra - a.spectra || a.gap - b.gap).slice(0, limit))
  return bins.filter((b) => keep.has(b))
}

export interface GapPeak {
  index: number
  delta: number | null
  spectra: number | null
  explainedBy: string
  alternatives: string[]
  context: string
}

/// What the `background` run row names, in words.
export function backgroundWords(token: string | undefined): string | null {
  if (!token) return null
  if (token === 'shipped_human') return 'the human reference proteome shipped with FASTag'
  if (token === 'models_table') return 'the background in the model table'
  if (token.startsWith('fasta:')) return `the residue composition of ${baseName(token.slice(6))}`
  return token
}

/// The last path component, for either separator.
export function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || p
}

export function gapPeaks(r: Report): GapPeak[] {
  const ids: number[] = []
  for (const x of section(r, 'peak')) {
    const i = Number(x.key.split('.')[0])
    if (Number.isInteger(i) && !ids.includes(i)) ids.push(i)
  }
  return ids
    .sort((a, b) => a - b)
    .map((i) => {
      const v = (k: string): string | undefined => value(r, 'peak', `${i}.${k}`)
      const alt = v('alternatives') ?? ''
      return {
        index: i,
        delta: num(v('delta')),
        spectra: num(v('spectra')),
        explainedBy: v('explained_by') ?? 'none',
        alternatives: alt === '' || alt === '-' ? [] : alt.split(';'),
        context: v('context') ?? ''
      }
    })
}

const formats = new Map<string, Intl.NumberFormat>()
const format = (o: Intl.NumberFormatOptions): Intl.NumberFormat => {
  const k = JSON.stringify(o)
  let f = formats.get(k)
  if (!f) formats.set(k, (f = new Intl.NumberFormat('en-US', o)))
  return f
}

/// Format a number for display without inventing precision: at most @p digits
/// decimals, and three significant digits for a non-zero value they would
/// round to 0. One fixed format (1,234.5) whatever the OS locale, so counts
/// and decimals in one table read alike.
export function fmt(v: number | null, digits = 3): string {
  if (v == null) return '–'
  if (v !== 0 && Math.abs(v) < 0.5 * 10 ** -digits) return format({ maximumSignificantDigits: 3 }).format(v)
  return format({ maximumFractionDigits: digits }).format(v)
}

/// A share (0..1) as a percentage, up to two decimals (12.43%); a non-zero
/// share too small for them keeps three significant digits (0.00181%), as
/// fmt does, so it does not read as 0.
export function pct(v: number | null): string {
  return v == null ? '–' : `${fmt(v * 100, 2)}%`
}

/// A mass difference in Da with its sign and four decimals: +0.9840, −484.5920.
export function signedDa(v: number | null): string {
  if (v == null) return '–'
  const s = format({ minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(Math.abs(v))
  return v > 0 ? `+${s}` : v < 0 && s !== '0.0000' ? `−${s}` : s
}

/// The integers of a report sentence in the one number format the cards use
/// (3614 -> 3,614). A decimal's digits, a zero-padded code and a name such as
/// PXD063917 or K8 stay as written.
export function groupDigits(text: string): string {
  // The prefix group (start, a non-word non-dot character, or a non-digit
  // followed by a dot) keeps decimal digits and names such as PXD063917
  // unchanged; it is put back in front of the grouped number.
  return text.replace(/(^|[^\w.]|\D\.)([1-9]\d{3,})(?!\w|\.\d)/g, (_, pre: string, d: string) => `${pre}${fmt(Number(d))}`)
}
