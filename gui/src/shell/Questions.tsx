// The two questions of the window (moved from App.tsx, P2a PR s, unchanged):
// the close guard's "Cancel run and quit" or "Keep running", and the
// overwrite question asked before a run, never after.

import type { JSX } from 'react'
import type { OverwriteAsk } from '../run/runReducer'

export interface CloseQuestionProps {
  // What was asked: closing the window or quitting.
  what: 'close' | 'quit'
  // A batch is queued or running.
  batch: boolean
  batchRunning: boolean
  // true: cancel the run and quit; false: keep running.
  onAnswer(quit: boolean): void
}

/// The backend's close guard: closing or quitting would kill the run.
export function CloseQuestion({ what, batch, batchRunning, onAnswer }: CloseQuestionProps): JSX.Element {
  return (
      // The backend's close guard: closing or quitting would kill the run.
      <div className="modal-backdrop">
        <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="close-ask-h" aria-describedby="close-ask-p">
          <h2 id="close-ask-h">{batch ? 'A batch is running' : 'FASTag is running'}</h2>
          <p id="close-ask-p">
            {what === 'quit' ? 'Quitting' : 'Closing the window'} stops the run
            {batchRunning ? ' and the rest of the batch' : ''}, and removes the files it has written so far.
          </p>
          <div className="row actions">
            <button
              className="danger"
              onClick={() => {
                onAnswer(true)
              }}
            >
              Cancel run and quit
            </button>
            <button
              className="secondary"
              autoFocus
              onClick={() => {
                onAnswer(false)
              }}
            >
              Keep running
            </button>
          </div>
        </div>
      </div>
  )
}

/// Outputs that already exist: asked before the run, never after.
export function OverwriteQuestion({ ask, onAnswer }: { ask: OverwriteAsk; onAnswer(overwrite: boolean): void }): JSX.Element {
  return (
      // Outputs that already exist: asked before the run, never after.
      <div className="modal-backdrop">
        <div
          className="modal"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="overwrite-ask-h"
          aria-describedby="overwrite-ask-p"
        >
          <h2 id="overwrite-ask-h">
            {ask.files.length === 1 ? 'An output already exists' : `${ask.files.length} outputs already exist`}
          </h2>
          <p id="overwrite-ask-p">
            The run writes over {ask.files.length === 1 ? 'this file' : 'these files'}. If it is cancelled or
            fails, {ask.files.length === 1 ? 'it is' : 'they are'} removed, not restored.
          </p>
          <ul className="overwrite-list">
            {ask.files.slice(0, 12).map((f) => (
              <li key={f}>
                <code>{f}</code>
              </li>
            ))}
            {ask.files.length > 12 && <li>and {ask.files.length - 12} more</li>}
          </ul>
          <div className="row actions">
            <button
              className="danger"
              onClick={() => {
                onAnswer(true)
              }}
            >
              Overwrite and run
            </button>
            <button
              className="secondary"
              autoFocus
              onClick={() => {
                onAnswer(false)
              }}
            >
              Don't run
            </button>
          </div>
        </div>
      </div>
  )
}
