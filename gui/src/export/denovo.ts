// Stitch and ALPS export (GUI-DESIGN 10 P3, D7): a FASTag -res_conf tags
// TSV as de novo "reads" for antibody assembly, written exactly as the
// repository's tools/tags_to_denovo.py writes them. That script is the
// reference: the golden files in src/fixtures/denovo are its output (CI
// regenerates and compares them, scripts/denovo-golden.mjs) and this port
// must equal them byte for byte (denovo.test.ts). Its docstring explains the
// formats; in short:
//
//   stitch  the PEAKS "Old" 15-column positional CSV snijderlab/stitch reads,
//           no quoting, Area 0 (a constant nonzero Area makes Stitch's
//           intensity NaN), mods spelled as PEAKS deltas (S(+79.97));
//   alps    the 5-column CSV denisbeslic/denovopipeline gives ALPS.jar,
//           RFC 4180 quoting (Python's csv module), bare residues, Area 1.
//
// Filters in the script's order: malformed rows are skipped, then rows
// shorter than minLength, then the topN lowest E-values of each spectrum
// (file order on ties; spectra in the order they first appear). Defaults
// as the script: topN 1 (FASTag's tags of one spectrum are re-reads of one
// fragment ladder, not independent reads), minLength 8.
//
// Python's own parsers are mirrored where the script leans on them: int()
// and float() (surrounding whitespace, underscores between digits, inf and
// infinity), str.split() whitespace, universal newlines (\n, \r\n and a lone
// \r end a line) and round() (half to even). One known difference: a NaN
// E-value, which no FASTag writes, ranks last here, while Python's sort
// leaves it wherever its comparisons happen to put it.

export type DenovoFormat = 'stitch' | 'alps'

export interface DenovoOptions {
  format: DenovoFormat
  /// Reads kept per spectrum, lowest E-value first (script --top-n, >= 1).
  topN: number
  /// Tags shorter than this many residues are dropped (script --min-length).
  minLength: number
}

export interface DenovoResult {
  text: string
  /// Reads written.
  reads: number
  /// Non-blank data rows read; below the minimum length; malformed (skipped).
  rowsRead: number
  short: number
  malformed: number
  /// Mod names outside the built-in delta map, stripped to the bare residue
  /// in the Stitch spelling, with their counts.
  unknownMods: Record<string, number>
}

/// A file the script would refuse (or stop on): nothing is written.
export class DenovoError extends Error {}

export const DENOVO_DEFAULTS = { topN: 1, minLength: 8 } as const

// tags_to_denovo.py MOD_DELTAS.
const MOD_DELTAS: Record<string, string> = {
  oxidation: '+15.99',
  phospho: '+79.97',
  carbamidomethyl: '+57.02',
  acetyl: '+42.01',
  deamidated: '+0.98'
}

const STITCH_HEADER = 'Scan,Peptide,Tag Length,ALC (%),length,m/z,z,RT,Area,Mass,ppm,PTM,local confidence,tag,mode'
const ALPS_HEADER = ['Spectrum Name', 'Peptide', 'aaScore', 'Score', 'Area']
const REQUIRED = ['spectrum', 'tag', 'length', 'charge', 'nterm_mass', 'cterm_mass', 'evalue', 'res_conf']

// Python's str.isspace() set (str.split() with no argument, int(), float()).
const WS = '\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000'
const STRIP = new RegExp(`^[${WS}]+|[${WS}]+$`, 'g')
const SPLIT_WS = new RegExp(`[${WS}]+`)
const DIGITS = '\\d(?:_?\\d)*'
const PY_INT = new RegExp(`^[+-]?${DIGITS}$`)
const PY_FLOAT = new RegExp(`^[+-]?(?:(?:${DIGITS}(?:\\.(?:${DIGITS})?)?|\\.${DIGITS})(?:[eE][+-]?${DIGITS})?|inf|infinity|nan)$`, 'i')

/// Python int(s) for ASCII digits; null where int() raises ValueError.
function pyInt(s: string): number | null {
  const t = s.replace(STRIP, '')
  if (!PY_INT.test(t)) return null
  const v = Number(t.replace(/_/g, ''))
  // Number('-0') is -0; Python's int has no negative zero.
  return v === 0 ? 0 : v
}

/// Python float(s); null where float() raises ValueError.
function pyFloat(s: string): number | null {
  const t = s.replace(STRIP, '')
  if (!PY_FLOAT.test(t)) return null
  const u = t.toLowerCase().replace(/_/g, '')
  const neg = u.startsWith('-')
  const body = u.replace(/^[+-]/, '')
  if (body === 'inf' || body === 'infinity') return neg ? -Infinity : Infinity
  if (body === 'nan') return NaN
  return Number(u)
}

/// Python's split() with no separator: runs of whitespace, no empty ends.
const pySplit = (s: string): string[] => s.split(SPLIT_WS).filter((x) => x !== '')

/// Python round(x) for the ALC: half to even. x - floor(x) is exact here.
function roundHalfEven(x: number): number {
  const f = Math.floor(x)
  const d = x - f
  if (d < 0.5) return f
  if (d > 0.5) return f + 1
  return f % 2 === 0 ? f : f + 1
}

// tags_to_denovo.py parse_tag: residue, then an optional [ModName].
const TAG_TOKEN = /([A-Z])(?:\[([^\]]*)\])?/y

type Residue = [string, string | null]

function parseTag(tag: string): Residue[] | null {
  const out: Residue[] = []
  TAG_TOKEN.lastIndex = 0
  let pos = 0
  for (;;) {
    const m = TAG_TOKEN.exec(tag)
    if (!m) break
    out.push([m[1], m[2] ?? null])
    pos = TAG_TOKEN.lastIndex
  }
  return pos === tag.length && out.length > 0 ? out : null
}

interface Row {
  spectrum: string
  residues: Residue[]
  confs: number[]
  charge: string
  nterm: string
  cterm: string
  evalue: number
  order: number
}

/// The lines of @p text as Python's universal-newline reader splits them,
/// line ends removed: \r\n, \n and a lone \r each end a line.
function lines(text: string): string[] {
  const out = text.split(/\r\n|\r|\n/)
  // A final line end leaves an empty piece that is no line.
  if (out.length > 0 && out[out.length - 1] === '') out.pop()
  return out
}

function readRows(text: string, minLength: number): { rows: Row[]; read: number; short: number; bad: number } {
  const all = lines(text)
  if (all.length === 0) throw new DenovoError('the tags file is empty')
  const header = all[0].split('\t')
  const idx = new Map<string, number>()
  header.forEach((name, i) => idx.set(name, i))
  const missing = REQUIRED.filter((c) => !idx.has(c))
  if (missing.length > 0) {
    const hint = missing.includes('res_conf') ? ' (re-run FASTag with -res_conf)' : ''
    throw new DenovoError(`the tags file lacks column(s) ${missing.join(', ')}${hint}; its header has: ${header.join(', ')}`)
  }
  const at = (f: string[], c: string): string => f[idx.get(c)!]
  const rows: Row[] = []
  let read = 0
  let short = 0
  let bad = 0
  for (let n = 1; n < all.length; n++) {
    const line = all[n]
    if (line === '') continue
    read++
    const f = line.split('\t')
    if (f.length < header.length) {
      bad++
      continue
    }
    const residues = parseTag(at(f, 'tag'))
    if (!residues) {
      bad++
      continue
    }
    const confs: number[] = []
    let ok = true
    for (const c of pySplit(at(f, 'res_conf'))) {
      const v = pyInt(c)
      if (v === null) {
        ok = false
        break
      }
      confs.push(v)
    }
    if (!ok) {
      bad++
      continue
    }
    // Python's chained comparison reads the length only when the residue
    // and confidence counts agree; a length int() cannot read stops the
    // script there.
    if (residues.length !== confs.length) {
      bad++
      continue
    }
    const length = pyInt(at(f, 'length'))
    if (length === null) {
      throw new DenovoError(`line ${n + 1}: the length ${JSON.stringify(at(f, 'length'))} is not an integer`)
    }
    if (length !== confs.length) {
      bad++
      continue
    }
    if (confs.some((c) => c < 0 || c > 100)) {
      bad++
      continue
    }
    if (residues.length < minLength) {
      short++
      continue
    }
    // An E-value float() cannot read ranks last.
    const evalue = pyFloat(at(f, 'evalue')) ?? Infinity
    const charge = pyInt(at(f, 'charge'))
    rows.push({
      spectrum: at(f, 'spectrum'),
      residues,
      confs,
      charge: charge === null ? '0' : String(charge),
      nterm: at(f, 'nterm_mass'),
      cterm: at(f, 'cterm_mass'),
      evalue,
      order: read
    })
  }
  return { rows, read, short, bad }
}

/// tags_to_denovo.py thin_top_n: the topN lowest E-values of each spectrum,
/// file order on ties, spectra in the order they first appear.
function thinTopN(rows: Row[], topN: number): Row[] {
  const bySpec = new Map<string, Row[]>()
  for (const r of rows) {
    const g = bySpec.get(r.spectrum)
    if (g) g.push(r)
    else bySpec.set(r.spectrum, [r])
  }
  const key = (v: number): number => (Number.isNaN(v) ? Infinity : v)
  const out: Row[] = []
  for (const g of bySpec.values()) {
    const sorted = g.slice().sort((a, b) => {
      const x = key(a.evalue)
      const y = key(b.evalue)
      if (x < y) return -1
      if (x > y) return 1
      // NaN after +inf (see the header).
      const nan = Number(Number.isNaN(a.evalue)) - Number(Number.isNaN(b.evalue))
      return nan || a.order - b.order
    })
    out.push(...sorted.slice(0, topN))
  }
  return out
}

function spellPeptide(residues: Residue[], unknown: Record<string, number>): string {
  let out = ''
  for (const [res, mod] of residues) {
    if (mod === null) {
      out += res
      continue
    }
    const delta = Object.prototype.hasOwnProperty.call(MOD_DELTAS, mod.toLowerCase()) ? MOD_DELTAS[mod.toLowerCase()] : undefined
    if (delta === undefined) {
      unknown[mod] = (unknown[mod] ?? 0) + 1
      out += res
    } else {
      out += `${res}(${delta})`
    }
  }
  return out
}

const alc = (confs: number[]): string => String(roundHalfEven(confs.reduce((a, b) => a + b, 0) / confs.length))
const bare = (residues: Residue[]): string => residues.map(([r]) => r).join('')

function writeStitch(rows: Row[], unknown: Record<string, number>): string {
  const out: string[] = [STITCH_HEADER + '\n']
  for (const r of rows) {
    const n = String(r.residues.length)
    const fields = [
      r.spectrum.replace(/[,;]/g, '_'), // Scan: Stitch splits on ',' and cuts at ';'
      spellPeptide(r.residues, unknown),
      n,
      alc(r.confs),
      n,
      '0', // m/z
      r.charge,
      '0', // RT
      '0', // Area: must be 0 (the NaN trap)
      '0', // Mass
      '0', // ppm
      `n=${r.nterm};c=${r.cterm}`,
      r.confs.join(' '),
      bare(r.residues),
      ''
    ]
    for (const f of fields) {
      if (f.includes(',')) throw new DenovoError(`a comma in ${JSON.stringify(f)} would shift every Stitch column after it`)
    }
    out.push(fields.join(',') + '\n')
  }
  return out.join('')
}

/// Python csv.writer's QUOTE_MINIMAL with lineterminator '\n'.
const csvField = (s: string): string => (/[,"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

function writeAlps(rows: Row[]): string {
  const out: string[] = [ALPS_HEADER.map(csvField).join(',') + '\n']
  for (const r of rows) {
    out.push([r.spectrum.replace(/,/g, '_'), bare(r.residues), r.confs.join(' '), alc(r.confs), '1'].map(csvField).join(',') + '\n')
  }
  return out.join('')
}

/// The reads of tags TSV @p text in @p opts.format, as
/// `tags_to_denovo.py --format F --top-n N --min-length L` writes them.
/// Throws DenovoError where the script refuses the file or stops.
export function tagsToDenovo(text: string, opts: DenovoOptions): DenovoResult {
  if (!Number.isInteger(opts.topN) || opts.topN < 1) throw new DenovoError('the reads per spectrum (top N) must be at least 1')
  if (!Number.isInteger(opts.minLength)) throw new DenovoError('the minimum read length must be a whole number')
  const { rows, read, short, bad } = readRows(text, opts.minLength)
  const kept = thinTopN(rows, opts.topN)
  const unknownMods: Record<string, number> = {}
  const out = opts.format === 'stitch' ? writeStitch(kept, unknownMods) : writeAlps(kept)
  return { text: out, reads: kept.length, rowsRead: read, short, malformed: bad, unknownMods }
}

/// Whether a tags table with these columns can be exported as reads.
export const canExportReads = (columns: string[]): boolean => REQUIRED.every((c) => columns.includes(c))
