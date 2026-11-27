// The cut every mass-shift table of the Mass shifts tab makes (the owner's
// rule): a row with a gap under SHIFT_MIN_DA is the unshifted
// placement, not a mass shift, and is not listed; one line under the table
// gives what it leaves out. The Overview's tiles and the Shifted count still
// count it (the shifted share), and the CLI's files keep it.

import type { JSX } from 'react'
import { SHIFT_MIN_DA } from './overview'

/// Whether gap @p d (Da) is a shift the tables list: |d| of SHIFT_MIN_DA or
/// more. A gap that is not a number is no gap and is not cut.
export const listedGap = (d: number): boolean => Number.isNaN(d) || Math.abs(d) >= SHIFT_MIN_DA

const en = (n: number): string => n.toLocaleString('en-US')

/// The line under a mass-shift table: the @p n spectra (or placements, @p one
/// / @p many) it leaves out; none when there are none.
export function UnshiftedLine({ n, one = 'spectrum', many = 'spectra' }: { n: number; one?: string; many?: string }): JSX.Element | null {
  if (n <= 0) return null
  return (
    <p className="hint unshifted-note">
      {en(n)} {n === 1 ? one : many} with a gap under {SHIFT_MIN_DA} Da (no shift) not listed.
    </p>
  )
}
