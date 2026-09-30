# FASTag desktop GUI

A cross-platform desktop front-end for the FASTag CLI, built with
[Tauri 2](https://tauri.app) (Rust backend + the OS's own webview) and React.
The CLI stays the source of truth: the GUI shells out to it, streams its
progress, and renders the tags and species report.

Tauri uses the OS's own webview rather than a bundled Chromium, so the app is a
few MB instead of ~150 MB. The React frontend speaks to an abstract
`window.fastag` bridge (`src/api.ts`), which is the only surface the Rust
backend has to satisfy.

## Layout

```
gui/
  src/                 React frontend (App, ParamField, SpeciesPanel, api bridge)
    api.ts             the window.fastag bridge over Tauri invoke/events + dialog/opener plugins
    paramLayout.ts     which CLI params are core vs advanced (overlay on the generated manifest)
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

## Tests

Rust unit tests cover the trust boundaries (`build_args` allowlist and
flag-injection defence, settings sanitisation, species/taxdb parsing, browser
bounds): `cargo test` in `src-tauri/`. The frontend has typecheck and build
only.

## Packaging

Release bundles carry the CLI, its dylib closure with a single `libomp` (which
avoids OpenMP error #15) and the ~1 GB taxonomy inside the app; see
[../doc/SIGNING-macos-gui.md](../doc/SIGNING-macos-gui.md). In dev those
resources are machine-specific symlinks and are gitignored.
