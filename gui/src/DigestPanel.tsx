import { useState, type JSX } from 'react'
import SequenceLogo, { LogoLegend } from './SequenceLogo'
import {
  backgroundWords,
  baseName,
  digestCall,
  fmt,
  gapHistogram,
  gapPeaks,
  labelFindings,
  modelLogo,
  num,
  observedLogo,
  section,
  topBins,
  value,
  type Report,
  type ReportRow
} from './digestReport'

// The digest, label and mass-gap reports. FASTag reports measurements; this
// pane shows them and their own sentences, and adds no judgement of its own.

const REASON: Record<string, string> = {
  low_resolution: 'the fragment tolerance is in Da',
  timstof: 'the run is from a timsTOF',
  ms2_scan_window: 'the MS2 scan window starts above y1 of K',
  ms2_first_peak: 'the first MS2 peaks lie above y1 of K',
  few_tags: 'too few terminal tags',
  nonfinite_score: 'a residue has probability 0 under a model',
  tie: 'two models of different classes fit equally well'
}

const reasonWords = (k: string): string => REASON[k] ?? k

/// Section heading with the report's file name, so reports of different
/// runs cannot be mistaken for one.
function Heading({ id, title, report }: { id: string; title: string; report: Report }): JSX.Element {
  return (
    <h2 id={id}>
      {title}
      <span className="src mono" title={report.path}>
        {baseName(report.path)}
      </span>
    </h2>
  )
}

const ALT_SHOWN = 3

const BIN_LIMIT = 40

interface Props {
  reports: Report[]
  errors: string[]
  onOpen: () => void
}

function Sentences({ rows }: { rows: ReportRow[] }): JSX.Element | null {
  const seen = new Set<string>()
  const list = rows.map((r) => r.description).filter((d) => d && !seen.has(d) && seen.add(d))
  if (!list.length) return null
  return (
    <ul className="sentences">
      {list.map((d) => (
        <li key={d}>{d}</li>
      ))}
    </ul>
  )
}

function RawRows({ report }: { report: Report }): JSX.Element {
  return (
    <details className="raw">
      <summary>
        All {report.rows.length.toLocaleString()} rows of <span className="mono">{report.path}</span>
      </summary>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>section</th>
              <th>key</th>
              <th>value</th>
              <th className="num">n</th>
              <th>description</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r, i) => (
              <tr key={i}>
                <td>{r.section}</td>
                <td className="mono">{r.key}</td>
                <td className="mono">{r.value}</td>
                <td className="num">{r.n ?? '–'}</td>
                <td className="wrap">{r.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

function Digest({ report }: { report: Report }): JSX.Element {
  const call = digestCall(report)
  const observed = observedLogo(report)
  const called = call.model ? modelLogo(report, call.model) : null
  const runner = call.runnerUp ? modelLogo(report, call.runnerUp) : null
  const maxBits = Math.max(
    1,
    ...[observed, called ?? [], runner ?? []].flat().map((c) => c.bits)
  )
  const bg = backgroundWords(value(report, 'run', 'background'))
  const tagMin = value(report, 'run', 'tag_min')
  const hasBg = section(report, 'background').length > 0
  const nocall = section(report, 'nocall')
  return (
    <section className="dg-block" aria-labelledby="dg-digest">
      <Heading id="dg-digest" title="Digest" report={report} />
      <div className="headline">
        {call.status === 'call' ? (
          <>
            <div className="call">
              <span className="taxon">{call.model}</span>
              {call.cls && call.cls !== call.model && <span className="rank">{call.cls}</span>}
            </div>
            <div className="sub">
              {call.runnerUp && (
                <>
                  runner-up {call.runnerUp}
                  {call.runnerUpClass && call.runnerUpClass !== call.runnerUp ? ` (${call.runnerUpClass})` : ''} ·{' '}
                </>
              )}
              margin {fmt(call.margin, 4)} log-likelihood per tag
              {call.usesNterm != null && <> · N end {call.usesNterm ? 'used' : 'not used'}</>}
            </div>
          </>
        ) : call.status === 'no_call' ? (
          <>
            <div className="call">
              <span className="taxon">No call</span>
            </div>
            <div className="sub">
              reason: {call.reason ? reasonWords(call.reason) : 'not stated'}
              {call.fired.length > 1 && (
                <> · also {call.fired.filter((f) => f !== call.reason).map(reasonWords).join(', ')}</>
              )}
            </div>
          </>
        ) : (
          <div className="sub">The report has no call rows.</div>
        )}
        {call.unknown.length > 0 && (
          <div className="caveat">Metadata absent for: {call.unknown.join(', ')}.</div>
        )}
      </div>
      {observed.some((c) => c.letters.length) && (
        <div className="logos">
          <SequenceLogo title="Observed" columns={observed} maxBits={maxBits} showN />
          {called && <SequenceLogo title={`Called: ${call.model}`} columns={called} maxBits={maxBits} />}
          {runner && <SequenceLogo title={`Runner-up: ${call.runnerUp}`} columns={runner} maxBits={maxBits} />}
          <LogoLegend />
          <p className="footnote">
            Letter height is the residue's share times the column's information in bits against the background
            {bg ? `, ${bg}` : ''}
            {hasBg ? '' : '; the report carries no background, so a uniform one is used'}. P positions use the
            C-terminal background, P′ positions the N-terminal one. Observed columns are corrected for the
            information a small sample shows by chance, (s − 1) / (2n ln 2) bits; columns with fewer than{' '}
            {tagMin ?? 'the minimum of'} tag ends are greyed, as are the P′ columns when the call leaves out the N
            end. Model logos show the model distributions before mixing with the background.
            {call.model && !called && ' The report carries no model distributions, so the model logos are not drawn.'}
          </p>
        </div>
      )}
      <Sentences
        rows={[
          ...section(report, 'call'),
          ...nocall.filter((r) => r.value !== 'no'),
          ...section(report, 'count'),
          ...section(report, 'share')
        ]}
      />
      <RawRows report={report} />
    </section>
  )
}

function Label({ report }: { report: Report }): JSX.Element {
  const labels = labelFindings(report)
  const heavy = section(report, 'heavy')
  return (
    <section className="dg-block" aria-labelledby="dg-label">
      <Heading id="dg-label" title="Labels" report={report} />
      {value(report, 'run', 'low_resolution') === 'yes' && (
        <div className="caveat">The fragment tolerance is in Da, so the label windows do not hold.</div>
      )}
      {labels.length > 0 && (
        <table className="taxa narrow">
          <thead>
            <tr>
              <th>label</th>
              <th className="num">tag ends</th>
              <th className="num">at +0.5 Da</th>
              <th className="num">share of tags</th>
            </tr>
          </thead>
          <tbody>
            {labels.map((l) => (
              <tr key={l.label}>
                <td>{l.label}</td>
                <td className="num">{fmt(l.count)}</td>
                <td className="num dim">{fmt(l.background)}</td>
                <td className="num">{fmt(l.share, 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {heavy.length > 0 && (
        <table className="taxa narrow">
          <thead>
            <tr>
              <th>heavy SILAC</th>
              <th className="num">value</th>
            </tr>
          </thead>
          <tbody>
            {heavy.map((h) => (
              <tr key={h.key}>
                <td>{h.key}</td>
                <td className="num">{num(h.value) != null ? fmt(num(h.value), 4) : h.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Sentences rows={[...section(report, 'nlabel').filter((x) => x.key.endsWith('.share')), ...heavy.filter((x) => x.key === 'gate')]} />
      <RawRows report={report} />
    </section>
  )
}

function MassGap({ report }: { report: Report }): JSX.Element {
  const [all, setAll] = useState(false)
  const bins = gapHistogram(report)
  const shown = topBins(bins, all ? null : BIN_LIMIT)
  // The zero bin holds most spectra; scale the bars to the largest shifted
  // bin so the others stay visible, and let the zero bin run full width.
  const w = num(value(report, 'run', 'window_da')) ?? 0.02
  const shifted = bins.filter((b) => Math.abs(b.gap) > w)
  const maxS = Math.max(1, ...(shifted.length ? shifted : bins).map((b) => b.spectra))
  const peaks = gapPeaks(report)
  const cys = section(report, 'cys')
  const top = section(report, 'top')
  const silac = value(report, 'silac', 'call')
  return (
    <section className="dg-block" aria-labelledby="dg-gap">
      <Heading id="dg-gap" title="Mass gaps" report={report} />
      {top.length > 0 && (
        <div className="sub">
          Most frequent modifications: {top.map((t) => t.value).join(', ')}
          {silac && <> · SILAC: {silac}</>}
        </div>
      )}
      <Sentences rows={[...section(report, 'combo'), ...cys.filter((c) => c.value !== '0'), ...section(report, 'silac').slice(0, 1)]} />
      {peaks.length > 0 && (
        <table className="taxa narrow">
          <thead>
            <tr>
              <th className="num">gap (Da)</th>
              <th className="num">spectra</th>
              <th>explained by</th>
              <th>alternatives</th>
              <th>context</th>
            </tr>
          </thead>
          <tbody>
            {peaks.map((p) => (
              <tr key={p.index}>
                <td className="num">{fmt(p.delta, 4)}</td>
                <td className="num">{fmt(p.spectra)}</td>
                <td className={p.explainedBy === 'none' ? 'dim' : ''}>{p.explainedBy}</td>
                <td className="dim alts" title={p.alternatives.join(', ')}>
                  {p.alternatives.slice(0, ALT_SHOWN).join(', ')}
                  {p.alternatives.length > ALT_SHOWN && ` +${p.alternatives.length - ALT_SHOWN} more`}
                </td>
                <td className="dim">{p.context}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {bins.length > 0 && (
        <>
          <table className="taxa narrow gaps">
            <caption>
              Gap distribution{bins.length > shown.length ? `: the ${shown.length} fullest of ${bins.length.toLocaleString()} bins` : ''}
              {shifted.length > 0 && shifted.length < bins.length ? `; bars scaled to the largest bin beyond ±${w} Da` : ''}
            </caption>
            <thead>
              <tr>
                <th className="num">gap (Da)</th>
                <th className="num">spectra</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((b) => (
                <tr key={b.key}>
                  <td className="num">{b.key}</td>
                  <td className="num bar-cell">
                    <span className="minibar" style={{ width: `${Math.min(100, Math.round((b.spectra / maxS) * 100))}%` }} />
                    <span className="v">{b.spectra.toLocaleString()}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {bins.length > BIN_LIMIT && (
            <button className="link" onClick={() => setAll((a) => !a)}>
              {all ? `Show the ${BIN_LIMIT} fullest bins` : `Show all ${bins.length.toLocaleString()} bins`}
            </button>
          )}
        </>
      )}
      <RawRows report={report} />
    </section>
  )
}

export default function DigestPanel({ reports, errors, onOpen }: Props): JSX.Element {
  const by = (k: Report['kind']): Report | undefined => reports.find((r) => r.kind === k)
  const d = by('digest')
  const l = by('label')
  const m = by('massgap')
  return (
    <div className="species digest">
      {errors.map((e) => (
        <p className="warn" key={e} role="alert">
          {e}
        </p>
      ))}
      {!d && !l && !m && errors.length === 0 && (
        <div className="empty">
          The digest, label and mass-gap reports appear here after a run that writes them (<code>digest out</code>,{' '}
          <code>label out</code>, <code>massgap out</code>), or{' '}
          <button className="link" onClick={onOpen}>
            open a report TSV…
          </button>
        </div>
      )}
      {d && <Digest report={d} />}
      {l && <Label report={l} />}
      {m && <MassGap report={m} />}
      {(d || l || m) && (
        <button className="secondary slim" onClick={onOpen}>
          Open another report…
        </button>
      )}
    </div>
  )
}
