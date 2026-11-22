// All tags of a spectrum at once: the tags that lie on the same peaks
// of the same series are one path through the spectrum graph, so they are
// merged into one longer tag (a contig), and a tag that lies wholly inside
// another is subsumed by it and not drawn on its own.
//
// Each tag is placed by its ladder (ladder.ts: the series it lies on). Two
// tags merge when they share at least one residue step: the same two peaks,
// the same residue (I and L alike), and agree wherever they overlap. Tags
// that only touch at one peak stay apart (ponytail: joining there would be de
// novo sequencing, not merging; add it as an option if it is wanted).
// Tags are taken by E-value, best first, so a contig is grown from its best
// tag.

import type { SpectrumPeaks } from './dump'
import { laddersFor, type Ladder, type LadderPosition, type Residues, type TagRow } from './ladder'

export interface TagIn {
  row: TagRow
  evalue: number
  // The tag's index in the spectrum's tags.
  index: number
}

export interface Contig {
  series: Ladder['series']
  charge: number
  // In ascending m/z; residues[k] lies between positions k and k + 1.
  positions: LadderPosition[]
  residues: string[]
  // The merged tags (indices of TagIn.index), best E-value first.
  members: number[]
  // The best E-value of its members.
  evalue: number
}

export interface Consolidated {
  contigs: Contig[]
  // Tags whose ladder is not on the peaks: neither merged nor drawn.
  offPeaks: number[]
}

const node = (p: LadderPosition): string => (p.peak != null ? `p${p.peak}` : `x${p.expected.toFixed(3)}`)
const same = (a: string, b: string): boolean => a.replace(/I/g, 'L') === b.replace(/I/g, 'L')

/** @p d merged into @p c, or null when they do not share a step or disagree. */
export function merge(c: Contig, d: Contig): Contig | null {
  if (c.series !== d.series || c.charge !== d.charge) return null
  const cn = c.positions.map(node)
  const dn = d.positions.map(node)
  const first = dn.findIndex((k) => cn.includes(k))
  if (first < 0) return null
  const shift = cn.indexOf(dn[first]) - first
  let shared = 0
  for (let k = 0; k < dn.length; k++) {
    const i = k + shift
    if (i < 0 || i >= cn.length) continue
    if (cn[i] !== dn[k]) return null
    if (k + 1 < dn.length && i + 1 < cn.length) {
      if (!same(c.residues[i], d.residues[k])) return null
      shared++
    }
  }
  if (shared === 0) return null
  const start = Math.min(0, shift)
  const end = Math.max(cn.length, dn.length + shift)
  const positions: LadderPosition[] = []
  const residues: string[] = []
  for (let i = start; i < end; i++) {
    positions.push(i >= 0 && i < cn.length ? c.positions[i] : d.positions[i - shift])
    if (i + 1 < end) residues.push(i >= 0 && i + 1 < cn.length ? c.residues[i] : d.residues[i - shift])
  }
  const members = [...c.members, ...d.members]
  return { series: c.series, charge: c.charge, positions, residues, members, evalue: Math.min(c.evalue, d.evalue) }
}

/** The contigs of @p tags on the peaks of @p s. */
export function consolidate(tags: TagIn[], s: SpectrumPeaks, residues: Residues): Consolidated {
  const offPeaks: number[] = []
  let contigs: Contig[] = []
  for (const t of [...tags].sort((a, b) => a.evalue - b.evalue)) {
    const l = laddersFor(t.row, s, residues).best
    if (!l.complete) {
      offPeaks.push(t.index)
      continue
    }
    let cur: Contig = { series: l.series, charge: l.charge, positions: l.positions, residues: l.residues, members: [t.index], evalue: t.evalue }
    // Absorb every contig it now bridges.
    for (;;) {
      const rest: Contig[] = []
      let grew = false
      for (const c of contigs) {
        const m = merge(c, cur)
        if (m) {
          cur = m
          grew = true
        } else rest.push(c)
      }
      contigs = rest
      if (!grew) break
    }
    contigs.push(cur)
  }
  contigs.sort((a, b) => a.evalue - b.evalue || b.residues.length - a.residues.length)
  return { contigs, offPeaks }
}

/** A contig's residues from N to C terminus. */
export const sequenceOf = (c: Contig): string => (c.series === 'b' || c.series === 'c' ? c.residues : [...c.residues].reverse()).join('')

/** A contig as a ladder, for the plot. */
export const ladderOf = (c: Contig): Ladder => ({
  series: c.series,
  charge: c.charge,
  positions: c.positions,
  residues: c.residues,
  matched: c.positions.filter((p) => p.peak != null).length,
  complete: true
})

/** One plot row per line, N-terminal series above C-terminal: lines that do
 *  not overlap in m/z share a row. */
export function packRows(lines: Ladder[], gap: number): { rows: number[]; count: number } {
  const span = (l: Ladder): [number, number] => {
    const xs = l.positions.map((p) => p.mz ?? p.expected)
    return [Math.min(...xs), Math.max(...xs)]
  }
  const rows = new Array<number>(lines.length).fill(0)
  let base = 0
  for (const side of [['b', 'c'], ['y', 'z']]) {
    const ends: number[] = []
    const ids = lines.map((l, i) => i).filter((i) => side.includes(lines[i].series)).sort((a, b) => span(lines[a])[0] - span(lines[b])[0])
    for (const i of ids) {
      const [a, b] = span(lines[i])
      let r = ends.findIndex((e) => e + gap < a)
      if (r < 0) r = ends.push(b) - 1
      else ends[r] = b
      rows[i] = base + r
    }
    base += ends.length
  }
  return { rows, count: base }
}
