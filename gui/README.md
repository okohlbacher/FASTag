# FASTag desktop GUI

A cross-platform desktop front-end for the FASTag CLI, built with
[Tauri 2](https://tauri.app) (Rust backend + the OS's own webview) and React.
The CLI stays the source of truth: the GUI shells out to it, streams its
progress, and renders the tags, the species report and the digest, label and
mass-gap reports.

Tauri uses the OS's own webview rather than a bundled Chromium, so the app
itself adds only a few MB on top of what it carries; the release bundle is
dominated by the bundled CLI and its ~1 GB taxonomy (see Packaging), about
1.3 GB installed on macOS. The React frontend speaks to an abstract
`window.fastag` bridge (`src/api.ts`), which is the only surface the Rust
backend has to satisfy.

## Layout

```
gui/
  src/                 React frontend
    App.tsx            the window shell: header, close/overwrite questions, shortcuts and menus,
                       laying out the setup, the run bar and the result tabs
    app/               viewStore.ts (result tab and log drawer, one store per window),
                       output-path and text helpers (paths.ts, format.ts)
    run/               useRun.ts (a run or batch, its log, progress and results), RunBar.tsx,
                       LogDrawer.tsx, BatchList.tsx and the batch job naming (batch.ts)
    results/           ResultTabs.tsx (Tags, Species, Digest and the failure banner), reports.ts
    ParamField.tsx     one form field per manifest parameter
    ResultsTable.tsx   tags browser: virtualized table with filters, column choice and export
    SpeciesPanel.tsx   species report
    Leftovers.tsx      the startup offer to remove files an unfinished run left (sweep.rs)
    DigestPanel.tsx    digest, label and mass-gap reports
    digestReport.ts    reader of the digest/label/mass-gap TSVs and the sequence-logo arithmetic
    SequenceLogo.tsx   SVG sequence logo (bits against a background)
    fixtures/          synthetic report TSVs for the tests and the browser preview
    api.ts             the window.fastag bridge over Tauri invoke, one Channel per run, events + dialog/opener plugins
    runJob.ts          one run as the renderer tracks it: id made before invoke, Channel events and the reply merged
    paramLayout.ts     section/ordering overlay on the generated manifest (one flat list)
    params.generated.json   `-write_ini` dump of the tool (the source of truth for params)
    testing/           mock bridge for the tests and the browser preview (`npm run dev`),
                       the e2e bridge with its ?fixture= scenarios (Playwright build only),
                       and the shared test helpers (render.tsx: renderApp, click, pickSingle, ...)
    adversarial/       end-to-end GUI tests (see Tests)
    setup/             useSession.ts (the form's values, last-used offer, presets), SetupForm.tsx,
                       parameter search (Cmd+K, "/"), instrument presets and the
                       species fixes (presets.ts), shortcuts and menu actions (shortcuts.ts)
    help/              the Help view (F1): pages as data (content.tsx, faq.tsx, params.ts),
                       HelpView.tsx, the link store (link.ts) and the "?" links (HelpLink.tsx)
  scripts/             gen-params.mjs (parameter manifest), bundle-macos.sh (macOS resource tree for release bundles),
                       check-dist-clean.mjs (a release dist/ carries no mock or fixture code)
  testing/stub-fastag/ a sh stand-in for the CLI, for the Rust run-lifecycle tests
  e2e-web/             Playwright specs and their fixtures (see Tests)
  src-tauri/           Rust backend
    src/lib.rs         plugin setup and Tauri command registration
    src/fastag.rs      resolve/probe the binary, run it (its events to the job's Channel), cancel
    src/events.rs      RunEvent (Log/Progress/Phase/Done) and the batching: one Log{lines} per 75 ms or 500 lines
    src/progress.rs    phase labels from the CLI's output (tests/fixtures/stderr) and the ETA from a weighted rate
    src/outputs.rs     the files a run writes (from its argv); removes them when it is cancelled or fails
    src/lifetime.rs    process lifetime: the one spawner thread every CLI child starts from, PDEATHSIG
                       (Linux), the per-run watchdog (Unix), the per-run kill-on-close job (Windows)
    src/sweep.rs       the marker (with a heartbeat) of a running run; at startup, interrupted runs
                       recorded and their leftovers (.part, .incomplete, the outputs they wrote while
                       alive) offered for removal
    src/close_guard.rs asks before a window close or Cmd+Q kills an active run
    src/settings.rs    named presets + last-used, atomic JSON in the app config dir
    src/browser.rs     indexed million-row results browser: head read on open, index and
                       E-value order built in the background and swapped in (D5)
    src/menu.rs        File, Run and Help menus with their CmdOrCtrl shortcuts
    src/reveal.rs      ResolvedOutputs (every output, absolute) and Reveal / Open folder, limited to run outputs
    src/species.rs     species TSV read + FTX2 taxdb header read
    src/report.rs      digest/label/mass-gap report read
    examples/browser_bench.rs  the browser bench (bench/bench-<version>.json)
    tauri.conf.json    window, bundle, icons
    resources/fastag/  the bundled FASTag binary + share/ (dev: symlinks; release: real files)
```

## Develop

```bash
npm install
npm run tauri dev
```

`resolve_binary` (`src-tauri/src/fastag.rs`) looks for the CLI in this order:
`FASTAG_BIN` (if that file exists), then `resources/fastag/bin/FASTag` in the
app's resource directory. A release build stops there: without a bundled CLI
(and no `FASTAG_BIN`) it reports the CLI missing. A debug build (`tauri dev`)
adds two fallbacks: the same path under this crate's own `src-tauri/`
(compiled in as `CARGO_MANIFEST_DIR`), then `FASTag` on `PATH` (`FASTag.exe` on
Windows, which the Windows CLI zip does not contain: it ships `FASTag.bat` and
`FASTag.core.exe`, so there the `PATH` step finds nothing). For dev, point it
at a local build with `FASTAG_BIN=/path/to/FASTag npm run tauri dev`, or drop a
symlink at `src-tauri/resources/fastag/bin/FASTag`.

`npm run dev` opened in a browser (http://localhost:1420) shows the React part
without the backend: a mock bridge stands in, and "open a report" loads the
fixture reports. A production build does not contain it.

## Build

```bash
npm run tauri build              # release .app/.dmg/.msi/.deb/.AppImage
npm run tauri build -- --debug   # faster, unsigned, for local checking
```

## Regenerate the param manifest

The UI form is generated from the tool's own `-write_ini`. After changing a CLI
parameter, refresh the manifest so the form stays in lockstep, and place the
new option in `src/paramLayout.ts` and give it a plain-language entry in
`src/help/params.ts` (the layout and Help tests fail until both are done):

```bash
npm run params    # runs scripts/gen-params.mjs against the bundled binary
```

The bundled binary is gitignored; without it, name one:
`node scripts/gen-params.mjs /path/to/FASTag src/params.generated.json`. The
script replaces the manifest only once it is complete, so a missing or broken
binary leaves the old one in place. Do not redirect its stdout into the
manifest: the shell empties the file before the script runs.

## Shortcuts

Cmd on macOS, Ctrl on Windows and Linux; the same items are in the native
File, Run and Help menus.

| Keys | Action |
|---|---|
| Cmd+O / Cmd+Shift+O | Open spectra / open a tags TSV |
| Cmd+Enter | Run (or run the batch) |
| Cmd+. | Cancel the run |
| Cmd+E | Export the shown rows |
| Cmd+? (F1, ?) | Help |
| Cmd+K or / | Search parameters by name, flag or help text |

## Browser bench

    cd gui/src-tauri
    cargo run --release --example browser_bench -- big.tags.tsv > ../bench/bench-<version>.json

Each mode runs in its own process (its peak RSS is its own): `firstcut`
(head read, index, E-value order), `today` (v1.11's sorted view), `verify`
(both orders identical) and `typed` (the typed-column prototype: filter time,
peak memory, export throughput). bench/bench-1.12.0.json holds the P0b
numbers on 1.65M and 6.6M rows.

## Tests

Rust unit tests cover the trust boundaries (`build_args` allowlist and
flag-injection defence, settings sanitisation, species/taxdb parsing, report
reading, browser bounds): `cargo test` in `src-tauri/` (it needs
`src-tauri/resources/fastag` to exist, even empty). The frontend has vitest
tests (run/batch orchestration, layout completeness, results browser, report
parsing and logo arithmetic, Digest tab) and a typecheck: `npm test`,
`npm run typecheck`. The Rust tests of the run lifecycle (a cancelled or
failed run leaves no output behind, the `run` command's events in order on a
real Channel, the IPC message rate of a chatty phase) run
`testing/stub-fastag/FASTag`, not the CLI; `cargo test --lib ipc_rate --
--nocapture` prints the measured rate. `src/api.test.ts` tests the bridge itself
against Tauri's IPC mock (`@tauri-apps/api/mocks`): a Done before the `run`
reply, a late log after Done, a cancel during a phase without progress.
The parts of the window have tests of their own beside them: the hooks
(`setup/useSession`, `run/useRun`, `app/viewStore`) through `renderHook`, and
`RunBar`, `LogDrawer`, `BatchList` and `ResultTabs` rendered alone with their
props. The App-level tests, which render the whole window, are split by area
beside the parts they drive: `run/batch.app.test.tsx` (run and batch
orchestration), `results/digest.app.test.tsx` (the Digest tab) and
`setup/setup.app.test.tsx` (the setup form and run bar, with the checks that
App wires Reset, the phase and the elapsed time into the run bar); they share
their helpers from `src/testing/render.tsx`.
The process-lifetime tests (`lifetime::tests`, and
`a_killed_gui_ends_the_run_and_the_next_start_offers_what_it_left`) run the
test binary again as a stand-in GUI process and kill it with SIGKILL; the
PDEATHSIG ones run on Linux only (the `gui` CI job), the job-object one on
Windows only (`gui-windows`).
The stub is steered by environment variables (`STUB_SLEEP`,
`STUB_SLEEP_BEFORE`, `STUB_FAIL`, `STUB_CHATTY`, `STUB_ORPHAN`, ...), by
`<in>.stub` next to the input, or, in the tauri-driver specs, by the input's
name: an input named `*.slow.*` keeps running, `*.chatty.*` prints 5,000 log
lines and `*.fail.*` fails.

The tauri-driver specs in `e2e-tauri/` drive the real debug app in WebKitGTK
on Linux (tauri-driver and WebKitWebDriver under xvfb): probe, run, table,
cancel, and two recorded gates, the time to first rows on a generated
1M-row file and the IPC rate of a chatty run (log lines and messages, counted
apart, so batched log events still count every line). Native dialogs cannot
be driven, so a spec replaces only `window.fastag.pickInput` /
`pickResults`. `bash e2e-tauri/run.sh stub` runs them against the stub (CI
does on every push and PR, informational until P5); `run.sh real` against
the CLI in the app's own resources (CI does against the installed `.deb`
and, for the probe, the unpacked tarball before a tag). In real mode the
cancel spec runs the E. coli fixture's spectra repeated 500 times
(`e2e-tauri/mzml.mjs`, `E2E_CANCEL_COPIES`) on one thread, clicks Cancel once
the partial output exists, and asserts the run was cancelled, the partial file
removed and no CLI process left. `E2E_ONLY` picks specs by name. Results go to
`e2e-tauri/results/`.

The Playwright specs in `e2e-web/` drive the app in Chromium and WebKit on an
explicit e2e build, `npm run build:e2e` (`vite build --mode e2e`, into
`dist-e2e/`), which installs `src/testing/e2eBridge.ts`; each spec picks a
scenario with `?fixture=` (`default`, `batch-fail`, `big`, `slow`,
`lastused`, `existing`, `interrupted`, and the others in `e2eBridge.ts`). Run them with `npm run e2e` (`npx playwright install chromium
webkit` once). Any console error fails a spec. `npm run check:dist` checks
that a release `dist/` carries none of the bridges' strings; the `ui`
workflow runs both.

The tests in `src/adversarial/` check GUI behaviour end to end: accessibility,
the run lifecycle, report parsing, and agreement with the CLI and with this
README. The real CLI outputs they parse are committed in
`src/fixtures/real/` (public inputs only; see its README.md);
`FASTAG_GUI_TEST_OUTPUTS` names another directory of them instead. The
`cli-consistency` tests also need `FASTAG_BIN` (a FASTag CLI of the version
`params.generated.json` was made from) and are skipped without it. They also
need the `build_args` and `order_rs` examples in `src-tauri/examples`
(`order_rs` replays stdout/stderr in the order two reader threads receive
them), which `cargo test` or `cargo build --examples` builds;
`FASTAG_ORDER_RS` names another helper. CI runs them in the release-only
`gui-cli-consistency` job, on a tag and on a `gui_dry_run` dispatch, against
the portable linux-x64 CLI. See `src/adversarial/external.ts`.

The tests in `src/help/` check that every Help link lands on a section that
exists, that every CLI parameter has a settings entry, that every digest
no-call reason and failure class has a troubleshooting entry, and that the key
Help sentences still match README.md, doc/DESIGN-digest.md and
doc/SPECIES-DETECTOR.md.

## Packaging

Release bundles carry the CLI, its dylib closure with a single `libomp` (which
avoids OpenMP error #15), the digest tables (`share/FASTag/digest`) and the
~1 GB taxonomy inside the app; see
[../doc/SIGNING-macos-gui.md](../doc/SIGNING-macos-gui.md). In dev those
resources are machine-specific symlinks and are gitignored.

On Linux (from 1.13.0) the `gui-linux` job in `.github/workflows/ci.yml`
builds the app outside conda on ubuntu-22.04 against apt's WebKitGTK 4.1,
with the portable linux-x64 CLI staged into `src-tauri/resources/fastag`:
`fastag-gui_<version>_amd64.deb` (Debian package `fastag-gui`; Tauri would
name it `fas-tag`, so the job repacks it), `FASTag-gui-linux-x64.tar.gz` (the `.deb`'s
`/usr` tree, relocatable) and a best-effort `FASTag-gui-linux-x64.AppImage`.
A `gui_dry_run` dispatch with `gui_full_payload` embeds the taxonomy index as
a tag does, so the release-sized bundles are built and smoke-tested first.
A tag attaches them only once P1 PR b's process lifetime
(a `libc::PR_SET_PDEATHSIG` call, #17) is in `src-tauri/src`.
The supported systems are Ubuntu 22.04+ and Debian 12+ (glibc 2.35 and
WebKitGTK 4.1). RHEL-family systems are not supported by the desktop app
(RHEL/Rocky 9 has glibc 2.34 and only WebKitGTK API 4.0, `webkit2gtk3`, and
there is no older build base); their users run the CLI, and no CI job tests
the app there. Before anything is attached to a release, the `.deb` is
installed and run on ubuntu-22.04 and 24.04 (and the tarball unpacked into
an arbitrary prefix, run and probed there first) and the AppImage launched on
both; a `gui_dry_run` dispatch runs the same
jobs without a tag and leaves the bundles as the `FASTag-gui-linux-x64`
artifact.
