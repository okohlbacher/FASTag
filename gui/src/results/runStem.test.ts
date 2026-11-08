// The run a table belongs to by its file name (reports.ts runStem,
// sameRunFiles): the rule the viewers use to keep one run's files together.

import { describe, expect, it } from 'vitest'
import { runStem, sameRunFiles } from './reports'

describe('runStem and sameRunFiles', () => {
  it('reads the stem of the names a run writes', () => {
    expect(runStem('/d/run01.massgap.tsv')).toBe('run01')
    expect(runStem('/d/run01.recon.mzTab')).toBe('run01')
    expect(runStem('/d/run01.tags.glyco.tsv')).toBe('run01')
    expect(runStem('/d/run01.tags.tsv')).toBe('run01')
    expect(runStem('C:\\r.1\\my.sample.delta.tsv')).toBe('my.sample')
    expect(runStem('/d/recon.tsv')).toBeNull()
  })

  it('one folder and, where both have one, one stem', () => {
    expect(sameRunFiles('/a/run.massgap.tsv', '/a/run.delta.tsv')).toBe(true)
    expect(sameRunFiles('/a/run.massgap.tsv', '/a/run.tags.glyco.tsv')).toBe(true)
    expect(sameRunFiles('/a/run.massgap.tsv', '/b/run.delta.tsv')).toBe(false)
    expect(sameRunFiles('/a/run.massgap.tsv', '/a/other.recon.tsv')).toBe(false)
    expect(sameRunFiles('/a/run.massgap.tsv', '/a/recon.tsv')).toBe(true)
  })
})
