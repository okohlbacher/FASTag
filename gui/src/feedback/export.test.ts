// The report and its public export against their schemas: the local report
// (schema/report.schema.json) a Save builds, and the public export
// (schema/feedback-public.schema.json, the intake's fastag-feedback-public/1;
// it must stay identical to doc/feedback/feedback-public.schema.json).
// fixtures/export.golden.json is what src-tauri/src/feedback.rs writes for
// fixtures/draft.json (cargo test export_zip_and_golden_json); the test
// bridges' port (publicExport.ts) must write the same.
import { describe, expect, it } from 'vitest'
import publicSchema from './schema/feedback-public.schema.json'
import localSchema from './schema/report.schema.json'
import draftFixture from './fixtures/draft.json'
import golden from './fixtures/export.golden.json'
import { validate } from './schemaCheck'
import { publicExport } from './publicExport'
import { frame, unframe } from './frame'
import { issueUrl, MAX_URL } from './issueUrl'
import type { FeedbackDraft, FeedbackReport } from './types'

const report = (over: Partial<FeedbackReport> = {}): FeedbackReport => ({
  ...(draftFixture as unknown as FeedbackDraft),
  schema: 'fastag-feedback/1',
  id: '0f8e2a4c-1b3d-4e5f-9a7b-6c5d4e3f2a1b',
  created_utc: '2026-11-18T09:46:40Z',
  tz_offset_min: 60,
  status: 'saved',
  issue_url: null,
  ...over
})
const all = { screenshot: true, diagnostics: true, log: true }

describe('schemas', () => {
  it('the golden export validates against the public schema', () => {
    expect(validate(publicSchema, golden)).toEqual([])
  })
  it('the test bridges export what the backend exports', () => {
    expect(publicExport(report(), all, true)).toEqual(golden)
  })
  it('every combination of what is included validates', () => {
    for (const screenshot of [false, true])
      for (const diagnostics of [false, true])
        for (const log of [false, true]) {
          const e = publicExport(report(), { screenshot, diagnostics, log }, true)
          expect(validate(publicSchema, e), JSON.stringify({ screenshot, diagnostics, log })).toEqual([])
          expect('log' in e).toBe(log)
          expect('capture' in e).toBe(screenshot)
          expect('platform' in e).toBe(diagnostics)
        }
  })
  it('a report of the fixture validates against the local schema', () => {
    expect(validate(localSchema, report())).toEqual([])
  })
  it('the validator rejects what the schemas forbid', () => {
    expect(validate(publicSchema, { ...golden, extra: 1 }).join()).toMatch(/extra is not allowed/)
    expect(validate(publicSchema, { ...golden, id: 'x' }).join()).toMatch(/does not match/)
    expect(validate(publicSchema, { ...golden, platform: { arch: 'arm64' } }).join()).toMatch(/is not one of/)
    expect(validate(publicSchema, { ...golden, params: { 'a/b': 1 } }).join()).toMatch(/name/)
    expect(validate(publicSchema, { ...golden, params: { a: [1] } }).join()).toMatch(/anyOf/)
    expect(validate(localSchema, { ...report(), title: '' }).join()).toMatch(/shorter/)
    expect(validate(localSchema, { ...report(), capture: { ...report().capture, width: 4000 } }).join()).toMatch(/above/)
    expect(validate({ type: 'object', oneOf: [] }, {}).join()).toMatch(/not supported/)
  })
  it('an export carries no description, paths or file names', () => {
    const text = JSON.stringify(publicExport(report(), all, true))
    for (const bad of ['description', 'steps', 'expected', 'actual', 'Refer', '/Users/']) expect(text).not.toContain(bad)
  })
  it('a version that is not semver and an unknown arch are dropped and named in truncated', () => {
    const r = report({ app: { ...report().app, version: 'dev build' }, platform: { ...report().platform, arch: 'riscv64' } })
    const e = publicExport(r, all, true)
    expect(e.truncated).toEqual(['app', 'platform'])
    expect(validate(publicSchema, e)).toEqual([])
  })
})

describe('issue draft URL', () => {
  const id = '0f8e2a4c-1b3d-4e5f-9a7b-6c5d4e3f2a1b'
  it('names the form and only title, report id and kind', () => {
    const u = new URL(issueUrl({ title: 'Empty Species tab', reportId: id, kind: 'bug' })!)
    expect(u.origin + u.pathname).toBe('https://github.com/okohlbacher/FASTag/issues/new')
    expect([...u.searchParams.keys()]).toEqual(['template', 'title', 'report-id', 'kind'])
    expect(u.searchParams.get('template')).toBe('feedback.yml')
    expect(u.searchParams.get('title')).toBe('[bug] Empty Species tab')
    expect(u.searchParams.get('report-id')).toBe(id)
    expect(u.searchParams.get('kind')).toBe('bug')
  })
  it('stays under 2 KB with any title', () => {
    for (const t of ['ä'.repeat(120), '%'.repeat(120), '😀'.repeat(120), 'x\ny'.repeat(60)]) {
      const u = issueUrl({ title: t, reportId: id, kind: 'idea' })!
      expect(u.length).toBeLessThanOrEqual(MAX_URL)
      expect(new URL(u).searchParams.get('title')).not.toMatch(/\n/)
    }
  })
  it('refuses an id or kind that is not one', () => {
    expect(issueUrl({ title: 't', reportId: '../x', kind: 'bug' })).toBeNull()
    expect(issueUrl({ title: 't', reportId: id, kind: 'evil' as 'bug' })).toBeNull()
  })
})

describe('binary frames', () => {
  it('round-trip JSON and PNG bytes', () => {
    const png = new Uint8Array([137, 80, 78, 71, 0, 255])
    const f = frame({ a: 'ü' }, png)
    const back = unframe<{ a: string }>(f.buffer as ArrayBuffer)
    expect(back.json).toEqual({ a: 'ü' })
    expect(Array.from(back.png!)).toEqual(Array.from(png))
    expect(unframe(frame({ b: 1 }, null)).png).toBeNull()
    expect(() => unframe(new Uint8Array([9, 0, 0, 0, 1]))).toThrow()
  })
})
