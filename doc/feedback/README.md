# Feedback intake

The desktop app's **Feedback** button saves a report on the user's machine. Nothing is sent until the user
shares it. This folder describes the GitHub side.

## Flow

1. The app writes the **public export**, `<id>.feedback.zip` (`export.json` and, if kept, the annotated
   screenshot), in a folder of its own per export (`export-<n>/` in the report's folder, `<n>` the export
   request's number): a zip once written is never rewritten, and the one the app reveals is that file. `export.json` follows [`feedback-public.schema.json`](feedback-public.schema.json)
   (`fastag-feedback-public/1`): typed, allow-listed fields only, no paths or file names.
2. **Open issue draft** opens
   `https://github.com/okohlbacher/FASTag/issues/new?template=feedback.yml&title=…&report-id=…&kind=…`
   and reveals the zip. The user pastes **Copy diagnostics** into *Diagnostics*, drops the zip into
   *Report file*, ticks the privacy box and submits.
3. [`feedback-triage.yml`](../../.github/workflows/feedback-triage.yml) runs on `opened`, `edited` and
   when the `feedback` label is added. It runs [`tools/feedback_triage.py`](../../tools/feedback_triage.py),
   which takes exactly one JSON block (≤ 64 KB) from *Diagnostics*, validates it against the public schema,
   checks it against the *Report id* field and looks for the zip. The job then applies allow-listed labels
   and writes or updates one bot comment (marker `<!-- fastag-feedback-triage -->`) that names what is
   missing: diagnostics, a known schema version, the attachment. Edits re-run it; labels from an earlier
   valid version that no longer apply are removed.
4. A maintainer triages (spec §6): reproduce on the **reported version's tag**, not main. The comment's
   `fb-<hash>` fingerprint (view, dialog, phase, exit code, minor version) finds likely duplicates by search.

There is no LLM step. The commented-out `llm-suggest` job in the workflow lists the conditions for one.

The form's field ids (`kind`, `report-id`, `summary`, `steps`, `expected`, `actual`, `diagnostics`,
`attachment`, `privacy`) are the contract with the app's prefill URL; the field *labels* are the section
headings `feedback_triage.py` parses. Change neither without changing both sides.

## Labels

The workflow applies only labels that exist; unknown ones are skipped with a notice. Create them once
(and a `v:` label per minor release):

```sh
gh label create feedback      -R okohlbacher/FASTag -c 5319e7 -d "Report from the app's Feedback button"
gh label create needs-triage  -R okohlbacher/FASTag -c fbca04 -d "Not yet looked at by a maintainer"
gh label create kind:bug      -R okohlbacher/FASTag -c d73a4a -d "Feedback: something is broken"
gh label create kind:ui       -R okohlbacher/FASTag -c e99695 -d "Feedback: layout, wording, usability"
gh label create kind:idea     -R okohlbacher/FASTag -c a2eeef -d "Feedback: suggestion"
gh label create kind:question -R okohlbacher/FASTag -c d876e3 -d "Feedback: question"
gh label create os:macos      -R okohlbacher/FASTag -c c5def5 -d "Reported on macOS"
gh label create os:windows    -R okohlbacher/FASTag -c c5def5 -d "Reported on Windows"
gh label create os:linux      -R okohlbacher/FASTag -c c5def5 -d "Reported on Linux"
gh label create v:1.15        -R okohlbacher/FASTag -c ededed -d "Reported on FASTag 1.15.x"
# optional, for the future LLM pass:
# gh label create llm-triage  -R okohlbacher/FASTag -c 000000 -d "Maintainer: request an LLM suggestion"
```

## Testing

Locally: `python3 tools/test_feedback_triage.py` (valid, missing, duplicated, oversized, wrong-version,
hostile and edited bodies). A body from a real issue:
`gh issue view N --json body --jq .body > /tmp/b.md && python3 tools/feedback_triage.py --body-file /tmp/b.md`.

On a fork, before merging:

1. Fork, push the branch, make it the fork's default branch (issue events run the default branch's
   workflow and template), and enable Issues and Actions on the fork.
2. Create the labels above with `-R <you>/FASTag`.
3. Open `https://github.com/<you>/FASTag/issues/new?template=feedback.yml&title=Test&report-id=<uuid>&kind=bug`,
   paste a diagnostics block (e.g. `VALID` from the test file, `json.dumps(..., indent=2)`), attach a zip
   named `<uuid>.feedback.zip`, submit. Expect `kind:bug`, `os:macos`, `v:1.15` and one comment.
4. Edit the issue: break the JSON, change the report id, remove the attachment, paste a second block,
   put `${{ github.token }}` and `$(id)` in every field. Each edit must update the same comment, never
   add a second one, and the run log must show no expansion of the hostile text.
5. Add an unrelated label: the job must be skipped.

## Removing personal data from a report

If a report holds personal or patient data, act at once; the issue is public and indexed.

1. **Hide first:** lock the issue, and if the data is in a comment, hide or delete that comment.
2. **Edit the body** and remove the data. GitHub keeps the **edit history**: open the *edited* dropdown
   on the issue body and delete each earlier revision that holds the data (anyone with write access to
   the repository can; see "Tracking changes in a comment" in GitHub's docs).
3. **Attachments** (`github.com/user-attachments/...`): in a public repository they can be fetched
   without authentication
   ([attaching files](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files)),
   and removing the link from the text does not delete the file. There is no self-service delete; ask
   GitHub Support to remove it, giving the attachment URL.
4. **Delete the issue** if nothing else is worth keeping (admins: *Delete issue* in the sidebar). This
   does not remove attachments or copies in e-mail notifications; step 3 still applies.
5. For data that was cached or forked, file a
   [sensitive data removal request](https://docs.github.com/en/site-policy/content-removal-policies/github-private-information-removal-policy)
   with GitHub Support.
6. Tell the reporter what was removed, and record the report id (not the data) in the maintainer log.
