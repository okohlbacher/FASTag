import { useEffect, useRef, useState, type JSX } from 'react'
import type { BinaryInfo, RunResult, SpeciesReport } from './types'
import {
  SECTIONS,
  PARAM_BY_NAME,
  RENDERED,
  inertBecause,
  isActive,
  unknownParams,
  unplacedParams,
  type ParamSpec
} from './paramLayout'
import ParamField, { type ParamValue } from './ParamField'
import ResultsTable from './ResultsTable'
import SpeciesPanel from './SpeciesPanel'
import DigestPanel from './DigestPanel'
import { parseReport, type Report } from './digestReport'
import logo from './assets/logo.svg'
import openmsLogo from './assets/openms-logo.png'

// Strip the final extension only when the dot sits inside the basename — a
// dotted directory (`/runs.2026/sample`) must not lose half its path. Mirrors
// the CLI's guard so the GUI reads exactly where the CLI writes.
function stripExt(p: string): string {
  const dot = p.lastIndexOf('.')
  const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return dot > slash ? p.slice(0, dot) : p
}

// Where -species writes when -species_out is not given: <out> minus its final
// extension, plus .species.tsv.
function defaultSpeciesOut(out: string): string {
  return `${stripExt(out)}.species.tsv`
}

// The 1.8.0 reports the Digest tab shows.
const REPORT_PARAMS = ['digest_out', 'label_out', 'massgap_out']

// A batch must not write every job's extra outputs to one configured path, or
// each job overwrites the last. Each configured output-file option gets a
// per-job path from the (unique) tags output, keeping the configured
// extension: <stem>.<option without _out>.<ext>, e.g. a.glyco.tsv, and
// a.spectra.mzpeak for out_spectra. species_out is blanked instead, so the CLI
// derives its own per-input default.
export function perJobOutputs(values: Record<string, unknown>, tagsOut: string): Record<string, ParamValue> {
  const stem = tagsOut.endsWith('.tags.tsv') ? tagsOut.slice(0, -'.tags.tsv'.length) : stripExt(tagsOut)
  const o: Record<string, ParamValue> = { species_out: '' }
  for (const name of RENDERED) {
    if (name === 'species_out' || PARAM_BY_NAME.get(name)?.type !== 'output-file') continue
    const cfg = String(values[name] || '')
    if (!cfg) continue
    const ext = cfg.slice(stripExt(cfg).length) || (name === 'out_spectra' ? '.mzML' : '.tsv')
    o[name] = `${stem}.${name.replace(/_out$/, '').replace(/^out_/, '')}${ext}`
  }
  return o
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

interface Job {
  input: string
  out: string
  status: 'queued' | 'running' | 'done' | 'failed'
  tags?: number
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
  // and the frontend view/scroll state must reset with it.
  const [results, setResults] = useState<{ path: string; gen: number } | null>(null)
  const [species, setSpecies] = useState<SpeciesReport | null>(null)
  const [tab, setTab] = useState<'results' | 'species' | 'digest'>('results')
  const [reports, setReports] = useState<{ list: Report[]; errors: string[] }>({ list: [], errors: [] })
  // Why the last run failed, shown above the result tabs (which still hold the
  // previous run's results).
  const [failure, setFailure] = useState<string | null>(null)
  const lastError = useRef<string | null>(null)
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

  const speciesOn = values['species'] === true
  // k comes from the index header, not an assumption: a differently-built index
  // would make a hardcoded 7 quietly wrong. The CLI warns too, but only after a
  // run has spent seconds and ~2 GB to produce an empty table.
  // tag_lengths, when set, replaces tag_length; its longest seed decides.
  const seeds = (Array.isArray(values['tag_lengths']) ? values['tag_lengths'] : []).map(Number).filter((n) => n > 0)
  const seed = seeds.length ? Math.max(...seeds) : Number(values['tag_length'] || 0)
  const reach = seed + 2 * Number(values['extension'] || 0)
  const tooShort =
    speciesOn && taxdbK != null && reach < taxdbK
      ? { reach, k: taxdbK, option: seeds.length ? 'tag lengths' : 'tag length' }
      : null

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
      setLog((l) => [...l, line])
      if (/\b(error|exception|fatal)\b/i.test(line)) lastError.current = line
      // "Species: N spectra contributed taxon evidence; ..."
      const sp = /^Species:\s+(\d+) spectra contributed/.exec(line)
      if (sp) setEvidence((e) => ({ ...e, contributed: Number(sp[1]) }))
      // "42092 MS2 spectra, 1130228 tags"
      const ms2 = /^(\d+) MS2 spectra,/.exec(line)
      if (ms2) setEvidence((e) => ({ ...e, ms2: Number(ms2[1]) }))
    })
    const offProgress = window.fastag.onProgress((p) => setProgress(p))
    const offDone = window.fastag.onDone((r: RunResult) => {
      // A terminal event that names no run, or one whose run already settled
      // (a duplicate), correlates to nothing we await: drop it before it can
      // touch the log or a later job's state.
      const id = r.runId
      if (id == null || settled.current.has(id)) return
      setProgress(null)
      setLog((l) => [...l, r.ok ? '— done —' : `— failed (${failText(r)}) —`])
      // Hand the result to the awaiter for THIS run id; an event that beats
      // the invoke reply parks in earlyDone until runOne claims it.
      const resolve = pending.current.get(id)
      pending.current.delete(id)
      if (resolve) {
        settled.current.add(id)
        resolve(r)
      } else {
        earlyDone.current.set(id, r)
      }
      if (pending.current.size === 0) setRunning(false)
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

  const setValue = (name: string, v: ParamValue): void => setValues((s) => ({ ...s, [name]: v }))

  async function pickInput(): Promise<void> {
    const p = await window.fastag.pickInput()
    if (p) {
      setInput(p)
      setOut(defaultOut(p))
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
    const p =
      spec.type === 'output-file'
        ? await window.fastag.pickOutput(String(values[spec.name] || ''))
        : await window.fastag.pickInput()
    if (p) setValue(spec.name, p)
  }

  // Only the parameters the UI renders. The form seeds a value for every manifest
  // entry, but HIDDEN ones must never reach the command line: `-version` is
  // recorded in the INI yet rejected as an option, so sending the whole record
  // aborts the run with "Unknown option(s) '[-version]'".
  const submittedParams = (): Record<string, ParamValue> =>
    Object.fromEntries(RENDERED.map((name) => [name, values[name]]))

  // Run one file and resolve when it finishes. Shared by single and batch runs.
  function runOne(inFile: string, outFile: string, overrides?: Record<string, ParamValue>): Promise<RunResult> {
    return new Promise<RunResult>((resolve) => {
      setLog([])
      setProgress(null)
      setEvidence({ contributed: null, ms2: null }) // don't carry a prior run's counts
      setReports({ list: [], errors: [] })
      setTab((t) => (t === 'digest' ? 'results' : t))
      setFailure(null)
      lastError.current = null
      cancelled.current = false
      setRunning(true)
      const settle = (r: RunResult): void => {
        if (pending.current.size === 0) setRunning(false)
        resolve(r)
      }
      window.fastag
        .run({ in: inFile, out: outFile, params: { ...submittedParams(), ...overrides } })
        .then((res) => {
          // Register the awaiter only once the backend hands back the run
          // id; the terminal event carries the same id (see onDone).
          if (res.started && res.runId != null) {
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
            setLog([`could not start: ${res.reason ?? 'unknown'}`])
            settle({ ok: false, code: null, message: res.reason })
          }
        })
        .catch((err) => {
          // A rejected invoke would otherwise leave running=true forever.
          setLog([`could not start: ${err instanceof Error ? err.message : String(err)}`])
          settle({ ok: false, code: null, message: String(err) })
        })
    })
  }

  async function showResults(outFile: string, overrides: Record<string, ParamValue> = {}): Promise<void> {
    setResults((r) => ({ path: outFile, gen: (r?.gen ?? 0) + 1 }))
    const path = (name: string): string => String(overrides[name] ?? values[name] ?? '')
    let switched = false
    if (speciesOn) {
      const sp = await window.fastag.species(path('species_out') || defaultSpeciesOut(outFile))
      setSpecies(sp)
      if (sp && !sp.empty) {
        setTab('species')
        switched = true
      }
    }
    const rep = await loadReports(REPORT_PARAMS.map(path).filter((p) => p !== ''))
    setReports({ list: rep.reports, errors: rep.errors })
    if (!switched && (rep.reports.length || rep.errors.length)) setTab('digest')
  }

  // The message above the tabs when a run failed: the CLI's exit status and
  // its last error line, which may have scrolled out of the log.
  const failed = (r: RunResult, what: string): void =>
    setFailure(`${what} failed (${failText(r)})${lastError.current ? `: ${lastError.current}` : ''}`)

  // run()/runBatch() are onClick-driven: nothing awaits them, so a rejecting
  // preview/species inside showResults would surface as an unhandled rejection.
  // Log it instead; the run itself already settled.
  const logResultsError = (err: unknown): void =>
    setLog((l) => [...l, `results: ${err instanceof Error ? err.message : String(err)}`])

  async function run(): Promise<void> {
    if (!input || !out) return
    window.fastag.saveLast(values)
    const r = await runOne(input, out)
    if (r.ok) await showResults(out).catch(logResultsError)
    else if (!cancelled.current) failed(r, 'The run')
  }

  async function runBatch(): Promise<void> {
    if (jobs.length === 0 || batchRunning || running) return
    window.fastag.saveLast(values)
    setBatchRunning(true)
    // Snapshot the queue we're running and key status updates by input path (the
    // queue is dedup'd on input). A thrown preview/species must still release the
    // batch controls -- hence finally -- or Run stays disabled forever.
    const queue = jobs.filter((j) => j.status !== 'done')
    let nFailed = 0
    batchCancel.current = false
    try {
      for (let i = 0; i < queue.length; i++) {
        if (batchCancel.current) break
        const job = queue[i]
        setJobs((js) => js.map((j) => (j.input === job.input ? { ...j, status: 'running' } : j)))
        const outputs = perJobOutputs(values, job.out)
        const r = await runOne(job.input, job.out, outputs)
        setJobs((js) => js.map((j) => (j.input === job.input ? { ...j, status: r.ok ? 'done' : 'failed' } : j)))
        if (!r.ok) nFailed++
        if (batchCancel.current) break
        if (r.ok && i === queue.length - 1)
          // preview the last
          await showResults(job.out, { ...outputs, species_out: defaultSpeciesOut(job.out) }).catch(logResultsError)
      }
      if (nFailed > 0 && !batchCancel.current)
        setFailure(`${nFailed} of ${queue.length} batch jobs failed; the queue marks them with ✕.`)
    } finally {
      setBatchRunning(false)
      batchCancel.current = false
    }
  }

  async function openResults(): Promise<void> {
    const p = await window.fastag.pickResults()
    if (p) setResults((r) => ({ path: p, gen: (r?.gen ?? 0) + 1 }))
  }

  // Add one report to those shown, replacing one of the same kind.
  async function openReport(): Promise<void> {
    const p = await window.fastag.pickReport()
    if (!p) return
    const rep = await loadReports([p])
    if (rep.reports.length === 0 && rep.errors.length === 0) rep.errors.push(`${p} does not exist.`)
    setReports((cur) => ({
      list: [...cur.list.filter((r) => !rep.reports.some((n) => n.kind === r.kind)), ...rep.reports],
      errors: rep.errors
    }))
    setTab('digest')
  }

  async function applyPreset(name: string): Promise<void> {
    setPreset(name)
    if (!name) return
    const st = await window.fastag.loadSettings()
    const pv = st.presets[name]
    if (pv) setValues((v) => ({ ...v, ...(pv as Record<string, ParamValue>) }))
  }
  async function commitPreset(): Promise<void> {
    const name = (savingName ?? '').trim()
    if (!name) { setSavingName(null); return }
    await window.fastag.savePreset(name, values)
    const st = await window.fastag.loadSettings()
    setPresets(Object.keys(st.presets).sort())
    setPreset(name)
    setSavingName(null)
  }
  async function removePreset(): Promise<void> {
    if (!preset) return
    await window.fastag.deletePreset(preset)
    const st = await window.fastag.loadSettings()
    setPresets(Object.keys(st.presets).sort())
    setPreset('')
  }

  const canRun = bin?.ok && !!input && !!out && !running && !batchRunning
  const field = (name: string): JSX.Element | null => {
    const spec = PARAM_BY_NAME.get(name)
    if (!spec) return null
    return (
      <ParamField
        key={name}
        spec={spec}
        value={values[name]}
        inert={inertBecause(name, values)}
        onChange={(v) => setValue(name, v)}
        onPickFile={pickFor}
      />
    )
  }

  return (
    <div className="app">
      <header>
        <img className="logo" src={logo} alt="" width={26} height={26} />
        <h1>FASTag</h1>
        {bin && (
          <span className={`badge ${bin.ok ? 'ok' : 'bad'}`} title={bin.bin}>
            {bin.ok ? bin.detail : `binary not runnable: ${bin.detail}`}
          </span>
        )}
        <span className="spacer" />
        <span className="openms" title="FASTag is an OpenMS TOPP tool — openms.de">
          built on
          <img src={openmsLogo} alt="OpenMS" />
        </span>
      </header>

      <main>
        <section className="controls">
          <div className="field">
            <label>Input spectra (mzML / mzPeak)</label>
            <div className="row tight">
              <button className="secondary" onClick={pickInput}>
                Choose file…
              </button>
              <button className="secondary" onClick={addBatchFiles} disabled={batchRunning || running} title="Queue several files to run in turn">
                Add batch…
              </button>
            </div>
            {input && jobs.length === 0 && <div className="path">{input}</div>}
          </div>

          {jobs.length > 0 && (
            <div className="field batch">
              <label>
                Batch queue
                <span className="count">
                  {jobs.filter((j) => j.status === 'done').length}/{jobs.length} done
                </span>
              </label>
              <ul className="jobs">
                {jobs.map((j, i) => (
                  <li key={j.input} className={`job ${j.status}`}>
                    <span className="st" aria-hidden>
                      {j.status === 'done' ? '✓' : j.status === 'failed' ? '✕' : j.status === 'running' ? '⟳' : '·'}
                    </span>
                    <span className="jn" title={j.input}>{j.input.split('/').pop()}</span>
                    {!batchRunning && (
                      <button className="rm" title="remove" aria-label={`Remove ${j.input}`} onClick={() => setJobs((js) => js.filter((_, k) => k !== i))}>
                        ×
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <div className="row tight">
                <button onClick={runBatch} disabled={batchRunning || running || !bin?.ok}>
                  {batchRunning ? 'Running batch…' : `Run batch (${jobs.filter((j) => j.status !== 'done').length})`}
                </button>
                <button className="secondary slim" onClick={() => setJobs([])} disabled={batchRunning}>
                  Clear
                </button>
              </div>
            </div>
          )}

          {jobs.length === 0 && (
            <div className="field">
              <label htmlFor="out">Output tags (TSV)</label>
              <input id="out" value={out} onChange={(e) => setOut(e.target.value)} placeholder="tags.tsv" />
            </div>
          )}

          <div className="sep" />

          <div className="presets">
            {savingName === null ? (
              <>
                <select
                  value={preset}
                  onChange={(e) => applyPreset(e.target.value)}
                  title="Load a saved preset"
                  aria-label="Preset"
                >
                  <option value="">Presets…</option>
                  {presets.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                <button className="secondary slim" onClick={() => setSavingName(preset || '')}>Save as…</button>
                <button className="secondary slim" onClick={removePreset} disabled={!preset}>Delete</button>
              </>
            ) : (
              <>
                <input
                  autoFocus
                  value={savingName}
                  placeholder="preset name"
                  aria-label="Preset name"
                  onChange={(e) => setSavingName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitPreset(); if (e.key === 'Escape') setSavingName(null) }}
                />
                <button className="slim" onClick={commitPreset}>Save</button>
                <button className="secondary slim" onClick={() => setSavingName(null)}>Cancel</button>
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
            return (
              <section className={`sec${open ? ' open' : ''}`} key={sec.title}>
                <button
                  className="disclosure"
                  onClick={() => setOpenGroups((st) => ({ ...st, [sec.title]: !open }))}
                  aria-expanded={open}
                >
                  <span className={`chev ${open ? 'open' : ''}`}>▸</span>
                  {sec.title}
                  {on && <span className="on-dot" title={`${sec.master} is set`} />}
                  <span className="count">{sec.params.length}</span>
                </button>
                {open && (
                  <div className="sec-body">
                    {sec.blurb && <p className="blurb">{sec.blurb}</p>}
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
              {UNPLACED.length > 0 && <>{UNPLACED.length} CLI parameter(s) missing from the UI layout: {UNPLACED.join(', ')}. </>}
              {UNKNOWN.length > 0 && <>{UNKNOWN.length} layout entr(y/ies) name no such parameter: {UNKNOWN.join(', ')}.</>}
            </p>
          )}

          <button className="secondary slim wide" onClick={() => setValues(initialValues())}>
            Reset all to CLI defaults
          </button>

          <div className="row actions">
            <button onClick={run} disabled={!canRun}>
              {running ? 'Running…' : 'Run'}
            </button>
            <button
              className="secondary"
              onClick={() => {
                cancelled.current = true
                if (batchRunning) batchCancel.current = true
                window.fastag.cancel()
              }}
              disabled={!running}
            >
              Cancel
            </button>
          </div>
        </section>

        <section className="results">
          {running && (
            <div className="progress">
              {progress && progress.total > 0 ? (
                <>
                  <div className="bar">
                    <div
                      className="fill"
                      style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                    />
                  </div>
                  <span className="pct">
                    {Math.round((progress.done / progress.total) * 100)}% ·{' '}
                    {progress.done.toLocaleString()}/{progress.total.toLocaleString()} spectra
                  </span>
                </>
              ) : (
                <>
                  <div className="bar indeterminate">
                    <div className="fill" />
                  </div>
                  <span className="pct">
                    {progress ? `${progress.done.toLocaleString()} spectra` : 'starting…'}
                  </span>
                </>
              )}
            </div>
          )}
          <pre className="log" ref={logRef} aria-label="Run log">
            {log.length ? log.join('\n') : 'Log output appears here.'}
          </pre>

          {failure && (
            <div className="failure" role="alert">
              <span>{failure}</span>
              <button className="link" onClick={() => setFailure(null)} aria-label="Dismiss">
                ×
              </button>
            </div>
          )}

          <div className="tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === 'results'}
              className={tab === 'results' ? 'on' : ''}
              onClick={() => setTab('results')}
            >
              Tags
            </button>
            <button
              role="tab"
              aria-selected={tab === 'species'}
              className={tab === 'species' ? 'on' : ''}
              onClick={() => setTab('species')}
            >
              Species
              {species && !species.empty && <span className="count">{species.taxa.length}</span>}
            </button>
            {(reports.list.length > 0 || reports.errors.length > 0 || tab === 'digest') && (
              <button
                role="tab"
                aria-selected={tab === 'digest'}
                className={tab === 'digest' ? 'on' : ''}
                onClick={() => setTab('digest')}
              >
                Digest
                {reports.list.length > 0 && <span className="count">{reports.list.length}</span>}
              </button>
            )}
          </div>

          {tab === 'digest' ? (
            <div className="tablewrap">
              <DigestPanel reports={reports.list} errors={reports.errors} onOpen={openReport} />
            </div>
          ) : tab === 'species' ? (
            <div className="tablewrap">
              <SpeciesPanel
                report={species}
                enabled={speciesOn}
                tooShort={tooShort}
                contributed={evidence.contributed}
                totalMs2={evidence.ms2}
              />
            </div>
          ) : results ? (
            <ResultsTable key={`${results.path}#${results.gen}`} path={results.path} />
          ) : (
            <div className="tablewrap">
              <div className="empty">
                Results appear here after a run, or{' '}
                <button className="link" onClick={openResults}>
                  open an existing tags TSV…
                </button>{' '}
                or a{' '}
                <button className="link" onClick={openReport}>
                  digest, label or mass-gap report…
                </button>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
