# PREREG-msfragger2: `-search_engine msfragger` export, second held-out test (post-1.13.1)

Status: **FROZEN 2026-11-11.** Protocol, drawn manifest, scorer, verdict script and thresholds are fixed in the commit
that adds this file (branch `post1131/msfragger-heldout2`), pushed before any file of the 10 drawn projects is
downloaded. A second commit adds the staged manifest (sha256 of raw and mzML) and nothing else; it is pushed before
the candidate binary or MSFragger reads any held-out file. The split `msfragger-heldout2` is run once and scored
once. Nothing is tuned on it, no run is repeated with changed settings, nothing is re-scored, no criterion is changed.
Deviations are recorded, not repaired. FAIL and INCONCLUSIVE are valid results. The code is not changed.

Pattern: `acceptance/1.13/PREREG-msfragger.md` on branch `acc113r/msfragger` (first test, FAIL). Criteria and
thresholds are those of the first test, unchanged.

## Question

Used unedited, with the documented shortlist recipe `-shortlist_gapped -recon_min_length 6 -shortlist_max_evalue 10
-recon_missed_cleavages 2` and all export options at their defaults (isotope errors 0/1/2/3, 2 missed cleavages,
20 ppm precursor window, variable protein N-terminal acetylation), does the export of `-search_engine msfragger` keep
at least 80 % of the spectra a default MSFragger closed search on the full human proteome identifies, faster, with an
entrapment FDP of at most 1.5 % pooled and 2.0 % in every run?

The isotope default of 1.13.1 has no held-out test either; it is part of every export of this test, so the verdict
covers it together with the three new defaults and the recipe. The test does not separate them.

## Frozen software and inputs

| What | Value |
|---|---|
| Candidate | branch `post1131/msfragger` at 8d704544429b3c8f42b42918dfd7013208bf3ea6 (code identical to c537b0e; the later commit changes README, CHANGELOG and doc/SHORTLIST.md only) |
| FASTag | built on node data from `git archive` of that commit: `data:/scratch/kohlbach/post1131/msfragger/heldout2/build/FASTag`, sha256 `bde217c0b4ff59044dd28ed3dbfeecfb2ad1bd1a36eb090cd5cb40c3644776e4` (reports 1.13.1); run through the wrapper `heldout2/opt/fastag` (sets OPENMS_DATA_PATH, FASTAG_DIGEST_DIR, LD_LIBRARY_PATH, OPENBLAS_NUM_THREADS=1). Check before the freeze, on the development run PXD003531 only: its shortlist FASTA is byte-identical to the one of the development timing pass |
| MSFragger | 4.4.1, the copy installed on data: `/ceph/ibmi/abi/oliver/spextract/tools/MSFragger-4.4.1.jar`, sha256 `56b15a35060e1aa3b38508eed5e1b21ce697918bad75b450307160c86c652112`; OpenJDK 21, `-Xmx64g`. Not downloaded, not redistributed |
| Database | `heldout2/db/human.fasta`, copy of the first test's file (UP000005640 reviewed, 2026_04, 20,414 entries), sha256 `6342992b6a9824ab73f31ac9df8c90f8bf24f54d4a0730768e28535f34ef6416` |
| Arm b parameters | `heldout2/db/closed_b.params`, copy of the first test's file, sha256 `2070a7d60d21eca6d7cddb24aeec79e7519bce66c85a757d71d710093ec0b1dc`: MSFragger's closed defaults, `num_threads = 32` (`scripts/make_b_params.sh`); `database_name` set per run |
| Conversion | ThermoRawFileParser 2.0.0 `-f 2`, `scripts/stage_msfragger.sh` with `MSFRAGGER_HELDOUT=/scratch/kohlbach/post1131/msfragger/heldout2/data` |
| Scripts, scorer, verdict | `msfragger2/SHA256SUMS`. Unchanged from the first test: `score_msfragger.py`, `verdict_msfragger.py`, `verdict_msfragger_test.py`, `mkdb.py`, `make_b_params.sh`, `stage_msfragger.sh`, `fetch_pride_meta.sh`. Changed: `run_one.sh` (work directory, the four recipe options in the FASTag command, added arm a0), `run_all.sh` (one added line that writes the informational `a0.tsv`), `build_manifest.py` (paths, run ids MG), `build_exclusions.py` (optional sub-folders to skip), `select_msfragger_heldout2.py` (seed, 10 projects). New: `score_a0.py` (informational) |
| Threads | 32 for FASTag and for every MSFragger search; runs and arms strictly one after another |

## Runs

10 runs from 10 PRIDE projects, one run per project: `manifests/msfragger-heldout2.tsv`; draw table
`msfragger2/inputs/draw.tsv`; disjointness `disjointness/msfragger-heldout2.tsv`.

Draw (`msfragger2/inputs/select_msfragger_heldout2.py`, seed `fastag-post-1.13.1:msfragger:qe`):

- Pool: the 135 `qe` projects with result `OK_not_needed` in `h2r_pride_candidates.tsv` (copy of
  `acceptance/1.12/inputs/h2r_pride_candidates.tsv` beside the script): Q Exactive only, DDA, trypsin, label-free, no
  enrichment, lysate, one organism.
- Excluded: every PXD named in any file of any `origin/*` branch (135 refs after `git fetch` on 2026-11-11, among them
  `post1131/aspn`, `post1131/labeldisc`, `post1131/labeldisc-format5`, `post1131/labeldisc-heldout4`,
  `post1131/species`, `post1131/msfragger` and all `acc113r/*`) or under `output/backlog-1.13`:
  `msfragger2/inputs/excl_pxd.tsv`, 23,944 accessions with the first file naming each (`build_exclusions.py`). Not
  counted as use, as in the first test: the pool file, exclusion lists (`excl*`, `prereg-exclude*`, `other_arms*`),
  `not_needed` rows of draw tables. **Additional rule of this test:** the folder
  `output/backlog-1.13/post-1.13.1/msfragger` (this track's own report, draft protocol and draft draw) is not scanned;
  its draft draw names the same projects, and no file of them was downloaded. The development projects named there
  (PXD003531, PXD014764, the 8 projects of the first test) are excluded through the branches.
- The PRIDE record names exactly one organism, Homo sapiens. File rule: `.raw`, 0.2 to 4 GB, name without
  blank/QC/wash/standard/DIA/PRM/HeLa/test/library; shuffled with seed `<seed>:<PXD>`; first = chosen, second = backup.
- The first 10 projects with an eligible file in the shuffled order are taken. The draw is identical to the draft
  draw of the same day (129 refs); no other track took one of the projects in between.

| Run | PXD | Chosen file | Backup file |
|---|---|---|---|
| MG01 | PXD006188 | 02271_GF1_P024178_S00_T06_R1.raw | 01965_C02_P020564_S00_U14_R1.raw |
| MG02 | PXD012858 | 150213_siCTRL_MSI_contr02.raw | 161122_siCTRL_MSII_R1_K03.raw |
| MG03 | PXD006776 | tumor_tissue_high_stage_4_1.raw | control_tissue_3_1.raw |
| MG04 | PXD018780 | HsLRRC8D_1.raw | HsLRRC8D_3.raw |
| MG05 | PXD053237 | 20210223_BloodTip_DDA_03.raw | 20210223_BloodTip_DDA_07.raw |
| MG06 | PXD001724 | 130715_M504_FT_002.raw | 130715_M812_40mm_001.raw |
| MG07 | PXD009324 | 20180221_QEPlus_ML_DH_EXP109_96TipSpinner_2.raw | 20180221_QEPlus_ML_DH_EXP109_TubeSpinner_4.raw |
| MG08 | PXD018404 | NCOA1.raw | NC61.raw |
| MG09 | PXD059544 | 20221214_91_AM_F_Exp2_EST_02.raw | 20221214_110_AM_F_Exp2_BPAF_03.raw |
| MG10 | PXD052806 | L04_02.raw | L01_01.raw |

Disjointness: none of the 10 PXDs is in the exclusion list; on node data (`/scratch/kohlbach`,
`/ceph/ibmi/abi/oliver`, five levels, sweep of 2026-11-11 in `msfragger2/inputs/cluster_sweep.txt`) only PRIDE
metadata and SDRF files carry these accessions, no raw or mzML file.

Staging (no candidate, no search): download from the PRIDE mirror, PRIDE SHA-1 checked (without a PRIDE checksum: the
size and a second independent download with the same sha256), conversion, check: every MS2 is FTMS HCD and at least
5,000 MS2 carry a charge.

**Replacement rules, fixed before staging.** If the chosen file fails download, conversion or check, the backup file
of the same project is staged and used. If that fails too, the project is dropped and the test has fewer runs; there
is no redraw and no third file. C1 is judged on all staged runs; the evaluable-run minimum stays 6. Known weak point:
PXD001724 (MG06) is from the same submitter series as PXD001725, whose files ThermoRawFileParser read as empty in the
first test.

## Exact commands per run (`msfragger2/scripts/run_one.sh <run> <mzML> <dir>`)

Driver: `scripts/run_all.sh list.tsv /scratch/kohlbach/post1131/msfragger/heldout2/runs /scratch/kohlbach/post1131/msfragger/heldout2/results`
(runs in manifest order; refuses an existing run or results directory). Each step under `/usr/bin/time -v`.

1. FASTag, **primary arm** (shortlist options of the first test with the recipe; all export options at defaults):
   `FASTag -in <mzML> -out tags.tsv -recon_fasta human.fasta -tag_length 4 -extension 6 -fixed_modifications "Carbamidomethyl (C)" -variable_modifications "Oxidation (M)" -shortlist_out sl.tsv -fasta_out red.fasta -shortlist_max_evalue 10 -shortlist_min_spectra 1 -shortlist_parsimony none -shortlist_top 0 -shortlist_gapped -recon_min_length 6 -recon_missed_cleavages 2 -search_config_out fragger.params -search_engine msfragger -threads 32`
2. Arm **a**: `java -Xmx64g -jar MSFragger-4.4.1.jar fragger.params <run>.mzML` on the unedited export, in the
   directory FASTag wrote to; sha256 of `fragger.params` and `red.fasta` before and after.
3. Arm **aE**: the exported `fragger.params` with `database_name` alone replaced; targets of `red.fasta` + one
   shuffled entrapment copy of each (`ENTRAP_`) + reversed decoys (`rev_`) of both (`mkdb.py --entrap`).
4. Arm **b** (reference): `closed_b.params`, `human.fasta` + reversed decoys (`mkdb.py`).
5. Arm **bE** (informational): b with the entrapment copy of the full proteome.
6. Arm **c** (informational): the exported parameters on the database of b.
7. Arm **a0** (informational, no verdict; **default shortlist**): the FASTag command of the first test
   (`-shortlist_max_evalue 1`, no `-shortlist_gapped`, no `-recon_min_length`, no `-recon_missed_cleavages`) with the
   candidate's default export, in its own directory, then MSFragger on that unedited export. Scored by
   `score_a0.py` into `results/a0.tsv`; it enters no criterion.

## Scoring (`msfragger2/scorers/score_msfragger.py`, unchanged; one row per run)

FDR, the same for every arm: from MSFragger's `.pin`, one PSM per scan (rank 1), sorted by hyperscore descending
(ties: decoys first). Decoy = every protein starts with `rev_`; entrapment = every non-decoy protein starts with
`ENTRAP_`. q = decoys / non-decoys above the position, made monotone. **Identified** = non-decoy PSM with q <= 0.01.
Peptides are compared without flanks, modifications and charge, I = L. No rescoring.

- kept share ("recall", per run) = scans identified in b that a identifies with the same peptide / scans identified in b.
- speed-up (per run) = wall(b) / (wall(FASTag) + wall(a)), wall clock of `/usr/bin/time`.
- entrapment FDP of aE = 2 E / (T + E) over its identified PSMs.

## Criteria and thresholds (unchanged from the first test)

A run is **evaluable** when arm b returned 0 and identified at least 1,000 spectra.

| | Criterion | Threshold |
|---|---|---|
| C1 (primary) | in every staged run: FASTag returns 0 and writes both files; MSFragger returns 0 on them, unedited; the files are unchanged afterwards; a identifies at least one target PSM | all runs |
| C2 (primary) | kept share in every evaluable run (a missing or failed arm a counts as 0) | >= 0.80 |
| G1 (guard) | median speed-up over the evaluable runs | > 1.0 |
| G2 (guard) | entrapment FDP of aE: pooled over the evaluable runs, and in each evaluable run | pooled <= 0.015; each run <= 0.020 |

**Verdict** (`msfragger2/scorers/verdict_msfragger.py`, unchanged; called with the number of staged runs):

1. C1 is PASS or FAIL over all staged runs.
2. Fewer than 6 evaluable runs: C2, G1 and G2 are **INCONCLUSIVE**.
3. Otherwise each of C2, G1, G2 is PASS or FAIL at its threshold (a value that cannot be computed fails).
4. Overall: **FAIL** if any criterion fails; else **INCONCLUSIVE** if any is inconclusive; else **PASS**.

**Technical failures during the run.** A non-zero return code of FASTag or of MSFragger in arm a is a result (C1
fails); it is not rerun. A failed arm b makes the run non-evaluable; a run without an aE result or without all three
times has no G2 or G1 value, and with fewer than 6 values that guard is INCONCLUSIVE. Only if the driver is stopped
from outside (node reboot, job killed by a signal from outside, file system full; shown by the logs) the interrupted
run directory is renamed `<run>.interrupted`, kept, and that run is started once more with the identical command;
this is listed as a deviation.

Timing caveat: node data is shared and loaded; arms of a run follow each other directly, so both sides of the
speed-up see similar load, but single wall-clock values are noisy. G1 uses the median for this reason.

## Expectation, written before the run (development runs; no criterion)

On nine development runs (PXD003531, PXD014764, the seven runs of the first test) the primary arm kept 0.888 to 0.964
(mean 0.935), median speed-up 2.12, entrapment FDP 0.92 to 1.43 % per run, 1.11 % pooled. These runs chose the recipe
and the export defaults, so the values are optimistic by an unknown amount. C2 fails with a single run below 0.80 and
G2 with a single run above 2.0 % out of 10; a run with a few thousand identified spectra moves by 0.3 to 0.5 points
on 10 entrapment hits. The default shortlist (arm a0) kept 0.678 to 0.915 on the development runs (8 of 9 at or above
0.80) and is expected below 0.80 in at least one run.

## Staging result (added with the staged manifest, before any run)

Staged 2026-11-11; `manifests/msfragger-heldout2.tsv` now carries sha256 of every raw and mzML file
(`msfragger2/inputs/staged_chosen.tsv`). All 10 chosen files passed download and check (6 with the PRIDE SHA-1, 4
without one: size and identical second download); no backup file was downloaded. **The test runs on 10 runs from 10
projects** (`msfragger2/inputs/list.tsv`). MG09 (PXD059544): 40,172 of 97,104 MS2 carry a charge; the check
(at least 5,000) passes.

Deviations up to here: (1) the freeze is two commits, 8c26eb1 (protocol, scripts, scorer) and dd9c384 (manifest,
disjointness, draw, staging list, exclusion list, pool); the `*.tsv` ignore rule kept the tables out of the first.
Both were pushed before the first download. (2) A first staging launch between the two commits ended after 2 s
without a download because the staging list was missing on the node; its empty outputs are kept in
`heldout2/stage/aborted_no_list/`. Nothing else in this document changed.
