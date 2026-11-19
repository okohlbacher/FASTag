// History's file names (HistoryView FileName): the stem is cut with an
// ellipsis in a narrow cell, the extensions are kept so a run's outputs stay
// apart (FASTag 1.15.0: a long input name wrapped one character per line).
import { describe, expect, it } from 'vitest'
import { splitName } from './HistoryView'

describe('splitName', () => {
  it('keeps up to two extensions apart from the stem', () => {
    const stem = 'TMT_Erwinia_1uLSike_Top10HCD_isol2_45stepped_60min_01-20141210'
    expect(splitName(`${stem}.mzML`)).toEqual({ stem, ext: '.mzML' })
    expect(splitName(`${stem}.digest.tsv`)).toEqual({ stem, ext: '.digest.tsv' })
    expect(splitName('run01.pseudo.mzML')).toEqual({ stem: 'run01', ext: '.pseudo.mzML' })
    expect(splitName('a.b.c.tags.tsv')).toEqual({ stem: 'a.b.c', ext: '.tags.tsv' })
  })

  it('a name without an extension, or only one, stays whole', () => {
    expect(splitName('README')).toEqual({ stem: 'README', ext: '' })
    expect(splitName('.hidden')).toEqual({ stem: '.hidden', ext: '' })
    expect(splitName('run_2014.12')).toEqual({ stem: 'run_2014.12', ext: '' })
  })
})
