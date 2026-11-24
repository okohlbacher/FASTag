// The Overview's model (GUI-DESIGN 3 S3) over real CLI output on the gate
// PXDs: every tile names its cutoff or caveat, every suggested setting its
// evidence, and nothing is a call the CLI did not make (Q2).

import { describe, expect, it } from 'vitest'
import { alkylationCall, parseReport } from '../digestReport'
import ALKYLATION_TAGS from '../fixtures/alkylation-tags.tsv?raw'
import { CLI_CASES, logLines, type CliCase } from '../testing/cliFixtures'
import { speciesFromTsv } from '../testing/speciesTsv'
import { addNote, alkylationReason, buildOverview, MIN_TAGGED, type Overview, type Tile } from './overview'

function overviewOf(c: CliCase, extra: { instrument?: string | null } = {}): Overview {
  const reports = [parseReport(c.digest, `/d/${c.name}.digest.tsv`), parseReport(c.label, `/d/${c.name}.label.tsv`)]
  if (c.massgap) reports.push(parseReport(c.massgap, `/d/${c.name}.massgap.tsv`))
  return buildOverview({
    log: logLines(c),
    reports,
    species: speciesFromTsv(c.species, `/d/${c.name}.species.tsv`),
    census: c.census ?? null,
    params: c.params,
    instrument: extra.instrument ?? null
  })
}
const tile = (o: Overview, id: string): Tile => {
  const t = [...o.figures, ...o.calls].find((x) => x.id === id)
  if (!t) throw new Error(`no tile ${id}`)
  return t
}
const line = (o: Overview, setting: string) => {
  const s = o.suggestions.find((x) => x.setting === setting)
  if (!s) throw new Error(`no line ${setting}`)
  return s
}

describe('Overview model: key figures', () => {
  it('counts from the CLI summary line and the digest filter, each with its cutoff', () => {
    const o = overviewOf(CLI_CASES.v112)
    expect(tile(o, 'spectra').value).toBe('2,738')
    expect(tile(o, 'spectra').note).toMatch(/subsampled: 3,251 of 32,513 input spectra/)
    expect(tile(o, 'tags').value).toBe('128,821')
    expect(tile(o, 'filtered').value).toBe('38,300')
    expect(tile(o, 'filtered').note).toMatch(/E-value ≤ 1/)
    expect(tile(o, 'glyco').value).toBe('1,318 flagged')
    expect(tile(o, 'glyco').note).toMatch(/of 2,738 MS2 spectra.*not an identification/)
  })

  it('spectra with tags come from the census; without one the tile says so', () => {
    const called = overviewOf(CLI_CASES.v112Call)
    expect(tile(called, 'tagged').value).toBe('2,723 (99.45%)')
    expect(tile(called, 'tagged').note).toMatch(/identifiability/)
    const plain = overviewOf(CLI_CASES.v112)
    expect(tile(plain, 'tagged').value).toBe('not counted')
    expect(tile(plain, 'tagged').note).toMatch(/identifiability/)
  })

  it('every tile names its cutoff or caveat', () => {
    for (const c of Object.values(CLI_CASES)) {
      const o = overviewOf(c)
      for (const t of [...o.figures, ...o.calls]) expect(t.note.trim(), `${c.name} ${t.id}`).not.toBe('')
      for (const s of o.suggestions) expect(s.note.trim(), `${c.name} ${s.setting}`).not.toBe('')
    }
  })
})

describe('Overview model: calls', () => {
  it('protease from the digest call', () => {
    const o = overviewOf(CLI_CASES.v112)
    expect(tile(o, 'protease')).toMatchObject({ value: 'Trypsin', tone: 'call' })
    expect(tile(o, 'protease').note).toMatch(/4,257 C-terminal tag ends.*margin 1\.08.*Lys-C/)
  })

  it('top genus from the ranking, labelled as a ranking, not a presence call', () => {
    const o = overviewOf(CLI_CASES.v112)
    expect(tile(o, 'genus').value).toBe('Homo')
    expect(tile(o, 'genus').note).toMatch(/q = <1e-300; ranked first of 50 taxa at genus rank.*not a presence call/)
  })

  it('top genus from -species_call when present, with the other present genera', () => {
    const o = overviewOf(CLI_CASES.v112Call)
    expect(tile(o, 'genus').value).toBe('Homo')
    expect(tile(o, 'genus').note).toMatch(/present by the CLI species call.*also present: Macaca, Sus, Equus/)
  })

  it.each(['few_spectra', 'low_resolution', 'homology'])('does not turn a %s no-call into biological absence', (reason) => {
    const o = buildOverview({
      log: [], reports: [], census: null, params: {}, instrument: null,
      species: { path: '/d/species.tsv', taxa: [
        { rank: 'genus', taxid: 9605, name: 'Homo', observed: 9, adjusted: 9, q: 1, call: 'no_call', callReason: reason }
      ] }
    })
    expect(tile(o, 'genus')).toMatchObject({ value: 'no presence call', tone: 'nocall' })
    expect(tile(o, 'genus').note).toContain('does not establish absence')
    expect(o.suggestions.find((s) => s.setting === 'database')).toBeUndefined()
  })

  // Round 5, 9: an exact tie at the top of the ranking is no single leader
  // (the Species tab says the same) and suggests no proteome.
  it('a tie at the top of the ranking names no leader and suggests no database', () => {
    const o = buildOverview({
      log: [], reports: [], census: null, params: {}, instrument: null,
      species: { path: '/d/species.tsv', taxa: [
        { rank: 'genus', taxid: 561, name: 'Escherichia', observed: 40, adjusted: 40, q: 0.01 },
        { rank: 'genus', taxid: 590, name: 'Salmonella', observed: 40, adjusted: 40, q: 0.01 },
        { rank: 'genus', taxid: 9605, name: 'Homo', observed: 3, adjusted: 3, q: 0.5 }
      ] }
    })
    expect(tile(o, 'genus')).toMatchObject({ value: 'No single leader', tone: 'nocall' })
    expect(tile(o, 'genus').note).toMatch(/Escherichia, Salmonella/)
    expect(o.suggestions.find((s) => s.setting === 'database')).toBeUndefined()
  })

  it('describes not_detected taxa as undetected rather than absent', () => {
    const o = buildOverview({
      log: [], reports: [], census: null, params: {}, instrument: null,
      species: { path: '/d/species.tsv', taxa: [
        { rank: 'genus', taxid: 9605, name: 'Homo', observed: 9, adjusted: 9, q: 1, call: 'not_detected', callReason: 'not_significant' }
      ] }
    })
    expect(tile(o, 'genus').value).toBe('none detected')
    expect(tile(o, 'genus').note).toContain('does not establish absence')
  })

  it('label from the CLI label_call (1.12); "not called" for 1.11, never a GUI rule', () => {
    expect(tile(overviewOf(CLI_CASES.v112Tmt), 'label')).toMatchObject({ value: 'TMT', tone: 'call' })
    expect(tile(overviewOf(CLI_CASES.v112), 'label').value).toBe('none (label-free)')
    const old = tile(overviewOf(CLI_CASES.v111Tmt), 'label')
    expect(old.value).toBe('not called')
    expect(old.note).toMatch(/no label call/) // round 14: no version named on screen
  })

  it('no alkylation report: "not assessed" with "Add Alkylation report and run again"', () => {
    const o = overviewOf(CLI_CASES.v112)
    const t = tile(o, 'alkylation')
    expect(t.value).toBe('not assessed')
    expect(t.tone).toBe('off')
    // feedback 202dbcf4: the report needs no database, so the action adds it
    // without raising Characterize's extension 2, and the tile says so.
    expect(t.action).toEqual({ kind: 'enable', label: 'Add Alkylation report and run again', values: { alkylation_out: 'alkylation.tsv' } })
    expect(t.note).toMatch(/needs no database/)
    expect(t.note).not.toMatch(/raises the extension/)
    expect(line(o, 'fixed C')).toMatchObject({ evidence: 'default' })
    expect(line(o, 'fixed C').note).toBe('default, alkylation not assessed (alkylation report not written)')
  })

  it('also for FASTag 1.11', () => {
    const o = overviewOf(CLI_CASES.v111)
    expect(tile(o, 'alkylation').value).toBe('not assessed')
    expect(line(o, 'fixed C').evidence).toBe('default')
  })

  it('with a FASTA: the Cys gap counts, still no call, and C+57.021 stays a default', () => {
    const o = overviewOf(CLI_CASES.v112Fasta)
    const t = tile(o, 'alkylation')
    expect(t.value).toBe('no call (counts only)')
    expect(t.note).toMatch(/Carbamidomethyl \(C\) 11 of 475 placed spectra/)
    expect(t.action).toBeUndefined()
    expect(line(o, 'fixed C').evidence).toBe('default')
    expect(line(o, 'fixed C').note).toMatch(/no alkylation call/)
  })

  it('with a FASTA but tags too short for the recon index: not assessed, not an absence', () => {
    // The exact command "Add FASTA and run again" sent before the fix:
    // extension 2 with -recon_fasta; the CLI exits 0 and places nothing.
    const o = overviewOf(CLI_CASES.v112ReconExt2)
    const t = tile(o, 'alkylation')
    expect(t.value).toBe('not assessed (no tag placed in the FASTA)')
    expect(t.tone).toBe('off')
    expect(t.note).toBe('tags reach at most 7 residues (tag length 3 + 2 × extension 2); the recon index needs 8 (its log line)')
    expect(t.action).toEqual({ kind: 'enable', label: 'Run again with extension 3', values: { extension: '3' } })
    expect(line(o, 'fixed C').note).toBe('default, alkylation not assessed (no tag placed in the FASTA)')
  })

  it('what "Add FASTA and run again" sends now (extension 3, -recon_fasta) places tags: the Cys counts', () => {
    const t = tile(overviewOf(CLI_CASES.v112ReconExt3), 'alkylation')
    expect(t.value).toBe('no call (counts only)')
    expect(t.note).toMatch(/Carbamidomethyl \(C\) 11 of 475 placed spectra/)
  })

  // A census line added to real output (GUI runs do not send -census yet):
  // the cutoff counts tagged spectra, never the MS2 spectra processed.
  const withCensus = (c: CliCase, read: number, tagged: number): CliCase => ({
    ...c,
    log: `${c.log}\nCensus: ${read} MS2 spectra read, ${tagged} with a reported tag (0 placed), ${read - tagged} no_tags`
  })

  it('with fewer than 1,000 tagged spectra the CLI calls read "too little evidence", the CLI result in the note', () => {
    expect(MIN_TAGGED).toBe(1000)
    const o = overviewOf(withCensus(CLI_CASES.v112, 2738, 400)) // 2,738 MS2 spectra, 400 tagged
    expect(o.lowEvidence).toBe(true)
    expect(o.cutoffApplied).toBe(true)
    for (const id of ['protease', 'genus', 'label']) {
      expect(tile(o, id).value, id).toBe('too little evidence')
      expect(tile(o, id).note, id).toMatch(/^400 tagged spectra, fewer than 1,000; CLI: /)
    }
    expect(tile(o, 'protease').note).toMatch(/CLI: Trypsin \(digest call over 4,257/)
    expect(tile(o, 'genus').note).toMatch(/CLI: Homo/)
    expect(line(o, 'enzyme').evidence).toBe('default')
    expect(o.suggestions.find((x) => x.setting === 'database')).toBeUndefined()
  })

  it('a CLI no call is never overridden: the Da run keeps its low_resolution reason', () => {
    const o = overviewOf(withCensus(CLI_CASES.v112Da, 686, 600))
    expect(o.lowEvidence).toBe(true)
    for (const id of ['protease', 'label']) {
      expect(tile(o, id).value, id).toBe('no call')
      expect(tile(o, id).note, id).toMatch(/no call at a fragment tolerance in Da \(see above\); also 600 tagged spectra, fewer than 1,000\.?$/)
    }
    // Round 6, 26: the shared cause is said once, above the tiles.
    expect(o.warning).toMatch(/^The fragment tolerance is 0\.5 Da: FASTag makes no protease or label call at a tolerance in Da, and species calls are unreliable/)
    // The genus is a ranking the CLI made: held back.
    expect(tile(o, 'genus').value).toBe('too little evidence')
    expect(tile(o, 'genus').note).toMatch(/CLI: Gallus/)
  })

  it('without a census the cutoff is not applied, and the Overview says so', () => {
    for (const c of [CLI_CASES.v112Da, CLI_CASES.v112]) {
      const o = overviewOf(c)
      expect(o.lowEvidence, c.name).toBe(false)
      expect(o.cutoffApplied, c.name).toBe(false)
      expect(o.checks, c.name).toContainEqual({ tone: 'muted', gates: true, text: expect.stringMatching(/^Evidence cutoff not applied: this run did not count tagged spectra/) })
      // Said once, by the check line: not repeated in every call tile.
      for (const id of ['protease', 'genus', 'label']) expect(tile(o, id).note, `${c.name} ${id}`).not.toMatch(/[Ee]vidence cutoff/)
    }
    // 686 MS2 spectra: the Da run's calls are what the CLI wrote.
    const da = overviewOf(CLI_CASES.v112Da)
    expect(tile(da, 'protease')).toMatchObject({ value: 'no call', tone: 'nocall' })
    expect(tile(da, 'protease').note).toBe('no call at a fragment tolerance in Da (see above)')
    expect(da.warning).toMatch(/no protease or label call at a tolerance in Da/)
    expect(tile(da, 'genus').value).toBe('Gallus')
    // With a census of at least 1,000 tagged spectra it is applied, and passes.
    const called = overviewOf(CLI_CASES.v112Call)
    expect(called.cutoffApplied).toBe(true)
    expect(called.lowEvidence).toBe(false)
    expect(called.checks.map((c) => c.text).join(' ')).not.toMatch(/Evidence cutoff not applied/)
  })
})

describe('Overview model: instrument', () => {
  it('the instrument as the digest meta rows name it, never read as an analyzer', () => {
    const da = tile(overviewOf(CLI_CASES.v112Da), 'instrument')
    expect(da).toMatchObject({ value: 'LTQ Orbitrap XL', tone: 'figure' })
    expect(da.note).toMatch(/from the report meta rows/)
    // No GUI rule turns the model name into "ion trap": no re-run offer.
    expect(da.action).toBeUndefined()
    expect(tile(overviewOf(CLI_CASES.v112), 'instrument').value).toBe('Q Exactive')
    const none = buildOverview({ log: [], reports: [], species: null, census: null, params: {}, instrument: null })
    expect(tile(none, 'instrument')).toMatchObject({ value: 'not named', tone: 'off' })
  })
})

describe('Overview model: checks and caveats', () => {
  it('the acquisition check line when the CLI wrote one; "not checked" otherwise', () => {
    // Short, with the CLI's reasoning on request.
    expect(overviewOf(CLI_CASES.v112).checks).toContainEqual({ tone: 'ok', text: 'Acquisition: DDA', detail: expect.any(String) })
    expect(overviewOf(CLI_CASES.v111).checks).toContainEqual({ tone: 'muted', text: expect.stringMatching(/not checked/) })
  })

  it('a Da tolerance and electron activation are flagged; the species caveat names ion-trap/Da', () => {
    const o = overviewOf(CLI_CASES.v112Da)
    // The Da cause once, as the warning above the tiles; the checks keep
    // the electron activation.
    expect(o.warning).toMatch(/fragment tolerance is 0\.5 Da.*species calls are unreliable on ion-trap\/Da data/i)
    expect(o.checks.filter((c) => c.tone === 'flag').map((c) => c.text)).toEqual([expect.stringMatching(/328 of 686 MS2 spectra were electron-activated/)])
    expect(o.caveats.join(' ')).toMatch(/species calls are unreliable on ion-trap\/Da data/)
  })

  // Round 6, 24: the Da caveat only where the check line would say it.
  it('the ion-trap/Da caveat only for a Da or unknown tolerance', () => {
    const ppm = buildOverview({ log: [], reports: [], species: null, census: null, params: { species: true, fragment_tolerance: '20', fragment_tolerance_unit: 'ppm' }, instrument: null })
    expect(ppm.caveats.join(' ')).not.toMatch(/ion-trap\/Da/)
    expect(ppm.copyText).not.toMatch(/ion-trap\/Da/)
    expect(ppm.warning).toBeUndefined()
    const da = buildOverview({ log: [], reports: [], species: null, census: null, params: { species: true, fragment_tolerance: '0.3', fragment_tolerance_unit: 'Da' }, instrument: null })
    expect(da.caveats.join(' ')).toMatch(/ion-trap\/Da/)
  })
})

describe('Overview model: suggested settings', () => {
  it('each line names its evidence: a call, a default or a preset', () => {
    const o = overviewOf(CLI_CASES.v112Tmt, { instrument: 'Orbitrap HCD 20 ppm' })
    expect(line(o, 'enzyme')).toMatchObject({ value: 'Trypsin', evidence: 'call' })
    expect(line(o, 'missed cleavages')).toMatchObject({ value: '2', evidence: 'default', note: 'default, not measured' })
    expect(line(o, 'label')).toMatchObject({ value: 'TMT6plex (K, N-term)', evidence: 'call' })
    expect(line(o, 'fragment tol.')).toMatchObject({ value: '20 ppm', evidence: 'preset', note: 'from instrument preset Orbitrap HCD 20 ppm' })
  })

  it('1.13: a label-free call from fewer than 175 tag ends is the default, not a call', () => {
    const weakLabel = CLI_CASES.v112.label.replace(
      /^label_call\tstatus\tcall\t\d+\t([^\n]*)$/m,
      'label_call\tstatus\tcall\t12\tA label call is made from 12 C-terminal tag ends and 38300 filtered tags. These are fewer than 175, so a label-free call means only that no label rule fired.'
    )
    expect(weakLabel).not.toBe(CLI_CASES.v112.label)
    const o = overviewOf({ ...CLI_CASES.v112, label: weakLabel })
    expect(line(o, 'label')).toMatchObject({ value: 'none', evidence: 'default' })
    expect(line(o, 'label').note).toMatch(/label-free from 12 C-terminal tag ends only/)
    expect(tile(o, 'label').note).toMatch(/fewer than 175, so a label-free call means only that no label rule fired/)
  })

  it('without a call the enzyme is the default and says why', () => {
    const o = overviewOf(CLI_CASES.v112Da)
    expect(line(o, 'enzyme')).toMatchObject({ value: 'Trypsin/P', evidence: 'default' })
    expect(line(o, 'enzyme').note).toMatch(/no digest call/)
    expect(line(o, 'fragment tol.')).toMatchObject({ value: '0.5 Da', evidence: 'run' })
  })

  it('a report the run did not write offers to turn it on', () => {
    const c = CLI_CASES.v112
    const o = buildOverview({
      log: logLines(c),
      reports: [],
      species: null,
      census: null,
      params: { glyco: false },
      instrument: null
    })
    expect(tile(o, 'protease').action).toEqual({ kind: 'enable', label: 'Add Digest report and run again', values: { digest_out: 'digest.tsv' } })
    expect(tile(o, 'label').action).toEqual({ kind: 'enable', label: 'Add Label report and run again', values: { label_out: 'label.tsv' } })
    expect(tile(o, 'genus').action).toEqual({ kind: 'enable', label: 'Add Species report and run again', values: { species: true, extension: '2' } })
    // The log of this case has a glyco line, but the run was told glyco off: the log wins.
    expect(tile(o, 'glyco').action).toBeUndefined()
  })

  it('glyco off and no glyco line: turn it on', () => {
    const o = buildOverview({ log: ['10 MS2 spectra, 5 tags'], reports: [], species: null, census: null, params: {}, instrument: null })
    expect(tile(o, 'glyco')).toMatchObject({ value: 'off', action: { kind: 'enable', values: { glyco: true } } })
  })

  it('copies as plain text, one line per setting with its evidence', () => {
    const o = overviewOf(CLI_CASES.v112)
    expect(o.copyText.split('\n')).toContain('Fixed cysteine modification: Carbamidomethyl (C, +57.021) (default, alkylation not assessed (alkylation report not written))')
  })
})

// FASTag 1.15.0 on PXD001 (TMT_Erwinia_..._01-20141210.mzML): a q-value of
// 3.16e-119 printed as a 120-digit decimal that ran over the cards, and the
// label card read "tag ends*: The run is labelled TMT.; evidence cutoff".
describe('Overview card text: tiny numbers and punctuation', () => {
  it('a tiny q-value reads as the Species tab writes it', async () => {
    const { fmt, fmtQ } = await import('../digestReport')
    expect(fmtQ(3.16e-119)).toBe('3.2e-119')
    expect(fmtQ(0.0123)).toBe('0.012')
    expect(fmtQ(0)).toBe('<1e-300')
    expect(fmtQ(null)).toBe('uncalibrated')
    // fmt never spells a tiny value as a long fixed-point decimal either.
    expect(fmt(3.16e-119)).toBe('3.16e-119')
    expect(fmt(0.000123)).toBe('0.000123')
    expect(fmt(3.16e-119).length).toBeLessThan(12)
  })

  it('the Top genus card of a ranking with q = 3.16e-119', () => {
    const c = CLI_CASES.v112
    const species = speciesFromTsv(c.species, `/d/${c.name}.species.tsv`)!
    const top = species.taxa.find((t) => t.rank === 'genus')!
    top.q = 3.16e-119
    const reports = [parseReport(c.digest, '/d/a.digest.tsv'), parseReport(c.label, '/d/a.label.tsv')]
    const o = buildOverview({ log: logLines(c), reports, species, census: null, params: c.params, instrument: null })
    const note = tile(o, 'genus').note
    // Not deconvolved (adjusted = observed): by observed spectra, as the Species tab says (round 9, 11).
    expect(note).toMatch(/^q = 3\.2e-119; ranked first of 50 taxa at genus rank by observed spectra, not a presence call\.$/)
    expect(note).not.toMatch(/0\.0{6,}/)
  })

  it('a note that ends a sentence takes the next one as a sentence', () => {
    expect(addNote('The run is labelled TMT.', 'evidence cutoff (1,000 tagged spectra) not applied: tagged spectra not counted')).toBe(
      'The run is labelled TMT. Evidence cutoff (1,000 tagged spectra) not applied: tagged spectra not counted.'
    )
    expect(addNote('digest call over 793 C-terminal tag ends', 'more')).toBe('digest call over 793 C-terminal tag ends; more')
  })

  it('no tile note has a stray "*" or ".;", and the genus q-value is short', () => {
    for (const c of Object.values(CLI_CASES)) {
      const o = overviewOf(c)
      for (const t of o.calls) {
        expect(t.note, `${c.name} ${t.id}`).not.toMatch(/\*|\.;/)
        expect(t.note, `${c.name} ${t.id}`).not.toMatch(/0\.0{6,}/)
      }
    }
  })
})

describe('Overview model: the alkylation report', () => {
  const report = (status: string, reason: string, extra = ''): string =>
    [
      'section\tkey\tvalue\tn\tdescription',
      'alk_run\tformat\t1\t-\t-',
      'alk_run\tdatabase_source\tbundled:human\t-\t-',
      `alkylation_call\tstatus\t${status}\t42\t-`,
      `alkylation_call\treason\t${reason}\t-\t-`,
      extra
    ].join('\n')
  const of = (text: string, params: Record<string, unknown> = { extension: '2' }) =>
    buildOverview({ log: [], reports: [parseReport(text, '/d/a.alkylation.tsv')], species: null, census: null, params, instrument: null })

  it('shows the no call with its reason in words; too short tags offer extension 3', () => {
    const t = tile(of(report('no_call', 'tags_too_short')), 'alkylation')
    expect(t).toMatchObject({ value: 'no call', tone: 'nocall' })
    expect(t.note).toMatch(/no tag reaches the 8 residues the proteome needs/)
    expect(t.action).toEqual({ kind: 'enable', label: 'Run again with extension 3', values: { extension: '3' } })
  })

  // feedback 202dbcf4: format 2, the call from the tags without a database
  const tagReport = (status: string, reason: string, extra = ''): string =>
    [
      'section\tkey\tvalue\tn\tdescription',
      'alk_run\tformat\t2\t-\t-',
      'alk_run\tmethod\ttags\t-\t-',
      'alk_run\tdatabase\t-\t-\t-',
      'alk_run\tdatabase_source\tnone\t-\t-',
      'alkt_run\tformat\t2\t-\t-',
      `alkylation_call\tstatus\t${status}\t8\t-`,
      `alkylation_call\treason\t${reason}\t-\t-`,
      'alkylation_call\tsource\ttags\t-\t-',
      extra
    ].join('\n')
  it('a tag-only report (format 2): the call names the votes and no database, and few votes ask for longer tags', () => {
    const r = parseReport(tagReport('no_call', 'few_cys_spectra'), '/d/a.alkylation.tsv')
    expect(r.kind).toBe('alkylation')
    const t = tile(of(tagReport('no_call', 'few_cys_spectra')), 'alkylation')
    expect(t).toMatchObject({ value: 'no call', tone: 'nocall' })
    expect(t.note).toMatch(/8 spectra vote from their tags/)
    expect(t.note).not.toMatch(/proteome/)
    expect(t.action).toBeUndefined()
    const c = tile(of(tagReport('call', '-', 'alkylation_call\treagent\tMethylthio\t6\t-\nalkylation_call\tmass\t45.987721\t-\t-\nalkylation_call\tshare\t0.75\t8\t-')), 'alkylation')
    expect(c).toMatchObject({ value: 'Methylthio', tone: 'call' })
    expect(c.note).toMatch(/75% of 8 spectra whose tags read a cysteine, no database; experimental/)
    const u = tile(of(tagReport('no_call', 'unresolved_forms')), 'alkylation')
    expect(u.note).toMatch(/cannot tell two cysteine forms apart/)
  })

  // Codex7 review n1: a tag-only CAM call is no call alias_needs_database;
  // the tile names the candidate and asks for a protein database.
  it('a tag candidate with an exact alias: "Candidate: Carbamidomethyl", needs a protein database', () => {
    const text = tagReport(
      'no_call',
      'alias_needs_database',
      'alkylation_call\tcandidate\tCarbamidomethyl\t36\t-\nalkylation_call\tshare\t0.9\t40\t-\nalkylation_call\tvoted\t40\t40\t-'
    )
    const r = parseReport(text, '/d/a.alkylation.tsv')
    expect(r.kind).toBe('alkylation')
    const t = tile(of(text), 'alkylation')
    expect(t).toMatchObject({ value: 'Candidate: Carbamidomethyl', tone: 'nocall' })
    expect(t.note).toMatch(/^needs a protein database to confirm \(90% of 40 tag votes\); run again with a FASTA \(Protein database\) or a shipped proteome/)
    expect(alkylationReason('alias_needs_database')).toMatch(/needs a protein database/)
  })

  // Release-gate review n4: 18 CAM + 2 other + 4 conflicts is a share of
  // 0.75 of 24 (the share row's n, format 3), not "75% of 20".
  it('a format 3 call pairs the share with its reported denominator, conflicts included', () => {
    const text = tagReport(
      'call',
      '-',
      'alkylation_call\treagent\tCarbamidomethyl\t18\t-\nalkylation_call\tmass\t57.021464\t-\t-\nalkylation_call\tshare\t0.75\t24\t-\nalkylation_call\tvoted\t24\t20\t-'
    ).replace('alkylation_call\tstatus\tcall\t8\t-', 'alkylation_call\tstatus\tcall\t20\t-')
    const c = tile(of(text), 'alkylation')
    expect(c).toMatchObject({ value: 'Carbamidomethyl', tone: 'call' })
    expect(c.note).toMatch(/^75% of 24 tag votes \(20 for a form, 4 conflicted\), no database; experimental$/)
    expect(c.note).not.toMatch(/of 20/)
  })

  // Codex6 review n1: from format 4 the share's denominator holds the tag
  // votes that abstained (alkt_form alias_unconfirmed); PXD000001 at
  // Extension 2: Methylthio 52 of 69, 57 for a form, 1 conflicted, 11 abstained.
  it('a format 4 call names the abstained votes in its denominator, not as conflicts', () => {
    const text = tagReport(
      'call',
      '-',
      'alkt_form\talias_unconfirmed\t11\t69\t-\nalkylation_call\treagent\tMethylthio\t52\t-\nalkylation_call\tmass\t45.987721\t-\t-\nalkylation_call\tshare\t0.7536231884057971\t69\t-\nalkylation_call\tvoted\t69\t57\t-'
    )
      .replace('alk_run\tformat\t2\t-\t-', 'alk_run\tformat\t4\t-\t-')
      .replace('alkylation_call\tstatus\tcall\t8\t-', 'alkylation_call\tstatus\tcall\t57\t-')
    expect(alkylationCall(parseReport(text, '/d/a.alkylation.tsv')).abstained).toBe(11)
    const c = tile(of(text), 'alkylation')
    expect(c).toMatchObject({ value: 'Methylthio', tone: 'call' })
    expect(c.note).toMatch(/^75\.36% of 69 tag votes \(57 for a form, 1 conflicted, 11 abstained\), no database; experimental$/)
    // Format 3 has no abstentions: the same rows read as 12 conflicts.
    const f3 = text.replace('alk_run\tformat\t4\t-\t-', 'alk_run\tformat\t3\t-\t-')
    expect(alkylationCall(parseReport(f3, '/d/a.alkylation.tsv')).abstained).toBe(0)
    expect(tile(of(f3), 'alkylation').note).toMatch(/\(57 for a form, 12 conflicted\)/)
  })

  // Review n4: neither component calls on a shipped proteome with too short
  // tags (PXD000001, gui/src/fixtures/alkylation-tags.tsv): the report's
  // call is the tag call's few_cys_spectra, the tags_too_short is the
  // placement call's; the tile keeps both and the extension that places.
  it('a tag no call over a placement call whose tags are too short keeps the diagnosis and the extension', () => {
    const t = tile(of(ALKYLATION_TAGS, { tag_length: '3', extension: '0' }), 'alkylation')
    expect(t).toMatchObject({ value: 'no call', tone: 'nocall' })
    expect(t.note).toMatch(/^8 spectra vote from their tags, fewer than the call needs; the placements: no tag reaches the 8 residues the proteome needs$/)
    expect(t.action).toEqual({ kind: 'enable', label: 'Run again with extension 3', values: { extension: '3' } })
    // The search line's reason is the tag call's, in tag words.
    expect(line(of(ALKYLATION_TAGS, { tag_length: '3', extension: '0' }), 'fixed C').note).toBe('default; no alkylation call (too few tag votes for a cysteine form)')
  })

  it('shows the call with its reagent, and suggests it for the search', () => {
    const o = of(report('call', '-', 'alkylation_call\treagent\tPropionamide\t-\t-\nalkylation_call\tmass\t71.0371\t-\t-\nalkylation_call\tshare\t0.9\t42\t-'))
    expect(tile(o, 'alkylation')).toMatchObject({ value: 'Propionamide', tone: 'call' })
    expect(line(o, 'fixed C')).toMatchObject({ value: 'Propionamide (C, +71.037)', evidence: 'call' })
  })
})
