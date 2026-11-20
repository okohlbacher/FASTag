# FASTag GUI review, 2026-11-20: workflow-based Setup

Branch `feat/gui-workflows` (from `origin/main`), head `6a81f2ab`, not pushed.
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

Compared with the merge base: 156 files under `gui/src` (58 added, 97
changed, 1 removed), 7 under `gui/src-tauri`, 24 under `gui/e2e-web`, plus
`doc/GUI-WORKFLOWS.md` and this report (189 files, +38,770 / -2,448 lines).

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
  Batch); History restore rebuilds from CLI defaults plus the recorded params;
  Apply last-used goes through the same replacement (recipe kept, Undo); the
  alkylation Extension raise happens only on the user's own toggle or edit,
  only for shipped proteomes, and follows `recon_min_length` and `tag_lengths`.
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
  Species; help popovers kept inside the pane; re-run actions only for the run
  shown; reports grouped by History run id; one selection per drop; no crash
  for a tag without a ladder; modal questions trap focus.
- **Batch.** Run gated on the queue; per-workflow summary columns from the
  batch's recorded workflow; QC reports read; species ties and not-assessable
  isobaric runs kept out of the majority vote; SDRF check uses the QC report.
- **Help.** Help pages and topic links rewritten for the seven workflows,
  Batch mode, Outputs and Advanced; single-dash flags.
- **Tests and fixtures.** Real CLI 1.15 runs per workflow
  (`gui/src/fixtures/cli-1.15/workflows/`) drive the e2e bridge; vitest from
  965 to 1405 passing tests; new Playwright specs `workflow-counts` and a
  popover-in-pane check in `screens`.

## 3. Review rounds

Each round reviewed the commit named (Claude plus Codex, Kimi and Vibe;
findings verified against the code and the screenshots); the next round's
commit fixed them. Blocking = critical + major. In every round 0 tests
failed; the WebKit Playwright project was not run.

| Round | Commit reviewed | Tests at that commit | Confirmed: critical / major / minor (rejected) | Blocking |
|---|---|---|---|---|
| 1 | d3ac1dd1 | typecheck OK; vitest 968 passed, 17 skipped; Playwright chromium 103 passed, 9 skipped; screens 58 PNGs | 2 / 17 / 18 (6) | 19 |
| 2 | 2a4f3e29 | typecheck OK; vitest 1002 passed; Playwright 111 passed; cargo test 250 passed; screens 56 PNGs | 2 / 13 / 18 (2) | 15 |
| 3 | cc231743 | typecheck OK; vitest 1181 passed; Playwright 118 passed (workflow-counts 7/7); cargo test 253 passed; screens 56 PNGs | 2 / 10 / 12 (3) | 13 (12 after merging duplicates) |
| 4 | eadfc4b7 | typecheck OK; vitest 1260 passed; Playwright 118 passed; screens 56 PNGs | 0 / 11 / 18 (4) | 11 |
| 5 | 5fae4e5c | typecheck OK; vitest 1278 passed; Playwright 118 passed; screens 56 PNGs | 0 / 8 / 19 (7) | 8 |
| 6 | f6e7ee61 | typecheck OK; vitest 1318 passed; Playwright 118 passed; screens 56 PNGs | 0 / 8 / 15 (4) | 8 |
| 7 | 9ae667a9 | typecheck OK; vitest 1346 passed; Playwright 118 passed; screens 57 PNGs | 0 / 8 / 15 (1) | 8 |
| 8 | 410784c9 | typecheck OK; vitest 1370 passed; Playwright 118 passed; screens 58 PNGs (incl. popover-in-pane check) | 0 / 5 / 11 (4) | 5 |
| 9 | 78322292 | typecheck OK; vitest 1384 passed, 17 skipped; Playwright 118 passed, 9 skipped; screens 59 PNGs | 0 / 3 / 17 (5) | 3 |
| 10 | 6a81f2ab | typecheck OK; vitest 1405 passed, 17 skipped; Playwright 118 passed, 9 skipped; screens 59 PNGs | 0 / 3 / 18 (4) | 3 |
| 11 | 3f16dffd | typecheck OK; vitest 1425 passed, 17 skipped; screens 59 PNGs (Playwright suites not run) | 0 / 8 / 12 (0) | 8 |

Blocking findings fell from 19 to 3; since round 4 no critical finding has
been found.

## 4. Findings of rounds 10 and later

### Round 10 (at 6a81f2ab)

No critical findings. The three round-10 majors are fixed in f54dd66b:
- Characterize alkylation note: the off state says "Turning it on raises Extension 2 → 3 …" (test round10.test.tsx).
- Run association: two persisted run ids are two runs; the outputs-list match only for the run just shown (test round10.app.test.tsx).
- Mass-shift chart labels: named from the CLI's interpretations; an assumed window labels the mass only (test round11.test.tsx).
The 18 round-10 minors are fixed (table below).

#### Major (3)

| Area | Problem | Fix |
|---|---|---|
| Characterize: alkylation note | With Alkylation report off, the note reads "Extension 2 → 3 (Advanced › Tagging); changes every tag; …", the same present-tense wording as after the raise, while the call still sends `-extension 2` (`SetupForm.tsx:238-253`). | Use `raiseNote` only when the raise is in force; for the off state say "Turning it on raises Extension 2 → 3 …"; test. |
| Run association | `sameRunIn` (`reports.ts:23-30`) treats two files with different persisted run ids as one run when either record lists the other path. Run B rewrites `sample.tags.tsv`; A's leftover `sample.qc.tsv` is shown beside B's tags with no warning. | Two distinct persisted run ids are different runs; use the outputs-list match only for synthetic `shown:<out>` mappings; regression test. |
| Mass-shift chart labels | Bins are named after the nearest bundled modification within the window, which without a mass-gap report (the workflow default) is an assumed ±0.5 Da: a +15.600 Da bin is labelled "Oxidation", which can contradict the CLI's UniMod assignments (`MassGapChart.tsx:146-163`). | Name bins only from the CLI's assignments; draw mass-only matches in a separate, marked style ("nearest known mass ±0.5 Da"). |

#### Minor (18)

All 18 fixed; none rejected. Tests: `results/round10Minor.test.tsx` unless named.

| Area | Problem (fix) | Result |
|---|---|---|
| Outputs card layout | Alkylation (?) wraps under the two-line note and leaves a gap in the left column (popover after the label; note on a full line). | Fixed in 1357e23c: (?) after the label; the alkylation row spans the card, its note on a line of its own. |
| Alkylation note location | Always says "(Advanced › Tagging)", though Extension is a Settings field in Export tags and Mass-shift survey; the species/digest clause shows when neither report is on (location from the task layout; clause only when relevant). | Fixed in 5ec48309: "(Settings)" where the workflow shows Extension there; the clause names only the species or digest report that is on. |
| Overview grouping | Main-result tile and run facts are split into rows with no visible heading (add "Main result" / "Run" headings). | Fixed in 9ec19d29. |
| Tags re-run button | "Re-run with per-residue confidence" shows beside existing Min./Mean conf. columns (name what it adds; reorder or hide all-zero columns). | Fixed in 3593385e: "Re-run to add Residue conf. (%)"; the tooltip tells it from the step scores. |
| Advanced density | 6,100 to 7,400 px per workflow; Other analyses expands into many waiting sub-groups (collapse each to one line with Turn on). | Fixed in 1a2b9141: a group whose settings all wait is one line with its note and Turn on; Turn on opens it. |
| Spectrum from a ranking | With only a triage ranking open, tags of a later run that rewrote the tags path are drawn (check the newest writer's run id). | Fixed in 96be1cf6 (test `workflowOpen.app.test.tsx`). |
| Undo after replacement | `beside()` rewrites custom output paths, and the edited set is lost (restore the snapshot unchanged, with the edited set). | Fixed in d82ae091 (test `useSession.test.tsx`). |
| Apply last-used | Restores every value but keeps the current workflow, so label, record and lead tiles name the wrong workflow; the test uses a partial value set (store the workflow id; full-value test). | Fixed in d82ae091: the run saves its workflow with the values; Apply restores it as origin (full-value test in `useSession.test.tsx`). |
| Drop of custom-named files | Tags and QC of one run with custom names: the tags are dropped as superseded (one selection token per drop). | Fixed in 707ad176: `useRun.openDropped` (test `run/round10.app.test.tsx`). |
| Run association without record | With no record and no `<stem>.<kind>` names, files of two runs with different Extension are shown as one (a missing stem is unknown identity). | Fixed in ce1f1269 (test `run/round10.app.test.tsx`). |
| Help: Overview figures | Still describes the removed "Tags E ≤ 1" tile (`workflows.tsx:23`). | Fixed in f54dd66b. |
| Help: mass-shift extension | Says the action raises to 3; it now computes the value and may suggest a longer seed. | Fixed in 5ec48309. |
| Help: `alkylation_proteome` | Field path with commas reads badly and is incomplete outside Mass-shift survey. | Fixed in 77f304fd. |
| Re-run extension with `-fasta` | Targets `recon_min_length` and the longest seed; the CLI checks the filter floor with every seed, so it can refuse the suggested call. | Fixed in 5812fc23: with `-fasta` the shortest seed must reach `min_filter_length` (else 8) too (test `viewers.test.tsx`). |
| Triage: experimental | `-census_score` is experimental per the README; the product, help and Overview do not say so. | Fixed in a359f948 (task, product, option help, Triage help, Overview tile). |
| Mass shifts: 0 Da bin | "Spectra with a mass gap" and its warning count the unshifted 0 Da bin. | Fixed in 895aec4f: "Placed spectra" beside "Shifted (≥ 0.5 Da)"; the warning says "placed on the database" and keeps its threshold on the placed spectra (the CLI's gap-peak share is of those). |
| Species tab, empty report | The Da-tolerance banner is skipped in the empty branch. | Fixed in c9b8d810. |
| Table sort | Blank numeric cells sort as 0, not last (`Number('')`). | Fixed in d2f11248 (test `viewers.test.tsx`). |

### Round 11 (at 3f16dffd)

Lens: simplicity and intuitiveness per workflow. Codex, Kimi, Vibe and
Claude; duplicates merged. All fixed, none rejected. Tests:
`gui/src/review/round11.test.tsx` unless named.

#### Major (8)

| Area | Problem | Result |
|---|---|---|
| Digest: Labels | The panel showed only the isobaric tag-end counts: a SILAC call read "No label tag ends". | Fixed in c5f4c41c: the CLI's label call (or no call, with its reason) leads; the counts follow under "Isobaric tag ends". |
| Database reduction: Comet | The Comet template sat in Advanced; without it the CLI writes a fragment the GUI called a configuration. | Fixed in c5f4c41c: with Comet, Settings shows the template; without one the product says it is a fragment to merge. |
| Database reduction: protease | Protease only in Advanced; a non-tryptic run withholds the FASTA and configuration. | Fixed in c5f4c41c: Protease in Settings ("Trypsin; Auto for another or unknown digest"). |
| Mass shifts: first table | The placements were the first table; the mass-shift table (sites, UniMod) was a second click under "Gap peaks". | Fixed in e07afe8a (tests `viewers.test.tsx`, `viewers.app.test.tsx`, `p4c.spec.ts`): "Mass-shift table" first, Placements beside it. |
| Triage: candidates | Setup asks for the Triage E-value, but Results had no way to list the candidates (triage = 1). | Fixed in e5382ae4, 697d52b9: "Triage candidates" filter and count, column beside Identified, Overview tile. |
| Export tags: extension | Extension 0 gives 3-residue tags, so the workflow's assembly read export (8+) was empty. | Fixed in ff13d4c0: Extension 3; the e2e fixture re-recorded (6,279 tags). |
| Batch: Triage | A Triage batch summary showed only spectrum counts. | Fixed in 8f21c27c (test `batchWorkflows.test.ts`): Median identifiability per job. |
| Input: vendor files | Picker, drop and folder add refused .raw and timsTOF .d/.d.zip, which the bundled CLI reads; the FAQ said they are not read. | Fixed in 714b42a8 (Rust test `drop.rs`). |

#### Minor (12)

| Area | Problem | Result |
|---|---|---|
| Outputs card | The wide alkylation row left a gap beside Label report. | Fixed in 368de7c8 (grid-auto-flow dense). |
| Triage: unscored census | A census without a score opened as a ranking, in file order. | Fixed in e5382ae4: "Per-spectrum census", no ranking claim; a scored unsorted census is sorted by score. |
| Batch: One file disabled | No reason given while a batch is queued. | Fixed in 368de7c8. |
| Mass shifts: trypsin | Placements are tryptic; the help did not say so. | Fixed in 368de7c8 (field help and low-placed warning). |
| Decoys | Help said FASTag adds no decoys; for MSFragger it appends rev_ decoys. | Fixed in 368de7c8. |
| Species help | Named removed workflows. | Fixed in 368de7c8. |
| Placements as identifications | No caveat at the product. | Fixed in 368de7c8: "candidates, not FDR-controlled" (README name kept). |
| Mass shifts empty state | Said the workflow writes the Mass-gap report. | Fixed in 368de7c8. |
| Species footnote | Named the CLI option `species_deconvolve`. | Fixed in 368de7c8. |
| Batch plan line | "out:" (CLI name). | Fixed in 368de7c8: "outputs in …". |
| Ranked product | No experimental badge. | Fixed in 368de7c8. |
| Glyco stat | "Flag rule (glyco_min_fraction)". | Fixed in 368de7c8: "minimum oxonium share". |

Before merging: `origin/main` has moved on to 1.15.4 (regenerated
`params.generated.json`, `-shortlist_defaults`, `-shortlist_max_evalue`
help, metaproteome recommendation `-shortlist_max_evalue 100`); rebase and
rerun the tests. The spec still names the 1.15.3 manifest.

The review notes per round are in
`/Users/kohlbach/Claude/OpenMS/New Tools/FASTag/output/gui-workflows/r<N>-*.md`.

## 5. Screenshots

Each round's screenshots are in
`/Users/kohlbach/Claude/OpenMS/New Tools/FASTag/output/gui-workflows/screens/r<N>`
(N = 1 to 10; r10 shows the head, 59 PNGs). Naming: `00` landing,
`10-setup-<k>-*` Setup per workflow, `11-*-full` whole form, `12-*-advanced`
Advanced open, `13` Batch mode, `14` Characterize with Alkylation on, `2x`
help popovers, run bar and file chosen, `3<k>-results-*` Results tabs per
workflow (k = 1 Export tags … 7 Characterize). Open a folder in Finder or
Preview (`open ".../screens/r10"`) to page through; compare rounds by
opening the same file name in two folders.

To regenerate, in `gui/`:

```
npm run build:e2e
E2E_PORT=4411 SCREENS_DIR=<dir> npx playwright test -c e2e-web screens --project chromium
```
