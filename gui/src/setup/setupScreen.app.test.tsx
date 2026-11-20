// The Setup screen of P2a PR u (GUI-DESIGN 3 S1, 10 P2a): the task chooser,
// the four step cards with hidden dependent fields, the plan footer with
// Copy command and Export INI, and presets saved as diffs. Rendered as the
// app starts (renderColdApp: Export tags). Survey-specific tests select
// Characterize explicitly; renderApp starts from FASTag's own defaults.

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { installMockBridge } from '../testing/mockBridge'
import { click, goTo, key, openGroup, renderApp, renderColdApp, renderCharacterizeApp, runButton } from '../testing/render'
import { shellLine } from '../app/format'

const field = (name: string): HTMLInputElement | null => document.getElementById(`p-${name}`) as HTMLInputElement | null
const change = (el: Element, value: string): Promise<void> =>
  act(async () => {
    fireEvent.change(el, { target: { value } })
  })
const openSection = async (title: string): Promise<void> => {
  const b = screen.getAllByRole('button').find((x) => x.classList.contains('disclosure') && x.querySelector('.sec-title')?.textContent === title)!
  if (b.getAttribute('aria-expanded') !== 'true') await click(b)
}
const footer = (): HTMLElement => screen.getByRole('region', { name: 'Plan' })
const task = (name: RegExp): HTMLInputElement => screen.getByRole('radio', { name }) as HTMLInputElement

describe('Setup: the task chooser', () => {
  it('a cold start prioritizes Export tags, runs all spectra in 2 actions, and lands on Tags', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    expect(screen.getAllByRole('radio', { name: (_, el) => (el as HTMLInputElement).name === 'task' }).map((radio) => (radio as HTMLInputElement).value))
      .toEqual(['export-tags', 'run-qc', 'mass-shift', 'species', 'db-reduction', 'triage', 'characterize'])
    expect(task(/^Export tags/).checked).toBe(true)
    expect(footer().textContent).toContain('Export tags · no file yet · tags table only · all spectra')
    // Action 1: the input. Action 2: Run.
    mock.nextPickInput = '/d/run01.mzML'
    await click(screen.getByRole('button', { name: 'Choose file…' }))
    expect(footer().textContent).toContain('Export tags on run01.mzML · tags table only · all spectra')
    await click(runButton())
    expect(mock.runCalls).toHaveLength(1)
    const p = mock.runCalls[0].params
    expect(p.res_conf).toBe(true)
    expect(p.threads).toBe('0')
    expect([p.tag_length, p.extension]).toEqual(['3', '0'])
    expect([p.subsample_spectra, p.subsample_fraction]).toEqual(['0', '0.0'])
    expect(p.species).not.toBe(true)
    expect(p.glyco).not.toBe(true)
    for (const output of ['digest_out', 'label_out', 'species_out', 'glyco_out', 'recon_out', 'massgap_out', 'delta_out', 'qc_out']) {
      expect(p[output] ?? '', output).toBe('')
    }
    expect(mock.runCalls[0].out).toBe('/d/run01.tags.tsv')
    await act(async () => mock.emitDone({ ok: true, code: 0, runId: mock.lastRunId }))
    await waitFor(() => expect(mock.resultsOpenCalls).toContain('/d/run01.tags.tsv'))
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Tags')
    expect(screen.queryByRole('region', { name: 'Running' })).toBeNull()
    expect(mock.reportCalls).toEqual([])
    expect(mock.speciesCalls).toEqual([])
  })

  it('a workflow replaces the form; Undo brings back what it replaced', async () => {
    const mock = installMockBridge()
    await renderCharacterizeApp(mock)
    await openGroup('Tagging')
    await change(field('tag_length')!, '5')
    await click(task(/^Export tags/))
    expect(task(/^Export tags/).checked).toBe(true)
    expect(field('tag_length')!.value).toBe('3')
    expect(field('res_conf')!.checked).toBe(true)
    await click(screen.getByRole('button', { name: 'Undo' }))
    expect(field('tag_length')!.value).toBe('5')
    expect(task(/^Characterize a run/).checked).toBe(true)
    // Nothing to undo when nothing was changed by hand. The values Undo
    // brought back are the user's own again, so Reset takes them back first.
    await click(screen.getByRole('button', { name: /^Reset to Characterize a run/ }))
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    await click(task(/^Export tags/))
    await click(task(/^Characterize a run/))
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it.each(['Species', 'Spectrum'])('an Export tags run returns to Tags after viewing %s', async (previousTab) => {
    const mock = installMockBridge()
    mock.spectrumSupportResult = { ...mock.spectrumSupportResult, supported: true }
    // A Species tab only for a report that was read.
    mock.speciesResult = { path: '/d/run01.tags.species.tsv', taxa: [{ rank: 'genus', taxid: 561, name: 'Escherichia', observed: 7, adjusted: 7, q: 1e-13 }] } as typeof mock.speciesResult
    await renderCharacterizeApp(mock)
    mock.nextPickInput = '/d/run01.mzML'
    await click(screen.getByRole('button', { name: 'Choose file…' }))
    await click(runButton())
    await act(async () => mock.emitDone({ ok: true, code: 0, runId: mock.lastRunId }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Running' })).toBeNull())
    await goTo('results')
    await click(await screen.findByRole('tab', { name: new RegExp(`^${previousTab}`) }))
    await goTo('setup')
    await click(task(/^Export tags/))
    await click(runButton())
    expect(mock.runCalls[1].params.species).not.toBe(true)
    await act(async () => mock.emitDone({ ok: true, code: 0, runId: mock.lastRunId }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Running' })).toBeNull())
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Tags')
  })

  it('edits survive two workflow switches in a row: Undo brings them back', async () => {
    const mock = installMockBridge()
    await renderCharacterizeApp(mock)
    await openGroup('Tagging')
    await change(field('tag_length')!, '5')
    // Each switch replaces the form but preserves the original edits.
    await click(task(/^Run QC/))
    await click(task(/^Export tags/))
    expect(field('tag_length')!.value).toBe('3')
    await click(screen.getByRole('button', { name: 'Undo' }))
    expect(field('tag_length')!.value).toBe('5')
    expect(task(/^Characterize a run/).checked).toBe(true)
  })

  it('Batch is an input mode of every workflow: Add files… queues files for it', async () => {
    const mock = installMockBridge()
    await renderCharacterizeApp(mock)
    expect(screen.queryByRole('button', { name: 'Add files…' })).toBeNull()
    await click(screen.getByRole('radio', { name: 'Batch' }))
    expect(screen.queryByRole('button', { name: 'Choose file…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Or choose one file…' })).toBeNull()
    expect(screen.getByText('SDRF file (optional)')).toBeDefined()
    expect(screen.queryByLabelText('Run name')).toBeNull()
    mock.nextPickInputs = ['/d/a.mzML', '/d/b.mzML']
    await click(screen.getByRole('button', { name: 'Add files…' }))
    await goTo('setup')
    await waitFor(() => expect(screen.getByText(/2 files in the batch/)).toBeDefined())
  })

  it('a preset saved over Batch QC loads as Characterize a run in Batch mode', async () => {
    const mock = installMockBridge()
    mock.settings.presets = { qc: { v: 2, base: 'builtin:batch-qc', diff: { tag_length: '4' } } }
    await renderColdApp(mock)
    await change(document.getElementById('origin')!, 'qc')
    expect(task(/^Characterize a run/).checked).toBe(true)
    await openGroup('Tagging')
    expect(field('tag_length')!.value).toBe('4')
    expect((screen.getByRole('radio', { name: 'Batch' }) as HTMLInputElement).checked).toBe(true)
  })

  it('Open results is not a workflow: Open earlier results… opens a tags table', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    expect(screen.queryByRole('radio', { name: /^Open results/ })).toBeNull()
    mock.nextPickResults = '/d/old.tags.tsv'
    await click(screen.getByRole('button', { name: 'Open earlier results…' }))
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Tags')
    await waitFor(() => expect(mock.resultsOpenCalls).toEqual(['/d/old.tags.tsv']))
  })

  it('the chooser names each workflow with what it writes, and the chosen one says what it answers', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    expect(screen.getByText('→ QC report')).toBeDefined()
    await click(task(/^Run QC/))
    expect(screen.getByText(/^QC of one run: MS\/MS counts/)).toBeDefined()
  })

  it('five numbered cards in reading order, Advanced collapsed with 0 changed', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    const cards = screen.getAllByRole('region').filter((r) => r.classList.contains('step-card'))
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual(['1 Input', '2 Workflow', '3 Settings', '4 Outputs'])
    const adv = document.querySelector('details.advanced') as HTMLDetailsElement
    expect(adv.open).toBe(false)
    expect(adv.querySelector('summary')!.textContent).toContain('Advanced (0 changed)')
    // One edit inside Advanced counts, also while it is closed.
    await openGroup('Tagging, advanced')
    await change(field('gaps')!, '0')
    expect(adv.querySelector('summary')!.textContent).toContain('Advanced (1 changed)')
    // Export tags shows no species, glyco, digest or database field in Settings.
    const settings = cards[2]
    for (const n of ['species_rank', 'glyco_min_fraction', 'digest_models', 'recon_fasta']) expect(within(settings).queryByLabelText(new RegExp(n))).toBeNull()
    expect(settings.querySelector('#p-recon_fasta')).toBeNull()
  })
})

describe('Setup: hidden dependent fields', () => {
  // Round 4, 13: one pattern for every waiting field, one or several: folded
  // under one short note naming the master, its reason in the note's (?),
  // and one Turn on only when the master's checkbox is in another group.
  it('a group waiting for a report says so once, with Turn on; its fields show once it is on', async () => {
    const mock = installMockBridge()
    await renderApp(mock) // FASTag defaults: species off
    await openGroup('Species')
    await openGroup('Species, advanced')
    const group = document.querySelector('[data-group="Species, advanced"]')!
    expect(group.querySelector('.group-needs')!.textContent).toMatch(/needs?:? (.*; )?Species report[.;]/)
    expect(group.querySelector('.group-needs [data-param-help]')).not.toBeNull()
    expect(field('species_min_len')).toBeNull()
    await click(within(group as HTMLElement).getByRole('button', { name: 'Turn on Species report' }))
    expect(field('species_min_len')!.disabled).toBe(false)
    expect(field('species')!.checked).toBe(true)
  })

  it('Digest and labels folds its waiting fields under one line per report set, with no Turn on beside its own checkbox', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await openGroup('Digest and labels')
    const group = document.querySelector('[data-group="Digest and labels"]')!
    const banners = group.querySelectorAll('.group-needs')
    expect(banners.length).toBeGreaterThan(0)
    expect(banners[0].textContent).toMatch(/needs?:? (.*; )?Digest report[.;]/)
    // No waiting field is left in view, disabled.
    expect(group.querySelectorAll('.field.off')).toHaveLength(0)
    // The digest report's checkbox is in this group: no Turn on repeats it.
    expect(within(group as HTMLElement).queryByRole('button', { name: /^Turn on Digest report/ })).toBeNull()
    await click(document.getElementById('out-digest_out')!)
    expect(field('digest_tag_min')!.disabled).toBe(false)
  })

  it('a single waiting field is folded too, under the same short note', async () => {
    const mock = installMockBridge()
    await renderApp(mock) // FASTag defaults: glyco off
    await openGroup('Glycopeptides')
    const group = document.querySelector('[data-group="Glycopeptides"]')!
    expect(field('glyco_min_fraction')).toBeNull()
    expect(group.querySelector('.group-needs')!.textContent).toMatch(/needs?:? (.*; )?Glycopeptide report[.;]/)
    // The report's checkbox is the switch.
    await click(field('glyco')!)
    expect(field('glyco_min_fraction')!.disabled).toBe(false)
  })

  it('Triage hides the ID q-value and Triage E-value until Identifications is set (round 4, 18)', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await click(task(/^Identifiability triage/))
    expect(field('census_ids')).not.toBeNull()
    expect(field('census_ids_fdr')).toBeNull()
    expect(field('census_triage_evalue')).toBeNull()
    await change(field('census_ids')!, '/d/run01.idXML')
    expect(field('census_ids_fdr')!.disabled).toBe(false)
    expect(field('census_triage_evalue')!.disabled).toBe(false)
  })

  it('a field waiting for either of two reports names both in words', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await openGroup('Digest and labels')
    const group = document.querySelector('[data-group="Digest and labels"]')!
    const notes = [...group.querySelectorAll('.group-needs')].map((n) => n.textContent ?? '')
    expect(notes.some((t) => /Digest report or Label report[.;]/.test(t))).toBe(true)
    expect(field('digest_window')).toBeNull()
  })

  it('the parameter search opens a hidden field at its switch', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await click(screen.getByRole('button', { name: /Search settings…/ }))
    const box = await screen.findByRole('combobox', { name: /Search parameters/ })
    await change(box, 'species_rank')
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' })
    })
    await waitFor(() => expect(document.activeElement).toBe(field('species')))
  })

  it('the parameter search routes folded and wired parameters to their owning control (round 4, 24)', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    const search = async (q: string): Promise<void> => {
      await click(screen.getByRole('button', { name: /Search settings…/ }))
      const box = await screen.findByRole('combobox', { name: /Search parameters/ })
      await change(box, q)
      await act(async () => {
        fireEvent.keyDown(box, { key: 'Enter' })
      })
    }
    // The count is the Custom count… of Spectra to read: revealed, focused.
    await search('subsample_spectra')
    await waitFor(() => expect(document.activeElement?.id).toBe('p-subsample_spectra'))
    expect((field('subsample_fraction') as unknown as HTMLSelectElement).value).toBe('__count')
    // A switch a report sets: that report's checkbox.
    await click(task(/^Identifiability triage/))
    await search('census_score')
    await waitFor(() => expect(document.activeElement?.id).toBe('out-census_sorted_out'))
  })

  it('a native view menu closes search instead of leaving a modal over a hidden form', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await click(screen.getByRole('button', { name: /Search settings…/ }))
    expect(screen.getByRole('dialog', { name: 'Search parameters' })).toBeDefined()
    await act(async () => mock.emitMenu('view-results'))
    expect(screen.queryByRole('dialog', { name: 'Search parameters' })).toBeNull()
    await click(screen.getByRole('button', { name: /^Setup$/ }))
    expect(screen.queryByRole('dialog', { name: 'Search parameters' })).toBeNull()
  })
})

describe('Setup: the plan footer', () => {
  it('explains an empty run name at the field and Run, then clears the error when repaired', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    mock.nextPickInput = '/d/run01.mzML'
    await click(screen.getByRole('button', { name: 'Choose file…' }))
    const name = document.getElementById('out-name') as HTMLInputElement
    expect(name.value).toBe('run01')
    await change(name, '')
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(runButton().hasAttribute('disabled')).toBe(true)
    expect(runButton().getAttribute('aria-describedby')).toContain('run-output-required')
    expect(screen.getByText('Choose a run name in Outputs before running.')).toBeDefined()
    await change(name, 'repaired')
    expect(name.getAttribute('aria-invalid')).toBe('false')
    expect(runButton().hasAttribute('disabled')).toBe(false)
    await click(runButton())
    expect(mock.runCalls[0].out).toBe('/d/repaired.tags.tsv')
  })

  it('says what the run does; the workflow row says how far the form differs from where it started', async () => {
    const mock = installMockBridge()
    await renderCharacterizeApp(mock)
    await openGroup('Tagging')
    mock.nextPickInput = '/d/run01.mzML'
    await click(screen.getByRole('button', { name: 'Choose file…' }))
    expect(within(footer()).getByText('Characterize a run on run01.mzML · 4 reports · 10% of spectra')).toBeDefined()
    expect(screen.queryByText('(modified)')).toBeNull()
    await change(field('tag_length')!, '4')
    await change(field('max_tags')!, '20')
    expect(screen.getByText('(modified)')).toBeDefined()
    await click(screen.getByRole('button', { name: 'Reset to Characterize a run' }))
    expect(field('tag_length')!.value).toBe('3')
    expect(screen.queryByText('(modified)')).toBeNull()
    // Reports stay beside the input after the reset.
    await click(runButton())
    expect(mock.runCalls[0].params.digest_out).toBe('/d/run01.digest.tsv')
  })

  it('Copy command copies the command line the run is given', async () => {
    const mock = installMockBridge()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await renderColdApp(mock)
    mock.nextPickInput = '/d/my run/a.mzML'
    await click(screen.getByRole('button', { name: 'Choose file…' }))
    await click(within(footer()).getByRole('button', { name: 'Copy command line' }))
    expect(mock.commandLineCalls).toHaveLength(1)
    expect(within(footer()).getByRole('button', { name: 'Copied' })).toBeDefined()
    await click(runButton())
    // The footer asked for the very request Run sent, and copied its argv.
    expect(mock.commandLineCalls[0]).toEqual(mock.runCalls[0])
    expect(writeText).toHaveBeenCalledWith(shellLine(mock.commandOf(mock.runCalls[0])))
  })

  it('clears copied feedback when the command changes', async () => {
    const mock = installMockBridge()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true })
    await renderColdApp(mock)
    mock.nextPickInput = '/d/run01.mzML'
    await click(screen.getByRole('button', { name: 'Choose file…' }))
    await click(within(footer()).getByRole('button', { name: 'Copy command line' }))
    expect(within(footer()).getByRole('button', { name: 'Copied' })).toBeDefined()
    await change(field('tag_length')!, '4')
    expect(within(footer()).getByRole('button', { name: 'Copy command line' })).toBeDefined()
  })

  it('Export INI writes the request Run would send to the chosen file', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    mock.nextPickInput = '/d/run01.mzML'
    await click(screen.getByRole('button', { name: 'Choose file…' }))
    mock.nextPickOutput = '/d/run01.ini'
    await click(within(footer()).getByRole('button', { name: 'Export INI…' }))
    expect(mock.pickFileCalls[mock.pickFileCalls.length - 1]).toEqual({ kind: 'save', formats: ['ini'] })
    await waitFor(() => expect(mock.exportIniCalls).toHaveLength(1))
    expect(mock.exportIniCalls[0].dest).toBe('/d/run01.ini')
    expect(await within(footer()).findByRole('status')).toHaveProperty('textContent', 'INI written: run01.ini. The command line runs it with FASTag -ini run01.ini')
    await click(runButton())
    expect(mock.exportIniCalls[0].params).toEqual(mock.runCalls[0])
  })

  it('does not show late clipboard success for a changed command', async () => {
    const mock = installMockBridge()
    let finish!: () => void
    const writeText = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await renderColdApp(mock)
    mock.nextPickInput = '/d/run01.mzML'
    await click(screen.getByRole('button', { name: 'Choose file…' }))
    await click(within(footer()).getByRole('button', { name: 'Copy command line' }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    await change(field('tag_length')!, '4')
    await act(async () => { finish() })
    expect(within(footer()).queryByRole('button', { name: 'Copied' })).toBeNull()
  })

  it('does not overwrite a newer copy with a late command-line response', async () => {
    const mock = installMockBridge()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await renderColdApp(mock)
    mock.nextPickInput = '/d/run01.mzML'
    await click(screen.getByRole('button', { name: 'Choose file…' }))
    let finish!: (argv: string[]) => void
    vi.spyOn(window.fastag, 'commandLine')
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
      .mockResolvedValueOnce(['FASTag', '-tag_length', '4'])
    await click(within(footer()).getByRole('button', { name: 'Copy command line' }))
    await change(field('tag_length')!, '4')
    await click(within(footer()).getByRole('button', { name: 'Copy command line' }))
    expect(writeText).toHaveBeenCalledExactlyOnceWith('FASTag -tag_length 4')
    await act(async () => { finish(['FASTag', '-tag_length', '3']) })
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(within(footer()).getByRole('button', { name: 'Copied' })).toBeDefined()
  })

  it('exports the clicked setup but does not show late success for a changed setup', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    mock.nextPickInput = '/d/run01.mzML'
    await click(screen.getByRole('button', { name: 'Choose file…' }))
    let choose!: (path: string) => void
    vi.spyOn(window.fastag, 'saveFile').mockImplementation(() => new Promise((resolve) => { choose = resolve }))
    await click(within(footer()).getByRole('button', { name: 'Export INI…' }))
    await change(field('tag_length')!, '4')
    await act(async () => { choose('/d/run01.ini') })
    expect(mock.exportIniCalls[0].params.params.tag_length).toBe('3')
    expect(within(footer()).queryByRole('status')).toBeNull()
  })

  it('reports a rejected save dialog without an unhandled promise rejection', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    vi.spyOn(window.fastag, 'saveFile').mockRejectedValue(new Error('Save dialog unavailable'))
    await click(within(footer()).getByRole('button', { name: 'Export INI…' }))
    expect((await within(footer()).findByRole('alert')).textContent).toContain('Save dialog unavailable')
    expect(mock.exportIniCalls).toHaveLength(0)
  })

  it('a failed export says why; a cancelled dialog writes nothing', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    mock.nextPickOutput = null
    await click(within(footer()).getByRole('button', { name: 'Export INI…' }))
    expect(mock.exportIniCalls).toHaveLength(0)
    mock.nextPickOutput = '/ro/x.ini'
    mock.exportIniError = 'FASTag could not write the INI (Permission denied)'
    await click(within(footer()).getByRole('button', { name: 'Export INI…' }))
    expect((await within(footer()).findByRole('alert')).textContent).toContain('Permission denied')
  })
})

describe('Setup: presets as diffs', () => {
  it('a preset saved from a workflow stores its diff over it, without paths', async () => {
    const mock = installMockBridge()
    await renderCharacterizeApp(mock)
    await openGroup('Tagging')
    await openGroup('Keep only tags found in a database')
    mock.nextPickInput = '/data/run01.mzML'
    await click(screen.getByRole('button', { name: 'Choose file…' }))
    await change(field('tag_length')!, '4')
    await change(field('fasta')!, '/data/db/human.fasta')
    await change(document.getElementById('origin')!, '__save')
    expect(screen.getByText(/Paths are not saved: fasta/)).toBeDefined()
    await change(screen.getByRole('textbox', { name: 'Preset name' }), 'Mine')
    await click(screen.getByRole('button', { name: 'Save' }))
    expect(mock.settings.presets['Mine']).toEqual({ v: 2, base: 'builtin:characterize', diff: { tag_length: '4' } })
    // Applied on another input, it is the workflow plus the diff, beside that input.
    await click(task(/^Export tags/))
    mock.nextPickInput = '/data/run02.mzML'
    await click(screen.getByRole('button', { name: 'Change…' }))
    await change(document.getElementById('origin')!, 'Mine')
    expect(task(/^Characterize a run/).checked).toBe(true)
    expect(field('tag_length')!.value).toBe('4')
    expect(screen.getByText('preset Mine')).toBeDefined()
    expect(screen.queryByText('(modified)')).toBeNull()
    await click(runButton())
    expect(mock.runCalls[0].params.digest_out).toBe('/data/run02.digest.tsv')
    expect(mock.runCalls[0].params.species).toBe(true)
  })

  it('a preset the settings file refuses is not taken for saved', async () => {
    const mock = installMockBridge()
    mock.settingsWritable = false
    await renderColdApp(mock)
    await change(field('tag_length')!, '4')
    await change(document.getElementById('origin')!, '__save')
    await change(screen.getByRole('textbox', { name: 'Preset name' }), 'Mine')
    await click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert').textContent).toMatch(/“Mine” could not be saved: the settings file cannot be written/)
    expect(mock.settings.presets['Mine']).toBeUndefined()
    // The name stays open to retry or cancel; the origin is still the workflow.
    expect(screen.getByRole('textbox', { name: 'Preset name' })).toBeDefined()
    await click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Export tags', { selector: 'strong' })).toBeDefined()
    expect(screen.queryByRole('option', { name: /^Delete preset/ })).toBeNull()
  })

  it('a preset the settings file refuses to delete stays the origin', async () => {
    const mock = installMockBridge()
    mock.settings.presets = { kept: { v: 2, base: 'defaults', diff: { tag_length: '6' } } }
    await renderColdApp(mock)
    await change(document.getElementById('origin')!, 'kept')
    mock.settingsWritable = false
    await change(document.getElementById('origin')!, '__delete')
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/“kept” could not be deleted/))
    expect(screen.getByText('preset kept')).toBeDefined()
  })

  it('a v1 preset (a full record) applies as it always did', async () => {
    const mock = installMockBridge()
    mock.settings.presets = { old: { tag_length: '6', fragment_tolerance: '0.3', fragment_tolerance_unit: 'Da', species: false } }
    await renderColdApp(mock)
    await change(document.getElementById('origin')!, 'old')
    expect(field('tag_length')!.value).toBe('6')
    // 0.3 Da is the ion-trap preset.
    expect((document.getElementById('instrument') as HTMLSelectElement).value).toBe('iontrap-cid')
    // Over the defaults, as it was saved: not over the landing workflow.
    await openGroup('Glycopeptides')
    expect(field('glyco')!.checked).toBe(false)
  })
})
