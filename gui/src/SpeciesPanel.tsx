import type { JSX } from 'react'
import type { SpeciesReport, Taxon } from './types'
import { baseName } from './digestReport'
import { IconFlag } from './icons'
import { HelpLink } from './help/HelpLink'

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

// null: the CLI wrote NA (1.12 #10, -species_orientation both). The analytic
// q-value is withheld there, so it is shown as uncalibrated, never as q = 1.
function fmtQ(q: number | null): string {
  if (q === null) return 'uncalibrated'
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
        Species detection is off. Enable <code>species</code> under Species detection.{' '}
        <HelpLink to="faq-species-off">How to use it</HelpLink>
      </div>
    )
  }

  if (tooShort) {
    return (
      <div className="warn big">
        <strong>Tags are too short for the species reference.</strong>
        <p>
          Tags are at most {tooShort.reach} residues long, but the species reference stores protein pieces of{' '}
          {tooShort.k} residues, so no tag can be looked up and FASTag refuses the run. Raise{' '}
          <code>{tooShort.option}</code> to {tooShort.k}, or set <code>extension</code> so the tags grow to{' '}
          {tooShort.k}. <HelpLink to="faq-species-short">More</HelpLink>
        </p>
      </div>
    )
  }

  if (!report) return <div className="empty">Species results appear here after a run.</div>
  if (report.taxa.length === 0) {
    return (
      <div className="empty">
        No taxon met the report thresholds. The run completed; this does not establish that an organism
        is absent. <HelpLink to="faq-species-none">Possible causes</HelpLink>
      </div>
    )
  }

  const top = report.taxa[0]
  const hasCalls = report.taxa.some((t) => t.call !== undefined)
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
        From <code title={report.path}>{baseName(report.path)}</code> ·{' '}
        {top.rank && (
          <>
            rank <code>{top.rank}</code> ·{' '}
          </>
        )}
        {deconvolved ? 'shared sequence subtracted' : 'no deconvolution'} ·{' '}
        <HelpLink to="species-reading">About this tab</HelpLink>
      </p>

      <section className="cards" aria-label="Taxon ranking">
        <div className="card headline">
          <span className="card-label">Top-ranked taxon</span>
          <div className="call">
            <span className="taxon">{tied.length > 1 ? 'No single leader' : <TaxonName t={top} />}</span>
            {top.rank && <span className="rank">{top.rank}</span>}
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
            Ranked first by {counted} spectra ·{' '}
            <span title={top.q === null ? Q_NA_TITLE : Q_TITLE}>q {fmtQ(top.q)}</span>
            {next && (
              <>
                {' '}· next: <TaxonName t={next} /> at {relOf(next)}% of its evidence
              </>
            )}
          </div>
          <div className="caveat">
            {top.rank === 'species'
              ? 'Species names are not reliable: a reduced reference set and short tags cannot separate close relatives. Interpret the ranking at genus level.'
              : `${top.rank ? `${top.rank}-level ranking` : 'Ranking at an unstated rank'} — a reduced reference set and short tags cannot resolve species.`}
            {' '}Ranked evidence does not establish presence.{hasCalls && ' See the separate CLI call column below.'}
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
              {hasCalls && <th scope="col" title="The status reported by the CLI’s optional species call; separate from the evidence ranking">CLI call</th>}
              <th scope="col" className="rel-col">Relative to top taxon</th>
              <th scope="col" className="num">Observed</th>
              {deconvolved && <th scope="col" className="num">Adjusted</th>}
              <th scope="col" className="num" title={Q_TITLE}>
                q-value
              </th>
            </tr>
          </thead>
          <tbody>
            {report.taxa.map((t: Taxon) => {
              // Keyed by genus: a species-rank row (Bos taurus) is flagged by its genus.
              const flag = CONTAMINANT[t.name.split(' ')[0]]
              // Relative evidence, normalised so the top is 100%; not a probability.
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
                  {hasCalls && <td title={t.callReason?.replace(/_/g, ' ')}>{t.call?.replace(/_/g, ' ') ?? 'not reported'}</td>}
                  <td title={`${counted} spectra as a share of the top taxon`}>
                    <span className="relbar">
                      <span className="track">
                        <span className="minibar" style={{ width: `${rel}%` }} />
                      </span>
                      <span className="v">{rel}%</span>
                    </span>
                  </td>
                  <td className="num">{t.observed.toLocaleString('en-US')}</td>
                  {deconvolved && <td className="num">{t.adjusted.toLocaleString('en-US')}</td>}
                  <td className="num dim" title={t.q === null ? Q_NA_TITLE : undefined}>{fmtQ(t.q)}</td>
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
        exactly what makes it significant. Relative values compare each taxon&apos;s {counted} spectra with the
        top taxon&apos;s (100%); they are not probabilities. The q-value only helps sort the list. It is{' '}
        <em>not an error rate</em> you can rely on, because the background it assumes is approximate and spectra
        that mix two peptides can make a taxon look stronger than it is. “Common contaminant” marks genera that
        turn up in most runs, from reagents such as trypsin or serum, or from handling (keratin).{' '}
        <HelpLink to="species-limits">When to trust a call</HelpLink>
      </p>
    </div>
  )
}

const Q_NA_TITLE =
  'Uncalibrated: under -species_orientation both no analytic background applies, so the CLI writes the q-value as NA. Use the decoy_qvalue of -species_call decoy.'

const Q_TITLE = 'q-value: smaller means the evidence is less likely to be chance. Use it to rank taxa, not as an error rate.'

/// Genus and species names are italic, as taxonomy writes them.
function TaxonName({ t }: { t: Taxon }): JSX.Element {
  return t.rank === 'genus' || t.rank === 'species' ? <em>{t.name}</em> : <>{t.name}</>
}
