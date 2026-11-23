// Whether a resolved tag lies at a peptide terminus, or one residue from it:
// the GUI's twin of the `terminus` column FASTag writes on -resolved_out
// (SPEC.md), used for tables of a FASTag that did not write it and when the
// GUI resolves the tags itself.
//
// A resolved tag's flanks in FASTag's tag convention: nterm_mass F_N and
// cterm_mass F_C, the residue sums before and after it (terminal
// modifications included), with F_N + residues + F_C + H2O = M. One of
// them is measured from the peaks (F_N for a b/c reading, F_C for y/z), the
// other from the precursor.
//
// The flanks are the ones -resolved_out writes, but tested unclamped: a
// flank below 0 (a tag longer than the precursor allows) is at no terminus,
// though the nterm_mass/cterm_mass cells show it as 0.
// - Tolerance: the peaks' side, the fragment tolerance at the tag's low peak
//   times its charge; the precursor's side, that plus the tolerance at the
//   precursor m/z times the precursor charge (as complement pairs and
//   sameAsOf take it), at each precursor isotope offset k x 1.0033548 Da of
//   -isotope_error (the precursor mass lowered by k).
// - Targets: 0, the fixed terminal modification of that side
//   (-fixed_modifications "X (N-term)", "X (C-term)"), and each variable
//   terminal one ("Acetyl (N-term)", "Acetyl (Protein N-term)"), one at a
//   time, never summed.
// - At the terminus: |F - m| <= tol for a target m. Else one residue from
//   it: |F - (m + r)| <= tol for the mass r of one residue of the run
//   (fixed modifications applied, variable residue modifications as
//   X[Name]); several such residues are written as a gap is, [KQ].
//
// The token: N, N+X, C, C+X, the N side first, comma-separated (N,C+K);
// empty when neither side is.

import type { SpectrumPeaks } from './dump'
import type { GPath } from './graph'
import { C_OFFSET, DEFAULT_FIXED, PROTON, WATER, Z_DOT_OFFSET, modDelta, readingMass, type Ladder, type Residues } from './ladder'

export const C13 = 1.0033548

/** One side of a tag: at the terminus ('at'), one residue from it (that
 *  residue, or [KQ] when several fit), or neither (null). */
export type End = 'at' | { away: string } | null
export interface Terminus {
  n: End
  c: End
}
export const NO_TERMINUS: Terminus = { n: null, c: null }

/** What a run knows of its termini and residues, from its parameters. */
export interface TermContext {
  // Target flank masses per side.
  n: number[]
  c: number[]
  // The fixed terminal modification of each side (0 without one).
  fixedN: number
  fixedC: number
  // -isotope_error offsets.
  isotopes: number[]
  // One residue: its label and mass.
  residues: { label: string; mass: number }[]
}

const list = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? [v] : typeof v === 'number' ? [String(v)] : undefined)
const MOD = /^\s*(.+?)\s*\(([^)]*)\)\s*$/

/** The terminal modifications and residues of a run with parameters
 *  @p params (null or missing ones: FASTag's defaults), on @p residues. */
export function termContext(params: Record<string, unknown> | null | undefined, residues: Residues): TermContext {
  const fixed = list(params?.['fixed_modifications']) ?? DEFAULT_FIXED
  const variable = list(params?.['variable_modifications']) ?? []
  let fixedN = 0
  let fixedC = 0
  for (const raw of fixed) {
    const m = MOD.exec(raw)
    const d = m ? modDelta(m[1]) : undefined
    if (!m || d === undefined) continue
    const site = m[2].trim().toLowerCase()
    if (site === 'n-term' || site === 'protein n-term') fixedN += d
    else if (site === 'c-term' || site === 'protein c-term') fixedC += d
  }
  const n = [0, fixedN]
  const c = [0, fixedC]
  const res = Object.entries(residues.masses).map(([label, mass]) => ({ label, mass }))
  for (const raw of variable) {
    const m = MOD.exec(raw)
    const d = m ? modDelta(m[1]) : undefined
    if (!m || d === undefined) continue
    const site = m[2].trim()
    const low = site.toLowerCase()
    if (low === 'n-term' || low === 'protein n-term') n.push(d)
    else if (low === 'c-term' || low === 'protein c-term') c.push(d)
    else if (!/term/i.test(site)) for (const r of site.replace(/\s/g, '')) if (r in residues.masses) res.push({ label: `${r}[${m[1].trim()}]`, mass: residues.masses[r] + d })
  }
  const iso = (list(params?.['isotope_error']) ?? ['0']).flatMap((x) => x.split(/[\s,]+/)).filter(Boolean).map(Number).filter((k) => Number.isInteger(k))
  const uniq = (xs: number[]): number[] => [...new Set(xs)]
  return { n: uniq(n), c: uniq(c), fixedN, fixedC, isotopes: iso.length ? uniq(iso) : [0], residues: res }
}

const tolAt = (s: SpectrumPeaks, x: number): number => (s.toleranceUnit === 'ppm' ? (x * s.tolerance) / 1e6 : s.tolerance)
const nTerminal = (series: Ladder['series']): boolean => series === 'b' || series === 'c'

/** The flanks of @p p as -resolved_out writes them (TagGraph.cpp
 *  appendResolvedRows, clamped at 0 as there); null where unknown (no
 *  precursor, a reading without a mass here). */
export function flanksOf(p: Pick<GPath, 'series' | 'charge' | 'peaks' | 'steps'>, s: SpectrumPeaks, residues: Residues): { n: number | null; c: number | null } {
  const f = rawFlanksOf(p, s, residues)
  const pos = (x: number | null): number | null => (x == null ? null : Math.max(0, x))
  return { n: pos(f.n), c: pos(f.c) }
}

/** The flanks of @p p before the clamp at 0, as terminus() tests them. */
export function rawFlanksOf(p: Pick<GPath, 'series' | 'charge' | 'peaks' | 'steps'>, s: SpectrumPeaks, residues: Residues): { n: number | null; c: number | null } {
  const z = p.charge
  const low = s.mz[p.peaks[0]]
  let cum = 0
  for (const st of p.steps) {
    const m = readingMass(st.readings[0].label, residues)
    if (m == null) return { n: null, c: null }
    cum += m
  }
  const M = s.precursor != null && s.charge > 0 ? s.precursor * s.charge - s.charge * PROTON : null
  if (nTerminal(p.series)) {
    const n = low * z - PROTON * z - (p.series === 'c' ? C_OFFSET : 0)
    return { n, c: M == null ? null : M - n - cum - WATER }
  }
  const offC = p.series === 'z' ? Z_DOT_OFFSET : WATER
  return { c: low * z - PROTON * z - offC, n: M == null ? null : M - (low * z - PROTON * z + cum) - (WATER - offC) }
}

/** Residue labels as a gap's: I and L together, then by letter. */
const labelOf = (xs: string[]): string => {
  const u = [...new Set(xs)].sort((a, b) => a.replace(/I/g, 'L').localeCompare(b.replace(/I/g, 'L')) || a.localeCompare(b))
  return u.length === 1 ? u[0] : `[${u.join('')}]`
}

function endOf(F: number | null, targets: number[], offsets: number[], tol: number, ctx: TermContext): End {
  if (F == null) return null
  const fs = offsets.map((k) => F - k * C13)
  if (fs.some((f) => targets.some((m) => Math.abs(f - m) <= tol))) return 'at'
  const hit = ctx.residues.filter((r) => fs.some((f) => targets.some((m) => Math.abs(f - (m + r.mass)) <= tol))).map((r) => r.label)
  return hit.length ? { away: labelOf(hit) } : null
}

/** Where a tag lies against the peptide's termini, from its flanks (as
 *  TagGraph.cpp terminus() takes them): @p series and fragment @p charge,
 *  its low peak @p lowMz, the flanks @p nterm and @p cterm (null: unknown).
 *  Without a precursor the side from it is not tested. */
export function terminusFromFlanks(series: Ladder['series'], charge: number, lowMz: number, nterm: number | null, cterm: number | null, s: SpectrumPeaks, ctx: TermContext): Terminus {
  const z = charge > 0 ? charge : 1
  const peak = tolAt(s, lowMz) * z
  const havePrec = s.precursor != null && s.charge > 0
  const prec = havePrec ? peak + tolAt(s, s.precursor as number) * s.charge : 0
  const fromPeaksN = nTerminal(series)
  const side = (F: number | null, targets: number[], fromPeaks: boolean): End =>
    !fromPeaks && !havePrec ? null : endOf(F, targets, fromPeaks ? [0] : ctx.isotopes, fromPeaks ? peak : prec, ctx)
  return { n: side(nterm, ctx.n, fromPeaksN), c: side(cterm, ctx.c, !fromPeaksN) }
}

/** Where @p p lies against the peptide's termini on @p s. */
export function terminusOf(p: Pick<GPath, 'series' | 'charge' | 'peaks' | 'steps'>, s: SpectrumPeaks, residues: Residues, ctx: TermContext): Terminus {
  if (p.peaks.length === 0) return NO_TERMINUS
  const f = rawFlanksOf(p, s, residues)
  return terminusFromFlanks(p.series, p.charge, s.mz[p.peaks[0]], f.n, f.c, s, ctx)
}

/** The token of @p t, as the terminus column writes it. */
export function terminusText(t: Terminus): string {
  const one = (side: 'N' | 'C', e: End): string | null => (e === 'at' ? side : e ? `${side}+${e.away}` : null)
  return [one('N', t.n), one('C', t.c)].filter((x) => x != null).join(',')
}

/** A terminus column cell read back; null when it is not one. */
export function parseTerminus(cell: string): Terminus | null {
  const t: Terminus = { n: null, c: null }
  for (const tok of cell.split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = /^([NC])(?:\+(.+))?$/.exec(tok)
    if (!m) return null
    const e: End = m[2] ? { away: m[2] } : 'at'
    if (m[1] === 'N') t.n = e
    else t.c = e
  }
  return t
}

/** The words of one side: "at the peptide N terminus", "one residue (K) from the C terminus". */
export function endWords(side: 'N' | 'C', e: End): string | null {
  return e === 'at' ? `at the peptide ${side} terminus` : e ? `one residue (${e.away}) from the ${side} terminus` : null
}

/** The termini of a sequence as text: N–, –C, N–(K), (K)–C, and in words. */
export function termText(t: Terminus): { pre: string; post: string; words: string } {
  const pre = t.n === 'at' ? 'N–' : t.n ? `N–(${t.n.away})` : ''
  const post = t.c === 'at' ? '–C' : t.c ? `(${t.c.away})–C` : ''
  return { pre, post, words: [endWords('N', t.n), endWords('C', t.c)].filter(Boolean).join('; ') }
}

/** Where the stick plot marks the terminus of @p p read from its peaks: the
 *  b0/c0 (N side of a b/c reading) or y0/z0 (C side of a y/z one) m/z at its
 *  charge, the terminal target its flank matched (0 or a terminal
 *  modification) included. None when that side is not at or one residue
 *  from the terminus, or its flank is not known. */
export function terminusMark(p: Pick<GPath, 'series' | 'charge' | 'peaks' | 'steps'>, t: Terminus, s: SpectrumPeaks, residues: Residues, ctx: TermContext): { mz: number; side: 'N' | 'C'; label: string; words: string; away: boolean } | null {
  const n = nTerminal(p.series)
  const e = n ? t.n : t.c
  if (!e || p.peaks.length === 0) return null
  const f = rawFlanksOf(p, s, residues)
  const F = n ? f.n : f.c
  if (F == null) return null
  const z = p.charge > 0 ? p.charge : 1
  // The target nearest the flank (plus the nearest residue when one away).
  const rs = e === 'at' ? [0] : ctx.residues.map((r) => r.mass)
  let m = 0
  let best = Infinity
  for (const x of n ? ctx.n : ctx.c)
    for (const r of rs) {
      const d = Math.abs(F - x - r)
      if (d < best) [best, m] = [d, x]
    }
  const off = p.series === 'c' ? C_OFFSET : p.series === 'y' ? WATER : p.series === 'z' ? Z_DOT_OFFSET : 0
  const side = n ? 'N' : 'C'
  return { mz: (m + off + z * PROTON) / z, side, label: `${side} ${p.series}0${z > 1 ? ` ${z}+` : ''}`, words: endWords(side, e) ?? '', away: e !== 'at' }
}

/** The terminus of each resolved tag of @p paths: as FASTag wrote it when
 *  its table has the column and the tag is still read in the series FASTag
 *  wrote it for (the peptide can settle another), else computed here. */
export function terminiOf(paths: GPath[], s: SpectrumPeaks, residues: Residues, ctx: TermContext): Terminus[] {
  return paths.map((p) => (p.terminus && p.terminus.series === p.series ? parseTerminus(p.terminus.text) : null) ?? terminusOf(p, s, residues, ctx))
}
