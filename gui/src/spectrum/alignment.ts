// The tags of one spectrum on the database protein they hit uniquely
// (-fasta_proteins: db_protein_count 1), for the Spectrum tab's alignment
// block. Pure layout: which tags go on which protein, the stretch of the
// protein to read (fasta.rs fasta_segment), and each tag's residues under it.
//
// A tag that hits several proteins is not aligned: it is listed with its
// count. Entrapment matches (efwd, erev) are aligned on the entrapment
// protein, in a block of their own, never as a target.

import { dbCellsOf } from '../results/dbProteins'
import { residueMasses } from './ladder'

export interface AlignedTag {
  // Index into the spectrum's tag rows.
  row: number
  // The tag as written, and its residues as the database reads them (the
  // tag reversed for a rev or erev match).
  tag: string
  residues: string
  reversed: boolean
  start: number
  end: number
}

export interface ProteinBlock {
  id: string
  accession: string
  gene: string | null
  entrapment: boolean
  tags: AlignedTag[]
  // The span of every tag on it (1-based, inclusive).
  start: number
  end: number
}

export interface Unaligned {
  row: number
  tag: string
  // The proteins it hits (db_protein_count).
  count: number
}

export interface Alignments {
  blocks: ProteinBlock[]
  // Tags with a database hit on several proteins.
  several: Unaligned[]
}

/** A tag's residues without modifications: C(Carbamidomethyl) and M[+15.995]
 *  are C and M. */
export const residuesOf = (tag: string): string => tag.replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/[^A-Za-z]/g, '').toUpperCase()

const HITS = new Set(['fwd', 'rev', 'efwd', 'erev'])

/** The blocks of the spectrum's tag @p rows under @p columns: one per
 *  protein a tag hits uniquely, the protein with the most tags first (then
 *  the earlier tag); null when the file has no db_proteins column. */
export function alignmentsOf(columns: readonly string[], rows: readonly (readonly string[])[]): Alignments | null {
  if (!columns.includes('db_proteins')) return null
  const ti = columns.indexOf('tag')
  const hi = columns.indexOf('fasta_hit')
  const byKey = new Map<string, ProteinBlock>()
  const several: Unaligned[] = []
  rows.forEach((r, row) => {
    const hit = r[hi] ?? '-'
    if (!HITS.has(hit)) return
    const cells = dbCellsOf(columns, r)
    if (!cells || cells.count === 0 || cells.proteins.length === 0) return
    const tag = r[ti] ?? ''
    if (cells.count > 1) {
      several.push({ row, tag, count: cells.count })
      return
    }
    const p = cells.proteins[0]
    const entrapment = hit === 'efwd' || hit === 'erev'
    const reversed = hit === 'rev' || hit === 'erev'
    const res = residuesOf(tag)
    const key = `${entrapment ? 'e' : 't'}\u0000${p.id}`
    let b = byKey.get(key)
    if (!b) {
      b = { id: p.id, accession: p.accession, gene: p.gene, entrapment, tags: [], start: p.start, end: p.end }
      byKey.set(key, b)
    }
    b.tags.push({ row, tag, residues: reversed ? [...res].reverse().join('') : res, reversed, start: p.start, end: p.end })
    b.start = Math.min(b.start, p.start)
    b.end = Math.max(b.end, p.end)
  })
  const blocks = [...byKey.values()]
  for (const b of blocks) b.tags.sort((x, y) => x.start - y.start || x.row - y.row)
  // Targets before entrapment, then by tags, then by first tag.
  blocks.sort((x, y) => Number(x.entrapment) - Number(y.entrapment) || y.tags.length - x.tags.length || Math.min(...x.tags.map((t) => t.row)) - Math.min(...y.tags.map((t) => t.row)))
  return { blocks, several }
}

/// Residues read either side of the tags to find the peptide's ends.
export const READ_FLANK = 30
/// Residues shown either side when the peptide's ends are not clear.
export const PLAIN_FLANK = 5
/// Residues shown outside the peptide.
export const PEPTIDE_FLANK = 3
/// The longest stretch between the tags and a K or R still read as the
/// peptide's end: farther, the cleavage is not clear.
export const MAX_TRYPTIC_REACH = 25

/** The stretch of the protein to read for @p b. */
export const readRange = (b: { start: number; end: number }): [number, number] => [Math.max(1, b.start - READ_FLANK), b.end + READ_FLANK]

export interface Layout {
  // The residues shown, 1-based, inclusive, and their letters.
  from: number
  to: number
  sequence: string
  // The peptide region a tryptic cleavage implies, or null when not clear.
  peptide: [number, number] | null
  // For each tag: one cell per residue shown, its letter or '' outside the
  // tag, and whether the letter differs from the protein's (I and L alike).
  // placed false: the tag's residues cannot be put on the protein's for this
  // run (an isobaric reading the run's rules do not give, or rules that are
  // not known here); its cells carry no letters and `span` marks start..end.
  lines: { tag: AlignedTag; placed: boolean; cells: { ch: string; diff: boolean; span?: boolean }[] }[]
}

const fold = (a: string): string => (a === 'I' ? 'L' : a)
const same = (a: string, b: string): boolean => fold(a) === fold(b)

/** The block @p b laid out on @p seg, residues @p segStart.. of a protein
 *  of @p length residues (fasta_segment's answer to readRange). The peptide
 *  runs from after the last K or R before the tags (or the protein's start)
 *  to the first K or R at or after their end (or the protein's end), each
 *  within MAX_TRYPTIC_REACH; it is shown with PEPTIDE_FLANK residues either
 *  side, otherwise the tags with PLAIN_FLANK. @p ctx holds the run's
 *  isobaric rules (placementContext); null: they are not known, and only
 *  tags that read the protein letter for letter get their letters. */
export function layout(b: ProteinBlock, seg: string, segStart: number, length: number, ctx: PlacementContext | null): Layout {
  const at = (pos: number): string => seg[pos - segStart] ?? ''
  const segEnd = segStart + seg.length - 1
  let left: number | null = null
  for (let p = b.start - 1; p >= Math.max(segStart, b.start - MAX_TRYPTIC_REACH); p--) {
    if (at(p) === 'K' || at(p) === 'R') {
      left = p + 1
      break
    }
  }
  if (left == null && b.start - 1 <= MAX_TRYPTIC_REACH && segStart === 1) left = 1
  let right: number | null = null
  for (let p = b.end; p <= Math.min(segEnd, b.end + MAX_TRYPTIC_REACH); p++) {
    if (at(p) === 'K' || at(p) === 'R') {
      right = p
      break
    }
  }
  if (right == null && length - b.end <= MAX_TRYPTIC_REACH && segEnd >= length) right = length
  const peptide: [number, number] | null = left != null && right != null ? [left, right] : null
  const lo = peptide ? peptide[0] - PEPTIDE_FLANK : b.start - PLAIN_FLANK
  const hi = peptide ? peptide[1] + PEPTIDE_FLANK : b.end + PLAIN_FLANK
  const from = Math.max(segStart, 1, lo)
  const to = Math.min(segEnd, length, hi)
  const sequence = seg.slice(from - segStart, to - segStart + 1)
  const lines = b.tags.map((tag) => {
    const cells: { ch: string; diff: boolean; span?: boolean }[] = [...sequence].map(() => ({ ch: '', diff: false }))
    const lo = Math.max(tag.start, from)
    const hi = Math.min(tag.end, to)
    const own = sequence.slice(lo - from, hi - from + 1)
    const inside = tag.start >= from && tag.end <= to
    const equal = tag.residues.length === tag.end - tag.start + 1
    // Letter for letter: no rule reading needed, whatever the rules are.
    const literal = inside && equal && [...tag.residues].every((c, k) => same(c, own[k]))
    const placed = literal
      ? [...tag.residues].map((ch) => ({ ch, diff: false }))
      : inside && ctx
        ? placeTag(tag.residues, own, ctx.rules)
        : null
    if (placed) {
      placed.forEach((c, k) => (cells[tag.start - from + k] = c))
      return { tag, placed: true, cells }
    }
    if (ctx && ctx.rules.length > 0 && equal) {
      // The run's rules give no reading, yet the tag spans its residues one
      // to one: each letter on its residue, the differing ones marked. Not
      // at -isobaric_tolerance 0: the CLI then matched exact strings only, so
      // a differing letter is a reading this run cannot have made.
      for (let pos = lo; pos <= hi; pos++) {
        const ch = tag.residues[pos - tag.start] ?? ''
        cells[pos - from] = { ch, diff: ch !== '' && !same(ch, sequence[pos - from]) }
      }
      return { tag, placed: true, cells }
    }
    // The placement of the residues cannot be reconstructed: the span only.
    for (let pos = lo; pos <= hi; pos++) cells[pos - from] = { ch: '', diff: false, span: true }
    return { tag, placed: false, cells }
  })
  return { from, to, sequence, peptide, lines }
}

/** A residue that a residue pair of the same mass stands for (and back):
 *  m(one) = m(a) + m(b) within the run's -isobaric_tolerance. */
export interface CollapseRule {
  a: string
  b: string
  one: string
}

/// The CLI's -isobaric_tolerance default.
export const ISOBARIC_TOL = 0.04

// OpenMS "Natural19WithoutI", sorted by letter (ResidueFold.h sorts its table).
const NATURAL19 = 'ACDEFGHKLMNPQRSTVWY'

/** The CLI's isobaric rules (ResidueFold.h deriveCollapseRules, ported):
 *  every (a, b, one) over the 19 residues without I, under the residue
 *  @p masses of the run's fixed modifications, with |m(one) - (m(a) + m(b))|
 *  <= @p tol; in the CLI's order. None at @p tol <= 0 (ProteomeIndex.cpp
 *  derives rules only for a positive tolerance). */
export function collapseRules(tol: number, masses: Record<string, number>): CollapseRule[] {
  const rules: CollapseRule[] = []
  if (!(tol > 0)) return rules
  const R = [...NATURAL19].map((c) => [c, masses[c]] as const)
  for (const [one, mo] of R) for (const [a, ma] of R) for (const [b, mb] of R) if (Math.abs(mo - (ma + mb)) <= tol) rules.push({ a, b, one })
  return rules
}

export interface PlacementContext {
  rules: CollapseRule[]
}

/** The isobaric rules of the run given @p params (its -fixed_modifications
 *  and -isobaric_tolerance, the CLI defaults where a key is absent); null
 *  when they cannot be known here: no params, a fixed modification whose
 *  mass is not known, or a tolerance that is not a number >= 0. */
export function placementContext(params: Record<string, unknown> | null | undefined): PlacementContext | null {
  if (!params) return null
  const f = params['fixed_modifications']
  let fixed: string[] | undefined
  if (f === undefined) fixed = undefined
  else if (Array.isArray(f)) fixed = f.map(String)
  else if (typeof f === 'string') fixed = [f]
  else return null
  const res = residueMasses(fixed)
  if (res.unknownFixed.length > 0) return null
  const t = params['isobaric_tolerance']
  let tol: number
  if (t === undefined) tol = ISOBARIC_TOL
  else if (typeof t === 'number') tol = t
  else if (typeof t === 'string' && t.trim() !== '') tol = Number(t)
  else return null
  if (!Number.isFinite(tol) || tol < 0) return null
  return { rules: collapseRules(tol, res.masses) }
}

/** The tag @p residues on the protein residues @p prot it matched (the same
 *  stretch, db_proteins start..end), under the run's isobaric @p rules: one
 *  cell per protein residue. A letter the protein has sits on it; a tag
 *  letter that a rule gives for the protein residue pair sits on the first
 *  of the two, and both are marked; a tag letter pair that a rule gives for
 *  one protein residue shares its cell, marked. I and L are one. Null when
 *  no such reading exists. */
export function placeTag(residues: string, prot: string, rules: readonly CollapseRule[]): { ch: string; diff: boolean }[] | null {
  const rule = new Set(rules.map((r) => `${r.a}${r.b}${r.one}`))
  const has = (a: string, b: string, one: string): boolean => rule.has(`${fold(a)}${fold(b)}${fold(one)}`)
  const seen = new Set<string>()
  const go = (i: number, j: number): { ch: string; diff: boolean }[] | null => {
    if (i === residues.length && j === prot.length) return []
    if (i >= residues.length || j >= prot.length || seen.has(`${i},${j}`)) return null
    seen.add(`${i},${j}`)
    const t = residues[i]
    if (same(t, prot[j])) {
      const r = go(i + 1, j + 1)
      if (r) return [{ ch: t, diff: false }, ...r]
    }
    if (j + 1 < prot.length && has(prot[j], prot[j + 1], t)) {
      const r = go(i + 1, j + 2)
      if (r) return [{ ch: t, diff: true }, { ch: '', diff: true }, ...r]
    }
    if (i + 1 < residues.length && has(t, residues[i + 1], prot[j])) {
      const r = go(i + 2, j + 1)
      if (r) return [{ ch: t + residues[i + 1], diff: true }, ...r]
    }
    return null
  }
  return go(0, 0)
}
