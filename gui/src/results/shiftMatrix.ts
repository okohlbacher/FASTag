// Mass shifts by residue: the -delta_out table pivoted on its residues
// column (README, -delta_out: "site:count pairs separated by ',', most
// frequent first (ties by name), localized spectra only"). One row per mass
// shift, one column per site class: the 20 residues, and N-term and C-term
// for the terminal-ambiguous sites (N-term|K, Protein C-term|L). Each
// spectrum counts once, so a row's cells sum to its localized column.
// Pure: the view (ResidueMatrix.tsx) renders and exports what this returns.

import type { DeltaTable } from './tables'

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
  /// The row of the delta table.
  row: number
  /// The gap as printed, and as a number.
  key: string
  delta: number
  spectra: number
  /// The best name: the first UniMod entry, else the first PSI-MOD one,
  /// else the isotope error; '' when none.
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

/// The delta table @p t by residue, or null when it has no residues column
/// (a table of FASTag 1.15.1 or earlier).
export function pivotResidues(t: DeltaTable, mode: TerminalMode = 'terminus'): ResidueMatrix | null {
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
  const used = new Set<string>()
  let terminal = false
  const rows: MatrixRow[] = []
  const mismatched: number[] = []
  for (let i = 0; i < t.rows; i++) {
    const sites = parseSites(res[i] ?? '', bad)
    const counts = new Map<string, number>()
    const detail = new Map<string, SiteCount[]>()
    let sum = 0
    for (const s of sites) {
      if (isTerminal(s.site)) terminal = true
      const c = siteColumn(s.site, mode)
      counts.set(c, (counts.get(c) ?? 0) + s.n)
      detail.set(c, [...(detail.get(c) ?? []), s])
      used.add(c)
      sum += s.n
    }
    // Without a localized column, the sites are all there is.
    const localized = count(loc, i) ?? sum
    if (localized !== sum) mismatched.push(i)
    const isoName = (iso?.[i] ?? '').trim()
    const named = firstName(unimod?.[i]) || firstName(psimod?.[i]) || (isoName === '-' ? '' : firstName(isoName))
    const names = [unimod?.[i], psimod?.[i], iso?.[i]]
      .map((v) => (v ?? '').trim())
      .filter((v) => v !== '' && v !== '-')
      .join('; ')
    rows.push({ row: i, key: t.keys[i], delta: t.delta[i], spectra: t.spectra[i], name: named, names, localized, unlocalized: count(unloc, i) ?? 0, counts, detail, sum })
  }
  return { rows, columns: columnOrder(used), terminal, mismatched, unreadable: bad.n }
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
