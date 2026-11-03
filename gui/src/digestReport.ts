// Readers for the three long-form reports of FASTag 1.8.0 (-digest_out,
// -label_out, -massgap_out; doc/DESIGN-digest.md). Every file has the header
// `section key value n description`; the reports differ only in their sections.
// Everything here is pure so it can be tested without the bridge.

export type ReportKind = 'digest' | 'label' | 'massgap'

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
}

const COLUMNS = ['section', 'key', 'value', 'n', 'description'] as const

/// The 19 residues the counts use (I is counted as L).
export const ALPHABET = 'ACDEFGHKLMNPQRSTVWY'.split('')

export const C_POSITIONS = ['P4', 'P3', 'P2', 'P1'] as const
export const N_POSITIONS = ["P1'", "P2'", "P3'", "P4'"] as const

/// Parse one report. Throws with a readable message when the file is not one.
export function parseReport(text: string, path: string): Report {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0) throw new Error('the file is empty')
  const head = lines[0].split('\t').map((h) => h.trim())
  const idx = COLUMNS.map((c) => head.indexOf(c))
  const missing = COLUMNS.filter((_, i) => idx[i] < 0)
  if (missing.length) throw new Error(`not a FASTag report: no ${missing.join(', ')} column`)
  const rows: ReportRow[] = []
  for (const line of lines.slice(1)) {
    const f = line.split('\t')
    const at = (i: number): string => (f[idx[i]] ?? '').trim()
    const n = at(3)
    const nv = n === '' || n === '-' ? null : Number(n)
    rows.push({
      section: at(0),
      key: at(1),
      value: at(2),
      n: nv != null && Number.isFinite(nv) ? nv : null,
      description: at(4)
    })
  }
  const sections = new Set(rows.map((r) => r.section))
  let kind: ReportKind
  if (['call', 'pos', 'residue', 'model', 'nocall'].some((x) => sections.has(x))) kind = 'digest'
  else if (sections.has('nlabel') || sections.has('heavy')) kind = 'label'
  else if (sections.has('hist') || sections.has('peak') || sections.has('cys')) kind = 'massgap'
  else throw new Error('not a digest, label or mass-gap report: none of their sections is present')
  return { kind, path, rows }
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

export function num(s: string | undefined): number | null {
  if (s == null || s === '' || s === '-') return null
  const v = Number(s)
  return Number.isFinite(v) ? v : null
}

// ---- digest --------------------------------------------------------------

export interface DigestCall {
  status: 'call' | 'no_call' | 'unknown'
  model?: string
  cls?: string
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
  return {
    status: st === 'call' || st === 'no_call' ? st : 'unknown',
    model: v('model'),
    cls: v('class'),
    runnerUp: v('runner_up'),
    runnerUpClass: v('runner_up_class'),
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

export interface ModelScore {
  model: string
  cls: string
  loglik: number
}

/// Models in report order with their log-likelihood and class.
export function modelScores(r: Report): ModelScore[] {
  const out: ModelScore[] = []
  for (const x of section(r, 'model')) {
    if (!x.key.endsWith('.loglik')) continue
    const model = x.key.slice(0, -'.loglik'.length)
    const ll = num(x.value)
    if (ll == null) continue
    out.push({ model, cls: value(r, 'model', `${model}.class`) ?? '', loglik: ll })
  }
  return out
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
  const blank = (raw = 0): LogoColumn => ({ label, letters: [], bits: 0, n, raw, faded: false })
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
  return { label, letters, bits, n, raw, faded: false }
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
    return { ...out, faded: n < tagMin || (end === 'N' && nUnused) }
  }
  return [...C_POSITIONS.map((p) => col('C', p, qc)), ...N_POSITIONS.map((p) => col('N', p, qn))]
}

/// A model's logo drawn like the observed one: only P1 and P1' carry the
/// model; the other positions are the background and stay empty.
export function modelLogo(r: Report, model: string): LogoColumn[] | null {
  const c = modelDist(r, model, 'C')
  const n = modelDist(r, model, 'N')
  if (!c && !n) return null
  const empty = (p: string): LogoColumn => ({ label: p, letters: [], bits: 0, n: null, raw: 0, faded: false })
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
    const name = x.key.slice(0, x.key.lastIndexOf('.'))
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

/// Format a decimal for display without inventing precision.
export function fmt(v: number | null, digits = 3): string {
  if (v == null) return '–'
  if (Number.isInteger(v)) return v.toLocaleString()
  return Number(v.toFixed(digits)).toString()
}
