import { useEffect, useRef, useState, type JSX } from 'react'
import type { BinaryInfo } from './types'
import { inertDependency } from './paramLayout'
import { IconCheck } from './icons'
import HelpView from './help/HelpView'
import { closeHelp, openHelp, useHelp } from './help/link'
import ParamSearch from './setup/ParamSearch'
import type { ParamHit } from './setup/searchRank'
import { actionOfKey, deduper, type Action } from './setup/shortcuts'
import { useSession } from './setup/useSession'
import SetupForm from './setup/SetupForm'
import { useRun } from './run/useRun'
import RunBar from './run/RunBar'
import LogDrawer from './run/LogDrawer'
import ResultTabs from './results/ResultTabs'
import { createViewStore, useView } from './app/viewStore'
import { defaultOut, rebaseOutputs } from './app/paths'
import { focusLater } from './app/focus'
import logo from './assets/logo.svg'
import openmsLogo from './assets/openms-logo.png'

// The app shell (P1 PR c): the header, the close and overwrite questions,
// shortcuts and menus, and the three parts it lays out. The state lives in
// useSession (the form), useRun (runs and their results) and the view store
// (tab and log drawer); the parts render it.
export default function App(): JSX.Element {
  const [bin, setBin] = useState<BinaryInfo | null>(null)
  // The backend's close guard asks: the window was closed, or the app asked
  // to quit, while a run or batch is active.
  const [closeAsk, setCloseAsk] = useState<'close' | 'quit' | null>(null)
  // Parameter search (Cmd+K, "/"): the dialog is open.
  const [searchOpen, setSearchOpen] = useState(false)
  const searchBtnRef = useRef<HTMLButtonElement>(null)
  const logRef = useRef<HTMLPreElement>(null)
  const [viewStore] = useState(() => createViewStore())
  const view = useView(viewStore)
  const { tab, logOpen, logJob } = view
  const session = useSession()
  const { input, out, values, blocked } = session
  const run = useRun(session, viewStore)
  const { running, batchRunning, busy, jobs } = run

  const help = useHelp()
  // F1 (or ?, outside a text field) opens Help; Esc closes it.
  useEffect(() => {
    const typing = (t: EventTarget | null): boolean =>
      t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'F1' || (e.key === '?' && !typing(e.target))) {
        e.preventDefault()
        // Already open: stay where the reader is.
        if (!help.open) openHelp()
      } else if (e.key === 'Escape' && help.open && !typing(e.target)) {
        e.preventDefault()
        closeHelp()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [help.open])

  // Cmd/Ctrl shortcuts in the webview and the native menu items (menu.rs)
  // run one action each; a key both see acts once (deduper).
  useEffect(() => {
    const fresh = deduper()
    const onKey = (e: globalThis.KeyboardEvent): void => {
      const a = actionOfKey(e)
      if (!a) return
      e.preventDefault()
      if (fresh(a, 'key')) actRef.current(a)
    }
    window.addEventListener('keydown', onKey)
    const off = window.fastag.onMenu((name) => {
      const a = name as Action
      if (fresh(a, 'menu')) actRef.current(a)
    })
    return () => {
      window.removeEventListener('keydown', onKey)
      off()
    }
  }, [])

  useEffect(() => {
    window.fastag.probe().then(setBin)
  }, [])

  // The backend asks before a close or quit kills an active run.
  useEffect(() => window.fastag.onCloseRequested((what) => setCloseAsk(what)), [])

  // Open the log of a batch job (null: the live log) in the drawer.
  function openLog(job: string | null | undefined): void {
    viewStore.setLogJob(job ?? null)
    viewStore.setLogOpen(true)
    focusLater(() => logRef.current)
  }

  async function pickInput(): Promise<void> {
    if (running || batchRunning) return
    const p = await window.fastag.pickInput()
    if (p) {
      session.setInput(p)
      session.setOut(defaultOut(p))
      session.setValues((v) => ({ ...v, ...rebaseOutputs(v, defaultOut(p)) }))
    }
  }

  // Not behind a batch queue: the single input and output are hidden then.
  const canRun = !!bin?.ok && !!input && !!out && !running && !batchRunning && jobs.length === 0 && !blocked

  // A parameter chosen in the search: open its section, focus its field (or,
  // while the field is inert, the switch it waits for).
  function chooseParam(hit: ParamHit): void {
    setSearchOpen(false)
    if (hit.section) session.setOpenGroups((g) => ({ ...g, [hit.section]: true }))
    setTimeout(() => {
      let el = document.getElementById(`p-${hit.name}`) as HTMLInputElement | null
      if (el && el.disabled) {
        const dep = inertDependency(hit.name, values)
        const on = dep ? (Array.isArray(dep.on) ? dep.on[0] : dep.on) : null
        const master = on ? (document.getElementById(`p-${on}`) as HTMLInputElement | null) : null
        if (master && !master.disabled) el = master
      }
      el?.scrollIntoView?.({ block: 'center' })
      el?.focus()
    })
  }

  // Shortcuts and native menus run the same actions (setup/shortcuts.ts).
  const act = (a: Action): void => {
    switch (a) {
      case 'open-spectra':
        if (!busy && jobs.length === 0) void pickInput()
        break
      case 'open-results':
        if (!busy) void run.openResults()
        break
      case 'run':
        if (jobs.length > 0) {
          if (!batchRunning && !running && bin?.ok && !blocked && run.remaining > 0) void run.runBatch()
        } else if (canRun) void run.run()
        break
      case 'cancel':
        run.cancelRun()
        break
      case 'export':
        viewStore.setTab('results')
        window.dispatchEvent(new CustomEvent('fastag-action', { detail: 'export' }))
        break
      case 'reveal':
        void run.reveal(false)
        break
      case 'help':
        if (!help.open) openHelp()
        break
      case 'search-params':
        if (!busy && !help.open) setSearchOpen(true)
        break
    }
  }
  const actRef = useRef(act)
  actRef.current = act

  const overwriteAsk = run.overwriteAsk
  // The drawer shows the live log, or the kept log of a batch job.
  const logJobEntry = logJob ? jobs.find((j) => j.input === logJob && j.log) : undefined

  return (
    <div className="app">
      {closeAsk && (
        // The backend's close guard: closing or quitting would kill the run.
        <div className="modal-backdrop">
          <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="close-ask-h" aria-describedby="close-ask-p">
            <h2 id="close-ask-h">{busy && jobs.length > 0 ? 'A batch is running' : 'FASTag is running'}</h2>
            <p id="close-ask-p">
              {closeAsk === 'quit' ? 'Quitting' : 'Closing the window'} stops the run
              {batchRunning ? ' and the rest of the batch' : ''}, and removes the files it has written so far.
            </p>
            <div className="row actions">
              <button
                className="danger"
                onClick={() => {
                  run.cancelForQuit()
                  setCloseAsk(null)
                  window.fastag.answerClose(true)
                }}
              >
                Cancel run and quit
              </button>
              <button
                className="secondary"
                autoFocus
                onClick={() => {
                  setCloseAsk(null)
                  window.fastag.answerClose(false)
                }}
              >
                Keep running
              </button>
            </div>
          </div>
        </div>
      )}
      {overwriteAsk && (
        // Outputs that already exist: asked before the run, never after.
        <div className="modal-backdrop">
          <div
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="overwrite-ask-h"
            aria-describedby="overwrite-ask-p"
          >
            <h2 id="overwrite-ask-h">
              {overwriteAsk.files.length === 1 ? 'An output already exists' : `${overwriteAsk.files.length} outputs already exist`}
            </h2>
            <p id="overwrite-ask-p">
              The run writes over {overwriteAsk.files.length === 1 ? 'this file' : 'these files'}. If it is cancelled or
              fails, {overwriteAsk.files.length === 1 ? 'it is' : 'they are'} removed, not restored.
            </p>
            <ul className="overwrite-list">
              {overwriteAsk.files.slice(0, 12).map((f) => (
                <li key={f}>
                  <code>{f}</code>
                </li>
              ))}
              {overwriteAsk.files.length > 12 && <li>and {overwriteAsk.files.length - 12} more</li>}
            </ul>
            <div className="row actions">
              <button
                className="danger"
                onClick={() => {
                  run.setOverwriteAsk(null)
                  overwriteAsk.answer(true)
                }}
              >
                Overwrite and run
              </button>
              <button
                className="secondary"
                autoFocus
                onClick={() => {
                  run.setOverwriteAsk(null)
                  overwriteAsk.answer(false)
                }}
              >
                Don't run
              </button>
            </div>
          </div>
        </div>
      )}
      <header className="appbar">
        <img className="logo" src={logo} alt="" width={22} height={22} />
        <h1>FASTag</h1>
        {bin?.version && <span className="ver">{bin.version}</span>}
        {bin && (
          <span className={`chip ${bin.ok ? 'ok' : 'bad'}`} title={`${bin.detail} · ${bin.bin}`}>
            {bin.ok ? (
              <>
                <IconCheck />
                FASTag ready
              </>
            ) : (
              `FASTag cannot start: ${bin.detail.replace(/^cannot (run|execute): /, '')}`
            )}
          </span>
        )}
        <span className="spacer" />
        {help.open ? (
          <button type="button" className="secondary small" onClick={() => closeHelp()}>
            Back to FASTag
          </button>
        ) : (
          <button type="button" className="secondary small" aria-keyshortcuts="F1" title="Help (F1)" onClick={() => openHelp()}>
            Help
          </button>
        )}
        <span className="openms" title="FASTag is an OpenMS TOPP tool — openms.de">
          Built on
          <img src={openmsLogo} alt="OpenMS" />
        </span>
      </header>

      {help.open && <HelpView />}
      {/* Hidden, not unmounted: the form, the batch and the results stay as they were. */}
      <div className="layout" hidden={help.open}>
        <aside className="controls" aria-label="Run setup">
          {searchOpen && !busy && (
            <ParamSearch
              onChoose={chooseParam}
              onClose={() => {
                setSearchOpen(false)
                focusLater(() => searchBtnRef.current)
              }}
            />
          )}
          <SetupForm
            session={session}
            run={run}
            onPickInput={pickInput}
            logJob={logJob}
            logOpen={logOpen}
            openLog={openLog}
            onSearch={() => setSearchOpen(true)}
            searchBtnRef={searchBtnRef}
          />
          <RunBar
            announce={run.announce}
            running={running}
            busy={busy}
            batchRunning={batchRunning}
            cancelling={run.cancelling}
            progress={run.progress}
            phase={run.phase}
            startedAt={run.startedAt}
            invalid={session.invalid}
            refused={session.refused}
            fixes={session.fixes}
            onFix={session.applyFix}
            input={input}
            jobs={jobs.length}
            remaining={run.remaining}
            failedJobs={run.failedJobs}
            binOk={!!bin?.ok}
            canRun={canRun}
            instrument={session.instrument}
            values={values}
            onInstrument={session.chooseInstrument}
            onRun={run.run}
            onRunBatch={(only) => run.runBatch(only)}
            onCancel={run.cancelRun}
            onReset={session.reset}
          />
        </aside>

        <ResultTabs
          tab={tab}
          setTab={viewStore.setTab}
          species={run.species}
          speciesRun={run.speciesRun}
          speciesOn={session.speciesOn}
          tooShort={session.tooShort}
          evidence={run.evidence}
          reports={run.reports}
          batchMiss={run.batchMiss}
          results={run.results}
          setResults={run.setResults}
          running={running}
          busy={busy}
          failure={run.failure}
          setFailure={run.setFailure}
          copied={run.copied}
          setCopied={run.setCopied}
          openResults={run.openResults}
          openReport={run.openReport}
          openLog={openLog}
        >
          <LogDrawer
            log={logJobEntry?.log ?? run.log}
            live={run.log}
            open={logOpen}
            job={logJobEntry?.input}
            onToggle={() => viewStore.setLogOpen((o) => !o)}
            onShowLive={() => openLog(null)}
            logRef={logRef}
          />
        </ResultTabs>
      </div>
    </div>
  )
}
