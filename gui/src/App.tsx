import { useEffect, useRef, useState, type JSX } from 'react'
import type { BinaryInfo } from './types'
import { inertDependency } from './paramLayout'
import HelpView from './help/HelpView'
import { closeHelp, openHelp, useHelp } from './help/link'
import ParamSearch from './setup/ParamSearch'
import type { ParamHit } from './setup/searchRank'
import { viewOfAction, type Action, type View } from './setup/shortcuts'
import { useKeys } from './shell/useKeys'
import { useSession } from './setup/useSession'
import SetupForm from './setup/SetupForm'
import { useRun } from './run/useRun'
import RunBar from './run/RunBar'
import LogDrawer from './run/LogDrawer'
import BatchList from './run/BatchList'
import ResultTabs from './results/ResultTabs'
import FailureBanner from './results/FailureBanner'
import { createViewStore, useView } from './app/viewStore'
import { defaultOut, rebaseOutputs } from './app/paths'
import { focusLater } from './app/focus'
import { useTheme, type Theme } from './app/theme'
import TopBar from './shell/TopBar'
import HistoryView from './shell/HistoryView'
import AboutDialog from './shell/AboutDialog'
import { useDrops } from './shell/useDrops'
import { CloseQuestion, OverwriteQuestion } from './shell/Questions'
import Notices, { type Toast } from './shell/Notices'
import { useFinish } from './shell/useFinish'

// The app shell (P1 PR c; the P2a shell, PR s): the top bar with the four
// views and the progress pill, the Help side panel, the close and overwrite
// questions, shortcuts, native menus, drops and the finish notice. The state
// lives in useSession (the form), useRun (runs and their results) and the
// view store (tab and log drawer); the views render it.
export default function App(): JSX.Element {
  const [bin, setBin] = useState<BinaryInfo | null>(null)
  // The view shown (Cmd+1..4, the top bar, the View menu).
  const [view, setView] = useState<View>('setup')
  const viewRef = useRef(view)
  viewRef.current = view
  const [theme, setTheme] = useTheme()
  const [aboutOpen, setAboutOpen] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  // Bumped when a run ends: History reads the record again.
  const [historyVersion, setHistoryVersion] = useState(0)
  const emptyBatchRef = useRef<HTMLButtonElement>(null)
  const addBatchRef = useRef<HTMLButtonElement>(null)
  // The backend's close guard asks: the window was closed, or the app asked
  // to quit, while a run or batch is active.
  const [closeAsk, setCloseAsk] = useState<'close' | 'quit' | null>(null)
  // Parameter search (Cmd+K, "/"): the dialog is open.
  const [searchOpen, setSearchOpen] = useState(false)
  const searchBtnRef = useRef<HTMLButtonElement>(null)
  const logRef = useRef<HTMLPreElement>(null)
  const [viewStore] = useState(() => createViewStore())
  const { tab, logOpen, logJob } = useView(viewStore)
  const session = useSession()
  const { input, out, values, blocked } = session
  const run = useRun(session, viewStore, { onStart: () => setView('results') })
  const { running, batchRunning, busy, jobs } = run

  const help = useHelp()
  // F1, ?, Esc, the Cmd/Ctrl shortcuts and the native menus (shell/useKeys.ts).
  useKeys(help.open, (a) => actRef.current(a), () => escRef.current())

  useEffect(() => {
    window.fastag.probe().then(setBin)
  }, [])

  // The backend asks before a close or quit kills an active run.
  useEffect(() => window.fastag.onCloseRequested((what) => setCloseAsk(what)), [])

  // Navigation (GUI-DESIGN 2): a run moves to Results (useRun's onStart);
  // the first file of a queue moves to Batch.
  const hadJobs = useRef(0)
  useEffect(() => {
    if (jobs.length > 0 && hadJobs.current === 0) setView('batch')
    hadJobs.current = jobs.length
  }, [jobs.length])

  // A view switch that hid the focused control (Run moving to Results, a
  // drop, Cmd+1..4, a toast's Open) would leave focus on the page body: move
  // it to the view now shown, whose label a screen reader then announces.
  const viewsRef = useRef<HTMLDivElement>(null)
  const shownView = useRef(view)
  useEffect(() => {
    if (shownView.current === view) return
    shownView.current = view
    const a = document.activeElement
    if (a && a !== document.body && !a.closest('[hidden]')) return
    viewsRef.current?.querySelector<HTMLElement>(`.view[data-view="${view}"]`)?.focus()
  }, [view])

  useFinish({
    lastRun: run.lastRun,
    batchEnd: run.batchEnd,
    view: () => viewRef.current,
    toast: setToast,
    ended: () => setHistoryVersion((n) => n + 1)
  })

  // Open the log of a batch job (null: the live log) in the drawer, which
  // sits on the Batch view while there is a queue and on Results otherwise.
  function openLog(job: string | null | undefined): void {
    setView(jobs.length > 0 ? 'batch' : 'results')
    viewStore.setLogJob(job ?? null)
    viewStore.setLogOpen(true)
    focusLater(() => logRef.current)
  }

  // The single input, picked or dropped, with its outputs beside it.
  function setInputPath(p: string): void {
    session.setInput(p)
    session.setOut(defaultOut(p))
    session.setValues((v) => ({ ...v, ...rebaseOutputs(v, defaultOut(p)) }))
  }

  async function pickInput(): Promise<void> {
    if (running || batchRunning) return
    const p = await window.fastag.pickInput()
    if (p) setInputPath(p)
  }

  // A results file picked (menu, History, the empty states): Results.
  async function openResults(): Promise<void> {
    if (await run.openResults()) setView('results')
  }

  // OS file drops, routed by type (drop.rs, shell/useDrops.ts).
  const { dragOver, dropNote, dismissNote } = useDrops({ busy, jobs: jobs.length, setInputPath, session, run, setView })

  // Esc outside a field: dismisses a shown notice (the drop note, then the
  // toast) first, so dismissing one never kills a run; else cancels a run
  // when no question or dialog is open.
  const escape = (): boolean => {
    if (closeAsk || run.overwriteAsk || aboutOpen || searchOpen) return false
    if (dropNote) {
      dismissNote()
      return true
    }
    if (toast) {
      setToast(null)
      return true
    }
    if (!running || run.cancelling) return false
    run.cancelRun()
    return true
  }
  const escRef = useRef(escape)
  escRef.current = escape

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
    const v = viewOfAction(a)
    if (v) {
      setView(v)
      return
    }
    switch (a) {
      case 'open-spectra':
        if (!busy && jobs.length === 0) {
          setView('setup')
          void pickInput()
        }
        break
      case 'open-results':
        if (!busy) void openResults()
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
        setView('results')
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
        if (!busy && !help.open) {
          setView('setup')
          setSearchOpen(true)
        }
        break
      case 'faq':
        openHelp('troubleshooting')
        break
      case 'about':
        setAboutOpen(true)
        break
      case 'theme-system':
      case 'theme-light':
      case 'theme-dark':
        setTheme(a.slice(6) as Theme)
        break
    }
  }
  const actRef = useRef(act)
  actRef.current = act

  const overwriteAsk = run.overwriteAsk
  // The drawer shows the live log, or the kept log of a batch job.
  const logJobEntry = logJob ? jobs.find((j) => j.input === logJob && j.log) : undefined
  // The run bar and the log drawer sit with the queue while there is one.
  const runBarView: View = jobs.length > 0 ? 'batch' : 'setup'
  const runningJob = jobs.findIndex((j) => j.status === 'running')
  const activeInput = runningJob >= 0 ? jobs[runningJob].input : running ? input : null
  const batchAt = batchRunning && runningJob >= 0 ? { at: runningJob + 1, of: jobs.length } : null
  const drawer = (
    <LogDrawer
      log={logJobEntry?.log ?? run.log}
      live={run.log}
      open={logOpen}
      job={logJobEntry?.input}
      onToggle={() => viewStore.setLogOpen((o) => !o)}
      onShowLive={() => openLog(null)}
      logRef={logRef}
    />
  )
  const runBar = (
    <RunBar
      announce={run.announce}
      announceElsewhere
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
  )

  return (
    <div className="app">
      {closeAsk && (
        <CloseQuestion
          what={closeAsk}
          batch={busy && jobs.length > 0}
          batchRunning={batchRunning}
          onAnswer={(quit) => {
            if (quit) run.cancelForQuit()
            setCloseAsk(null)
            window.fastag.answerClose(quit)
          }}
        />
      )}
      {overwriteAsk && (
        <OverwriteQuestion
          ask={overwriteAsk}
          onAnswer={(yes) => {
            run.setOverwriteAsk(null)
            overwriteAsk.answer(yes)
          }}
        />
      )}
      {aboutOpen && <AboutDialog bin={bin} onClose={() => setAboutOpen(false)} />}
      <TopBar
        bin={bin}
        view={view}
        onView={setView}
        badges={{ batch: jobs.length || undefined }}
        pill={{
          running,
          batchRunning,
          cancelling: run.cancelling,
          input: activeInput,
          batch: batchAt,
          phase: run.phase,
          progress: run.progress,
          runBarShown: view === runBarView,
          onShow: () => setView(jobs.length > 0 ? 'batch' : 'results'),
          onCancel: run.cancelRun
        }}
        theme={theme}
        onTheme={setTheme}
        helpOpen={help.open}
        onHelp={() => (help.open ? closeHelp() : openHelp())}
      />
      {/* The run's live region: always in the page, whichever view is shown. */}
      <p className="sr-only" role="status">
        {run.announce}
      </p>

      <div className="shell">
        <div className="views" ref={viewsRef}>
          {/* Hidden, not unmounted: the form, the batch and the results stay as they were. */}
          <section className="view view-setup" data-view="setup" hidden={view !== 'setup'} tabIndex={-1} aria-label="Setup">
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
                onSearch={() => setSearchOpen(true)}
                searchBtnRef={searchBtnRef}
                onOpenBatch={() => setView('batch')}
                addBatchRef={addBatchRef}
              />
              {runBarView === 'setup' && runBar}
            </aside>
          </section>

          <section className="view view-results" data-view="results" hidden={view !== 'results'} tabIndex={-1} aria-label="Results">
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
              openResults={openResults}
              openReport={run.openReport}
              openLog={openLog}
              showFailure={jobs.length === 0}
            >
              {jobs.length === 0 && drawer}
            </ResultTabs>
          </section>

          <section className="view view-batch" data-view="batch" hidden={view !== 'batch'} tabIndex={-1} aria-label="Batch">
            {jobs.length > 0 ? (
              <div className="batchview">
                <div className="batch-main">
                  {run.failure && (
                    <FailureBanner
                      failure={run.failure}
                      copied={run.copied}
                      setFailure={run.setFailure}
                      setCopied={run.setCopied}
                      openLog={openLog}
                      focusAfter={() => document.getElementById('batch-label')}
                    />
                  )}
                  <BatchList
                    jobs={jobs}
                    busy={busy}
                    results={run.results}
                    logJob={logJob}
                    logOpen={logOpen}
                    onAdd={run.addBatchFiles}
                    onClear={() => run.removeJobs(jobs.map((j) => j.input))}
                    onRemove={(i) => run.removeJobs([jobs[i].input])}
                    onShow={(j) => {
                      run.showJob(j)
                      if (j.outputs) setView('results')
                    }}
                    onLog={openLog}
                    addBatchRef={emptyBatchRef}
                  />
                  {runBar}
                </div>
                {drawer}
              </div>
            ) : (
              <div className="empty batch-empty">
                <h2>No batch yet</h2>
                <p className="muted">Queue several spectra files to run them in turn with the same parameters.</p>
                <button type="button" className="secondary" ref={emptyBatchRef} onClick={run.addBatchFiles} disabled={busy}>
                  Add files for a batch…
                </button>
              </div>
            )}
          </section>

          <section className="view view-history" data-view="history" hidden={view !== 'history'} tabIndex={-1} aria-label="History">
            <HistoryView active={view === 'history'} version={historyVersion} busy={busy} onOpenResults={openResults} />
          </section>
        </div>
        {help.open && (
          <aside id="help-panel" className="help-panel" aria-label="Help">
            <HelpView />
          </aside>
        )}
      </div>

      <Notices
        dragOver={dragOver}
        dropNote={dropNote}
        toast={toast}
        onDismissNote={dismissNote}
        onDismissToast={() => setToast(null)}
        onOpen={(to) => {
          setView(to)
          setToast(null)
        }}
      />
    </div>
  )
}
