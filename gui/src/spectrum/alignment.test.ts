// The alignment of a spectrum's tags on the protein they hit uniquely:
// grouping, the stretch read, the peptide's ends, each tag's residues.

// @ts-ignore -- node built-in; the app's tsconfig has no node types
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { alignmentsOf, collapseRules, layout, placementContext, readRange, residuesOf, PLAIN_FLANK, PEPTIDE_FLANK, type CollapseRule } from './alignment'
import { residueMasses } from './ladder'

const COLS = ['spectrum', 'tag', 'fasta_hit', 'db_proteins', 'db_genes', 'db_protein_count']
const row = (tag: string, hit: string, prot: string, count = '1', gene = '-'): string[] => ['s', tag, hit, prot, gene, count]

// A protein of 40 residues: a tryptic peptide GEWLTDYAPK (11..20) after K10.
//            1         11        21        31
const PROT = 'MSAQLDGTRK' + 'GEWLTDYAPK' + 'VNESHMAGGC' + 'QWERTYAAAA'

// A run at the CLI defaults (Carbamidomethyl (C), -isobaric_tolerance 0.04).
const DEF = placementContext({})

describe('alignment layout', () => {
  it('groups the uniquely hitting tags by protein, most tags first; several-protein tags are only named', () => {
    const rows = [
      row('WLTD', 'fwd', 'P1@13-16'),
      row('EWL', 'fwd', 'P1@12-14'),
      row('AAAA', 'fwd', 'P2@37-40', '1', 'abc'),
      row('YAP', 'fwd', 'P1@17-19;P3@4-6', '2'),
      row('DTLW', 'efwd', 'E1@3-6'),
      row('XX', '-', '-', '0')
    ]
    const al = alignmentsOf(COLS, rows)!
    expect(al.blocks.map((b) => [b.id, b.entrapment, b.tags.map((t) => t.tag), b.start, b.end])).toEqual([
      ['P1', false, ['EWL', 'WLTD'], 12, 16],
      ['P2', false, ['AAAA'], 37, 40],
      ['E1', true, ['DTLW'], 3, 6]
    ])
    expect(al.blocks[1].gene).toBe('abc')
    expect(al.several).toEqual([{ row: 3, tag: 'YAP', count: 2 }])
    expect(alignmentsOf(['tag', 'fasta_hit'], [['A', 'fwd']])).toBeNull()
  })

  it('reads 30 residues either side and shows the tryptic peptide with 3 residues of flank', () => {
    const b = alignmentsOf(COLS, [row('WLTD', 'fwd', 'P1@13-16'), row('EWL', 'fwd', 'P1@12-14')])!.blocks[0]
    expect(readRange(b)).toEqual([1, 46])
    const l = layout(b, PROT, 1, PROT.length, DEF)
    expect(l.peptide).toEqual([11, 20])
    expect([l.from, l.to]).toEqual([11 - PEPTIDE_FLANK, 20 + PEPTIDE_FLANK])
    expect(l.sequence).toBe(PROT.slice(7, 23))
    // Each tag under its residues, nothing elsewhere.
    const line = (k: number): string => l.lines[k].cells.map((c) => c.ch || '.').join('')
    expect(line(0)).toBe('....EWL.........')
    expect(line(1)).toBe('.....WLTD.......')
    expect(l.lines.flatMap((x) => x.cells).some((c) => c.diff)).toBe(false)
  })

  it('draws a reversed match as the database reads it, and marks it', () => {
    const b = alignmentsOf(COLS, [row('DTLW', 'rev', 'P1@13-16')])!.blocks[0]
    expect(b.tags[0]).toMatchObject({ reversed: true, residues: 'WLTD' })
    const l = layout(b, PROT, 1, PROT.length, DEF)
    expect(l.lines[0].cells.filter((c) => c.ch).map((c) => c.ch).join('')).toBe('WLTD')
  })

  it('without a K or R near the tags: 5 residues either side, no peptide', () => {
    // A segment read from residue 20 (no protein start in it) without K/R
    // near the tag at 30..33.
    const seg = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    const b = alignmentsOf(COLS, [row('AAAA', 'fwd', 'P@30-33')])!.blocks[0]
    const l = layout(b, seg, 20, 200, DEF)
    expect(l.peptide).toBeNull()
    expect([l.from, l.to]).toEqual([30 - PLAIN_FLANK, 33 + PLAIN_FLANK])
  })

  it('the protein start and end count as the peptide ends; the shown stretch stays in the protein', () => {
    const b = alignmentsOf(COLS, [row('MSAQ', 'fwd', 'P1@1-4'), row('AAAA', 'fwd', 'P1@37-40')])!.blocks[0]
    const l = layout(b, PROT, 1, PROT.length, DEF)
    expect(l.peptide).toEqual([1, 40])
    expect([l.from, l.to]).toEqual([1, 40])
  })

  it('a respelled match (a residue pair of the same mass) is marked where it differs', () => {
    // GA stands for Q (and the reverse): the tag spans one residue more.
    const b = alignmentsOf(COLS, [row('GEWQ', 'fwd', 'P1@11-14')])!.blocks[0]
    const l = layout(b, PROT, 1, PROT.length, DEF)
    const cells = l.lines[0].cells.filter((c) => c.ch)
    expect(cells.map((c) => [c.ch, c.diff])).toEqual([['G', false], ['E', false], ['W', false], ['Q', true]])
  })

  it('a tag one residue shorter or longer than its range keeps each letter on its own residues', () => {
    // Residues 5..11 of the protein are G A W D T L N. The tag QWDTLGG matched
    // them with Q for the pair GA and the pair GG for N (same mass).
    //            123456789012
    const prot = 'MKRSGAWDTLNK'
    const b = alignmentsOf(COLS, [row('QWDTLGG', 'fwd', 'P@5-11')])!.blocks[0]
    const l = layout(b, prot, 1, prot.length, DEF)
    const cells = l.lines[0].cells.slice(5 - l.from, 11 - l.from + 1)
    expect(cells.map((c) => [c.ch, c.diff])).toEqual([
      ['Q', true], ['', true], // Q on G A
      ['W', false], ['D', false], ['T', false], ['L', false],
      ['GG', true] // GG on N
    ])
    // Nothing of the tag spills past its range.
    expect(l.lines[0].cells.slice(11 - l.from + 1).every((c) => !c.ch)).toBe(true)
  })

  it('reads modifications off a tag', () => {
    expect(residuesOf('PEC(Carbamidomethyl)M[+15.9949]K')).toBe('PECMK')
  })
})

describe('alignment of a real run (FASTag -fasta -fasta_proteins 3)', () => {
  const lines: string[] = readFileSync(`src/fixtures/cli-dev/ecoli-fasta-proteins/run01.tags.tsv`, 'utf8').trimEnd().split('\n')
  const columns = lines[0].split('\t')
  const rows = lines.slice(1).map((l) => l.split('\t'))
  const fasta = new Map<string, string>()
  let id = ''
  for (const l of readFileSync(`../examples/Ecoli_MS2_small.fasta`, 'utf8').split(/\r?\n/) as string[]) {
    if (l.startsWith('>')) fasta.set((id = l.slice(1).split(/\s/)[0]), '')
    else if (id) fasta.set(id, fasta.get(id)! + l.replace(/[^A-Za-z]/g, '').toUpperCase())
  }

  it('scan 11539: forward and reversed tags on one protein, each under the residues it matches', () => {
    const mine = rows.filter((r) => r[0].endsWith('scan=11539'))
    const al = alignmentsOf(columns, mine)!
    expect(al.blocks).toHaveLength(1)
    const b = al.blocks[0]
    expect(b.id).toBe('VIMSS17368')
    expect(b.tags.some((t) => t.reversed) && b.tags.some((t) => !t.reversed)).toBe(true)
    const seq = fasta.get(b.id)!
    const [from, to] = readRange(b)
    const l = layout(b, seq.slice(from - 1, to), from, seq.length, DEF)
    // Every tag of equal length sits on the protein's own residues.
    for (const { tag, cells } of l.lines) {
      if (tag.end - tag.start + 1 !== tag.residues.length) continue
      expect(cells.some((c) => c.diff), tag.tag).toBe(false)
      expect(cells.filter((c) => c.ch).map((c) => c.ch).join('').replace(/I/g, 'L')).toBe(seq.slice(tag.start - 1, tag.end).replace(/I/g, 'L'))
    }
    // The respelled ones too (three of the four): every unmarked letter is the
    // protein's own residue at that place, and the tag ends on its range's end
    // (DGWAQKT on DGWAQAGT: K for AG; ATQQAWGW reversed: W for AD, Q for AG).
    expect(l.lines.filter(({ tag }) => tag.end - tag.start + 1 !== tag.residues.length)).toHaveLength(3)
    for (const { tag, cells } of l.lines) {
      const mine = cells.slice(tag.start - l.from, tag.end - l.from + 1)
      mine.forEach((c, k) => {
        if (!c.diff) expect(c.ch.replace(/I/g, 'L'), `${tag.tag} at ${tag.start + k}`).toBe(seq[tag.start - 1 + k].replace(/I/g, 'L'))
      })
      expect(mine.filter((c) => c.diff && c.ch).length, tag.tag).toBeLessThanOrEqual(2)
      expect(mine[mine.length - 1].ch, tag.tag).not.toBe('')
      expect(mine.map((c) => c.ch).join(''), tag.tag).toBe(tag.residues)
    }
  })
})

const rulesText = (rules: readonly CollapseRule[]): string[] => rules.map((r) => `${r.one}=${r.a}${r.b}`)
const letters = (cells: { ch: string }[]): string => cells.map((c) => c.ch || '.').join('')

describe('alignment under the run\'s isobaric rules (ResidueFold.h)', () => {
  // AKLE matched AGVLE (4..8) in a run with Dimethyl (K) fixed: K is then
  // 156.126 Da, 0.036 Da from G + V, so the CLI reads K for GV.
  //                 123456789012
  const protDm = 'MSRAGVLEPKWE'
  const dmBlock = () => alignmentsOf(COLS, [row('AKLE', 'fwd', 'P@4-8')])!.blocks[0]
  const DM = placementContext({ fixed_modifications: ['Carbamidomethyl (C)', 'Dimethyl (K)'], isobaric_tolerance: '0.04' })

  it('the default rules are the ones ResidueFold.h documents', () => {
    // ResidueFold.h: at 0.04 Da, N=GG, Q=GA/AG, K=GA/AG, R=GV/VG,
    // W=AD/DA/GE/EG/SV/VS; in the CLI's order (the residue table sorted).
    expect(rulesText(collapseRules(0.04, residueMasses(undefined).masses))).toEqual([
      'K=AG', 'K=GA', 'N=GG', 'Q=AG', 'Q=GA', 'R=GV', 'R=VG', 'W=AD', 'W=DA', 'W=EG', 'W=GE', 'W=SV', 'W=VS'
    ])
    expect(rulesText(DEF!.rules)).toEqual(rulesText(collapseRules(0.04, residueMasses(undefined).masses)))
  })

  it('the fixed modifications shift the rules as in the CLI, and tolerance 0 has none', () => {
    // The counts the CLI logs ("Filter: ... N isobaric rules") on
    // examples/Ecoli_MS2_small with -fasta: 13 at the defaults, 13 with
    // Dimethyl (K) (K=GV/VG for K=GA/AG), 15 with Acetyl (K) (K=GL/LG/AV/VA),
    // 0 at -isobaric_tolerance 0.
    const dm = rulesText(DM!.rules)
    expect(dm).toHaveLength(13)
    expect(dm).toEqual(expect.arrayContaining(['K=GV', 'K=VG']))
    expect(dm).not.toContain('K=GA')
    const ac = rulesText(placementContext({ fixed_modifications: ['Carbamidomethyl (C)', 'Acetyl (K)'] })!.rules)
    expect(ac).toHaveLength(15)
    expect(ac.filter((r) => r.startsWith('K='))).toEqual(['K=AV', 'K=GL', 'K=LG', 'K=VA'])
    expect(placementContext({ isobaric_tolerance: '0' })!.rules).toEqual([])
    expect(placementContext({ isobaric_tolerance: 0 })!.rules).toEqual([])
    expect(collapseRules(0, residueMasses(undefined).masses)).toEqual([])
    // Exactly the tolerance, no slack: K - (G + A) is 0.03638 Da.
    expect(rulesText(collapseRules(0.0363, residueMasses(undefined).masses))).not.toContain('K=GA')
    expect(rulesText(collapseRules(0.0364, residueMasses(undefined).masses))).toContain('K=GA')
  })

  it('a tag K on GV with Dimethyl (K) fixed sits on G, marks G and V, and keeps the rest on their residues', () => {
    const l = layout(dmBlock(), protDm, 1, protDm.length, DM)
    const line = l.lines[0]
    expect(line.placed).toBe(true)
    const mine = line.cells.slice(4 - l.from, 8 - l.from + 1)
    expect(mine.map((c) => [c.ch, c.diff])).toEqual([['A', false], ['K', true], ['', true], ['L', false], ['E', false]])
    expect(line.cells.every((c) => !c.span)).toBe(true)
  })

  it('the same tag under the default rules shows its positions only, no letter shifted', () => {
    const l = layout(dmBlock(), protDm, 1, protDm.length, DEF)
    const line = l.lines[0]
    expect(line.placed).toBe(false)
    expect(line.cells.every((c) => c.ch === '' && !c.diff)).toBe(true)
    expect(line.cells.map((c, k) => (c.span ? l.from + k : 0)).filter(Boolean)).toEqual([4, 5, 6, 7, 8])
  })

  it('at -isobaric_tolerance 0 a respelled match has no reading and shows its positions only', () => {
    for (const isobaric_tolerance of ['0', 0]) {
      const ctx = placementContext({ isobaric_tolerance })
      const q = layout(alignmentsOf(COLS, [row('GEWQ', 'fwd', 'P1@11-14')])!.blocks[0], PROT, 1, PROT.length, ctx)
      expect(q.lines[0].placed).toBe(false)
      expect(letters(q.lines[0].cells)).not.toMatch(/[A-Z]/)
      const prot = 'MKRSGAWDTLNK'
      const g = layout(alignmentsOf(COLS, [row('QWDTLGG', 'fwd', 'P@5-11')])!.blocks[0], prot, 1, prot.length, ctx)
      expect(g.lines[0].placed).toBe(false)
      expect(letters(g.lines[0].cells)).not.toMatch(/[A-Z]/)
      // A tag that reads the protein letter for letter needs no rule.
      const w = layout(alignmentsOf(COLS, [row('WLTD', 'fwd', 'P1@13-16')])!.blocks[0], PROT, 1, PROT.length, ctx)
      expect(w.lines[0].placed).toBe(true)
      expect(letters(w.lines[0].cells).replace(/\./g, '')).toBe('WLTD')
    }
  })

  it('an unknown fixed modification, no params or a bad tolerance: positions only', () => {
    expect(placementContext({ fixed_modifications: ['Carbamidomethyl (C)', 'Mystery (K)'] })).toBeNull()
    expect(placementContext(null)).toBeNull()
    expect(placementContext({ isobaric_tolerance: 'abc' })).toBeNull()
    expect(placementContext({ isobaric_tolerance: -1 })).toBeNull()
    expect(placementContext({ isobaric_tolerance: '' })).toBeNull()
    expect(rulesText(placementContext({ isobaric_tolerance: '0.04' })!.rules)).toEqual(rulesText(DEF!.rules))
    const prot = 'MKRSGAWDTLNK'
    for (const ctx of [placementContext({ fixed_modifications: ['Mystery (K)'] }), placementContext(null)]) {
      const a = layout(dmBlock(), protDm, 1, protDm.length, ctx)
      expect(a.lines[0].placed).toBe(false)
      expect(letters(a.lines[0].cells)).not.toMatch(/[A-Z]/)
      const g = layout(alignmentsOf(COLS, [row('QWDTLGG', 'fwd', 'P@5-11')])!.blocks[0], prot, 1, prot.length, ctx)
      expect(g.lines[0].placed).toBe(false)
      expect(letters(g.lines[0].cells)).not.toMatch(/[A-Z]/)
      expect(g.lines[0].cells.filter((c) => c.span)).toHaveLength(7)
    }
  })
})

describe('alignment of a real run with Dimethyl (K) fixed (FASTag -fasta -fasta_proteins 3)', () => {
  const dir = 'src/fixtures/cli-dev/ecoli-dimethyl-k'
  const lines: string[] = readFileSync(`${dir}/run01.tags.tsv`, 'utf8').trimEnd().split('\n')
  const columns = lines[0].split('\t')
  const rows = lines.slice(1).map((l) => l.split('\t'))
  const fasta = new Map<string, string>()
  let id = ''
  for (const l of readFileSync(`${dir}/ecoli.fasta`, 'utf8').split(/\r?\n/) as string[]) {
    if (l.startsWith('>')) fasta.set((id = l.slice(1).split(/\s/)[0]), '')
    else if (id) fasta.set(id, fasta.get(id)! + l.replace(/[^A-Za-z]/g, '').toUpperCase())
  }
  const params = { fixed_modifications: ['Carbamidomethyl (C)', 'Dimethyl (K)'] }
  const laid = (ctx: ReturnType<typeof placementContext>) => {
    const spectra = new Map<string, string[][]>()
    for (const r of rows) spectra.set(r[0], [...(spectra.get(r[0]) ?? []), r])
    return [...spectra.entries()].flatMap(([spectrum, rs]) =>
      alignmentsOf(columns, rs)!.blocks.flatMap((b) => {
        const seq = fasta.get(b.id)!
        const [from, to] = readRange(b)
        const l = layout(b, seq.slice(from - 1, to), from, seq.length, ctx)
        return l.lines.map((x) => ({ ...x, spectrum, seq, from: l.from }))
      })
    )
  }

  it('derives as many isobaric rules as the run logged', () => {
    const log = readFileSync(`${dir}/run01.stdout`, 'utf8') as string
    const n = Number(/(\d+) isobaric rules/.exec(log)![1])
    expect(placementContext(params)!.rules).toHaveLength(n)
  })

  it('puts every tag on its residues, K on GV included; the default rules cannot', () => {
    const all = laid(placementContext(params))
    expect(all.length).toBeGreaterThan(50)
    for (const { tag, cells, placed, seq, from } of all) {
      expect(placed, tag.tag).toBe(true)
      const mine = cells.slice(tag.start - from, tag.end - from + 1)
      mine.forEach((c, k) => {
        if (!c.diff) expect(c.ch.replace(/I/g, 'L'), `${tag.tag} at ${tag.start + k}`).toBe(seq[tag.start - 1 + k].replace(/I/g, 'L'))
      })
      expect(mine.map((c) => c.ch).join(''), tag.tag).toBe(tag.residues)
    }
    // K read for a protein's GV or VG (KQR, YKK, KVR and others).
    const kOnGv = all.filter(({ tag, cells, seq, from }) =>
      cells.some((c, k) => c.ch === 'K' && c.diff && ['GV', 'VG'].includes(seq.slice(from + k - 1, from + k + 1)))
    )
    expect(kOnGv.length).toBeGreaterThanOrEqual(5)
    // Under the default masses those tags have no reading: positions only.
    const def = laid(DEF)
    for (const t of kOnGv) {
      const d = def.find((x) => x.spectrum === t.spectrum && x.tag.row === t.tag.row)!
      expect(d.placed, t.tag.tag).toBe(false)
      expect(d.cells.every((c) => !c.ch), t.tag.tag).toBe(true)
    }
  })
})
