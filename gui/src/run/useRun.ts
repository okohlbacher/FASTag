// The run (GUI-DESIGN 5 runStore): one run or a batch of them, their log
// and progress, and what they leave for the result tabs. The state is one
// useReducer (runReducer.ts, P2a PR r), which replaced the useState setters
// P1 PR c moved here from App.tsx; each job's events come on its own Channel
// (runJob.ts), and its log lines go to its log store (logStore.ts), not to
// React state, so a Log batch re-renders only the drawer.

import { LAST_WORKFLOW, runValues, taskById } from '../setup/tasks'
import { useCallback, useEffect, useMemo, useReducer, useRef, type Dispatch, type SetStateAction } from 'react'
import type { LogLine, ResolvedOutputs, RunRecord, RunResult, SpeciesReport } from '../types'
import { recordOutputs } from '../shell/HistoryView'
import { newJobId, runJob, type Job as RunJob, type JobAction } from '../runJob'
import { conflicts, inertBecause, isChanged, PARAM_BY_NAME, RENDERED, sentValues } from '../paramLayout'
import { cliText } from '../app/format'
import type { ParamValue } from '../ParamField'
import { baseName, value, type Report } from '../digestReport'
import { perJobOutputs, REPORT_PARAMS } from '../app/paths'
import { cleanupLines, failText } from '../app/format'
import type { Tab, ViewStore } from '../app/viewStore'
import { loadReports, sameRun, sameRunFiles, sameRunIn, sniffPath, type RunOf, type SameRun } from '../results/reports'
import { TAB_OF, sniffLongForm, sniffSpecies, sniffTags, sniffWorkflow, workflowFiles, workflowPaths, workflowReportsOf, type WorkflowKind, type WorkflowReports } from '../results/workflowReports'
import { sniffTable } from '../results/tables'
import { productLabel } from '../setup/products'
import { tablePaths, type TableGen, type TableKind, type TablePaths } from '../results/tables'
import { sharedOutputs, type BatchJob } from './batch'
import { buildSummary } from './batchSummary'
import { useBatchData } from './useBatchSummary'
import { createLogStore, type LogStore } from './logStore'
import { NOTE_LINE, refusalOf } from '../inspector/checks'
import {
  activeJob,
  createRunState,
  queueView,
  runReducer,
  type BatchEnd,
  type Failure,
  type OverwriteAsk,
  type Reports,
  type Results
} from './runReducer'

export { appendLog } from './logStore'
export type { BatchEnd, Evidence, Failure, LastRun, Reports, Results, Shown } from './runReducer'

// TOPPBase prints this epilogue on stdout at every exit, after a refusal on
// stderr too (the two pipes are read on separate threads), so it is never the
// reason a run failed.
const EPILOGUE = /^\S+ took .*Peak Memory Usage/
// OpenMS follows a ConversionError with the whole --help; this header starts
// that dump, and nothing in it explains the failure.
const HELP_START = /^FASTag -- /
// FASTag 1.12 (E7) follows a refusal (raw DIA, exit 11) with this line for
// scripts; the sentence before it is the reason a person reads.
const REFUSED = /^FASTAG_REFUSED\b/
// "Error:", "ConversionError", "exception", "fatal".
const ERROR_WORD = /(error|exception)\b|\bfatal\b/i
// A line kept per stream: stderr (err) and stdout (out).
type StreamLines = { err: string | null; out: string | null }
const noLines = (): StreamLines => ({ err: null, out: null })

// What a run is started with, from the session.
export interface RunInputs {
  values: Record<string, ParamValue>
  input: string
  out: string
  blocked: boolean
  speciesOn: boolean
  // The parameters a run sends that differ from the defaults.
  changedParams: string[]
  // The values the session started from (the workflow's): a field left at
  // the CLI default there and here is not named (paramLayout sentValues).
  originValues?: Record<string, ParamValue>
}

// The outputs of a run whose reply never came (or was refused): none.
const noOutputs: ResolvedOutputs = { out: null }

// The tables shown that belong to the run of @p path (sameRunFiles), and
// the paths of the others; @p replaced is the kind about to be replaced.
function splitTables(tables: TablePaths | undefined, path: string, replaced?: TableKind, same: SameRun = sameRunFiles): { kept: TablePaths; closed: string[] } {
  const kept: TablePaths = {}
  const closed: string[] = []
  for (const [k, q] of Object.entries(tables ?? {}) as [TableKind, string | undefined][]) {
    if (!q || k === replaced) continue
    if (same(q, path)) kept[k] = q
    else closed.push(q)
  }
  return { kept, closed }
}

function bumpGen<K extends string>(gen: Partial<Record<K, number>> | undefined, kinds: K[]): Partial<Record<K, number>> {
  const g: Partial<Record<K, number>> = { ...gen }
  for (const k of kinds) g[k] = (g[k] ?? 0) + 1
  return g
}

// What stays shown when a file of the run of @p path opens: the reports,
// tables and workflow reports of that run (@p same: by the app's record,
// else sameRunFiles); those of another run close.
function closeOtherRuns(cur: Reports, path: string, same: SameRun = sameRunFiles): Reports {
  const { kept } = splitTables(cur.tables, path, undefined, same)
  const workflow: WorkflowReports = {}
  for (const [k, q] of workflowPaths(cur.workflow ?? {})) if (same(q, path)) workflow[k] = q
  if (cur.workflow?.files && workflow.shortlist) workflow.files = cur.workflow.files
  const partial = cur.partial?.filter((x) => same(x.path, path))
  return { ...cur, list: cur.list.filter((r) => same(r.path, path)), tables: kept, workflow, missing: undefined, partial: partial?.length ? partial : undefined }
}

// The reports with @p path marked partial when its run (@p rec, the record
// of the run that last wrote it) did not finish, unmarked when it did.
function withPartial(cur: Reports, path: string, rec: RunRecord | null): Reports {
  const rest = (cur.partial ?? []).filter((x) => x.path !== path)
  const bad = rec && rec.status !== 'ok' ? [{ path, status: rec.status, end: rec.end }] : []
  const partial = [...rest, ...bad]
  return { ...cur, partial: partial.length ? partial : undefined }
}

// The note when a file of another run closed what was shown.
function closedNote(path: string, closed: string[]): string {
  return `${baseName(path)} is from another run; ${closed.join(', ')} ${closed.length === 1 ? 'was' : 'were'} closed.`
}

// The shell's part in a run (P2a PR s): onStart is called when a single run
// is about to start (after the overwrite question), so the app can show
// Results, where its state and a refused start's reason are.
//
// landing: the tab a run's results land on (doc/GUI-WORKFLOWS.md 3): the
// workflow's own view (QC, Mass shifts, Shortlist, Triage, the Overview of
// Characterize); null keeps the Species/Digest/Tags rule.
export interface RunHooks {
  onStart?(): void
  // The landing tab of the workflow @p workflow (the run's own, from its
  // call: a Re-run lands where its recorded workflow does).
  landing?(workflow: string | null, params?: Record<string, unknown>): Tab | null
  // The workflow a run is started from (its tab order and Overview).
  workflow?(): string | null
}

// The workflow a run was sent with: a Re-run's is its record's, not the
// form's. A record without one (before 1.15.4) has none.
const workflowOf = (call: Record<string, unknown>): string | null => (typeof call['workflow'] === 'string' ? call['workflow'] : null)

// What the log of a run says of its evidence: the MS2 count and the spectra
// that gave taxon evidence (the CLI's summary lines).
/// The CLI's warning (IonSeries.h speciesExcludedWarning) that c/z tag rows
/// were left out of -species: their count.
export const CZ_EXCLUDED = /Ion series: (\d+) tag rows read as c\/z-dot ions were left out of -species/
export function evidenceOfLog(lines: readonly string[]): { contributed: number | null; ms2: number | null; czExcluded: number | null } {
  let contributed: number | null = null
  let ms2: number | null = null
  let czExcluded: number | null = null
  for (const line of lines) {
    const cz = CZ_EXCLUDED.exec(line)
    if (cz) czExcluded = Number(cz[1])
    const sp = /^Species:\s+(\d+) spectra contributed/.exec(line)
    if (sp) contributed = Number(sp[1])
    const m = /^(\d+) MS2 spectra,/.exec(line)
    if (m) ms2 = Number(m[1])
  }
  return { contributed, ms2, czExcluded }
}

// The option behind each table and workflow report, for its name in words.
const TABLE_PARAM: Record<TableKind, string> = { recon: 'recon_out', delta: 'delta_out', glyco: 'glyco_out', reconIds: 'recon_id_out' }
const WORKFLOW_PARAM: Record<WorkflowKind, string> = {
  qc: 'qc_out',
  shortlist: 'shortlist_out',
  triage: 'census_sorted_out',
  censusSummary: 'census_summary_out',
  deltaSpectra: 'delta_spectra_out',
  deltaCounts: 'delta_counts_out'
}

// A selection: its showGen number and the file it opened.
interface Selection {
  g: number
  p: string
}

export function useRun(s: RunInputs, view: ViewStore, hooks: RunHooks = {}) {
  const { values, input, out, blocked, speciesOn, changedParams, originValues } = s
  const setTab = view.setTab
  const [state, dispatch] = useReducer(runReducer, undefined, createRunState)
  const active = activeJob(state)
  const running = active?.status === 'running'
  const { batchRunning } = state
  const cancelling = active?.cancelRequested ?? false
  // The live log, readable at once by the async run flow: a dispatch lands
  // only at the next render.
  const live = useRef<LogStore>(state.liveLog)
  const pushLog = (...lines: string[]): void => live.current.append(lines)
  // A Run click is checking for existing outputs: a second click waits.
  const checking = useRef(false)
  // The command line the run in flight was given.
  const command = useRef<string[] | undefined>(undefined)
  // The last error line and the last line of each stream, stderr and
  // stdout apart: the two pipes are read by two threads (fastag.rs), so a
  // stdout line the CLI wrote BEFORE its stderr refusal can still arrive
  // after it. Only the order within one stream is the CLI's; FASTag writes
  // its errors and refusals to stderr (OPENMS_LOG_ERROR), its info to stdout.
  const lastError = useRef<StreamLines>(noLines())
  // The tag count of the CLI's summary line, for the announcement.
  const lastTags = useRef<number | null>(null)
  // The last log line: FASTag's own refusals name no error, exception or fatal.
  const lastLine = useRef<StreamLines>(noLines())
  // Inside the --help dump OpenMS prints after a ConversionError.
  const inHelp = useRef(false)
  // The run's lines the inspector reads (checks.ts NOTE_LINE): the
  // acquisition check, a refusal, the tolerance and activation warnings.
  const notes = useRef<string[]>([])
  // The job in flight (runJob.ts): its events come on its own Channel, so
  // none can reach another job, and a Done before the reply is a state of
  // the job, not a race.
  const currentJob = useRef<ReturnType<typeof runJob> | null>(null)
  // Cancel pressed during a batch: stop the QUEUE, not just the current job.
  const batchCancel = useRef(false)
  // Cancel pressed during the current run: its failure is the user's doing.
  const cancelled = useRef(false)
  // The results last asked for (a run, a batch job selected, a file
  // opened): a slow read for an earlier one must not land beside them
  // (job A's reports next to job B's tags). Bumped by each; showResults
  // dispatches nothing once it has moved on.
  const showGen = useRef(0)
  // The file the latest selection opened (showGen's): an earlier open of
  // the same run (a mixed drop: its tags beside its reports) still lands,
  // one of another run does not.
  const selected = useRef('')
  // A selection token, taken at each entry point before its first await.
  function select(p: string): Selection {
    selected.current = p
    return { g: ++showGen.current, p }
  }
  // The run each opened or shown file belongs to, by the app's record
  // (historyOf): two runs of one input in one folder, or one run's outputs
  // under custom names, are told by it; a file without one by its name.
  const runs = useRef(new Map<string, RunOf>())
  const recordRun = (p: string, rec: RunRecord | null): void => {
    if (rec) runs.current.set(p, { id: rec.id, outputs: rec.outputs })
  }
  const same: SameRun = (a, b) => sameRunIn(runs.current, a, b)
  // A later selection of another run took over: dispatch nothing more.
  const superseded = (t: Selection): boolean => t.g !== showGen.current && !same(selected.current, t.p)
  // No later selection at all: only this one may still switch the tab.
  const latest = (t: Selection): boolean => t.g === showGen.current
  // A killed run's exit status says nothing (Windows reports code 1), so a
  // cancel is read off the backend flag or the Cancel the user pressed. A run
  // that finished ok despite the kill stays ok.
  const isCancelled = (r: RunResult): boolean => !r.ok && (r.cancelled === true || cancelled.current)
  const jobs = useMemo(() => queueView(state), [state.jobs])
  // The batch summary (GUI-DESIGN 3 S6): one row per job, from its reports.
  const batchData = useBatchData(state.jobs)
  // Its columns are those of the workflow its jobs ran with (each job's
  // call records it), not the one Setup shows now: a Run QC batch keeps its
  // QC columns when the form moves on. A batch that ran with several
  // workflows shows the columns of each; one that has not run yet, the
  // form's.
  const ranWith = state.jobs.filter((j) => j.batch && j.params).map((j) => workflowOf(j.params!))
  const ranKey = ranWith.join('\n')
  const formWorkflow = hooks.workflow?.() ?? null
  const batchWorkflow = useMemo<readonly (string | null)[] | string | null>(() => (ranKey ? ranKey.split('\n').map((w) => w || null) : formWorkflow), [ranKey, formWorkflow])
  const summary = useMemo(() => buildSummary(jobs, batchData, batchWorkflow), [jobs, batchData, batchWorkflow])

  // The last run of an earlier session, from the run record: a cancelled or
  // failed one still reads as such after a restart.
  useEffect(() => {
    window.fastag
      .historyList(1)
      .then((h) => {
        const r = h[0]
        if (!r) return
        dispatch({
          type: 'LAST_RUN',
          ifNone: true,
          lastRun: {
            input: r.input,
            ok: r.status === 'ok',
            cancelled: r.status === 'cancelled',
            at: r.end,
            ms: Math.max(0, r.end - r.start),
            cleaned: r.cleanup.removed.length,
            earlier: true,
            out: r.outputs[0]
          }
        })
      })
      .catch(() => {})
  }, [])

  // Between two batch jobs no CLI child exists: tell the backend's close
  // guard that the batch is still busy.
  useEffect(() => {
    window.fastag.setBusy(batchRunning).catch(() => {})
  }, [batchRunning])

  // One line of the run's log: the reasons for the failure banner and the
  // counts of the CLI's summary come from these.
  const onLogLine = (line: string, stderr: boolean): void => {
    // The reason for the banner: neither the exit epilogue nor the help
    // dump that follows a ConversionError can be it.
    if (HELP_START.test(line)) inHelp.current = true
    if (!inHelp.current && notes.current.length < 50 && NOTE_LINE.test(line)) notes.current.push(line)
    if (!inHelp.current && !EPILOGUE.test(line) && !REFUSED.test(line)) {
      const k = stderr ? 'err' : 'out'
      if (ERROR_WORD.test(line)) lastError.current[k] = line
      if (line.trim()) lastLine.current[k] = line.trim()
    }
    // "Species: N spectra contributed taxon evidence; ..."
    const sp = /^Species:\s+(\d+) spectra contributed/.exec(line)
    if (sp) dispatch({ type: 'EVIDENCE', evidence: { contributed: Number(sp[1]) } })
    // "42092 MS2 spectra, 1130228 tags[ -> 5321 after filtering]"
    const ms2 = /^(\d+) MS2 spectra,(?: (\d+) tags)?(?: -> (\d+) after filtering)?/.exec(line)
    if (ms2) dispatch({ type: 'EVIDENCE', evidence: { ms2: Number(ms2[1]) } })
    const cz = CZ_EXCLUDED.exec(line)
    if (cz) dispatch({ type: 'EVIDENCE', evidence: { czExcluded: Number(cz[1]) } })
    const t = ms2?.[3] ?? ms2?.[2]
    if (t) lastTags.current = Number(t)
  }

  async function addBatchFiles(): Promise<void> {
    // The picker offers .zip for a timsTOF .d.zip; another archive is no input.
    addBatchPaths((await window.fastag.pickInputs()).filter((p) => !/\.zip$/i.test(p) || /\.d\.zip$/i.test(p)))
  }

  // Files added to the queue by a pick or a drop (shell/dropRoute.ts).
  function addBatchPaths(files: string[]): void {
    if (!files.length) return
    dispatch({ type: 'BATCH_ADD', files })
  }

  // The spectra files of a folder, picked (the Batch view's Add folder…), to
  // the queue. Resolves with the folder and how many files it held; null
  // when no folder was picked. Rejects when the folder cannot be listed.
  async function addBatchFolder(): Promise<{ dir: string; files: number } | null> {
    const dir = await window.fastag.pickFolder()
    if (!dir) return null
    const files = await window.fastag.folderSpectra(dir)
    addBatchPaths(files)
    return { dir, files: files.length }
  }

  // The batch's output folder (null: beside each input); the jobs not run
  // yet are named in it (runReducer BATCH_OUT_DIR).
  const setOutDir = (dir: string | null): void => dispatch({ type: 'BATCH_OUT_DIR', dir })
  async function chooseOutDir(): Promise<void> {
    const dir = await window.fastag.pickFolder()
    if (dir) setOutDir(dir)
  }

  // Remove these inputs from the queue (a running job stays).
  const removeJobs = (inputs: string[]): void => dispatch({ type: 'BATCH_REMOVE', inputs })

  // What a run sends (paramLayout sentValues): only the parameters the UI
  // renders (`-version` is recorded in the INI yet rejected as an option),
  // none that is inert (the CLI refuses some: -massgap_out without
  // -recon_out), and an option outside the 1.15.3 set (ALWAYS_SENT) only
  // when it differs from the CLI default: the CLI reads some options by
  // whether they were given at all.
  // The values a run of the form's workflow is sent (tasks.ts runValues):
  // Mass-shift survey's shift reports stay off until a database is chosen.
  const toRun = (v: Record<string, ParamValue>): Record<string, ParamValue> => runValues(taskById(hooks.workflow?.() ?? ''), v)
  const runParams = (inFile: string, outFile: string, overrides?: Record<string, ParamValue>): Record<string, unknown> => ({
    in: inFile,
    out: outFile,
    params: sentValues(toRun({ ...values, ...overrides }), originValues)
  })

  // A run call with the workflow it is started from, which the run record
  // keeps (history.rs RunRecord.workflow): its results, and a Re-run's, are
  // shown as that workflow's, whatever the form shows by then.
  // The last-used values with the workflow they ran in (useSession
  // applyLastUsed puts that workflow back with them).
  const lastOf = (v: Record<string, unknown>): Record<string, unknown> => {
    const wf = hooks.workflow?.()
    return wf ? { ...v, [LAST_WORKFLOW]: wf } : v
  }
  const withWorkflow = (call: Record<string, unknown>): Record<string, unknown> => {
    const wf = hooks.workflow?.()
    return wf ? { ...call, workflow: wf } : call
  }
  // The workflow and the species switch of a run, from what it was sent: a
  // Re-run's are its record's, not the form's. A record without a workflow
  // (before 1.15.4) has none.
  const speciesOf = (call: Record<string, unknown>): boolean => ((call['params'] ?? {}) as Record<string, unknown>)['species'] === true

  // The outputs of these runs that already exist. A failed check asks
  // nothing: the backend still refuses to run over an unconfirmed file.
  // Also the outputs that are one of the run's inputs: such a run is not
  // started (the backend refuses it too, and keeps the input).
  // shared: outputs two calls (two jobs of a batch) would both write.
  async function existingOutputs(calls: Record<string, unknown>[]): Promise<{ existing: string[]; clashes: string[]; shared: string[] }> {
    try {
      const all = await Promise.all(calls.map((c) => window.fastag.outputsCheck(c)))
      return {
        existing: [...new Set(all.flatMap((c) => c.existing))],
        clashes: [...new Set(all.flatMap((c) => c.clashes ?? []))],
        shared: sharedOutputs(all.map((c) => c.outputs ?? []))
      }
    } catch {
      return { existing: [], clashes: [], shared: [] }
    }
  }
  // The refusal of a run whose output would overwrite one of its inputs
  // (@p batch: an input of any job of the batch).
  // A batch's refusal stays in the Batch view, where its banner is.
  function refuseClash(clashes: string[], batch = false): void {
    if (!batch) hooks.onStart?.()
    const what = batch ? 'this batch' : 'this run'
    dispatch({
      type: 'FAILURE',
      failure: {
        title: `Not started: an output is also an input of ${what}`,
        reasons: clashes.map((p) => ({ text: `${p} is read by ${what}; writing it would destroy it. Choose another output name${batch ? ' or folder' : ''}.` }))
      }
    })
  }
  // While the overwrite question is open, no other run starts: a second
  // Run (a shortcut, the menu) would ask again over the pending question.
  const asking = useRef(false)
  const askOverwrite = (files: string[]): Promise<boolean> => {
    asking.current = true
    return new Promise<boolean>((answer) =>
      dispatch({
        type: 'ASK',
        ask: {
          files,
          answer: (yes) => {
            asking.current = false
            answer(yes)
          }
        }
      })
    )
  }

  // Run one file and resolve when it finishes. Shared by single and batch runs.
  // Resolves with how it ended, every output the backend resolved for it
  // (none for a run that never started), its command line and how long it
  // ran. overwrite: the user confirmed overwriting its existing outputs.
  // call: what `run` is sent, instead of the form's (a History Re-run).
  function runOne(
    inFile: string,
    outFile: string,
    overrides?: Record<string, ParamValue>,
    overwrite = false,
    call?: Record<string, unknown>
  ): Promise<RunResult & { outputs?: ResolvedOutputs; ms: number; params: Record<string, unknown>; log: LogStore }> {
    return new Promise((settle) => {
      const id = newJobId()
      const log = createLogStore()
      live.current = log
      const at = Date.now()
      // The run's Done has come (so a failed reply is not "could not start").
      let gotDone = false
      const onChange = (job: RunJob, a: JobAction): void => {
        if (a.type === 'EVENT' && a.event.kind === 'log') {
          // Into the log store only: no React state changes, so only the
          // drawer re-renders.
          log.append(a.event.lines.map((l: LogLine) => l[0]))
          a.event.lines.forEach((l: LogLine) => onLogLine(l[0], l[1]))
          return
        }
        if (a.type === 'REPLY') {
          command.current = job.command
          if (!a.reply.started) log.reset([`FASTag could not start: ${a.reply.reason ?? 'no reason given'}`])
        } else if (a.type === 'REJECTED') {
          if (!gotDone) log.reset([`FASTag could not start: ${a.error}`])
        } else if (a.type === 'EVENT' && a.event.kind === 'done') {
          gotDone = true
          const r = job.result!
          log.append([
            r.ok ? '— done —' : job.status === 'cancelled' ? '— cancelled (stopped before it finished) —' : `— failed (${failText(r)}) —`,
            ...cleanupLines(r.cleanup)
          ])
        }
        dispatch({ type: 'EVENT', id, action: a })
      }
      lastTags.current = null
      // The Overview and the Digest reports of the run before go.
      setTab((t) => (t === 'digest' || t === 'overview' ? 'results' : t))
      command.current = undefined
      lastError.current = noLines()
      lastLine.current = noLines()
      inHelp.current = false
      notes.current = []
      cancelled.current = false
      const sent = call ?? withWorkflow(runParams(inFile, outFile, overrides))
      const params = overwrite ? { ...sent, overwrite: true } : sent
      dispatch({ type: 'RUN_START', id, input: inFile, out: outFile, params, at, log, speciesOn: speciesOf(params) })
      const job = runJob(window.fastag, params, id, onChange)
      currentJob.current = job
      void job.settled.then((j) => {
        const r0 = j.result!
        const r: RunResult = { ...r0, cancelled: j.status === 'cancelled' }
        const failedRun = !r.ok && !isCancelled(r)
        dispatch({
          type: 'DONE',
          id,
          result: isCancelled(r) ? { ...r, cancelled: true } : r,
          at: Date.now(),
          tags: lastTags.current,
          reason: failedRun ? failureReason(r) : undefined,
          notes: notes.current.slice()
        })
        if (currentJob.current?.job().id === id) currentJob.current = null
        settle({ ...r, outputs: j.outputs, ms: Date.now() - at, params, log })
      })
    })
  }

  // The tags and reports of a run, at the paths the backend resolved for it
  // (ResolvedOutputs): the renderer never derives an output path itself.
  //
  // @p ran: what the run was sent and its log, for the Overview.
  async function showResults(inFile: string, outputs: ResolvedOutputs, ran?: { params: Record<string, unknown>; log: LogStore }): Promise<void> {
    const outFile = outputs.out
    if (!outFile) {
      // Done without outputs: the reply that names them never came.
      pushLog('The run finished, but the app did not learn where it wrote its outputs; open them with Open tags….')
      return
    }
    const g = ++showGen.current
    selected.current = outFile
    // The run shown is one run: its outputs are known as such, whatever
    // their names (a later file is told against them, sameRunIn).
    const written = Object.values(outputs as unknown as Record<string, unknown>).filter((x): x is string => typeof x === 'string' && x !== '')
    for (const x of written) runs.current.set(x, { id: `shown:${outFile}`, outputs: written })
    const stale = (): boolean => g !== showGen.current
    dispatch({ type: 'RESULTS', update: (r) => ({ path: outFile, gen: (r?.gen ?? 0) + 1, input: inFile }) })
    dispatch({ type: 'BATCH_MISS', miss: null })
    let switched = false
    let species: SpeciesReport | null = null
    // What the run was sent decides (a Re-run's record), else the form.
    const runSpecies = ran ? speciesOf(ran.params) : speciesOn
    const runWorkflow = ran ? workflowOf(ran.params) : null
    // The Species tab and the evidence counts are this run's (a batch job
    // selected after a later one), from its own call and log; none are
    // left from the run shown before.
    dispatch({ type: 'SPECIES', species: null, speciesRun: { input: inFile, enabled: runSpecies } })
    dispatch({ type: 'EVIDENCE', evidence: ran ? evidenceOfLog(ran.log.get()) : { contributed: null, ms2: null, czExcluded: null } })
    if (runSpecies && outputs.species_out) {
      // An unreadable species report must not also cost the Digest reports.
      try {
        const sp = await window.fastag.species(outputs.species_out)
        if (stale()) return
        species = sp
        dispatch({ type: 'SPECIES', species: sp })
        if (sp && sp.taxa.length > 0) {
          setTab('species')
          switched = true
        }
      } catch (err) {
        if (stale()) return
        logResultsError(err)
      }
    }
    // Only the reports the run was sent: an inert option was not, so its
    // path is not an output and may hold an old file.
    const sent = REPORT_PARAMS.map((n) => outputs[n]).filter((p): p is string => !!p)
    const rep = await loadReports(sent)
    if (stale()) return
    // A view only for a file that exists (doc/GUI-WORKFLOWS.md 3): a report
    // the run was asked for and did not write gets no tab; the Overview
    // names it instead.
    const exists = (p: string): Promise<boolean> => window.fastag.reportHead(p).then((t) => t != null, () => true)
    const missing: string[] = []
    for (const n of REPORT_PARAMS) {
      const p = outputs[n]
      if (p && !rep.reports.some((r) => r.path === p) && !rep.errors.some((e) => e.includes(p))) missing.push(productLabel(n) ?? n)
    }
    if (outputs.species_out && runSpecies && !species) missing.push(productLabel('species_out') ?? 'Species report')
    // A run re-reads its tables even where the last one wrote them.
    const tables: TablePaths = {}
    for (const [k, p] of Object.entries(tablePaths(outputs)) as [TableKind, string][]) {
      if (await exists(p)) tables[k] = p
      else if (k !== 'reconIds') missing.push(productLabel(TABLE_PARAM[k]) ?? k)
    }
    if (stale()) return
    const all = workflowReportsOf(outputs)
    // The reduced FASTA and the engine configuration too: only those written.
    const wf = await workflowFiles(all, exists)
    missing.push(...wf.missing)
    const workflow: WorkflowReports = wf.files.length ? { files: wf.files } : {}
    for (const [k, p] of workflowPaths(all)) {
      if (await exists(p)) workflow[k] = p
      else missing.push(productLabel(WORKFLOW_PARAM[k]) ?? k)
    }
    if (stale()) return
    const read = (p: string | undefined): Promise<string | null> => (p ? window.fastag.report(p).catch(() => null) : Promise.resolve(null))
    const census = await read(workflow.censusSummary)
    // What the Overview's workflow figures read: small key/value reports and
    // the mass-shift table (one row per shift).
    const texts = {
      qc: await read(workflow.qc),
      shortlist: await read(workflow.shortlist),
      deltaCounts: await read(workflow.deltaCounts),
      delta: await read(tables.delta),
      triage: await read(workflow.triage),
      config: wf.files.some((f) => f.path === outputs.search_config_out),
      reducedFasta: wf.files.some((f) => f.path === outputs.fasta_out)
    }
    if (stale()) return
    dispatch({
      type: 'REPORTS',
      update: (cur) => ({
        list: rep.reports,
        errors: rep.errors,
        tables,
        gen: bumpGen(cur.gen, Object.keys(tables) as TableKind[]),
        workflow,
        workflowGen: bumpGen(cur.workflowGen, (Object.keys(workflow) as (keyof WorkflowReports)[]).filter((k): k is WorkflowKind => k !== 'files')),
        missing
      })
    })
    if (ran) {
      const sentParams = (ran.params['params'] ?? {}) as Record<string, unknown>
      dispatch({
        type: 'SHOWN',
        shown: { input: inFile, params: sentParams, log: ran.log.get(), reports: rep.reports, species, out: outFile, workflow: runWorkflow ?? undefined, census, texts }
      })
      const landing = hooks.landing?.(runWorkflow, sentParams)
      if (landing) {
        setTab(landing)
        return
      }
    } else dispatch({ type: 'SHOWN', shown: null })
    if (!switched) setTab(rep.reports.length || rep.errors.length ? 'digest' : 'results')
  }

  // The message above the tabs when a run failed: the CLI's exit status and
  // its last error line, which may have scrolled out of the log.
  function failureWhy(): string | null {
    // FASTag's refusal names the reason; its last line is the sentinel.
    // stderr first: its last line is the CLI's last word, whatever stdout
    // line the other reader thread delivered after it.
    const e = lastError.current
    const l = lastLine.current
    return refusalOf(notes.current, null)?.message ?? e.err ?? l.err ?? e.out ?? l.out
  }
  function failureReason(r: RunResult): string {
    const why = failureWhy()
    return `${failText(r)}${why ? `: ${why}` : ''}`
  }
  const failed = (r: RunResult, what: string): void => {
    // A refusal (exit 11) names FASTag's own reason, not its last line
    // (the FASTAG_REFUSED sentinel).
    const refusal = refusalOf(notes.current, r.code) ?? undefined
    const why = refusal?.message ?? failureWhy()
    dispatch({
      type: 'FAILURE',
      failure: {
        title: refusal ? `${what}: raw DIA, not tagged (${failText(r)})` : `${what} failed (${failText(r)})`,
        reasons: why ? [{ text: why, refusal }] : [],
        command: command.current
      }
    })
  }

  // run()/runBatch() are onClick-driven: nothing awaits them, so a rejecting
  // preview/species inside showResults would surface as an unhandled rejection.
  // Log it instead; the run itself already settled.
  const logResultsError = (err: unknown): void =>
    pushLog(`Could not show the results: ${err instanceof Error ? err.message : String(err)}`)

  // Run the single input. @p overrides: values the run is sent over the
  // form's (an Overview action turns an option on and runs again; the form
  // gets the same values).
  async function runWith(overrides?: Record<string, ParamValue>): Promise<void> {
    if (!input || !out) return
    await single(
      input,
      out,
      withWorkflow(runParams(input, out, overrides)),
      () => window.fastag.saveLast(lastOf(overrides ? { ...values, ...overrides } : values)),
      changedParams
    )
  }
  const run = (): Promise<void> => runWith()

  // A History Re-run (GUI-DESIGN 3 S9, 6.5): the recorded run of @p id
  // again, with the parameters it was sent (history_rerun), not the form's,
  // so its command line is the recorded one. Like Run: the overwrite
  // question, then Results. False when it did not start.
  async function rerun(id: string): Promise<boolean> {
    if (running || batchRunning || checking.current || asking.current) return false
    const call = await window.fastag.historyRerun(id)
    const inFile = typeof call.in === 'string' ? call.in : ''
    const outFile = typeof call.out === 'string' ? call.out : ''
    if (!inFile || !outFile) return false
    return single(inFile, outFile, call)
  }

  // One run of @p call (input @p inFile, tags @p outFile): Run, an
  // Overview action and Re-run.
  async function single(
    inFile: string,
    outFile: string,
    call: Record<string, unknown>,
    beforeStart?: () => void,
    changed?: string[]
  ): Promise<boolean> {
    if (checking.current || asking.current) return false
    checking.current = true
    let existing: string[]
    try {
      const check = await existingOutputs([call])
      if (check.clashes.length) {
        refuseClash(check.clashes)
        return false
      }
      existing = check.existing
    } finally {
      checking.current = false
    }
    const overwrite = existing.length > 0
    if (overwrite && !(await askOverwrite(existing))) return false
    beforeStart?.()
    view.setLogJob(null)
    hooks.onStart?.()
    const r = await runOne(inFile, outFile, undefined, overwrite, call)
    dispatch({
      type: 'LAST_RUN',
      lastRun: {
        input: inFile,
        ok: r.ok,
        cancelled: isCancelled(r),
        at: Date.now(),
        ms: r.ms,
        ...(changed ? { changed } : {}),
        cleaned: r.cleanup?.removed.length ?? 0,
        out: r.outputs?.out ?? undefined
      }
    })
    if (r.ok) await showResults(inFile, r.outputs ?? noOutputs, r).catch(logResultsError)
    else if (!isCancelled(r)) failed(r, baseName(inFile))
    return true
  }

  async function runBatch(only?: BatchJob['status']): Promise<void> {
    if (jobs.length === 0 || batchRunning || running || blocked || asking.current) return
    // Checked again over the queue itself: the form's checks may not have
    // seen a file just added (the CLI would refuse each mzPeak job, rc 6).
    const refusedNow = conflicts(toRun(values), { inputs: jobs.map((j) => j.input) })
    if (refusedNow.length) {
      dispatch({ type: 'FAILURE', failure: { title: 'Not started: the CLI would refuse these settings', reasons: refusedNow.map((c) => ({ text: c.note })) } })
      return
    }
    window.fastag.saveLast(lastOf(values))
    view.setLogJob(null)
    dispatch({ type: 'BATCH_RUNNING', on: true })
    // Snapshot the queue we're running and key status updates by input path (the
    // queue is dedup'd on input). A thrown preview/species must still release the
    // batch controls -- hence finally -- or Run stays disabled forever.
    // Without `only`, the jobs not run yet: a failed one is Retry failed's.
    const queue = jobs.filter((j) => (only ? j.status === only : j.status !== 'done' && j.status !== 'failed'))
    // Each failed job with its reason: the next job clears the log.
    const failures: Failure['reasons'] = []
    let failedCommand: string[] | undefined
    // The last job of this batch that wrote its tags, and the last one run.
    let lastDone: string | undefined
    let lastRunJob: { input: string; ok: boolean } | undefined
    const failedInputs: string[] = []
    // What this pass ran, for the finish notice (useFinish.ts).
    const ended: BatchEnd = { ran: 0, failed: 0, cancelled: false }
    batchCancel.current = false
    try {
      // Every input of the queue is protected in every job (fastag.rs
      // RunParams.protect): job 1's output must not be the file job 2 reads
      // (s.mzML writing s.spectra.mzML, queued too). The backend compares
      // canonical paths, refuses such a run and never cleans one up.
      const protect = [...new Set(jobs.map((j) => j.input))]
      const calls = queue.map((j) => withWorkflow({ ...runParams(j.input, j.out, perJobOutputs(values, j.out)), protect }))
      // One question for the whole batch, before its first job.
      const check = await existingOutputs(calls)
      if (check.clashes.length) {
        refuseClash(check.clashes, true)
        return
      }
      // Two jobs writing one file (case-insensitively: sample.tags.tsv and
      // SAMPLE.tags.tsv on macOS): the second would overwrite the first.
      if (check.shared.length) {
        dispatch({
          type: 'FAILURE',
          failure: {
            title: 'Not started: two jobs of this batch would write the same file',
            reasons: check.shared.map((p) => ({
              text: `${p} would be written by more than one job (file names that differ only in case are one file on most macOS and Windows volumes). Rename an input or choose an output folder.`
            }))
          }
        })
        return
      }
      const existing = check.existing
      const overwrite = existing.length > 0
      if (overwrite && !(await askOverwrite(existing))) return
      for (let i = 0; i < queue.length; i++) {
        if (batchCancel.current) break
        const job = queue[i]
        // RUN_START marks the job running and DONE records how it ended
        // (status, reason, time, outputs and its own log) in the queue.
        const r = await runOne(job.input, job.out, undefined, overwrite, calls[i])
        const status: BatchJob['status'] = r.ok ? 'done' : isCancelled(r) ? 'cancelled' : 'failed'
        ended.ran++
        if (status === 'failed') ended.failed++
        if (status === 'cancelled') ended.cancelled = true
        lastRunJob = { input: job.input, ok: r.ok }
        if (r.ok) lastDone = job.input
        if (status === 'failed') {
          const refusal = refusalOf(notes.current, r.code) ?? undefined
          const why = refusal?.message ?? failureWhy()
          failures.push({
            what: `${baseName(job.input)} (${refusal ? 'raw DIA, not tagged, ' : ''}${failText(r)})`,
            text: why ?? '',
            input: job.input,
            refusal
          })
          failedInputs.push(job.input)
          failedCommand = failedCommand ?? command.current
        }
        if (batchCancel.current) break
        if (r.ok && i === queue.length - 1)
          // preview the last
          await showResults(job.input, r.outputs ?? noOutputs, r).catch(logResultsError)
      }
      // The pane must not keep an older table as if it were this batch's:
      // name the job without tags, and a done one to select instead.
      if (lastRunJob && !lastRunJob.ok) {
        // A job done in an earlier pass of this queue counts too.
        const done = lastDone ?? [...jobs].reverse().find((j) => j.status === 'done')?.input
        dispatch({ type: 'BATCH_MISS', miss: { input: failedInputs[0] ?? lastRunJob.input, done } })
        setTab('results')
      }
      // A job that failed before the user cancelled the rest still failed.
      if (failures.length > 0)
        dispatch({
          type: 'FAILURE',
          failure: {
            title: `${failures.length} of ${queue.length} batch jobs failed`,
            reasons: failures,
            command: failedCommand,
            logOf: failures[0].input
          }
        })
    } finally {
      if (batchCancel.current) ended.cancelled = true
      dispatch({ type: 'BATCH_RUNNING', on: false, ended: ended.ran > 0 ? ended : undefined })
      batchCancel.current = false
    }
  }

  // Resolves true when a file was picked.
  async function openResults(): Promise<boolean> {
    const p = await window.fastag.pickResults()
    if (p) await openResultsPath(p)
    return !!p
  }

  // What another run left shown goes when a file of @p p's run opens: its
  // tags, its species report (with the run it describes) and its Overview.
  // The reports and tables are closed by the opener itself. Judged in the
  // reducer, against the state as it is then: a render's state read after
  // an await may still show the run before.
  function closeOtherRun(p: string, keepTags = false): void {
    dispatch({ type: 'CLOSE_OTHER_RUN', path: p, same, keepTags })
  }

  // Any file FASTag wrote, picked or dropped (Open earlier results…, Open
  // tags…, a drop): told by its content, so a QC report, a shortlist or an
  // identifiability table opens in its own view whatever its name. A file
  // is read as a tags table only once no report format fits.
  async function openResultsPath(p: string, t: Selection = select(p)): Promise<void> {
    const head = await window.fastag.reportHead(p).catch(() => null)
    if (superseded(t)) return
    if (head != null) {
      if (sniffWorkflow(head, p) || sniffTable(head) || sniffLongForm(head) || /^\s*</.test(head)) return openReportPath(p, head, t)
      if (sniffSpecies(head)) return openSpeciesPath(p, t)
    }
    return openTagsPath(p, t)
  }

  // A tags table.
  async function openTagsPath(p: string, t: Selection = select(p)): Promise<void> {
    // Select before waiting: a mixed drop may open a report alongside the
    // tags, and that report's later selection should remain in front.
    if (latest(t)) setTab('results')
    // A file whose run the record marks cancelled or failed (its cleanup
    // could not remove it) is not opened as a complete table.
    const rec = await window.fastag.historyOf(p).catch(() => null)
    if (superseded(t)) return
    recordRun(p, rec)
    const recorded = rec && rec.status !== 'ok' ? { status: rec.status, end: rec.end } : undefined
    dispatch({
      type: 'RESULTS',
      update: (r) => ({ path: p, gen: (r?.gen ?? 0) + 1, ...(recorded ? { stale: true, incomplete: true, recorded } : {}) })
    })
    dispatch({ type: 'BATCH_MISS', miss: null })
    // Tags of another run: the Overview, the species and the reports of the
    // run shown are not this file's (B's tags beside A's QC would read as
    // one run).
    dispatch({ type: 'CLOSE_OTHER_RUN', path: p, same, keepTags: true, tagsOpened: true, reports: (cur) => closeOtherRuns(cur, p, same) })
  }

  // A done batch job's tags and reports, as the batch writes them.
  function showJob(j: BatchJob): void {
    if (!j.outputs) return
    setTab('results')
    const params = state.jobs.find((x) => x.batch && x.input === j.input)?.params
    showResults(j.input, j.outputs, params && j.log ? { params, log: j.log } : undefined).catch(logResultsError)
  }

  // A recorded run opened from History (use case 8): its tags, the reports
  // it was sent and its workflow's views, as showJob does for a batch job.
  // The record keeps no log: the Overview reads the files alone. A tags
  // file a later run left incomplete (its record says so) opens as that,
  // marked, without the finished run's reports.
  //
  // The files are those of the run that wrote them last: when a later run
  // (B) wrote @p out over this one (A), A's input, parameters and reports
  // would be shown beside B's tags. B's record opens instead, with a
  // notice that A's outputs were overwritten.
  async function showRecord(r: RunRecord, out: string): Promise<void> {
    const t = select(out)
    setTab('results')
    const last = await window.fastag.historyOf(out).catch(() => null)
    if (superseded(t)) return
    if (last && last.status !== 'ok') return openTagsPath(out, t)
    const shown = last && last.id !== r.id ? last : r
    const call: Record<string, unknown> = { params: shown.params ?? {}, ...(shown.workflow ? { workflow: shown.workflow } : {}) }
    // Each report path is checked as the tags are: a report a later run
    // wrote over (another tags file, the same report path) is withheld, and
    // the banner names that run. B's QC beside A's tags would read as one run.
    const outputs = recordOutputs(shown, out)
    const reportsReplaced: { path: string; by: string; end: number }[] = []
    // A later run that did not finish withholds nothing: its record may name
    // a path it never wrote. The report is shown, with a note.
    const reportsTouched: { path: string; by: string; end: number; status: 'cancelled' | 'failed' }[] = []
    const slots = outputs as unknown as Record<string, string | null | undefined>
    for (const [k, p] of Object.entries(slots)) {
      if (k === 'out' || !p || p === out) continue
      const w = await window.fastag.historyOf(p).catch(() => null)
      if (superseded(t)) return
      if (w && w.id !== shown.id && w.end >= shown.end) {
        if (w.status !== 'ok') {
          reportsTouched.push({ path: p, by: w.input, end: w.end, status: w.status })
          continue
        }
        slots[k] = null
        reportsReplaced.push({ path: p, by: w.input, end: w.end })
      }
    }
    await showResults(shown.input, outputs, { params: call, log: createLogStore() }).catch(logResultsError)
    if (shown !== r || reportsReplaced.length || reportsTouched.length)
      dispatch({
        type: 'RESULTS',
        update: (x) =>
          x && x.path === out
            ? {
                ...x,
                ...(shown !== r ? { replaced: { input: r.input, by: shown.input, end: shown.end } } : {}),
                ...(reportsReplaced.length ? { reportsReplaced } : {}),
                ...(reportsTouched.length ? { reportsTouched } : {})
              }
            : x
      })
  }

  // Add one report to those shown, replacing one of the same kind. A report
  // of another run replaces all of them: one run's call next to another
  // run's labels would read as one result.
  async function openReport(): Promise<void> {
    const p = await window.fastag.pickReport()
    if (!p) return
    await openReportPath(p)
  }

  // Reports dropped together: each is added as a picked one would be,
  // under one selection for the whole drop. A later choice of another run
  // (another file opened while these are read) stops the rest: they never
  // replace it. A file of the same run opened meanwhile (the drop's species
  // report, selected as it starts) is part of the same choice: superseded,
  // not a strict generation check, or the drop's other reports would be
  // dropped after the first.
  async function openReportPaths(paths: string[], t: Selection | undefined = undefined): Promise<void> {
    if (!paths.length) return
    t ??= select(paths[0])
    for (const p of paths) {
      if (superseded(t)) return
      await openReportPath(p, undefined, { g: t.g, p })
    }
  }

  // One drop: its tags, reports and species report under ONE selection.
  // Taken apart, each later part would supersede the tags whenever the
  // names do not tell one run (custom names, no record read yet), and the
  // tags of the run dropped would be dropped as another run's.
  async function openDropped(d: { results?: string | null; reports: string[]; species?: string | null }): Promise<void> {
    const first = d.results ?? d.reports[0] ?? d.species
    if (!first) return
    const t = select(first)
    await Promise.all([
      d.results ? openResultsPath(d.results, t) : null,
      d.reports.length ? openReportPaths(d.reports, t) : null,
      d.species ? openSpeciesPath(d.species, t) : null
    ])
  }

  // A species report, dropped or opened: shown in the Species tab, in
  // place of what another run left shown.
  async function openSpeciesPath(p: string, t: Selection = select(p)): Promise<void> {
    try {
      const sp = await window.fastag.species(p)
      if (superseded(t)) return
      // The run that wrote it, when the app recorded it; else the report.
      const rec = await window.fastag.historyOf(p).catch(() => null)
      if (superseded(t)) return
      recordRun(p, rec)
      closeOtherRun(p)
      dispatch({ type: 'REPORTS', update: (cur) => closeOtherRuns(cur, p, same) })
      // A report read is shown whatever Setup's species switch and reach
      // check say; the counts of the run shown before are not its own.
      dispatch({ type: 'REPORTS', update: (cur) => withPartial(cur, p, rec) })
      dispatch({ type: 'SPECIES', species: sp, speciesRun: { input: baseName(rec?.input ?? p), enabled: true, params: rec?.params ?? null } })
      dispatch({ type: 'EVIDENCE', evidence: { contributed: null, ms2: null, czExcluded: null } })
      if (latest(t)) setTab('species')
    } catch (err) {
      logResultsError(err)
    }
  }

  async function openReportPath(p: string, known?: string | null, t: Selection = select(p)): Promise<void> {
    // A workflow report (QC, shortlist, identifiability, survey tables)
    // opens in its own view, told by its content: not the Digest parser.
    const head = known !== undefined ? known : await window.fastag.reportHead(p).catch(() => null)
    if (superseded(t)) return
    if (head != null && known === undefined && !sniffWorkflow(head, p) && !sniffTable(head) && !sniffLongForm(head) && !/^\s*</.test(head)) {
      // Picked as a report, yet a species report or a tags table.
      if (sniffSpecies(head)) return openSpeciesPath(p, t)
      if (sniffTags(head)) return openTagsPath(p, t)
    }
    const wk = head != null ? sniffWorkflow(head, p) : null
    // The run that wrote it, as tags and History records are checked: a
    // report of a cancelled or failed run (its cleanup could not remove it)
    // is not shown as complete.
    const rec = await window.fastag.historyOf(p).catch(() => null)
    if (superseded(t)) return
    recordRun(p, rec)
    const mark = (): void => dispatch({ type: 'REPORTS', update: (cur) => withPartial(cur, p, rec) })
    // A report of another run replaces its tags, species and Overview.
    closeOtherRun(p)
    if (wk) {
      dispatch({ type: 'SHOWN', shown: null })
      dispatch({
        type: 'REPORTS',
        update: (cur) => {
          const kept = closeOtherRuns(cur, p, same)
          // Opening the file again reads it again (it may have changed).
          return { ...kept, workflow: { ...kept.workflow, [wk]: p }, workflowGen: bumpGen(cur.workflowGen, [wk]), missing: undefined }
        }
      })
      mark()
      if (latest(t)) setTab(TAB_OF[wk])
      return
    }
    // A wide table (P4c: recon, delta, mzTab ids, glyco) opens in its viewer.
    const table = await sniffPath(p, head)
    if (superseded(t)) return
    if (table) {
      dispatch({
        type: 'REPORTS',
        update: (cur) => {
          if (!('kind' in table)) return { ...cur, errors: [...cur.errors, table.error] }
          // Like a long-form report of another run (below), a table of
          // another run closes what the view showed of the run before:
          // B's recon bins must not sit under A's peaks and counts.
          const closedReports = cur.list.filter((r) => !same(r.path, p))
          const { kept, closed: closedTables } = splitTables(cur.tables, p, table.kind, same)
          const closed = [...closedReports.map((r) => r.path), ...closedTables]
          const tables = { ...kept, [table.kind]: p }
          // Opening the file again reads it again (it may have changed).
          const gen = bumpGen(cur.gen, [table.kind])
          // The workflow reports of another run close as well: B's table
          // beside A's QC, Shortlist or Triage would read as one run.
          const workflow = closeOtherRuns(cur, p, same).workflow
          if (closed.length === 0) return { ...cur, tables, gen, workflow, missing: undefined, notice: undefined }
          const note = closedNote(p, closed)
          return { list: cur.list.filter((r) => !closedReports.includes(r)), errors: [note], tables, gen, workflow, notice: note, partial: closeOtherRuns(cur, p, same).partial }
        }
      })
      mark()
      // An unreadable one is named where report errors are: the Digest tab.
      if (latest(t)) setTab('kind' in table ? (table.kind === 'glyco' ? 'glyco' : 'recon') : 'digest')
      closeOtherRun(p)
      return
    }
    const rep = await loadReports([p])
    if (superseded(t)) return
    if (rep.reports.length === 0 && rep.errors.length === 0) rep.errors.push(`${p} does not exist.`)
    dispatch({
      type: 'REPORTS',
      update: (cur) => {
        const input = (r: Report): string | undefined => value(r, 'run', 'input')
        const fresh = rep.reports[0]
        const other = fresh ? cur.list.filter((r) => !sameRun(r, fresh, runs.current)) : []
        const notes = other.length
          ? [
              `${baseName(fresh.path)} is from ${
                other.some((r) => input(r) !== input(fresh))
                  ? `another input (${input(fresh) ?? 'not stated'})`
                  : `another run of ${input(fresh) ?? 'its input'}`
              }; ${other.map((r) => r.path).join(', ')} ${other.length === 1 ? 'was' : 'were'} closed.`
            ]
          : []
        const kept = cur.list.filter((r) => !other.includes(r) && !rep.reports.some((n) => n.kind === r.kind))
        // The tables of another run close too; those of the fresh report's
        // run (its folder and stem) stay, so B's recon dropped with B's
        // massgap is kept whichever opens first.
        const split = fresh ? splitTables(cur.tables, fresh.path, undefined, same) : { kept: cur.tables ?? {}, closed: [] }
        if (fresh && other.length === 0 && split.closed.length > 0) notes.push(closedNote(fresh.path, split.closed))
        else if (notes.length && split.closed.length > 0) notes[0] = notes[0].replace(/ (was|were) closed\.$/, `, ${split.closed.join(', ')} were closed.`)
        const closedRuns = closeOtherRuns(cur, p, same)
        return { list: [...kept, ...rep.reports], errors: [...notes, ...rep.errors], tables: split.kept, gen: cur.gen, workflow: closedRuns.workflow, partial: closedRuns.partial }
      }
    })
    mark()
    closeOtherRun(p)
    if (latest(t)) setTab('digest')
  }

  function cancelRun(): void {
    if (!running || cancelling) return
    cancelled.current = true
    currentJob.current?.dispatch({ type: 'CANCEL_REQUESTED' })
    dispatch({ type: 'CANCEL_REQUESTED' })
    if (batchRunning) batchCancel.current = true
    window.fastag.cancel()
  }

  // "Cancel run and quit" in the close guard: the backend kills the run; the
  // queue starts nothing after it.
  function cancelForQuit(): void {
    cancelled.current = true
    batchCancel.current = true
    currentJob.current?.dispatch({ type: 'CANCEL_REQUESTED' })
    dispatch({ type: 'CANCEL_REQUESTED' })
  }

  // Reveal the last run's -out in the file manager, or open its folder. The
  // backend refuses any path that is not an output of a run of this app.
  async function reveal(folder: boolean): Promise<void> {
    if (!state.lastRun?.ok || !state.lastRun.out) return
    dispatch({ type: 'REVEAL_ERR', error: null })
    try {
      await window.fastag.revealOutput(state.lastRun.out, folder)
    } catch (err) {
      dispatch({ type: 'REVEAL_ERR', error: err instanceof Error ? err.message : String(err) })
    }
  }

  // Setters for the result tabs and the overwrite question; stable, like
  // the useState setters they replace.
  const setResults: Dispatch<SetStateAction<Results | null>> = useCallback((u) => dispatch({ type: 'RESULTS', update: u }), [])
  const setFailure = useCallback((f: Failure | null) => dispatch({ type: 'FAILURE', failure: f }), [])
  const setCopied = useCallback((c: 'yes' | 'no' | null) => dispatch({ type: 'COPIED', copied: c }), [])
  const setOverwriteAsk = useCallback((a: OverwriteAsk | null) => dispatch({ type: 'ASK', ask: a }), [])

  const p = running ? active?.progress : undefined
  // The job whose tags are shown, by its output path: an older History run
  // of the same input is not the session's last run, and its notes are not
  // that run's.
  const shownPath = state.results?.path
  const shownJob = shownPath
    ? state.jobs.find((j) => j.status !== 'running' && (j.resolvedOutputs?.out === shownPath || j.out === shownPath))
    : undefined
  // A re-run fix applies its values to the form and runs that: only when
  // the run shown is the session's last single run and the form would send
  // the same call again.
  const shownRerunnable =
    !!shownJob && !shownJob.batch && !!input && !!out && sameCall(shownJob.params, withWorkflow(runParams(input, out)))
  return {
    running,
    // The input and -out of the job in flight (a single run, a History
    // Re-run or the batch job going), null when none is: what the Results
    // title, the run pill and the Running panel name. Not the form's
    // input: a Re-run of A while Setup holds B runs A.
    activeInput: running && active ? active.input : null,
    activeOut: running && active ? active.out : null,
    // What Setup shows while a single run goes (shell-1): the request that
    // was sent (a Re-run's recorded call, an Overview action's values), not
    // the form, which may have moved on.
    inFlight: running && active && !active.batch && active.params ? callView(active.input, active.out, active.params, active.resolvedOutputs) : null,
    batchRunning,
    batchEnd: state.batchEnd,
    busy: running || batchRunning,
    cancelling,
    progress:
      p && p.done !== null && p.total !== null ? { done: p.done, total: p.total, ratePerSec: p.ratePerSec, etaSec: p.etaSec } : null,
    // The phase the run is in (progress.rs), for the run bar.
    phase: active?.progress.phase ?? null,
    // The live log: the store of the job last started. Read it with useLog
    // (the drawer) or get(); it is not React state.
    log: state.liveLog,
    announce: state.announce,
    startedAt: active?.startedAt ?? 0,
    evidence: state.evidence,
    // The inspector's CLI lines of the run whose results are shown.
    shownNotes: shownJob?.notes ?? [],
    shownRerunnable,
    jobs,
    summary,
    // What each done batch job wrote (useBatchData), for the SDRF comparison.
    batchData,
    outDir: state.batchOutDir,
    setOutDir,
    chooseOutDir,
    addBatchFiles,
    addBatchFolder,
    addBatchPaths,
    removeJobs,
    // Failed jobs are Retry failed's, not the remaining ones.
    remaining: jobs.filter((j) => j.status !== 'done' && j.status !== 'failed').length,
    failedJobs: jobs.filter((j) => j.status === 'failed').length,
    results: state.results,
    setResults,
    batchMiss: state.batchMiss,
    species: state.species,
    speciesRun: state.speciesRun,
    reports: state.reports,
    failure: state.failure,
    setFailure,
    copied: state.copied,
    setCopied,
    lastRun: state.lastRun,
    revealErr: state.revealErr,
    overwriteAsk: state.overwriteAsk,
    setOverwriteAsk,
    // The request `run` would be given for the single input: what the Setup
    // footer's Copy command and Export INI send, so neither can say
    // anything a run would not do.
    paramsFor: (): Record<string, unknown> => withWorkflow(runParams(input, out)),
    run,
    runWith,
    shown: state.shown,
    rerun,
    runBatch,
    cancelRun,
    cancelForQuit,
    showJob,
    showRecord,
    openResults,
    openResultsPath: (p: string) => openResultsPath(p),
    openReport,
    openReportPaths: (paths: string[]) => openReportPaths(paths),
    openSpeciesPath: (p: string) => openSpeciesPath(p),
    openDropped,
    reveal
  }
}

export type RunState = ReturnType<typeof useRun>

/// Two run calls send the same: input, output and parameters alike (the
/// overwrite confirmation and the workflow name aside).
export function sameCall(a: Record<string, unknown> | undefined, b: Record<string, unknown>): boolean {
  if (!a) return false
  if (a['in'] !== b['in'] || a['out'] !== b['out']) return false
  const pa = (a['params'] ?? {}) as Record<string, unknown>
  const pb = (b['params'] ?? {}) as Record<string, unknown>
  const keys = new Set([...Object.keys(pa), ...Object.keys(pb)])
  for (const k of keys) if (JSON.stringify(pa[k]) !== JSON.stringify(pb[k])) return false
  return true
}

/// The input, the files written and the changed parameters of a run call, as
/// Setup's busy view lists them. The outputs are the backend's once it
/// resolved them, before that -out and every output path the call names.
export function callView(
  input: string,
  out: string,
  call: Record<string, unknown>,
  resolved?: ResolvedOutputs
): { input: string; out: string; writingFiles: string[]; changedParams: string[] } {
  const params = (call['params'] ?? {}) as Record<string, unknown>
  const norm = (n: string, v: unknown): ParamValue => {
    if (PARAM_BY_NAME.get(n)?.type === 'bool') return v === true || v === 'true'
    if (Array.isArray(v)) return v.map(String)
    return String(v ?? '')
  }
  const sent: Record<string, ParamValue> = {}
  for (const [n, v] of Object.entries(params)) sent[n] = norm(n, v)
  const files: string[] = []
  if (resolved) {
    if (resolved.out) files.push(resolved.out)
    for (const [k, v] of Object.entries(resolved)) if (k !== 'out' && typeof v === 'string' && v) files.push(v)
  } else {
    files.push(out)
    for (const n of RENDERED) {
      if (PARAM_BY_NAME.get(n)?.type !== 'output-file') continue
      const v = sent[n]
      if (typeof v === 'string' && v && !inertBecause(n, sent)) files.push(v)
    }
  }
  const changedParams = RENDERED.filter((n) => n in sent && !inertBecause(n, sent) && isChanged(n, sent[n])).map((n) => cliText(n, sent[n]))
  return { input, out, writingFiles: [...new Set(files.filter(Boolean).map(baseName))], changedParams }
}
