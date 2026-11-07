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
    App.tsx            the window shell: the top bar and the four views (Setup, Results,
                       Batch, History; Cmd+1..4), the Help side panel, close/overwrite
                       questions, shortcuts, menus, drops and the finish toast and notification
    shell/             TopBar.tsx (logo, view switcher, progress pill, theme, Help toggle),
                       HistoryView.tsx (the run record), AboutDialog.tsx, and dropRoute.ts
                       (what a drop drop.rs sorted does, and which view it lands on)
    styles/tokens.css  the D9 design tokens (ProSE structure, v6 logo colours), light, dark
                       and system on :root[data-theme]; tokens.test.ts pins them and their contrast
    app/               viewStore.ts (result tab and log drawer, one store per window),
                       theme.ts (the chosen theme), output-path and text helpers (paths.ts, format.ts)
    run/               useRun.ts (a run or batch, its log, progress and results) over one
                       reducer (runReducer.ts: jobs, RUN_START/EVENT/DONE/CANCEL_REQUESTED/
                       BATCH_ADD/BATCH_REMOVE/BATCH_OUT_DIR), each job's log in a store
                       outside React state (logStore.ts), RunBar.tsx, LogDrawer.tsx,
                       BatchList.tsx, the batch job naming (batch.ts), and the batch
                       summary: batchSummary.ts (rows and the majority rule),
                       useBatchSummary.ts (each done job's reports) and SummaryTable.tsx
    results/           ResultTabs.tsx (Overview, Tags, Species, Digest), FailureBanner.tsx (over
                       the tabs, or on the Batch view beside the queue), reports.ts,
                       RunningPanel.tsx (the running state), OverviewPanel.tsx over
                       overview.ts (tiles, checks, suggested settings) and calls.ts (the
                       parser of the calls FASTag wrote)
    ParamField.tsx     one form field per manifest parameter
    ResultsTable.tsx   tags browser: virtualized table with filters, column choice and export
    SpeciesPanel.tsx   species report
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
    setup/             useSession.ts (the form's values, where they started, last-used offer, presets),
                       SetupForm.tsx (task chooser, four step cards), PlanFooter.tsx (plan,
                       diff, Copy command line, Export INI), the built-in tasks (tasks.ts),
                       presets as diffs and the v1 preset reader (presetDiff.ts), card and plan
                       text (plan.ts), parameter search (Cmd+K, "/"), instrument presets and the
                       species fixes (presets.ts), shortcuts and menu actions (shortcuts.ts)
    help/              the Help side panel (F1, Cmd+?): pages as data (content.tsx, faq.tsx, params.ts),
                       HelpView.tsx with its search (search.ts, over every page, the FAQ, the
                       glossary and the settings), the link store (link.ts) and the "?" links (HelpLink.tsx)
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
    src/close_guard.rs asks before a window close or Cmd+Q kills an active run
    src/settings.rs    named presets (diffs) + last-used in a tauri-plugin-store file (settings.json
                       in the app config dir); migrates the v1 file once (kept as settings.v1.json.bak)
    src/ini.rs         Export INI: the run's argv as a temporary INI, merged by `FASTag -ini <tmp> -write_ini <out>`
    src/browser.rs     indexed million-row results browser: head read on open, index and
                       E-value order built in the background and swapped in (D5)
    src/menu.rs        File, Run, View and Help menus with their CmdOrCtrl shortcuts, and the
                       dispatch of a menu click (Quit and Close through the close guard)
    src/drop.rs        the window-wide drop zone: dropped paths sorted by type into one route
    src/notify.rs      the system notification when a run or batch finishes
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

## The window

Four views, switched from the top bar: **Setup** (the input, the parameters
and Run), **Results** (Overview, Tags, Species and Digest, full width), **Batch** (the
queue, its run bar, the failure banner, the summary table and each job's log) and **History**
(every recorded run: input, status, duration, outputs). Run moves to
Results; the first file of a batch moves to Batch. The progress pill in the
top bar shows the job in flight (file, phase or percentage, ETA) and, outside
the view with the run bar or the running state, its Cancel. While a run goes,
Results shows its running state (file, phase, progress with rate and ETA,
Cancel, Show log). When a run or batch finishes while the
window is in the background, the system shows a notification; a toast
offers Open results.

A run of **Characterize a run** or **Batch QC** lands on the **Overview**:
key figures (MS2 spectra, spectra with tags, tags, tags with E ≤ 1, glyco
flags), the calls FASTag made (protease from the digest report, top genus
from the species report, label from the `label_call` rows of `-label_out`,
alkylation only from a mass-gap report, so only with a FASTA; otherwise
"not assessed (needs a FASTA)"), the checks (the 1.12 acquisition check
line, a Da tolerance, electron activation) and suggested search settings,
each line naming its evidence (a call, a default, a preset or the run).
Every tile names its cutoff or caveat; with fewer than 1,000 spectra a call
reads "too little evidence". The GUI computes no call itself: `calls.ts`
only parses what the CLI wrote, and what an older CLI does not write reads
"not called" or "not checked" (detected from the rows and columns present,
never from the version string). A tile whose report the run did not write
offers to turn it on and run again ("Add FASTA and run again" for the
alkylation tile). Runs from FASTag's defaults land where they did before and
offer the Overview as a tab.

The **Batch** view adds files or a whole folder (**Add folder…**: the spectra
files directly inside it, as a dropped folder adds them) and can put every
output into one **output folder** (for inputs on a read-only share; the
reports follow the tags, and "Beside inputs" puts them back). Its **summary
table** has one row per job, read from the reports that job wrote: status,
tags, top genus, protease, label and alkylation, each cell as that run's
Overview states it, with its caveat as a tooltip. A call that differs from
its column's majority is marked ≠; a majority needs at least 3 jobs with a
call and more than half of them, and a no call, "too little evidence", a
ranking without call columns, a failed or a queued job never counts. A raw
DIA input that FASTag 1.12 refuses (exit 11) fails with the CLI's sentence.
**Export summary TSV…** writes the table, cell for cell, with a `yes` column
after each call column where it differs. The SDRF comparison follows in P4.

Setup starts from a task: **Characterize a run** (the default: species with
extension 2, the digest, label and glyco reports, a tenth of the spectra),
**Batch QC vs SDRF**, **Export tags** (with the per-residue confidence
column) or **Open results / inspect spectra** (no run). "Starting from" also
offers FASTag's own defaults and your saved presets. The parameters sit in
four step cards (Spectra, Database & taxonomy, Tagging, Reports), each with a
one-line summary; settings that only a section's switch turns on (species,
glyco, a FASTA, reconciliation) stay hidden until it is on. The footer above
Run states the plan, counts what differs from the task or preset (Reset takes
it back), copies the command line and exports an INI. Choosing a task or a
preset replaces the form; Undo brings back what it replaced.

A preset stores only what differs from the task or defaults it was saved
over, and no paths: input files (a FASTA, a taxonomy) are left out, and a
report is stored by its name (`digest.tsv`), written beside each input.
**Export INI…** writes the parameters a run would use as a TOPP INI: the GUI
writes them to a temporary INI and lets the CLI merge it into its defaults
(`FASTag -ini <tmp> -write_ini <file>`), so `FASTag -ini <file>` runs with
the same effective parameters (`-progress`, which the GUI adds for its
progress bar, is left out). Presets and the last-used offer are kept with
tauri-plugin-store in `settings.json` in the app config folder; a settings
file of an earlier version is migrated on the first start, every preset
kept, and the old file stays beside it as `settings.v1.json.bak`.

Help is a side panel beside any view, with a search over every page, the
troubleshooting entries, the glossary and the settings reference.

Files dropped anywhere on the window go by type: one spectra file to the
input, two or more (or a folder) to the batch, a FASTA to `-fasta`, a
`.taxdb` to `-taxdb`, a tags TSV to Results, a digest, label or mass-gap
report to the Digest tab and a species report to the Species tab. Nothing is
taken while FASTag runs. Reports without a tab yet (recon, delta, glyco) and
SDRF files are named, not read.

Themes: System (the default), Light and Dark, from the top bar or View >
Theme; the choice is remembered on this machine. Text uses the system UI
font; IBM Plex Mono is bundled for sequences and IDs.

## Shortcuts

Cmd on macOS, Ctrl on Windows and Linux; the same items are in the native
File, Run, View and Help menus.

| Keys | Action |
|---|---|
| Cmd+O / Cmd+Shift+O | Open spectra / open a tags TSV |
| Cmd+Enter | Run (or run the batch) |
| Cmd+. or Esc | Cancel the run |
| Cmd+E | Export the shown rows |
| Cmd+1 .. Cmd+4 | Setup, Results, Batch, History |
| Cmd+? (F1, ?) | Help |
| Cmd+K or / | Search parameters by name, flag or help text |
| Cmd+W / Cmd+Q | Close the window / quit (both ask first while a run is active) |

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
orchestration), `results/digest.app.test.tsx` (the Digest tab),
`results/overview.app.test.tsx` (the Overview and the running state; the
parser and model tests `results/calls.test.ts` and `results/overview.test.ts`
read real CLI output on the gate PXDs from `src/fixtures/cli/`),
`run/batchSummary.app.test.tsx` (the summary table, its export, Add folder…
and the output folder; `run/batchSummary.test.ts` checks the majority rule
and the rows of one real batch, `src/fixtures/cli/batch/`),
`setup/setup.app.test.tsx` (the setup form and run bar, with the checks that
App wires Reset, the phase and the elapsed time into the run bar) and
`shell/shell.app.test.tsx` (the views, the pill, Help and its search, menus,
drops, the finish notice and the themes); they share their helpers from
`src/testing/render.tsx`, whose getters go to the view that holds their
control (`showView`, `goTo`). `styles/tokens.test.ts` pins the D9 tokens and
their contrast. Native menus and OS file drops cannot be driven from a test:
cargo tests drive their handlers instead (`menu::on_menu_event` with every
item id, `drop::on_drag_drop` with the DragDrop payloads).

Setup (P2a): `setup/setupScreen.app.test.tsx` renders the window as it starts
(`renderColdApp`: the task "Characterize a run") and checks the two-action
cold start, the task chooser and Undo, hidden dependent fields, the plan
footer, Copy command line, Export INI and presets saved as diffs; the older
App-level tests start from FASTag's defaults (`renderApp`).
`setup/presetDiff.test.ts` checks the diffs and reads the v1 settings file
`src-tauri/tests/fixtures/settings-v1.json`, which the cargo migration test
(`settings::tests`) migrates into the store. The Export INI round trip
(`ini::tests::round_trip`) exports a request, then compares the CLI's
effective parameters under `-ini` with the run's argv over the CLI's
defaults, and the tags and digest report of a run from the argv with those
of a run from the INI. It runs the stub CLI always and the real CLI when one
is found (`FASTAG_REAL_CLI`, else `FASTag` on PATH); `cargo test --lib
round_trip -- --nocapture` prints which.

The Playwright specs in `e2e-web/` drive the app in Chromium and WebKit on an
explicit e2e build, `npm run build:e2e` (`vite build --mode e2e`, into
`dist-e2e/`), which installs `src/testing/e2eBridge.ts`; each spec picks a
scenario with `?fixture=` (`default`, `batch-fail`, `big`, `slow`,
`lastused`, the real-CLI `gate*` scenarios, and `gate-batch`, whose
`batch-summary.spec.ts` checks the summary table and its TSV against
oracles recomputed from the batch fixtures); `&start=defaults` starts the session from FASTag's defaults
instead of the task the app lands on. `setup.spec.ts` drives the Setup
screen and saves its screenshots. Run them with `npm run e2e` (`npx playwright install chromium
webkit` once). Any console error fails a spec. `shell.spec.ts` drives the
views, Help and its search, the themes and drops (through the e2e bridge's
`drop` and `menu` controls), and saves screenshots of every view in both
themes at 960×600 and 1440×900 to `e2e-web/test-results/`. `npm run check:dist` checks
that a release `dist/` carries none of the bridges' strings; the `ui`
workflow runs both.

The tests in `src/adversarial/` check GUI behaviour end to end: accessibility,
the run lifecycle, report parsing, and agreement with the CLI and with this
README. Some of them read inputs from outside the repository and are skipped
unless these are set: `FASTAG_GUI_TEST_OUTPUTS` (a directory of real CLI outputs on the E. coli
fixture), `FASTAG_BIN` (a FASTag CLI to run) and `FASTAG_ORDER_RS` (a helper
that replays stdout/stderr in the order two reader threads receive them).
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
