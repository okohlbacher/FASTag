// The startup sweep (GUI-DESIGN 6.4 and 6.6, sweep.rs): files that an
// unfinished run left behind are offered for removal once, when the app
// starts. Nothing is removed without the click, and only the files the
// backend lists can be removed.

import { useEffect, useState, type JSX } from 'react'
import { IconError } from './icons'

export function Leftovers(): JSX.Element | null {
  const [files, setFiles] = useState<string[]>([])
  const [failed, setFailed] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    window.fastag
      .leftovers()
      .then((f) => {
        if (live) setFiles(f)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  if (files.length === 0 && failed.length === 0) return null

  const remove = async (): Promise<void> => {
    setBusy(true)
    try {
      const c = await window.fastag.sweepLeftovers(files)
      setFailed(c.failed)
      setFiles([])
    } catch {
      setFailed(files)
      setFiles([])
    } finally {
      setBusy(false)
    }
  }
  const keep = async (): Promise<void> => {
    setBusy(true)
    await window.fastag.keepLeftovers(files).catch(() => {})
    setFiles([])
    setBusy(false)
  }

  return (
    <section className="block leftovers" aria-labelledby="leftovers-h">
      <h2 id="leftovers-h">{files.length ? 'Files left by an unfinished run' : 'Leftover files'}</h2>
      {files.length > 0 && (
        <>
          <p className="muted">
            A run that was cancelled, failed or was still going when FASTag ended left {files.length === 1 ? 'this file' : 'these files'}. {files.length === 1 ? 'It is' : 'They are'} incomplete.
          </p>
          <ul className="leftovers-list">
            {files.map((f) => (
              <li key={f}>
                <code>{f}</code>
              </li>
            ))}
          </ul>
          <div className="row">
            <button type="button" className="secondary small" disabled={busy} onClick={() => void remove()}>
              {files.length === 1 ? 'Remove it' : 'Remove them'}
            </button>
            <button type="button" className="secondary small" disabled={busy} onClick={() => void keep()}>
              Keep
            </button>
          </div>
        </>
      )}
      {failed.length > 0 && (
        <p className="warn" role="alert">
          <IconError />
          <span>Could not remove: {failed.join(', ')}</span>
        </p>
      )}
    </section>
  )
}
