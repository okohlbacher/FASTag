// The result tabs (moved from App.tsx, P1 PR c): Tags, Species and Digest,
// the failure banner over them, and the empty and withheld states of the
// Tags pane. P2b: the Overview tab first, once a run's results are shown
// (GUI-DESIGN 3 S3), and the running state over the tabs while a single run
// goes (S2).

import { useEffect, useMemo, useState, type Dispatch, type JSX, type KeyboardEvent, type ReactNode, type SetStateAction } from 'react'
import type { SpeciesReport, SpectrumSupport } from '../types'
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
import OverviewPanel from './OverviewPanel'
import { daSpeciesTolerance, type Overview, type TileAction } from './overview'
import ReconView from './ReconView'
import ReportTable from './ReportTable'
import type { WorkflowReports } from './workflowReports'
import GlycoTable from './GlycoTable'
import SpectrumPanel, { type SpectrumSource, type SpectrumTarget } from '../spectrum/SpectrumPanel'

const TAB_LABEL: Record<Tab, string> = {
  overview: 'Overview',
  results: 'Tags',
  spectrum: 'Spectrum',
  qc: 'QC',
  recon: 'Mass shifts',
  species: 'Species',
  shortlist: 'Shortlist',
  triage: 'Triage',
  digest: 'Digest',
  glyco: 'Glyco'
}
// The order of every tab, after those a workflow puts first.
const ORDER: Tab[] = ['overview', 'results', 'spectrum', 'qc', 'recon', 'species', 'shortlist', 'triage', 'digest', 'glyco']

/// The tabs each workflow opens, in its order (doc/GUI-WORKFLOWS.md 1): the
/// Overview, the workflow's reports, then Tags and Spectrum, in every one.
export const WORKFLOW_TABS: Record<string, Tab[]> = {
  'export-tags': ['overview', 'results', 'spectrum'],
  'run-qc': ['overview', 'qc', 'results', 'spectrum'],
  'mass-shift': ['overview', 'recon', 'results', 'spectrum'],
  species: ['overview', 'species', 'results', 'spectrum'],
  'db-reduction': ['overview', 'shortlist', 'results', 'spectrum'],
  triage: ['overview', 'triage', 'results', 'spectrum'],
  characterize: ['overview', 'digest', 'species', 'glyco', 'results', 'spectrum']
}

/// The tabs shown: only those whose report exists (the Overview while a
/// run's results are shown, Tags with a tags table, the Spectrum tab (P4)
/// only with a CLI that has -dump_spectrum), the workflow's own first, in
/// its order (doc/GUI-WORKFLOWS.md 1), then the others. With nothing to show,
/// Tags alone: the empty landing with its Open buttons.
export function tabsOf(has: Partial<Record<Tab, boolean>>, workflow?: string | null): Tab[] {
  const first = (workflow && WORKFLOW_TABS[workflow]) || []
  const order = [...first, ...ORDER.filter((t) => !first.includes(t))]
  const shown = order.filter((t) => has[t])
  // The Spectrum tab alone is no result: it opens from a table.
  return shown.some((t) => t !== 'spectrum') ? shown : ['results', ...shown]
}

export type { WorkflowReports }

export interface ResultTabsProps {
  tab: Tab
  setTab(t: Tab): void
  species: SpeciesReport | null
  // The run the Species tab describes, as it was submitted.
  speciesRun: { input: string; enabled: boolean; params?: Record<string, unknown> | null } | null
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
  // The Overview of the run shown (none: no Overview tab), its input, and
  // what its actions do; locked while busy.
  overview?: { model: Overview; input: string; locked: boolean; params?: Record<string, unknown>; workflow?: string | null; workflowId?: string | null; missing?: string[] } | null
  onOverviewAction?(a: TileAction): void
  // Over the tabs while a single run goes (RunningPanel).
  runningState?: ReactNode
  // GUI-DESIGN S8: the Tags table's "Re-run with per-residue confidence"
  // for a file without res_conf; null when the form would not repeat the
  // run that wrote the file shown.
  rerunResConf?: { run(): void; disabled: boolean } | null
  // P4c, the Mass gaps & recon empty state: choose a FASTA (or turn the
  // reports on) and run again; null: not offered (no run of the form's input).
  reconAction?: { label: string; run(): void; disabled: boolean } | null
  // The low-placed banner: the run again with extension 3 (reconExtend).
  reconExtend?: { label: string; run(): void; disabled: boolean } | null
  // P4: whether the CLI has -dump_spectrum (null: still asking), and the
  // run whose results are shown (its input and what it was sent), from
  // which the Spectrum tab dumps peaks under the run's own options.
  spectrumSupport?: SpectrumSupport | null
  spectrumRun?: { input: string; params: Record<string, unknown> } | null
  // The workflow of the run shown: its tabs come first, in its order.
  workflow?: string | null
}

export default function ResultTabs(p: ResultTabsProps): JSX.Element {
  const { setTab, species, speciesRun, reports, batchMiss, results, running, busy, failure, copied } = p
  const tables = reports.tables ?? {}
  const massgap = reports.list.find((r) => r.kind === 'massgap') ?? null
  const hasRecon = !!(massgap || tables.recon || tables.delta || tables.reconIds)
  const spectrumOn = !!p.spectrumSupport?.supported
  const wr: WorkflowReports = reports.workflow ?? {}
  const tabs = tabsOf({
    overview: !!p.overview,
    // A tags table, or what stands for it: a batch job without one, or a
    // run writing it.
    results: !!results || !!batchMiss || running,
    // Only beside a table it opens from: Tags or Triage.
    spectrum: spectrumOn && (!!results || !!wr.triage),
    qc: !!wr.qc,
    recon: hasRecon || !!wr.deltaSpectra || !!wr.deltaCounts,
    // Only a report that was read: a requested one that is missing is named
    // in the Overview instead.
    species: !!species,
    shortlist: !!wr.shortlist,
    triage: !!wr.triage || !!wr.censusSummary,
    digest: reports.list.length > 0 || reports.errors.length > 0,
    glyco: !!tables.glyco
  }, p.workflow)
  // A tab whose content is gone (a new run started, or the Spectrum tab with
  // a CLI that cannot dump spectra) shows the first one left.
  const tab: Tab = tabs.includes(p.tab) ? p.tab : tabs[0]

  // The Spectrum tab (P4): the spectrum opened from the Tags table, and
  // the input and parameters of the run that wrote the table shown.
  const [target, setTarget] = useState<SpectrumTarget | null>(null)
  const [located, setLocated] = useState<Record<string, string>>({})
  const [record, setRecord] = useState<{ path: string; input: string | null; params: Record<string, unknown> | null } | null>(null)
  // The file the Spectrum tab reads tags and the run's record from: the
  // tags table, or the identifiability ranking opened without one.
  const path = results?.path ?? wr.triage ?? null
  const fromRun = !!(p.spectrumRun && results?.input && p.spectrumRun.input === results.input)
  useEffect(() => {
    if (!path || fromRun || !spectrumOn) return
    let live = true
    window.fastag
      .historyOf(path)
      .catch(() => null)
      .then((r) => live && setRecord({ path, input: r?.input ?? null, params: r?.params ?? null }))
    return () => {
      live = false
    }
  }, [path, fromRun, spectrumOn])
  const runInput = fromRun ? p.spectrumRun!.input : null
  const runParams = fromRun ? p.spectrumRun!.params : null
  const rec = record && record.path === path ? record : null
  const source = useMemo((): SpectrumSource => {
    const loc = path ? located[path] : undefined
    if (fromRun) return { input: loc ?? runInput, params: runParams, from: loc ? 'located' : 'run' }
    const params = rec?.params ?? null
    if (loc) return { input: loc, params, from: 'located' }
    if (rec?.input) return { input: rec.input, params, from: 'history' }
    return { input: null, params: null, from: 'none' }
  }, [path, located, fromRun, runInput, runParams, rec])
  // A target of another file (a new run, another TSV) is not shown.
  const shownTarget = target && target.path === path ? target : null
  function openSpectrum(spectrum: string, rowId: number | null): void {
    if (!path) return
    setTarget({ path, spectrum, rowId })
    setTab('spectrum')
    // Keyboard focus follows the row to the Spectrum tab's heading.
    focusLater(() => document.querySelector<HTMLElement>('#tabpanel .sp-head h2'))
  }
  // Arrow keys, Home and End move between the tabs (WAI-ARIA tabs pattern).
  function onTabKey(e: KeyboardEvent<HTMLDivElement>): void {
    const i = tabs.indexOf(tab)
    const to =
      e.key === 'ArrowRight' ? (i + 1) % tabs.length
      : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? tabs.length - 1
      : -1
    if (to < 0) return
    e.preventDefault()
    setTab(tabs[to])
    document.getElementById(`tab-${tabs[to]}`)?.focus()
  }

  return (
    <section className="results" aria-label="Results">
      <div className="tabs">
        <div role="tablist" aria-label="Results" onKeyDown={onTabKey}>
          {tabs.map((t) => (
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
              {t === 'species' && species && <span className={`count${species.taxa.length === 0 ? ' zero' : ''}`}>{species.taxa.length}</span>}
              {t === 'digest' && reports.list.length > 0 && <span className="count">{reports.list.length}</span>}
            </button>
          ))}
        </div>
        {/* Always reachable, also once a result fills the pane. */}
        {/* Not while a run is writing the files they would open. */}
        <button className="secondary" onClick={p.openResults} disabled={busy} title="Open an existing tags TSV">
          Open tags…
        </button>
        <button className="secondary" onClick={p.openReport} disabled={busy} title="Open a report of an earlier run">
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

      {results?.replaced && (
        <p className="banner warn" role="status">
          <IconWarning />
          <span>
            <strong>Outputs overwritten.</strong> The run of {baseName(results.replaced.input)} wrote{' '}
            <code>{results.path}</code>, but a later run of {baseName(results.replaced.by)} (
            {new Date(results.replaced.end).toLocaleString()}) wrote over it. Its results are shown.
          </span>
        </p>
      )}

      {results?.reportsReplaced && results.reportsReplaced.length > 0 && (
        <div className="banner warn" role="status">
          <IconWarning />
          <span>
            <strong>Reports overwritten.</strong> A later run wrote over{' '}
            {results.reportsReplaced.length === 1 ? 'a report' : 'reports'} of the run shown, so{' '}
            {results.reportsReplaced.length === 1 ? 'it is' : 'they are'} not shown:{' '}
            {results.reportsReplaced.map((x, k) => (
              <span key={x.path}>
                {k > 0 && '; '}
                <code>{baseName(x.path)}</code> by the run of {baseName(x.by)} ({new Date(x.end).toLocaleString()})
              </span>
            ))}
            .
          </span>
        </div>
      )}

      {results?.reportsTouched && results.reportsTouched.length > 0 && (
        <p className="banner warn" role="status">
          <IconWarning />
          <span>
            <strong>Reports may be partial.</strong> A later run that did not finish named{' '}
            {results.reportsTouched.length === 1 ? 'a report' : 'reports'} of the run shown too; if it wrote to{' '}
            {results.reportsTouched.length === 1 ? 'it' : 'them'} before it stopped, the file is not this run&apos;s:{' '}
            {results.reportsTouched.map((x, k) => (
              <span key={x.path}>
                {k > 0 && '; '}
                <code>{baseName(x.path)}</code> by the run of {baseName(x.by)} ({x.status},{' '}
                {new Date(x.end).toLocaleString()})
              </span>
            ))}
            .
          </span>
        </p>
      )}

      {p.runningState}

      <div className="tabpanel" id="tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'overview' && p.overview ? (
          <div className="tablewrap">
            <OverviewPanel
              overview={p.overview.model}
              input={p.overview.input}
              params={p.overview.params}
              workflow={p.overview.workflow}
              workflowId={p.overview.workflowId}
              missing={p.overview.missing}
              busy={busy || p.overview.locked}
              onAction={(a) => p.onOverviewAction?.(a)}
            />
          </div>
        ) : (tab === 'qc' || tab === 'shortlist' || tab === 'triage') && wr[tab] ? (
          <div className="tablewrap">
            <ReportTable
              key={`${tab}:${wr[tab]}`}
              kind={tab}
              path={wr[tab]!}
              gen={reports.workflowGen?.[tab]}
              files={tab === 'shortlist' ? wr.files : undefined}
              openSpectrum={tab === 'triage' && spectrumOn ? (sp) => openSpectrum(sp, null) : undefined}
            />
            {tab === 'triage' && wr.censusSummary && (
              <details className="raw">
                <summary>Run summary of the identifiability table</summary>
                <ReportTable key={`sum:${wr.censusSummary}`} kind="generic" path={wr.censusSummary} gen={reports.workflowGen?.censusSummary} />
              </details>
            )}
          </div>
        ) : tab === 'triage' && wr.censusSummary ? (
          <div className="tablewrap">
            <p className="hint">The run summary of the identifiability table; the ranking of the spectra is in a file of its own.</p>
            <ReportTable key={`sum:${wr.censusSummary}`} kind="generic" path={wr.censusSummary} gen={reports.workflowGen?.censusSummary} />
          </div>
        ) : tab === 'recon' ? (
          <div className="tablewrap">
            {(hasRecon || (!wr.deltaSpectra && !wr.deltaCounts)) && (
              <ReconView massgap={massgap} tables={tables} gen={reports.gen} notice={reports.notice} action={p.reconAction} extend={p.reconExtend} onOpen={p.openReport} />
            )}
            {wr.deltaSpectra && (
              <details className="raw" open={!hasRecon}>
                <summary>Spectra per mass shift</summary>
                <ReportTable key={`ds:${wr.deltaSpectra}`} kind="generic" path={wr.deltaSpectra} gen={reports.workflowGen?.deltaSpectra} />
              </details>
            )}
            {wr.deltaCounts && (
              <details className="raw" open={!hasRecon}>
                <summary>Mass-shift accounting: how many spectra reach each step</summary>
                <ReportTable key={`dc:${wr.deltaCounts}`} kind="generic" path={wr.deltaCounts} gen={reports.workflowGen?.deltaCounts} />
              </details>
            )}
          </div>
        ) : tab === 'glyco' && tables.glyco ? (
          <div className="tablewrap">
            {reports.notice && (
              <p className="caveat" role="status">
                {reports.notice}
              </p>
            )}
            <GlycoTable key={`${reports.gen?.glyco ?? 0}:${tables.glyco}`} path={tables.glyco} gen={reports.gen?.glyco} />
          </div>
        ) : tab === 'spectrum' ? (
          <div className="tablewrap">
            {shownTarget ? (
              <SpectrumPanel
                target={shownTarget}
                source={source}
                onTarget={setTarget}
                onLocate={(input) => path && setLocated((l) => ({ ...l, [path]: input }))}
              />
            ) : (
              <div className="empty-state">
                <h2>No spectrum chosen</h2>
                <p>
                  In Tags or Triage, choose a row and press Enter (or Open in Spectrum) to see its spectrum with
                  FASTag&apos;s processed peaks and, for a tagged spectrum, the tag&apos;s ladder on them.
                </p>
              </div>
            )}
          </div>
        ) : tab === 'digest' ? (
          <div className="tablewrap">
            <DigestPanel reports={reports.list} errors={reports.errors} onOpen={p.openReport} />
          </div>
        ) : tab === 'species' ? (
          <div className="tablewrap">
            <SpeciesPanel
              report={species}
              enabled={speciesRun ? speciesRun.enabled : p.speciesOn}
              formOn={!!speciesRun && !speciesRun.enabled && p.speciesOn}
              runInput={speciesRun?.input}
              // A run that started passed the reach check, so it was never too short.
              tooShort={speciesRun ? null : p.tooShort}
              contributed={p.evidence.contributed}
              totalMs2={p.evidence.ms2}
              czExcluded={p.evidence.czExcluded ?? null}
              daTolerance={daSpeciesTolerance(reports.list, speciesRun?.params ?? p.overview?.params ?? p.spectrumRun?.params ?? rec?.params)}
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
            rerunResConf={p.rerunResConf}
            spectrum={{
              state: spectrumOn ? 'yes' : p.spectrumSupport == null ? 'checking' : 'no',
              open: openSpectrum
            }}
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
