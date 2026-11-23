// Review round 7 (doc/GUI-WORKFLOWS.md): the species caveat at a tolerance
// in Da on the Species tab, the CLI's activation lines under auto and cz,
// a tie among the present taxa in the batch and the SDRF comparison, the
// DIA input setting, the isobaric kit not assessable in the QC strip, a
// report read again, the localization columns, the Digest panel at Da, the
// (?) tip, the alkylation extension per proteome, the ETD share of the
// species check, the engine defaults and the workflow's lead tiles.

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import SpeciesPanel from '../SpeciesPanel'
import DigestPanel from '../DigestPanel'
import ParamField from '../ParamField'
import { autoWidths } from '../ResultsTable'
import HelpPopover from '../help/HelpPopover'
import ReportTable, { qcSummary } from './ReportTable'
import { buildOverview, daSpeciesTolerance, leadTiles, shownTiles } from './overview'
import { parseLog, unassessedKits } from './calls'
import { parseReport } from '../digestReport'
import { AUTO_NO_COLUMN_LINE, COLLISIONAL_CZ_LINE, HYBRID_AUTO_LINE, NOTE_LINE, postRunChecks, preStartChecks } from '../inspector/checks'
import { parseProbe } from '../inspector/probe'
import { jobCells, majority, qcCells, type JobData } from '../run/batchSummary'
import { compareSdrf } from '../sdrf/compare'
import { parseSdrf } from '../sdrf/sdrfTable'
import { parseTaxdump } from '../sdrf/taxonomy'
import { alkylationExtension, alkylationTarget, PRODUCT_OF, alkylationRaise, toggleProduct } from '../setup/products'
import { PARAM_BY_NAME, uiOf } from '../paramLayout'
import { installMockBridge } from '../testing/mockBridge'
import type { SpeciesReport, Taxon } from '../types'
import charDigest from '../fixtures/cli-1.15/workflows/characterize/run01.digest.tsv?raw'
import charLabel from '../fixtures/cli-1.15/workflows/characterize/run01.label.tsv?raw'
import iontrapProbe from '../fixtures/probe/iontrap.probe.jsonl?raw'
import diaRawProbe from '../fixtures/probe/dia_raw.probe.jsonl?raw'
// @ts-ignore -- node built-in; the app's tsconfig has no node types
import { readFileSync } from 'node:fs'

const taxon = (name: string, taxid: number, n: number, call?: string): Taxon => ({ rank: 'genus', taxid, name, observed: n, adjusted: n, q: 0.001, ...(call ? { call } : {}) })
const sp = (taxa: Taxon[]): SpeciesReport => ({ path: '/d/a.tags.species.tsv', taxa })

// ---- 1: the species caveat at a tolerance in Da ------------------------------

describe('round 7, 1: the Species tab says the caveat of a tolerance in Da', () => {
  const digest = parseReport(charDigest, '/d/run01.digest.tsv')

  it('daSpeciesTolerance reads the reports first, else the parameters', () => {
    expect(daSpeciesTolerance([digest], {})).toBe(0.3)
    expect(daSpeciesTolerance([], { fragment_tolerance: '0.5', fragment_tolerance_unit: 'Da' })).toBe(0.5)
    expect(daSpeciesTolerance([], { fragment_tolerance: '20', fragment_tolerance_unit: 'ppm' })).toBeNull()
    expect(daSpeciesTolerance([], null)).toBeNull()
  })

  it('a warning above the top-ranked taxon, whose name is muted', () => {
    const { container } = render(
      <SpeciesPanel report={sp([taxon('Cricetulus', 10028, 40), taxon('Mus', 10088, 9)])} enabled tooShort={null} contributed={null} totalMs2={null} daTolerance={0.3} />
    )
    const banner = container.querySelector('.banner.warn')!
    expect(banner.textContent).toMatch(/The fragment tolerance is 0\.3 Da: species calls are unreliable on ion-trap\/Da data/)
    // Above the Top-ranked taxon card.
    expect(banner.compareDocumentPosition(container.querySelector('.card.headline')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.querySelector('.headline .taxon')!.classList.contains('muted')).toBe(true)
  })

  it('at ppm no warning and no muted name', () => {
    const { container } = render(<SpeciesPanel report={sp([taxon('Homo', 9605, 40)])} enabled tooShort={null} contributed={null} totalMs2={null} daTolerance={null} />)
    expect(container.querySelector('.banner.warn')).toBeNull()
    expect(container.querySelector('.headline .taxon')!.classList.contains('muted')).toBe(false)
  })
})

// ---- 2: the activation lines under auto and cz -----------------------------

const HYBRID = 'Hybrid activation: 120 of 4000 MS2 spectra were activated by a hybrid method (EThcD, ETciD) and were tagged as b/y ions under -ion_series auto; reading them as b/y and c/z ions together is not supported yet.'
const NOCOL = 'Ion series: 40 electron-activated MS2 spectra were tagged as b/y ions: -ion_series auto reads the activation of mzML input only and writes no ion_series column here; use -ion_series cz to read them as c/z-dot ions.'
const COLL = 'Collisional activation: 2000 of 4000 MS2 spectra were activated by collision (CID, HCD), which yields b/y ions, but -ion_series cz reads every spectrum as c/z-dot ions; use -ion_series auto or by for them.'

describe('round 7, 2: the CLI activation lines after a run', () => {
  it('NOTE_LINE keeps all three; the species-excluded line is not the no-column one', () => {
    for (const l of [HYBRID, NOCOL, COLL]) expect(NOTE_LINE.test(l), l).toBe(true)
    expect(NOTE_LINE.test('Ion series: 12 tag rows read as c/z-dot ions were left out of -species, which counts b/y tags only.')).toBe(false)
    expect(HYBRID_AUTO_LINE.exec(HYBRID)!.slice(1)).toEqual(['120', '4000'])
    expect(AUTO_NO_COLUMN_LINE.exec(NOCOL)![1]).toBe('40')
    expect(COLLISIONAL_CZ_LINE.exec(COLL)!.slice(1)).toEqual(['2000', '4000'])
  })

  it('Hybrid activation: a warning, fixed by Ion series auto with Hybrid both on mzML', () => {
    const c = postRunChecks({ reports: [], notes: [HYBRID], ionSeries: 'auto', input: '/d/a.mzML' }).checks.find((x) => x.id === 'hybrid-auto')!
    expect(c.level).toBe('warn')
    expect(c.detail).toMatch(/^120 of 4,000 MS2 spectra were activated by a hybrid method/)
    expect(c.fix).toEqual({ label: 'Read ETD as c/z, EThcD as both (Ion series auto, Hybrid both)', params: { ion_series: 'auto', ion_series_hybrid: 'both' }, rerun: true })
  })

  it('the no-column line (auto on MGF or mzPeak): cz, or convert to mzML', () => {
    // All 40 MS2 spectra electron-activated: cz is the re-run (round 8, 17).
    const c = postRunChecks({ reports: [], notes: [NOCOL], ionSeries: 'auto', input: '/d/a.mgf', ms2: 40 }).checks.find((x) => x.id === 'auto-no-column')!
    expect(c.level).toBe('warn')
    expect(c.detail).toMatch(/convert the run to mzML and use auto/)
    expect(c.fix).toEqual({ label: 'Read every spectrum as c/z (Ion series cz)', params: { ion_series: 'cz' }, rerun: true })
  })

  it('collisional spectra under cz: auto on mzML, by on MGF', () => {
    const mz = postRunChecks({ reports: [], notes: [COLL], ionSeries: 'cz', input: '/d/a.mzML' }).checks.find((x) => x.id === 'collisional-cz')!
    expect(mz.level).toBe('warn')
    expect(mz.fix?.params).toEqual({ ion_series: 'auto' })
    const mgf = postRunChecks({ reports: [], notes: [COLL], ionSeries: 'cz', input: '/d/a.mgf' }).checks.find((x) => x.id === 'collisional-cz')!
    expect(mgf.fix?.params).toEqual({ ion_series: 'by' })
  })

  it('the Overview flags each line too', () => {
    const o = buildOverview({ log: [HYBRID, NOCOL, COLL], reports: [], species: null, census: null, params: {}, input: '/d/a.mzML', instrument: null })
    const flags = o.checks.filter((c) => c.tone === 'flag').map((c) => c.text)
    expect(flags.some((t) => /^120 of 4,000 MS2 spectra were activated by a hybrid method/.test(t))).toBe(true)
    expect(flags.some((t) => /^40 electron-activated MS2 spectra were tagged as b\/y ions/.test(t))).toBe(true)
    expect(flags.some((t) => /^2,000 of 4,000 MS2 spectra were activated by collision/.test(t))).toBe(true)
    expect(parseLog([HYBRID, NOCOL, COLL])).toMatchObject({ hybridAuto: { hybrid: 120, of: 4000 }, autoNoColumn: 40, collisionalCz: { collisional: 2000, of: 4000 } })
  })
})

// ---- 4: a tie among the present taxa --------------------------------------

describe('round 7, 4: a tie at the top is no single call', () => {
  const data = (taxa: Taxon[]): JobData => ({ log: [], reports: [], species: sp(taxa), census: null, params: { species: true } })
  const tie = [taxon('Saccharomyces', 4930, 40, 'present'), taxon('Homo', 9605, 40, 'present'), taxon('Mus', 10088, 5, 'present')]

  it('the batch cell names the tie and stays out of the majority', () => {
    const g = jobCells(data(tie)).cells.genus
    expect(g.text).toBe('No single leader')
    expect(g.call).toBeNull()
    expect(g.tied).toEqual(['Saccharomyces', 'Homo'])
    const one = jobCells(data([taxon('Homo', 9605, 40, 'present'), taxon('Mus', 10088, 5, 'present')])).cells.genus
    expect(one.call).toBe('Homo')
    expect(majority([g, one, one, one].map((c) => c.call))).toMatchObject({ value: 'Homo', calls: 3, count: 3 })
  })

  it('in the SDRF comparison any tied leader counts as the top call', () => {
    const tx = parseTaxdump(readFileSync('src/fixtures/sdrf/nodes.dmp', 'utf8'), readFileSync('src/fixtures/sdrf/names.dmp', 'utf8'))
    const t = parseSdrf(new TextEncoder().encode('source name\tcharacteristics[organism]\tcomment[data file]\nS1\tHomo sapiens\tx.mzML\n'))
    const o = compareSdrf(t, [{ input: '/d/x.mzML', status: 'done', data: data(tie) }], tx).jobs[0].fields!.organism
    expect(o.state).toBe('genus')
    expect(o.fastag).toMatch(/Saccharomyces \(taxid 4930\) or Homo \(taxid 9605\), tied/)
    expect(o.note).toMatch(/^tied at the top: /)
  })
})

// ---- 5: the DIA input setting ---------------------------------------------

describe('round 7, 5: raw DIA follows the DIA input setting', () => {
  const pre = (acquisition_check?: string) =>
    preStartChecks({ input: '/d/a.mzML', values: { fragment_tolerance: '20', fragment_tolerance_unit: 'ppm', ...(acquisition_check ? { acquisition_check } : {}) }, supported: true, probe: parseProbe(diaRawProbe) })
  const dia = (r: ReturnType<typeof pre>) => r.checks.find((c) => c.id === 'raw-dia')
  it('refuse (the default) blocks; warn is a warning with the command; off is a note', () => {
    expect(dia(pre())!.level).toBe('block')
    expect(dia(pre('refuse'))!.level).toBe('block')
    const w = dia(pre('warn'))!
    expect(w.level).toBe('warn')
    expect(w.command?.[0]).toBe('DIAspeXtract')
    expect(dia(pre('off'))!.level).toBe('info')
    expect(pre('off').checks.some((c) => c.level === 'block')).toBe(false)
  })
})

// ---- 6: no kit assessable -----------------------------------------------------

const QC_UNASSESSED = [
  'section\tkey\tvalue\tn\tdescription',
  'qc\tcount_ms2\t100\t-\tMS2 spectra read.',
  'qc\treporter_compatible_kits\tnone\t-\tIsobaric kits whose reporters are present.',
  'qc\treporter_tmt\tnot_assessable\t-\tNot assessable: the MS2 scan range starts above the reporter ions.',
  'qc\treporter_itraq\tnot_assessable\t-\tNot assessable: the MS2 scan range starts above the reporter ions.'
].join('\n')

describe('round 7, 6: the QC strip says Not assessable, as the batch does', () => {
  it('qcSummary and qcCells share the reason', async () => {
    const mock = installMockBridge()
    mock.reportFiles['/d/a.qc.tsv'] = QC_UNASSESSED
    render(<ReportTable kind="qc" path="/d/a.qc.tsv" />)
    await waitFor(() => expect(screen.getByLabelText('QC summary')).toBeDefined())
    const kit = [...document.querySelectorAll('.qc-strip .stat')].find((s) => s.querySelector('dt')!.textContent === 'Isobaric kit')!
    expect(kit.querySelector('dd')!.textContent).toBe('Not assessable')
    expect(kit.getAttribute('title')).toBe('No kit could be assessed: the MS2 scan range starts above the reporter ions.')
    expect(qcCells(QC_UNASSESSED).kit).toMatchObject({ text: 'Not assessable', call: null })
    expect(unassessedKits('TMT', [])).toBeNull()
  })

  it('a "none" with an absent kit stays none found', () => {
    const rows = [
      { sec: 'qc', key: 'reporter_compatible_kits', value: 'none', n: '-', desc: '' },
      { sec: 'qc', key: 'reporter_tmt', value: 'absent', n: '-', desc: '' }
    ]
    expect(qcSummary(rows).find((x) => x.label === 'Isobaric kit')!.value).toBe('none found')
  })
})

// ---- 7: a report read again -------------------------------------------------

describe('round 7, 7: a report view reads the file again on each open', () => {
  it('a new gen at the same path shows the rewritten file', async () => {
    const mock = installMockBridge()
    mock.reportFiles['/d/a.qc.tsv'] = 'section\tkey\tvalue\tn\tdescription\nqc\tcount_ms2\t100\t-\tMS2 spectra read.\n'
    const { rerender } = render(<ReportTable kind="qc" path="/d/a.qc.tsv" gen={1} />)
    await waitFor(() => expect(document.querySelector('.qc-strip')!.textContent).toMatch(/MS2 spectra100/))
    mock.reportFiles['/d/a.qc.tsv'] = 'section\tkey\tvalue\tn\tdescription\nqc\tcount_ms2\t250\t-\tMS2 spectra read.\n'
    rerender(<ReportTable kind="qc" path="/d/a.qc.tsv" gen={1} />)
    await act(async () => {})
    expect(document.querySelector('.qc-strip')!.textContent).toMatch(/MS2 spectra100/)
    rerender(<ReportTable kind="qc" path="/d/a.qc.tsv" gen={2} />)
    await waitFor(() => expect(document.querySelector('.qc-strip')!.textContent).toMatch(/MS2 spectra250/))
  })
})

// ---- 12, 13: the Digest panel at a tolerance in Da -----------------------------

describe('round 7, 12 and 13: the Digest panel at 0.3 Da', () => {
  it('labels not assessable, not a green "no label"; the status sentence is not repeated', () => {
    render(<DigestPanel reports={[parseReport(charDigest, '/d/run01.digest.tsv'), parseReport(charLabel, '/d/run01.label.tsv')]} errors={[]} onOpen={() => {}} />)
    const chips = [...document.querySelectorAll('#dg-label ~ .chip-line .chip, .dg-block .chip-line .chip')].map((c) => `${c.className}|${c.textContent}`)
    expect(chips.some((c) => c === 'chip|Not assessable (tolerance in Da)')).toBe(true)
    expect(chips.some((c) => c.startsWith('chip ok'))).toBe(false)
    const says = [...document.querySelectorAll('.sentences li')].map((l) => l.textContent ?? '').join(' ')
    expect(says).not.toMatch(/No protease is called: the fragment tolerance is in Da/)
  })
})

// ---- 14: the (?) shows the tip -----------------------------------------------------

describe('round 7, 14: the field popover shows the tip below the text', () => {
  it('digest_models_version', () => {
    const tip = uiOf('digest_models_version').help!.tip!
    expect(tip).toMatch(/the log says v2 is ignored for the table/)
    render(<HelpPopover name="digest_models_version" label="Digest models version" description="d" deflt="shipped" more="m" tip={tip} />)
    fireEvent.click(screen.getByRole('button', { name: 'About Digest models version' }))
    expect(document.querySelector('.help-pop-tip')!.textContent).toBe(tip)
  })
  it('ParamField passes the tip', () => {
    const spec = PARAM_BY_NAME.get('digest_models_version')!
    render(<ParamField spec={spec} value="shipped" onChange={() => {}} />)
    fireEvent.click(document.querySelector('[data-param-help="digest_models_version"]')!)
    expect(document.querySelector('.help-pop-tip')).not.toBeNull()
  })
})

// ---- 15, 16: the alkylation extension ------------------------------------------------

describe('round 7, 15 and 16: the alkylation extension by proteome, restored when unneeded', () => {
  const alk = PRODUCT_OF.get('alkylation_out')!
  const base = { tag_length: '3', extension: '0' }
  it('human and mouse need 8, yeast and E. coli 7; a FASTA file is not raised (round 9, 5)', () => {
    expect(alkylationTarget({})).toBe(8)
    expect(alkylationTarget({ alkylation_proteome: 'mouse' })).toBe(8)
    expect(alkylationTarget({ alkylation_proteome: 'yeast' })).toBe(7)
    expect(alkylationExtension({ ...base, alkylation_proteome: 'auto' })).toBe('3')
    expect(alkylationExtension({ ...base, alkylation_proteome: 'ecoli' })).toBe('2')
    expect(alkylationExtension({ ...base, alkylation_proteome: '/d/my.fasta' })).toBeNull()
  })

  it('another product that places tags restores the raised Extension', () => {
    const on = toggleProduct(alk, true, base, '/d/a.tags.tsv', null)
    expect(on.values['extension']).toBe('3')
    expect(on.raised).toEqual({ from: '0', to: '3' })
    const placed = toggleProduct(PRODUCT_OF.get('recon_out')!, true, on.values, '/d/a.tags.tsv', on.raised)
    expect(placed.values['extension']).toBe('0')
    expect(placed.raised).toBeNull()
    // A protein database set in the form does the same.
    expect(alkylationRaise({ ...on.values, recon_fasta: '/d/db.fasta' }, on.raised).values['extension']).toBe('0')
    // An Extension edited since stays.
    expect(alkylationRaise({ ...on.values, extension: '4', recon_fasta: '/d/db.fasta' }, on.raised)).toMatchObject({ raised: null, values: { extension: '4' } })
    // Still needed (glyco places nothing): kept.
    const glyco = toggleProduct(PRODUCT_OF.get('glyco_out')!, true, on.values, '/d/a.tags.tsv', on.raised)
    expect(glyco.values['extension']).toBe('3')
    expect(glyco.raised).toEqual(on.raised)
  })
})

// ---- 17: the ETD share of the species check --------------------------------------

describe('round 7, 17: species leaves the ETD spectra out only over 1%', () => {
  const values = { fragment_tolerance: '0.3', fragment_tolerance_unit: 'Da', species: true, ion_series: 'auto' }
  const pre = (electron: number, collisional: number) =>
    preStartChecks({
      input: '/d/a.mzML',
      values,
      supported: true,
      probe: parseProbe(iontrapProbe.replace('"of":4000,"collisional":2000,"electron":2000', `"of":${electron + collisional},"collisional":${collisional},"electron":${electron}`))
    })
  it('one ETD scan in 5000: no warning; 100 of 5000: the warning', () => {
    expect(pre(1, 4999).checks.some((c) => c.id === 'cz-species')).toBe(false)
    expect(pre(100, 4900).checks.find((c) => c.id === 'cz-species')!.title).toBe('Species detection leaves the ETD spectra out')
  })
})

// ---- 19: engine defaults ---------------------------------------------------------------

describe('round 7, 19: -1 (by engine) reads as an empty field', () => {
  it('placeholder engine default, and an emptied field sends the default', () => {
    const spec = PARAM_BY_NAME.get('search_missed_cleavages')!
    const got: unknown[] = []
    render(<ParamField spec={spec} value="-1" onChange={(v) => got.push(v)} />)
    const input = document.getElementById('p-search_missed_cleavages') as HTMLInputElement
    expect(input.value).toBe('')
    expect(input.placeholder).toBe('engine default')
    fireEvent.change(input, { target: { value: '3' } })
    expect(got[got.length - 1]).toBe('3')
  })
  it('a set value shows as typed; emptied, it goes back to -1', () => {
    const spec = PARAM_BY_NAME.get('search_isotope_errors')!
    const got: unknown[] = []
    render(<ParamField spec={spec} value="2" onChange={(v) => got.push(v)} />)
    const input = document.getElementById('p-search_isotope_errors') as HTMLInputElement
    expect(input.value).toBe('2')
    fireEvent.change(input, { target: { value: '' } })
    expect(Number(got[got.length - 1])).toBe(-1)
  })
})

// ---- 23: the workflow's tiles first ------------------------------------------------

describe('round 7, 23: the workflow\'s own tiles come first, in the grid of the counts', () => {
  it('Species: Top genus before MS2 and Tags, and no calls row left', () => {
    const o = buildOverview({ log: ['100 MS2 spectra, 300 tags'], reports: [], species: sp([taxon('Homo', 9605, 40)]), census: null, params: { species: true }, instrument: null })
    const t = leadTiles(shownTiles(o, { species: true }), 'species')
    expect(t.figures[0].id).toBe('genus')
    expect(t.figures.map((x) => x.id)).toContain('spectra')
    expect(t.calls.map((x) => x.id)).not.toContain('genus')
    // Generate tags has no lead tiles: unchanged.
    expect(leadTiles(shownTiles(o, { species: true }), 'export-tags')).toEqual(shownTiles(o, { species: true }))
  })
})

// ---- 11: tags in the mono font, sized exactly -----------------------------------

describe('round 7, 11: the tag column fits a 7-residue tag of W and M', () => {
  it('8 px a character (IBM Plex Mono at 13 px is 7.8) plus the cell padding', () => {
    const w = autoWidths(['spectrum', 'tag', 'length'], [['scan=1', 'WMWMWMW', '7']])
    expect(w.tag).toBe(7 * 8 + 20)
    expect(w.tag).toBeGreaterThanOrEqual(Math.ceil(7 * 7.8 + 20))
  })
})
