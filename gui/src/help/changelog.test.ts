// @ts-nocheck -- test-only file; uses node APIs outside the app tsconfig
// The release notes name one ranking of resolved tags as the one shipped: the
// default the CLI registers (src/FASTagOptions.cpp), which the GUI's fallback
// takes too (stepScore.ts schemeGraph). Entries written while another ranking
// was the default must not still read as the shipped behaviour.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repo = join(__dirname, '..', '..', '..')
const read = (f: string): string => readFileSync(join(repo, f), 'utf8')

describe('CHANGELOG, the ranking of resolved tags', () => {
  const options = read('src/FASTagOptions.cpp')
  const shipped = /registerStringOption_\("resolve_score",\s*"<scheme>",\s*"(\w+)"/.exec(options)?.[1]
  const log = read('CHANGELOG.md')
  const unreleased = (/## Unreleased\n([\s\S]*?)\n## /.exec(log)?.[1] ?? '').replace(/\s+/g, ' ')

  it('names the default the CLI registers', () => {
    expect(shipped).toBe('cstar')
    expect(unreleased).toContain(`\`-resolve_score ${shipped}\` (the default)`)
  })

  it('does not present another ranking as what -resolved_out or the Spectrum tab ranks by', () => {
    expect(unreleased).not.toContain('Ranked by the preregistered step log-odds')
    expect(unreleased).not.toContain('All tags, resolved now ranks the resolved tags by the log-odds')
    // Every sentence that calls a ranking the default names the shipped one, or says it no longer is.
    const sentences = unreleased.split(/(?<=\.)\s+/)
    for (const s of sentences.filter((x) => /\bdefault\b/.test(x) && /steplogodds|step log-odds|evidence|anchor/.test(x))) {
      expect(s.includes(shipped) || /no longer the default/.test(s), s).toBe(true)
    }
  })
})
