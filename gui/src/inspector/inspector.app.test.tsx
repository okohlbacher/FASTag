// The inspector in the app (P2b): the checks before a run from the probe
// fixtures (only with a CLI whose --helphelp lists -probe_input), Run held by
// a block or an unanswered red flag, the checks after a run from the real
// FASTag 1.12 digest report and log of the ion-trap gate input with the
// re-run offer, and the exit-11 raw-DIA refusal.

import { act, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installMockBridge, type MockBridge } from '../testing/mockBridge'
import { click, flush, goTo, pickSingle, renderApp, renderColdApp, runButton, showView } from '../testing/render'
import { applyLastUsed, formValue } from '../testing/lastUsed'
import iontrapProbe from '../fixtures/probe/iontrap.probe.jsonl?raw'
import diaRawProbe from '../fixtures/probe/dia_raw.probe.jsonl?raw'
import noMs2Probe from '../fixtures/probe/no_ms2.probe.jsonl?raw'
import orbitrapProbe from '../fixtures/probe/orbitrap.probe.jsonl?raw'
import it20Digest from '../fixtures/cli-1.12/iontrap_20ppm.digest.tsv?raw'
import it20Label from '../fixtures/cli-1.12/iontrap_20ppm.label.tsv?raw'
import it20Err from '../fixtures/cli-1.12/iontrap_20ppm.stderr?raw'
import it20Out from '../fixtures/cli-1.12/iontrap_20ppm.stdout?raw'
import orbiDigest from '../fixtures/cli-1.12/orbitrap_hcd.digest.tsv?raw'
import orbiErr from '../fixtures/cli-1.12/orbitrap_hcd.stderr?raw'
import diaErr from '../fixtures/cli-1.12/dia_raw.stderr?raw'
import diaOut from '../fixtures/cli-1.12/dia_raw.stdout?raw'

const IN = '/data/run01.mzML'

function withProbe(mock: MockBridge, probe: string, input = IN): void {
  mock.cliOptions = { options: [...mock.cliOptions.options, 'probe_input'], ok: true, detail: '' }
  mock.probeOutputs[input] = probe
}

const checksBefore = (): HTMLElement => screen.getByRole('list', { name: 'Checks before the run' })
const checkItem = (title: RegExp): HTMLElement => {
  const all = [...document.querySelectorAll<HTMLElement>('li.check')]
  const hit = all.find((li) => title.test(li.querySelector('strong')?.textContent ?? ''))
  if (!hit) throw new Error(`no check ${title}: ${all.map((l) => l.querySelector('strong')?.textContent).join(' | ')}`)
  return hit
}

// Play a real CLI log into the newest run, then end it.
async function playRun(mock: MockBridge, logs: string[], done: { ok: boolean; code: number }): Promise<void> {
  await act(async () => {
    for (const log of logs) for (const l of log.split('\n')) if (l.trim()) mock.emitLog(l)
    mock.emitDone({ ...done, runId: mock.lastRunId })
  })
  await flush()
}

describe('inspector before a run', () => {
  it('with a CLI that has no -probe_input, the file is "not checked", never probed and Run is not held', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await pickSingle(mock, IN)
    expect(screen.getByText(/Not checked before the run: this FASTag has no metadata probe/)).toBeDefined()
    expect(mock.probeCalls).toEqual([])
    expect(screen.queryByRole('list', { name: 'Checks before the run' })).toBeNull()
    expect((runButton() as HTMLButtonElement).disabled).toBe(false)
  })

  it('ion-trap MS2 at 20 ppm: the 0.3 Da red flag holds Run until fixed; the stale index until Run anyway', async () => {
    const mock = installMockBridge()
    withProbe(mock, iontrapProbe)
    await renderApp(mock)
    await pickSingle(mock, IN)
    await flush()
    expect(mock.probeCalls).toEqual([{ input: IN, fasta: null }])
    const flag = checkItem(/^Red flag: Ion-trap MS2 with a 20 ppm tolerance/)
    expect(flag.textContent).toContain('From the probe.')
    expect(screen.getByText(/Instrument: LTQ Orbitrap XL/)).toBeDefined()
    expect(within(checksBefore()).getAllByRole('listitem')).toHaveLength(3)
    expect((runButton() as HTMLButtonElement).disabled).toBe(true)
    // The preset list marks the detected one.
    expect(screen.getByRole('option', { name: 'Ion trap CID 0.3 Da (detected)' })).toBeDefined()

    await click(within(flag).getByRole('button', { name: 'Use Ion trap CID 0.3 Da' }))
    expect(() => checkItem(/Ion-trap MS2/)).toThrow()
    expect((runButton() as HTMLButtonElement).disabled).toBe(true) // the stale index still waits
    await click(within(checkItem(/^Red flag: The mzML index does not match/)).getByRole('button', { name: 'Run anyway' }))
    expect((runButton() as HTMLButtonElement).disabled).toBe(false)
    await click(runButton())
    expect(mock.runCalls[0].params).toMatchObject({ fragment_tolerance: '0.3', fragment_tolerance_unit: 'Da' })
  })

  it('an Orbitrap run proposes Orbitrap HCD and holds nothing', async () => {
    const mock = installMockBridge()
    withProbe(mock, orbitrapProbe)
    await renderApp(mock)
    await pickSingle(mock, IN)
    await flush()
    expect(screen.getByText("No problem found in the file's metadata.")).toBeDefined()
    expect(screen.getByRole('option', { name: 'Orbitrap HCD 20 ppm (detected)' })).toBeDefined()
    expect((runButton() as HTMLButtonElement).disabled).toBe(false)
  })

  it('raw DIA blocks the run and names DIAspeXtract; no MS2 blocks it too', async () => {
    const mock = installMockBridge()
    withProbe(mock, diaRawProbe)
    withProbe(mock, noMs2Probe, '/data/ms1only.mzML')
    await renderApp(mock)
    await pickSingle(mock, IN)
    await flush()
    const block = checkItem(/^Blocks the run: Raw DIA/)
    expect(within(block).queryByRole('button', { name: 'Run anyway' })).toBeNull()
    expect(within(block).getByRole('button', { name: 'Copy DIAspeXtract command' })).toBeDefined()
    expect(block.textContent).toContain('DIAspeXtract -in /data/PXD006096/100815_MM_ABPP_H1993_DMSO_DIA1_new.mzML')
    expect((runButton() as HTMLButtonElement).disabled).toBe(true)
    await pickSingle(mock, '/data/ms1only.mzML')
    await flush()
    checkItem(/^Blocks the run: No MS2 spectra/)
    expect((runButton() as HTMLButtonElement).disabled).toBe(true)
  })

  it('a probe that fails says so and holds nothing', async () => {
    const mock = installMockBridge()
    withProbe(mock, iontrapProbe, '/elsewhere.mzML')
    await renderApp(mock)
    await pickSingle(mock, IN)
    await flush()
    expect(screen.getByText(/Not checked before the run: the probe failed \(exit code 5: Error: cannot read/)).toBeDefined()
    expect((runButton() as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('inspector after a run (real 1.12 reports and log)', () => {
  function ionTrapRun(mock: MockBridge): void {
    mock.reportFiles = { '/data/run01.digest.tsv': it20Digest, '/data/run01.label.tsv': it20Label }
  }

  it('the ion-trap gate input at 20 ppm: the red flag from the meta rows and the log, and a re-run at 0.3 Da', async () => {
    const mock = installMockBridge()
    ionTrapRun(mock)
    // The task the app lands on writes the digest report (and has species on).
    await renderColdApp(mock)
    await pickSingle(mock, IN)
    await click(runButton())
    expect(mock.runCalls[0].params).toMatchObject({ digest_out: '/data/run01.digest.tsv' })
    await playRun(mock, [it20Err, it20Out], { ok: true, code: 0 })
    await goTo('results')
    const after = screen.getByRole('list', { name: 'Checks after the run' })
    const flag = within(after).getByText(/^Red flag: This run used 20 ppm; the MS2 look like ion trap/).closest('li')!
    expect(flag.textContent).toContain('LTQ Orbitrap XL')
    expect(flag.textContent).toContain("From the digest report and FASTag's log.")
    expect(within(after).getByText(/^Warning: Electron activation/)).toBeDefined()

    // Re-run with 0.3 Da: species is on, so its Da red flag waits on Setup.
    await click(within(flag).getByRole('button', { name: 'Re-run with 0.3 Da' }))
    await flush()
    expect(mock.runCalls).toHaveLength(1)
    showView('setup')
    const da = checkItem(/^Red flag: Species detection with a tolerance in Da/)
    await click(within(da).getByRole('button', { name: 'Run anyway' }))
    await click(runButton())
    expect(mock.runCalls).toHaveLength(2)
    expect(mock.runCalls[1].params).toMatchObject({ fragment_tolerance: '0.3', fragment_tolerance_unit: 'Da' })
  })

  it('without species the re-run starts at once', async () => {
    const mock = installMockBridge()
    ionTrapRun(mock)
    // From the defaults, with the digest report written.
    mock.settings.lastUsed = { digest_out: '/data/run01.digest.tsv' }
    await renderApp(mock)
    await applyLastUsed(1)
    expect(await formValue('digest_out')).toBe('/data/run01.digest.tsv') // guard
    await pickSingle(mock, IN)
    await click(runButton())
    expect(mock.runCalls[0].params).toMatchObject({ digest_out: '/data/run01.digest.tsv' })
    expect(mock.runCalls[0].params['species']).not.toBe(true) // guard: species off
    await playRun(mock, [it20Err], { ok: true, code: 0 })
    await goTo('results')
    await click(screen.getByRole('button', { name: 'Re-run with 0.3 Da' }))
    await flush()
    expect(mock.runCalls).toHaveLength(2)
    expect(mock.runCalls[1].params).toMatchObject({ fragment_tolerance: '0.3', fragment_tolerance_unit: 'Da' })
  })

  it('an Orbitrap HCD run shows no checks after it', async () => {
    const mock = installMockBridge()
    mock.reportFiles = { '/data/run01.digest.tsv': orbiDigest }
    await renderColdApp(mock)
    await pickSingle(mock, IN)
    await click(runButton())
    await playRun(mock, [orbiErr], { ok: true, code: 0 })
    await goTo('results')
    // Guard: the digest report was read, so its meta rows were looked at.
    expect(mock.reportCalls).toContain('/data/run01.digest.tsv')
    expect(screen.getByRole('tab', { name: /Digest/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByRole('list', { name: 'Checks after the run' })).toBeNull()
  })
})

describe('the exit-11 raw-DIA refusal (real 1.12 output)', () => {
  it('is a clear block with the DIAspeXtract command, not a generic failure', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await pickSingle(mock, IN)
    await click(runButton())
    await playRun(mock, [diaErr, diaOut], { ok: false, code: 11 })
    await goTo('results')
    const alert = screen.getByRole('alert')
    expect(within(alert).getByText('run01.mzML: raw DIA, not tagged (exit code 11)')).toBeDefined()
    expect(alert.textContent).toContain('FASTag did not tag this file: it is raw DIA (126 isolation windows, median width 8 Th)')
    expect(within(alert).getByRole('button', { name: 'Copy DIAspeXtract command' })).toBeDefined()
    const input = '/scratch/kohlbach/gate-in-1.12/PXD006096/100815_MM_ABPP_H1993_DMSO_DIA1_new'
    expect(alert.textContent).toContain(`DIAspeXtract -in ${input}.mzML -out ${input}.pseudo.mzML`)
    // FASTag's own reason, not its sentinel line, and the Help entry for it.
    const reason = [...alert.querySelectorAll('code.why')].find((c) => !c.closest('.check-command'))
    expect(reason?.textContent).toMatch(/is raw DIA: /)
    expect(alert.textContent).not.toContain('FASTAG_REFUSED')
    expect(within(alert).getByRole('button', { name: 'What to do' }).getAttribute('data-help')).toBe('faq-raw-dia')
  })
})
