// A list field is as tall as its entries (UI refresh, Inputs mockup): one
// entry is one line, so Fixed modifications matches the Instrument select
// beside it; every further entry adds a line.

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ParamField from '../ParamField'
import { PARAM_BY_NAME } from '../paramLayout'

const rows = (value: string[]): number => {
  const spec = PARAM_BY_NAME.get('fixed_modifications')!
  const { container, unmount } = render(<ParamField spec={spec} value={value} onChange={() => {}} />)
  const n = container.querySelector('textarea')!.rows
  unmount()
  return n
}

describe('string-list rows', () => {
  it('one entry is one row; each further entry adds one', () => {
    expect(rows([])).toBe(1)
    expect(rows(['Carbamidomethyl (C)'])).toBe(1)
    expect(rows(['Carbamidomethyl (C)', 'TMT6plex (K)'])).toBe(2)
  })
})
