// The one empty state of every view (Results, Spectrum, Batch, History): a
// 16 px title, one short sentence and secondary actions, left-aligned on the
// content column.

import type { JSX, ReactNode } from 'react'

export interface EmptyStateProps {
  title: ReactNode
  /// One short sentence (or a few inline nodes).
  children?: ReactNode
  actions?: ReactNode
  className?: string
}

export default function EmptyState(p: EmptyStateProps): JSX.Element {
  return (
    <div className={`empty-state${p.className ? ` ${p.className}` : ''}`}>
      <h2>{p.title}</h2>
      {p.children && <p>{p.children}</p>}
      {p.actions && <div className="row-actions">{p.actions}</div>}
    </div>
  )
}
