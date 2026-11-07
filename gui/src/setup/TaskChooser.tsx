// The top of the Setup screen (GUI-DESIGN 3 S1): what the session is for
// (a built-in task), what it starts from (the task, FASTag's defaults or a
// saved preset), saving the form as a preset, the last-used offer (D6) and
// Undo after a task or preset replaced the form.

import type { JSX } from 'react'
import { TASKS } from './tasks'
import type { Session } from './useSession'
import { cliText } from '../app/format'

export default function TaskChooser({ session }: { session: Session }): JSX.Element {
  const { lastUsed, lastUsedDiff } = session
  return (
    <section className="block task-chooser" aria-labelledby="task-h">
      <fieldset className="tasks">
        <legend id="task-h">What do you want to do?</legend>
        {TASKS.map((t) => (
          <label key={t.id} className={`task${session.task === t.id ? ' on' : ''}`}>
            <input
              type="radio"
              name="task"
              value={t.id}
              checked={session.task === t.id}
              onChange={() => session.chooseTask(t.id)}
              aria-describedby={`task-${t.id}-d`}
            />
            <span className="task-label">{t.label}</span>
            <span id={`task-${t.id}-d`} className="task-blurb">
              {t.blurb}
            </span>
          </label>
        ))}
      </fieldset>
      <div className="row tight starting">
        {session.savingName === null ? (
          <>
            <label htmlFor="origin" className="sublabel">
              Starting from
            </label>
            <select
              id="origin"
              className="small"
              ref={session.presetRef}
              value={session.originKey}
              onChange={(e) => void session.applyPreset(e.target.value)}
              title="Start from FASTag's defaults, a built-in task or a saved preset"
              aria-label="Preset"
            >
              <option value="">FASTag defaults</option>
              <optgroup label="Built-in">
                {TASKS.filter((t) => t.runs).map((t) => (
                  <option key={t.id} value={`builtin:${t.id}`}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
              {session.presets.length > 0 && (
                <optgroup label="Saved presets">
                  {session.presets.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <button type="button" className="secondary small" onClick={() => session.setSavingName(session.preset || '')}>
              Save…
            </button>
            <button type="button" className="secondary small" onClick={session.removePreset} disabled={!session.preset}>
              Delete
            </button>
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
              <button type="button" className="secondary small" onClick={session.undo} title="Bring back the values the last task or preset replaced">
                Undo
              </button>
            )}
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
    </section>
  )
}
