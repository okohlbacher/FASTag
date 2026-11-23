// The Setup wizard in the app (doc/GUI-SETUP-WIZARD.md): selecting is not
// choosing, the steps and their focus, the inputs each task asks for, the
// carry-over of a form replacement, and the short paths (Cmd+Enter on step
// 1, a changed input from any step, presets without a file).

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installMockBridge } from '../testing/mockBridge'
import { shellLine } from '../app/format'
import { chooseTask, click, currentStep, flush, goTo, key, renderApp, renderColdApp, runButton, showStep } from '../testing/render'

const field = (n: string): HTMLInputElement | null => document.getElementById(`p-${n}`) as HTMLInputElement | null
const change = (el: Element, value: string): Promise<void> => act(async () => void fireEvent.change(el, { target: { value } }))
const tile = (id: string): HTMLElement => document.querySelector<HTMLElement>(`button.task-tile[data-task="${id}"]`)!
const stepBtn = (n: number): HTMLElement => document.querySelector<HTMLElement>(`nav[aria-label="Setup steps"] button[data-step-btn="${n}"]`)!
/// Open Advanced in step 3 until the field of @p name is built (each
/// group's body is built only while open).
const openAdvanced = (name: string): Promise<void> => openAdvancedTo(`p-${name}`)
const openAdvancedTo = async (id: string): Promise<void> => {
  showStep(3)
  for (let i = 0; i < 4 && !document.querySelector(`[data-step="3"] #${id}`); i++) {
    const closed = [...document.querySelectorAll<HTMLElement>('[data-step="3"] summary')].filter((e) => !(e.parentElement as HTMLDetailsElement).open)
    if (!closed.length) break
    for (const c of closed) await click(c)
  }
}
const addInput = (name: string): Promise<void> => change(screen.getByRole('combobox', { name: 'Add optional input' }), name)

describe('wizard: step 1', () => {
  it('opens on step 1 with nothing confirmed; steps 2-4 are locked but keep focus', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    expect(currentStep()).toBe(1)
    for (const n of [2, 3, 4]) {
      expect(stepBtn(n).getAttribute('aria-disabled')).toBe('true')
      expect(stepBtn(n).hasAttribute('disabled')).toBe(false)
      expect(document.getElementById(stepBtn(n).getAttribute('aria-describedby')!)!.textContent).toBe('Choose a task first')
    }
    await click(stepBtn(3))
    expect(currentStep()).toBe(1)
    // No run bar until a task is confirmed.
    expect(document.querySelector('.view-setup .runbar')).toBeNull()
  })

  it('tiles are buttons in lists under their group; arrows move focus, Enter continues', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    const groups = [...document.querySelectorAll('.task-group h3')].map((h) => h.textContent)
    expect(groups).toEqual(['Look at the tags', 'Learn about the sample', 'Check run quality'])
    expect(tile('export-tags').closest('ul')).not.toBeNull()
    expect(tile('export-tags').getAttribute('role')).toBeNull()
    act(() => tile('export-tags').focus())
    fireEvent.keyDown(tile('export-tags'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tile('characterize'))
    // Focus selects (the detail panel), it does not choose.
    expect(screen.getByRole('region', { name: /Characterize a run/ }).textContent).toMatch(/protease, labels, glycopeptides and species/)
    expect(stepBtn(2).getAttribute('aria-disabled')).toBe('true')
    await act(async () => void fireEvent.keyDown(tile('characterize'), { key: 'Enter' }))
    expect(currentStep()).toBe(2)
    expect(tile('characterize').getAttribute('aria-current')).toBe('true')
    expect(stepBtn(1).textContent).toMatch(/Task: Characterize a run/)
    expect(document.activeElement?.id).toBe('step-h-2')
    expect(screen.getByText('Step 2 of 4: Inputs')).toBeDefined()
  })

  it('Cmd+Enter on step 1 confirms the selected tile and, without a file, opens Inputs', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await click(tile('species'))
    await key({ key: 'Enter', ctrlKey: true })
    await flush()
    expect(tile('species').getAttribute('aria-current')).toBe('true')
    expect(currentStep()).toBe(2)
    expect(mock.runCalls).toHaveLength(0)
  })

  it('a file chosen on a fresh launch confirms the selected tile (File > Open, a drop)', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    mock.nextPickInput = '/d/run01.mzML'
    await act(async () => mock.emitMenu('open-spectra'))
    await flush()
    expect(currentStep()).toBe(2)
    expect(tile('export-tags').getAttribute('aria-current')).toBe('true')
    expect((runButton() as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('wizard: inputs per task', () => {
  it('Generate tags asks for no FASTA; the Filter database is one click away, with its effect', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await chooseTask('Generate tags')
    expect(field('recon_fasta')).toBeNull()
    expect(field('fasta')).toBeNull()
    const menu = screen.getByRole('combobox', { name: 'Add optional input' })
    expect([...menu.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Choose…', 'Filter database: Removes tags not found in these proteins.'])
    await addInput('fasta')
    expect(document.activeElement).toBe(field('fasta'))
    await change(field('fasta')!, '/d/h.fasta')
    // The setting that waits on it only (Shortest tag matched) shows under it.
    expect(field('min_filter_length')).not.toBeNull()
    expect(field('min_filter_length')!.closest('[data-step]')!.getAttribute('data-step')).toBe('2')
    const menu2 = screen.getByRole('combobox', { name: 'Add optional input' })
    expect([...menu2.querySelectorAll('option')].map((o) => o.value)).toEqual(['', 'entrapment_fasta'])
    await click(screen.getByRole('button', { name: 'Remove Filter database' }))
    expect(field('fasta')).toBeNull()
  })

  it('Mass-shift survey requires the protein database: said at the field once Next was tried; a wrong extension warns', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await chooseTask('Mass-shift survey')
    expect(field('recon_fasta')).not.toBeNull()
    expect(screen.queryByText(/^Required for Mass-shift survey: choose a protein FASTA/)).toBeNull()
    expect(stepBtn(2).closest('li')!.className).toMatch(/blocked/)
    expect(document.querySelector('.still-missing')!.textContent).toBe('Still missing: spectra, Protein database')
    await click(screen.getByRole('button', { name: 'Next: Settings ›' }))
    // Next is never a dead end: Settings opens; Inputs shows its errors.
    expect(currentStep()).toBe(3)
    showStep(2)
    expect(screen.getByText('Required for Mass-shift survey: choose a protein FASTA.')).toBeDefined()
    await change(field('recon_fasta')!, '/d/proteins.txt')
    expect(screen.getByText('proteins.txt is not a FASTA file (.fasta, .fa, .faa).')).toBeDefined()
  })

  it('an input file that is not on disk blocks Run, with a link to Inputs', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await chooseTask('Mass-shift survey')
    mock.nextPickInput = '/d/run01.mzML'
    await click(screen.getByRole('button', { name: 'Choose file…' }))
    await change(field('recon_fasta')!, '/d/missing.fasta')
    await waitFor(() => expect(screen.getByText('Not found: /d/missing.fasta')).toBeDefined())
    expect((runButton() as HTMLButtonElement).disabled).toBe(true)
    showStep(4)
    await click(screen.getByRole('button', { name: 'Go to Inputs' }))
    expect(currentStep()).toBe(2)
  })

  it.each([
    ['Run QC', 'fasta', null],
    // The alkylation report reads the Protein database if one is given (review decision 5).
    ['Characterize a run', 'recon_fasta', 'alkylation_out']
  ] as const)('a database set under Advanced (%s, %s) leaves Inputs clean: no "Also set", no "!"', async (task, n, report) => {
    {
      const mock = installMockBridge()
      await renderColdApp(mock)
      await chooseTask(task)
      mock.nextPickInput = '/d/run01.mzML'
      await click(screen.getByRole('button', { name: 'Choose file…' }))
      if (report) {
        showStep(4)
        await click(document.getElementById(`out-${report}`)!)
      }
      await openAdvanced(n)
      const f = field(n)!
      expect(Number(f.closest<HTMLElement>('[data-step]')!.dataset.step), `${task} ${n}`).toBe(3)
      await change(f, '/d/human.fasta')
      expect(stepBtn(2).closest('li')!.className, task).not.toMatch(/blocked/)
      expect(screen.queryByRole('heading', { name: 'Also set' }), task).toBeNull()
    }
  })

  it('Characterize with Tag placements turned on under Advanced: the protein database becomes a required input; the hint leads to it', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await chooseTask('Characterize a run')
    mock.nextPickInput = '/d/run01.mzML'
    await click(screen.getByRole('button', { name: 'Choose file…' }))
    expect(field('recon_fasta')).toBeNull()
    await openAdvancedTo('out-recon_out')
    await click(document.getElementById('out-recon_out')!)
    expect((runButton() as HTMLButtonElement).disabled).toBe(true)
    // Inputs is the step to fix, and shows the field there.
    expect(stepBtn(2).closest('li')!.className).toMatch(/blocked/)
    expect(Number(field('recon_fasta')!.closest<HTMLElement>('[data-step]')!.dataset.step)).toBe(2)
    expect(document.querySelectorAll('#p-recon_fasta')).toHaveLength(1)
    showStep(4)
    await click(screen.getByRole('button', { name: 'choose it in Inputs' }))
    expect(currentStep()).toBe(2)
    expect(document.querySelector('.still-missing')!.textContent).toBe('Still missing: Protein database')
    expect(document.querySelector('[data-step="2"] .lead')!.textContent).toBe('Characterize a run needs spectra; optional: your taxonomy. Also required for Tag placements: a protein FASTA.')
    await change(field('recon_fasta')!, '/d/human.fasta')
    expect(stepBtn(2).closest('li')!.className).not.toMatch(/blocked/)
    expect((runButton() as HTMLButtonElement).disabled).toBe(false)
    // Turned off again: the field goes back under Advanced, with its value.
    await openAdvancedTo('out-recon_out')
    await click(document.getElementById('out-recon_out')!)
    expect(Number(field('recon_fasta')!.closest<HTMLElement>('[data-step]')!.dataset.step)).toBe(3)
    expect(field('recon_fasta')!.value).toBe('/d/human.fasta')
  })

  it('a refusal leads to the step where its field is for the task: the entrapment database under Advanced in Species', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await chooseTask('Species')
    mock.nextPickInput = '/d/run01.mzML'
    await click(screen.getByRole('button', { name: 'Choose file…' }))
    await openAdvanced('fasta')
    await change(field('fasta')!, '/d/human.fasta')
    await openAdvanced('entrapment_fasta')
    await change(field('entrapment_fasta')!, '/d/entrap.fasta')
    expect((runButton() as HTMLButtonElement).disabled).toBe(true)
    showStep(2)
    expect(screen.queryByRole('button', { name: 'Go to Inputs' })).toBeNull()
    await click(screen.getByRole('button', { name: 'Go to Settings' }))
    expect(currentStep()).toBe(3)
    expect(field('entrapment_fasta')!.closest<HTMLElement>('[data-step]')!.dataset.step).toBe('3')
  })

  it('Species offers only the taxonomy, as one set of three files; Remove clears all three', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await chooseTask('Species')
    const menu = screen.getByRole('combobox', { name: 'Add optional input' })
    expect([...menu.querySelectorAll('option')].map((o) => o.value)).toEqual(['', 'taxdb'])
    await addInput('taxdb')
    for (const n of ['taxdb', 'taxonomy_nodes', 'taxonomy_names']) expect(field(n)).not.toBeNull()
    await change(field('taxdb')!, '/t/x.taxdb')
    await click(screen.getByRole('button', { name: 'Remove Your taxonomy' }))
    for (const n of ['taxdb', 'taxonomy_nodes', 'taxonomy_names']) expect(field(n)).toBeNull()
  })

  it('About these spectra: the instrument and fixed modifications in step 2; an ion trap warns for Species', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await chooseTask('Species')
    const about = screen.getByRole('region', { name: 'About these spectra' })
    expect(within(about).getByLabelText(/^Instrument/)).toBeDefined()
    expect(about.textContent).toMatch(/Was the sample alkylated\?/)
    await change(document.getElementById('instrument')!, 'iontrap-cid')
    expect(about.textContent).toMatch(/Species calls are unreliable on ion-trap spectra/)
    // The plan line names the assumptions, from every step.
    expect(document.querySelector('.plan-assume')!.textContent).toBe('Assumes: Ion trap CID 0.3 Da · Carbamidomethyl (C)')
  })
})

describe('wizard: changing the task and loading settings', () => {
  it('a protein database survives Mass-shift survey → Database reduction, Reset and a preset; Species drops it, Undo brings it back', async () => {
    const mock = installMockBridge()
    mock.settings.presets = { Mine: { v: 2, base: 'builtin:db-reduction', diff: { shortlist_top: '50' } } }
    await renderColdApp(mock)
    await chooseTask('Mass-shift survey')
    await change(field('recon_fasta')!, '/d/h.fasta')
    await chooseTask('Database reduction')
    expect(field('recon_fasta')!.value).toBe('/d/h.fasta')
    expect(document.querySelector('.carried')!.textContent).toMatch(/^Kept: Protein database\./)
    // Reset keeps the inputs.
    showStep(3)
    await change(document.getElementById('p-variable_modifications')!, 'Oxidation (M)')
    await click(screen.getByRole('button', { name: 'Reset to Database reduction' }))
    expect(field('recon_fasta')!.value).toBe('/d/h.fasta')
    // So does a preset (presets hold no paths), loaded from Settings: it stays there.
    await change(document.getElementById('origin')!, 'Mine')
    expect(currentStep()).toBe(3)
    expect(field('recon_fasta')!.value).toBe('/d/h.fasta')
    await chooseTask('Species')
    expect(document.querySelector('.carried')!.textContent).toMatch(/Dropped for Species: Protein database\./)
    await click(within(document.querySelector('.carried') as HTMLElement).getByRole('button', { name: 'Undo' }))
    expect(tile('db-reduction').getAttribute('aria-current')).toBe('true')
    expect(field('recon_fasta')!.value).toBe('/d/h.fasta')
  })

  it('a changed instrument stays across a task change; the wizard returns to the step it came from', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await chooseTask('Species')
    mock.nextPickInput = '/d/run01.mzML'
    await click(screen.getByRole('button', { name: 'Choose file…' }))
    await change(document.getElementById('instrument')!, 'timstof')
    showStep(3)
    await chooseTask('Characterize a run')
    expect(currentStep()).toBe(3)
    expect((document.getElementById('instrument') as HTMLSelectElement).value).toBe('timstof')
    expect(document.querySelector('.carried')!.textContent).toMatch(/^Kept: instrument\./)
  })

  it('Mass-shift survey without a file: Settings, Save as preset, Export INI', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await chooseTask('Mass-shift survey')
    await click(stepBtn(3))
    expect(currentStep()).toBe(3)
    await change(document.getElementById('origin')!, '__save')
    await change(screen.getByRole('textbox', { name: 'Preset name' }), 'Survey')
    await click(screen.getByRole('button', { name: 'Save' }))
    expect(mock.settings.presets['Survey']).toMatchObject({ v: 2, base: 'builtin:mass-shift' })
    mock.nextPickOutput = '/d/survey.ini'
    await click(screen.getByRole('button', { name: 'Export INI…' }))
    await waitFor(() => expect(mock.exportIniCalls).toHaveLength(1))
  })
})

describe('wizard: short paths', () => {
  it('run, back to Setup, Change spectra…, Run: two actions in Setup', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await chooseTask('Generate tags')
    mock.nextPickInput = '/d/run01.mzML'
    await click(screen.getByRole('button', { name: 'Choose file…' }))
    showStep(4)
    await click(runButton())
    await act(async () => mock.emitDone({ ok: true, code: 0, runId: mock.lastRunId }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Running' })).toBeNull())
    await goTo('setup')
    // The step is kept across the run.
    expect(currentStep()).toBe(4)
    mock.nextPickInput = '/d/run02.mzML'
    await click(screen.getByRole('button', { name: 'Change spectra…' }))
    await click(runButton())
    expect(mock.runCalls.map((c) => c.in)).toEqual(['/d/run01.mzML', '/d/run02.mzML'])
  })

  it('Alt+Right moves to the next step, but not while typing in a field', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    expect(currentStep()).toBe(2)
    fireEvent.keyDown(document.getElementById('step-h-2')!, { key: 'ArrowRight', altKey: true })
    expect(currentStep()).toBe(3)
    fireEvent.keyDown(field('tag_length')!, { key: 'ArrowRight', altKey: true })
    expect(currentStep()).toBe(3)
  })

  it('the command preview of step 4 is the command line Run starts', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    mock.nextPickInput = '/d/run01.mzML'
    await click(screen.getByRole('button', { name: 'Choose file…' }))
    showStep(4)
    const pre = await screen.findByLabelText('The command line Run starts')
    await waitFor(() => expect(pre.textContent).toMatch(/run01\.mzML/))
    await click(runButton())
    expect(pre.textContent).toBe(shellLine(mock.commandOf(mock.runCalls[0])))
  })

  it('Add to batch queues the file with the same settings; Identifications keep it out', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await chooseTask('Identifiability triage')
    mock.nextPickInput = '/d/run01.mzML'
    await click(screen.getByRole('button', { name: 'Choose file…' }))
    await addInput('census_ids')
    await change(field('census_ids')!, '/d/run01.idXML')
    showStep(4)
    expect((screen.getByRole('button', { name: 'Add to batch' }) as HTMLButtonElement).disabled).toBe(true)
    showStep(2)
    await click(screen.getByRole('button', { name: 'Remove Identifications' }))
    showStep(4)
    await click(screen.getByRole('button', { name: 'Add to batch' }))
    await flush()
    expect(document.querySelectorAll('.view[data-view="batch"] li.job')).toHaveLength(1)
  })
})
