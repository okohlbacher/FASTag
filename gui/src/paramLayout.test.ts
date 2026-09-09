import { describe, expect, it } from 'vitest'
import {
  DEPENDS,
  PARAM_BY_NAME,
  RENDERED,
  SECTIONS,
  inertBecause,
  isActive,
  unknownParams,
  unplacedParams
} from './paramLayout'

describe('layout completeness', () => {
  // The stale manifest that shipped without the four -species_* options was
  // invisible to unplacedParams(), which can only see what the manifest has.
  it('names no parameter the tool does not have', () => {
    expect(unknownParams()).toEqual([])
  })

  it('places every parameter the tool does have', () => {
    expect(unplacedParams()).toEqual([])
  })

  it('renders each parameter exactly once', () => {
    expect(RENDERED.length).toBe(new Set(RENDERED).size)
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

  it('never depends on a parameter that is not itself rendered', () => {
    // A master hidden from the form would leave its dependents permanently
    // greyed out with no way to switch them on.
    for (const deps of Object.values(DEPENDS))
      for (const d of deps) expect(RENDERED).toContain(d.on)
  })

  it('depends only on parameters the tool has', () => {
    for (const deps of Object.values(DEPENDS))
      for (const d of deps) expect(PARAM_BY_NAME.has(d.on)).toBe(true)
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
