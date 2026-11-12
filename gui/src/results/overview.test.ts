// The Overview's model (GUI-DESIGN 3 S3) over real CLI output on the gate
// PXDs: every tile names its cutoff or caveat, every suggested setting its
// evidence, and nothing is a call the CLI did not make (Q2).

import { describe, expect, it } from 'vitest'
import { parseReport } from '../digestReport'
import { CLI_CASES, logLines, type CliCase } from '../testing/cliFixtures'
import { speciesFromTsv } from '../testing/speciesTsv'
import { buildOverview, MIN_TAGGED, type Overview, type Tile } from './overview'

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
    expect(tile(called, 'tagged').note).toMatch(/census/)
    const plain = overviewOf(CLI_CASES.v112)
    expect(tile(plain, 'tagged').value).toBe('not counted')
    expect(tile(plain, 'tagged').note).toMatch(/census/)
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
    expect(tile(o, 'genus').note).toMatch(/q = 0.*ranked first of 50 genera.*not a presence call/)
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
    expect(old.note).toMatch(/FASTag 1\.12/)
  })

  it('no FASTA, no alkylation call: "not assessed (needs a FASTA)" with "Add FASTA and run again"', () => {
    const o = overviewOf(CLI_CASES.v112)
    const t = tile(o, 'alkylation')
    expect(t.value).toBe('not assessed (needs a FASTA)')
    expect(t.tone).toBe('off')
    // Characterize's extension 2 cannot place tags in a proteome: the action
    // raises it to 3, and the tile says so.
    expect(t.action).toEqual({ kind: 'add-fasta', label: 'Add FASTA and run again', values: { extension: '3' } })
    expect(t.note).toMatch(/sets the extension from 2 to 3/)
    expect(line(o, 'fixed C+57.021')).toMatchObject({ evidence: 'default' })
    expect(line(o, 'fixed C+57.021').note).toBe('default, alkylation not assessed (no FASTA)')
    expect(line(o, 'variable M+15.995').note).toBe('default; mass gaps not assessed (no FASTA)')
  })

  it('also for FASTag 1.11', () => {
    const o = overviewOf(CLI_CASES.v111)
    expect(tile(o, 'alkylation').value).toBe('not assessed (needs a FASTA)')
    expect(line(o, 'fixed C+57.021').evidence).toBe('default')
  })

  it('with a FASTA: the Cys gap counts, still no call, and C+57.021 stays a default', () => {
    const o = overviewOf(CLI_CASES.v112Fasta)
    const t = tile(o, 'alkylation')
    expect(t.value).toBe('no call (counts only)')
    expect(t.note).toMatch(/Carbamidomethyl \(C\) 11 of 475 placed spectra/)
    expect(t.action).toBeUndefined()
    expect(line(o, 'fixed C+57.021').evidence).toBe('default')
    expect(line(o, 'fixed C+57.021').note).toMatch(/no alkylation call/)
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
    expect(line(o, 'fixed C+57.021').note).toBe('default, alkylation not assessed (no tag placed in the FASTA)')
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
      expect(tile(o, id).note, id).toMatch(/the fragment tolerance is in Da.*; also 600 tagged spectra, fewer than 1,000$/)
    }
    // The genus is a ranking the CLI made: held back.
    expect(tile(o, 'genus').value).toBe('too little evidence')
    expect(tile(o, 'genus').note).toMatch(/CLI: Gallus/)
  })

  it('without a census the cutoff is not applied, and the Overview says so', () => {
    for (const c of [CLI_CASES.v112Da, CLI_CASES.v112]) {
      const o = overviewOf(c)
      expect(o.lowEvidence, c.name).toBe(false)
      expect(o.cutoffApplied, c.name).toBe(false)
      expect(o.checks, c.name).toContainEqual({ tone: 'muted', text: expect.stringMatching(/^Evidence cutoff not applied: this run did not count tagged spectra/) })
      for (const id of ['protease', 'genus', 'label']) expect(tile(o, id).note, `${c.name} ${id}`).toMatch(/evidence cutoff \(1,000 tagged spectra\) not applied/)
    }
    // 686 MS2 spectra: the Da run's calls are what the CLI wrote.
    const da = overviewOf(CLI_CASES.v112Da)
    expect(tile(da, 'protease')).toMatchObject({ value: 'no call', tone: 'nocall' })
    expect(tile(da, 'protease').note).toMatch(/^No protease is called: the fragment tolerance is in Da/)
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
    expect(overviewOf(CLI_CASES.v112).checks).toContainEqual({ tone: 'ok', text: expect.stringMatching(/^Acquisition check: DDA/) })
    expect(overviewOf(CLI_CASES.v111).checks).toContainEqual({ tone: 'muted', text: expect.stringMatching(/not checked/) })
  })

  it('a Da tolerance and electron activation are flagged; the species caveat names ion-trap/Da', () => {
    const o = overviewOf(CLI_CASES.v112Da)
    expect(o.checks.filter((c) => c.tone === 'flag').map((c) => c.text)).toEqual([
      expect.stringMatching(/fragment tolerance is 0\.5 Da.*species calls are unreliable on ion-trap\/Da data/i),
      expect.stringMatching(/328 of 686 MS2 spectra were electron-activated/)
    ])
    expect(overviewOf(CLI_CASES.v112).caveats.join(' ')).toMatch(/species calls are unreliable on ion-trap\/Da data/)
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
    expect(tile(o, 'protease').action).toEqual({ kind: 'enable', label: 'Turn on and run again', values: { digest_out: 'digest.tsv' } })
    expect(tile(o, 'label').action).toEqual({ kind: 'enable', label: 'Turn on and run again', values: { label_out: 'label.tsv' } })
    expect(tile(o, 'genus').action).toEqual({ kind: 'enable', label: 'Turn on and run again', values: { species: true, extension: '2' } })
    // The log of this case has a glyco line, but the run was told glyco off: the log wins.
    expect(tile(o, 'glyco').action).toBeUndefined()
  })

  it('glyco off and no glyco line: turn it on', () => {
    const o = buildOverview({ log: ['10 MS2 spectra, 5 tags'], reports: [], species: null, census: null, params: {}, instrument: null })
    expect(tile(o, 'glyco')).toMatchObject({ value: 'off', action: { kind: 'enable', values: { glyco: true } } })
  })

  it('copies as plain text, one line per setting with its evidence', () => {
    const o = overviewOf(CLI_CASES.v112)
    expect(o.copyText.split('\n')).toContain('fixed C+57.021: Carbamidomethyl (C) (default, alkylation not assessed (no FASTA))')
  })
})
