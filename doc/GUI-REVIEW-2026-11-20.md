# FASTag GUI review, 2026-11-20: workflow-based Setup

Branch `feat/gui-workflows` (from `origin/main`), head `f6e7ee61`, not pushed.
GUI-only: files under `gui/` and `doc/`; no C++ source and no
`gui/src/params.generated.json` changed. Spec: [GUI-WORKFLOWS.md](GUI-WORKFLOWS.md).

## 1. Workflow structure

Setup reads Input (One file | Batch) -> Workflow -> Settings -> Outputs -> Run,
then Results. A workflow is a named preset (a diff over the CLI defaults) with
2 to 5 basic fields. Every other option is under one Advanced disclosure and in
the parameter search. All run workflows set `threads 0`; all write the tags
table. The common block (Instrument preset, Fixed modifications) is in every
workflow.

| Workflow | Inputs | Outputs (on by default; offered off) | Default parameters (diff over CLI defaults) | Basic fields |
|---|---|---|---|---|
| Export tags (landing) | spectra | tags.tsv (ProForma column, USI column, spectra with tags .mzML) | `res_conf true` | seed length, extension, E-value cutoff, tags per spectrum, per-residue confidence |
| Run QC | spectra | qc.tsv, tags.tsv | `qc_out` | spectra to read |
| Mass-shift survey | spectra, protein FASTA (required) | recon.tsv, delta.tsv, delta_spectra.tsv, delta_counts.tsv (massgap.tsv, recon_id.tsv) | `recon_out`, `delta_out`, `delta_spectra_out`, `delta_counts_out`, `extension 3` | protein database, extension, missed cleavages |
| Species | spectra | species.tsv | `species true`, `extension 2` (seed 3 + 2 x 2 = 7, the paper setting) | report rank, spectra to read |
| Database reduction | spectra, protein FASTA (required), background proteins (optional) | shortlist.tsv, reduced.fasta, engine configuration | `shortlist_out`, `fasta_out`, `search_config_out`, `extension 3`, recipe `shortlist_gapped true`, `recon_min_length 6`, `shortlist_max_evalue 10`, `recon_missed_cleavages 2` (default recipe, not validated; see SHORTLIST.md) | protein database, background proteins, search engine, variable modifications |
| Identifiability triage | spectra, idXML/mzIdentML (optional) | census.tsv, census_summary.tsv, census_sorted.tsv | `census true`, `census_score true`, `census_sorted_out` | identifications, ID q-value and triage E-value (shown once identifications are set) |
| Characterize a run | spectra | digest.tsv, label.tsv, glyco.tsv, species.tsv (alkylation.tsv) | `digest_out`, `label_out`, `glyco true`, `species true`, `extension 2`, `subsample_fraction 0.1`; ticking Alkylation raises Extension to 3 | spectra to read |

Batch is an input mode of every workflow (file list, output folder, optional
SDRF), not a workflow. Open earlier results is navigation (header, link under
the chooser, drag and drop), not a card. Saved presets with the old IDs
`batch-qc` and `open-results` load as Characterize (Batch) and Export tags.

## 2. What changed from main

143 files under `gui/src` (50 added, 92 changed, 1 removed), plus Rust changes
in `gui/src-tauri` and the new spec `doc/GUI-WORKFLOWS.md`.

- **Setup.** Task chooser with seven workflows; per-workflow basic fields,
  required inputs and help; Instrument preset matched by value (incl. Orbitrap
  ETD and EThcD, unvalidated); Outputs card with product checkboxes, derived
  names, wired dependencies (`products.ts`); Advanced grouped by
  "For every workflow" and "Other analyses", with one dependency note and
  Turn on per group; workflow "(modified)" marker and Save as preset.
- **Command line.** Only options in `ALWAYS_SENT`, changed values and values
  that differ from the CLI's conditional defaults are sent (`sentValues`);
  value/unit pairs travel together; the MSFragger recipe is shown as the
  CLI applies it; dependencies follow the CLI reader table, with value
  conditions; pre-run conflicts for combinations the CLI refuses.
- **Output protection (Rust + TS).** All output-file options are tracked from
  the manifest (overwrite confirmation, cleanup, history, reveal); an output
  that names an input (incl. `alkylation_proteome` files and other queued
  batch inputs) is refused; cleanup never removes an input; batch names are
  allocated case-insensitively.
- **Results.** Per-workflow tab order and Overview (workflow named, tiles for
  requested products only); new views for QC, Shortlist, Triage, Mass shifts
  (delta columns, extra reports); content-aware opening of reports from Open,
  Open report, drop and History; per-selection generation tokens against
  stale async reads; c/z ladders in Spectrum; ETD/EThcD pre- and post-run
  checks by input format.
- **Batch.** Run gated on the queue; per-workflow summary columns from the
  batch's recorded workflow; QC reports read; isobaric not-assessable runs kept
  out of the majority vote; SDRF comparison uses the QC report.
- **Help.** Help pages and topic links rewritten for the seven workflows,
  Batch mode, Outputs and Advanced; single-dash flags.
- **Tests and fixtures.** Real CLI 1.15 runs per workflow
  (`gui/src/fixtures/cli-1.15/workflows/`) drive the e2e bridge; vitest went
  from 965 to 1318 passing tests; new Playwright spec `workflow-counts`.

## 3. Review rounds

Each round reviewed the commit named (Claude plus Codex, Kimi and Vibe;
findings confirmed against the code), and the next round's commit fixed them.
Blocking = critical + major.

| Round | Commit reviewed | Tests at that commit | Confirmed: critical / major / minor (rejected) | Blocking |
|---|---|---|---|---|
| 1 | d3ac1dd1 | typecheck OK; vitest 968 passed, 17 skipped; Playwright chromium 103 passed, 9 skipped; screens 58 PNGs | 2 / 17 / 18 (6) | 19 |
| 2 | 2a4f3e29 | typecheck OK; vitest 1002 passed; Playwright 111 passed; cargo test 250 passed; screens 56 PNGs | 2 / 13 / 18 (2) | 15 |
| 3 | cc231743 | typecheck OK; vitest 1181 passed; Playwright 118 passed (incl. workflow-counts 7/7); cargo test 253 passed; screens 56 PNGs | 2 / 10 / 12 (3) | 13 reported, 12 after merging duplicates |
| 4 | eadfc4b7 | typecheck OK; vitest 1260 passed; Playwright 118 passed; screens 56 PNGs | 0 / 11 / 18 (4) | 11 |
| 5 | 5fae4e5c | typecheck OK; vitest 1278 passed; Playwright 118 passed; screens 56 PNGs | 0 / 8 / 19 (7) | 8 |
| 6 | f6e7ee61 | typecheck OK; vitest 1318 passed, 17 skipped; Playwright 118 passed, 9 skipped; screens 56 PNGs | 0 / 8 / 15 (4) | 8 |

In every round 0 tests failed; the WebKit Playwright project was not run.

## 4. Open findings (round 6, at f6e7ee61)

No critical findings remain.

### Major (8)

| Area | Problem | Fix |
|---|---|---|
| Species tab, Da tolerance | The Overview warns that species calls are unreliable at 0.3 Da; the Species tab shows the top taxon without the caveat (`SpeciesPanel.tsx`). | Reuse `daSpecies` from `overview.ts`; banner above the top taxon, mute its name. |
| ETD/EThcD after a run | `NOTE_LINE` (`checks.ts:381`) keeps only "Electron activation:"; the CLI's "Hybrid activation", "Ion series: … tagged as b/y" and "Collisional activation" lines are dropped, so no post-run check appears for those cases. | Parse the three lines, turn each into a warn check with its fix, mirror in the Overview, test each line. |
| History, overwritten reports | `showRecord` (`useRun.ts:863-876`) checks only the tags path; a shared report path overwritten by a later run shows B's report beside A's tags. | Check the last writer of every report path; withhold overwritten reports and name the run. |
| Species tie in batch and SDRF | `batchSummary.ts:291-296` and `compare.ts:462-474` use `present[0]` on a tie: false outliers and false SDRF mismatches. | Apply `tiedLeaders`; a tie gives no single call; any tied leader counts as top call. |
| DIA input override | The raw-DIA block (`checks.ts:257-276`) ignores `acquisition_check`, so Warn or Off still disables Run. | Block only for refuse; advisory for warn; nothing for off. |
| Single-run QC isobaric kit | `ReportTable.tsx:289-290` shows "none found" when every kit is not_assessable. | Share the batch logic; show "Not assessable" with the reason. |
| Report views reopen stale | `useReport` (`ReportTable.tsx:50-62`) reloads only on path change; a rewritten QC/Shortlist/Triage file shows old contents. | Per-report generation bumped on open and on finished runs. |
| Mass-shift "Localized" | `ReconView.tsx:351` calls it fragment-placed; the CLI counts fragment_localized + sequence_constrained (README:1145). | Show both columns; describe Localized as their sum. |

### Minor (15)

| Area | Problem (fix) |
|---|---|
| Multi-file drop race | `openReportPaths` takes a new selection token per file and can replace a later user choice (one token per drop). |
| Advanced hints | One-line clamp (`index.css:1201`) cuts hints mid-sentence (2-line clamp or curated brief hints). |
| Tags column width | 9 px/char estimate truncates 7-residue tags with W/M/Q (monospace or measured width, from the whole file). |
| Digest Labels chip | Green "No label tag ends" on a 0.3 Da run (neutral "Not assessable (tolerance in Da)"). |
| Digest card | Da reason repeated in the first "FASTag says" bullet (filter the restatement). |
| Protease models tip | `help.tip` not passed to the (?) popover; wording conflicts with the CLI log (pass and reword). |
| Alkylation raise target | Always aims for 8 residues; yeast/E. coli need 7, a FASTA needs none (derive from `alkylation_proteome`). |
| Alkylation raise restore | Extension stays 3 when another product makes the raise unnecessary (restore on any toggle). |
| Species/ETD pre-run warning | Fires for any c/z spectrum (require more than 1%). |
| Advanced group disclosure | `openGroups` seeded with false for every title, so workflow groups start closed (seed `{}`). |
| Search configuration -1 | `-1` sentinels shown as raw numbers (empty field, placeholder "engine default"). |
| Gating note layout | Long notes leave the (?) on its own line (keep it inline; move condition lists to the popover). |
| Characterize Outputs layout | Two-line alkylation note breaks the grid rows (one-line note). |
| Species q-value | e-notation instead of the shared "× 10" formatter. |
| Species Overview order | Top genus tile below the generic counts (workflow tiles first). |

The round-6 review notes are in
`/Users/kohlbach/Claude/OpenMS/New Tools/FASTag/output/gui-workflows/r6-*.md`.

## 5. Screenshots

Each round's screenshots are in
`/Users/kohlbach/Claude/OpenMS/New Tools/FASTag/output/gui-workflows/screens/r<N>`
(N = 1 to 6; r6 shows the head). Naming: `00` landing, `10-setup-<k>-*`
Setup per workflow, `11-*-full` whole form, `12-*-advanced` Advanced open,
`13` Batch mode, `2x` help popovers, run bar, file chosen, `3<k>-results-*`
Results tabs per workflow (k = 1 Export tags … 7 Characterize).

To regenerate, in `gui/`:

```
npm run build:e2e
E2E_PORT=4410 SCREENS_DIR=<dir> npx playwright test -c e2e-web screens --project chromium
```
