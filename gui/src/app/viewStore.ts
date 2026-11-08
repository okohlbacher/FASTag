// The view state of one App (GUI-DESIGN 5, P1 PR c): which result tab is
// shown and what the log drawer shows. It lives outside React and is read
// with useSyncExternalStore, so the run logic (useRun) can switch the tab
// without owning it. One store per App instance: a module-level store would
// be shared by every test that renders an App.
//
// The per-results-path keying of section 5 (sort, filters and scroll that
// survive a tab switch) lands with the ResultsTable work of P3; until then
// that state stays in ResultsTable, unchanged.

import { useSyncExternalStore } from 'react'

// spectrum: P4, only with a CLI that has -dump_spectrum (spectrum/).
// recon, glyco: P4c, the Mass gaps & recon and Glyco viewers.
export type Tab = 'overview' | 'results' | 'spectrum' | 'species' | 'digest' | 'recon' | 'glyco'

export interface ViewState {
  tab: Tab
  // The log drawer: collapsed to its last line unless opened.
  logOpen: boolean
  // The batch job whose log the drawer shows; null: the live log.
  logJob: string | null
}

type Update<T> = T | ((cur: T) => T)

export interface ViewStore {
  get(): ViewState
  subscribe(listener: () => void): () => void
  setTab(t: Update<Tab>): void
  setLogOpen(o: Update<boolean>): void
  setLogJob(j: string | null): void
}

export function createViewStore(init: Partial<ViewState> = {}): ViewStore {
  let state: ViewState = { tab: 'results', logOpen: false, logJob: null, ...init }
  const listeners = new Set<() => void>()
  // Like a React state setter: no change, no new snapshot and no notice.
  const set = <K extends keyof ViewState>(k: K, u: Update<ViewState[K]>): void => {
    const next = typeof u === 'function' ? (u as (cur: ViewState[K]) => ViewState[K])(state[k]) : u
    if (Object.is(next, state[k])) return
    state = { ...state, [k]: next }
    for (const l of listeners) l()
  }
  return {
    get: () => state,
    subscribe(l) {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
    setTab: (t) => set('tab', t),
    setLogOpen: (o) => set('logOpen', o),
    setLogJob: (j) => set('logJob', j)
  }
}

/// The store's state, re-rendering the caller on each change.
export function useView(store: ViewStore): ViewState {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}
