// Keyboard shortcuts and native-menu actions (GUI-DESIGN 2, P0b minimal set).
// The same action names come from the native menus (menu.rs, MENU_EVENT) and
// from the webview's own key handler below. Cmd on macOS, Ctrl elsewhere.

export type Action =
  | 'open-spectra'
  | 'open-results'
  | 'export'
  | 'reveal'
  | 'run'
  | 'cancel'
  | 'help'
  | 'search-params'

export const ACTIONS: readonly Action[] = [
  'open-spectra',
  'open-results',
  'export',
  'reveal',
  'run',
  'cancel',
  'help',
  'search-params'
]

export const isMac = (): boolean => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

/// The shortcut text shown beside a control: "⌘K" on macOS, "Ctrl+K" elsewhere.
export function keyText(key: string, mac = isMac()): string {
  return mac ? `⌘${key}` : `Ctrl+${key}`
}

const typing = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

/// The action of a key event, if it is one of the app's shortcuts. The
/// modifier is Cmd on macOS and Ctrl elsewhere (@p mac). "/" opens the
/// parameter search only outside a text field.
export function actionOfKey(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'target'>,
  mac = isMac()
): Action | null {
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
  if (!mod) {
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e.target)) return 'search-params'
    return null
  }
  if (e.altKey) return null
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (k === 'o') return e.shiftKey ? 'open-results' : 'open-spectra'
  if (e.shiftKey) return k === '?' || k === '/' ? 'help' : null
  if (k === 'Enter') return 'run'
  if (k === '.') return 'cancel'
  if (k === 'e') return 'export'
  if (k === 'k') return 'search-params'
  if (k === '?') return 'help'
  return null
}

/// Drops an action that arrives from the other source (native menu or the
/// webview's key handler) within @p ms of the same action: a shortcut both
/// see acts once. Repeats from one source always act.
export function deduper(ms = 300, now: () => number = () => Date.now()): (a: Action, source: 'key' | 'menu') => boolean {
  let last: { a: Action; t: number; source: 'key' | 'menu' } | null = null
  return (a, source) => {
    const t = now()
    if (last && last.a === a && last.source !== source && t - last.t < ms) {
      last = null
      return false
    }
    last = { a, t, source }
    return true
  }
}
