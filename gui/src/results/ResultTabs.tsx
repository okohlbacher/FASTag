// The result tabs (moved from App.tsx, P1 PR c): Tags, Species and Digest,
// the failure banner over them, and the empty and withheld states of the
// Tags pane.

import type { Dispatch, JSX, KeyboardEvent, ReactNode, SetStateAction } from 'react'
import type { SpeciesReport } from '../types'
import ResultsTable from '../ResultsTable'
import FailureBanner from './FailureBanner'
import SpeciesPanel from '../SpeciesPanel'
import DigestPanel from '../DigestPanel'
import { baseName } from '../digestReport'
import { IconClose, IconError, IconWarning } from '../icons'
import { HelpButton, HelpLink } from '../help/HelpLink'
import { focusLater } from '../app/focus'
import type { Tab } from '../app/viewStore'
import type { Evidence, Failure, Reports, Results } from '../run/useRun'
import type { speciesReach } from '../paramLayout'

const TAB_LABEL: Record<Tab, string> = { results: 'Tags', species: 'Species', digest: 'Digest' }
// The tabs, in order. Digest is always there: its empty state is a way to
// open a report.
const TABS: Tab[] = ['results', 'species', 'digest']

export interface ResultTabsProps {
  tab: Tab
  setTab(t: Tab): void
  species: SpeciesReport | null
  // The run the Species tab describes, as it was submitted.
  speciesRun: { input: string; enabled: boolean } | null
  // The form's species switch, and why its run would find no species.
  speciesOn: boolean
  tooShort: ReturnType<typeof speciesReach>
  evidence: Evidence
  reports: Reports
  batchMiss: { input: string; done?: string } | null
  results: Results | null
  setResults: Dispatch<SetStateAction<Results | null>>
  running: boolean
  busy: boolean
  failure: Failure | null
  setFailure(f: Failure | null): void
  copied: 'yes' | 'no' | null
  setCopied(c: 'yes' | 'no' | null): void
  openResults(): void
  openReport(): void
  openLog(job: string | null | undefined): void
  // Below the panel: the log drawer.
  children?: ReactNode
  // false: the failure banner is shown elsewhere (the Batch view, P2a).
  showFailure?: boolean
}

export default function ResultTabs(p: ResultTabsProps): JSX.Element {
  const { tab, setTab, species, speciesRun, reports, batchMiss, results, running, busy, failure, copied } = p
  // Arrow keys, Home and End move between the tabs (WAI-ARIA tabs pattern).
  function onTabKey(e: KeyboardEvent<HTMLDivElement>): void {
    const i = TABS.indexOf(tab)
    const to =
      e.key === 'ArrowRight' ? (i + 1) % TABS.length
      : e.key === 'ArrowLeft' ? (i - 1 + TABS.length) % TABS.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? TABS.length - 1
      : -1
    if (to < 0) return
    e.preventDefault()
    setTab(TABS[to])
    document.getElementById(`tab-${TABS[to]}`)?.focus()
  }

  return (
    <section className="results" aria-label="Results">
      <div className="tabs">
        <div role="tablist" aria-label="Results" onKeyDown={onTabKey}>
          {TABS.map((t) => (
            <button
              key={t}
              id={`tab-${t}`}
              role="tab"
              aria-selected={tab === t}
              aria-controls="tabpanel"
              tabIndex={tab === t ? 0 : -1}
              className={tab === t ? 'on' : ''}
              onClick={() => setTab(t)}
            >
              {TAB_LABEL[t]}
              {t === 'species' && species && species.taxa.length > 0 && <span className="count">{species.taxa.length}</span>}
              {t === 'digest' && reports.list.length > 0 && <span className="count">{reports.list.length}</span>}
            </button>
          ))}
        </div>
        {/* Always reachable, also once a result fills the pane. */}
        {/* Not while a run is writing the files they would open. */}
        <button className="secondary" onClick={p.openResults} disabled={busy} title="Open an existing tags TSV">
          Open tags…
        </button>
        <button className="secondary" onClick={p.openReport} disabled={busy} title="Open a digest, label or mass-gap report">
          Open report…
        </button>
      </div>

      {failure && p.showFailure !== false && (
        <FailureBanner
          failure={failure}
          copied={copied}
          setFailure={p.setFailure}
          setCopied={p.setCopied}
          openLog={p.openLog}
          focusAfter={() => document.getElementById(`tab-${tab}`)}
        />
      )}

      <div className="tabpanel" id="tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'digest' ? (
          <div className="tablewrap">
            <DigestPanel reports={reports.list} errors={reports.errors} onOpen={p.openReport} />
          </div>
        ) : tab === 'species' ? (
          <div className="tablewrap">
            {speciesRun?.enabled && (
              <p className="src" title={species?.path}>
                Species of <span className="mono">{speciesRun.input}</span>
              </p>
            )}
            <SpeciesPanel
              report={species}
              enabled={speciesRun ? speciesRun.enabled : p.speciesOn}
              formOn={!!speciesRun && !speciesRun.enabled && p.speciesOn}
              runInput={speciesRun?.input}
              // A run that started passed the reach check, so it was never too short.
              tooShort={speciesRun ? null : p.tooShort}
              contributed={p.evidence.contributed}
              totalMs2={p.evidence.ms2}
            />
          </div>
        ) : batchMiss ? (
          <div className="tablewrap">
            <div className="empty-state">
              <h2>No tags for {baseName(batchMiss.input)}</h2>
              <p>
                {batchMiss.done
                  ? <>Select {baseName(batchMiss.done)} in the batch to see its results.</>
                  : 'No job of this batch finished.'}
              </p>
              <p>
                <HelpLink to="faq-no-tags">Why a run writes no tags</HelpLink>
              </p>
            </div>
          </div>
        ) : results?.stale && (running || results.incomplete) ? (
          <div className="tablewrap">
            {/* Not the old rows while a run rewrites the file in place, nor
                after it stopped part-way: the file may be truncated. */}
            <div className="banner warn" role="status">
              <IconWarning />
              {running ? (
                <span>
                  <strong>Outdated.</strong> This run is rewriting <code>{results.path}</code>; its tags appear
                  here when it finishes.
                </span>
              ) : results.removed ? (
                <span>
                  <strong>Removed.</strong> The run stopped before it finished, so its partial outputs were
                  {results.removed === 'removed' ? ' removed' : ' renamed to .incomplete'}: <code>{results.path}</code>{' '}
                  {results.removed === 'removed' ? 'no longer exists' : 'is now named with .incomplete'}. Run again for
                  a complete table. <HelpButton to="faq-incomplete" what="partial outputs" />
                </span>
              ) : (
                <span>
                  {results.recorded ? (
                    <>
                      <strong>Incomplete.</strong> The run that wrote <code>{results.path}</code> was{' '}
                      {results.recorded.status} ({new Date(results.recorded.end).toLocaleString()}), so the file
                      may hold only part of a table.{' '}
                    </>
                  ) : (
                    <>
                      <strong>Incomplete.</strong> The run stopped while rewriting <code>{results.path}</code>, so
                      the file may hold only part of a table or none.{' '}
                    </>
                  )}
                  <button
                    type="button"
                    className="link"
                    onClick={() => p.setResults((x) => (x ? { ...x, stale: false, incomplete: false, gen: x.gen + 1 } : x))}
                  >
                    Open it anyway
                  </button>{' '}
                  <HelpButton to="faq-incomplete" what="an incomplete tags file" />
                </span>
              )}
            </div>
          </div>
        ) : results ? (
          <ResultsTable
            key={`${results.path}#${results.gen}`}
            path={results.path}
            source={results.input ? `from the run of ${results.input}` : 'opened from disk'}
          />
        ) : (
          <div className="tablewrap">
            <div className="empty-state">
              <h2>No results yet</h2>
              <p>
                Run FASTag on the chosen file, or open a tags TSV or a digest, label or mass-gap report from an
                earlier run.
              </p>
              <p>
                New to FASTag? <HelpLink to="start">Read Getting started</HelpLink> (F1 opens Help at any time).
              </p>
              <div className="row-actions">
                {/* Not while a run is writing the files they would open. */}
                <button className="secondary big" onClick={p.openResults} disabled={busy}>
                  Open a tags TSV…
                </button>
                <button className="secondary big" onClick={p.openReport} disabled={busy}>
                  Open a digest, label or mass-gap report…
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {p.children}
    </section>
  )
}
