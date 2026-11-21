// The state a report freezes: typed, allow-listed values only.
import { describe, expect, it } from 'vitest'
import localSchema from './schema/report.schema.json'
import { validate } from './schemaCheck'
import { allowParams, allowValue, appInfo, extOf, runInfo, viewInfo, type AppState } from './snapshot'
import { buildDraft } from './draft'
import type { Frozen } from './capture'
import type { Session } from './useFeedback'
import { emptyText } from './useFeedback'

const state = (over: Partial<AppState> = {}): AppState => ({
  view: 'results',
  tab: 'species',
  workflow: 'characterize',
  mode: 'single',
  dialog: null,
  helpOpen: false,
  values: {},
  input: '/Users/alice/patient-0042/run01.mzML',
  out: '/Users/alice/patient-0042/run01.tags.tsv',
  running: false,
  phase: null,
  shownOut: '/Users/alice/patient-0042/run01.tags.tsv',
  themeSetting: 'system',
  ...over
})

describe('feedback state snapshot', () => {
  it('keeps typed values of the manifest and drops free text', () => {
    expect(allowValue('tag_length', 4)).toBe(4)
    expect(allowValue('tag_length', '5')).toBe(5)
    expect(allowValue('tag_length', 'five')).toBeUndefined()
    expect(allowValue('species', true)).toBe(true)
    expect(allowValue('species', 'yes')).toBeUndefined()
    expect(allowValue('fragment_tolerance_unit', 'ppm')).toBe('ppm')
    // A string option without choices is free text: dropped.
    expect(allowValue('search_decoy_prefix', 'patient_smith_')).toBeUndefined()
    expect(allowValue('alkylation_proteome', '/Users/alice/x.fasta')).toBeUndefined()
    // Not a parameter of the CLI.
    expect(allowValue('my_secret', 1)).toBeUndefined()
  })

  it('turns paths into their role and extension', () => {
    const p = allowParams({ recon_fasta: '/Users/alice/human.fasta', digest_out: 'C:\\x\\digest.tsv', taxdb: '', tag_length: 3 }, state().input, state().out)
    expect(p).toEqual({
      recon_fasta: { role: 'input', ext: 'fasta' },
      digest_out: { role: 'output', ext: 'tsv' },
      taxdb: null,
      tag_length: 3,
      in: { role: 'input', ext: 'mzML' },
      out: { role: 'output', ext: 'tsv' }
    })
    expect(JSON.stringify(p)).not.toMatch(/alice|patient|human|digest\./)
    expect(extOf('/a/b.d.zip')).toBe('zip')
    expect(extOf('/a/noext')).toBe('')
  })

  it('records the view as machine ids', () => {
    expect(viewInfo(state())).toEqual({ view: 'results', workflow: 'characterize', tab: 'species', dialog: null, mode: 'single', help_open: false })
    expect(viewInfo(state({ view: 'setup', tab: 'species', dialog: 'Über uns' }))).toMatchObject({ tab: null, dialog: null })
  })

  it('a run in flight is the run on screen', () => {
    expect(runInfo(state({ running: true, phase: 'Tagging spectra' }), null)).toMatchObject({ status: 'running', phase: 'Tagging spectra', input: { ext: 'mzML' } })
    const rec = { id: 'r1', status: 'succeeded' as const, exit_code: 0, phase: null, message: null, duration_ms: 5, argv: ['FASTag'], workflow: null, input: null }
    expect(runInfo(state(), rec)).toBe(rec)
  })

  it('the build identity: a full commit, else "unknown" and no dirty flag', () => {
    expect(appInfo({ version: '1.15.6', commit: 'abc', dirty: true, build_date: null, channel: 'dev' })).toMatchObject({ commit: 'unknown', dirty: null })
    const b = appInfo()
    expect(b.version).toBe(__APP_VERSION__)
    expect(b.commit).toMatch(/^([0-9a-f]{7,40}|unknown)$/)
  })

  it('a draft of a text-only session validates against the local schema', () => {
    const frozen: Frozen = { attemptId: 'cap-1', status: 'failed', method: 'none', api: null, error: 'no screenshot: timeout', image: null, width: 0, height: 0, scale: 0, capturedUtc: '2026-11-21T10:00:00Z' }
    const s: Session = { frozen, state: state({ values: { tag_length: 3, search_decoy_prefix: 'x y' } }), log: [{ level: 'warn', text: 'w', t: 1 }], platform: null, run: null, bin: null }
    const d = buildDraft(s, { ...emptyText(), title: 'It broke', description: 'see 1' }, { image: null, removed: false, shapes: [] })
    const full = { ...d, schema: 'fastag-feedback/1', id: '0f8e2a4c-1b3d-4e5f-9a7b-6c5d4e3f2a1b', created_utc: '2026-11-21T10:00:00Z', tz_offset_min: 0, status: 'saved', issue_url: null }
    expect(validate(localSchema, full)).toEqual([])
    expect(d.capture).toMatchObject({ status: 'failed', error: 'no screenshot: timeout' })
    expect(d.share).toEqual({ screenshot: false, diagnostics: true, log: false })
    expect(d.params).toEqual({ tag_length: 3, in: { role: 'input', ext: 'mzML' }, out: { role: 'output', ext: 'tsv' } })
    const removed = buildDraft(s, { ...emptyText(), title: 't' }, { image: null, removed: true, removedReason: 'removed by the user', shapes: [] })
    expect(removed.capture.status).toBe('removed')
  })
})
