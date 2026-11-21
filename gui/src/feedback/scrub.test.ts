// The scrubber's corpus (skill gui-feedback 4): each line holds something
// that must not reach a report, and what must stay.
import { describe, expect, it } from 'vitest'
import { scrub } from './scrub'
import { clip, clearRing, recent, record, RING_SIZE } from './consoleRing'

const hints = { home: '/Users/alice', user: 'alice' }

const CORPUS: [string, string, { home?: string; user?: string }?][] = [
  ['open /Users/alice/data/run01.mzML failed', 'open <home>/data/run01.mzML failed'],
  ['C:\\Users\\Bob\\Documents\\x.mzML', 'C:\\Users\\<user>\\Documents\\x.mzML', {}],
  ['c:\\users\\bob\\x', '<home>\\x', { home: 'C:\\Users\\Bob', user: 'Bob' }],
  ['/home/carol/run.mgf', '/home/<user>/run.mgf', {}],
  ['/Users/dave/run.mgf', '/Users/<user>/run.mgf', {}],
  ['mail alice.smith+lab@uni-tuebingen.de now', 'mail <email> now', {}],
  ['https://user:hunter2@example.org/x', 'https://<credentials>@example.org/x', {}],
  ['https://token@example.org/x', 'https://<credentials>@example.org/x', {}],
  ['GET https://api.example.org/v1?id=3&access_token=abc123&x=1', 'GET https://api.example.org/v1?id=3&access_token=<redacted>&x=1', {}],
  ['https://s3.example.org/f?X-Amz-Signature=deadbeef&sig=zz', 'https://s3.example.org/f?X-Amz-Signature=<redacted>&sig=<redacted>', {}],
  ['token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 leaked', 'token <token> leaked', {}],
  ['github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz', '<token>', {}],
  ['Authorization: Bearer eyJhbGciOi.JIUzI1NiIsInR5cCI6.IkpXVCJ9xyz', 'Authorization: Bearer <token>', {}],
  ['jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.c2lnbmF0dXJlMTIz end', 'jwt <token> end', {}],
  ['key AKIAIOSFODNN7EXAMPLE', 'key <token>', {}],
  ['\\\\fileserver\\proteomics\\2026\\run.raw', '\\\\<host>\\<share>\\2026\\run.raw', {}],
  ['open //nas01/lab/run.raw', 'open //<host>/<share>/run.raw', {}],
  ['C:\\Users\\<user>\\OneDrive - Universität Tübingen\\runs', 'C:\\Users\\<user>\\OneDrive - <org>\\runs', {}],
  ['alice ran it; malice stays', '<user> ran it; malice stays'],
  // What stays: the message, file names relative to the home, numbers, URLs without secrets.
  ['TypeError: x is undefined at SpeciesPanel (SpeciesPanel.tsx:12:5)', 'TypeError: x is undefined at SpeciesPanel (SpeciesPanel.tsx:12:5)', {}],
  ['https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?id=9606', 'https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?id=9606', {}]
]

describe('scrub: corpus', () => {
  for (const [input, want, h] of CORPUS) {
    it(JSON.stringify(input), () => expect(scrub(input, h ?? hints)).toBe(want))
  }
  it('is idempotent', () => {
    for (const [input, , h] of CORPUS) expect(scrub(scrub(input, h ?? hints), h ?? hints)).toBe(scrub(input, h ?? hints))
  })
  it('never lets the home folder, the user name or an address through', () => {
    const all = CORPUS.map(([i, , h]) => scrub(i, h ?? hints)).join('\n')
    for (const bad of ['alice@', 'hunter2', 'ghp_', 'abc123', 'fileserver', 'Bob\\', 'carol', 'AKIA', 'Universität']) expect(all).not.toContain(bad)
  })
})

describe('console ring', () => {
  it('keeps the last 50 entries, oldest first', () => {
    clearRing()
    for (let i = 0; i < 70; i++) record(i % 2 ? 'warn' : 'error', [`message ${i}`], i)
    const r = recent()
    expect(r).toHaveLength(RING_SIZE)
    expect(r[0].text).toBe('message 20')
    expect(r[49]).toEqual({ level: 'warn', text: 'message 69', t: 69 })
    clearRing()
  })
  it('cuts an entry to 2,000 characters keeping its first stack frames', () => {
    const stack = ['Error: boom', ...Array.from({ length: 200 }, (_, i) => `    at frame${i} (file.ts:${i}:1)`)].join('\n')
    const c = clip(stack)
    expect([...c].length).toBeLessThanOrEqual(2000)
    expect(c.startsWith('Error: boom\n    at frame0 (file.ts:0:1)\n    at frame1')).toBe(true)
    expect(c.endsWith('\n…')).toBe(true)
    expect(clip('short')).toBe('short')
  })
  it('records an Error with its stack', () => {
    clearRing()
    const e = new Error('kaput')
    record('error', ['failed:', e])
    expect(recent()[0].text).toContain('kaput')
    clearRing()
  })
})
