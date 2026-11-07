// Text the run UI shows (moved from App.tsx, P1 PR c).

import type { Cleanup, RunResult } from '../types'
import type { ParamValue } from '../ParamField'

// m:ss, or h:mm:ss for a long run.
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const mm = Math.floor(s / 60)
  const ss = String(s % 60).padStart(2, '0')
  return mm >= 60 ? `${Math.floor(mm / 60)}:${String(mm % 60).padStart(2, '0')}:${ss}` : `${mm}:${ss}`
}
export const clock = (t: number): string => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

// A command line a POSIX shell reads back as the same argv.
export function shellLine(argv: string[]): string {
  return argv.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(' ')
}

// A changed parameter as the command line spells it: a switch is its name.
export function cliText(name: string, v: ParamValue): string {
  if (typeof v === 'boolean') return `-${name}`
  const s = Array.isArray(v) ? v.filter((x) => x.trim() !== '').join(' ') : v
  return s === '' ? `-${name} ''` : `-${name} ${s}`
}

// What the backend did with the outputs of a run that did not finish, as log
// lines.
export function cleanupLines(c: Cleanup | undefined): string[] {
  if (!c) return []
  return [
    ...c.removed.map((p) => `Removed the partial output ${p}`),
    ...c.renamed.map((p) => `Could not remove a partial output; renamed it to ${p}`),
    ...c.failed.map((p) => `Could not remove the partial output ${p}: it may be incomplete`)
  ]
}

// Two values of one parameter are the same setting.
export const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

// A run with no exit code was killed: by Cancel, or by the OS.
export function failText(r: RunResult): string {
  return r.message ?? (r.code == null ? 'stopped before it finished' : `exit code ${r.code}`)
}
