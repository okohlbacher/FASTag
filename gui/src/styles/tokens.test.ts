// The D9 token contract (GUI-DESIGN 4): the semantic tokens with the table's
// values in both themes, the documented contrast floors, the system font
// stack with one bundled mono, and no colour outside the token file.
import { describe, expect, it } from 'vitest'
// @ts-ignore -- node built-in; the app's tsconfig has no node types
import { readFileSync } from 'node:fs'

// Read from disk: vitest serves a .css import (?raw included) as empty.
const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8')
const tokens = read('./tokens.css')
const index = read('../index.css')

/// The custom properties declared in the first block that @p selector opens.
function block(css: string, selector: string): Record<string, string> {
  const at = css.indexOf(`${selector} {`)
  if (at < 0) throw new Error(`no block ${selector}`)
  const open = css.indexOf('{', at)
  let depth = 0
  let end = open
  for (; end < css.length; end++) {
    if (css[end] === '{') depth++
    else if (css[end] === '}' && --depth === 0) break
  }
  const body = css.slice(open + 1, end).replace(/\/\*[\s\S]*?\*\//g, '')
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}

const light = block(tokens, ':root')
const darkSystem = block(tokens, ':root:not([data-theme="light"])')
const darkChosen = block(tokens, ':root[data-theme="dark"]')
// A theme's value of @p name, following var() to the light block.
function value(theme: Record<string, string>, name: string): string {
  let v = theme[name] ?? light[name]
  for (let i = 0; i < 5 && v?.startsWith('var('); i++) {
    const ref = v.slice(4, -1).trim()
    v = theme[ref] ?? light[ref]
  }
  return v
}

function lum(hex: string): number {
  const h = hex.replace('#', '')
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const f = (x: number): number => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
  const [r, g, b] = c.map(f)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string): number => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

describe('D9 tokens', () => {
  it('has every semantic token of the table, with its light value', () => {
    const want: Record<string, string> = {
      '--brand-tag': '#2f6fe0',
      '--brand-gap': '#b56d00',
      '--brand-peaks': '#5f6878',
      '--background': '#ffffff',
      '--card': '#ffffff',
      '--panel': '#f3f4f7',
      '--border': '#d6d9e0',
      '--foreground': '#1a1d23',
      '--muted-foreground': '#666d7a',
      '--primary': '#2f6fe0',
      '--ring': '#2f6fe0',
      '--primary-foreground': '#ffffff',
      '--ok': '#15803d',
      '--destructive': '#d92d20',
      '--flag': '#b56d00',
      '--radius': '0.5rem'
    }
    for (const [k, v] of Object.entries(want)) expect(value(light, k), k).toBe(v)
  })

  it('dark, by the system and when chosen, has the same values', () => {
    expect(darkSystem).toEqual(darkChosen)
    const want: Record<string, string> = {
      '--brand-tag': '#5c9dff',
      '--brand-gap': '#f7b23b',
      '--brand-peaks': '#939cab',
      '--background': '#16181d',
      '--panel': '#1d2026',
      '--border': 'rgba(255, 255, 255, 0.10)',
      '--foreground': '#e6e8ec',
      '--primary': '#5c9dff',
      '--ring': '#5c9dff',
      '--primary-foreground': '#0b1220',
      '--ok': '#46c977',
      '--destructive': '#f2666a',
      '--flag': '#f7b23b'
    }
    for (const [k, v] of Object.entries(want)) expect(value(darkChosen, k), k).toBe(v)
    // Flat dark cards: the card is the page.
    expect(value(darkChosen, '--card')).toBe(value(darkChosen, '--background'))
    expect(tokens).toMatch(/:root\[data-theme="dark"\] \{[\s\S]*?color-scheme: dark;/)
  })

  it('keeps the contrast floors in both themes', () => {
    for (const [name, t] of [
      ['light', light],
      ['dark', darkChosen]
    ] as const) {
      const bg = value(t, '--background')
      const panel = value(t, '--panel')
      const fg = value(t, '--foreground')
      const muted = value(t, '--muted-foreground')
      const dark = name === 'dark'
      expect(contrast(fg, bg), `${name} body`).toBeGreaterThanOrEqual(dark ? 14 : 4.5)
      expect(contrast(fg, panel), `${name} body on panel`).toBeGreaterThanOrEqual(dark ? 12 : 4.5)
      expect(contrast(muted, bg), `${name} muted`).toBeGreaterThanOrEqual(dark ? 7.5 : 4.5)
      expect(contrast(muted, panel), `${name} muted on panel`).toBeGreaterThanOrEqual(dark ? 7.5 : 4.5)
      for (const surface of [bg, panel]) {
        expect(contrast(value(t, '--primary-text'), surface), `${name} accent text`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(value(t, '--destructive-text'), surface), `${name} error text`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(value(t, '--flag-text'), surface), `${name} flag text`).toBeGreaterThanOrEqual(4.5)
      }
      expect(contrast(value(t, '--destructive-text'), value(t, '--destructive-bg'))).toBeGreaterThanOrEqual(4.5)
      expect(contrast(value(t, '--flag-text'), value(t, '--flag-bg'))).toBeGreaterThanOrEqual(4.5)
      expect(contrast(value(t, '--ok'), value(t, '--ok-bg'))).toBeGreaterThanOrEqual(4.5)
      expect(contrast(value(t, '--primary-foreground'), value(t, '--primary')), `${name} on accent`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('forced colours map the accent to Highlight', () => {
    expect(tokens).toMatch(/@media \(forced-colors: active\) \{\s*:root \{[^}]*--primary: Highlight;[^}]*--ring: Highlight;/)
  })

  it('uses the system UI stack and bundles only IBM Plex Mono', () => {
    expect(light['--font-sans']).toBe('-apple-system, "Segoe UI", system-ui, "Noto Sans", sans-serif')
    expect(light['--font-seq']).toMatch(/^"IBM Plex Mono"/)
    expect(index).not.toMatch(/IBM Plex Sans/)
    const faces = [...index.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1])
    expect(faces.length).toBeGreaterThan(0)
    for (const f of faces) {
      expect(f).toMatch(/font-family: 'IBM Plex Mono'/)
      expect(f).toMatch(/font-weight: (400|500);/)
      expect(f).toMatch(/plex-mono-latin-(400|500)-normal\.woff2/)
    }
  })

  it('declares no colour outside the token file', () => {
    // index.css takes every colour from a token (the brand's SVG marks and
    // the plot tokens included).
    const css = index.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) ?? []).toEqual([])
    expect(index).toMatch(/@import '\.\/styles\/tokens\.css';/)
  })
})
