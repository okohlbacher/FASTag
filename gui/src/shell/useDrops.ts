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

export interface DropInputs {
  busy: boolean
  // Queued batch jobs: spectra then join the queue.
  jobs: number
  setInputPath(p: string): void
  session: Pick<Session, 'setValues' | 'setOpenGroups'>
  run: Pick<RunState, 'addBatchPaths' | 'openResultsPath' | 'openReportPaths' | 'openSpeciesPath'>
  setView(v: View): void
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
    if (plan.results) void d.run.openResultsPath(plan.results)
    if (plan.reports.length) void d.run.openReportPaths(plan.reports)
    if (plan.species) void d.run.openSpeciesPath(plan.species)
    if (plan.view) d.setView(plan.view)
    setDropNote(plan.notes.length ? plan.notes.join(' ') : null)
  }
  const applyRef = useRef(apply)
  applyRef.current = apply

  useEffect(() => window.fastag.onDrop((r) => applyRef.current(r)), [])
  useEffect(() => window.fastag.onDragHover(setDragOver), [])

  return { dragOver, dropNote, dismissNote: () => setDropNote(null) }
}
