# Homebrew distribution for FASTag (macOS)

Status: implemented 2026-09-09, after an adversarial review (section 6).
Scope is macOS only: a third-party tap
[okohlbacher/homebrew-fastag](https://github.com/okohlbacher/homebrew-fastag)
carrying two casks that install the release disk images `ci.yml` already
produces, plus the automation that keeps the casks in step with each
release. homebrew-core is out of scope (it does not accept pre-built blobs
for a tool this size, and a from-source formula would mean building OpenMS
on the user's machine).

## 1. What the release contains (verified on v1.4.2)

Every `v*` tag publishes four macOS disk images with **fixed names** (no
version in the filename; each release carries its own copy):

| asset | content |
|---|---|
| `FASTag-gui-macos-{arm64,x64}.dmg` | Tauri-built desktop app `FASTag.app` at the volume root (plus an `Applications` symlink), Developer ID signed, notarized, ticket **stapled to the .app**; the image itself is signed. |
| `FASTag-macos-{arm64,x64}.dmg` | Command-line tool. Volume root holds one folder `FASTag/` (the `dist/FASTag` tree) plus `.VolumeIcon.icns`. The image is signed, notarized and **stapled**. |

`FASTag/` is: `FASTag` (a `/bin/sh` wrapper), `FASTag.bin` (the Mach-O,
hardened runtime, Developer ID), `lib/*.dylib` (157 files, its whole
closure, each signed), `share-OpenMS/` (OpenMS data, `OPENMS_DATA_PATH`),
and `share-FASTag-taxonomy/` (the 1.1 GB k-mer index, embedded at tag time).
The app bundles the same tree under
`Contents/Resources/resources/fastag/`. Bundle identifier `de.openms.fastag`.

The wrapper is the load-bearing detail for a Homebrew install:

```sh
#!/bin/sh
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export OPENMS_DATA_PATH="$HERE/share-OpenMS"
exec "$HERE/FASTag.bin" "$@"
```

It locates everything from `$0` and does **not** resolve symlinks. A plain
Homebrew `binary` stanza symlinks `$(brew --prefix)/bin/FASTag` to the
wrapper, `$0` becomes `/opt/homebrew/bin/FASTag`, `HERE` becomes
`/opt/homebrew/bin`, and the exec of `/opt/homebrew/bin/FASTag.bin` fails.
So the cask invokes the wrapper by its absolute staged path (section 2).

**Minimum macOS is not what the app declares.** `LC_BUILD_VERSION` of the
shipped Mach-Os (read from the v1.4.2 images):

| component | arm64 | x64 |
|---|---:|---:|
| `FASTag.bin` / the app's bundled `bin/FASTag` | 14.0 | 15.0 |
| `libmzpeak.dylib`, `libnumpress.dylib` | 14.0 | 15.0 |
| `libOpenMS.dylib` (bioconda) | 11.3 | 11.3 |
| `FASTag.app` `LSMinimumSystemVersion` | 11.0 | 11.0 |

Nothing in the build sets a deployment target, so the floor is the SDK of
whichever runner image built it (`macos-14` for arm64, `macos-15-intel` for
x64) and moves when GitHub retires an image. dyld refuses to load a Mach-O
on an older macOS than its minos, so on Intel macOS 11-14 the app installs,
launches, and every run fails. The casks declare the binaries' floor, not
the plist's (14 on arm64, 15 on x64), and the tap's CI re-derives it from
the images on every update (section 3.2, step 6). The upstream fix is a
`CMAKE_OSX_DEPLOYMENT_TARGET` in the build (open item, section 7).

`release-complete` (the job before the new one in `ci.yml`) asserts all
four images exist on the tag's release once every build leg has finished;
it is the gate for anything that publishes a checksum of those files.

## 2. The casks

Two casks, not one:

* `fastag` -- the desktop app (`app "FASTag.app"`).
* `fastag-cli` -- the command-line tool (`FASTag` on PATH).

Reasons: the app already carries its own private copy of the CLI, so one cask
installing both would put ~1.4 GB on disk twice; the audiences differ (a
workstation vs. a server or a script); and each can be upgraded, pinned or
uninstalled on its own. `brew install --cask okohlbacher/fastag/fastag
okohlbacher/fastag/fastag-cli` installs both in one line.

### 2.1 `Casks/fastag-cli.rb` (the app cask differs only where noted)

```ruby
cask "fastag-cli" do
  arch arm: "arm64", intel: "x64"

  version "1.4.2"
  sha256 arm:   "384bdc59868f470ece7e05c0201423e8d19f507a997668beb7d0f0b3d19759ee",
         intel: "7c81405742204a2ed0a4ec962fb34b55a53ddacbab92a60b5671862dcbb949e5"

  on_arm do
    depends_on macos: :sonoma
  end
  on_intel do
    depends_on macos: :sequoia
  end

  url "https://github.com/okohlbacher/FASTag/releases/download/v#{version}/FASTag-macos-#{arch}.dmg"
  name "FASTag command-line tool"
  desc "Command-line sequence-tag search and species identification for tandem MS"
  homepage "https://okohlbacher.github.io/FASTag/"

  livecheck do
    url :url
    strategy :github_latest
  end

  command_wrapper "FASTag", executable: "#{staged_path}/FASTag/FASTag"
end
```

`fastag`: url `FASTag-gui-macos-#{arch}.dmg`, `app "FASTag.app"`,
`uninstall quit: "de.openms.fastag"`, and a `zap trash:` list of the Tauri
app's per-user state under the bundle identifier (`~/Library/Application
Support/de.openms.fastag`, `Caches`, `Preferences/...plist`, `Saved
Application State`, `WebKit`).

Design points, with reasons:

* **Pinned `version` + per-architecture `sha256`**, not `version :latest` +
  `sha256 :no_check`. Pinning is what gives users integrity (the download
  must match the recorded digest), lets `brew outdated`/`brew upgrade` and
  `livecheck` work (a `:latest` cask is invisible to `brew upgrade` without
  `--greedy`), and makes an install reproducible. The cost -- one commit per
  release -- is what section 3 automates.
* **Versioned download URL** (`releases/download/v#{version}/...`), never
  `releases/latest/download/...`: a fixed digest must point at a fixed file.
  No `verified:` -- Homebrew 6 deprecates the parameter and verifies the
  host itself.
* **`arch` + `sha256 arm:/intel:`** is the compact modern form of
  `on_arm`/`on_intel` blocks for the download; `brew audit` and
  `brew bump-cask-pr` both understand it, and the bump tool rewrites exactly
  those lines. The `on_arm`/`on_intel` blocks carry only the per-arch
  `depends_on macos:` (symbol form; the `">= :sonoma"` string form is
  deprecated in Homebrew 6 and `brew style` rejects it). Stanza order is
  enforced by `brew style` and was fixed with `--fix`.
* **`command_wrapper`** (Homebrew >= 6.0.13, July 2026; homebrew-cask itself
  uses it, e.g. `blender`) writes
  `Caskroom/fastag-cli/<v>/.homebrew-command-wrappers/FASTag` containing
  `exec "<staged_path>/FASTag/FASTag" "$@"` and symlinks
  `$(brew --prefix)/bin/FASTag` to *that*. The wrapper's `$0` is then the
  absolute path inside the Caskroom and its relative lookup works; the whole
  `FASTag/` folder stays where Homebrew staged it. Verified: the shim on
  disk is exactly that, and `FASTag --help` from `/tmp` reports
  `Version: 1.4.2 (OpenMS 3.5.0-pre-exported-20251212)`.
* **`livecheck` with `:github_latest`** reads GitHub's "latest" release,
  which skips drafts and pre-releases -- the taxonomy data tags are
  pre-releases, so they never surface. `brew livecheck` reports
  `1.4.2 ==> 1.4.2`.
* **`uninstall quit:`** so `brew uninstall --cask fastag` quits a running
  app first (note: by bundle id, so it quits *any* running FASTag.app, not
  only the one this cask installed). The CLI has no `zap`: the only thing
  it writes outside the working directory is OpenMS's shared `~/.OpenMS/`
  marker directory, which other OpenMS tools use too.
* **No `auto_updates`** (no self-updater), no `caveats`.

### 2.2 Homebrew 6 tap trust

Non-official taps must be trusted before Homebrew loads any Ruby from
them. `brew install --cask okohlbacher/fastag/fastag-cli` (fully
qualified) taps the repository and trusts just that cask; the short-name
route is `brew tap okohlbacher/fastag && brew trust okohlbacher/fastag`.
The README shows the fully qualified form first. CI trusts the tap
explicitly before auditing it.

### 2.3 Gatekeeper and quarantine (what was observed, what was not)

Homebrew quarantines what it downloads and propagates the attribute to what
it copies out of the image. Observed on this machine after
`brew install --cask`:

* `FASTag.app` (installed into a scratch `--appdir`): `spctl -a -vv` says
  `accepted, source=Notarized Developer ID`; `stapler validate` passes; the
  app's own bundled `bin/FASTag --help` reports 1.4.2.
* `Caskroom/fastag-cli/1.4.2/FASTag/FASTag.bin` carries
  `com.apple.quarantine` (flag `0381`) and runs. `spctl -a -t execute` on it
  says `rejected (the code is valid but does not seem to be an app)`, the
  usual verdict for a bare Mach-O; execution is what matters and it works.
  The species smoke (139 spectra, 5057 tags, 35-line species report in
  7.7 s) ran through the PATH command from an unrelated directory.

Not established: cold **offline** first run of the CLI on a machine that
has never seen these binaries. A notarization ticket can be ingested from
the stapled image when it is assessed and then authorises the copied
Mach-Os locally, but whether Homebrew's `hdiutil` mount triggers that
ingestion is not documented by Apple and was not tested (it would need a
fresh VM). The manual drag-out has the same open question. Users on an
offline machine can pass `--no-quarantine`.

## 3. CI/CD: keeping the casks current

### 3.1 Two triggers, one implementation

The update logic lives in **one place, the tap** (`update-casks.yml`):

1. **`schedule`** (every 6 hours, `23 */6 * * *`) -- **zero secrets**: the
   tap's own `GITHUB_TOKEN` reads okohlbacher/FASTag's public releases and
   pushes to the tap. Latency: up to 6 h, and not a hard bound (GitHub
   delays or drops scheduled runs under load, and **disables the schedule
   after 60 days without a commit to the tap**; see 3.4).
2. **`workflow_dispatch`** with an input `tag` -- fired by the new last job
   in FASTag's `ci.yml` the moment `release-complete` is green, **if** the
   maintainer has added the PAT `HOMEBREW_TAP_TOKEN` (3.3). Latency:
   minutes. Without the secret the job prints a notice and the schedule
   covers it.

Why not have FASTag push into the tap directly: it would duplicate the
bump/audit/test logic in a second repository, need a PAT with `contents:
write` on the tap (versus `actions: write` for a dispatch), and would not
work at all until the secret exists.

### 3.2 `update-casks.yml` (tap side)

`runs-on: macos-15`; job `permissions: contents: write`; `concurrency:
update-casks`, `cancel-in-progress: false` (GitHub keeps one pending run per
group and replaces it when a third arrives -- acceptable, because every run
re-resolves what it should publish). Steps:

1. `actions/checkout`, then **symlink the checkout into
   `Library/Taps/okohlbacher/homebrew-fastag`** and `brew trust` it. The
   checkout *is* the tap: `brew bump-cask-pr` edits it in place and the
   final commit is pushed with the credentials `actions/checkout` left
   behind. The base SHA is recorded.
2. Resolve the release: the `tag` input (validated against
   `^v[0-9]+\.[0-9]+\.[0-9]+$` before it reaches a shell) or
   `releases/latest`. Drafts and pre-releases are refused on both paths.
3. **Completeness**: the four image names must be among the release's
   assets with `state == uploaded`. Missing on a scheduled run: `::warning`,
   no-op (still uploading, or FASTag's own `release-complete` is the loud
   signal); on a dispatch: fail. The four assets' `id/size/updated_at` are
   snapshotted.
4. Compare with the current cask version. Lower: refuse (a demoted or
   deleted release needs a human; the red run every 6 h is the alert).
   Equal: verify, do not rewrite (step 5).
5. A cask below the target version: `brew bump-cask-pr --write-only
   --no-audit --no-style --version <v>` -- Homebrew's own tool downloads
   both architectures' images, computes both digests and rewrites the
   stanzas. Verified locally: a cask forged to `1.4.1` with fake digests
   came back to `1.4.2` with the right digests in 3 s from cache. A cask
   already at the target version: `brew fetch --cask --arch all`, which
   downloads both images and checks them against the recorded digests
   (verified locally: a forged digest fails with "Cask reports different
   checksum"). A mismatch means the assets were replaced under the same tag
   and the run goes red with a message to cut a new release -- not
   repaired, because `brew upgrade` compares versions, not digests, so a
   digest refresh would not reach anyone who already installed. (The first
   live dispatch on GitHub found that `bump-cask-pr` raises "Unable to
   update cask" on a no-op, contrary to the brief's invariant 6; this is
   the fix.)
6. `brew audit --cask --strict --online --except=min_os`, `brew style`,
   `brew fetch --cask --arch all`, then
   **`.github/scripts/check-macos-floor.sh`**: mounts all four images, takes
   the highest `minos` over every Mach-O inside, and fails if a cask admits
   an older macOS than its payload loads on -- for both architectures, on
   one runner. This replaces the skipped `min_os` audit, which only compares
   against the app's plist (11.0) and never looks at the CLI inside.
7. Install test: `brew install --cask fastag-cli`; `FASTag --help` must
   print `Version: <v>`; the species smoke from `ci.yml` through the PATH
   command from an unrelated directory (proves wrapper, dylibs,
   `OPENMS_DATA_PATH`, taxonomy index); `brew install --cask fastag`;
   `spctl -a -vv` accepts, plist version matches, the app's bundled CLI
   runs; uninstall both; `FASTag` gone from PATH.
8. Commit only if `git diff --cached` is non-empty, **after** re-fetching
   the release and confirming the asset snapshot is unchanged (else fail:
   re-run) and confirming `origin/main` is still the SHA everything was
   tested on (else fail: re-run -- never rebase an untested combination).
   Commit as `github-actions[bot]`, push. Re-running for the same release
   therefore produces no second commit.

A push made with `GITHUB_TOKEN` does not trigger `tests.yml`, which is why
steps 6-7 run inside this workflow.

### 3.3 FASTag side: job `homebrew-tap` appended to `ci.yml`

* `if: ${{ !cancelled() && needs.release-complete.result == 'success' }}`
  (in `${{ }}`: a bare `!` is a YAML tag); `needs: [release-complete]`;
  `permissions: {}`. On non-tag runs `release-complete` is skipped, the
  comparison is false, the job skips cleanly.
* Step 1 maps `secrets.HOMEBREW_TAP_TOKEN` into `env:` and writes
  `enabled=true|false` (`secrets.*` in an `if:` is illegal and takes the
  whole workflow down as a 0-job `startup_failure`).
* Step 2: `gh workflow enable update-casks.yml` (re-enables a workflow
  GitHub disabled for inactivity; a no-op otherwise) then
  `gh workflow run update-casks.yml -f "tag=$TAG"`, the tag passed through
  `env` and quoted (a tag is any valid Git ref). Failure emits a
  `::warning` annotation and the tag build stays green: the tap is
  downstream, and its schedule publishes the release anyway.

**The secret** (the maintainer adds it in FASTag's *Settings > Secrets and
variables > Actions*; nothing here creates or handles it):
name `HOMEBREW_TAP_TOKEN`; a **fine-grained** personal access token, resource
owner `okohlbacher`, repository access **only** `okohlbacher/homebrew-fastag`,
repository permissions **Actions: Read and write** (Metadata: Read is added
automatically). Nothing else. What a leaked token can do: run, enable or
disable any workflow in that one public repository; it cannot push commits
and has no access to FASTag. Expiry at most one year.

### 3.4 Failure modes and limits (from the review)

* **Partial release**: never announced (FASTag dispatches only after
  `release-complete`), never half-published (the tap re-checks
  completeness and re-checks the asset snapshot before committing).
* **Assets replaced under the same tag**: not re-published; the scheduled
  run goes red ("cut a new release") until a new tag exists. `brew upgrade`
  compares versions, not digests, so a digest refresh would not reach users
  who already installed anyway. Documented in the tap README.
* **Schedule disabled after 60 days of tap inactivity**: the PAT path
  re-enables it before each dispatch; without a PAT the maintainer
  re-enables it under *Actions > update casks*. A commit per FASTag release
  normally keeps it alive.
* **Demoted / deleted release**: the no-downgrade rule holds the cask where
  it is and the scheduled run goes red until a human decides.
* **`tests.yml`** runs the same audit/style/floor/install checks on every
  push and PR, for hand-made edits.

## 4. Verification performed (v1.4.2 assets, this machine, arm64, macOS 26.5)

`brew audit --cask --strict` on both casks: clean. `brew style` on the tap
(casks + both workflows, actionlint + shellcheck): `no offenses detected`.
`check-macos-floor.sh`: all four (cask, arch) pairs `ok`. `brew install
--cask okohlbacher/fastag/fastag-cli`: `Linking Command Wrapper 'FASTag' to
'/opt/homebrew/bin/FASTag'`; `FASTag --help` reports `Version: 1.4.2`;
species smoke passes. `brew install --cask --appdir=<scratch> fastag`:
`spctl` accepted, stapler valid, version 1.4.2, bundled CLI 1.4.2; the
pre-existing `/Applications/FASTag.app` was not touched. `brew livecheck`:
`1.4.2 ==> 1.4.2`. `brew bump-cask-pr --write-only` round trip: correct.
Both casks uninstalled, tap untapped, then pushed. The tap's own CI on
GitHub (macos-15 runner) then ran: `brew audit --online`, `brew style`, the
floor script and both installs passed there; two things it caught that the
local run had not -- `bump-cask-pr` refusing a no-op, and `| tee | head`
under `pipefail` -- were fixed and pushed once more. Finally, as a fresh
user (local trust removed), `brew install --cask okohlbacher/fastag/fastag-cli`
from GitHub auto-tapped, trusted only that cask, installed, and `FASTag
--help` reported `Version: 1.4.2`.

## 5. Deliberately not done

* No homebrew-core / homebrew-cask submission (pre-built 500 MB blobs; a
  tap is the right home). No formula (source build).
* No Linuxbrew / Windows: casks are macOS-only.
* No change to the CLI wrapper to make it symlink-safe: that lives in the
  bundle step in the middle of `ci.yml`, which another workstream is editing;
  the cask works around it (open item).
* No PR-based bumps, no GitHub App in place of the PAT, no `fastag@x.y`
  casks, no `auto_updates`, no signing changes, no edits to the gh-pages
  site, no offline-VM Gatekeeper test.

## 6. Adversarial review (codex, gpt-6-astra, 2026-09-09) -- verdicts

Brief: `/tmp/brief-homebrew.md`; review: `/tmp/review-homebrew.md`.

| # | finding | verdict |
|---|---|---|
| 1 | `command_wrapper` + `staged_path` correct; bare `binary` would break the wrapper; upgrade leaves no dangling link | CONFIRMED (source + install test) |
| 3a | `--clobber` race: digest recorded from one generation, other arch from another | CONFIRMED (mechanism) -> asset snapshot re-checked before commit |
| 3b | digest-only refresh does not reach installed users | CONFIRMED (`brew upgrade` compares versions) -> same-version runs verify instead of rewriting; changed bytes need a new release |
| 3c | reject pre-release on dispatch too; demoted release needs a human | CONFIRMED -> both implemented |
| 4a | PAT wording: scoped to a repository, not a workflow; "cannot read code" misleading | CONFIRMED -> README/plan reworded |
| 4b | schedule disabled after 60 days of inactivity; 6 h is not a bound | CONFIRMED (GitHub docs) -> `gh workflow enable` before dispatch, README note |
| 4c | `continue-on-error` acceptable if conspicuous | ACCEPTED -> `::warning` annotation, step green |
| 6a | "identical to the manual drag-out" and "always online" overstated | CONFIRMED -> rewritten as observed vs. not established |
| 6b | `spctl` on a machine that knows v1.4.2 says nothing about cold offline runs | CONFIRMED -> stated as open (no VM here) |
| 8a | `">= :big_sur"` string form fails style | CONFIRMED (Homebrew 6 deprecation seen) -> symbol form |
| 8b | floor must cover the dylibs and the app's bundled CLI, both arches | CONFIRMED (arm64 14.0, x64 15.0 measured) -> per-arch `depends_on`, `--except=min_os`, floor script |
| 9a | plan's `setup-homebrew` + `git pull --rebase` would fail at push (no credentials, no tracking) | CONFIRMED -> `actions/checkout` symlinked in as the tap |
| 9b | pending-run coalescing under `concurrency` | CONFIRMED -> accepted explicitly (comment in workflow) |
| 9c | test-then-rebase can publish an untested tree | CONFIRMED (theoretical) -> abort if `origin/main` moved |
| 10a | `if:` must be wrapped in `${{ }}` | CONFIRMED -> done |
| 10b | pass `github.ref_name` via env, quoted | CONFIRMED -> done |
| 13a | one runner tests one architecture | CONFIRMED -> floor script mounts both arches' images; a real x64 install test still needs an Intel runner (open) |
| 13b | `--help` alone is too weak a smoke | CONFIRMED -> species smoke through PATH, app plist + bundled CLI checks |
| 13c | `uninstall quit:` would quit the user's running app during local tests | CONFIRMED -> checked it was not running before uninstalling |
| 2, 5, 7, 11, 12 | environment, Rosetta/prefix, livecheck derivation, naming, exclusions | fine, agreed |

## 7. Open items for the maintainer

* Add `HOMEBREW_TAP_TOKEN` (3.3) for instant updates -- optional.
* Set a deployment target in the macOS build (`CMAKE_OSX_DEPLOYMENT_TARGET`
  / `MACOSX_DEPLOYMENT_TARGET`, and Tauri's `minimumSystemVersion` to
  match) so the shipped binaries' floor is a choice rather than the runner
  image's SDK; then the casks' per-arch floors can drop to the plist value
  and `--except=min_os` can go.
* Make the CLI wrapper resolve symlinks (a `readlink` loop) so a bare
  `binary` stanza and hand-made symlinks also work.
* An Intel runner (`macos-15-intel`) leg in the tap's `tests.yml` would
  test the x64 payload end to end.
* Cold offline first run of the CLI: test in a fresh VM once.
* The README's "Signed, installable bundles are still on the roadmap"
  sentence in the Desktop GUI section is stale (not touched here).
