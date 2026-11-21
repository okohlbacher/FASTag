// The public export (fastag-feedback-public/1) as src-tauri/src/feedback.rs
// public_export builds it, for the test bridges (mockBridge.ts): the browser
// and e2e builds have no backend to build it. Both must agree:
// fixtures/export.golden.json is the Rust export of fixtures/draft.json
// (cargo test export_zip_and_golden_json) and this one's (export.test.ts).

import type { FeedbackReport, Include, ParamValue } from './types'

const IDENT = /^[A-Za-z0-9_.:-]{1,64}$/
const VERSION_CHARS = /^[0-9A-Za-z ._()+-]{1,64}$/
const LOCALE = /^[A-Za-z]{2,8}([_-][A-Za-z0-9]{1,8})*$/
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.+-]+)?$/
const UTC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/
const PARAM = /^[a-z][a-z0-9_]{0,63}$/

const take = (s: string, n: number): string => [...s].slice(0, n).join('')

function validParam(v: ParamValue): boolean {
  if (v === null || typeof v === 'boolean') return true
  if (typeof v === 'number') return Number.isFinite(v)
  if (typeof v === 'string') return [...v].length <= 200
  if (typeof v === 'object') {
    const keys = Object.keys(v)
    return keys.every((k) => k === 'role' || k === 'ext') && IDENT.test(v.role) && (v.ext === undefined || /^[A-Za-z0-9.]{0,16}$/.test(v.ext))
  }
  return false
}

function phaseId(s: string): string | null {
  const id = [...s.trim()]
    .map((c) => (/[A-Za-z0-9_.:-]/.test(c) ? c.toLowerCase() : '_'))
    .slice(0, 64)
    .join('')
    .replace(/^_+|_+$/g, '')
  return IDENT.test(id) ? id : null
}

export function publicExport(r: FeedbackReport, inc: Include, screenshot: boolean): Record<string, unknown> {
  const m: Record<string, unknown> = {
    schema: 'fastag-feedback-public/1',
    id: r.id,
    created_utc: r.created_utc,
    kind: r.kind,
    title: take(r.title, 120)
  }
  const truncated: string[] = []
  if (inc.diagnostics) {
    const app: Record<string, unknown> = {}
    if (SEMVER.test(r.app.version) && r.app.version.length <= 64) app.version = r.app.version
    else truncated.push('app')
    if (r.app.commit !== 'unknown') app.commit = r.app.commit
    if (r.app.dirty != null) app.dirty = r.app.dirty
    const b = r.app.build_date
    if (b && (UTC.test(b) || UTC.test(`${b}T00:00:00Z`))) app.build_date = b
    app.channel = r.app.channel
    m.app = app

    const eng: Record<string, unknown> = {}
    if (r.engine.version != null) eng.version = take(r.engine.version, 200)
    if (r.engine.source === 'bundled') eng.source = 'bundled'
    else if (r.engine.source === 'env' || r.engine.source === 'path') eng.source = 'override'
    m.engine = eng

    const p = r.platform
    const plat: Record<string, unknown> = {}
    let dropped = false
    if (p.os !== 'other') plat.os = p.os
    if (VERSION_CHARS.test(p.os_version)) plat.os_version = p.os_version
    else dropped ||= p.os_version !== ''
    if (['aarch64', 'x86_64', 'arm', 'x86'].includes(p.arch)) plat.arch = p.arch
    else dropped = true
    plat.webview = p.webview
    if (VERSION_CHARS.test(p.webview_version)) plat.webview_version = p.webview_version
    else dropped ||= p.webview_version !== ''
    if (p.locale.length <= 35 && LOCALE.test(p.locale)) plat.locale = p.locale
    else dropped ||= p.locale !== ''
    if (dropped) truncated.push('platform')
    m.platform = plat

    m.window = { width: r.window.width, height: r.window.height, dpr: r.window.dpr, theme: r.window.theme }
    const view: Record<string, unknown> = { view: r.view.view }
    for (const k of ['workflow', 'tab', 'dialog'] as const) if (r.view[k] != null) view[k] = r.view[k]
    m.view = view
    m.params = Object.fromEntries(Object.entries(r.params).filter(([k, v]) => PARAM.test(k) && validParam(v)))
    if (r.run) {
      const run: Record<string, unknown> = { status: r.run.status, exit_code: r.run.exit_code }
      const ph = r.run.phase ? phaseId(r.run.phase) : null
      if (ph) run.phase = ph
      if (r.run.message != null) run.message = take(r.run.message, 2000)
      if (r.run.duration_ms != null) run.duration_s = r.run.duration_ms / 1000
      run.argv = r.run.argv.slice(0, 200)
      m.run = run
    }
  }
  if (inc.log) m.log = r.log.slice(-50).map((l) => l.text)
  if (inc.screenshot && screenshot) {
    const c = r.capture
    m.capture = { status: c.status, method: c.method, width: c.width, height: c.height }
    m.annotations = r.annotations.length
  }
  if (truncated.length) m.truncated = truncated
  return m
}
