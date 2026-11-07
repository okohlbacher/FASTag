// The SDRF corrections TSV (GUI-DESIGN 10 P4 acceptance): reproducible from
// the CLI reports alone. This test reads nothing but files: the SDRF, the
// taxonomy dumps the species call uses, and what FASTag wrote for each job
// of the gate batch (log, digest, label and species reports, as a cluster
// user has them), and the TSV must equal the committed golden file byte for
// byte. The Playwright spec sdrf.spec.ts checks that the app's export writes
// the same bytes.

// @ts-ignore -- node built-in; the app's tsconfig has no node types
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseReport } from '../digestReport'
import { speciesFromTsv } from '../testing/speciesTsv'
import { compareSdrf, correctionsTsv, CORRECTIONS_HEADER, type SdrfJob } from './compare'
import { parseSdrf, serializeSdrf } from './sdrfTable'
import { parseTaxdump } from './taxonomy'

const BATCH = 'src/fixtures/cli/batch'
const read = (p: string): string => readFileSync(p, 'utf8') as string
const GOLDEN = 'src/fixtures/sdrf/gate-batch.corrections.tsv'

// One job per batch directory, named as the e2e folder lists it; a job
// whose CLI wrote no reports (the refused raw DIA input) failed.
function jobs(): SdrfJob[] {
  const names = (readdirSync(BATCH, { withFileTypes: true }) as { name: string; isDirectory(): boolean }[])
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
  return names.map((n): SdrfJob => {
    const dir = `${BATCH}/${n}`
    if (!existsSync(`${dir}/run.digest.tsv`)) return { input: `/data/${n}.mzML`, status: 'failed', data: undefined }
    return {
      input: `/data/${n}.mzML`,
      status: 'done',
      data: {
        log: read(`${dir}/run.log`)
          .split(/\r?\n/)
          .filter((l) => l !== ''),
        reports: [parseReport(read(`${dir}/run.digest.tsv`), `/data/${n}.digest.tsv`), parseReport(read(`${dir}/run.label.tsv`), `/data/${n}.label.tsv`)],
        species: speciesFromTsv(read(`${dir}/run.tags.species.tsv`), `/data/${n}.tags.species.tsv`),
        census: null,
        params: {}
      }
    }
  })
}

const sdrf = (): ReturnType<typeof parseSdrf> => parseSdrf(new Uint8Array(readFileSync('src/fixtures/sdrf/gate-batch.sdrf.tsv')))
const tx = parseTaxdump(read('src/fixtures/sdrf/nodes.dmp'), read('src/fixtures/sdrf/names.dmp'))

describe('the SDRF corrections TSV', () => {
  it('equals the golden file, from the reports, the SDRF and the taxonomy alone', () => {
    expect(correctionsTsv(compareSdrf(sdrf(), jobs(), tx))).toBe(read(GOLDEN))
  })

  it('lists the mismatches only (no run setting that differs), in SDRF order, whatever the queue order', () => {
    const j = jobs()
    const a = correctionsTsv(compareSdrf(sdrf(), j, tx))
    expect(correctionsTsv(compareSdrf(sdrf(), [...j].reverse(), tx))).toBe(a)
    const lines = a.trimEnd().split('\n')
    expect(lines[0].split('\t')).toEqual([...CORRECTIONS_HEADER])
    // The fragment tolerances (pxd004541, pxd010783) and the run's
    // Carbamidomethyl (pxd040407) are run settings that differ: not here.
    expect(lines.slice(1).map((l) => l.split('\t').slice(1, 4))).toEqual([
      ['pxd014764.mzML', '5,6', 'organism'],
      ['pxd040407-chymo.mzML', '8', 'instrument']
    ])
    // Every line has every column, and no cell holds a tab or line break.
    for (const l of lines) expect(l.split('\t')).toHaveLength(CORRECTIONS_HEADER.length)
  })

  it('a genus call against the SDRF species is no correction', () => {
    const a = correctionsTsv(compareSdrf(sdrf(), jobs(), tx))
    expect(a).not.toMatch(/\tpxd003531\.mzML\t/)
    expect(a.split('\n').filter((l) => l.includes('\torganism\t'))).toHaveLength(1)
  })

  it('the SDRF is never rewritten: the comparison leaves its bytes as they were', () => {
    const bytes = new Uint8Array(readFileSync('src/fixtures/sdrf/gate-batch.sdrf.tsv'))
    const t = parseSdrf(bytes)
    compareSdrf(t, jobs(), tx)
    expect(Array.from(serializeSdrf(t))).toEqual(Array.from(bytes))
  })
})
