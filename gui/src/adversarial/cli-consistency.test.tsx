// @ts-nocheck -- test-only file; uses node APIs and ES2022 helpers outside the app tsconfig
// The GUI and the CLI agree: what the form sends, what the CLI refuses.
//
// End to end, minus Tauri: the real App builds the run request through the
// mock bridge, the shipped fastag.rs build_args() (through the build_args
// example in src-tauri, which `cargo test` builds) turns it into argv, and the FASTag CLI named by FASTAG_BIN runs it on the
// public E. coli fixture. Its stdout/stderr lines are replayed into the GUI in
// the order two concurrent pipe readers receive them (as fastag.rs's two
// reader threads do), and the failure banner the user would see is asserted.
//
// Where the GUI refuses a run up front, the CLI is run directly on the same
// option to show the refusal is its.
// Skipped unless FASTAG_BIN names the CLI, the pipe-order helper is found
// (FASTAG_ORDER_RS, cli/order_rs under FASTAG_GUI_TEST_OUTPUTS, or the
// order_rs example in src-tauri, which `cargo test` builds) and the
// build_args example is built; see ./external.ts.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { execFileSync, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import App from '../App'
import { installMockBridge, type MockBridge } from '../testing/mockBridge'
import { DEFAULTS, LANDING, type Origin } from '../setup/tasks'
import { click, showView } from '../testing/render'
import { applyAndCheck } from '../testing/lastUsed'
import { PARAM_BY_NAME, invalidBecause, invalidParams } from '../paramLayout'
import { FASTAG_BIN, ORDER_RS, REPO_FIXTURES_DIR, SRC_TAURI_DIR } from './external'

const BA = join(SRC_TAURI_DIR, 'target', 'debug', 'examples', 'build_args')
const FASTAG = FASTAG_BIN
const FIX = `${REPO_FIXTURES_DIR}Ecoli_MS2_small`
const ORDER = ORDER_RS
const ready = FASTAG !== '' && ORDER !== '' && existsSync(BA) && existsSync(`${FIX}.mzML`)
// A fresh directory per run; realpath, as the GUI and the CLI see the folder.
const S = ready ? realpathSync(mkdtempSync(join(tmpdir(), 'fastag-cli-consistency-'))) : ''
const IN = `${S}/ecoli.mzML`
const FA = `${S}/ecoli.fasta`
if (ready) {
  copyFileSync(`${FIX}.mzML`, IN)
  copyFileSync(`${FIX}.fasta`, FA)
}

interface Outcome {
  argv: string[]
  rc: number | null
  lines: { src: 'out' | 'err'; line: string }[]
  banner: string | null
  mock: MockBridge
}

// Two blocking reader threads, one per pipe, exactly as fastag.rs run() does
// (scratch/cli/order_rs): Node's event loop orders simultaneous pipe data
// differently from two OS threads, so the arrival order is taken from Rust.
function runCli(argv: string[]): Promise<{ rc: number | null; lines: Outcome['lines'] }> {
  return new Promise((resolve) => {
    const p = spawn(ORDER, [FASTAG, ...argv], { cwd: S, env: { ...process.env, OPENBLAS_NUM_THREADS: '1' } })
    let text = ''
    p.stdout.on('data', (d: Buffer) => (text += d.toString('utf8')))
    p.on('close', () => {
      const [head, ...rest] = text.replace(/\n$/, '').split('\n')
      const rc = head.split('\t')[1] === 'null' ? null : Number(head.split('\t')[1])
      const lines = rest.map((l) => {
        const t = l.indexOf('\t')
        return { src: l.slice(0, t) as 'out' | 'err', line: l.slice(t + 1) }
      })
      resolve({ rc, lines })
    })
  })
}

async function guiRun(opts: {
  lastUsed?: Record<string, unknown>
  out?: string
  ui?: () => Promise<void>
  name: string
  /// Where the session starts. FASTag's defaults unless a test asks for the
  /// landing task: the app lands on "Export tags", which adds per-residue
  /// confidence, and each test here states its options as a
  /// diff over the CLI's defaults (as renderApp in testing/render.tsx does).
  start?: Origin
}): Promise<Outcome> {
  const mock = installMockBridge()
  if (opts.lastUsed) mock.settings.lastUsed = opts.lastUsed
  render(<App start={opts.start ?? DEFAULTS} />)
  await screen.findByText('FASTag ready')
  await act(async () => {})
  if (opts.lastUsed) await applyAndCheck(opts.lastUsed) // D6: the offer, clicked; guards the form
  mock.nextPickInput = IN
  await click(screen.getByRole('button', { name: /^(Choose file|Change)…$/ }))
  const outField = screen.getByLabelText(/Tags TSV/) as HTMLInputElement
  await act(async () => {
    fireEvent.change(outField, { target: { value: opts.out ?? `${S}/${opts.name}.tags.tsv` } })
  })
  if (opts.ui) await opts.ui()
  await click(screen.getByRole('button', { name: /^Run( on .+)?$/ }))
  const call = mock.runCalls[0]
  const argv = JSON.parse(
    execFileSync(BA, { input: JSON.stringify({ in: call.in, out: call.out, params: call.params }) }).toString()
  ) as string[]
  const { rc, lines } = await runCli(argv)
  // Each line on the stream it came on, as fastag.rs's Log events carry it.
  for (const l of lines) await act(async () => mock.emitEvent(mock.lastRunId, { kind: 'log', lines: [[l.line, l.src === 'err']] }))
  await act(async () => mock.emitDone({ runId: mock.lastRunId, ok: rc === 0, code: rc }))
  const banner = screen.queryByRole('alert')?.textContent ?? null
  return { argv, rc, lines, banner, mock }
}

// The GUI up to the point of Run, for a form the GUI refuses to run.
async function guiBlocked(lastUsed: Record<string, unknown>): Promise<{ mock: MockBridge; run: HTMLButtonElement; controls: string }> {
  const mock = installMockBridge()
  mock.settings.lastUsed = lastUsed
  // From FASTag's defaults, as guiRun.
  const { container } = render(<App start={DEFAULTS} />)
  await screen.findByText('FASTag ready')
  await act(async () => {})
  await applyAndCheck(lastUsed) // D6: the offer, clicked; guards the form
  mock.nextPickInput = IN
  await click(screen.getByRole('button', { name: /^(Choose file|Change)…$/ }))
  const run = screen.getByRole('button', { name: /^Run( on .+)?$/ }) as HTMLButtonElement
  await click(run)
  return { mock, run, controls: container.querySelector('.controls')?.textContent ?? '' }
}
// Setup's section, which is hidden while a finished run shows its Results.
const openMatching = (): Promise<void> => {
  showView('setup')
  return click(screen.getAllByRole('button').find((b) => b.className === 'disclosure' && /Sequence matching/.test(b.textContent ?? ''))!)
}
// The CLI on its own, with defaults plus @p extra.
const cliDirect = (name: string, extra: string[]) =>
  runCli(['-in', IN, '-out', `${S}/${name}.tags.tsv`, '-threads', '1', ...extra])

const argOf = (argv: string[], name: string): string | undefined => {
  const i = argv.indexOf(`-${name}`)
  return i < 0 ? undefined : argv[i + 1]
}

describe.skipIf(!ready)('GUI-built argv against the FASTag CLI (FASTAG_BIN)', () => {
  it('a default run is accepted and sends every rendered default explicitly', async () => {
    const o = await guiRun({ name: 'defaults' })
    expect(o.rc).toBe(0)
    expect(o.banner).toBeNull()
    expect(argOf(o.argv, 'threads')).toBe('0')
    expect(argOf(o.argv, 'tag_length')).toBe('3')
    expect(o.argv).not.toContain('-species')
  }, 30000)

  it('the landing Export tags task processes all spectra with confidence and no survey reports', async () => {
    const o = await guiRun({ name: 'landing', start: LANDING })
    expect(o.rc).toBe(0)
    expect(o.banner).toBeNull()
    expect(o.argv).toContain('-res_conf')
    expect(argOf(o.argv, 'subsample_spectra')).toBe('0')
    expect(argOf(o.argv, 'subsample_fraction')).toBe('0.0')
    for (const name of ['species', 'glyco', 'digest_out', 'label_out', 'species_out', 'glyco_out']) {
      expect(o.argv).not.toContain(`-${name}`)
    }
    expect(readFileSync(`${S}/landing.tags.tsv`, 'utf8').split('\n')[0].split('\t')).toContain('res_conf')
  }, 30000)

  it('the optional Characterize task is accepted and writes its survey reports', async () => {
    const o = await guiRun({ name: 'characterize', start: { kind: 'builtin', id: 'characterize' } })
    expect(o.rc).toBe(0)
    expect(o.banner).toBeNull()
    expect(o.argv).toContain('-species')
    expect(argOf(o.argv, 'extension')).toBe('2')
    expect(o.argv).toContain('-glyco')
    expect(argOf(o.argv, 'subsample_fraction')).toBe('0.1')
    // The task's reports, on the input's stem beside it (rebaseOutputs on Choose file).
    for (const r of ['digest', 'label']) {
      expect(argOf(o.argv, `${r}_out`)).toBe(`${S}/ecoli.${r}.tsv`)
      expect(existsSync(`${S}/ecoli.${r}.tsv`)).toBe(true)
    }
  }, 120000)

  it('cleared fixed modifications reach the CLI as -fixed_modifications ""', async () => {
    const o = await guiRun({ name: 'nofixed', lastUsed: { fixed_modifications: [''] } })
    expect(argOf(o.argv, 'fixed_modifications')).toBe('')
    expect(o.rc).toBe(0)
    expect(o.lines.some((l) => /Carbamidomethyl/.test(l.line))).toBe(false)
  }, 30000)

  it('the Da unit chosen in the dropdown reaches the CLI, and the digest report says no_call (low_resolution)', async () => {
    const o = await guiRun({
      name: 'da',
      lastUsed: { tag_length: '4', digest_out: `${S}/da.digest.tsv` },
      ui: async () => {
        await act(async () => {
          fireEvent.change(document.getElementById('p-fragment_tolerance')!, { target: { value: '0.3' } })
          fireEvent.change(document.getElementById('p-fragment_tolerance_unit')!, { target: { value: 'Da' } })
        })
      }
    })
    expect(argOf(o.argv, 'fragment_tolerance_unit')).toBe('Da')
    expect(o.rc).toBe(0)
    // Choose file rebased the configured digest_out onto the input's stem.
    expect(argOf(o.argv, 'digest_out')).toBe(`${S}/ecoli.digest.tsv`)
    expect(readFileSync(`${S}/ecoli.digest.tsv`, 'utf8')).toMatch(/^call\treason\tlow_resolution/m)
  }, 30000)

  it('inactive options are not sent (gap_penalty with gaps 0, massgap/delta without recon, species_out with species off)', async () => {
    const o = await guiRun({
      name: 'inert',
      lastUsed: { gaps: '0', gap_penalty: '5', massgap_out: `${S}/x.mg.tsv`, delta_out: `${S}/x.d.tsv`, species_out: `${S}/x.sp.tsv` }
    })
    for (const n of ['gap_penalty', 'massgap_out', 'delta_out', 'species_out']) expect(o.argv).not.toContain(`-${n}`)
    expect(o.rc).toBe(0)
  }, 30000)

  it('-max_peaks 2000, which the CLI refuses, is caught in the form and never sent', async () => {
    const g = await guiBlocked({ max_peaks: '2000' })
    expect(g.run.disabled).toBe(true)
    expect(g.mock.runCalls).toHaveLength(0)
    expect(g.controls).toMatch(/Max peaks \(must be at most 1024\)/)
    const d = await cliDirect('mp', ['-max_peaks', '2000'])
    expect(d.rc).toBe(6)
    expect(d.lines.some((l) => /Invalid integer parameter value '2000' for parameter 'max_peaks'/.test(l.line))).toBe(true)
  }, 30000)

  it('a FASTag refusal after start-up is quoted in the banner, not the "FASTag took" timing line', async () => {
    // -species with the GUI default tag_length 3: Run is enabled, the CLI refuses.
    const o = await guiRun({ name: 'sp3', lastUsed: { species: true } })
    expect(o.rc).toBe(6)
    const refusal = o.lines.find((l) => /cannot reach the index k = 7/.test(l.line))
    expect(refusal?.src).toBe('err')
    // Separate stdout/stderr readers can deliver either line last.
    // lifecycle.test.tsx also checks a deterministic trailing timing line.
    expect(o.lines.some((l) => l.src === 'out' && /^FASTag took/.test(l.line))).toBe(true)
    expect(o.banner).toMatch(/^ecoli\.mzML failed \(exit code 6\)FASTag's reason:-species: .*cannot reach the index k = 7/)
    expect(o.banner).not.toMatch(/FASTag took/)
  }, 30000)

  it('outputs aliasing each other are refused, and the banner says so', async () => {
    // digest_out is rebased to <dir>/ecoli.digest.tsv on Choose file; the user then types that as Output.
    const o = await guiRun({ name: 'alias', lastUsed: { digest_out: `${S}/x.tsv` }, out: `${S}/ecoli.digest.tsv` })
    expect(argOf(o.argv, 'digest_out')).toBe(argOf(o.argv, 'out'))
    expect(o.rc).toBe(6)
    expect(o.lines.some((l) => /-digest_out and -out name the same file/.test(l.line))).toBe(true)
    expect(o.banner).toMatch(/-digest_out and -out name the same file/)
  }, 30000)

  it('out_spectra = the input is refused (input survives) and the banner says why', async () => {
    const before = readFileSync(IN).length
    const o = await guiRun({
      name: 'aliasin',
      ui: async () => {
        await click(screen.getByRole('button', { name: /^Output (defaults|\d+ changed)$/ }))
        await act(async () => {
          fireEvent.change(document.getElementById('p-out_spectra')!, { target: { value: IN } })
        })
      }
    })
    expect(o.rc).toBe(6)
    expect(argOf(o.argv, 'out_spectra')).toBe(IN) // a single run does not rebase an output typed AFTER the pick
    expect(o.lines.some((l) => /is the input file; writing it would destroy the input/.test(l.line))).toBe(true)
    expect(readFileSync(IN).length).toBe(before)
    expect(o.banner).toMatch(/is the input file; writing it would destroy the input/)
  }, 30000)

  it('-entrapment_fasta + -species, which the CLI refuses, is refused beside Run', async () => {
    const g = await guiBlocked({ species: true, tag_length: '7', fasta: FA, entrapment_fasta: FA })
    expect(g.run.disabled).toBe(true)
    expect(g.mock.runCalls).toHaveLength(0)
    expect(g.controls).toMatch(/entrapment_fasta cannot be combined with species/)
    const d = await cliDirect('ent', ['-species', '-tag_length', '7', '-fasta', FA, '-entrapment_fasta', FA])
    expect(d.rc).toBe(6)
    expect(d.lines.some((l) => /cannot be combined with -species/.test(l.line))).toBe(true)
  }, 60000)

  it('a non-integer in an int field ("7.0", "1e2") is caught in the form; the CLI would give a ConversionError', async () => {
    expect(invalidBecause(PARAM_BY_NAME.get('tag_length')!, '7.0')).toBe('a whole number is required')
    expect(invalidParams({ max_peaks: '2000' }).max_peaks).toBe('must be at most 1024')
    const g = await guiBlocked({ tag_length: '7.0' })
    expect(g.run.disabled).toBe(true)
    expect(g.mock.runCalls).toHaveLength(0)
    const d = await cliDirect('dec', ['-tag_length', '7.0'])
    expect(d.rc).toBe(6)
    expect(d.lines.some((l) => /ConversionError\): Prefix of string '7\.0'/.test(l.line))).toBe(true)
  }, 30000)

  it('tag_lengths typed comma-separated on one line is caught ("one value per line"); the CLI would refuse it', async () => {
    expect(invalidBecause(PARAM_BY_NAME.get('tag_lengths')!, ['7, 8'])).toBe('one value per line')
    const g = await guiBlocked({ tag_lengths: ['7, 8'] })
    expect(g.run.disabled).toBe(true)
    expect(g.mock.runCalls).toHaveLength(0)
    const d = await cliDirect('tls', ['-tag_lengths', '7, 8'])
    expect(d.rc).toBe(6)
    expect(d.lines.some((l) => /ConversionError/.test(l.line))).toBe(true)
  }, 30000)

  it('orientation=reverse is not offered; a stored one is marked invalid and never sent', async () => {
    expect(PARAM_BY_NAME.get('orientation')?.choices).not.toContain('reverse')
    const g = await guiBlocked({ fasta: FA, tag_length: '5', orientation: 'reverse' })
    expect(g.run.disabled).toBe(true)
    expect(g.mock.runCalls).toHaveLength(0)
    await openMatching()
    expect(document.getElementById('p-orientation')?.getAttribute('aria-invalid')).toBe('true')
    const d = await cliDirect('rev', ['-fasta', FA, '-tag_length', '5', '-orientation', 'reverse'])
    expect(d.rc).toBe(6)
    expect(d.lines.some((l) => /Invalid string parameter value 'reverse'/.test(l.line))).toBe(true)
  }, 30000)

  it('with reconciliation against -recon_fasta (no -fasta) the GUI sends orientation and isobaric_tolerance, which the CLI applies to reconciliation', async () => {
    const base = {
      tag_length: '4',
      fragment_tolerance: '0.3',
      fragment_tolerance_unit: 'Da',
      recon_fasta: FA,
      orientation: 'forward',
      isobaric_tolerance: '0'
    }
    const o = await guiRun({ name: 'rc', lastUsed: { ...base, recon_out: `${S}/rc.recon.tsv` } })
    const guiRecon = argOf(o.argv, 'recon_out')!
    expect(o.rc).toBe(0)
    expect(o.argv).toContain('-recon_out')
    expect(argOf(o.argv, 'orientation')).toBe('forward')
    expect(argOf(o.argv, 'isobaric_tolerance')).toBe('0')
    // The fields are live: they affect reconciliation, too.
    await openMatching()
    expect((document.getElementById('p-orientation') as HTMLSelectElement | null)?.disabled).toBe(false)
    // What the user asked for, run directly: the same reconciliation.
    const direct = o.argv.filter((a) => a !== '-progress')
    direct[direct.indexOf('-recon_out') + 1] = `${S}/rc.direct.recon.tsv`
    direct[direct.indexOf('-out') + 1] = `${S}/rc.direct.tags.tsv`
    const d = await runCli(direct)
    expect(d.rc).toBe(0)
    const rows = (p: string) => readFileSync(p, 'utf8').trim().split('\n')
    expect(rows(guiRecon)).toEqual(rows(`${S}/rc.direct.recon.tsv`))
  }, 60000)

  it('species_rank offers domain (the taxdump rank), not superkingdom, and a domain run reports taxa', async () => {
    const c = PARAM_BY_NAME.get('species_rank')?.choices ?? []
    expect(c).toContain('domain')
    expect(c).not.toContain('superkingdom')
    const o = await guiRun({
      name: 'dom',
      lastUsed: { species: true, tag_length: '7', fragment_tolerance: '0.3', fragment_tolerance_unit: 'Da', species_rank: 'domain' },
      // Species with a Da tolerance is a pre-start red flag (GUI-DESIGN P2b
      // Inspector): Run waits until the user answers it with Run anyway.
      ui: async () => {
        const flag = screen.getAllByRole('listitem').find((li) => /^Red flag: Species detection with a tolerance in Da/.test(li.textContent ?? ''))!
        await click(within(flag).getByRole('button', { name: 'Run anyway' }))
      }
    })
    expect(o.rc).toBe(0)
    const sp = readFileSync(`${S}/dom.tags.species.tsv`, 'utf8').trim().split('\n')
    expect(sp.length).toBeGreaterThan(1)
  }, 120000)

  // Runs the shipped build_args (cargo test build_args_keeps_dash_leading_file_names).
  it('a typed fasta path starting with "-" reaches the CLI, resolved against the input folder, and the run is filtered', async () => {
    copyFileSync(FA, `${S}/-db.fasta`)
    const o = await guiRun({ name: 'dash', lastUsed: { fasta: '-db.fasta', tag_length: '5' } })
    expect(o.argv[o.argv.indexOf('-fasta') + 1]).toBe(`${S}/-db.fasta`)
    expect(o.rc).toBe(0)
    expect(o.lines.some((l) => /after filtering/.test(l.line))).toBe(true)
  }, 30000)
})

describe('dependency logic vs CLI defaults (no CLI needed)', () => {
  it('a cleared gaps field means the CLI default gaps=1, so gap_penalty/species_use_gapped stay live', async () => {
    const { inertBecause } = await import('../paramLayout')
    expect(PARAM_BY_NAME.get('gaps')?.default).toBe('1')
    expect(inertBecause('gap_penalty', { gaps: '' })).toBeNull()
    expect(inertBecause('species_use_gapped', { species: true, gaps: '' })).toBeNull()
  })
  it('tag_length is inert when tag_lengths replaces it (the CLI ignores it)', async () => {
    const { inertBecause } = await import('../paramLayout')
    expect(inertBecause('tag_length', { tag_lengths: ['7', '8'] })).toBe('tag_lengths replaces it')
  })
  it('gap_penalty help shown in the GUI says, as the README does, that it decides the max_tags slots', () => {
    const d = PARAM_BY_NAME.get('gap_penalty')?.description
    expect(d).not.toMatch(/never which tags are reported/)
    expect(d).toMatch(/under -?max_tags it decides which tags fill the capped slots/)
  })
})
