// @ts-nocheck -- test-only file; uses node APIs outside the app tsconfig
// Help says what the docs say: each key claim of the Help pages is pinned to
// the sentence in README.md, doc/DESIGN-digest.md or doc/SPECIES-DETECTOR.md
// that it restates, so the two cannot drift apart unnoticed.
import { act, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import HelpView from './HelpView'
import { resetHelp, showHelpPage } from './link'
import { LANDING_TASK, taskById } from '../setup/tasks'

const repo = join(__dirname, '..', '..', '..')
const doc = (f: string): string => readFileSync(join(repo, f), 'utf8').replace(/\s+/g, ' ')

function pageText(page: string): string {
  resetHelp()
  act(() => showHelpPage(page))
  const { container, unmount } = render(<HelpView />)
  // Details bodies are in the DOM while closed, so textContent has them.
  const t = (container.textContent ?? '').replace(/\s+/g, ' ')
  unmount()
  return t
}

afterEach(() => resetHelp())

describe('help vs docs', () => {
  it('describes the actual first-run task and existing results views', () => {
    expect(LANDING_TASK).toBe('export-tags')
    expect(taskById(LANDING_TASK)!.values).toEqual({ res_conf: true })
    const start = pageText('start')
    expect(start).toContain('Export tags, the default task')
    expect(start).toContain('tags from all input spectra and includes per-residue confidence')
    expect(start).toContain('Results opens on Tags')
    expect(start).toContain('Open results / inspect spectra')
    // QC remains available as an explicit optional workflow.
    expect(taskById('characterize')!.values).toMatchObject({ species: true, extension: '2', subsample_fraction: '0.1', digest_out: 'digest.tsv', label_out: 'label.tsv', glyco: true })
    expect(start).toContain('For a separate QC survey, choose Characterize a run')
    expect(start).toContain('These tasks sample 10% of the spectra')
    expect(start).toContain('opening on Overview')
    expect(start).not.toContain('Every other setting starts at')
    const files = pageText('files')
    expect(files).toContain('Glyco tab lists these spectra')
    expect(files).not.toContain('report has no tab')
  })

  const readme = doc('README.md')
  const digest = doc('doc/DESIGN-digest.md')
  const species = doc('doc/SPECIES-DETECTOR.md')
  const tagger = doc('src/FASTagger.cpp')

  // [doc text, sentence in the doc, page, sentence in Help]
  const claims: [string, string, string, string][] = [
    [tagger, 'use_compl ? 3 : 2', 'results', 'This component is omitted when the spectrum has no complementary pairs'],
    [tagger, 'pair shares one score', 'results', 'That step counts once in Mean conf., even though its score appears twice in the residue list'],
    [readme, '`auto` reads the activation of mzML input only', 'tags', 'Automatic selection uses activation metadata from mzML only'],
    [readme, 'or no call on a Da tolerance or below 175 C-terminal tag ends', 'digest', 'The label call needs at least 175 counted C-terminal ends and a ppm tolerance'],
    [readme, '`decoy_qvalue` are not calibrated', 'species', 'neither its calls nor its decoy q-values are calibrated error guarantees'],
    [readme, 'The E-value ranks tags; it is not a calibrated expected count.', 'results', 'The E-value ranks tags; it is not an error rate, and its value does not tell how many such tags arise by chance'],
    [readme, 'so it can exceed `-max_evalue`; divide by the penalty for the raw E-value', 'results', 'divide it by the gap penalty (100 by default) to compare it with the cutoff'],
    [readme, '`-out run.tags.tsv` gives `run.tags.species.tsv` and `run.tags.glyco.tsv`', 'files', '<name>.tags.species.tsv'],
    [readme, 'is the ranking value, E × `-gap_penalty`', 'tags', 'the E-value printed for it includes that factor'],
    [readme, 'gapped tags take **95% of rank-1 slots while being 3.6x less likely to be correct**', 'tags', 'a gapped tag was the top-ranked tag in 95% of simulated spectra, yet a top-ranked gapped tag was 3.6 times less often correct'],
    [readme, 'with up to eight spellings', 'tags', 'At most eight spellings'],
    [readme, 'on an ion-trap file, 20 ppm returned 3,007 tags where 0.3 Da returned 824,959', 'troubleshooting', '20 ppm gave 3,007 tags and 0.3 Da gave 824,959'],
    [digest, '`gapped == 0` and `evalue <= 1`', 'digest', 'Only tags without a gap and with an E-value of at most 1 are counted'],
    [digest, '(0.008 Da, `TERMINUS_WINDOW_DA`)', 'digest', 'within 0.008 Da'],
    [readme, 'C counts at its carbamidomethyl mass (160.03065 Da', 'digest', 'C counts at its carbamidomethyl mass (160.031 Da)'],
    [readme, 'Each protease model, mixed with 5 % background', 'digest', 'Each model is mixed with 5% of a background'],
    [digest, 'only when `n_n ≥ -digest_tag_min` (100, `TAG_MIN`)', 'digest', 'The N-terminal ends are used only when there are at least 100 of them'],
    [digest, 'the runner-up is the best model of **another class**', 'digest', 'The runner-up is the best model of a different protease'],
    [digest, 'K+TMT, K+TMTpro, K+iTRAQ4 and K+8 added to K, R+10 left out', 'digest', 'heavy R (Arg10) is left out of the protease counts'],
    [digest, 'a call needs two of them', 'settings', 'a SILAC call needs two of Lys4, Arg6, Lys8 and Arg10'],
    [readme, 'first-peak rule needs no metadata', 'troubleshooting', 'so it also works when the file has no instrument information'],
    [species, 'Only ungapped tags count.', 'species', 'Only tags without a gap count by default'],
    [species, 'A tag supports a taxon only if EVERY one of its k-mers is in that taxon', 'species', 'A tag supports an organism only if every one of its pieces occurs in that organism'],
    [readme, 'A taxon needs at least 5 supporting spectra to be tested', 'species', 'with at least 5 spectra are listed, at most 50'],
    [readme, 'showing at most 50 rows', 'species', 'at most 50'],
    [readme, 'admitting gapped tags drops the true genus from rank 1 to rank 20', 'species', 'moved the true genus from rank 1 to rank 20'],
    [species, '| Eclipse ion-trap | Homo | **2** | **38** |', 'species', 'pushed Homo from rank 2 to rank 38'],
    [species, 'Reduced reference = genus/family only.', 'species', 'Genus or family, not species.'],
    [readme, '`q` is a ranking aid, not a calibrated FDR', 'species', 'Neither is a calibrated false discovery rate'],
    [readme, 'hits can outrank the true genus (q stays the better guide there)', 'species', 'there the q-value is the better guide'],
    [readme, '`q_db` is conservative at `<= 0.02`', 'results', 'q_db at 0.02 or below was higher than the real chance rate (on the safe side)'],
    [digest, '`<L>.count` = `near(n, m) + near(c, m)`', 'digest', 'The count adds the N-term and C-term flanks'],
    [readme, 'Each length is tagged, scored and capped by `-max_tags` exactly as on its own', 'results', 'each length has its own limit of 50'],
    [readme, '**underestimates the true false-match rate ~1.6x at 0.05–0.1**', 'results', 'at 0.05 to 0.1 the real rate was about 1.6 times higher']
  ]

  for (const [text, inDoc, page, inHelp] of claims) {
    it(`${page}: "${inHelp}"`, () => {
      expect(text).toContain(inDoc)
      expect(pageText(page)).toContain(inHelp)
    })
  }
})
