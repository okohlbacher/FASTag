// Every file in a fixture folder is something a test or the e2e bridge
// reads, so none may be git-ignored: an ignored fixture is never committed
// and a clean checkout then fails to resolve it (the cli-dev TSVs fell
// under the top-level *.tsv rule this way). The rule exceptions live in
// the repository's .gitignore.

// @ts-ignore -- node built-ins; the app's tsconfig has no node types
import { spawnSync } from 'node:child_process'
// @ts-ignore
import { existsSync, readdirSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const FIXTURE_DIRS = [
  'src/fixtures',
  'src/testing/fixtures',
  'src/feedback/fixtures',
  'e2e-web/fixtures',
  'src-tauri/tests/fixtures'
]

function filesUnder(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir) as string[]) {
    const p = `${dir}/${name}`
    if (statSync(p).isDirectory()) out.push(...filesUnder(p))
    else out.push(p)
  }
  return out
}

// Outside a git work tree (a source tarball) there is nothing to check.
const inGit: boolean = (() => {
  const r = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' })
  return r.status === 0 && String(r.stdout).trim() === 'true'
})()

describe.skipIf(!inGit)('fixtures are not git-ignored', () => {
  it('no file in a fixture folder matches a .gitignore rule', () => {
    const files = FIXTURE_DIRS.filter((d) => existsSync(d)).flatMap(filesUnder)
    expect(files.length).toBeGreaterThan(0)
    // --no-index: judge by the rules alone, so a force-added file that a
    // rule still matches is caught too (it would be dropped on re-adding).
    const r = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], {
      input: files.join('\n') + '\n',
      encoding: 'utf8'
    })
    // Exit 1: no path is ignored. Exit 0: the listed paths are.
    const ignored = String(r.stdout).split('\n').filter((l: string) => l !== '')
    expect(ignored).toEqual([])
    expect(r.status).toBe(1)
  })
})
