// The run (GUI-DESIGN 5 runStore, P1 PR c; moved from App.tsx): one run or a
// batch of them, their log and progress, and what they leave for the result
// tabs. Each job's events come on its own Channel (runJob.ts).

import { useEffect, useRef, useState } from 'react'
import type { LogLine, ResolvedOutputs, RunResult, SpeciesReport } from '../types'
import { MAX_LOG, newJobId, runJob, type Job as RunJob, type JobAction } from '../runJob'
import { RENDERED, inertBecause } from '../paramLayout'
import type { ParamValue } from '../ParamField'
import { baseName, value, type Report } from '../digestReport'
import { perJobOutputs, REPORT_PARAMS } from '../app/paths'
import { cleanupLines, failText } from '../app/format'
import type { ViewStore } from '../app/viewStore'
import { loadReports, sameRun } from '../results/reports'
import { addJobs, type BatchJob } from './batch'

// TOPPBase prints this epilogue on stdout at every exit, after a refusal on
// stderr too (the two pipes are read on separate threads), so it is never the
// reason a run failed.
const EPILOGUE = /^\S+ took .*Peak Memory Usage/
// OpenMS follows a ConversionError with the whole --help; this header starts
// that dump, and nothing in it explains the failure.
const HELP_START = /^FASTag -- /
// "Error:", "ConversionError", "exception", "fatal".
const ERROR_WORD = /(error|exception)\b|\bfatal\b/i

// The log keeps its last MAX_LOG lines (runJob.ts), appended a batch at a
// time: the backend sends one Log message per flush interval.
export function appendLog(l: string[], lines: string[]): string[] {
  const all = l.concat(lines)
  return all.length <= MAX_LOG ? all : ['… earlier lines dropped …', ...all.slice(all.length - MAX_LOG + 1)]
}

// A run that failed: what failed, and FASTag's own words for why (each failed
// job of a batch has its own), plus the command line to reproduce it.
export interface Failure {
  title: string
  // input: the batch job the reason belongs to, whose log it opens.
  reasons: { what?: string; text: string; input?: string }[]
  command?: string[]
  // The batch job whose log "Show full log" opens; none: the live log.
  logOf?: string
}

// The tags TSV the browser pane shows. gen forces a fresh ResultsTable when
// the same path is re-run: the backend cache invalidates on (len, mtime),
// and the frontend view/scroll state must reset with it. input names the
// run that wrote it (none for an opened file). stale: a run that writes
// this path is in flight. The CLI writes <out> in place, so a run that fails
// or is cancelled can leave it truncated or removed (incomplete).
export interface Results {
  path: string
  gen: number
  input?: string
  stale?: boolean
  incomplete?: boolean
  // The backend removed it (or renamed it to .incomplete) after the run
  // stopped part-way: there is nothing left to open.
  removed?: 'removed' | 'renamed'
  // Opened from disk, and the run record says the run that last wrote it
  // did not finish (history.rs): withheld as incomplete.
  recorded?: { status: 'cancelled' | 'failed'; end: number }
}

// The last run that finished, for the summary over the form, with the
// parameters it was given that differ from the defaults.
export interface LastRun {
  input: string
  ok: boolean
  cancelled: boolean
  at: number
  ms: number
  // Not known for a run of an earlier session (read from the run record).
  changed?: string[]
  // Partial outputs the backend removed after a cancel or failure.
  cleaned: number
  // Read from the run record at start: a run of an earlier session.
  earlier?: boolean
  // Its -out as the CLI wrote it (ResolvedOutputs): Reveal and Open folder.
  out?: string
}

// Parsed from the CLI's own summary line, so the panel reports what the run
// actually did rather than a number the GUI guessed.
export interface Evidence {
  contributed: number | null
  ms2: number | null
}

export interface Reports {
  list: Report[]
  errors: string[]
}

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

export function useRun(s: RunInputs, view: ViewStore) {
  const { values, input, out, blocked, speciesOn, changedParams } = s
  const setTab = view.setTab
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<RunJob['progress']>(null)
  // The phase the run is in (progress.rs), for the run bar.
  const [phase, setPhase] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])
  // The same log, readable synchronously: a batch job keeps a copy of it when
  // it ends, before the next job clears it.
  const liveLog = useRef<string[]>([])
  const pushLog = (...lines: string[]): void => {
    liveLog.current = appendLog(liveLog.current, lines)
    setLog(liveLog.current)
  }
  const resetLog = (lines: string[] = []): void => {
    liveLog.current = lines
    setLog(lines)
  }
  const [results, setResults] = useState<Results | null>(null)
  // A batch whose last job wrote no tags: the Tags tab names the job with
  // none, and a done job whose tags can be selected in the batch.
  const [batchMiss, setBatchMiss] = useState<{ input: string; done?: string } | null>(null)
  const [species, setSpecies] = useState<SpeciesReport | null>(null)
  // The run the Species tab describes, as it was submitted: unticking species
  // or lowering tag_length afterwards must not hide (or re-show) its report.
  // null until the first run; the tab then follows the form.
  const [speciesRun, setSpeciesRun] = useState<{ input: string; enabled: boolean } | null>(null)
  const [reports, setReports] = useState<Reports>({ list: [], errors: [] })
  // Why the last run failed, shown above the result tabs.
  const [failure, setFailure] = useState<Failure | null>(null)
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null)
  const [lastRun, setLastRun] = useState<LastRun | null>(null)
  // Outputs of the run about to start that already exist: confirmed before
  // the run, never after (GUI-DESIGN 6.4). answer(true) runs over them.
  const [overwriteAsk, setOverwriteAsk] = useState<{ files: string[]; answer: (yes: boolean) => void } | null>(null)
  // A Run click is checking for existing outputs: a second click waits.
  const checking = useRef(false)
  // What a screen reader hears of a run: started, finished, stopped. The log
  // is a live region too, but it is display:none while the drawer is shut.
  const [announce, setAnnounce] = useState('')
  // When the run in flight started, and the command line it was given.
  const startedAt = useRef(0)
  const command = useRef<string[] | undefined>(undefined)
  const lastError = useRef<string | null>(null)
  // The tag count of the CLI's summary line, for the announcement.
  const lastTags = useRef<number | null>(null)
  // The last log line: FASTag's own refusals name no error, exception or fatal.
  const lastLine = useRef<string | null>(null)
  // Inside the --help dump OpenMS prints after a ConversionError.
  const inHelp = useRef(false)
  // Why Reveal did nothing.
  const [revealErr, setRevealErr] = useState<string | null>(null)
  const [jobs, setJobs] = useState<BatchJob[]>([])
  const [batchRunning, setBatchRunning] = useState(false)
  // The job in flight (runJob.ts): its events come on its own Channel, so
  // none can reach another job, and a Done before the reply is a state of
  // the job, not a race.
  const currentJob = useRef<ReturnType<typeof runJob> | null>(null)
  const [evidence, setEvidence] = useState<Evidence>({ contributed: null, ms2: null })
  // Cancel pressed during a batch: stop the QUEUE, not just the current job.
  const batchCancel = useRef(false)
  // Cancel pressed during the current run: its failure is the user's doing.
  const cancelled = useRef(false)
  // One cancel per run: further clicks would only send more kills.
  const [cancelling, setCancelling] = useState(false)
  // A killed run's exit status says nothing (Windows reports code 1), so a
  // cancel is read off the backend flag or the Cancel the user pressed. A run
  // that finished ok despite the kill stays ok.
  const isCancelled = (r: RunResult): boolean => !r.ok && (r.cancelled === true || cancelled.current)

  // The last run of an earlier session, from the run record: a cancelled or
  // failed one still reads as such after a restart.
  useEffect(() => {
    window.fastag
      .historyList(1)
      .then((h) => {
        const r = h[0]
        if (!r) return
        setLastRun(
          (cur) =>
            cur ?? {
              input: r.input,
              ok: r.status === 'ok',
              cancelled: r.status === 'cancelled',
              at: r.end,
              ms: Math.max(0, r.end - r.start),
              cleaned: r.cleanup.removed.length,
              earlier: true,
              out: r.outputs[0]
            }
        )
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
    if (!inHelp.current && !EPILOGUE.test(line)) {
      if (ERROR_WORD.test(line)) lastError.current = line
      if (line.trim()) lastLine.current = line.trim()
    }
    // "Species: N spectra contributed taxon evidence; ..."
    const sp = /^Species:\s+(\d+) spectra contributed/.exec(line)
    if (sp) setEvidence((e) => ({ ...e, contributed: Number(sp[1]) }))
    // "42092 MS2 spectra, 1130228 tags[ -> 5321 after filtering]"
    const ms2 = /^(\d+) MS2 spectra,(?: (\d+) tags)?(?: -> (\d+) after filtering)?/.exec(line)
    if (ms2) setEvidence((e) => ({ ...e, ms2: Number(ms2[1]) }))
    const t = ms2?.[3] ?? ms2?.[2]
    if (t) lastTags.current = Number(t)
  }

  async function addBatchFiles(): Promise<void> {
    const files = await window.fastag.pickInputs()
    if (!files.length) return
    setJobs((js) => addJobs(js, files))
  }

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
    new Promise((answer) => setOverwriteAsk({ files, answer }))

  // Run one file and resolve when it finishes. Shared by single and batch runs.
  // Resolves with how it ended and every output the backend resolved for it
  // (none for a run that never started). overwrite: the user confirmed
  // overwriting its existing outputs.
  function runOne(
    inFile: string,
    outFile: string,
    overrides?: Record<string, ParamValue>,
    overwrite = false
  ): Promise<RunResult & { outputs?: ResolvedOutputs }> {
    return new Promise<RunResult & { outputs?: ResolvedOutputs }>((done) => {
      // The table marked stale when the reply named this run's -out.
      let marked: string | null = null
      // The run's Done has come (so a failed reply is not "could not start").
      let gotDone = false
      const finish = (job: RunJob): void => {
        const r = { ...job.result!, cancelled: job.status === 'cancelled' }
        // The CLI writes -out in place: a finished run rewrote it, so the
        // table reads it afresh; a failed or cancelled one may have left it
        // truncated or removed, so the table stays withheld as incomplete.
        // The backend removed what the run wrote: the table has nothing left
        // to open, not even "anyway".
        const gone = (p: string): 'removed' | 'renamed' | undefined =>
          r.cleanup?.removed.includes(p) ? 'removed' : r.cleanup?.renamed.includes(`${p}.incomplete`) ? 'renamed' : undefined
        setResults((x) =>
          x?.stale && marked !== null && x.path === marked
            ? r.ok
              ? { ...x, stale: false, incomplete: false, removed: undefined, gen: x.gen + 1 }
              : { ...x, incomplete: true, removed: gone(x.path) }
            : x
        )
        const name = baseName(inFile)
        const cleaned = r.cleanup?.removed.length ?? 0
        setAnnounce(
          r.ok
            ? `Finished ${name}${lastTags.current != null ? `: ${lastTags.current.toLocaleString('en-US')} tags` : ''}.`
            : isCancelled(r)
              ? `Cancelled ${name}${cleaned ? ', partial outputs removed' : ''}.`
              : `${name} failed${cleaned ? ', partial outputs removed' : ''}.`
        )
        if (currentJob.current?.job().id === job.id) currentJob.current = null
        setRunning(false)
        done({ ...r, outputs: job.outputs })
      }
      const onChange = (job: RunJob, a: JobAction): void => {
        if (a.type === 'REPLY') {
          command.current = job.command
          if (!a.reply.started) {
            resetLog([`FASTag could not start: ${a.reply.reason ?? 'no reason given'}`])
            return
          }
          // The run may replace -out: until it ends, a table of that path
          // may not be what the file will hold.
          const o = job.outputs?.out
          if (o) {
            marked = o
            setResults((x) => (x && x.path === o ? { ...x, stale: true } : x))
          }
          return
        }
        if (a.type === 'REJECTED') {
          if (!gotDone) resetLog([`FASTag could not start: ${a.error}`])
          return
        }
        if (a.type !== 'EVENT') return
        const e = a.event
        if (e.kind === 'log') {
          const lines = e.lines.map((l: LogLine) => l[0])
          pushLog(...lines)
          lines.forEach(onLogLine)
        } else if (e.kind === 'progress') {
          setProgress(job.progress)
        } else if (e.kind === 'phase') {
          setPhase(e.label)
        } else {
          gotDone = true
          setProgress(null)
          const r = job.result!
          pushLog(
            r.ok ? '— done —' : job.status === 'cancelled' ? '— cancelled (stopped before it finished) —' : `— failed (${failText(r)}) —`,
            ...cleanupLines(r.cleanup)
          )
        }
      }
      resetLog()
      setProgress(null)
      setPhase(null)
      setEvidence({ contributed: null, ms2: null }) // don't carry a prior run's counts
      setReports({ list: [], errors: [] })
      // Nor a prior run's species: whatever this run ends as, the old taxa
      // would read as its result.
      setSpecies(null)
      setSpeciesRun({ input: inFile, enabled: speciesOn })
      setBatchMiss(null)
      lastTags.current = null
      setAnnounce(`Run started on ${baseName(inFile)}.`)
      setTab((t) => (t === 'digest' ? 'results' : t))
      setFailure(null)
      setCopied(null)
      startedAt.current = Date.now()
      command.current = undefined
      lastError.current = null
      lastLine.current = null
      inHelp.current = false
      cancelled.current = false
      setCancelling(false)
      setRunning(true)
      const params = overwrite ? { ...runParams(inFile, outFile, overrides), overwrite: true } : runParams(inFile, outFile, overrides)
      const job = runJob(window.fastag, params, newJobId(), onChange)
      currentJob.current = job
      void job.settled.then(finish)
    })
  }

  // The tags and reports of a run, at the paths the backend resolved for it
  // (ResolvedOutputs): the renderer never derives an output path itself.
  async function showResults(inFile: string, outputs: ResolvedOutputs): Promise<void> {
    const outFile = outputs.out
    if (!outFile) {
      // Done without outputs: the reply that names them never came.
      pushLog('The run finished, but the app did not learn where it wrote its outputs; open them with Open a tags TSV….')
      return
    }
    setResults((r) => ({ path: outFile, gen: (r?.gen ?? 0) + 1, input: inFile }))
    setBatchMiss(null)
    let switched = false
    if (speciesOn && outputs.species_out) {
      // An unreadable species report must not also cost the Digest reports.
      try {
        const sp = await window.fastag.species(outputs.species_out)
        setSpecies(sp)
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
    setReports({ list: rep.reports, errors: rep.errors })
    if (!switched && (rep.reports.length || rep.errors.length)) setTab('digest')
  }

  // The message above the tabs when a run failed: the CLI's exit status and
  // its last error line, which may have scrolled out of the log.
  const failureWhy = (): string | null => lastError.current ?? lastLine.current
  const failureReason = (r: RunResult): string => {
    const why = failureWhy()
    return `${failText(r)}${why ? `: ${why}` : ''}`
  }
  const failed = (r: RunResult, what: string): void => {
    const why = failureWhy()
    setFailure({ title: `${what} failed (${failText(r)})`, reasons: why ? [{ text: why }] : [], command: command.current })
  }

  // run()/runBatch() are onClick-driven: nothing awaits them, so a rejecting
  // preview/species inside showResults would surface as an unhandled rejection.
  // Log it instead; the run itself already settled.
  const logResultsError = (err: unknown): void =>
    pushLog(`Could not show the results: ${err instanceof Error ? err.message : String(err)}`)

  async function run(): Promise<void> {
    if (!input || !out || checking.current) return
    checking.current = true
    let existing: string[]
    try {
      existing = await existingOutputs([runParams(input, out)])
    } finally {
      checking.current = false
    }
    const overwrite = existing.length > 0
    if (overwrite && !(await askOverwrite(existing))) return
    window.fastag.saveLast(values)
    view.setLogJob(null)
    const r = await runOne(input, out, undefined, overwrite)
    setLastRun({
      input,
      ok: r.ok,
      cancelled: isCancelled(r),
      at: Date.now(),
      ms: Date.now() - startedAt.current,
      changed: changedParams,
      cleaned: r.cleanup?.removed.length ?? 0,
      out: r.outputs?.out ?? undefined
    })
    if (r.ok) await showResults(input, r.outputs ?? noOutputs).catch(logResultsError)
    else if (!isCancelled(r)) failed(r, baseName(input))
  }

  async function runBatch(only?: BatchJob['status']): Promise<void> {
    if (jobs.length === 0 || batchRunning || running || blocked) return
    window.fastag.saveLast(values)
    view.setLogJob(null)
    setBatchRunning(true)
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
    batchCancel.current = false
    try {
      // One question for the whole batch, before its first job.
      const existing = await existingOutputs(queue.map((j) => runParams(j.input, j.out, perJobOutputs(values, j.out))))
      const overwrite = existing.length > 0
      if (overwrite && !(await askOverwrite(existing))) return
      for (let i = 0; i < queue.length; i++) {
        if (batchCancel.current) break
        const job = queue[i]
        setJobs((js) => js.map((j) => (j.input === job.input ? { ...j, status: 'running', reason: undefined } : j)))
        const outputs = perJobOutputs(values, job.out)
        const r = await runOne(job.input, job.out, outputs, overwrite)
        const status: BatchJob['status'] = r.ok ? 'done' : isCancelled(r) ? 'cancelled' : 'failed'
        const reason = status === 'failed' ? failureReason(r) : undefined
        const ms = Date.now() - startedAt.current
        // The live log holds this job's lines (and its done line) until the
        // next job clears it: keep a copy with the job.
        const jobLog = liveLog.current
        const cleaned = r.cleanup?.removed.length ?? 0
        setJobs((js) =>
          js.map((j) =>
            j.input === job.input ? { ...j, status, reason, ms, outputs: r.ok ? r.outputs : undefined, log: jobLog, cleaned } : j
          )
        )
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
          await showResults(job.input, r.outputs ?? noOutputs).catch(logResultsError)
      }
      // The pane must not keep an older table as if it were this batch's:
      // name the job without tags, and a done one to select instead.
      if (lastRunJob && !lastRunJob.ok) {
        // A job done in an earlier pass of this queue counts too.
        const done = lastDone ?? [...jobs].reverse().find((j) => j.status === 'done')?.input
        setBatchMiss({ input: failedInputs[0] ?? lastRunJob.input, done })
        setTab('results')
      }
      // A job that failed before the user cancelled the rest still failed.
      if (failures.length > 0)
        setFailure({
          title: `${failures.length} of ${queue.length} batch jobs failed`,
          reasons: failures,
          command: failedCommand,
          logOf: failures[0].input
        })
    } finally {
      setBatchRunning(false)
      batchCancel.current = false
    }
  }

  async function openResults(): Promise<void> {
    const p = await window.fastag.pickResults()
    if (p) {
      // A file whose run the record marks cancelled or failed (its cleanup
      // could not remove it) is not opened as a complete table.
      const rec = await window.fastag.historyOf(p).catch(() => null)
      const recorded = rec && rec.status !== 'ok' ? { status: rec.status, end: rec.end } : undefined
      setResults((r) => ({ path: p, gen: (r?.gen ?? 0) + 1, ...(recorded ? { stale: true, incomplete: true, recorded } : {}) }))
      setBatchMiss(null)
    }
  }

  // A done batch job's tags and reports, as the batch writes them.
  function showJob(j: BatchJob): void {
    if (!j.outputs) return
    setTab('results')
    showResults(j.input, j.outputs).catch(logResultsError)
  }

  // Add one report to those shown, replacing one of the same kind. A report
  // of another run replaces all of them: one run's call next to another
  // run's labels would read as one result.
  async function openReport(): Promise<void> {
    const p = await window.fastag.pickReport()
    if (!p) return
    const rep = await loadReports([p])
    if (rep.reports.length === 0 && rep.errors.length === 0) rep.errors.push(`${p} does not exist.`)
    setReports((cur) => {
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
    })
    setTab('digest')
  }

  function cancelRun(): void {
    if (!running || cancelling) return
    cancelled.current = true
    currentJob.current?.dispatch({ type: 'CANCEL_REQUESTED' })
    if (batchRunning) batchCancel.current = true
    setCancelling(true)
    window.fastag.cancel()
  }

  // "Cancel run and quit" in the close guard: the backend kills the run; the
  // queue starts nothing after it.
  function cancelForQuit(): void {
    cancelled.current = true
    batchCancel.current = true
    currentJob.current?.dispatch({ type: 'CANCEL_REQUESTED' })
  }

  // Reveal the last run's -out in the file manager, or open its folder. The
  // backend refuses any path that is not an output of a run of this app.
  async function reveal(folder: boolean): Promise<void> {
    if (!lastRun?.ok || !lastRun.out) return
    setRevealErr(null)
    try {
      await window.fastag.revealOutput(lastRun.out, folder)
    } catch (err) {
      setRevealErr(err instanceof Error ? err.message : String(err))
    }
  }

  return {
    running,
    batchRunning,
    busy: running || batchRunning,
    cancelling,
    progress,
    phase,
    log,
    announce,
    startedAt: startedAt.current,
    evidence,
    jobs,
    setJobs,
    addBatchFiles,
    // Failed jobs are Retry failed's, not the remaining ones.
    remaining: jobs.filter((j) => j.status !== 'done' && j.status !== 'failed').length,
    failedJobs: jobs.filter((j) => j.status === 'failed').length,
    results,
    setResults,
    batchMiss,
    species,
    speciesRun,
    reports,
    failure,
    setFailure,
    copied,
    setCopied,
    lastRun,
    revealErr,
    overwriteAsk,
    setOverwriteAsk,
    run,
    runBatch,
    cancelRun,
    cancelForQuit,
    showJob,
    openResults,
    openReport,
    reveal
  }
}

export type RunState = ReturnType<typeof useRun>
