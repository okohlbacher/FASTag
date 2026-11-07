// The GUI does what the docs say: each test checks a GUI behaviour against a
// sentence in README.md, gui/README.md, doc/DESIGN-digest.md,
// doc/SPECIES-DETECTOR.md or the release notes, or against what the CLI prints.
//
// Real CLI outputs (FASTag 1.9.0 on test/fixtures/Ecoli_MS2_small.mzML) are
// read from the directory named by FASTAG_GUI_TEST_OUTPUTS, so the parsers see
// what the CLI writes; those tests skip when it is unset.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { rebaseOutputs } from '../app/paths'
import DigestPanel from '../DigestPanel'
import SpeciesPanel from '../SpeciesPanel'
import { parseReport } from '../digestReport'
import { HIDDEN, PARAM_BY_NAME, RENDERED } from '../paramLayout'
import manifest from '../params.generated.json'
import { installMockBridge } from '../testing/mockBridge'
import { click, pickSingle, renderApp, runButton } from '../testing/render'
import { applyAndCheck } from '../testing/lastUsed'
import type { SpeciesReport } from '../types'
import digestTsv from '../fixtures/digest.tsv?raw'
import { haveScratch, readScratch } from './external'
import massgapTsv from '../fixtures/massgap.tsv?raw'

const cli = (f: string): string => readScratch(`map/${f}`) as string

// species.rs reader, minus the observed <= 0 filter (none here).
function speciesFromTsv(text: string): SpeciesReport {
  const [, ...lines] = text.trim().split('\n')
  const taxa = lines.map((l) => {
    const [rank, taxid, name, observed, adjusted, , , q] = l.split('\t')
    return { rank, taxid: +taxid, name, observed: +observed, adjusted: +adjusted, q: +q }
  })
  return { path: '/r/run.tags.species.tsv', taxa }
}

describe('docs: failure banner vs what the CLI prints (RN 1.8.0 "error messages")', () => {
  it.skipIf(!haveScratch('docs/short.out', 'docs/short.err'))('a FASTag refusal is followed on stdout by the timing line, and the banner quotes the refusal', async () => {
    // Lines exactly as FASTag 1.9.0 prints them for `-species` with the
    // default tag_length 3 (scratch/docs/short.out + short.err, rc 6).
    const out = (readScratch('docs/short.out') ?? '').trim().split('\n')
    const err = (readScratch('docs/short.err') ?? '').trim()
    expect(err).toMatch(/^-species: tag_length \(3\) .* cannot reach the index k = 7/)
    expect(out[out.length - 1]).toMatch(/^FASTag took .* Peak Memory Usage/)
    const mock = installMockBridge()
    await renderApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    // Process write order: the refusal (stderr) is written before main()
    // returns; TOPPBase prints the timing line (stdout) after it.
    await act(async () => mock.emitLog(out[0]))
    await act(async () => mock.emitLog(err))
    await act(async () => mock.emitLog(out[out.length - 1]))
    await act(async () => mock.emitDone({ ok: false, code: 6, runId: 1 }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/a\.mzML failed \(exit code 6\)FASTag's reason:-species: tag_length \(3\)/)
    expect(alert.textContent).not.toMatch(/FASTag took/)
  })
})

describe('docs: species precondition (README "FASTag refuses the run up front")', () => {
  it('like the CLI, the GUI refuses the run up front: Run is disabled and the reason sits beside it', async () => {
    const mock = installMockBridge()
    mock.settings.lastUsed = { species: true, tag_length: '3' }
    mock.taxdbInfoResult = { path: '/b/tax_k7.taxdb', k: 7 }
    const c = await renderApp(mock)
    await applyAndCheck(mock.settings.lastUsed!) // D6: the offer, clicked; guards the form
    await pickSingle(mock, '/d/a.mzML')
    expect((runButton() as HTMLButtonElement).disabled).toBe(true)
    expect(c.querySelector('.controls')!.textContent).toMatch(/cannot reach the species index k = 7/)
    await click(screen.getByRole('tab', { name: /Species/ }))
    expect(screen.getByText(/FASTag refuses the run/)).toBeDefined()
    expect(screen.queryByText(/the report would be empty/)).toBeNull()
  })
})

describe('docs: species headline and footnote vs SPECIES-DETECTOR.md / README', () => {
  it.skipIf(!haveScratch('map/run.tags.species.tsv'))('no "after subtracting shared sequence" on a run without -species_deconvolve, where adjusted == observed', () => {
    const rep = speciesFromTsv(cli('run.tags.species.tsv'))
    expect(rep.taxa.every((t) => t.adjusted === t.observed)).toBe(true) // the CLI did not deconvolve
    const { container } = render(
      <SpeciesPanel report={rep} enabled tooShort={null} contributed={7} totalMs2={139} />
    )
    // The tied fixture also renders a tie sub-line; the count is the last one.
    expect([...container.querySelectorAll('.headline .sub')].pop()?.textContent).toBe('7 spectra')
    expect(container.querySelector('.headline')?.textContent).not.toMatch(/subtracting/)
    expect(container.querySelector('.footnote')?.textContent).not.toMatch(/has been subtracted/)
    expect(container.querySelector('.footnote')?.textContent).toMatch(/Shared sequence was not subtracted/)
  })
  it.skipIf(!haveScratch('map/run.tags.species.tsv'))('the adjusted column is headed "adjusted", as SPECIES-DETECTOR.md names it, and shown when the run deconvolved', () => {
    const rep = speciesFromTsv(cli('run.tags.species.tsv'))
    const { container, unmount } = render(<SpeciesPanel report={rep} enabled tooShort={null} contributed={null} totalMs2={null} />)
    let heads = within(within(container).getAllByRole('row')[0]).getAllByRole('columnheader').map((h) => h.textContent)
    // Without -species_deconvolve adjusted == observed: no second column of the same numbers.
    expect(heads).not.toContain('Adjusted')
    expect(heads).not.toContain('enrich.')
    expect(container.querySelector('.footnote')?.textContent).toMatch(/species_deconvolve to add an Adjusted column/)
    unmount()
    const dec = { ...rep, taxa: rep.taxa.map((t, i) => (i === 0 ? { ...t, adjusted: t.adjusted - 1 } : t)) }
    const r2 = render(<SpeciesPanel report={dec} enabled tooShort={null} contributed={null} totalMs2={null} />)
    heads = within(within(r2.container).getAllByRole('row')[0]).getAllByRole('columnheader').map((h) => h.textContent)
    expect(heads.map((h) => h?.toLowerCase())).toContain('adjusted')
    expect(heads).not.toContain('enrich.')
  })
})

describe('docs: Digest tab vs doc/DESIGN-digest.md "GUI: Digest tab"', () => {
  it('the mass-gap distribution is drawn first, "followed by the peaks"', () => {
    const r = parseReport(massgapTsv, '/r/a.massgap.tsv')
    const { container } = render(<DigestPanel reports={[r]} errors={[]} onOpen={() => {}} />)
    const tables = [...container.querySelectorAll('section.dg-block > table')]
    const peaksAt = tables.findIndex((t) => t.textContent?.includes('Explained by'))
    const distAt = tables.findIndex((t) => t.classList.contains('gaps'))
    expect(distAt).toBeGreaterThanOrEqual(0)
    expect(peaksAt).toBeGreaterThan(distAt)
  })

  it('a call with no model of another class (DigestReport.cpp:248-250) shows neither runner-up nor margin', () => {
    const t = digestTsv
      .replace(/^call\trunner_up\t.*$/m, 'call\trunner_up\tnone\t-\tNo model of another class is in the table.')
      .replace(/^call\trunner_up_class\t.*$/m, 'call\trunner_up_class\tnone\t-\tNo model of another class is in the table.')
      .replace(/^call\tmargin\t.*$/m, 'call\tmargin\t-\t-\tWithout a model of another class there is no margin.')
    const r = parseReport(t, '/r/a.digest.tsv')
    const { container } = render(<DigestPanel reports={[r]} errors={[]} onOpen={() => {}} />)
    expect(container.querySelector('.headline .sub')?.textContent).toBe('N end not used')
    const stats = [...container.querySelectorAll('.headline dt')].map((d) => d.textContent)
    expect(stats).toEqual(['Called', 'Tag ends used']) // no runner-up, no margin
    const logos = [...container.querySelectorAll('svg[role="img"]')].map((l) => l.getAttribute('aria-label')?.split(':')[0])
    expect(logos).toEqual(['Observed', 'Called'])
  })

  it.skipIf(!haveScratch('map/run.digest.tsv', 'map/run.label.tsv'))('opening a report of a different file with the same basename closes the other reports (the CLI writes run.input as a basename)', async () => {
    // Real 1.9.0 reports: run.input is "Ecoli_MS2_small.mzML", no directory.
    const dig = cli('run.digest.tsv')
    const lab = cli('run.label.tsv')
    expect(dig).toMatch(/^run\tinput\tEcoli_MS2_small\.mzML\t/m)
    const mock = installMockBridge()
    mock.reportFiles = { '/rep1/Ecoli_MS2_small.label.tsv': lab, '/rep2/Ecoli_MS2_small.digest.tsv': dig }
    await renderApp(mock)
    mock.nextPickReport = '/rep1/Ecoli_MS2_small.label.tsv'
    await click(screen.getByRole('button', { name: 'Open a digest, label or mass-gap report…' }))
    mock.nextPickReport = '/rep2/Ecoli_MS2_small.digest.tsv'
    await click(screen.getByRole('button', { name: 'Open another report…' }))
    // Another folder is another run: the label report is closed, with a note.
    const panel = screen.getByRole('tabpanel')
    expect(within(panel).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Protease'])
    expect(screen.getByText(/Ecoli_MS2_small\.digest\.tsv is from another run of Ecoli_MS2_small\.mzML; \/rep1\/Ecoli_MS2_small\.label\.tsv was closed/)).toBeTruthy()
  })
})

describe('docs: RN 1.9.0 "a new input no longer overwrites the previous sample\'s reports"', () => {
  it('two inputs with the same file name in different folders get their own report paths', () => {
    const cfg = { digest_out: '/res/sample.digest.tsv', recon_out: '/res/sample.recon.tsv', species_out: '/res/sample.species.tsv' }
    const a = rebaseOutputs(cfg, '/runA/sample.tags.tsv')
    const b = rebaseOutputs(a, '/runB/sample.tags.tsv')
    expect(b).not.toEqual(a)
    expect(a['digest_out']).toBe('/runA/sample.digest.tsv')
    expect(b['digest_out']).toBe('/runB/sample.digest.tsv')
  })
  it('the second run is sent its own digest_out', async () => {
    const mock = installMockBridge()
    mock.settings.lastUsed = { digest_out: '/res/old.digest.tsv' }
    await renderApp(mock)
    await applyAndCheck(mock.settings.lastUsed!) // D6: the offer, clicked; guards the form
    await pickSingle(mock, '/runA/sample.mzML')
    await click(runButton())
    await act(async () => mock.emitDone({ ok: true, code: 0, runId: 1 }))
    await pickSingle(mock, '/runB/sample.mzML')
    await click(runButton())
    const [r1, r2] = mock.runCalls
    expect(r1.out).not.toBe(r2.out) // the tags differ ...
    expect(r1.params['digest_out']).toBe('/runA/sample.digest.tsv')
    expect(r2.params['digest_out']).toBe('/runB/sample.digest.tsv') // ... and so do the reports
  })
})

describe('docs: code comments that promise the CLI will not reject a GUI value', () => {
  it('orientation takes the manifest choices, with no overlay value the CLI rejects', () => {
    const raw = (manifest.params as { name: string; choices?: string[] }[]).find((p) => p.name === 'orientation')
    expect(raw?.choices).toEqual(['both', 'forward'])
    expect(PARAM_BY_NAME.get('orientation')?.choices).toEqual(['both', 'forward'])
  })
  it('max_peaks 2000 is marked invalid and never sent', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await click(screen.getByRole('button', { name: /^Spectra/ }))
    const f = document.getElementById('p-max_peaks') as HTMLInputElement
    expect(f.type).toBe('text')
    await act(async () => {
      fireEvent.change(f, { target: { value: '2000' } })
    })
    expect(f.getAttribute('aria-invalid')).toBe('true')
    await pickSingle(mock, '/d/a.mzML')
    expect((runButton() as HTMLButtonElement).disabled).toBe(true)
    await click(runButton())
    expect(mock.runCalls).toHaveLength(0)
  })
  it('the 14 advanced FASTag parameters are in the manifest, and the ignored mzpeak_read_memory is hidden', () => {
    const own = ['version', 'log', 'debug', 'no_progress', 'force', 'test']
    const adv = (manifest.params as { name: string; toppAdvanced: boolean }[]).filter((p) => p.toppAdvanced && !own.includes(p.name))
    expect(adv.length).toBe(14)
    expect(adv.map((p) => p.name)).toContain('massgap_window')
    expect(HIDDEN.mzpeak_read_memory).toBeDefined()
    expect(RENDERED).not.toContain('mzpeak_read_memory')
  })
})
