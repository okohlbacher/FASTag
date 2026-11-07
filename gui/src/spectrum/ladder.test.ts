// The ladder oracle (GUI-DESIGN 9 layer 1, 10 P4): for every tag of the
// fixture runs, the ladder ladder.ts draws lies on the peaks FASTag tagged
// (its -dump_spectrum output) within the run's tolerance. Real CLI output on
// the public E. coli fixture: the tags and the dumps of the same build, at
// the CLI default (20 ppm) and at 0.3 Da (src/fixtures/cli/v112-ecoli-dump).
//
// The check is independent of ladder.ts: its own residue table (the
// gui_cli_test.sh one, C with the CLI's default Carbamidomethyl), its own
// tolerance rule, and the peaks read straight from the JSON.

import { describe, expect, it } from 'vitest'
import { ladderFor, parseTag, residueMasses, tagRowFrom, type Ladder } from './ladder'
import { parseDump, splitDumps, type SpectrumPeaks } from './dump'
import ppmTags from '../../e2e-web/fixtures/ecoli.tags.tsv?raw'
import ppmDumps from '../fixtures/cli/v112-ecoli-dump/dumps.ppm.jsonl?raw'
import daTags from '../fixtures/cli/v112-ecoli-dump/da.tags.tsv?raw'
import daDumps from '../fixtures/cli/v112-ecoli-dump/dumps.da.jsonl?raw'

const MONO: Record<string, number> = {
  G: 57.02146372057, A: 71.03711378471, S: 87.03202840427, P: 97.05276384885, V: 99.06841391299,
  T: 101.04767846841, C: 160.03064850528, L: 113.08406397713, I: 113.08406397713, N: 114.04292744114,
  D: 115.02694302383, Q: 128.05857750527, K: 128.09496301399, E: 129.04259308797, M: 131.04048491299,
  H: 137.05891185845, F: 147.06841391299, R: 156.10111102359, Y: 163.06332853255, W: 186.07931294986
}
const PROTON = 1.007276466812

function dumpsById(text: string): Map<string, SpectrumPeaks> {
  const m = new Map<string, SpectrumPeaks>()
  for (const d of splitDumps(text)) {
    const r = parseDump(d)
    if (!r.ok) throw new Error(r.error)
    m.set(r.spectrum.nativeId, r.spectrum)
  }
  return m
}

function rowsOf(tsv: string): { columns: string[]; rows: string[][] } {
  const lines = tsv.split('\n').filter((l) => l !== '')
  return { columns: lines[0].split('\t'), rows: lines.slice(1).map((l) => l.split('\t')) }
}

// The run's tolerance at m/z x (the dump says which).
const tolAt = (s: SpectrumPeaks, x: number): number => (s.toleranceUnit === 'ppm' ? (x * s.tolerance) / 1e6 : s.tolerance)

/** Fails with a reason when @p lad is not on @p s's peaks for @p tag. */
function oracle(lad: Ladder, tag: string, z: number, flank: number, s: SpectrumPeaks, gapped: boolean): string | null {
  // In ascending m/z: the residues between the ladder's positions.
  const res = lad.series === 'b' ? [...tag] : [...tag].reverse()
  if (lad.positions.length !== res.length + 1) return `${lad.positions.length} positions for ${res.length} residues`
  let missing = 0
  let prev: number | null = null
  let pending = 0
  for (let k = 0; k < lad.positions.length; k++) {
    const p = lad.positions[k]
    if (k > 0) pending += MONO[res[k - 1]] / z
    if (p.peak == null) {
      if (k === 0 || k === lad.positions.length - 1) return `an end of the ladder (position ${k}) is not on a peak`
      // A gap edge stands for one missing peak (FASTagger.cpp buildGraph).
      if (lad.positions[k - 1].peak == null) return `positions ${k - 1} and ${k} are both off the peaks`
      missing++
      continue
    }
    // The drawn peak is one of the dumped peaks, at its m/z.
    if (p.peak < 0 || p.peak >= s.mz.length || s.mz[p.peak] !== p.mz) return `position ${k} names no dumped peak`
    if (prev == null) {
      // The first peak is near the printed flank (4 decimals): one of the
      // two flanks is derived from the precursor, so it may lie up to
      // (n + 1) tolerances away (gui_cli_test.sh allows the same).
      const x = (flank + z * PROTON) / z
      if (Math.abs(p.mz! - x) > res.length * tolAt(s, x) + tolAt(s, x) + 1e-4 / z) return `the first peak ${p.mz} is ${p.mz! - x} from the flank ${x}`
    } else {
      // Each step (across the missing peaks of a gapped tag) is its residues within the tolerance.
      const gap = p.mz! - prev
      if (Math.abs(gap - pending) > tolAt(s, p.mz!)) return `step to position ${k}: gap ${gap} for ${pending}`
    }
    prev = p.mz!
    pending = 0
  }
  if (missing > 0 && !gapped) return `${missing} positions of an ungapped tag are not on a peak`
  return null
}

function checkRun(tsv: string, dumps: string): { checked: number; series: Record<string, number> } {
  const peaks = dumpsById(dumps)
  const { columns, rows } = rowsOf(tsv)
  const residues = residueMasses(undefined)
  let checked = 0
  const series: Record<string, number> = { b: 0, y: 0 }
  const failures: string[] = []
  for (const cells of rows) {
    const s = peaks.get(cells[0])
    if (!s) throw new Error(`no dump of ${cells[0]}`)
    const row = tagRowFrom(columns, cells)
    if (!row) throw new Error(`not a tag row: ${cells.join(' ')}`)
    const lad = ladderFor(row, s, residues)
    const why = lad.complete ? oracle(lad, row.tag, row.charge, lad.series === 'b' ? row.ntermMass : row.ctermMass + 18.0105646837, s, row.gapped) : lad.reason ?? 'incomplete'
    if (why) failures.push(`${cells[0]} ${row.tag} z=${row.charge}: ${why}`)
    else {
      checked++
      series[lad.series]++
    }
  }
  expect(failures.slice(0, 10)).toEqual([])
  return { checked, series }
}

describe('ladder oracle on the real fixture runs', () => {
  it('every tag of the 20 ppm run lies on its peaks', () => {
    const r = checkRun(ppmTags, ppmDumps)
    expect(r.checked).toBe(2028)
  })

  it('every tag of the 0.3 Da run lies on its peaks', () => {
    const r = checkRun(daTags, daDumps)
    expect(r.checked).toBe(5937)
  })

  it('a ladder against the wrong spectrum is not complete', () => {
    const peaks = [...dumpsById(ppmDumps).values()]
    const { columns, rows } = rowsOf(ppmTags)
    // The first tag of the first spectrum, drawn on another spectrum's peaks.
    const row = tagRowFrom(columns, rows[0])!
    const other = peaks.find((s) => s.nativeId !== rows[0][0] && Math.abs((s.precursor ?? 0) - 617.3) > 50)!
    expect(ladderFor(row, other, residueMasses(undefined)).complete).toBe(false)
  })

  it('a peak shifted by more than the tolerance breaks the ladder', () => {
    const peaks = dumpsById(ppmDumps)
    const { columns, rows } = rowsOf(ppmTags)
    const cells = rows.find((r) => r[7] === '0')!
    const s = peaks.get(cells[0])!
    const row = tagRowFrom(columns, cells)!
    const lad = ladderFor(row, s, residueMasses(undefined))
    expect(lad.complete).toBe(true)
    const k = lad.positions[2].peak!
    const mz = Array.from(s.mz)
    mz[k] += 3 * tolAt(s, mz[k])
    const shifted = { ...s, mz }
    expect(ladderFor(row, shifted, residueMasses(undefined)).complete).toBe(false)
  })
})

describe('residue masses and tag parsing', () => {
  it('C carries the default Carbamidomethyl; cleared fixed mods leave it bare', () => {
    expect(residueMasses(undefined).masses.C).toBeCloseTo(160.030649, 5)
    expect(residueMasses(['Carbamidomethyl (C)']).masses.C).toBeCloseTo(160.030649, 5)
    expect(residueMasses([]).masses.C).toBeCloseTo(103.009185, 5)
    expect(residueMasses(['']).masses.C).toBeCloseTo(103.009185, 5)
  })

  it('a fixed TMT6plex (K) shifts K; an N-term one leaves the residues alone', () => {
    const r = residueMasses(['Carbamidomethyl (C)', 'TMT6plex (K)', 'TMT6plex (N-term)'])
    expect(r.masses.K).toBeCloseTo(128.094963 + 229.162932, 5)
    expect(r.unknownFixed).toEqual([])
  })

  it('an unknown fixed modification is named, not guessed', () => {
    expect(residueMasses(['Frobnicated (K)']).unknownFixed).toEqual(['Frobnicated (K)'])
  })

  it('reads inline variable modifications', () => {
    expect(parseTag('PEM[Oxidation]K')).toEqual([
      { residue: 'P', mod: null },
      { residue: 'E', mod: null },
      { residue: 'M', mod: 'Oxidation' },
      { residue: 'K', mod: null }
    ])
    expect(parseTag('pep')).toBeNull()
    expect(parseTag('PE[unclosed')).toBeNull()
  })
})
