// The native disclosure wiring (P5): a click flips React's state at once, a
// toggle the browser makes itself (find-in-page) is mirrored, and the
// summary keeps the button semantics of the toggle it replaced.
import { describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState, type JSX } from 'react'
import { disclosure } from './disclosure'

function Box({ start = false }: { start?: boolean }): JSX.Element {
  const [open, setOpen] = useState(start)
  const d = disclosure(open, setOpen)
  return (
    <details {...d.details}>
      <summary {...d.summary}>Section</summary>
      {open && <p>body</p>}
    </details>
  )
}

describe('disclosure', () => {
  it('is a details/summary announced as a button with its expanded state', () => {
    const { container } = render(<Box />)
    const s = screen.getByRole('button', { name: 'Section' })
    expect(s.tagName).toBe('SUMMARY')
    expect(s.getAttribute('aria-expanded')).toBe('false')
    expect((container.querySelector('details') as HTMLDetailsElement).open).toBe(false)
  })

  it('opens and closes on a click, synchronously, with the body built only while open', () => {
    const { container } = render(<Box />)
    const s = screen.getByRole('button', { name: 'Section' })
    fireEvent.click(s)
    expect(s.getAttribute('aria-expanded')).toBe('true')
    expect((container.querySelector('details') as HTMLDetailsElement).open).toBe(true)
    expect(screen.getByText('body')).toBeTruthy()
    fireEvent.click(s)
    expect(s.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('body')).toBeNull()
  })

  it('follows a toggle the browser makes on its own', () => {
    const { container } = render(<Box />)
    const d = container.querySelector('details') as HTMLDetailsElement
    act(() => {
      d.open = true
      d.dispatchEvent(new Event('toggle'))
    })
    expect(screen.getByRole('button', { name: 'Section' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('body')).toBeTruthy()
  })
})
