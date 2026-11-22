// overlapping tags on the same peaks merge, contained tags are subsumed.
import { describe, expect, it } from 'vitest'
import { consolidate, packRows, sequenceOf, ladderOf, type TagIn } from './consolidate'
import { PROTON, residueMasses, tagRowFrom } from './ladder'
import type { SpectrumPeaks } from './dump'

const R = residueMasses([]).masses
const N = 100
// b peaks of the N-terminal run P E P T I D E after a 100 Da flank.
const SEQ = 'PEPTIDE'
const b: number[] = [N + PROTON]
for (const r of SEQ) b.push(b[b.length - 1] + R[r])

const spec: SpectrumPeaks = {
  nativeId: 'scan=1', index: 0, msLevel: 2, rt: null, precursor: 1200, charge: 2, chargeGiven: 2,
  tolerance: 10, toleranceUnit: 'ppm', picked: false, deisotoped: true, tagged: true,
  nRead: b.length, mz: b, int: b.map(() => 100)
}
const columns = ['spectrum', 'tag', 'charge', 'nterm_mass', 'cterm_mass', 'gapped', 'evalue']
// A tag of SEQ starting at residue @p at; cterm_mass is not used by the b ladder here.
let n = 0
const tag = (at: number, len: number, evalue: number): TagIn => {
  let flank = N
  for (const r of SEQ.slice(0, at)) flank += R[r]
  return { row: tagRowFrom(columns, ['scan=1', SEQ.slice(at, at + len), '1', String(flank), '5000', '0', String(evalue)])!, evalue, index: n++ }
}

describe('all tags consolidate', () => {
  it('merges overlapping tags, subsumes the contained one, keeps a disjoint one apart', () => {
    n = 0
    const tags = [tag(0, 3, 0.01), tag(2, 3, 0.02), tag(3, 2, 0.5), tag(1, 2, 0.1)]
    const { contigs, offPeaks } = consolidate(tags, spec, residueMasses([]))
    expect(offPeaks).toEqual([])
    expect(contigs).toHaveLength(1)
    expect(sequenceOf(contigs[0])).toBe('PEPTI')
    expect(contigs[0].members.sort()).toEqual([0, 1, 2, 3])
    expect(contigs[0].evalue).toBe(0.01)
  })

  it('tags that only touch at one peak stay apart', () => {
    n = 0
    const { contigs } = consolidate([tag(0, 2, 0.01), tag(2, 3, 0.02)], spec, residueMasses([]))
    expect(contigs.map(sequenceOf)).toEqual(['PE', 'PTI'])
  })

  it('a tag off the peaks is reported, not merged', () => {
    n = 0
    const off = tag(0, 3, 0.01)
    off.row.ntermMass += 3
    const { contigs, offPeaks } = consolidate([off, tag(2, 3, 0.02)], spec, residueMasses([]))
    expect(offPeaks).toEqual([0])
    expect(contigs).toHaveLength(1)
  })

  it('packs disjoint lines into one row, overlapping ones into two', () => {
    n = 0
    const { contigs } = consolidate([tag(0, 2, 0.01), tag(2, 3, 0.02)], spec, residueMasses([]))
    const lines = contigs.map(ladderOf)
    expect(packRows(lines, 1).count).toBe(2) // they share the peak at P(3)
    expect(packRows(lines, -1e9).count).toBe(1)
  })
})
