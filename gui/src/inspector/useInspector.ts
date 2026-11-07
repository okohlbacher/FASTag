// The inspector's state (GUI-DESIGN 5 inspectorStore, P2b): what the CLI
// can do (--helphelp), the probe of each input, and which red flags the user
// chose to run anyway. The checks themselves are pure (checks.ts).

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ParamValue } from '../ParamField'
import { capabilitiesOf, NO_CAPABILITIES, type CliCapabilities } from './capabilities'
import { preStartChecks, type Check, type PreStart } from './checks'
import { parseProbe, type ProbeReport } from './probe'

interface Probed {
  report?: ProbeReport
  error?: string
}

export interface Inspector {
  caps: CliCapabilities | null
  pre: PreStart
  // Checks that keep Run disabled.
  blocks: Check[]
  // Red flags not yet answered with "Run anyway" (or fixed).
  unanswered: Check[]
  // Run waits for a block to go or a red flag to be answered.
  held: boolean
  isAnswered(id: string): boolean
  runAnyway(id: string): void
  // Probe the input again (it may have changed on disk).
  recheck(): void
}

const keyOf = (input: string, fasta: string): string => `${input}\u0000${fasta}`

export function useInspector(o: { input: string; values: Record<string, ParamValue>; binOk: boolean }): Inspector {
  const { input, values, binOk } = o
  const fasta = typeof values['fasta'] === 'string' ? values['fasta'].trim() : ''
  const [caps, setCaps] = useState<CliCapabilities | null>(null)
  const [probes, setProbes] = useState<Record<string, Probed>>({})
  // `${input} ${check id}` of the red flags answered with Run anyway.
  const [answered, setAnswered] = useState<Set<string>>(() => new Set())
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    if (!binOk) return
    let live = true
    window.fastag
      .cliCapabilities()
      .then((c) => live && setCaps(c.ok ? capabilitiesOf(c.options) : NO_CAPABILITIES))
      .catch(() => live && setCaps(NO_CAPABILITIES))
    return () => {
      live = false
    }
  }, [binOk])

  const key = keyOf(input, fasta)
  useEffect(() => {
    if (!input || !caps?.probeInput) return
    let live = true
    window.fastag
      .probeInput(input, fasta || null)
      .then((r) => {
        if (!live) return
        const p: Probed = !r.supported
          ? { error: r.reason ?? 'not supported' }
          : r.ok
            ? { report: parseProbe(r.stdout) }
            : { error: r.timed_out ? (r.reason ?? 'timed out') : `exit code ${r.code ?? '?'}${r.reason ? `: ${r.reason}` : ''}` }
        setProbes((m) => ({ ...m, [keyOf(input, fasta)]: p }))
      })
      .catch((e: unknown) => live && setProbes((m) => ({ ...m, [keyOf(input, fasta)]: { error: e instanceof Error ? e.message : String(e) } })))
    return () => {
      live = false
    }
    // generation: Check again.
  }, [input, fasta, caps?.probeInput, generation])

  const probed = probes[key]
  const pre = useMemo<PreStart>(() => {
    if (!input) {
      // No file: only the checks of the settings.
      const s = preStartChecks({ input, values, supported: false, probe: null })
      return { ...s, notChecked: null }
    }
    return preStartChecks({
      input,
      values,
      // Not known yet: the probe is pending, never "not checked".
      supported: caps ? caps.probeInput : true,
      probe: probed?.report ?? null,
      probeError: probed?.error ?? null
    })
  }, [input, values, caps, probed])

  const isAnswered = useCallback((id: string) => answered.has(`${input} ${id}`), [answered, input])
  const blocks = pre.checks.filter((c) => c.level === 'block')
  const unanswered = pre.checks.filter((c) => c.level === 'flag' && !answered.has(`${input} ${c.id}`))
  return {
    caps,
    pre,
    blocks,
    unanswered,
    held: blocks.length > 0 || unanswered.length > 0,
    isAnswered,
    runAnyway: (id) => setAnswered((s) => new Set(s).add(`${input} ${id}`)),
    recheck: () => {
      setProbes((m) => {
        const n = { ...m }
        delete n[key]
        return n
      })
      setGeneration((g) => g + 1)
    }
  }
}
