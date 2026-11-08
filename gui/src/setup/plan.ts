// The Setup screen's four step cards and the plan footer (GUI-DESIGN 3 S1):
// which form sections each card holds, the one-line summary a card shows,
// and the plan line above Run. Pure text from the form's values.

import { PARAM_BY_NAME, isActive, inertBecause } from '../paramLayout'
import { baseName } from '../digestReport'

export interface Card {
  n: number
  id: 'spectra' | 'database' | 'tagging' | 'reports'
  title: string
  /// The form sections (paramLayout SECTIONS titles) the card holds, in order.
  sections: string[]
}

export const CARDS: readonly Card[] = [
  { n: 1, id: 'spectra', title: 'Spectra', sections: ['Spectra'] },
  { n: 2, id: 'database', title: 'Database & taxonomy', sections: ['Sequence matching', 'Species detection'] },
  { n: 3, id: 'tagging', title: 'Tagging', sections: ['Tagging', 'Modifications', 'Performance'] },
  { n: 4, id: 'reports', title: 'Reports', sections: ['Glycopeptides', 'Digest and labels', 'Reconciliation', 'Output'] }
]

type V = Record<string, unknown>

const shown = (v: unknown, name: string): string => {
  const s = String(v ?? '').trim()
  return s === '' ? String(PARAM_BY_NAME.get(name)?.default ?? '') : s
}

/// The reports a run writes, by short name, in the order of card 4.
export function reportsOn(values: V): string[] {
  const on: string[] = []
  if (isActive('digest_out', values)) on.push('digest')
  if (isActive('label_out', values)) on.push('label')
  if (isActive('glyco', values)) on.push('glyco')
  if (isActive('recon_out', values)) on.push('recon')
  if (isActive('massgap_out', values) && !inertBecause('massgap_out', values)) on.push('mass-gap')
  return on
}

/// The summary line of card @p id.
export function cardSummary(id: Card['id'], values: V, ctx: { input: string; out: string; files: number }): string {
  switch (id) {
    case 'spectra': {
      const what = ctx.files > 0 ? `${ctx.files} ${ctx.files === 1 ? 'file' : 'files'} in the batch` : ctx.input ? baseName(ctx.input) : 'no file yet'
      const sub = Number(shown(values['subsample_fraction'], 'subsample_fraction'))
      const n = Number(shown(values['subsample_spectra'], 'subsample_spectra'))
      const subText = n > 0 ? ` · ${n} spectra sampled` : sub > 0 && sub < 1 ? ` · ${Math.round(sub * 100)}% of spectra` : ''
      return `${what}${subText}`
    }
    case 'database': {
      const species = isActive('species', values)
        ? `Species on (${isActive('taxdb', values) ? baseName(String(values['taxdb'])) : 'bundled index'})`
        : 'Species off'
      const fasta = isActive('fasta', values) ? `FASTA ${baseName(String(values['fasta']))}` : 'FASTA none'
      return `${species} · ${fasta}`
    }
    case 'tagging': {
      const lens = Array.isArray(values['tag_lengths']) ? (values['tag_lengths'] as unknown[]).map((x) => String(x).trim()).filter(Boolean) : []
      const len = lens.length ? `lengths ${lens.join(', ')}` : `length ${shown(values['tag_length'], 'tag_length')}`
      const tol = `${shown(values['fragment_tolerance'], 'fragment_tolerance')} ${shown(values['fragment_tolerance_unit'], 'fragment_tolerance_unit')}`
      return `${len} · extension ${shown(values['extension'], 'extension')} · ${tol} · max ${shown(values['max_tags'], 'max_tags')} tags`
    }
    case 'reports': {
      const on = reportsOn(values)
      // Mass gaps need reconciliation, which needs a database (GUI-DESIGN 1).
      const massgap = on.includes('mass-gap') ? '' : isActive('fasta', values) || isActive('recon_fasta', values) ? '' : ' · mass-gap needs a FASTA'
      return `${on.length ? on.join(', ') : 'tags only'}${massgap}`
    }
  }
}

/// The plan line of the footer: "1 file · species on · digest+label+glyco ·
/// out: beside input".
/// ctx.outDir: the batch's output folder (none: beside each input).
export function planLine(values: V, ctx: { input: string; out: string; files: number; outDir?: string | null }): string {
  const parts: string[] = []
  parts.push(ctx.files > 0 ? `${ctx.files} ${ctx.files === 1 ? 'file' : 'files'}` : ctx.input ? '1 file' : 'no file')
  parts.push(isActive('species', values) ? 'species on' : 'species off')
  const on = reportsOn(values)
  parts.push(on.length ? on.join('+') : 'no reports')
  if (ctx.files > 0) parts.push(ctx.outDir ? `out: ${ctx.outDir}` : 'out: beside each input')
  else if (ctx.out) {
    const dir = (p: string): string => p.slice(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1)
    parts.push(ctx.input && dir(ctx.input) === dir(ctx.out) ? 'out: beside input' : `out: ${baseName(ctx.out)}`)
  }
  return parts.join(' · ')
}
