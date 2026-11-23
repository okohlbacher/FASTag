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
//
// A row read as c/z-dot ions (ion_series cz, under -ion_series cz or auto,
// also in a hybrid run's mixed rows) has the same residue-sum flanks with
// the c/z-dot offsets (IonSeries.h ionPair): c at nterm_mass + NH3, z-dot at
// cterm_mass + H2O - NH2.

import type { SpectrumPeaks } from './dump'

export const PROTON = 1.007276466812
export const WATER = 18.0105646837
// OpenMS Residue::getInternalToCIon (NH3) and getInternalToZp1Ion
// (H2O - NH2, the z+1 radical of ETD/ECD).
export const C_OFFSET = 17.0265491015
export const Z_DOT_OFFSET = WATER - 16.0187240694

// Monoisotopic residue masses (unmodified; C without Carbamidomethyl): OpenMS
// ResidueDB's internal masses (Residue::getMonoWeight(Internal) over
// Natural19WithoutI, I = L), as FASTag's TagGraph takes them, so that the GUI
// resolves and ranks a spectrum's tags exactly as the CLI does.
const RESIDUE: Record<string, number> = {
  G: 57.0214640957, A: 71.03711415949999, S: 87.0320291595, P: 97.05276422329999, V: 99.0684142871,
  T: 101.04767922330001, C: 103.00918488949999, L: 113.08406435089999, I: 113.08406435089999, N: 114.04292819140001,
  D: 115.02694415949999, Q: 128.05857825520002, K: 128.09496338280002, E: 129.0425942233, M: 131.04048501709997,
  H: 137.05891222330001, F: 147.06841428710004, R: 156.1011113828, Y: 163.06332928710003, W: 186.07931331899999
}

// Unimod monoisotopic deltas of the modifications a run commonly carries, by
// their OpenMS name (case does not matter); OpenMS ModificationsDB's
// getDiffMonoMass gives the same values. A name not here is named in the
// Spectrum tab rather than guessed.
const MOD_DELTA: Record<string, number> = {
  carbamidomethyl: 57.021464,
  oxidation: 15.994915,
  phospho: 79.966331,
  acetyl: 42.010565,
  deamidated: 0.984016,
  amidated: -0.984016,
  methyl: 14.01565,
  methylthio: 45.987721,
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

/** The Unimod monoisotopic delta of the modification @p name (case does
 *  not matter); undefined when it is not known here. */
export const modDelta = (name: string): number | undefined => MOD_DELTA[name.trim().toLowerCase()]

// The CLI's default -fixed_modifications.
export const DEFAULT_FIXED = ['Carbamidomethyl (C)']

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

/** The mass of one residue under @p residues; undefined when it or its
 *  modification has no mass here. */
const massOf = (r: TagResidue, residues: Residues): number | undefined => {
  const m = residues.masses[r.residue]
  const d = r.mod == null ? 0 : MOD_DELTA[r.mod.toLowerCase()]
  return m === undefined || d === undefined ? undefined : m + d
}

/** The mass of a step reading as graph.ts labels it (A, M[Oxidation], a
 *  gap's residues [AG]); null when it does not parse or has no mass here. */
export function readingMass(label: string, residues: Residues): number | null {
  const parsed = parseTag(label.startsWith('[') && label.endsWith(']') ? label.slice(1, -1) : label)
  if (!parsed) return null
  let sum = 0
  for (const r of parsed) {
    const m = massOf(r, residues)
    if (m === undefined) return null
    sum += m
  }
  return sum
}

export interface TagRow {
  spectrum: string
  tag: string
  charge: number
  ntermMass: number
  ctermMass: number
  gapped: boolean
  // The series the row was read as (the ion_series column; by without it).
  ionSeries: 'by' | 'cz'
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
  return {
    spectrum: at('spectrum') ?? '',
    tag,
    charge,
    ntermMass,
    ctermMass,
    gapped: (at('gapped') ?? '0') !== '0',
    ionSeries: (at('ion_series') ?? '').trim() === 'cz' ? 'cz' : 'by'
  }
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
  series: 'b' | 'y' | 'c' | 'z'
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
  // Which ion series the peaks are, as far as the spectrum tells (seriesCall):
  // series above is call.series. Missing: not judged (no peaks).
  call?: SeriesCall
  // The flank it was walked from: b/c from nterm_mass, y/z from cterm_mass.
  walked?: Ladder['series']
}

/** Which ion series a ladder lies on. FASTag writes a tag in ascending m/z
 *  and does not say whether it read b or y ions; the series decides which way
 *  the tag reads N to C. sure: the evidence held in at least 99.4% of correct
 *  ladders of the development data (PXD003531, PXD000001; work/tag-score,
 *  series.ts); likely: 86-99%; open: not told apart (there 64-86% y, too
 *  unstable across datasets to call), shown as walked. */
export interface SeriesCall {
  series: Ladder['series']
  level: 'sure' | 'likely' | 'open'
  why: string
}

const CO = 27.9949146
// The rules were measured at 20 ppm; a wider tolerance (a Da run, an ion
// trap) matches a ions and K/R by chance too often to be believed.
const SERIES_MAX_PPM = 25
const SERIES_MAX_DA = 0.02
// The complement of a peak lies within this of the precursor less the peak.
export const complementTol = (s: SpectrumPeaks, x: number): number => tolAt(s, x) + (s.precursor != null ? tolAt(s, s.precursor) : 0)
/** The neutral mass of the complement of peak @p k at charge @p z, or null without a precursor. */
export function complementOf(s: SpectrumPeaks, k: number, z: number): number | null {
  if (s.precursor == null || !(s.charge > 0)) return null
  return s.precursor * s.charge - s.charge * PROTON - (s.mz[k] * z - z * PROTON)
}
export function seriesCall(peaks: number[], z: number, flankSeries: Ladder['series'], s: SpectrumPeaks, residues: Residues): SeriesCall {
  // c/z-dot: no rule measured; the flank the ladder was walked from decides.
  if (flankSeries === 'c' || flankSeries === 'z') return { series: flankSeries, level: 'open', why: 'c and z ions are not told apart here' }
  if (s.toleranceUnit === 'ppm' ? s.tolerance > SERIES_MAX_PPM : s.tolerance > SERIES_MAX_DA)
    return { series: flankSeries, level: 'open', why: `at this tolerance (${s.tolerance} ${s.toleranceUnit}) a ions match by chance too often to tell b from y` }
  const neutral = (k: number): number => s.mz[k] * z - z * PROTON
  const at = (m: number): number => {
    const x = (m + z * PROTON) / z
    return nearest(s.mz, x, tolAt(s, x))
  }
  const aSelf = peaks.filter((k) => at(neutral(k) - CO) >= 0).length
  // The complement of each peak (b <-> y at the same charge), and an a ion beside it.
  const mirror = peaks.map((k) => complementOf(s, k, z)).map((m) => (m == null ? -1 : at(m))).filter((k) => k >= 0)
  const aMirror = mirror.filter((k) => at(neutral(k) - CO) >= 0).length
  // Read as y, the mass below its lowest peak is a suffix plus water: K or R alone is a tryptic C terminus.
  const below = neutral(peaks[0]) - WATER
  const kr = [['K', residues.masses.K], ['R', residues.masses.R]].find(([, m]) => Math.abs(below - (m as number)) <= 2 * tolAt(s, below))?.[0]
  const n = (k: number, what: string): string => `${k} ${what}${k === 1 ? '' : 's'}`
  if (aSelf >= 2 && aMirror < 2) return { series: 'b', level: 'sure', why: `a ions (b − CO) beside ${n(aSelf, 'peak')}` }
  if (aSelf === 0 && aMirror >= 2) return { series: 'y', level: 'sure', why: `a ions beside ${n(aMirror, 'complement peak')} (its b ions)` }
  if (aSelf === 0 && kr) return { series: 'y', level: 'sure', why: `read as y ions it starts right after a C-terminal ${kr}` }
  if (aSelf === 1 && aMirror === 0) return { series: 'b', level: 'likely', why: 'an a ion (b − CO) beside 1 peak' }
  if (aMirror === 1 && aSelf === 0) return { series: 'y', level: 'likely', why: 'an a ion beside 1 complement peak (its b ions)' }
  // Not told apart: the reading the ladder was walked as (FASTag's written order for b).
  return {
    series: flankSeries,
    level: 'open',
    why: aSelf > 0 && aMirror > 0 ? 'a ions beside its peaks and beside its complement: b or y is not told apart' : 'no a ion beside its peaks or its complement: b or y is not told apart'
  }
}

/** Whether @p b lies on the complements of @p a (at least two of its peaks). */
export function isComplement(a: number[], b: number[], z: number, s: SpectrumPeaks): boolean {
  let n = 0
  for (const k of b) {
    const m = complementOf(s, k, z)
    if (m != null && a.some((j) => Math.abs(s.mz[j] * z - z * PROTON - m) <= complementTol(s, s.mz[j]) * z)) n++
  }
  return n >= Math.min(2, b.length)
}

/** A ladder and its complement are opposite series: a judged one settles an
 *  open one; two judged the same way contradict each other and are both open. */
export function pairCalls(a: SeriesCall, b: SeriesCall): [SeriesCall, SeriesCall] {
  const flip = (c: SeriesCall): Ladder['series'] => (c.series === 'b' ? 'y' : c.series === 'y' ? 'b' : c.series === 'c' ? 'z' : 'c')
  if (a.level !== 'open' && b.level === 'open') return [a, { series: flip(a), level: a.level, why: `the complement of a ladder judged ${a.series}: ${a.why}` }]
  if (b.level !== 'open' && a.level === 'open') return [{ series: flip(b), level: b.level, why: `the complement of a ladder judged ${b.series}: ${b.why}` }, b]
  if (a.level !== 'open' && b.level !== 'open' && a.series === b.series) {
    const why = `it and its complement are both judged ${a.series}: b or y is not told apart`
    return [{ ...a, level: 'open', why }, { ...b, level: 'open', why }]
  }
  return [a, b]
}

/** The ladder relabelled with the series its peaks are judged to be. */
export function called(l: Ladder, s: SpectrumPeaks, residues: Residues): Ladder {
  const peaks = l.positions.map((p) => p.peak).filter((p): p is number => p != null)
  if (peaks.length === 0) return l
  const call = seriesCall(peaks, l.charge, l.series, s, residues)
  return { ...l, series: call.series, call, walked: l.series }
}

/** The series as shown: b, y, with ? when likely, "b or y" when open. */
export function seriesText(series: Ladder['series'], call?: SeriesCall): string {
  if (!call || call.level === 'sure') return series
  if (call.level === 'likely') return `${series}?`
  return series === 'c' || series === 'z' ? 'c or z' : 'b or y'
}

const tolAt = (s: SpectrumPeaks, x: number): number => (s.toleranceUnit === 'ppm' ? (x * s.tolerance) / 1e6 : s.tolerance)

/** The peak nearest @p x within @p tol, or -1. */
export function nearest(mz: number[], x: number, tol: number): number {
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
function walk(series: Ladder['series'], start: number, residues: number[], labels: string[], z: number, s: SpectrumPeaks, gapped: boolean): Ladder {
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
  return laddersFor(row, s, residues).best
}

/** At least one residue step joins two peaks. */
export const hasStep = (l: Ladder): boolean => l.positions.some((p, k) => k > 0 && p.peak != null && l.positions[k - 1].peak != null)

/** Both ladders of @p row (N-terminal series first) and the one on the
 *  peaks (ladderFor). The plot draws each series with a step on the peaks
 *  on its own line (#127); `both` is empty when no ladder can be built. */
export function laddersFor(row: TagRow, s: SpectrumPeaks, residues: Residues): { best: Ladder; both: Ladder[] } {
  const z = row.charge
  const parsed = parseTag(row.tag)
  const cz = row.ionSeries === 'cz'
  const none = (reason: string): { best: Ladder; both: Ladder[] } => ({
    best: { series: cz ? 'c' : 'b', charge: z, positions: [], residues: [], matched: 0, complete: false, reason },
    both: []
  })
  if (!parsed) return none(`${row.tag} is not a tag`)
  const masses: number[] = []
  const labels: string[] = []
  for (const r of parsed) {
    if (residues.masses[r.residue] === undefined) return none(`no mass for the residue ${r.residue}`)
    const m = massOf(r, residues)
    if (m === undefined) return none(`no mass for the modification ${r.mod}`)
    masses.push(m)
    labels.push(r.mod != null ? `${r.residue}[${r.mod}]` : r.residue)
  }
  if (s.mz.length === 0) return none('the spectrum has no peaks')
  // Walked from either flank; each is then judged b or y on its own peaks.
  let b = called(walk(cz ? 'c' : 'b', row.ntermMass + (cz ? C_OFFSET : 0), masses, labels, z, s, row.gapped), s, residues)
  let y = called(walk(cz ? 'z' : 'y', row.ctermMass + (cz ? Z_DOT_OFFSET : WATER), [...masses].reverse(), [...labels].reverse(), z, s, row.gapped), s, residues)
  // The two walks of one tag usually land on complementary peaks: judge them together.
  const onPeaks = (l: Ladder): number[] => l.positions.map((p) => p.peak).filter((p): p is number => p != null)
  if (b.call && y.call && isComplement(onPeaks(b), onPeaks(y), z, s)) {
    const [cb, cy] = pairCalls(b.call, y.call)
    b = { ...b, series: cb.series, call: cb }
    y = { ...y, series: cy.series, call: cy }
  }
  // The one on the peaks; with both (or neither), the one on more peaks.
  const best = b.complete !== y.complete ? (b.complete ? b : y) : y.matched > b.matched ? y : b
  return { best, both: [b, y] }
}
