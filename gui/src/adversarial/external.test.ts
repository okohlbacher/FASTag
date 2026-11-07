// @ts-nocheck -- test-only file; uses node APIs outside the app tsconfig
// The real CLI outputs the parser, docs and critic tests read are committed
// (GUI-DESIGN section 9, P1: src/fixtures/real/), so those tests run in every
// checkout instead of only where FASTAG_GUI_TEST_OUTPUTS is set.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FIXTURES_DIR, REAL_DIR, SCRATCH, haveScratch } from './external'

// Every real output a test in this folder asks for.
const USED = [
  'parsers/r.digest.tsv',
  'parsers/q.label.tsv',
  'parsers/r.massgap.tsv',
  'parsers/b.digest.tsv',
  'parsers/c.digest.tsv',
  'parsers/c.massgap.tsv',
  'parsers/b.label.tsv',
  'parsers/c.tags.tsv',
  'parsers/b.tags.species.tsv',
  'docs/short.out',
  'docs/short.err',
  'map/run.tags.species.tsv',
  'map/run.digest.tsv',
  'map/run.label.tsv'
]

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? files(p) : [p]
  })
}

describe('committed real CLI outputs', () => {
  it('are the default test-outputs directory when FASTAG_GUI_TEST_OUTPUTS is unset', () => {
    expect(REAL_DIR).toBe(join(FIXTURES_DIR, 'real'))
    if ((process.env.FASTAG_GUI_TEST_OUTPUTS ?? '').trim() === '') expect(SCRATCH).toBe(REAL_DIR)
  })

  it('hold every output the tests in this folder read', () => {
    for (const f of USED) expect(haveScratch(f), f).toBe(true)
  })

  it('carry no path of the machine they were made on', () => {
    for (const f of files(REAL_DIR)) {
      const t = readFileSync(f, 'utf8')
      expect(t, f).not.toMatch(/\/Users\/|\/home\/|kohlbach|\.worktrees/)
    }
  })

  it('come only from the public E. coli fixture and PXD063917 (README.md beside them)', () => {
    const readme = readFileSync(join(REAL_DIR, 'README.md'), 'utf8')
    expect(readme).toMatch(/Ecoli_MS2_small/)
    expect(readme).toMatch(/PXD063917/)
    for (const f of files(REAL_DIR).filter((p) => p.endsWith('.tsv'))) {
      const t = readFileSync(f, 'utf8')
      const input = /^run\tinput\t([^\t]*)\t/m.exec(t)?.[1]
      if (input) expect(['Ecoli_MS2_small.mzML', 'ecoli.mzML', 'run.mzML', 'PXD063917.mzML'], f).toContain(input)
    }
  })
})
