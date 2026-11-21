// The last errors and warnings of the session, for a feedback report: a
// ring buffer of 50, installed at startup (main.tsx), around console.error,
// console.warn, uncaught errors and unhandled rejections. Each entry is cut
// to 2,000 characters keeping its first stack frames; the scrubber runs on
// it when a report is made (snapshot.ts), not here.

import type { LogEntry } from './types'

export const RING_SIZE = 50
export const ENTRY_MAX = 2000

const ring: LogEntry[] = []
let installed = false

function text(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return a.stack && a.stack.includes(a.message) ? a.stack : `${a.name}: ${a.message}\n${a.stack ?? ''}`
      if (typeof a === 'string') return a
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')
}

/// @p s within ENTRY_MAX: the message and as many whole stack lines as fit.
export function clip(s: string, max = ENTRY_MAX): string {
  if ([...s].length <= max) return s
  const lines = s.split('\n')
  let out = ''
  for (const l of lines) {
    const next = out ? `${out}\n${l}` : l
    if ([...next].length > max - 2) break
    out = next
  }
  if (!out) out = [...s].slice(0, max - 2).join('')
  return `${out}\n…`
}

export function record(level: LogEntry['level'], args: unknown[], t = Date.now()): void {
  ring.push({ level, text: clip(text(args)), t })
  if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE)
}

/// A copy of the buffer, oldest first.
export function recent(): LogEntry[] {
  return ring.map((e) => ({ ...e }))
}

export function clearRing(): void {
  ring.length = 0
}

export function installConsoleRing(target: Window & typeof globalThis = window): void {
  if (installed) return
  installed = true
  const c = target.console
  for (const level of ['error', 'warn'] as const) {
    const orig = c[level].bind(c)
    c[level] = (...args: unknown[]) => {
      try {
        record(level, args)
      } catch {
        // The buffer never breaks logging.
      }
      orig(...args)
    }
  }
  target.addEventListener('error', (e) => record('error', [e.error ?? e.message]))
  target.addEventListener('unhandledrejection', (e) => record('error', ['Unhandled rejection:', e.reason]))
}
