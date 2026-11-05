// Parsers lens: real FASTag 1.9.0 outputs and fuzzed inputs through every
// GUI parser and table. Real outputs live in the review scratch directory
// named by FASTAG_GUI_REVIEW_SCRATCH (see ./external.ts)
// (generated from test/fixtures/Ecoli_MS2_small.mzML and the public
// PXD063917 run); a test that needs one is skipped when it is absent.
// "BUG?" marked an assertion pinning a defect candidate; "FIXED" asserts the correction.
// @ts-ignore -- node built-in; the app's tsconfig has no node types
import { readFileSync } from 'node:fs'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  digestCall,
  fmt,
  gapHistogram,
  gapPeaks,
  labelFindings,
  modelLogo,
  modelScores,
  num,
  observedLogo,
  parseReport,
  section,
  topBins,
  value,
  type Report
} from '../digestReport'
import DigestPanel from '../DigestPanel'
import SpeciesPanel from '../SpeciesPanel'
import ResultsTable from '../ResultsTable'
import { installMockBridge } from '../testing/mockBridge'
import { FIXTURES_DIR, haveScratch, readScratch, scratchPath } from './external'

const lastOf = <T,>(a: readonly T[] | undefined): T | undefined => (a && a.length ? a[a.length - 1] : undefined)

const FX = FIXTURES_DIR
const real = (f: string): string | null => readScratch(`parsers/${f}`)
const load = (f: string): Report => parseReport(real(f) as string, scratchPath(`parsers/${f}`))
const have = (...f: string[]): boolean => haveScratch(...f.map((x) => `parsers/${x}`))
const HEAD = 'section\tkey\tvalue\tn\tdescription'

// ---------------------------------------------------------------------------
describe('parsers: real 1.9.0 outputs', () => {
  it.skipIf(!have('r.digest.tsv'))('digest with a call (PXD063917, Trypsin)', () => {
    const r = load('r.digest.tsv')
    expect(r.kind).toBe('digest')
    const c = digestCall(r)
    expect(c).toMatchObject({ status: 'call', model: 'Trypsin', runnerUp: 'Lys-C', usesNterm: false })
    expect(c.margin).toBeCloseTo(1.4827579, 6)
    expect(modelScores(r).map((m) => m.model)).toEqual([
      'Trypsin', 'Lys-C', 'Arg-C', 'Glu-C', 'Chymotrypsin', 'Asp-N', 'Lys-N', 'unspecific'
    ])
    const obs = observedLogo(r)
    expect(obs.map((x) => x.label)).toEqual(['P4', 'P3', 'P2', 'P1', "P1'", "P2'", "P3'", "P4'"])
    const p1 = obs[3]
    expect(lastOf(p1.letters)?.aa).toMatch(/[KR]/)
    // independent recomputation (python, scratch/parsers): P1 n=21285, I=3.0750 bits, K height 1.8885
    expect(p1.n).toBe(21285)
    expect(p1.bits).toBeCloseTo(3.075, 3)
    expect(lastOf(p1.letters)?.aa).toBe('K')
    expect(lastOf(p1.letters)?.bits).toBeCloseTo(1.8885, 3)
    expect(obs[0].bits).toBeCloseTo(0.2258, 3)
    expect(obs.slice(4).every((x) => x.faded)).toBe(true) // uses_nterm no
    const t = modelLogo(r, 'Trypsin')
    expect(lastOf(t?.[3].letters)?.aa).toMatch(/[KR]/)
    expect(lastOf(modelLogo(r, 'Lys-C')?.[3].letters)?.aa).toBe('K')
  })

  it.skipIf(!have('r.digest.tsv', 'q.label.tsv', 'r.massgap.tsv'))('DigestPanel renders the real reports', () => {
    const errs = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<DigestPanel reports={[load('r.digest.tsv'), load('q.label.tsv'), load('r.massgap.tsv')]} errors={[]} onOpen={() => {}} />)
    expect(screen.getByText('Trypsin', { selector: '.taxon' })).toBeDefined()
    // dt/dd pairs of the call card; a text query would walk the 12,808 raw rows.
    const stat = (label: string): string | null | undefined =>
      [...document.querySelectorAll('.headline dt')].find((d) => d.textContent === label)?.nextElementSibling?.textContent
    expect(stat('Runner-up, other enzyme class')).toBe('Lys-C')
    expect(stat('Margin, log-likelihood per tag')).toBe('1.4828')
    expect(stat('Tag ends used')).toMatch(/N end not used$/)
    // mass-gap: 19 peaks, 40 of 12,808 bins
    expect(document.body.textContent).toMatch(/the 40 fullest of 12,808 bins/)
    expect(errs).not.toHaveBeenCalled()
    errs.mockRestore()
  })

  it.skipIf(!have('b.digest.tsv', 'c.digest.tsv'))('no-call digests (Da run; ppm run with no tags)', () => {
    const b = digestCall(load('b.digest.tsv'))
    expect(b).toMatchObject({ status: 'no_call', reason: 'low_resolution' })
    expect(b.fired).toEqual(['low_resolution', 'ms2_first_peak', 'few_tags'])
    expect(b.usesNterm).toBeNull()
    const c = digestCall(load('c.digest.tsv'))
    expect(c).toMatchObject({ status: 'no_call', reason: 'ms2_first_peak' })
    // A no-call report has no uses_nterm row, so the P' columns are never greyed
    // for the "N end not used" rule even though no call uses them.
    const obsB = observedLogo(load('b.digest.tsv'))
    expect(obsB.every((x) => x.faded)).toBe(true) // only because n < tag_min=100 here
  })

  it.skipIf(!have('r.massgap.tsv'))('mass gap: every hist row becomes a bin; peaks 1..19', () => {
    const r = load('r.massgap.tsv')
    const histRows = section(r, 'hist').length
    expect(gapHistogram(r)).toHaveLength(histRows)
    expect(histRows).toBe(12808)
    const p = gapPeaks(r)
    expect(p.map((x) => x.index)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1))
    expect(p[0]).toMatchObject({ delta: 0.6231279069767441, spectra: 43, explainedBy: 'none', alternatives: [] })
    expect(topBins(gapHistogram(r), 40)).toHaveLength(40)
  })

  it.skipIf(!have('c.massgap.tsv', 'b.label.tsv', 'c.tags.tsv'))('empty mass-gap report (0 bins), Da label report', () => {
    const m = load('c.massgap.tsv')
    expect(m.kind).toBe('massgap')
    expect(gapHistogram(m)).toEqual([])
    const l = load('b.label.tsv')
    render(<DigestPanel reports={[m, l]} errors={[]} onOpen={() => {}} />)
    expect(document.body.textContent).toMatch(/The fragment tolerance is in Da, so the label windows do not hold/)
    expect(real('c.tags.tsv')?.trim().split('\n')).toHaveLength(1) // header-only tags file from a real run
  })

  it('FIXED (m9, m10): bar scaling counts a bin as shifted beyond 2*window, as the CLI does, and marks the bars cut off at that scale', () => {
    const r = parseReport(
      `${HEAD}\nrun\twindow_da\t0.02\t-\td\nhist\t0.0000\t1000\t-\td\nhist\t0.0300\t400\t-\td\nhist\t15.9949\t20\t-\td\ncombo\tshifted_spectra\t20\t420\tThe CLI: 20 of them have a gap more than 0.04 Da from zero.`,
      '/x.massgap.tsv'
    )
    const { container } = render(<DigestPanel reports={[r]} errors={[]} onOpen={() => {}} />)
    const bars = [...container.querySelectorAll('table.gaps tbody tr')].map((tr) => [
      tr.firstElementChild?.textContent,
      (tr.querySelector('.minibar') as HTMLElement).style.width
    ])
    // 0.03 is within 2*0.02 of zero, so only 15.9949 sets the scale; the two
    // bins near zero run past it and carry the cut-off mark.
    expect(bars).toEqual([['0.0000', '100%'], ['0.0300', '100%'], ['15.9949', '100%']])
    const clipped = [...container.querySelectorAll('table.gaps tbody tr')].map((tr) => tr.querySelector('.clip') != null)
    expect(clipped).toEqual([true, true, false])
    expect(container.querySelector('table.gaps caption')?.textContent).toMatch(/beyond ±0\.04 Da; ⫽ marks a bar cut off/)
  })

  it.skipIf(!have('q.label.tsv'))('label: findings and heavy rows', () => {
    const r = load('q.label.tsv')
    expect(r.kind).toBe('label')
    expect(labelFindings(r).map((l) => l.label)).toEqual(['TMT', 'TMTpro', 'iTRAQ4'])
    expect(section(r, 'heavy').map((h) => h.key)).toEqual(['K8.share', 'R10.share', 'K.tags', 'R.tags', 'gate'])
  })

  it.skipIf(!have('r.digest.tsv', 'q.label.tsv'))(
    'BUG? "same input" is decided by run.input, which is only the basename: two runs with different parameters (tag_length 8 vs 4) are treated as one',
    () => {
      const d = load('r.digest.tsv')
      const l = load('q.label.tsv')
      expect(value(d, 'run', 'tag_length')).toBe('8')
      expect(value(l, 'run', 'tag_length')).toBe('4')
      expect(value(d, 'run', 'input')).toBe(value(l, 'run', 'input')) // 'PXD063917.mzML' -> not closed
    }
  )
})

// ---------------------------------------------------------------------------
describe('parsers: GUI fixtures vs real output', () => {
  const keys = (t: string): Set<string> =>
    new Set(
      t.split('\n').slice(1).filter(Boolean).map((l) => {
        const [s, k] = l.split('\t')
        return `${s}\t${k.replace(/\.[A-Y]$/, '.<aa>')}`
      })
    )
  // The fixtures are FASTag 1.10.0 output; the scratch reports (real 1.9.0)
  // must have no row the fixtures lack, and 1.10.0 adds ion_counts and
  // ms2_whole_intensity_share on top.
  it('fixtures are 1.10.0 output: 8 nocall rules in report order, ion_counts and its meta row', () => {
    for (const f of ['digest.tsv', 'digest_nocall.tsv', 'label.tsv', 'massgap.tsv'])
      expect(readFileSync(`${FX}${f}`, 'utf8')).toMatch(/^run\tversion\t1\.10\.0\t/m)
    for (const f of ['digest.tsv', 'digest_nocall.tsv']) {
      const t: string = readFileSync(`${FX}${f}`, 'utf8')
      const rules = t.split('\n').filter((l: string) => l.startsWith('nocall\t')).map((l: string) => l.split('\t')[1])
      expect(rules).toEqual([
        'low_resolution', 'timstof', 'ms2_scan_window', 'ms2_first_peak',
        'ion_counts', 'few_tags', 'nonfinite_score', 'tie'
      ])
      expect(t).toMatch(/^meta\tms2_whole_intensity_share\t[0-9.e-]+\t\d+\t/m)
    }
  })
  it.skipIf(!have('b.digest.tsv'))('FIXED (m14): fixtures carry every row of real output: run.input, fragment_tolerance_unit, all nocall rules', () => {
    const fx = readFileSync(`${FX}digest_nocall.tsv`, 'utf8')
    const fk = keys(fx)
    const rk = keys(real('b.digest.tsv') as string)
    const missing = [...rk].filter((k) => !fk.has(k) && !k.startsWith('pos') && !k.startsWith('residue') && !k.startsWith('background'))
    expect(missing).toEqual([])
    // the unit has its own row, as 1.9.0 and later write it
    expect(fx).not.toMatch(/^run\tfragment_tolerance\t[^\t]* (ppm|Da)\t/m)
    expect(fx).toMatch(/^run\tfragment_tolerance_unit\tDa\t/m)
    // and the call fixture is a state the writer produces: n_n below tag_min, so uses_nterm no
    const dg = readFileSync(`${FX}digest.tsv`, 'utf8')
    expect(dg).toMatch(/^count\tn_n\t0\t/m)
    expect(dg).toMatch(/^call\tuses_nterm\tno\t/m)
  })
})

// ---------------------------------------------------------------------------
describe('parsers: fuzzed reports', () => {
  const dig = (rows: string, head = HEAD): Report => parseReport(`${head}\n${rows}`, '/x.digest.tsv')

  it('empty, whitespace and header-only files throw readable errors', () => {
    expect(() => parseReport('', 'x')).toThrow('the file is empty')
    expect(() => parseReport('\n \r\n\t\n', 'x')).toThrow('the file is empty')
    expect(() => parseReport(HEAD + '\n', 'x')).toThrow(/none of their sections/)
    expect(() => parseReport('a\tb\n', 'x')).toThrow(/no section, key, value, n, description column/)
  })

  it('CRLF and a UTF-8 BOM parse', () => {
    const r = parseReport(`﻿${HEAD}\r\ncall\tstatus\tcall\t5\tok\r\ncall\tmodel\tTrypsin\t5\tx\r\n`, 'x')
    expect(digestCall(r).model).toBe('Trypsin')
    expect(r.rows[0].n).toBe(5)
  })

  it('lossy-decoded bytes survive', () => {
    const r = dig('run\tinput\tSampl�.mzML\t-\td\ncall\tstatus\tno_call\t0\td')
    expect(value(r, 'run', 'input')).toBe('Sampl�.mzML')
  })

  it('NaN / inf / huge numbers become null, -0 prints as "-0"', () => {
    expect([num('nan'), num('NaN'), num('inf'), num('Infinity'), num('1e309'), num('-')]).toEqual([null, null, null, null, null, null])
    expect(fmt(-0)).toBe('-0')
    const r = dig('call\tstatus\tcall\tnan\td\ncall\tmargin\tinf\t1e400\td')
    expect(r.rows[0].n).toBeNull()
    expect(digestCall(r).margin).toBeNull()
  })

  it('FIXED (m15): num() reads decimals only, not hex / binary / octal literals', () => {
    expect([num('0x1A'), num('0b11'), num('0o7')]).toEqual([null, null, null])
    expect([num('12'), num('-0.5'), num('1.8066e-05'), num('.5')]).toEqual([12, -0.5, 1.8066e-5, 0.5])
  })

  it('FIXED (m11): fmt keeps small non-zero shares visible; the Share column shows them as a percentage', () => {
    // 1 TMT tag end out of 55352 filtered tags (q/p runs have 55k-103k): share 1.8e-5
    expect(fmt(1 / 55352, 4)).toBe('0.0000181')
    expect(fmt(0.00004, 4)).toBe('0.00004')
    expect(fmt(0, 4)).toBe('0')
    const lab = parseReport(
      `${HEAD}\nnlabel\tTMT.count\t1\t55352\td\nnlabel\tTMT.background\t0\t55352\td\nnlabel\tTMT.share\t1.8066e-05\t55352\td`,
      '/x.label.tsv'
    )
    render(<DigestPanel reports={[lab]} errors={[]} onOpen={() => {}} />)
    const row = screen.getAllByRole('row').find((r) => r.textContent?.startsWith('TMT')) as HTMLElement
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual(['TMT', '1', '0', '0.00181%'])
  })

  it('missing / extra / reordered columns', () => {
    expect(() => parseReport('section\tkey\tvalue\tdescription\ncall\tstatus\tcall\tx', 'x')).toThrow(/no n column/)
    const r = parseReport('description\tn\textra\tvalue\tkey\tsection\nd\t3\tz\tcall\tstatus\tcall', 'x')
    expect(digestCall(r).status).toBe('call')
    // short rows: missing trailing fields become ''
    const s = dig('call\tstatus')
    expect(s.rows[0]).toMatchObject({ value: '', n: null, description: '' })
  })

  it('FIXED (m15): duplicate keys: the first row wins, and the panel says so', () => {
    const r = dig('call\tstatus\tcall\t5\ta\ncall\tmodel\tTrypsin\t5\tb\ncall\tstatus\tno_call\t5\tc\ncall\treason\tfew_tags\t-\td')
    expect(digestCall(r).status).toBe('call')
    expect(r.warnings).toEqual(['x.digest.tsv has more than one call status row; the first one is used.'])
    render(<DigestPanel reports={[r]} errors={[]} onOpen={() => {}} />)
    expect(screen.getByText('x.digest.tsv has more than one call status row; the first one is used.')).toBeDefined()
  })

  it('FIXED (m15): duplicate hist keys keep distinct React keys in the gap table', () => {
    const errs = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = parseReport(`${HEAD}\nhist\t1.0000\t5\t-\td\nhist\t1.0000\t6\t-\td\nrun\twindow_da\t0.02\t-\td`, '/x.massgap.tsv')
    expect(gapHistogram(r)).toHaveLength(2)
    expect(r.warnings).toEqual(['x.massgap.tsv has more than one hist 1.0000 row; the first one is used.'])
    render(<DigestPanel reports={[r]} errors={[]} onOpen={() => {}} />)
    const dup = errs.mock.calls.some((c) => String(c[0]).includes('same key'))
    errs.mockRestore()
    expect(dup).toBe(false)
  })

  it('quotes and embedded tabs in descriptions', () => {
    const r = dig('call\tstatus\tcall\t5\t"quoted" \'x\' <b>y</b>\tspill')
    expect(r.rows[0].description).toBe('"quoted" \'x\' <b>y</b>') // spill after a tab is dropped
  })

  it('unknown sections and unknown no-call reasons', () => {
    expect(() => parseReport(`${HEAD}\nfoo\tbar\t1\t-\td`, 'x')).toThrow(/none of their sections/)
    const r = dig('call\tstatus\tno_call\t0\td\ncall\treason\tnew_rule_2027\t-\td\nnocall\tnew_rule_2027\tyes\t-\td\nzzz\ta\tb\t-\td')
    render(<DigestPanel reports={[r]} errors={[]} onOpen={() => {}} />)
    expect(screen.getByText('Reason').nextElementSibling?.textContent).toBe('new_rule_2027')
  })

  it('FIXED (m15): labelFindings: a key without a dot names no label', () => {
    const r = parseReport(`${HEAD}\nnlabel\tTMT\t3\t10\td\nnlabel\tTMTpro.count\t2\t10\td`, '/x.label.tsv')
    expect(labelFindings(r).map((l) => l.label)).toEqual(['TMTpro'])
  })

  it('peak keys with a leading zero are found as an index but their values are not', () => {
    const r = parseReport(`${HEAD}\npeak\t01.delta\t15.99\t3\td\npeak\t01.spectra\t3\t-\td`, '/x.massgap.tsv')
    expect(gapPeaks(r)[0]).toMatchObject({ index: 1, delta: null, spectra: null })
  })

  it('a no-call report never greys the P′ columns for the N-end rule (no uses_nterm row)', () => {
    // 200 tag ends at every position, tag_min 100, no_call: P' columns are not greyed
    const pos = ['P4', 'P3', 'P2', 'P1'].map((p) => `pos\tC.${p}.K\t200\t-\td`).join('\n')
    const posN = ["P1'", "P2'", "P3'", "P4'"].map((p) => `pos\tN.${p}.D\t200\t-\td`).join('\n')
    const r = dig(`run\ttag_min\t100\t-\td\ncall\tstatus\tno_call\t200\td\ncall\treason\ttimstof\t-\td\n${pos}\n${posN}`)
    expect(observedLogo(r).slice(4).map((c) => c.faded)).toEqual([false, false, false, false])
  })

  it('20k-bin mass-gap report parses and renders in reasonable time', () => {
    const rows = Array.from({ length: 20000 }, (_, i) => `hist\t${(i * 0.37 - 3000).toFixed(4)}\t${(i % 13) + 1}\t-\td`).join('\n')
    const t0 = performance.now()
    const r = parseReport(`${HEAD}\nrun\twindow_da\t0.02\t-\td\n${rows}`, '/x.massgap.tsv')
    render(<DigestPanel reports={[r]} errors={[]} onOpen={() => {}} />)
    const ms = performance.now() - t0
    expect(ms).toBeLessThan(5000)
  })
})

// ---------------------------------------------------------------------------
describe('SpeciesPanel: edge values from species.rs', () => {
  const taxon = (o: Partial<{ rank: string; taxid: number; name: string; observed: number; adjusted: number; q: number }>) => ({
    rank: 'genus', taxid: 1, name: 'A', observed: 5, adjusted: 5, expected: 1, logP: -1, q: 0.01, ...o
  })
  it('BUG? a BOM header leaves rank "" and the caveat reads "-level call"', () => {
    render(<SpeciesPanel report={{ path: 'x', empty: false, taxa: [taxon({ rank: '' })] }} enabled tooShort={null} contributed={null} totalMs2={null} />)
    expect(screen.getByText(/^-level call/)).toBeDefined()
  })
  it('BUG? q missing/NaN in the TSV is shown as 1.000 (species.rs default), not as absent', () => {
    render(<SpeciesPanel report={{ path: 'x', empty: false, taxa: [taxon({ q: 1.0 })] }} enabled tooShort={null} contributed={null} totalMs2={null} />)
    expect(screen.getByText('1.000')).toBeDefined()
  })
  it('two unparsable taxids (both 0) collide as React keys', () => {
    const errs = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<SpeciesPanel report={{ path: 'x', empty: false, taxa: [taxon({ taxid: 0, name: 'A' }), taxon({ taxid: 0, name: 'B' })] }} enabled tooShort={null} contributed={null} totalMs2={null} />)
    const dup = errs.mock.calls.some((c) => String(c[0]).includes('same key'))
    errs.mockRestore()
    expect(dup).toBe(true)
  })
  it('fmtQ: 0 -> <1e-300, tiny -> exponential', () => {
    render(<SpeciesPanel report={{ path: 'x', empty: false, taxa: [taxon({ q: 0 }), taxon({ taxid: 2, q: 1.59964e-29 })] }} enabled tooShort={null} contributed={null} totalMs2={null} />)
    expect(screen.getByText('<1e-300')).toBeDefined()
    expect(screen.getByText('1.6e-29')).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
describe('ResultsTable: filter inputs and size', () => {
  const flush = (): Promise<void> => act(async () => {})
  const commit = async (label: string, v: string): Promise<void> => {
    const el = screen.getByLabelText(label)
    await act(async () => {
      fireEvent.change(el, { target: { value: v } })
    })
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Enter' })
    })
  }

  it('FIXED (m7): min length "-1" is marked invalid and never sent; one past u32 is clamped to its max', async () => {
    const mock = installMockBridge()
    render(<ResultsTable path="/x.tags.tsv" />)
    await flush()
    await commit('Min. length', '-1')
    expect(screen.getByLabelText('Min. length').getAttribute('aria-invalid')).toBe('true')
    expect(mock.resultsQueryCalls.some((c) => c.view.minLength === -1)).toBe(false)
    await commit('Min. length', '4294967296')
    expect(lastOf(mock.resultsQueryCalls)?.view.minLength).toBe(4294967295)
  })

  it('FIXED (M10): an unparsable or overflowing filter is marked invalid and reported; a decimal comma is read', async () => {
    const mock = installMockBridge()
    render(<ResultsTable path="/x.tags.tsv" />)
    await flush()
    await commit('Max. E-value', '1e999')
    expect(lastOf(mock.resultsQueryCalls)?.view.maxEvalue).toBeNull()
    expect(screen.getByLabelText('Max. E-value').getAttribute('aria-invalid')).toBe('true')
    await commit('Max. E-value', '0,01') // decimal comma
    expect(lastOf(mock.resultsQueryCalls)?.view.maxEvalue).toBe(0.01)
    expect((screen.getByLabelText('Max. E-value') as HTMLInputElement).value).toBe('0,01')
    await commit('Min. length', '7abc')
    expect(lastOf(mock.resultsQueryCalls)?.view.minLength).toBeNull()
    expect(screen.getByLabelText('Min. length').getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText(/not applied \(invalid\)/)).toBeDefined()
  })

  it('200k rows: renders a window only, and the bottom of a 1M-row file is reachable', async () => {
    const mock = installMockBridge()
    mock.resultsRows = Array.from({ length: 200000 }, (_, i) => [`scan=${i}`, 'PEPTIDE', '7', '0.01', '-'])
    const t0 = performance.now()
    const { container } = render(<ResultsTable path="/x.tags.tsv" />)
    await flush()
    expect(performance.now() - t0).toBeLessThan(3000)
    expect(container.querySelectorAll('.rt-row').length).toBeLessThan(40)
    expect(screen.getByText('Showing 200,000 of 200,000')).toBeDefined()

    mock.resultsRows = Array.from({ length: 1_000_000 }, (_, i) => [`scan=${i}`, 'P', '7', '0.01', '-'])
    const { container: c2 } = render(<ResultsTable path="/big.tags.tsv" />)
    await flush()
    const sc = c2.querySelector('.rt-scroll') as HTMLElement
    const canvas = c2.querySelector('.rt-canvas') as HTMLElement
    expect(canvas.style.height).toBe(`${28 + 15_000_000}px`)
    await act(async () => {
      sc.scrollTop = 15_000_000 + 28 - 600
      fireEvent.scroll(sc)
    })
    await flush()
    const cells = [...c2.querySelectorAll('.rt-row')].map((r) => r.firstElementChild?.textContent)
    expect(lastOf(cells)).toBe('scan=999999')
  })
})
