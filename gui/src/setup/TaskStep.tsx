// Step 1 of the Setup wizard (doc/GUI-SETUP-WIZARD.md 3): what the run is
// for. Seven workflow tiles in three groups; the selected one fills one
// shared detail card (You get, You need, Run time). Selecting a tile changes
// nothing: Continue (or Enter on a tile) confirms it and only then replaces
// the form. In the page header, StartRow: Continue last run, Presets and Open
// earlier results…. The preset controls (Presets on every step, origin,
// Reset, Undo and the preset name of step 3) are here too, as PresetMenu
// and OriginRow.

import { useRef, type JSX, type KeyboardEvent } from 'react'
import { PARAM_BY_NAME } from '../paramLayout'
import { TASKS, TASK_GROUPS, TILE_ORDER, taskById, type Task, type TaskId } from './tasks'
import type { Session } from './useSession'
import { cliText } from '../app/format'
import { HelpLink } from '../help/HelpLink'
import { TaskIcon } from '../icons'
import { INPUTS, inputLabel, missingInputs } from './inputs'

/// The badge of a tile: "needs FASTA" when a required input is a FASTA,
/// "IDs optional" when identifications are an optional input; "FASTA or
/// shipped proteome" when its database reports take either (dbOptional).
export function taskBadge(t: Task): string | null {
  if (t.dbOptional) return 'FASTA or shipped proteome'
  if ((t.required ?? []).some((n) => (PARAM_BY_NAME.get(n)?.formats ?? []).includes('fasta'))) return 'needs FASTA'
  if ((t.optionalInputs ?? []).includes('census_ids')) return 'IDs optional'
  return null
}

/// "spectra + a protein FASTA (Protein database)", from the task's inputs.
export function youNeed(t: Task | null): string {
  const req = (t?.required ?? []).map((n) => (n === 'recon_fasta' ? 'a protein FASTA' : inputLabel(n)))
  const opt = (t?.optionalInputs ?? [])
    .filter((n) => !INPUTS[n]?.after)
    .map((n) => (t?.dbOptional && n === 'recon_fasta' ? 'protein database (your FASTA or a shipped proteome)' : inputLabel(n).replace(/^Your /, 'your ').toLowerCase()))
  return ['spectra', ...req].join(' + ') + (opt.length ? `; optional: ${opt.join(', ')}` : '')
}

/// After a preset or the last run's settings were loaded on step 1: Inputs
/// when the spectra or a required input are missing, else stay.
function leaveStep1(session: Session): void {
  const batch = session.mode === 'batch'
  if (missingInputs(null, session.values, { input: session.input, jobs: 0, mode: batch ? 'batch' : 'one' }).length) session.setStep(2)
}

/// The preset menu: load a preset of yours or FASTag's defaults, delete the
/// one the form started from; with @p withSave (step 3) also Save as preset.
export function PresetMenu({ session, withSave = false }: { session: Session; withSave?: boolean }): JSX.Element {
  // Loaded from step 1: on to Inputs when one is missing (step 3 stays).
  const load = async (name: string): Promise<void> => {
    await session.applyPreset(name)
    if (session.step === 1) leaveStep1(session)
  }
  return (
    <label className="preset-pick">
      <span className="sublabel">Presets</span>
      <select
        id="origin"
        ref={session.presetRef}
        value=""
        aria-label="Presets"
        onChange={(e) => {
          const v = e.target.value
          if (v === '__save') session.setSavingName(session.preset || '')
          else if (v === '__delete') void session.removePreset()
          else if (v === '__defaults') void load('')
          else if (v) void load(v)
        }}
      >
        <option value="">Choose…</option>
        {withSave && <option value="__save">Save as preset…</option>}
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
  )
}

/// Step 3's origin row: where the values came from, whether they still hold
/// it (Reset), Undo, and the name field of Save as preset (header Presets).
export function OriginRow({ session }: { session: Session }): JSX.Element {
  const modified = session.diff.length > 0
  if (session.savingName !== null)
    return (
      <div className="row tight starting">
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
        <button type="button" className="secondary small" onClick={session.commitPreset}>
          Save
        </button>
        <button type="button" className="secondary small" onClick={session.cancelPreset}>
          Cancel
        </button>
        <p id="preset-note" className="hint">
          Saves what differs from {session.presetBaseText}
          {session.droppedPaths.length > 0 && <>. Paths are not saved: {session.droppedPaths.join(', ')}</>}.
        </p>
      </div>
    )
  return (
    <div className="row tight starting">
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
      {session.canUndo && (
        <button type="button" className="secondary small" onClick={session.undo} title="Bring back the values the last workflow or preset replaced">
          Undo
        </button>
      )}
    </div>
  )
}

/// The start row, the page actions of step 1: Continue last run, Presets
/// and Open earlier results….
export function StartRow({ session, onOpenResults }: { session: Session; onOpenResults(): void }): JSX.Element {
  const { lastUsed, lastUsedDiff } = session
  const lastTask = session.lastWorkflow ? taskById(session.lastWorkflow) : undefined
  return (
    <div className="row tight start-row">
      {lastUsed && lastUsedDiff.length > 0 && (
        <button
          type="button"
          className="secondary offer"
          onClick={() => {
            session.applyLastUsed()
            leaveStep1(session)
          }}
          title={`The settings of your last run${lastTask ? ` (${lastTask.label})` : ''}: ${lastUsedDiff.map((n) => cliText(n, lastUsed[n])).join(' ')}`}
        >
          Continue last run ({lastUsedDiff.length})
        </button>
      )}
      <PresetMenu session={session} />
      <button type="button" onClick={onOpenResults}>
        Open earlier results…
      </button>
    </div>
  )
}

export interface TaskStepProps {
  session: Session
  /// Confirm @p id: replace the form when it is another task, and move on.
  onContinue(id: TaskId): void
}

export default function TaskStep({ session, onContinue }: TaskStepProps): JSX.Element {
  const selected = taskById(session.tile) ?? TASKS[0]
  const grid = useRef<HTMLDivElement>(null)
  // Arrows move focus across all tiles (a plain focus group): focus selects.
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, id: TaskId): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onContinue(id)
      return
    }
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
    if (!d) return
    e.preventDefault()
    const tiles = [...(grid.current?.querySelectorAll<HTMLButtonElement>('button.task-tile') ?? [])]
    const i = tiles.indexOf(e.currentTarget)
    tiles[(i + d + tiles.length) % tiles.length]?.focus()
  }
  const current = session.taskConfirmed ? session.task : null
  return (
    <div className="task-step">
      {session.presetError && (
        <p className="warn" role="alert">
          {session.presetError}
        </p>
      )}
      <div className="task-pick">
        <div className="task-grid" ref={grid}>
          {TASK_GROUPS.map((g) => (
            <section key={g.id} className="task-group" aria-labelledby={`tg-${g.id}`}>
              <h3 id={`tg-${g.id}`}>{g.title}</h3>
              <ul>
                {TILE_ORDER.map((id) => taskById(id)!).filter((t) => t.group === g.id).map((t) => {
                  const badge = taskBadge(t)
                  const on = selected.id === t.id
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        className={`task-tile${on ? ' selected' : ''}${current === t.id ? ' current' : ''}`}
                        data-task={t.id}
                        aria-pressed={on}
                        aria-current={current === t.id ? 'true' : undefined}
                        aria-describedby={`tile-${t.id}-q`}
                        aria-controls="task-detail"
                        onClick={() => session.setTile(t.id)}
                        onFocus={() => session.setTile(t.id)}
                        onKeyDown={(e) => onKey(e, t.id)}
                      >
                        <TaskIcon id={t.id} />
                        <span className="task-tile-text">
                          {/* The chips sit after the label: no line of their own. */}
                          <span className="task-tile-head">
                            <span className="task-tile-label">{t.label}</span>
                            {t.recommended && (
                              <span className="chip accent" title="Recommended to start">
                                Start here
                              </span>
                            )}
                            {badge && <span className="badge">{badge}</span>}
                            {current === t.id && <span className="chip">Current</span>}
                          </span>
                          <span className="task-tile-q" id={`tile-${t.id}-q`}>
                            {t.question}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
        <section className="task-detail" id="task-detail" aria-labelledby="task-detail-h">
          <h3 id="task-detail-h">
            <TaskIcon id={selected.id} /> {selected.label}
          </h3>
          <dl>
            <dt>You get</dt>
            <dd>{selected.gets}</dd>
            <dt>You need</dt>
            <dd>{youNeed(selected).replace(/^s/, 'S')}</dd>
            <dt>Run time</dt>
            <dd>
              {selected.time === 'short' ? 'Short' : 'Longer'}: {selected.timeNote}
            </dd>
          </dl>
          {/* When to use it and what it is not for: in Help. */}
          <HelpLink to={`task-${selected.id}`}>More about this task</HelpLink>
        </section>
      </div>
    </div>
  )
}
