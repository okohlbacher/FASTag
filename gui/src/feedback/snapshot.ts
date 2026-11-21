// The state a feedback report freezes when it is asked for (skill
// gui-feedback 1): typed, allow-listed values, never scrubbed strings. The
// view as machine ids, the effective parameters from the CLI's manifest
// (paths as {role, ext}, free text dropped), the window, the build and the
// engine, the run on screen and the scrubbed log.

import manifest from '../params.generated.json'
import type { BinaryInfo } from '../types'
import { recent } from './consoleRing'
import { scrub, type ScrubHints } from './scrub'
import type { AppInfo, EngineInfo, FeedbackPlatform, LogEntry, ParamValue, PlatformInfo, RunInfo, ViewInfo, WindowInfo } from './types'

interface ManifestParam {
  name: string
  type: string
  choices?: string[]
}
const PARAMS = new Map((manifest.params as ManifestParam[]).map((p) => [p.name, p]))

/// What App knows at the moment of the report.
export interface AppState {
  view: string
  tab: string | null
  workflow: string | null
  mode: 'single' | 'batch'
  dialog: string | null
  helpOpen: boolean
  values: Record<string, unknown>
  input: string
  out: string
  running: boolean
  phase: string | null
  // The -out of the run whose results are shown (its run record).
  shownOut: string | null
  themeSetting: 'system' | 'light' | 'dark'
}

const IDENT = /^[A-Za-z0-9_.:-]{1,64}$/
const ident = (s: string | null | undefined): string | null => (s && IDENT.test(s) ? s : null)

/// The extension of a path (letters and digits only, ≤ 16), "" without one.
export function extOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot + 1).replace(/[^A-Za-z0-9]/g, '').slice(0, 16)
}

function fileRef(role: 'input' | 'output', v: unknown): ParamValue | undefined {
  if (typeof v !== 'string') return undefined
  if (v.trim() === '') return null
  const ext = extOf(v.trim())
  return ext ? { role, ext } : { role }
}

/// One value as the allow-list keeps it; undefined: dropped.
export function allowValue(name: string, v: unknown): ParamValue | undefined {
  const p = PARAMS.get(name)
  if (!p) return undefined
  switch (p.type) {
    case 'bool':
      return typeof v === 'boolean' ? v : undefined
    case 'int':
    case 'double': {
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
      return Number.isFinite(n) ? n : undefined
    }
    case 'string':
      // Only a value of the declared choices; free text never.
      return typeof v === 'string' && p.choices?.includes(v) ? v : undefined
    case 'string-list': {
      if (!p.choices || !Array.isArray(v)) return undefined
      const items = v.map(String)
      return items.every((x) => p.choices!.includes(x)) ? items.join(',').slice(0, 200) : undefined
    }
    case 'input-file':
      return fileRef('input', v)
    case 'output-file':
      return fileRef('output', v)
  }
  return undefined
}

/// The effective parameters: the form's values through the allow-list, the
/// input and -out as roles.
export function allowParams(values: Record<string, unknown>, input: string, out: string): Record<string, ParamValue> {
  const params: Record<string, ParamValue> = {}
  for (const [k, v] of Object.entries(values)) {
    if (k === 'in' || k === 'out' || !/^[a-z][a-z0-9_]{0,63}$/.test(k)) continue
    const a = allowValue(k, v)
    if (a !== undefined) params[k] = a
  }
  const i = fileRef('input', input)
  const o = fileRef('output', out)
  if (i !== undefined) params.in = i
  if (o !== undefined) params.out = o
  return params
}

export function viewInfo(s: AppState): ViewInfo {
  return {
    view: ident(s.view) ?? 'unknown',
    workflow: ident(s.workflow),
    tab: s.view === 'results' ? ident(s.tab) : null,
    dialog: ident(s.dialog),
    mode: s.mode,
    help_open: s.helpOpen
  }
}

export function windowInfo(s: AppState, w: Window = window): WindowInfo {
  const root = w.document.documentElement
  const set = root.dataset.theme
  const dark = set ? set === 'dark' : !!w.matchMedia?.('(prefers-color-scheme: dark)').matches
  const r = (x: number): number => Math.round(x * 1000) / 1000
  return {
    width: Math.round(w.innerWidth),
    height: Math.round(w.innerHeight),
    dpr: r(w.devicePixelRatio || 1),
    theme: dark ? 'dark' : 'light',
    theme_setting: s.themeSetting,
    zoom: r(w.visualViewport?.scale ?? 1)
  }
}

export function appInfo(b = __BUILD_INFO__): AppInfo {
  const commit = /^[0-9a-f]{7,40}$/.test(b.commit) ? b.commit : 'unknown'
  return { version: b.version, commit, dirty: commit === 'unknown' ? null : b.dirty, build_date: b.build_date, channel: b.channel }
}

const SOURCES = ['env', 'bundled', 'path', 'missing'] as const
export function engineInfo(bin: BinaryInfo | null, p: FeedbackPlatform | null): EngineInfo {
  const src = p?.engine_source ?? bin?.source
  return {
    version: bin?.version ?? null,
    source: (SOURCES as readonly string[]).includes(src ?? '') ? (src as EngineInfo['source']) : 'unknown',
    bin_size: p?.engine_bin_size ?? null,
    ok: !!bin?.ok
  }
}

export function platformInfo(p: FeedbackPlatform | null, w: Window = window): PlatformInfo {
  return {
    os: p?.os ?? 'other',
    os_version: p?.os_version ?? '',
    arch: p?.arch ?? '',
    webview: p?.webview ?? 'browser',
    webview_version: p?.webview_version ?? '',
    locale: (w.navigator.language || '').slice(0, 35),
    display_scale: p?.display_scale ?? (w.devicePixelRatio || 1)
  }
}

/// The scrubbed log, oldest first.
export function scrubbedLog(entries: LogEntry[] = recent(), hints: ScrubHints = {}): LogEntry[] {
  return entries.slice(-50).map((e) => ({ ...e, text: [...scrub(e.text, hints)].slice(0, 2000).join('') }))
}

/// The run on screen: the one in flight, else the record of the run whose
/// results are shown (@p record, feedbackRun).
export function runInfo(s: AppState, record: RunInfo | null): RunInfo | null {
  if (s.running) {
    const ext = extOf(s.input)
    return {
      id: null,
      status: 'running',
      exit_code: null,
      phase: s.phase ? s.phase.slice(0, 120) : null,
      message: null,
      duration_ms: null,
      argv: [],
      workflow: ident(s.workflow),
      input: s.input ? { ext, size: null, mtime_utc: null } : null
    }
  }
  return record
}
