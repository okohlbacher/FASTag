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
//   E2E_OUT      a folder for tauri-driver-<mode>.json, the recorded gates
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { once } from 'node:events'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Session, until } from './wd.mjs'

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

test('cancel leaves no truncated output', { timeout: 300000 }, () =>
  withApp(async (s) => {
    // The stub keeps running on a .slow. input; the real CLI on the small
    // fixture may finish first, and then its output must be whole.
    const input = spectra(MODE === 'stub' ? 'run02.slow.mzML' : 'run02.mzML')
    const out = tagsOf(input)
    await chooseInput(s, input)
    await s.click(await s.button(`Run on ${basename(input)}`))
    const cancel = await until('Cancel, or the finished table', async () => {
      const c = await s.buttonNow('Cancel')
      if (c) return c
      return /Showing [\d,]+ of/.test(await s.bodyText()) ? 'finished' : null
    }, 240000)
    // The stub's partial table is on disk before the Cancel: the cleanup
    // then has something to remove, and the banner says so.
    if (MODE === 'stub') await until(`the partial ${basename(out)}`, () => existsSync(out), 30000)
    if (cancel !== 'finished') await s.click(cancel).catch(() => {})
    const end = await until('the run to end', async () => {
      const l = await lastRun(s)
      if (/^Cancelled/m.test(l) || /partial outputs removed/.test(l)) return 'cancelled'
      if (/Showing [\d,]+ of/.test(await s.bodyText())) return 'finished'
      return null
    }, 60000)
    if (MODE === 'stub') {
      assert.equal(end, 'cancelled')
      assert.match(await lastRun(s), /partial outputs removed/)
    }
    if (end === 'cancelled') assert.ok(!existsSync(out), `${out} survived the cancel`)
    else assert.equal(lines(out) - 1, fullRows, 'a finished run after Cancel wrote a different table')
    gates.cancel = end
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

test('IPC: every log line of a chatty run reaches the webview; message rate recorded', { timeout: 300000, skip: MODE !== 'stub' && 'the stub only' }, () =>
  withApp(async (s) => {
    await s.exec(
      "window.__wd = { n: 0, t0: 0, t1: 0 }; window.fastag.onLog(() => { const w = window.__wd; const t = performance.now(); if (!w.n) w.t0 = t; w.t1 = t; w.n++ })"
    )
    const input = spectra('run03.chatty.mzML')
    await chooseInput(s, input)
    await s.click(await s.button('Run on run03.chatty.mzML'))
    await s.waitText(/Showing 1 of 1/, 120000)
    const w = await until('the log to settle', async () => {
      const a = await s.exec('return window.__wd')
      await new Promise((r) => setTimeout(r, 300))
      const b = await s.exec('return window.__wd')
      return a.n === b.n && b.n > 0 ? b : null
    })
    assert.ok(w.n >= 5000, `only ${w.n} log messages arrived`)
    const secs = (w.t1 - w.t0) / 1000
    gates.ipc = { messages: w.n, seconds: Number(secs.toFixed(3)), perSecond: Math.round(w.n / Math.max(secs, 1e-3)) }
  }))
