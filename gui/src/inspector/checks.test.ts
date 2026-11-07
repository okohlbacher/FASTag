// The inspector's checks: before a run from the probe fixtures and the form,
// after a run from the real FASTag 1.12 reports and log lines of the public
// gate inputs (src/fixtures/cli-1.12/), and the exit-11 refusal.
import { describe, expect, it } from 'vitest'
import { parseReport } from '../digestReport'
import { parseProbe } from './probe'
import { NOT_CHECKED_NO_PROBE, NOTE_LINE, postRunChecks, preStartChecks, pseudoPath, refusalOf } from './checks'
import iontrapProbe from '../fixtures/probe/iontrap.probe.jsonl?raw'
import orbitrapProbe from '../fixtures/probe/orbitrap.probe.jsonl?raw'
import diaRawProbe from '../fixtures/probe/dia_raw.probe.jsonl?raw'
import diaPseudoProbe from '../fixtures/probe/dia_pseudo.probe.jsonl?raw'
import noMs2Probe from '../fixtures/probe/no_ms2.probe.jsonl?raw'
import profileProbe from '../fixtures/probe/profile.probe.jsonl?raw'
import fastaProbe from '../fixtures/probe/fasta_nodecoys.probe.jsonl?raw'
import newerProbe from '../fixtures/probe/newer_format.probe.jsonl?raw'
import truncatedProbe from '../fixtures/probe/truncated.probe.jsonl?raw'
import it20Digest from '../fixtures/cli-1.12/iontrap_20ppm.digest.tsv?raw'
import it20Label from '../fixtures/cli-1.12/iontrap_20ppm.label.tsv?raw'
import it20Err from '../fixtures/cli-1.12/iontrap_20ppm.stderr?raw'
import it03Digest from '../fixtures/cli-1.12/iontrap_03da.digest.tsv?raw'
import it03Err from '../fixtures/cli-1.12/iontrap_03da.stderr?raw'
import orbiDigest from '../fixtures/cli-1.12/orbitrap_hcd.digest.tsv?raw'
import orbiErr from '../fixtures/cli-1.12/orbitrap_hcd.stderr?raw'
import diaErr from '../fixtures/cli-1.12/dia_raw.stderr?raw'
import diaOut from '../fixtures/cli-1.12/dia_raw.stdout?raw'
import diaRc from '../fixtures/cli-1.12/dia_raw.rc?raw'

const ppm = { fragment_tolerance: '20', fragment_tolerance_unit: 'ppm' }
const da = { fragment_tolerance: '0.3', fragment_tolerance_unit: 'Da' }
const pre = (probe: string, values: Record<string, string | boolean> = ppm) =>
  preStartChecks({ input: '/data/run01.mzML', values, supported: true, probe: parseProbe(probe) })
const ids = (cs: { id: string; level: string }[]): string[] => cs.map((c) => `${c.level}:${c.id}`)
// The lines useRun keeps from a run's log.
const notes = (...logs: string[]): string[] => logs.flatMap((l) => l.split('\n')).filter((l) => NOTE_LINE.test(l))

describe('preStartChecks (from the probe)', () => {
  it('ion-trap MS2 at 20 ppm: a red flag whose fix is the 0.3 Da preset, and ion trap is detected', () => {
    const r = pre(iontrapProbe)
    expect(r.notChecked).toBeNull()
    expect(r.detected).toMatchObject({ family: 'ion-trap', preset: 'iontrap-cid', text: 'LTQ Orbitrap XL', source: 'the probe' })
    const flag = r.checks.find((c) => c.id === 'iontrap-ppm')!
    expect(flag.level).toBe('flag')
    expect(flag.fix).toEqual({ label: 'Use Ion trap CID 0.3 Da', instrument: 'iontrap-cid' })
    expect(flag.detail).toContain('ion trap')
    // The stale index is a red flag too; the ETD half of the run a warning.
    expect(ids(r.checks)).toEqual(['flag:iontrap-ppm', 'flag:stale-index', 'warn:electron'])
  })

  it('the same file at 0.3 Da: no tolerance flag', () => {
    expect(ids(pre(iontrapProbe, da).checks)).toEqual(['flag:stale-index', 'warn:electron'])
  })

  it('an Orbitrap HCD run with an index passes every check and proposes Orbitrap HCD', () => {
    const r = pre(orbitrapProbe)
    expect(r.checks).toEqual([])
    expect(r.detected?.preset).toBe('orbitrap-hcd')
  })

  it('raw DIA is a block with the DIAspeXtract command; pseudo-DDA passes', () => {
    const r = pre(diaRawProbe)
    const block = r.checks.find((c) => c.id === 'raw-dia')!
    expect(block.level).toBe('block')
    expect(block.title).toMatch(/Raw DIA/)
    expect(block.detail).toContain('DIAspeXtract')
    expect(block.command).toEqual([
      'DIAspeXtract',
      '-in',
      '/data/PXD006096/100815_MM_ABPP_H1993_DMSO_DIA1_new.mzML',
      '-out',
      '/data/PXD006096/100815_MM_ABPP_H1993_DMSO_DIA1_new.pseudo.mzML'
    ])
    expect(pre(diaPseudoProbe).checks).toEqual([])
  })

  it('no MS2 is a block; profile MS2 a red flag; a FASTA without decoys a warning', () => {
    expect(ids(pre(noMs2Probe).checks)).toEqual(['block:no-ms2'])
    expect(ids(pre(profileProbe).checks)).toEqual(['flag:profile'])
    expect(ids(pre(fastaProbe).checks)).toEqual(['warn:fasta-decoys'])
  })

  it('species with a Da tolerance is a red flag from the settings, probe or not', () => {
    const values = { ...da, species: true }
    expect(ids(pre(orbitrapProbe, values).checks)).toEqual(['flag:da-species'])
    const none = preStartChecks({ input: '/d/a.mzML', values, supported: false, probe: null })
    expect(ids(none.checks)).toEqual(['flag:da-species'])
  })

  it('without -probe_input nothing is checked from the file and nothing is guessed', () => {
    const r = preStartChecks({ input: '/d/a.mzML', values: ppm, supported: false, probe: null })
    expect(r).toEqual({ checks: [], detected: null, notChecked: NOT_CHECKED_NO_PROBE, pending: false })
  })

  it('a probe in flight is pending; a newer, cut or failed probe is "not checked"', () => {
    expect(preStartChecks({ input: '/d/a.mzML', values: ppm, supported: true, probe: null }).pending).toBe(true)
    expect(pre(newerProbe).notChecked).toMatch(/format 2, newer/)
    expect(pre(truncatedProbe).notChecked).toMatch(/incomplete/)
    expect(pre(truncatedProbe).checks).toEqual([])
    const failed = preStartChecks({ input: '/d/a.mzML', values: ppm, supported: true, probe: null, probeError: 'exit code 5' })
    expect(failed.notChecked).toMatch(/probe failed \(exit code 5\)/)
  })

  it('pseudoPath follows FASTag: the extension is cut only inside the file name', () => {
    expect(pseudoPath('/d/run.mzML')).toBe('/d/run.pseudo.mzML')
    expect(pseudoPath('/d.v2/run')).toBe('/d.v2/run.pseudo.mzML')
    expect(pseudoPath('C:\\d\\run.mzML')).toBe('C:\\d\\run.pseudo.mzML')
  })
})

describe('postRunChecks (from the reports and the log of a real 1.12 run)', () => {
  const rep = (t: string, p: string) => parseReport(t, p)

  it('the ion-trap fixture at 20 ppm: the 0.3 Da red flag and the re-run offer', () => {
    const r = postRunChecks({ reports: [rep(it20Digest, '/d/a.digest.tsv'), rep(it20Label, '/d/a.label.tsv')], notes: notes(it20Err) })
    const flag = r.checks.find((c) => c.id === 'iontrap-ppm')!
    expect(flag.level).toBe('flag')
    expect(flag.fix).toEqual({ label: 'Re-run with 0.3 Da', instrument: 'iontrap-cid', rerun: true })
    expect(flag.detail).toContain('LTQ Orbitrap XL')
    expect(flag.detail).toContain('0.600 Th')
    expect(flag.source).toBe("the digest report and FASTag's log")
    expect(r.detected).toMatchObject({ text: 'LTQ Orbitrap XL', family: 'hybrid-ion-trap', preset: 'iontrap-cid', source: 'the digest report' })
    expect(ids(r.checks)).toEqual(['flag:iontrap-ppm', 'warn:electron'])
  })

  it('from the meta rows alone: an ion trap at ppm is flagged, a hybrid is not', () => {
    const ionTrapOnly = it20Digest.replace('meta\tinstrument\tLTQ Orbitrap XL', 'meta\tinstrument\tLTQ XL')
    expect(ids(postRunChecks({ reports: [rep(ionTrapOnly, '/d/a.digest.tsv')], notes: [] }).checks)).toEqual(['flag:iontrap-ppm'])
    expect(postRunChecks({ reports: [rep(it20Digest, '/d/a.digest.tsv')], notes: [] }).checks).toEqual([])
  })

  it('the same file at 0.3 Da, and an Orbitrap HCD run: no flag', () => {
    expect(ids(postRunChecks({ reports: [rep(it03Digest, '/d/a.digest.tsv')], notes: notes(it03Err) }).checks)).toEqual(['warn:electron'])
    const orbi = postRunChecks({ reports: [rep(orbiDigest, '/d/b.digest.tsv')], notes: notes(orbiErr) })
    expect(orbi.checks).toEqual([])
    expect(orbi.detected).toMatchObject({ family: 'orbitrap', preset: 'orbitrap-hcd' })
  })

  it('no reports: nothing detected', () => {
    expect(postRunChecks({ reports: [], notes: [] })).toEqual({ checks: [], detected: null })
  })
})

describe('refusalOf (FASTag 1.12 exit 11)', () => {
  it('reads the real raw-DIA refusal with the DIAspeXtract command FASTag proposes', () => {
    expect(Number(diaRc.trim())).toBe(11)
    const r = refusalOf(notes(diaErr, diaOut), 11)!
    const input = '/scratch/kohlbach/gate-in-1.12/PXD006096/100815_MM_ABPP_H1993_DMSO_DIA1_new.mzML'
    expect(r).toMatchObject({ kind: 'raw_dia', input, windows: 126, medianWidth: 8 })
    expect(r.command).toEqual(['DIAspeXtract', '-in', input, '-out', input.replace(/\.mzML$/, '.pseudo.mzML')])
    expect(r.message).toMatch(/is raw DIA: .*DIAspeXtract/)
  })

  it('the sentinel alone decides; without it, exit 11 and the message do', () => {
    expect(refusalOf(['FASTAG_REFUSED reason=raw_dia windows=10 median_width=25'], 1)).toMatchObject({ windows: 10, command: null })
    const msg = notes(diaErr).filter((l) => !l.startsWith('FASTAG_REFUSED'))
    expect(refusalOf(msg, 11)?.command?.[0]).toBe('DIAspeXtract')
    expect(refusalOf(msg, 1)).toBeNull()
    expect(refusalOf(['FASTAG_REFUSED reason=other'], 11)).toBeNull()
    expect(refusalOf(notes(it20Err), 0)).toBeNull()
  })
})
