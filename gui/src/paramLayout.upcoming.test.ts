// The 1.8.0 options are placed in the layout before the manifest has them.
// Here the manifest is extended the way `npm run params` will extend it, and
// the form must then show every one of them with no layout warning.

import { describe, expect, it, vi } from 'vitest'

const NEW = [
  ['digest_out', 'output-file'],
  ['label_out', 'output-file'],
  ['digest_models', 'input-file'],
  ['digest_tag_min', 'int'],
  ['digest_window', 'double'],
  ['digest_background_share', 'double'],
  ['digest_silac_min', 'int'],
  ['massgap_out', 'output-file'],
  ['massgap_window', 'double'],
  ['massgap_window_da', 'double'],
  ['massgap_min_spectra', 'int'],
  ['massgap_min_share', 'double'],
  ['massgap_min_bin', 'int'],
  ['massgap_max_mods', 'int'],
  ['massgap_top', 'int'],
  ['massgap_silac_share', 'double'],
  ['massgap_silac_min', 'int']
] as const

vi.mock('./params.generated.json', async (importOriginal) => {
  const orig = (await importOriginal()) as { default: { params: unknown[] } }
  const extra = NEW.map(([name, type]) => ({
    name,
    type,
    default: '',
    description: `${name} (test)`,
    required: false,
    toppAdvanced: true
  }))
  return { default: { params: [...orig.default.params, ...extra] } }
})

describe('layout with the 1.8.0 manifest', () => {
  it('renders every new option and warns about nothing', async () => {
    const L = await import('./paramLayout')
    for (const [name] of NEW) expect(L.RENDERED).toContain(name)
    expect(L.unplacedParams()).toEqual([])
    expect(L.unknownParams()).toEqual([])
    expect(L.SECTIONS.map((s) => s.title)).toContain('Digest and labels')
  })
})

describe('layout with the 1.7.0 manifest', () => {
  it('leaves the new options out instead of warning', async () => {
    vi.resetModules()
    vi.doUnmock('./params.generated.json')
    const L = await import('./paramLayout')
    for (const [name] of NEW) expect(L.RENDERED).not.toContain(name)
    expect(L.unknownParams()).toEqual([])
  })
})
