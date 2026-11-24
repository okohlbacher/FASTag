// Why the file was not checked before the run, behind a (?) beside the
// Instrument brief (SPEC step 2: no prose line under the input card). Only
// for the benign case, a CLI without -probe_input (checks.ts
// NOT_CHECKED_NO_PROBE); a failed or unreadable probe stays a visible line
// (InspectorPanel). The live region of the checks still says it aloud.

import { useEffect, useId, useRef, useState, type JSX } from 'react'

export function NotCheckedHelp({ text }: { text: string }): JSX.Element {
  const [open, setOpen] = useState(false)
  const id = useId()
  const box = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  // A click outside, or Escape, closes it; Escape gives focus back.
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [open])
  return (
    <div
      className="help-pop-wrap not-checked-help"
      ref={box}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          setOpen(false)
          btn.current?.focus()
        }
      }}
    >
      <button
        ref={btn}
        type="button"
        className="help-q"
        aria-label="Why the file was not checked"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        ?
      </button>
      {open && (
        <div id={id} className="help-pop" role="dialog" aria-label="Not checked before the run">
          <p className="not-checked">{text}</p>
        </div>
      )}
    </div>
  )
}
