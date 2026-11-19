// The plan row of the run bar (doc/GUI-WORKFLOWS.md 3): what a run does in
// one line, Copy command line and Export INI…. Both send the request Run
// would send (useRun paramsFor): the command line is fastag.rs build_args,
// the INI is that argv merged by the CLI itself (ini.rs).

import { useEffect, useRef, useState, type JSX } from 'react'
import type { Session } from './useSession'
import type { RunState } from '../run/useRun'
import { planLine } from './plan'
import { shellLine } from '../app/format'
import { baseName } from '../digestReport'
import { stripExt } from '../app/paths'

/// Where Export INI offers to write: beside the tags output, named after it.
export function iniName(out: string): string {
  if (!out) return 'FASTag.ini'
  const stem = out.endsWith('.tags.tsv') ? out.slice(0, -'.tags.tsv'.length) : stripExt(out)
  return `${stem}.ini`
}

export default function PlanFooter({ session, run }: { session: Session; run: RunState }): JSX.Element {
  const { values, input, out, originText } = session
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null)
  const [ini, setIni] = useState<{ ok: boolean; text: string } | null>(null)
  const revision = useRef(0)
  useEffect(() => {
    setCopied(null)
    setIni(null)
    return () => {
      revision.current++
    }
  }, [values, input, out])

  async function copy(): Promise<void> {
    const started = revision.current
    try {
      const argv = await window.fastag.commandLine(run.paramsFor())
      if (revision.current !== started) return
      await navigator.clipboard.writeText(shellLine(argv))
      if (revision.current === started) setCopied('yes')
    } catch {
      if (revision.current === started) setCopied('no')
    }
  }

  async function exportIni(): Promise<void> {
    const started = revision.current
    const params = run.paramsFor()
    setIni(null)
    try {
      const dest = await window.fastag.saveFile(iniName(out), ['ini'])
      if (!dest) return
      const r = await window.fastag.exportIni(params, dest)
      const name = baseName(r.dest)
      if (revision.current === started) setIni({ ok: true, text: `INI written: ${name}. The command line runs it with FASTag -ini ${name}` })
    } catch (e) {
      if (revision.current === started) setIni({ ok: false, text: `Export INI failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  const label = originText.replace(/^preset /, '')
  return (
    <div className="plan-footer" role="region" aria-label="Plan">
      <p className="plan-line">{planLine(label === 'FASTag defaults' ? 'FASTag' : label, values, { input, files: run.jobs.length, outDir: run.outDir })}</p>
      <div className="row tight plan-actions">
        <button type="button" className="secondary small" onClick={copy} disabled={!input || run.jobs.length > 0}>
          {copied === 'yes' ? 'Copied' : 'Copy command line'}
        </button>
        <button type="button" className="secondary small" onClick={exportIni} title="Write these settings as an INI file the FASTag command line reads">
          Export INI…
        </button>
      </div>
      {copied === 'no' && <p className="muted">The clipboard refused the command.</p>}
      {ini &&
        (ini.ok ? (
          <p className="hint" role="status">
            {ini.text}
          </p>
        ) : (
          <p className="warn" role="alert">
            {ini.text}
          </p>
        ))}
    </div>
  )
}
