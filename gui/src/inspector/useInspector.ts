// The inspector's state (GUI-DESIGN 5 inspectorStore, P2b): what the CLI
// can do (--helphelp), the probe of each input, and which red flags the user
// chose to run anyway. The checks themselves are pure (checks.ts).
//
// The spectra file is probed on its own, keyed by the input alone: typing a
// FASTA path never re-probes it. The FASTA is a second, optional probe
// (-probe_input <input> -fasta <file>, as the contract has it) that only adds
// its fasta record; it waits until the field has stopped changing and names
// a FASTA file, and its failure only leaves the FASTA unchecked.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ParamValue } from '../ParamField'
import { PARAM_BY_NAME } from '../paramLayout'
import { capabilitiesOf, NO_CAPABILITIES, type CliCapabilities } from './capabilities'
import { preStartChecks, type Check, type PreStart } from './checks'
import { parseProbe, type ProbeFasta, type ProbeReport } from './probe'
import type { TaxonomyStatus } from '../types'

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
  // The CLI's capabilities or the probe of the input are not known yet: Run
  // waits for them (a probe error or timeout releases it as "not checked").
  checking: boolean
  // Run waits: still checking, a block, or a red flag not answered.
  held: boolean
  isAnswered(id: string): boolean
  runAnyway(id: string): void
  // Take a "Run anyway" back.
  undoRunAnyway(id: string): void
  // Probe the input again (it may have changed on disk).
  recheck(): void
}

/// How long the FASTA field must stay unchanged before it is probed.
export const FASTA_PROBE_DELAY_MS = 700

const FASTA_FORMATS = PARAM_BY_NAME.get('fasta')?.formats ?? ['fasta', 'fa', 'faa']
/// An absolute path that names a FASTA file by its extension (the manifest's
/// formats of -fasta), so a half-typed path is not probed.
export function probeableFasta(f: string): boolean {
  if (!(f.startsWith('/') || /^[A-Za-z]:[\\/]/.test(f) || f.startsWith('\\\\'))) return false
  const ext = /\.([A-Za-z0-9]+)(?:\.gz)?$/.exec(f)?.[1]?.toLowerCase()
  return !!ext && FASTA_FORMATS.includes(ext)
}

const whyFailed = (r: { supported: boolean; ok: boolean; timed_out: boolean; code: number | null; reason: string | null }): string =>
  !r.supported
    ? (r.reason ?? 'not supported')
    : r.timed_out
      ? (r.reason ?? 'timed out')
      : `exit code ${r.code ?? '?'}${r.reason ? `: ${r.reason}` : ''}`

const fastaKey = (input: string, fasta: string): string => `${input}\u0000${fasta}`

export function useInspector(o: { input: string; values: Record<string, ParamValue>; binOk: boolean }): Inspector {
  const { input, values, binOk } = o
  const fasta = typeof values['fasta'] === 'string' ? values['fasta'].trim() : ''
  const [caps, setCaps] = useState<CliCapabilities | null>(null)
  // input -> its probe.
  const [probes, setProbes] = useState<Record<string, Probed>>({})
  // input + FASTA -> the FASTA record (null: the FASTA probe gave none).
  const [fastas, setFastas] = useState<Record<string, ProbeFasta | null>>({})
  // `${input} ${check id}` of the red flags answered with Run anyway.
  const [answered, setAnswered] = useState<Set<string>>(() => new Set())
  const [generation, setGeneration] = useState(0)
  // Where a -species run finds the taxonomy index; undefined while unknown.
  const [taxonomy, setTaxonomy] = useState<TaxonomyStatus | undefined>(undefined)
  const speciesOn = values['species'] === true
  const taxdbField = typeof values['taxdb'] === 'string' ? values['taxdb'].trim() : ''
  // The taxonomy: whenever the species report is on, its -taxdb field
  // changes, Check again is pressed, or the window gets the focus back (the
  // index may just have been unpacked).
  const [focusCount, setFocusCount] = useState(0)
  useEffect(() => {
    const onFocus = (): void => setFocusCount((n) => n + 1)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])
  useEffect(() => {
    if (!binOk || !speciesOn) return
    let live = true
    window.fastag
      .taxonomyStatus(taxdbField || undefined)
      .then((t) => live && setTaxonomy(t))
      .catch(() => live && setTaxonomy(undefined))
    return () => {
      live = false
    }
  }, [binOk, speciesOn, taxdbField, generation, focusCount])

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

  // The spectra file: once per input (and per "Check again").
  useEffect(() => {
    if (!input || !caps?.probeInput) return
    let live = true
    window.fastag
      .probeInput(input, null)
      .then((r) => {
        if (!live) return
        const p: Probed = r.supported && r.ok ? { report: parseProbe(r.stdout) } : { error: whyFailed(r) }
        setProbes((m) => ({ ...m, [input]: p }))
      })
      .catch((e: unknown) => live && setProbes((m) => ({ ...m, [input]: { error: e instanceof Error ? e.message : String(e) } })))
    return () => {
      live = false
    }
    // generation: Check again.
  }, [input, caps?.probeInput, generation])

  // The FASTA: debounced, and only a path that names a FASTA file.
  const fk = fastaKey(input, fasta)
  const wantFasta = !!input && !!caps?.probeInput && caps?.options.includes('fasta') === true && probeableFasta(fasta)
  useEffect(() => {
    if (!wantFasta) return
    let live = true
    const t = setTimeout(() => {
      window.fastag
        .probeInput(input, fasta)
        .then((r) => {
          if (!live) return
          const rep = r.supported && r.ok ? parseProbe(r.stdout) : null
          setFastas((m) => ({ ...m, [fk]: rep?.status === 'ok' ? (rep.fasta ?? null) : null }))
        })
        .catch(() => live && setFastas((m) => ({ ...m, [fk]: null })))
    }, FASTA_PROBE_DELAY_MS)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [fk, wantFasta, generation])

  const probed = probes[input]
  const fastaRecord = wantFasta ? fastas[fk] : undefined
  const pre = useMemo<PreStart>(() => {
    if (!input) {
      // No file: only the checks of the settings.
      const s = preStartChecks({ input, values, supported: false, probe: null, taxonomy })
      return { ...s, notChecked: null }
    }
    const report = probed?.report
    return preStartChecks({
      input,
      values,
      // Not known yet: the probe is pending, never "not checked".
      supported: caps ? caps.probeInput : true,
      // The FASTA record comes from its own probe only.
      probe: report ? { ...report, fasta: fastaRecord ?? undefined } : null,
      probeError: probed?.error ?? null,
      taxonomy
    })
  }, [input, values, caps, probed, fastaRecord, taxonomy])

  const isAnswered = useCallback((id: string) => answered.has(`${input} ${id}`), [answered, input])
  const blocks = pre.checks.filter((c) => c.level === 'block')
  const unanswered = pre.checks.filter((c) => c.level === 'flag' && !answered.has(`${input} ${c.id}`))
  const checking = !!input && binOk && pre.pending
  return {
    caps,
    pre,
    blocks,
    unanswered,
    checking,
    held: checking || blocks.length > 0 || unanswered.length > 0,
    isAnswered,
    runAnyway: (id) => setAnswered((s) => new Set(s).add(`${input} ${id}`)),
    undoRunAnyway: (id) =>
      setAnswered((s) => {
        const n = new Set(s)
        n.delete(`${input} ${id}`)
        return n
      }),
    recheck: () => {
      setProbes((m) => {
        const n = { ...m }
        delete n[input]
        return n
      })
      setFastas((m) => {
        const n = { ...m }
        delete n[fk]
        return n
      })
      setGeneration((g) => g + 1)
    }
  }
}
