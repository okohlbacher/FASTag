// The Mass gaps & recon tab (GUI-DESIGN S7): the mass-gap chart with the
// Unimod deltas marked, and one shared table for -recon_out (placements),
// -delta_out (gap peaks) and -recon_id_out (the placements as PSMs, mzTab;
// an idXML or mzid one is listed as a file to reveal or open).
// A warning when too few spectra are placed for any conclusion, and an empty
// state that offers the FASTA and the run. It reports what the CLI wrote and
// adds no judgement of its own: every gap is a candidate.

import { useEffect, useMemo, useState, type JSX } from 'react'
import { baseName, fmt, gapHistogram, gapPeaks, num, parseReport, section, value, type Report } from '../digestReport'
import { dirName } from '../app/paths'
import { runStem } from './reports'
import { HelpLink } from '../help/HelpLink'
import { IconWarning } from '../icons'
import DataTable, { type Column } from './DataTable'
import MassGapChart, { type GapBin } from './MassGapChart'
import { filterRecon, idFormat, type DeltaTable, type ReconFilter, type ReconIdTable, type ReconTable, type TableGen, type TablePaths } from './tables'
import { useTable } from './useTable'
import { useSticky } from './tableStore'
import { FASTA_EXTENSION, SHIFT_MIN_DA, type TileAction } from './overview'
import { longestSeed, shortestSeed } from '../paramLayout'
import ReportHeader from './ReportHeader'
import ProductFiles, { type ProductFile } from './ProductFiles'
import './viewers.css'

/// Below this many placed spectra the gap distribution supports no
/// conclusion (provisional: the CLI's own gap peaks need 20 spectra, and a
/// share of 0.005 of the placed; 100 is where one such peak can stand out).
export const LOW_PLACED = 100

/// The gap window when no mass-gap report of the run is at hand (a delta.tsv
/// opened alone): the wider of the CLI's two defaults, -massgap_window_da
/// (a Da fragment tolerance; -massgap_window is 0.02 on a ppm run). The
/// delta file does not record the window, so the view says it assumed it.
export const ASSUMED_WINDOW = 0.5

export interface ReconViewProps {
  /// The -massgap_out report of the run shown, if any.
  massgap: Report | null
  tables: TablePaths
  /// How often each table was opened (Reports.gen): a new count re-reads it.
  gen?: TableGen
  /// Why another run's files were closed when a table opened.
  notice?: string
  /// "Choose a FASTA and write these reports" and the run; null: not offered.
  action?: { label: string; run(): void; disabled: boolean } | null
  /// "Run again with extension 3" in the low-placed banner (reconExtend);
  /// null: not offered.
  extend?: { label: string; run(): void; disabled: boolean } | null
  onOpen(): void
}

const given = (v: unknown): boolean => (typeof v === 'string' ? v.trim() !== '' : v === true)

/// The CLI's largest -extension.
const MAX_EXTENSION = 12
/// The shortest tag placed when -recon_min_length is 0 on a human-sized
/// database (the index's minimum, products.ts alkylationTarget).
const DEFAULT_MIN_PLACED = 8

/// The extension a FASTA run of @p params needs so its longest seed
/// (tag_lengths replaces tag_length) reaches the shortest tag placed: an
/// explicit recon_min_length, else 8; never below FASTA_EXTENSION. With
/// -fasta (the tag filter) every seed must also reach the filter's floor,
/// min_filter_length when set, else 8 for a human-sized database: the CLI
/// refuses the run otherwise (FASTag.cpp "Seed length ... reaches at most").
/// Above the CLI's 12 the seed itself must grow (@p seed: the seed that
/// would reach both at extension 12).
export function fastaExtension(params: Record<string, unknown>): { ext: number; seed?: number } {
  const seed = longestSeed(params) ?? 3
  const target = positive(params['recon_min_length']) ?? DEFAULT_MIN_PLACED
  let need = Math.max(FASTA_EXTENSION, Math.ceil((target - seed) / 2))
  let reach = target
  if (given(params['fasta'])) {
    const floor = positive(params['min_filter_length']) ?? DEFAULT_MIN_PLACED
    need = Math.max(need, Math.ceil((floor - (shortestSeed(params) ?? seed)) / 2))
    reach = Math.max(reach, floor)
  }
  return need > MAX_EXTENSION ? { ext: MAX_EXTENSION, seed: reach - 2 * MAX_EXTENSION } : { ext: need }
}

/// A whole number above 0, else null.
function positive(v: unknown): number | null {
  const x = Number(String(v ?? '').trim() || '0')
  return Number.isFinite(x) && x > 0 ? x : null
}

/// What the empty state's button does for a run sent @p params: without a
/// FASTA, pick one and run with the recon, delta and mass-gap reports (and
/// the extension the overview's "Add FASTA" uses, so tags reach the length a
/// proteome index needs); with one, turn the three reports on.
export function reconRerun(params: Record<string, unknown>): TileAction {
  const reports = { recon_out: 'recon.tsv', delta_out: 'delta.tsv', massgap_out: 'massgap.tsv' }
  // Either way the extension the FASTA needs: with a FASTA and extension 2
  // the run places nothing (v112-pxd014764-recon-ext2).
  const need = fastaExtension(params).ext
  const raise: Record<string, string> = extensionOf(params) < need ? { extension: String(need) } : {}
  if (given(params['fasta']) || given(params['recon_fasta']))
    return { kind: 'enable', label: 'Write these reports and run again', values: { ...reports, ...raise } }
  return { kind: 'add-fasta', label: 'Choose a FASTA and run again', values: { delta_out: 'delta.tsv', ...raise } }
}

/// The low-placed banner's action for a run sent @p params: the run again
/// with the extension its seed and shortest placed tag need (fastaExtension),
/// when it had a FASTA and a shorter extension; a longer seed when even 12
/// does not reach (a single tag_length only); else null.
export function reconExtend(params: Record<string, unknown>): TileAction | null {
  if (!(given(params['fasta']) || given(params['recon_fasta']))) return null
  const ext = extensionOf(params)
  const need = fastaExtension(params)
  if (need.seed != null) {
    if (Array.isArray(params['tag_lengths']) && params['tag_lengths'].length) return null
    return { kind: 'enable', label: `Run again with seed length ${need.seed} and extension ${need.ext}`, values: { tag_length: String(need.seed), extension: String(need.ext) } }
  }
  if (ext >= need.ext) return null
  return { kind: 'enable', label: `Run again with extension ${need.ext}`, values: { extension: String(need.ext) } }
}

// The CLI's -extension default is 0.
function extensionOf(params: Record<string, unknown>): number {
  const v = params['extension']
  const x = typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(x) ? x : 0
}

/// The gap window of the run whose delta.tsv is shown without its mass-gap
/// report: run/window_da of the sibling <stem>.massgap.tsv (same folder and
/// stem), only when the app's records say one run wrote both (or neither is
/// recorded: files opened from elsewhere). A mass-gap report a former run
/// left there is another run's (round 14): the window stays assumed.
/// null while unknown.
function useSiblingWindow(deltaPath: string | undefined, skip: boolean, gen = 0): number | null {
  const [found, setFound] = useState<{ at: string; win: number | null } | null>(null)
  const sib = deltaPath && !skip ? siblingMassgap(deltaPath) : null
  const key = sib && deltaPath ? `${deltaPath}\u0000${sib}\u0000${gen}` : null
  useEffect(() => {
    if (!sib || !deltaPath || !key) return
    let live = true
    void (async () => {
      try {
        const [rd, rs] = await Promise.all([window.fastag.historyOf(deltaPath).catch(() => null), window.fastag.historyOf(sib).catch(() => null)])
        const oneRun = rd && rs ? rd.id === rs.id : !rd && !rs
        const text = oneRun ? await window.fastag.report(sib) : null
        const win = text == null ? null : num(value(parseReport(text, sib), 'run', 'window_da'))
        if (live) setFound({ at: key, win: win ?? null })
      } catch {
        if (live) setFound({ at: key, win: null })
      }
    })()
    return () => {
      live = false
    }
  }, [key, sib, deltaPath])
  return key && found?.at === key ? found.win : null
}

/// <dir>/<stem>.massgap.tsv beside @p deltaPath (massgap.tsv for a bare delta.tsv).
export function siblingMassgap(deltaPath: string): string {
  const stem = runStem(deltaPath)
  return `${dirName(deltaPath)}${stem == null ? '' : `${stem}.`}massgap.tsv`
}

type Dataset = 'recon' | 'delta' | 'reconIds'
const DATASET_LABEL: Record<Dataset, string> = {
  recon: 'Placements',
  delta: 'Mass-shift table',
  reconIds: 'Identifications (mzTab)'
}

const signed = (v: number, d = 4): string => (Number.isNaN(v) ? '' : v > 0 ? `+${v.toFixed(d)}` : v < 0 ? `−${(-v).toFixed(d)}` : (0).toFixed(d))

export default function ReconView({ massgap, tables, gen = {}, notice, action, extend, onOpen }: ReconViewProps): JSX.Element {
  const recon = useTable(tables.recon, 'recon', gen.recon)
  const delta = useTable(tables.delta, 'delta', gen.delta)
  // Only an mzTab -recon_id_out is read here. An idXML or mzid one (the
  // user's choice, an older preset, a dropped file) is listed as a file, as
  // is a .mzTab that holds XML: never a red error for a file written on purpose.
  const idPath = tables.reconIds
  const idFmt = idPath ? idFormat(idPath) : null
  const ids = useTable(idFmt === 'mzTab' ? idPath : undefined, 'reconIds', gen.reconIds)
  // An mzTab that cannot be shown (over the viewer's size limit, or a read
  // that failed) keeps its Open and Reveal: it is a valid export all the same.
  const idFiles: ProductFile[] =
    idPath && (idFmt !== 'mzTab' || ids.notShown || ids.tooLarge || !!ids.error)
      ? [
          {
            label: 'placements as identifications',
            path: idPath,
            note:
              idFmt !== 'mzTab'
                ? `${idFmt}, for identification tools. Only the mzTab form is shown here.`
                : ids.notShown
                  ? 'Not an mzTab file: open it in an identification tool.'
                  : ids.tooLarge
                    ? 'mzTab larger than the 128 MB viewer limit: open it in an identification tool or a spreadsheet.'
                    : 'This mzTab could not be read here: open it in an identification tool or a spreadsheet.'
          }
        ]
      : []
  // The size limit is the file row's note, not a second error in red.
  const errors = [recon.error, delta.error, ids.tooLarge ? null : ids.error].filter((e): e is string => !!e)
  const loading = recon.loading || delta.loading || ids.loading

  // The bins: -delta_out (with its interpretations), else the hist rows of
  // the mass-gap report (the same rows, as -massgap_out reads them).
  const bins: GapBin[] = useMemo(() => {
    const d = delta.table
    if (d) return Array.from(d.delta, (gap, i) => ({ gap, key: d.keys[i], spectra: d.spectra[i], interps: d.interps[i] })).filter((b) => !Number.isNaN(b.gap))
    return massgap ? gapHistogram(massgap).map((b) => ({ gap: b.gap, key: b.key, spectra: b.spectra })) : []
  }, [delta.table, massgap])
  const peaks = useMemo(() => (massgap ? gapPeaks(massgap) : []), [massgap])
  // The window the CLI matched with: the report's; else the sibling
  // report's; else assumed (and said so).
  const sibWin = useSiblingWindow(tables.delta, !!massgap, gen.delta ?? 0)
  const reportWin = (massgap && num(value(massgap, 'run', 'window_da'))) ?? sibWin
  const win = reportWin ?? ASSUMED_WINDOW
  const winAssumed = reportWin == null
  const placed =
    (massgap && num(value(massgap, 'cys', 'spectra'))) ?? (bins.length ? bins.reduce((n, b) => n + b.spectra, 0) : null)

  const have = !!(massgap || tables.recon || tables.delta || tables.reconIds)
  if (!have) {
    return (
      <div className="empty-state recon-empty">
        <h2>No mass shifts yet</h2>
        <p>
          Mass shifts come from placing the tags on a protein database: choose a FASTA and write the Tag placements
          and the Mass-shift table (the Mass-shift survey workflow does); add the Mass-gap report for explained
          peaks.
        </p>
        <div className="row-actions">
          {action && (
            <button type="button" className="primary big" disabled={action.disabled} onClick={action.run}>
              {action.label}
            </button>
          )}
          <button type="button" className="secondary big" onClick={onOpen}>
            Open a placements, mass-shift or mass-gap report…
          </button>
        </div>
        <p>
          <HelpLink to="workflow-reconciliation">Working with mass gaps and reconciliation</HelpLink>
        </p>
      </div>
    )
  }

  const files = [massgap?.path, tables.recon, tables.delta, tables.reconIds].filter((p): p is string => !!p)
  const sources = [...new Set(files)]
  return (
    <div className="recon-view">
      <ReportHeader id="recon-title" title="Mass shifts" paths={sources} />
      {notice && (
        <p className="caveat" role="status">
          {notice}
        </p>
      )}
      {errors.map((e) => (
        <p className="warn" key={e} role="alert">
          {e}
        </p>
      ))}
      <ProductFiles files={idFiles} label="Identification files" />
      {[recon.table, delta.table, ids.table].flatMap((t) => t?.warnings ?? []).map((w) => (
        <div className="caveat" key={w}>
          {w}
        </div>
      ))}
      {placed != null && placed < LOW_PLACED && (
        <div className="banner warn" role="status">
          <IconWarning />
          <span>
            <strong>
              {placed === 0 ? 'No spectrum is placed' : `Only ${fmt(placed)} spectra are placed`} on the database.
            </strong>{' '}
            That is too few for any conclusion about modifications or alkylation (this view asks for {LOW_PLACED} placed spectra).
            {placed === 0 && ' Tags may be shorter than the recon index needs; its log line names the minimum length.'}
            {' Placements use tryptic peptides: a run digested with another protease places fewer tags.'}
          </span>
          {extend && (
            <button type="button" className="secondary" disabled={extend.disabled} onClick={extend.run}>
              {extend.label}
            </button>
          )}
        </div>
      )}
      <dl className="headline stats">
        <div className="stat" title="Spectra placed on the database; the gap of an unmodified one is near 0 Da">
          <dt>Placed spectra</dt>
          <dd>{fmt(placed)}</dd>
        </div>
        {bins.length > 0 && (
          // The spectra with a gap of 0.5 Da or more: the bin near 0 Da
          // (unmodified) holds placed spectra without a shift.
          <div className="stat" title={`Placed spectra with a gap at least ${SHIFT_MIN_DA} Da from 0`}>
            <dt>Shifted (≥ {SHIFT_MIN_DA} Da)</dt>
            <dd>{fmt(bins.reduce((n, b) => n + (Math.abs(b.gap) >= SHIFT_MIN_DA ? b.spectra : 0), 0))}</dd>
          </div>
        )}
        {recon.table && (
          <>
            <div className="stat">
              <dt>Placements</dt>
              <dd>{fmt(recon.table.rows)}</dd>
            </div>
            <div className="stat">
              <dt>Spectra with a placement</dt>
              <dd>{fmt(recon.table.spectra.length)}</dd>
            </div>
          </>
        )}
        {bins.length > 0 && (
          // As the Overview counts shifts: 0.5 Da or more away from 0 (the
          // bin near 0 is the unmodified one).
          <div className="stat" title={`Bins at least ${SHIFT_MIN_DA} Da from 0; the bin near 0 Da (unmodified) is not counted`}>
            <dt>Gap peaks (≥ {SHIFT_MIN_DA} Da)</dt>
            <dd>{fmt(bins.filter((b) => Math.abs(b.gap) >= SHIFT_MIN_DA).length)}</dd>
          </div>
        )}
        {massgap && section(massgap, 'top').length > 0 && (
          <div className="stat">
            <dt>Largest explained shares</dt>
            <dd>{section(massgap, 'top').map((t) => t.value).join(', ')}</dd>
          </div>
        )}
      </dl>
      <p className="caveat">
        Candidates, not identifications: localization is region-level, nothing here is FDR-controlled, and an
        interpretation names a hypothesis.
      </p>
      {bins.length > 0 ? (
        <MassGapChart bins={bins} peaks={peaks} window={win} windowAssumed={winAssumed} source={baseName(tables.delta ?? massgap?.path ?? '')} />
      ) : (
        !loading && <p className="muted">No gap rows to draw.</p>
      )}
      <ReconTables recon={recon.table} delta={delta.table} ids={ids.table} loading={loading} />
    </div>
  )
}

function ReconTables({ recon, delta, ids, loading }: { recon: ReconTable | null; delta: DeltaTable | null; ids: ReconIdTable | null; loading: boolean }): JSX.Element | null {
  // The survey's answer first: the mass-shift table with sites and UniMod
  // names; the placements behind it are the detail.
  const avail = (['delta', 'recon', 'reconIds'] as Dataset[]).filter((d) => (d === 'recon' ? recon : d === 'delta' ? delta : ids))
  const [pick, setPick] = useSticky<Dataset | null>(delta ?? recon ?? ids, 'dataset', null)
  const ds = pick && avail.includes(pick) ? pick : avail[0]
  if (!ds) return loading ? <p className="muted">Reading the tables…</p> : null
  return (
    <section className="recon-tables" aria-label="Recon tables">
      {avail.length > 1 && (
        <div className="seg" role="group" aria-label="Table">
          {avail.map((d) => (
            <button key={d} type="button" aria-pressed={d === ds} onClick={() => setPick(d)}>
              {DATASET_LABEL[d]}
            </button>
          ))}
        </div>
      )}
      {ds === 'recon' && recon && <PlacementTable t={recon} />}
      {ds === 'delta' && delta && <DeltaPeaks t={delta} />}
      {ds === 'reconIds' && ids && <IdTable t={ids} />}
    </section>
  )
}

const INTERP_CHOICES: { v: string; label: string }[] = [
  { v: '*', label: 'any' },
  { v: '?', label: '? (no interpretation)' },
  { v: 'sub:', label: 'sub: (substitution)' },
  { v: 'mod:', label: 'mod: (modification)' },
  { v: '', label: 'none (no gap)' }
]

function PlacementTable({ t }: { t: ReconTable }): JSX.Element {
  const [text, setText] = useSticky(t, 'text', '')
  const [gapped, setGapped] = useSticky(t, 'gapped', false)
  const [minAbs, setMinAbs] = useSticky(t, 'minAbs', '')
  const [interp, setInterp] = useSticky(t, 'interp', '*')
  const f: ReconFilter = {
    text: text || undefined,
    gapped: gapped || undefined,
    minAbsDelta: minAbs.trim() !== '' && Number.isFinite(Number(minAbs)) ? Number(minAbs) : undefined,
    interp: interp === '*' ? undefined : interp
  }
  const key = JSON.stringify(f)
  const rows = useMemo(() => filterRecon(t, JSON.parse(key) as ReconFilter), [t, key])
  const cols: Column[] = [
    { id: 'spectrum', label: 'Spectrum', mono: true, text: (i) => t.spectra[t.spectrum[i]], spectrum: (i) => t.spectra[t.spectrum[i]] },
    { id: 'tag', label: 'Tag', mono: true, text: (i) => t.tag[i] },
    { id: 'protein', label: 'Protein', text: (i) => t.protein[i] },
    { id: 'peptide', label: 'Peptide', mono: true, text: (i) => t.peptide[i] },
    { id: 'pos', label: 'Pos', num: true, text: (i) => String(t.pos[i]), key: (i) => t.pos[i] },
    {
      id: 'match',
      label: 'Flanks',
      title: 'Which flank matched the database peptide: N, C, both or neither',
      text: (i) => (t.nMatch[i] && t.cMatch[i] ? 'both' : t.nMatch[i] ? 'N' : t.cMatch[i] ? 'C' : 'neither')
    },
    { id: 'delta', label: 'Δ mass (Da)', num: true, text: (i) => signed(t.delta[i]), key: (i) => t.delta[i] },
    { id: 'region', label: 'Region', mono: true, text: (i) => t.region[i] },
    { id: 'interp', label: 'Interpretation', mono: true, text: (i) => t.interp[i] },
    ...(t.loc
      ? [
          { id: 'site', label: 'Site', mono: true, text: (i: number) => t.loc!.site[i] },
          { id: 'score', label: 'Site score', num: true, text: (i: number) => (t.loc!.score[i] < 0 ? '' : String(t.loc!.score[i])), key: (i: number) => (t.loc!.score[i] < 0 ? NaN : t.loc!.score[i]) },
          { id: 'ties', label: 'Ties', num: true, text: (i: number) => (t.loc!.ties[i] < 0 ? '' : String(t.loc!.ties[i])), key: (i: number) => (t.loc!.ties[i] < 0 ? NaN : t.loc!.ties[i]) }
        ]
      : []),
    { id: 'rev', label: 'Reversed', text: (i) => (t.reversed[i] ? 'yes' : '') }
  ]
  return (
    <>
      <div className="dt-filters" role="group" aria-label="Placement filters">
        <label>
          Contains
          <input type="search" value={text} placeholder="spectrum, tag, protein or peptide" onChange={(e) => setText(e.target.value)} />
        </label>
        <label>
          |Δ| at least (Da)
          <input type="number" inputMode="decimal" min={0} step="any" value={minAbs} onChange={(e) => setMinAbs(e.target.value)} />
        </label>
        <label>
          Interpretation
          <select value={interp} onChange={(e) => setInterp(e.target.value)}>
            {INTERP_CHOICES.map((c) => (
              <option key={c.v} value={c.v}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={gapped} onChange={(e) => setGapped(e.target.checked)} /> One flank off (a localized gap)
        </label>
      </div>
      <DataTable label="Placements" columns={cols} ids={rows} total={t.rows} empty="No placement matches these filters." keep={t} />
    </>
  )
}

/// The survey columns of a mass-shift table, in words (README, -delta_out).
const DELTA_EXTRA: { id: string; label: string; title: string; num?: true }[] = [
  {
    id: 'localized',
    label: 'Localized',
    title: 'Spectra whose shift is placed on one site class: fragment-localized plus sequence-constrained',
    num: true
  },
  {
    id: 'fragment_localized',
    label: 'Fragment-localized',
    title: 'Localized spectra whose site the fragments chose, with enough site-determining evidence',
    num: true
  },
  {
    id: 'sequence_constrained',
    label: 'Sequence-constrained',
    title: 'Localized spectra whose shift region is one residue: the placement, not a fragment, fixes the site',
    num: true
  },
  { id: 'residues', label: 'Sites', title: 'Site:count pairs of the localized spectra, most frequent first' },
  { id: 'unlocalized', label: 'Unlocalized', title: 'Spectra with a shift and no site-determining evidence', num: true },
  { id: 'ambiguous', label: 'Ambiguous', title: 'Unlocalized spectra with some site evidence, below the localization margin', num: true },
  { id: 'unimod', label: 'UniMod match', title: 'UniMod entries within the naming tolerance on a site of the row' },
  { id: 'isotope_error', label: 'Isotope error', title: 'A precursor isotope error, when the shift is one' },
  { id: 'isobars', label: 'Isobars', title: 'Exact isobars of the best name: mass cannot choose among them' },
  { id: 'class', label: 'Observation class', title: 'The observation classes of the row, most frequent first' }
]

function DeltaPeaks({ t }: { t: DeltaTable }): JSX.Element {
  const [minSpectra, setMinSpectra] = useSticky(t, 'minSpectra', '')
  const min = minSpectra.trim() !== '' && Number.isFinite(Number(minSpectra)) ? Number(minSpectra) : 0
  const rows = useMemo(() => {
    const out = new Uint32Array(t.rows)
    let k = 0
    for (let i = 0; i < t.rows; i++) if (t.spectra[i] >= min) out[k++] = i
    return out.slice(0, k)
  }, [t, min])
  const cols: Column[] = [
    { id: 'delta', label: 'Gap (Da)', num: true, text: (i) => t.keys[i], key: (i) => t.delta[i] },
    { id: 'spectra', label: 'Spectra', num: true, text: (i) => fmt(t.spectra[i]), key: (i) => t.spectra[i] },
    { id: 'interps', label: 'Top interpretations', mono: true, text: (i) => t.interps[i].map((x) => `${x.name} ${x.n}`).join(', ') },
    // The survey columns (1.15.2 on): localization, residues, UniMod names
    // and ambiguity, shown when the file has them.
    ...DELTA_EXTRA.filter((c) => t.extra[c.id]).map((c): Column => {
      const v = t.extra[c.id]!
      const numeric = c.num === true
      return {
        id: c.id,
        label: c.label,
        title: c.title,
        num: numeric,
        mono: !numeric,
        text: (i) => (v[i] === '-' ? '' : v[i]),
        key: numeric ? (i) => Number(v[i]) : undefined
      }
    })
  ]
  return (
    <>
      <div className="dt-filters" role="group" aria-label="Gap peak filters">
        <label>
          Spectra at least
          <input type="number" min={0} step={1} value={minSpectra} onChange={(e) => setMinSpectra(e.target.value)} />
        </label>
      </div>
      <DataTable label="Mass-shift table" columns={cols} ids={rows} total={t.rows} sort={{ column: 'spectra', desc: true }} keep={t} />
    </>
  )
}

function IdTable({ t }: { t: ReconIdTable }): JSX.Element {
  const [text, setText] = useSticky(t, 'text', '')
  const rows = useMemo(() => {
    const needle = text.trim().toLowerCase()
    const out = new Uint32Array(t.rows)
    let k = 0
    for (let i = 0; i < t.rows; i++) {
      if (needle && !(t.sequence[i].toLowerCase().includes(needle) || t.accession[i].toLowerCase().includes(needle) || t.spectrum[i].toLowerCase().includes(needle))) continue
      out[k++] = i
    }
    return out.slice(0, k)
  }, [t, text])
  const cols: Column[] = [
    { id: 'spectrum', label: 'Spectrum', mono: true, text: (i) => t.spectrum[i], spectrum: (i) => t.spectrum[i] },
    { id: 'sequence', label: 'Peptide', mono: true, text: (i) => t.sequence[i] },
    { id: 'accession', label: 'Protein', text: (i) => t.accession[i] },
    { id: 'score', label: 'E-value', num: true, text: (i) => (Number.isNaN(t.score[i]) ? '' : t.score[i].toExponential(2)), key: (i) => t.score[i] },
    { id: 'charge', label: 'z', num: true, text: (i) => String(t.charge[i]), key: (i) => t.charge[i] },
    { id: 'mz', label: 'm/z', num: true, text: (i) => (Number.isNaN(t.expMz[i]) ? '' : t.expMz[i].toFixed(4)), key: (i) => t.expMz[i] },
    { id: 'delta', label: 'Δ mass (Da)', num: true, text: (i) => signed(t.delta[i]), key: (i) => t.delta[i] },
    { id: 'interp', label: 'Interpretation', mono: true, text: (i) => t.interp[i] },
    { id: 'tag', label: 'Tag', mono: true, text: (i) => t.tag[i] }
  ]
  return (
    <>
      <p className="caveat">The placements as identifications, for identification tools: NOT FDR-controlled (the run says so).</p>
      <div className="dt-filters" role="group" aria-label="Identification filters">
        <label>
          Contains
          <input type="search" value={text} placeholder="peptide, protein or spectrum" onChange={(e) => setText(e.target.value)} />
        </label>
      </div>
      <DataTable label="Identifications" columns={cols} ids={rows} total={t.rows} sort={{ column: 'score', desc: false }} keep={t} />
    </>
  )
}
