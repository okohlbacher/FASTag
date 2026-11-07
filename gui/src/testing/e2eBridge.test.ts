// The e2e `view` fixture serves the tags table with e2eBridge.ts's
// viewIds, a TypeScript copy of browser.rs's view rules. This holds that
// copy to the backend: ecoli.views.json is what browser.rs's query path
// returns for each spec on the same E. coli tags (browser_p3_tests.rs,
// the_backend_views_of_the_fixture_match_the_golden, which fails when the
// backend moves and rewrites the file with FASTAG_GOLDEN=write).

import { describe, expect, it } from 'vitest'
import { viewIds } from './e2eBridge'
import type { ResultsView } from '../types'
import ecoliTags from '../../e2e-web/fixtures/ecoli.tags.tsv?raw'
import golden from '../../e2e-web/fixtures/ecoli.views.json'

const [head, ...lines] = ecoliTags.replace(/\r/g, '').split('\n').filter((l) => l !== '')
const columns = head.split('\t')
const rows = lines.map((l) => l.split('\t'))

describe("the view fixture's viewIds", () => {
  it('covers a spec of every kind', () => {
    const views = (golden as { view: ResultsView }[]).map((g) => g.view)
    expect(views.length).toBeGreaterThan(20)
    for (const k of ['sort', 'spectrum', 'minLength', 'maxEvalue', 'fastaHit', 'perSpectrum'] as const)
      expect(views.some((v) => v[k] != null), k).toBe(true)
  })

  for (const { view, ids } of golden as { view: ResultsView; ids: number[] }[])
    it(`equals browser.rs for ${JSON.stringify(view)}`, () => {
      expect(viewIds(columns, rows, view)).toEqual(ids)
    })
})
