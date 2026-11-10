# PREREG-census-2: census triage, second held-out test (1.13 backlog item 7, plan #11)

Status: **FROZEN 2026-11-10.** Protocol, drawn manifest, scorers and CFG-census-triage2-113 are fixed in the commit
that adds this file (branch `acc113r/census`), pushed before any file of the 8 projects is downloaded. Not run, not
scored. The split `census-triage-2` is run once and scored once; nothing is tuned on it; no run is repeated with
changed settings; nothing is re-scored. A FAIL or INCONCLUSIVE is a valid result.

It replaces nothing: the first test (PREREG-census, 6 runs) stays recorded as FAIL. Background:
`output/backlog-1.13/census/REASSESS.md`, `PREREG-draft.md`.

## Question

Unchanged: are the spectra that `-census -census_ids` marks as triage candidates identified by a second, wider
search more often than the other unidentified spectra, and more often than the same number picked by peak count?

## What changes against PREREG-census

| | First test | This test |
|---|---|---|
| Runs | 6 runs, 6 projects | 8 new runs, 8 new projects |
| E2 | rr > 1 in every run; undefined fails | rr > 1 in every **evaluable** run; at least 6 of 8 runs evaluable (E0) |
| Scorer | `census_triage_eval.py` d777b98 | same file at 16b50f4 (adds `evaluable`, `q_min`; other keys unchanged) |
| FASTag | 1.12.1 (702b45c) | 1.12.2, built from `feat/b113-census` 16b50f4 |
| Execution | one run after another | up to 4 runs at a time, 8 threads each (output does not depend on it) |

## Frozen software

| What | Value |
|---|---|
| Candidate | `feat/b113-census` at 16b50f4 (= origin/feat/b113-census) |
| FASTag | `data:/scratch/kohlbach/b113/census/opt_m2/FASTag`, sha256 `95a571728f3ce826ef81e0eedd37d6c8c5525b6c0bfefd2e98259299a683ea91` (FASTag 1.12.2). Built on node data from `/scratch/kohlbach/b113/census/src`, which is byte-identical to the tree of 16b50f4 (git blob hash of all 941 files). Gate: `GATE PASS (9 cases)`, new cases `PASS (8)`, ctest rc 0. Run through the wrapper `opt/FASTag` (sha256 `b84c190a1348e2f4c8435671fc27c94e0af89691d8ca7bebeef7efcca5fdb43b`), which execs `FASTag.bin` beside it; for this test both are copied to `<H>/opt/` and the copy's sha256 is checked before the runs. |
| CFG-census-triage2-113 | `-census -census_ids <closed.idXML> -census_ids_fdr 0.01 -census_triage_evalue 0.01 -threads 8`, all other options at defaults (`frozen-configs.tsv`) |
| Run script | `census/scorers/census2/run_census_triage.sh`, sha256 `e1b5e87c89ca4e5912a7560853efe232b99faffc21350f965de4e449625d1021` (unchanged from the first test); driver `run_heldout2.sh` |
| OpenMS | 70cebcd144: SageAdapter `11b0d1dd...e174a`, IDScoreSwitcher `c3ddb98a...32b7` |
| Sage | 0.14.7, sha256 `d3820543a31bfa2a556e04f91719204ce0ac6f34dcca6670314a13df87064625` |
| Database | UP000005640 with reversed decoys, `UP000005640_9606_td.fasta`, sha256 `281e4e25b05ddc125f2983c2941b38155dbd33d3d53f5f372e3ed88a9a1c5378` |
| Conversion | ThermoRawFileParser 2.0.0 (sha256 `73039004...ccb2`) `-f 2`; `census/scripts/stage_census.sh` sha256 `c674d8c0acb4926cdbf55527904f9add5549691b37054cf86c4ca4ff2c2a0eea` |
| Scorer | `census/scorers/census2/census_triage_eval.py` = `tools/census_triage_eval.py` at 16b50f4, sha256 `8b1a2d10d9357d011ff5180e9bd6b698a7bfc20b19e7824e939bcf2600d2bbb4` |
| Verdict | `census/scorers/census2/verdict_census2.py`, sha256 `4febb38913a37f71b1c3551201c718329472339eec4edae5455df1a578c44ec8` |
| Scoring driver | `census/scorers/census2/score_census.sh`, sha256 `c22f31747f15fb73a19bdbeb6eedb6275219bd0bfba662425df4c127fe3379eb`; it checks `SHA256SUMS` (scorer, verdict, run scripts) before scoring and refuses to score twice |

The first test's scorers in `census/scorers/` are left untouched; this test's scorers are in `census/scorers/census2/`.

Searches per run (closed, semi, open), population U, primary truth, baseline, pooling and bootstrap are exactly as
in PREREG-census: U = census rows with `identified` 0; a hit = the semi search's rank-1 PSM is a target with
q <= 0.01, q recomputed among the rank-1 PSMs of U as (decoys + 1) / targets by `sage_discriminant_score`
(`--fdr subset`); triage = U with `triage` 1; baseline = the |triage| spectra of U with the largest `n_peaks`;
counts summed over runs; percentile 95% intervals from a run-cluster bootstrap, 10,000 resamples, seed 20261109.

## Endpoints

A run is **evaluable** when its unidentified spectra have at least one hit (`t_u` > 0; scorer key `evaluable`).
This is computed from all unidentified spectra of the run and does not depend on the triage split.

| | Endpoint | Criterion |
|---|---|---|
| E0 | number of evaluable runs | >= 6 of the 8 drawn runs |
| E1 | pooled rr = P(hit \| triage) / P(hit \| rest), all scored runs | rr >= 2.0 and CI lower bound >= 1.5 |
| E2 | per-run rr, evaluable runs only | rr > 1 in every evaluable run (inf counts as > 1; undefined, e.g. no triage candidate, fails) |
| E3 | pooled d = P(hit \| triage) - P(hit \| top-n_peaks baseline), all scored runs | d > 0 and CI lower bound > 0 |

Verdict (`verdict_census2.py`), in this order:

1. E0 fails: **INCONCLUSIVE**, whatever E1 to E3 say.
2. A point criterion fails (pooled rr < 2.0 or undefined; an evaluable run with rr <= 1 or undefined; pooled
   d <= 0 or undefined): **FAIL**.
3. A CI criterion fails (lower bound below its limit or undefined): **INCONCLUSIVE**.
4. Otherwise **PASS**.

Non-evaluable scored runs stay in the pooled counts of E1 and E3 and are listed with `q_min`. Each criterion is
also reported on its own (E0 to E3 lines of `verdict.txt`).

Reported without a verdict: semi with Sage's q-values (`--fdr global`); open with subset and global q-values; d
against `n_edges` and `n_peaks_kept`; recall; AUROC; per-run tables.

## Technical failures (fixed before the run)

The denominator of E0 is always the 8 drawn projects. A run that is excluded under the rules below counts as not
evaluable, is not replaced by a new draw, and is left out of the pooled counts. Every exclusion is recorded in
`census/results2/excluded_runs.tsv` (run, reason) before the scorer is started and reported as a deviation.

- **Staging** (`stage_census.sh`): the chosen file fails when the download does not complete after 8 resumed tries,
  the PRIDE SHA-1 does not match (without a PRIDE SHA-1: the size does not match or an independent second download
  has a different sha256), the conversion fails, or the post-download check fails (not all MS2 Orbitrap HCD, or
  fewer than 5,000 MS2 with a charge state). Then the project's backup file is staged once under the same rules.
  If the backup fails too, or there is none (PXD044743), the run is excluded.
- **Pipeline** (`run_heldout2.sh`): a run whose log does not end with `RUN_DONE` (a step of
  `run_census_triage.sh` failed or the process died) is started once more from scratch with the identical command;
  the failed attempt's directory is kept as `<run>.failed1`. A second failure excludes the run. A node-wide
  interruption (reboot, full disk) that kills the driver is handled the same way per run: finished runs
  (`RUN_DONE`) are kept, each unfinished run gets its one restart from scratch.
- **Scorer**: when `census_triage_eval.py` refuses the input of a run (malformed or unjoinable table) no verdict
  exists; that run is added to `excluded_runs.tsv` with the scorer's message and `score_census.sh` is started
  again on the remaining runs. This is the only case in which the scoring driver is started a second time, and
  only before a `verdict.txt` exists. A failure of a secondary table does not affect the verdict.
- No option, threshold, script or criterion is changed after the freeze. A defect in a frozen script that prevents
  execution altogether is fixed only in the plumbing (paths, environment), recorded as a deviation with a diff; a
  defect that would change a number stops the test, which is then reported as not completed.

## Runs

`manifests/census-triage-2.tsv`: the 8 drawn projects, chosen and backup file each (15 files; PXD044743 has one
eligible file). Drawn 2026-11-09 by `census/inputs2/select_census_heldout2.py` (seed `fastag-1.13:#11:triage2:qe`,
8 projects, exclusion list `census/inputs2/excl_pxd_draw2.txt`; draw table `census/inputs2/draw.tsv`; the script's
docstring still says "Take: 6", the code takes 8). Pool, project rule and file rule as in the first draw. The draw
is not edited by hand: a run that looks poor (PXD044743, dental calculus) stays; E0 exists for that case.

| Rank | Project | Chosen file | GB |
|---|---|---|---|
| 2 | PXD073999 | 20180509_A375_shSIRT6_2_rep2.raw | 1.34 |
| 3 | PXD042242 | N184A_1.raw | 1.27 |
| 6 | PXD067571 | 18.9_Apical-outl_OGM_day4_1_T_210816.raw | 1.35 |
| 10 | PXD032145 | P800_EXTL3_batch1.raw | 0.54 |
| 12 | PXD003400 | 20150421_JoLI_FASP_RIPA_10ug_n1_2153.raw | 0.78 |
| 13 | PXD044743 | 20200816_EXPL5_nLC7_MEM_collab_77min_DDA_Ancient_calculus_1835_01.raw | 1.20 |
| 16 | PXD068740 | 2150-gr1-1.raw | 0.98 |
| 17 | PXD028322 | QEXHF08361.raw | 2.74 |

The manifest is frozen in two steps. Step 1 (this commit): the drawn files with URL, size and PRIDE SHA-1, before
any download. Step 2: after staging, `manifests/census-triage-2.staged.tsv` (the file used per project, sha256 of
raw and mzML, `use` = run or excluded) is built by `census/scripts/build_manifest2.py staged`, committed and
pushed **before FASTag or any search touches a staged file**. Staging runs no FASTag, no search and no scoring.

## Disjointness

`disjointness/census-triage-2.tsv`, built by `census/scripts/build_disjointness2.py` on 2026-11-10 (it exits
non-zero on any overlap). For each of the 8 projects:

- not DEV (PXD003531, PXD014764), not one of the first test's 6 projects, not in `excl_pxd_draw2.txt` (1,531);
- not in the lists of the other 1.13 arms as given in `output/backlog-1.13/HELDOUT-COMMON.md`: shifts (9 reserved
  PXDs), species (66 PXDs of `species/heldout-manifest-draft.tsv`); copies in `census/inputs2/other_arms.*`;
- all 257 branches of the FASTag repository: named only in the PRIDE candidate pool
  (`acceptance/1.12/inputs/h2r_pride_candidates.tsv`) and in the first draw table `census/inputs/draw.tsv`, where
  each has the result `not_needed` (the draw table lists all 135 pool projects; these 8 were never looked at);
- `alknodb/prereg-exclude-pxd.txt` (1,625) does contain all 8. Cause, verified: that list is every PXD named under
  `acceptance/` minus the pool, and the 8 are named there only in the first draw table. It is an exclusion list of
  the alknodb arm, not a use; the alknodb and hdrcharge arms therefore cannot draw them. PXD003400 and PXD068740
  are divisible by 4 (hdrcharge's draw domain), the other six are not (alknodb's); HELDOUT-COMMON reserves all 8
  for census;
- cluster sweep (`census/inputs2/cluster_sweep.txt`: names under `data:/scratch/kohlbach` and
  `/ceph/ibmi/abi/oliver`, and file contents under `/scratch/kohlbach/b113`): only PRIDE metadata caches, the bigbio
  SDRF catalogues and copies of the pool and of the census draw tables. No file of the 8 projects was downloaded
  before this freeze.

## Review of the verdict script

The draft `verdict_census2.py` (kept as `census/inputs2/verdict_census2.draft.py`) was reviewed against this
protocol and replaced. Findings:

1. It returned FAIL when a point criterion failed with fewer than 6 evaluable runs; the protocol says INCONCLUSIVE
   whenever E0 fails. Confirmed on synthetic input (5 evaluable, rr 1.1: draft prints FAIL). Fixed.
2. A missing `evaluable` key was read as "not evaluable" without an error. Now refused (exit 2), as are duplicate
   keys, NaN, run lists that do not match the table, and `evaluable` inconsistent with `t_u`.
3. It had no notion of drawn runs that are not scored. Now the drawn and the scored run lists are separate
   arguments; a drawn, unscored run counts as not evaluable.
4. It needed Python >= 3.12 (nested quotes in an f-string). Removed.

`verdict_census2_test.py` (9 cases, synthetic tables): PASS; FAIL on E1 point, on E2 (rr <= 1 and undefined rr in an
evaluable run) and on E3 point; INCONCLUSIVE on the E1 and E3 CI bounds; INCONCLUSIVE with 5 evaluable runs,
both with passing and with failing E1 to E3; a non-evaluable run with undefined rr not failing E2; excluded runs
counted against E0; malformed inputs refused. Ten hand-made mutants of the verdict logic (each comparison and the
order of the rules) are all caught by the tests. `score_census.sh` was run end to end on the 6 spent runs of the
first test plus two dummy rows (one excluded in the manifest, one in `excluded_runs.tsv`): it reproduces the first
test's pooled numbers (rr 5.848, d 0.0552) and refuses a second scoring.

## Commands (node data, H = /scratch/kohlbach/b113/census/heldout/census2)

    CENSUS_HELDOUT=$H/raw bash census/scripts/stage_census.sh census/inputs2/stage.tsv $H/staged_chosen.<PXD>.tsv chosen <PXD>     # per project; backup likewise if needed
    python3 census/scripts/build_manifest2.py staged acceptance/1.13 staged_*.tsv       # then commit + push
    bash census/scorers/census2/run_heldout2.sh manifests/census-triage-2.staged.tsv $H  # runs run_census_triage.sh <H>/raw/<mzML> <H>/runs/<PXD> 8
    bash census/scorers/census2/score_census.sh manifests/census-triage-2.staged.tsv $H/runs $H/score

`$H/opt/FASTag` (wrapper) and `$H/opt/FASTag.bin` (the candidate binary) and `$H/db/UP000005640_9606_td.fasta` are
copies checked by sha256. Results (small tables and logs) go to `census/results2/`.

## Not in this test

As in PREREG-census: no census classifier (PLAN-qc phase C, F7), the reserved F7 pools stay unopened, no MSFragger.

## Result (appended 2026-11-10, after the single scoring)

Scored once: **PASS**. E0 7 of 8 runs evaluable; E1 rr 5.32 (CI 2.59 to 8.25); E2 rr > 1 in all 7 evaluable runs
(1.75 to 21.1); E3 d +0.0229 (CI 0.0176 to 0.0286). PXD067571 and PXD068740 ran on their backup file (staging
rule). Details: `census/results2/RESULT.md`.
