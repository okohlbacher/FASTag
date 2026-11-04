import type { JSX } from 'react'
import type { SpeciesReport, Taxon } from './types'
import { baseName } from './digestReport'
import { IconFlag } from './icons'

// Genera that turn up in almost any LC-MS/MS run regardless of the sample:
// porcine trypsin, bovine serum, keratin from handling. Flagged so a user does
// not read a reagent as a finding. A hint, never a verdict -- these are also
// perfectly valid samples.
const CONTAMINANT: Record<string, string> = {
  Sus: 'porcine trypsin',
  Bos: 'bovine serum / BSA',
  Oryctolagus: 'common reagent source',
  Gallus: 'common reagent source',
  Ovis: 'common reagent source',
  Equus: 'common reagent source',
  Homo: 'keratin / handling (or the sample itself)'
}

function fmtQ(q: number): string {
  if (q === 0) return '<1e-300'
  if (q < 0.001) return q.toExponential(1)
  return q.toFixed(3)
}

interface Props {
  report: SpeciesReport | null
  enabled: boolean
  tooShort: { reach: number; k: number; option: string } | null
  contributed: number | null
  totalMs2: number | null
  /// The form has species on although the run shown had it off: the switch
  /// the off message points to is already set, so say to run again instead.
  formOn?: boolean
  /// The input of the run shown, for that message.
  runInput?: string
}

export default function SpeciesPanel({
  report,
  enabled,
  tooShort,
  contributed,
  totalMs2,
  formOn,
  runInput
}: Props): JSX.Element {
  if (!enabled && formOn) {
    return (
      <div className="empty">
        The last run{runInput ? <> (<span className="mono">{baseName(runInput)}</span>)</> : null} did not detect species;
        run again to detect them.
      </div>
    )
  }
  if (!enabled) {
    return (
      <div className="empty">
        Species detection is off. Enable <code>species</code> under Species detection.
      </div>
    )
  }

  if (tooShort) {
    return (
      <div className="warn big">
        <strong>No tag can reach the index.</strong>
        <p>
          Tags reach {tooShort.reach} residues but the index is keyed on {tooShort.k}-mers, so
          nothing can be looked up, and FASTag refuses such a run up front. Raise <code>{tooShort.option}</code> to{' '}
          {tooShort.k}, or use <code>extension</code> to reach it.
        </p>
      </div>
    )
  }

  if (!report) return <div className="empty">Species results appear here after a run.</div>
  if (report.empty) {
    return (
      <div className="empty">
        No taxon was supported by the tags. The run completed — this is a negative result, not an
        error.
      </div>
    )
  }

  const top = report.taxa[0]
  // Without -species_deconvolve the CLI writes adjusted = observed for every
  // taxon, so nothing was subtracted and the wording must not say so.
  const deconvolved = report.taxa.some((t) => t.adjusted !== t.observed)
  // An exact tie on both sort keys is not a call: the order inside the tied
  // block is only the CLI's taxid order (the digest call treats it the same).
  const tied = report.taxa.filter((t) => t.adjusted === top.adjusted && t.observed === top.observed)
  // rel. follows the ranking (adjusted), so the rank-1 taxon is 100%.
  const relBase = top.adjusted > 0 ? top.adjusted : 1
  const relOf = (t: Taxon): number => Math.min(100, Math.round((t.adjusted / relBase) * 100))
  const next = tied.length > 1 ? undefined : report.taxa[1]
  const pctSpectra =
    contributed != null && totalMs2 ? Math.round((contributed / totalMs2) * 1000) / 10 : null
  const counted = deconvolved ? 'adjusted' : 'observed'

  return (
    <div className="species">
      <p className="src">
        From <code title={report.path}>{baseName(report.path)}</code> · rank <code>{top.rank}</code> ·{' '}
        {deconvolved ? 'shared sequence subtracted' : 'no deconvolution'}
      </p>

      <section className="cards" aria-label="Species call">
        <div className="card headline">
          <span className="card-label">Species call</span>
          <div className="call">
            <span className="taxon">{tied.length > 1 ? 'No single call' : <TaxonName t={top} />}</span>
            <span className="rank">{top.rank}</span>
          </div>
          {tied.length > 1 && (
            <div className="sub">
              Tie between {tied.length} taxa: {tied.map((t) => t.name).join(', ')}
            </div>
          )}
          <div className="sub">
            {top.observed.toLocaleString('en-US')} spectra
            {deconvolved && <> · {top.adjusted.toLocaleString('en-US')} after subtracting shared sequence</>}
          </div>
          <div className="muted">
            Ranked first by {counted} spectra · q {fmtQ(top.q)}
            {next && (
              <>
                {' '}· next: <TaxonName t={next} /> at {relOf(next)}% of its evidence
              </>
            )}
          </div>
          <div className="caveat">
            {top.rank}-level call — a reduced reference set and short tags cannot resolve species.
          </div>
        </div>
        {contributed != null && (
          <div className="card evidence">
            <span className="card-label">Evidence</span>
            <span className="big">{contributed.toLocaleString('en-US')}</span>
            <span className="muted">
              {totalMs2 ? (
                <>
                  of {totalMs2.toLocaleString('en-US')} MS2 spectra ({pctSpectra}%) gave taxon evidence
                </>
              ) : (
                'spectra gave taxon evidence'
              )}
            </span>
          </div>
        )}
      </section>

      <div className="card table-card">
        <table className="taxa">
          <caption>Taxa by {counted} spectra</caption>
          <thead>
            <tr>
              <th scope="col">Taxon</th>
              <th scope="col">Rank</th>
              <th scope="col" className="rel-col">Relative to top taxon</th>
              <th scope="col" className="num">Observed</th>
              {deconvolved && <th scope="col" className="num">Adjusted</th>}
              <th scope="col" className="num">q-value</th>
            </tr>
          </thead>
          <tbody>
            {report.taxa.map((t: Taxon) => {
              // Keyed by genus: a species-rank row (Bos taurus) is flagged by its genus.
              const flag = CONTAMINANT[t.name.split(' ')[0]]
              // Adjusted count relative to the rank-1 taxon: a relative
              // confidence that this is the taxon, normalised so the top is 100%.
              const rel = relOf(t)
              return (
                <tr key={t.taxid}>
                  <td>
                    <button
                      className="link"
                      title={`NCBI Taxonomy ${t.taxid}`}
                      onClick={() => window.fastag.openTaxon(t.taxid)}
                    >
                      <TaxonName t={t} />
                    </button>
                    {flag && (
                      <span className="chip warn contam" title={`Common contaminant: ${flag}`}>
                        <IconFlag />
                        common contaminant<span className="sr-only">: {flag}</span>
                      </span>
                    )}
                  </td>
                  <td className="dim">{t.rank}</td>
                  <td title={`${counted} count relative to the top taxon`}>
                    <span className="relbar">
                      <span className="track">
                        <span className="minibar" style={{ width: `${rel}%` }} />
                      </span>
                      <span className="v">{rel}%</span>
                    </span>
                  </td>
                  <td className="num">{t.observed.toLocaleString('en-US')}</td>
                  {deconvolved && <td className="num">{t.adjusted.toLocaleString('en-US')}</td>}
                  <td className="num dim">{fmtQ(t.q)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="footnote">
        {deconvolved ? (
          <>
            Ranked by the <em>adjusted</em> count — spectra remaining once sequence shared with other
            taxa has been subtracted.
          </>
        ) : (
          <>
            Ranked by observed spectra. Shared sequence was not subtracted, so close relatives share evidence
            with the top taxon; run with <code className="cli">species_deconvolve</code> to add an Adjusted
            column.
          </>
        )}{' '}
        Ranking by significance instead would favour a near neighbour, whose borrowed count is
        exactly what makes it significant. Relative values divide by the top taxon&apos;s {counted} spectra: a
        relative confidence, not a calibrated posterior. q is likewise a <em>ranking aid, not a calibrated
        FDR</em> — the per-k-mer background is a proxy and the chimeric-null problem applies. “Common
        contaminant” marks genera common to most runs as reagents.
      </p>
    </div>
  )
}

/// Genus and species names are italic, as taxonomy writes them.
function TaxonName({ t }: { t: Taxon }): JSX.Element {
  return t.rank === 'genus' || t.rank === 'species' ? <em>{t.name}</em> : <>{t.name}</>
}
