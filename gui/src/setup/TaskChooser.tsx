// The Workflow card of Setup (doc/GUI-WORKFLOWS.md 1 and 3): seven workflow
// cards, the row that says whether the form still holds the workflow's
// values (Reset), the presets menu (Save as…, load, Delete), the last-used
// offer (D6) and Undo after a workflow or preset replaced the form. The
// Preset select comes first, so it keeps its place whichever workflow is
// chosen; "Open earlier results…" is in the Input card.

import type { JSX } from 'react'
import { TASKS, taskById } from './tasks'
import type { Session } from './useSession'
import { cliText } from '../app/format'
import { HelpLink } from '../help/HelpLink'

/// The workflow row: Preset select, the origin and whether the form still
/// holds it (Reset), last-used, Undo and Learn more. Setup draws it in the
/// Workflow card's head (@p rowInHead of TaskChooser).
export function PresetRow({ session }: { session: Session }): JSX.Element {
  const { lastUsed, lastUsedDiff } = session
  const task = session.task ? taskById(session.task) : undefined
  const modified = session.diff.length > 0
  return (
    <div className="row tight starting">
      {session.savingName === null ? (
        <>
          <label className="preset-pick">
            <span className="sublabel">Preset</span>
            <select
              id="origin"
              className="small"
              ref={session.presetRef}
              value=""
              aria-label="Preset"
              onChange={(e) => {
                const v = e.target.value
                if (v === '__save') session.setSavingName(session.preset || '')
                else if (v === '__delete') void session.removePreset()
                else if (v === '__defaults') void session.applyPreset('')
                else if (v) void session.applyPreset(v)
              }}
            >
              <option value="">Choose…</option>
              <option value="__save">Save as preset…</option>
              {session.presets.length > 0 && (
                <optgroup label="Load">
                  {session.presets.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </optgroup>
              )}
              <option value="__defaults">Load FASTag defaults</option>
              {session.preset && <option value="__delete">Delete preset {session.preset}</option>}
            </select>
          </label>
          <span className="origin-name">
            <strong>{session.originText}</strong>
            {modified && (
              <span className="muted" title={session.diff.join(', ')}>
                {' '}
                (modified)
              </span>
            )}
          </span>
          {modified && (
            <button type="button" className="secondary small" aria-label={`Reset to ${session.originText}`} onClick={session.resetToOrigin}>
              Reset
            </button>
          )}
          {lastUsedDiff.length > 0 && (
            <button
              type="button"
              className="secondary small offer"
              onClick={session.applyLastUsed}
              title={`The settings of your last run: ${lastUsedDiff.map((n) => cliText(n, lastUsed![n])).join(' ')}`}
            >
              Apply last-used ({lastUsedDiff.length})
            </button>
          )}
          {session.canUndo && (
            <button type="button" className="secondary small" onClick={session.undo} title="Bring back the values the last workflow or preset replaced">
              Undo
            </button>
          )}
          <span className="spacer" />
          {task && <HelpLink to={task.docs.to}>Learn more</HelpLink>}
        </>
      ) : (
        <>
          <input
            className="small"
            autoFocus
            value={session.savingName}
            placeholder="preset name"
            aria-label="Preset name"
            aria-describedby="preset-note"
            onChange={(e) => session.setSavingName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') session.commitPreset()
              if (e.key === 'Escape') session.cancelPreset()
            }}
          />
          <button type="button" className="small" onClick={session.commitPreset}>
            Save
          </button>
          <button type="button" className="secondary small" onClick={session.cancelPreset}>
            Cancel
          </button>
          <p id="preset-note" className="hint">
            Saves what differs from {session.presetBaseText}
            {session.droppedPaths.length > 0 && <>. Paths are not saved: {session.droppedPaths.join(', ')}</>}.
          </p>
        </>
      )}
    </div>
  )
}

export default function TaskChooser({ session, rowInHead = false }: { session: Session; rowInHead?: boolean }): JSX.Element {
  const task = session.task ? taskById(session.task) : undefined
  return (
    <div className="task-chooser">
      <fieldset className="tasks">
        <legend className="sr-only">Workflow</legend>
        {TASKS.map((t) => (
          <label key={t.id} className={`task${session.task === t.id ? ' on' : ''}`} title={`${t.label}: ${t.blurb} → ${t.products}`}>
            <input
              type="radio"
              name="task"
              value={t.id}
              checked={session.task === t.id}
              onChange={() => session.chooseTask(t.id)}
              aria-describedby={`task-${t.id}-d`}
            />
            <span className="task-label">{t.label}</span>
            <span id={`task-${t.id}-d`} className="task-products">
              → {t.products}
            </span>
          </label>
        ))}
      </fieldset>
      {task && <p className="task-blurb-line">{task.blurb}</p>}
      {!rowInHead && <PresetRow session={session} />}
      {session.presetError && (
        <p className="warn" role="alert">
          {session.presetError}
        </p>
      )}
    </div>
  )
}
