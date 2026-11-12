// The Setup screen of P2a PR u (GUI-DESIGN 3 S1, 10 P2a): the task chooser,
// the four step cards with hidden dependent fields, the plan footer with
// Copy command and Export INI, and presets saved as diffs. Rendered as the
// app starts (renderColdApp: Characterize a run, D1), unlike the older
// App-level tests, which start from FASTag's defaults (renderApp).

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { installMockBridge } from '../testing/mockBridge'
import { click, renderApp, renderColdApp, runButton } from '../testing/render'
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
  it('a cold start lands on Characterize a run and reaches Run in 2 actions', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    expect(task(/^Characterize a run/).checked).toBe(true)
    // Action 1: the input. Action 2: Run.
    mock.nextPickInput = '/d/run01.mzML'
    await click(screen.getByRole('button', { name: 'Choose file…' }))
    await click(runButton())
    expect(mock.runCalls).toHaveLength(1)
    const p = mock.runCalls[0].params
    expect([p.species, p.extension, p.glyco, p.subsample_fraction]).toEqual([true, '2', true, '0.1'])
    expect([p.digest_out, p.label_out]).toEqual(['/d/run01.digest.tsv', '/d/run01.label.tsv'])
    expect(mock.runCalls[0].out).toBe('/d/run01.tags.tsv')
  })

  it('a task replaces the form; Undo brings back what it replaced', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await change(field('tag_length')!, '5')
    await click(task(/^Export tags/))
    expect(task(/^Export tags/).checked).toBe(true)
    expect(field('tag_length')!.value).toBe('3')
    await openSection('Output')
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

  it('edits survive two task switches in a row, by keyboard: Undo brings them back', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await change(field('tag_length')!, '5')
    // Arrowing through the native radio group replaces the form once per
    // task it passes: Batch QC, then Export tags.
    await click(task(/^Batch QC/))
    await click(task(/^Export tags/))
    expect(field('tag_length')!.value).toBe('3')
    await click(screen.getByRole('button', { name: 'Undo' }))
    expect(field('tag_length')!.value).toBe('5')
    expect(task(/^Characterize a run/).checked).toBe(true)
  })

  it('Batch QC asks for the files of a batch first; one file is still possible', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    expect(screen.queryByRole('button', { name: 'Or choose one file…' })).toBeNull()
    await click(task(/^Batch QC/))
    // The same values as Characterize: only the input differs (P2a).
    expect(field('extension')!.value).toBe('2')
    expect(screen.queryByRole('button', { name: 'Choose file…' })).toBeNull()
    mock.nextPickInputs = ['/d/a.mzML', '/d/b.mzML']
    await click(screen.getByRole('button', { name: 'Add files for a batch…' }))
    await waitFor(() => expect(screen.getByText(/A batch of 2 files/)).toBeDefined())
  })

  it('Batch QC keeps the single-file path', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await click(task(/^Batch QC/))
    mock.nextPickInput = '/d/run01.mzML'
    await click(screen.getByRole('button', { name: 'Or choose one file…' }))
    await click(runButton())
    expect(mock.runCalls).toHaveLength(1)
    expect(mock.runCalls[0].params.digest_out).toBe('/d/run01.digest.tsv')
  })

  it('Open results collapses the cards to an Open… button', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await click(task(/^Open results/))
    expect(field('tag_length')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Plan' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Run/ })).toBeNull()
    mock.nextPickResults = '/d/old.tags.tsv'
    await click(screen.getByRole('button', { name: 'Open results…' }))
    await waitFor(() => expect(mock.resultsOpenCalls).toEqual(['/d/old.tags.tsv']))
  })

  it('four numbered step cards, each with its summary line', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    const cards = screen.getAllByRole('region').filter((r) => r.classList.contains('step-card'))
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual(['1 Spectra', '2 Database & taxonomy', '3 Tagging', '4 Reports'])
    expect(within(cards[1]).getByText('Species on (bundled index) · no FASTA selected (optional)')).toBeDefined()
    expect(within(cards[2]).getByText('length 3 · extension 2 · 20.0 ppm · max 50 tags')).toBeDefined()
  })
})

describe('Setup: hidden dependent fields', () => {
  it('species settings stay hidden until the switch is on, which says what it turns on', async () => {
    const mock = installMockBridge()
    await renderApp(mock) // FASTag defaults: species off
    await openSection('Species detection')
    const hiddenField = (n: string): boolean => !!field(n)?.closest('[hidden]')
    expect(hiddenField('species_rank')).toBe(true)
    expect(hiddenField('taxdb')).toBe(true)
    expect(screen.queryByRole('combobox', { name: /Species rank/ })).toBeNull()
    expect(document.getElementById('h-species')!.textContent).toMatch(/Turns on 11 settings\.$/)
    await click(field('species')!)
    expect(hiddenField('species_rank')).toBe(false)
    expect(field('species_rank')!.disabled).toBe(false)
    expect(document.getElementById('h-species')!.textContent).not.toMatch(/Turns on/)
  })

  // Beside setup.app.test "an inert field keeps its description and names
  // what it needs" (isobaric_tolerance, now also hidden until fasta): a field
  // that waits for something other than its section's switch is shown.
  it('a field waiting for a non-switch option keeps its description and names what it needs', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await openSection('Digest and labels')
    const help = document.getElementById('h-digest_window')!
    expect(help.textContent).toMatch(/^Mass window around a residue/)
    expect(help.textContent).toMatch(/Needs -?digest_out or -?label_out/)
    expect(field('digest_window')!.disabled).toBe(true)
  })

  it('the parameter search opens a hidden field at its switch', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await click(screen.getByRole('button', { name: /Search…/ }))
    const box = await screen.findByRole('combobox', { name: /Search parameters/ })
    await change(box, 'species_rank')
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' })
    })
    await waitFor(() => expect(document.activeElement).toBe(field('species')))
  })

  it('a native view menu closes search instead of leaving a modal over a hidden form', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await click(screen.getByRole('button', { name: /Search…/ }))
    expect(screen.getByRole('dialog', { name: 'Search parameters' })).toBeDefined()
    await act(async () => mock.emitMenu('view-results'))
    expect(screen.queryByRole('dialog', { name: 'Search parameters' })).toBeNull()
    await click(screen.getByRole('button', { name: /^Setup$/ }))
    expect(screen.queryByRole('dialog', { name: 'Search parameters' })).toBeNull()
  })
})

describe('Setup: the plan footer', () => {
  it('explains an empty output at the field and Run, then clears the error when repaired', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    mock.nextPickInput = '/d/run01.mzML'
    await click(screen.getByRole('button', { name: 'Choose file…' }))
    const output = document.getElementById('out')!
    await change(output, '')
    expect(output.getAttribute('aria-invalid')).toBe('true')
    expect(runButton().hasAttribute('disabled')).toBe(true)
    expect(runButton().getAttribute('aria-describedby')).toContain('run-output-required')
    expect(screen.getByText('Choose where to save the tags TSV in Output before running.')).toBeDefined()
    await change(output, '/d/repaired.tsv')
    expect(output.getAttribute('aria-invalid')).toBe('false')
    expect(runButton().hasAttribute('disabled')).toBe(false)
  })

  it('says what the run does and how far the form differs from where it started', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    mock.nextPickInput = '/d/run01.mzML'
    await click(screen.getByRole('button', { name: 'Choose file…' }))
    expect(within(footer()).getByText('1 file · 10% of spectra · species on · digest+label+glyco · out: beside input')).toBeDefined()
    expect(footer().textContent).toContain('Same as Characterize a run')
    await change(field('tag_length')!, '4')
    await change(field('max_tags')!, '20')
    expect(footer().textContent).toContain('Differs from Characterize a run: 2')
    await click(within(footer()).getByRole('button', { name: 'Reset to Characterize a run' }))
    expect(field('tag_length')!.value).toBe('3')
    expect(footer().textContent).toContain('Same as Characterize a run')
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
    expect(await within(footer()).findByRole('status')).toHaveProperty('textContent', 'INI written: run01.ini. Run it with FASTag -ini run01.ini')
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
  it('a preset saved from a task stores its diff over the task, without paths', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    mock.nextPickInput = '/data/run01.mzML'
    await click(screen.getByRole('button', { name: 'Choose file…' }))
    await change(field('tag_length')!, '4')
    await openSection('Sequence matching')
    await change(field('fasta')!, '/data/db/human.fasta')
    await click(screen.getByRole('button', { name: 'Save…' }))
    expect(screen.getByText(/Paths are not saved: fasta/)).toBeDefined()
    await change(screen.getByLabelText('Preset name'), 'Mine')
    await click(screen.getByRole('button', { name: 'Save' }))
    expect(mock.settings.presets['Mine']).toEqual({ v: 2, base: 'builtin:characterize', diff: { tag_length: '4' } })
    // Applied on another input, it is the task plus the diff, beside that input.
    await click(task(/^Export tags/))
    mock.nextPickInput = '/data/run02.mzML'
    await click(screen.getByRole('button', { name: 'Change…' }))
    await change(screen.getByLabelText('Preset'), 'Mine')
    expect(task(/^Characterize a run/).checked).toBe(true)
    expect(field('tag_length')!.value).toBe('4')
    expect(footer().textContent).toContain('Same as preset Mine')
    await click(runButton())
    expect(mock.runCalls[0].params.digest_out).toBe('/data/run02.digest.tsv')
    expect(mock.runCalls[0].params.species).toBe(true)
  })

  it('a preset the settings file refuses is not taken for saved', async () => {
    const mock = installMockBridge()
    mock.settingsWritable = false
    await renderColdApp(mock)
    await change(field('tag_length')!, '4')
    await click(screen.getByRole('button', { name: 'Save…' }))
    await change(screen.getByLabelText('Preset name'), 'Mine')
    await click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert').textContent).toMatch(/“Mine” could not be saved: the settings file cannot be written/)
    expect(mock.settings.presets['Mine']).toBeUndefined()
    // The name stays open to retry or cancel; the origin is still the task.
    expect(screen.getByLabelText('Preset name')).toBeDefined()
    await click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect((screen.getByLabelText('Preset') as HTMLSelectElement).value).toBe('builtin:characterize')
    expect(footer().textContent).not.toContain('preset Mine')
    expect((screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('a preset the settings file refuses to delete stays the origin', async () => {
    const mock = installMockBridge()
    mock.settings.presets = { kept: { v: 2, base: 'defaults', diff: { tag_length: '6' } } }
    await renderColdApp(mock)
    await change(screen.getByLabelText('Preset'), 'kept')
    mock.settingsWritable = false
    await click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('alert').textContent).toMatch(/“kept” could not be deleted/)
    expect((screen.getByLabelText('Preset') as HTMLSelectElement).value).toBe('kept')
    expect(footer().textContent).toContain('preset kept')
  })

  it('a v1 preset (a full record) applies as it always did', async () => {
    const mock = installMockBridge()
    mock.settings.presets = { old: { tag_length: '6', fragment_tolerance: '0.3', fragment_tolerance_unit: 'Da', species: false } }
    await renderColdApp(mock)
    await change(screen.getByLabelText('Preset'), 'old')
    expect(field('tag_length')!.value).toBe('6')
    expect((document.getElementById('p-fragment_tolerance_unit') as HTMLSelectElement).value).toBe('Da')
    // Over the defaults, as it was saved: not over the landing task.
    await openSection('Output')
    await openSection('Glycopeptides')
    expect(field('glyco')!.checked).toBe(false)
  })
})
