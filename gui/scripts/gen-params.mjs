// Extract the FASTag parameter contract from the tool's own -write_ini output.
//
// The CLI is the source of truth for names, types, defaults and restrictions;
// hand-copying them into the UI is how a GUI drifts from its CLI (a tolerance
// copied without its unit silently means something else).
//
//   node scripts/gen-params.mjs [path/to/FASTag] [src/params.generated.json]
//   (run from gui/; paths are relative to it)
//
// With an output path the file is replaced only once the manifest is complete,
// so a missing or broken binary leaves the old one in place (a shell redirect
// would have emptied it before the script ran). Without one it prints to stdout.
//
// `npm run params` runs it against the bundled src-tauri/resources/fastag binary.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const bin = process.argv[2] || process.env.FASTAG_BIN || 'src-tauri/resources/fastag/bin/FASTag'
const outPath = process.argv[3]

const dir = mkdtempSync(join(tmpdir(), 'fastag-ini-'))
const ini = join(dir, 'fastag.ini')
let xml
try {
  execFileSync(bin, ['-write_ini', ini], { stdio: ['ignore', 'ignore', 'pipe'] })
  xml = readFileSync(ini, 'utf8')
} catch (e) {
  console.error(`failed to run ${bin} -write_ini: ${e.message}`)
  process.exit(1)
} finally {
  rmSync(dir, { recursive: true, force: true })
}

const unescape = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

const attrs = (tag) => {
  const out = {}
  for (const m of tag.matchAll(/(\w+)="([^"]*)"/g)) out[m[1]] = unescape(m[2])
  return out
}

// restrictions carry two different meanings depending on type:
//   numeric -> "min:max", either side may be empty ("1:" = min 1, no max)
//   string  -> comma-separated allowed values
const parseRestrictions = (type, r) => {
  if (!r) return {}
  if (type === 'int' || type === 'double') {
    const [lo, hi] = r.split(':')
    const res = {}
    if (lo !== '' && lo !== undefined) res.min = Number(lo)
    if (hi !== '' && hi !== undefined) res.max = Number(hi)
    return res
  }
  return { choices: r.split(',') }
}

const params = []

for (const m of xml.matchAll(/<ITEM\s([^>]*?)\/>/g)) {
  const a = attrs(m[1])
  if (!a.name) continue
  params.push({
    name: a.name,
    type: a.type,
    // Numbers in plain decimals: the INI writes 0.008 as 8.0e-03.
    default: (a.type === 'double' || a.type === 'int') && /e/i.test(a.value ?? '') ? String(Number(a.value)) : (a.value ?? ''),
    description: a.description ?? '',
    required: a.required === 'true',
    toppAdvanced: a.advanced === 'true',
    ...parseRestrictions(a.type, a.restrictions),
    // "*.fasta,*.fa" -> ["fasta", "fa"]: the file dialog's filter.
    ...(a.supported_formats
      ? { formats: a.supported_formats.split(',').map((f) => f.trim().replace(/^\*\./, '')).filter(Boolean) }
      : {})
  })
}

// <ITEMLIST name=... > <LISTITEM value="..."/> ... </ITEMLIST>
for (const m of xml.matchAll(/<ITEMLIST\s([^>]*?)>([\s\S]*?)<\/ITEMLIST>/g)) {
  const a = attrs(m[1])
  if (!a.name) continue
  const items = [...m[2].matchAll(/<LISTITEM\s+value="([^"]*)"/g)].map((x) => unescape(x[1]))
  params.push({
    name: a.name,
    type: 'string-list',
    default: items,
    description: a.description ?? '',
    required: a.required === 'true',
    toppAdvanced: a.advanced === 'true',
    // An int list (tag_lengths) keeps its item type and bounds, which apply
    // to each item: the form can then refuse `0` or `7, 8` on one line.
    ...(a.type && a.type !== 'string' ? { itemType: a.type } : {}),
    ...parseRestrictions(a.type, a.restrictions)
  })
}

if (params.length === 0) {
  console.error(`${bin} -write_ini produced no parameters`)
  process.exit(1)
}

params.sort((x, y) => x.name.localeCompare(y.name))
const json = JSON.stringify({ params }, null, 2) + '\n'
if (outPath) {
  const tmp = `${outPath}.tmp`
  writeFileSync(tmp, json)
  renameSync(tmp, outPath)
} else {
  process.stdout.write(json)
}
