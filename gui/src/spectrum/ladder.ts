// The tag ladder of the Spectrum tab (GUI-DESIGN S5, P4): computed here from
// the tag row (nterm_mass, cterm_mass, the residues and the charge) and
// drawn on the peaks FASTag tagged (dump.ts), never on raw peaks.
//
// A tag is a path through the tagger's spectrum graph: peaks one residue
// apart at the tag's fragment charge, each step within the run's tolerance.
// The ladder starts near the flank the row prints (the b ladder at
// nterm_mass, the y ladder at cterm_mass + water) and follows the residues
// peak by peak. A gapped tag (gapped = 1) took gap edges: two residues
// across one missing peak, so an inner position of its ladder may be off the
// peaks. Whichever of the b and y ladders lies on the peaks is drawn (the
// TSV does not say which).

import type { SpectrumPeaks } from './dump'

export const PROTON = 1.007276466812
export const WATER = 18.0105646837

// Monoisotopic residue masses (unmodified; C without Carbamidomethyl).
const RESIDUE: Record<string, number> = {
  G: 57.02146372057, A: 71.03711378471, S: 87.03202840427, P: 97.05276384885, V: 99.06841391299,
  T: 101.04767846841, C: 103.00918478471, L: 113.08406397713, I: 113.08406397713, N: 114.04292744114,
  D: 115.02694302383, Q: 128.05857750527, K: 128.09496301399, E: 129.04259308797, M: 131.04048491299,
  H: 137.05891185845, F: 147.06841391299, R: 156.10111102359, Y: 163.06332853255, W: 186.07931294986
}

// Unimod monoisotopic deltas of the modifications a run commonly carries,
// by their OpenMS name (case does not matter). A name not here is named in
// the Spectrum tab rather than guessed.
const MOD_DELTA: Record<string, number> = {
  carbamidomethyl: 57.021464,
  oxidation: 15.994915,
  phospho: 79.966331,
  acetyl: 42.010565,
  deamidated: 0.984016,
  methyl: 14.01565,
  dimethyl: 28.0313,
  formyl: 27.994915,
  carbamyl: 43.005814,
  propionamide: 71.037114,
  'gln->pyro-glu': -17.026549,
  'glu->pyro-glu': -18.010565,
  tmt6plex: 229.162932,
  tmtpro: 304.207146,
  itraq4plex: 144.102063,
  itraq8plex: 304.20536,
  'label:13c(6)': 6.020129,
  'label:13c(6)15n(2)': 8.014199,
  'label:13c(6)15n(4)': 10.008269
}

// The CLI's default -fixed_modifications.
const DEFAULT_FIXED = ['Carbamidomethyl (C)']

export interface Residues {
  masses: Record<string, number>
  // Fixed modifications of the run whose mass is not known here.
  unknownFixed: string[]
}

/** The residue masses under the run's -fixed_modifications (undefined: the
 *  CLI default; [] or ['']: none). N- and C-terminal ones shift only the
 *  flanks, which the TSV prints already. */
export function residueMasses(fixed: string[] | undefined): Residues {
  const masses = { ...RESIDUE }
  const unknownFixed: string[] = []
  for (const raw of fixed ?? DEFAULT_FIXED) {
    const m = /^\s*(.+?)\s*\(([^)]*)\)\s*$/.exec(raw)
    if (!raw.trim()) continue
    if (!m) {
      unknownFixed.push(raw)
      continue
    }
    const sites = m[2].trim()
    if (/term/i.test(sites)) continue
    const delta = MOD_DELTA[m[1].toLowerCase()]
    if (delta === undefined) {
      unknownFixed.push(raw)
      continue
    }
    for (const r of sites.replace(/\s/g, '')) if (r in masses) masses[r] += delta
  }
  return { masses, unknownFixed }
}

export interface TagResidue {
  residue: string
  // An inline variable modification (X[Name]).
  mod: string | null
}

/** The residues of a tag as the TSV writes it: an upper-case residue, then
 *  an optional [Name]. null: not a tag. */
export function parseTag(tag: string): TagResidue[] | null {
  const out: TagResidue[] = []
  const re = /([A-Z])(?:\[([^\]]*)\])?/y
  let at = 0
  while (at < tag.length) {
    re.lastIndex = at
    const m = re.exec(tag)
    if (!m) return null
    out.push({ residue: m[1], mod: m[2] ?? null })
    at = re.lastIndex
  }
  return out.length > 0 ? out : null
}

export interface TagRow {
  spectrum: string
  tag: string
  charge: number
  ntermMass: number
  ctermMass: number
  gapped: boolean
}

/** The ladder fields of one row of a tags TSV; null without them. */
export function tagRowFrom(columns: string[], cells: string[]): TagRow | null {
  const at = (n: string): string | undefined => {
    const i = columns.indexOf(n)
    return i >= 0 ? cells[i] : undefined
  }
  const num = (n: string): number => Number(at(n) ?? NaN)
  const charge = num('charge')
  const ntermMass = num('nterm_mass')
  const ctermMass = num('cterm_mass')
  const tag = at('tag')
  if (!tag || !Number.isInteger(charge) || charge < 1 || !Number.isFinite(ntermMass) || !Number.isFinite(ctermMass)) return null
  return { spectrum: at('spectrum') ?? '', tag, charge, ntermMass, ctermMass, gapped: (at('gapped') ?? '0') !== '0' }
}

export interface LadderPosition {
  // The m/z the ladder expects here.
  expected: number
  // The peak it lies on (an index into the dump's peaks), or none.
  peak: number | null
  mz: number | null
  // The error of this step (from the previous peak on the ladder) in ppm,
  // and in m/z; null off the peaks.
  deltaPpm: number | null
  deltaMz: number | null
}

export interface Ladder {
  series: 'b' | 'y'
  charge: number
  // In ascending m/z; residues[k] lies between positions k and k + 1.
  positions: LadderPosition[]
  residues: string[]
  // Positions on a peak.
  matched: number
  // Every position is on a peak, apart from the one a gapped tag crossed.
  complete: boolean
  // Why there is no ladder or it is not complete.
  reason?: string
}

const tolAt = (s: SpectrumPeaks, x: number): number => (s.toleranceUnit === 'ppm' ? (x * s.tolerance) / 1e6 : s.tolerance)

/** The peak nearest @p x within @p tol, or -1. */
function nearest(mz: number[], x: number, tol: number): number {
  let lo = 0
  let hi = mz.length
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (mz[m] < x) lo = m + 1
    else hi = m
  }
  let best = -1
  for (const i of [lo - 1, lo]) {
    if (i < 0 || i >= mz.length) continue
    if (Math.abs(mz[i] - x) <= tol && (best < 0 || Math.abs(mz[i] - x) < Math.abs(mz[best] - x))) best = i
  }
  return best
}

// The 4 decimals the TSV prints the flanks with.
const FLANK_SLACK = 1e-4

interface Chain {
  positions: LadderPosition[]
  matched: number
  // The last position is on a peak.
  end: boolean
  // Sum of the step errors in m/z (a tie-break).
  err: number
}

const at = (s: SpectrumPeaks, x: number, p: number): LadderPosition => ({
  expected: x,
  peak: p,
  mz: s.mz[p],
  deltaPpm: ((s.mz[p] - x) / x) * 1e6,
  deltaMz: s.mz[p] - x
})
const off = (x: number): LadderPosition => ({ expected: x, peak: null, mz: null, deltaPpm: null, deltaMz: null })

/** The best chain from the peak @p p0 (position 0) over @p steps, as the
 *  tagger's graph has them (FASTagger.cpp buildGraph): an ordinary edge is
 *  one residue, the peak nearest mz + residue / z within the tolerance at
 *  that target; a gap edge (gapped tags only) spans two residues across one
 *  missing peak, within the tolerance at the far peak. A position no edge
 *  reaches is off the peaks. */
function chainFrom(x0: number, p0: number, steps: number[], s: SpectrumPeaks, gaps: boolean): Chain {
  const n = steps.length
  // memo[k][peak]: the best tail from position k on that peak.
  const memo = new Map<string, Chain>()
  const tail = (k: number, p: number): Chain => {
    if (k === n) return { positions: [], matched: 0, end: true, err: 0 }
    const key = `${k}:${p}`
    const hit = memo.get(key)
    if (hit) return hit
    let best: Chain | null = null
    const consider = (c: Chain): void => {
      if (
        !best ||
        Number(c.end) > Number(best.end) ||
        (c.end === best.end && (c.matched > best.matched || (c.matched === best.matched && c.err < best.err)))
      )
        best = c
    }
    // An ordinary edge.
    const x1 = s.mz[p] + steps[k]
    const q1 = nearest(s.mz, x1, tolAt(s, x1))
    if (q1 >= 0) {
      const t = tail(k + 1, q1)
      consider({ positions: [at(s, x1, q1), ...t.positions], matched: t.matched + 1, end: t.end, err: t.err + Math.abs(s.mz[q1] - x1) })
    }
    // A gap edge over position k + 1.
    if (gaps && k + 2 <= n) {
      const x2 = s.mz[p] + steps[k] + steps[k + 1]
      const q2 = nearest(s.mz, x2, tolAt(s, x2))
      if (q2 >= 0) {
        const t = tail(k + 2, q2)
        consider({ positions: [off(x1), at(s, x2, q2), ...t.positions], matched: t.matched + 1, end: t.end, err: t.err + Math.abs(s.mz[q2] - x2) })
      }
    }
    // Nowhere to go: the rest of the ladder is off the peaks.
    if (!best) {
      const rest: LadderPosition[] = []
      let x = s.mz[p]
      for (let j = k; j < n; j++) rest.push(off((x += steps[j])))
      best = { positions: rest, matched: 0, end: false, err: 0 }
    }
    memo.set(key, best)
    return best
  }
  const t = tail(0, p0)
  return { positions: [at(s, x0, p0), ...t.positions], matched: t.matched + 1, end: t.end, err: t.err }
}

// One series: the chain of peaks one residue (in m/z: residue / charge)
// apart. The printed flank places the first peak only roughly: one of the
// two flanks is derived from the precursor and carries its error, so the
// first peak may lie up to (n + 1) tolerances from it (gui_cli_test.sh
// allows the same). Every peak in that window is tried; a chain to the last
// position wins, then the one on most peaks, then the smaller error, then
// the one nearest the flank.
function walk(series: 'b' | 'y', start: number, residues: number[], labels: string[], z: number, s: SpectrumPeaks, gapped: boolean): Ladder {
  const x0 = (start + z * PROTON) / z
  const steps = residues.map((m) => m / z)
  const window = (steps.length + 1) * tolAt(s, x0) + FLANK_SLACK / z
  let best: (Chain & { dist: number }) | null = null
  const lo = s.mz.findIndex((v) => v >= x0 - window)
  for (let i = lo < 0 ? s.mz.length : lo; i < s.mz.length && s.mz[i] <= x0 + window; i++) {
    const c = chainFrom(x0, i, steps, s, gapped)
    const dist = Math.abs(s.mz[i] - x0)
    const better =
      !best ||
      Number(c.end) > Number(best.end) ||
      (c.end === best.end &&
        (c.matched > best.matched || (c.matched === best.matched && (c.err < best.err || (c.err === best.err && dist < best.dist)))))
    if (better) best = { ...c, dist }
  }
  let positions: LadderPosition[]
  let matched: number
  if (best) {
    positions = best.positions
    matched = best.matched
  } else {
    // No peak near the flank: the expected ladder, all off the peaks.
    positions = [off(x0)]
    let x = x0
    for (const st of steps) positions.push(off((x += st)))
    matched = 0
  }
  const n = positions.length
  const complete = positions[0].peak != null && positions[n - 1].peak != null && (gapped || matched === n)
  return {
    series,
    charge: z,
    positions,
    residues: labels,
    matched,
    complete,
    reason: complete ? undefined : `${n - matched} of ${n} ladder positions are not on a peak`
  }
}

/** The ladder of @p row on the peaks of @p s, under @p residues. */
export function ladderFor(row: TagRow, s: SpectrumPeaks, residues: Residues): Ladder {
  const z = row.charge
  const parsed = parseTag(row.tag)
  const none = (reason: string): Ladder => ({ series: 'b', charge: z, positions: [], residues: [], matched: 0, complete: false, reason })
  if (!parsed) return none(`${row.tag} is not a tag`)
  const masses: number[] = []
  const labels: string[] = []
  for (const r of parsed) {
    let m = residues.masses[r.residue]
    if (m === undefined) return none(`no mass for the residue ${r.residue}`)
    if (r.mod != null) {
      const d = MOD_DELTA[r.mod.toLowerCase()]
      if (d === undefined) return none(`no mass for the modification ${r.mod}`)
      m += d
    }
    masses.push(m)
    labels.push(r.mod != null ? `${r.residue}[${r.mod}]` : r.residue)
  }
  if (s.mz.length === 0) return none('the spectrum has no peaks')
  const b = walk('b', row.ntermMass, masses, labels, z, s, row.gapped)
  const y = walk('y', row.ctermMass + WATER, [...masses].reverse(), [...labels].reverse(), z, s, row.gapped)
  // The one on the peaks; with both (or neither), the one on more peaks.
  if (b.complete !== y.complete) return b.complete ? b : y
  return y.matched > b.matched ? y : b
}
