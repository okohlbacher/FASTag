// The species report parser (species.ts), which replaces species.rs
// read_species (GUI-DESIGN 6.7, P4). The cargo tests of read_species move
// here, each named after its predecessor, plus every real -species report
// in the repository (src/fixtures/cli, the 1.11.0 and 1.12 CLIs on the gate
// PXDs).

import { describe, expect, it } from 'vitest'
import { parseSpecies } from './species'

const realReports = import.meta.glob('../fixtures/cli/**/*.species.tsv', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

describe('parseSpecies (successors of the species.rs read_species tests)', () => {
  it('species_report_filters_zero_hits_and_keeps_file_order', () => {
    // The rows deliberately do not follow the CLI's ranking (Neighbour has
    // the lower adjusted count), so any re-ranking by the GUI fails.
    const r = parseSpecies(
      'rank\ttaxid\tname\tobserved\tadjusted\texpected\tlog_pvalue\tqvalue\n' +
        'genus\t1\tZero\t0\t0\t0.5\t-1\t1\n' +
        'genus\t2\tNeighbour\t200\t1\t2.0\t-99\t0\n' +
        'genus\t3\tTrue\t100\t90\t2.0\t-50\t0\n',
      '/d/sp.tsv'
    )!
    expect(r.path).toBe('/d/sp.tsv')
    expect(r.taxa.map((t) => t.name)).toEqual(['Neighbour', 'True'])
  })

  it('non_utf8_name_does_not_hide_the_report (report_text decodes lossily)', () => {
    // report.rs read_report turns a Latin-1 byte into U+FFFD; the parser
    // keeps the row.
    const r = parseSpecies('rank\ttaxid\tname\tobserved\tadjusted\texpected\tlog_pvalue\tqvalue\ngenus\t1\tCaf�ella\t5\t5\t0.5\t-3\t0.01\n', 'x')!
    expect(r.taxa).toHaveLength(1)
    expect(r.taxa[0].name).toBe('Caf�ella')
    expect(r.taxa[0].observed).toBe(5)
  })

  it('bom_header_still_binds_the_rank_column', () => {
    const r = parseSpecies('﻿rank\ttaxid\tname\tobserved\tadjusted\tqvalue\ngenus\t1\tA\t5\t5\t0.01\n', 'x')!
    expect(r.taxa[0].rank).toBe('genus')
  })

  it('empty_missing_or_directory_path_is_none: an empty text is no report', () => {
    expect(parseSpecies('', 'x')).toBeNull()
    expect(parseSpecies('\n\n  \n', 'x')).toBeNull()
  })

  it('num_strips_trailing_unit, and a non-finite or unparsable count is 0', () => {
    const r = parseSpecies(
      'rank\ttaxid\tname\tobserved\tadjusted\tqvalue\n' +
        'genus\t1\tA\t1.4x\t8.3X\t0.5\n' +
        'genus\t2\tB\t3\tinf\tnan\n' +
        'genus\t3\tC\tgarbage\t1\t0\n',
      'x'
    )!
    expect(r.taxa.map((t) => [t.name, t.observed, t.adjusted, t.q])).toEqual([
      ['A', 1.4, 8.3, 0.5],
      ['B', 3, 0, 1]
    ])
  })

  it('CRLF line ends and a short row read as the CLI wrote them', () => {
    const r = parseSpecies('rank\ttaxid\tname\tobserved\tadjusted\tqvalue\r\ngenus\t7\tShort\t2\r\n', 'x')!
    expect(r.taxa).toEqual([{ rank: 'genus', taxid: 7, name: 'Short', observed: 2, adjusted: 0, q: 1 }])
  })

  it('species_call_columns_of_the_real_fixture', () => {
    const r = parseSpecies(realReports['../fixtures/cli/v112-pxd003531-call/run.tags.species.tsv'], 'call')!
    expect(r.taxa).toHaveLength(50)
    expect(r.taxa.filter((t) => t.call === 'present').map((t) => t.name)).toEqual(['Homo', 'Macaca', 'Sus', 'Equus'])
    expect(r.taxa[0].callReason).toBe('pass')
  })

  it('a_report_without_the_call_columns_has_no_call_fields', () => {
    const r = parseSpecies(realReports['../fixtures/cli/v111-pxd003531/run.tags.species.tsv'], 'v111')!
    expect(r.taxa[0].name).toBe('Homo')
    expect(r.taxa.every((t) => !('call' in t) && !('callReason' in t))).toBe(true)
  })
})

describe('parseSpecies on every real species report in the repository', () => {
  const names = Object.keys(realReports)
  it('finds the real reports', () => {
    expect(names.length).toBeGreaterThanOrEqual(15)
  })
  for (const name of names) {
    it(name.replace('../fixtures/cli/', ''), () => {
      const text = realReports[name]
      const r = parseSpecies(text, name)!
      const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
      const head = lines[0].split('\t')
      const obs = head.indexOf('observed')
      // Every row with a hit, in the CLI's order; no other row.
      const expected = lines.slice(1).map((l) => l.split('\t')).filter((f) => Number(f[obs]) > 0)
      expect(r.taxa.map((t) => t.name)).toEqual(expected.map((f) => f[head.indexOf('name')]))
      expect(r.taxa.map((t) => t.taxid)).toEqual(expected.map((f) => Number(f[head.indexOf('taxid')])))
      for (const t of r.taxa) {
        expect(Number.isInteger(t.taxid) && t.taxid > 0).toBe(true)
        expect(t.q >= 0 && t.q <= 1).toBe(true)
      }
      // The call columns are there exactly when the CLI wrote them (a
      // report without hits, as pxd010783's, has no rows to carry them).
      if (r.taxa.length > 0) expect(r.taxa.some((t) => 'call' in t)).toBe(head.includes('call'))
    })
  }
})
