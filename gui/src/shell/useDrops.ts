// Drops on the window (GUI-DESIGN 2 "window-wide drop zone", P2a PR s): the
// backend sorts the dropped paths (drop.rs) and sends one route; this applies
// it as dropRoute.ts plans it, shows the drop target while files are dragged
// over the window, and says what was not taken.

import { useEffect, useRef, useState } from 'react'
import type { DropRoute } from '../types'
import type { View } from '../setup/shortcuts'
import type { Session } from '../setup/useSession'
import type { RunState } from '../run/useRun'
import { SECTIONS } from '../paramLayout'
import { planDrop } from './dropRoute'
import { INPUTS } from '../setup/inputs'
import { baseName } from '../digestReport'

export interface DropInputs {
  busy: boolean
  // Queued batch jobs: spectra then join the queue.
  jobs: number
  setInputPath(p: string): void
  session: Pick<Session, 'setValues' | 'setOpenGroups' | 'revealInput'>
  run: Pick<RunState, 'addBatchPaths' | 'openDropped'>
  setView(v: View): void
  // A dropped SDRF is loaded for the Batch view's comparison (P4).
  loadSdrf(path: string): Promise<void>
}

export function useDrops(d: DropInputs): { dragOver: boolean; dropNote: string | null; dismissNote(): void } {
  const [dragOver, setDragOver] = useState(false)
  // What a drop did not take, said once.
  const [dropNote, setDropNote] = useState<string | null>(null)

  function apply(r: DropRoute): void {
    const plan = planDrop(r, { busy: d.busy, queued: d.jobs > 0 })
    if (plan.input) d.setInputPath(plan.input)
    if (plan.batch) d.run.addBatchPaths(plan.batch)
    if (plan.values) {
      const vals = plan.values
      d.session.setValues((v) => ({ ...v, ...vals }))
      // Show the fields that were filled.
      const open = SECTIONS.filter((sec) => sec.params.some((n) => n in vals)).map((sec) => sec.title)
      d.session.setOpenGroups((g) => ({ ...g, ...Object.fromEntries(open.map((t) => [t, true])) }))
    }
    // One selection for the whole drop (useRun openDropped).
    if (plan.results || plan.reports.length || plan.species) void d.run.openDropped({ results: plan.results, reports: plan.reports, species: plan.species })
    // A FASTA or an index fills a field of Inputs, which may be another
    // step or an optional input not shown yet: opened, and said where.
    const placed: string[] = []
    for (const [n, v] of Object.entries(plan.values ?? {})) {
      const spec = INPUTS[n]
      if (!spec || spec.place !== 'step2' || typeof v !== 'string' || !v) continue
      d.session.revealInput(n)
      placed.push(`${baseName(v)} went to ${spec.label} in Inputs.`)
    }
    if (plan.sdrf) void d.loadSdrf(plan.sdrf)
    if (plan.view) d.setView(plan.view)
    setDropNote(plan.notes.length || placed.length ? [...placed, ...plan.notes].join(' ') : null)
  }
  const applyRef = useRef(apply)
  applyRef.current = apply

  useEffect(() => window.fastag.onDrop((r) => applyRef.current(r)), [])
  useEffect(() => window.fastag.onDragHover(setDragOver), [])

  return { dragOver, dropNote, dismissNote: () => setDropNote(null) }
}
