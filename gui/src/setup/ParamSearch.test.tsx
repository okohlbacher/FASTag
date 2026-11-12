import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ParamSearch from './ParamSearch'

afterEach(() => vi.restoreAllMocks())

describe('parameter search accessibility', () => {
  it('focuses the search and closes from its button or Escape without invoking page shortcuts', () => {
    const close = vi.fn()
    const pageKey = vi.fn()
    render(<div onKeyDown={pageKey}><ParamSearch onChoose={vi.fn()} onClose={close} /></div>)
    expect(screen.getByRole('dialog').hasAttribute('open')).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('combobox'))
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'o', metaKey: true })
    const button = screen.getByRole('button', { name: 'Close parameter search' })
    fireEvent.click(button)
    fireEvent.keyDown(button, { key: 'Escape' })
    expect(close).toHaveBeenCalledTimes(2)
    expect(pageKey).not.toHaveBeenCalled()
  })

  it('keeps the keyboard-selected result visible and chooses it with Enter', () => {
    const choose = vi.fn()
    const scroll = vi.fn()
    const previous = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scroll
    try {
      render(<ParamSearch onChoose={choose} onClose={vi.fn()} />)
      const input = screen.getByRole('combobox')
      fireEvent.change(input, { target: { value: 'tag' } })
      const hits = screen.getAllByRole('option')
      expect(hits.length).toBeGreaterThan(2)
      for (let i = 1; i < hits.length; i++) fireEvent.keyDown(input, { key: 'ArrowDown' })
      const last = hits[hits.length - 1]
      expect(input.getAttribute('aria-activedescendant')).toBe(last.id)
      expect(scroll.mock.contexts[scroll.mock.contexts.length - 1]).toBe(last)
      expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest' })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(choose).toHaveBeenCalledWith(expect.objectContaining({ name: last.querySelector('code')!.textContent }))
      fireEvent.change(input, { target: { value: 'no-such-parameter-xyz' } })
      fireEvent.keyDown(input, { key: 'ArrowDown' })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(choose).toHaveBeenCalledTimes(1)
      expect(input.hasAttribute('aria-activedescendant')).toBe(false)
    } finally {
      if (previous) Element.prototype.scrollIntoView = previous
      else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })
})
