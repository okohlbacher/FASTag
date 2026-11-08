// The -dump_spectrum parser (dump.ts) against real CLI output: the G1 CLI
// (feat/g1-gui-cli-additions) on the public E. coli fixture, every tagged
// spectrum at 20 ppm and at 0.3 Da (src/fixtures/cli/v112-ecoli-dump).

import { describe, expect, it } from 'vitest'
import { parseDump, splitDumps } from './dump'
import ppmDumps from '../fixtures/cli/v112-ecoli-dump/dumps.ppm.jsonl?raw'
import daDumps from '../fixtures/cli/v112-ecoli-dump/dumps.da.jsonl?raw'

const first = splitDumps(ppmDumps)[0]

describe('parseDump on real -dump_spectrum output', () => {
  it('reads every dumped spectrum of both runs', () => {
    for (const [text, n, tol, unit] of [
      [ppmDumps, 129, 20, 'ppm'],
      [daDumps, 139, 0.3, 'Da']
    ] as const) {
      const dumps = splitDumps(text)
      expect(dumps).toHaveLength(n)
      for (const d of dumps) {
        const r = parseDump(d)
        if (!r.ok) throw new Error(r.error)
        const s = r.spectrum
        expect(s.tolerance).toBe(tol)
        expect(s.toleranceUnit).toBe(unit)
        expect(s.msLevel).toBe(2)
        expect(s.tagged).toBe(true)
        expect(s.mz.length).toBe(s.int.length)
        expect(s.mz.length).toBeGreaterThan(0)
        for (let i = 1; i < s.mz.length; i++) expect(s.mz[i]).toBeGreaterThan(s.mz[i - 1])
      }
    }
  })

  it('reads the fields of the first spectrum as the CLI printed them', () => {
    const r = parseDump(first)
    if (!r.ok) throw new Error(r.error)
    const s = r.spectrum
    expect(s.nativeId).toBe('controllerType=0 controllerNumber=1 scan=11461')
    expect(s.index).toBe(0)
    expect(s.precursor).toBeCloseTo(617.318542480469, 9)
    expect(s.charge).toBe(2)
    expect(s.chargeGiven).toBe(2)
    expect(s.nRead).toBe(260)
    expect(s.mz).toHaveLength(103)
    expect(s.mz[0]).toBe(175.28836059570312)
    expect(s.picked).toBe(false)
    expect(s.deisotoped).toBe(true)
  })

  it('refuses a cut stream, a second spectrum, another format and bad peaks', () => {
    const lines = first.trimEnd().split('\n')
    const rec = JSON.parse(lines[0]) as Record<string, unknown>
    const withRec = (o: Record<string, unknown>): string => JSON.stringify(o) + '\n{"record":"end"}\n'
    const bad: [string, RegExp][] = [
      ['', /empty/],
      [lines[0] + '\n', /cut|end record/],
      [lines[0] + '\n' + lines[0] + '\n{"record":"end"}\n', /2 spectrum records/],
      ['{"record":"end"}\n', /no spectrum record/],
      ['not json\n{"record":"end"}\n', /not JSON/],
      [withRec({ ...rec, format: 2 }), /format 2/],
      [withRec({ ...rec, mz: [2, 1], int: [1, 1], n: 2 }), /ascending/],
      [withRec({ ...rec, mz: [1, 2], int: [1], n: 2 }), /mz and int/],
      [withRec({ ...rec, tolerance_unit: 'mmu' }), /tolerance_unit/],
      [withRec({ ...rec, tolerance: 0 }), /tolerance/],
      [withRec({ ...rec, mz: [1, 'x'], int: [1, 2], n: 2 }), /finite/]
    ]
    for (const [text, why] of bad) {
      const r = parseDump(text)
      expect(r.ok, text.slice(0, 60)).toBe(false)
      if (!r.ok) expect(r.error).toMatch(why)
    }
  })

  it('ignores records and fields it does not know, and CRLF line ends', () => {
    const lines = first.trimEnd().split('\n')
    const rec = { ...(JSON.parse(lines[0]) as Record<string, unknown>), future_field: [1, 2] }
    const text = '{"record":"note","text":"hi"}\r\n' + JSON.stringify(rec) + '\r\n{"record":"end"}\r\n'
    const r = parseDump(text)
    expect(r.ok).toBe(true)
  })

  it('reads an MS1 dump (no peaks, not tagged) without error', () => {
    const lines = first.trimEnd().split('\n')
    const rec = { ...(JSON.parse(lines[0]) as Record<string, unknown>), ms_level: 1, tagged: false, precursor: null, n: 0, mz: [], int: [] }
    const r = parseDump(JSON.stringify(rec) + '\n{"record":"end"}\n')
    if (!r.ok) throw new Error(r.error)
    expect(r.spectrum.precursor).toBeNull()
    expect(r.spectrum.tagged).toBe(false)
    expect(r.spectrum.mz).toHaveLength(0)
  })
})
