// The run setup (moved from App.tsx, P1 PR c): the last run, the input or
// the batch queue, the output and the parameter form; while a run is in
// flight, a locked summary of what it uses.

import type { JSX, RefObject } from 'react'
import {
  SECTIONS,
  PARAM_BY_NAME,
  dependents,
  hiddenUntilMaster,
  type Section,
  UNIT_OF,
  UNIT_PARAMS,
  humanName,
  inertBecause,
  inertDependency,
  isActive,
  isChanged,
  unknownParams,
  unplacedParams
} from '../paramLayout'
import ParamField from '../ParamField'
import { baseName } from '../digestReport'
import { IconError, IconFile, IconLock, JobIcon } from '../icons'
import { slug } from '../help/HelpView'
import { HelpButton, HelpLink } from '../help/HelpLink'
import { isMac, keyText } from './shortcuts'
import type { Session } from './useSession'
import type { RunState } from '../run/useRun'
import { Leftovers } from '../Leftovers'
import { dirName, revealLabel } from '../app/paths'
import { clock, duration } from '../app/format'
import TaskChooser from './TaskChooser'
import { CARDS, cardSummary } from './plan'
import { taskById } from './tasks'

// A parameter that exists in the CLI but nowhere in the layout would silently
// be unreachable; surface it instead of hiding it.
const UNPLACED = unplacedParams()
const UNKNOWN = unknownParams()

export interface SetupFormProps {
  session: Session
  run: RunState
  onPickInput(): void
  onSearch(): void
  searchBtnRef: RefObject<HTMLButtonElement | null>
  // Show the Batch view, where the queue is.
  onOpenBatch(): void
  // Add the spectra files of a folder to the batch (P2b).
  onAddFolder?(): void
  // What Add folder… found here (App.tsx): its live region.
  folderNote?: JSX.Element
  // The "Add files for a batch…" button, where focus goes when the queue
  // is cleared.
  addBatchRef: RefObject<HTMLButtonElement | null>
  // "Open results…" of the task "Open results / inspect spectra".
  onOpenResults(): void
}

export default function SetupForm({ session, run, onPickInput, onSearch, searchBtnRef, onOpenBatch, onAddFolder, folderNote, addBatchRef, onOpenResults }: SetupFormProps): JSX.Element {
  const { input, out, values, setValue, openGroups, setOpenGroups, writingFiles, changedParams } = session
  const { busy, jobs, lastRun, evidence, revealErr, reveal } = run
  // A batch task (Batch QC) asks for the files of a batch before one file.
  const batchFirst = !input && !!session.task && taskById(session.task)?.batch === true

  const field = (name: string, sec?: Section): JSX.Element | null => {
    const spec = PARAM_BY_NAME.get(name)
    // A unit is drawn inside the field of its value.
    if (!spec || UNIT_PARAMS.has(name)) return null
    // Hidden until its section's switch is on (GUI-DESIGN 3 S1): the switch
    // says once what it turns on. Kept in the page, hidden, so its value
    // (a dropped taxonomy, a last-used path) stays where it was.
    const hidden = !!sec && hiddenUntilMaster(name, sec, values)
    const turnsOn = sec?.master === name && !isActive(name, values) ? dependents(sec).length : 0
    const unitName = UNIT_OF[name]
    const unitSpec = unitName ? PARAM_BY_NAME.get(unitName) : undefined
    const f = (
      <ParamField
        key={name}
        spec={spec}
        value={values[name]}
        needs={inertDependency(name, values)}
        onChange={(v) => setValue(name, v)}
        onPickFile={session.pickFor}
        turnsOn={turnsOn}
        unit={unitSpec && unitName ? { spec: unitSpec, value: values[unitName], onChange: (v) => setValue(unitName, v) } : undefined}
      />
    )
    return hidden ? (
      <div key={name} className="dep-hidden" hidden>
        {f}
      </div>
    ) : (
      f
    )
  }

  // The queue itself is on the Batch view (GUI-DESIGN 2, P2a PR s); the
  // form says the parameters are the batch's.
  const batchSummary = (
    <section className="block batch-summary" aria-labelledby="batch-sum-h">
      <h2 id="batch-sum-h">Input</h2>
      <p>
        A batch of {jobs.length} {jobs.length === 1 ? 'file' : 'files'}: each runs with the parameters below.
      </p>
      <button type="button" className="secondary small" onClick={onOpenBatch}>
        Open the batch
      </button>
    </section>
  )

  const spectraInputs = (
    <>
    {jobs.length > 0 ? (
      batchSummary
    ) : (
      <section className="block" aria-labelledby="input-label">
        <div className="block-head">
          <h2 id="input-label">Input</h2>
          <HelpButton to="files-inputs" what="input files" />
        </div>
        {batchFirst ? (
          // Batch QC (tasks.ts): the input is a queue of files, so adding
          // them is the card's own action; one file stays possible.
          <>
            <div className="input-card empty-input">
              <IconFile />
              <span className="muted">The files of the batch, as mzML, mzPeak or MGF</span>
              <button className="secondary" ref={addBatchRef} onClick={run.addBatchFiles} title="Queue several files to run in turn">
                Add files for a batch…
              </button>
            </div>
            {onAddFolder && (
              <button className="link add-batch" onClick={onAddFolder}>
                Or add a folder…
              </button>
            )}
            {folderNote}
            <button className="link add-batch" onClick={onPickInput}>
              Or choose one file…
            </button>
          </>
        ) : input ? (
          <div className="input-card">
            <IconFile />
            <div className="path" title={input}>
              <span className="fname">{baseName(input)}</span>
              <span className="dir">{dirName(input)}</span>
            </div>
            <button className="secondary" onClick={onPickInput}>
              Change…
            </button>
          </div>
        ) : (
          <div className="input-card empty-input">
            <IconFile />
            <span className="muted">Spectra as mzML, mzPeak or MGF</span>
            <button className="secondary" onClick={onPickInput}>
              Choose file…
            </button>
          </div>
        )}
        {!(batchFirst) && (
          <button className="link add-batch" ref={addBatchRef} onClick={run.addBatchFiles} title="Queue several files to run in turn">
            <span aria-hidden="true">+ </span>Add files for a batch…
          </button>
        )}
      </section>
    )}

    {jobs.length === 0 && (
      <section className="block" aria-labelledby="out-h">
        <div className="block-head">
          <h2 id="out-h">Output</h2>
          <HelpButton to="files-outputs" what="output files" />
        </div>
        <label htmlFor="out" className="sublabel">
          Tags TSV <code className="cli">out</code>
        </label>
        <div className="row tight">
          <input id="out" className="path-input" value={out} onChange={(e) => session.setOut(e.target.value)} placeholder="tags.tsv" />
          <button
            className="secondary"
            aria-label="Browse for the tags TSV"
            onClick={async () => {
              const p = await window.fastag.pickOutput(out || undefined)
              if (p) session.setOut(p)
            }}
          >
            Browse…
          </button>
        </div>
        {out && writingFiles.length > 1 && (
          <p className="hint">
            Reports go to{' '}
            {writingFiles
              .slice(1)
              .map((f, i) => (
                <span key={f}>
                  {i > 0 && ', '}
                  <code>{f}</code>
                </span>
              ))}
          </p>
        )}
      </section>
    )}

    </>
  )

  const renderSection = (sec: Section): JSX.Element => {
    const open = openGroups[sec.title] ?? sec.open
    // A section whose master switch is on is doing work; say so in the
    // header, so a collapsed "Species detection" cannot hide the fact
    // that the run will spend time on it.
    const on = sec.master ? isActive(sec.master, values) : false
    const rest = sec.params.filter((n) => n !== sec.master)
    // What a collapsed section hides: its live values that are not
    // the CLI's defaults.
    const changed = rest.filter((n) => !inertBecause(n, values) && isChanged(n, values[n])).length
    return (
      <section className={`sec${open ? ' open' : ''}${on || changed ? ' active' : ''}`} key={sec.title}>
        <button
          className="disclosure"
          onClick={() => setOpenGroups((st) => ({ ...st, [sec.title]: !open }))}
          aria-expanded={open}
        >
          <span className={`chev ${open ? 'open' : ''}`} aria-hidden="true">▸</span>
          <span className="sec-title">{sec.title}</span>{' '}
          {on && (
            <span className="chip ok on-dot" role="img" aria-label={`${humanName(sec.master!)} is on`}>
              on
            </span>
          )}
          {changed > 0 && <span className="chip accent">{changed} changed</span>}{' '}
          {!on && changed === 0 && <span className="defaults">defaults</span>}
        </button>
        {open && (
          <div className="sec-body">
            <p className="blurb">
              {sec.blurb}{' '}
              <HelpLink to={`param-sec-${slug(sec.title)}`}>
                Help on {sec.title}
              </HelpLink>
            </p>
            {sec.master && field(sec.master, sec)}
            {sec.master && rest.length > 0 && <div className="sub-rule" />}
            {rest.map((n) => field(n, sec))}
          </div>
        )}
      </section>
    )
  }

  // The task "Open results": no run, no form.
  const openOnly = session.task === 'open-results'

  return (
    <div className="controls-body">
      {busy ? (
        <>
          {/* The form is not editable mid-run: a changed value would not
              be what the run is using. */}
          <p className="locked">
            <IconLock />
            <span>Input, output and parameters are locked while FASTag runs.</span>
          </p>
          {jobs.length > 0 ? (
            batchSummary
          ) : (
            <section className="block">
              <h2>Input</h2>
              <div className="path" title={input}>
                <span className="fname">{baseName(input)}</span>
                <span className="dir">{dirName(input)}</span>
              </div>
            </section>
          )}
          {jobs.length === 0 && (
            <section className="block">
              <h2>Writing</h2>
              {writingFiles.map((f) => (
                <code key={f}>{f}</code>
              ))}
            </section>
          )}
          <section className="block">
            <h2>Changed from defaults</h2>
            {changedParams.length ? (
              changedParams.map((c) => <code key={c}>{c}</code>)
            ) : (
              <span className="muted">nothing: all parameters at their defaults</span>
            )}
          </section>
        </>
      ) : (
        <>
          <Leftovers />
          {lastRun && jobs.length === 0 && (
            <section className="block last-run" aria-labelledby="last-run-h">
              <h2 id="last-run-h">Last run</h2>
              <div className={`last-run-name ${lastRun.ok ? 'ok' : lastRun.cancelled ? 'cancelled' : 'bad'}`}>
                <JobIcon status={lastRun.ok ? 'done' : lastRun.cancelled ? 'cancelled' : 'failed'} />
                <span>{baseName(lastRun.input)}</span>
              </div>
              <div className="muted">
                {lastRun.ok ? 'Finished' : lastRun.cancelled ? 'Cancelled' : 'Failed'}{' '}
                {lastRun.earlier ? `in an earlier session, ${new Date(lastRun.at).toLocaleString()}` : clock(lastRun.at)} ·{' '}
                {duration(lastRun.ms)}
                {lastRun.cleaned > 0 && ' · partial outputs removed'}
                {lastRun.ok && evidence.ms2 != null && ` · ${evidence.ms2.toLocaleString('en-US')} MS2 spectra`}
              </div>
              {/* The form may be edited since: what this run was given. */}
              {lastRun.changed && (
                <code className="last-run-params">{lastRun.changed.length ? lastRun.changed.join(' ') : 'all defaults'}</code>
              )}
              {lastRun.ok && lastRun.out && (
                <div className="row reveal">
                  <button type="button" className="secondary small" onClick={() => reveal(false)} title={lastRun.out}>
                    {revealLabel()}
                  </button>
                  <button type="button" className="secondary small" onClick={() => reveal(true)}>
                    Open folder
                  </button>
                </div>
              )}
              {revealErr && (
                <p className="warn" role="alert">
                  <IconError />
                  <span>{revealErr}</span>
                </p>
              )}
            </section>
          )}

          <TaskChooser session={session} />

          {openOnly ? (
            <section className="block step-card open-only" role="region" aria-label="Open results">
              <p className="muted">{taskById('open-results')!.blurb}</p>
              <button type="button" onClick={onOpenResults}>
                Open results…
              </button>
            </section>
          ) : (
            <>
              <div className="row tight cards-tools">
                <span className="muted">Every setting is in one of the four steps below.</span>
                <button
                  type="button"
                  className="secondary small"
                  ref={searchBtnRef}
                  aria-keyshortcuts={isMac() ? 'Meta+K /' : 'Control+K /'}
                  title={`Search parameters (${keyText('K')} or /)`}
                  onClick={onSearch}
                >
                  Search… <kbd>{keyText('K')}</kbd>
                </button>
              </div>
              {CARDS.map((card) => (
                <section key={card.id} className="block step-card" role="region" aria-label={`${card.n} ${card.title}`}>
                  <div className="card-head">
                    <span className="card-n" aria-hidden="true">
                      {card.n}
                    </span>
                    <h2>{card.title}</h2>
                  </div>
                  <p className="card-summary">{cardSummary(card.id, values, { input, out, files: jobs.length })}</p>
                  {card.id === 'spectra' && spectraInputs}
                  {card.sections.map((t) => renderSection(SECTIONS.find((x) => x.title === t)!))}
                </section>
              ))}
              {(UNPLACED.length > 0 || UNKNOWN.length > 0) && (
                <p className="warn">
                  {UNPLACED.length > 0 && (
                    <>
                      {UNPLACED.length} {UNPLACED.length === 1 ? 'parameter of FASTag is' : 'parameters of FASTag are'} missing
                      from the form: {UNPLACED.join(', ')}.{' '}
                    </>
                  )}
                  {UNKNOWN.length > 0 && (
                    <>
                      {UNKNOWN.length} {UNKNOWN.length === 1 ? 'form entry names' : 'form entries name'} no such
                      parameter: {UNKNOWN.join(', ')}.
                    </>
                  )}
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
