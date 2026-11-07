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
    App.tsx            the window: parameter form, run and batch, result tabs
    ParamField.tsx     one form field per manifest parameter
    ResultsTable.tsx   tags browser: virtualized table with filters, column choice and export
    SpeciesPanel.tsx   species report
    DigestPanel.tsx    digest, label and mass-gap reports
    digestReport.ts    reader of the digest/label/mass-gap TSVs and the sequence-logo arithmetic
    SequenceLogo.tsx   SVG sequence logo (bits against a background)
    fixtures/          synthetic report TSVs for the tests and the browser preview
    api.ts             the window.fastag bridge over Tauri invoke/events + dialog/opener plugins
    paramLayout.ts     section/ordering overlay on the generated manifest (one flat list)
    params.generated.json   `-write_ini` dump of the tool (the source of truth for params)
    testing/           mock bridge for the tests and the browser preview (`npm run dev`),
                       and the e2e bridge with its ?fixture= scenarios (Playwright build only)
    adversarial/       end-to-end GUI tests (see Tests)
    setup/             parameter search (Cmd+K, "/"), instrument presets and the
                       species fixes (presets.ts), shortcuts and menu actions (shortcuts.ts)
    help/              the Help view (F1): pages as data (content.tsx, faq.tsx, params.ts),
                       HelpView.tsx, the link store (link.ts) and the "?" links (HelpLink.tsx)
  scripts/             gen-params.mjs (parameter manifest), bundle-macos.sh (macOS resource tree for release bundles),
                       check-dist-clean.mjs (a release dist/ carries no mock or fixture code)
  testing/stub-fastag/ a sh stand-in for the CLI, for the Rust run-lifecycle tests
  e2e-web/             Playwright specs and their fixtures (see Tests)
  src-tauri/           Rust backend
    src/lib.rs         plugin setup and Tauri command registration
    src/fastag.rs      resolve/probe the binary, run it, stream stderr and stdout lines as events, cancel
    src/outputs.rs     the files a run writes (from its argv); removes them when it is cancelled or fails
    src/close_guard.rs asks before a window close or Cmd+Q kills an active run
    src/settings.rs    named presets + last-used, atomic JSON in the app config dir
    src/browser.rs     indexed million-row results browser: head read on open, index and
                       E-value order built in the background and swapped in (D5)
    src/menu.rs        File, Run and Help menus with their CmdOrCtrl shortcuts
    src/reveal.rs      ResolvedOutputs (-out) and Reveal / Open folder, limited to run outputs
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
failed run leaves no output behind) run `testing/stub-fastag/FASTag`, not the
CLI. The stub is steered by environment variables (`STUB_SLEEP`,
`STUB_SLEEP_BEFORE`, `STUB_FAIL`, `STUB_CHATTY`) or, where the real app
launches it and passes no environment of its own, by the input's name: an
input named `*.slow.*` keeps running, `*.chatty.*` prints 5,000 log lines and
`*.fail.*` fails.

The tauri-driver specs in `e2e-tauri/` drive the real debug app in WebKitGTK
on Linux (tauri-driver and WebKitWebDriver under xvfb): probe, run, table,
cancel, and two recorded gates, the time to first rows on a generated
1M-row file and the IPC message rate of a chatty run. Native dialogs cannot
be driven, so a spec replaces only `window.fastag.pickInput` /
`pickResults`. `bash e2e-tauri/run.sh stub` runs them against the stub (CI
does on every push and PR, informational until P5); `run.sh real` against
the CLI in the app's own resources (CI does against the installed `.deb`
before a tag). Results go to `e2e-tauri/results/`.

The Playwright specs in `e2e-web/` drive the app in Chromium and WebKit on an
explicit e2e build, `npm run build:e2e` (`vite build --mode e2e`, into
`dist-e2e/`), which installs `src/testing/e2eBridge.ts`; each spec picks a
scenario with `?fixture=` (`default`, `batch-fail`, `big`, `slow`,
`lastused`). Run them with `npm run e2e` (`npx playwright install chromium
webkit` once). Any console error fails a spec. `npm run check:dist` checks
that a release `dist/` carries none of the bridges' strings; the `ui`
workflow runs both.

The tests in `src/adversarial/` check GUI behaviour end to end: accessibility,
the run lifecycle, report parsing, and agreement with the CLI and with this
README. The real CLI outputs they parse are committed in
`src/fixtures/real/` (public inputs only; see its README.md);
`FASTAG_GUI_TEST_OUTPUTS` names another directory of them instead. The
`cli-consistency` tests also need `FASTAG_BIN` (a FASTag CLI to run) and
`FASTAG_ORDER_RS` (a helper that replays stdout/stderr in the order two
reader threads receive them) and are skipped without them.
`cli-consistency` also needs the `build_args` example, which `cargo test`
builds. See `src/adversarial/external.ts`.

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
`FASTag-gui-linux-x64.deb`, `FASTag-gui-linux-x64.tar.gz` (the `.deb`'s
`/usr` tree, relocatable) and a best-effort `FASTag-gui-linux-x64.AppImage`.
The supported floor is glibc 2.35 and WebKitGTK 4.1 (Ubuntu 22.04, Debian 12).
Rocky/RHEL 9 is below it: glibc 2.34 and only WebKitGTK API 4.0
(`webkit2gtk3`); the Rocky 9 smoke job records both and is informational
until decision Q13 is revisited. Before anything is attached to a release, the `.deb` is
installed and run on ubuntu-22.04 and 24.04 and the AppImage launched on
both (and tried in a Rocky 9 container); a `gui_dry_run` dispatch runs the same
jobs without a tag and leaves the bundles as the `FASTag-gui-linux-x64`
artifact.
