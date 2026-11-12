// End-to-end specs of the INSTALLED Windows app with its real bundled CLI
// (tauri-driver + msedgedriver; run-windows.ps1 starts them). Where
// app.test.mjs covers the Linux debug build, this drives what a user runs:
// the app the NSIS installer put on disk, its resources\fastag CLI, the
// public fixtures. Native dialogs cannot be driven, so a spec replaces only
// window.fastag.pickInput with a function returning its path; everything
// else goes through the real invoke, the Rust backend and the CLI.
//
// Environment (run-windows.ps1 sets it):
//   FASTAG_APP    the installed app (<install dir>\fastag.exe)
//   E2E_VERSION   the version the bundled CLI must report
//   E2E_MZML      the public E. coli fixture (test/fixtures/Ecoli_MS2_small.mzML)
//   E2E_MGF       the same spectra as MGF (test/fixtures/Ecoli_MS2_small.mgf)
//   E2E_OUT       results: windows-e2e.json and screens\*.png
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { ELEMENT, Session, until } from './wd.mjs'

const APP = process.env.FASTAG_APP
const OUT = process.env.E2E_OUT || tmpdir()
const SCREENS = join(OUT, 'screens')
const CLI = join(dirname(APP), 'resources', 'fastag', 'bin', 'FASTag.exe')
assert.ok(APP && existsSync(APP), `FASTAG_APP (${APP}) is not a file`)
assert.ok(existsSync(CLI), `no bundled CLI at ${CLI}`)
mkdirSync(SCREENS, { recursive: true })

const record = { recorded: new Date().toISOString(), app: APP, steps: {} }
after(() => writeFileSync(join(OUT, 'windows-e2e.json'), JSON.stringify(record, null, 2) + '\n'))

/** The CLI's environment as the app sets it (fastag.rs cli_env): on Windows
 *  on ARM64 the x64 CLI runs emulated and needs the mimalloc redirection off
 *  (0xC0000142 otherwise; FASTag.bat does the same). */
const ARM64 = /^ARM/i.test(process.env.PROCESSOR_ARCHITECTURE || '') || /^ARM/i.test(process.env.PROCESSOR_IDENTIFIER || '')
const cliEnv = () => ({
  ...process.env,
  OPENMS_DATA_PATH: join(dirname(CLI), '..', 'share', 'OpenMS'),
  OPENBLAS_NUM_THREADS: '1',
  ...(ARM64 && !process.env.MIMALLOC_DISABLE_REDIRECT ? { MIMALLOC_DISABLE_REDIRECT: '1' } : {})
})

const tagsOf = (input) => join(dirname(input), basename(input).replace(/\.[^.]+$/, '') + '.tags.tsv')
const count = (s) => Number(s.replace(/,/g, ''))

/** Processes whose executable is @p exe (a full path), by path: the app and
 *  its CLI share the image name fastag.exe. */
function running(exe) {
  const ps = `@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${exe.replace(/'/g, "''")}' }).Count`
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })
  return Number(r.stdout.trim() || 0)
}

async function shot(s, name) {
  const b64 = await s.cmd('GET', '/screenshot')
  writeFileSync(join(SCREENS, `${name}.png`), Buffer.from(b64, 'base64'))
}

/** A fresh copy of @p src in a folder of its own, named @p name. */
function copyIn(src, name) {
  const d = mkdtempSync(join(tmpdir(), 'fastag-wd-'))
  const p = join(d, name)
  copyFileSync(src, p)
  return p
}

/** Launch the app, wait for the probe, run @p fn, close the app. */
async function withApp(fn) {
  await until('the previous app to exit', () => running(APP) === 0, 30000, 300)
  const s = await Session.start(APP)
  try {
    await s.waitText(/FASTag ready/, 90000)
    // Every run's parameters, for the CLI comparison.
    await s.exec(`const orig = window.fastag.run; window.__runs = [];
      window.fastag.run = (params, onEvent) => { window.__runs.push(params); return orig(params, onEvent) }`)
    return await fn(s)
  } finally {
    await s.end()
    await until('the app to exit', () => running(APP) === 0, 30000, 300).catch(() =>
      spawnSync('taskkill', ['/F', '/IM', 'fastag.exe', '/FI', `WINDOWTITLE eq FASTag`]))
  }
}

async function view(s, id) {
  const nav = await until(`the ${id} view button`, async () => {
    const el = await s.exec(`return document.querySelector('nav[aria-label="Views"] button[data-view="' + arguments[0] + '"]')`, id)
    return el && (el[ELEMENT] ?? Object.values(el)[0])
  })
  await s.click(nav)
  await until(`the ${id} view`, () => s.exec(`const v = document.querySelector('.view[data-view="' + arguments[0] + '"]'); return !!v && !v.hidden`, id), 5000)
}

/** Pick the Setup task whose card reads @p label. */
async function task(s, label) {
  await view(s, 'setup')
  const ok = await s.exec(`const want = arguments[0];
    for (const l of document.querySelectorAll('label')) {
      if ((l.textContent || '').includes(want)) { const r = l.querySelector('input[type=radio]'); if (r) { r.click(); return true } }
    }
    return false`, label)
  assert.ok(ok, `no task "${label}" on Setup`)
}

async function chooseInput(s, path) {
  await s.exec('const p = arguments[0]; window.fastag.pickInput = async () => p', path)
  await s.click(await s.button('Choose file…'))
}

/** Run the CLI itself with the argv the app built for its last run, writing
 *  to @p out instead; the app's own command_line (fastag.rs) builds it. */
async function cliTwin(s, out) {
  const params = await s.exec('return window.__runs[window.__runs.length - 1]')
  const argv = await s.execAsync('const [p, done] = arguments; window.fastag.commandLine(p).then(done, (e) => done({ error: String(e) }))', params)
  assert.ok(Array.isArray(argv), JSON.stringify(argv))
  const args = argv.slice(1)
  const i = args.indexOf('-out')
  assert.ok(i >= 0, `no -out in ${JSON.stringify(argv)}`)
  args[i + 1] = out
  const r = spawnSync(CLI, args, { encoding: 'utf8', env: cliEnv(), cwd: dirname(out), windowsHide: true })
  assert.equal(r.status, 0, `the CLI twin exited ${r.status}: ${(r.stderr || '').slice(-1500)}`)
  return { argv, args }
}

/** Tags TSVs equal apart from provenance comment lines (# ... lines naming
 *  paths, dates or the command). */
function sameTags(a, b) {
  const body = (p) => readFileSync(p, 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('#'))
  const x = body(a)
  const y = body(b)
  if (x.length !== y.length) return `line counts differ: ${x.length} vs ${y.length}`
  for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return `line ${k + 1} differs:\n${x[k]}\n${y[k]}`
  return null
}

test('probe: the installed app runs its bundled CLI', { timeout: 180000 }, () =>
  withApp(async (s) => {
    const info = await s.execAsync('const done = arguments[arguments.length - 1]; window.fastag.probe().then(done, (e) => done({ error: String(e) }))')
    record.steps.probe = info
    assert.equal(info.ok, true, JSON.stringify(info))
    assert.equal(info.source, 'bundled', JSON.stringify(info))
    assert.equal(info.version, process.env.E2E_VERSION)
    await shot(s, '01-setup-ready')
  }))

for (const [kind, env, name] of [
  ['mzML', 'E2E_MZML', 'ecoli.mzML'],
  ['MGF', 'E2E_MGF', 'ecoli.mgf']
]) {
  test(`export tags (${kind}): run with defaults, the Tags table, the CLI's own output`, { timeout: 600000 }, () =>
    withApp(async (s) => {
      await task(s, 'Export tags')
      const input = copyIn(process.env[env], name)
      await chooseInput(s, input)
      await s.click(await s.button(`Run on ${name}`))
      const m = await s.waitText(/Showing ([\d,]+) of ([\d,]+)/, 480000)
      const out = tagsOf(input)
      assert.ok(existsSync(out), `${out} was not written`)
      const rows = readFileSync(out, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#')).length - 1
      assert.ok(rows > 0, 'the run wrote no tags')
      assert.equal(count(m[2]), rows, 'the table total is not the row count of the file')
      await shot(s, `02-tags-${kind}`)
      const twin = join(dirname(input), 'cli-twin.tags.tsv')
      const { argv } = await cliTwin(s, twin)
      const diff = sameTags(out, twin)
      record.steps[`export-${kind}`] = { rows, argv, identical: diff === null, diff }
      assert.equal(diff, null, diff)
      if (kind === 'mzML') {
        // The spectrum inspector on the first tagged row.
        const row = await until('the first row', async () => {
          const el = await s.exec("return document.querySelector('.rt-rows .rt-row')")
          return el && (el[ELEMENT] ?? Object.values(el)[0])
        })
        const spectrum = await s.exec("return document.querySelector('.rt-rows .rt-row [role=gridcell]').getAttribute('title')")
        await s.click(row)
        await s.click(await s.button('Open in Spectrum'))
        let last = ''
        const verdict = await until('the ladder', async () => {
          const v = await s.exec(`const v = document.querySelector('[data-testid=ladder-verdict]');
            const p = document.querySelector('.sp[role=region]');
            return { verdict: v ? v.textContent : '', text: p ? p.innerText.replace(/\\s+/g, ' ').slice(0, 800) : '(no Spectrum panel)' }`)
          last = v.text
          return v.verdict
        }, 90000, 200).catch((e) => { throw new Error(`${e.message}; the panel shows: ${last}`) })
        assert.match(verdict, /^on \d+ of \d+ positions within the run's tolerance$/, verdict)
        assert.equal(await s.exec("return document.querySelector('.sp-head h2').textContent"), spectrum)
        record.steps.spectrum = { spectrum, verdict }
        await shot(s, '03-spectrum-inspector')
      }
    }))
}

test('characterize: species, digest, label reports and the Overview', { timeout: 900000 }, () =>
  withApp(async (s) => {
    await task(s, 'Characterize a run')
    const input = copyIn(process.env.E2E_MZML, 'char.mzML')
    await chooseInput(s, input)
    await shot(s, '04-characterize-setup')
    // A fresh install has the taxonomy dumps but not the k-mer index (a
    // separate release asset): the species survey stops with exit 6 and the
    // failure banner must quote FASTag's reason. Then the index goes where
    // that reason says, as a user would put it, and the run is repeated.
    const taxDir = join(dirname(APP), 'resources', 'fastag', 'share', 'FASTag', 'taxonomy')
    const taxdb = process.env.E2E_TAXDB
    if (taxdb && !existsSync(join(taxDir, basename(taxdb)))) {
      await s.click(await s.button('Run on char.mzML', 120000))
      const banner = await until('the failure banner', () => s.exec("const b = document.querySelector('.failure[role=alert]'); return b ? b.innerText : ''"), 300000, 300)
      await shot(s, '05-characterize-no-taxdb')
      record.steps.characterizeNoTaxdb = banner.slice(0, 1500)
      assert.match(banner, /FASTag.s reason/, banner)
      assert.match(banner, /no taxdb/, banner)
      copyFileSync(taxdb, join(taxDir, basename(taxdb)))
      await view(s, 'setup')
    }
    await s.click(await s.button('Run on char.mzML', 120000))
    await until('the Overview', () => s.exec(`const t = [...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.trim() === 'Overview');
      return !!t && t.getAttribute('aria-selected') === 'true' && !!document.querySelector('.view[data-view="results"]:not([hidden])')`), 600000, 500)
      .catch(async (e) => {
        await shot(s, '06-overview-missing').catch(() => {})
        const body = await s.bodyText().catch(() => '')
        record.steps.characterize = { missing: body.replace(/\s+/g, ' ').slice(0, 3000) }
        throw new Error(`${e.message}; the app shows: ${body.replace(/\s+/g, ' ').slice(0, 1500)}`)
      })
    const overview = await s.exec("const p = document.querySelector('[role=tabpanel]:not([hidden])'); return p ? p.innerText : ''")
    await shot(s, '06-overview')
    const tabs = await s.exec("return [...document.querySelectorAll('[role=tab]')].map((t) => t.textContent.trim())")
    record.steps.characterize = { tabs, overview: overview.slice(0, 1500) }
    assert.match(overview, /Overview of/)
    const dir = dirname(input)
    const written = readdirSync(dir)
    record.steps.characterize.files = written
    for (const kind of ['digest', 'label']) assert.ok(written.some((f) => f.includes(kind) && f.endsWith('.tsv')), `no ${kind} report next to the input: ${written.join(', ')}`)
    // Each report tab renders.
    for (const want of tabs.filter((t) => t !== 'Overview')) {
      await s.exec(`const t = [...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.trim() === arguments[0]); t && t.click()`, want)
      await until(`the ${want} tab`, () => s.exec(`const t = [...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.trim() === arguments[0]); return t && t.getAttribute('aria-selected') === 'true'`, want), 10000)
      const text = await until(`the ${want} panel`, async () => {
        const t = await s.exec("const p = document.querySelector('[role=tabpanel]:not([hidden])'); return p ? p.innerText.trim() : ''")
        return t.length > 20 && t
      }, 30000, 200)
      record.steps.characterize[`tab:${want}`] = text.slice(0, 300)
      await shot(s, `07-report-${want.replace(/[^A-Za-z0-9]+/g, '_')}`)
    }
  }))

test('refusal: a file FASTag refuses is blocked before the run, with its reason', { timeout: 300000 }, () =>
  withApp(async (s) => {
    await task(s, 'Export tags')
    // DIA spectra: FASTag refuses them (exit 11) and says why.
    const input = copyIn(process.env.E2E_REFUSED, 'dia_like.mzML')
    const d = dirname(input)
    const r = spawnSync(CLI, ['-in', input, '-out', join(d, 'cli.tsv')], { encoding: 'utf8', env: cliEnv(), windowsHide: true })
    const cliText = (r.stdout || '') + (r.stderr || '')
    assert.notEqual(r.status, 0, 'the CLI accepted the DIA input')
    await chooseInput(s, input)
    // The GUI asks FASTag's probe before a run: a file it would refuse is a
    // "Blocks the run" check quoting FASTag's classification, Run stays
    // disabled, and the DIAspeXtract command is offered.
    const block = await until('the raw-DIA check', () => s.exec(`const f = document.querySelector('li.check-block[data-check="raw-dia"]');
      return f ? f.innerText : ''`), 120000, 300)
    await shot(s, '08-refusal')
    const runEnabled = !!(await s.buttonNow('Run on dia_like.mzML'))
    const reason = cliText.split(/\r?\n/).map((l) => l.trim()).filter((l) => / is raw DIA/.test(l)).pop() || ''
    record.steps.refusal = { cliExit: r.status, reason, block: block.slice(0, 1500), runEnabled }
    assert.equal(r.status, 11, `the CLI exited ${r.status}, not 11 (refused): ${cliText.slice(-800)}`)
    assert.ok(reason, `no refusal message in the CLI's output: ${cliText.slice(-800)}`)
    assert.equal(runEnabled, false, 'Run is enabled for a file FASTag refuses')
    // The same classification as FASTag's refusal: windows and median width.
    const m = /cycle of (\d+) isolation windows \(median ([\d.]+) Th/.exec(reason)
    assert.ok(m, `unexpected refusal message: ${reason}`)
    for (const w of [`${m[1]} `, `${m[2]} Th`, 'DIAspeXtract']) assert.ok(block.includes(w), `the raw-DIA check does not show "${w}" from FASTag's refusal "${reason}"; it shows: ${block}`)
  }))
