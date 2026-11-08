#!/usr/bin/env node
// The de novo golden files (GUI-DESIGN 9, layer 1; P3): every case of
// src/fixtures/denovo/cases.json run through the repository's own
// tools/tags_to_denovo.py, the reference export/denovo.ts must match byte for
// byte (src/export/denovo.test.ts). The script is called as it is; nothing of
// it is copied or changed here.
//
//   node scripts/denovo-golden.mjs          check: regenerate into a temporary
//                                            folder, compare with the committed
//                                            files, and run the script's own
//                                            --check on each (CI, ci.yml gui)
//   node scripts/denovo-golden.mjs --write  regenerate the committed files
//
// PYTHON names the interpreter (default python3).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const gui = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(gui, 'src', 'fixtures', 'denovo')
const script = join(gui, '..', 'tools', 'tags_to_denovo.py')
const python = process.env.PYTHON || 'python3'
const write = process.argv.includes('--write')

if (!existsSync(script)) {
  console.error(`denovo-golden: ${script} not found`)
  process.exit(2)
}
const cases = JSON.parse(readFileSync(join(dir, 'cases.json'), 'utf8'))
const tmp = mkdtempSync(join(tmpdir(), 'fastag-denovo-'))
const bad = []
try {
  for (const c of cases) {
    const out = join(tmp, c.golden)
    const args = [script, join(dir, c.input), '--format', c.format, '-o', out, '--top-n', String(c.topN), '--min-length', String(c.minLength), '--check']
    // -I: no user site-packages or current-folder modules in the way.
    execFileSync(python, ['-I', ...args], { stdio: ['ignore', 'ignore', 'pipe'] })
    const got = readFileSync(out)
    const dest = join(dir, c.golden)
    if (write) {
      writeFileSync(dest, got)
      console.log(`wrote ${c.golden} (${got.toString('utf8').split('\n').length - 2} reads)`)
    } else if (!existsSync(dest) || !readFileSync(dest).equals(got)) {
      bad.push(c.golden)
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
if (bad.length) {
  console.error(`denovo-golden: tools/tags_to_denovo.py writes something else than the committed ${bad.join(', ')}`)
  console.error('regenerate with `node scripts/denovo-golden.mjs --write` and check export/denovo.ts against them')
  process.exit(1)
}
if (!write) console.log(`denovo-golden: ${cases.length} golden files equal what tools/tags_to_denovo.py writes`)
