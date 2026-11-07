// The full shortcut set of P2a (GUI-DESIGN 2 "Native menus"): Cmd+1..4 for
// the views; every native menu action (menu.rs) is an action of the
// renderer.
import { describe, expect, it } from 'vitest'
import { ACTIONS, actionOfKey, viewOfAction } from '../setup/shortcuts'

const ev = (key: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey', boolean>> = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  target: null,
  ...mods
})

describe('P2a shortcuts', () => {
  it('Cmd+1..4 switch the views on macOS, Ctrl+1..4 elsewhere', () => {
    expect(actionOfKey(ev('1', { metaKey: true }), true)).toBe('view-setup')
    expect(actionOfKey(ev('2', { metaKey: true }), true)).toBe('view-results')
    expect(actionOfKey(ev('3', { metaKey: true }), true)).toBe('view-batch')
    expect(actionOfKey(ev('4', { metaKey: true }), true)).toBe('view-history')
    expect(actionOfKey(ev('3', { ctrlKey: true }), false)).toBe('view-batch')
    expect(actionOfKey(ev('1'), true)).toBeNull()
    expect(actionOfKey(ev('5', { metaKey: true }), true)).toBeNull()
  })

  it('names the view of each view action', () => {
    expect(viewOfAction('view-setup')).toBe('setup')
    expect(viewOfAction('view-results')).toBe('results')
    expect(viewOfAction('view-batch')).toBe('batch')
    expect(viewOfAction('view-history')).toBe('history')
    expect(viewOfAction('run')).toBeNull()
  })

  it('knows every native menu action', () => {
    // menu.rs FILE, RUN, VIEWS, SEARCH, THEMES, HELP (cargo checks that side).
    const menu = [
      'open-spectra',
      'open-results',
      'export',
      'reveal',
      'run',
      'cancel',
      'view-setup',
      'view-results',
      'view-batch',
      'view-history',
      'search-params',
      'theme-system',
      'theme-light',
      'theme-dark',
      'help',
      'faq',
      'about'
    ]
    expect([...ACTIONS].sort()).toEqual([...menu].sort())
  })
})
