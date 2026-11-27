// Mass shifts by residue: the -delta_out table pivoted on its residues
// column (README, -delta_out: "site:count pairs separated by ',', most
// frequent first (ties by name), localized spectra only"). One row per mass
// shift, one column per site class: the 20 residues, and N-term and C-term
// for the terminal-ambiguous sites (N-term|K, Protein C-term|L). Each
// spectrum counts once, so a row's cells sum to its localized column.
// The matrix leaves out the unshifted rows (|gap| under SHIFT_MIN_DA, as the
// Mass shifts summary's "Shifted" count): their sites are sequence-
// constrained by construction (the gap region is the placement's C-terminal
// residue), not modification sites. Several runs' tables pool into one
// matrix (poolTables): rows merged by mass, counts summed.
// Pure: the view (ResidueMatrix.tsx) renders and exports what this returns.

import type { DeltaTable } from './tables'
import { SHIFT_MIN_DA } from './overview'

/// The 20 amino acids, in the order of the matrix.
export const AMINO_ACIDS = ['A', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'K', 'L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'V', 'W', 'Y'] as const

/// The residue names for the column tooltips.
export const RESIDUE_NAME: Record<string, string> = {
  A: 'alanine',
  C: 'cysteine',
  D: 'aspartate',
  E: 'glutamate',
  F: 'phenylalanine',
  G: 'glycine',
  H: 'histidine',
  I: 'isoleucine',
  K: 'lysine',
  L: 'leucine',
  M: 'methionine',
  N: 'asparagine',
  P: 'proline',
  Q: 'glutamine',
  R: 'arginine',
  S: 'serine',
  T: 'threonine',
  V: 'valine',
  W: 'tryptophan',
  Y: 'tyrosine'
}

export const N_TERM = 'N-term'
export const C_TERM = 'C-term'

export interface SiteCount {
  /// The site as the CLI wrote it: K, N-term|K, Protein C-term|L.
  site: string
  n: number
}

/// The pairs of a residues cell, in the file's order; none for '-' or ''.
/// A pair without a whole count after its last ':' is left out (and
/// counted in @p bad when given).
export function parseSites(cell: string, bad?: { n: number }): SiteCount[] {
  const c = cell.trim()
  if (c === '' || c === '-') return []
  const out: SiteCount[] = []
  for (const part of c.split(',')) {
    const p = part.trim()
    const at = p.lastIndexOf(':')
    const n = at > 0 ? Number(p.slice(at + 1)) : NaN
    if (!(Number.isInteger(n) && n >= 0)) {
      if (bad) bad.n++
      continue
    }
    out.push({ site: p.slice(0, at), n })
  }
  return out
}

/// How a terminal-ambiguous site is counted: under its terminus (N-term,
/// C-term) or under its residue (N-term|K under K).
export type TerminalMode = 'terminus' | 'residue'

const TERMINAL = /^(?:Protein )?([NC])-term\|(.+)$/

/// Whether @p site is terminal-ambiguous (N-term|K, Protein C-term|L).
export const isTerminal = (site: string): boolean => TERMINAL.test(site)

/// The matrix column of @p site: a residue is its own column; a terminal
/// site goes under N-term or C-term, or under its residue (@p mode
/// 'residue'); anything else is a column of its own name.
export function siteColumn(site: string, mode: TerminalMode = 'terminus'): string {
  const m = TERMINAL.exec(site)
  if (!m) return site
  return mode === 'residue' ? m[2] : m[1] === 'N' ? N_TERM : C_TERM
}

/// @p cols in the matrix's order: N-term, the 20 residues, C-term, then
/// any other site (a non-standard residue letter) by name.
export function columnOrder(cols: Iterable<string>): string[] {
  const rank = (c: string): number => (c === N_TERM ? 0 : (AMINO_ACIDS as readonly string[]).includes(c) ? 1 + AMINO_ACIDS.indexOf(c as (typeof AMINO_ACIDS)[number]) : c === C_TERM ? 21 : 22)
  return [...new Set(cols)].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))
}

/// The first entry of a unimod or psimod cell, without its mass error:
/// "TMT6plex@N-term/K/T/H(-0.5ppm);..." gives "TMT6plex@N-term/K/T/H".
export function firstName(cell: string | undefined): string {
  const c = (cell ?? '').trim()
  if (c === '' || c === '-') return ''
  return c.split(';')[0].replace(/\((?:[+-]?[\d.]+(?:ppm|mDa))\)$/, '').trim()
}

export interface MatrixRow {
  /// The row's place in the matrix (ResidueMatrix.rows).
  row: number
  /// The gap as printed, and as a number.
  key: string
  delta: number
  spectra: number
  /// The best name: the first UniMod entry, else the first PSI-MOD one,
  /// else the isotope error; '' when none. A pooled row: the entry the most
  /// of its spectra carry, with the sites its rows name (poolName).
  name: string
  /// The names behind it, for the tooltip (unimod; psimod; isotope error).
  names: string
  localized: number
  unlocalized: number
  /// The counts by column; a column without a count is absent.
  counts: Map<string, number>
  /// The sites behind each column, as written.
  detail: Map<string, SiteCount[]>
  /// The sum of the counts.
  sum: number
  /// The tables with a row in it (1 unless pooled), and the rows pooled.
  tables: number
  members: number
  /// The smallest and largest gap of the rows pooled (Da).
  lo: number
  hi: number
}

export interface ResidueMatrix {
  rows: MatrixRow[]
  /// Every column with a count in some row, in columnOrder.
  columns: string[]
  /// Some site is terminal-ambiguous.
  terminal: boolean
  /// Rows whose counts do not sum to localized (none in a CLI file).
  mismatched: number[]
  /// residues pairs that could not be read.
  unreadable: number
}

/// One row of a mass-shift table as the matrix reads it, before any
/// pivot: its sites as written.
export interface SourceRow {
  key: string
  delta: number
  spectra: number
  localized: number
  unlocalized: number
  sites: SiteCount[]
  name: string
  names: string
}

/// A mass-shift table as the matrix reads it (sourceOf).
export interface MatrixSource {
  path: string
  rows: SourceRow[]
  /// residues pairs that could not be read.
  unreadable: number
}

/// The rows of the delta table @p t as the matrix reads them, or null when
/// it has no residues column (a table of FASTag 1.15.1 or earlier).
export function sourceOf(t: DeltaTable): MatrixSource | null {
  const res = t.extra['residues']
  if (!res) return null
  const col = (id: string): string[] | undefined => t.extra[id]
  const loc = col('localized')
  const unloc = col('unlocalized')
  const unimod = col('unimod')
  const psimod = col('psimod')
  const iso = col('isotope_error')
  const count = (v: string[] | undefined, i: number): number | null => {
    const x = v ? Number(v[i]) : NaN
    return Number.isFinite(x) ? x : null
  }
  const bad = { n: 0 }
  const rows: SourceRow[] = []
  for (let i = 0; i < t.rows; i++) {
    const sites = parseSites(res[i] ?? '', bad)
    // Without a localized column, the sites are all there is.
    const localized = count(loc, i) ?? sites.reduce((n, s) => n + s.n, 0)
    const isoName = (iso?.[i] ?? '').trim()
    const name = firstName(unimod?.[i]) || firstName(psimod?.[i]) || (isoName === '-' ? '' : firstName(isoName))
    const names = [unimod?.[i], psimod?.[i], iso?.[i]]
      .map((v) => (v ?? '').trim())
      .filter((v) => v !== '' && v !== '-')
      .join('; ')
    rows.push({ key: t.keys[i], delta: t.delta[i], spectra: t.spectra[i], localized, unlocalized: count(unloc, i) ?? 0, sites, name, names })
  }
  return { path: t.path, rows, unreadable: bad.n }
}

/// A matrix row of the source rows @p rs (one, or the rows poolTables
/// merged), its key and gap those of @p rs[0], its cells by @p mode.
function matrixRow(rs: readonly SourceRow[], tables: number, mode: TerminalMode, name: string, names: string): MatrixRow & { terminal: boolean } {
  const counts = new Map<string, number>()
  const bySite = new Map<string, Map<string, number>>()
  let sum = 0
  let terminal = false
  let spectra = 0
  let localized = 0
  let unlocalized = 0
  let lo = Infinity
  let hi = -Infinity
  for (const r of rs) {
    spectra += r.spectra
    localized += r.localized
    unlocalized += r.unlocalized
    lo = Math.min(lo, r.delta)
    hi = Math.max(hi, r.delta)
    for (const s of r.sites) {
      if (isTerminal(s.site)) terminal = true
      const c = siteColumn(s.site, mode)
      counts.set(c, (counts.get(c) ?? 0) + s.n)
      let d = bySite.get(c)
      if (!d) bySite.set(c, (d = new Map()))
      d.set(s.site, (d.get(s.site) ?? 0) + s.n)
      sum += s.n
    }
  }
  // One row: its sites in the file's order; pooled: most first, ties by name, as the CLI orders them.
  const detail = new Map<string, SiteCount[]>()
  for (const [c, d] of bySite) {
    const list = [...d].map(([site, n]) => ({ site, n }))
    if (rs.length > 1) list.sort((a, b) => b.n - a.n || (a.site < b.site ? -1 : a.site > b.site ? 1 : 0))
    detail.set(c, list)
  }
  return { row: 0, key: rs[0].key, delta: rs[0].delta, spectra, name, names, localized, unlocalized, counts, detail, sum, tables, members: rs.length, lo, hi, terminal }
}

/// The delta table @p t by residue, every row of it, or null when it has no
/// residues column (a table of FASTag 1.15.1 or earlier).
export function pivotResidues(t: DeltaTable, mode: TerminalMode = 'terminus'): ResidueMatrix | null {
  const src = sourceOf(t)
  if (!src) return null
  const used = new Set<string>()
  let terminal = false
  const rows: MatrixRow[] = []
  const mismatched: number[] = []
  src.rows.forEach((r, i) => {
    const { terminal: term, ...m } = matrixRow([r], 1, mode, r.name, r.names)
    m.row = i
    if (term) terminal = true
    for (const c of m.counts.keys()) used.add(c)
    if (m.localized !== m.sum) mismatched.push(i)
    rows.push(m)
  })
  return { rows, columns: columnOrder(used), terminal, mismatched, unreadable: src.unreadable }
}

/// The -delta_group default (Da): one run's rows are at most twice this
/// wide, and their gaps at least 0.0045 Da apart (README, -delta_out).
export const DELTA_GROUP_DA = 0.004

/// What a matrix of one or more tables left out, per table.
export interface PoolPart {
  path: string
  /// Rows and spectra with |gap| of SHIFT_MIN_DA or more: in the matrix.
  rows: number
  spectra: number
  /// Rows and spectra nearer 0: unshifted placements, left out.
  unshiftedRows: number
  unshiftedSpectra: number
}

export interface PooledMatrix extends ResidueMatrix {
  parts: PoolPart[]
  /// The unshifted rows and spectra of all tables, left out.
  unshiftedRows: number
  unshiftedSpectra: number
  /// Rows within this many Da of a row's gap are one row (Da).
  tolerance: number
}

/// The sites a pooled best name shows.
export const POOL_NAME_SITES = 3

/// A best name split at its '@': the entry (Oxidation, Oxidation+Acetyl,
/// 13C+1) and its sites, most-supported first (M/W); none for an isotope error.
export function nameParts(name: string): { entry: string; sites: string[] } {
  const at = name.indexOf('@')
  return at < 0 ? { entry: name, sites: [] } : { entry: name.slice(0, at), sites: name.slice(at + 1).split('/') }
}

/// The localized spectra of a pooled row on @p token, a site as a name
/// writes it (M, N-term, Protein N-term, C[-Carbamidomethyl]): on the
/// residue, also terminal-ambiguous (N-term|M for M); on a terminus, its
/// terminal sites.
function siteSupport(token: string, detail: ReadonlyMap<string, readonly SiteCount[]>): number {
  const t = token.replace(/\[.*\]$/, '')
  let n = 0
  for (const list of detail.values())
    for (const s of list) if (s.site === t || (/-term$/.test(t) ? s.site.startsWith(`${t}|`) : s.site.endsWith(`|${t}`))) n += s.n
  return n
}

/// The best name of the rows @p rs pooled into one, and the names behind
/// it. One row keeps its own. Several: each row's best name votes for its
/// entry (the name before '@') with the row's spectra, rows without a name
/// do not vote, ties go by entry; the winner is written with the sites its
/// voters named (a run names the sites its own localized spectra support),
/// the pooled row's most-supported first, as the CLI orders them: so
/// Oxidation@M in one run and Oxidation@W/M in another pool to
/// Oxidation@M/W when M holds more pooled spectra. The name shows the
/// POOL_NAME_SITES most-supported sites and '…' for more (the tooltip, the
/// names, has them all: across hundreds of runs a list grows long).
/// '' when none has a name.
function poolName(rs: readonly { r: SourceRow; s: number }[], detail: ReadonlyMap<string, readonly SiteCount[]>): { name: string; names: string } {
  if (rs.length === 1) return { name: rs[0].r.name, names: rs[0].r.names }
  const votes = new Map<string, { spectra: number; tables: Set<number>; sites: string[] }>()
  for (const { r, s } of rs) {
    if (!r.name) continue
    const { entry, sites } = nameParts(r.name)
    let v = votes.get(entry)
    if (!v) votes.set(entry, (v = { spectra: 0, tables: new Set(), sites: [] }))
    v.spectra += r.spectra
    v.tables.add(s)
    for (const x of sites) if (!v.sites.includes(x)) v.sites.push(x)
  }
  const written = (entry: string, sites: readonly string[], max = Infinity): string => {
    if (sites.length === 0) return entry
    const order = sites.map((x, k) => ({ x, k, n: siteSupport(x, detail) })).sort((a, b) => b.n - a.n || a.k - b.k)
    return `${entry}@${order.slice(0, max).map((o) => o.x).join('/')}${order.length > max ? '/…' : ''}`
  }
  const ranked = [...votes].sort((a, b) => b[1].spectra - a[1].spectra || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const en = (n: number): string => n.toLocaleString('en-US')
  const names = ranked.map(([e, v]) => `${written(e, v.sites)}: ${en(v.spectra)} spectra in ${en(v.tables.size)} ${v.tables.size === 1 ? 'table' : 'tables'}`).join('; ')
  return { name: ranked.length ? written(ranked[0][0], ranked[0][1].sites, POOL_NAME_SITES) : '', names: names && `Best names of the pooled rows: ${names}` }
}

/// The matrix of the tables @p sources, pooled: their rows with |gap| of
/// @p minAbs or more (nearer 0 is the unshifted placement: its site is the
/// residue the placement ends on, not a modification site), merged by mass
/// as -delta_group merges one run's bins: the row with the most spectra
/// (ties: the smaller gap, the earlier table) takes every row not yet taken
/// within @p tolerance Da of its gap, then the next row not taken, without
/// chaining. A pooled row has that first row's gap, the sums of the spectra,
/// localized, unlocalized and site counts of its rows, and the best name of
/// the entry the most of its spectra carry (poolName). One table pools to its own rows:
/// at the default its gaps are more than 0.004 Da apart. Rows in order of gap.
export function poolTables(sources: readonly MatrixSource[], mode: TerminalMode = 'terminus', tolerance = DELTA_GROUP_DA, minAbs = SHIFT_MIN_DA): PooledMatrix {
  const all: { r: SourceRow; s: number; i: number }[] = []
  let unreadable = 0
  const parts: PoolPart[] = sources.map((src, s) => {
    unreadable += src.unreadable
    const part: PoolPart = { path: src.path, rows: 0, spectra: 0, unshiftedRows: 0, unshiftedSpectra: 0 }
    src.rows.forEach((r, i) => {
      if (Number.isNaN(r.delta)) return
      if (Math.abs(r.delta) < minAbs) {
        part.unshiftedRows++
        part.unshiftedSpectra += r.spectra
        return
      }
      part.rows++
      part.spectra += r.spectra
      all.push({ r, s, i })
    })
    return part
  })
  // By gap, for the window of each seed; the seeds by spectra.
  const byGap = all.map((_, k) => k).sort((a, b) => all[a].r.delta - all[b].r.delta || all[a].s - all[b].s || all[a].i - all[b].i)
  const seeds = all.map((_, k) => k).sort((a, b) => all[b].r.spectra - all[a].r.spectra || all[a].r.delta - all[b].r.delta || all[a].s - all[b].s || all[a].i - all[b].i)
  const gapAt = byGap.map((k) => all[k].r.delta)
  const lowerBound = (x: number): number => {
    let lo = 0
    let hi = gapAt.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (gapAt[mid] < x) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  // The rows' gaps are printed to 4 decimals: a row 0.0040 Da away is within 0.004.
  const eps = 1e-9
  const taken = new Uint8Array(all.length)
  const groups: number[][] = []
  for (const k of seeds) {
    if (taken[k]) continue
    const d = all[k].r.delta
    const g = [k]
    taken[k] = 1
    for (let j = lowerBound(d - tolerance - eps); j < byGap.length && gapAt[j] <= d + tolerance + eps; j++) {
      const m = byGap[j]
      if (taken[m]) continue
      taken[m] = 1
      g.push(m)
    }
    groups.push(g)
  }
  groups.sort((a, b) => all[a[0]].r.delta - all[b[0]].r.delta)
  const used = new Set<string>()
  let terminal = false
  const mismatched: number[] = []
  const rows = groups.map((g, i) => {
    const members = g.map((k) => all[k])
    const { terminal: term, ...m } = matrixRow(
      members.map((x) => x.r),
      new Set(members.map((x) => x.s)).size,
      mode,
      '',
      ''
    )
    const named = poolName(members, m.detail)
    m.name = named.name
    m.names = named.names
    m.row = i
    if (term) terminal = true
    for (const c of m.counts.keys()) used.add(c)
    if (m.localized !== m.sum) mismatched.push(i)
    return m
  })
  return {
    rows,
    columns: columnOrder(used),
    terminal,
    mismatched,
    unreadable,
    parts,
    unshiftedRows: parts.reduce((n, p) => n + p.unshiftedRows, 0),
    unshiftedSpectra: parts.reduce((n, p) => n + p.unshiftedSpectra, 0),
    tolerance
  }
}

/// The pooling tolerance of tables whose runs used @p groups as
/// -delta_group (null: the run is not recorded): that value when every
/// recorded run used the same one above 0, else the default. A table does
/// not record its grouping; the app's History records the command line.
export function poolTolerance(groups: readonly (number | null)[]): { tolerance: number; recorded: boolean } {
  const known = [...new Set(groups.filter((g): g is number => g != null))]
  if (known.length === 1 && known[0] > 0 && groups.every((g) => g != null)) return { tolerance: known[0], recorded: true }
  return { tolerance: DELTA_GROUP_DA, recorded: false }
}

/// The -delta_group of a run's command line @p argv: its value, else the
/// default (the run left it so); null for a value that is not a number.
export function deltaGroupOf(argv: readonly string[]): number | null {
  const i = argv.indexOf('-delta_group')
  if (i < 0) return DELTA_GROUP_DA
  const x = Number(argv[i + 1])
  return Number.isFinite(x) && x >= 0 ? x : null
}

/// The columns the matrix shows: those with a count in @p rows when
/// @p hideEmpty; else the 20 residues, N-term and C-term when the table has
/// terminal sites, and any other site of @p m.
export function shownColumns(m: ResidueMatrix, rows: readonly MatrixRow[], hideEmpty: boolean, mode: TerminalMode): string[] {
  if (hideEmpty) {
    const have = new Set<string>()
    for (const r of rows) for (const [c, n] of r.counts) if (n > 0) have.add(c)
    return columnOrder(have)
  }
  const ends = m.terminal && mode === 'terminus' ? [N_TERM, C_TERM] : []
  return columnOrder([...AMINO_ACIDS, ...ends, ...m.columns])
}

/// The share of a row's spectra that is localized, in whole percent; null
/// for a row without spectra.
export function localizedPct(r: MatrixRow): number | null {
  return r.spectra > 0 ? Math.round((100 * r.localized) / r.spectra) : null
}

/// A table as text: tab-separated (tabs and line breaks in a value become a
/// space, as the shown-rows export writes them), or comma-separated with
/// RFC 4180 quoting.
export function delimited(head: readonly string[], body: readonly (readonly string[])[], format: 'tsv' | 'csv'): string {
  const cell =
    format === 'tsv'
      ? (v: string): string => v.replace(/[\t\r\n]+/g, ' ')
      : (v: string): string => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const sep = format === 'tsv' ? '\t' : ','
  return [head, ...body].map((r) => r.map(cell).join(sep)).join('\n') + '\n'
}
