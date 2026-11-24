// The likely peptide of a spectrum, from the run's tag placements
// (-recon_out: one row per placement of a tag on a database peptide), and
// where its fragments fall on the m/z axis. A candidate the tags point at,
// not an identification: FASTag does not score or FDR-control it.

import type { SpectrumPeaks } from './dump'
import { ladderSteps, type Step } from './step'
import { C_OFFSET, PROTON, WATER, Z_DOT_OFFSET, type Ladder, type Residues, type SeriesCall } from './ladder'

export interface Candidate {
  peptide: string
  protein: string
  // Distinct tags of the spectrum placed on it, and how many of them exactly.
  tags: number
  exact: number
  // Peptides the spectrum's tags were placed on.
  of: number
  // The mass the placement leaves over (0: exact) and the residues of the
  // peptide it may sit on (0-based, inclusive).
  delta: number
  region: [number, number] | null
}

const il = (s: string): string => s.replace(/I/g, 'L')
// Two placements leave the same gap when their masses are this close (Da), as -delta_out's tag_support.
const GAP_SAME = 0.05

/** The peptide most tags of the spectrum were placed on; of equals the one
 *  with more exact placements, then the smaller mass gap, then the first. */
export function likelyPeptide(columns: string[], rows: string[][]): Candidate | null {
  const col = (n: string): number => columns.indexOf(n)
  const [pe, pr, tg, nm, cm, dm, rg] = ['peptide', 'protein', 'tag', 'nterm_match', 'cterm_match', 'delta_mass', 'region'].map(col)
  if (pe < 0 || tg < 0) return null
  interface G {
    peptide: string
    protein: string
    tags: Set<string>
    exactTags: Set<string>
    gaps: { delta: number; region: [number, number] | null }[]
  }
  const groups = new Map<string, G>()
  for (const r of rows) {
    const peptide = r[pe] ?? ''
    if (!peptide) continue
    const exact = r[nm] === '1' && r[cm] === '1'
    const delta = exact ? 0 : Number(r[dm] ?? '')
    if (Number.isNaN(delta)) continue
    const m = /^(\d+)-(\d+)$/.exec(r[rg] ?? '')
    let g = groups.get(peptide)
    if (!g) groups.set(peptide, (g = { peptide, protein: r[pr] ?? '', tags: new Set(), exactTags: new Set(), gaps: [] }))
    g.tags.add(r[tg] ?? '')
    if (exact) g.exactTags.add(r[tg] ?? '')
    g.gaps.push({ delta, region: !exact && m ? [Number(m[1]), Number(m[2])] : null })
  }
  // ponytail: one gap per peptide, its smallest (0 when a tag sits exactly);
  // tags that leave different gaps on the same peptide are not told apart here.
  const gapOf = (g: G): number => g.gaps.reduce((d, x) => (Math.abs(x.delta) < Math.abs(d) ? x.delta : d), Infinity)
  let best: G | null = null
  for (const g of groups.values())
    if (!best || g.tags.size > best.tags.size || (g.tags.size === best.tags.size && (g.exactTags.size > best.exactTags.size || (g.exactTags.size === best.exactTags.size && Math.abs(gapOf(g)) < Math.abs(gapOf(best)))))) best = g
  if (!best) return null
  const delta = gapOf(best)
  // The gap sits where every tag that leaves it allows it: the regions' overlap.
  let region: [number, number] | null = null
  if (delta !== 0)
    for (const x of best.gaps) {
      if (!x.region || Math.abs(x.delta - delta) > GAP_SAME) continue
      region = region ? [Math.max(region[0], x.region[0]), Math.min(region[1], x.region[1])] : x.region
    }
  if (region && region[0] > region[1]) region = null
  return { peptide: best.peptide, protein: best.protein, tags: best.tags.size, exact: best.exactTags.size, of: groups.size, delta, region }
}

export interface Ruler {
  series: Ladder['series']
  charge: number
  // The m/z of each cleavage in ascending order, the peptide's ends included
  // (null: not known, inside the region of a mass gap or past a residue
  // without a mass), and the residue between tick k and k + 1.
  ticks: (number | null)[]
  residues: string[]
}

/** Where the fragments of @p c fall for one ion series and fragment charge.
 *  A mass gap is added from the end of its region on; inside it no tick. */
export function rulerOf(c: Candidate, series: Ladder['series'], charge: number, residues: Residues): Ruler {
  const seq = [...c.peptide]
  const n = seq.length
  const gap = c.delta !== 0
  const [lo, hi] = c.region ?? [0, n - 1]
  // prefix[i]: the mass of the first i residues.
  const prefix: (number | null)[] = [0]
  let sum: number | null = 0
  seq.forEach((r, k) => {
    const m: number | undefined = residues.masses[r]
    sum = sum == null || m === undefined ? null : sum + m
    const i = k + 1
    prefix.push(sum == null ? null : gap && i > lo && i <= hi ? null : sum + (gap && i > hi ? c.delta : 0))
  })
  const total = sum == null ? null : sum + c.delta
  const fromN = series === 'b' || series === 'c'
  const mz = (m: number | null, offset: number): number | null => (m == null ? null : (m + offset + charge * PROTON) / charge)
  if (fromN) return { series, charge, ticks: prefix.map((p) => mz(p, series === 'c' ? C_OFFSET : 0)), residues: seq }
  const off = series === 'y' ? WATER : Z_DOT_OFFSET
  return {
    series,
    charge,
    ticks: prefix.map((_, j) => mz(total == null || prefix[n - j] == null ? null : total - (prefix[n - j] as number), off)),
    residues: [...seq].reverse()
  }
}

/** The tick of @p ruler each peak of @p peaks lies on within the run's
 *  tolerance (the nearest), or -1. */
export function ticksOf(ruler: Ruler, peaks: number[], s: SpectrumPeaks): number[] {
  return peaks.map((p) => {
    const x = s.mz[p]
    const tol = s.toleranceUnit === 'ppm' ? (x * s.tolerance) / 1e6 : s.tolerance
    let best = -1
    ruler.ticks.forEach((t, k) => {
      if (t != null && Math.abs(t - x) <= tol && (best < 0 || Math.abs(t - x) < Math.abs((ruler.ticks[best] as number) - x))) best = k
    })
    return best
  })
}

/** Whether @p st is read as the peptide has it: its two peaks on the ruler,
 *  one residue apart with that residue, or two apart with a gap's two. */
export function stepOnRuler(st: Step, ruler: Ruler, s: SpectrumPeaks): boolean {
  const [a, b] = ticksOf(ruler, [st.u, st.v], s)
  if (a < 0 || b <= a) return false
  const want = il(ruler.residues.slice(a, b).sort().join(''))
  return st.readings.some((r) => b - a === (r.gap ? 2 : 1) && il([...r.label.replace(/[[\]]/g, '')].sort().join('')) === want)
}

export { ladderSteps }

/** The series the database peptide confirms for these steps: the one whose
 *  fragments more of them lie on (at least one), else null. */
export function dbCall(c: Candidate, steps: Step[], charge: number, series: Ladder['series'], residues: Residues, s: SpectrumPeaks): SeriesCall | null {
  const pair: Ladder['series'][] = series === 'c' || series === 'z' ? ['c', 'z'] : ['b', 'y']
  const on = pair.map((x) => steps.filter((st) => stepOnRuler(st, rulerOf(c, x, charge, residues), s)).length)
  if (on[0] === on[1]) return null
  const k = on[0] > on[1] ? 0 : 1
  return { series: pair[k], level: 'sure', why: `${on[k]} of its steps lie on the database peptide's ${pair[k]} ions` }
}
