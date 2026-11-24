// The proteins of a database hit, as -fasta_proteins writes them (README,
// "Database proteins"): db_proteins holds the first n as
// identifier@start-end (1-based, ';'-separated, targets before decoys),
// db_genes the GN= of each ('-' where the header has none), and
// db_protein_count all of them. '-', '-', 0: none located, or a run without
// the option.

export interface DbProtein {
  // The identifier as the FASTA header has it (sp|P0A6F5|CH60_ECOLI).
  id: string
  // A UniProt identifier's accession (P0A6F5); any other identifier whole.
  accession: string
  // A UniProt identifier's entry name (CH60_ECOLI); null for any other.
  entryName: string | null
  gene: string | null
  start: number
  end: number
}

const UNIPROT = /^(sp|tr)\|([^|]+)\|(.+)$/

/** The entries of a db_proteins cell, with the genes of the db_genes cell
 *  @p genes beside them. '-', '' and entries that do not parse give none. */
export function parseDbProteins(proteins: string, genes = ''): DbProtein[] {
  const p = proteins.trim()
  if (p === '' || p === '-') return []
  const g = genes.trim() === '' || genes.trim() === '-' ? [] : genes.split(';')
  const out: DbProtein[] = []
  p.split(';').forEach((item, k) => {
    // The identifier may hold '@' itself: the range is after the last one.
    const at = item.lastIndexOf('@')
    if (at <= 0) return
    const id = item.slice(0, at)
    const m = /^(\d+)-(\d+)$/.exec(item.slice(at + 1))
    if (!m) return
    const u = UNIPROT.exec(id)
    const gene = (g[k] ?? '-').trim()
    out.push({
      id,
      accession: u ? u[2] : id,
      entryName: u ? u[3] : null,
      gene: gene === '' || gene === '-' ? null : gene,
      start: Number(m[1]),
      end: Number(m[2])
    })
  })
  return out
}

/** A protein in short: accession/gene@start–end (P0A6F5/groL@123–131). */
export const proteinShort = (p: DbProtein): string => `${p.accession}${p.gene ? `/${p.gene}` : ''}@${p.start}–${p.end}`

export interface DbCells {
  proteins: DbProtein[]
  // db_protein_count: every protein, those not listed too.
  count: number
}

/** The db_* cells of @p row under @p columns; null when the file has no
 *  db_proteins column (a run without -fasta_proteins, an older CLI). */
export function dbCellsOf(columns: readonly string[], row: readonly string[]): DbCells | null {
  const j = columns.indexOf('db_proteins')
  if (j < 0) return null
  const proteins = parseDbProteins(row[j] ?? '', row[columns.indexOf('db_genes')] ?? '')
  const n = Number(row[columns.indexOf('db_protein_count')] ?? '')
  return { proteins, count: Number.isFinite(n) && n >= proteins.length ? n : proteins.length }
}

/** What a Database hit cell says with the proteins known: the first one in
 *  short and "+k more" for the rest (P0A6F5/groL@123–131 +2 more), an
 *  entrapment match marked as one. @p words: the cell without proteins
 *  (ResultsTable hitWords), kept when none was located. */
export function dbHitText(hit: string, cells: DbCells | null, words: string): string {
  if (!cells || cells.proteins.length === 0) return words
  const first = proteinShort(cells.proteins[0])
  const more = cells.count - 1
  const text = `${first}${more > 0 ? ` +${more} more` : ''}`
  return hit === 'efwd' || hit === 'erev' ? `Entrapment: ${text}` : text
}

/** The cell's tooltip: every protein listed, how the tag matched, and how
 *  many proteins there are in all. */
export function dbHitTitle(hit: string, cells: DbCells | null): string {
  if (!cells || cells.proteins.length === 0) return hit
  const how = hit === 'rev' || hit === 'erev' ? 'reversed' : 'as written'
  const where = hit === 'efwd' || hit === 'erev' ? 'entrapment database' : 'database'
  const list = cells.proteins.map((p) => `${p.id}${p.gene ? ` (${p.gene})` : ''} ${p.start}–${p.end}`).join('; ')
  const rest = cells.count > cells.proteins.length ? `; ${cells.count - cells.proteins.length} more not listed` : ''
  return `${hit}: in the ${where}, ${how}. ${list}${rest}. ${cells.count} protein${cells.count === 1 ? '' : 's'} in all.`
}
