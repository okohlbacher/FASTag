// The window's keys and native menus (moved from App.tsx, P2a PR s). F1 (or
// ?, outside a text field) opens Help; Esc closes it, or else cancels the run
// when nothing else is open (@p escape says whether it did). Cmd/Ctrl
// shortcuts in the webview and the native menu items (menu.rs) run one action
// each; a key both see acts once (deduper).

import { useEffect } from 'react'
import { closeHelp, openHelp } from '../help/link'
import { actionOfKey, deduper, type Action } from '../setup/shortcuts'

const typing = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

export function useKeys(helpOpen: boolean, act: (a: Action) => void, escape: () => boolean): void {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'F1' || (e.key === '?' && !typing(e.target))) {
        e.preventDefault()
        // Already open: stay where the reader is.
        if (!helpOpen) openHelp()
      } else if (e.key === 'Escape' && helpOpen && !typing(e.target)) {
        e.preventDefault()
        closeHelp()
      } else if (e.key === 'Escape' && !e.defaultPrevented && !typing(e.target)) {
        if (escape()) e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // act and escape are read through refs by the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [helpOpen])

  useEffect(() => {
    const fresh = deduper()
    const onKey = (e: globalThis.KeyboardEvent): void => {
      const a = actionOfKey(e)
      if (!a) return
      e.preventDefault()
      if (fresh(a, 'key')) act(a)
    }
    window.addEventListener('keydown', onKey)
    const off = window.fastag.onMenu((name) => {
      const a = name as Action
      if (fresh(a, 'menu')) act(a)
    })
    return () => {
      window.removeEventListener('keydown', onKey)
      off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
