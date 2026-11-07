// The run (GUI-DESIGN 5 runStore): one run or a batch of them, their log
// and progress, and what they leave for the result tabs. The state is one
// useReducer (runReducer.ts, P2a PR r), which replaced the useState setters
// P1 PR c moved here from App.tsx; each job's events come on its own Channel
// (runJob.ts), and its log lines go to its log store (logStore.ts), not to
// React state, so a Log batch re-renders only the drawer.

import { useCallback, useEffect, useMemo, useReducer, useRef, type Dispatch, type SetStateAction } from 'react'
import type { LogLine, ResolvedOutputs, RunResult, SpeciesReport } from '../types'
import { newJobId, runJob, type Job as RunJob, type JobAction } from '../runJob'
import { RENDERED, inertBecause } from '../paramLayout'
import type { ParamValue } from '../ParamField'
import { baseName, value, type Report } from '../digestReport'
import { perJobOutputs, REPORT_PARAMS } from '../app/paths'
import { cleanupLines, failText } from '../app/format'
import type { ViewStore } from '../app/viewStore'
import { loadReports, sameRun } from '../results/reports'
import type { BatchJob } from './batch'
import { buildSummary } from './batchSummary'
import { useBatchData } from './useBatchSummary'
import { createLogStore, type LogStore } from './logStore'
import {
  activeJob,
  createRunState,
  queueView,
  runReducer,
  type BatchEnd,
  type Failure,
  type OverwriteAsk,
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

// What a run is started with, from the session.
export interface RunInputs {
  values: Record<string, ParamValue>
  input: string
  out: string
  blocked: boolean
  speciesOn: boolean
  // The parameters a run sends that differ from the defaults.
  changedParams: string[]
}

// The outputs of a run whose reply never came (or was refused): none.
const noOutputs: ResolvedOutputs = { out: null }

// The shell's part in a run (P2a PR s): onStart is called when a single run
// is about to start (after the overwrite question), so the app can show
// Results, where its state and a refused start's reason are.
//
// overviewLanding: a run's results land on the Overview tab (GUI-DESIGN 3
// S3, D8) rather than on the Species or Digest tab: the tasks that
// characterize a run say yes.
export interface RunHooks {
  onStart?(): void
  overviewLanding?(): boolean
}

export function useRun(s: RunInputs, view: ViewStore, hooks: RunHooks = {}) {
  const { values, input, out, blocked, speciesOn, changedParams } = s
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
  const lastError = useRef<string | null>(null)
  // The tag count of the CLI's summary line, for the announcement.
  const lastTags = useRef<number | null>(null)
  // The last log line: FASTag's own refusals name no error, exception or fatal.
  const lastLine = useRef<string | null>(null)
  // Inside the --help dump OpenMS prints after a ConversionError.
  const inHelp = useRef(false)
  // The job in flight (runJob.ts): its events come on its own Channel, so
  // none can reach another job, and a Done before the reply is a state of
  // the job, not a race.
  const currentJob = useRef<ReturnType<typeof runJob> | null>(null)
  // Cancel pressed during a batch: stop the QUEUE, not just the current job.
  const batchCancel = useRef(false)
  // Cancel pressed during the current run: its failure is the user's doing.
  const cancelled = useRef(false)
  // A killed run's exit status says nothing (Windows reports code 1), so a
  // cancel is read off the backend flag or the Cancel the user pressed. A run
  // that finished ok despite the kill stays ok.
  const isCancelled = (r: RunResult): boolean => !r.ok && (r.cancelled === true || cancelled.current)
  const jobs = useMemo(() => queueView(state), [state.jobs])
  // The batch summary (GUI-DESIGN 3 S6): one row per job, from its reports.
  const batchData = useBatchData(state.jobs)
  const summary = useMemo(() => buildSummary(jobs, batchData), [jobs, batchData])

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
  const onLogLine = (line: string): void => {
    // The reason for the banner: neither the exit epilogue nor the help
    // dump that follows a ConversionError can be it.
    if (HELP_START.test(line)) inHelp.current = true
    if (!inHelp.current && !EPILOGUE.test(line) && !REFUSED.test(line)) {
      if (ERROR_WORD.test(line)) lastError.current = line
      if (line.trim()) lastLine.current = line.trim()
    }
    // "Species: N spectra contributed taxon evidence; ..."
    const sp = /^Species:\s+(\d+) spectra contributed/.exec(line)
    if (sp) dispatch({ type: 'EVIDENCE', evidence: { contributed: Number(sp[1]) } })
    // "42092 MS2 spectra, 1130228 tags[ -> 5321 after filtering]"
    const ms2 = /^(\d+) MS2 spectra,(?: (\d+) tags)?(?: -> (\d+) after filtering)?/.exec(line)
    if (ms2) dispatch({ type: 'EVIDENCE', evidence: { ms2: Number(ms2[1]) } })
    const t = ms2?.[3] ?? ms2?.[2]
    if (t) lastTags.current = Number(t)
  }

  async function addBatchFiles(): Promise<void> {
    addBatchPaths(await window.fastag.pickInputs())
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

  // Only the parameters the UI renders. The form seeds a value for every manifest
  // entry, but HIDDEN ones must never reach the command line: `-version` is
  // recorded in the INI yet rejected as an option, so sending the whole record
  // aborts the run with "Unknown option(s) '[-version]'".
  //
  // Inert ones (their master is unset) with a value stay out too: the CLI
  // ignores most of them, but refuses some (-massgap_out without -recon_out).
  // An empty value still goes, as it asks for the CLI's default.
  const submittedParams = (): Record<string, ParamValue> =>
    Object.fromEntries(RENDERED.map((name) => [name, values[name]]))
  const withoutInert = (p: Record<string, ParamValue>): Record<string, ParamValue> =>
    Object.fromEntries(Object.entries(p).filter(([name, v]) => v === '' || !inertBecause(name, { ...values, ...p })))

  // What `run` is given for one file.
  const runParams = (inFile: string, outFile: string, overrides?: Record<string, ParamValue>): Record<string, unknown> => ({
    in: inFile,
    out: outFile,
    params: withoutInert({ ...submittedParams(), ...overrides })
  })

  // The outputs of these runs that already exist. A failed check asks
  // nothing: the backend still refuses to run over an unconfirmed file.
  async function existingOutputs(calls: Record<string, unknown>[]): Promise<string[]> {
    try {
      const all = await Promise.all(calls.map((c) => window.fastag.outputsCheck(c)))
      return [...new Set(all.flatMap((c) => c.existing))]
    } catch {
      return []
    }
  }
  const askOverwrite = (files: string[]): Promise<boolean> =>
    new Promise((answer) => dispatch({ type: 'ASK', ask: { files, answer } }))

  // Run one file and resolve when it finishes. Shared by single and batch runs.
  // Resolves with how it ended, every output the backend resolved for it
  // (none for a run that never started), its command line and how long it
  // ran. overwrite: the user confirmed overwriting its existing outputs.
  function runOne(
    inFile: string,
    outFile: string,
    overrides?: Record<string, ParamValue>,
    overwrite = false
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
          const lines = a.event.lines.map((l: LogLine) => l[0])
          log.append(lines)
          lines.forEach(onLogLine)
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
      lastError.current = null
      lastLine.current = null
      inHelp.current = false
      cancelled.current = false
      const params = overwrite ? { ...runParams(inFile, outFile, overrides), overwrite: true } : runParams(inFile, outFile, overrides)
      dispatch({ type: 'RUN_START', id, input: inFile, out: outFile, params, at, log, speciesOn })
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
          reason: failedRun ? failureReason(r) : undefined
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
      pushLog('The run finished, but the app did not learn where it wrote its outputs; open them with Open a tags TSV….')
      return
    }
    dispatch({ type: 'RESULTS', update: (r) => ({ path: outFile, gen: (r?.gen ?? 0) + 1, input: inFile }) })
    dispatch({ type: 'BATCH_MISS', miss: null })
    let switched = false
    let species: SpeciesReport | null = null
    if (speciesOn && outputs.species_out) {
      // An unreadable species report must not also cost the Digest reports.
      try {
        const sp = await window.fastag.species(outputs.species_out)
        species = sp
        dispatch({ type: 'SPECIES', species: sp })
        if (sp && sp.taxa.length > 0) {
          setTab('species')
          switched = true
        }
      } catch (err) {
        logResultsError(err)
      }
    }
    // Only the reports the run was sent: an inert option was not, so its
    // path is not an output and may hold an old file.
    const sent = REPORT_PARAMS.map((n) => outputs[n]).filter((p): p is string => !!p)
    const rep = await loadReports(sent)
    dispatch({ type: 'REPORTS', update: { list: rep.reports, errors: rep.errors } })
    if (ran) {
      const sentParams = (ran.params['params'] ?? {}) as Record<string, unknown>
      dispatch({ type: 'SHOWN', shown: { input: inFile, params: sentParams, log: ran.log.get(), reports: rep.reports, species } })
      if (hooks.overviewLanding?.()) {
        setTab('overview')
        return
      }
    }
    if (!switched && (rep.reports.length || rep.errors.length)) setTab('digest')
  }

  // The message above the tabs when a run failed: the CLI's exit status and
  // its last error line, which may have scrolled out of the log.
  function failureWhy(): string | null {
    return lastError.current ?? lastLine.current
  }
  function failureReason(r: RunResult): string {
    const why = failureWhy()
    return `${failText(r)}${why ? `: ${why}` : ''}`
  }
  const failed = (r: RunResult, what: string): void => {
    const why = failureWhy()
    dispatch({
      type: 'FAILURE',
      failure: { title: `${what} failed (${failText(r)})`, reasons: why ? [{ text: why }] : [], command: command.current }
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
    if (!input || !out || checking.current) return
    checking.current = true
    let existing: string[]
    try {
      existing = await existingOutputs([runParams(input, out, overrides)])
    } finally {
      checking.current = false
    }
    const overwrite = existing.length > 0
    if (overwrite && !(await askOverwrite(existing))) return
    window.fastag.saveLast(overrides ? { ...values, ...overrides } : values)
    view.setLogJob(null)
    hooks.onStart?.()
    const r = await runOne(input, out, overrides, overwrite)
    dispatch({
      type: 'LAST_RUN',
      lastRun: {
        input,
        ok: r.ok,
        cancelled: isCancelled(r),
        at: Date.now(),
        ms: r.ms,
        changed: changedParams,
        cleaned: r.cleanup?.removed.length ?? 0,
        out: r.outputs?.out ?? undefined
      }
    })
    if (r.ok) await showResults(input, r.outputs ?? noOutputs, r).catch(logResultsError)
    else if (!isCancelled(r)) failed(r, baseName(input))
  }
  const run = (): Promise<void> => runWith()

  async function runBatch(only?: BatchJob['status']): Promise<void> {
    if (jobs.length === 0 || batchRunning || running || blocked) return
    window.fastag.saveLast(values)
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
      // One question for the whole batch, before its first job.
      const existing = await existingOutputs(queue.map((j) => runParams(j.input, j.out, perJobOutputs(values, j.out))))
      const overwrite = existing.length > 0
      if (overwrite && !(await askOverwrite(existing))) return
      for (let i = 0; i < queue.length; i++) {
        if (batchCancel.current) break
        const job = queue[i]
        // RUN_START marks the job running and DONE records how it ended
        // (status, reason, time, outputs and its own log) in the queue.
        const r = await runOne(job.input, job.out, perJobOutputs(values, job.out), overwrite)
        const status: BatchJob['status'] = r.ok ? 'done' : isCancelled(r) ? 'cancelled' : 'failed'
        ended.ran++
        if (status === 'failed') ended.failed++
        if (status === 'cancelled') ended.cancelled = true
        lastRunJob = { input: job.input, ok: r.ok }
        if (r.ok) lastDone = job.input
        if (status === 'failed') {
          const why = failureWhy()
          failures.push({ what: `${baseName(job.input)} (${failText(r)})`, text: why ?? '', input: job.input })
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

  // A tags table, picked or dropped.
  async function openResultsPath(p: string): Promise<void> {
    // A file whose run the record marks cancelled or failed (its cleanup
    // could not remove it) is not opened as a complete table.
    const rec = await window.fastag.historyOf(p).catch(() => null)
    const recorded = rec && rec.status !== 'ok' ? { status: rec.status, end: rec.end } : undefined
    dispatch({
      type: 'RESULTS',
      update: (r) => ({ path: p, gen: (r?.gen ?? 0) + 1, ...(recorded ? { stale: true, incomplete: true, recorded } : {}) })
    })
    dispatch({ type: 'BATCH_MISS', miss: null })
  }

  // A done batch job's tags and reports, as the batch writes them.
  function showJob(j: BatchJob): void {
    if (!j.outputs) return
    setTab('results')
    const params = state.jobs.find((x) => x.batch && x.input === j.input)?.params
    showResults(j.input, j.outputs, params && j.log ? { params, log: j.log } : undefined).catch(logResultsError)
  }

  // Add one report to those shown, replacing one of the same kind. A report
  // of another run replaces all of them: one run's call next to another
  // run's labels would read as one result.
  async function openReport(): Promise<void> {
    const p = await window.fastag.pickReport()
    if (!p) return
    await openReportPath(p)
  }

  // Reports dropped together: each is added as a picked one would be.
  async function openReportPaths(paths: string[]): Promise<void> {
    for (const p of paths) await openReportPath(p)
  }

  // A species report, dropped: shown in the Species tab.
  async function openSpeciesPath(p: string): Promise<void> {
    try {
      const sp = await window.fastag.species(p)
      dispatch({ type: 'SPECIES', species: sp })
      setTab('species')
    } catch (err) {
      logResultsError(err)
    }
  }

  async function openReportPath(p: string): Promise<void> {
    const rep = await loadReports([p])
    if (rep.reports.length === 0 && rep.errors.length === 0) rep.errors.push(`${p} does not exist.`)
    dispatch({
      type: 'REPORTS',
      update: (cur) => {
        const input = (r: Report): string | undefined => value(r, 'run', 'input')
        const fresh = rep.reports[0]
        const other = fresh ? cur.list.filter((r) => !sameRun(r, fresh)) : []
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
        return { list: [...kept, ...rep.reports], errors: [...notes, ...rep.errors] }
      }
    })
    setTab('digest')
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
  return {
    running,
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
    jobs,
    summary,
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
    paramsFor: (): Record<string, unknown> => runParams(input, out),
    run,
    runWith,
    shown: state.shown,
    runBatch,
    cancelRun,
    cancelForQuit,
    showJob,
    openResults,
    openResultsPath,
    openReport,
    openReportPaths,
    openSpeciesPath,
    reveal
  }
}

export type RunState = ReturnType<typeof useRun>
