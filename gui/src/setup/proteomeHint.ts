// The line under Shipped proteome (Mass-shift survey, step 2): which of the
// shipped proteomes fits, from a species report of the same file when there
// is one (feedback 422372a2). Pure: the form passes the report the run state
// holds and whether it belongs to the file in Inputs.

import type { SpeciesReport } from '../types'
import { choiceText } from '../paramLayout'

/// The NCBI taxa of the shipped proteomes (data/alkylation/proteomes.tsv),
/// with the strains a species report may name.
export const SHIPPED_TAXA: Readonly<Record<number, string>> = {
  9606: 'human',
  10090: 'mouse',
  4932: 'yeast',
  559292: 'yeast',
  562: 'ecoli',
  83333: 'ecoli'
}

/// The default line, when no species report of this file is open.
export const PROTEOME_HELP = "The organism's shipped proteome, when you have no FASTA of your own. Not sure of the organism? Species names it, with no database."

/// The shipped proteome a species report of the file points to: its first
/// taxon at rank species (the CLI's order), unless the call says it is not
/// there. null when the report has none.
export function topSpecies(sp: SpeciesReport | null): { name: string; proteome: string | null } | null {
  const top = sp?.taxa.find((t) => t.rank === 'species' && t.call !== 'not_detected')
  return top ? { name: top.name, proteome: SHIPPED_TAXA[top.taxid] ?? null } : null
}

/// The line under Shipped proteome: @p sp is a species report of the file
/// in Inputs (null when there is none), @p chosen the proteome chosen now.
export function proteomeHint(sp: SpeciesReport | null, chosen: string): string {
  const top = topSpecies(sp)
  if (!top) return PROTEOME_HELP
  const said = `Species detection names ${top.name} first in this file`
  if (!top.proteome) return `${said}; no shipped proteome fits: give its FASTA as Protein database.`
  if (chosen === top.proteome) return `${said}.`
  return `${said}: choose ${choiceText('recon_proteome', top.proteome)}.`
}
