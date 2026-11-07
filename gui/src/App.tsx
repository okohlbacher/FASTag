import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
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
import SummaryTable from './run/SummaryTable'
import ResultTabs from './results/ResultTabs'
import FailureBanner from './results/FailureBanner'
import { createViewStore, useView } from './app/viewStore'
import { createExportJobs, ExportJobsContext } from './results/exportJobs'
import { defaultOut, rebaseOutputs } from './app/paths'
import { focusLater, focusLost } from './app/focus'
import { useTheme, type Theme } from './app/theme'
import TopBar from './shell/TopBar'
import HistoryView from './shell/HistoryView'
import AboutDialog from './shell/AboutDialog'
import { useDrops } from './shell/useDrops'
import { CloseQuestion, OverwriteQuestion } from './shell/Questions'
import Notices, { type Toast } from './shell/Notices'
import { useFinish } from './shell/useFinish'
import { LANDING, type Origin } from './setup/tasks'
import PlanFooter from './setup/PlanFooter'
import { SECTION_OF } from './paramLayout'
import type { ParamValue } from './ParamField'
import RunningPanel from './results/RunningPanel'
import { buildOverview, type TileAction } from './results/overview'
import { reconExtend, reconRerun } from './results/ReconView'
import { useInspector } from './inspector/useInspector'
import { AfterRunPanel, PreStartPanel } from './inspector/InspectorPanel'
import { postRunChecks } from './inspector/checks'
import { INSTRUMENTS, matchesInstrument, presetText } from './setup/presets'

// The tasks whose run lands on the Overview tab (D8): they characterize it.
const OVERVIEW_TASKS: readonly (string | null)[] = ['characterize', 'batch-qc']
// The FASTA formats the recon_fasta field takes.
const FASTA_FORMATS = ['fasta', 'fa', 'faa']

// The app shell (P1 PR c; the P2a shell, PR s): the top bar with the four
// views and the progress pill, the Help side panel, the close and overwrite
// questions, shortcuts, native menus, drops and the finish notice. The state
// lives in useSession (the form), useRun (runs and their results) and the
// view store (tab and log drawer); the views render it.
///
/// @p start: where the session's values come from; the app lands on the
/// built-in task "Characterize a run" (D1, GUI-DESIGN 3 S1).
export default function App({ start = LANDING }: { start?: Origin } = {}): JSX.Element {
  const [bin, setBin] = useState<BinaryInfo | null>(null)
  // The view shown (Cmd+1..4, the top bar, the View menu).
  const [view, setView] = useState<View>('setup')
  const viewRef = useRef(view)
  viewRef.current = view
  const [theme, setTheme] = useTheme()
  const [aboutOpen, setAboutOpen] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  // What Add folder… found: a folder without spectra, or one that could not
  // be read; shown where it was asked from (Setup's Batch QC card or the
  // Batch view), in a live region always in the page there.
  const [folderNote, setFolderNote] = useState<{ text: string; from: 'setup' | 'batch' } | null>(null)
  // Bumped when a run ends: History reads the record again.
  const [historyVersion, setHistoryVersion] = useState(0)
  const emptyBatchRef = useRef<HTMLButtonElement>(null)
  // The queue's Add… button, where focus goes when the empty state that
  // held it is replaced by the queue.
  const queueAddRef = useRef<HTMLButtonElement>(null)
  const addBatchRef = useRef<HTMLButtonElement>(null)
  // The backend's close guard asks: the window was closed, or the app asked
  // to quit, while a run or batch is active.
  const [closeAsk, setCloseAsk] = useState<'close' | 'quit' | null>(null)
  // Parameter search (Cmd+K, "/"): the dialog is open.
  const [searchOpen, setSearchOpen] = useState(false)
  const searchBtnRef = useRef<HTMLButtonElement>(null)
  const logRef = useRef<HTMLPreElement>(null)
  const [viewStore] = useState(() => createViewStore())
  // Export jobs outlive the tags table (it unmounts on a tab switch).
  const [exportJobs] = useState(createExportJobs)
  const { tab, logOpen, logJob } = useView(viewStore)
  const session = useSession(start)
  const { input, out, values, blocked } = session
  const taskRef = useRef(session.task)
  taskRef.current = session.task
  const run = useRun(session, viewStore, {
    onStart: () => setView('results'),
    overviewLanding: () => OVERVIEW_TASKS.includes(taskRef.current)
  })
  const { running, batchRunning, busy, jobs } = run
  // The checks before a run (GUI-DESIGN 3 S1, P2b): from the CLI's metadata
  // probe when it has one, and the form.
  const inspector = useInspector({ input, values, binOk: !!bin?.ok })
  // Re-run with this instrument preset once the form holds its values.
  const [rerunWith, setRerunWith] = useState<string | null>(null)

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
    if (jobs.length > 0 && hadJobs.current === 0) {
      setView('batch')
      // Files or a folder added from the Batch view's empty state: the
      // button that added them is gone with it.
      focusLater(() => (focusLost() ? queueAddRef.current : null))
    }
    hadJobs.current = jobs.length
  }, [jobs.length])

  // A batch pass ended: the Run and the queue's buttons were disabled or
  // gone while it ran, so focus moves to the summary it filled.
  const seenBatchEnd = useRef(run.batchEnd)
  useEffect(() => {
    if (run.batchEnd === seenBatchEnd.current) return
    seenBatchEnd.current = run.batchEnd
    if (!run.batchEnd) return
    focusLater(() => {
      const batch = viewsRef.current?.querySelector<HTMLElement>('.view[data-view="batch"]')
      if (!focusLost() || !batch || batch.hidden) return null
      return batch.querySelector<HTMLElement>('#sum-h') ?? batch
    })
  }, [run.batchEnd])

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

  // The running state goes away when the run ends or is cancelled; focus
  // that was on its Cancel or Show log would fall to the page body. After a
  // finished run it moves to the selected results tab (the Overview of a
  // characterizing run), after a cancel or a failure to the Results view.
  const lastRunRef = useRef(run.lastRun)
  lastRunRef.current = run.lastRun
  function runStateGone(): void {
    focusLater(() => {
      const a = document.activeElement
      if (a && a !== document.body) return null
      const results = viewsRef.current?.querySelector<HTMLElement>('.view[data-view="results"]')
      if (!results || results.hidden) return null
      const lr = lastRunRef.current
      const tab = lr?.ok && !lr.cancelled ? results.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') : null
      return tab ?? results
    })
  }

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

  // Add folder… (the Batch view, Batch QC's input card): the spectra files
  // directly inside a folder join the queue, as a dropped folder's do.
  async function addFolder(from: 'setup' | 'batch'): Promise<void> {
    setFolderNote(null)
    try {
      const r = await run.addBatchFolder()
      if (r && r.files === 0) setFolderNote({ text: `No spectra files (mzML, mzPeak, MGF) directly in ${r.dir}.`, from })
    } catch (e) {
      setFolderNote({ text: `Cannot read the folder: ${e instanceof Error ? e.message : String(e)}`, from })
    }
  }
  // The folder note's live region at @p from: always mounted, empty there
  // unless the note was asked from there.
  const folderNoteAt = (from: 'setup' | 'batch'): JSX.Element => (
    <p className="hint note-flag folder-note" role="status">
      {folderNote?.from === from ? folderNote.text : ''}
    </p>
  )

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

  // The Overview of the run whose results are shown (GUI-DESIGN 3 S3). Its
  // fragment tolerance came from the instrument preset chosen when that
  // preset still matches what the run was sent.
  const shown = run.shown
  const preset = INSTRUMENTS.find((x) => x.id === session.instrument)
  const presetLabel = shown && preset && matchesInstrument(shown.params, preset) ? presetText(preset) : null
  const overview = useMemo(
    () =>
      shown
        ? {
            model: buildOverview({ log: shown.log, reports: shown.reports, species: shown.species, census: null, params: shown.params, instrument: presetLabel }),
            input: shown.input,
            // Its actions run the form's input again: not another file's.
            locked: shown.input !== input || jobs.length > 0
          }
        : null,
    [shown, presetLabel, input, jobs.length]
  )

  // An Overview tile's action: the option on in the form, and the run again
  // with it. An output named by its file (digest.tsv) goes beside -out.
  async function overviewAction(a: TileAction): Promise<void> {
    // Not over a value the CLI would refuse: Run is disabled for it too.
    if (busy || blocked) return
    let set: Record<string, ParamValue>
    if (a.kind === 'add-fasta') {
      const p = await window.fastag.pickFile(FASTA_FORMATS)
      if (!p) return
      // With the extension the tile names (overview.ts FASTA_EXTENSION):
      // Characterize's tags are too short for a proteome's recon index.
      set = { ...a.values, recon_fasta: p, recon_out: 'recon.tsv', massgap_out: 'massgap.tsv' }
    } else set = a.values
    const beside = rebaseOutputs({ ...values, ...set }, out)
    const over: Record<string, ParamValue> = Object.fromEntries(
      Object.entries(set).map(([k, v]) => [k, k in beside ? beside[k] : v])
    )
    session.setValues((v) => ({ ...v, ...over }))
    await run.runWith(over)
  }

  // Not behind a batch queue: the single input and output are hidden then.
  const canRun = !!bin?.ok && !!input && !!out && !running && !batchRunning && jobs.length === 0 && !blocked && !inspector.held

  // The checks after a run, from its reports and FASTag's log lines.
  const after = postRunChecks({ reports: run.reports.list, notes: run.shownNotes })
  const afterInput = run.results?.input ?? ''
  // A finished run names its red flags after the run too (the panel over
  // the result tabs shows them).
  const afterFlags = after.checks.filter((c) => c.level === 'flag').length
  const announce =
    !running && afterFlags > 0 && run.announce.startsWith('Finished ')
      ? `${run.announce} ${afterFlags} ${afterFlags === 1 ? 'red flag' : 'red flags'} after the run: see Checks after the run.`
      : run.announce
  const canRerun = !busy && jobs.length === 0 && !!bin?.ok && !!afterInput && afterInput === input && run.lastRun?.input === input
  useEffect(() => {
    if (!rerunWith) return
    const p = INSTRUMENTS.find((x) => x.id === rerunWith)
    if (!p || !matchesInstrument(values, p)) return
    setRerunWith(null)
    // Another check holds the run (species with a Da tolerance): Setup
    // shows it, with its Run anyway.
    if (canRun) void run.run()
    else setView('setup')
  }, [rerunWith, values, canRun])
  const detectedPreset = inspector.pre.detected?.preset ?? null
  const chosenInstrument = INSTRUMENTS.find((x) => x.id === detectedPreset && matchesInstrument(values, x))?.id ?? ''

  // A parameter chosen in the search: open its section, focus its field (or,
  // while the field is inert, the switch it waits for).
  function chooseParam(hit: ParamHit): void {
    setSearchOpen(false)
    if (hit.section) session.setOpenGroups((g) => ({ ...g, [hit.section]: true }))
    setTimeout(() => {
      let el = document.getElementById(`p-${hit.name}`) as HTMLInputElement | null
      // Hidden until its section's switch is on: the switch.
      const master = SECTION_OF.get(hit.name)?.master
      if (el?.closest('[hidden]') && master) el = document.getElementById(`p-${master}`) as HTMLInputElement | null
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

  // A done batch job's results, in Results.
  function showBatchJob(j: (typeof jobs)[number]): void {
    run.showJob(j)
    if (j.outputs) setView('results')
  }

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
      detectedInstrument={detectedPreset}
      inspectorHeld={inspector.held}
      inspectorChecking={inspector.checking}
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
          // The run bar, or the Results pane's running state, shows it.
          runBarShown: view === runBarView || (view === 'results' && running && jobs.length === 0),
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
        {announce}
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
                onAddFolder={() => void addFolder('setup')}
                folderNote={folderNoteAt('setup')}
                addBatchRef={addBatchRef}
                onOpenResults={openResults}
                inspector={
                  <PreStartPanel
                    checks={inspector.pre.checks}
                    detected={inspector.pre.detected}
                    notChecked={inspector.pre.notChecked}
                    pending={inspector.pre.pending}
                    chosenInstrument={chosenInstrument}
                    isAnswered={inspector.isAnswered}
                    onRunAnyway={inspector.runAnyway}
                    onUndoRunAnyway={inspector.undoRunAnyway}
                    hasInput={!!input}
                    onInstrument={session.chooseInstrument}
                    onRecheck={inspector.recheck}
                  />
                }
              />
              {!busy && session.task !== 'open-results' && <PlanFooter session={session} run={run} />}
              {runBarView === 'setup' && session.task !== 'open-results' && runBar}
            </aside>
          </section>

          <section className="view view-results" data-view="results" hidden={view !== 'results'} tabIndex={-1} aria-label="Results">
            {!running && jobs.length === 0 && (
              <AfterRunPanel
                checks={after.checks}
                detected={after.detected}
                input={afterInput}
                onRerun={
                  canRerun
                    ? (id) => {
                        session.chooseInstrument(id)
                        setRerunWith(id)
                      }
                    : null
                }
              />
            )}
            <ExportJobsContext.Provider value={exportJobs}>
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
                overview={overview}
                onOverviewAction={(a) => void overviewAction(a)}
                rerunResConf={
                  // Only for the output of the run the form would repeat.
                  run.results?.input && run.results.input === input && jobs.length === 0 && bin?.ok
                    ? {
                        run: () => void overviewAction({ kind: 'enable', label: 'Re-run with per-residue confidence', values: { res_conf: true } }),
                        disabled: busy || !!blocked
                      }
                    : null
                }
                reconAction={
                  // The run shown, repeated with a FASTA or the reports on.
                  shown && overview && !overview.locked && bin?.ok
                    ? (() => {
                        const a = reconRerun(shown.params)
                        return { label: a.label, run: () => void overviewAction(a), disabled: busy || !!blocked }
                      })()
                    : null
                }
                reconExtend={
                  // The same run, when it placed too few with a short extension.
                  shown && overview && !overview.locked && bin?.ok
                    ? (() => {
                        const a = reconExtend(shown.params)
                        return a ? { label: a.label, run: () => void overviewAction(a), disabled: busy || !!blocked } : null
                      })()
                    : null
                }
                runningState={
                  running && jobs.length === 0 ? (
                    <RunningPanel
                      input={input}
                      phase={run.phase}
                      progress={run.progress}
                      startedAt={run.startedAt}
                      cancelling={run.cancelling}
                      onCancel={run.cancelRun}
                      onShowLog={() => openLog(null)}
                      onFocusLost={runStateGone}
                    />
                  ) : null
                }
              >
                {jobs.length === 0 && drawer}
              </ResultTabs>
            </ExportJobsContext.Provider>
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
                    onAddFolder={() => void addFolder('batch')}
                    outDir={run.outDir}
                    onChooseOutDir={() => void run.chooseOutDir()}
                    onClearOutDir={() => run.setOutDir(null)}
                    onClear={() => run.removeJobs(jobs.map((j) => j.input))}
                    onRemove={(i) => run.removeJobs([jobs[i].input])}
                    onShow={showBatchJob}
                    onLog={openLog}
                    addBatchRef={emptyBatchRef}
                    addRef={queueAddRef}
                  />
                  {folderNoteAt('batch')}
                  {runBar}
                </div>
                <div className="batch-side">
                  <SummaryTable
                    summary={run.summary}
                    busy={busy}
                    outDir={run.outDir}
                    onShow={(input) => {
                      const j = jobs.find((x) => x.input === input)
                      if (j) showBatchJob(j)
                    }}
                  />
                  {drawer}
                </div>
              </div>
            ) : (
              <div className="empty batch-empty">
                <h2>No batch yet</h2>
                <p className="muted">Queue several spectra files to run them in turn with the same parameters.</p>
                <div className="actions">
                  <button type="button" className="secondary" ref={emptyBatchRef} onClick={run.addBatchFiles} disabled={busy}>
                    Add files for a batch…
                  </button>
                  <button type="button" className="secondary" onClick={() => void addFolder('batch')} disabled={busy}>
                    Add folder…
                  </button>
                </div>
                {folderNoteAt('batch')}
              </div>
            )}
          </section>

          <section className="view view-history" data-view="history" hidden={view !== 'history'} tabIndex={-1} aria-label="History">
            <HistoryView
              active={view === 'history'}
              version={historyVersion}
              busy={busy}
              onOpenResults={openResults}
              onOpen={(p) => void run.openResultsPath(p).then(() => setView('results'))}
              onSettings={session.takeRun}
              onRerun={run.rerun}
              onGoSetup={() => setView('setup')}
            />
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
