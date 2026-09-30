# FASTag desktop GUI

A cross-platform desktop front-end for the FASTag CLI, built with
[Tauri 2](https://tauri.app) (Rust backend + the OS's own webview) and React.
The CLI stays the source of truth: the GUI shells out to it, streams its
progress, and renders the tags and species report.

## Why Tauri

Tauri renders in the OS's own webview, so the app is a few-MB binary instead
of a bundled ~150 MB Chromium, and its Rust backend is a natural fit next to a
scientific CLI. The React frontend never calls Tauri directly: it speaks to an
abstract `window.fastag` bridge (`src/api.ts`), which is also what the tests
substitute (`src/testing/mockBridge.ts`).

## Layout

```
gui/
  src/                 React frontend (App, ParamField, SpeciesPanel, api bridge)
    api.ts             the window.fastag bridge over Tauri invoke/events + dialog/opener plugins
    paramLayout.ts     section/ordering overlay on the generated manifest (one flat list)
    params.generated.json   `-write_ini` dump of the tool (the source of truth for params)
  src-tauri/           Rust backend
    src/fastag.rs      resolve/probe the binary, run it, stream stderr as events, cancel
    src/settings.rs    named presets + last-used, atomic JSON in the app config dir
    src/browser.rs     indexed million-row results browser
    src/species.rs     species TSV read + FTX2 taxdb header read
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

## Build

```bash
npm run tauri build              # release .app/.dmg/.msi/.deb/.AppImage
npm run tauri build -- --debug   # faster, unsigned, for local checking
```

## Regenerate the param manifest

The UI form is generated from the tool's own `-write_ini`. After changing a CLI
parameter, refresh the manifest so the form stays in lockstep:

```bash
npm run params    # runs scripts/gen-params.mjs against the bundled binary
```

## Notes / open work

- **Bundling the native CLI** (its dylib closure, a single `libomp` to avoid
  OpenMP error #15, and the ~1 GB taxonomy) is done: `scripts/bundle-macos.sh`
  assembles a local self-contained `.app`, and CI stages
  `src-tauri/resources/fastag` itself before `tauri build`. In dev the resources
  are machine-specific symlinks and are gitignored. Still open: auto-update, a
  Linux desktop artifact, Windows signing — `doc/PLAN-gui-2026-09.md`.
- Rust unit tests cover the trust boundaries (`build_args` allowlist and
  flag-injection defence, settings sanitisation, species/taxdb parsing, browser
  bounds): `cargo test` in `src-tauri/`. The React side has its own vitest suite
  over the mock bridge: `npm test`. CI runs both on every push.
