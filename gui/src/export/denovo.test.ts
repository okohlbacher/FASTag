// export/denovo.ts against the golden files tools/tags_to_denovo.py writes
// (src/fixtures/denovo, regenerated and compared in CI by
// scripts/denovo-golden.mjs): byte for byte, for Stitch and ALPS, on the real
// E. coli -res_conf tags and on a hand-written file with every edge the
// script handles (ties, unparsable and infinite E-values, mods known and
// unknown, malformed rows, commas, semicolons and quotes in the spectrum ID,
// CRLF and lone CR line ends, half-even ALC rounding).

// @ts-ignore -- node built-in; the app's tsconfig has no node types
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DenovoError, tagsToDenovo, type DenovoFormat } from './denovo'

interface Case {
  input: string
  format: DenovoFormat
  topN: number
  minLength: number
  golden: string
}
// Read from disk (vitest runs in gui/), as bytes: a ?raw import would go
// through the bundler.
const raw = (name: string): Uint8Array => new Uint8Array(readFileSync(`src/fixtures/denovo/${name}`))
const read = (name: string): string => new TextDecoder('utf-8', { fatal: true }).decode(raw(name))
const CASES: Case[] = JSON.parse(read('cases.json'))
const bytes = (s: string): Uint8Array => new TextEncoder().encode(s)
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i])

const HEAD = 'spectrum\ttag\tlength\tcharge\tnterm_mass\tcterm_mass\tevalue\tres_conf\n'
const row = (spec: string, tag: string, ev: string, conf: string, len = String(tag.replace(/\[[^\]]*\]/g, '').length)): string =>
  `${spec}\t${tag}\t${len}\t2\t0\t0\t${ev}\t${conf}\n`

describe('golden files of tools/tags_to_denovo.py', () => {
  it('covers both formats on both inputs', () => {
    expect(new Set(CASES.map((c) => `${c.input}:${c.format}`)).size).toBe(4)
  })

  for (const c of CASES) {
    it(`${c.golden}: --format ${c.format} --top-n ${c.topN} --min-length ${c.minLength}`, () => {
      const out = tagsToDenovo(read(c.input), { format: c.format, topN: c.topN, minLength: c.minLength })
      expect(sameBytes(bytes(out.text), raw(c.golden))).toBe(true)
      // The same text, for a readable diff when the bytes differ.
      expect(out.text).toBe(read(c.golden))
      expect(out.reads).toBe(read(c.golden).split('\n').length - 2)
    })
  }
})

describe('best-tag export', () => {
  it('has exactly one read per tagged spectrum of the fixture', () => {
    const text = read('ecoli.res_conf.tags.tsv')
    const spectra = new Set(text.split('\n').slice(1).filter(Boolean).map((l) => l.split('\t')[0]))
    expect(spectra.size).toBe(134)
    for (const format of ['stitch', 'alps'] as const) {
      const out = tagsToDenovo(text, { format, topN: 1, minLength: 1 })
      const ids = out.text.split('\n').slice(1, -1).map((l) => l.split(',')[0])
      expect(ids.length).toBe(spectra.size)
      expect(new Set(ids)).toEqual(spectra)
      expect(out.reads).toBe(spectra.size)
    }
  })

  it('keeps the lowest E-value of each spectrum, file order on ties, spectra in order of first appearance', () => {
    const text =
      HEAD +
      row('b', 'KKKK', '0.5', '1 1 1 1') +
      row('a', 'LLLL', '0.1', '2 2 2 2') +
      row('b', 'MMMM', '0.01', '3 3 3 3') +
      row('a', 'NNNN', '0.1', '4 4 4 4')
    const out = tagsToDenovo(text, { format: 'alps', topN: 1, minLength: 1 })
    expect(out.text.split('\n').slice(1, -1).map((l) => l.split(',').slice(0, 2).join(','))).toEqual(['b,MMMM', 'a,LLLL'])
  })
})

describe('what the script counts and refuses', () => {
  it('counts rows read, rows below the minimum length and malformed rows', () => {
    const out = tagsToDenovo(read('edge.tags.tsv'), { format: 'stitch', topN: 1, minLength: 8 })
    expect(out).toMatchObject({ rowsRead: 25, short: 4, malformed: 7, reads: 4 })
    expect(out.unknownMods).toEqual({})
    const all = tagsToDenovo(read('edge.tags.tsv'), { format: 'stitch', topN: 50, minLength: 1 })
    expect(all.unknownMods).toEqual({ Foo: 1, '': 1 })
  })

  it('refuses a file without the res_conf column, naming the CLI option', () => {
    const text = 'spectrum\ttag\tlength\tcharge\tnterm_mass\tcterm_mass\tevalue\n'
    expect(() => tagsToDenovo(text, { format: 'stitch', topN: 1, minLength: 1 })).toThrow(DenovoError)
    expect(() => tagsToDenovo(text, { format: 'stitch', topN: 1, minLength: 1 })).toThrow(/res_conf.*-res_conf/)
  })

  it('refuses an empty file and a top N below 1', () => {
    expect(() => tagsToDenovo('', { format: 'alps', topN: 1, minLength: 1 })).toThrow(/empty/)
    expect(() => tagsToDenovo(HEAD, { format: 'alps', topN: 0, minLength: 1 })).toThrow(/top/)
  })

  it('refuses a length the script cannot read as an integer, as the script stops on it', () => {
    expect(() => tagsToDenovo(HEAD + row('a', 'KKKK', '0.1', '1 1 1 1', 'four'), { format: 'alps', topN: 1, minLength: 1 })).toThrow(
      /length/
    )
    // A residue/confidence count mismatch is a skipped row before the length is read.
    const out = tagsToDenovo(HEAD + row('a', 'KKKK', '0.1', '1 1 1', 'four'), { format: 'alps', topN: 1, minLength: 1 })
    expect(out).toMatchObject({ reads: 0, malformed: 1 })
  })

  it('refuses a Stitch flank with a comma (it would shift every column), and ALPS quotes nothing but the ID', () => {
    const text = HEAD + 'a\tKKKK\t4\t2\t1,5\t0\t0.1\t1 1 1 1\n'
    expect(() => tagsToDenovo(text, { format: 'stitch', topN: 1, minLength: 1 })).toThrow(/comma/)
    expect(tagsToDenovo(text, { format: 'alps', topN: 1, minLength: 1 }).text).toBe('Spectrum Name,Peptide,aaScore,Score,Area\na,KKKK,1 1 1 1,1,1\n')
  })

  it('rounds the ALC half to even, as Python round() does', () => {
    const text = HEAD + row('a', 'KK', '0.1', '50 51') + row('b', 'KK', '0.1', '51 52') + row('c', 'KKKK', '0.1', '0 0 0 1')
    const alc = tagsToDenovo(text, { format: 'alps', topN: 1, minLength: 1 })
      .text.split('\n')
      .slice(1, -1)
      .map((l) => l.split(',')[3])
    expect(alc).toEqual(['50', '52', '0'])
  })
})
