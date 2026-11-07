// Organism matching by NCBI taxid (GUI-DESIGN 3 S6, 10 P4): an SDRF
// organism is resolved through the taxonomy FASTag's species call uses (the
// bundled nodes.dmp and names.dmp, copied to src/fixtures/sdrf), and a genus
// call that contains the SDRF species is consistent at genus, not a mismatch.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { genusOf, matchOrganism, parseTaxdump, resolveOrganism } from './taxonomy'

const tx = parseTaxdump(readFileSync('src/fixtures/sdrf/nodes.dmp', 'utf8'), readFileSync('src/fixtures/sdrf/names.dmp', 'utf8'))

describe('the taxonomy dump', () => {
  it('reads nodes and scientific names', () => {
    expect(tx.node(9606)).toEqual({ parent: 9605, rank: 'species' })
    expect(tx.name(9605)).toBe('Homo')
    expect(tx.size).toBeGreaterThan(300)
  })

  it('walks to the genus: a species, a strain, the genus itself; none above genus', () => {
    expect(genusOf(tx, 9606)).toBe(9605)
    expect(genusOf(tx, 10090)).toBe(10088)
    // E. coli K-12 (a strain) -> Escherichia; S. cerevisiae S288C -> Saccharomyces.
    expect(genusOf(tx, 83333)).toBe(561)
    expect(genusOf(tx, 559292)).toBe(4930)
    expect(genusOf(tx, 9605)).toBe(9605)
    expect(genusOf(tx, 9604)).toBeNull()
    expect(genusOf(tx, 123456789)).toBeNull()
  })

  it('a cycle in a malformed dump ends the walk', () => {
    const bad = parseTaxdump('5\t|\t6\t|\tspecies\t|\n6\t|\t5\t|\tno rank\t|\n', '5\t|\tX y\t|\t\t|\tscientific name\t|\n')
    expect(genusOf(bad, 5)).toBeNull()
  })
})

describe('an SDRF organism to a taxid', () => {
  it('by scientific name, case and spaces aside', () => {
    expect(resolveOrganism(tx, 'Homo sapiens')).toMatchObject({ taxid: 9606, rank: 'species', genus: 9605 })
    expect(resolveOrganism(tx, '  homo   SAPIENS ')).toMatchObject({ taxid: 9606 })
    expect(resolveOrganism(tx, 'Mus musculus')).toMatchObject({ taxid: 10090, genus: 10088 })
  })

  it('by an NCBITaxon accession, which wins over the name', () => {
    expect(resolveOrganism(tx, 'NT=Homo sapiens;AC=NCBITaxon:9606')).toMatchObject({ taxid: 9606 })
    expect(resolveOrganism(tx, 'NCBITaxon:10090')).toMatchObject({ taxid: 10090 })
    expect(resolveOrganism(tx, 'NT=Human;AC=NCBITaxon_9606')).toMatchObject({ taxid: 9606 })
  })

  it('a common-name suffix in parentheses is dropped', () => {
    expect(resolveOrganism(tx, 'Homo sapiens (Human)')).toMatchObject({ taxid: 9606 })
  })

  it('an organism outside the taxonomy, or "not available", resolves to nothing', () => {
    expect(resolveOrganism(tx, 'Vitis vinifera')).toBeNull()
    expect(resolveOrganism(tx, 'not available')).toBeNull()
    expect(resolveOrganism(tx, '')).toBeNull()
  })
})

describe('a genus call against an SDRF organism', () => {
  it('genus "Homo" vs SDRF "Homo sapiens" is consistent at genus, not a mismatch', () => {
    expect(matchOrganism(tx, ['Homo sapiens'], 9605)).toMatchObject({ state: 'genus' })
  })

  it('the genus itself is a match; another genus is a mismatch', () => {
    expect(matchOrganism(tx, ['Homo'], 9605)).toMatchObject({ state: 'match' })
    expect(matchOrganism(tx, ['Mus musculus'], 9605)).toMatchObject({ state: 'mismatch' })
    expect(matchOrganism(tx, ['NT=Mus musculus;AC=NCBITaxon:10090'], 10088)).toMatchObject({ state: 'genus' })
  })

  it('by taxid, not by name: a genus of the same name elsewhere would not do', () => {
    // A call whose taxid is not Homo's is a mismatch even if a name said "Homo".
    expect(matchOrganism(tx, ['Homo sapiens'], 9539)).toMatchObject({ state: 'mismatch' })
  })

  it('several SDRF organisms (a spike-in): the call matches one of them', () => {
    expect(matchOrganism(tx, ['Homo sapiens', 'Saccharomyces cerevisiae'], 4930)).toMatchObject({ state: 'genus' })
  })

  it('an SDRF organism FASTag cannot detect is not checkable, never a mismatch', () => {
    expect(matchOrganism(tx, ['Vitis vinifera'], 9605)).toMatchObject({ state: 'not_checkable' })
    // One resolvable organism that differs, one not in the taxonomy: not checkable either.
    expect(matchOrganism(tx, ['Mus musculus', 'Vitis vinifera'], 9605)).toMatchObject({ state: 'not_checkable' })
  })
})
