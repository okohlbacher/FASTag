import { describe, expect, it } from 'vitest'
// @ts-ignore -- node built-in; the app's tsconfig has no node types
import { readFileSync } from 'node:fs'
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
  invalidParams,
  isActive,
  masters,
  speciesReach,
  unknownParams,
  unplacedParams,
  choiceText,
  dependsOf,
  hintText,
  sentValues,
  UNIT_PARAMS
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
    expect(inertBecause('massgap_top', { massgap_out: '/r/m.tsv' })).toMatch(/placements/)
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
  it('blocks numeric overflow before a run reaches the CLI', () => {
    const spec = PARAM_BY_NAME.get('fragment_tolerance')!
    expect(invalidBecause(spec, '1e999')).toBe('must be a finite number')
    expect(invalidBecause(spec, '-1e999')).toBe('must be a finite number')
    expect(invalidParams({ fragment_tolerance: '1e999' })).toMatchObject({ fragment_tolerance: 'must be a finite number' })
    expect(invalidBecause(spec, '2e1')).toBeNull()
  })

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

  // Round 4, 4: the combinations FASTag refuses with ILLEGAL_PARAMETERS.
  it('refuses the TMT reporter filter without the pseudo-tag filter', () => {
    const c = conflicts({ tmt_reporter_filter: true })
    expect(c.map((x) => x.params[0])).toEqual(['tmt_pseudo_filter'])
    expect(c[0].note).toMatch(/^tmt_reporter_filter requires tmt_pseudo_filter auto or on/)
    expect(conflicts({ tmt_reporter_filter: true, tmt_pseudo_filter: 'auto' })).toEqual([])
    expect(conflicts({ tmt_reporter_filter: false, tmt_pseudo_filter: 'off' })).toEqual([])
  })

  it('refuses exact identification matching with subsampling', () => {
    const ids = { census: true, census_ids: '/d/a.idXML', census_ids_exact: true }
    const c = conflicts({ ...ids, subsample_fraction: '0.1' })
    expect(c.map((x) => x.params[0])).toEqual(['subsample_fraction'])
    expect(c[0].note).toMatch(/^census_ids_exact needs every spectrum read/)
    expect(conflicts({ ...ids, subsample_spectra: '5000' })).toHaveLength(1)
    expect(conflicts({ ...ids, subsample_fraction: '0.0' })).toEqual([])
    // Without identifications the switch is inert: nothing to refuse.
    expect(conflicts({ census: true, census_ids_exact: true, subsample_fraction: '0.1' })).toEqual([])
  })

  it('never sends a Comet template left set after the engine changed', () => {
    const v = { search_config_out: '/d/a.search.json', recon_fasta: '/d/h.fasta', search_config_template: '/d/comet.params', search_engine: 'sage' }
    expect(inertBecause('search_config_template', v)).toMatch(/written complete/)
    expect('search_config_template' in sentValues(v)).toBe(false)
    expect(conflicts(v)).toEqual([])
    expect(inertBecause('search_config_template', { ...v, search_engine: 'comet' })).toBeNull()
    expect(sentValues({ ...v, search_engine: 'comet' })['search_config_template']).toBe('/d/comet.params')
  })
})

// Round 4, 5: every dependency agrees with the reader column of the CLI's
// IgnoredOption table (src/FASTag.cpp): the option is live with its reader
// on and inert with it off.
describe('dependencies follow the CLI reader table', () => {
  const cpp = readFileSync('../src/FASTag.cpp', 'utf8')
  const block = cpp.slice(cpp.indexOf('const IgnoredOption ignored[] = {'), cpp.indexOf('for (const IgnoredOption& r : ignored)'))
  const rows = [...block.matchAll(/\{"(\w+)",\s*(?:\w+\s*\?\s*)?"([^"]+)"/g)].map((m) => ({ option: m[1], reader: m[2] }))
  const ids = { census: true, census_ids: '/d/a.idXML' }
  // Each reader: values that turn it on, and values that leave it off (the
  // nearest that do not: a search configuration alone for the shortlist).
  const READERS: Record<string, { on: Record<string, unknown>[]; off: Record<string, unknown>[] }> = {
    '-digest_out': { on: [{ digest_out: 'd.tsv' }], off: [{}] },
    '-digest_out or -label_out': { on: [{ digest_out: 'd.tsv' }, { label_out: 'l.tsv' }], off: [{}] },
    '-label_out': { on: [{ label_out: 'l.tsv' }], off: [{ digest_out: 'd.tsv' }] },
    '-glyco': { on: [{ glyco: true }], off: [{}] },
    '-species': { on: [{ species: true }], off: [{}] },
    '-acquisition_check refuse or warn': { on: [{ acquisition_check: 'warn' }, { acquisition_check: 'refuse' }], off: [{ acquisition_check: 'off' }] },
    '-ion_series auto': { on: [{ ion_series: 'auto' }], off: [{ ion_series: 'by' }] },
    '-unknown_charge enumerate or infer, or -check_header_charge': {
      on: [{ unknown_charge: 'infer' }, { unknown_charge: 'enumerate' }, { check_header_charge: 'warn' }],
      off: [{ unknown_charge: 'assume2', check_header_charge: 'off' }]
    },
    '-check_header_charge warn or both': { on: [{ check_header_charge: 'warn' }, { check_header_charge: 'both' }], off: [{ check_header_charge: 'off' }] },
    '-fasta_out': { on: [{ fasta_out: 'r.fasta' }], off: [{ shortlist_out: 's.tsv', search_config_out: 'c.json' }] },
    '-shortlist_out or -fasta_out': { on: [{ shortlist_out: 's.tsv' }, { fasta_out: 'r.fasta' }], off: [{ search_config_out: 'c.json' }] },
    '-shortlist_out, -fasta_out or -search_config_out': { on: [{ search_config_out: 'c.json' }, { shortlist_out: 's.tsv' }], off: [{}] },
    '-shortlist_protease other than trypsin': { on: [{ shortlist_out: 's.tsv', shortlist_protease: 'auto' }], off: [{ shortlist_out: 's.tsv', shortlist_protease: 'trypsin' }] },
    '-search_config_out': { on: [{ search_config_out: 'c.json', search_engine: 'comet' }], off: [{ shortlist_out: 's.tsv' }] },
    '-species_call decoy': { on: [{ species: true, species_call: 'decoy' }], off: [{ species: true, species_call: 'none' }] },
    '-alkylation_out': { on: [{ alkylation_out: 'a.tsv' }], off: [{ alkylation_tags_out: 't.tsv' }] },
    '-alkylation_out or -alkylation_tags_out': { on: [{ alkylation_out: 'a.tsv' }, { alkylation_tags_out: 't.tsv' }], off: [{}] },
    '-census': { on: [{ census: true }], off: [{}] },
    '-census_ids': { on: [ids], off: [{ census: true }] },
    '-census_score': { on: [{ census: true, census_score: true }], off: [{ census: true }] }
  }
  // Read under a further condition of the table's `read` column.
  const ALSO_OFF: Record<string, Record<string, unknown>[]> = {
    census_ids_fdr: [{ ...ids, census_ids_accept: 'all' }]
  }
  // Switches a product checkbox drives, and options the CLI accepts without
  // a reader of their own in the form: their reports are their switch.
  const FORM_ONLY = new Set(['species_out', 'glyco_out', 'census_out', 'census_summary_out', 'census_sorted_out', 'census_score', 'census_ids', 'species_call'])

  it('reads the table', () => {
    expect(rows.length).toBeGreaterThan(60)
    for (const r of rows) expect(READERS[r.reader], `${r.option}: reader ${r.reader}`).toBeDefined()
  })

  for (const r of rows) {
    // A unit goes with its value (sentValues), so the value's dependency is its.
    if (FORM_ONLY.has(r.option) || !RENDERED.includes(r.option) || UNIT_PARAMS.has(r.option)) continue
    it(`${r.option} is read for ${r.reader}`, () => {
      const rd = READERS[r.reader]
      for (const on of rd.on) expect(inertBecause(r.option, on), `${r.option} with ${JSON.stringify(on)}`).toBeNull()
      for (const off of [...rd.off, ...(ALSO_OFF[r.option] ?? [])]) expect(inertBecause(r.option, off), `${r.option} with ${JSON.stringify(off)}`).not.toBeNull()
    })
  }
})

describe('labels', () => {
  it('labels only rendered parameters, each with its own words', () => {
    for (const name of Object.keys(LABEL)) {
      expect(PARAM_BY_NAME.has(name), name).toBe(true)
      expect(hiddenReason(name), name).toBeUndefined()
      expect(RENDERED, name).toContain(name)
    }
    expect(new Set(Object.values(LABEL)).size).toBe(Object.keys(LABEL).length)
    expect(humanName('tag_length')).toBe('Seed length')
  })
})

// Review round 3: no flag, CLI word or version note reaches a label, a
// choice, the one line under a field or the note of an inert field.
describe('the words of the form', () => {
  const FLAG = /(^|[\s(])-[a-z]+_[a-z_]+\b/
  const SNAKE = new RegExp(`\\b(${RENDERED.filter((n) => n.includes('_')).join('|')})\\b`)
  const CLI_WORDS = /\breconcil|\bCLI\b|\bAssume2\b|\bheld-out\b/i
  const VERSION = /\b1\.1\d(\.\d+)?\b/
  for (const name of RENDERED) {
    it(`${name}: label, choices, hint and inert note are in words`, () => {
      const texts = [humanName(name), hintText(name, ''), ...(PARAM_BY_NAME.get(name)?.choices ?? []).map((c) => choiceText(name, c)), ...dependsOf(name).map((d) => d.note)]
      for (const t of texts) {
        expect(t, `${name}: ${t}`).not.toMatch(FLAG)
        expect(t, `${name}: ${t}`).not.toMatch(SNAKE)
        expect(t, `${name}: ${t}`).not.toMatch(CLI_WORDS)
        expect(t, `${name}: ${t}`).not.toMatch(VERSION)
      }
    })
  }
})
