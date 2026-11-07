// The probe contract (probe.ts) read from its fixtures. The probe fixtures
// (src/fixtures/probe/) carry the metadata of the public gate inputs as
// FASTag 1.12 reports them: the "Acquisition check:" reasons are the lines
// the integration/1.12 build printed on those files, the counts come from
// their mzML headers (see src/fixtures/cli-1.12/README.md).
import { describe, expect, it } from 'vitest'
import { parseProbe, PROBE_FORMAT } from './probe'
import iontrap from '../fixtures/probe/iontrap.probe.jsonl?raw'
import diaRaw from '../fixtures/probe/dia_raw.probe.jsonl?raw'
import fasta from '../fixtures/probe/fasta_nodecoys.probe.jsonl?raw'
import newer from '../fixtures/probe/newer_format.probe.jsonl?raw'
import truncated from '../fixtures/probe/truncated.probe.jsonl?raw'
import ionTrapLog from '../fixtures/cli-1.12/iontrap_20ppm.stderr?raw'
import diaLog from '../fixtures/cli-1.12/dia_raw.stderr?raw'

describe('parseProbe', () => {
  it('reads every record of a complete probe', () => {
    const p = parseProbe(iontrap)
    expect(p.status).toBe('ok')
    expect(p.format).toBe(PROBE_FORMAT)
    expect(p.fileFormat).toBe('mzML')
    expect(p.instrument).toEqual({ name: 'LTQ Orbitrap XL', model: null, ms2Analyzer: 'ion trap', ionMobility: null })
    expect(p.spectra).toEqual({ ms1: 2668, ms2: 7626, probed: 4000, centroid: 4000, profile: 0, typeUnknown: 0 })
    expect(p.activation).toEqual({ of: 4000, collisional: 2000, electron: 2000, hybrid: 0, unknown: 0 })
    expect(p.index).toEqual({ state: 'stale' })
    expect(p.acquisition?.mode).toBe('DDA')
    expect(p.acquisition?.refuse).toBe(false)
  })

  it('the acquisition record carries the reason FASTag 1.12 logs for the same file', () => {
    // The contract: acquisition.why is the reason of the "Acquisition check:" line.
    const line = (log: string): string => log.split('\n').find((l) => l.startsWith('Acquisition check: '))!
    expect(line(ionTrapLog)).toBe(`Acquisition check: DDA (${parseProbe(iontrap).acquisition!.why})`)
    const dia = parseProbe(diaRaw)
    expect(line(diaLog)).toBe(`Acquisition check: DIA (${dia.acquisition!.why})`)
    expect(dia.acquisition).toMatchObject({ refuse: true, windows: 126, medianWidth: 8 })
    // ... and windows/median_width as in the FASTAG_REFUSED sentinel.
    expect(diaLog).toContain('FASTAG_REFUSED reason=raw_dia windows=126 median_width=8')
  })

  it('reads the fasta record', () => {
    expect(parseProbe(fasta).fasta).toEqual({ path: '/data/db/Homo_sapiens.fasta', proteins: 20416, decoys: 0, decoyAffix: null })
  })

  it('a newer format is not used, an output without its end record is incomplete', () => {
    expect(parseProbe(newer).status).toBe('newer')
    expect(parseProbe(truncated).status).toBe('incomplete')
  })

  it('ignores unknown records and fields, non-JSON lines and malformed values', () => {
    const p = parseProbe(
      [
        'FASTag -- probe banner on stdout',
        '{"record":"probe","format":1,"input":"/d/a.mzML","file_format":"MGF","extra":1}',
        '{"record":"future","x":1}',
        '{"record":"spectra","ms1":-1,"ms2":"12","ms2_probed":3}',
        '{"record":"index","state":"maybe"}',
        '[1,2]',
        '{"record":"end"}'
      ].join('\r\n')
    )
    expect(p.status).toBe('ok')
    expect(p.fileFormat).toBe('MGF')
    expect(p.spectra).toMatchObject({ ms1: null, ms2: null, probed: 3 })
    expect(p.index).toBeUndefined()
  })

  it('nothing that looks like a probe is unreadable', () => {
    expect(parseProbe('').status).toBe('unreadable')
    expect(parseProbe('{"record":"end"}').status).toBe('unreadable')
  })
})
