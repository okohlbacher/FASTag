import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { BinaryInfo } from './types'
import { inertDependency, type Conflict } from './paramLayout'
import HelpView from './help/HelpView'
import { closeHelp, openHelp, useHelp } from './help/link'
import ParamSearch from './setup/ParamSearch'
import type { ParamHit } from './setup/searchRank'
import { viewOfAction, type Action, type View } from './setup/shortcuts'
import { useKeys } from './shell/useKeys'
import { useSession } from './setup/useSession'
import SetupForm, { ownerOf } from './setup/SetupForm'
import { useRun } from './run/useRun'
import RunBar, { NavBar, Preflight, type ActionNav } from './run/RunBar'
import PageHeader from './shell/PageHeader'
import EmptyState from './shell/EmptyState'
import LogDrawer from './run/LogDrawer'
import BatchList from './run/BatchList'
import SummaryTable from './run/SummaryTable'
import SdrfPanel from './sdrf/SdrfPanel'
import { useSdrf } from './sdrf/useSdrf'
import ResultTabs from './results/ResultTabs'
import { useSpectrumSupport } from './spectrum/support'
import FailureBanner from './results/FailureBanner'
import { createViewStore, useView } from './app/viewStore'
import { createExportJobs, ExportJobsContext } from './results/exportJobs'
import { defaultOut, rebaseOutputs } from './app/paths'
import { focusLater, focusLost } from './app/focus'
import { useTheme, type Theme } from './app/theme'
import TopBar from './shell/TopBar'
import HistoryView from './shell/HistoryView'
import AboutDialog from './shell/AboutDialog'
import FeedbackDialog from './feedback/FeedbackDialog'
import { useFeedback } from './feedback/useFeedback'
import { useDrops } from './shell/useDrops'
import { CloseQuestion, OverwriteQuestion } from './shell/Questions'
import Notices, { type Toast } from './shell/Notices'
import { useFinish } from './shell/useFinish'
import { LANDING, runValues, taskById, type Origin, type TaskId } from './setup/tasks'
import PlanFooter from './setup/PlanFooter'
import { INPUTS, aboutParams, inputParams, taskInputs, type Step } from './setup/inputs'
import { usePathStatus } from './setup/usePathStatus'
import { SECTION_OF } from './paramLayout'
import type { Tab } from './app/viewStore'
import type { ParamValue } from './ParamField'
import RunningPanel from './results/RunningPanel'
import { buildOverview, type TileAction } from './results/overview'
import { reconExtend, reconRerun } from './results/ReconView'
import { useInspector } from './inspector/useInspector'
import { AfterRunPanel, PreStartPanel, focusHeldCheck } from './inspector/InspectorPanel'
import { NOT_CHECKED_NO_PROBE, postRunChecks, type CheckFix } from './inspector/checks'
import { INSTRUMENTS, matchesInstrument, presetText, shownInstrument } from './setup/presets'

// The tab a workflow's run lands on (doc/GUI-WORKFLOWS.md 3): its own view.
// Generate tags and Species keep the Tags/Species rule of useRun.
const LANDING_TAB: Partial<Record<TaskId, Tab>> = { 'run-qc': 'qc', 'mass-shift': 'recon', 'db-reduction': 'shortlist', triage: 'triage', characterize: 'overview' }
// A .zip the picker let through that is not a timsTOF .d.zip.
const notSpectraZip = (p: string): boolean => /\.zip$/i.test(p) && !/\.d\.zip$/i.test(p)
// The FASTA formats the recon_fasta field takes.
const FASTA_FORMATS = ['fasta', 'fa', 'faa']

/// The input files step 2 shows that hold a path: the ones checked on disk.
/// The Help page of each Results tab: the app bar's Help opens the page of
/// the screen shown (doc/GUI-SETUP-WIZARD.md 1).
const TAB_HELP: Record<Tab, string> = {
  overview: 'workflow-overview',
  results: 'results',
  spectrum: 'results-spectrum',
  qc: 'workflow-run-qc',
  recon: 'workflow-reconciliation',
  species: 'species-reading',
  shortlist: 'workflow-db-reduction',
  triage: 'workflow-triage',
  digest: 'digest',
  glyco: 'files-glyco'
}

function stepTwoPaths(task: import('./setup/tasks').Task | null, values: Record<string, ParamValue>): string[] {
  return [...inputParams(task, values)].map((n) => String(values[n] ?? '').trim()).filter(Boolean)
}
/// The step whose control a refusal names first, for @p task: 2 for an input
/// or about field step 2 shows for the task with @p values (or a file not
/// found), else the step whose body holds its field (all four are mounted),
/// else (a field not built: a closed group) 3; null for a product. Step 2's
/// fields come first from @p values, not the page: this runs while the
/// change renders, and the page still has the field where it was before (the
/// Protein database under Advanced while the alkylation report is on, moving
/// to Inputs as Tag placements turn on). Never INPUTS.place alone: most tasks
/// keep the databases under Advanced.
function stepOfParam(name: string, task: import('./setup/tasks').Task | null, values: Record<string, ParamValue>): Step | null {
  if (name === 'in_file') return 2
  if (name === 'in' || name === 'out') return null
  if (inputParams(task, values).has(name) || aboutParams(task).includes(name)) return 2
  const at = Number(document.getElementById(`p-${name}`)?.closest<HTMLElement>('[data-step]')?.dataset.step ?? 0)
  if (at >= 2 && at <= 4) return at as Step
  return 3
}

// The app shell (P1 PR c; the P2a shell, PR s): the top bar with the four
// views and the progress pill, the Help side panel, the close and overwrite
// questions, shortcuts, native menus, drops and the finish notice. The state
// lives in useSession (the form), useRun (runs and their results) and the
// view store (tab and log drawer); the views render it.
///
/// @p start: where the session's values come from; the app lands on the
/// built-in task "Generate tags".
export default function App({ start }: { start?: Origin } = {}): JSX.Element {
  const [bin, setBin] = useState<BinaryInfo | null>(null)
  // The view shown (Cmd+1..4, the top bar, the View menu).
  const [view, setView] = useState<View>('setup')
  const viewRef = useRef(view)
  viewRef.current = view
  const [theme, setTheme] = useTheme()
  const [aboutOpen, setAboutOpen] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  // Why File > Open Example Data found nothing, shown as a drop note is.
  const [exampleNote, setExampleNote] = useState<string | null>(null)
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
  // The Results tab shown (ResultTabs), for Help's page.
  const shownTabRef = useRef<Tab | null>(null)
  const logRef = useRef<HTMLPreElement>(null)
  const [viewStore] = useState(() => createViewStore())
  // Export jobs outlive the tags table (it unmounts on a tab switch).
  const [exportJobs] = useState(createExportJobs)
  const { tab, logOpen, logJob } = useView(viewStore)
  // A launch that names its origin (the e2e `?start=`, the component
  // harness) has chosen it: the wizard opens on Inputs. A plain launch
  // opens on step 1 with the landing task selected.
  const session = useSession(start ?? LANDING, { confirmed: start !== undefined })
  const { input, out, values, blocked } = session
  const taskRef = useRef(session.task)
  taskRef.current = session.task
  const run = useRun(session, viewStore, {
    onStart: () => setView('results'),
    // A Mass-shift survey without a database wrote the tags only: no Mass shifts tab to land on.
    landing: (wf, params) => (wf === 'mass-shift' && params && !params['recon_out'] ? null : wf ? (LANDING_TAB[wf as TaskId] ?? null) : null),
    workflow: () => taskRef.current ?? null
  })
  const { running, batchRunning, busy, jobs } = run
  // The queued inputs reach the session's checks (mzPeak refusals per file).
  const queued = jobs.map((j) => j.input).join('\n')
  const { setBatchInputs } = session
  useEffect(() => setBatchInputs(queued ? queued.split('\n') : []), [queued, setBatchInputs])
  // The Batch view's SDRF (P4): compared with the jobs as they finish.
  const sdrf = useSdrf(run.jobs, run.batchData, {
    nodes: typeof values['taxonomy_nodes'] === 'string' ? values['taxonomy_nodes'] : undefined,
    names: typeof values['taxonomy_names'] === 'string' ? values['taxonomy_names'] : undefined
  })
  // The files no export may write (the loaded SDRF): every writeSummary
  // caller in the Batch view passes this one list, and the backend refuses
  // a destination that is one of them (report.rs write_summary).
  const sdrfPath = sdrf.file?.path ?? null
  const writeProtect = useMemo(() => (sdrfPath ? [sdrfPath] : []), [sdrfPath])
  // The checks before a run (GUI-DESIGN 3 S1, P2b): from the CLI's metadata
  // probe when it has one, and the form.
  // The values the run is sent (tasks.ts runValues, as useRun's toRun):
  // Mass-shift survey's shift reports off without a database, so no check
  // holds a run on a file it would not read (Codex finding 5).
  const runForm = useMemo(() => runValues(taskById(session.task ?? ''), values), [session.task, values])
  const inspector = useInspector({ input, values: runForm, binOk: !!bin?.ok })
  // Re-run with this fix (an instrument preset, its parameters) once the
  // form holds its values.
  const [rerunWith, setRerunWith] = useState<CheckFix | null>(null)

  const help = useHelp()
  // In-app feedback (feedback/): the button, Help > Send Feedback… and
  // Cmd/Ctrl+Shift+F share one capture path; the state is read the moment
  // a report is asked for.
  const feedback = useFeedback(
    () => ({
      view: viewRef.current,
      tab: viewStore.get().tab,
      workflow: taskRef.current ?? null,
      mode: session.mode === 'batch' || jobs.length > 0 ? 'batch' : 'single',
      dialog: closeAsk ? 'close-question' : run.overwriteAsk ? 'overwrite-question' : aboutOpen ? 'about' : searchOpen ? 'parameter_search' : null,
      helpOpen: help.open,
      values,
      input,
      out,
      running: running || batchRunning,
      phase: run.phase,
      shownOut: run.shown?.out ?? run.lastRun?.out ?? null,
      themeSetting: theme
    }),
    bin
  )
  const feedbackOpen = !!feedback.session || feedback.reportsOnly
  // F1, ?, Esc, the Cmd/Ctrl shortcuts and the native menus (shell/useKeys.ts).
  useKeys(help.open, (a) => actRef.current(a), () => escRef.current(), () => topicRef.current())

  useEffect(() => {
    window.fastag.probe().then(setBin)
  }, [])
  // P4: the Spectrum tab needs a CLI with -dump_spectrum.
  const spectrumSupport = useSpectrumSupport(bin)

  // The backend asks before a close or quit kills an active run.
  useEffect(() => window.fastag.onCloseRequested((what) => setCloseAsk(what)), [])

  // Navigation (GUI-DESIGN 2): a run moves to Results (useRun's onStart);
  // the first file of a queue moves to Batch.
  const hadJobs = useRef(0)
  useEffect(() => {
    if (jobs.length > 0 && hadJobs.current === 0) {
      session.setMode('batch')
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
    if (view !== 'setup') setSearchOpen(false)
    const a = document.activeElement
    if (a && a !== document.body && !a.closest('[hidden]')) return
    viewsRef.current?.querySelector<HTMLElement>(`.view[data-view="${view}"]`)?.focus()
  }, [view])

  // The running state, and the pill's Cancel, go away when the run ends or
  // is cancelled; focus that was on Cancel or Show log would fall to the
  // page body. After a finished run it moves to the selected results tab
  // (the Overview of a characterizing run), after a cancel or a failure to
  // the Results view; on another view to that view.
  const lastRunRef = useRef(run.lastRun)
  lastRunRef.current = run.lastRun
  function runStateGone(): void {
    focusLater(() => {
      const a = document.activeElement
      if (a && a !== document.body) return null
      const results = viewsRef.current?.querySelector<HTMLElement>('.view[data-view="results"]')
      if (!results || results.hidden) return viewsRef.current?.querySelector<HTMLElement>('.view:not([hidden])') ?? null
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
  // On a launch with no task confirmed yet, a file (picked, dropped, the
  // example) confirms the selected tile and opens Inputs.
  function setInputPath(p: string): void {
    if (!session.taskConfirmed) {
      session.chooseTask(session.tile)
      session.setTaskConfirmed(true)
      session.setStep(2)
    }
    session.setInput(p)
    session.setOut(defaultOut(p))
    session.setValues((v) => ({ ...v, ...rebaseOutputs(v, defaultOut(p)) }))
  }

  // File > Open Example Data: the shipped example run as the input.
  async function openExample(): Promise<void> {
    if (running || batchRunning) return
    setExampleNote(null)
    try {
      setInputPath(await window.fastag.exampleInput())
    } catch (e) {
      setExampleNote(`No example data: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function pickInput(): Promise<void> {
    if (running || batchRunning) return
    const p = await window.fastag.pickInput()
    // The picker offers .zip for a timsTOF .d.zip; another archive is no input.
    if (p && notSpectraZip(p)) {
      setFolderNote({ text: `${p} is not a timsTOF .d.zip archive: FASTag reads only those of the .zip files.`, from: 'setup' })
      return
    }
    setFolderNote(null)
    if (p) setInputPath(p)
  }

  // Add folder… (the Batch view, Batch QC's input card): the spectra files
  // directly inside a folder join the queue, as a dropped folder's do.
  async function addFolder(from: 'setup' | 'batch'): Promise<void> {
    setFolderNote(null)
    try {
      const r = await run.addBatchFolder()
      if (r && r.files === 0) setFolderNote({ text: `No spectra files (mzML, mzPeak, MGF, .raw, timsTOF .d) directly in ${r.dir}.`, from })
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
  const { dragOver, dropNote, dismissNote } = useDrops({ busy, jobs: jobs.length, setInputPath, session, run, setView, loadSdrf: sdrf.load })

  // Esc outside a field: dismisses a shown notice (the drop note, then the
  // toast) first, so dismissing one never kills a run; else cancels a run
  // when no question or dialog is open. The Feedback panel is not modal:
  // Esc inside it is its own (FeedbackDialog), outside it is the app's.
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
  // The Spectrum tab dumps peaks under the options of the run shown.
  const spectrumRun = useMemo(() => (shown ? { input: shown.input, params: shown.params } : null), [shown])
  // As Setup shows it: the preset chosen while its values hold, else the
  // first whose values the run was sent (shownInstrument), so the default
  // Orbitrap/TOF HCD 20 ppm counts though nobody picked it.
  const preset = shown ? shownInstrument(shown.params, session.instrument) : null
  const presetLabel = preset ? presetText(preset) : null
  const overview = useMemo(
    () =>
      shown
        ? {
            model: buildOverview({
              log: shown.log,
              reports: shown.reports,
              species: shown.species,
              census: shown.census ?? null,
              params: shown.params,
              input: shown.input,
              instrument: presetLabel,
              ...(shown.texts ?? {})
            }),
            input: shown.input,
            params: shown.params,
            workflow: shown.workflow ? (taskById(shown.workflow)?.label ?? null) : null,
            workflowId: shown.workflow ? (taskById(shown.workflow)?.id ?? null) : null,
            missing: run.reports.missing ?? [],
            // Its actions apply a change to the form and run it: only when
            // the form would repeat the run on screen (not an older History
            // run of the same input, not after another workflow was chosen).
            locked: shown.input !== input || jobs.length > 0 || !run.shownRerunnable
          }
        : null,
    [shown, presetLabel, input, jobs.length, run.reports.missing, run.shownRerunnable]
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

  // Not behind a batch queue, nor in Batch mode with an empty queue: the
  // single-file controls are hidden there, so neither Run nor a shortcut
  // may start that hidden single-file setup.
  const batchMode = session.mode === 'batch' || jobs.length > 0
  // The step-2 input files of the form that are not on disk (pathStatus):
  // they block Run as a missing input does.
  const notFound = usePathStatus(stepTwoPaths(session.task ? (taskById(session.task) ?? null) : null, values))
  const canRun = !!bin?.ok && !!input && !!out && !running && !batchRunning && !batchMode && !blocked && !inspector.held && notFound.length === 0
  // A file not found is refused in the run bar too, with its field's step.
  const refused = useMemo(
    () => [...session.refused, ...notFound.map((p) => ({ params: ['in_file'], note: `Not found: ${p}. Choose it again in Inputs.` }))],
    [session.refused, notFound]
  )

  // The checks after a run, from its reports and FASTag's log lines.
  // The ion series of the run shown (its sent options: none is by), else the form's.
  const afterIons = run.shown ? (run.shown.params['ion_series'] ?? 'by') : values['ion_series']
  const afterHybrid = run.shown ? (run.shown.params['ion_series_hybrid'] ?? 'by') : values['ion_series_hybrid']
  const after = postRunChecks({
    reports: run.reports.list,
    notes: run.shownNotes,
    species: values['species'] === true,
    ionSeries: afterIons,
    ionSeriesHybrid: afterHybrid,
    input: run.results?.input ?? '',
    ms2: run.evidence.ms2
  })
  const afterInput = run.results?.input ?? ''
  // A finished run names its red flags after the run too (the panel over
  // the result tabs shows them).
  const afterFlags = after.checks.filter((c) => c.level === 'flag').length
  const announce =
    !running && afterFlags > 0 && run.announce.startsWith('Finished ')
      ? `${run.announce} ${afterFlags} ${afterFlags === 1 ? 'red flag' : 'red flags'} after the run: see Checks after the run.`
      : run.announce
  const canRerun = !busy && jobs.length === 0 && !!bin?.ok && !!afterInput && afterInput === input && run.lastRun?.input === input && run.shownRerunnable
  useEffect(() => {
    if (!rerunWith) return
    if (rerunWith.instrument) {
      const p = INSTRUMENTS.find((x) => x.id === rerunWith.instrument)
      if (!p || !matchesInstrument(values, p)) return
    }
    if (rerunWith.params && !Object.entries(rerunWith.params).every(([k, v]) => values[k] === v)) return
    setRerunWith(null)
    // Another check holds the run (species with a Da tolerance): Setup
    // shows it, with its Run anyway.
    if (canRun) void run.run()
    else {
      // Setup at the step that holds the run: the input checks, else Settings.
      session.setStep(inspector.held ? 2 : 3)
      setView('setup')
    }
  }, [rerunWith, values, canRun])
  // Cmd+Enter on step 1: the selected tile confirmed, then run once the
  // form holds it, or Inputs when something is missing.
  const [runOnConfirm, setRunOnConfirm] = useState(false)
  useEffect(() => {
    if (!runOnConfirm || session.task !== session.tile) return
    setRunOnConfirm(false)
    if (canRun) void run.run()
    else session.setStep(2)
  }, [runOnConfirm, session.task, session.tile, canRun])
  const detectedPreset = inspector.pre.detected?.preset ?? null
  const chosenInstrument = INSTRUMENTS.find((x) => x.id === detectedPreset && matchesInstrument(values, x))?.id ?? ''

  // A parameter chosen in the search: open its section, focus its field (or,
  // while the field is inert, the switch it waits for).
  function chooseParam(hit: ParamHit): void {
    setSearchOpen(false)
    // A hit on a fresh launch confirms the selected tile: the user is
    // about to set something for it.
    if (!session.taskConfirmed) {
      session.chooseTask(session.tile)
      session.setTaskConfirmed(true)
    }
    // An optional input of step 2 not opened yet: opened first.
    const primary = INPUTS[hit.name]?.partOf ?? hit.name
    const owner = session.task ? (taskById(session.task) ?? null) : null
    if (taskInputs(owner, values, batchMode ? 'batch' : 'one', session.revealed).addable.includes(primary)) session.revealInput(primary)
    // A field under Advanced: the disclosure, its group and, for another
    // workflow's group, Other analyses open (doc/GUI-WORKFLOWS.md 2.4).
    if (hit.section) {
      session.setAdvancedOpen(true)
      session.setOpenGroups((g) => ({ ...g, [hit.section]: true, 'Other analyses': true }))
    }
    // The tolerance shows under the Instrument's Custom.
    if (SECTION_OF.get(hit.name)?.home === 'common' && !document.getElementById(`p-${hit.name}`)) session.chooseInstrument('custom')
    setTimeout(() => {
      // The field, or the product checkbox of an output (out-<name>, or the
      // switch it drives), or, while its group waits for a report, the
      // group's Turn on.
      const byName = (n: string): HTMLElement | null =>
        document.getElementById(`p-${n}`) ?? document.getElementById(`out-${n}`) ?? document.querySelector(`.products input[data-param="${n}"]`)
      // Folded behind its group's "Needs …" line: the switch it waits for,
      // else that line's Turn on.
      const waits = inertDependency(hit.name, values)
      // No field of its own: the control that owns it (round 4, 24).
      const owner = ownerOf(hit.name)
      if (owner?.revealCount) {
        const sel = document.getElementById(owner.id)
        if (sel && !(sel as HTMLSelectElement).disabled) {
          sel.dispatchEvent(new Event('fastag:reveal-count'))
          setTimeout(() => {
            const c = document.getElementById(`p-${hit.name}`) ?? sel
            c.scrollIntoView?.({ block: 'center' })
            c.focus()
          })
          return
        }
      }
      let el = ((owner && document.getElementById(owner.id)) ??
        byName(hit.name) ??
        (waits ? byName(Array.isArray(waits.on) ? waits.on[0] : waits.on) : null) ??
        (hit.section ? document.querySelector(`[data-group="${hit.section}"] .group-needs button`) : null)) as HTMLInputElement | null
      // Hidden until its section's switch is on: the switch.
      const master = SECTION_OF.get(hit.name)?.master
      if (el?.closest('[hidden]') && master) el = document.getElementById(`p-${master}`) as HTMLInputElement | null
      if (el && el.disabled) {
        const dep = inertDependency(hit.name, values)
        const on = dep ? (Array.isArray(dep.on) ? dep.on[0] : dep.on) : null
        const master = on ? (document.getElementById(`p-${on}`) as HTMLInputElement | null) : null
        if (master && !master.disabled) el = master
      }
      // The step whose body holds the control (all four are mounted).
      const at = Number(el?.closest<HTMLElement>('[data-step]')?.dataset.step ?? 0)
      if (at >= 1 && at <= 4) session.setStep(at as Step)
      setTimeout(() => {
        el?.scrollIntoView?.({ block: 'center' })
        el?.focus()
      })
    })
  }

  // The Help page of the screen shown: Help in the app bar, Cmd/Ctrl+?, the
  // menu, F1 and ? all open it. Results: the tab ResultTabs shows, not a
  // stored one that is gone.
  function helpTopic(): string {
    if (view === 'results') return TAB_HELP[shownTabRef.current ?? tab] ?? 'results'
    if (view === 'batch') return 'workflow-batch'
    if (view === 'history') return 'workflow-history'
    if (busy) return 'start'
    const t = session.task ? taskById(session.task) : undefined
    return session.step === 2 ? 'files-inputs' : session.step === 3 ? (t?.docs.to ?? 'start-presets') : session.step === 4 ? 'files-outputs' : 'start'
  }
  // Search settings in the app bar: from every view, it switches to Setup
  // (Help gives way to it).
  function searchSettings(): void {
    if (busy) return
    // Focus goes to the palette's input, and back to the Search button on
    // Escape, not to Help's opener.
    if (help.open) closeHelp({ restoreFocus: false })
    setView('setup')
    setSearchOpen(true)
  }

  // Shortcuts and native menus run the same actions (setup/shortcuts.ts).
  const act = (a: Action): void => {
    const v = viewOfAction(a)
    // A question or About is open: shortcuts and native menu items reach
    // here past its inert background; only a view change goes through (Run
    // would ask the overwrite question again over the pending one). The
    // Feedback panel is not modal: the app behind it keeps its shortcuts.
    if (!v && (closeAsk || run.overwriteAsk || aboutOpen)) return
    // The parameter search closes for any other action.
    if (searchOpen && a !== 'search-params') setSearchOpen(false)
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
      case 'open-example':
        if (!busy && jobs.length === 0) {
          setView('setup')
          void openExample()
        }
        break
      case 'run':
        if (viewRef.current === 'setup' && session.step === 1 && jobs.length === 0) {
          session.chooseTask(session.tile)
          session.setTaskConfirmed(true)
          setRunOnConfirm(true)
        } else if (jobs.length > 0) {
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
        if (!help.open) openHelp(helpTopic())
        break
      case 'search-params':
        // One path with the app bar's Search button.
        searchSettings()
        break
      case 'faq':
        openHelp('troubleshooting')
        break
      case 'about':
        setAboutOpen(true)
        break
      case 'feedback':
        feedback.trigger()
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
  const topicRef = useRef(helpTopic)
  topicRef.current = helpTopic

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
  // The job in flight's own input (useRun), never the form's: a History
  // Re-run of A while Setup holds B names A.
  const activeInput = run.activeInput ?? (runningJob >= 0 ? jobs[runningJob].input : null)
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
  const runBarWith = (nav?: ActionNav): JSX.Element => (
    <RunBar
      nav={nav}
      announce={run.announce}
      announceElsewhere
      running={running}
      busy={busy}
      batchRunning={batchRunning}
      progress={run.progress}
      phase={run.phase}
      startedAt={run.startedAt}
      invalid={session.invalid}
      refused={refused}
      goTo={goTo}
      fixes={session.fixes}
      onFix={session.applyFix}
      input={input}
      out={out}
      batchMode={batchMode}
      jobs={jobs.length}
      remaining={run.remaining}
      failedJobs={run.failedJobs}
      binOk={!!bin?.ok}
      canRun={canRun}
      inspectorHeld={inspector.held}
      inspectorChecking={inspector.checking}
      inspectorBlocks={inspector.blocks.length}
      step={session.step}
      onReviewChecks={() => {
        setView('setup')
        session.setStep(2)
        focusHeldCheck()
      }}
      onRun={run.run}
      onRunBatch={(only) => run.runBatch(only)}
      plan={<PlanFooter session={session} run={run} />}
    />
  )
  // The one Go to Inputs / Go to Settings of a refusal, for both bars.
  function goTo(c: Conflict): { label: string; go(): void } | null {
    const st = stepOfParam(c.params[0], session.task ? (taskById(session.task) ?? null) : null, values)
    return st
      ? {
          label: st === 2 ? 'Go to Inputs' : 'Go to Settings',
          go: () => {
            // In Batch the run bar is there: Setup is shown first, then
            // the step's heading takes focus (SetupForm).
            setView('setup')
            session.goStep(st)
          }
        }
      : null
  }
  const runBar = runBarWith()
  // Setup while the Batch view holds the queue: the bar still runs it, in
  // the slot Run has elsewhere; filled on Outputs, the wizard's last step
  // (doc/GUI-SETUP-WIZARD.md 2.3). After a failed batch with nothing left,
  // Retry failed takes the slot.
  const queueDisabled = batchRunning || running || !bin?.ok || !!blocked || notFound.length > 0
  // Why the queue's Run is disabled, said beside it (as in the run bar).
  const queueBlocked = !busy && (Object.keys(session.invalid).length > 0 || refused.length > 0)
  const queuePreflight = queueBlocked ? (
    <Preflight id="queue-preflight" invalid={session.invalid} refused={refused} fixes={session.fixes} onFix={session.applyFix} goTo={goTo} />
  ) : null
  const queueRun = (nav: ActionNav): JSX.Element | null => {
    const cls = nav.next ? 'secondary' : 'primary'
    if (run.remaining > 0)
      return (
        <button
          type="button"
          className={cls}
          disabled={queueDisabled}
          aria-describedby={queueBlocked ? 'queue-preflight' : undefined}
          onClick={() => {
            void run.runBatch()
            setView('batch')
          }}
        >
          Run {run.remaining} {run.remaining === 1 ? 'file' : 'files'}
        </button>
      )
    if (run.failedJobs > 0)
      return (
        <button
          type="button"
          className={cls}
          disabled={queueDisabled}
          aria-describedby={queueBlocked ? 'queue-preflight' : undefined}
          onClick={() => {
            void run.runBatch('failed')
            setView('batch')
          }}
        >
          Retry failed
        </button>
      )
    return null
  }

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
      {aboutOpen && (
        <AboutDialog
          bin={bin}
          onClose={() => setAboutOpen(false)}
          onFeedbackReports={() => {
            setAboutOpen(false)
            feedback.openReports()
          }}
        />
      )}
      {feedbackOpen && (
        <FeedbackDialog
          session={feedback.session}
          text={feedback.text}
          setText={feedback.setText}
          onSaved={feedback.saved}
          onClose={feedback.close}
          onRetake={feedback.retake}
          retaking={feedback.retaking}
          raised={feedback.raised}
          layouts={feedback.layouts}
          setLayout={feedback.setLayout}
        />
      )}
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
          // The run bar, or the Results pane's running state, shows the
          // progress; Cancel is the pill's on every view.
          runBarShown: view === runBarView || (view === 'results' && running && jobs.length === 0),
          onShow: () => setView(jobs.length > 0 ? 'batch' : 'results'),
          onCancel: run.cancelRun,
          onFocusLost: runStateGone
        }}
        theme={theme}
        onTheme={setTheme}
        helpOpen={help.open}
        onHelp={() => (help.open ? closeHelp() : openHelp(helpTopic()))}
        onFeedback={() => actRef.current('feedback')}
        feedbackBusy={feedback.capturing}
        onSearch={searchSettings}
        searchDisabled={busy}
        searchRef={searchBtnRef}
      />
      {/* The run's live region: always in the page, whichever view is shown. */}
      <p className="sr-only" role="status" id="run-status">
        {announce}
      </p>
      <p className="sr-only feedback-status" role="status">
        {feedback.capturing ? 'Taking a screenshot for the feedback report…' : ''}
      </p>

      <div className="shell">
        <div className="views" ref={viewsRef}>
          {/* Hidden, not unmounted: the form, the batch and the results stay as they were. */}
          <section className="view view-setup" data-view="setup" hidden={view !== 'setup'} tabIndex={-1} aria-label="Setup">
            <aside className="controls" aria-label="Run setup">
              {searchOpen && view === 'setup' && !busy && (
                <ParamSearch
                  onChoose={chooseParam}
                  onClose={() => {
                    setSearchOpen(false)
                    focusLater(() => searchBtnRef.current)
                  }}
                />
              )}
              <SetupForm
                session={run.inFlight ? { ...session, ...run.inFlight } : session}
                run={run}
                onPickInput={pickInput}
                actionBar={(nav?: ActionNav) =>
                  runBarView === 'setup' ? runBarWith(nav) : nav ? (
                    <NavBar nav={nav} run={queueRun(nav)} preflight={queuePreflight} plan={busy ? null : <PlanFooter session={session} run={run} />} />
                  ) : null
                }
                onOpenBatch={() => setView('batch')}
                onAddFolder={() => void addFolder('setup')}
                folderNote={folderNoteAt('setup')}
                addBatchRef={addBatchRef}
                onOpenResults={openResults}
                sdrf={sdrf}
                detectedInstrument={detectedPreset}
                notFound={notFound}
                notCheckedNote={inspector.pre.notChecked === NOT_CHECKED_NO_PROBE ? inspector.pre.notChecked : null}
                legacyAuto={inspector.legacyAuto}
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
                    onParams={(v) => Object.entries(v).forEach(([n, x]) => session.setValue(n, x))}
                    onRecheck={inspector.recheck}
                  />
                }
              />
            </aside>
          </section>

          <section className="view view-results" data-view="results" hidden={view !== 'results'} tabIndex={-1} aria-label="Results">
            <ExportJobsContext.Provider value={exportJobs}>
              <ResultTabs
                tab={tab}
                setTab={viewStore.setTab}
                shownTab={shownTabRef}
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
                spectrumSupport={spectrumSupport}
                spectrumRun={spectrumRun}
                workflow={shown?.workflow ?? null}
                activeInput={activeInput}
                rerunResConf={
                  // Only for the output of the run the form would repeat
                  // (shownRerunnable: the run on screen, sent what the form sends).
                  // Not after a run that was already sent res_conf: it would write the same file.
                  run.results?.input && run.results.input === input && run.shownRerunnable && jobs.length === 0 && bin?.ok && shown?.params['res_conf'] !== true
                    ? {
                        run: () => void overviewAction({ kind: 'enable', label: 'Re-run to add Residue conf. (%)', values: { res_conf: true } }),
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
                afterRun={!running && jobs.length === 0 && (
                <AfterRunPanel
                  checks={after.checks}
                  detected={after.detected}
                  input={afterInput}
                  onRerun={
                    canRerun
                      ? (fix) => {
                          if (fix.params) session.setValues((v) => ({ ...v, ...fix.params }))
                          if (fix.instrument) session.chooseInstrument(fix.instrument)
                          setRerunWith(fix)
                        }
                      : null
                  }
                />
              )}
                runningState={
                  running && jobs.length === 0 ? (
                    <RunningPanel
                      input={run.activeInput ?? input}
                      phase={run.phase}
                      progress={run.progress}
                      startedAt={run.startedAt}
                      cancelling={run.cancelling}
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
            <div className="page">
              <div className="page-scroll">
                <div className="page-col">
                  <PageHeader
                    title="Batch"
                    context={
                      jobs.length > 0
                        ? `${jobs.length} ${jobs.length === 1 ? 'file' : 'files'}, each run in turn with the same settings`
                        : 'Several spectra files, run in turn with the same settings.'
                    }
                  />
                  {jobs.length > 0 ? (
                    <div className="batchview page-body">
                      {/* The queue first, so it stays above the fold; the
                          failure banner (an alert, announced wherever it is)
                          under it. */}
                      <div className="batch-main">
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
                      </div>
                      <div className="batch-side">
                        <SummaryTable
                          summary={run.summary}
                          busy={busy}
                          outDir={run.outDir}
                          sdrf={sdrf.comparison}
                          protect={writeProtect}
                          onShow={(input) => {
                            const j = jobs.find((x) => x.input === input)
                            if (j) showBatchJob(j)
                          }}
                        />
                        <SdrfPanel
                          sdrf={sdrf}
                          protect={writeProtect}
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
                    <div className="page-body">
                    <EmptyState
                      className="batch-empty"
                      title="No batch yet"
                      actions={
                        <>
                          <button type="button" className="secondary" ref={emptyBatchRef} onClick={run.addBatchFiles} disabled={busy}>
                            Add files for a batch…
                          </button>
                          <button type="button" className="secondary" onClick={() => void addFolder('batch')} disabled={busy}>
                            Add folder…
                          </button>
                        </>
                      }
                    >
                      Queue several spectra files to run them in turn with the same parameters.
                    </EmptyState>
                    </div>
                  )}
                  {jobs.length === 0 && folderNoteAt('batch')}
                  {/* An SDRF dropped before any file: kept for the batch. */}
                  {jobs.length === 0 && sdrf.file && (
                    <p className="hint" role="status">
                      SDRF {sdrf.file.path} loaded ({sdrf.file.rows} rows): add the batch's files to compare them with it.
                    </p>
                  )}
                  {jobs.length === 0 && sdrf.error && (
                    <p className="hint note-flag" role="alert">
                      {sdrf.error}
                    </p>
                  )}
                </div>
              </div>
              {jobs.length > 0 && runBar}
            </div>
          </section>

          <section className="view view-history" data-view="history" hidden={view !== 'history'} tabIndex={-1} aria-label="History">
            <HistoryView
              active={view === 'history'}
              version={historyVersion}
              busy={busy}
              onOpenResults={openResults}
              onOpen={(r, out) => void run.showRecord(r, out).then(() => setView('results'))}
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
        dropNote={dropNote ?? exampleNote}
        toast={toast}
        onDismissNote={() => {
          dismissNote()
          setExampleNote(null)
        }}
        onDismissToast={() => setToast(null)}
        onOpen={(to) => {
          setView(to)
          setToast(null)
        }}
      />
    </div>
  )
}
