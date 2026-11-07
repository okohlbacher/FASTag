// The top bar (GUI-DESIGN 2 "Persistent chrome", P2a PR s): the v6 logo,
// the view switcher (Cmd+1..4), the progress pill, the theme, the Help
// toggle (Cmd+?, F1) and the OpenMS mark.

import type { JSX } from 'react'
import type { BinaryInfo } from '../types'
import type { Progress } from '../runJob'
import { IconCheck } from '../icons'
import { VIEWS, isMac, keyText, type View } from '../setup/shortcuts'
import { THEMES, type Theme } from '../app/theme'
import { duration } from '../app/format'
import { baseName } from '../digestReport'
import openmsLogo from '../assets/openms-logo.png'

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
  // The run bar is on screen: it shows the progress and Cancel itself.
  runBarShown: boolean
  onShow(): void
  onCancel(): void
}

/// The active job: its file, % or phase, ETA, and Cancel where the run bar
/// is not shown. Idle otherwise.
export function ProgressPill(p: PillProps): JSX.Element {
  const busy = p.running || p.batchRunning
  const pct = p.progress && p.progress.total > 0 ? Math.round((p.progress.done / p.progress.total) * 100) : null
  const eta = p.progress?.etaSec != null ? duration(p.progress.etaSec * 1000) : null
  const what = p.cancelling ? 'Cancelling…' : (p.phase ?? 'Starting FASTag')
  return (
    <div className={`pill${busy ? ' busy' : ''}`} role="group" aria-label="Run status">
      {!busy ? (
        <span className="pill-idle">Idle</span>
      ) : (
        <>
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
          {!p.runBarShown && p.running && (
            <>
              {pct != null && p.progress ? (
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
              )}
              <button
                type="button"
                className="danger small"
                onClick={p.onCancel}
                disabled={p.cancelling}
                aria-keyshortcuts={isMac() ? 'Meta+Period Escape' : 'Control+Period Escape'}
                title={`Cancel (${keyText('.')} or Esc)`}
              >
                Cancel
              </button>
            </>
          )}
        </>
      )}
    </div>
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
}

export default function TopBar(p: TopBarProps): JSX.Element {
  const { bin } = p
  return (
    <header className="topbar">
      <Logo />
      <h1>FASTag</h1>
      {bin?.version && <span className="ver">{bin.version}</span>}
      {bin && !bin.ok && (
        <span className="chip bad" title={`${bin.detail} · ${bin.bin}`}>
          {`FASTag cannot start: ${bin.detail.replace(/^cannot (run|execute): /, '')}`}
        </span>
      )}
      {bin?.ok && (
        <span className="chip ok ready" title={`${bin.detail} · ${bin.bin}`}>
          <IconCheck />
          FASTag ready
        </span>
      )}
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
      <ProgressPill {...p.pill} />
      <span className="spacer" />
      {/* One button that steps through System, Light and Dark (View > Theme too). */}
      <button
        type="button"
        className="secondary small theme-pick"
        aria-label={`Theme: ${THEMES.find((t) => t.id === p.theme)?.label}`}
        title="Theme: System, Light or Dark"
        onClick={() => p.onTheme(THEMES[(THEMES.findIndex((t) => t.id === p.theme) + 1) % THEMES.length].id)}
      >
        <span aria-hidden="true">{p.theme === 'dark' ? '☾' : p.theme === 'light' ? '☀' : '◐'}</span>
      </button>
      <button
        type="button"
        className={`secondary small${p.helpOpen ? ' on' : ''}`}
        aria-expanded={p.helpOpen}
        aria-controls="help-panel"
        aria-keyshortcuts={isMac() ? 'Meta+Shift+Slash F1' : 'Control+Shift+Slash F1'}
        title="Help (F1)"
        onClick={p.onHelp}
      >
        Help
      </button>
      <span className="openms" title="FASTag is an OpenMS TOPP tool — openms.de">
        Built on
        <img src={openmsLogo} alt="OpenMS" />
      </span>
    </header>
  )
}
