# Signing the FASTag desktop app — macOS and Windows

`ci.yml` builds, signs, notarizes and staples the macOS `.app`/`.dmg`;
`windows.yml` builds the app and signs the CLI and the NSIS installer through
SignPath. The macOS desktop app is gated on the signing credentials below, so a
secret-less tag build skips it rather than burning ~90 minutes to produce
something unshippable. Windows builds the installer on every tag and signs it
when SignPath is configured ([below](#turning-on-windows-signing)); otherwise
it ships unsigned, with a warning in the run log.

**Before tagging a release meant to be signed, do a dry run**: Actions → the
workflow → Run workflow → tick `gui_dry_run`. That builds the app off a branch,
uploads it as a workflow artifact, and uploads nothing to any release. On macOS
a dry run also signs and notarizes when the secrets are present. On Windows it
signs with SignPath's `test-signing` policy when SignPath is configured: that
proves the requests, the artifact configuration and the download, and the
artifact is the test-signed installer. A test certificate is not
Windows-trusted, so this never produces a shippable binary.

The self-contained `.app` (see `gui/scripts/bundle-macos.sh`) is one bundle
carrying the CLI, its full dylib closure with **one** `libomp` (which fixes
`OMP: Error #15`), `share/OpenMS`, the ~1.1 GB taxonomy, and the icon. It runs
species detection standalone with no `KMP_DUPLICATE_LIB_OK`.

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
SignPath twice**: once for the CLI, about ten minutes into the `windows-x64`
job, and once for the installer, about 25 minutes later. Each request waits 30
minutes for its click before the run fails. Both use the artifact configuration
`initial` (below); an NSIS installer is an `.exe`, so one configuration covers
both.

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

Windows needs `SIGNPATH_API_TOKEN` and `SIGNPATH_ORG_ID` instead; see
[Turning on Windows signing](#turning-on-windows-signing).

`MACOS_SIGNING_IDENTITY` and `MACOS_TEAM_ID` follow from the issued
certificate: `Developer ID Application: Oliver Kohlbacher (9WF4NVY9MY)` and
`9WF4NVY9MY`, valid to 22 May 2031.

**Getting the `.p12`.** The certificate alone is only the public half; the
`.p12` needs the private key generated with the original CSR. Check with
`security find-identity -p codesigning -v` — if it lists the Developer ID
identity, `security export -k ~/Library/Keychains/login.keychain-db -t
identities -f pkcs12 -o cert.p12` produces the file, and
`base64 -i cert.p12 | pbcopy` its secret value. If it reports `0 valid
identities`, the key is gone and the certificate must be revoked and reissued
from a fresh CSR — there is no recovery. Add every secret through the GitHub
web UI, never a command line, and delete the local `.p12` afterwards.

## Turning on Windows signing

Under SignPath's Foundation program the key lives in their HSM and they submit
the certificate request themselves, so **a CSR from their console must not be
taken to a CA** — a certificate obtained elsewhere would not match the HSM key
and the enrollment would have to be redone. "OpenMS Apps" in the console is
that certificate, not a project.

Windows signing is on when all of these exist:

1. **In SignPath**, a project for FASTag with
   - the predefined **GitHub.com** trusted build system linked to it;
   - an artifact configuration with slug `initial` that expects a zip
     (`actions/upload-artifact` always zips):
     ```xml
     <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
       <zip-file><pe-file path="*.exe"><authenticode-sign /></pe-file></zip-file>
     </artifact-configuration>
     ```
   - signing policies with slugs `test-signing` (test certificate) and
     `release-signing` (the Foundation certificate, manual approval);
   - a user whose API token is used below, with the Submitter role on both
     policies.
2. **In GitHub** → Settings → Secrets and variables → Actions: the secrets
   `SIGNPATH_ORG_ID` (the organization ID) and `SIGNPATH_API_TOKEN`. Paste the
   token in the web form only.
3. **In `windows.yml`**: `SIGNPATH_PROJECT_SLUG` set to the project slug, read
   off the project page. The CLI and the installer both read that one
   variable, so they cannot drift apart.

Then dry-run before the first signed tag:

```bash
gh workflow run windows.yml -R okohlbacher/FASTag --ref main \
  -f gui_dry_run=true -f signing_policy=test-signing
```

The run log shows `SignPath signing policy: test-signing` and an
`Authenticode:` line for the CLI and the installer; the
`FASTag-gui-windows-x64-dryrun` artifact is the test-signed installer. On a
`v*` tag the policy is `release-signing`; `signing_policy` overrides it on a
manual run.

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
- **A brand-new bundle ID's first notarization can take 8–12 hours.** Prime it
  out of band before the first signed release; no job timeout here covers that.
- Ad-hoc signatures from `bundle-macos.sh` (`codesign --sign -`) are placeholders
  the Developer ID pass overwrites.
