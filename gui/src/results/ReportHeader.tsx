// The one header of every report tab (round 4, 19): a title in sentence
// case, a help link, and the file(s) it was read from at the right, so
// reports of different runs cannot be mistaken for one; an optional line
// under it says what the report is of (the run, the rank).

import type { JSX, ReactNode } from 'react'
import { baseName } from '../digestReport'
import { HelpLink } from '../help/HelpLink'

export interface ReportHeaderProps {
  title: ReactNode
  id?: string
  /// The files the tab shows, by full path (their tooltip).
  paths: string[]
  help?: { to: string; label: string }
  /// The help as a (?) button instead of a link (DigestPanel's sections).
  helpButton?: ReactNode
  /// A muted line under the title.
  sub?: ReactNode
}

export default function ReportHeader({ title, id, paths, help, helpButton, sub }: ReportHeaderProps): JSX.Element {
  return (
    <div className="report-head">
      <div className="card-head">
        <h2 id={id}>{title}</h2>
        {help && <HelpLink to={help.to}>{help.label}</HelpLink>}
        {helpButton}
        <span className="report-files">
          {paths.map((p) => (
            <code className="src" key={p} title={p}>
              {baseName(p)}
            </code>
          ))}
        </span>
      </div>
      {sub && <p className="report-sub">{sub}</p>}
    </div>
  )
}
