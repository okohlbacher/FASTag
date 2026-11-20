# FASTag GUI review, 2026-11-20: workflow-based Setup

Branch `feat/gui-workflows` (from `origin/main`), head `410784c9`, not pushed.
GUI-only: compared with the merge base, only files under `gui/` and `doc/`
changed; no C++ source and no `gui/src/params.generated.json`.
Spec: [GUI-WORKFLOWS.md](GUI-WORKFLOWS.md).

## 1. Workflow structure

Setup reads Input (One file | Batch) -> Workflow -> Settings -> Outputs -> Run,
then Results. A workflow is a named preset (a diff over the CLI defaults) with
1 to 5 basic fields. Every other option is under one Advanced disclosure and in
the parameter search. All workflows set `threads 0` and write the tags table.
Instrument preset and Fixed modifications are in every workflow.

| Workflow | Inputs | Outputs (on by default; offered off) | Default parameters (diff over CLI defaults) | Basic fields |
|---|---|---|---|---|
| Export tags (landing) | spectra | tags.tsv (ProForma column, USI column, spectra with tags .mzML) | `res_conf true` | seed length, extension, E-value cutoff, tags per spectrum, per-residue confidence |
| Run QC | spectra | qc.tsv, tags.tsv | `qc_out` | spectra to read |
| Mass-shift survey | spectra, protein FASTA (required) | recon.tsv, delta.tsv, delta_spectra.tsv, delta_counts.tsv (massgap.tsv, recon_id.tsv) | `recon_out`, `delta_out`, `delta_spectra_out`, `delta_counts_out`, `extension 3` | protein database, extension, missed cleavages |
| Species | spectra | species.tsv | `species true`, `extension 2` (seed 3 + 2 x 2 = 7, the paper setting) | report rank, spectra to read |
| Database reduction | spectra, protein FASTA (required), background proteins (optional) | shortlist.tsv, reduced.fasta, engine configuration | `shortlist_out`, `fasta_out`, `search_config_out`, `extension 3`; recipe `shortlist_gapped true`, `recon_min_length 6`, `shortlist_max_evalue 10`, `recon_missed_cleavages 2` (default recipe, not validated; see SHORTLIST.md) | protein database, background proteins, search engine, variable modifications |
| Identifiability triage | spectra, idXML/mzIdentML (optional) | census.tsv, census_summary.tsv, census_sorted.tsv | `census true`, `census_score true`, `census_sorted_out` | identifications; ID q-value and triage E-value once identifications are set |
| Characterize a run | spectra | digest.tsv, label.tsv, glyco.tsv, species.tsv (alkylation.tsv) | `digest_out`, `label_out`, `glyco true`, `species true`, `extension 2`, `subsample_fraction 0.1`; ticking Alkylation raises Extension to the length the proteome needs | spectra to read |

Batch is an input mode of every workflow (file list, output folder, optional
SDRF), not a workflow. Open earlier results is navigation (header, link under
the chooser, drag and drop, History), not a card. Saved presets with the old
IDs `batch-qc` and `open-results` load as Characterize (Batch) and Export tags.

## 2. What changed from main

148 files under `gui/src` (54 added, 93 changed, 1 removed), 31 under
`gui/src-tauri` and `gui/e2e-web`, plus `doc/GUI-WORKFLOWS.md` and this report.

- **Setup.** Task chooser with seven workflows; per-workflow basic fields,
  required inputs and help; Instrument preset matched by value (incl. Orbitrap
  ETD and EThcD, unvalidated); Outputs card with product checkboxes, derived
  names and wired dependencies (`products.ts`); Advanced grouped into the
  workflow's own groups (Characterize leads with its Species groups),
  "For every workflow" and "Other analyses", with one dependency note and a
  named Turn on per group; "(modified)" marker and Save as preset.
- **Command line.** Only `ALWAYS_SENT` options, changed values and values
  that differ from the CLI's conditional defaults are sent (`sentValues`);
  value/unit pairs travel together; the MSFragger recipe is shown as the CLI
  applies it; dependencies follow the CLI reader table, with value
  conditions; pre-run conflicts for combinations the CLI refuses (also in
  Batch); History restore rebuilds from CLI defaults plus the recorded params.
- **Output protection (Rust + TS).** All output-file options are tracked from
  the manifest (overwrite confirmation, cleanup, history, reveal); an output
  that names an input (incl. `alkylation_proteome` files and other queued
  batch inputs) is refused; cleanup never removes an input; batch names are
  allocated case-insensitively.
- **Results.** Per-workflow tab order and Overview (workflow named, tiles for
  requested products, workflow tiles first, Mass-shift tile always drawn);
  views for QC, Shortlist, Triage and Mass shifts (delta columns, extra
  reports); content-aware opening from Open, Open report, drop and History;
  selection tokens against stale async reads; c/z ladders; ETD/EThcD pre-
  and post-run checks by input format, keyed to the run shown; Da caveat on
  Species; help popovers kept inside the pane.
- **Batch.** Run gated on the queue; per-workflow summary columns from the
  batch's recorded workflow; QC reports read; species ties and not-assessable
  isobaric runs kept out of the majority vote; SDRF check uses the QC report.
- **Help.** Help pages and topic links rewritten for the seven workflows,
  Batch mode, Outputs and Advanced; single-dash flags.
- **Tests and fixtures.** Real CLI 1.15 runs per workflow
  (`gui/src/fixtures/cli-1.15/workflows/`) drive the e2e bridge; vitest from
  965 to 1370 passing tests; new Playwright specs `workflow-counts` and a
  popover-in-pane check in `screens`.

## 3. Review rounds

Each round reviewed the commit named (Claude plus Codex, Kimi and Vibe;
findings verified against the code); the next round's commit fixed them.
Blocking = critical + major. In every round 0 tests failed; the WebKit
Playwright project was not run.

| Round | Commit reviewed | Tests at that commit | Confirmed: critical / major / minor (rejected) | Blocking |
|---|---|---|---|---|
| 1 | d3ac1dd1 | typecheck OK; vitest 968 passed, 17 skipped; Playwright chromium 103 passed, 9 skipped; screens 58 PNGs | 2 / 17 / 18 (6) | 19 |
| 2 | 2a4f3e29 | typecheck OK; vitest 1002 passed; Playwright 111 passed; cargo test 250 passed; screens 56 PNGs | 2 / 13 / 18 (2) | 15 |
| 3 | cc231743 | typecheck OK; vitest 1181 passed; Playwright 118 passed (workflow-counts 7/7); cargo test 253 passed; screens 56 PNGs | 2 / 10 / 12 (3) | 13 (12 after merging duplicates) |
| 4 | eadfc4b7 | typecheck OK; vitest 1260 passed; Playwright 118 passed; screens 56 PNGs | 0 / 11 / 18 (4) | 11 |
| 5 | 5fae4e5c | typecheck OK; vitest 1278 passed; Playwright 118 passed; screens 56 PNGs | 0 / 8 / 19 (7) | 8 |
| 6 | f6e7ee61 | typecheck OK; vitest 1318 passed; Playwright 118 passed; screens 56 PNGs | 0 / 8 / 15 (4) | 8 |
| 7 | 9ae667a9 | typecheck OK; vitest 1346 passed, 17 skipped; Playwright 118 passed, 9 skipped; screens 57 PNGs | 0 / 8 / 15 (1) | 8 |
| 8 | 410784c9 | typecheck OK; vitest 1370 passed, 17 skipped; Playwright 118 passed, 9 skipped; screens 58 PNGs (incl. popover-in-pane check) | 0 / 5 / 11 (4) | 5 |

## 4. Open findings (round 8, at 410784c9)

No critical findings remain. Round 8 has not been fixed yet.

### Major (5)

| Area | Problem | Fix |
|---|---|---|
| Spectrum ladder crash | `LadderLine` (`SpectrumPanel.tsx:400-423`) reads `positions[0].mz` when `ladderFor` returned no positions; a tag with a modification missing from `MOD_DELTA` (e.g. `C[Carboxymethyl]`) throws and breaks the Spectrum view. | Show only the verdict with `ladder.reason` when positions is empty; render test. |
| Re-run actions | "Re-run with per-residue confidence" and the Overview / Mass shifts re-run actions (`App.tsx:317, 709-733`) check only the input name, so on an older History run they run the current form plus the change and overwrite current outputs. | Gate them on `run.shownRerunnable`, or build the call from the shown run's params; regression test. |
| Drops with a species file | `useDrops.ts:42-44`: `openSpeciesPath` bumps the selection token after `openReportPaths` started, so the drop's remaining reports are silently not opened (deterministic). | One selection per drop, passed to every opener, or compare with `superseded(t)`. |
| Alkylation raise on replacement | The raise effect (`SetupForm.tsx:150-174`) runs on every History restore, preset, workflow, reset or undo; a loaded run with the alkylation report and a lower Extension is raised at once, so the recorded call is not reproduced (yeast flips 2 -> 3 -> 2). | Raise only on the user's own toggle or edit; on a replacement show "Needs Extension N" with a one-click raise; read the proteome from the new values. |
| Alkylation and custom databases | A FASTA in `alkylation_proteome` always raises as for human, while the same FASTA as Protein database gets no raise and "Extension is left as it is"; the CLI indexes both the same way (size-dependent minimum, 4 for the 3-protein fixture). The help suggests a protein database as a way out of `tags_too_short`. | One rule for every custom database: raise only for shipped proteomes; for a FASTA show "Needs Extension N for a human-sized database"; fix the help and the Characterize product note. |

### Minor (11)

| Area | Problem (fix) |
|---|---|
| Alkylation target, `recon_min_length` | The CLI checks tags against it when set; the GUI always targets 8 or 7 (return it when above 0; Setup note and Overview follow). |
| Alkylation target, `tag_lengths` | Seed taken from `tag_length` only (use the longest effective seed; add to effect dependencies). |
| Help popover CLI line | Kept or dropped by length, so jargon leads or facts are lost (Storey, 1+ test, column list, .gz) (curated text first; drop the CLI line only when covered). |
| Mass-gap help | Says the raise does not apply to a FASTA proteome; code and product note say it does (align with the custom-database rule; docs test). |
| Export tags Extension hint | "3 gives tags of 8+" (Extension is an upper bound: "3 lets a seed of 3 grow to 9"). |
| Species wording | Overview says "by adjusted count", Species tab "by observed spectra" (one shared helper). |
| Mass shifts headline | "Placed spectra" next to "Spectra with a placement"; "Gap peaks 1" counts the 0 Da bin, while the Overview says "no shift peak" (rename; count peaks of at least 0.5 Da). |
| TMT reporter filter help | "singly charged tags" (the reporter ion is singly charged; reword). |
| Report opened after a failed run | Species/QC/report opens skip the history status check (one opener with the "Reports may be partial" state). Plausible. |
| Spec: threads | GUI-WORKFLOWS.md says 0 means all cores and the CLI default is 1; FASTag uses half the logical cores for 0 and that is its default. |
| Empty Results text | "Open a digest, label or mass-gap report…" although the opener handles every report ("Open a FASTag report…"). |

Before merging: `origin/main` has moved on to 1.15.4 (regenerated
`params.generated.json`, `-shortlist_defaults`, `-shortlist_max_evalue`
help); rebase and rerun the tests. The spec still names the 1.15.3 manifest.

The review notes per round are in
`/Users/kohlbach/Claude/OpenMS/New Tools/FASTag/output/gui-workflows/r<N>-*.md`.

## 5. Screenshots

Each round's screenshots are in
`/Users/kohlbach/Claude/OpenMS/New Tools/FASTag/output/gui-workflows/screens/r<N>`
(N = 1 to 8; r8 shows the head). Naming: `00` landing, `10-setup-<k>-*`
Setup per workflow, `11-*-full` whole form, `12-*-advanced` Advanced open,
`13` Batch mode, `2x` help popovers, run bar and file chosen,
`3<k>-results-*` Results tabs per workflow (k = 1 Export tags … 7
Characterize). Open a folder in Finder or Preview
(`open .../screens/r8`) to page through.

To regenerate, in `gui/`:

```
npm run build:e2e
E2E_PORT=4410 SCREENS_DIR=<dir> npx playwright test -c e2e-web screens --project chromium
```
