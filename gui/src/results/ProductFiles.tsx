// Files a run wrote that no viewer here shows (the reduced FASTA, the engine
// configuration, an idXML or mzid -recon_id_out): each is a row with its
// name, an optional note, and buttons to reveal it in the file manager or
// open it in the app the system gives its type. Never an error: the run
// wrote the file on purpose. The backend reveals only outputs of a run of
// this app, and opens (reveal.rs may_open) only these types (idXML, mzid,
// mzTab, FASTA, the engine configuration) when a run of this session ended
// with exit 0 having written them, or the file was dropped on the window,
// and only while it is still that file; a failure says why in the row's own
// line.

import { useState, type JSX } from 'react'
import { baseName } from '../digestReport'
import { revealLabel } from '../app/paths'

export interface ProductFile {
  label: string
  path: string
  /// Why it is a file here, e.g. "idXML, for identification tools; not shown here".
  note?: string
}

export default function ProductFiles({ files, label = 'Files' }: { files: readonly ProductFile[]; label?: string }): JSX.Element | null {
  const [err, setErr] = useState<string | null>(null)
  if (files.length === 0) return null
  const fail = (verb: string, path: string) => (e: unknown) =>
    setErr(`Cannot ${verb} ${baseName(path)}: ${e instanceof Error ? e.message : String(e)}`)
  return (
    <div className="written-files" role="group" aria-label={label}>
      {files.map((f) => (
        <div className="row tight written-file" key={f.path}>
          <button
            type="button"
            className="secondary small"
            title={f.path}
            onClick={() => {
              setErr(null)
              window.fastag.revealOutput(f.path, false).catch(fail('reveal', f.path))
            }}
          >
            {revealLabel()}: {f.label} ({baseName(f.path)})
          </button>
          <button
            type="button"
            className="secondary small"
            title={f.path}
            aria-label={`Open ${f.label} (${baseName(f.path)}) with the default app`}
            onClick={() => {
              setErr(null)
              window.fastag.openOutput(f.path).catch(fail('open', f.path))
            }}
          >
            Open with default app
          </button>
          {f.note && <span className="muted">{f.note}</span>}
        </div>
      ))}
      {err && (
        <p className="warn" role="alert">
          {err}
        </p>
      )}
    </div>
  )
}
