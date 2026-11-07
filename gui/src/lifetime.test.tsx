// P1 PR b, process lifetime: the startup sweep's offer (GUI-DESIGN 6.4 and
// 6.6, sweep.rs). The backend half (what is listed, what may be removed) is
// tested in cargo; here the user sees the files and decides.

import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import { installMockBridge } from './testing/mockBridge'

async function renderApp(): Promise<HTMLElement> {
  const { container } = render(<App />)
  await screen.findByText('FASTag ready')
  await act(async () => {})
  return container
}

const click = (el: Element): Promise<void> =>
  act(async () => {
    fireEvent.click(el)
  })

const LEFT = ['/d/a.tags.tsv', '/d/a.digest.tsv.part']

describe('P1: files an unfinished run left are offered at startup', () => {
  it('nothing is shown when nothing was left', async () => {
    installMockBridge()
    await renderApp()
    expect(screen.queryByRole('region', { name: /left by an unfinished run/ })).toBeNull()
  })

  it('lists them and removes them only on the click', async () => {
    const mock = installMockBridge()
    mock.leftoverFiles = [...LEFT]
    await renderApp()
    const box = screen.getByRole('region', { name: 'Files left by an unfinished run' })
    expect(box.textContent).toContain('/d/a.tags.tsv')
    expect(box.textContent).toContain('/d/a.digest.tsv.part')
    expect(mock.sweepCalls).toEqual([])
    await click(screen.getByRole('button', { name: 'Remove them' }))
    expect(mock.sweepCalls).toEqual([LEFT])
    expect(screen.queryByRole('region', { name: /left by an unfinished run/ })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says which files could not be removed', async () => {
    const mock = installMockBridge()
    mock.leftoverFiles = [...LEFT]
    mock.sweepFails = ['/d/a.tags.tsv']
    await renderApp()
    await click(screen.getByRole('button', { name: 'Remove them' }))
    expect(screen.getByRole('alert').textContent).toContain('Could not remove: /d/a.tags.tsv')
  })

  it('Keep removes nothing and does not ask again', async () => {
    const mock = installMockBridge()
    mock.leftoverFiles = ['/d/a.tags.tsv.incomplete']
    await renderApp()
    await click(screen.getByRole('button', { name: 'Keep' }))
    expect(mock.sweepCalls).toEqual([])
    expect(mock.keepCalls).toEqual([['/d/a.tags.tsv.incomplete']])
    expect(screen.queryByRole('region', { name: /left by an unfinished run/ })).toBeNull()
  })
})
