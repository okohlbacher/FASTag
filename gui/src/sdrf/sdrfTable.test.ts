// SDRF import (GUI-DESIGN 3 S6, 10 P4): the table reader keeps every byte,
// so a parsed SDRF serialises back to the file it was read from, byte for
// byte: CRLF and LF and lone CR, a UTF-8 BOM, quoted cells (with tabs, line
// breaks and doubled quotes inside), malformed quotes, empty cells, ragged
// rows, repeated and unknown columns, a missing or doubled final line break,
// and bytes that are not UTF-8.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { columnsNamed, dataRows, parseSdrf, serializeSdrf, cellValue, type SdrfTable } from './sdrfTable'

// vitest runs in gui/ (as the other fixture readers assume).
const FIXTURE = 'src/fixtures/sdrf/gate-batch.sdrf.tsv'
const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
const roundTrip = (b: Uint8Array): Uint8Array => serializeSdrf(parseSdrf(b))
const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex')

function expectSame(b: Uint8Array): SdrfTable {
  const t = parseSdrf(b)
  expect(hex(serializeSdrf(t))).toBe(hex(b))
  return t
}

describe('SDRF round trip (byte for byte)', () => {
  it('the fixture SDRF: BOM, CRLF, quoted cells, empty cells, extra and repeated columns, a ragged row', () => {
    const b = new Uint8Array(readFileSync(FIXTURE))
    const t = expectSame(b)
    expect(t.bom).toBe(true)
    expect(t.encoding).toBe('utf-8')
    // The header, then 10 data rows (the last one ragged), then a blank line.
    const rows = dataRows(t)
    expect(rows).toHaveLength(10)
    expect(rows.map((r) => r.row)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    // The BOM is not part of the first header name.
    expect(cellValue(t.lines[0].cells[0])).toBe('source name')
    expect(columnsNamed(t, 'comment[modification parameters]')).toEqual([10, 11, 12])
    expect(columnsNamed(t, 'Comment[Data File]')).toEqual([15])
    // A quoted cell with a tab and doubled quotes is one cell, unquoted for reading.
    expect(rows[0].cells).toHaveLength(19)
    expect(rows[0].cells[18].raw).toBe('"a tab\there and ""quotes"""')
    expect(cellValue(rows[0].cells[18])).toBe('a tab\there and "quotes"')
    expect(cellValue(rows[0].cells[3])).toBe('ovarian cancer')
    // A quoted cell with a CRLF inside stays in its row.
    expect(cellValue(rows[4].cells[18])).toBe('line one\r\nline two')
    expect(rows[4].cells).toHaveLength(19)
    // The ragged row keeps its 16 cells.
    expect(rows[9].cells).toHaveLength(16)
    expect(cellValue(rows[9].cells[15])).toBe('extra_run_not_in_batch.raw')
    // Empty cells are cells.
    expect(rows[0].cells[9].raw).toBe('')
  })

  it('line endings: LF, CRLF, lone CR, mixed, none at the end, several at the end', () => {
    for (const s of ['a\tb\n1\t2\n', 'a\tb\r\n1\t2\r\n', 'a\tb\r1\t2\r', 'a\tb\r\n1\t2\n3\t4\r', 'a\tb\n1\t2', 'a\tb\n1\t2\n\n\n', 'a\tb\r\n\r\n1\t2\r\n']) {
      const t = expectSame(enc(s))
      expect(dataRows(t).map((r) => r.cells.map(cellValue))).toEqual(
        s
          .split(/\r\n|\n|\r/)
          .slice(1)
          .filter((l) => l !== '')
          .map((l) => l.split('\t'))
      )
    }
  })

  it('a BOM is kept, and only a leading one is a BOM', () => {
    const t = expectSame(enc('﻿source name\tcomment[data file]\r\nx\ty.raw\r\n'))
    expect(t.bom).toBe(true)
    expect(cellValue(t.lines[0].cells[0])).toBe('source name')
    const u = expectSame(enc('source name\tcomment[data file]\nx\t﻿y.raw\n'))
    expect(u.bom).toBe(false)
    expect(cellValue(dataRows(u)[0].cells[1])).toBe('﻿y.raw')
  })

  it('quoting: doubled quotes, tabs and line breaks inside quotes, malformed quotes kept as written', () => {
    const cases: [string, string[]][] = [
      ['h1\th2\n"a""b"\t"c\td"\n', ['a"b', 'c\td']],
      ['h1\th2\n"multi\nline"\tz\n', ['multi\nline', 'z']],
      // A quote inside an unquoted cell is a character.
      ['h1\th2\nab"c\t5" tall\n', ['ab"c', '5" tall']],
      // Text after a closing quote: the cell is read as written.
      ['h1\th2\n"ab"c\td\n', ['"ab"c', 'd']],
      // An unterminated quote runs to the end of its line, as written.
      ['h1\th2\n"open\tx\ny\tz\n', ['"open', 'x']],
      // An empty quoted cell.
      ['h1\th2\n""\t\n', ['', '']]
    ]
    for (const [s, first] of cases) {
      const t = expectSame(enc(s))
      expect(dataRows(t)[0].cells.map(cellValue)).toEqual(first)
    }
  })

  it('empty cells, empty rows and whitespace are kept', () => {
    const t = expectSame(enc('a\tb\tc\n\t\t\n  x \t\t\n\n'))
    const rows = dataRows(t)
    // A row of empty cells is a row (it has tabs); a blank line is not.
    expect(rows.map((r) => r.cells.map((c) => c.raw))).toEqual([
      ['', '', ''],
      ['  x ', '', '']
    ])
  })

  it('bytes that are not UTF-8 survive (read as Latin-1), and so does UTF-16 with its BOM', () => {
    const latin = new Uint8Array([0x61, 0x09, 0x62, 0x0a, 0xe9, 0x09, 0xff, 0x0d, 0x0a])
    const t = expectSame(latin)
    expect(t.encoding).toBe('latin1')
    expect(cellValue(dataRows(t)[0].cells[0])).toBe('é')
    // A truncated UTF-8 sequence at the end.
    expectSame(new Uint8Array([0x61, 0x0a, 0xe2, 0x82]))
    // UTF-16LE with a BOM (Excel's "Unicode text").
    const s = 'source name\tcomment[data file]\r\nx\tü.raw\r\n'
    const u16 = new Uint8Array(2 + 2 * s.length)
    u16[0] = 0xff
    u16[1] = 0xfe
    for (let i = 0; i < s.length; i++) {
      u16[2 + 2 * i] = s.charCodeAt(i) & 0xff
      u16[3 + 2 * i] = s.charCodeAt(i) >> 8
    }
    const w = expectSame(u16)
    expect(w.encoding).toBe('utf-16le')
    expect(cellValue(dataRows(w)[0].cells[1])).toBe('ü.raw')
    // Odd-length "UTF-16": not UTF-16, kept byte for byte anyway.
    expectSame(new Uint8Array([0xff, 0xfe, 0x61]))
  })

  it('an empty file and a header-only file', () => {
    expect(dataRows(expectSame(new Uint8Array(0)))).toEqual([])
    expect(dataRows(expectSame(enc('source name\tcomment[data file]')))).toEqual([])
  })

  it('random byte strings round-trip (seeded)', () => {
    const alphabet = [0x09, 0x0a, 0x0d, 0x22, 0x61, 0x62, 0x20, 0xef, 0xbb, 0xbf, 0xc3, 0xa9, 0xff, 0xfe, 0x00]
    let seed = 0x5eed
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % n
    }
    for (let k = 0; k < 2000; k++) {
      const b = new Uint8Array(rnd(40))
      for (let i = 0; i < b.length; i++) b[i] = alphabet[rnd(alphabet.length)]
      expect(hex(roundTrip(b))).toBe(hex(b))
    }
  })
})
