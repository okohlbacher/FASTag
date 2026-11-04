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

export function IconCheck({ size = 12 }: { size?: number }): JSX.Element {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.5 6.2l2.2 2.2 4.8-4.9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconWarning({ size = 16 }: { size?: number }): JSX.Element {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
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

/// The status of a batch job: done, failed, running, cancelled or not run.
export function JobIcon({ status }: { status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled' }): JSX.Element {
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
