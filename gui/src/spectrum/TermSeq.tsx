// A resolved tag's sequence with its termini (terminus.ts): N– before it when
// its N side is the peptide's N terminus, –C after it for the C terminus;
// N–(K) and (K)–C, muted, when one residue lies between.

import type { JSX } from 'react'
import { endWords, termText, type End, type Terminus } from './terminus'

function Mark({ side, e, text }: { side: 'N' | 'C'; e: End; text: string }): JSX.Element | null {
  if (!e) return null
  const words = endWords(side, e) ?? ''
  return (
    <span className={`sp-term${e === 'at' ? '' : ' away'}`} data-term={side} role="img" aria-label={words} title={words}>
      {text}
    </span>
  )
}

export function TermSeq({ seq, t }: { seq: string; t?: Terminus | null }): JSX.Element {
  if (!t) return <>{seq}</>
  const tt = termText(t)
  return (
    <>
      <Mark side="N" e={t.n} text={tt.pre} />
      {seq}
      <Mark side="C" e={t.c} text={tt.post} />
    </>
  )
}
