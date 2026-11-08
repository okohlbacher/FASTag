// PARAM_UI against the manifest (GUI-DESIGN P5): one entry per parameter of
// params.generated.json, in both directions, so that regenerating the
// manifest from a new CLI is an edit of PARAM_UI only.
import { describe, expect, it } from 'vitest'
import manifest from './params.generated.json'
import { PARAM_UI } from './paramUi'
import { HIDDEN_PARAMS, RENDERED, SECTIONS, masters, unknownParams, unplacedParams } from './paramLayout'

const NAMES = (manifest.params as { name: string }[]).map((p) => p.name)
const MANIFEST = new Set(NAMES)
const ENTRIES = Object.keys(PARAM_UI)

describe('PARAM_UI', () => {
  it('has exactly one entry for every parameter of the manifest', () => {
    // An object literal cannot hold a key twice at run time, and the manifest
    // itself names each parameter once; a name missing from either side is
    // the failure.
    expect(new Set(NAMES).size).toBe(NAMES.length)
    expect(NAMES.filter((n) => !Object.prototype.hasOwnProperty.call(PARAM_UI, n))).toEqual([])
  })

  it('names no parameter the manifest lacks', () => {
    expect(ENTRIES.filter((n) => !MANIFEST.has(n))).toEqual([])
  })

  it('places each entry exactly once: in one form section, or hidden with a reason', () => {
    const titles = new Set(SECTIONS.map((s) => s.title))
    for (const [n, u] of Object.entries(PARAM_UI)) {
      expect((u.section === undefined) !== (u.hidden === undefined), n).toBe(true)
      if (u.section !== undefined) expect(titles.has(u.section), `${n}: ${u.section}`).toBe(true)
      if (u.hidden !== undefined) expect(u.hidden.trim(), n).not.toBe('')
    }
    expect(RENDERED.length + HIDDEN_PARAMS.length).toBe(ENTRIES.length)
    expect(unplacedParams()).toEqual([])
  })

  it('names only manifest parameters as masters and units', () => {
    for (const [n, u] of Object.entries(PARAM_UI)) {
      for (const d of u.depends ?? []) for (const m of masters(d)) expect(MANIFEST.has(m), `${n} depends on ${m}`).toBe(true)
      if (u.unit) {
        expect(MANIFEST.has(u.unit), `${n} unit ${u.unit}`).toBe(true)
        // The unit is drawn inside its value's field, so both are in the form
        // or neither is.
        expect(PARAM_UI[u.unit]?.section, `${n} unit ${u.unit}`).toBe(u.section)
      }
    }
    for (const s of SECTIONS) if (s.master) expect(PARAM_UI[s.master]?.section, s.master).toBe(s.title)
    expect(unknownParams()).toEqual([])
  })

  it('gives every section at least one parameter', () => {
    for (const s of SECTIONS) expect(s.params.length, s.title).toBeGreaterThan(0)
  })
})
