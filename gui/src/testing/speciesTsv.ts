// The species report as the renderer reads it, for the vitest and e2e
// fixtures: since P4 the production parser itself (results/species.ts, the
// successor of species.rs read_species), so the fixtures cannot drift from
// the app. An empty text gives a report without taxa.

import type { SpeciesReport } from '../types'
import { parseSpecies } from '../results/species'

export function speciesFromTsv(text: string, path: string): SpeciesReport {
  return parseSpecies(text, path) ?? { path, taxa: [] }
}
