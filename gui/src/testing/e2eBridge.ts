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
//
// window.__fastagE2E gives the specs the mock and a few controls.

import { installMockBridge, type MockBridge } from './mockBridge'
import type { ResultsPage, RunStarted } from '../types'
import ecoliTags from '../../e2e-web/fixtures/ecoli.tags.tsv?raw'
import digestTsv from '../fixtures/digest.tsv?raw'
import labelTsv from '../fixtures/label.tsv?raw'
import massgapTsv from '../fixtures/massgap.tsv?raw'

/// A string a release dist/ must never contain.
export const E2E_MARKER = '__FASTAG_E2E_BRIDGE__'

export interface E2EControls {
  marker: string
  fixture: string
  mock: MockBridge
  /// The backend's close guard asking (a close or quit while busy).
  requestClose(what: 'close' | 'quit'): void
}

declare global {
  interface Window {
    __fastagE2E?: E2EControls
  }
}

interface Script {
  lines: string[]
  ok: boolean
  code: number | null
  // Never ends on its own (until Cancel).
  hang?: boolean
}

function parseTsv(text: string): { columns: string[]; rows: string[][] } {
  const [head, ...lines] = text.replace(/\r/g, '').split('\n').filter((l) => l !== '')
  return { columns: head.split('\t'), rows: lines.map((l) => l.split('\t')) }
}

const base = (p: string): string => p.slice(p.lastIndexOf('/') + 1)

export function installE2EBridge(): void {
  const fixture = new URLSearchParams(window.location.search).get('fixture') ?? 'default'
  const mock = installMockBridge()
  mock.binaryInfo = { bin: '/e2e/FASTag', source: 'env', ok: true, version: '1.11.0', detail: 'e2e fixture: no CLI' }
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

  if (fixture === 'lastused') {
    mock.settings.lastUsed = { tag_length: '7', species: true }
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

  // What the simulated CLI prints for a run of @p input.
  const script = (input: string): Script => {
    const name = base(input)
    const reading = [`${name}: Reading spectra`, `${name}: Loading the spectra index`]
    if (fixture === 'slow') return { lines: reading, ok: false, code: null, hang: true }
    if (fixture === 'batch-fail' && name === 'run02.mzML')
      return {
        lines: [...reading, `${name}: Error: Unable to read file (in: ${input}): the index is stale`],
        ok: false,
        code: 1
      }
    return { lines: [...reading, `${name}: 139 MS2 spectra, 2028 tags`], ok: true, code: 0 }
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
  mock.run = async (params): Promise<RunStarted> => {
    const started = await origRun(params)
    if (!started.started || started.runId == null) return started
    const id = started.runId
    const s = script(String(params['in']))
    const at = (ms: number, f: () => void): void => {
      setTimeout(() => {
        if (!cancelled.has(id)) f()
      }, ms)
    }
    s.lines.forEach((l, i) => at(40 + i * 40, () => mock.emitLog(l)))
    at(60, () => mock.emitProgress({ done: 70, total: 139 }))
    if (!s.hang) {
      const end = 80 + s.lines.length * 40
      at(end - 10, () => mock.emitProgress({ done: 139, total: 139 }))
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
    requestClose: (what) => mock.emitCloseRequested(what)
  }
}
