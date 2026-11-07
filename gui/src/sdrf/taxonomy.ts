// SDRF organisms by NCBI taxid (GUI-DESIGN 3 S6, 10 P4). The taxonomy is
// the one FASTag's species call reads: nodes.dmp and names.dmp of the
// taxonomy folder next to the index (the bundled one is an NCBI taxdump
// pruned to the lineages the index can reach), read by the backend
// (sdrf.rs taxonomy_dump) and parsed here, so the comparison is a pure
// function of the files.
//
// The species report's genus rows carry their taxid, so a call and an SDRF
// organism are compared by taxid: the organism is resolved (an NCBITaxon
// accession first, else its name), walked up to its genus, and a genus call
// equal to that genus is consistent at genus. An organism the taxonomy does
// not hold is one FASTag cannot detect: not checkable, never a mismatch.

export interface TaxNode {
  parent: number
  rank: string
}

export interface Taxonomy {
  node(taxid: number): TaxNode | undefined
  /// The scientific name of @p taxid.
  name(taxid: number): string | undefined
  /// The taxa a name (any name class) is, scientific names first.
  byName(name: string): number[]
  size: number
}

const fields = (line: string): string[] => line.replace(/\t\|\s*$/, '').split('\t|\t')
const key = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase()

/// The taxonomy of an NCBI nodes.dmp and names.dmp.
export function parseTaxdump(nodesText: string, namesText: string): Taxonomy {
  const nodes = new Map<number, TaxNode>()
  for (const line of nodesText.split(/\r?\n/)) {
    if (!line.trim()) continue
    const f = fields(line)
    const id = Number(f[0])
    const parent = Number(f[1])
    if (Number.isInteger(id) && Number.isInteger(parent)) nodes.set(id, { parent, rank: (f[2] ?? '').trim() })
  }
  const sci = new Map<number, string>()
  // name -> [scientific taxids, other taxids]
  const index = new Map<string, [number[], number[]]>()
  for (const line of namesText.split(/\r?\n/)) {
    if (!line.trim()) continue
    const f = fields(line)
    const id = Number(f[0])
    const name = (f[1] ?? '').trim()
    if (!Number.isInteger(id) || !name) continue
    const isSci = (f[3] ?? '').trim() === 'scientific name'
    if (isSci) sci.set(id, name)
    const k = key(name)
    const e = index.get(k) ?? [[], []]
    const list = e[isSci ? 0 : 1]
    if (!list.includes(id)) list.push(id)
    index.set(k, e)
  }
  return {
    node: (t) => nodes.get(t),
    name: (t) => sci.get(t),
    byName: (n) => {
      const e = index.get(key(n))
      return e ? [...e[0].sort((a, b) => a - b), ...e[1].sort((a, b) => a - b)] : []
    },
    size: nodes.size
  }
}

/// The genus @p taxid is or lies in; null above genus or outside the dump.
export function genusOf(tx: Taxonomy, taxid: number): number | null {
  let t = taxid
  for (let guard = 0; guard < 100; guard++) {
    const n = tx.node(t)
    if (!n) return null
    if (n.rank === 'genus') return t
    if (n.parent === t) return null
    t = n.parent
  }
  return null
}

export interface Organism {
  taxid: number
  rank: string
  name: string
  genus: number | null
}

/// The SDRF values that state no organism.
export const NOT_STATED = new Set(['', 'not available', 'not applicable', 'na', 'n/a', 'none', 'unknown'])

/// The taxon an SDRF organism cell names: its NCBITaxon accession (AC=
/// NCBITaxon:9606, NCBITaxon_9606) if the taxonomy holds it, else its name
/// (NT= or the whole cell), else that name without a "(common name)" suffix.
export function resolveOrganism(tx: Taxonomy, value: string): Organism | null {
  const v = value.trim()
  if (NOT_STATED.has(v.toLowerCase())) return null
  const of = (taxid: number): Organism => ({ taxid, rank: tx.node(taxid)!.rank, name: tx.name(taxid) ?? String(taxid), genus: genusOf(tx, taxid) })
  const acc = /NCBITaxon[:_](\d+)/i.exec(v)
  if (acc && tx.node(Number(acc[1]))) return of(Number(acc[1]))
  const nt = /(?:^|;)\s*NT\s*=\s*([^;]*)/i.exec(v)
  const name = nt ? nt[1] : v.includes('=') ? '' : v
  for (const n of [name, name.replace(/\s*\([^)]*\)\s*$/, '')]) {
    const hit = n ? tx.byName(n).find((t) => tx.node(t)) : undefined
    if (hit !== undefined) return of(hit)
  }
  return null
}

export type OrganismState = 'match' | 'genus' | 'mismatch' | 'not_checkable'

export interface OrganismMatch {
  state: OrganismState
  /// The SDRF organisms as resolved (null: not in the taxonomy).
  resolved: { value: string; organism: Organism | null }[]
  /// Why, in words.
  note: string
}

const named = (tx: Taxonomy, t: number | null): string => (t == null ? 'no genus' : `${tx.name(t) ?? 'taxid'} (taxid ${t})`)

/// A genus call (@p genus, its taxid) against the SDRF organisms of a run.
/// match: an SDRF organism is that genus; genus: one lies in it (a species
/// or strain); not_checkable: none matches and one is not in the taxonomy
/// (FASTag cannot call it); mismatch: every SDRF organism resolves and none
/// lies in the called genus.
export function matchOrganism(tx: Taxonomy, values: readonly string[], genus: number): OrganismMatch {
  const resolved = values.map((value) => ({ value, organism: resolveOrganism(tx, value) }))
  const hit = resolved.find((r) => r.organism?.genus === genus)
  if (hit) {
    const o = hit.organism!
    return o.taxid === genus
      ? { state: 'match', resolved, note: `the SDRF names the genus ${named(tx, genus)}` }
      : { state: 'genus', resolved, note: `${o.name} (taxid ${o.taxid}) lies in the called genus ${named(tx, genus)}: consistent at genus` }
  }
  const missing = resolved.filter((r) => !r.organism)
  if (missing.length)
    return {
      state: 'not_checkable',
      resolved,
      note: `${missing.map((r) => r.value).join(', ')} is not in the taxonomy FASTag's species call uses, so FASTag cannot call it`
    }
  const words = resolved.map((r) => `${r.organism!.name} (taxid ${r.organism!.taxid}, genus ${named(tx, r.organism!.genus)})`).join(', ')
  return { state: 'mismatch', resolved, note: `the SDRF names ${words}; FASTag called the genus ${named(tx, genus)}` }
}
