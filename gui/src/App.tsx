import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import type { BinaryInfo, RunResult, SpeciesReport } from './types'
import {
  SECTIONS,
  PARAM_BY_NAME,
  RENDERED,
  UNIT_OF,
  UNIT_PARAMS,
  conflicts,
  humanName,
  inertBecause,
  inertDependency,
  invalidParams,
  isActive,
  isChanged,
  speciesReach,
  unknownParams,
  unplacedParams,
  type ParamSpec
} from './paramLayout'
import ParamField, { type ParamValue } from './ParamField'
import ResultsTable from './ResultsTable'
import SpeciesPanel from './SpeciesPanel'
import DigestPanel from './DigestPanel'
import { baseName, parseReport, value, type Report } from './digestReport'
import { IconCheck, IconClose, IconError, IconFile, IconLock, IconWarning, JobIcon, type JobStatus } from './icons'
import HelpView, { slug } from './help/HelpView'
import { HelpButton, HelpLink } from './help/HelpLink'
import { closeHelp, openHelp, useHelp } from './help/link'
import { faqForMessage } from './help/faq'
import logo from './assets/logo.svg'
import openmsLogo from './assets/openms-logo.png'

// The index of the last path separator, '/' or '\\'; -1 if there is none.
const lastSep = (p: string): number => Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))

// Strip the final extension only when the dot sits inside the basename — a
// dotted directory (`/runs.2026/sample`) must not lose half its path. Mirrors
// the CLI's guard so the GUI reads exactly where the CLI writes.
function stripExt(p: string): string {
  const dot = p.lastIndexOf('.')
  const slash = lastSep(p)
  return dot > slash ? p.slice(0, dot) : p
}

// Where -species writes when -species_out is not given: <out> minus its final
// extension, plus .species.tsv.
function defaultSpeciesOut(out: string): string {
  return `${stripExt(out)}.species.tsv`
}

// Where the CLI writes a relative output path: fastag.rs resolves it against
// the folder of an absolute input (the child's working directory), so the
// renderer must read it there too, not relative to its own cwd.
const isAbsolute = (p: string): boolean => /^([/\\]|[A-Za-z]:[/\\])/.test(p)
function resolveBeside(inFile: string, p: string): string {
  if (!p || isAbsolute(p) || !isAbsolute(inFile)) return p
  const slash = lastSep(inFile)
  return `${inFile.slice(0, slash + 1)}${p}`
}

// The report options whose files the Digest tab reads.
const REPORT_PARAMS = ['digest_out', 'label_out', 'massgap_out']

// A batch must not write every job's extra outputs to one configured path, or
// each job overwrites the last. Each configured output-file option gets a
// per-job path from the (unique) tags output, keeping the configured
// extension: <stem>.<option without _out>.<ext>, e.g. a.glyco.tsv, and
// a.spectra.mzpeak for out_spectra. species_out is blanked instead, so the CLI
// derives its own per-input default.
export function perJobOutputs(values: Record<string, unknown>, tagsOut: string): Record<string, ParamValue> {
  return { ...rebaseOutputs(values, tagsOut), species_out: '' }
}

// Each run writes its reports beside its own tags output. The configured
// report paths persist across runs, sessions (lastUsed) and presets, so
// without this step sample B would overwrite sample A's digest/recon/...
// files. Each configured output-file option is moved beside the new tags
// output and keeps its extension: /res/A.digest.tsv -> /d/B.digest.tsv.
// Keeping the configured folder is not enough: /runA/sample.mzML and
// /runB/sample.mzML would both write /res/sample.digest.tsv. Unset options
// stay unset.
export function rebaseOutputs(values: Record<string, unknown>, tagsOut: string): Record<string, ParamValue> {
  const stem = tagsOut.endsWith('.tags.tsv') ? tagsOut.slice(0, -'.tags.tsv'.length) : stripExt(tagsOut)
  const o: Record<string, ParamValue> = {}
  for (const name of RENDERED) {
    if (PARAM_BY_NAME.get(name)?.type !== 'output-file') continue
    const cfg = String(values[name] || '')
    if (!cfg) continue
    const ext = cfg.slice(stripExt(cfg).length) || (name === 'out_spectra' ? '.mzML' : '.tsv')
    o[name] = `${stem}.${name.replace(/_out$/, '').replace(/^out_/, '')}${ext}`
  }
  return o
}

// TOPPBase prints this epilogue on stdout at every exit, after a refusal on
// stderr too (the two pipes are read on separate threads), so it is never the
// reason a run failed.
const EPILOGUE = /^\S+ took .*Peak Memory Usage/
// OpenMS follows a ConversionError with the whole --help; this header starts
// that dump, and nothing in it explains the failure.
const HELP_START = /^FASTag -- /
// "Error:", "ConversionError", "exception", "fatal".
const ERROR_WORD = /(error|exception)\b|\bfatal\b/i

// The log keeps its last MAX_LOG lines: every line re-renders the whole log,
// so an unbounded one makes a chatty run quadratic.
const MAX_LOG = 5000
function appendLog(l: string[], line: string): string[] {
  return l.length < MAX_LOG ? [...l, line] : ['… earlier lines dropped …', ...l.slice(l.length - MAX_LOG + 2), line]
}

// Two runs wrote the same report when the run rows they share agree and the
// files sit in one folder. run.input is only a basename (sample.mzML from two
// folders, or one file run with two tag lengths, would otherwise read as one).
const RUN_KEYS = ['input', 'version', 'fragment_tolerance', 'fragment_tolerance_unit', 'tag_length', 'subsample_fraction', 'subsample_spectra']
function sameRun(a: Report, b: Report): boolean {
  return dirName(a.path) === dirName(b.path) && RUN_KEYS.every((k) => value(a, 'run', k) === value(b, 'run', k))
}

// Read and parse whichever reports exist; a report the run did not write is
// skipped, one that cannot be read or parsed becomes a message.
async function loadReports(paths: string[]): Promise<{ reports: Report[]; errors: string[] }> {
  const reports: Report[] = []
  const errors: string[] = []
  for (const p of paths) {
    try {
      const text = await window.fastag.report(p)
      if (text != null) reports.push(parseReport(text, p))
    } catch (e) {
      errors.push(`Cannot read ${p}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { reports, errors }
}

type Tab = 'results' | 'species' | 'digest'
const TAB_LABEL: Record<Tab, string> = { results: 'Tags', species: 'Species', digest: 'Digest' }

interface Job {
  input: string
  out: string
  status: JobStatus
  tags?: number
  // Why the job failed: the next job clears the log.
  reason?: string
  // How long the job ran, in ms.
  ms?: number
  // The -out the CLI wrote, resolved by the backend (a done job's tags).
  wrote?: string
}

// A run that failed: what failed, and FASTag's own words for why (each failed
// job of a batch has its own), plus the command line to reproduce it.
interface Failure {
  title: string
  reasons: { what?: string; text: string }[]
  command?: string[]
}

// m:ss, or h:mm:ss for a long run.
function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const mm = Math.floor(s / 60)
  const ss = String(s % 60).padStart(2, '0')
  return mm >= 60 ? `${Math.floor(mm / 60)}:${String(mm % 60).padStart(2, '0')}:${ss}` : `${mm}:${ss}`
}
const clock = (t: number): string => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

// The folder part of a path, separator kept.
function dirName(p: string): string {
  return p.slice(0, lastSep(p) + 1)
}

// A command line a POSIX shell reads back as the same argv.
function shellLine(argv: string[]): string {
  return argv.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(' ')
}

// A changed parameter as the command line spells it: a switch is its name.
function cliText(name: string, v: ParamValue): string {
  if (typeof v === 'boolean') return `-${name}`
  const s = Array.isArray(v) ? v.filter((x) => x.trim() !== '').join(' ') : v
  return s === '' ? `-${name} ''` : `-${name} ${s}`
}

function defaultOut(input: string): string {
  return `${stripExt(input)}.tags.tsv`
}

// Initial form state IS the tool's own defaults, straight from the manifest.
function initialValues(): Record<string, ParamValue> {
  const v: Record<string, ParamValue> = {}
  for (const [name, spec] of PARAM_BY_NAME) {
    if (spec.type === 'string-list') v[name] = Array.isArray(spec.default) ? spec.default : []
    else if (spec.type === 'bool') v[name] = spec.default === 'true'
    else v[name] = String(spec.default ?? '')
  }
  return v
}

// A run with no exit code was killed: by Cancel, or by the OS.
function failText(r: RunResult): string {
  return r.message ?? (r.code == null ? 'stopped before it finished' : `exit code ${r.code}`)
}

// A parameter that exists in the CLI but nowhere in the layout would silently
// be unreachable; surface it instead of hiding it.
const UNPLACED = unplacedParams()
const UNKNOWN = unknownParams()

export default function App(): JSX.Element {
  const [bin, setBin] = useState<BinaryInfo | null>(null)
  const [input, setInput] = useState('')
  const [out, setOut] = useState('')
  const [values, setValues] = useState<Record<string, ParamValue>>(initialValues)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SECTIONS.map((s) => [s.title, s.open]))
  )
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [log, setLog] = useState<string[]>([])
  // The tags TSV the browser pane shows. gen forces a fresh ResultsTable when
  // the same path is re-run: the backend cache invalidates on (len, mtime),
  // and the frontend view/scroll state must reset with it. input names the
  // run that wrote it (none for an opened file). stale: a run that writes
  // this path is in flight. The CLI writes <out> in place, so a run that fails
  // or is cancelled can leave it truncated or removed (incomplete).
  const [results, setResults] = useState<{
    path: string
    gen: number
    input?: string
    stale?: boolean
    incomplete?: boolean
  } | null>(null)
  // A batch whose last job wrote no tags: the Tags tab names the job with
  // none, and a done job whose tags can be selected in the batch.
  const [batchMiss, setBatchMiss] = useState<{ input: string; done?: string } | null>(null)
  const [species, setSpecies] = useState<SpeciesReport | null>(null)
  // The run the Species tab describes, as it was submitted: unticking species
  // or lowering tag_length afterwards must not hide (or re-show) its report.
  // null until the first run; the tab then follows the form.
  const [speciesRun, setSpeciesRun] = useState<{ input: string; enabled: boolean } | null>(null)
  const [tab, setTab] = useState<Tab>('results')
  const [reports, setReports] = useState<{ list: Report[]; errors: string[] }>({ list: [], errors: [] })
  // Why the last run failed, shown above the result tabs.
  const [failure, setFailure] = useState<Failure | null>(null)
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null)
  // The log drawer: collapsed to its last line unless opened.
  const [logOpen, setLogOpen] = useState(false)
  // The last run that finished, for the summary over the form, with the
  // parameters it was given that differ from the defaults.
  const [lastRun, setLastRun] = useState<{
    input: string
    ok: boolean
    cancelled: boolean
    at: number
    ms: number
    changed: string[]
  } | null>(null)
  // What a screen reader hears of a run: started, finished, stopped. The log
  // is a live region too, but it is display:none while the drawer is shut.
  const [announce, setAnnounce] = useState('')
  // Re-renders the run bar once a second, so the elapsed time runs on between
  // progress events (loading spectra and building the index print none).
  const [, setTick] = useState(0)
  // Where focus goes when the control that had it disappears.
  const resetRef = useRef<HTMLButtonElement>(null)
  const presetRef = useRef<HTMLSelectElement>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  const addBatchRef = useRef<HTMLButtonElement>(null)
  // Reset… asks before it throws away every parameter.
  const [resetAsk, setResetAsk] = useState(false)
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
  const [taxdbK, setTaxdbK] = useState<number | null>(null)
  const [presets, setPresets] = useState<string[]>([])
  const [preset, setPreset] = useState('')
  const [savingName, setSavingName] = useState<string | null>(null)  // non-null = the 'save as' input is open
  const [jobs, setJobs] = useState<Job[]>([])
  const [batchRunning, setBatchRunning] = useState(false)
  // Awaiter for the run in flight, keyed by the backend's run id. Keying by
  // id (not a single slot) means a duplicated or late terminal event can only
  // ever resolve the run it belongs to -- never the next job's awaiter.
  const pending = useRef(new Map<number, (r: RunResult) => void>())
  // A terminal event can beat the invoke reply: a child that exits at once can
  // emit fastag:done before `run()` resolves with the run id, so onDone would
  // arrive before the resolver is registered. Park such a result here; runOne
  // claims it the moment it learns the id.
  const earlyDone = useRef(new Map<number, RunResult>())
  // Run ids whose result has been delivered. A duplicated or late terminal
  // event for a settled run must be dropped outright -- re-parking it in
  // earlyDone would hand a stale result to a future run() reply.
  const settled = useRef(new Set<number>())
  // Parsed from the CLI's own summary line, so the panel reports what the run
  // actually did rather than a number the GUI guessed.
  const [evidence, setEvidence] = useState<{ contributed: number | null; ms2: number | null }>({
    contributed: null,
    ms2: null
  })
  const logRef = useRef<HTMLPreElement>(null)
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

  const speciesOn = values['species'] === true
  // k comes from the index header, not an assumption: a differently-built index
  // would make a hardcoded 7 quietly wrong. The CLI refuses such a run up front
  // (rc 6); conflicts() below keeps Run disabled for it, and this tells the
  // Species tab why it is empty. The same rule as that conflict.
  const tooShort = speciesReach(values, taxdbK)

  useEffect(() => {
    window.fastag.probe().then(setBin)
    window.fastag.loadSettings().then((st) => {
      setPresets(Object.keys(st.presets).sort())
      // Restore the last session's parameters (but not in/out paths -- those are
      // per-run). Merge over defaults so a new CLI option added since last launch
      // still gets its default rather than undefined.
      if (st.lastUsed) setValues((v) => ({ ...v, ...(st.lastUsed as Record<string, ParamValue>) }))
    })
  }, [])

  // Re-read whenever the user points at a different index.
  const taxdbPath = String(values['taxdb'] || '')
  useEffect(() => {
    window.fastag.taxdbInfo(taxdbPath || undefined).then((i) => setTaxdbK(i ? i.k : null))
  }, [taxdbPath])

  useEffect(() => {
    const offLog = window.fastag.onLog((line) => {
      setLog((l) => appendLog(l, line))
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
    })
    const offProgress = window.fastag.onProgress((p) => setProgress(p))
    const offDone = window.fastag.onDone((r: RunResult) => {
      // A terminal event that names no run, or one whose run already settled
      // (a duplicate), correlates to nothing we await: drop it before it can
      // touch the log or a later job's state.
      const id = r.runId
      if (id == null || settled.current.has(id)) return
      setProgress(null)
      setLog((l) =>
        appendLog(
          l,
          r.ok ? '— done —' : isCancelled(r) ? '— cancelled (stopped before it finished) —' : `— failed (${failText(r)}) —`
        )
      )
      // Hand the result to the awaiter for THIS run id; an event that beats
      // the invoke reply parks in earlyDone until runOne claims it. Only a
      // delivered result ends the run: a parked one must not re-enable Run
      // while runOne still awaits its invoke reply.
      const resolve = pending.current.get(id)
      pending.current.delete(id)
      if (resolve) {
        settled.current.add(id)
        resolve(r)
        if (pending.current.size === 0) setRunning(false)
      } else {
        earlyDone.current.set(id, r)
      }
    })
    return () => {
      offLog()
      offProgress()
      offDone()
    }
  }, [])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log])

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [running])

  // Focus a control once the render that brings it has happened.
  const focusLater = (el: () => HTMLElement | null | undefined): void => {
    setTimeout(() => el()?.focus())
  }

  const setValue = (name: string, v: ParamValue): void => setValues((s) => ({ ...s, [name]: v }))

  async function pickInput(): Promise<void> {
    if (running || batchRunning) return
    const p = await window.fastag.pickInput()
    if (p) {
      setInput(p)
      setOut(defaultOut(p))
      setValues((v) => ({ ...v, ...rebaseOutputs(v, defaultOut(p)) }))
    }
  }

  async function addBatchFiles(): Promise<void> {
    const files = await window.fastag.pickInputs()
    if (!files.length) return
    setJobs((js) => {
      const have = new Set(js.map((j) => j.input))
      const used = new Set(js.map((j) => j.out))
      const add: Job[] = []
      for (const f of files) {
        if (have.has(f)) continue
        have.add(f)
        // sample.mzML and sample.mzpeak both map to sample.tags.tsv — on a
        // collision keep the full input name, then number, so outputs stay
        // distinct even when the fallback collides too.
        let out = defaultOut(f)
        if (used.has(out)) out = `${f}.tags.tsv`
        for (let n = 2; used.has(out); n++) out = `${f}.${n}.tags.tsv`
        used.add(out)
        add.push({ input: f, out, status: 'queued' as const })
      }
      return [...js, ...add]
    })
  }

  async function pickFor(spec: ParamSpec): Promise<void> {
    // Offer the parameter's own formats (FASTA, idXML/mzid/mzTab, TSV, taxdb),
    // not the spectra filter used for inputs or 'Tags (TSV)' for every output.
    const p =
      spec.type === 'output-file'
        ? await window.fastag.saveFile(String(values[spec.name] || ''), spec.formats)
        : await window.fastag.pickFile(spec.formats)
    if (p) setValue(spec.name, p)
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

  // Run one file and resolve when it finishes. Shared by single and batch runs.
  // Resolves with the -out the CLI was given (RunStarted.out), absolute once
  // the backend has resolved a relative Output.
  function runOne(
    inFile: string,
    outFile: string,
    overrides?: Record<string, ParamValue>
  ): Promise<RunResult & { out: string }> {
    let wrote = resolveBeside(inFile, outFile)
    const marked = wrote
    return new Promise<RunResult & { out: string }>((done) => {
      const resolve = (r: RunResult): void => {
        // The CLI writes -out in place: a finished run rewrote it, so the
        // table reads it afresh; a failed or cancelled one may have left it
        // truncated or removed, so the table stays withheld as incomplete.
        setResults((x) =>
          x?.stale && (x.path === marked || x.path === wrote)
            ? r.ok
              ? { ...x, stale: false, incomplete: false, gen: x.gen + 1 }
              : { ...x, incomplete: true }
            : x
        )
        const name = baseName(inFile)
        setAnnounce(
          r.ok
            ? `Finished ${name}${lastTags.current != null ? `: ${lastTags.current.toLocaleString('en-US')} tags` : ''}.`
            : isCancelled(r)
              ? `Cancelled ${name}.`
              : `${name} failed.`
        )
        done({ ...r, out: wrote })
      }
      setLog([])
      setProgress(null)
      setEvidence({ contributed: null, ms2: null }) // don't carry a prior run's counts
      setReports({ list: [], errors: [] })
      // Nor a prior run's species: whatever this run ends as, the old taxa
      // would read as its result.
      setSpecies(null)
      setSpeciesRun({ input: inFile, enabled: speciesOn })
      // The run may replace -out: until it ends, a table of that path may
      // not be what the file will hold.
      setResults((r) => (r && r.path === wrote ? { ...r, stale: true } : r))
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
      const settle = (r: RunResult): void => {
        if (pending.current.size === 0) setRunning(false)
        resolve(r)
      }
      window.fastag
        .run({ in: inFile, out: outFile, params: withoutInert({ ...submittedParams(), ...overrides }) })
        .then((res) => {
          // Register the awaiter only once the backend hands back the run
          // id; the terminal event carries the same id (see onDone).
          if (res.started && res.runId != null) {
            if (res.out) wrote = res.out
            command.current = res.command
            const early = earlyDone.current.get(res.runId)
            if (early) {
              // The terminal event already fired before this reply landed.
              // Consume the parked result and mark the run settled so a
              // duplicate of that event dies in onDone.
              earlyDone.current.delete(res.runId)
              settled.current.add(res.runId)
              settle(early)
            } else {
              pending.current.set(res.runId, resolve)
            }
          } else {
            setLog([`FASTag could not start: ${res.reason ?? 'no reason given'}`])
            settle({ ok: false, code: null, message: res.reason })
          }
        })
        .catch((err) => {
          // A rejected invoke would otherwise leave running=true forever.
          setLog([`FASTag could not start: ${err instanceof Error ? err.message : String(err)}`])
          settle({ ok: false, code: null, message: String(err) })
        })
    })
  }

  async function showResults(inFile: string, outFile: string, overrides: Record<string, ParamValue> = {}): Promise<void> {
    setResults((r) => ({ path: outFile, gen: (r?.gen ?? 0) + 1, input: inFile }))
    setBatchMiss(null)
    const path = (name: string): string => resolveBeside(inFile, String(overrides[name] ?? values[name] ?? ''))
    let switched = false
    if (speciesOn) {
      // An unreadable species report must not also cost the Digest reports.
      try {
        const sp = await window.fastag.species(path('species_out') || defaultSpeciesOut(outFile))
        setSpecies(sp)
        if (sp && sp.taxa.length > 0) {
          setTab('species')
          switched = true
        }
      } catch (err) {
        logResultsError(err)
      }
    }
    // An inert report option was not sent, so its path may hold an old file.
    const sent = REPORT_PARAMS.filter((n) => !inertBecause(n, { ...values, ...overrides }))
    const rep = await loadReports(sent.map(path).filter((p) => p !== ''))
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
    setLog((l) => [...l, `Could not show the results: ${err instanceof Error ? err.message : String(err)}`])

  async function run(): Promise<void> {
    if (!input || !out) return
    window.fastag.saveLast(values)
    const r = await runOne(input, out)
    setLastRun({
      input,
      ok: r.ok,
      cancelled: isCancelled(r),
      at: Date.now(),
      ms: Date.now() - startedAt.current,
      changed: changedParams
    })
    if (r.ok) await showResults(input, r.out).catch(logResultsError)
    else if (!isCancelled(r)) failed(r, baseName(input))
  }

  async function runBatch(only?: Job['status']): Promise<void> {
    if (jobs.length === 0 || batchRunning || running || blocked) return
    window.fastag.saveLast(values)
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
      for (let i = 0; i < queue.length; i++) {
        if (batchCancel.current) break
        const job = queue[i]
        setJobs((js) => js.map((j) => (j.input === job.input ? { ...j, status: 'running', reason: undefined } : j)))
        const outputs = perJobOutputs(values, job.out)
        const r = await runOne(job.input, job.out, outputs)
        const status: Job['status'] = r.ok ? 'done' : isCancelled(r) ? 'cancelled' : 'failed'
        const reason = status === 'failed' ? failureReason(r) : undefined
        const ms = Date.now() - startedAt.current
        setJobs((js) => js.map((j) => (j.input === job.input ? { ...j, status, reason, ms, wrote: r.ok ? r.out : undefined } : j)))
        lastRunJob = { input: job.input, ok: r.ok }
        if (r.ok) lastDone = job.input
        if (status === 'failed') {
          const why = failureWhy()
          failures.push({ what: `${baseName(job.input)} (${failText(r)})`, text: why ?? '' })
          failedInputs.push(job.input)
          failedCommand = failedCommand ?? command.current
        }
        if (batchCancel.current) break
        if (r.ok && i === queue.length - 1)
          // preview the last
          await showResults(job.input, r.out, { ...outputs, species_out: defaultSpeciesOut(r.out) }).catch(logResultsError)
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
        setFailure({ title: `${failures.length} of ${queue.length} batch jobs failed`, reasons: failures, command: failedCommand })
    } finally {
      setBatchRunning(false)
      batchCancel.current = false
    }
  }

  // The tabs, in order. Digest is always there: its empty state is a way to
  // open a report.
  const tabs: Tab[] = ['results', 'species', 'digest']
  // Arrow keys, Home and End move between the tabs (WAI-ARIA tabs pattern).
  function onTabKey(e: KeyboardEvent<HTMLDivElement>): void {
    const i = tabs.indexOf(tab)
    const to =
      e.key === 'ArrowRight' ? (i + 1) % tabs.length
      : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? tabs.length - 1
      : -1
    if (to < 0) return
    e.preventDefault()
    setTab(tabs[to])
    document.getElementById(`tab-${tabs[to]}`)?.focus()
  }

  async function openResults(): Promise<void> {
    const p = await window.fastag.pickResults()
    if (p) {
      setResults((r) => ({ path: p, gen: (r?.gen ?? 0) + 1 }))
      setBatchMiss(null)
    }
  }

  // A done batch job's tags and reports, as the batch writes them.
  function showJob(j: Job): void {
    const wrote = j.wrote ?? resolveBeside(j.input, j.out)
    setTab('results')
    showResults(j.input, wrote, { ...perJobOutputs(values, j.out), species_out: defaultSpeciesOut(wrote) }).catch(logResultsError)
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

  async function applyPreset(name: string): Promise<void> {
    setPreset(name)
    if (!name) return
    const st = await window.fastag.loadSettings()
    const pv = st.presets[name]
    // A preset stores the report paths of the sample it was saved with; put
    // them beside the current tags output, or this run overwrites that
    // sample's reports.
    if (pv)
      setValues((v) => {
        const merged = { ...v, ...(pv as Record<string, ParamValue>) }
        return out ? { ...merged, ...rebaseOutputs(merged, out) } : merged
      })
  }
  async function refreshPresets(): Promise<void> {
    const st = await window.fastag.loadSettings()
    setPresets(Object.keys(st.presets).sort())
  }
  async function commitPreset(): Promise<void> {
    const name = (savingName ?? '').trim()
    if (!name) { cancelPreset(); return }
    await window.fastag.savePreset(name, values)
    await refreshPresets()
    setPreset(name)
    setSavingName(null)
    focusLater(() => presetRef.current)
  }
  function cancelPreset(): void {
    setSavingName(null)
    focusLater(() => presetRef.current)
  }
  async function removePreset(): Promise<void> {
    if (!preset) return
    await window.fastag.deletePreset(preset)
    await refreshPresets()
    setPreset('')
    focusLater(() => presetRef.current)
  }

  // Values the CLI would refuse, field by field, and combinations it refuses
  // before reading a spectrum (rc 6): either keeps Run and Run batch disabled.
  const invalid = invalidParams(values)
  const refused = conflicts(values, { taxdbK })
  const blocked = Object.keys(invalid).length > 0 || refused.length > 0
  // Not behind a batch queue: the single input and output are hidden then.
  const canRun = bin?.ok && !!input && !!out && !running && !batchRunning && jobs.length === 0 && !blocked
  const busy = running || batchRunning
  const field = (name: string): JSX.Element | null => {
    const spec = PARAM_BY_NAME.get(name)
    // A unit is drawn inside the field of its value.
    if (!spec || UNIT_PARAMS.has(name)) return null
    const unitName = UNIT_OF[name]
    const unitSpec = unitName ? PARAM_BY_NAME.get(unitName) : undefined
    return (
      <ParamField
        key={name}
        spec={spec}
        value={values[name]}
        needs={inertDependency(name, values)}
        onChange={(v) => setValue(name, v)}
        onPickFile={pickFor}
        unit={unitSpec && unitName ? { spec: unitSpec, value: values[unitName], onChange: (v) => setValue(unitName, v) } : undefined}
      />
    )
  }

  // What a run writes, by file name: the tags, then each output it is sent.
  // Species and glyco reports go beside <out> when no path is given.
  const writingFiles: string[] = (() => {
    const files = [out]
    if (speciesOn) files.push(String(values['species_out'] || '') || defaultSpeciesOut(out))
    if (values['glyco'] === true) files.push(String(values['glyco_out'] || '') || `${stripExt(out)}.glyco.tsv`)
    for (const name of RENDERED) {
      if (name === 'species_out' || name === 'glyco_out' || PARAM_BY_NAME.get(name)?.type !== 'output-file') continue
      const v = String(values[name] || '')
      if (v && !inertBecause(name, values)) files.push(v)
    }
    return files.filter(Boolean).map(baseName)
  })()
  // The parameters a run sends that differ from the defaults.
  const changedParams = RENDERED.filter((n) => !inertBecause(n, values) && isChanged(n, values[n])).map((n) =>
    cliText(n, values[n])
  )

  const nInvalid = Object.keys(invalid).length
  // Failed jobs are Retry failed's, not the remaining ones.
  const remaining = jobs.filter((j) => j.status !== 'done' && j.status !== 'failed').length
  const failedJobs = jobs.filter((j) => j.status === 'failed').length
  const lastLog = [...log].reverse().find((l) => l.trim() !== '') ?? ''

  const jobWords = (j: Job): string =>
    j.status === 'done'
      ? `Done${j.ms != null ? ` · ${duration(j.ms)}` : ''}`
      : j.status === 'failed'
        ? `Failed: ${j.reason ?? 'no reason given'}`
        : j.status === 'cancelled'
          ? 'Cancelled by you'
          : j.status === 'running'
            ? 'Running…'
            : 'Not run'

  const batchList = (
    <section className="block" aria-labelledby="batch-label">
      <div className="block-head">
        <h2 id="batch-label">
          Batch · {jobs.length} {jobs.length === 1 ? 'file' : 'files'}
        </h2>
        <span className="count">
          {jobs.filter((j) => j.status === 'done').length}/{jobs.length} done
        </span>
        {!busy && (
          <>
            <button className="secondary small" ref={addRef} onClick={addBatchFiles}>
              Add…
            </button>
            <button
              className="secondary small"
              onClick={() => {
                setJobs([])
                focusLater(() => addBatchRef.current)
              }}
            >
              Clear
            </button>
          </>
        )}
      </div>
      {/* Focusable: while a batch runs nothing in it is, and it scrolls. */}
      <ul className="jobs" tabIndex={0} aria-labelledby="batch-label">
        {jobs.map((j, i) => {
          const body = (
            <>
              <span className="jn" title={j.input}>
                {baseName(j.input)}
              </span>
              <span className="js">{jobWords(j)}</span>
            </>
          )
          const shown = j.status === 'done' && results?.input === j.input && results.path === (j.wrote ?? j.out)
          return (
          <li key={j.input} className={`job ${j.status}${shown ? ' shown' : ''}`}>
            <span className="st" role="img" aria-label={j.status} title={j.reason ?? j.status}>
              <JobIcon status={j.status} />
            </span>
            {j.status === 'done' && !busy ? (
              // A done job's tags and reports are one click away.
              <button
                type="button"
                className="jbody pick"
                aria-current={shown || undefined}
                title={`Show the results of ${j.input}`}
                onClick={() => showJob(j)}
              >
                {body}
              </button>
            ) : (
              <span className="jbody">{body}</span>
            )}
            {!busy && (
              <button
                className="rm"
                title="Remove"
                aria-label={`Remove ${j.input}`}
                onClick={() => {
                  setJobs((js) => js.filter((_, k) => k !== i))
                  // The next job's remove button, else the previous one's,
                  // else whichever Add button the form then shows.
                  focusLater(() => {
                    const rms = document.querySelectorAll<HTMLButtonElement>('ul.jobs button.rm')
                    return rms[Math.min(i, rms.length - 1)] ?? addRef.current ?? addBatchRef.current
                  })
                }}
              >
                <IconClose />
              </button>
            )}
          </li>
          )
        })}
      </ul>
      <p className="hint">
        Each file writes its own <code>&lt;name&gt;.tags.tsv</code> and reports next to the input.{' '}
        <HelpLink to="start-batch">About batch runs</HelpLink>
      </p>
    </section>
  )

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : null
  const elapsed = running && startedAt.current ? ` · ${duration(Date.now() - startedAt.current)} elapsed` : ''

  return (
    <div className="app">
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
                  batchList
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
                {lastRun && jobs.length === 0 && (
                  <section className="block last-run" aria-labelledby="last-run-h">
                    <h2 id="last-run-h">Last run</h2>
                    <div className={`last-run-name ${lastRun.ok ? 'ok' : lastRun.cancelled ? 'cancelled' : 'bad'}`}>
                      <JobIcon status={lastRun.ok ? 'done' : lastRun.cancelled ? 'cancelled' : 'failed'} />
                      <span>{baseName(lastRun.input)}</span>
                    </div>
                    <div className="muted">
                      {lastRun.ok ? 'Finished' : lastRun.cancelled ? 'Cancelled' : 'Failed'} {clock(lastRun.at)} · {duration(lastRun.ms)}
                      {lastRun.ok && evidence.ms2 != null && ` · ${evidence.ms2.toLocaleString('en-US')} MS2 spectra`}
                    </div>
                    {/* The form may be edited since: what this run was given. */}
                    <code className="last-run-params">{lastRun.changed.length ? lastRun.changed.join(' ') : 'all defaults'}</code>
                  </section>
                )}

                {jobs.length > 0 ? (
                  batchList
                ) : (
                  <section className="block" aria-labelledby="input-label">
                    <div className="block-head">
                      <h2 id="input-label">Input</h2>
                      <HelpButton to="files-inputs" what="input files" />
                    </div>
                    {input ? (
                      <div className="input-card">
                        <IconFile />
                        <div className="path" title={input}>
                          <span className="fname">{baseName(input)}</span>
                          <span className="dir">{dirName(input)}</span>
                        </div>
                        <button className="secondary" onClick={pickInput}>
                          Change…
                        </button>
                      </div>
                    ) : (
                      <div className="input-card empty-input">
                        <IconFile />
                        <span className="muted">Spectra as mzML, mzPeak or MGF</span>
                        <button className="secondary" onClick={pickInput}>
                          Choose file…
                        </button>
                      </div>
                    )}
                    <button className="link add-batch" ref={addBatchRef} onClick={addBatchFiles} title="Queue several files to run in turn">
                      <span aria-hidden="true">+ </span>Add files for a batch…
                    </button>
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
                      <input id="out" className="path-input" value={out} onChange={(e) => setOut(e.target.value)} placeholder="tags.tsv" />
                      <button
                        className="secondary"
                        aria-label="Browse for the tags TSV"
                        onClick={async () => {
                          const p = await window.fastag.pickOutput(out || undefined)
                          if (p) setOut(p)
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

                <section className="block" aria-labelledby="par-h">
                  <div className="block-head">
                    <h2 id="par-h">Parameters</h2>
                    {savingName === null ? (
                      <>
                        <select
                          className="small"
                          ref={presetRef}
                          value={preset}
                          onChange={(e) => applyPreset(e.target.value)}
                          title="Load a saved preset"
                          aria-label="Preset"
                        >
                          <option value="">No preset</option>
                          {presets.map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                        <button className="secondary small" onClick={() => setSavingName(preset || '')}>Save…</button>
                        <button className="secondary small" onClick={removePreset} disabled={!preset}>Delete</button>
                      </>
                    ) : (
                      <>
                        <input
                          className="small"
                          autoFocus
                          value={savingName}
                          placeholder="preset name"
                          aria-label="Preset name"
                          onChange={(e) => setSavingName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') commitPreset(); if (e.key === 'Escape') cancelPreset() }}
                        />
                        <button className="small" onClick={commitPreset}>Save</button>
                        <button className="secondary small" onClick={cancelPreset}>Cancel</button>
                      </>
                    )}
                  </div>

                  {SECTIONS.map((sec) => {
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
                            {sec.master && field(sec.master)}
                            {sec.master && rest.length > 0 && <div className="sub-rule" />}
                            {rest.map(field)}
                          </div>
                        )}
                      </section>
                    )
                  })}

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
                </section>
              </>
            )}
          </div>

          <div className="runbar">
            {/* Always in the page, so its changes are announced. */}
            <p className="sr-only" role="status">
              {announce}
            </p>
            {running && (
              <div className="progress">
                <div className="progress-text">
                  <span className="what">Tagging spectra</span>
                  <span className="pct">
                    {pct != null && progress
                      ? `${pct}% · ${progress.done.toLocaleString('en-US')} of ${progress.total.toLocaleString('en-US')} spectra${elapsed}`
                      : progress
                        ? `${progress.done.toLocaleString('en-US')} spectra${elapsed}`
                        : `starting…${elapsed}`}
                  </span>
                </div>
                {pct != null && progress ? (
                  <div
                    className="bar"
                    role="progressbar"
                    aria-label="Run progress"
                    aria-valuemin={0}
                    aria-valuemax={progress.total}
                    aria-valuenow={progress.done}
                    aria-valuetext={`${progress.done.toLocaleString('en-US')} of ${progress.total.toLocaleString('en-US')} spectra`}
                  >
                    <div className="fill" style={{ width: `${pct}%` }} />
                  </div>
                ) : (
                  <div
                    className="bar indeterminate"
                    role="progressbar"
                    aria-label="Run progress"
                    aria-valuetext={progress ? `${progress.done.toLocaleString('en-US')} spectra` : 'starting'}
                  >
                    <div className="fill" />
                  </div>
                )}
              </div>
            )}

            {!busy && blocked && (
              <div className="preflight" role="status">
                {nInvalid > 0 && (
                  <p className="warn">
                    <IconError />
                    <span>
                      {nInvalid} {nInvalid === 1 ? 'value' : 'values'} to fix before running:{' '}
                      {Object.entries(invalid).map(([n, why]) => `${humanName(n)} (${why})`).join('; ')}.
                    </span>
                  </p>
                )}
                {refused.map((c) => (
                  <p className="warn" key={c.params.join(',')}>
                    <IconError />
                    <span>{c.note}</span>
                  </p>
                ))}
              </div>
            )}
            {!busy && !blocked && jobs.length === 0 && !input && <p className="hint">Choose an input file to run.</p>}

            {resetAsk && !busy ? (
              <div className="confirm" role="group" aria-label="Reset parameters">
                <span>Reset every parameter to its default?</span>
                <button
                  className="danger"
                  onClick={() => {
                    setValues(initialValues())
                    setResetAsk(false)
                    focusLater(() => resetRef.current)
                  }}
                >
                  Reset
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    setResetAsk(false)
                    focusLater(() => resetRef.current)
                  }}
                  autoFocus
                >
                  Keep
                </button>
              </div>
            ) : (
              <div className="row actions">
                {jobs.length > 0 ? (
                  <>
                    <button className="primary" onClick={() => runBatch()} disabled={batchRunning || running || !bin?.ok || blocked || remaining === 0}>
                      {batchRunning ? 'Running batch…' : `Run ${remaining} remaining ${remaining === 1 ? 'file' : 'files'}`}
                    </button>
                    {!busy && failedJobs > 0 && (
                      <button className="secondary" onClick={() => runBatch('failed')} disabled={!bin?.ok || blocked}>
                        Retry failed
                      </button>
                    )}
                  </>
                ) : (
                  <button className="primary" onClick={run} disabled={!canRun}>
                    {running ? 'Running…' : input ? `Run on ${baseName(input)}` : 'Run'}
                  </button>
                )}
                {busy ? (
                  <button
                    className="secondary"
                    onClick={() => {
                      cancelled.current = true
                      if (batchRunning) batchCancel.current = true
                      setCancelling(true)
                      window.fastag.cancel()
                    }}
                    disabled={!running || cancelling}
                  >
                    Cancel
                  </button>
                ) : (
                  <button className="secondary" ref={resetRef} onClick={() => setResetAsk(true)}>
                    Reset…
                  </button>
                )}
              </div>
            )}
          </div>
        </aside>

        <section className="results" aria-label="Results">
          <div className="tabs">
            <div role="tablist" aria-label="Results" onKeyDown={onTabKey}>
              {tabs.map((t) => (
                <button
                  key={t}
                  id={`tab-${t}`}
                  role="tab"
                  aria-selected={tab === t}
                  aria-controls="tabpanel"
                  tabIndex={tab === t ? 0 : -1}
                  className={tab === t ? 'on' : ''}
                  onClick={() => setTab(t)}
                >
                  {TAB_LABEL[t]}
                  {t === 'species' && species && species.taxa.length > 0 && <span className="count">{species.taxa.length}</span>}
                  {t === 'digest' && reports.list.length > 0 && <span className="count">{reports.list.length}</span>}
                </button>
              ))}
            </div>
            {/* Always reachable, also once a result fills the pane. */}
            {/* Not while a run is writing the files they would open. */}
            <button className="secondary" onClick={openResults} disabled={busy} title="Open an existing tags TSV">
              Open tags…
            </button>
            <button className="secondary" onClick={openReport} disabled={busy} title="Open a digest, label or mass-gap report">
              Open report…
            </button>
          </div>

          {failure && (
            <div className="failure" role="alert">
              <div className="failure-head">
                <IconError size={18} />
                <strong>{failure.title}</strong>
                <button
                  className="icon-btn"
                  onClick={() => {
                    setFailure(null)
                    focusLater(() => document.getElementById(`tab-${tab}`))
                  }}
                  aria-label="Dismiss"
                >
                  <IconClose />
                </button>
              </div>
              {failure.reasons.length === 0 && <HelpLink to="faq-run-failed">What to do</HelpLink>}
              {failure.reasons.map((r, i) => (
                <div className="failure-reason" key={i}>
                  {r.what && <div className="what">{r.what}</div>}
                  {r.text && (
                    <>
                      <div className="why-label">FASTag&apos;s reason:</div>
                      <code className="why">{r.text}</code>
                    </>
                  )}
                  <HelpLink to={faqForMessage(r.text)}>What to do</HelpLink>
                </div>
              ))}
              <div className="failure-actions">
                <button
                  className="secondary"
                  onClick={() => {
                    setLogOpen(true)
                    focusLater(() => logRef.current)
                  }}
                >
                  Show full log
                </button>
                {failure.command && (
                  <button
                    className="secondary"
                    onClick={() =>
                      navigator.clipboard
                        .writeText(shellLine(failure.command!))
                        .then(() => setCopied('yes'), () => setCopied('no'))
                    }
                  >
                    {copied === 'yes' ? 'Copied' : 'Copy command'}
                  </button>
                )}
                {copied === 'no' && <span className="muted">The clipboard refused the command.</span>}
              </div>
            </div>
          )}

          <div className="tabpanel" id="tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
            {tab === 'digest' ? (
              <div className="tablewrap">
                <DigestPanel reports={reports.list} errors={reports.errors} onOpen={openReport} />
              </div>
            ) : tab === 'species' ? (
              <div className="tablewrap">
                {speciesRun?.enabled && (
                  <p className="src" title={species?.path}>
                    Species of <span className="mono">{speciesRun.input}</span>
                  </p>
                )}
                <SpeciesPanel
                  report={species}
                  enabled={speciesRun ? speciesRun.enabled : speciesOn}
                  formOn={!!speciesRun && !speciesRun.enabled && speciesOn}
                  runInput={speciesRun?.input}
                  // A run that started passed the reach check, so it was never too short.
                  tooShort={speciesRun ? null : tooShort}
                  contributed={evidence.contributed}
                  totalMs2={evidence.ms2}
                />
              </div>
            ) : batchMiss ? (
              <div className="tablewrap">
                <div className="empty-state">
                  <h2>No tags for {baseName(batchMiss.input)}</h2>
                  <p>
                    {batchMiss.done
                      ? <>Select {baseName(batchMiss.done)} in the batch to see its results.</>
                      : 'No job of this batch finished.'}
                  </p>
                  <p>
                    <HelpLink to="faq-no-tags">Why a run writes no tags</HelpLink>
                  </p>
                </div>
              </div>
            ) : results?.stale && (running || results.incomplete) ? (
              <div className="tablewrap">
                {/* Not the old rows while a run rewrites the file in place, nor
                    after it stopped part-way: the file may be truncated. */}
                <div className="banner warn" role="status">
                  <IconWarning />
                  {running ? (
                    <span>
                      <strong>Outdated.</strong> This run is rewriting <code>{results.path}</code>; its tags appear
                      here when it finishes.
                    </span>
                  ) : (
                    <span>
                      <strong>Incomplete.</strong> The run stopped while rewriting <code>{results.path}</code>, so the
                      file may hold only part of a table or none.{' '}
                      <button
                        type="button"
                        className="link"
                        onClick={() =>
                          setResults((x) => (x ? { ...x, stale: false, incomplete: false, gen: x.gen + 1 } : x))
                        }
                      >
                        Open it anyway
                      </button>{' '}
                      <HelpButton to="faq-incomplete" what="an incomplete tags file" />
                    </span>
                  )}
                </div>
              </div>
            ) : results ? (
              <ResultsTable
                key={`${results.path}#${results.gen}`}
                path={results.path}
                source={results.input ? `from the run of ${results.input}` : 'opened from disk'}
              />
            ) : (
              <div className="tablewrap">
                <div className="empty-state">
                  <h2>No results yet</h2>
                  <p>
                    Run FASTag on the chosen file, or open a tags TSV or a digest, label or mass-gap report from an
                    earlier run.
                  </p>
                  <p>
                    New to FASTag? <HelpLink to="start">Read Getting started</HelpLink> (F1 opens Help at any time).
                  </p>
                  <div className="row-actions">
                    <button className="secondary big" onClick={openResults}>
                      Open a tags TSV…
                    </button>
                    <button className="secondary big" onClick={openReport}>
                      Open a digest, label or mass-gap report…
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <section className={`logdrawer${logOpen ? ' open' : ''}`} aria-label="Run log">
            <button className="drawer-toggle" aria-expanded={logOpen} aria-controls="runlog" onClick={() => setLogOpen((o) => !o)}>
              <span className={`chev ${logOpen ? 'open' : ''}`} aria-hidden="true">▸</span>
              <span className="lbl">Log</span>
              <code className="last">{lastLog || 'Log output appears here.'}</code>
              <span className="n">
                {log.length} {log.length === 1 ? 'line' : 'lines'}
              </span>
            </button>
            {/* role=log is a polite live region while the drawer is open; a
                collapsed one is display:none and announces nothing, so the
                run bar's status says when a run starts and ends. Focusable,
                so the keyboard can scroll it. */}
            <pre id="runlog" className="log" ref={logRef} role="log" aria-label="Run log" tabIndex={0} hidden={!logOpen}>
              {log.length ? log.join('\n') : 'Log output appears here.'}
            </pre>
          </section>
        </section>
      </div>
    </div>
  )
}
