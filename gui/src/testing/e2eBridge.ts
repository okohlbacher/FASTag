// The window.fastag bridge of the Playwright e2e build (`vite build --mode
// e2e`, GUI-DESIGN section 9). main.tsx loads it only when __E2E__ is true,
// so a normal `vite build` tree-shakes it out (scripts/check-dist-clean.mjs
// checks the release dist/ for its strings).
//
// The page picks a scenario with ?fixture=<name>. Every scenario plays a
// simulated CLI over the test mock: each run streams log lines and progress
// and then ends. The tags table is the real FASTag 1.11.0 output for the
// public E. coli fixture (test/fixtures/Ecoli_MS2_small.mzML, see
// e2e-web/fixtures/README.md); the reports are src/fixtures.
//
//   default     single runs succeed (run01.mzML)
//   batch-fail  a three-file batch where run02 fails, run01 and run03 finish
//   big         the tags table has 10,000,000 rows (served page by page)
//   slow        a run goes on until it is cancelled (close guard, busy state)
//   lastused    the last session ran with -tag_length 7 -species
//   existing    run01.tags.tsv exists, and the run record says the run of
//               the last session that wrote it was cancelled
//   rank        D5: the E-value order of the tags is "being built" until a
//               spec calls finishRanking(); until then a query sorted by
//               E-value is served in file order (ranked: false), as
//               browser.rs does
//   gate, gate-1.11, gate-da, gate-call
//               P2b Overview: a run prints the real log of FASTag on a gate
//               PXD and its reports and species report are the real ones
//               (src/fixtures/cli, testing/cliFixtures.ts): integration/1.12
//               on PXD003531, 1.11.0 on it (the 1.12 output absent), 1.12 on
//               the Da run PXD010783, and 1.12 with -species_call decoy
//   gate-batch  P2b Batch summary: Add folder… on /data lists eight spectra
//               files, one per job of a real batch (src/fixtures/cli/batch,
//               testing/batchFixtures.ts): each prints that job's log and
//               serves its reports; /data/pxd006096-dia.mzML is refused
//               with exit 11 (raw DIA, E7). Choose output folder… picks /out.
//   iontrap-probe  P2b: the CLI has -probe_input, and run01.mzML probes as
//               the ion-trap gate input (src/fixtures/probe/iontrap)
//   dia-probe   P2b: the CLI has -probe_input, and run01.mzML probes as
//               raw DIA (src/fixtures/probe/dia_raw)
//   orbitrap-probe  P2b: the CLI has -probe_input, and run01.mzML probes
//               as the Orbitrap HCD gate input (its index stale, as FASTag
//               1.12 reports it; src/fixtures/probe/orbitrap)
//   iontrap     P2b: a CLI without the probe; a run of run01.mzML prints
//               the real FASTag 1.12 log of the ion-trap gate input at
//               20 ppm and writes its digest and label reports
//               (src/fixtures/cli-1.12/iontrap_20ppm.*)
//   dia-refusal P2b: a run prints FASTag 1.12's real raw-DIA refusal and
//               exits 11 (src/fixtures/cli-1.12/dia_raw.*)
//
// &hold=probes holds every probe until a spec calls
// __fastagE2E.mock.releaseProbes() (a probe still in flight).
//
// &start=defaults starts the session from FASTag's defaults instead of the
// task the app lands on (D1, "Characterize a run"): the specs written
// before P2a PR u check what a run from the defaults sends.
//
// Every scenario records each run that ends in the mock's run record, as
// fastag.rs does: the History view lists it, and its argv is the command
// line the run reply offered (e2eCommand, the argv build_args writes). The
// Setup footer's Copy command line answers the same argv (command_of).
//
// window.__fastagE2E gives the specs the mock and a few controls.

import { installMockBridge, type MockBridge } from './mockBridge'
import { DEFAULTS, type Origin } from '../setup/tasks'
import type { BrowserEvent, DropRoute, ResultsPage, ResultsView, RunEvent, RunStarted } from '../types'
import ecoliTags from '../../e2e-web/fixtures/ecoli.tags.tsv?raw'
import digestTsv from '../fixtures/digest.tsv?raw'
import labelTsv from '../fixtures/label.tsv?raw'
import massgapTsv from '../fixtures/massgap.tsv?raw'
import { CLI_CASES, logLines, type CliCase } from './cliFixtures'
import { speciesFromTsv } from './speciesTsv'
import { BATCH_CASES, DIA_REFUSAL } from './batchFixtures'

// The ?fixture= names of the real-CLI Overview scenarios.
const GATE: Record<string, CliCase> = {
  gate: CLI_CASES.v112,
  'gate-1.11': CLI_CASES.v111,
  'gate-da': CLI_CASES.v112Da,
  'gate-call': CLI_CASES.v112Call
}
import iontrapProbe from '../fixtures/probe/iontrap.probe.jsonl?raw'
import diaRawProbe from '../fixtures/probe/dia_raw.probe.jsonl?raw'
import orbitrapProbe from '../fixtures/probe/orbitrap.probe.jsonl?raw'
import it20Digest from '../fixtures/cli-1.12/iontrap_20ppm.digest.tsv?raw'
import it20Label from '../fixtures/cli-1.12/iontrap_20ppm.label.tsv?raw'
import it20Err from '../fixtures/cli-1.12/iontrap_20ppm.stderr?raw'
import it20Out from '../fixtures/cli-1.12/iontrap_20ppm.stdout?raw'
import diaErr from '../fixtures/cli-1.12/dia_raw.stderr?raw'
import diaOut from '../fixtures/cli-1.12/dia_raw.stdout?raw'

/// A string a release dist/ must never contain.
export const E2E_MARKER = '__FASTAG_E2E_BRIDGE__'

export interface E2EControls {
  marker: string
  fixture: string
  mock: MockBridge
  /// The backend's close guard asking (a close or quit while busy).
  requestClose(what: 'close' | 'quit'): void
  /// An OS file drop as drop.rs routes it, and a native menu click.
  drop(route: Partial<DropRoute>): void
  menu(action: string): void
  /// rank fixture: progress of the E-value order, and its end (Ranked).
  rankProgress(done: number, total: number): void
  finishRanking(): void
}

declare global {
  interface Window {
    __fastagE2E?: E2EControls
  }
}

interface Script {
  // The phase (progress.rs) the run is in while it prints them.
  phase: string
  lines: string[]
  ok: boolean
  code: number | null
  // Never ends on its own (until Cancel).
  hang?: boolean
  // ms between two log lines (default 40).
  step?: number
}

function parseTsv(text: string): { columns: string[]; rows: string[][] } {
  const [head, ...lines] = text.replace(/\r/g, '').split('\n').filter((l) => l !== '')
  return { columns: head.split('\t'), rows: lines.map((l) => l.split('\t')) }
}

const base = (p: string): string => p.slice(p.lastIndexOf('/') + 1)

/// browser.rs's order: finite numbers by value, then every other cell by its
/// bytes (UTF-16 order is byte order for this ASCII fixture), ties in file
/// order; descending reverses each block on its own.
export function rankOrder(cells: string[], desc: boolean): number[] {
  const num = (c: string): number | null => {
    const t = c.trim() === c && c !== '' ? Number(c) : NaN
    return Number.isFinite(t) && !/^(0x|[+-]?inf|nan)/i.test(c) ? t : null
  }
  const ids = cells.map((_, i) => i)
  const nums = ids.filter((i) => num(cells[i]) !== null)
  const strs = ids.filter((i) => num(cells[i]) === null)
  const sgn = desc ? -1 : 1
  nums.sort((a, b) => sgn * (num(cells[a])! - num(cells[b])!) || a - b)
  strs.sort((a, b) => (cells[a] < cells[b] ? -sgn : cells[a] > cells[b] ? sgn : a - b))
  return [...nums, ...strs]
}

/// The argv fastag.rs build_args writes for @p params, binary first (the
/// same rules for the values the e2e form sends): -in and -out, each switch
/// that is on by its name, each value as its own element (a list item by
/// item, a cleared list as ''), and -progress last.
export function e2eCommand(bin: string, params: Record<string, unknown>, out: string): string[] {
  const argv = [bin, '-in', String(params['in']), '-out', out]
  const p = (params['params'] ?? {}) as Record<string, unknown>
  for (const [name, v] of Object.entries(p)) {
    if (v === true) argv.push(`-${name}`)
    else if (Array.isArray(v)) {
      const items = v.map(String).filter((x) => x.trim() !== '')
      if (items.length) argv.push(`-${name}`, ...items)
    } else if ((typeof v === 'string' && v.trim() !== '') || typeof v === 'number') argv.push(`-${name}`, String(v).trim())
  }
  argv.push('-progress')
  return argv
}

/// Installs the bridge; returns where the session starts (?start=).
export function installE2EBridge(): Origin | undefined {
  const query = new URLSearchParams(window.location.search)
  const fixture = query.get('fixture') ?? 'default'
  const mock = installMockBridge()
  mock.recordRuns = true
  mock.binaryInfo = { bin: '/e2e/FASTag', source: 'env', ok: true, version: '1.11.0', detail: 'e2e fixture: no CLI' }
  // Copy command line (Setup) answers the argv the run reply offers and
  // History records, as fastag.rs builds both with command_of.
  mock.commandOf = (call) => e2eCommand(mock.binaryInfo.bin, call as unknown as Record<string, unknown>, call.out)
  const tags = parseTsv(ecoliTags)
  mock.resultsColumns = tags.columns
  mock.resultsRows = tags.rows
  mock.reportFiles = {
    '/data/run01.digest.tsv': digestTsv,
    '/data/run01.label.tsv': labelTsv,
    '/data/run01.massgap.tsv': massgapTsv
  }
  mock.nextPickInput = '/data/run01.mzML'
  mock.nextPickInputs = ['/data/run01.mzML', '/data/run02.mzML', '/data/run03.mzML']
  mock.nextPickResults = '/data/run01.tags.tsv'
  mock.nextPickReport = '/data/run01.digest.tsv'

  const gate = GATE[fixture]
  if (gate) {
    mock.reportFiles = { '/data/run01.digest.tsv': gate.digest, '/data/run01.label.tsv': gate.label }
    mock.speciesResult = speciesFromTsv(gate.species, '/data/run01.tags.species.tsv')
  }
  // gate-batch: the jobs by input, in the folder's (name) order.
  const batchCases = Object.values(BATCH_CASES)
  const batchInput = (name: string, dir = '/data'): string => `${dir}/${name}.mzML`
  if (fixture === 'gate-batch') {
    const names = [...batchCases.map((c) => c.name), DIA_REFUSAL.name].sort()
    mock.nextPickFolder = '/data'
    mock.folderFiles = { '/data': names.map((n) => batchInput(n)), '/out': [] }
    // Reports wherever the batch puts them: beside the inputs or in /out.
    for (const dir of ['/data', '/out'])
      for (const c of batchCases) {
        mock.reportFiles[`${dir}/${c.name}.digest.tsv`] = c.digest
        mock.reportFiles[`${dir}/${c.name}.label.tsv`] = c.label
        mock.speciesFiles[`${dir}/${c.name}.tags.species.tsv`] = speciesFromTsv(c.species, `${dir}/${c.name}.tags.species.tsv`)
      }
  }
  // P2b: the inspector. A CLI whose --helphelp lists -probe_input.
  if (fixture === 'iontrap-probe' || fixture === 'dia-probe' || fixture === 'orbitrap-probe') {
    mock.cliOptions = { options: [...mock.cliOptions.options, 'probe_input'], ok: true, detail: 'e2e fixture' }
    mock.probeOutputs['/data/run01.mzML'] =
      fixture === 'dia-probe' ? diaRawProbe : fixture === 'orbitrap-probe' ? orbitrapProbe : iontrapProbe
  }
  if (query.get('hold') === 'probes') mock.holdProbes = true
  if (fixture === 'iontrap') {
    mock.reportFiles = { '/data/run01.digest.tsv': it20Digest, '/data/run01.label.tsv': it20Label }
  }
  if (fixture === 'lastused') {
    mock.settings.lastUsed = { tag_length: '7', species: true }
  }
  if (fixture === 'existing') {
    mock.existingOutputs = ['/data/run01.tags.tsv']
    mock.history = [
      {
        id: '1762419600000-1',
        input: '/data/run01.mzML',
        outputs: ['/data/run01.tags.tsv'],
        cwd: '/data',
        argv: ['/e2e/FASTag', '-in', '/data/run01.mzML', '-out', '/data/run01.tags.tsv'],
        status: 'cancelled',
        exitCode: null,
        message: 'cancelled',
        start: 1762419600000,
        end: 1762419690000,
        cleanup: { removed: [], renamed: [], failed: ['/data/run01.tags.tsv'] }
      }
    ]
  }
  // A run of an earlier session that the app did not see end (sweep.rs
  // recover): recorded as failed, its partial table and a .part offered.
  if (fixture === 'interrupted') {
    mock.history = [
      {
        id: '1762419600000-interrupted',
        input: '/data/run01.mzML',
        outputs: ['/data/run01.tags.tsv', '/data/run01.digest.tsv'],
        cwd: '/data',
        argv: ['/e2e/FASTag', '-in', '/data/run01.mzML', '-out', '/data/run01.tags.tsv'],
        status: 'failed',
        exitCode: null,
        message: 'interrupted: the app ended while this run was in progress',
        start: 1762419600000,
        end: 1762419660000,
        cleanup: { removed: [], renamed: [], failed: [] }
      }
    ]
    mock.leftoverFiles = ['/data/run01.tags.tsv', '/data/run01.digest.tsv.part']
  }
  if (fixture === 'big') {
    const N = 10_000_000
    mock.resultsQuery = (path, view, offset, limit): Promise<ResultsPage> => {
      mock.resultsQueryCalls.push({ path, view, offset, limit })
      const rows: string[][] = []
      for (let i = offset; i < Math.min(N, offset + limit); i++) {
        const r = tags.rows[i % tags.rows.length].slice()
        r[0] = `controllerType=0 controllerNumber=1 scan=${i}`
        rows.push(r)
      }
      return Promise.resolve({ columns: tags.columns, totalRows: N, matchedRows: N, rows })
    }
  }

  let ranked = fixture !== 'rank'
  let rankCb: ((e: BrowserEvent) => void) | null = null
  if (fixture === 'rank') {
    const ev = tags.columns.indexOf('evalue')
    const order = (desc: boolean): number[] => rankOrder(tags.rows.map((r) => r[ev] ?? ''), desc)
    mock.resultsOpen = (path, onEvent) => {
      mock.resultsOpenCalls.push(path)
      rankCb = onEvent
      setTimeout(() => onEvent({ kind: 'indexed', generation: 1, totalRows: tags.rows.length }), 10)
      return Promise.resolve({ generation: 1, columns: tags.columns, rows: tags.rows.slice(0, 1000), complete: false })
    }
    const sortedIds = (view: ResultsView): { ids: number[]; ranked: boolean } => {
      const s = view.sort
      if (!s) return { ids: tags.rows.map((_, i) => i), ranked: true }
      if (s.column === 'evalue' && !ranked) return { ids: tags.rows.map((_, i) => i), ranked: false }
      if (s.column === 'evalue') return { ids: order(s.desc), ranked: true }
      const j = tags.columns.indexOf(s.column)
      const ids = tags.rows.map((_, i) => i)
      ids.sort((a, b) => (tags.rows[a][j] < tags.rows[b][j] ? -1 : tags.rows[a][j] > tags.rows[b][j] ? 1 : a - b))
      if (s.desc) ids.reverse()
      return { ids, ranked: true }
    }
    mock.resultsQuery = (path, view, offset, limit): Promise<ResultsPage> => {
      mock.resultsQueryCalls.push({ path, view, offset, limit })
      const { ids, ranked: r } = sortedIds(view)
      const sel = ids.slice(offset, offset + limit)
      return Promise.resolve({
        columns: tags.columns,
        totalRows: tags.rows.length,
        matchedRows: ids.length,
        rows: sel.map((i) => tags.rows[i]),
        rowIds: sel,
        ranked: r,
        pending: !r
      })
    }
    mock.resultsPosition = (_path, view, row) => Promise.resolve(sortedIds(view).ids.indexOf(row))
  }

  // What the simulated CLI prints for a run of @p input.
  const script = (input: string): Script => {
    const name = base(input)
    const reading = [`${name}: Reading spectra`, `${name}: Loading the spectra index`]
    if (fixture === 'slow') return { phase: 'Reading spectra', lines: reading, ok: false, code: null, hang: true }
    const real = (...logs: string[]): string[] => logs.flatMap((l) => l.split('\n')).filter((l) => l.trim() !== '')
    if (fixture === 'iontrap') return { phase: 'Reading spectra', lines: real(it20Err, it20Out), ok: true, code: 0 }
    if (fixture === 'dia-refusal') return { phase: 'Reading spectra', lines: real(diaErr, diaOut), ok: false, code: 11 }
    if (fixture === 'batch-fail' && name === 'run02.mzML')
      return {
        phase: 'Reading spectra',
        lines: [...reading, `${name}: Error: Unable to read file (in: ${input}): the index is stale`],
        ok: false,
        code: 1
      }
    if (gate) return { phase: 'Reading spectra', lines: logLines(gate), ok: true, code: 0, step: 100 }
    if (fixture === 'gate-batch') {
      const lines = (t: string): string[] => t.split(/\r?\n/).filter((l) => l !== '')
      if (name === `${DIA_REFUSAL.name}.mzML`) return { phase: 'Reading spectra', lines: lines(DIA_REFUSAL.log), ok: false, code: DIA_REFUSAL.code, step: 10 }
      const c = batchCases.find((x) => name === `${x.name}.mzML`)
      if (c) return { phase: 'Reading spectra', lines: lines(c.log), ok: true, code: 0, step: 10 }
    }
    return { phase: 'Reading spectra', lines: [...reading, `${name}: 139 MS2 spectra, 2028 tags`], ok: true, code: 0 }
  }

  const cancelled = new Set<number>()
  const origRun = mock.run
  const origCancel = mock.cancel
  mock.cancel = () => {
    cancelled.add(mock.lastRunId)
    const id = mock.lastRunId
    // The killed child's terminal event, as fastag.rs sends it.
    setTimeout(
      () =>
        mock.emitDone({
          runId: id,
          ok: false,
          code: null,
          message: 'cancelled',
          cancelled: true,
          cleanup: { removed: [mock.runCalls[mock.runCalls.length - 1]?.out ?? ''], renamed: [], failed: [] }
        }),
      30
    )
    return origCancel()
  }
  mock.run = async (params, onEvent): Promise<RunStarted> => {
    const started = await origRun(params, onEvent)
    if (!started.started) return started
    // The reply's command, which the run record keeps (mockBridge recordRuns).
    started.command = e2eCommand(mock.binaryInfo.bin, params, started.out ?? '')
    const id = mock.lastRunId
    const s = script(String(params['in']))
    const at = (ms: number, f: () => void): void => {
      setTimeout(() => {
        if (!cancelled.has(id)) f()
      }, ms)
    }
    const emit = (e: RunEvent): void => mock.emitEvent(id, e)
    at(20, () => emit({ kind: 'phase', label: s.phase }))
    const step = s.step ?? 40
    s.lines.forEach((l, i) => at(40 + i * step, () => emit({ kind: 'log', lines: [[l, true]] })))
    at(60, () => emit({ kind: 'phase', label: 'Tagging spectra' }))
    at(60, () => emit({ kind: 'progress', done: 70, total: 139, ratePerSec: 700, etaSec: 0.1 }))
    if (!s.hang) {
      const end = 80 + s.lines.length * step
      at(end - 10, () => emit({ kind: 'progress', done: 139, total: 139 }))
      at(end, () =>
        mock.emitDone({
          runId: id,
          ok: s.ok,
          code: s.code,
          cleanup: s.ok ? undefined : { removed: [String(params['out'])], renamed: [], failed: [] }
        })
      )
    }
    return started
  }

  window.__fastagE2E = {
    marker: E2E_MARKER,
    fixture,
    mock,
    requestClose: (what) => mock.emitCloseRequested(what),
    drop: (route) => mock.emitDrop(route),
    menu: (action) => mock.emitMenu(action),
    rankProgress: (done, total) => rankCb?.({ kind: 'rankProgress', generation: 1, done, total }),
    finishRanking: () => {
      ranked = true
      rankCb?.({ kind: 'ranked', generation: 1, column: 'evalue' })
    }
  }
  return query.get('start') === 'defaults' ? DEFAULTS : undefined
}
