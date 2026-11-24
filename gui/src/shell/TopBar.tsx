// The app bar (GUI-DESIGN 2 "Persistent chrome"; doc/GUI-SETUP-WIZARD.md 1):
// the v6 logo, the view switcher (Cmd+1..4), the progress pill, Search
// settings (Cmd+K), the Help toggle (Cmd+?, F1), Feedback (Cmd+Shift+F) and
// the theme.

import { useLayoutEffect, useRef, type JSX, type RefObject } from 'react'
import type { BinaryInfo } from '../types'
import type { Progress } from '../runJob'
import { VIEWS, isMac, keyText, type View } from '../setup/shortcuts'
import { THEMES, type Theme } from '../app/theme'
import { duration } from '../app/format'
import { baseName } from '../digestReport'

/// The v6 Five Peaks mark (assets/logo.svg) drawn inline, so its colours are
/// the --brand-* tokens of the chosen theme, not only of the system one.
function Logo(): JSX.Element {
  return (
    <svg className="logo" viewBox="0 0 64 64" width={22} height={22} aria-hidden="true" focusable="false">
      <g className="brand-peaks">
        <rect x="4" y="30" width="6" height="26" rx="3" />
        <rect x="16" y="20" width="6" height="36" rx="3" />
        <rect x="28" y="34" width="6" height="22" rx="3" />
        <rect x="42" y="40" width="6" height="16" rx="3" />
        <rect x="54" y="16" width="6" height="40" rx="3" />
      </g>
      <g className="brand-tag">
        <rect x="4" y="6" width="14" height="8" rx="4" />
        <rect x="20" y="6" width="12" height="8" rx="4" />
      </g>
      <g className="brand-gap">
        <rect x="36" y="6" width="4" height="8" rx="2" />
        <rect x="44" y="6" width="4" height="8" rx="2" />
        <rect x="52" y="6" width="4" height="8" rx="2" />
      </g>
    </svg>
  )
}

export interface PillProps {
  running: boolean
  batchRunning: boolean
  cancelling: boolean
  // The input of the job in flight, and the queue position in a batch.
  input: string | null
  batch: { at: number; of: number } | null
  phase: string | null
  progress: Progress | null
  // The view shows the run's progress itself (the run bar, or the Results
  // pane's running state): the pill then has no bar of its own.
  runBarShown: boolean
  onShow(): void
  onCancel(): void
  /// The busy part went away (the run ended) while focus was in it: the
  /// caller moves focus on, so it does not fall to the page body.
  onFocusLost?(): void
}

/// The active job: its file, % or phase, ETA, and Cancel, the run's one
/// Cancel on every view. Idle otherwise.
export function ProgressPill(p: PillProps): JSX.Element {
  const busy = p.running || p.batchRunning
  return (
    <div className={`pill${busy ? ' busy' : ''}`} role="group" aria-label="Run status">
      {!busy ? <span className="pill-idle">Idle</span> : <PillRun {...p} />}
    </div>
  )
}

function PillRun(p: PillProps): JSX.Element {
  const pct = p.progress && p.progress.total > 0 ? Math.round((p.progress.done / p.progress.total) * 100) : null
  const eta = p.progress?.etaSec != null ? duration(p.progress.etaSec * 1000) : null
  const what = p.cancelling ? 'Cancelling…' : (p.phase ?? 'Starting FASTag')
  // Checked before React removes the busy part (a layout cleanup runs while
  // the nodes are still in the document). Focus inside it counts, and so
  // does focus that left it for nowhere: Cancel turns disabled while
  // cancelling, and the browser drops its focus to the page body.
  const ref = useRef<HTMLSpanElement>(null)
  const inside = useRef(false)
  const lost = useRef(p.onFocusLost)
  lost.current = p.onFocusLost
  useLayoutEffect(() => {
    const el = ref.current
    return () => {
      const a = document.activeElement
      if (el && (el.contains(a) || (inside.current && (!a || a === document.body)))) lost.current?.()
    }
  }, [])
  return (
    <span
      className="pill-run"
      ref={ref}
      onFocus={() => {
        inside.current = true
      }}
      onBlur={(e) => {
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) inside.current = false
      }}
    >
      <button type="button" className="pill-show" onClick={p.onShow} title="Show the run">
        {p.batch && (
          <span className="pill-batch">
            {p.batch.at}/{p.batch.of}
          </span>
        )}
        {p.input && <span className="pill-file">{baseName(p.input)}</span>}
        <span className="pill-what">{what}</span>
        {pct != null && <span className="pill-pct">{pct}%</span>}
        {eta && <span className="pill-eta">ETA {eta}</span>}
      </button>
      {!p.runBarShown && p.running &&
          (pct != null && p.progress ? (
            <span
              className="pill-bar"
              role="progressbar"
              aria-label="Run progress"
              aria-valuemin={0}
              aria-valuemax={p.progress.total}
              aria-valuenow={p.progress.done}
            >
              <span className="fill" style={{ width: `${pct}%` }} />
            </span>
          ) : (
            <span className="pill-bar indeterminate" role="progressbar" aria-label="Run progress">
              <span className="fill" />
            </span>
          ))}
      {/* The run's one Cancel, on every view; between batch jobs nothing
          runs to cancel. */}
      <button
        type="button"
        className="danger-quiet small"
        onClick={p.onCancel}
        disabled={!p.running || p.cancelling}
        aria-keyshortcuts={isMac() ? 'Meta+Period Escape' : 'Control+Period Escape'}
        title={`Cancel (${keyText('.')} or Esc)`}
      >
        Cancel
      </button>
    </span>
  )
}

export interface TopBarProps {
  bin: BinaryInfo | null
  view: View
  onView(v: View): void
  // A count beside a view's name (queued batch files).
  badges: Partial<Record<View, number>>
  pill: PillProps
  theme: Theme
  onTheme(t: Theme): void
  helpOpen: boolean
  onHelp(): void
  // In-app feedback (feedback/): the one capture path; busy while the
  // screenshot is taken.
  onFeedback(): void
  feedbackBusy: boolean
  // Search settings (Cmd+K, /): from every view; it switches to Setup.
  onSearch(): void
  searchDisabled?: boolean
  searchRef?: RefObject<HTMLButtonElement | null>
}

const IconSearch = (): JSX.Element => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
)
const IconHelp = (): JSX.Element => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7" />
    <path d="M12 17h.01" />
  </svg>
)
const IconFeedback = (): JSX.Element => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" focusable="false">
    <path d="M4 5h16v11H8l-4 4z" />
  </svg>
)
function IconTheme({ theme }: { theme: Theme }): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" focusable="false">
      {theme === 'light' ? (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
        </>
      ) : theme === 'dark' ? (
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
      ) : (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 4v16a8 8 0 0 0 0-16z" fill="currentColor" />
        </>
      )}
    </svg>
  )
}

/// The app bar (48 px, the same on every view): the logo, the views as
/// underline tabs, then at the right in a fixed order the run status, Search
/// settings, Help, Feedback and the theme. The version and the OpenMS mark
/// are in About.
export default function TopBar(p: TopBarProps): JSX.Element {
  const { bin } = p
  const theme = THEMES.find((t) => t.id === p.theme)?.label
  return (
    <header className="topbar">
      <span className="brand">
        <Logo />
        <h1>FASTag</h1>
      </span>
      <nav className="viewnav" aria-label="Views">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            data-view={v.id}
            aria-current={p.view === v.id ? 'page' : undefined}
            aria-keyshortcuts={`${isMac() ? 'Meta' : 'Control'}+${v.key}`}
            title={`${v.label} (${keyText(v.key)})`}
            onClick={() => p.onView(v.id)}
          >
            {v.label}
            {p.badges[v.id] ? <span className="badge"> {p.badges[v.id]}</span> : null}
          </button>
        ))}
      </nav>
      <span className="spacer" />
      {bin && !bin.ok && (
        <span className="chip bad" title={`${bin.detail} · ${bin.bin}`}>
          {`FASTag cannot start: ${bin.detail.replace(/^cannot (run|execute): /, '')}`}
        </span>
      )}
      <ProgressPill {...p.pill} />
      {bin?.ok && (
        <span className="ready" title={`${bin.detail} · ${bin.bin}${bin.version ? ` · ${bin.version}` : ''}`}>
          <span className="ready-dot" aria-hidden="true" />
          FASTag ready
        </span>
      )}
      <button
        type="button"
        className="search-btn"
        ref={p.searchRef}
        aria-label="Search settings…"
        disabled={p.searchDisabled}
        aria-keyshortcuts={isMac() ? 'Meta+K /' : 'Control+K /'}
        title={`Search all settings (${keyText('K')} or /)`}
        onClick={p.onSearch}
      >
        <IconSearch />
        <span className="search-label">Search settings…</span>
        <kbd>{keyText('K')}</kbd>
      </button>
      <button
        type="button"
        className={`icon-btn bar-icon${p.helpOpen ? ' on' : ''}`}
        aria-label="Help"
        aria-expanded={p.helpOpen}
        aria-controls="help-panel"
        aria-keyshortcuts={isMac() ? 'Meta+Shift+Slash F1' : 'Control+Shift+Slash F1'}
        title="Help for this screen (F1)"
        onClick={p.onHelp}
      >
        <IconHelp />
      </button>
      {/* Feedback sits in the bar's fixed right-hand group, beside Help. */}
      <button
        type="button"
        className="icon-btn bar-icon feedback-btn"
        aria-label="Feedback"
        aria-keyshortcuts={isMac() ? 'Meta+Shift+F' : 'Control+Shift+F'}
        aria-busy={p.feedbackBusy || undefined}
        title={`Send feedback: a report with a screenshot, kept on this computer (${isMac() ? '⌘⇧F' : 'Ctrl+Shift+F'})`}
        onClick={p.onFeedback}
      >
        <IconFeedback />
      </button>
      {/* One button that steps through System, Light and Dark (View > Theme too). */}
      <button
        type="button"
        className="icon-btn bar-icon theme-pick"
        aria-label={`Theme: ${theme}`}
        title={`Theme: ${theme} (System, Light or Dark)`}
        onClick={() => p.onTheme(THEMES[(THEMES.findIndex((t) => t.id === p.theme) + 1) % THEMES.length].id)}
      >
        <IconTheme theme={p.theme} />
      </button>
    </header>
  )
}
