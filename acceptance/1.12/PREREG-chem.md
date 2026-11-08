# PREREG-chem: #3 chemistry calls

Status 2026-11-08: **DEV fits done; configs fixed below; NOT cleared for held-out.** The v2 table, the calibration
and the minimum confidence are fitted on the DEV regeneration with the frozen RC and their sha256 are fixed here.
Two things are still open before HO-03-heldout may run (frozen-configs.tsv status `pending_scorer`): the held-out
scoring script (it must apply `endpoint()` of `dev/scripts/fit_chem.py` to the manifest's truth columns and be
committed with its sha256), and your decisions on the DEV results that miss the plan's targets (section DEV
results). One primary endpoint per piece; every other metric is secondary and descriptive. Each config is scored
exactly once; nothing is tuned on held-out data.

## Frozen software

| What | Value |
|---|---|
| Release candidate | origin/integration/1.12 at a117801 (no src/ change on acceptance/1.12) |
| FASTag.bin sha256 | c4c2ad67fcd9106e474f552267f7cdfefe107f394b268bbc236308b773e4d7f3 |
| Bundle | data:/scratch/kohlbach/fastag-heldout-1.12/rc-a117801, SHA256SUMS sha256 93a1ad6d1184b156febb15b9f564e36a0a974f989fe9e5e7d8cf4849927cc051 (unchanged: the #3 fitted tables are not bundled, see below) |
| digest_models.tsv (shipped v1) | b486bbb2fc97c72192956c0cf1f64ddd5868570a61edb05953a98edc7bff7c36 |
| **Fitted v2 table** | `acceptance/1.12/dev/chem/fitted/digest_models_v2.tsv`, sha256 **51d5d582c61856c16908d3fe8cf7337c92b859be91aafc7ca754fdba169e28b4** (replaces, for CFG-03-cand, the unfitted da18f58e...) |
| **Fitted calibration** | `acceptance/1.12/dev/chem/fitted/digest_calibration.tsv`, sha256 **901989f3d90915a1a120ad945018913c35870c81bae0c596e0a149a557d9ed2c** (replaces 45451faf...) |
| **-digest_min_confidence** | **0.8** |
| massgap_mods.tsv | c1ec6f57718c4f9ea84a975d9ef35a34ca542fcfcc7026aa21ff50f109caa106 |
| Reference K:R (#3c) | ref50.fasta sha256 2bc7295c31bcb4643a59cd0dc8fdb0a28f74d8b47989902788eaa10d2d328626: ref_k 0.4932492134195986, ref_r 0.5067507865804014 (`dev/scripts/kr_reference.py`, `dev/chem/kr_reference.tsv`) |
| Alkylation database rule | the SDRF organism of the run (manifest column `organisms`) mapped to the prose-auto panel FASTA `/ceph/ibmi/abi/oliver/prose-auto-20261029/panel/<Genus>_<species>.fasta` (the DEV C pass used the same panel through runs.json); a run whose organism has no panel FASTA is not evaluable for 3g and is listed, not dropped silently. No bundled proteomes (not in 1.12.0) |
| Label rule (#3a) | ported from prose-auto 0.1.10 (`harness/v0110c_code/prose_auto/external.py`, sha256 97fb913cc80453e149cc905470ddc8df63b891f90a947e7df5c1ae39443692e5). **Parity on the 177 DEV runs: 177/177 identical** (`dev/chem/label_parity.tsv`) |
| Scoring script | **TO FILL before the run** (see Status) |

**Why the #3 tables are not bundled.** They are read at run time (CMake `install(FILES ...)`, `FASTAG_DIGEST_DIR`),
not compiled in, so FASTag.bin stays c4c2ad67.... Putting them into `data/digest` would change two things that
pin the unfitted tables: `test/digest_cli_test.sh` checks that the shipped calibration gives p_correct 0.5, and the
`chem_reports` gate case stages `data/digest` by sha256. v2 is opt-in, so whether 1.12.0 ships the fitted tables is
your decision (PLAN-INTEGRATION section 8, item 13). The held-out run passes them by path.

Defaults in force: the RC's (1.11 plus #7 refuse). PLAN-INTEGRATION section 8 decision 2: the fits use this RC; a
later #2/#6/#9 default flip triggers a recorded refit before a #3 default flip.

## Commands (held-out = DEV regeneration protocol, `dev/scripts/chem_dev.py`)

All runs on node data, `FASTAG_FULL_PRECISION=1`, the RC bundle's `opt/FASTag`.

- **Termini (CFG-03-base):** `FASTag -in <run> -out <tmp> -tag_length 4 -threads 8 -subsample_fraction 0.25
  -fragment_tolerance 20.0 -fragment_tolerance_unit ppm -digest_out digest.tsv -label_out label.tsv`,
  `FASTAG_DIGEST_DIR` = the RC bundle's `data/digest`. (The paper's digest validation options, fastag-digest-val
  run_one.py / rerun190.py, on every run.)
- **Termini (CFG-03-cand):** the same plus `-digest_models_version v2 -digest_detection shipped -digest_flank2 auto
  -digest_calibration <fitted calibration> -digest_min_confidence 0.8`, `FASTAG_DIGEST_DIR` = a copy of the RC
  bundle's `data/digest` with the fitted `digest_models_v2.tsv` and `digest_calibration.tsv` in place (DEV:
  `data:/scratch/kohlbach/fastag112-dev/chem/dig_v2`). The label piece is read from this run's `-label_out`
  (label_call does not depend on the digest options; parity above).
- **Alkylation (CFG-03-cand, 3g):** the prose-auto mass-gap command with `-alkylation_out`: `FASTag -in <run> -out
  <tmp> -tag_length 4 -extension 6 -threads 8 -recon_fasta <panel FASTA> -recon_out <tmp> -delta_out <tmp>
  -recon_min_length 5 -fixed_modifications -fragment_tolerance <t> -fragment_tolerance_unit <u> -massgap_out
  massgap.tsv -alkylation_out alkylation.tsv` with t/u = 0.3 Da when the MS2 are ion-trap scans
  (`fastag_bench.species.ms2_analyzer`) and 20 ppm otherwise, and no `-subsample_fraction` (the DEV gap commands
  carry prose-auto's per-run subsample fractions; the held-out runs have none). Baseline: always-CAM.

## TRAIN/DEV (in-sample; done 2026-11-08)

- Runs: results/sdrf_truth_runs.tsv, 254 runs. **77 of them are held-out files of other items** (66 of #1, 10 of
  #2, 6 of #6, 3 of #9; `scripts/check_dev_inputs.py`, `dev/lists/chem_dev_check.tsv`) and were left out, so DEV
  is **177 runs from 154 PXDs** (`dev/chem/training_runs.tsv`, sha256
  8d0cde480f7ec8c38b442e4f5241e42a5cb099176ecbfd8e1319cd5f27551823). With an enzyme truth: 159 (Trypsin 123,
  unspecific 16, Lys-C 5, Arg-C 4, Glu-C 4, Chymotrypsin 4, Asp-N 3, LysargiNase 0). Alkylation truth: CAM 105,
  none 17, Methylthio 1.
- Regeneration (`dev/scripts/chem_dev.py`; data:/scratch/kohlbach/fastag112-dev/chem/runs, reports archived as
  `chem_dev_reports.tgz` sha256 830a0fcc4875e79bfdd2a62e704ffd8c1c30faae5b400d0db12a1749e9d79aab): passes B (v1
  shipped), V0 (v2 prior table), C (gap command + alkylation), A (alkylation on the whole run), V1 (fitted table),
  V2b (fitted table + calibration + min_confidence 0.8). Every pass returned 0 on every run.
- Port check: `dev/scripts/chemport.py` reproduces the RC's per-model log-likelihoods (relative 1e-9) and calls on
  all 354 B/V0 reports and all 177 V1 reports, flank2 calls excepted (`dev/chem/port_check.tsv`).
- **Fit (`dev/scripts/fit_chem.py fit`, iteration 2).** Grid detection {fitted, unit} x kappa {10, 100, 1000,
  10000, rule-only} x s_trypsin x s_nontryptic {0.02, 0.05, 0.1, 0.2, 0.4}, chosen by LOPO-CV balanced accuracy
  (no-call wrong) on the 96 evaluable runs whose call does not go through flank2 (`dev/chem/fit_grid.tsv`).
  Chosen: **detection fitted** (orbitrap_hcd e(K) 1.18118, e(R) 0.82365 from 130516 K / 93501 R ends; other
  e(K) 1.57084, e(R) 0.44437 from 4184 / 1216; **timstof unfitted (1, 1): no tryptic timsTOF run is in DEV**),
  **kappa rule-only** (no empirical ends), **s_trypsin 0.05, s_nontryptic 0.1**.
  - Iteration 1 (mode `fit_lik`, kept in `dev/chem/iteration1/`): kappa and s by likelihood gave kappa 100, s 0.1/0.1;
    the empirical Arg-C end took up the K ends of the Arg-C runs and 23 tryptic runs were called Arg-C (in-sample
    called accuracy 62/96). Replaced by the CV rule above before any calibration.
  - LOPO-CV on the 96 non-flank2 runs: balanced accuracy **0.908** (Trypsin 0.942 of 69, Lys-C 1.0 of 4,
    non-tryptic 0.783 of 23), called accuracy 0.926 (87/94, Wilson 0.854-0.963). v1 on the same runs: 0.879, 0.904.
- **Calibration (`fit_chem.py calibrate V1`, iteration 2):** IRLS (L2 0.1) on the 97 called evaluable V1 runs:
  intercept -4.80255, margin 2.68153, log_n 0.76380, first_peak 1.53357. Threshold: the best LOPO-CV balanced
  accuracy among {0, 0.5, ..., 0.95} with CV called accuracy >= 0.95 -> **0.8** (CV called accuracy 0.956, Wilson
  LB 0.891; CV balanced accuracy 0.514). Iteration 1 (smallest threshold meeting LB >= 0.90, else highest called
  accuracy) chose 0.95 and cut the in-sample balanced accuracy to 0.19 (`dev/chem/iteration1/`).

## DEV results (in-sample, the binary's calls; `dev/chem/eval_passes.json`)

| Pass | Balanced acc. (no-call wrong) | Trypsin / Lys-C / non-tryptic recall | Called | Called acc. (Wilson LB) | Acc. no-call wrong |
|---|---|---|---|---|---|
| B (v1, CFG-03-base) | 0.615 | 0.528 / 0.8 / 0.516 | 94/159 | 0.904 (0.828) | 0.535 |
| V0 (v2 prior) | 0.645 | 0.553 / 0.8 / 0.581 | 98/159 | 0.918 (0.847) | 0.566 |
| V1 (fitted table) | 0.653 | 0.545 / 0.8 / 0.613 | 97/159 | 0.928 (0.859) | 0.566 |
| **V2b (CFG-03-cand)** | **0.514** | 0.528 / 0.4 / 0.613 | 90/159 | **0.956 (0.891)** | 0.541 |

- **Protease: on DEV, the candidate meets neither balanced accuracy >= 0.75 nor called accuracy LB >= 0.90.** 63
  of the 159 runs are withheld by ms2_scan_window / ms2_first_peak / few_tags before scoring; flank2 rescues 25.
- **timsTOF:** no DEV timsTOF run; the timstof detection weights are 1, and CFG-03-cand calls timsTOF runs with them.
- **Alkylation (3g, `dev/scripts/alk_dev.py`, no fit):** C pass, 95 evaluable runs (39 DEV runs have no gap
  command): accuracy 0.358 vs always-CAM 0.916; called 37, accuracy 0.919 (LB 0.787); **'none' recall 1/7**. The
  whole-run pass A is not better (0.253; none 1/7). The plan's pre-freeze check of the "not alkylated" family on
  the DEV 'none' runs fails; most runs are `few_cys_spectra` (n_min 10). The rule (n_min 10, s_min 0.6) is the
  plan's and was not changed.
- **Label (3a):** parity 177/177. Accuracy against the SDRF label (158 evaluable) 0.639 vs the majority baseline
  (label-free) 0.798: on DEV the frozen rule is 16 points below the baseline, not 5 above.

## Configurations (acceptance/1.12/frozen-configs.tsv, `scripts/make_configs.py`)

| Config | Options | Parameter hash | Status |
|---|---|---|---|
| CFG-03-base | the termini command above (v1 shipped tables, label_call rows) | b539190ab58c0b42cbbee15f3bd198e3517536dd21ee5e6172a55fade6e94663 | pending_scorer |
| CFG-03-cand | termini + v2/detection/flank2/fitted calibration/min_confidence 0.8; alkylation command | e373910df5619539c16c60818f073b35ebdd664daa4cc13a777ce94b73a24425 | pending_scorer |

The hash is sha256 of `binary=<FASTag.bin sha>;bundle=<SHA256SUMS sha>;options=<options>;tables=<name:sha,...>`.
CFG-03-base's earlier row (37c1ff84..., "frozen") named no tagging options; it was never run and is replaced by
this row, which fixes them. Baselines: the majority class on the held-out set (protease, label) and always-CAM
(alkylation).

## Held-out set (registry HO-03-heldout-r2, which supersedes HO-03-heldout; manifest acceptance/1.12/manifests/item03-heldout.tsv)

Registry note (2026-11-08 audit): HO-03-heldout still names the replaced configs (CFG-03-base 37c1ff84... as
"frozen", CFG-03-cand 9c04f9c1... as "pending_dev_fit"). It stays in place as history; HO-03-heldout-r2 records
the current hashes above (both pending_scorer) and the fitted table sha256s, and HO-03-heldout-SUPERSEDED marks the
old row. `scripts/check_registry.py` passes on the registry.

Mined by acceptance/1.12/scripts/mine_bigbio.py and select_chem.py (rules in their headers) from
bigbio/sdrf-annotated-datasets 452596762d38f46924b5719aae9969c467c7fa17, PXDs outside the 234 DEV PXDs, the
prose-auto validation sets and corpora, and the 37 species DEV PXDs; committed before any run:

| Stratum | Runs | PXDs | Gates? |
|---|---|---|---|
| nontryptic:Lys-C | 15 | 15 | yes (>= 15 runs from >= 3 PXDs) |
| nontryptic:Arg-C | 13 | 6 | descriptive only (after the format replacement, see below) |
| nontryptic:Chymotrypsin | 15 | 15 | yes |
| nontryptic:Glu-C | 15 | 15 | yes |
| nontryptic:Asp-N | 15 | 15 | yes |
| nontryptic:unspecific | 15 | 15 | yes |
| nontryptic:LysargiNase | 6 | 3 | descriptive only |
| ddapasef | 10 | 10 | timsTOF endpoint (>= 10 runs) |
| alkylation_noncam | 15 | 15 | 'none' recall condition (>= 15 runs) |
| tryptic | 60 | 60 | protease endpoint (>= 60 tryptic runs) |

At most 3 runs per PXD per class; each PXD in one stratum. Amendment before any run (scripts/replace_chem.py, from file
formats only): PXD060719, PXD043396, PXD041616 and PXD000921 had files that cannot be converted on Linux and were
replaced within their stratum by the next PXD of the seeded order (Asp-N, Chymotrypsin, tryptic restored; Arg-C has
no further usable PXD). Runs whose staged file fails conversion, or whose
#7 check refuses (to be investigated, not dropped silently), are recorded in the manifest. Pseudo-DDA is not
in this set (no DIA stratum was drawn). Disjointness: acceptance/1.12/disjointness/item03-heldout.tsv.

## Primary endpoints and acceptance (PLAN-organism-chemistry #3)

- 3c-3f protease: balanced accuracy over trypsin, Lys-C and the pooled non-tryptic classes >= 0.75, with called
  accuracy >= 0.95 (Wilson LB >= 0.90) and accuracy with no-call counted wrong >= baseline.
- timsTOF: called accuracy >= 0.9 on >= 10 runs; otherwise the timsTOF call stays withheld.
- 3g alkylation: accuracy with no-call counted wrong >= always-CAM, with called accuracy >= 0.97 and 'none' recall >= 0.7.
- 3a label: accuracy >= majority baseline + 5 points.
Each piece passes or fails on its own. Metrics also reported: accuracy among called, per-class recall with Wilson CIs.
