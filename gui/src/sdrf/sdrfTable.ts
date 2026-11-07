// An SDRF file as a table that keeps every byte (GUI-DESIGN 3 S6, 10 P4).
//
// The GUI never rewrites an SDRF (corrections go to a TSV of their own), but
// what it reads must be what the file says, so this reader loses nothing:
// serializeSdrf(parseSdrf(bytes)) is bytes, byte for byte, for any input.
// It keeps
// - the encoding: UTF-8 with or without a BOM, UTF-16LE with its BOM, and
//   anything that is neither read as Latin-1 (one char per byte);
// - each line's own terminator (CRLF, LF or a lone CR; none on a last line);
// - each cell as written (raw), quotes included; the reading of a cell
//   (cellValue) unquotes a well-formed quoted cell ("" inside is one quote,
//   and tabs and line breaks inside quotes stay in the cell). A malformed
//   quote (text after the closing quote, no closing quote) is read as
//   written, up to the next tab or line break;
// - empty cells, blank lines, ragged rows, repeated columns (comment
//   [modification parameters] is repeated by design) and columns this app
//   does not know.
//
// Written from the SDRF-Proteomics specification (tab-separated, one header
// row, columns by name); the ProSE design/sdrf-table.ts it ports was not
// available to this build, so the byte-preservation rules above are its
// contract, pinned by sdrfTable.test.ts.

export type Encoding = 'utf-8' | 'utf-16le' | 'latin1'
export type Eol = '' | '\n' | '\r\n' | '\r'

export interface SdrfCell {
  /// The cell as written, quotes included.
  raw: string
  /// A well-formed quoted cell: raw starts and ends with a quote.
  quoted: boolean
}

export interface SdrfLine {
  cells: SdrfCell[]
  /// The line's terminator as written ('' only on a last line without one).
  eol: Eol
}

export interface SdrfTable {
  encoding: Encoding
  bom: boolean
  /// Every line, the header first; a blank line is one empty cell.
  lines: SdrfLine[]
}

export interface SdrfRow {
  /// The data row's number: 1 for the first row after the header, blank
  /// lines not counted.
  row: number
  /// Its index in lines.
  line: number
  cells: SdrfCell[]
}

const UTF8_BOM = [0xef, 0xbb, 0xbf]

function latin1(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i += 0x2000) s += String.fromCharCode(...b.subarray(i, i + 0x2000))
  return s
}

function decode(bytes: Uint8Array): { text: string; encoding: Encoding; bom: boolean } {
  const bom = bytes.length >= 3 && UTF8_BOM.every((v, i) => bytes[i] === v)
  if (!bom && bytes.length >= 2 && bytes.length % 2 === 0 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    try {
      return { text: new TextDecoder('utf-16le', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(2)), encoding: 'utf-16le', bom: true }
    } catch {
      // A lone surrogate: not UTF-16 after all.
    }
  }
  const body = bom ? bytes.subarray(3) : bytes
  try {
    return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body), encoding: 'utf-8', bom }
  } catch {
    return { text: latin1(body), encoding: 'latin1', bom }
  }
}

function encode(text: string, encoding: Encoding, bom: boolean): Uint8Array {
  let body: Uint8Array
  if (encoding === 'utf-8') body = new TextEncoder().encode(text)
  else if (encoding === 'utf-16le') {
    body = new Uint8Array(2 * text.length)
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      body[2 * i] = c & 0xff
      body[2 * i + 1] = c >> 8
    }
  } else {
    body = new Uint8Array(text.length)
    for (let i = 0; i < text.length; i++) body[i] = text.charCodeAt(i) & 0xff
  }
  const head = !bom ? [] : encoding === 'utf-16le' ? [0xff, 0xfe] : UTF8_BOM
  const out = new Uint8Array(head.length + body.length)
  out.set(head, 0)
  out.set(body, head.length)
  return out
}

const isEnd = (c: string | undefined): boolean => c === undefined || c === '\t' || c === '\n' || c === '\r'

/// The end (exclusive) of a quoted cell starting at @p i, or -1 when it is
/// not well formed: "" is a quote, and the closing quote must be followed by
/// a tab, a line break or the end of the text.
function quotedEnd(s: string, i: number): number {
  let j = i + 1
  for (;;) {
    const q = s.indexOf('"', j)
    if (q < 0) return -1
    if (s[q + 1] === '"') {
      j = q + 2
      continue
    }
    return isEnd(s[q + 1]) ? q + 1 : -1
  }
}

function parseText(s: string): SdrfLine[] {
  const lines: SdrfLine[] = []
  let cells: SdrfCell[] = []
  let i = 0
  if (s.length === 0) return lines
  for (;;) {
    // One cell at i.
    let end = s[i] === '"' ? quotedEnd(s, i) : -1
    const quoted = end >= 0
    if (!quoted) {
      end = i
      while (!isEnd(s[end])) end++
    }
    cells.push({ raw: s.slice(i, end), quoted })
    i = end
    if (s[i] === '\t') {
      i++
      continue
    }
    // A line break or the end of the text.
    let eol: Eol = ''
    if (s[i] === '\r') eol = s[i + 1] === '\n' ? '\r\n' : '\r'
    else if (s[i] === '\n') eol = '\n'
    lines.push({ cells, eol })
    cells = []
    i += eol.length
    if (i >= s.length) return lines
  }
}

/// The table of an SDRF file's bytes (or of its text, read as UTF-8).
export function parseSdrf(input: Uint8Array | string): SdrfTable {
  const d = typeof input === 'string' ? { text: input.replace(/^﻿/, ''), encoding: 'utf-8' as const, bom: input.startsWith('﻿') } : decode(input)
  return { encoding: d.encoding, bom: d.bom, lines: parseText(d.text) }
}

/// The table's text, without the BOM.
export function sdrfText(t: SdrfTable): string {
  return t.lines.map((l) => l.cells.map((c) => c.raw).join('\t') + l.eol).join('')
}

/// The bytes of @p t: the file it was read from, unless a cell was changed.
export function serializeSdrf(t: SdrfTable): Uint8Array {
  return encode(sdrfText(t), t.encoding, t.bom)
}

/// What a cell says: a well-formed quoted cell unquoted, any other as written.
export function cellValue(c: SdrfCell | undefined): string {
  if (!c) return ''
  return c.quoted ? c.raw.slice(1, -1).replace(/""/g, '"') : c.raw
}

/// A column name as the specification compares them: case, the spaces
/// around and inside the brackets and repeated spaces do not count.
export function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*\[\s*/g, '[')
    .replace(/\s*\]\s*/g, ']')
}

/// The header's columns named @p name, in file order (a name may repeat).
export function columnsNamed(t: SdrfTable, name: string): number[] {
  const want = normalizeName(name)
  const head = t.lines[0]?.cells ?? []
  return head.flatMap((c, i) => (normalizeName(cellValue(c)) === want ? [i] : []))
}

const blank = (l: SdrfLine): boolean => l.cells.length === 1 && l.cells[0].raw === ''

/// The data rows: every line after the header that is not blank.
export function dataRows(t: SdrfTable): SdrfRow[] {
  const out: SdrfRow[] = []
  for (let i = 1; i < t.lines.length; i++) if (!blank(t.lines[i])) out.push({ row: out.length + 1, line: i, cells: t.lines[i].cells })
  return out
}
