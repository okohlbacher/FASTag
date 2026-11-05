// @ts-nocheck -- test-only file; uses node APIs and ES2022 helpers outside the app tsconfig
// The app as a user drives it (vite + mock bridge): run inputs, presets,
// batches and the tags filter.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../App'
import ResultsTable from '../ResultsTable'
import { installMockBridge, type MockBridge } from '../testing/mockBridge'

async function renderApp(mock: MockBridge): Promise<HTMLElement> {
  const { container } = render(<App />)
  await screen.findByText('FASTag ready')
  await act(async () => {})
  return container
}
const click = (el: Element): Promise<void> =>
  act(async () => {
    fireEvent.click(el)
  })
const change = (el: Element, value: string): Promise<void> =>
  act(async () => {
    fireEvent.change(el, { target: { value } })
  })
const runButton = (): HTMLElement => screen.getByRole('button', { name: /^(Run( on .+)?|Running…)$/ })
const field = (c: HTMLElement, name: string): HTMLInputElement =>
  c.querySelector(`#p-${name}`) as HTMLInputElement
const openSection = async (title: string): Promise<void> => {
  const b = screen.getAllByRole('button').find((x) => x.classList.contains('disclosure') && x.textContent?.includes(title))!
  if (b.getAttribute('aria-expanded') !== 'true') await click(b)
}
async function pick(mock: MockBridge, path: string): Promise<void> {
  mock.nextPickInput = path
  await click(screen.getByRole('button', { name: /^(Choose file|Change)…$/ }))
}
const done = (mock: MockBridge, ok = true, code: number | null = ok ? 0 : 1): Promise<void> =>
  act(async () => mock.emitDone({ runId: mock.lastRunId, ok, code, message: null }))

describe('live: run inputs', () => {
  it('a preset\'s report paths are rebased onto the input chosen before it', async () => {
    const mock = installMockBridge()
    const c = await renderApp(mock)
    await pick(mock, '/r/A.mzML')
    await openSection('Digest and labels')
    await change(field(c, 'digest_out'), '/r/A.digest.tsv')
    await click(screen.getByRole('button', { name: 'Save…' }))
    await change(screen.getByLabelText('Preset name'), 'Lab default')
    await click(screen.getByRole('button', { name: 'Save' }))
    await pick(mock, '/r/B.mzML')
    expect(field(c, 'digest_out').value).toBe('/r/B.digest.tsv') // rebased: fine
    await change(screen.getByLabelText('Preset'), '')
    await change(screen.getByLabelText('Preset'), 'Lab default')
    await click(runButton())
    expect(mock.runCalls.at(-1)!.in).toBe('/r/B.mzML')
    // B's run writes B's report, not over A's.
    expect(mock.runCalls.at(-1)!.params.digest_out).toBe('/r/B.digest.tsv')
  })

  it('with a batch queue shown, the single Run is disabled', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await pick(mock, '/r2/sampleB.mzML')
    mock.nextPickInputs = ['/d/a.mzML', '/d/b.mzML']
    await click(screen.getByRole('button', { name: /^(Add files for a batch|Add)…$/ }))
    expect(screen.queryByLabelText(/Tags TSV/)).toBeNull()
    expect(screen.queryByText('/r2/sampleB.mzML')).toBeNull()
    expect(screen.queryByText('sampleB.mzML')).toBeNull()
    // No single Run at all behind the queue.
    expect(screen.queryByRole('button', { name: /^(Run( on .+)?|Running…)$/ })).toBeNull()
    expect(mock.runCalls).toHaveLength(0)
  })

  it('an invalid number typed into a field is marked, and Run stays disabled', async () => {
    const mock = installMockBridge()
    const c = await renderApp(mock)
    await pick(mock, '/r/A.mzML')
    await openSection('Spectra')
    await change(field(c, 'max_peaks'), '-5') // range [0:1024]
    await change(field(c, 'tag_length'), '1e3') // int: CLI rc 6 ConversionError
    expect(field(c, 'max_peaks').getAttribute('aria-invalid')).toBe('true')
    expect(field(c, 'tag_length').getAttribute('aria-invalid')).toBe('true')
    expect((runButton() as HTMLButtonElement).disabled).toBe(true)
    await click(runButton())
    expect(mock.runCalls).toHaveLength(0)
  })

  it('species with tag_length 3 against a k=7 index: Run is disabled and the reason sits next to the form, as the CLI refuses with rc 6', async () => {
    const mock = installMockBridge()
    mock.taxdbInfoResult = { path: '/t/tax_k7.taxdb', k: 7 }
    const c = await renderApp(mock)
    await pick(mock, '/r/A.mzML')
    await openSection('Species detection')
    await click(field(c, 'species'))
    expect((runButton() as HTMLButtonElement).disabled).toBe(true)
    expect(c.querySelector('.controls .warn')!.textContent).toMatch(/cannot reach the species index k = 7/)
    await click(screen.getByRole('tab', { name: /Species/ }))
    expect(c.querySelector('.tabpanel')!.textContent).toContain('FASTag refuses the run')
  })
})

describe('live: failure and stale results', () => {
  it('the failure banner quotes the ConversionError, not the --help dump after it', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await pick(mock, '/r/A.mzML')
    await click(runButton())
    await act(async () => {
      for (const l of [
        "Invalid parameter values (ConversionError): Prefix of string '1e3' successfully converted to an int32 value. Additional characters found at position 2. Aborting!",
        'FASTag -- Infers partial sequence tags from MS/MS spectra.',
        '  --helphelp                       Shows all options (including advanced)'
      ])
        mock.emitLog(l)
    })
    await done(mock, false, 6)
    expect(screen.getByRole('alert').textContent).not.toContain('--helphelp')
    expect(screen.getByRole('alert').textContent).toContain('ConversionError')
  })

  it('after B fails, the Species tab no longer shows A\'s taxa and names B; a species-off run has no badge', async () => {
    const mock = installMockBridge()
    mock.speciesResult = {
      path: '/s/A.tags.species.tsv',
      empty: false,
      taxa: [{ rank: 'genus', taxid: 561, name: 'Escherichia', observed: 25, adjusted: 25, expected: 1, logP: -70, q: 1e-29 }]
    }
    const c = await renderApp(mock)
    await pick(mock, '/s/A.mzML')
    await openSection('Species detection')
    await click(field(c, 'species'))
    await change(field(c, 'tag_length'), '7')
    await click(runButton())
    await done(mock)
    await waitFor(() => expect(screen.getByRole('tab', { name: /Species/ }).getAttribute('aria-selected')).toBe('true'))
    await pick(mock, '/s/B.mzML')
    await click(runButton())
    await done(mock, false)
    await click(screen.getByRole('tab', { name: /Species/ }))
    expect(c.querySelector('.tabpanel')!.textContent).not.toContain('Escherichia')
    expect(c.querySelector('.tabpanel')!.textContent).toContain('B.mzML')
    await click(field(c, 'species'))
    await click(runButton())
    await done(mock)
    expect(screen.getByRole('tab', { name: /Species/ }).textContent).toBe('Species')
  })

  it('after a run, permanent controls open another tags TSV or a report', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    expect(screen.getByRole('button', { name: /Open a tags TSV/ })).toBeTruthy()
    await pick(mock, '/r/A.mzML')
    await click(runButton())
    await done(mock)
    await waitFor(() => expect(mock.resultsQueryCalls.length).toBeGreaterThan(0))
    expect(screen.queryByRole('button', { name: /Open a tags TSV/ })).toBeNull() // the empty-pane link
    mock.nextPickResults = '/r/other.tags.tsv'
    await click(screen.getByRole('button', { name: 'Open tags…' }))
    await waitFor(() => expect(mock.resultsQueryCalls.at(-1)!.path).toBe('/r/other.tags.tsv'))
    expect(screen.getByRole('button', { name: 'Open report…' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Digest/ })).toBeTruthy()
  })

  it('a file picked twice in one batch dialog is queued once', async () => {
    const mock = installMockBridge()
    const c = await renderApp(mock)
    mock.nextPickInputs = ['/d/a.mzML', '/d/a.mzML']
    await click(screen.getByRole('button', { name: /^(Add files for a batch|Add)…$/ }))
    expect(c.querySelectorAll('li.job').length).toBe(1)
  })
})

describe('live: tags filter', () => {
  it('a decimal-comma E-value filter is read as a decimal', async () => {
    const mock = installMockBridge()
    render(<ResultsTable path="/r/A.tags.tsv" />)
    const ev = await screen.findByLabelText('Max. E-value')
    await change(ev, '0,005')
    await act(async () => {
      fireEvent.keyDown(ev, { key: 'Enter' })
    })
    await waitFor(() => expect(mock.resultsQueryCalls.length).toBeGreaterThan(1))
    expect(mock.resultsQueryCalls.at(-1)!.view.maxEvalue).toBe(0.005)
    expect((ev as HTMLInputElement).value).toBe('0,005')
    expect(ev.getAttribute('aria-invalid')).toBeNull()
  })

  it('a negative min length is marked invalid and never reaches the backend (ViewSpec is Option<u32>)', async () => {
    const mock = installMockBridge()
    render(<ResultsTable path="/r/A.tags.tsv" />)
    const ml = await screen.findByLabelText('Min. length')
    await change(ml, '-1')
    await act(async () => {
      fireEvent.keyDown(ml, { key: 'Enter' })
    })
    await waitFor(() => expect(ml.getAttribute('aria-invalid')).toBe('true'))
    expect(mock.resultsQueryCalls.some((c) => c.view.minLength === -1)).toBe(false)
  })
})
