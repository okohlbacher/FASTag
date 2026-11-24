// Review round 8, the run hook and the Setup form: a species report opened
// alone keeps its run's tolerance (2), the raised Extension forgotten with
// the values it was raised in (7), the after-run notes of the run shown (8),
// and a later run that did not finish withholds no report (23).

import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useRun, type RunInputs } from './useRun'
import { createViewStore } from '../app/viewStore'
import { initialValues } from '../setup/useSession'
import { installMockBridge, type MockBridge } from '../testing/mockBridge'
import { click, pickSingle, renderCharacterizeApp, runButton, chooseTask } from '../testing/render'
import { daSpeciesTolerance } from '../results/overview'
import type { RunRecord } from '../types'

afterEach(() => {
  vi.restoreAllMocks()
})

function hook(mock: MockBridge) {
  void mock
  const view = createViewStore({ tab: 'digest', logJob: null })
  const inputs: RunInputs = { values: initialValues(), input: '/d/a.mzML', out: '/d/a.tags.tsv', blocked: false, speciesOn: false, changedParams: [] }
  const r = renderHook(() => useRun(inputs, view))
  return { ...r, view }
}

const rec = (id: string, input: string, outputs: string[], end: number, params: Record<string, unknown>, status: RunRecord['status'] = 'ok'): RunRecord => ({
  id,
  input,
  outputs,
  cwd: '/d',
  argv: ['FASTag', '-in', input, '-out', outputs[0]],
  status,
  exitCode: status === 'ok' ? 0 : 1,
  message: null,
  start: end - 1000,
  end,
  cleanup: { removed: [], renamed: [], failed: [] },
  params,
  workflow: 'run-qc'
})

const QC = 'section\tkey\tvalue\tn\tdescription\nrun\tversion\t1.15.3\t-\tFASTag 1.15.3 wrote this report.\nqc\tcount_ms2\t7\t-\tMS2 spectra read.\n'

describe('round 8, 2: a species report opened alone', () => {
  it('keeps the parameters of the run that wrote it: its Da tolerance is known', async () => {
    const mock = installMockBridge()
    mock.history = [rec('S', '/d/s.mzML', ['/d/s.tags.tsv', '/d/s.species.tsv'], 1_000_000, { species: true, fragment_tolerance: '0.3', fragment_tolerance_unit: 'Da' })]
    vi.spyOn(window.fastag, 'species').mockResolvedValue({ path: '/d/s.species.tsv', taxa: [{ rank: 'genus', taxid: 10028, name: 'Cricetulus', observed: 9, adjusted: 9, q: 0.01 }] } as never)
    const { result } = hook(mock)
    await act(async () => result.current.openSpeciesPath('/d/s.species.tsv'))
    await waitFor(() => expect(result.current.species).not.toBeNull())
    expect(result.current.speciesRun?.params).toMatchObject({ fragment_tolerance_unit: 'Da' })
    // As ResultTabs reads it, with no other run shown.
    expect(daSpeciesTolerance([], result.current.speciesRun?.params)).toBe(0.3)
  })
})

describe('round 8, 23: a later run that did not finish', () => {
  it('withholds no report; the report is shown with a note naming that run', async () => {
    const mock = installMockBridge()
    mock.reportFiles['/d/shared.qc.tsv'] = QC
    const a = rec('A', '/d/a.mzML', ['/d/a.tags.tsv', '/d/shared.qc.tsv'], 1_000_000, { qc_out: '/d/shared.qc.tsv' })
    const b = rec('B', '/d/b.mzML', ['/d/b.tags.tsv', '/d/shared.qc.tsv'], 2_000_000, { qc_out: '/d/shared.qc.tsv' }, 'failed')
    mock.history = [b, a]
    const { result } = hook(mock)
    await act(async () => result.current.showRecord(a, '/d/a.tags.tsv'))
    await waitFor(() => expect(result.current.reports.workflow?.qc).toBe('/d/shared.qc.tsv'))
    expect(result.current.results?.reportsReplaced).toBeUndefined()
    expect(result.current.results?.reportsTouched).toEqual([{ path: '/d/shared.qc.tsv', by: '/d/b.mzML', end: 2_000_000, status: 'failed' }])
  })
})

describe('round 8, 8: the after-run notes are those of the run shown', () => {
  it('an older History run of the same input shows none of the last run\'s notes', async () => {
    const mock = installMockBridge()
    const { result } = hook(mock)
    await act(async () => {
      void result.current.run()
    })
    await waitFor(() => expect(mock.runCalls).toHaveLength(1))
    await act(async () => {
      mock.emitLog('Collisional activation: 30 of 40 MS2 spectra were activated by collision (CID, HCD) but are read as c/z ions under -ion_series cz.')
      mock.emitDone({ ok: true, code: 0, runId: mock.lastRunId })
    })
    await waitFor(() => expect(result.current.results?.path).toBe('/d/a.tags.tsv'))
    expect(result.current.shownNotes.length).toBeGreaterThan(0)
    expect(result.current.shownRerunnable).toBe(true)
    // An earlier run of a.mzML, to another output.
    const old = rec('O', '/d/a.mzML', ['/d/a.old.tags.tsv'], 500_000, {})
    mock.history = [old]
    await act(async () => result.current.showRecord(old, '/d/a.old.tags.tsv'))
    await waitFor(() => expect(result.current.results?.path).toBe('/d/a.old.tags.tsv'))
    expect(result.current.shownNotes).toEqual([])
    expect(result.current.shownRerunnable).toBe(false)
  })
})

describe('round 8, 7: the raise belongs to the values it was raised in', () => {
  it('Characterize + alkylation, then Mass-shift survey and its database: Extension stays the preset 3', async () => {
    const mock = installMockBridge()
    await renderCharacterizeApp(mock)
    const ext = (): string => (document.getElementById('p-extension') as HTMLInputElement | null)?.value ?? ''
    await click(document.getElementById('out-alkylation_out')!)
    // feedback 202dbcf4: no database, so the report raises nothing here.
    expect(document.getElementById('out-alkylation_out-d')!.textContent).toMatch(/^No database needed/)
    await chooseTask('Mass-shift survey')
    const db = document.getElementById('p-recon_fasta') as HTMLInputElement
    await act(async () => {
      fireEvent.change(db, { target: { value: '/d/human.fasta' } })
    })
    // Extension is a basic field of the survey (doc/GUI-WORKFLOWS.md 2.2).
    expect(ext()).toBe('3')
    await pickSingle(mock, '/d/run01.mzML')
    await click(runButton())
    expect(mock.runCalls[0].params.extension).toBe('3')
  })
})
