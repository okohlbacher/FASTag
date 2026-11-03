# FASTag desktop GUI

A cross-platform desktop front-end for the FASTag CLI, built with
[Tauri 2](https://tauri.app) (Rust backend + the OS's own webview) and React.
The CLI stays the source of truth: the GUI shells out to it, streams its
progress, and renders the tags, the species report and the digest, label and
mass-gap reports.

Tauri uses the OS's own webview rather than a bundled Chromium, so the app is a
few MB instead of ~150 MB. The React frontend speaks to an abstract
`window.fastag` bridge (`src/api.ts`), which is the only surface the Rust
backend has to satisfy.

## Layout

```
gui/
  src/                 React frontend (App, ParamField, SpeciesPanel, DigestPanel, api bridge)
    digestReport.ts    reader of the digest/label/mass-gap TSVs and the sequence-logo arithmetic
    SequenceLogo.tsx   SVG sequence logo (bits against a background)
    fixtures/          synthetic report TSVs for the tests and the browser preview
    api.ts             the window.fastag bridge over Tauri invoke/events + dialog/opener plugins
    paramLayout.ts     section/ordering overlay on the generated manifest (one flat list)
    params.generated.json   `-write_ini` dump of the tool (the source of truth for params)
  src-tauri/           Rust backend
    src/fastag.rs      resolve/probe the binary, run it, stream stderr as events, cancel
    src/settings.rs    named presets + last-used, atomic JSON in the app config dir
    src/browser.rs     indexed million-row results browser
    src/species.rs     species TSV read + FTX2 taxdb header read
    src/report.rs      digest/label/mass-gap report read
    tauri.conf.json    window, bundle, icons
    resources/fastag/  the bundled FASTag binary + share/ (dev: symlinks; release: real files)
```

## Develop

```bash
npm install
npm run tauri dev
```

`resolveBinary` looks for the CLI in this order: `FASTAG_BIN`, the bundled
`resources/fastag/bin/FASTag`, then `FASTag` on `PATH`. For dev, point it at a
local build with `FASTAG_BIN=/path/to/FASTag npm run tauri dev`, or drop a
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
parameter, refresh the manifest so the form stays in lockstep. Options listed
in `UPCOMING` (`src/paramLayout.ts`) are placed in the layout already and appear
once the manifest has them:

```bash
npm run params    # runs scripts/gen-params.mjs against the bundled binary
```

## Tests

Rust unit tests cover the trust boundaries (`build_args` allowlist and
flag-injection defence, settings sanitisation, species/taxdb parsing, report
reading, browser bounds): `cargo test` in `src-tauri/` (it needs
`src-tauri/resources/fastag` to exist, even empty). The frontend has vitest
tests (run/batch orchestration, layout completeness, results browser, report
parsing and logo arithmetic, Digest tab) and a typecheck: `npm test`,
`npm run typecheck`.

## Packaging

Release bundles carry the CLI, its dylib closure with a single `libomp` (which
avoids OpenMP error #15) and the ~1 GB taxonomy inside the app; see
[../doc/SIGNING-macos-gui.md](../doc/SIGNING-macos-gui.md). In dev those
resources are machine-specific symlinks and are gitignored.
