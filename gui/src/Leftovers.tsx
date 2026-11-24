// The startup sweep (GUI-DESIGN 6.4 and 6.6, sweep.rs): files that an
// unfinished run left behind are offered for removal once, when the app
// starts. Nothing is removed without the click, and only the files the
// backend lists can be removed.

import { useEffect, useState, type JSX } from 'react'
import { IconError, IconFlag } from './icons'

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

  const n = files.length
  const one = n === 1
  // One compact notice at the right of the stepper (SPEC: step 1 fits
  // 1280 x 800 with all seven tiles): the title and the two choices; what
  // the files are and their paths open from "Show" below it.
  return (
    <section className={`leftovers${n ? ' has-files' : ''}`} aria-labelledby="leftovers-h">
      {n > 0 && <IconFlag />}
      <h2 id="leftovers-h">{n ? 'Files left by an unfinished run' : 'Leftover files'}</h2>
      {n > 0 && (
        <>
          <details className="leftovers-files">
            <summary>Show {one ? 'the file' : `${n} files`}</summary>
            <div className="leftovers-pop">
              <p className="muted">
                {n} incomplete {one ? 'file' : 'files'} from a run that was cancelled, failed or still going when FASTag ended:
              </p>
              <ul className="leftovers-list">
                {files.map((f) => (
                  <li key={f}>
                    <code>{f}</code>
                  </li>
                ))}
              </ul>
            </div>
          </details>
          <div className="row leftovers-actions">
            <button type="button" className="secondary small" disabled={busy} onClick={() => void remove()}>
              {one ? 'Remove it' : 'Remove them'}
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
