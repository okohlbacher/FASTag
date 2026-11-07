#!/usr/bin/env node
// Fails when a release build carries the test bridges (GUI-DESIGN section 9).
// The mock and e2e bridges are reachable only from branches that are constant
// false outside `vite dev` and `vite build --mode e2e`, so a release dist/
// must contain none of their strings. Minifying renames identifiers but keeps
// string literals, so the check looks for literals only those files hold.
//
//   node scripts/check-dist-clean.mjs [dist]
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] ?? 'dist'
const MARKERS = [
  '__FASTAG_E2E_BRIDGE__', // e2eBridge.ts E2E_MARKER
  '__fastagE2E', // the e2e controls on window
  'e2e fixture: no CLI', // e2eBridge.ts
  'FASTag 9.9.9 (mock)', // mockBridge.ts
  '/mock/FASTag', // mockBridge.ts
  'browser preview: no CLI', // devBridge.ts
  'controllerType=0 controllerNumber=1 scan=11461', // the e2e tags fixture
  '20130611_QE3_UPLC10_CFR_SA_OC_T_NO_03_01_01', // the real-CLI fixtures (src/fixtures/cli)
  'KristenJeff_p53_mod_AspN_03_02_07',
  'Hog1p_WT_Rep3_Chymo_5uL', // the batch fixtures (src/fixtures/cli/batch)
  '100815_MM_ABPP_H1993_DMSO_DIA1_new',
  'sp|Q9NX58|LYAR_HUMAN', // the P4c recon fixtures (src/fixtures/cli/v112-pxd014764-delta-ext3)
  'VIMSS17368' // and v1111-ecoli-recon-loc
]

function* files(d) {
  for (const name of readdirSync(d)) {
    const p = join(d, name)
    if (statSync(p).isDirectory()) yield* files(p)
    else yield p
  }
}

let checked = 0
const hits = []
for (const f of files(dir)) {
  if (!/\.(js|mjs|html|css|json|map)$/.test(f)) continue
  checked++
  const text = readFileSync(f, 'utf8')
  for (const m of MARKERS) if (text.includes(m)) hits.push(`${f}: ${JSON.stringify(m)}`)
}
if (checked === 0) {
  console.error(`check-dist-clean: no built files in ${dir}`)
  process.exit(2)
}
if (hits.length) {
  console.error(`check-dist-clean: ${dir} carries test-bridge code:\n  ${hits.join('\n  ')}`)
  process.exit(1)
}
console.log(`check-dist-clean: ${checked} files in ${dir}, no mock or fixture strings`)
