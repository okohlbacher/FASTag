import { useState, type JSX, type ReactNode } from 'react'
import SequenceLogo, { LogoLegend } from './SequenceLogo'
import { HelpButton, HelpLink } from './help/HelpLink'
import {
  backgroundWords,
  baseName,
  digestCall,
  fmt,
  gapHistogram,
  gapPeaks,
  groupDigits,
  labelFindings,
  modelLogo,
  num,
  observedLogo,
  pct,
  section,
  signedDa,
  topBins,
  value,
  type GapBin,
  type Report,
  type ReportRow
} from './digestReport'

// The digest, label and mass-gap reports. FASTag reports measurements; this
// pane shows them and their own sentences, and adds no judgement of its own.

export const REASON: Record<string, string> = {
  low_resolution: 'the fragment tolerance is in Da',
  timstof: 'the run is from a timsTOF',
  ms2_scan_window: 'the MS2 scan range starts above m/z 147.21 (the y1 ion of a C-terminal K, plus 0.1), so a K before the cut is missed',
  ms2_first_peak: 'the first MS2 peaks lie above m/z 147.21 (the y1 ion of a C-terminal K, plus 0.1), so a K before the cut is missed',
  ion_counts: 'no instrument is named and the intensities are ion counts, as on a timsTOF',
  few_tags: 'too few terminal tags',
  nonfinite_score: 'a residue has probability 0 under a model',
  tie: 'two models of different classes fit equally well'
}

const reasonWords = (k: string): string => REASON[k] ?? k

// The rules a report can mark `unknown`: what could not be checked, in words.
const UNCHECKED: Record<string, string> = {
  timstof: 'whether the run is from a timsTOF (no instrument or native ID format named)',
  ms2_scan_window: 'the MS2 scan window (no spectrum states it)',
  ms2_first_peak: 'the first MS2 peaks (no MS2 spectrum has a peak)',
  ion_counts: 'whether the intensities are ion counts'
}

// The heavy-SILAC rows of the label report, in words.
const HEAVY: Record<string, string> = {
  'K8.share': 'K8 share',
  'R10.share': 'R10 share',
  'K.tags': 'K tag ends',
  'R.tags': 'R tag ends',
  gate: 'Enough K and R tag ends to judge'
}
function heavyValue(key: string, v: string): string {
  const n = num(v)
  if (key.endsWith('.share')) return pct(n)
  if (n != null) return fmt(n, 4)
  return v === 'yes' ? 'Yes' : v === 'no' ? 'No' : v
}

/// Section heading with the report's file name, so reports of different
/// runs cannot be mistaken for one, followed by what the reader found wrong
/// with the file.
function Heading({ id, title, report, help }: { id: string; title: string; report: Report; help: string }): JSX.Element {
  return (
    <>
      <div className="card-head">
        <h2 id={id}>{title}</h2>
        <HelpButton to={help} what={title} />
        <code className="src" title={report.path}>
          {baseName(report.path)}
        </code>
      </div>
      {report.warnings.map((w) => (
        <div className="caveat" key={w}>
          {w}
        </div>
      ))}
    </>
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
    <div className="says">
      <span className="card-label">FASTag says</span>
      <ul className="sentences">
        {list.map((d) => (
          <li key={d}>{groupDigits(d)}</li>
        ))}
      </ul>
    </div>
  )
}

/// One figure of a card: a label over its value.
function Stat({ label, children, big = false }: { label: string; children: ReactNode; big?: boolean }): JSX.Element {
  return (
    <div className={big ? 'stat big' : 'stat'}>
      <dt>{label}</dt>
      <dd className={big ? 'taxon' : undefined}>{children}</dd>
    </div>
  )
}

function RawRows({ report }: { report: Report }): JSX.Element {
  return (
    <details className="raw">
      <summary>
        All {fmt(report.rows.length)} report rows of <span className="mono">{report.path}</span>
      </summary>
      {/* Focusable: it scrolls, and nothing in it takes focus. */}
      <div className="tablewrap" tabIndex={0} role="region" aria-label="Report rows">
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
  const nC = num(value(report, 'count', 'n_c'))
  const nN = num(value(report, 'count', 'n_n'))
  return (
    <section className="dg-block card" aria-labelledby="dg-digest">
      <Heading id="dg-digest" title="Protease" report={report} help="digest-protease" />
      <dl className="headline stats">
        {call.status === 'call' ? (
          <>
            <Stat label="Called" big>
              {call.model}
              {call.cls && call.cls !== call.model && <span className="rank">{call.cls}</span>}
            </Stat>
            {call.runnerUp && (
              <Stat label="Runner-up, other enzyme class">
                {call.runnerUp}
                {call.runnerUpClass && call.runnerUpClass !== call.runnerUp ? ` (${call.runnerUpClass})` : ''}
              </Stat>
            )}
            {call.margin != null && <Stat label="Lead over runner-up (log-likelihood per tag end)">{fmt(call.margin, 4)}</Stat>}
          </>
        ) : call.status === 'no_call' ? (
          <>
            <Stat label="Called" big>
              No call
            </Stat>
            <Stat label="Reason">
              {call.reason ? reasonWords(call.reason) : 'not stated'}
              {call.fired.length > 1 && (
                <> · also {call.fired.filter((f) => f !== call.reason).map(reasonWords).join(', ')}</>
              )}
            </Stat>
          </>
        ) : (
          <Stat label="Called">The report has no call rows.</Stat>
        )}
        {(nC != null || nN != null || call.usesNterm != null) && (
          <Stat label="Tag ends used">
            {[nC != null && `${fmt(nC)} C`, nN != null && `${fmt(nN)} N`].filter(Boolean).join(' · ')}
            {call.usesNterm === false && <span className="sub">N end not used</span>}
          </Stat>
        )}
      </dl>
      {call.status === 'no_call' && call.reason && REASON[call.reason] && (
        <p className="sub">
          <HelpLink to={`faq-digest-${call.reason}`}>What this no-call means, and what to do</HelpLink>
        </p>
      )}
      {call.unknown.length > 0 && (
        <div className="caveat">Could not check: {call.unknown.map((k) => UNCHECKED[k] ?? k).join('; ')}.</div>
      )}
      <div className="logo-row">
        {observed.some((c) => c.letters.length) && (
          <div className="logos">
            <SequenceLogo title="Observed" columns={observed} maxBits={maxBits} showN />
            {called && <SequenceLogo title={`Called: ${call.model}`} columns={called} maxBits={maxBits} />}
            {runner && <SequenceLogo title={`Runner-up: ${call.runnerUp}`} columns={runner} maxBits={maxBits} />}
            <LogoLegend />
            <p className="footnote">
              Each column is one position around the cut: P4 to P1 are the last four residues before it, P1′ to P4′
              the first four after it. The height of a stack shows how far that position differs from the background
              {bg ? ` (${bg})` : ''}
              {hasBg ? '' : ' (the report carries none, so a uniform one is used)'}. Each letter&apos;s height is its share
              at that position, so the largest letter is the most common residue. Positions before the cut are
              compared with the C-terminal background, positions after it with the N-terminal one. Observed columns
              are corrected for the pattern a small sample shows by chance. Columns with fewer than{' '}
              {tagMin ?? 'the minimum of'} tag ends are grey, and so are the P′ columns when the call does not use the
              N end. Model logos show what each protease predicts, before mixing with the background.
              {call.model && !called && ' The report carries no model distributions, so the model logos are not drawn.'}{' '}
              <HelpLink to="digest-logo">About the logos</HelpLink>
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
      </div>
      <RawRows report={report} />
    </section>
  )
}

function Label({ report }: { report: Report }): JSX.Element {
  const labels = labelFindings(report)
  const heavy = section(report, 'heavy')
  // Counts only, as the report gives them: a label with tag ends is named,
  // to be compared with the chance count 0.5 Da above it, in the column below.
  const seen = labels.filter((l) => (l.count ?? 0) > 0)
  return (
    <section className="dg-block card" aria-labelledby="dg-label">
      <Heading id="dg-label" title="Labels" report={report} help="digest-labels" />
      {labels.length > 0 && (
        <div className="chip-line">
          {seen.length === 0 ? (
            <>
              <span className="chip ok">No label tag ends</span>
              <span className="muted">{labels.map((l) => l.label).join(', ')}: 0 tag ends each.</span>
            </>
          ) : (
            <>
              <span className="chip warn">Tag ends at {seen.map((l) => l.label).join(', ')}</span>
              <span className="muted">
                Counts at 0.5 Da above each label mass show how many ends match by chance; a real label clearly
                exceeds them.
              </span>
            </>
          )}
        </div>
      )}
      {value(report, 'run', 'low_resolution') === 'yes' && (
        <div className="caveat">The fragment tolerance is in Da, so the label windows do not hold.</div>
      )}
      {labels.length > 0 && (
        <table className="taxa narrow">
          <thead>
            <tr>
              <th scope="col">Label</th>
              <th scope="col" className="num">Tag ends</th>
              <th scope="col" className="num">Chance (0.5 Da above)</th>
              <th scope="col" className="num">Share of tags</th>
            </tr>
          </thead>
          <tbody>
            {labels.map((l) => (
              <tr key={l.label}>
                <td>{l.label}</td>
                <td className="num">{fmt(l.count)}</td>
                <td className="num dim">{fmt(l.background)}</td>
                <td className="num">{pct(l.share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {heavy.length > 0 && (
        <table className="taxa narrow">
          <thead>
            <tr>
              <th scope="col">Heavy SILAC label (Lys8, Arg10)</th>
              <th scope="col" className="num">Value</th>
            </tr>
          </thead>
          <tbody>
            {heavy.map((h) => (
              <tr key={h.key}>
                <td>{HEAVY[h.key] ?? h.key}</td>
                <td className="num">{heavyValue(h.key, h.value)}</td>
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
  // bin so the others stay visible, and mark the bins that run off the scale.
  // Shifted means more than twice the window from zero, as the CLI counts it.
  const w = num(value(report, 'run', 'window_da')) ?? 0.02
  const shiftedAt = 2 * w
  const shifted = bins.filter((b) => Math.abs(b.gap) > shiftedAt)
  const maxS = Math.max(1, ...(shifted.length ? shifted : bins).map((b) => b.spectra))
  const clipped = shown.some((b) => b.spectra > maxS)
  const peaks = gapPeaks(report)
  const cys = section(report, 'cys')
  const top = section(report, 'top')
  const silac = value(report, 'silac', 'call')
  const alk = alkylation(report)
  return (
    <section className="dg-block card" aria-labelledby="dg-gap">
      <Heading id="dg-gap" title="Precursor mass gaps" report={report} help="digest-gaps" />
      {top.length > 0 && (
        <div className="sub">
          Most frequent modifications: {top.map((t) => t.value).join(', ')}
          {silac && <> · SILAC: {silac}</>}
        </div>
      )}
      <Sentences rows={[...section(report, 'combo'), ...cys.filter((c) => c.value !== '0'), ...section(report, 'silac').slice(0, 1)]} />
      {bins.length > 0 && <GapHistogram bins={bins} />}
      {bins.length > 0 && (
        <>
          <table className="taxa narrow gaps">
            <caption>
              Gap distribution{bins.length > shown.length ? `: the ${shown.length} fullest of ${fmt(bins.length)} bins` : ''}
              {shifted.length > 0 && shifted.length < bins.length ? `; bars scaled to the largest bin beyond ±${fmt(shiftedAt, 4)} Da` : ''}
              {clipped ? '; ⫽ marks a bar cut off at that scale' : ''}
            </caption>
            <thead>
              <tr>
                <th className="num">gap (Da)</th>
                <th className="num">spectra</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((b, i) => (
                // A hand-edited report can repeat a gap; the index keeps the rows apart.
                <tr key={`${b.key}#${i}`}>
                  <td className="num">{b.key}</td>
                  <td className="num bar-cell">
                    <span className="minibar" style={{ width: `${Math.min(100, Math.round((b.spectra / maxS) * 100))}%` }} />
                    <span className="v">
                      {b.spectra > maxS && (
                        <span className="clip" title="The bar is cut off: it runs past the scale of the shifted bins.">
                          ⫽{' '}
                        </span>
                      )}
                      {fmt(b.spectra)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {bins.length > BIN_LIMIT && (
            <button className="link" onClick={() => setAll((a) => !a)}>
              {all ? `Show the ${BIN_LIMIT} fullest bins` : `Show all ${fmt(bins.length)} bins`}
            </button>
          )}
        </>
      )}
      {peaks.length > 0 && (
        <table className="taxa narrow">
          <thead>
            <tr>
              <th scope="col" className="num">Gap (Da)</th>
              <th scope="col" className="num">Spectra</th>
              <th scope="col">Explained by</th>
              <th scope="col">Alternatives</th>
              <th scope="col">Context</th>
            </tr>
          </thead>
          <tbody>
            {peaks.map((p) => (
              <tr key={p.index}>
                <td className="num">{signedDa(p.delta)}</td>
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
      {alk && (
        <div className="chip-line">
          <span className={alk.count > 0 ? 'chip ok' : 'chip'}>
            {alk.count > 0 ? `Cysteine alkylation: ${alk.name}` : 'No cysteine alkylation gap'}
          </span>
          <span className="muted">
            {alk.count > 0
              ? `${fmt(alk.count)} of the ${fmt(alk.placed)} spectra placed in a database peptide`
              : `none of the ${fmt(alk.placed)} spectra placed in a database peptide has an alkylation gap`}
          </span>
        </div>
      )}
      <RawRows report={report} />
    </section>
  )
}

/// The Cys alkylation the gaps point to: the cys row with the most spectra,
/// out of the placed spectra the section counts. null without a cys section.
function alkylation(r: Report): { name: string; count: number; placed: number } | null {
  const rows = section(r, 'cys')
  const placed = num(value(r, 'cys', 'spectra'))
  if (!rows.length || placed == null) return null
  let best = { name: '', count: 0 }
  for (const x of rows) {
    if (x.key === 'spectra' || x.key === 'zero_bin') continue
    const n = num(x.value) ?? 0
    if (n > best.count) best = { name: x.key, count: n }
  }
  return { ...best, placed }
}

const MAX_COLS = 72
/// The gaps in whole-Da steps (wider when the range is wide), as columns. The
/// range holds the central 98% of the spectra and 0, so a few far gaps do not
/// squeeze the rest into one column; what lies outside is counted in the
/// caption. The bin around 0 holds most spectra: the bars are scaled to the
/// fullest other bin, and the 0 bin is drawn cut at that height with its count.
function GapHistogram({ bins }: { bins: GapBin[] }): JSX.Element {
  const total = bins.reduce((n, b) => n + b.spectra, 0)
  const quantile = (q: number): number => {
    let seen = 0
    for (const b of bins) {
      seen += b.spectra
      if (seen >= q * total) return b.gap
    }
    return bins[bins.length - 1].gap
  }
  const lo = Math.min(0, Math.round(quantile(0.01)))
  const hi = Math.max(0, Math.round(quantile(0.99)))
  const step = Math.max(1, Math.ceil((hi - lo + 1) / MAX_COLS))
  const n = Math.floor((hi - lo) / step) + 1
  const cols = Array.from({ length: n }, (_, i) => ({ from: lo + i * step, spectra: 0 }))
  let outside = 0
  for (const b of bins) {
    const g = Math.round(b.gap)
    if (g < lo || g > lo + n * step - 1) outside += b.spectra
    else cols[Math.floor((g - lo) / step)].spectra += b.spectra
  }
  const zero = cols.findIndex((c) => c.from <= 0 && 0 < c.from + step)
  const others = cols.filter((_, i) => i !== zero)
  const scale = Math.max(1, ...(others.some((c) => c.spectra > 0) ? others : cols).map((c) => c.spectra))
  const top = cols
    .map((c, i) => ({ ...c, i }))
    .filter((c) => c.i !== zero && c.spectra > 0)
    .sort((a, b) => b.spectra - a.spectra)
    .slice(0, 3)
  const peakAt = new Set(top.map((c) => c.i))
  const da = (v: number): string => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0')
  const at = (c: { from: number }): string => (step === 1 ? da(c.from) : `${da(c.from)} to ${da(c.from + step - 1)}`)
  // Axis labels by priority, each far enough from the ones already placed
  // to stay legible: 0, the peaks, then the two ends.
  const ticks: number[] = []
  for (const i of [zero, ...top.map((c) => c.i), 0, n - 1]) {
    if (i >= 0 && ticks.every((t) => Math.abs(t - i) >= Math.max(1, n * 0.12))) ticks.push(i)
  }
  const summary =
    `Spectra by precursor minus peptide mass, ${step === 1 ? 'in 1 Da steps' : `in ${step} Da steps`} from ${da(lo)} to ${da(lo + n * step - 1)} Da` +
    (zero >= 0 ? `: ${fmt(cols[zero].spectra)} at ${at(cols[zero])}${cols[zero].spectra > scale ? ' (bar cut)' : ''}` : '') +
    (top.length ? `; next ${top.map((c) => `${at(c)} (${fmt(c.spectra)})`).join(', ')}` : '') +
    (outside > 0 ? `; ${fmt(outside)} outside this range` : '')
  return (
    <figure className="gap-hist">
      <figcaption>
        Spectra placed in a database peptide, by precursor − peptide mass (Da)
        {zero >= 0 && cols[zero].spectra > scale ? '; the 0 bin is cut and labelled' : ''}
        {outside > 0 ? `; ${fmt(outside)} beyond ${da(lo)} to ${da(lo + n * step - 1)} Da are not drawn` : ''}
      </figcaption>
      <div className="hist" role="img" aria-label={summary} style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {cols.map((c, i) => {
          const cut = c.spectra > scale
          const h = Math.min(100, (c.spectra / scale) * 100)
          return (
            <div
              key={c.from}
              className={`bar${i === zero || peakAt.has(i) ? ' peak' : ''}${cut ? ' cut' : ''}`}
              style={{ height: `${c.spectra > 0 ? Math.max(h, 2) : 0}%` }}
              title={`${at(c)} Da: ${fmt(c.spectra)} spectra`}
            >
              {cut && <span className="cut-label">{fmt(c.spectra)}</span>}
            </div>
          )
        })}
      </div>
      <div className="hist-axis" aria-hidden="true">
        {ticks.map((i) => (
          <span key={i} style={{ left: `${((i + 0.5) / n) * 100}%` }}>
            {step === 1 || i === zero ? da(i === zero ? 0 : cols[i].from) : da(cols[i].from + Math.floor(step / 2))}
          </span>
        ))}
      </div>
    </figure>
  )
}

export default function DigestPanel({ reports, errors, onOpen }: Props): JSX.Element {
  const by = (k: Report['kind']): Report | undefined => reports.find((r) => r.kind === k)
  const d = by('digest')
  const l = by('label')
  const m = by('massgap')
  return (
    <div className="digest">
      {errors.map((e) => (
        <p className="warn" key={e} role="alert">
          {e}
        </p>
      ))}
      {!d && !l && !m && errors.length === 0 && (
        <div className="empty">
          The digest, label and mass-gap reports appear here after a run that writes them (<code className="cli">digest_out</code>,{' '}
          <code className="cli">label_out</code>, <code className="cli">massgap_out</code>), or{' '}
          <button className="link" onClick={onOpen}>
            open a report TSV…
          </button>{' '}
          <HelpLink to="faq-digest-empty">How to write them</HelpLink>
        </div>
      )}
      {d && <Digest report={d} />}
      {l && <Label report={l} />}
      {m && <MassGap report={m} />}
      {(d || l || m) && (
        <button className="secondary" onClick={onOpen}>
          Open another report…
        </button>
      )}
    </div>
  )
}
