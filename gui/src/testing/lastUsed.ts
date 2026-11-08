// Test helpers for the last-used offer (D6, GUI-DESIGN P0a). The last
// session's parameters are no longer applied on start: a test that starts
// from them clicks "Apply last-used (n)" as a user would, and then checks
// that the form really holds them, so it cannot pass vacuously on defaults.

import { act, fireEvent, screen } from '@testing-library/react'
import { expect } from 'vitest'
import { PARAM_BY_NAME, RENDERED, SECTIONS } from '../paramLayout'
import { showView } from './render'

/// Click the offer chip. @p n is the number of settings it must offer.
export async function applyLastUsed(n: number): Promise<void> {
  // The chip is on the Setup view (P2a shell).
  showView('setup')
  const chip = await screen.findByRole('button', { name: /^Apply last-used \(\d+\)$/ })
  expect(chip.textContent).toBe(`Apply last-used (${n})`)
  await act(async () => {
    fireEvent.click(chip)
  })
  // The offer is used up.
  expect(screen.queryByRole('button', { name: /^Apply last-used/ })).toBeNull()
}

/// What the form holds for parameter @p name: a checkbox's state, a field's
/// text (a list's lines joined by newlines). A field inside a collapsed
/// section is read by opening the section and closing it again, so the
/// test's own disclosure clicks are not disturbed.
export async function formValue(name: string): Promise<string | boolean> {
  const read = (): string | boolean | undefined => {
    const el = document.getElementById(`p-${name}`) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null
    if (!el) return undefined
    return el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el.value
  }
  const now = read()
  if (now !== undefined) return now
  const sec = SECTIONS.find((s) => s.params.includes(name))
  if (!sec) throw new Error(`${name} is in no section of the form`)
  showView('setup')
  const toggle = (): Promise<void> =>
    act(async () => {
      const b = screen
        .getAllByRole('button')
        .find((e) => e.className === 'disclosure' && (e.textContent ?? '').includes(sec.title))
      if (!b) throw new Error(`no disclosure for ${sec.title}`)
      fireEvent.click(b)
    })
  await toggle()
  const v = read()
  await toggle()
  if (v === undefined) throw new Error(`${name} is not in the form`)
  return v
}

/// The number of settings "Apply last-used" offers for @p lastUsed on a fresh
/// form: the rendered ones whose value differs from FASTag's default.
export function offerCount(lastUsed: Record<string, unknown>): number {
  return Object.entries(lastUsed).filter(([name, v]) => {
    const spec = PARAM_BY_NAME.get(name)
    if (!spec || !RENDERED.includes(name)) return false
    const def =
      spec.type === 'string-list'
        ? Array.isArray(spec.default) ? spec.default : []
        : spec.type === 'bool'
          ? spec.default === 'true'
          : String(spec.default ?? '')
    return JSON.stringify(def) !== JSON.stringify(v)
  }).length
}

/// Apply the offer for @p lastUsed and check that the form holds each of its
/// switches and single values (the guard against a vacuous pass).
export async function applyAndCheck(lastUsed: Record<string, unknown>): Promise<void> {
  await applyLastUsed(offerCount(lastUsed))
  for (const [name, v] of Object.entries(lastUsed)) {
    if (typeof v === 'boolean' || typeof v === 'string') expect(await formValue(name), name).toBe(v)
  }
}
