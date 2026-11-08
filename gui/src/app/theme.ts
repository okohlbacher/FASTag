// Themes (GUI-DESIGN 4, D9): light, dark and system. The choice sits on
// :root[data-theme] (styles/tokens.css); system removes the attribute, so
// prefers-color-scheme decides. It is a per-machine look, not a run setting,
// so it is remembered in local storage (D6 is about run parameters).

import { useCallback, useState } from 'react'

export type Theme = 'system' | 'light' | 'dark'

export const THEMES: readonly { id: Theme; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' }
]

const KEY = 'fastag.theme'
const isTheme = (v: unknown): v is Theme => THEMES.some((t) => t.id === v)

export function applyTheme(t: Theme, root: HTMLElement = document.documentElement): void {
  if (t === 'system') root.removeAttribute('data-theme')
  else root.dataset.theme = t
}

/// The remembered theme; system when none is stored or storage is blocked.
export function loadTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    return isTheme(v) ? v : 'system'
  } catch {
    return 'system'
  }
}

export function saveTheme(t: Theme): void {
  try {
    localStorage.setItem(KEY, t)
  } catch {
    // A blocked storage keeps the theme for this session only.
  }
}

/// The theme and a setter that applies and remembers it.
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(loadTheme)
  const setTheme = useCallback((t: Theme) => {
    applyTheme(t)
    saveTheme(t)
    setThemeState(t)
  }, [])
  return [theme, setTheme]
}
