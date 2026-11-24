// The page header every view shares (Setup, Results, Batch, History): the
// title, at most one line of context under it, the page's own actions at the
// right (secondary controls only), and the local navigation under it (the
// Setup steps, the result tabs). It sits on the content column, so its left
// edge is the content's.

import type { JSX, ReactNode } from 'react'

export interface PageHeaderProps {
  title: ReactNode
  /// The heading's id and tab stop: Setup moves focus to it on a step change.
  titleId?: string
  focusable?: boolean
  /// Extra classes of the heading (mono for a file name).
  titleClass?: string
  /// The heading's tooltip: the full path when the title is a file name.
  titleTip?: string
  /// One line under the title, muted.
  context?: ReactNode
  contextId?: string
  contextClass?: string
  /// Page-level actions at the right: secondary buttons and selects.
  actions?: ReactNode
  /// The local navigation row (steps, tabs).
  nav?: ReactNode
}

export default function PageHeader(p: PageHeaderProps): JSX.Element {
  return (
    <header className="page-header">
      <div className="page-header-row">
        <div className="page-title">
          <h2 id={p.titleId} tabIndex={p.focusable ? -1 : undefined} className={p.titleClass} title={p.titleTip}>
            {p.title}
          </h2>
          {p.context && (
            <p id={p.contextId} className={`page-context${p.contextClass ? ` ${p.contextClass}` : ''}`}>
              {p.context}
            </p>
          )}
        </div>
        {p.actions && <div className="page-actions">{p.actions}</div>}
      </div>
      {p.nav}
    </header>
  )
}
