// A modal question or dialog (the close guard, the overwrite question,
// About): the rest of the window is inert while it is open, so Tab and a
// screen reader stay inside it; Tab cycles through its controls; Escape
// gives the safe answer; focus goes back where it was when it closes.

import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/// @p box: the modal element; @p onEscape: the safe answer. Returns the
/// modal's keydown handler.
export function useModal(box: RefObject<HTMLElement | null>, onEscape: () => void): (e: KeyboardEvent<HTMLElement>) => void {
  const escape = useRef(onEscape)
  escape.current = onEscape
  // Where focus was before the modal: read at its first render, before an
  // autoFocus control of it takes focus.
  const [back] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null))
  useEffect(() => {
    // Every sibling of the modal's ancestors up to <body> goes inert.
    const made: Element[] = []
    const top = box.current?.closest('.modal-backdrop') ?? box.current
    for (let el: Element | null | undefined = top; el && el.parentElement; el = el.parentElement) {
      for (const sib of Array.from(el.parentElement.children)) {
        if (sib === el || sib.hasAttribute('inert') || sib.tagName === 'SCRIPT') continue
        sib.setAttribute('inert', '')
        made.push(sib)
      }
      if (el.parentElement === document.body) break
    }
    // An autoFocus control already has focus; else the first one.
    if (box.current && !box.current.contains(document.activeElement)) box.current.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    return () => {
      for (const e of made) e.removeAttribute('inert')
      if (back && back.isConnected) back.focus()
    }
  }, [])
  return (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      escape.current()
      return
    }
    if (e.key !== 'Tab' || !box.current) return
    const items = Array.from(box.current.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (items.length === 0) return
    const i = items.indexOf(document.activeElement as HTMLElement)
    const to = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i < 0 || i === items.length - 1 ? 0 : i + 1
    e.preventDefault()
    items[to].focus()
  }
}
