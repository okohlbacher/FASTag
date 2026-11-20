// Review round 9: a ladder that cannot be built (1), the re-run actions of
// an older History run (2), a drop of reports with a species report (3),
// the alkylation extension on a replacement and on a custom database (4-7,
// 9), the (?) popover's order (8), the species ranking word (11), the Mass
// shifts stats (12), a report of an unfinished run (14) and the empty
// Results opener (16).

import { act, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LadderLine } from '../spectrum/SpectrumPanel'
import { ladderFor, residueMasses, tagRowFrom } from '../spectrum/ladder'
import type { SpectrumPeaks } from '../spectrum/dump'
import { popoverTexts } from '../help/HelpPopover'
import { PARAM_UI } from '../paramUi'
import { alkylationExtension, alkylationNeed, alkylationShort, alkylationTarget, PRODUCT_OF, toggleProduct } from '../setup/products'
import { TASKS } from '../setup/tasks'
import { DIGEST } from '../help/content'
import { parseReport } from '../digestReport'
import { buildOverview, shownTiles } from './overview'
import { speciesCall } from './calls'
import { installMockBridge } from '../testing/mockBridge'
import { click, flush, goTo, pickSingle, renderApp, renderColdApp, runButton } from '../testing/render'
import { formValue } from '../testing/lastUsed'
import { speciesFromTsv } from '../testing/speciesTsv'
import type { RunRecord } from '../types'
import charDigest from '../fixtures/cli-1.15/workflows/characterize/run01.digest.tsv?raw'
import charLabel from '../fixtures/cli-1.15/workflows/characterize/run01.label.tsv?raw'
import charSpecies from '../fixtures/cli-1.15/workflows/characterize/run01.tags.species.tsv?raw'
import qcTsv from '../fixtures/cli-1.15/ecoli_ms2_small_0.3da.qc.tsv?raw'

const peaks = (mz: number[]): SpectrumPeaks => ({
  nativeId: 'scan=1',
  index: 0,
  msLevel: 2,
  rt: null,
  precursor: 800,
  charge: 2,
  chargeGiven: 2,
  tolerance: 10,
  toleranceUnit: 'ppm',
  picked: false,
  deisotoped: true,
  tagged: true,
  nRead: mz.length,
  mz,
  int: mz.map(() => 100)
})

describe('round 9, 1: a ladder that cannot be built says why', () => {
  const columns = ['spectrum', 'tag', 'length', 'charge', 'nterm_mass', 'cterm_mass', 'extended', 'gapped', 'evalue']
  it('a modification without a known mass: the verdict, no steps, no crash', () => {
    const row = tagRowFrom(columns, ['scan=1', 'PEC[Carboxymethyl]K', '4', '1', '200', '300', '0', '0', '0.01'])!
    const lad = ladderFor(row, peaks([300, 400, 500]), residueMasses([]))
    expect(lad.positions).toEqual([])
    render(<LadderLine ladder={lad} tag={row.tag} unit="ppm" />)
    expect(screen.getByTestId('ladder-verdict').textContent).toBe('no ladder: no mass for the modification Carboxymethyl')
    expect(screen.queryByRole('list', { name: 'Ladder steps' })).toBeNull()
  })
})

function rec(id: string, input: string, out: string, params: Record<string, unknown>, extra: Partial<RunRecord> = {}): RunRecord {
  return {
    id,
    input,
    outputs: [out],
    cwd: input.slice(0, input.lastIndexOf('/')),
    argv: ['/e2e/FASTag', '-in', input, '-out', out],
    status: 'ok',
    exitCode: 0,
    message: null,
    start: 1762419600000,
    end: 1762419641000,
    cleanup: { removed: [], renamed: [], failed: [] },
    params,
    ...extra
  }
}

async function historyRows(): Promise<HTMLElement[]> {
  await goTo('history')
  const table = await screen.findByRole('table', { name: 'Run history' })
  return within(table).getAllByRole('row').slice(1)
}

describe('round 9, 2: the re-run actions belong to the run on screen', () => {
  it('an older History run of the same input with other settings offers no re-run', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await waitFor(() => expect(mock.runCalls).toHaveLength(1))
    await act(async () => mock.emitDone({ ok: true, code: 0, runId: mock.lastRunId }))
    await goTo('results')
    await click(screen.getByRole('tab', { name: 'Tags' }))
    // The session's own run: the form would repeat it.
    expect(await screen.findByRole('button', { name: 'Re-run with per-residue confidence' })).toBeTruthy()
    // An older run of the same input, sent another tag length, to another file.
    mock.history = [rec('old', '/d/a.mzML', '/d/a.old.tags.tsv', { tag_length: '5' }), ...mock.history]
    const rows = await historyRows()
    const old = rows.find((r) => /a\.old/.test(r.textContent ?? '') || within(r).queryAllByRole('cell').some((c) => c.getAttribute('title') === '/d/a.old.tags.tsv'))!
    await click(within(old ?? rows[0]).getByRole('button', { name: 'Open' }))
    await flush()
    await goTo('results')
    await click(screen.getByRole('tab', { name: 'Tags' }))
    await flush()
    expect(screen.queryByRole('button', { name: 'Re-run with per-residue confidence' })).toBeNull()
  })
})

describe('round 9, 3: a drop of reports and a species report opens all of them', () => {
  it('the digest and label reports of the drop both open beside its species report', async () => {
    const mock = installMockBridge()
    mock.reportFiles['/d/run01.digest.tsv'] = charDigest
    mock.reportFiles['/d/run01.label.tsv'] = charLabel
    mock.speciesFiles = { '/d/run01.tags.species.tsv': speciesFromTsv(charSpecies, '/d/run01.tags.species.tsv') }
    await renderColdApp(mock)
    await act(async () =>
      mock.emitDrop({
        reports: [
          { kind: 'digest', path: '/d/run01.digest.tsv' },
          { kind: 'label', path: '/d/run01.label.tsv' },
          { kind: 'species', path: '/d/run01.tags.species.tsv' }
        ]
      })
    )
    await flush()
    await waitFor(() => expect(screen.getAllByRole('tab').some((t) => /^Species/.test(t.textContent ?? ''))).toBe(true))
    const digest = screen.getAllByRole('tab').find((t) => /^Digest/.test(t.textContent ?? ''))!
    await waitFor(() => expect(digest.querySelector('.count')?.textContent).toBe('2'))
  })
})

describe('round 9, 4: values that replace the form are not raised', () => {
  it('History Settings with the alkylation report and Extension 2 keep 2, with the note and a one-click raise', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await pickSingle(mock, '/d/x.mzML')
    mock.history = [rec('1', '/d/a.mzML', '/d/a.tags.tsv', { alkylation_out: '/d/a.alkylation.tsv', extension: '2', tag_length: '3' }, { workflow: 'characterize' })]
    const [row] = await historyRows()
    await click(within(row).getByRole('button', { name: 'Settings into form' }))
    await goTo('setup')
    await flush()
    expect(await formValue('extension')).toBe('2')
    const note = document.getElementById('out-alkylation_out-d')!
    expect(note.textContent).toBe('Needs Extension 3: shorter tags do not place on the proteome.')
    await click(screen.getByRole('button', { name: 'Set Extension to 3' }))
    expect(await formValue('extension')).toBe('3')
  })
})

describe('round 9, 5-7: one rule for every database the alkylation report places on', () => {
  const alk = PRODUCT_OF.get('alkylation_out')!
  it('a shipped proteome raises; a FASTA proteome and a Protein database do not, and say the human-sized need', () => {
    expect(alkylationExtension({ tag_length: '3', extension: '0' })).toBe('3')
    expect(alkylationExtension({ alkylation_proteome: '/x/three.fasta', tag_length: '3', extension: '0' })).toBeNull()
    expect(alkylationShort({ alkylation_proteome: '/x/three.fasta', tag_length: '3', extension: '0' })).toBe('3')
    expect(alkylationExtension({ recon_fasta: '/x/human.fasta', tag_length: '3', extension: '2' })).toBeNull()
    expect(alkylationShort({ recon_fasta: '/x/human.fasta', tag_length: '3', extension: '2' })).toBe('3')
    const on = toggleProduct(alk, true, { recon_fasta: '/x/human.fasta', tag_length: '3', extension: '2' }, '/d/a.tags.tsv', null)
    expect(on.values['extension']).toBe('2')
    // Another report that places tags sets the index up itself.
    expect(alkylationNeed({ recon_out: '/d/a.recon.tsv', tag_length: '3', extension: '0' })).toBeNull()
  })
  it('the minimum tag length the run sets is the target (6 needs less, 10 more)', () => {
    expect(alkylationTarget({ recon_min_length: '6' })).toBe(6)
    expect(alkylationExtension({ recon_min_length: '6', tag_length: '3', extension: '0' })).toBe('2')
    expect(alkylationExtension({ recon_min_length: '10', tag_length: '3', extension: '3' })).toBe('4')
    expect(alkylationTarget({ recon_min_length: '0', alkylation_proteome: 'yeast' })).toBe(7)
  })
  it('tag_lengths replaces tag_length: the longest seed counts', () => {
    expect(alkylationExtension({ tag_lengths: ['3', '5'], tag_length: '3', extension: '0' })).toBe('2')
    expect(alkylationExtension({ tag_lengths: ['2'], tag_length: '4', extension: '0' })).toBe('3')
  })
  it('the Overview names the run\'s minimum and offers the extension that reaches it', () => {
    const text = [
      'section\tkey\tvalue\tn\tdescription',
      'alk_run\tformat\t1\t-\t-',
      'alk_run\tdatabase_source\tbundled:human\t-\t-',
      'alkylation_call\tstatus\tno_call\t42\t-',
      'alkylation_call\treason\ttags_too_short\t-\t-'
    ].join('\n')
    const params = { alkylation_out: '/d/a.alkylation.tsv', recon_min_length: '10', tag_length: '3', extension: '3' }
    const o = buildOverview({ log: [], reports: [parseReport(text, '/d/a.alkylation.tsv')], species: null, census: null, params, instrument: null })
    const t = [...o.figures, ...o.calls].find((x) => x.id === 'alkylation')!
    expect(t.value).toBe('no call')
    expect(t.note).toMatch(/no tag reaches the 10 residues/)
    expect(t.action).toEqual({ kind: 'enable', label: 'Run again with extension 4', values: { extension: '4' } })
  })
  it('the Characterize note, the proteome help and the mass-gap help say the same rule', () => {
    const note = TASKS.find((t) => t.id === 'characterize')!.productNotes!['alkylation_out']
    expect(note).toMatch(/A FASTA of your own \(as the proteome or as Protein database\)[^.]*: Extension is not raised/)
    const help = PARAM_UI['alkylation_proteome'].help!.text
    expect(help).not.toMatch(/or choose a protein database/)
    expect(help).toMatch(/Extension is not raised for it/)
    // The mass-gap help (round 9, 9) against alkylationTarget/Extension.
    const page = render(<>{DIGEST.sections.map((x, k) => <div key={k}>{x.body}</div>)}</>).container.textContent ?? ''
    expect(page).toMatch(/not on a FASTA of your own, as the proteome or as Protein database/)
    expect(alkylationExtension({ alkylation_proteome: '/x/p.fasta', tag_length: '3', extension: '0' })).toBeNull()
    expect(alkylationExtension({ recon_fasta: '/x/p.fasta', tag_length: '3', extension: '0' })).toBeNull()
    expect(alkylationExtension({ alkylation_proteome: 'human', tag_length: '3', extension: '0' })).toBe(String(Math.ceil((alkylationTarget({}) - 3) / 2)))
    expect(alkylationExtension({ alkylation_proteome: 'yeast', tag_length: '3', extension: '0' })).toBe('2')
  })
})

describe('round 9, 8: the (?) shows the plain text first, and the CLI facts it lacks', () => {
  const cli = (n: string, d: string): ReturnType<typeof popoverTexts> => popoverTexts(d, PARAM_UI[n].help!.text, PARAM_UI[n].help!.tip, PARAM_UI[n].help!.cliCovered)
  it('the plain text first; the CLI line only when it adds something', () => {
    const v = cli('digest_models_version', "Shipped protease models of digest_out: 'shipped' (1.11) or 'v2' (detection, LysargiNase and Asp-N_ambic rows, pooled specificity; not validated on held-out data)")
    expect(v.text).toMatch(/^Which protease models/)
    expect(v.cli).toBeUndefined()
  })
  it('the facts the CLI line held are in the plain text now', () => {
    expect(PARAM_UI['species_pi0'].help!.text).toMatch(/Storey/)
    expect(PARAM_UI['charge_min'].help!.text).toMatch(/1\+/)
    expect(PARAM_UI['digest_models'].help!.text).toMatch(/model, class, end, residue, freq/)
    expect(PARAM_UI['alkylation_proteome'].help!.text).toMatch(/\.gz/)
  })
  it('13: the TMT reporter filter names b/y tags and the TMT6/10 reporter ions', () => {
    expect(PARAM_UI['tmt_reporter_filter'].help!.text).toBe('Also reject b/y tags whose low end is a singly charged TMT6/10 reporter ion. Needs the TMT pseudo-tag filter on or auto.')
  })
})

describe('round 9, 11: the Overview says the count the ranking is by', () => {
  it('observed spectra without deconvolution, adjusted count with it', () => {
    const sp = speciesFromTsv(charSpecies, '/d/run01.tags.species.tsv')
    const c = speciesCall(sp)
    if (c.state !== 'ranked') return
    const deconvolved = sp.taxa.some((t) => t.adjusted !== t.observed)
    expect(c.counted).toBe(deconvolved ? 'adjusted' : 'observed')
    const o = buildOverview({ log: ['1000 MS2 spectra, 500 tags'], reports: [], species: sp, census: null, params: { species: true }, instrument: null })
    const genus = shownTiles(o, { species: true }).calls.concat(shownTiles(o, { species: true }).figures).find((t) => t.id === 'genus')!
    expect(genus.note).toMatch(deconvolved ? /by adjusted count/ : /by observed spectra/)
  })
})

describe('round 9, 14: a report of a run that did not finish opens marked', () => {
  it('a QC report whose run failed shows "Reports may be partial"', async () => {
    const mock = installMockBridge()
    mock.reportFiles['/d/a.qc.tsv'] = qcTsv
    mock.nextPickReport = '/d/a.qc.tsv'
    mock.history = [rec('1', '/d/a.mzML', '/d/a.tags.tsv', { qc_out: '/d/a.qc.tsv' }, { outputs: ['/d/a.tags.tsv', '/d/a.qc.tsv'], status: 'failed', exitCode: 2 })]
    await renderColdApp(mock)
    await goTo('results')
    await click(screen.getByRole('button', { name: 'Open a FASTag report…' }))
    await waitFor(() => expect(screen.getByText('Reports may be partial.')).toBeTruthy())
    expect(screen.getByText('Reports may be partial.').parentElement!.textContent).toMatch(/a\.qc\.tsv \(failed/)
  })
})
