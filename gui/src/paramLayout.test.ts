import { describe, expect, it } from 'vitest'
import {
  PARAM_BY_NAME,
  PARAM_UI,
  hiddenReason,
  RENDERED,
  SECTIONS,
  conflicts,
  humanName,
  inertBecause,
  invalidBecause,
  isActive,
  masters,
  speciesReach,
  unknownParams,
  unplacedParams
} from './paramLayout'

// The pre-P5 tables, as views of PARAM_UI.
const DEPENDS = Object.fromEntries(Object.entries(PARAM_UI).flatMap(([n, u]) => (u.depends ? [[n, u.depends]] : [])))
const LABEL = Object.fromEntries(Object.entries(PARAM_UI).flatMap(([n, u]) => (u.label ? [[n, u.label]] : [])))

describe('layout completeness', () => {
  // unplacedParams() can only see what the manifest has; this is the other
  // direction.
  it('names no parameter the tool does not have', () => {
    expect(unknownParams()).toEqual([])
  })

  it('places every parameter the tool does have', () => {
    expect(unplacedParams()).toEqual([])
  })

  it('renders each parameter exactly once', () => {
    expect(RENDERED.length).toBe(new Set(RENDERED).size)
  })

  it("carries the tool default for threads, not TOPPBase's", () => {
    // FASTag's main() applies -threads 0 (half the cores); --help still prints
    // TOPPBase's 1, so the form must not trust the manifest here.
    expect(PARAM_BY_NAME.get('threads')?.default).toBe('0')
    expect(PARAM_BY_NAME.get('threads')?.description).toMatch(/half the logical cores/)
  })

  it('lists every section master among its own params', () => {
    for (const s of SECTIONS) if (s.master) expect(s.params).toContain(s.master)
  })
})

describe('dependencies', () => {
  const off: Record<string, unknown> = {}

  it('marks a dependent inert while its master is unset', () => {
    expect(inertBecause('species_rank', off)).toBe('species detection is off')
    expect(inertBecause('species_rank', { species: true })).toBeNull()
  })

  it('treats 0 as off for numeric masters', () => {
    expect(inertBecause('gap_penalty', { gaps: '0' })).not.toBeNull()
    expect(inertBecause('gap_penalty', { gaps: '1' })).toBeNull()
  })

  it('treats an empty path as off for file masters', () => {
    expect(inertBecause('orientation', { fasta: '  ' })).not.toBeNull()
    expect(inertBecause('orientation', { fasta: '/db.fasta' })).toBeNull()
  })

  it('requires BOTH masters where two are declared', () => {
    expect(inertBecause('species_use_gapped', { species: true, gaps: '0' })).toBe('no gapped tags are produced')
    expect(inertBecause('species_use_gapped', { species: false, gaps: '1' })).toBe('species detection is off')
    expect(inertBecause('species_use_gapped', { species: true, gaps: '1' })).toBeNull()
  })

  it('arms the subsample seed from EITHER subsample knob', () => {
    expect(inertBecause('subsample_seed', off)).not.toBeNull()
    expect(inertBecause('subsample_seed', { subsample_spectra: '500' })).toBeNull()
    expect(inertBecause('subsample_seed', { subsample_fraction: '0.1' })).toBeNull()
  })

  it('arms the digest window from EITHER report', () => {
    expect(inertBecause('digest_window', off)).not.toBeNull()
    expect(inertBecause('digest_window', { digest_out: '/r/d.tsv' })).toBeNull()
    expect(inertBecause('digest_window', { label_out: '/r/l.tsv' })).toBeNull()
  })

  it('needs both recon_out and massgap_out for the mass-gap knobs', () => {
    expect(inertBecause('massgap_top', { massgap_out: '/r/m.tsv' })).toMatch(/reconciliation/)
    expect(inertBecause('massgap_top', { recon_out: '/r/r.tsv' })).toMatch(/mass-gap/)
    expect(inertBecause('massgap_top', { recon_out: '/r/r.tsv', massgap_out: '/r/m.tsv' })).toBeNull()
  })

  it('never depends on a parameter that is not itself rendered', () => {
    // A master hidden from the form would leave its dependents permanently
    // greyed out with no way to switch them on.
    for (const [name, deps] of Object.entries(DEPENDS))
      if (RENDERED.includes(name)) for (const d of deps) for (const m of masters(d)) expect(RENDERED).toContain(m)
  })

  it('depends only on parameters the tool has', () => {
    for (const [name, deps] of Object.entries(DEPENDS))
      if (PARAM_BY_NAME.has(name)) for (const d of deps) for (const m of masters(d)) expect(PARAM_BY_NAME.has(m)).toBe(true)
  })

  it('reads a checkbox, a number and a path the same way', () => {
    expect(isActive('x', { x: true })).toBe(true)
    expect(isActive('x', { x: false })).toBe(false)
    expect(isActive('x', { x: '0' })).toBe(false)
    expect(isActive('x', { x: '2' })).toBe(true)
    expect(isActive('x', { x: '' })).toBe(false)
    expect(isActive('x', { x: '/some/path' })).toBe(true)
    expect(isActive('x', {})).toBe(false)
  })
})

describe('field validation', () => {
  // The CLI declares fragment_tolerance >= 1e-9 (restrictions="1.0e-09:" in
  // the CTD); 0 and negatives read as "greater than 0", not "at least 1e-9".
  it('requires fragment_tolerance greater than 0', () => {
    const spec = PARAM_BY_NAME.get('fragment_tolerance')!
    expect(spec.min).toBe(1e-9)
    expect(invalidBecause(spec, '0')).toBe('must be greater than 0')
    expect(invalidBecause(spec, '-1')).toBe('must be greater than 0')
    expect(invalidBecause(spec, '1e-12')).toBe('must be at least 1e-9')
    expect(invalidBecause(spec, '0.02')).toBeNull()
  })
})

describe('field validation: an exclusive maximum', () => {
  // The CLI declares digest_background_share 0..1 but refuses 1 (rc 6).
  it('refuses digest_background_share 1, as the CLI does', () => {
    const spec = PARAM_BY_NAME.get('digest_background_share')!
    expect(invalidBecause(spec, '1')).toBe('must be below 1')
    expect(invalidBecause(spec, '0.99')).toBeNull()
    expect(invalidBecause(spec, '1.5')).toBe('must be at most 1')
  })
})

describe('preflight conflicts', () => {
  it('reads a cleared tag_length as its default 3, as the CLI does', () => {
    const v = { species: true, tag_length: '', extension: '2' }
    expect(speciesReach(v, 7)).toBeNull()
    expect(conflicts(v, { taxdbK: 7 })).toEqual([])
    expect(speciesReach({ species: true, tag_length: '3', extension: '1' }, 7)).toMatchObject({ reach: 5, k: 7, option: 'tag_length' })
  })

  it('refuses part of the taxdb/taxonomy_nodes/taxonomy_names set', () => {
    const c = conflicts({ species: true, taxdb: '/d/x.taxdb' })
    expect(c.map((x) => x.params)).toEqual([['taxonomy_nodes', 'taxonomy_names']])
    expect(conflicts({ species: true, taxdb: '/a', taxonomy_nodes: '/b', taxonomy_names: '/c' })).toEqual([])
    expect(conflicts({ species: false, taxdb: '/d/x.taxdb' })).toEqual([])
  })
})

describe('labels', () => {
  it('labels only rendered parameters, each with its own words', () => {
    for (const name of Object.keys(LABEL)) {
      expect(PARAM_BY_NAME.has(name), name).toBe(true)
      expect(hiddenReason(name), name).toBeUndefined()
      expect(RENDERED, name).toContain(name)
    }
    expect(new Set(Object.values(LABEL)).size).toBe(Object.keys(LABEL).length)
    expect(humanName('tag_length')).toBe('Tag length')
  })
})
