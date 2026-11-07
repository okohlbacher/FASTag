// Readers for the four wide tables the P4c viewers show (GUI-DESIGN S7,
// S8): -recon_out (one row per placement), -delta_out (the mass-shift
// histogram), -recon_id_out as mzTab (the placements as PSMs) and
// -glyco_out (one row per MS2 spectrum). Formats as FASTag.cpp writes them
// (recon: "spectrum tag protein peptide pos reversed nterm_match
// cterm_match delta_mass region delta_interp" plus "loc_site loc_score
// loc_ties" with -recon_localize; delta: "delta spectra top_interps"; glyco:
// "spectrum n_oxonium oxonium_frac glyco ions"). Columns are found by name.
//
// Numbers go into typed arrays and the filters run over them, returning row
// ids as a Uint32Array in file order: a proteome-scale recon table keeps one
// string per distinct spectrum and no per-row objects. Pure, so it is tested
// without the bridge (tables.test.ts, on real CLI output).

import type { ResolvedOutputs } from '../types'
import { baseName } from '../digestReport'

export type TableKind = 'recon' | 'delta' | 'glyco' | 'reconIds'

/// The table files of one run (or opened by the user), by kind.
export type TablePaths = Partial<Record<TableKind, string>>
/// A read count per table (Reports.gen): a new one re-reads the file.
export type TableGen = Partial<Record<TableKind, number>>

interface Base {
  path: string
  rows: number
  /// What a reader should know about a malformed file (a short row).
  warnings: string[]
}

export interface ReconTable extends Base {
  kind: 'recon'
  /// Distinct spectrum IDs in first-seen order; `spectrum[i]` indexes them.
  spectra: string[]
  spectrum: Uint32Array
  tag: string[]
  protein: string[]
  peptide: string[]
  pos: Int32Array
  reversed: Uint8Array
  nMatch: Uint8Array
  cMatch: Uint8Array
  /// NaN where the cell is not a number.
  delta: Float64Array
  region: string[]
  interp: string[]
  /// The -recon_localize columns; score and ties are -1 where empty.
  loc: { site: string[]; score: Int32Array; ties: Int32Array } | null
}

export interface DeltaTable extends Base {
  kind: 'delta'
  /// The gap as printed, for display and as a key.
  keys: string[]
  delta: Float64Array
  spectra: Uint32Array
  interps: { name: string; n: number }[][]
}

export interface GlycoTable extends Base {
  kind: 'glyco'
  spectrum: string[]
  nOxonium: Int32Array
  frac: Float64Array
  flagged: Uint8Array
  ions: string[][]
  flaggedCount: number
  /// Each ion with the flagged spectra that carry it, most frequent first.
  ionCounts: { ion: string; flagged: number; all: number }[]
}

export interface ReconIdTable extends Base {
  kind: 'reconIds'
  format: 'mzTab'
  sequence: string[]
  accession: string[]
  score: Float64Array
  charge: Int32Array
  expMz: Float64Array
  calcMz: Float64Array
  spectrum: string[]
  start: Int32Array
  end: Int32Array
  tag: string[]
  delta: Float64Array
  interp: string[]
}

export type AnyTable = ReconTable | DeltaTable | GlycoTable | ReconIdTable

const RECON = ['spectrum', 'tag', 'protein', 'peptide', 'pos', 'reversed', 'nterm_match', 'cterm_match', 'delta_mass', 'region', 'delta_interp'] as const
const LOC = ['loc_site', 'loc_score', 'loc_ties'] as const
const DELTA = ['delta', 'spectra', 'top_interps'] as const
const GLYCO = ['spectrum', 'n_oxonium', 'oxonium_frac', 'glyco', 'ions'] as const

const lines = (text: string): string[] => text.split(/\r?\n/).filter((l) => l !== '')
const header = (text: string): string[] => {
  const nl = text.search(/\r?\n/)
  return (nl < 0 ? text : text.slice(0, nl)).split('\t').map((h) => h.trim())
}
// An mzTab line: a section prefix and a tab.
const MZTAB_LINE = /^(MTD|PSH|PSM|PRH|PRT|PEH|PEP|SMH|SML|COM)\t/
const firstLine = (text: string): string => {
  const m = /^[ \t]*\S[^\r\n]*/m.exec(text.slice(0, 1 << 16))
  return m ? m[0].trimStart() : ''
}
const has = (head: string[], cols: readonly string[]): boolean => cols.every((c) => head.includes(c))

/// The kind of table a file holds, by its header; null for anything else
/// (a long-form report, a tags table, an empty file).
export function sniffTable(text: string): TableKind | null {
  // An mzTab by its first line, with or without a PSM section: OpenMS writes
  // the PSH header only when there are PSMs, so the -recon_id_out of a run
  // that placed nothing holds only MTD lines (MzTabFile::store).
  if (MZTAB_LINE.test(firstLine(text))) return 'reconIds'
  const head = header(text)
  if (has(head, RECON)) return 'recon'
  if (has(head, DELTA) && head.length === 3) return 'delta'
  if (has(head, GLYCO)) return 'glyco'
  return null
}

/// Parse a table of any of the four kinds. Throws with a readable message.
export function parseTable(text: string, path: string): AnyTable {
  if (/^\s*<\?xml|^\s*</.test(text)) {
    const what = /<MzIdentML/i.test(text.slice(0, 4096)) || /\.mzid$/i.test(path) ? 'mzIdentML' : 'idXML'
    throw new Error(`${baseName(path)} is ${what}; this viewer reads the mzTab form of -recon_id_out (name the file .mzTab), or open it in an identification tool`)
  }
  switch (sniffTable(text)) {
    case 'recon':
      return parseRecon(text, path)
    case 'delta':
      return parseDelta(text, path)
    case 'glyco':
      return parseGlyco(text, path)
    case 'reconIds':
      return parseReconIds(text, path)
    default:
      throw new Error(`${baseName(path)} is not a recon, delta, glyco or mzTab table: its header names none of their columns`)
  }
}

// The rows of a table with the columns @p need, by name.
function columns(text: string, need: readonly string[], what: string): { idx: (c: string) => number; body: string[]; width: number } {
  const ls = lines(text)
  if (ls.length === 0) throw new Error('the file is empty')
  const head = ls[0].split('\t').map((h) => h.trim())
  const missing = need.filter((c) => !head.includes(c))
  if (missing.length) throw new Error(`not a ${what}: no ${missing.join(', ')} column`)
  return { idx: (c) => head.indexOf(c), body: ls.slice(1), width: head.length }
}

const intOr = (s: string, dflt: number): number => (/^[+-]?\d+$/.test(s) ? Number(s) : dflt)
const numOr = (s: string): number => (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s) ? Number(s) : NaN)
const shortRow = (path: string, i: number, got: number, of: number): string =>
  `${baseName(path)}: row ${i + 2} has ${got} of ${of} columns; the missing cells read as empty.`

export function parseRecon(text: string, path: string): ReconTable {
  const { idx, body, width } = columns(text, RECON, 'recon table (-recon_out)')
  const n = body.length
  const c = Object.fromEntries([...RECON, ...LOC].map((k) => [k, idx(k)])) as Record<(typeof RECON)[number] | (typeof LOC)[number], number>
  const withLoc = LOC.every((k) => c[k] >= 0)
  const t: ReconTable = {
    kind: 'recon',
    path,
    rows: n,
    warnings: [],
    spectra: [],
    spectrum: new Uint32Array(n),
    tag: new Array<string>(n),
    protein: new Array<string>(n),
    peptide: new Array<string>(n),
    pos: new Int32Array(n),
    reversed: new Uint8Array(n),
    nMatch: new Uint8Array(n),
    cMatch: new Uint8Array(n),
    delta: new Float64Array(n),
    region: new Array<string>(n),
    interp: new Array<string>(n),
    loc: withLoc ? { site: new Array<string>(n), score: new Int32Array(n), ties: new Int32Array(n) } : null
  }
  const dict = new Map<string, number>()
  for (let i = 0; i < n; i++) {
    const f = body[i].split('\t')
    if (f.length < width && t.warnings.length < 5) t.warnings.push(shortRow(path, i, f.length, width))
    const at = (k: number): string => (k >= 0 ? (f[k] ?? '') : '')
    const sp = at(c.spectrum)
    let id = dict.get(sp)
    if (id == null) {
      id = t.spectra.length
      dict.set(sp, id)
      t.spectra.push(sp)
    }
    t.spectrum[i] = id
    t.tag[i] = at(c.tag)
    t.protein[i] = at(c.protein)
    t.peptide[i] = at(c.peptide)
    t.pos[i] = intOr(at(c.pos), -1)
    t.reversed[i] = at(c.reversed) === '1' ? 1 : 0
    t.nMatch[i] = at(c.nterm_match) === '1' ? 1 : 0
    t.cMatch[i] = at(c.cterm_match) === '1' ? 1 : 0
    t.delta[i] = numOr(at(c.delta_mass))
    t.region[i] = at(c.region)
    t.interp[i] = at(c.delta_interp)
    if (t.loc) {
      t.loc.site[i] = at(c.loc_site)
      t.loc.score[i] = intOr(at(c.loc_score), -1)
      t.loc.ties[i] = intOr(at(c.loc_ties), -1)
    }
  }
  return t
}

export interface ReconFilter {
  /// Case-insensitive substring of spectrum, tag, protein or peptide.
  text?: string
  /// Exactly one flank matched: the rows with a localized gap.
  gapped?: boolean
  minAbsDelta?: number
  /// An exact delta_interp ('' for none), or a prefix ending in ':' (sub:, mod:).
  interp?: string
}

/// The rows of @p t that pass @p f, in file order.
export function filterRecon(t: ReconTable, f: ReconFilter): Uint32Array {
  const needle = f.text?.trim().toLowerCase() ?? ''
  // The spectrum dictionary is matched once, not per row.
  const spOk = needle ? Uint8Array.from(t.spectra, (s) => (s.toLowerCase().includes(needle) ? 1 : 0)) : null
  const prefix = f.interp != null && f.interp.endsWith(':') ? f.interp : null
  const out = new Uint32Array(t.rows)
  let k = 0
  for (let i = 0; i < t.rows; i++) {
    if (f.gapped && t.nMatch[i] === t.cMatch[i]) continue
    if (f.minAbsDelta != null && !(Math.abs(t.delta[i]) >= f.minAbsDelta)) continue
    if (f.interp != null) {
      if (prefix ? !t.interp[i].startsWith(prefix) : t.interp[i] !== f.interp) continue
    }
    if (spOk && !spOk[t.spectrum[i]]) {
      const hit =
        t.tag[i].toLowerCase().includes(needle) ||
        t.protein[i].toLowerCase().includes(needle) ||
        t.peptide[i].toLowerCase().includes(needle)
      if (!hit) continue
    }
    out[k++] = i
  }
  return out.slice(0, k)
}

export function parseDelta(text: string, path: string): DeltaTable {
  const { idx, body, width } = columns(text, DELTA, 'delta histogram (-delta_out)')
  const n = body.length
  const [cd, cs, ci] = DELTA.map(idx)
  const t: DeltaTable = { kind: 'delta', path, rows: n, warnings: [], keys: [], delta: new Float64Array(n), spectra: new Uint32Array(n), interps: [] }
  for (let i = 0; i < n; i++) {
    const f = body[i].split('\t')
    if (f.length < width && t.warnings.length < 5) t.warnings.push(shortRow(path, i, f.length, width))
    t.keys.push(f[cd] ?? '')
    t.delta[i] = numOr(f[cd] ?? '')
    t.spectra[i] = Math.max(0, intOr(f[cs] ?? '', 0))
    const cell = f[ci] ?? ''
    t.interps.push(
      cell === '' || cell === '-'
        ? []
        : cell.split(';').map((p) => {
            // The name may itself hold ':' (mod:Oxidation@M): the count is after the last one.
            const at = p.lastIndexOf(':')
            return { name: p.slice(0, at), n: intOr(p.slice(at + 1), 0) }
          })
    )
  }
  return t
}

export function parseGlyco(text: string, path: string): GlycoTable {
  const { idx, body, width } = columns(text, GLYCO, 'glyco report (-glyco_out)')
  const n = body.length
  const [cs, cn, cf, cg, ci] = GLYCO.map(idx)
  const t: GlycoTable = {
    kind: 'glyco',
    path,
    rows: n,
    warnings: [],
    spectrum: new Array<string>(n),
    nOxonium: new Int32Array(n),
    frac: new Float64Array(n),
    flagged: new Uint8Array(n),
    ions: new Array<string[]>(n),
    flaggedCount: 0,
    ionCounts: []
  }
  const counts = new Map<string, { flagged: number; all: number }>()
  for (let i = 0; i < n; i++) {
    const f = body[i].split('\t')
    if (f.length < width && t.warnings.length < 5) t.warnings.push(shortRow(path, i, f.length, width))
    t.spectrum[i] = f[cs] ?? ''
    t.nOxonium[i] = intOr(f[cn] ?? '', 0)
    t.frac[i] = numOr(f[cf] ?? '')
    t.flagged[i] = f[cg] === '1' ? 1 : 0
    t.flaggedCount += t.flagged[i]
    const cell = f[ci] ?? ''
    t.ions[i] = cell === '' || cell === '-' ? [] : cell.split(';')
    for (const ion of t.ions[i]) {
      const c = counts.get(ion) ?? { flagged: 0, all: 0 }
      c.all++
      c.flagged += t.flagged[i]
      counts.set(ion, c)
    }
  }
  t.ionCounts = [...counts]
    .map(([ion, c]) => ({ ion, ...c }))
    .sort((a, b) => b.flagged - a.flagged || b.all - a.all || (a.ion < b.ion ? -1 : 1))
  return t
}

const RECON_ID_NEED = ['sequence', 'accession', 'search_engine_score[1]', 'charge', 'exp_mass_to_charge', 'spectra_ref'] as const

/// The PSM section of an mzTab -recon_id_out (no rows when it has none).
export function parseReconIds(text: string, path: string): ReconIdTable {
  const ls = lines(text)
  const psh = ls.find((l) => l.startsWith('PSH\t'))
  // No PSH line: a run that placed nothing (only the metadata is written);
  // a file with no mzTab line at all is not an mzTab.
  if (!psh && !ls.some((l) => MZTAB_LINE.test(l))) throw new Error(`${baseName(path)} is not an mzTab file (no MTD or PSH line)`)
  const head = psh ? psh.split('\t') : [...RECON_ID_NEED]
  const missing = RECON_ID_NEED.filter((c) => !head.includes(c))
  if (missing.length) throw new Error(`${baseName(path)}: the PSM header has no ${missing.join(', ')} column`)
  const body = ls.filter((l) => l.startsWith('PSM\t'))
  const n = body.length
  const col = (c: string): number => head.indexOf(c)
  const cell = (f: string[], c: number): string => {
    const v = c >= 0 ? (f[c] ?? '') : ''
    return v === 'null' ? '' : v
  }
  const t: ReconIdTable = {
    kind: 'reconIds',
    format: 'mzTab',
    path,
    rows: n,
    warnings: [],
    sequence: [],
    accession: [],
    score: new Float64Array(n),
    charge: new Int32Array(n),
    expMz: new Float64Array(n),
    calcMz: new Float64Array(n),
    spectrum: [],
    start: new Int32Array(n),
    end: new Int32Array(n),
    tag: [],
    delta: new Float64Array(n),
    interp: []
  }
  const [cSeq, cAcc, cScore, cZ, cExp, cCalc, cRef, cOptRef, cStart, cEnd, cTag, cDelta, cInterp] = [
    'sequence',
    'accession',
    'search_engine_score[1]',
    'charge',
    'exp_mass_to_charge',
    'calc_mass_to_charge',
    'spectra_ref',
    'opt_global_spectrum_reference',
    'start',
    'end',
    'opt_global_tag',
    'opt_global_delta_mass',
    'opt_global_delta_interp'
  ].map(col)
  for (let i = 0; i < n; i++) {
    const f = body[i].split('\t')
    if (f.length < head.length && t.warnings.length < 5) t.warnings.push(shortRow(path, i, f.length, head.length))
    t.sequence.push(cell(f, cSeq))
    t.accession.push(cell(f, cAcc))
    t.score[i] = numOr(cell(f, cScore))
    t.charge[i] = intOr(cell(f, cZ), 0)
    t.expMz[i] = numOr(cell(f, cExp))
    t.calcMz[i] = numOr(cell(f, cCalc))
    // The native ID: the opt column, else spectra_ref without its ms_run[n]: prefix.
    const ref = cell(f, cOptRef) || cell(f, cRef).replace(/^ms_run\[\d+\]:/, '')
    t.spectrum.push(ref)
    t.start[i] = intOr(cell(f, cStart), -1)
    t.end[i] = intOr(cell(f, cEnd), -1)
    t.tag.push(cell(f, cTag))
    t.delta[i] = numOr(cell(f, cDelta))
    t.interp.push(cell(f, cInterp))
  }
  return t
}

/// The table files a run wrote, from the outputs the backend resolved
/// (never derived here).
export function tablePaths(o: ResolvedOutputs): TablePaths {
  const p: TablePaths = {}
  if (o.recon_out) p.recon = o.recon_out
  if (o.delta_out) p.delta = o.delta_out
  if (o.recon_id_out) p.reconIds = o.recon_id_out
  if (o.glyco_out) p.glyco = o.glyco_out
  return p
}
