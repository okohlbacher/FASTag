// The inspector in the app (P2b): the checks before a run from the probe
// fixtures (only with a CLI whose --helphelp lists -probe_input), Run held by
// a block or an unanswered red flag, the checks after a run from the real
// FASTag 1.12 digest report and log of the ion-trap gate input with the
// re-run offer, and the exit-11 raw-DIA refusal.

import { act, fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installMockBridge, type MockBridge } from '../testing/mockBridge'
import { click, flush, goTo, key, pickSingle, renderApp, renderColdApp, runButton, showView } from '../testing/render'
import diaPseudoProbe from '../fixtures/probe/dia_pseudo.probe.jsonl?raw'
import { applyLastUsed, formValue } from '../testing/lastUsed'
import iontrapProbe from '../fixtures/probe/iontrap.probe.jsonl?raw'
import diaRawProbe from '../fixtures/probe/dia_raw.probe.jsonl?raw'
import noMs2Probe from '../fixtures/probe/no_ms2.probe.jsonl?raw'
import fastaProbe from '../fixtures/probe/fasta_nodecoys.probe.jsonl?raw'
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

// The visible "not checked" note (the live region repeats its text).
const notChecked = (text: RegExp): HTMLElement => screen.getByText(text, { selector: 'p.not-checked' })
const summary = (): string => screen.getByTestId('checks-summary').textContent ?? ''
const runDisabled = (): boolean => (runButton() as HTMLButtonElement).disabled
// Let focusLater's timeout run.
const settle = (ms = 0): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms))
  })

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
    notChecked(/Not checked before the run: this FASTag has no metadata probe/)
    expect(summary()).toMatch(/^Not checked before the run: this FASTag has no metadata probe/)
    expect(mock.probeCalls).toEqual([])
    expect(screen.queryByRole('list', { name: 'Checks before the run' })).toBeNull()
    expect((runButton() as HTMLButtonElement).disabled).toBe(false)
  })

  it('ion-trap MS2 at 20 ppm: the 0.3 Da red flag holds Run until fixed; the stale index is only a warning', async () => {
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
    expect(summary()).toBe('Checks before the run: 1 red flag, 2 warnings.')
    expect((runButton() as HTMLButtonElement).disabled).toBe(true)
    expect(runButton().getAttribute('aria-describedby')).toBe('run-held')
    expect(document.getElementById('run-held')?.textContent).toMatch(/^Run waits for the checks before the run/)
    // The preset list marks the detected one.
    expect(screen.getByRole('option', { name: 'Ion trap CID 0.3 Da (detected)' })).toBeDefined()

    const fix = within(flag).getByRole('button', { name: 'Use Ion trap CID 0.3 Da' })
    fix.focus()
    await click(fix)
    await settle()
    expect(() => checkItem(/Ion-trap MS2/)).toThrow()
    checkItem(/^Warning: The mzML index does not match/)
    expect((runButton() as HTMLButtonElement).disabled).toBe(false)
    // The fix button is gone: focus moved on to Run, not to the page body.
    expect(document.activeElement).toBe(runButton())
    expect(runButton().getAttribute('aria-describedby')).toBeNull()
    await click(runButton())
    expect(mock.runCalls[0].params).toMatchObject({ fragment_tolerance: '0.3', fragment_tolerance_unit: 'Da' })
  })

  it('the Orbitrap gate input (stale index, as FASTag 1.12 reports it) proposes Orbitrap HCD and holds nothing', async () => {
    const mock = installMockBridge()
    withProbe(mock, orbitrapProbe)
    await renderApp(mock)
    await pickSingle(mock, IN)
    await flush()
    expect(within(checksBefore()).getAllByRole('listitem')).toHaveLength(1)
    checkItem(/^Warning: The mzML index does not match/)
    expect(screen.getByRole('option', { name: 'Orbitrap HCD 20 ppm (detected)' })).toBeDefined()
    // Added file, then Run: two actions, as without the probe.
    expect((runButton() as HTMLButtonElement).disabled).toBe(false)
    await click(runButton())
    expect(mock.runCalls).toHaveLength(1)
  })

  it('a file that really is indexed shows no problem', async () => {
    const mock = installMockBridge()
    withProbe(mock, diaPseudoProbe)
    await renderApp(mock)
    await pickSingle(mock, IN)
    await flush()
    expect(screen.getByText("No problem found in the file's metadata.")).toBeDefined()
    expect(summary()).toBe('Checks before the run: no problem found.')
    expect((runButton() as HTMLButtonElement).disabled).toBe(false)
  })

  it('Run waits while the probe is in flight, and the result then decides', async () => {
    const mock = installMockBridge()
    withProbe(mock, iontrapProbe)
    withProbe(mock, orbitrapProbe, '/data/orbi.mzML')
    mock.holdProbes = true
    await renderApp(mock)
    await pickSingle(mock, IN)
    await flush()
    expect(mock.probeCalls).toHaveLength(1)
    expect(screen.getAllByText('Checking the file with FASTag…').length).toBeGreaterThan(0)
    expect(runDisabled()).toBe(true)
    expect(document.getElementById('run-held')?.textContent).toMatch(/^Checking the input with FASTag/)
    expect(runButton().getAttribute('aria-describedby')).toBe('run-held')
    // Neither the click nor the shortcut starts a run.
    await click(runButton())
    await key({ key: 'Enter', metaKey: true, ctrlKey: true })
    expect(mock.runCalls).toEqual([])
    await act(async () => mock.releaseProbes())
    await flush()
    checkItem(/^Red flag: Ion-trap MS2 with a 20 ppm tolerance/)
    expect(runDisabled()).toBe(true)
    expect(document.getElementById('run-held')?.textContent).toMatch(/^Run waits for the checks/)

    await pickSingle(mock, '/data/orbi.mzML')
    await flush()
    expect(runDisabled()).toBe(true)
    await act(async () => mock.releaseProbes())
    await flush()
    expect(runDisabled()).toBe(false)
  })

  it('Run anyway is a pressed toggle that can be taken back, and focus moves on to Run', async () => {
    const mock = installMockBridge()
    withProbe(mock, orbitrapProbe)
    mock.settings.lastUsed = { species: true, fragment_tolerance: '0.3', fragment_tolerance_unit: 'Da' }
    await renderApp(mock)
    await applyLastUsed(3)
    await pickSingle(mock, IN)
    await flush()
    const da = checkItem(/^Red flag: Species detection with a tolerance in Da/)
    expect(runDisabled()).toBe(true)
    const anyway = within(da).getByRole('button', { name: 'Run anyway' })
    expect(anyway.getAttribute('aria-pressed')).toBe('false')
    anyway.focus()
    await click(anyway)
    await settle()
    expect(runDisabled()).toBe(false)
    expect(document.activeElement).toBe(runButton())
    const chosen = within(checkItem(/^Red flag: Species detection/)).getByRole('button', { name: 'Run anyway: chosen' })
    expect(chosen.getAttribute('aria-pressed')).toBe('true')
    await click(chosen)
    expect(runDisabled()).toBe(true)
    expect(within(checkItem(/^Red flag: Species detection/)).getByRole('button', { name: 'Run anyway' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('typing a FASTA path never re-probes the spectra file; the FASTA is probed once, after the typing', async () => {
    const mock = installMockBridge()
    withProbe(mock, iontrapProbe)
    mock.probeOutputs[IN] = iontrapProbe
    await renderApp(mock)
    await pickSingle(mock, IN)
    await flush()
    checkItem(/^Red flag: Ion-trap MS2/)
    expect(mock.probeCalls).toEqual([{ input: IN, fasta: null }])
    // The FASTA probe's output (the gate FASTA, no decoys).
    mock.probeOutputs[IN] = fastaProbe
    await click(screen.getByRole('button', { name: /Sequence matching/ }))
    const field = document.getElementById('p-fasta') as HTMLInputElement
    const path = '/data/db.fasta'
    await act(async () => {
      for (let i = 1; i <= path.length; i++) fireEvent.change(field, { target: { value: path.slice(0, i) } })
    })
    await flush()
    // The spectra checks stay while typing.
    checkItem(/^Red flag: Ion-trap MS2/)
    expect(mock.probeCalls).toHaveLength(1)
    await settle(900)
    await flush()
    expect(mock.probeCalls).toEqual([
      { input: IN, fasta: null },
      { input: IN, fasta: '/data/db.fasta' }
    ])
    checkItem(/^Warning: The FASTA has no decoys/)
    // The spectra checks are still the spectra probe's.
    checkItem(/^Red flag: Ion-trap MS2/)
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
    notChecked(/Not checked before the run: the probe failed \(exit code 5: Error: cannot read/)
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
    // The finish announcement names the red flag after the run.
    expect(screen.getAllByRole('status').some((s) => /^Finished run01\.mzML.* 1 red flag after the run/.test(s.textContent ?? ''))).toBe(true)

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
    // A Characterize run lands on the Overview (P2b #25, D8), not on the
    // Digest tab: the digest report is there, and no checks after the run.
    expect(screen.getByRole('tab', { name: /Overview/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: /Digest/ })).toBeDefined()
    expect(screen.queryByRole('list', { name: 'Checks after the run' })).toBeNull()
    await click(screen.getByRole('tab', { name: /Digest/ }))
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
