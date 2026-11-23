import type { JSX } from 'react'

// The few status glyphs the app draws. Decorative: the text beside each one
// says the same, so every icon is aria-hidden and coloured by currentColor.

export function IconError({ size = 12 }: { size?: number }): JSX.Element {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6 3.2v3.3M6 8.4v.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/// A disclosure chevron, pointing right; .chev.open turns it down.
export function IconChevron({ size = 12 }: { size?: number }): JSX.Element {
  return (
    <svg className="icon chev-icon" width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M4.2 2.2L8 6l-3.8 3.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconCheck(): JSX.Element {
  return (
    <svg className="icon" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.5 6.2l2.2 2.2 4.8-4.9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconWarning(): JSX.Element {
  return (
    <svg className="icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.8l6.5 11.4H1.5z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M8 6v3.4M8 11.3v.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function IconLock(): JSX.Element {
  return (
    <svg className="icon" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <rect x="3" y="6" width="8" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5 6V4.5a2 2 0 0 1 4 0V6" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

export function IconFile(): JSX.Element {
  return (
    <svg className="icon" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M4 2h7l3 3v11H4z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

export function IconClose(): JSX.Element {
  return (
    <svg className="icon" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function IconFlag(): JSX.Element {
  return (
    <svg className="icon" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M2 9V1.5h5.5L6.5 3.5 7.5 5.5H2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

/// The status of a batch job: done, failed, running, cancelled or not run.
export function JobIcon({ status }: { status: JobStatus }): JSX.Element {
  return (
    <svg className="icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      {status === 'done' ? (
        <>
          <circle cx="8" cy="8" r="7" className="fill-soft" />
          <path d="M4.8 8.2l2.1 2.1 4.3-4.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : status === 'failed' ? (
        <>
          <circle cx="8" cy="8" r="7" className="fill-soft" />
          <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </>
      ) : status === 'cancelled' ? (
        <>
          <circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M5 8h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </>
      ) : status === 'running' ? (
        <>
          <circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M8 4.8V8l2.2 1.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </>
      ) : (
        <circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 2" />
      )}
    </svg>
  )
}

/// The icon of a workflow tile in step 1 of Setup (16 px, decorative).
const TASK_PATHS: Record<string, JSX.Element> = {
  // A tag: a label with a hole.
  'export-tags': <><path d="M2 3h6l5.5 5-5.5 5H2z" /><circle cx="5" cy="8" r="1.2" /></>,
  // A gauge.
  'run-qc': <><path d="M2.5 11.5a5.5 5.5 0 1 1 11 0" /><path d="M8 11.5l2.6-3.6" /></>,
  // A delta.
  'mass-shift': <path d="M8 2.5l5.5 10.5h-11z" />,
  // A leaf.
  species: <><path d="M3 13c0-6 4-10 10-10 0 6-4 10-10 10z" /><path d="M3 13l6-6" /></>,
  // A funnel.
  'db-reduction': <path d="M2 3h12l-4.5 5.5V13l-3 1.5V8.5z" />,
  // Ranked bars.
  triage: <><path d="M3 13V9M6.5 13V6M10 13V8M13.5 13V3" /></>,
  // A magnifier.
  characterize: <><circle cx="7" cy="7" r="4.2" /><path d="M10.2 10.2L14 14" /></>,
  // No workflow: a slider.
  defaults: <><path d="M2 5h12M2 11h12" /><circle cx="6" cy="5" r="1.6" /><circle cx="10" cy="11" r="1.6" /></>
}
export function TaskIcon({ id }: { id: string }): JSX.Element {
  return (
    <svg className="icon task-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {TASK_PATHS[id] ?? TASK_PATHS.defaults}
    </svg>
  )
}
