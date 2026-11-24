// Feedback 422372a2: "Why is a protein database required for this step?"
// Mass-shift survey runs without a FASTA: the shift reports, which need a
// protein database, are off and say so instead of blocking Run; the shipped
// proteomes are a database choice in Inputs, with the species report's hint.

import { act, fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installMockBridge } from '../testing/mockBridge'
import { chooseTask, click, pickSingle, renderColdApp, runButton, showStep } from '../testing/render'
import { proteomeHint, PROTEOME_HELP, topSpecies } from './proteomeHint'
import { runValues, startValues, taskById } from './tasks'
import { planLine } from './plan'
import { waitingForDatabase } from './products'
import type { SpeciesReport } from '../types'

const field = (n: string): HTMLInputElement | null => document.getElementById(`p-${n}`) as HTMLInputElement | null
const change = (el: Element, value: string): Promise<void> => act(async () => void fireEvent.change(el, { target: { value } }))
const SHIFT = ['recon_out', 'delta_out', 'delta_spectra_out', 'delta_counts_out']

describe('Mass-shift survey without a protein database (feedback 422372a2)', () => {
  it('sends the tags run only, with the shift reports off; a shipped proteome turns them back on', () => {
    const t = taskById('mass-shift')!
    const v = startValues('builtin:mass-shift', '/d/a.tags.tsv')
    const sent = runValues(t, v)
    for (const n of SHIFT) expect(sent[n], n).toBe('')
    expect(waitingForDatabase(v).map((p) => p.param)).toEqual(SHIFT)
    // The form keeps them: choosing a database brings them back.
    for (const n of SHIFT) expect(String(v[n]), n).not.toBe('')
    const human: Record<string, unknown> = runValues(t, { ...v, recon_proteome: 'human' })
    for (const n of SHIFT) expect(human[n], n).toBe(v[n])
    expect(runValues(t, { ...v, recon_fasta: '/d/h.fasta' })).toEqual({ ...v, recon_fasta: '/d/h.fasta' })
    // Another workflow is sent as it is.
    const c = startValues('builtin:characterize', '/d/a.tags.tsv')
    expect(runValues(taskById('characterize'), { ...c, recon_out: '/d/r.tsv' })['recon_out']).toBe('/d/r.tsv')
  })

  it('the plan says plainly what runs', () => {
    const v = startValues('builtin:mass-shift', '/d/a.tags.tsv')
    expect(planLine('Mass-shift survey', runValues(taskById('mass-shift'), v), { input: '/d/a.mzML', files: 0, waiting: 3 })).toBe(
      'Mass-shift survey on a.mzML · tags table only · 3 reports off: no protein database · all spectra'
    )
  })

  it('names the shipped proteome a species report of the file points to', () => {
    const sp = (taxid: number, name: string, call?: string): SpeciesReport => ({
      path: '/d/a.species.tsv',
      taxa: [
        { rank: 'genus', taxid: 9605, name: 'Homo', observed: 9, adjusted: 9, q: 0 },
        { rank: 'species', taxid, name, observed: 9, adjusted: 9, q: 0, ...(call ? { call } : {}) }
      ]
    })
    expect(proteomeHint(null, '')).toBe(PROTEOME_HELP)
    expect(proteomeHint(sp(9606, 'Homo sapiens'), '')).toBe('Species detection names Homo sapiens first in this file: choose Human.')
    expect(proteomeHint(sp(9606, 'Homo sapiens'), 'human')).toBe('Species detection names Homo sapiens first in this file.')
    expect(proteomeHint(sp(83333, 'Escherichia coli K-12'), '')).toMatch(/: choose E\. coli\.$/)
    expect(proteomeHint(sp(9913, 'Bos taurus'), '')).toBe(
      'Species detection names Bos taurus first in this file; no shipped proteome fits: give its FASTA as Protein database.'
    )
    // A taxon the call says is not there names nothing.
    expect(topSpecies(sp(9606, 'Homo sapiens', 'not_detected'))).toBeNull()
  })

  it('Run is not blocked; the shift reports say they need a protein database; Human puts them in the run', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await chooseTask('Mass-shift survey')
    await pickSingle(mock, '/d/run01.mzML')
    expect(document.querySelector('.still-missing')).toBeNull()
    expect((runButton() as HTMLButtonElement).disabled).toBe(false)
    showStep(4)
    for (const n of SHIFT) {
      const box = document.getElementById(`out-${n}`) as HTMLInputElement
      expect(box.checked, n).toBe(false)
      expect(box.disabled, n).toBe(true)
      expect(document.getElementById(`out-${n}-d`)!.textContent, n).toBe('needs a protein database')
    }
    expect(screen.getByText(/No protein database: only the tags table is written\./)).toBeDefined()
    expect(document.querySelector('.plan-line')!.textContent).toMatch(/tags table only · 4 reports off: no protein database ·/)
    await click(runButton())
    const sent = mock.runCalls[0].params
    for (const n of SHIFT) expect(n in sent && sent[n] !== '', n).toBe(false)
    await act(async () => mock.emitDone({ ok: true, code: 0, runId: 1 }))

    showStep(2)
    await change(field('recon_proteome')!, 'human')
    showStep(4)
    for (const n of SHIFT) expect((document.getElementById(`out-${n}`) as HTMLInputElement).checked, n).toBe(true)
    expect(screen.queryByText(/No protein database/)).toBeNull()
    await click(runButton())
    const sent2 = mock.runCalls[mock.runCalls.length - 1].params
    expect(sent2['recon_proteome']).toBe('human')
    for (const n of SHIFT) expect(String(sent2[n] ?? ''), n).toMatch(/run01\./)
  })

  // Codex finding 5: the check before a run reads the values the run is
  // sent. With the Mass-gap report ticked and no database, launch sends no
  // placements and so no mass-gap report: a missing massgap_mods.tsv must
  // not hold the tags-only run. An engine without -recon_proteome is held
  // before a shipped proteome is sent to it.
  it('the checks follow what is sent: no mass-gap data needed without a database; an engine without -recon_proteome is held', async () => {
    const mock = installMockBridge()
    mock.dataStatusResult = { ...mock.dataStatusResult, files: { ...mock.dataStatusResult.files, massgapMods: false }, proteomes: ['human'] }
    await renderColdApp(mock)
    await chooseTask('Mass-shift survey')
    await pickSingle(mock, '/d/run01.mzML')
    showStep(2)
    await change(field('recon_proteome')!, 'human')
    showStep(4)
    const mg = document.getElementById('out-massgap_out') as HTMLInputElement
    if (!mg.checked) await click(mg)
    expect(mg.checked).toBe(true)
    // With the placements on, the mass-gap report needs its file: held.
    expect(document.querySelector('li.check[data-check="no-shipped-data-massgap_out"]')).not.toBeNull()
    expect((runButton() as HTMLButtonElement).disabled).toBe(true)
    showStep(2)
    await change(field('recon_proteome')!, '')
    // No database: the run is the tags alone, the report is not sent.
    expect(document.querySelector('li.check[data-check="no-shipped-data-massgap_out"]')).toBeNull()
    expect((runButton() as HTMLButtonElement).disabled).toBe(false)
    await click(runButton())
    const sent = mock.runCalls[mock.runCalls.length - 1].params
    expect(String(sent['massgap_out'] ?? '')).toBe('')
    await act(async () => mock.emitDone({ ok: true, code: 0, runId: 1 }))
  })

  it('an engine whose --helphelp lacks -recon_proteome holds the shipped-proteome run, with the fix', async () => {
    const mock = installMockBridge()
    mock.cliOptions = { ...mock.cliOptions, options: mock.cliOptions.options.filter((o) => o !== 'recon_proteome') }
    await renderColdApp(mock)
    await chooseTask('Mass-shift survey')
    await pickSingle(mock, '/d/run01.mzML')
    expect((runButton() as HTMLButtonElement).disabled).toBe(false)
    showStep(2)
    await change(field('recon_proteome')!, 'human')
    const li = document.querySelector<HTMLElement>('li.check[data-check="no-recon-proteome-option"]')
    expect(li).not.toBeNull()
    expect((runButton() as HTMLButtonElement).disabled).toBe(true)
    await click(within(li!).getByRole('button', { name: 'Use no shipped proteome' }))
    expect(document.querySelector('li.check[data-check="no-recon-proteome-option"]')).toBeNull()
    expect((runButton() as HTMLButtonElement).disabled).toBe(false)
  })
})
