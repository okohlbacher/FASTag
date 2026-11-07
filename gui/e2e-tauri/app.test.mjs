// tauri-driver + WebKitWebDriver specs against the real debug app on Linux
// (GUI-DESIGN section 9, layer 4; P1). Limited to what runs inside the
// webview: probe, run, table, cancel, time to first rows on a generated 1M
// file and the IPC message rate of a chatty run. Native dialogs cannot be
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
  await s.exec(`for (const b of document.querySelectorAll('button.disclosure')) {
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

// Counts delivered log LINES, not messages: today every line is one
// fastag:log event (the pre-batching baseline), and P1 PR a batches them as
// Log{lines} on a Channel, after which a message carries many lines. A
// payload that is an array, or has a `lines` array, counts its length. PR a
// must point the subscription below at its API if window.fastag.onLog goes.
test('IPC: every log line of a chatty run reaches the webview; message rate recorded', { timeout: 300000, skip: MODE !== 'stub' && 'the stub only' }, () =>
  withApp(async (s) => {
    const subscribed = await s.exec(
      `if (typeof window.fastag.onLog !== 'function') return false
      window.__wd = { messages: 0, lines: 0, t0: 0, t1: 0 }
      window.fastag.onLog((p) => {
        const w = window.__wd
        const t = performance.now()
        if (!w.messages) w.t0 = t
        w.t1 = t
        w.messages++
        w.lines += Array.isArray(p) ? p.length : p && Array.isArray(p.lines) ? p.lines.length : 1
      })
      return true`
    )
    assert.ok(subscribed, 'window.fastag.onLog is gone: point this spec at the log subscription of the Channel API (P1 PR a)')
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
      messages: w.messages,
      lines: w.lines,
      seconds: Number(secs.toFixed(3)),
      messagesPerSecond: Math.round(w.messages / secs),
      linesPerSecond: Math.round(w.lines / secs),
      batching: w.messages === w.lines ? 'none (one event per line: the pre-batching baseline)' : 'batched'
    }
  }))
