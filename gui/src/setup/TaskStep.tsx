// Step 1 of the Setup wizard (doc/GUI-SETUP-WIZARD.md 3): what the run is
// for. Seven workflow tiles in three groups; the selected one fills one
// shared detail panel. Selecting a tile changes nothing: Continue (or Enter
// on a tile) confirms it and only then replaces the form. At the right of the
// heading, StartRow: Continue last run, Presets and Open earlier results….
// The preset controls of step 3 (origin, Reset, Undo, Save as preset) are
// here too, as PresetMenu and OriginRow.

import { useRef, type JSX, type KeyboardEvent, type ReactNode } from 'react'
import { PARAM_BY_NAME } from '../paramLayout'
import { TASKS, TASK_GROUPS, TILE_ORDER, taskById, type Task, type TaskId } from './tasks'
import type { Session } from './useSession'
import { cliText } from '../app/format'
import { HelpLink } from '../help/HelpLink'
import { TaskIcon } from '../icons'
import { INPUTS, inputLabel, missingInputs } from './inputs'

/// The badge of a tile: "needs FASTA" when a required input is a FASTA,
/// "IDs optional" when identifications are an optional input.
export function taskBadge(t: Task): string | null {
  if ((t.required ?? []).some((n) => (PARAM_BY_NAME.get(n)?.formats ?? []).includes('fasta'))) return 'needs FASTA'
  if ((t.optionalInputs ?? []).includes('census_ids')) return 'IDs optional'
  return null
}

/// "spectra + a protein FASTA (Protein database)", from the task's inputs.
export function youNeed(t: Task | null): string {
  const req = (t?.required ?? []).map((n) => (n === 'recon_fasta' ? 'a protein FASTA' : inputLabel(n)))
  const opt = (t?.optionalInputs ?? []).filter((n) => !INPUTS[n]?.after).map((n) => inputLabel(n).replace(/^Your /, 'your ').toLowerCase())
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
        className="small"
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

/// Step 3's head: where the values came from, whether they still hold it
/// (Reset), Undo, the presets and Save as preset (an inline name field).
export function OriginRow({ session, learnMore }: { session: Session; learnMore?: ReactNode }): JSX.Element {
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
      {session.step === 3 && <PresetMenu session={session} withSave />}
      <span className="spacer" />
      {learnMore}
    </div>
  )
}

/// The start row, at the right of step 1's heading: Continue last run,
/// Presets and Open earlier results….
export function StartRow({ session, onOpenResults }: { session: Session; onOpenResults(): void }): JSX.Element {
  const { lastUsed, lastUsedDiff } = session
  const lastTask = session.lastWorkflow ? taskById(session.lastWorkflow) : undefined
  return (
    <div className="row tight start-row">
      {lastUsed && lastUsedDiff.length > 0 && (
        <button
          type="button"
          className="secondary small offer"
          onClick={() => {
            session.applyLastUsed()
            leaveStep1(session)
          }}
          title={`The settings of your last run${lastTask ? ` (${lastTask.label})` : ''}: ${lastUsedDiff.map((n) => cliText(n, lastUsed[n])).join(' ')}`}
        >
          Continue last run ({lastUsedDiff.length})
        </button>
      )}
      {session.step === 1 && <PresetMenu session={session} />}
      <button type="button" className="link small" onClick={onOpenResults}>
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
      <p className="hint not-search" id="not-search-engine">
        FASTag reads short amino-acid stretches (tags) from each MS/MS spectrum. It does not identify proteins with FDR control: use a
        search engine for that. Database reduction prepares the database and the settings for one.
      </p>
      {session.presetError && (
        <p className="warn" role="alert">
          {session.presetError}
        </p>
      )}
      <p className="hint recommend">
        Pick a task: it decides which files FASTag needs and what it writes; you can change it later. Not sure? Start with{' '}
        <strong>Characterize a run</strong>: it reports protease, labels, glycopeptides and species from 10% of the spectra in a few
        minutes.
      </p>
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
                        <span className="task-tile-head">
                          <TaskIcon id={t.id} />
                          <span className="task-tile-label">{t.label}</span>
                          {current === t.id && <span className="chip">Current</span>}
                        </span>
                        {/* The badges flow after the question: no line of their own. */}
                        <span className="task-tile-q" id={`tile-${t.id}-q`}>
                          {t.question}
                          {t.recommended && <span className="chip accent">Recommended to start</span>}
                          {badge && <span className="badge">{badge}</span>}
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
          <p className="detail-q">{selected.question}</p>
          <dl>
            <dt>You get</dt>
            <dd>{selected.gets}</dd>
            <dt>You need</dt>
            <dd>{youNeed(selected)}</dd>
            <dt>Use when</dt>
            <dd>{selected.use}</dd>
            <dt>Not for</dt>
            <dd>{selected.notFor}</dd>
            <dt>Run time</dt>
            <dd>
              {selected.time}: {selected.timeNote}
            </dd>
          </dl>
          <HelpLink to={selected.docs.to}>Learn more: {selected.docs.label}</HelpLink>
        </section>
      </div>
    </div>
  )
}
