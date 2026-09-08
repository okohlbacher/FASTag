# Signing the FASTag desktop app — macOS and Windows

**Status 2026-09-08: WIRED, not yet exercised.** `ci.yml` builds, signs,
notarizes and staples the macOS `.app`/`.dmg`; `windows.yml` builds the app and
signs the NSIS installer through SignPath. Both paths are **inert until the
secrets below exist** — they are gated on the signing credentials, so a
secret-less tag build skips them entirely rather than burning ~90 minutes to
produce something unshippable.

Neither has ever run. Before tagging a release that is meant to be signed, do a
**dry run**: Actions → the workflow → Run workflow → tick `gui_dry_run`. That
builds the app off a branch, uploads it as a workflow artifact, and uploads
nothing to any release. On macOS a dry run also signs and notarizes when the
secrets are present; on Windows it deliberately does not, because a SignPath
signing request blocks on a human clicking Approve.

The self-contained `.app` itself is **built and verified** (see
`gui/scripts/bundle-macos.sh`): one bundle carrying the CLI, its full dylib
closure with **one** `libomp` (which fixes `OMP: Error #15`), `share/OpenMS`,
the ~1.1 GB taxonomy, and the icon. It runs species detection standalone with
no `KMP_DUPLICATE_LIB_OK`.

## What the workflows actually do

`ci.yml`, macOS legs, after the CLI is signed and notarized:

1. Restage the finished `dist/FASTag/` tree into
   `gui/src-tauri/resources/fastag/` as `bin/FASTag`, `bin/lib/`,
   `share/OpenMS`, `share/FASTag/taxonomy` — the layout `resolve_binary()` in
   `gui/src-tauri/src/fastag.rs` searches. **`lib/` sits next to the binary**,
   not one level up, because `dist/` was bundled with
   `-p @executable_path/lib/`; a tidier `bin/../lib` breaks every dylib
   reference and only shows up at first launch on someone else's Mac.
   Everything is copied with `-L`: Tauri's resource bundler silently skips
   symlinked directories.
2. `npm ci && npm run tauri build` with the `APPLE_*` env vars — Tauri does the
   outer signing, notarization and stapling in one shot. The nested Mach-Os are
   already Developer ID-signed by the CLI step, which is what notarization
   requires.
3. `xcrun stapler validate` the `.dmg` before upload, then attach it as
   `FASTag-gui-<platform>.dmg`.

`windows.yml`, after the CLI is SignPath-signed and `dist/` assembled: the same
restage (but **flat** — Windows has no RPATH, so every DLL must sit beside the
`.exe`), `npm run tauri build`, then a **second** SignPath request for the NSIS
installer, attached as `FASTag-gui-windows-x64-setup.exe`.

That second request means **a signed release needs the Approve click in
SignPath twice**: once for the CLI, once for the installer. SignPath's
`initial` artifact configuration already expects a zip containing `*.exe`, and
an NSIS installer is an `.exe`, so no new configuration is needed.

## Secrets (add in GitHub → Settings → Secrets and variables → Actions)

Same set BALL/BALLView uses (see the `software-signing` runbook):

| secret | what |
|---|---|
| `MACOS_CERTIFICATE_BASE64` | Developer ID Application cert + key, `.p12`, base64 |
| `MACOS_CERTIFICATE_PASSWORD` | the `.p12` password |
| `MACOS_KEYCHAIN_PASSWORD` | password for the throwaway CI keychain |
| `MACOS_SIGNING_IDENTITY` | `Developer ID Application: Name (TEAMID)` |
| `MACOS_APPLE_ID` | Apple ID for notarytool |
| `MACOS_TEAM_ID` | Apple Developer Team ID |
| `MACOS_NOTARY_PASSWORD` | app-specific password for notarization |

Windows additionally needs the two SignPath secrets `windows.yml` already uses
for the CLI: `SIGNPATH_API_TOKEN` and `SIGNPATH_ORG_ID`. No new ones.

### SignPath enrollment state, 2026-09-08

Enrollment is under way for a project named **"OpenMS Apps"** — its CSR
(`OpenMS_Apps.csr`, RSA 4096, `CN=University of Tübingen`,
`O=Eberhard Karls Universität Tübingen`, `OU=IBMI/ABI`) was issued by
SignPath's console that day.

**Do not take that CSR to a CA.** SignPath's Foundation program generates the
key in their own HSM and submits the request themselves; the certificate flips
from `CSR PENDING` to `VALID` with no action. A certificate obtained elsewhere
would not match the HSM key, and the enrollment would have to be redone.

Consequence for this repo: `windows.yml`'s `SIGNPATH_PROJECT_SLUG` is still the
placeholder `fastag`, and the real project is not called that. **Read the slug
off the project page and set it before tagging a release meant to be signed** —
a wrong slug fails the signing request roughly twenty minutes into a tag run,
not at the start. The CLI and the installer both read that one variable, so
they cannot drift apart.

`MACOS_SIGNING_IDENTITY` and `MACOS_TEAM_ID` are already determined for this
project by the issued certificate: `Developer ID Application: Oliver Kohlbacher
(9WF4NVY9MY)` and `9WF4NVY9MY`, valid to 22 May 2031.

**Getting the `.p12`.** The certificate alone is only the public half; the
`.p12` needs the private key generated with the original CSR. Check with
`security find-identity -p codesigning -v` — if it lists the Developer ID
identity, `security export -k ~/Library/Keychains/login.keychain-db -t
identities -f pkcs12 -o cert.p12` produces the file, and
`base64 -i cert.p12 | pbcopy` its secret value. If it reports `0 valid
identities`, the key is gone and the certificate must be revoked and reissued
from a fresh CSR — there is no recovery. Add every secret through the GitHub
web UI, never a command line, and delete the local `.p12` afterwards.

## Gotchas (these bite on the first run)

- **`secrets.*` is illegal in `if:`** — it makes the whole workflow fail with a
  0-job `startup_failure`. Both workflows map the secret into a step `env:` and
  gate on a step OUTPUT instead; keep it that way.
- **Notarization is iterate-to-green.** The first submissions usually fail on a
  missed nested binary; `xcrun notarytool log <id>` names the exact file. That
  is why the CLI step signs *every* dylib rather than a hand-listed set.
- **Two arches.** `macos-arm64` and `macos-x64` each produce their own `.dmg`,
  ~1.5 GB apiece because the taxonomy is inside, so the notarization upload is
  slow — hence the 120-minute step timeout.
- **A brand-new bundle ID's first notarization can take 8–12 hours** (see
  `doc/BACKLOG-ci.md`). Prime it out of band before the first signed release;
  no job timeout here covers that.
- **The Windows app has never been built in CI at all.** Unlike macOS, there is
  no working local precedent for it — dry-run it before trusting a tag.
- Ad-hoc signatures from `bundle-macos.sh` (`codesign --sign -`) are placeholders
  the Developer ID pass overwrites.
