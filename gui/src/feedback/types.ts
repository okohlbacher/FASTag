// The shapes of a feedback report (src-tauri/src/feedback.rs; the local
// schema is schema/report.schema.json, the public export's
// schema/feedback-public.schema.json).

export type FeedbackKind = 'bug' | 'ui' | 'idea' | 'question'
export type CaptureStatus = 'ok' | 'degraded' | 'failed' | 'removed' | 'none'
export type CaptureMethod = 'native' | 'dom' | 'none'
export type ShapeType = 'rect' | 'arrow' | 'pen' | 'text' | 'redact'
export type ReportStatus = 'saved' | 'handoff_opened' | 'submitted'

/// A parameter of the allow-list: a typed scalar, or a path as its role and
/// extension (never the path).
export type ParamValue = null | boolean | number | string | { role: string; ext?: string }

export interface AppInfo {
  version: string
  commit: string
  dirty: boolean | null
  build_date: string | null
  channel: 'release' | 'prerelease' | 'dev' | 'e2e'
}

export interface EngineInfo {
  version: string | null
  source: 'env' | 'bundled' | 'path' | 'missing' | 'unknown'
  bin_size: number | null
  ok: boolean
}

export interface PlatformInfo {
  os: 'macos' | 'windows' | 'linux' | 'other'
  os_version: string
  arch: string
  webview: 'wkwebview' | 'webview2' | 'webkitgtk' | 'browser'
  webview_version: string
  locale: string
  display_scale: number
}

export interface WindowInfo {
  width: number
  height: number
  dpr: number
  theme: 'light' | 'dark'
  theme_setting: 'system' | 'light' | 'dark'
  zoom: number
}

export interface ViewInfo {
  view: string
  workflow: string | null
  tab: string | null
  dialog: string | null
  mode: 'single' | 'batch'
  help_open: boolean
}

export interface RunInfo {
  id: string | null
  status: 'none' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  exit_code: number | null
  phase: string | null
  message: string | null
  duration_ms: number | null
  argv: string[]
  workflow: string | null
  input: { ext: string; size: number | null; mtime_utc: string | null } | null
}

export interface LogEntry {
  level: 'error' | 'warn'
  text: string
  t: number
}

export interface CaptureInfo {
  status: CaptureStatus
  method: CaptureMethod
  api: string | null
  error: string | null
  width: number
  height: number
  scale: number
  attempt_id: string
  captured_utc: string
}

export interface Annotation {
  n: number
  type: ShapeType
  px: number[]
  text: string | null
}

export interface Share {
  screenshot: boolean
  diagnostics: boolean
  log: boolean
}

/// What feedback_save is sent: the report without the backend's fields.
export interface FeedbackDraft {
  kind: FeedbackKind
  title: string
  description: string
  steps: string
  expected: string
  actual: string
  app: AppInfo
  engine: EngineInfo
  platform: PlatformInfo
  window: WindowInfo
  view: ViewInfo
  params: Record<string, ParamValue>
  run: RunInfo | null
  log: LogEntry[]
  capture: CaptureInfo
  annotations: Annotation[]
  share: Share
  consent_text_version: string
}

/// report.json: the draft and the backend's fields.
export interface FeedbackReport extends FeedbackDraft {
  schema: 'fastag-feedback/1'
  id: string
  created_utc: string
  tz_offset_min: number
  status: ReportStatus
  issue_url: string | null
}

/// feedback_capture's reply: the native snapshot or why there is none.
export interface NativeCapture {
  status: 'ok' | 'failed'
  method: 'native' | 'none'
  api: string | null
  width: number
  height: number
  scale: number
  error: string | null
  png: Uint8Array | null
}

/// feedback_platform's reply. home and user only feed the log scrubber.
export interface FeedbackPlatform {
  os: PlatformInfo['os']
  os_version: string
  arch: string
  webview: PlatformInfo['webview']
  webview_version: string
  display_scale: number
  engine_source: string
  engine_bin_size: number | null
  home: string | null
  user: string | null
}

export interface FeedbackSaved {
  id: string
  folder: string
  created_utc: string
  status: ReportStatus
}

export interface FeedbackSummary {
  id: string
  folder: string
  created_utc: string
  kind: FeedbackKind
  title: string
  status: ReportStatus
  issue_url: string | null
  screenshot: boolean
  zip: string | null
  bytes: number
}

export interface FeedbackExported {
  zip: string
  // export.json as it is in the zip: the preview shows it, Copy diagnostics copies it.
  json: string
  image: { bytes: number; width: number; height: number } | null
  // The request number this zip was built for (feedback.rs export_ordered):
  // Reveal shows the zip of this very request, or refuses.
  seq: number
}

export type Include = Share

/// The feedback part of the window.fastag bridge (FastagApi in ../types.ts).
export interface FeedbackApi {
  // A native snapshot of this window's visible viewport (status failed with
  // the reason where there is none: the DOM rasteriser takes over).
  feedbackCapture: () => Promise<NativeCapture>
  feedbackPlatform: () => Promise<FeedbackPlatform>
  // The record of the run whose output @p out is on screen (redacted argv).
  feedbackRun: (out: string | null) => Promise<RunInfo | null>
  // Writes the local report; nothing leaves the machine.
  feedbackSave: (draft: FeedbackDraft, png: Uint8Array | null) => Promise<FeedbackSaved>
  feedbackList: () => Promise<FeedbackSummary[]>
  feedbackDelete: (id: string) => Promise<void>
  feedbackDeleteAll: () => Promise<number>
  // With @p seq (FeedbackExported.seq): that export's zip, or a refusal
  // once another export replaced it.
  feedbackReveal: (id: string, seq?: number) => Promise<void>
  // The public export: export-<n>/<id>.feedback.zip (one file per accepted export) and its export.json.
  // @p seq numbers the request, increasing (nextExportSeq): the backend
  // refuses one older than the export its zip holds.
  feedbackExport: (id: string, include: Include, seq?: number) => Promise<FeedbackExported>
  feedbackSetStatus: (id: string, status: ReportStatus, issueUrl?: string | null) => Promise<void>
  // Opens the issue form with title, report id and kind (text fields only).
  openFeedbackIssue: (draft: { title: string; reportId: string; kind: FeedbackKind }) => Promise<boolean>
}
