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
// equal to that genus is consistent at genus; so is an SDRF taxon above
// genus that contains the call. Only the call counts: an organism in a lower
// ranked genus the report calls present is not consistent (a mixed sample:
// present_not_called; else a mismatch). An organism the taxonomy does not hold is one FASTag cannot
// detect: not checkable, never a mismatch.

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

export type OrganismState = 'match' | 'genus' | 'present_not_called' | 'mismatch' | 'not_checkable'

export interface OrganismMatch {
  state: OrganismState
  /// The SDRF organisms as resolved (null: not in the taxonomy).
  resolved: { value: string; organism: Organism | null }[]
  /// Why, in words.
  note: string
}

const named = (tx: Taxonomy, t: number | null): string => (t == null ? 'no genus' : `${tx.name(t) ?? 'taxid'} (taxid ${t})`)

/// Whether @p ancestor is @p taxid or lies above it in its lineage.
export function isAncestor(tx: Taxonomy, ancestor: number, taxid: number): boolean {
  let t = taxid
  for (let guard = 0; guard < 100; guard++) {
    if (t === ancestor) return true
    const n = tx.node(t)
    if (!n || n.parent === t) return false
    t = n.parent
  }
  return false
}

/// A genus call (@p genus, its taxid) against the SDRF organisms of a run;
/// @p present: every genus the species report calls present, the call first
/// (default: the call alone).
/// Only the call (the top genus) counts: match: an SDRF organism is that
/// genus; genus: one lies in it (a species or strain), or is a taxon above
/// genus that contains it (a family, an order, "Bacteria").
/// A genus ranked below the call is a contaminant as often as a sample, so
/// an SDRF organism that lies only in such a genus is no consistency:
/// present_not_called when the SDRF lists several organisms for the run (a
/// mixed sample, of which FASTag called another), else a mismatch (the run's
/// top genus is not the SDRF's organism; the note says where the SDRF's
/// organism ranks). not_checkable: no SDRF organism fits the call and one is
/// not in the taxonomy (FASTag cannot call it); mismatch: every SDRF organism
/// resolves and none lies in, or contains, the called genus.
export function matchOrganism(tx: Taxonomy, values: readonly string[], genus: number, present: readonly number[] = [genus]): OrganismMatch {
  const resolved = values.map((value) => ({ value, organism: resolveOrganism(tx, value) }))
  const ranked = [genus, ...present.filter((g) => g !== genus)]
  // Whether an organism lies in genus g (or is it), or contains it from above genus.
  const fits = (o: Organism, g: number): 'in' | 'contains' | null =>
    o.genus === g ? 'in' : o.genus == null && isAncestor(tx, o.taxid, g) ? 'contains' : null
  for (const r of resolved) {
    const o = r.organism
    const how = o ? fits(o, genus) : null
    if (!o || !how) continue
    if (how === 'contains')
      return { state: 'genus', resolved, note: `${o.name} (taxid ${o.taxid}, ${o.rank || 'no rank'}) contains the called genus ${named(tx, genus)}: consistent` }
    if (o.taxid === genus) return { state: 'match', resolved, note: `the SDRF names the genus ${named(tx, genus)}` }
    return { state: 'genus', resolved, note: `${o.name} (taxid ${o.taxid}) lies in the called genus ${named(tx, genus)}: consistent at genus` }
  }
  // The best-ranked present genus below the call that holds an SDRF organism.
  let lower: { o: Organism; g: number; i: number } | null = null
  for (let i = 1; i < ranked.length && !lower; i++)
    for (const r of resolved) if (r.organism && fits(r.organism, ranked[i])) {
      lower = { o: r.organism, g: ranked[i], i }
      break
    }
  const lowerWords = lower
    ? `${lower.o.name} (taxid ${lower.o.taxid}) lies in the genus ${named(tx, lower.g)}, present but ranked ${lower.i + 1} of the ${ranked.length} present genera; the call is ${named(tx, genus)}`
    : ''
  if (lower && resolved.length > 1)
    return { state: 'present_not_called', resolved, note: `a mixed sample: ${lowerWords}, which the SDRF does not name` }
  const missing = resolved.filter((r) => !r.organism)
  if (missing.length)
    return {
      state: 'not_checkable',
      resolved,
      note: `${missing.map((r) => r.value).join(', ')} is not in the taxonomy FASTag's species call uses, so FASTag cannot call it`
    }
  if (lower) return { state: 'mismatch', resolved, note: `${lowerWords}: the run's top genus is not the SDRF's organism` }
  const words = resolved.map((r) => `${r.organism!.name} (taxid ${r.organism!.taxid}, genus ${named(tx, r.organism!.genus)})`).join(', ')
  const others = ranked.length > 1 ? ` (none of the ${ranked.length} genera the species report calls present holds an SDRF organism)` : ''
  return { state: 'mismatch', resolved, note: `the SDRF names ${words}; FASTag called the genus ${named(tx, genus)}${others}` }
}
