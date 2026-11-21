// The issue draft the share step opens (skill gui-feedback 5): the
// repository's issue form (.github/ISSUE_TEMPLATE/feedback.yml) with its text
// fields title, report-id and kind prefilled. Opening it sends the query to
// GitHub, so it carries nothing else; dropdowns cannot be prefilled, and the
// whole URL stays under 2 KB. The opener is scoped to this endpoint
// (src-tauri/capabilities/feedback.json).

import type { FeedbackKind } from './types'

export const ISSUE_NEW = 'https://github.com/okohlbacher/FASTag/issues/new'
export const ISSUE_TEMPLATE = 'feedback.yml'
export const MAX_URL = 2048
const KINDS: readonly FeedbackKind[] = ['bug', 'ui', 'idea', 'question']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/// The issue-form URL, or null for an id or kind that is not one.
export function issueUrl(d: { title: string; reportId: string; kind: FeedbackKind }): string | null {
  if (!UUID.test(d.reportId) || !KINDS.includes(d.kind)) return null
  const q = (title: string): string =>
    `${ISSUE_NEW}?template=${ISSUE_TEMPLATE}&title=${encodeURIComponent(title)}&report-id=${d.reportId}&kind=${d.kind}`
  // The title is cut (by characters) until the URL fits.
  let title = [...`[${d.kind}] ${d.title.replace(/[\r\n\t]+/g, ' ').trim()}`].slice(0, 120)
  while (title.length > 0 && q(title.join('')).length > MAX_URL) title = title.slice(0, -1)
  return q(title.join(''))
}
