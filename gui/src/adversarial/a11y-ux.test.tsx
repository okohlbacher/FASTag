// @ts-nocheck -- test-only file; uses node APIs and ES2022 helpers outside the app tsconfig
// Accessibility and usability: roles, names, focus, announcements and the
// wording of the form, the tables and the reports.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import ResultsTable from '../ResultsTable'
import DigestPanel from '../DigestPanel'
import SpeciesPanel from '../SpeciesPanel'
import ParamField from '../ParamField'
import { PARAM_BY_NAME } from '../paramLayout'
import { parseReport } from '../digestReport'
import { installMockBridge } from '../testing/mockBridge'
import { click, flush, renderApp } from '../testing/render'
import digestTsv from '../fixtures/digest.tsv?raw'
import labelTsv from '../fixtures/label.tsv?raw'

afterEach(() => vi.restoreAllMocks())

describe('a11y: tags browser (ResultsTable)', () => {
  it('a read-only table, not a grid; sort state and a plain name sit on its columnheader; the scroller is focusable and the count a status', async () => {
    const mock = installMockBridge()
    mock.resultsColumns = ['spectrum', 'tag', 'evalue']
    mock.resultsRows = [['controllerType=0 controllerNumber=1 scan=11482', 'ADGWAQA', '4.17011e-08']]
    const { container } = render(<ResultsTable path="/x.tags.tsv" />)
    await flush()
    const head = screen.getByRole('button', { name: 'Spectrum' })
    await click(head)
    // aria-sort is only defined on columnheader/rowheader, so it is not on the button.
    expect(head.hasAttribute('aria-sort')).toBe(false)
    // role=table: the cells are read-only, and a grid would promise arrow-key cell navigation.
    expect(screen.queryByRole('grid')).toBeNull()
    expect(screen.getByRole('table')).toBeDefined()
    const heads = screen.getAllByRole('columnheader')
    expect(heads).toHaveLength(3)
    expect(heads[0].getAttribute('aria-sort')).toBe('ascending')
    // Named by the label alone: not "spectrum▴ Resize column spectrum".
    expect(screen.getByRole('columnheader', { name: 'Spectrum' })).toBe(heads[0])
    expect(heads[0].querySelector('.dir')?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getAllByRole('row')).toHaveLength(2)
    // The scroller takes focus, so PageUp/PageDown page the rows.
    const scroller = container.querySelector('.rt-scroll') as HTMLElement
    expect(scroller.getAttribute('tabindex')).toBe('0')
    // The matched count is a live region: filtering is announced.
    const status = container.querySelector('.rt-status') as HTMLElement
    expect(status.getAttribute('role')).toBe('status')
  })

  it('a decimal comma in "max evalue" is read; a non-numeric value is marked invalid', async () => {
    const mock = installMockBridge()
    mock.resultsColumns = ['spectrum', 'evalue']
    mock.resultsRows = [['a', '0.5'], ['b', '0.001']]
    render(<ResultsTable path="/x.tags.tsv" />)
    await flush()
    const box = screen.getByLabelText('Max. E-value')
    await act(async () => {
      fireEvent.change(box, { target: { value: '0,01' } })
      fireEvent.keyDown(box, { key: 'Enter' })
    })
    let last = mock.resultsQueryCalls[mock.resultsQueryCalls.length - 1]
    expect(last.view.maxEvalue).toBe(0.01)
    expect((box as HTMLInputElement).getAttribute('aria-invalid')).toBeNull()
    await act(async () => {
      fireEvent.change(box, { target: { value: 'abc' } })
      fireEvent.keyDown(box, { key: 'Enter' })
    })
    last = mock.resultsQueryCalls[mock.resultsQueryCalls.length - 1]
    expect(last.view.maxEvalue).toBeNull()
    expect((box as HTMLInputElement).getAttribute('aria-invalid')).toBe('true')
  })
})

describe('a11y: run feedback in App', () => {
  it('the progress bar is a progressbar, and an always-exposed status announces start and end', async () => {
    const mock = installMockBridge()
    const container = await renderApp(mock)
    mock.nextPickInput = '/data/a.mzML'
    await click(screen.getByRole('button', { name: /^(Choose file|Change)…$/ }))
    await click(screen.getByRole('button', { name: /^Run( on .+)?$/ }))
    await act(async () => { mock.emitProgress({ done: 50, total: 200 }) })
    expect(container.querySelector('.progress .fill')).not.toBeNull()
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('50')
    expect(bar.getAttribute('aria-valuemax')).toBe('200')
    const log = container.querySelector('pre.log') as HTMLElement
    expect(log.getAttribute('role')).toBe('log') // implicitly aria-live=polite
    // ...but the collapsed log is display:none, outside the accessibility
    // tree. The run bar's status is not hidden and says what happened.
    expect(log.hidden).toBe(true)
    const status = container.querySelector('.runbar > [role="status"]') as HTMLElement
    expect(status.closest('[hidden]')).toBeNull()
    expect(status.textContent).toBe('Run started on a.mzML.')
    await act(async () => { mock.emitLog('42092 MS2 spectra, 1130228 tags') })
    await act(async () => { mock.emitDone({ runId: mock.lastRunId, ok: true, code: 0, message: null }) })
    expect(status.textContent).toBe('Finished a.mzML: 1,130,228 tags.')
  })

  it('the log, the batch queue and the raw report rows are focusable scrollers', async () => {
    const mock = installMockBridge()
    const container = await renderApp(mock)
    const log = container.querySelector('pre#runlog') as HTMLElement
    expect(log.getAttribute('tabindex')).toBe('0')
    expect(log.getAttribute('aria-label')).toBe('Run log')
    mock.nextPickInputs = ['/d/a.mzML']
    await click(screen.getByRole('button', { name: /^(Add files for a batch|Add)…$/ }))
    const jobs = container.querySelector('ul.jobs') as HTMLElement
    expect(jobs.getAttribute('tabindex')).toBe('0')
    expect(jobs.getAttribute('aria-labelledby')).toBe('batch-label')
    render(<DigestPanel reports={[parseReport(labelTsv, '/d/a.label.tsv')]} errors={[]} onOpen={() => {}} />)
    const raw = screen.getByRole('region', { name: 'Report rows' })
    expect(raw.getAttribute('tabindex')).toBe('0')
  })

  it('focus returns to a control when the focused one disappears', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    const until = (el: () => Element | null): Promise<void> =>
      vi.waitFor(() => expect(document.activeElement).toBe(el()))
    await click(screen.getByRole('button', { name: 'Reset…' }))
    await click(screen.getByRole('button', { name: 'Keep' }))
    await until(() => screen.getByRole('button', { name: 'Reset…' }))
    await click(screen.getByRole('button', { name: 'Save…' }))
    await act(async () => { fireEvent.keyDown(screen.getByLabelText('Preset name'), { key: 'Escape' }) })
    await until(() => screen.getByLabelText('Preset'))
    mock.nextPickInputs = ['/d/a.mzML', '/d/b.mzML']
    await click(screen.getByRole('button', { name: /^(Add files for a batch|Add)…$/ }))
    await click(screen.getByRole('button', { name: 'Remove /d/a.mzML' }))
    await until(() => screen.getByRole('button', { name: 'Remove /d/b.mzML' }))
    await click(screen.getByRole('button', { name: 'Clear' }))
    await until(() => screen.getByRole('button', { name: /Add files for a batch/ }))
  })

  it('the elapsed time runs on between progress events, and Open tags/report are locked mid-run', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const mock = installMockBridge()
      const container = await renderApp(mock)
      mock.nextPickInput = '/data/a.mzML'
      await click(screen.getByRole('button', { name: /^(Choose file|Change)…$/ }))
      await click(screen.getByRole('button', { name: /^Run( on .+)?$/ }))
      expect((screen.getByRole('button', { name: 'Open tags…' }) as HTMLButtonElement).disabled).toBe(true)
      expect((screen.getByRole('button', { name: 'Open report…' }) as HTMLButtonElement).disabled).toBe(true)
      await act(async () => { mock.emitProgress({ done: 5, total: 100 }) })
      await act(async () => { vi.advanceTimersByTime(3200) })
      expect(container.querySelector('.progress .pct')?.textContent).toMatch(/0:0[3-4] elapsed/)
      await act(async () => { mock.emitDone({ runId: mock.lastRunId, ok: true, code: 0, message: null }) })
      expect((screen.getByRole('button', { name: 'Open tags…' }) as HTMLButtonElement).disabled).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('batch job status is announced, and the failure banner names the failed file', async () => {
    const mock = installMockBridge()
    const container = await renderApp(mock)
    mock.nextPickInputs = ['/d/a.mzML', '/d/b.mzML']
    await click(screen.getByRole('button', { name: /^(Add files for a batch|Add)…$/ }))
    await click(screen.getByRole('button', { name: /^Run \d+ remaining file/ }))
    await act(async () => { mock.emitDone({ runId: mock.lastRunId, ok: false, code: 6, message: null }) })
    await flush()
    await act(async () => { mock.emitDone({ runId: mock.lastRunId, ok: true, code: 0, message: null }) })
    await flush()
    const failed = container.querySelector('li.job.failed') as HTMLElement
    expect(failed).not.toBeNull()
    expect(failed.querySelector('.st')?.getAttribute('aria-hidden')).toBeNull()
    expect(within(failed).getByRole('img').getAttribute('aria-label')).toBe('failed')
    expect(screen.getByRole('alert').textContent).not.toMatch(/✕/)
    expect(screen.getByRole('alert').textContent).toMatch(/^1 of 2 batch jobs faileda\.mzML \(exit code 6\)/)
  })

  it('an active section\'s dot is an image with a name, so the section button announces it', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    // Species section is collapsed by default: open it first.
    await click(screen.getByRole('button', { name: /Species detection/ }))
    await click(screen.getByLabelText('Species species'))
    const sec = screen.getAllByRole('button', { expanded: true }).find((b) => /Species/.test(b.textContent ?? ''))!
    const dot = sec.querySelector('.on-dot')!
    expect(dot.getAttribute('role')).toBe('img')
    expect(dot.getAttribute('aria-label')).toBe('Species is on')
    expect(screen.getByRole('button', { name: /Species detection.*Species is on/ })).toBe(sec)
  })
})

describe('a11y/UX: number formatting', () => {
  it('under a German UI locale, counts and decimals in one column share one fixed format', () => {
    const orig = Number.prototype.toLocaleString
    vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function (this: number) {
      return orig.call(this, 'de-DE')
    })
    const text = labelTsv
      .replace(/^heavy\tK\.tags\t\d+/m, 'heavy\tK.tags\t1234')
      .replace(/^heavy\tK8\.share\t[^\t]+/m, 'heavy\tK8.share\t0.004')
    render(<DigestPanel reports={[parseReport(text, '/d/a.label.tsv')]} errors={[]} onOpen={() => {}} />)
    const table = screen.getByRole('columnheader', { name: 'Heavy SILAC label (Lys8, Arg10)' }).closest('table')!
    const cells = within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').map((c) => c.textContent))
    // The rows in words, a share as a percentage (not raw keys and '0').
    expect(cells).toContainEqual(['K8 share', '0.4%'])
    expect(cells).toContainEqual(['K tag ends', '1,234']) // a grouping comma, not a decimal-looking point
    expect(cells).toContainEqual(['Enough K and R tag ends to judge', 'Yes'])
  })
})

describe('a11y: sequence logo text alternative', () => {
  it('each greyed column is announced with its own reason, and drawn at a legible opacity', () => {
    // tag_min 100; P4 has 20 tag ends, P1' has 200 but the call leaves out the N end.
    const rep = parseReport(
      [
        'section\tkey\tvalue\tn\tdescription',
        'run\ttag_min\t100\t-\td',
        'call\tstatus\tcall\t500\td',
        'call\tmodel\tTrypsin\t500\td',
        'call\tuses_nterm\tno\t0\td',
        'pos\tC.P4.K\t20\t-\td',
        'pos\tC.P1.K\t300\t-\td',
        'pos\tC.P1.R\t200\t-\td',
        "pos\tN.P1'.D\t150\t-\td",
        "pos\tN.P1'.A\t50\t-\td"
      ].join('\n'),
      '/d/a.digest.tsv'
    )
    render(<DigestPanel reports={[rep]} errors={[]} onOpen={() => {}} />)
    const obs = screen.getAllByRole('img').find((e) => e.getAttribute('aria-label')?.startsWith('Observed'))!
    const label = obs.getAttribute('aria-label')!
    expect(label).toMatch(/P1' D [\d.]+ bits \(N end not used by the call\)/)
    expect(label).toMatch(/P4 K [\d.]+ bits \(few tag ends\)/)
    expect(label).toMatch(/P1 K [\d.]+ bits(,|$)/)
    const faded = [...obs.querySelectorAll('g.faded')] as SVGGElement[]
    expect(faded.length).toBeGreaterThan(0)
    for (const g of faded) {
      // Only the letters fade, to an opacity that keeps every residue colour
      // at 3:1; the 12 px position label and n stay at full colour.
      expect(g.style.opacity).toBe('')
      const letters = [...g.querySelectorAll('text.aa')]
      for (const t of letters) expect(Number(t.getAttribute('opacity'))).toBeGreaterThanOrEqual(0.75)
      expect(g.querySelector('text.pos')?.getAttribute('opacity')).toBeNull()
    }
  })
})

describe('a11y: parameter form', () => {
  it('an out-of-range number is marked invalid and says why', () => {
    const spec = PARAM_BY_NAME.get('max_peaks')!
    expect(spec.max).toBe(1024)
    render(<ParamField spec={spec} value="2000" onChange={() => {}} />)
    const el = screen.getByLabelText(/max_peaks/) as HTMLInputElement
    expect(el.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('must be at most 1024')).toBeDefined()
  })

  it('labels use the CLI names, as help text and panels do', () => {
    const spec = PARAM_BY_NAME.get('species')!
    expect(spec.description).toMatch(/-species_out/)
    render(<ParamField spec={PARAM_BY_NAME.get('species_out')!} value="" onChange={() => {}} />)
    expect(screen.getByText('species_out')).toBeTruthy()
  })
})

describe('a11y: species table', () => {
  it('the contaminant flag is a chip in words, named after the reagent', () => {
    const report = {
      path: '/x.species.tsv',
      empty: false,
      taxa: [{ rank: 'genus', taxid: 9822, name: 'Sus', observed: 7, adjusted: 7, expected: 0.6, logP: -17, q: 6.7e-8 }]
    }
    render(<SpeciesPanel report={report} enabled tooShort={null} contributed={null} totalMs2={null} />)
    // Text, not a glyph: the reagent is read out with it, and shown on hover.
    const flag = screen.getByText('common contaminant')
    expect(flag.textContent).toBe('common contaminant: porcine trypsin')
    expect(flag.getAttribute('title')).toBe('Common contaminant: porcine trypsin')
  })

  it('a species-rank row is flagged by its genus (Bos taurus)', () => {
    const report = {
      path: '/x.species.tsv',
      empty: false,
      taxa: [
        { rank: 'species', taxid: 9606, name: 'Homo sapiens', observed: 9, adjusted: 9, expected: 0.6, logP: -17, q: 1e-8 },
        { rank: 'species', taxid: 9913, name: 'Bos taurus', observed: 7, adjusted: 7, expected: 0.6, logP: -17, q: 1e-7 },
        { rank: 'species', taxid: 10090, name: 'Mus musculus', observed: 5, adjusted: 5, expected: 0.6, logP: -10, q: 1e-4 }
      ]
    }
    render(<SpeciesPanel report={report} enabled tooShort={null} contributed={null} totalMs2={null} />)
    const bos = screen.getAllByRole('row').find((r) => r.textContent?.startsWith('Bos taurus'))!
    expect(within(bos).getByText('common contaminant').getAttribute('title')).toBe('Common contaminant: bovine serum / BSA')
    const mus = screen.getAllByRole('row').find((r) => r.textContent?.startsWith('Mus musculus'))!
    expect(within(mus).queryByText('common contaminant')).toBeNull()
  })
})

describe('UX: a known-failing species run stays one click away', () => {
  it('species on + default tag_length 3 + k=7 index: Run is disabled and the reason sits next to it, on the Tags tab', async () => {
    const mock = installMockBridge()
    mock.taxdbInfoResult = { path: '/t/tax_k7.taxdb', k: 7 }
    const container = await renderApp(mock)
    mock.nextPickInput = '/data/a.mzML'
    await click(screen.getByRole('button', { name: /^(Choose file|Change)…$/ }))
    await click(screen.getByRole('button', { name: /Species detection/ }))
    await click(screen.getByLabelText('Species species'))
    expect((screen.getByRole('button', { name: /^Run( on .+)?$/ }) as HTMLButtonElement).disabled).toBe(true)
    // Default tab is Tags: the reason is beside Run, not only in the Species tab.
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Tags')
    expect(container.querySelector('.controls')!.textContent).toMatch(/cannot reach the species index k = 7/)
    await click(screen.getByRole('tab', { name: /Species/ }))
    expect(container.textContent).toMatch(/Tags are too short for the species reference/)
  })
})
