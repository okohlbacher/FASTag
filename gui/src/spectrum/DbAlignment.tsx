// The Spectrum tab's alignment of the spectrum's tags on the database
// protein each hits uniquely (alignment.ts): the protein's residues around
// them, read from the database of the run that wrote the tags (fasta.rs
// fasta_segment), with each tag under its position. One block per protein,
// the one with most tags first; tags that hit several proteins are named,
// not aligned, and so are those on an identifier the database gives more
// than one entry (the CLI's positions may be of any of them).

import { useEffect, useMemo, useState, type JSX } from 'react'
import { alignmentsOf, layout, placementContext, readRange, type PlacementContext, type ProteinBlock } from './alignment'
import type { FastaDatabase, FastaSegment } from '../types'

interface Props {
  columns: string[]
  rows: string[][]
  // The tags table the rows are read from: its run's databases are read.
  tags: string | null
  // What the run was given: its -fasta and -entrapment_fasta, and the
  // -fixed_modifications and -isobaric_tolerance its isobaric rules follow.
  params: Record<string, unknown> | null
  chosen: number
  onChoose(row: number): void
}

const pathOf = (params: Record<string, unknown> | null, name: string): string | null => {
  const v = params?.[name]
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

type Seg = { state: 'loading' } | { state: 'ok'; seg: FastaSegment } | { state: 'error'; reason: string } | { state: 'nodb' }

export function DbAlignment({ columns, rows, tags, params, chosen, onChoose }: Props): JSX.Element | null {
  const al = useMemo(() => alignmentsOf(columns, rows), [columns, rows])
  // The run's isobaric rules (the CLI's ResidueFold.h), to put each tag's
  // residues on the protein's; null when they cannot be known here.
  const ctx = useMemo(() => placementContext(params), [params])
  if (!al || (al.blocks.length === 0 && al.several.length === 0)) return null
  return (
    <section className="sp-align" aria-label="Alignment on the database">
      <h3>Alignment on the database</h3>
      {al.blocks.length === 0 && <p className="hint">No tag of this spectrum hits a single protein, so none is aligned.</p>}
      {al.blocks.map((b) => (
        <Block
          key={`${b.entrapment ? 'e' : 't'}:${b.id}`}
          block={b}
          tags={tags}
          database={b.entrapment ? 'entrapment_fasta' : 'fasta'}
          known={pathOf(params, b.entrapment ? 'entrapment_fasta' : 'fasta') != null}
          ctx={ctx}
          chosen={chosen}
          onChoose={onChoose}
        />
      ))}
      {al.several.length > 0 && (
        <p className="hint" data-testid="align-several">
          Not aligned:{' '}
          {al.several.map((u, k) => (
            <span key={u.row}>
              {k > 0 ? '; ' : ''}
              <span className="mono">{u.tag}</span> matches {u.count.toLocaleString('en-US')} proteins
            </span>
          ))}
          .
        </p>
      )}
    </section>
  )
}

interface BlockProps {
  block: ProteinBlock
  tags: string | null
  database: FastaDatabase
  // The run was given that database.
  known: boolean
  ctx: PlacementContext | null
  chosen: number
  onChoose(row: number): void
}

function Block({ block: b, tags, database, known, ctx, chosen, onChoose }: BlockProps): JSX.Element {
  const [seg, setSeg] = useState<Seg>(known && tags ? { state: 'loading' } : { state: 'nodb' })
  useEffect(() => {
    let live = true
    if (!known || !tags) {
      setSeg({ state: 'nodb' })
      return
    }
    setSeg({ state: 'loading' })
    const [from, to] = readRange(b)
    window.fastag
      .fastaSegment(tags, database, b.id, from, to)
      .then((s) => live && setSeg({ state: 'ok', seg: s }))
      .catch((e: unknown) => live && setSeg({ state: 'error', reason: e instanceof Error ? e.message : String(e) }))
    return () => {
      live = false
    }
  }, [tags, database, known, b])

  const name = `${b.accession}${b.gene ? ` · ${b.gene}` : ''}`
  // An identifier of several entries: the CLI's positions, no residues.
  const repeated = seg.state === 'ok' && seg.seg.occurrences > 1 ? seg.seg.occurrences : 0
  const lay = seg.state === 'ok' && !repeated ? layout(b, seg.seg.sequence, seg.seg.start, seg.seg.length, ctx) : null
  const range = lay ? `${lay.from}–${lay.to}` : `${b.start}–${b.end}`
  return (
    <div className="sp-al-block" data-testid="align-block">
      <h4>
        <span className="mono" title={b.id}>
          {name}
        </span>{' '}
        <span className="muted">
          · residues {range}
          {lay && seg.state === 'ok' ? ` of ${seg.seg.length.toLocaleString('en-US')}` : ''} · {b.tags.length} tag{b.tags.length === 1 ? '' : 's'}
        </span>
        {b.entrapment && <span className="warn-text"> · entrapment database, a known false match</span>}
      </h4>
      {seg.state === 'ok' && seg.seg.description && <p className="hint sp-al-desc">{seg.seg.description}</p>}
      {seg.state === 'loading' && <p className="hint">Reading the protein…</p>}
      {seg.state === 'nodb' && <p className="hint">The run&apos;s database is not known here, so the protein&apos;s residues cannot be shown.</p>}
      {seg.state === 'error' && <p className="hint">Cannot read the protein: {seg.reason}</p>}
      {repeated > 0 && (
        <p className="hint" data-testid="align-repeated">
          {b.id} names {repeated.toLocaleString('en-US')} entries of the database, and the run&apos;s positions may be of any of them, so the
          tags are not aligned on one.
        </p>
      )}
      {lay ? (
        <div className="sp-al" role="table" aria-label={`Tags on ${name}, residues ${range}`}>
          <div className="sp-al-row" role="row">
            <span className="sp-al-label" role="rowheader">
              {lay.from}
            </span>
            <span className="sp-al-seq" role="cell" aria-label={`Protein residues ${range}: ${lay.sequence}`}>
              {[...lay.sequence].map((ch, k) => {
                const pos = lay.from + k
                const inPep = lay.peptide != null && pos >= lay.peptide[0] && pos <= lay.peptide[1]
                return (
                  <span key={k} className={`sp-al-res${inPep ? ' pep' : lay.peptide ? ' flank' : ''}`} title={`${ch}${pos}`}>
                    {ch}
                  </span>
                )
              })}
            </span>
            <span className="sp-al-end muted">{lay.to}</span>
          </div>
          {lay.lines.map(({ tag, placed, cells }) => (
            <div className={`sp-al-row${tag.row === chosen ? ' on' : ''}`} role="row" key={tag.row}>
              <span className="sp-al-label" role="rowheader">
                <button
                  type="button"
                  className="link mono"
                  onClick={() => onChoose(tag.row)}
                  aria-pressed={tag.row === chosen}
                  title={`Draw the ladder of ${tag.tag}`}
                >
                  {tag.tag}
                </button>
              </span>
              <span
                className="sp-al-seq"
                role="cell"
                aria-label={`${tag.tag} at residues ${tag.start}–${tag.end}${tag.reversed ? ', matched reversed' : ''}${placed ? '' : ', placement of its residues not reconstructed'}`}
                title={`${tag.tag}: residues ${tag.start}–${tag.end}${tag.reversed ? ', matched reversed (read from the other ion series)' : ''}`}
              >
                {cells.map((c, k) => (
                  <span key={k} className={`sp-al-res${c.ch ? ' tag' : ''}${c.diff ? ' diff' : ''}${c.span ? ' span' : ''}`}>
                    {c.ch.length > 1 ? <span className="sp-al-pair">{c.ch}</span> : c.ch || ' '}
                  </span>
                ))}
              </span>
              <span className="sp-al-end muted">{tag.reversed ? 'reversed' : ''}</span>
            </div>
          ))}
        </div>
      ) : (
        seg.state !== 'loading' && (
          <ul className="sp-al-list">
            {b.tags.map((t) => (
              <li key={t.row}>
                <span className="mono">{t.tag}</span> at residues {t.start}–{t.end}
                {t.reversed ? ', reversed' : ''}
              </li>
            ))}
          </ul>
        )
      )}
      {lay && (
        <p className="hint sp-al-note">
          {lay.peptide
            ? `Shaded: residues ${lay.peptide[0]}–${lay.peptide[1]}, the peptide a cut after K or R would give; a candidate, not an identification.`
            : 'No cut after K or R is near the tags, so the tags are shown with 5 residues either side.'}
          {lay.lines.some((l) => l.cells.some((c) => c.diff)) ? ' A marked residue differs from the protein (a residue pair of the same mass).' : ''}
          {lay.lines.some((l) => !l.placed) ? (
            <span data-testid="align-unplaced">
              {' '}
              A bar marks only the residues a tag matched: the placement of its residues cannot be reconstructed for this run
              {ctx ? ' (its isobaric rules give no reading of them)' : ' (its fixed modifications or isobaric tolerance are not known here)'}.
            </span>
          ) : null}
        </p>
      )}
    </div>
  )
}
