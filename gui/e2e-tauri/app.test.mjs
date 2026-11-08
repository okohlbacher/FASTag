// tauri-driver + WebKitWebDriver specs against the real debug app on Linux
// (GUI-DESIGN section 9, layer 4; P1). Limited to what runs inside the
// webview: probe, run, table, cancel, time to first rows on a generated 1M
// file, the IPC message rate of a chatty run, and (P4) a row opened in the
// Spectrum tab. Native dialogs cannot be
// driven, so a spec replaces only window.fastag.pickInput / pickResults with
// a function that returns its path; every other call goes through the real
// invoke, the real Rust backend and the CLI.
//
// Environment (run.sh sets it):
//   FASTAG_APP   the app binary (src-tauri/target/debug/fastag)
//   E2E_CLI      stub: the app runs gui/testing/stub-fastag/FASTag (FASTAG_BIN)
//                real: the app runs its bundled resources/fastag CLI
//   E2E_VERSION  real mode: the version the bundled CLI must report
//   E2E_MZML     real mode: the spectra to run (the public E. coli fixture)
//   E2E_CANCEL_COPIES  real mode: how many times the cancel spec repeats
//                E2E_MZML's spectra, so the run is still going at the Cancel
//                (default 500: 69,500 spectra, about 570 MB, at -threads 1)
//   E2E_BIN_PREFIX  optional: the probe must report a bundled CLI under this
//                path (the tarball smoke: the app found its own resources)
//   E2E_ONLY     optional: run only the specs whose name matches (run.sh)
//   E2E_OUT      a folder for tauri-driver-<mode>.json, the recorded gates
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, createWriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { once } from 'node:events'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Session, until } from './wd.mjs'
import { repeatMzML } from './mzml.mjs'

const APP = process.env.FASTAG_APP
const MODE = process.env.E2E_CLI === 'real' ? 'real' : 'stub'
const OUT = process.env.E2E_OUT || tmpdir()
const HERE = dirname(fileURLToPath(import.meta.url))
assert.ok(APP && existsSync(APP), `FASTAG_APP (${APP}) is not a file`)

const gates = { mode: MODE, recorded: new Date().toISOString() }
after(() => {
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, `tauri-driver-${MODE}.json`), JSON.stringify(gates, null, 2) + '\n')
})

const lines = (p) => readFileSync(p, 'utf8').split('\n').filter((l) => l !== '').length
const tagsOf = (input) => join(dirname(input), basename(input).replace(/\.[^.]+$/, '') + '.tags.tsv')
const count = (s) => Number(s.replace(/,/g, ''))

/** A fresh copy of the spectra in a folder of its own, named @p name. */
function spectra(name) {
  const d = mkdtempSync(join(tmpdir(), 'fastag-wd-'))
  const p = join(d, name)
  if (MODE === 'real') copyFileSync(process.env.E2E_MZML, p)
  else writeFileSync(p, 'spectra (the stub reads nothing)\n')
  return p
}

// The single-instance plugin hands a second launch to the first one over
// D-Bus and exits, so each spec waits until the previous app is gone.
const appAlive = () => spawnSync('pgrep', ['-f', '--', APP]).status === 0

/** Launch the app, wait for the probe, run @p fn, close the app. */
async function withApp(fn) {
  await until('the previous app to exit', () => !appAlive(), 30000, 200)
  const s = await Session.start(APP)
  try {
    await s.waitText(/FASTag ready/, 60000)
    return await fn(s)
  } finally {
    await s.end()
    await until('the app to exit', () => !appAlive(), 30000, 200).catch(() => spawnSync('pkill', ['-9', '-f', '--', APP]))
  }
}

async function chooseInput(s, path) {
  await s.exec('const p = arguments[0]; window.fastag.pickInput = async () => p', path)
  await s.click(await s.button('Choose file…'))
}

/** Go to one of the shell's views (P2a) through the top bar, as a user
 *  does: the other views stay in the DOM but hidden, and their buttons cannot
 *  be clicked. */
async function view(s, id) {
  const nav = await until(`the ${id} view button`, async () => {
    const el = await s.exec(`return document.querySelector('nav[aria-label="Views"] button[data-view="' + arguments[0] + '"]')`, id)
    return el && (el['element-6066-11e4-a52f-4a6976a6e3b5'] ?? Object.values(el)[0])
  })
  await s.click(nav)
  await until(`the ${id} view`, () => s.exec(`const v = document.querySelector('.view[data-view="' + arguments[0] + '"]'); return !!v && !v.hidden`, id), 5000)
}

/** Start the session from FASTag's defaults through Setup's "Starting
 *  from" select, as a user does (P2a D1: the app lands on "Characterize a
 *  run", whose run opens on its digest report, not the tags table). The run
 *  and IPC specs check what a run from the defaults writes and shows, as the
 *  e2e-web smoke spec does with ?start=defaults. React's onChange on a select
 *  listens to the change event, so the value goes through the native setter
 *  and a bubbling change. */
async function fromDefaults(s) {
  await until('the Starting from select', () => s.exec("const e = document.getElementById('origin'); return !!e && e.getClientRects().length > 0"))
  await s.exec(`const e = document.getElementById('origin')
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(e, '')
    e.dispatchEvent(new Event('change', { bubbles: true }))`)
  await until('the session to start from FASTag defaults', () => s.exec("const e = document.getElementById('origin'); return !!e && e.value === '' && !document.getElementById('p-digest_out')?.value"), 5000)
}

const lastRun = (s) => s.exec("const e = document.querySelector('.last-run'); return e ? e.innerText : ''")

test('probe: the app finds its CLI and reads its version', { timeout: 120000 }, () =>
  withApp(async (s) => {
    const info = await s.execAsync(
      'const done = arguments[arguments.length - 1]; window.fastag.probe().then(done, (e) => done({ error: String(e) }))'
    )
    assert.equal(info.ok, true, JSON.stringify(info))
    if (MODE === 'stub') assert.equal(info.version, '0.0.0-stub')
    else assert.equal(info.version, process.env.E2E_VERSION)
    const prefix = process.env.E2E_BIN_PREFIX
    if (prefix) {
      assert.equal(info.source, 'bundled', JSON.stringify(info))
      assert.ok(info.bin.startsWith(prefix), `the app runs ${info.bin}, not a CLI under ${prefix}`)
      gates.bin = info.bin
    }
    gates.webview = await s.exec('return navigator.userAgent')
  }))

let fullRows = -1
test('run: Choose file, Run, and the table shows what the CLI wrote', { timeout: 300000 }, () =>
  withApp(async (s) => {
    await fromDefaults(s)
    const input = spectra('run01.mzML')
    await chooseInput(s, input)
    await s.click(await s.button('Run on run01.mzML'))
    const m = await s.waitText(/Showing ([\d,]+) of ([\d,]+)/, 240000)
    const out = tagsOf(input)
    assert.ok(existsSync(out), `${out} was not written`)
    fullRows = lines(out) - 1
    assert.ok(fullRows > 0, 'the run wrote no tags')
    assert.equal(count(m[2]), fullRows, 'the table total is not the row count of the file')
    const first = await s.exec("const r = document.querySelector('.rt-rows [role=row]'); return r ? r.innerText : ''")
    assert.match(first, /scan=/)
    if (MODE === 'stub') assert.equal(fullRows, 1)
  }))

// The CLI processes of a run: the stub (a shell script) or the bundled CLI.
const CLI_PATTERN = MODE === 'stub' ? 'testing/stub-fastag/FASTag' : 'resources/fastag/bin/FASTag'
const cliAlive = () => spawnSync('pgrep', ['-f', '--', CLI_PATTERN]).status === 0

/** Open the Performance section and set -threads to @p n through the form. */
async function setThreads(s, n) {
  await s.exec(`for (const b of document.querySelectorAll('summary.disclosure')) {
      if ((b.querySelector('.sec-title') || {}).textContent === 'Performance' && b.getAttribute('aria-expanded') !== 'true') b.click()
    }`)
  await until('the threads field', () => s.exec("return !!document.getElementById('p-threads')"), 10000)
  // A React controlled input: the native setter, then the input event.
  await s.exec(`const i = document.getElementById('p-threads');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, arguments[0]);
    i.dispatchEvent(new Event('input', { bubbles: true }))`, String(n))
  await until(`threads = ${n}`, () => s.exec("return document.getElementById('p-threads').value === arguments[0]", String(n)), 5000)
}

test('cancel: a Cancel mid-run ends the CLI and leaves no truncated output', { timeout: 300000 }, () =>
  withApp(async (s) => {
    // The stub keeps running on a .slow. input. The real CLI reads the
    // 139-spectrum fixture in well under a second, so it gets the fixture's
    // spectra repeated, on one thread: still running at the Cancel.
    let input
    if (MODE === 'stub') input = spectra('run02.slow.mzML')
    else {
      input = join(mkdtempSync(join(tmpdir(), 'fastag-wd-')), 'run02.mzML')
      const copies = Number(process.env.E2E_CANCEL_COPIES || 500)
      gates.cancelSpectra = await repeatMzML(process.env.E2E_MZML, input, copies)
    }
    const out = tagsOf(input)
    try {
      await chooseInput(s, input)
      if (MODE === 'real') await setThreads(s, 1)
      assert.ok(!cliAlive(), `a ${CLI_PATTERN} process is running before the run`)
      await s.click(await s.button(`Run on ${basename(input)}`))
      const cancel = await s.button('Cancel', 60000)
      // The CLI has opened -out (FASTag.cpp opens it before the first
      // spectrum): the cleanup then has something to remove.
      await until(`the partial ${basename(out)}`, () => existsSync(out), 60000)
      assert.ok(cliAlive(), 'the CLI is not running when Cancel is clicked')
      const t0 = Date.now()
      await s.click(cancel)
      const end = await until('the run to end', async () => {
        const l = await lastRun(s)
        if (/^Cancelled/m.test(l) || /partial outputs removed/.test(l)) return 'cancelled'
        if (/Showing [\d,]+ of/.test(await s.bodyText())) return 'finished'
        return null
      }, 60000)
      assert.equal(end, 'cancelled', `the run finished before the Cancel took effect${MODE === 'real' ? ': raise E2E_CANCEL_COPIES' : ''}`)
      assert.match(await lastRun(s), /partial outputs removed/)
      assert.ok(!existsSync(out), `${out} survived the cancel`)
      await until(`no ${CLI_PATTERN} process`, () => !cliAlive(), 5000, 100)
      gates.cancel = { end, cliGoneMs: Date.now() - t0 }
    } finally {
      rmSync(dirname(input), { recursive: true, force: true })
    }
  }))

test('table: time to first rows on a generated 1M-row file (recorded)', { timeout: 300000 }, async () => {
  const src = readFileSync(join(HERE, '..', 'e2e-web', 'fixtures', 'ecoli.tags.tsv'), 'utf8').trimEnd().split('\n')
  const [head, ...rows] = src
  const d = mkdtempSync(join(tmpdir(), 'fastag-wd-1m-'))
  const big = join(d, 'big.tags.tsv')
  const w = createWriteStream(big)
  w.write(head + '\n')
  const N = 1_000_000
  for (let i = 0; i < N; i++) {
    const r = rows[i % rows.length].split('\t')
    r[0] = `controllerType=0 controllerNumber=1 scan=${100000 + i}`
    if (!w.write(r.join('\t') + '\n')) await once(w, 'drain')
  }
  w.end()
  await once(w, 'finish')
  await withApp(async (s) => {
    await s.exec('const p = arguments[0]; window.fastag.pickResults = async () => p', big)
    await view(s, 'results') // P2a: "Open a tags TSV..." is in the empty Results view
    const open = await s.button('Open a tags TSV…')
    const t0 = Date.now()
    await s.click(open)
    await until('the first row', () => s.exec("return !!document.querySelector('.rt-rows [role=row]')"), 60000, 10)
    const firstRows = Date.now() - t0
    await s.waitText(/Showing 1,000,000 of 1,000,000/, 120000)
    gates.firstRowsMs1M = firstRows
    gates.fullCountMs1M = Date.now() - t0
  })
})

// P4 PR a (GUI-DESIGN 3 S5, 9 layer 4, 10 P4): open a row of the Tags table
// in the Spectrum tab through the real backend: spectrum_support asks the CLI's
// --helphelp, spectrum_peaks runs `-dump_spectrum` and the ladder is drawn on
// the peaks it printed. The stub serves the G1 CLI's real --helphelp and
// dumps (src/fixtures/cli/v112-ecoli-dump); the real CLI dumps the E. coli
// fixture, whose CLI-default tags e2e-web/fixtures/ecoli.tags.tsv are. A real
// CLI without -dump_spectrum (before G1 ships) must hide the tab instead.
test('spectrum: a row of the Tags table opens in the Spectrum tab with its ladder on the dumped peaks', { timeout: 300000 }, async () => {
  const d = mkdtempSync(join(tmpdir(), 'fastag-wd-spectrum-'))
  const tags = join(d, 'run01.tags.tsv')
  const input = join(d, 'run01.mzML')
  copyFileSync(join(HERE, '..', 'e2e-web', 'fixtures', 'ecoli.tags.tsv'), tags)
  if (MODE === 'real') copyFileSync(process.env.E2E_MZML, input)
  else writeFileSync(input, 'spectra (the stub reads nothing)\n')
  try {
    await withApp(async (s) => {
      const support = await s.execAsync('const done = arguments[arguments.length - 1]; window.fastag.spectrumSupport().then(done, (e) => done({ error: String(e) }))')
      gates.spectrumSupport = support
      if (MODE === 'stub') assert.equal(support.supported, true, JSON.stringify(support))
      await s.exec('const p = arguments[0]; window.fastag.pickResults = async () => p', tags)
      await view(s, 'results')
      await s.click(await s.button('Open a tags TSV…'))
      await s.waitText(/Showing 2,028 of 2,028/, 60000)
      const row = await until('the first row', async () => {
        const el = await s.exec("return document.querySelector('.rt-rows .rt-row')")
        return el && (el['element-6066-11e4-a52f-4a6976a6e3b5'] ?? Object.values(el)[0])
      })
      const spectrum = await s.exec("return document.querySelector('.rt-rows .rt-row [role=gridcell]').getAttribute('title')")
      await s.click(row)
      if (!support.supported) {
        // A CLI without -dump_spectrum: no tab, and the row action says so.
        assert.equal(await s.exec("return [...document.querySelectorAll('[role=tab]')].some((t) => t.textContent === 'Spectrum')"), false)
        assert.match(await s.bodyText(), /Spectrum view needs FASTag 1\.17 or later/)
        return
      }
      await s.click(await s.button('Open in Spectrum'))
      // No run of this app wrote the table: its input is located.
      await s.exec('const p = arguments[0]; window.fastag.pickInput = async () => p', input)
      const t0 = Date.now()
      await s.click(await s.button('Locate input…'))
      // The ladder takes about 130 ms. On WebKitGTK the driver's click on
      // Locate input… was seen to be lost now and then (the panel then waits
      // for an input forever, the ladder never comes): while the panel still
      // asks which file, the click is repeated, and counted. Any other state
      // (Reading…, an error) is the app's and is waited on, then reported.
      const panel = () =>
        s.exec(`const v = document.querySelector('[data-testid=ladder-verdict]');
          const p = document.querySelector('.sp[role=region]');
          return { verdict: v ? v.textContent : '', asking: !!(p && p.querySelector('.empty-state')), text: p ? p.innerText.replace(/\\s+/g, ' ').slice(0, 1500) : '(no Spectrum panel)' }`)
      let reclicks = 0
      let asked = Date.now()
      let last = null
      const verdict = await until(
        'the ladder',
        async () => {
          last = await panel()
          if (last.verdict) return last.verdict
          if (!last.asking) asked = Date.now()
          else if (Date.now() - asked > 3000 && reclicks < 3) {
            reclicks += 1
            asked = Date.now()
            const b = await s.buttonNow('Locate input…')
            if (b) await s.click(b)
          }
          return ''
        },
        60000,
        100
      ).catch((e) => {
        throw new Error(`${e.message}; after ${reclicks} repeated Locate clicks the panel shows: ${last ? last.text : '(nothing read)'}`)
      })
      gates.spectrumMs = Date.now() - t0
      gates.spectrumLocateReclicks = reclicks
      assert.match(verdict, /^on \d+ of \d+ positions within the run's tolerance$/, verdict)
      assert.equal(await s.exec("return document.querySelector('.sp-head h2').textContent"), spectrum)
      const on = Number(/^on (\d+)/.exec(verdict)[1])
      assert.equal(await s.exec("return document.querySelectorAll('.sp-svg [data-peak=ladder]').length"), on)
      // Every tag of the spectrum lies on its peaks.
      const off = await s.exec("return [...document.querySelectorAll('.sp-tags-table tbody tr')].filter((r) => /not on the peaks/.test(r.textContent)).length")
      assert.equal(off, 0)
      // A second dump of the same spectrum comes from the backend's LRU.
      const again = await s.execAsync(
        'const [i, id, done] = arguments; window.fastag.spectrumPeaks(i, id, null).then((d) => done(d.cached), (e) => done(String(e)))',
        input,
        spectrum
      )
      assert.equal(again, true)
    })
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

// Counts delivered log LINES, not messages: today every line is one
// fastag:log event through window.fastag.onLog (the pre-batching baseline).
// P1 PR a (#16) drops onLog: each run gets a Channel<RunEvent> passed to
// window.fastag.run(params, onEvent), and one {kind: 'log', lines} message
// carries every line of a 50-100 ms flush. The spec reads whichever of the
// two the app has, so it keeps counting every line after PR a lands.
test('IPC: every log line of a chatty run reaches the webview; message rate recorded', { timeout: 300000, skip: MODE !== 'stub' && 'the stub only' }, () =>
  withApp(async (s) => {
    const via = await s.exec(
      `const w = (window.__wd = { messages: 0, lines: 0, t0: 0, t1: 0 })
      const seen = (n) => {
        const t = performance.now()
        if (!w.messages) w.t0 = t
        w.t1 = t
        w.messages++
        w.lines += n
      }
      const f = window.fastag
      if (typeof f.onLog === 'function') {
        f.onLog((p) => seen(Array.isArray(p) ? p.length : p && Array.isArray(p.lines) ? p.lines.length : 1))
        return 'fastag:log events (onLog)'
      }
      if (typeof f.run === 'function' && f.run.length >= 2) {
        const run = f.run
        f.run = (params, onEvent, ...rest) =>
          run(params, (e) => {
            if (e && e.kind === 'log') seen(Array.isArray(e.lines) ? e.lines.length : 1)
            return onEvent(e)
          }, ...rest)
        return 'the run Channel (RunEvent log)'
      }
      return null`
    )
    assert.ok(via, 'neither window.fastag.onLog nor a run(params, onEvent) Channel: point this spec at the log API')
    await fromDefaults(s)
    const input = spectra('run03.chatty.mzML')
    await chooseInput(s, input)
    await s.click(await s.button('Run on run03.chatty.mzML'))
    await s.waitText(/Showing 1 of 1/, 120000)
    const w = await until('the log to settle', async () => {
      const a = await s.exec('return window.__wd')
      await new Promise((r) => setTimeout(r, 300))
      const b = await s.exec('return window.__wd')
      return a.lines === b.lines && b.lines > 0 ? b : null
    })
    assert.ok(w.lines >= 5000, `only ${w.lines} log lines arrived (${w.messages} messages)`)
    const secs = Math.max((w.t1 - w.t0) / 1000, 1e-3)
    gates.ipc = {
      via,
      messages: w.messages,
      lines: w.lines,
      seconds: Number(secs.toFixed(3)),
      messagesPerSecond: Math.round(w.messages / secs),
      linesPerSecond: Math.round(w.lines / secs),
      batching: w.messages === w.lines ? 'none (one event per line: the pre-batching baseline)' : 'batched'
    }
  }))
