// The proteins of a database hit (-fasta_proteins): parsing the db_* cells,
// the Database hit cell's words, and a real run of the CLI (fixtures/cli-dev).

// @ts-ignore -- node built-in; the app's tsconfig has no node types
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { dbCellsOf, dbHitText, dbHitTitle, parseDbProteins, proteinShort } from './dbProteins'
import { autoWidths, hitCellText, proteinsCellText } from '../ResultsTable'

const FX = `src/fixtures/cli-dev/ecoli-fasta-proteins/run01.tags.tsv`

describe('db_proteins cells', () => {
  it('splits a UniProt identifier into accession and entry name, with the gene beside it', () => {
    const p = parseDbProteins('sp|P0A6F5|CH60_ECOLI@123-131;tr|A0A1|A0A1_HUMAN@5-12', 'groL;-')
    expect(p).toEqual([
      { id: 'sp|P0A6F5|CH60_ECOLI', accession: 'P0A6F5', entryName: 'CH60_ECOLI', gene: 'groL', start: 123, end: 131 },
      { id: 'tr|A0A1|A0A1_HUMAN', accession: 'A0A1', entryName: 'A0A1_HUMAN', gene: null, start: 5, end: 12 }
    ])
    expect(proteinShort(p[0])).toBe('P0A6F5/groL@123–131')
    expect(proteinShort(p[1])).toBe('A0A1@5–12')
  })

  it('keeps any other identifier whole, an @ in it too; none for - or empty', () => {
    expect(parseDbProteins('VIMSS17368@59-67', '-')).toEqual([{ id: 'VIMSS17368', accession: 'VIMSS17368', entryName: null, gene: null, start: 59, end: 67 }])
    expect(parseDbProteins('odd@name@3-9')[0]).toMatchObject({ id: 'odd@name', start: 3, end: 9 })
    expect(parseDbProteins('-', '-')).toEqual([])
    expect(parseDbProteins('')).toEqual([])
    expect(parseDbProteins('broken;x@1-2')).toEqual([{ id: 'x', accession: 'x', entryName: null, gene: null, start: 1, end: 2 }])
  })

  it('names the first protein and "+k more" in place of In database; entrapment stays marked', () => {
    const cols = ['tag', 'fasta_hit', 'db_proteins', 'db_genes', 'db_protein_count']
    const row = ['PEPTIDE', 'fwd', 'sp|P0A6F5|CH60_ECOLI@123-131;sp|P0A6F1|X_ECOLI@4-12;sp|Q1|Y_ECOLI@1-9', 'groL;-;yyy', '5']
    const cells = dbCellsOf(cols, row)
    expect(cells?.count).toBe(5)
    expect(dbHitText('fwd', cells, 'In database')).toBe('P0A6F5/groL@123–131 +4 more')
    expect(hitCellText(cols, row, 'fwd')).toBe('P0A6F5/groL@123–131 +4 more')
    expect(dbHitText('erev', cells, 'Entrapment')).toBe('Entrapment: P0A6F5/groL@123–131 +4 more')
    expect(dbHitTitle('rev', cells)).toBe(
      'rev: in the database, reversed. sp|P0A6F5|CH60_ECOLI (groL) 123–131; sp|P0A6F1|X_ECOLI 4–12; sp|Q1|Y_ECOLI (yyy) 1–9; 2 more not listed. 5 proteins in all.'
    )
    // One protein: no "more".
    expect(hitCellText(cols, ['T', 'rev', 'VIMSS17368@59-67', '-', '1'], 'rev')).toBe('VIMSS17368@59–67')
    // Nothing located, or a file without the columns: the words as before.
    expect(hitCellText(cols, ['T', 'fwd', '-', '-', '0'], 'fwd')).toBe('In database')
    expect(hitCellText(['tag', 'fasta_hit'], ['T', 'fwd'], 'fwd')).toBe('In database')
    expect(hitCellText(['tag', 'fasta_hit'], ['T', '-'], '-')).toBe('Not checked')
    expect(proteinsCellText('sp|P0A6F5|CH60_ECOLI@1-4;b@2-3')).toBe('P0A6F5@1–4; b@2–3')
  })

  it('sizes the Database hit column to the protein it names', () => {
    const cols = ['fasta_hit', 'db_proteins', 'db_genes', 'db_protein_count']
    const w = autoWidths(cols, [['fwd', 'sp|P0A6F5|CH60_ECOLI@123-131', 'groL', '3']])
    expect(w.fasta_hit).toBeGreaterThanOrEqual('P0A6F5/groL@123–131 +2 more'.length * 9)
  })
})

describe('db_proteins of a real run (FASTag -fasta -fasta_proteins 3)', () => {
  const lines: string[] = (readFileSync(FX, 'utf8') as string).trimEnd().split('\n')
  const columns = lines[0].split('\t')
  const rows = lines.slice(1).map((l) => l.split('\t'))
  const fasta = new Map<string, string>()
  let id = ''
  for (const l of readFileSync(`../examples/Ecoli_MS2_small.fasta`, 'utf8').split(/\r?\n/) as string[]) {
    if (l.startsWith('>')) fasta.set((id = l.slice(1).split(/\s/)[0]), '')
    else if (id) fasta.set(id, fasta.get(id)! + l.replace(/[^A-Za-z]/g, '').toUpperCase())
  }

  it('has the three columns after fasta_hit, and every row names its proteins', () => {
    expect(columns.slice(columns.indexOf('fasta_hit'))).toEqual(['fasta_hit', 'db_proteins', 'db_genes', 'db_protein_count'])
    expect(rows.length).toBeGreaterThan(20)
    for (const r of rows) {
      const c = dbCellsOf(columns, r)!
      expect(c.count, r.join(' ')).toBeGreaterThanOrEqual(1)
      expect(c.proteins.length).toBeGreaterThanOrEqual(1)
      expect(c.proteins.length).toBeLessThanOrEqual(Math.min(3, c.count))
      expect(hitCellText(columns, r, r[columns.indexOf('fasta_hit')])).not.toBe('In database')
    }
  })

  it('places each equal-length match on the residues of the FASTA, reversed for rev (I = L)', () => {
    const fold = (s: string): string => s.replace(/I/g, 'L')
    let exact = 0
    for (const r of rows) {
      const tag = r[columns.indexOf('tag')]
      const hit = r[columns.indexOf('fasta_hit')]
      for (const p of dbCellsOf(columns, r)!.proteins) {
        const seq = fasta.get(p.id)
        expect(seq, p.id).toBeDefined()
        if (p.end - p.start + 1 !== tag.length) continue
        const db = seq!.slice(p.start - 1, p.end)
        expect(fold(db), `${tag} ${hit} ${p.id}@${p.start}`).toBe(fold(hit === 'rev' ? [...tag].reverse().join('') : tag))
        exact++
      }
    }
    expect(exact).toBeGreaterThan(10)
  })
})
