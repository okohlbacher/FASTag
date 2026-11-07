// Drop routing in the renderer (GUI-DESIGN 2 "window-wide drop zone"): the
// backend sorts the dropped paths (drop.rs); planDrop says what the app does
// with them and which view it lands on.
import { describe, expect, it } from 'vitest'
import { planDrop, type DropRoute } from './dropRoute'

const route = (r: Partial<DropRoute>): DropRoute => ({
  spectra: [],
  batch: false,
  fasta: null,
  taxdb: null,
  results: null,
  reports: [],
  sdrf: null,
  ignored: [],
  ...r
})

describe('planDrop', () => {
  it('one spectra file is the input, in Setup', () => {
    const p = planDrop(route({ spectra: ['/d/a.mzML'] }), { busy: false })
    expect(p.input).toBe('/d/a.mzML')
    expect(p.batch).toBeUndefined()
    expect(p.view).toBe('setup')
  })

  it('two or more, or a folder, go to the batch', () => {
    const p = planDrop(route({ spectra: ['/d/a.mzML', '/d/b.mzML'], batch: true }), { busy: false })
    expect(p.input).toBeUndefined()
    expect(p.batch).toEqual(['/d/a.mzML', '/d/b.mzML'])
    expect(p.view).toBe('batch')
  })

  it('with a queue, even one file joins the batch', () => {
    const p = planDrop(route({ spectra: ['/d/c.mzML'] }), { busy: false, queued: true })
    expect(p.batch).toEqual(['/d/c.mzML'])
    expect(p.input).toBeUndefined()
    expect(p.view).toBe('batch')
  })

  it('a FASTA and a taxonomy set their fields', () => {
    const p = planDrop(route({ fasta: '/d/h.fasta', taxdb: '/d/t.taxdb' }), { busy: false })
    expect(p.values).toEqual({ fasta: '/d/h.fasta', taxdb: '/d/t.taxdb' })
    expect(p.view).toBe('setup')
  })

  it('a tags table and the reports with a tab open in Results', () => {
    const p = planDrop(
      route({
        results: '/d/r.tags.tsv',
        reports: [
          { kind: 'digest', path: '/d/r.digest.tsv' },
          { kind: 'label', path: '/d/r.label.tsv' },
          { kind: 'species', path: '/d/r.species.tsv' },
          { kind: 'glyco', path: '/d/r.glyco.tsv' },
          { kind: 'recon', path: '/d/r.recon.tsv' },
          { kind: 'delta', path: '/d/r.delta.tsv' },
          { kind: 'recon_id', path: '/d/r.recon_id.tsv' }
        ]
      }),
      { busy: false }
    )
    expect(p.results).toBe('/d/r.tags.tsv')
    // P4c: glyco, recon and delta have their tabs (Glyco, Mass gaps & recon).
    expect(p.reports).toEqual(['/d/r.digest.tsv', '/d/r.label.tsv', '/d/r.glyco.tsv', '/d/r.recon.tsv', '/d/r.delta.tsv'])
    expect(p.species).toBe('/d/r.species.tsv')
    expect(p.view).toBe('results')
    // A report no tab shows (the CLI writes -recon_id_out as idXML, mzid or
    // mzTab, never .tsv): said, not dropped silently.
    expect(p.notes.join(' ')).toMatch(/r\.recon_id\.tsv/)
    expect(p.notes.join(' ')).not.toMatch(/glyco|r\.recon\.tsv|delta/)
  })

  // P4c review: a dropped mzTab -recon_id_out opens as Open report… opens it
  // (the opener sniffs it into Mass gaps & recon; idXML and mzid are named there).
  it('an mzTab -recon_id_out goes to the reports, like the picker', () => {
    const p = planDrop(route({ reports: [{ kind: 'recon_ids', path: '/d/run.recon.mzTab' }] }), { busy: false })
    expect(p.reports).toEqual(['/d/run.recon.mzTab'])
    expect(p.view).toBe('results')
    expect(p.notes).toEqual([])
  })

  it('an SDRF lands on Batch with a note; unknown files are named', () => {
    const p = planDrop(route({ sdrf: '/d/p.sdrf.tsv', ignored: ['/d/readme.txt'] }), { busy: false })
    expect(p.view).toBe('batch')
    expect(p.notes.join(' ')).toMatch(/p\.sdrf\.tsv/)
    expect(p.notes.join(' ')).toMatch(/readme\.txt/)
  })

  it('while FASTag runs nothing is taken', () => {
    const p = planDrop(route({ spectra: ['/d/a.mzML'], results: '/d/r.tags.tsv', fasta: '/d/h.fasta' }), { busy: true })
    expect(p.input).toBeUndefined()
    expect(p.results).toBeUndefined()
    expect(p.values).toBeUndefined()
    expect(p.view).toBeUndefined()
    expect(p.notes).toHaveLength(1)
    expect(p.notes[0]).toMatch(/while FASTag runs/)
  })

  it('an empty drop does nothing', () => {
    const p = planDrop(route({}), { busy: false })
    expect(p).toEqual({ reports: [], notes: [] })
  })
})
