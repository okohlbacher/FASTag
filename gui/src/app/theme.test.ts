// Themes (GUI-DESIGN 4): light, dark and system on :root[data-theme], the
// choice remembered per machine; a stored value that is not a theme, or
// storage that throws, falls back to system.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { THEMES, applyTheme, loadTheme, saveTheme } from './theme'

// Node 26 shadows jsdom's localStorage with an undefined one; the webview
// has a real one. A map-backed stand-in for the tests.
class MemoryStorage {
  private m = new Map<string, string>()
  getItem(k: string): string | null {
    return this.m.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v))
  }
  removeItem(k: string): void {
    this.m.delete(k)
  }
  clear(): void {
    this.m.clear()
  }
}
let store: MemoryStorage
beforeEach(() => {
  store = new MemoryStorage()
  vi.stubGlobal('localStorage', store)
})
afterEach(() => {
  document.documentElement.removeAttribute('data-theme')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('theme', () => {
  it('offers system, light and dark, system first', () => {
    expect(THEMES.map((t) => t.id)).toEqual(['system', 'light', 'dark'])
  })

  it('sets data-theme on the root element', () => {
    applyTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    applyTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    // System: no attribute, so prefers-color-scheme decides.
    applyTheme('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('remembers the choice; anything else reads as system', () => {
    expect(loadTheme()).toBe('system')
    saveTheme('dark')
    expect(loadTheme()).toBe('dark')
    store.setItem('fastag.theme', 'neon')
    expect(loadTheme()).toBe('system')
  })

  it('survives storage that throws', () => {
    vi.spyOn(store, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(store, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(loadTheme()).toBe('system')
    expect(() => saveTheme('light')).not.toThrow()
  })
})
