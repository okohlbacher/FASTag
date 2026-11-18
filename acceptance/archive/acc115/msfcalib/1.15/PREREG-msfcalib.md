# PREREG-msfcalib: `calibrate_mass 2` in the MSFragger export, held-out test (post-1.15)

Status: **FROZEN 2026-11-15.** Protocol, draw script, drawn manifest, exclusion and disjointness lists, scorer,
verdict script and thresholds are fixed in the commit that adds this version (branch `acc115/msfcalib`), pushed
before any file of the 10 drawn projects is downloaded. A second commit adds the staged manifest (sha256 of raw and
mzML) and nothing else; it is pushed before the candidate binary or MSFragger reads any held-out file. The split
`msfcalib-heldout` is run once and scored once. Nothing is tuned on it, no run is repeated with changed settings,
nothing is re-scored, no criterion is changed. Deviations are recorded, not repaired. FAIL and INCONCLUSIVE are valid
results. The code is not changed.

Pattern: `acceptance/1.13/PREREG-msfragger2.md` on `post1131/msfragger-heldout2` (second test, PASS) and
`acceptance/1.14/PREREG-exactonly.md` on `acc114/exactonly` (third test). C1, C2, G1, G2 and their thresholds are
those of these tests, applied to the candidate arm; the paired criteria P1 to P3 come from the development decision
rule (`output/backlog-1.15/msfragger-calib/PLAN.md`).

## Question

Under the msfragger shortlist defaults (`-search_engine msfragger -search_config_out`, tryptic shortlist), does the
export with `calibrate_mass 2` (arm 2, candidate) meet the criteria of the earlier MSFragger held-out tests, and does
it keep more of a full MSFragger search's identified spectra than the same export with `calibrate_mass 0` (arm 0, the
export of FASTag 1.14.0), without raising the entrapment FDP over the limits and without losing the speed-up?

## Development result (no criterion; these runs chose the change)

27 development runs (all spent), node data, 12 threads (`output/backlog-1.15/msfragger-calib/RESULT.md`, `pair.tsv`):
lowest kept share 0.530 -> 0.800 (EX04), median 0.934 -> 0.946, higher in 25 of 27 runs, lower in one (MG04
0.976 -> 0.956); entrapment FDP 1.07 % -> 1.10 % pooled, one run above 2.0 % with both arms (2.12 % / 2.04 %);
speed-up lowest 2.02 -> 1.03, median 2.59 -> 1.49; MSFragger exit 0 in every run. The development runs include the
two runs on which the third held-out test failed (EX04 = PXD003252, EX03 = PXD045654).

## Decisions on the open points of the draft (decided 2026-11-15)

1. P3 (speed-up of arm 2 > 1.0 in every evaluable run) is kept as a guard, beside G1 (median).
2. P1 is the median over the evaluable runs of the paired difference kept share a2 - a0, > 0.
3. Pool: if fewer than 10 projects of the pool have an eligible file, all of them are taken, provided at least 6;
   with fewer than 6 the pool is widened to the next Orbitrap DDA class of `h2r_pride_candidates.tsv`, `astral`, with
   the same filters (it has no `OK_not_needed` row, so widening adds no project; still fewer than 6 -> no draw).
   Eligibility is counted from PRIDE metadata only, before the draw: **21 eligible qe projects** on 2026-11-15, so
   the rule did not apply and 10 projects were drawn.
4. 32 threads for FASTag and every MSFragger search.

## Frozen software and inputs

| What | Value |
|---|---|
| Candidate | branch `post115/msfragger-calib` at `48a2f22caea3d00af97c72209156c5a750246a12` (merge of origin/main da92dee6 = release 1.14.0 into 94abaa48; code 404d0d52, tests 64e9203d, log wording b90844c7). Gate on node data: ctest 83/83, GATE JOB PASS, gate 9/9, new cases 7/7, interface differs from 1.14.0 only in the `-search_engine` help |
| FASTag | built on node data from the tree of 48a2f22c (sha256 of every file equal to `git archive`): `data:/scratch/kohlbach/acc115/msfcalib/cand/build/FASTag`, sha256 `ea03278460c990f3cb7956881f491be759524dd790bd2ce4adff9afaf4a02678` (reports 1.14.0); wrapper `msfcalib/opt/fastag` (OPENMS_DATA_PATH, FASTAG_DIGEST_DIR, LD_LIBRARY_PATH, OPENBLAS_NUM_THREADS=1) |
| Arm 0 parameters | the candidate's exported `fragger.params` with the one line `calibrate_mass = 2` replaced by `calibrate_mass = 0`. Checked on the development run PXD003531 (32 threads): this file equals the 1.14.0 export except the header comment, and `red.fasta` is byte-identical |
| MSFragger | 4.4.1, `/ceph/ibmi/abi/oliver/spextract/tools/MSFragger-4.4.1.jar`, sha256 `56b15a35060e1aa3b38508eed5e1b21ce697918bad75b450307160c86c652112`; OpenJDK 21, `-Xmx64g` |
| Database | `msfcalib/db/human.fasta`, copy of the second test's file (UP000005640 reviewed, 20,414 entries), sha256 `6342992b6a9824ab73f31ac9df8c90f8bf24f54d4a0730768e28535f34ef6416` |
| Arm b parameters | `msfcalib/db/closed_b.params`, copy of the second test's file (MSFragger closed defaults, `num_threads = 32`), sha256 `2070a7d60d21eca6d7cddb24aeec79e7519bce66c85a757d71d710093ec0b1dc` |
| Staging | `msfcalib/scripts/stage_msfcalib.sh`: download through the group's PRIDE archive tool (`pride_get.py`, HTTPS, `--split 4`, size and PRIDE MD5 checked; persistent copy under `/ceph/ibmi/abi/dont-backup/pride/<PXD>/`), ThermoRawFileParser 2.0.0 `-f 2` (nice 10), the mzML also registered in the archive. At most 2 projects are staged at a time |
| Scripts, scorer, verdict | `msfcalib/SHA256SUMS`. Unchanged from the third test: `score_msfragger.py`, `verdict_msfragger.py`, `verdict_msfragger_test.py`, `mkdb.py`, `fetch_pride_meta.sh`, `h2r_pride_candidates.tsv`. New: `run_one.sh`, `run_all.sh`, `score_msfcalib.py` (imports `accepted()` and `wall()` unchanged), `verdict_msfcalib.py` (imports `verdict()` unchanged), `verdict_msfcalib_test.py`, `stage_msfcalib.sh`. Changed: `select_msfcalib.py` (seed, pool rule), `build_exclusions.py` (deleted-branch bundle, skip folder), `build_manifest.py` (paths, run ids MC) |
| Threads | 32 for FASTag and every MSFragger search; runs and arms strictly one after another |

Scorer check on development data only (PXD003531, EX04, MG04 of the development measurement, laid out as run
directories): `score_msfcalib.py` reproduces `pair.tsv`'s kept shares, entrapment FDPs and calibration values.

## Runs

10 runs from 10 PRIDE projects, one run per project: `manifests/msfcalib-heldout.tsv`; draw table
`msfcalib/inputs/draw.tsv`; disjointness `disjointness/msfcalib-heldout.tsv`.

Draw (`msfcalib/inputs/select_msfcalib.py`, seed `fastag-post-1.15:msfcalib:qe`):

- Pool: the 135 `qe` projects with result `OK_not_needed` in `h2r_pride_candidates.tsv`: Q Exactive only, DDA,
  trypsin, label-free, no enrichment, lysate, one organism.
- Excluded (`msfcalib/inputs/excl_pxd.tsv`, 25,444 accessions, `build_exclusions.py`): every PXD named in any file of
  any `origin/*` branch after `git fetch` on 2026-11-15 (29 refs; no `acc115/*` branch existed) or of any branch
  deleted from origin on 2026-11-13 (138 refs, from `output/backlog-1.15/branches-deleted-2026-11-13/branches.bundle`),
  in any file under the FASTag `output` folder (among them `backlog-1.13`, `backlog-1.14`, `backlog-1.15`, including
  the notes of the parallel tests `heldout-aspn2` and `heldout-acqcheck4`), or in a file name under the FASTag `data`
  folder. Not counted as use: the pool file, exclusion lists, `not_needed` rows of draw tables. Not scanned: this
  test's own notes folder `output/backlog-1.15/heldout-msfcalib`. 106 of the 135 pool projects are excluded.
- The PRIDE record names exactly one organism, Homo sapiens. File rule: `.raw`, 0.2 to 4 GB, name without
  blank/QC/wash/standard/DIA/PRM/HeLa/test/library; shuffled with seed `<seed>:<PXD>`; first = chosen, second = backup.
- The first 10 projects with an eligible file in the shuffled order are taken (draw ranks 13 to 85).

| Run | PXD | Chosen file | Backup file |
|---|---|---|---|
| MC01 | PXD051187 | 190804_IKP_I2_5.raw | 20211027_JMI_I1_60.raw |
| MC02 | PXD056281 | 63_DT43_2.raw | 59_DT92_1.raw |
| MC03 | PXD040351 | 230120_EH_04.raw | 230120_EH_02.raw |
| MC04 | PXD011353 | B002001_Ap_CMB-89_GevaertLab_ShotGun_Jurkat_3.raw | B001981_Ap_CMB-89_GevaertLab_ShotGun_HCT116_1.raw |
| MC05 | PXD042045 | Brain_D0_1.raw | Brain_D21_5.raw |
| MC06 | PXD035773 | QX04994.raw | QX05046.raw |
| MC07 | PXD027840 | 20201014_EXPL1_JRW_SA_T_XX9.raw | 20201014_EXPL1_JRW_SA_L_XX7.raw |
| MC08 | PXD066511 | 20220519_JVu_Mahajan_11942_Pre_07A_2ul_45.raw | 20220519_JVu_Mahajan_11942_Pre-09A_2ul_49.raw |
| MC09 | PXD027143 | S16994-techrep2.raw | S16996.raw |
| MC10 | PXD007081 | 20161116_UC_ColID_194_ProjID_267_RuthHerzog_161110RuHeS06T.raw | 20161116_UC_ColID_194_ProjID_267_RuthHerzog_161110RuHeS07T.raw |

Disjointness: none of the 10 PXDs is in the exclusion list; sweep on node data (`/scratch/kohlbach`,
`/ceph/ibmi/abi/oliver`, five levels; PXD folders of the PRIDE archive) in `msfcalib/inputs/cluster_sweep.txt`: only
PRIDE metadata and SDRF files carry these accessions, no raw or mzML file, no PRIDE archive folder. In the FASTag
output folder they appear only in an exclusion list and as `not_needed` rows of an earlier draft draw. The branches of the parallel tests are checked again right before the second commit.

Staging check: every MS2 is FTMS HCD and at least 5,000 MS2 carry a charge. **Replacement rules:** if the chosen file
fails download, conversion or check, the backup file of the same project is staged and used; if that fails too, the
project is dropped (no redraw, no third file). C1 is judged on all staged runs; the evaluable-run minimum stays 6.

## Exact commands per run (`msfcalib/scripts/run_one.sh <run> <mzML> <dir>`)

Driver: `scripts/run_all.sh list.tsv /scratch/kohlbach/acc115/msfcalib/runs /scratch/kohlbach/acc115/msfcalib/results`
(runs in manifest order; refuses an existing results directory and every existing run directory). Each step under
`/usr/bin/time -v`.

1. FASTag (candidate; msfragger defaults applied by FASTag, no recipe options):
   `FASTag -in <mzML> -out tags.tsv -recon_fasta human.fasta -tag_length 4 -extension 6 -fixed_modifications "Carbamidomethyl (C)" -variable_modifications "Oxidation (M)" -shortlist_out sl.tsv -fasta_out red.fasta -shortlist_min_spectra 1 -shortlist_parsimony none -shortlist_top 0 -search_config_out fragger.params -search_engine msfragger -threads 32`;
   the log must contain `MSFragger export (development runs only, no held-out test): calibrate_mass 2`.
2. Arm **b** (reference): `closed_b.params`, `human.fasta` + reversed decoys (`mkdb.py`).
3. Arms **aE0**, **aE2**: each arm's parameters with `database_name` alone replaced: targets of `red.fasta` + one
   shuffled entrapment copy of each (`ENTRAP_`) + reversed decoys of both (`mkdb.py --entrap`).
4. Arms **a0** and **a2** in the order a0 a2 a2 a0 (`a0_r1 a2_r1 a2_r2 a0_r2`), MSFragger run from the directory
   FASTag wrote to, on the exported `red.fasta`: a2 with the unedited export, a0 with the arm 0 file. Identifications
   from r1; wall clock = median of r1 and r2. sha256 of `fragger.params` and `red.fasta` before the first and after
   the last search.
5. After every search the derived caches (`*.pepindex`, `*.mzBIN*`) are removed, so no search reuses another's index.

## Scoring (unchanged rules; `msfcalib/scorers/score_msfcalib.py`, one row per run)

From MSFragger's `.pin`, one PSM per scan (rank 1), sorted by hyperscore descending (ties: decoys first); q =
decoys / non-decoys above the position, monotone; identified = non-decoy PSM with q <= 0.01; peptides without flanks,
modifications and charge, I = L. No rescoring.

- kept share (per run and arm) = scans identified in b that the arm's r1 identifies with the same peptide / scans
  identified in b.
- speed-up (per run and arm) = wall(b) / (wall(FASTag) + median(wall(r1), wall(r2))).
- entrapment FDP of aE = 2 E / (T + E) over its identified PSMs.
- Informational: whether r1 and r2 identify the same scans with the same peptides; MSFragger's optimized fragment
  tolerance and the MS2 mass error before calibration from a2_r1's log.

## Criteria (`msfcalib/scorers/verdict_msfcalib.py`)

A run is **evaluable** when arm b returned 0 and identified at least 1,000 spectra. At least 6 evaluable runs, else
C2, G1, G2 and P1 to P3 are INCONCLUSIVE.

Absolute criteria on arm 2 (thresholds of the earlier MSFragger tests; `verdict()` of `verdict_msfragger.py`):

| | Criterion | Threshold |
|---|---|---|
| C1 (primary) | every staged run: FASTag returns 0, writes both files and the calibrate_mass log line; MSFragger returns 0 in both repetitions of a2 and of a0; the files are unchanged afterwards; a2 identifies at least one target PSM | all runs |
| C2 (primary) | kept share of a2 in every evaluable run (a missing or failed a2 counts as 0) | >= 0.80 |
| G1 (guard) | median speed-up of a2 over the evaluable runs (fewer than 6 values: INCONCLUSIVE) | > 1.0 |
| G2 (guard) | entrapment FDP of aE2, pooled over the evaluable runs and in each evaluable run (fewer than 6 values: INCONCLUSIVE) | pooled <= 0.015; each <= 0.020 |

Paired criteria, arm 2 against arm 0:

| | Criterion | Threshold |
|---|---|---|
| P1 (primary) | median over the evaluable runs of kept share a2 - a0 (a missing kept share counts as 0) | > 0 |
| P2 (guard) | no evaluable run with aE0 FDP <= 0.020 has aE2 FDP > 0.020 (a missing aE2 value in such a run fails; fewer than 6 aE0 values: INCONCLUSIVE) | none |
| P3 (guard) | speed-up of a2 in every evaluable run (a missing value fails) | > 1.0 |

**Verdict:** C1 PASS or FAIL over all staged runs; otherwise each criterion PASS, FAIL or INCONCLUSIVE as above.
Overall FAIL if any criterion fails, else INCONCLUSIVE if any is inconclusive, else PASS. **PASS: `calibrate_mass 2`
stays the default and is documented as held-out tested. FAIL or INCONCLUSIVE: the export goes back to
`calibrate_mass 0`.** Arm 0's own C2, G1, G2 values are reported (a fourth look at the 1.14.0 export), with no verdict.

Technical failures: a non-zero return code is a result, not rerun. Only if the driver is stopped from outside (node
reboot, external signal, file system full; shown by the logs) the interrupted run directory is renamed
`<run>.interrupted`, kept, and that run is started once more with the identical command; listed as a deviation.
Timing caveat: node data is shared; the arms of a run follow each other directly and a0/a2 are interleaved and
mirrored, so both sides see similar load. The run is scheduled so that no other held-out test loads node data at the
same time.

## Expectation (development runs; no criterion)

On the 27 development runs arm 2 meets C2 in every run (lowest 0.800, EX04, at the threshold), G2 except the one run
above 2.0 % already under arm 0, P1 (median +0.012), and P3 only narrowly (three runs at 1.03 to 1.10 at 12 threads).
At 32 threads both sides of the speed-up change; P3 is the criterion most likely to fail.

## Staging result (added with the staged manifest, before any run)

Staged 2026-11-15; `manifests/msfcalib-heldout.tsv` now carries sha256 of every raw and mzML file
(`msfcalib/inputs/staged_chosen.tsv`). All 10 chosen files passed download (size and PRIDE MD5) and check; no backup
file was downloaded. **The test runs on 10 runs from 10 projects** (`msfcalib/inputs/list.tsv`). MC01 (PXD051187) has
5,068 MS2, all with a charge (the check needs 5,000); MC02 (PXD056281) and MC09 (PXD027143) carry a charge on 32,331 of
90,606 and 50,245 of 75,997 MS2. Re-check before this commit: `origin/acc115/acqcheck4` (freeze 1 c6abe7e0, after this
test's) names the 10 projects only in its exclusion lists; `disjointness/msfcalib-heldout.tsv` is refreshed with that
branch and this test's own files. Deviations up to here: none.
