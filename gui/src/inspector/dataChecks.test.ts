// The check before a run that needs FASTag's shipped data (report
// 20261124T094950Z_54456a88: a Mass-shift survey with an engine from a build
// tree stopped with exit 6 after 123 ms). One case per rule of FASTag.cpp:
// what needs which file, what gives its own, and an unknown status.
import { describe, expect, it } from 'vitest'
import { missingDataChecks, preStartChecks, shippedDataNeeds } from './checks'
import type { DataStatus } from '../types'

const BARE: DataStatus = {
  digestDir: null,
  files: { digestModels: false, digestModelsV2: false, massgapMods: false, calibration: false },
  alkylationDir: null,
  proteomes: [],
  searched: ['/b/share/FASTag/digest', '/b/bin/share-FASTag-digest', '/b/bin/digest'],
  fromEnv: false,
  autoDbFree: true
}
const FULL: DataStatus = {
  digestDir: '/app/share/FASTag/digest',
  files: { digestModels: true, digestModelsV2: true, massgapMods: true, calibration: true },
  alkylationDir: '/app/share/FASTag/alkylation',
  proteomes: ['human', 'mouse', 'yeast', 'ecoli'],
  searched: ['/app/share/FASTag/digest'],
  fromEnv: false,
  autoDbFree: true
}
const files = (v: Record<string, string | boolean>): string[] => shippedDataNeeds(v).map((n) => `${n.option}:${n.file}`)

describe('shipped data before a run', () => {
  it('names the file each output needs, as FASTag.cpp reads it', () => {
    expect(files({ recon_out: 'r.tsv', recon_fasta: '/d/db.fasta', massgap_out: 'g.tsv' })).toEqual(['massgap_out:massgap_mods.tsv'])
    expect(files({ digest_out: 'd.tsv' })).toEqual(['digest_out:digest_models.tsv'])
    expect(files({ digest_out: 'd.tsv', digest_models_version: 'v2' })).toEqual(['digest_out:digest_models_v2.tsv', 'digest_out:digest_calibration.tsv'])
    expect(files({ digest_out: 'd.tsv', digest_min_confidence: '0.5' })).toEqual(['digest_out:digest_models.tsv', 'digest_out:digest_calibration.tsv'])
    expect(files({ fasta: '/d/db.fasta', shortlist_out: 's.tsv' })).toEqual(['shortlist_out:digest_models.tsv'])
    expect(files({ fasta: '/d/db.fasta', search_config_out: 's.json' })).toEqual(['search_config_out:digest_models.tsv'])
    // The default auto reads no proteome: the call is read off the tags (feedback 202dbcf4).
    expect(files({ alkylation_out: 'a.tsv' })).toEqual([])
    expect(files({ alkylation_out: 'a.tsv', alkylation_proteome: 'auto' })).toEqual([])
    expect(files({ alkylation_out: 'a.tsv', alkylation_proteome: 'human' })).toEqual(['alkylation_out:human.fasta.gz'])
    expect(files({ alkylation_out: 'a.tsv', alkylation_proteome: 'yeast' })).toEqual(['alkylation_out:yeast.fasta.gz'])
    // QC, tags alone: nothing.
    expect(files({ qc_out: 'q.tsv' })).toEqual([])
  })

  it('an option that gives its own file needs none', () => {
    expect(files({ digest_out: 'd.tsv', digest_models: '/m.tsv' })).toEqual([])
    expect(files({ digest_out: 'd.tsv', digest_models_version: 'v2', digest_models: '/m.tsv', digest_calibration: '/c.tsv' })).toEqual([])
    // The hand-off uses the digest report's models when it is on.
    expect(files({ fasta: '/d/db.fasta', shortlist_out: 's.tsv', digest_out: 'd.tsv', digest_models: '/m.tsv' })).toEqual([])
    // The alkylation report on a database: -recon_fasta, a FASTA path, or the placements' database.
    expect(files({ alkylation_out: 'a.tsv', recon_fasta: '/d/db.fasta' })).toEqual([])
    expect(files({ alkylation_out: 'a.tsv', alkylation_proteome: '/d/my.fasta' })).toEqual([])
    expect(files({ alkylation_out: 'a.tsv', recon_out: 'r.tsv', fasta: '/d/db.fasta' })).toEqual([])
    expect(files({ alkylation_out: 'a.tsv', fasta: '/d/db.fasta', shortlist_out: 's.tsv' })).toEqual(['shortlist_out:digest_models.tsv'])
  })

  it('blocks the Mass-shift survey with a bare binary, names the folders and the fix, and offers to run without the report', () => {
    const values = { recon_out: 'r.tsv', recon_fasta: '/d/db.fasta', massgap_out: 'g.tsv' }
    const r = preStartChecks({ input: '/d/a.mzML', values, supported: false, probe: null, data: BARE })
    expect(r.checks.map((c) => `${c.level}:${c.id}`)).toEqual(['block:no-shipped-data-massgap_out'])
    const c = r.checks[0]
    expect(c.title).toBe("The mass-gap report needs FASTag's shipped data (massgap_mods.tsv)")
    expect(c.detail).toContain('It is not found next to the FASTag program (looked in /b/share/FASTag/digest, /b/bin/share-FASTag-digest, /b/bin/digest).')
    expect(c.detail).toContain('Use an installed FASTag (cmake --install puts it in <prefix>/share/FASTag/digest)')
    expect(c.detail).toContain('set FASTAG_DIGEST_DIR to a folder that holds it (data/digest in the FASTag sources) and start FASTag again')
    expect(c.detail).toContain('Or run without the mass-gap report.')
    expect(c.fix).toEqual({ label: 'Run without the mass-gap report', params: { massgap_out: '' } })
    expect(c.faq).toBe('faq-shipped-data')
    // The fix clears the need.
    expect(missingDataChecks({ ...values, ...c.fix!.params } as Record<string, string>, BARE)).toEqual([])
  })

  it('Characterize a run: the digest and alkylation reports, each with its own fix', () => {
    // The alkylation report at its default needs no proteome: only the digest data block.
    const plain = { digest_out: 'd.tsv', alkylation_out: 'a.tsv', qc_out: 'q.tsv' }
    expect(missingDataChecks(plain, BARE).map((c) => c.id)).toEqual(['no-shipped-data-digest_out'])
    expect(missingDataChecks({ alkylation_out: 'a.tsv' }, BARE)).toEqual([])
    // A shipped proteome named: it is needed.
    const values = { ...plain, alkylation_proteome: 'human' }
    const cs = missingDataChecks(values, BARE)
    expect(cs.map((c) => c.id)).toEqual(['no-shipped-data-digest_out', 'no-shipped-data-alkylation_out'])
    expect(cs[0].fix?.params).toEqual({ digest_out: '' })
    expect(cs[1].title).toBe('The alkylation report needs the shipped human proteome (human.fasta.gz)')
    expect(cs[1].detail).toContain('There is no alkylation folder beside the FASTag program.')
    expect(cs[1].detail).toContain('FASTAG_ALKYLATION_DIR')
    expect(cs[1].fix?.params).toEqual({ alkylation_out: '' })
    // The digest data found, the proteome not: only the alkylation report.
    const noYeast = { ...FULL, proteomes: ['human'] }
    expect(missingDataChecks({ ...values, alkylation_proteome: 'yeast' }, noYeast).map((c) => c.id)).toEqual(['no-shipped-data-alkylation_out'])
    expect(missingDataChecks({ ...values, alkylation_proteome: 'yeast' }, noYeast)[0].detail).toContain('It is not in /app/share/FASTag/alkylation.')
  })

  // Codex n5: an engine from before 1.16 (no -data_paths: autoDbFree false)
  // reads Alkylation proteome auto as the shipped human proteome, which the
  // check skipped: it stopped with exit 6 without the file, or placed the
  // tags on human proteins although the app showed the call from the tags.
  it('an older engine reads auto as the human proteome', () => {
    const values = { alkylation_out: 'a.tsv', alkylation_proteome: 'auto' }
    const legacy = { ...BARE, autoDbFree: false }
    expect(shippedDataNeeds(values, legacy)).toEqual([{ option: 'alkylation_out', file: 'human.fasta.gz', proteome: 'human' }])
    expect(shippedDataNeeds({ alkylation_out: 'a.tsv' }, legacy).map((n) => n.file)).toEqual(['human.fasta.gz'])
    const cs = missingDataChecks(values, legacy)
    expect(cs.map((c) => c.id)).toEqual(['no-shipped-data-alkylation_out'])
    expect(cs[0].title).toBe('The alkylation report needs the shipped human proteome (human.fasta.gz)')
    expect(cs[0].detail).toContain('older than the app')
    // The current engine: no need, no check.
    expect(shippedDataNeeds(values, BARE)).toEqual([])
    expect(missingDataChecks(values, BARE)).toEqual([])
    // With human there, the run goes but says it uses the human proteome.
    const withHuman = { ...legacy, alkylationDir: '/b/alkylation', proteomes: ['human'] }
    const flag = missingDataChecks(values, withHuman)
    expect(flag.map((c) => [c.id, c.level])).toEqual([['legacy-auto-human', 'flag']])
    expect(flag[0].detail).toContain('shipped human proteome')
    expect(missingDataChecks(values, { ...FULL, autoDbFree: false }).map((c) => c.id)).toEqual(['legacy-auto-human'])
    // A protein database or a named proteome: as before, whatever the engine.
    expect(missingDataChecks({ ...values, recon_fasta: '/d/db.fasta' }, legacy)).toEqual([])
    expect(missingDataChecks({ ...values, alkylation_proteome: 'yeast' }, withHuman).map((c) => c.id)).toEqual(['no-shipped-data-alkylation_out'])
  })

  // Feedback 422372a2: -recon_proteome places the tags on a shipped proteome,
  // which FASTag looks for as the alkylation report's (exit 6 without it).
  it("a shipped proteome for the placements is checked like the alkylation report's", () => {
    const values = { recon_out: 'r.tsv', delta_out: 'd.tsv', recon_proteome: 'mouse' }
    expect(files(values)).toEqual(['recon_proteome:mouse.fasta.gz'])
    // The alkylation report places on it too: one file, named once.
    expect(files({ ...values, alkylation_out: 'a.tsv', alkylation_proteome: 'yeast' })).toEqual(['recon_proteome:mouse.fasta.gz'])
    // The CLI ignores it with -recon_fasta, without -recon_out and with a hand-off.
    expect(files({ ...values, recon_fasta: '/d/db.fasta' })).toEqual([])
    expect(files({ recon_proteome: 'mouse' })).toEqual([])
    expect(files({ ...values, fasta: '/d/db.fasta', shortlist_out: 's.tsv' })).toEqual(['shortlist_out:digest_models.tsv'])
    const cs = missingDataChecks(values, { ...FULL, proteomes: ['human'] })
    expect(cs.map((c) => [c.id, c.level])).toEqual([['no-shipped-data-recon_proteome', 'block']])
    expect(cs[0].title).toBe('The tag placements need the shipped mouse proteome (mouse.fasta.gz)')
    expect(cs[0].detail).toContain('It is not in /app/share/FASTag/alkylation.')
    expect(cs[0].fix?.params).toEqual({ recon_proteome: '' })
    expect(missingDataChecks({ ...values, ...cs[0].fix!.params }, BARE)).toEqual([])
    expect(missingDataChecks(values, FULL)).toEqual([])
    // An older engine: the legacy auto-as-human flag is the alkylation report's only.
    expect(missingDataChecks({ ...values, recon_proteome: 'human' }, { ...FULL, autoDbFree: false })).toEqual([])
  })

  it('Database reduction is blocked without a fix button', () => {
    const cs = missingDataChecks({ fasta: '/d/db.fasta', shortlist_out: 's.tsv', fasta_out: 'r.fasta' }, BARE)
    expect(cs.map((c) => c.id)).toEqual(['no-shipped-data-shortlist_out'])
    expect(cs[0].title).toBe("The database reduction needs FASTag's shipped data (digest_models.tsv)")
    expect(cs[0].fix).toBeUndefined()
  })

  it('a folder without the file, and a FASTAG_DIGEST_DIR that is no folder, are said as such', () => {
    const noGap = { ...FULL, files: { ...FULL.files, massgapMods: false } }
    const values = { recon_out: 'r.tsv', recon_fasta: '/d/db.fasta', massgap_out: 'g.tsv' }
    expect(missingDataChecks(values, noGap)[0].detail).toContain('It is not in /app/share/FASTag/digest.')
    const env = { ...BARE, fromEnv: true, searched: ['/nope'] }
    expect(missingDataChecks(values, env)[0].detail).toContain('FASTAG_DIGEST_DIR names /nope, which is not a folder.')
  })

  it('nothing while the status is unknown or the data is there', () => {
    const values = { recon_out: 'r.tsv', recon_fasta: '/d/db.fasta', massgap_out: 'g.tsv', digest_out: 'd.tsv', alkylation_out: 'a.tsv' }
    expect(missingDataChecks(values, undefined)).toEqual([])
    expect(missingDataChecks(values, null)).toEqual([])
    expect(missingDataChecks(values, FULL)).toEqual([])
    expect(preStartChecks({ input: '/d/a.mzML', values, supported: false, probe: null }).checks).toEqual([])
  })
})
