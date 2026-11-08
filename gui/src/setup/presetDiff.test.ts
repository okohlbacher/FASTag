// Presets as diffs and the v1 preset migration (GUI-DESIGN 9 layer 1, P2a
// PR u): a preset stores what differs from its base and no paths; a v1
// preset, the full record of the form's values, applies to exactly the
// values it held.

import { describe, expect, it } from 'vitest'
import { applyPreset, diffNames, droppedPaths, normalizePreset, presetDiff, sameSetting } from './presetDiff'
import { baseValues, baseOf, startValues, originText, taskOf, TASKS, LANDING } from './tasks'
import { initialValues } from './useSession'
import { RENDERED } from '../paramLayout'
import type { ParamValue } from '../ParamField'
import v1File from '../../src-tauri/tests/fixtures/settings-v1.json'

const defaults = initialValues()

describe('presets as diffs', () => {
  it('an empty field, 20 against 20.0 and a moved report are the same setting', () => {
    expect(sameSetting('tag_length', '', '3')).toBe(true)
    expect(sameSetting('fragment_tolerance', '20', '20.0')).toBe(true)
    expect(sameSetting('fragment_tolerance', '20', '0.3')).toBe(false)
    expect(sameSetting('digest_out', '/a/x.digest.tsv', '/b/y.digest.tsv')).toBe(true)
    expect(sameSetting('digest_out', '', '/b/y.digest.tsv')).toBe(false)
    expect(sameSetting('fixed_modifications', ['Carbamidomethyl (C)', ''], ['Carbamidomethyl (C)'])).toBe(true)
    expect(sameSetting('fixed_modifications', [], ['Carbamidomethyl (C)'])).toBe(false)
    expect(sameSetting('species', false, true)).toBe(false)
  })

  it('the form at its base differs in nothing; each change counts once', () => {
    const base = baseValues('builtin:characterize')
    expect(diffNames(base, startValues('builtin:characterize', '/d/run01.tags.tsv'))).toEqual([])
    const v: Record<string, ParamValue> = { ...base, tag_length: '4', species: false }
    expect(diffNames(base, v).sort()).toEqual(['species', 'tag_length'])
  })

  it('a preset stores only the diff over its base, no input paths, outputs by name', () => {
    const base = baseValues('builtin:characterize')
    const v: Record<string, ParamValue> = {
      ...startValues('builtin:characterize', '/data/run01.tags.tsv'),
      fragment_tolerance: '0.3',
      fragment_tolerance_unit: 'Da',
      fasta: '/data/db/human.fasta',
      recon_out: '/data/run01.recon.tsv',
      glyco: false
    }
    const d = presetDiff(base, v)
    expect(d).toEqual({ fragment_tolerance: '0.3', fragment_tolerance_unit: 'Da', recon_out: 'recon.tsv', glyco: false })
    expect(droppedPaths(base, v)).toEqual(['fasta'])
    // No folder and no sample name anywhere in what is stored.
    expect(JSON.stringify(d)).not.toMatch(/data|run01/)
    // A report the base has and the form turned off is stored as off.
    expect(presetDiff(base, { ...base, digest_out: '' })).toEqual({ digest_out: '' })
  })

  it('applying a preset gives its base plus its diff, with reports beside the tags output', () => {
    const v = applyPreset({ v: 2, base: 'builtin:characterize', diff: { tag_length: '4', recon_out: 'recon.tsv' } }, '/d/B.tags.tsv')
    expect(v['tag_length']).toBe('4')
    expect(v['species']).toBe(true) // from the base
    expect(v['digest_out']).toBe('/d/B.digest.tsv')
    expect(v['recon_out']).toBe('/d/B.recon.tsv')
    // Saved and applied again, the form comes back (paths aside).
    const base = baseValues('builtin:characterize')
    const again = applyPreset({ v: 2, base: 'builtin:characterize', diff: presetDiff(base, v) }, '/d/B.tags.tsv')
    expect(diffNames(v, again)).toEqual([])
    expect(again['recon_out']).toBe('/d/B.recon.tsv')
  })

  it('every built-in task is a diff over the defaults that names only real parameters', () => {
    for (const t of TASKS) for (const n of Object.keys(t.values)) expect(RENDERED).toContain(n)
    expect(TASKS.map((t) => t.label)).toEqual(['Characterize a run', 'Batch QC vs SDRF', 'Export tags', 'Open results / inspect spectra'])
    const c = baseValues('builtin:characterize')
    expect([c['species'], c['extension'], c['glyco'], c['subsample_fraction']]).toEqual([true, '2', true, '0.1'])
    expect(Boolean(c['digest_out']) && Boolean(c['label_out'])).toBe(true)
    expect(baseValues('builtin:export-tags')['res_conf']).toBe(true)
    expect(baseValues('defaults')).toEqual(defaults)
    expect(originText(LANDING)).toBe('Characterize a run')
    expect(baseOf({ kind: 'preset', name: 'x', base: 'builtin:export-tags' })).toBe('builtin:export-tags')
    expect(taskOf({ kind: 'preset', name: 'x', base: 'builtin:export-tags' })?.id).toBe('export-tags')
  })
})

describe('the v1 preset migration', () => {
  // The same v1 file the cargo migration test reads (settings.rs).
  const presets = (v1File as { presets: Record<string, Record<string, ParamValue>> }).presets

  it('a v1 preset applies to exactly the values it held, every key kept', () => {
    expect(Object.keys(presets)).toEqual(['HCD paper', 'Ion trap Café'])
    for (const [name, record] of Object.entries(presets)) {
      const p = normalizePreset(record)!
      expect(p.base, name).toBe('defaults')
      expect(p.diff, name).toEqual(record)
      const applied = applyPreset(p, '')
      for (const [k, v] of Object.entries(record)) expect(applied[k], `${name} ${k}`).toEqual(v)
      // The FASTA path of a v1 preset survives the migration.
      if (name === 'Ion trap Café') expect(applied['fasta']).toBe('/data/db/Café.fasta')
    }
  })

  it('reads the v2 shape cargo writes, and nothing that is no preset', () => {
    const migrated = { v: 2, base: 'defaults', diff: presets['HCD paper'] }
    expect(normalizePreset(migrated)).toEqual(migrated)
    expect(normalizePreset({ v: 2, base: 'builtin:characterize', diff: { tag_length: '4', __proto__x: 1 } })?.base).toBe('builtin:characterize')
    expect(normalizePreset({ v: 2, base: 'nonsense', diff: {} })?.base).toBe('defaults')
    expect(normalizePreset(null)).toBeNull()
    expect(normalizePreset('x')).toBeNull()
    expect(normalizePreset(['a'])).toBeNull()
    const poisoned = JSON.parse('{"__proto__": {"x": 1}, "tag_length": "5"}')
    expect(normalizePreset(poisoned)?.diff).toEqual({ tag_length: '5' })
  })
})
