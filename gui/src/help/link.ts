// Whether Help is shown, which page, and which section a link asked for.
//
// A module-level store read with useSyncExternalStore, so a field or a panel
// deep in the tree can open Help without props threaded through App. The
// section request is a new object each time, so asking for the same section
// twice still scrolls to it.
import { useSyncExternalStore } from 'react'

export interface HelpState {
  open: boolean
  /// The page shown when no section is asked for (the last one seen).
  page: string
  /// The section a link asked for; null once a page is picked by hand.
  target: { id: string } | null
  /// Where the reader was before the last link or page pick, for one step back.
  back: { page: string; target: { id: string } | null } | null
}

let state: HelpState = { open: false, page: 'start', target: null, back: null }
const listeners = new Set<() => void>()
// The control that opened Help, to give focus back when it closes.
let opener: HTMLElement | null = null

function set(next: HelpState): void {
  state = next
  listeners.forEach((l) => l())
}

/// Open Help, at the section @p id if one is given, else at the last page.
export function openHelp(id?: string): void {
  if (!state.open) opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  set({ ...state, open: true, target: id ? { id } : null, back: here() })
}

/// Show page @p page from its top.
export function showHelpPage(page: string): void {
  set({ ...state, page, target: null, back: here() })
}

/// Go back one step, to where the last link or page pick left from.
export function helpBack(): void {
  const b = state.back
  if (b) set({ ...state, page: b.page, target: b.target && { id: b.target.id }, back: null })
}

const here = (): HelpState['back'] => (state.open ? { page: state.page, target: state.target } : null)

/// Remember the page a section link landed on, without a new scroll.
export function rememberHelpPage(page: string): void {
  if (state.page !== page) set({ ...state, page })
}

/// Close Help, and give focus back to the control that opened it once the
/// run view is shown again.
export function closeHelp(): void {
  set({ ...state, open: false, target: null, back: null })
  const o = opener
  opener = null
  if (o) setTimeout(() => o.isConnected && o.focus())
}

export function useHelp(): HelpState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state
  )
}

/// Tests start from a closed Help on its first page.
export function resetHelp(): void {
  opener = null
  set({ open: false, page: 'start', target: null, back: null })
}
