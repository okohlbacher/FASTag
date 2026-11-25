// Tiles as links (feedback a8f957f6): an Overview tile opens the tab that
// shows its detail, at its section where the tab has one, and a Run QC tile
// moves to its section on the page. A tile whose tab is not shown has no
// link. Keyboard focus goes to the heading of what opens.

import type { Tab } from '../app/viewStore'

export const TAB_LABEL: Record<Tab, string> = {
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

/// The ids of the Run QC page's section headings (ReportTable QcView).
export const QC_SECTION = {
  spectra: 'qc-sec-spectra',
  charge: 'qc-sec-charge',
  reporters: 'qc-sec-reporters'
} as const

/// Where a tile leads: a tab, and the ids of the headings to focus in it,
/// the first one on the page (none, or none there: the tab's own heading).
export interface TileTarget {
  tab: Tab
  sections?: string[]
}

/// The tab of each Overview tile (overview.ts ids); the first one shown wins.
const TILE_TABS: Record<string, TileTarget[]> = {
  spectra: [{ tab: 'qc', sections: [QC_SECTION.spectra] }],
  instrument: [{ tab: 'qc' }],
  tagged: [{ tab: 'triage' }],
  tags: [{ tab: 'results' }],
  filtered: [{ tab: 'digest', sections: ['dg-digest'] }],
  glyco: [{ tab: 'glyco' }],
  'qc-tagged': [{ tab: 'qc' }],
  'qc-charge': [{ tab: 'qc', sections: [QC_SECTION.charge] }],
  'qc-kit': [{ tab: 'qc', sections: [QC_SECTION.reporters] }],
  'qc-redundancy': [{ tab: 'qc' }],
  shortlist: [{ tab: 'shortlist' }],
  'ident-score': [{ tab: 'triage' }],
  identified: [{ tab: 'triage' }],
  candidates: [{ tab: 'triage' }],
  placed: [{ tab: 'recon' }],
  topshift: [{ tab: 'recon' }],
  protease: [{ tab: 'digest', sections: ['dg-digest'] }],
  genus: [{ tab: 'species' }],
  label: [{ tab: 'digest', sections: ['dg-label'] }],
  // The call of the alkylation report, else of the mass-gap report.
  alkylation: [{ tab: 'digest', sections: ['dg-alk', 'dg-gap'] }]
}

/// The Overview tile @p t leads to among the tabs shown, or null: no tab
/// for it, or a tile that only offers to add its report (nothing to see).
export function tileTarget(t: { id: string; tone: string; action?: unknown }, tabs: readonly Tab[]): TileTarget | null {
  if (t.tone === 'off' && t.action) return null
  return (TILE_TABS[t.id] ?? []).find((x) => tabs.includes(x.tab)) ?? null
}

/// The section of each Run QC tile (qcModel.ts labels).
export const QC_TILE_SECTION: Record<string, string> = {
  'MS2 spectra': QC_SECTION.spectra,
  'Isobaric kit': QC_SECTION.reporters
}

/// Focus @p el as a heading: reachable by script only, not by Tab.
export function focusHeading(el: HTMLElement): void {
  if (!el.hasAttribute('tabindex')) el.tabIndex = -1
  el.focus()
  el.scrollIntoView?.({ block: 'start' })
}

/// Once @p tab is the one shown, focus its heading: the first of
/// @p sections on the page, else the tab's first heading, else the tab
/// itself. Some tabs read their file first, so it looks again for a while.
export function focusTab(tab: Tab, sections: readonly string[] = [], tries = 40): void {
  const find = (): HTMLElement | null => {
    const panel = document.getElementById('tabpanel')
    if (!panel || panel.getAttribute('aria-labelledby') !== `tab-${tab}`) return null
    for (const id of sections) {
      const el = document.getElementById(id)
      if (el && panel.contains(el)) return el
    }
    return panel.querySelector<HTMLElement>('h2')
  }
  const step = (left: number): void => {
    const el = find()
    if (el) return focusHeading(el)
    if (left > 0) setTimeout(() => step(left - 1), 50)
    else document.getElementById(`tab-${tab}`)?.focus()
  }
  setTimeout(() => step(tries))
}
