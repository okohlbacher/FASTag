// The Digest tab's Alkylation block reads the call by its source (review
// n4): a format 2 (or later) call from the tags counts tag votes, not
// spectra with one cysteine, and its tag call passed a held-out test (at
// the margin) that the placement call has not; the placement call of a
// report with a database is shown beside it, its reason included.
// gui/src/fixtures/alkylation-tags.tsv: FASTag 1.15.7 on PXD000001 with
// -alkylation_proteome human and tags of 3 residues.

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import DigestPanel from '../DigestPanel'
import { parseReport } from '../digestReport'
import ALKYLATION from '../fixtures/alkylation.tsv?raw'
import ALKYLATION_TAGS from '../fixtures/alkylation-tags.tsv?raw'

const block = (text: string): string => {
  render(<DigestPanel reports={[parseReport(text, '/d/run01.alkylation.tsv')]} errors={[]} onOpen={() => {}} />)
  return screen.getByRole('region', { name: 'Alkylation' }).textContent ?? ''
}
// Review (release gate) n4: the held-out result is format 2's; a format 3
// report (the fixture) says so and that its rules were not tested again.
const TESTED = /Tag call: its held-out test passed at the margin on report format 2 \(40 of 57 runs called, 37 right, at tag length 4 and Extension 6\); this report is format 3, whose voting rules were not tested again/
const TESTED_F2 = /Tag call: passed a held-out test at the margin \(40 of 57 runs called, 37 right, at tag length 4 and Extension 6\)/

describe('Digest tab: the alkylation call by its source', () => {
  it('a tag no call: votes from tags, the tag call\'s test, and the placement call with its own reason', () => {
    const t = block(ALKYLATION_TAGS)
    expect(t).not.toMatch(/one cysteine/)
    expect(t).not.toMatch(/Not validated on held-out/)
    expect(t).toMatch(/No calltoo few tag votes for a cysteine form/)
    expect(t).toMatch(/Votes from tags8/)
    expect(t).toMatch(TESTED)
    expect(t).toMatch(/Placement callno call: no tag reaches the length the proteome needs/)
  })

  it('a call of tags and placements: the tag call\'s test, and the placement call and the rule not validated', () => {
    const both = ALKYLATION_TAGS.replace(/^alkylation_placement_call\tstatus\t[^\n]*$/m, 'alkylation_placement_call\tstatus\tcall\t12\t-')
      .replace(/^alkylation_placement_call\treagent\t[^\n]*$/m, 'alkylation_placement_call\treagent\tMethylthio\t11\t-')
      .replace(/^alkylation_placement_call\treason\t[^\n]*$/m, 'alkylation_placement_call\treason\t-\t-\t-')
      .replace(/^alkylation_call\tstatus\t[^\n]*$/m, 'alkylation_call\tstatus\tcall\t68\t-')
      .replace(/^alkylation_call\treagent\t[^\n]*$/m, 'alkylation_call\treagent\tMethylthio\t52\t-')
      .replace(/^alkylation_call\tmass\t[^\n]*$/m, 'alkylation_call\tmass\t45.987721\t-\t-')
      .replace(/^alkylation_call\treason\t[^\n]*$/m, 'alkylation_call\treason\t-\t-\t-')
      .replace(/^alkylation_call\tsource\t[^\n]*$/m, 'alkylation_call\tsource\ttags+placement\t-\t-')
    const t = block(both)
    expect(t).toMatch(/ReagentMethylthio/)
    expect(t).toMatch(/Votes from tags68/)
    expect(t).toMatch(/Placement callMethylthio \(12 spectra with one cysteine\)/)
    expect(t).toMatch(TESTED)
    expect(t).toMatch(/The placement call is not validated and the combination is a rule of this version\./)
    expect(t).not.toMatch(/Not validated on held-out/)
  })

  it('the held-out result is labelled by the report format', () => {
    const f2 = block(ALKYLATION_TAGS.replace(/^alk_run\tformat\t3\t/m, 'alk_run\tformat\t2\t'))
    expect(f2).toMatch(TESTED_F2)
    expect(f2).not.toMatch(/not tested again/)
  })

  it('format 1 (placements only) keeps its words', () => {
    const t = block(ALKYLATION)
    expect(t).toMatch(/too few spectra with one cysteine/)
    expect(t).toMatch(/Spectra with one cysteine0/)
    expect(t).toMatch(/Not validated on held-out data: a call to check, not a setting to copy\./)
    expect(t).not.toMatch(/Placement call|Tag call/)
  })
})
