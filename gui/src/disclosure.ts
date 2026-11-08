// Native disclosures (GUI-DESIGN P5): a <details>/<summary> whose open state
// React owns, for the parameter sections and the log drawer.
//
// The browser gives the summary its focus, its Enter/Space activation and
// the details its open/closed rendering. React keeps the state, because
// other code opens a section (parameter search, a dropped file) or the
// drawer (a batch job's log), and both are remembered in the stores:
//
// - A click on the summary (a pointer, Enter, Space, or a screen reader's
//   activate) is taken over: the native toggle is prevented and the state
//   flipped, so the change is synchronous like the button it replaces.
// - A toggle the browser makes on its own (find-in-page opening a closed
//   section) is mirrored into the state by onToggle.
//
// The summary keeps the button semantics of the old toggle: role=button with
// aria-expanded, so screen readers announce "button, collapsed/expanded" as
// before on every engine (WebKit names a bare summary differently).

import type { MouseEvent, SyntheticEvent } from 'react'

export interface DisclosureProps {
  details: { open: boolean; onToggle(e: SyntheticEvent<HTMLDetailsElement>): void }
  summary: { role: 'button'; 'aria-expanded': boolean; onClick(e: MouseEvent<HTMLElement>): void }
}

/// The props of a <details> and its <summary> shown @p open, with
/// @p setOpen called on every change the user asks for.
export function disclosure(open: boolean, setOpen: (open: boolean) => void): DisclosureProps {
  return {
    details: {
      open,
      onToggle: (e) => {
        const now = e.currentTarget.open
        if (now !== open) setOpen(now)
      }
    },
    summary: {
      role: 'button',
      'aria-expanded': open,
      onClick: (e) => {
        e.preventDefault()
        setOpen(!open)
      }
    }
  }
}
