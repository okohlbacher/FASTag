# FASTag GUI plan, 2026-09 — auto-update, Linux packaging, Windows signing, UX debt

Planning document only: nothing below is implemented. Base: `main` at
`5afa252` (2026-09-09). Every claim about the tree was checked against the
code, not against `doc/BACKLOG.md`; section 0 records where the backlog lags.
Section 7 records the adversarial review (codex, GPT-6): 19 findings, all
verified against the code, and what each one changed in sections 1–6.

Standing rules applied throughout: no new heavyweight dependency without a
stated reason; nothing that changes CLI output; anything user-facing ships with
a test; Windows CI is ~1h15m cold, so nothing heavy is added to it.

---

## 0. What the tree shows (verified 2026-09-09)

| item | backlog says | tree shows | evidence |
|---|---|---|---|
| Million-row results browser | `BACKLOG.md:340` "Still open: a million-row results browser (DuckDB in a Tauri sidecar)" | **DONE**, as the zero-dependency indexed reader from `BACKLOG-PLAN-2026-09.md` §3.2, not DuckDB | `gui/src-tauri/src/browser.rs` (626 lines): line-offset index `Index.offsets: Vec<u64>` (:58-62), `build_index` (:88), sorted/filtered permutation `Vec<u32>` in `build_view` (:248), windows via seek in `read_rows` (:297), single-slot cache keyed `(path, len, mtime)` in `query` (:312-350), `results_query` on `spawn_blocking` (:353-365), `MAX_WINDOW` clamp. Frontend `gui/src/ResultsTable.tsx` (234 lines): capped spacer `SPACER_CAP = 15_000_000` (:12), 500-row pages, 40-page LRU, asc→desc→off sort, Enter/blur-committed filters. Wired at `lib.rs:23,28`, `api.ts:64-65`, `types.ts:13-34`; rendered at `App.tsx:604`. No `preview.rs` remains. |
| Browser tests | — | 12 `browser::tests` (fixture, numeric/string sort, each filter, CRLF, blank lines, missing file, window clamp, cache staleness, dynamic columns, empty/header-only) + `real_file_crosscheck` marked `#[ignore]` (`browser.rs:587-589`); 5 vitest cases in `ResultsTable.test.tsx` | **ran** `cargo test` in `gui/src-tauri`: 28 passed, 0 failed, 1 ignored |
| vitest harness | `BACKLOG.md:341` "Still open: a headless renderer runner (vitest)" | **DONE**: `App.test.tsx` (19), `ResultsTable.test.tsx` (5), `paramLayout.test.ts` (13) over `gui/src/testing/mockBridge.ts`; CI `gui` job runs typecheck + tests + build + `cargo test --lib` (`ci.yml:1054-1085`) | **ran** `npm test`: 37 passed in 2.2 s |
| `showResults` unhandled rejection | named as an open wart in the brief for this plan | **FIXED**: `App.tsx:274-285` wraps `showResults` in `.catch(logResultsError)`; batch path `App.tsx:322` | tests `App.test.tsx:276-311` |
| macOS signing + notarization | `BACKLOG.md:340` "awaits the 7 `MACOS_*` secrets"; `doc/SIGNING-macos-gui.md:3` "WIRED, not yet exercised" | **LIVE**: the desktop `.dmg` is attached only when `steps.mac-signing.outputs.enabled == 'true'` (`ci.yml:918`), and v1.4.2 carries `FASTag-gui-macos-arm64.dmg` (520 MB) and `FASTag-gui-macos-x64.dmg` (531 MB) | `gh release view v1.4.2 --json assets`; build/notarize/staple at `ci.yml:877-914`; the newer status block `BACKLOG.md:350-359` (commit 5afa252) already says DONE — the table rows above it are the stale part |
| Windows installer | — | **BUILT, UNSIGNED**: NSIS via `npm run tauri build` under pwsh (`windows.yml:952-964`), unsigned attach (`windows.yml:1010-1020`), v1.4.2 has `FASTag-gui-windows-x64-setup.exe` (365 MB). SignPath gate `windows.yml:714-733`; `SIGNPATH_PROJECT_SLUG: ''` (`windows.yml:119`); application submitted 2026-09-09 (`BACKLOG-ci.md:158-166`). The Tauri GUI executable inside the installer is signed by nobody: the first SignPath request covers only the CLI (`windows.yml:735-743`), the second only the installer (`:969-989`) | read; not run |
| Windows release gate | — | `windows.yml:1068-1085` asserts **only** `FASTag-windows-x64.zip`; the installer is not in any completeness list, so a build that silently produces no installer (`windows.yml:1018` exits 0 with a warning) ships green | read |
| Linux desktop | — | **NO GUI ARTIFACT**: v1.4.2 Linux assets are `FASTag-linux-{x64,arm64}.tar.gz` only; `ci.yml:1141-1143` expects none; the `gui` job never runs `tauri build` | `gh release view`; read |
| Versions | — | `tauri.conf.json` 1.4.2, `gui/package.json` 1.4.2, `CMakeLists.txt:2` 1.4.2, **`gui/src-tauri/Cargo.toml` 1.2.1** (never bumped; release commit `d203085` touches only the first three). Tauri takes the version from `tauri.conf.json` when set, so the shipped app reports 1.4.2 — but nothing asserts the three hand-bumped files agree with the tag | read |
| Resource layout | — | `resolve_binary` (`fastag.rs:96-113`) looks for `<resource_dir>/resources/fastag/{bin/FASTag, share/OpenMS, share/FASTag/taxonomy}`; macOS stages `bin/lib` beside the binary (`ci.yml:822-826`), Windows stages DLLs flat in `bin/` (`windows.yml:935-938`). The GUI sets `OPENMS_DATA_PATH` and `FASTAG_TAXONOMY_DIR` itself (`fastag.rs:298-305`), so the CLI wrapper script is not needed inside the app | read |
| Probe semantics | — | `probe` (`fastag.rs:139-151`) reports `ok: true` for **any** `Command::output()` that returns `Ok`, including a non-zero exit — a bundle missing a shared library passes the probe and enables Run | read |
| Taxonomy size | the brief for this plan said "232 MB" | local dev tree: `tax_k7.taxdb` is **1.1 GB** (Jul 25 build); release tarball `FASTag-taxonomy-k7.tar.gz` is 449 MB compressed; the CLI **mmaps** the index (`src/TaxIndex.cpp:457`, Windows `:443`). 232 MB matched nothing measurable — treat the on-disk index as ~1.1 GB until the tag log's `du -h` (`ci.yml:846`) says otherwise. The index is embedded on **tag builds only** (`ci.yml:770`); dry runs ship the 12 KB dumps and no index | measured; read |
| Toolchain | — | `@tauri-apps/cli` 2.11.4, `tauri` crate 2.11.5; plugins: dialog, opener, single-instance; **no** updater/process plugin; capabilities `core:default` (which includes `core:app:default` → `allow-version`), `opener:default`, `dialog:default`; `csp: null` | `gui/package.json`, `Cargo.lock`, `capabilities/default.json`, `gen/schemas/desktop-schema.json` |

Consequence: of the "1–2 weeks" the backlog row still sizes, the browser, the
test harness and macOS signing are gone. What is actually open is
**auto-update, a Linux desktop artifact, the Windows signing hand-off, and a
short list of UX debt** — this document.

---

## 1. Auto-update (Tauri updater plugin)

### 1.1 Decisions

- **Mechanism.** `tauri-plugin-updater` 2 + `tauri-plugin-process` 2 (for
  `relaunch()`), JS packages `@tauri-apps/plugin-updater` and
  `@tauri-apps/plugin-process`. Justification for the new dependency: it is
  the only in-app update path Tauri supports, it is first-party, and it adds
  no runtime beyond what the app already links (reqwest is already a tauri
  transitive; the plugin adds minisign verification). Compile cost is a
  couple of minutes on a cold cache — accepted on the macOS/Linux legs; on
  Windows it is a small addition to a GUI build step that already exists.
- **Channel.** Stable only. The single endpoint is
  `https://github.com/okohlbacher/FASTag/releases/latest/download/latest.json`.
  GitHub's `latest` resolves to the newest **non-prerelease, non-draft**
  release, which is why the taxonomy data release must stay a pre-release
  (`ci.yml:74-75` already demands this) — a data tag must never become
  "latest" or every desktop app would fetch a manifest that is not there.
  No `{{target}}`/`{{current_version}}` templating, no channel field, no
  beta: a pre-release GUI build simply gets no `latest.json` and is never
  offered.
- **Trust model.** Transport is HTTPS to GitHub; integrity and authenticity
  of each **artifact** come from the minisign signature verified against the
  public key baked into the app (`plugins.updater.pubkey`). The pubkey is the
  root of trust for Windows and Linux users (no Authenticode yet, no Linux
  code-signing ecosystem); on macOS it sits beside Developer ID +
  notarization (which the updater does not itself re-check). What the
  signature does **not** cover is the manifest's metadata: `version`, `url`
  and `notes` are protected only by GitHub release-write access — a release
  writer without the key could advertise a higher version that points at an
  older, genuinely signed artifact (a downgrade). That is the same access
  that already controls the DMG people download by hand, so the updater does
  not widen it; it is recorded as an accepted risk, not a guarantee.
- **Never silent, and never during a run — in either direction.** The app
  checks on launch and on a "Check for updates" click; it downloads and
  installs only after the user clicks Install. `Install` is offered only when
  no run or batch is in flight, and **once an update is downloading or
  installed-pending-restart, Run / Run batch are disabled** (with the reason)
  until the app restarts — otherwise an analysis started mid-download would
  be killed on Windows (the installer exits the app) or have its resources
  swapped underneath it on macOS/Linux. "Restart to finish" is gated the same
  way. Auto-check failures (offline, `TargetsNotFound` for a platform not yet
  in the manifest) are silent; manual-check failures are shown, and every
  shown failure carries the GitHub releases link as the manual fallback.

### 1.2 Signing keypair — where the private key lives, and who can reach it

- Generated **once, on the maintainer's machine**, never in CI:
  `npm run tauri signer generate -- -w ~/.tauri/fastag-updater.key` (with a
  password). The private key file and its password go into the maintainer's
  password manager. **It is never committed**; `gui/src-tauri/.gitignore`
  gets `*.key` as a belt-and-braces line.
- The public key (`~/.tauri/fastag-updater.key.pub`, base64 minisign) is
  committed in `tauri.conf.json` as `plugins.updater.pubkey` (a literal, not a
  path).
- **The build jobs never see the key.** `bundle.createUpdaterArtifacts` stays
  **off**, so `npm run tauri build` behaves exactly as today on tags, dry runs
  and developer machines — no new "private key missing" failure, no change to
  the signed DMG flow (`ci.yml:877-934`). The legs attach *unsigned* updater
  artifacts (§1.3). Signing and manifest publication happen in **one
  dedicated workflow, `.github/workflows/updater.yml`**, whose `publish` job
  is the only job in the repository that references the GitHub environment
  **`release`**. The two secrets `TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` are **environment secrets** added
  through the GitHub web UI — available only to jobs that reference the
  environment, which is the property that makes the gate real (a job-level
  `environment:` on the existing `build`/`windows-x64` matrix jobs would
  either gate every PR build or need an expression-valued environment; a
  dedicated job avoids both). Environment settings: **required reviewer =
  the maintainer, "prevent self-review" on, deployment tags restricted to
  `v*`** — so a branch `gui_dry_run` cannot reference the environment at all,
  and the key is unreachable from anything but a tag.
- The publish job runs no code from the repository tree except the committed
  manifest script; the Tauri CLI it uses is pinned by version
  (`npx --yes @tauri-apps/cli@2.11.4 signer sign`), and the AppImage tooling
  that §2 downloads at build time is not in this job at all.
- **Residual risk, stated plainly.** Anyone who can push a `v*` tag and get
  the maintainer to click Approve can cause a release to be signed. The
  reviewer is approving a specific commit's workflow file and manifest
  script; that is the control. For a single-maintainer repository this is an
  acceptable, explicit trust decision. The stricter alternative — offline
  signing on the maintainer's machine with `tauri signer sign` and a manual
  upload of `.sig` files + manifest — is the fallback if that ever stops
  being true; the publish job's script is written so it can be run locally
  for exactly that.
- **Key rotation.** The pubkey is baked into every installed copy, and a
  manifest carries one signature per platform, so a rotation from key A to B
  is a *bridge release*: config pubkey = B, artifacts signed with A (possible
  because the publish job signs with `tauri signer sign`, which does not
  check the config pubkey — the publish job's own verification step is told
  which pubkey to verify against). Clients that install the bridge trust B
  from then on. **Clients that skip the bridge are stranded** — they will
  see signature failures on every later manifest — so a rotation is
  announced in the release notes and in the manual-check error text
  ("download from GitHub"), and the bridge is kept as `latest` for at least
  one full release cycle before any B-signed release. **Key compromise**
  cannot be repaired by signing (the attacker can sign a bridge too):
  rotate the environment secret immediately, and every installed copy is a
  manual reinstall from GitHub, announced the same way. Both procedures go in
  `doc/SIGNING-macos-gui.md` (the signing runbook for all three mechanisms).
- **Key loss** = no further updates can be offered to installed copies until
  they reinstall; same announcement path.

### 1.3 Artifacts, signing, and `latest.json`

- `tauri.conf.json`: `"plugins": { "updater": { "pubkey": …, "endpoints": [ … ], "windows": { "installMode": "passive" } } }`.
  `createUpdaterArtifacts` is **not** set (§1.2); the legs produce the
  updater payloads themselves, in the same shape Tauri's own bundler would:
  - macOS: `tar -czf FASTag-gui-macos-<arch>.app.tar.gz -C src-tauri/target/release/bundle/macos FASTag.app`
    — the **finished** `.app` (Tauri has signed, notarized and stapled it
    before the DMG is built, `ci.yml:901-911`), archived with exactly one
    root component `FASTag.app/`. The plugin strips that first component and
    renames the extracted tree onto the running bundle, which is exactly
    what it does with Tauri's own `.app.tar.gz`. The dry run asserts the
    stapled ticket survives: extract and `xcrun stapler validate` the
    `.app` inside.
  - Windows: the NSIS `FASTag-gui-windows-x64-setup.exe` already attached —
    the SignPath-signed one when SignPath ran, the unsigned one otherwise.
    Because the minisign signature is applied **last**, in `updater.yml`, the
    Authenticode-changes-the-bytes ordering trap does not exist.
  - Linux: `FASTag-gui-linux-<arch>.AppImage` (§2).
- **Frozen once advertised.** After `latest.json` exists on a release, the
  bytes at the advertised URLs must not change (`--clobber` on a re-run would
  leave a `.sig` that no longer matches, and clients would reject the
  download). Every attach step in `ci.yml`/`windows.yml` therefore checks
  `gh release view --json assets` first and **refuses** (exit 1, clear
  message) to clobber an updater artifact on a release that already carries
  `latest.json`, unless a `force_reupload` dispatch input is set — in which
  case the maintainer re-runs `updater.yml` afterwards, and its verification
  (below) is what catches a forgotten re-sign.
- **`updater.yml` — one publisher, run after either workflow finishes.**
  Trigger: `on: workflow_run: { workflows: [ci, windows], types: [completed] }`
  plus `workflow_dispatch` with a `tag` input for reconciliation (a cancelled
  or failed finalizer, a `force_reupload`, or anything else that leaves a
  complete release without a manifest). `concurrency: { group: updater-<tag>, cancel-in-progress: false }`
  serialises the two `workflow_run` triggers that fire minutes apart.
  1. `ready` (no environment): derive the tag from the triggering run's
     `head_branch` (a tag push) or the dispatch input; require the ref to
     match `v*`; `gh release view <tag> --json assets`; for every expected
     platform key (`darwin-aarch64`, `darwin-x86_64`, `windows-x86_64`, and
     `linux-x86_64`, `linux-aarch64` once §2 ships) require the artifact to be
     present. Output `complete=true|false`. If false, print which are missing
     and finish **green** — the other workflow's completion will trigger the
     next attempt. No approval is requested for an incomplete release.
  2. `publish` (`environment: release`, `needs: ready`, `if: complete`):
     download every artifact; sign each with the pinned Tauri CLI (produces
     the base64 `.sig`); **verify** each `.sig` against the committed pubkey
     independently (`minisign -Vm <artifact> -x <decoded sig> -p <decoded pubkey>`,
     `minisign` from apt — verify the decode step on the first dry run, it
     is the one untested detail); upload the `.sig` files; write
     `latest.json` with `version` (tag minus `v`), `notes` (release body),
     `pub_date` (RFC 3339), `platforms.<key>.{url,signature}` where `url` is
     the **versioned** permalink
     `https://github.com/okohlbacher/FASTag/releases/download/<tag>/<asset>`
     (never `latest/`, so a manifest is self-consistent); upload it with
     `--clobber`; then re-download each advertised artifact and re-verify its
     signature — a red publish job is the completeness assertion for updater
     assets, and it fails loudly on a stale `.sig`.
  Everything above is `gui/scripts/updater-publish.sh` (bash + jq + minisign,
  ~120 lines) with a `--from-dir <fixture>` mode; the `gui` CI job runs it
  against a checked-in fixture (unsigned artifacts + a throwaway test key
  checked in **only** for the fixture, never used to sign a release) and
  asserts the "waiting" exit, the emitted JSON shape, and that a tampered
  fixture artifact fails verification. The manifest format is user-facing
  (a wrong key name means no updates for a platform), so it gets a test.
- **Gates keep platform ownership.** `ci.yml`'s `release-complete` and
  `windows.yml`'s stay as they are (plus the installer, §3); neither asserts
  `latest.json`, because neither owns it — asserting it from the
  first-finishing workflow would go red on every normal release. `updater.yml`
  owns the `.sig`s and the manifest.
- Window of no-manifest: `gh release create` (`ci.yml:930`) makes the new
  release "latest" as soon as the first leg lands, an hour or two before
  `latest.json` exists. During that window the endpoint 404s, the plugin
  treats non-2xx as "next endpoint", there is none, `check()` errors, and the
  auto-check swallows it. Users simply see no offer until the manifest lands.
  The `--clobber` replace of `latest.json` itself has a sub-second delete-
  then-upload gap with the same harmless effect. If either ever matters, host
  the manifest on the existing `gh-pages` branch instead (atomic publish) —
  noted, not planned.

### 1.4 Platform behaviour

**macOS — DMG install vs in-place update.** The `.dmg` is the first-install
vehicle; updates never touch it. `tauri-plugin-updater` locates the running
bundle as `current_exe/../../..` when the executable path contains
`Contents/MacOS` — and **otherwise falls back to the executable's own
directory**, which is how a dev binary under `target/debug` would try to
"update" itself. It extracts the new `.app.tar.gz` into a temp dir, renames
the old bundle into a temp backup, moves the new one into place, and on
`PermissionDenied` escalates through AppleScript `do shell script … with
administrator privileges` (an admin-password prompt). Real failure modes:

1. App launched **from the mounted DMG**: the volume is read-only; the
   rename fails with `EROFS`, which is not `PermissionDenied`, so no
   escalation — a bare I/O error.
2. **App Translocation**: a quarantined bundle launched without having been
   moved by the user runs from a randomised read-only
   `/private/var/folders/…/AppTranslocation/…` path. The updater would target
   the translocated copy. Dragging to `/Applications` (the DMG already offers
   the `Applications` symlink) clears translocation.
3. A non-admin user with a read-only `/Applications`: the AppleScript prompt
   appears and, if declined, the update fails.
4. Not a bundle at all (dev build, or an unpacked binary): the fallback
   above would replace the wrong directory.

Mitigation (planned): a small Rust command `install_location()` returning
`{ path, updatable: bool, reason }` that classifies the executable path — on
macOS `updatable = false` unless the path contains `Contents/MacOS` **and**
does not start with `/Volumes/` **and** does not contain `/AppTranslocation/`;
on Linux `false` when `APPIMAGE` is unset (a `.deb` install or a dev build)
or the AppImage's directory is not writable; on Windows `true` only for an
installed location (the NSIS install dir; never a `target/` build). The UI
shows "Move FASTag to Applications, then update" (or the Linux/dev
equivalent) instead of an Install button. The classifier is pure and
unit-tested. After a successful swap the new bundle carries no quarantine
attribute (it was not downloaded by a browser), and it is signed, notarized
and stapled anyway, so Gatekeeper is satisfied either way.

**Windows — the unsigned installer.** The updater downloads the NSIS
installer to a temp file, verifies the minisign signature, launches it with
`ShellExecuteW` using the passive-mode flags plus `/UPDATE`, and exits the app
(`std::process::exit(0)`) because Windows installers cannot replace a running
executable. The installer is per-user (Tauri's `installMode` default
`currentUser`), so no UAC prompt. SmartScreen keys on the mark-of-the-web,
which browser downloads carry and a file written by the app does not, so the
updater-launched installer is not expected to hit the "Windows protected your
PC" dialog — **this is precisely the claim the validation gate tests on a real
Windows machine**, because the first-install experience (a browser download)
and the update experience differ here. Two things it does *not* cover, both
belonging to §3: Smart App Control (enforcing systems) judges the **installed
GUI executable**, which nobody signs today; and Authenticode signing of the
installer is orthogonal to the minisign check, which is the integrity
guarantee regardless.

**Linux.** Only the AppImage is updatable (the plugin swaps the AppImage file
in place, needing a writable temp dir on the same mount and a writable
target). `.deb` users get "new version available" with a link, no Install.
Details and the artifacts themselves are §2; until §2 lands, Linux has no
`platforms` key and no offer.

**v1.4.2 and earlier** have no updater; the first updater-enabled release is
a manual upgrade for everyone, announced in its notes.

### 1.5 GUI ↔ CLI version consistency

The CLI inside the app is staged from the **same CI run** that builds the app
(`ci.yml:816-832`, `windows.yml:931-941`) and the CI already asserts the
bundled CLI reports the CMake project version (`ci.yml:863-867`). An update
replaces the whole bundle — resources included — so GUI and CLI move together
by construction; there is no separate CLI channel and none is planned.

Two guards to add, both cheap:

1. **CI, tag builds:** assert `tauri.conf.json .version == gui/package.json
   .version == CMake project version == tag name minus "v"` before anything
   is built (a ~10-line step in both workflows). Today three files are
   bumped by hand in the release commit (`d203085`) with no check; the
   updater turns a forgotten bump into "the new release is never offered"
   (manifest version not greater than the installed one). The updater
   compares against Tauri's package version, which is `tauri.conf.json`'s
   when set, so the stale `Cargo.toml` (1.2.1) cannot by itself cause a loop
   or a missed offer — bump it anyway and include it in the assertion so the
   question never comes up again.
2. **Runtime:** the header badge already shows the probed CLI version
   (`App.tsx:385`, `fastag.rs:146-150`). Compare it with the app version
   (`getVersion()` from `@tauri-apps/api/app`; `core:app:default`, already
   granted via `core:default`, includes `allow-version`) and render the badge
   amber with "CLI x.y.z ≠ app a.b.c" on mismatch. It can only differ under
   `FASTAG_BIN` (`fastag.rs:89-95`) or a hand-edited bundle, and that is
   exactly when a user should see it. Tested via the mock bridge (`probe`
   returns a different version).

### 1.6 Rollback

None automatic, and none planned: the plugin restores its backup only if the
swap itself fails part-way. The rollback story is "every release keeps its
DMG/installer/AppImage on GitHub; reinstall the previous one by hand". The
updater will not offer a downgrade under honest metadata (default comparator
is `remote > current`; see §1.1 for why that is not a security property).
User state survives either direction: presets and last-used parameters live in
`fastag-settings.json` under the app config dir (`settings.rs:45`), outside
the bundle. Document in the README's install section; no UI.

### 1.7 Frontend

- `gui/src/Updater.tsx` (~130 lines): a header strip with three states —
  "vX available · Install · Later", download progress (bytes of ~520 MB; see
  Risks), "Restart to finish" (`relaunch()` on macOS/Linux; on Windows the
  installer exits the app). Plus a "Check for updates" item in the header.
- Shared run/update state: `App.tsx` gains `updating: 'idle' | 'downloading' | 'ready'`;
  `canRun` (`App.tsx:363`) and the batch button (`App.tsx:435`) require
  `idle`; `Install` requires `!running && !batchRunning`; `Restart` requires
  the same. The disabled Run carries a title "update in progress — restart to
  finish".
- Bridge (`api.ts`/`types.ts`/`mockBridge.ts`): `checkUpdate(): Promise<UpdateInfo | null>`,
  `installUpdate(onProgress): Promise<void>`, `relaunch()`,
  `installLocation()`. The mock's control surface gains
  `setUpdate(info | null | Error)`, `holdInstall/releaseInstall`, and
  `setLocation(...)`.
- Tests (vitest, `Updater.test.tsx` + cases in `App.test.tsx`): offer
  rendered only when `checkUpdate` returns a release; Install disabled while
  `running`/`batchRunning`; **Run and Run batch disabled while downloading
  and while ready-to-restart** (the reverse direction); Restart disabled
  while running; auto-check error silent, manual-check error shown with the
  releases link; non-updatable location shows the "move to Applications"
  text and no Install; progress rendered from `onProgress` callbacks; badge
  amber on version mismatch. Rust: unit tests for the location classifier
  (bundle path, `/Volumes/`, translocation, `target/debug`, AppImage with and
  without `APPIMAGE`, unwritable dir).
- Capabilities: add `updater:default` and `process:default` to
  `capabilities/default.json`. `csp: null` stays; the fetch is Rust-side.

### 1.8 Steps, files, effort, risks, gate

Steps: (1) maintainer generates the keypair, creates the `release`
environment (reviewer, prevent self-review, tags `v*`) and adds the two
environment secrets; (2) Cargo/npm deps, plugin registration in `lib.rs`,
capabilities; (3) `tauri.conf.json` updater block (no `createUpdaterArtifacts`);
(4) `update.rs` with `install_location`; (5) bridge + `Updater.tsx` + shared
run/update state + tests; (6) `updater-publish.sh` + fixture test in the
`gui` job; (7) CI: legs attach unsigned updater artifacts and refuse to
clobber advertised ones; `updater.yml`; version-consistency assert; dry runs
embed the taxonomy (so a dry-run artifact is what a tag would ship);
(8) `gui_dry_run` on both workflows; (9) end-to-end update test (gate);
(10) README + signing runbook text.

Files: `gui/src-tauri/{Cargo.toml, tauri.conf.json, capabilities/default.json, .gitignore, src/lib.rs, src/update.rs (new)}`,
`gui/{package.json, package-lock.json}`, `gui/src/{api.ts, types.ts, Updater.tsx (new), Updater.test.tsx (new), App.tsx, App.test.tsx, testing/mockBridge.ts, index.css}`,
`gui/scripts/updater-publish.sh` (new) + fixture, `.github/workflows/{ci.yml, windows.yml, updater.yml (new)}`, `README.md`, `doc/SIGNING-macos-gui.md`.

Effort: ~3–3.5 days (config + `updater.yml` + attach/freeze logic 1.5 d,
frontend + interlock + tests 1 d, classifier and platform guards 0.5 d, dry
runs and the end-to-end gate 0.5 d).

Risks: a 500 MB download per update because the taxonomy rides inside the
bundle (see "not doing" for the split); the two-workflow publication shape is
unusual — the fixture test plus one observed tag run plus one deliberate
reconciliation dispatch are the evidence; the frozen-artifact rule adds a
new way for a re-run to go red (by design, with a message); translocation/
DMG-launch on macOS (guarded, still a support question); disk on the macOS
runner (the `.app.tar.gz` is another ~500 MB beside the `.app` and the
`.dmg`); a stale `Cargo.toml`/config disagreement caught only by the new
assert.

Validation gate (all must pass before a tag): (a) `gui_dry_run` on `main` on
both workflows — with the taxonomy index embedded on dry runs from now on —
proves the unsigned updater artifacts exist and, on macOS, that the `.app`
inside the tar.gz validates with `stapler`; (b) the fixture test for the
publish script is green in the `gui` job; (c) **end-to-end with two packaged,
updater-enabled builds — never a dev build, never a draft release** (draft
assets are not anonymously downloadable, and a dev binary is not the
installed app): build v0 from a dry run with a dispatch input
`updater_endpoint` that overrides the endpoint at build time to a manifest
on a throwaway **pre-release** tag `updater-test-<date>` (pre-releases never
become `latest`, and their assets are public); build v1 normally; sign and
publish v1's manifest to the test tag with the publish script run locally
against a **test** key whose pubkey v0 was built with; install v0 from its
DMG/installer on macOS arm64, macOS x64 and Windows, accept the update,
confirm relaunch, the new version in the badge, the bundled CLI's `--help`
version, and a `-species` run (proves the resources were replaced whole);
delete the test tag afterwards; (d) tamper test: flip a byte in a published
artifact and confirm the install is refused; (e) Windows: confirm no
SmartScreen interception on the updater-launched installer, and that a run
in progress blocks Install and a download in progress blocks Run;
(f) reconciliation: cancel `updater.yml` mid-way once, then dispatch it by
tag and confirm it publishes.

---

## 2. Linux desktop packaging

### 2.1 Decisions

- **Both `.deb` and `.AppImage`**, x86_64 first. The `.deb` is the primary
  artifact (plain files on disk, no FUSE, `apt`-visible); the AppImage exists
  because it is the only Linux format the updater can replace in place and
  because it runs on non-Debian distributions. Not `.rpm`, not Flatpak/Snap
  (see "not doing").
- **Built on the existing Linux legs** (`ubuntu-24.04`, `ubuntu-24.04-arm`),
  tag-only plus `gui_dry_run`, after the CLI `dist/` is assembled and
  smoke-tested — the same shape as the macOS leg, so the app always wraps the
  CLI that just passed its portability check.
- **glibc floor — two different floors, stated separately.** The CLI is
  compiled with conda-forge's `cxx-compiler` (`ci.yml:207`), which carries
  its own sysroot, so the CLI tarball's glibc requirement is whatever that
  sysroot targets — **not** the runner's 2.39, and the earlier assumption
  "the tarball already has the 24.04 floor" was wrong. The desktop app is
  different: its Rust binary links the runner's glibc and `libwebkit2gtk-4.1`,
  so building on 24.04 gives the app a 24.04-class floor (Ubuntu 24.04,
  Debian 13, Fedora 40+). Two actions: (i) the Linux leg prints both floors
  (`objdump -T <bin> | grep -o 'GLIBC_[0-9.]*' | sort -V | tail -1` on
  `FASTag.bin` and on the app binary) so the README states measured numbers;
  (ii) the app stays on 24.04 for now — lowering it means a separate 22.04
  job that receives the 1.5 GB `dist/` as a workflow artifact, a real cost
  for a floor nobody has asked for yet. Revisit on the first complaint.
- **arm64: yes, cheaply, gated after one green dry run.** The arm64 leg
  exists, Tauri builds AppImages natively on aarch64 (no cross-compile; it
  downloads `linuxdeploy-aarch64` and `AppRun-aarch64`), and the CLI already
  ships for that platform. It goes into the `release-complete` want list only
  once a `gui_dry_run` has produced it — an untested tag-only path is the trap
  this repo's CI notes keep warning about.

### 2.2 Resource layout — the same `resources/fastag/{bin,share}`

Yes, it fits unchanged (the reviewer found no issue here either). Tauri
places `bundle.resources` under `usr/lib/<productName>/` in the `.deb`
(`/usr/lib/FASTag/resources/fastag/…`) and under `$APPDIR/usr/lib/FASTag/…`
in the AppImage; at runtime `resource_dir()` resolves to exactly those, and
`resolve_binary` joins `resources/fastag` onto it (`fastag.rs:97-98`) — no
Rust change.

Staging step (mirrors `ci.yml:816-832`, Linux flavour):

- `bin/FASTag` ← `dist/FASTag/FASTag.bin` (RPATH `$ORIGIN/lib`, `ci.yml:479`),
- `bin/lib/` ← `dist/FASTag/lib` (each `.so` RPATH `$ORIGIN`, `ci.yml:482`) —
  **beside the binary**, the same shape macOS uses for the same reason,
- `share/OpenMS` ← `dist/FASTag/share-OpenMS`,
- `share/FASTag/taxonomy` ← `dist/FASTag/share-FASTag-taxonomy` (a hard
  failure when `tax_k7.taxdb` is missing, on tags **and** on dry runs now
  that dry runs embed the index — `ci.yml:840-848` is the model).

Copy with `cp -RL`: `dist/FASTag/lib` contains symlinks (the BLAS aliases,
`ci.yml:463,475`), and Tauri's resource copier is documented to skip
symlinked **directories** and untested on symlinked files; dereferencing
costs a few duplicated MB and removes the question. The CLI wrapper script
(`ci.yml:509-514`) is not staged: the GUI sets `OPENMS_DATA_PATH` and
`FASTAG_TAXONOMY_DIR` itself (`fastag.rs:298-305`). Assert from inside the
staged tree, as macOS does (`ci.yml:855-859`):
`env -i HOME=$HOME "$R/bin/FASTag" --help` and the version grep.

### 2.3 Caveats worth writing down

- **FUSE.** AppImage's type-2 runtime needs `libfuse.so.2` on the host;
  Ubuntu 22.04+ ships fuse3 and users must `apt install libfuse2` or run with
  `--appimage-extract-and-run`. Goes in the README's Linux row.
- **mmap through squashfs.** The CLI memory-maps the 1.1 GB index
  (`TaxIndex.cpp:457`). Inside an AppImage those pages are served by the FUSE
  daemon from a compressed squashfs — correct, but slower on a cold
  `-species` run. Measure in the gate (same input, `.deb` vs AppImage); if
  the AppImage is >2× slower, say so in the README rather than "fix" it.
- **Build-time network, and it is not pinned.** Tauri's bundler downloads
  `linuxdeploy` and `AppRun` from mutable release assets on
  `github.com/tauri-apps/binary-releases` and the gtk plugin **script from
  `master`** of `tauri-apps/linuxdeploy-plugin-gtk` — none of it is fixed by
  the Tauri CLI version. That code executes on the runner during the build.
  Since §1.2 keeps the updater key out of the build jobs, a compromised
  download cannot steal the key; it could still produce a bad AppImage, which
  the publish job would then sign. Mitigation: pre-seed `~/.cache/tauri`
  (the bundler's cache directory) in the Linux leg from **pinned URLs with
  checked-in SHA-256s**, and assert in the build log that no download
  happened. **Open detail:** confirm on the first dry run that the bundler
  reuses a pre-existing cache file rather than re-downloading; if it does
  not, fall back to verifying the cache's checksums *after* the build and
  failing the leg on mismatch.
- **Size and disk.** `.deb` ≈ 500 MB compressed / ~1.5 GB installed;
  AppImage ≈ 500 MB. The runner will hold `dist/` + `resources/` + AppDir +
  both packages (~6 GB); `df -h` in the step, and delete the AppDir after
  the AppImage is written if it gets tight.
- **`.deb` depends.** Tauri's CLI injects `libwebkit2gtk-4.1-0` and
  `libgtk-3-0`; nothing else is needed — the CLI's closure travels in
  `bin/lib` exactly as in the tarball, whose portability check already runs
  from `/tmp` (`ci.yml:625`).
- **Updater interplay.** Only the AppImage joins `latest.json`
  (`linux-x86_64`, later `linux-aarch64`); the `.deb` app reports
  `updatable: false` via `install_location()` and shows a link. The
  AppImage is signed by `updater.yml` like everything else.

### 2.4 Steps, files, effort, risks, gate

Steps: (1) Linux legs: install `libwebkit2gtk-4.1-dev librsvg2-dev
libgtk-3-dev` + node 24 (tag/dry-run only); pre-seed the Tauri tool cache;
(2) staging step + in-tree CLI asserts + glibc floor print; (3) `npm ci &&
npm run tauri build -- --bundles deb,appimage`; (4) post-build asserts:
`dpkg-deb -c` lists `usr/lib/FASTag/resources/fastag/bin/FASTag` and
`…/share/FASTag/taxonomy/tax_k7.taxdb`; the AppImage is exercised **through
its own launcher** (`./FASTag*.AppImage --appimage-extract-and-run` needs a
display for the GUI, so the CI check is `--appimage-extract` + run the
extracted CLI with `env -i`; the launcher itself is the manual gate on a real
machine); (5) attach as `FASTag-gui-linux-{x64,arm64}.{deb,AppImage}`
(refusing to clobber an advertised artifact, §1.3), dry-run uploads workflow
artifacts; (6) extend `release-complete`; (7) README install table + Linux
caveats + measured glibc floors; (8) extend the `gui_dry_run` input's reach
to the Linux legs.

Files: `.github/workflows/ci.yml`, `gui/src-tauri/tauri.conf.json` (only if
a `bundle.linux` block is needed — none expected), `README.md`, `gui/README.md`.

Effort: ~1.5 days CI + 0.5 day on a real Ubuntu 24.04 machine (both formats,
`-species` timing, FUSE message, launch through the AppImage runtime) +
0.5 day arm64.

Risks: runner disk; Tauri's copier and the 1.5 GB tree (a symlink or a
permission bit surfacing as a missing file at first launch — the in-package
asserts exist for this); AppImage `-species` performance; the tool-cache
pinning detail above; a `.deb` whose `Package: fastag` collides with a
future distro package of the CLI (accept; rename to `fastag-desktop` via
`productName` only if it ever matters — that would also move
`/usr/lib/FASTag`).

Gate: `gui_dry_run` green on both Linux legs with the in-package asserts
(index included, since dry runs now embed it); on a clean Ubuntu 24.04 VM:
`apt install ./FASTag-gui-linux-x64.deb`, launch, run the E. coli fixture
with `-species` from the GUI, confirm the species tab; the AppImage the same
**launched as an AppImage** after `apt install libfuse2`, plus timing.

---

## 3. Windows signing wiring (once the SignPath project exists)

The CI is already scaffolded; what remains is configuration, secrets, one
real gap, and a few small workflow edits:

1. **Config + secrets (maintainer, outside the repo except one line).** Read
   the project slug off SignPath's project page and set
   `SIGNPATH_PROJECT_SLUG` in `windows.yml:119`; add `SIGNPATH_API_TOKEN` and
   `SIGNPATH_ORG_ID` via the GitHub web UI. The artifact configuration
   `initial` (zip containing `*.exe`, `windows.yml:704-708`) matches every
   `.exe` in the zip; policies `test-signing` and `release-signing` (manual
   approval on) per `BACKLOG-ci.md:213-216`.
2. **The gap: the GUI executable itself is never signed.** The first
   SignPath request signs the CLI (`windows.yml:735-743`, `fastag/build/FASTag.exe`),
   the second the NSIS installer (`:969-989`). The Tauri binary
   (`src-tauri/target/release/fastag.exe`) inside the installer stays
   unsigned, so a signed installer drops an unsigned program — Smart App
   Control on enforcing systems judges the installed executable, not the
   installer. SignPath's human approval cannot run inside `tauri build`'s
   own `signCommand` hook, so split the build: `npm run tauri build --
   --no-bundle` → upload **both** `fastag.exe` and the CLI's `FASTag.exe`
   in **one** SignPath request (the `initial` configuration's `*.exe` glob
   covers both) → copy the signed binaries back → `npm run tauri bundle`
   → the second request for the installer. Still two approvals per release,
   and the installer's payload is now fully signed. Assert after install (in
   the manual gate) with `Get-AuthenticodeSignature` on the installed
   `fastag.exe`, `FASTag.exe` and the installer.
3. **Dry-run artifact is the signed one.** `windows.yml:1027-1033` uploads
   `bundle/nsis/*.exe` — the unsigned build output — even when a
   `test-signing` dry run just signed it. Upload `signed-gui/*.exe` when the
   gate is enabled so the maintainer tests what would ship.
4. **Gate.** Add `FASTag-gui-windows-x64-setup.exe` to the Windows
   `release-complete` (`windows.yml:1085`) — today a missing installer ships
   green. (The `.sig` is `updater.yml`'s, §1.3.)
5. **Validate before tagging**: `windows` → Run workflow → `gui_dry_run` +
   `signing_policy: test-signing` (`windows.yml:66-80`).
6. **Doc fix** in `doc/SIGNING-macos-gui.md`: the header still says "WIRED,
   not yet exercised" (macOS is live) and names the slug placeholder `fastag`
   (it is `''`, `windows.yml:119`); add the payload-signing split.

Effort: ~1 day once the project exists (the build split and its dry run are
the new half-day); the OV certificate and organisation validation are the
long pole and are not this repo's work.

---

## 4. UX debt visible in the current App (file:line)

Each item is small, user-facing, and gets a vitest (or Rust) test. Ordered by
how often a real user hits it.

1. **A broken bundle passes the probe; a rejected probe leaves the app
   mute.** Two halves. (a) `fastag.rs:139-151`: any `Command::output()` that
   returns `Ok` yields `ok: true`, even when the child exited non-zero — a
   missing shared library (the loader starts, prints, exits 1) reports "runs,
   version unknown" and **enables Run**. Fix: `ok = out.status.success()`;
   Rust test with a fixture script that exits 1. (b) `App.tsx:116-123`:
   `probe().then(setBin)` and `loadSettings().then(...)` have no `.catch`; a
   rejected invoke leaves `bin` `null` forever: no badge, Run disabled
   (`App.tsx:363`), nothing said. Same at `App.tsx:129` for `taxdbInfo`.
   Fix: `.catch` → `setBin({ ok: false, detail })` and a visible line in the
   log. Test: mock `probe` rejects → badge reads "binary not runnable".
2. **Cancel renders as a failure — but a kill that misses must stay a
   success.** `fastag.rs:346` maps a killed child to `code: None` and
   `fastag.rs:358` always emits `message: null`, so `App.tsx:150` prints
   `— failed (exit null) —` and `App.tsx:319` marks a cancelled batch job
   `failed`. The naive fix ("cancel was called → cancelled") is wrong:
   `App.test.tsx:147-162` deliberately preserves `1/1 done` when the child
   finished just before the kill, and `cancel()` (`fastag.rs:366-376`)
   cannot tell. Fix: `CurrentRun` records `cancel_requested`; the coordinator
   emits `message: "cancelled"` only when **the request was made and the
   status is not a success**; a successful exit stays `ok: true` whatever
   was requested. UI prints `— cancelled —` and leaves the job `queued` (or a
   new `cancelled` state). Tests: Rust (requested + killed → cancelled;
   requested + exit 0 → ok), vitest (log line, job status), and the existing
   late-cancel test stays green.
3. **Windows paths in the batch list.** `App.tsx:425` uses
   `split('/').pop()`, so `C:\data\sample.mzML` shows in full. Use the same
   slash-agnostic basename `stripExt` already uses (`App.tsx:23-27`). Test
   with a backslash path.
4. **Stale help text.** `SpeciesPanel.tsx:42` says "Enable `species` under
   Advanced → Species detection"; since `b4cf6ff` there is no "Advanced" group
   and the section is top-level (`paramLayout.ts:115`). Test asserts the new
   wording.
5. **Non-zero exit is a line at the bottom of a `<pre>`, and stderr is not
   distinguishable.** `App.tsx:150` is the only signal; the CLI's real error
   is somewhere above it, and there is no way to copy the log. The bridge
   merges both streams into identical `fastag:log` strings
   (`fastag.rs:272-284`, `:319-332`), so a frontend "last stderr line"
   cannot be computed today. Fix in the bridge (not the CLI): the coordinator
   keeps the last N non-progress **stderr** lines and puts them in the done
   payload (`RunResult.stderrTail`); the UI shows an error strip above the
   log with the exit code and that tail, plus "Copy log". Optionally name
   TOPPBase exit codes (`ILLEGAL_PARAMETERS`, `INPUT_FILE_NOT_FOUND`, …) —
   verify the enum against OpenMS's `TOPPBase.h` before hardcoding; no CLI
   change. Tests: Rust (tail captured from stderr only), vitest (strip
   rendered from the payload).
6. **Stale results *and* stale species after a failed re-run.** `App.tsx:284`
   bumps `results` only on success, and `species` (`App.tsx:265-272`) is set
   only there too, so re-running into the same `out` and failing leaves the
   previous rows **and the previous species call** on screen under a fresh
   log. Clear both when a run starts for the path currently shown (or key
   both to the run that produced them). Test covers both panes.
7. **Presets overwrite silently.** `App.tsx:346-354` saves over an existing
   name with no confirmation; the comment at `:349` still talks about
   Electron. Inline "Replace 'name'?" on collision. Low.
8. **Silent save failures.** `App.tsx:282,289` call `saveLast` without
   awaiting; but the real miss is that `save` (`settings.rs:90-102`)
   **returns `false`** on an unwritable directory rather than rejecting, so a
   `.catch` alone would log nothing; `savePreset` (`settings.rs:117`) is the
   same. Fix: handle `false` explicitly (log line "could not save settings")
   for both, and `.catch` for the rejection case. Test both.

Not debt (deliberate): filters commit on Enter/blur (`ResultsTable.tsx:31-32`
explains why); the log being a `<pre>`; the two-tab results pane.

Effort: items 1–4 ≈ 1 day together (the probe and cancel halves are Rust +
TS); 5–8 ≈ 1 day.

---

## 5. Order, dependencies, and what is not being done

| # | work | effort | depends on | why here |
|---|---|---|---|---|
| 0 | **Guards**: version-consistency assert in both workflows; installer in the Windows gate; `Cargo.toml` bump; dry runs embed the taxonomy index | hours | — | prerequisites for 2 and 3; cheap; each closes a "ships green while wrong" hole or makes a dry run representative |
| 1 | **UX debt batch A** (§4 items 1–4) | ~1 d | — | hours each, user-visible today, parallelisable with anything |
| 2 | **Auto-update** for macOS + Windows, Linux notify-only (§1), incl. `updater.yml` and the frozen-artifact rule | 3–3.5 d | 0; maintainer keypair + `release` environment + secrets | the highest-value open item: every release is a 500 MB manual re-download for every user on two live platforms |
| 3 | **Linux packaging** (§2), then flip the AppImage into `latest.json` | 2.5 d + 0.5 d | 2 for the manifest part only; the packages themselves need nothing | closes the only platform with no desktop artifact |
| 4 | **UX debt batch B** (§4 items 5–8) | 1 d | — | useful, less frequent |
| 5 | **Windows signing wiring** (§3), incl. the payload-signing build split | 1 d | SignPath project + HSM certificate (external, days–weeks) | do the day the project exists |

Push discipline: each numbered item is one batched push (the Windows CI
cache rule); items 2, 3 and 5 each need a `gui_dry_run` on `main` before any
tag.

**Not doing, and why**

- **Splitting the taxonomy out of the bundle / delta updates.** Would cut an
  update from ~500 MB to ~30 MB and is the obvious follow-up — but it changes
  first-run (a data download with its own failure modes), the `resolve_binary`
  contract, the CLI's `FASTAG_TAXONOMY_DIR` handling, and the release layout,
  all at once. Not required for the updater to be viable (the reviewer
  agreed); do it after the updater exists and the download size has actually
  been complained about.
- **A beta/nightly channel.** One endpoint, one audience; a second channel is
  a second manifest and a settings UI for a user base that does not exist yet.
- **Auto-install without a click, or install while a run is active (or a run
  while an install is active).** A scientific tool must not kill an analysis
  to update itself.
- **A dynamic update server.** Static `latest.json` on GitHub does everything
  needed; a server is an operational liability.
- **Signing `latest.json` itself.** The plugin has no hook for it; the
  metadata risk in §1.1 is accepted and bounded by release-write access.
- **MSI**, **Windows arm64**, **macOS universal binary** (two DMGs stay — the
  universal bundle would double the CLI closure to ~1 GB per download),
  **`.rpm` / Flatpak / Snap** (no updater support for the last two; `.rpm`
  is one more untested artifact for a distribution family the CLI does not
  target either).
- **Signing the Linux artifacts** beyond minisign — no ecosystem to satisfy.
- **A separate 22.04 leg for a lower desktop glibc floor** — a real
  option, deferred until someone needs it (§2.1).
- **DuckDB / rusqlite results browser** — the shipped reader made it moot
  (§0).
- **Tightening `csp: null`** — worthwhile, but unrelated to this plan and
  easy to get wrong in the same change set.

---

## 6. What the maintainer adds (names only — never values in any file)

GitHub Actions secrets (web UI):
- `TAURI_SIGNING_PRIVATE_KEY` — new, updater private key file content;
  **environment secret** in `release`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — new; same environment
- `SIGNPATH_API_TOKEN`, `SIGNPATH_ORG_ID` — pending the SignPath project (§3)
- the seven `MACOS_*` secrets — already present and in use

Non-secret config:
- GitHub environment `release`: required reviewer, prevent self-review,
  deployment tags restricted to `v*` (§1.2)
- `SIGNPATH_PROJECT_SLUG` in `windows.yml` (§3)
- `plugins.updater.pubkey` + `endpoints` in `tauri.conf.json`;
  `updater:default`, `process:default` in `capabilities/default.json`
  (committed, §1)
- pinned `@tauri-apps/cli` version and `minisign` (apt) in `updater.yml`;
  pinned AppImage tool URLs + SHA-256s in `ci.yml` (§2.3)

---

## 7. Review findings and revisions

Reviewer: codex (GPT-6, `gpt-6-astra`), read-only, from the worktree root,
brief at `/tmp/brief-gui-plan.md`, output at `/tmp/review-gui-plan.md`. The
dispatch script reported exit 3 ("rejected a flag") — a false positive: its
guard matched the comment at `fastag.rs:7` ("…cannot inject an unknown
option") that codex echoed while reading; the review itself completed with
19 ranked findings and a disposition of all nine questions. Each finding was
re-checked against the tree before being accepted.

| # | finding (severity, real/theoretical) | verdict | what changed |
|---|---|---|---|
| 1 | Environment gate specified at the wrong level: environments attach to jobs, so "gate the signing step" either breaks `tauri build` (no key) or gates every PR build (high, real) | **CONFIRMED** (`ci.yml:91`, `windows.yml:428` are matrix/build jobs) | §1.2/1.3 redesigned: `createUpdaterArtifacts` stays off; legs attach unsigned artifacts; a dedicated `updater.yml` `publish` job is the only referent of the `release` environment |
| 2 | Dry-run approval could expose the key to branch-controlled code via `npm run tauri build` (high, theoretical with a concrete entry point) | **CONFIRMED** (`ci.yml:878`, `windows.yml:952` run `npm ci` on the dispatched ref) | Key never in build jobs; environment restricted to `v*` tags, prevent self-review; publish job runs only the committed script + a version-pinned CLI; residual risk stated in §1.2 |
| 3 | AppImage tooling downloaded at build time is not pinned (scripts from `master`, mutable release assets) (high, theoretical) | **CONFIRMED** (seen in `linuxdeploy.rs`: `raw.githubusercontent.com/…/master/linuxdeploy-plugin-gtk.sh`, `releases/download/linuxdeploy/…`) | Key isolated from the build (finding 1); §2.3 adds pre-seeding `~/.cache/tauri` from pinned URLs with checked-in SHA-256s; the cache-reuse behaviour is marked **OPEN** to confirm on the first dry run |
| 4 | Run/update interlock only one direction: a run started during a download is killed or has resources swapped (high, real) | **CONFIRMED** (`App.tsx:363`, `:435` know nothing of an update) | §1.1/1.7: shared `updating` state disables Run/Run batch/Restart; tests in both directions |
| 5 | Key rotation strands clients that skip the bridge; `tauri build` would reject old key vs new pubkey (high, real when rotating) | **CONFIRMED** | §1.2 rotation rewritten: bridge signed by the publish job (no config-pubkey check there), explicit verify-against-which-pubkey, "skippers reinstall" stated, compromise = reinstall |
| 6 | E2E gate cannot work as written: draft assets are not anonymously fetchable, a dev build is not the installed app, and the updater's non-bundle fallback targets the exe's directory (high, real) | **CONFIRMED** (updater.rs fallback; GitHub draft semantics) | §1.8(c) rewritten: two packaged updater-enabled builds, endpoint override at build time, a public pre-release test tag; §1.4 classifier now refuses non-bundle paths |
| 7 | `release-complete` in `ci.yml` would race the Windows workflow if it asserted `latest.json` (high, real on ordinary completion order) | **CONFIRMED** (`ci.yml:1126` runs after `build` only) | §1.3: gates keep platform ownership; `updater.yml`'s publish job is the completeness assertion for updater assets |
| 8 | Versioned URLs are not immutable under `--clobber`; a re-run leaves a stale `.sig`; concurrent callers; manifest delete-then-upload gap (medium, real on re-runs) | **CONFIRMED** (`ci.yml:934`, `windows.yml:1003`) | §1.3: attach steps refuse to clobber advertised artifacts unless `force_reupload`; publish job re-verifies every advertised artifact; single publisher with a concurrency group; the sub-second manifest gap accepted and noted |
| 9 | Cancellation can leave a complete release without a manifest forever (medium, real under cancellation) | **CONFIRMED** | §1.3: `updater.yml` also has `workflow_dispatch(tag)` for reconciliation; gate (f) exercises it |
| 10 | Artifact signatures do not authenticate the advertised version; a release writer can advertise a downgrade to an older signed artifact (medium, theoretical) | **CONFIRMED** | §1.1 trust model and §1.6 state it as an accepted risk bounded by release-write access; "not doing" adds signing the manifest |
| 11 | Dry runs skip the taxonomy embed, so Linux package assertions and species validation cannot pass on dry-run artifacts (medium, real) | **CONFIRMED** (`ci.yml:770` is tag-only; `:846` degrades to a warning) | §0 row added; item 0 in §5 extends the embed to dry runs; §2.2/2.4 asserts are hard on dry runs too |
| 12 | Windows dry-run uploads the unsigned installer even after a test-signing run (medium, real) | **CONFIRMED** (`windows.yml:1027-1033` uploads `bundle/nsis/*.exe`) | §3.3 |
| 13 | Signing the installer leaves the Tauri GUI executable unsigned; Smart App Control judges the installed exe (medium, real on enforcing systems) | **CONFIRMED** (`windows.yml:735-743` signs only the CLI; `:969-989` only the installer) | §3.2: `--no-bundle` → one SignPath request for both exes → `tauri bundle` → installer request; §0 row; §1.4 cross-reference; effort +0.5 d |
| 14 | `.catch` misses settings-save failures because `save` returns `false` (medium, real) | **CONFIRMED** (`settings.rs:90-102`, `api.ts:70`) | §4.8 handles `false` explicitly for `saveLast` and `savePreset` |
| 15 | Clearing `results` leaves stale species conclusions visible (medium, real) | **CONFIRMED** (`App.tsx:265-272`, `:593`) | §4.6 clears both panes |
| 16 | "cancel was called → cancelled" misclassifies a child that finished before the kill; `App.test.tsx:147` preserves `1/1 done` (medium, real) | **CONFIRMED** (test read; `fastag.rs:366-376` cannot tell) | §4.2: cancelled only when requested **and** not a success |
| 17 | The error strip cannot identify stderr: both streams arrive as identical `fastag:log` strings (medium, real) | **CONFIRMED** (`fastag.rs:272-284`, `:319-332`) | §4.5: stderr tail captured in the bridge and carried in the done payload |
| 18 | Startup catches miss a broken-bundle failure: `probe` reports `ok: true` on a non-zero exit (medium, real) | **CONFIRMED** (`fastag.rs:139-151`) | §4.1(a): `ok = status.success()`; §0 row |
| 19 | The runner does not establish the CLI's glibc floor — conda's compiler carries its own sysroot (low, real planning error) | **CONFIRMED** (`ci.yml:207` `cxx-compiler`) | §2.1 rewritten: two floors, both measured and printed by CI; app stays on 24.04 with the 22.04-leg option in "not doing" |

Areas the reviewer found sound, kept as written: §2.2 Linux resource layout
(`resource_dir`, `productName`, `bin/lib`, RPATHs, dereferenced BLAS
aliases); §1.5 version guard (comparing against the tag without `v`; the
stale `Cargo.toml` cannot cause a loop); §1.3 versioned permalinks and the
notarize-before-archive ordering; §1.4 Windows minisign-after-Authenticode
order and per-user `/UPDATE` behaviour; §4 items 3, 4, 7 as stated; §5
priorities; no CLI-output-contract change anywhere. Two of its asides were
adopted as well: run the AppImage gate through its actual launcher (§2.4),
and note that v1.4.2 is a manual upgrade to the first updater-enabled
release (§1.4).
