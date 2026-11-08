// The stub CLI (testing/stub-fastag, GUI-DESIGN 9 "CLI for app-level
// tests") writes the P4c tables with the real CLI's headers, so a cargo or
// tauri-driver run against it opens them in their viewers: each output
// parses with results/tables.ts as the kind its option names.

// @ts-ignore -- node built-ins; the app's tsconfig has no node types
import { execFileSync } from 'node:child_process'
// @ts-ignore
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
// @ts-ignore
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { parseTable, sniffTable } from './tables'

declare const process: { platform: string; env: Record<string, string | undefined> }
const env = process.env

describe.skipIf(process.platform === 'win32')('stub CLI: the P4c tables', () => {
  it('writes recon, delta, mzTab and glyco tables the viewers read', () => {
    const d: string = mkdtempSync(`${tmpdir()}/fastag-stub-`)
    try {
      execFileSync('sh', [
        'testing/stub-fastag/FASTag',
        '-in', `${d}/a.mzML`,
        '-out', `${d}/a.tags.tsv`,
        '-glyco',
        '-recon_out', `${d}/a.recon.tsv`,
        '-delta_out', `${d}/a.delta.tsv`,
        '-recon_id_out', `${d}/a.recon.mzTab`
      ], { stdio: 'ignore' })
      const kinds: Record<string, string> = {
        'a.recon.tsv': 'recon',
        'a.delta.tsv': 'delta',
        'a.recon.mzTab': 'reconIds',
        'a.tags.glyco.tsv': 'glyco'
      }
      for (const [f, kind] of Object.entries(kinds)) {
        const text: string = readFileSync(`${d}/${f}`, 'utf8')
        expect(sniffTable(text), f).toBe(kind)
        const t = parseTable(text, `${d}/${f}`)
        expect(t.rows, f).toBe(1)
        expect(t.warnings, f).toEqual([])
      }
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  })

  // The run that places nothing (the ext2 case): header-only recon and
  // delta tables, and an mzTab of MTD lines only, as OpenMS writes it.
  it('STUB_NO_PLACEMENTS writes empty tables the viewers still read', () => {
    const d: string = mkdtempSync(`${tmpdir()}/fastag-stub-`)
    try {
      execFileSync('sh', [
        'testing/stub-fastag/FASTag',
        '-in', `${d}/a.mzML`,
        '-out', `${d}/a.tags.tsv`,
        '-recon_out', `${d}/a.recon.tsv`,
        '-delta_out', `${d}/a.delta.tsv`,
        '-recon_id_out', `${d}/a.recon.mzTab`
      ], { stdio: 'ignore', env: { ...env, STUB_NO_PLACEMENTS: '1' } })
      const mz: string = readFileSync(`${d}/a.recon.mzTab`, 'utf8')
      expect(mz).toMatch(/^MTD\t/)
      expect(mz).not.toMatch(/^PS[HM]\t/m)
      const kinds: Record<string, string> = { 'a.recon.tsv': 'recon', 'a.delta.tsv': 'delta', 'a.recon.mzTab': 'reconIds' }
      for (const [f, kind] of Object.entries(kinds)) {
        const text: string = readFileSync(`${d}/${f}`, 'utf8')
        expect(sniffTable(text), f).toBe(kind)
        expect(parseTable(text, `${d}/${f}`).rows, f).toBe(0)
      }
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  })
})
