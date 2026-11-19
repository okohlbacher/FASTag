# PREREG-msfragger: `-search_engine msfragger` export, held-out test (1.13 backlog item 18)

Status: **FROZEN 2026-11-10.** Protocol, drawn manifest, scorer, verdict script and thresholds are fixed in the commit
that adds this file (branch `acc113r/msfragger`), pushed before any file of the 8 drawn projects is downloaded. A
second commit adds the staged manifest (sha256 of raw and mzML) and nothing else; it is pushed before the candidate
binary or MSFragger reads any held-out file. The split `msfragger-heldout` is run once and scored once. Nothing is
tuned on it, no run is repeated with changed settings, nothing is re-scored. FAIL and INCONCLUSIVE are valid results.
The code is not changed.

## Question

FASTag's experimental `-search_engine msfragger` writes a shortlist FASTA and an MSFragger parameter file. Used
unedited, does MSFragger accept them, and does the search on the shortlist keep the identifications of a default
MSFragger closed search on the full proteome, faster and without more false identifications?

## Frozen software and inputs

| What | Value |
|---|---|
| Candidate | `origin/integration/1.13` at 9365ff15429a78b96d3d2b9da2bc3386fcd8d991 |
| FASTag | built on node data from that commit: `data:/scratch/kohlbach/b113/msfragger/heldout/build/FASTag`, sha256 `6d32ddde27217bc594680fc92f1c094cd1b0801170b3c16f26ddd6558a601a13` (reports 1.12.2); run through the wrapper `heldout/opt/fastag` (sets OPENMS_DATA_PATH, FASTAG_DIGEST_DIR, LD_LIBRARY_PATH, OPENBLAS_NUM_THREADS=1) |
| MSFragger | 4.4.1, the copy already installed on data: `/ceph/ibmi/abi/oliver/spextract/tools/MSFragger-4.4.1.jar`, sha256 `56b15a35060e1aa3b38508eed5e1b21ce697918bad75b450307160c86c652112`; OpenJDK 21, `-Xmx64g` |
| Database | the human reference proteome FASTag ships (`src/data/alkylation/human.fasta.gz`, UP000005640 reviewed, release 2026_04, 20,414 entries), uncompressed: `heldout/db/human.fasta`, sha256 `6342992b6a9824ab73f31ac9df8c90f8bf24f54d4a0730768e28535f34ef6416` |
| Arm b parameters | `java -jar MSFragger-4.4.1.jar --config closed` gives `closed_fragger.params` (sha256 `0bb456769c6afc8e6c0759624b65def1cc87dae0a397a6bd6be9d70e5aeff0cd`); `scripts/make_b_params.sh` makes `closed_b.params` (sha256 `2070a7d60d21eca6d7cddb24aeec79e7519bce66c85a757d71d710093ec0b1dc`) with two edits that do not change the search: `num_threads = 32`, and `labile_fragment_ion_series = b,y` without the inline comment of the generated file (MSFragger reads that comment as part of the value). `database_name` is set per run. Everything else is MSFragger's default: 20 ppm precursor and fragment tolerance, mass calibration and parameter optimisation on (`calibrate_mass = 2`), isotope error 0/1/2/3, strict trypsin, 2 missed cleavages, variable Met oxidation and protein N-terminal acetylation, fixed Cys carbamidomethylation |
| Conversion | ThermoRawFileParser 2.0.0 `-f 2` (centroided, indexed mzML), `scripts/stage_msfragger.sh` |
| Scripts, scorer, verdict | `msfragger/SHA256SUMS` (sha256 of `run_one.sh`, `run_all.sh`, `mkdb.py`, `score_msfragger.py`, `verdict_msfragger.py` and the others) |
| Threads | 32 for FASTag and for every MSFragger search; runs and arms strictly one after another |

## Runs

8 runs from 8 PRIDE projects, one run per project: `manifests/msfragger-heldout.tsv`; draw table
`msfragger/inputs/draw.tsv`; disjointness `disjointness/msfragger-heldout.tsv`.

Draw (`msfragger/inputs/select_msfragger_heldout.py`, seed `fastag-1.13:#18:msfragger:qe`):

- Pool: the 135 `qe` projects with result `OK_not_needed` in `acceptance/1.12/inputs/h2r_pride_candidates.tsv`
  (Q Exactive only, DDA, trypsin, label-free, no enrichment, lysate, one organism; no run of them was ever downloaded).
- Excluded: every PXD named in any file of any `origin/*` branch (115 refs, among them all `acc113r/*`,
  `acceptance/1.13`, `acceptance/1.12`) or under `output/backlog-1.13` (reserved lists of shifts, census, species;
  alknodb manifests): `msfragger/inputs/excl_pxd.tsv`, 13,910 accessions with the first file naming each
  (`build_exclusions.py`). Not counted as use: the candidate pool file itself, files that are exclusion lists
  (`excl*`, `prereg-exclude*`, `other_arms*`), and `not_needed` rows of draw tables. See Deviations.
- The PRIDE record names exactly one organism, Homo sapiens (one database for all runs).
- Shuffled order; the first 8 projects with an eligible file are taken. File rule: `.raw`, 0.2 to 4 GB, name without
  blank/QC/wash/standard/DIA/PRM/HeLa/test/library; shuffled with seed `<seed>:<PXD>`; first = chosen, second = backup.

| Run | PXD | Chosen file | Backup file |
|---|---|---|---|
| MF01 | PXD010982 | QE6657.raw | QE7312.raw |
| MF02 | PXD003606 | H1_3rd_04.raw | CD-8_5th.raw |
| MF03 | PXD028846 | 005_SecrIII_F20.raw | 014_SecrIII_F20.raw |
| MF04 | PXD055832 | 055_SS05.raw | 062_SS12.raw |
| MF05 | PXD045916 | 20210615_QEp5_SA_SaMu_A549_NTC_IFN_HSV_4.raw | 20210615_QEp5_SA_SaMu_A549_NTC_IFN_HSV_3.raw |
| MF06 | PXD001725 | 130708_M787_002.raw | 130708_M687_002.raw |
| MF07 | PXD042467 | Aggregate-Ag-insoluble-1.raw | Aggregate-CTR-soluble-2.raw |
| MF08 | PXD035276 | HF181023_MM_neuro_WT1_3.raw | HF181023_MM_neuro_WBS3_2.raw |

Disjointness: none of the 8 PXDs is named in any branch or report other than in the candidate pool, exclusion lists
and `not_needed` draw rows; on node data (`/scratch/kohlbach`, `/ceph/ibmi/abi/oliver`, five levels, sweep of
2026-11-10 in `msfragger/inputs/cluster_sweep.txt`) only PRIDE metadata and SDRF files carry these accessions, no raw
or mzML file.

Staging (no candidate, no search): download from the PRIDE mirror, PRIDE SHA-1 checked (without a PRIDE checksum: the
size and a second independent download with the same sha256), conversion, check: every MS2 is FTMS HCD and at least
5,000 MS2 carry a charge. **Failed staging:** if the chosen file fails download or check, the backup file of the same
project is staged and used; if that fails too, the project is dropped and the test has fewer runs (no redraw). With
fewer than 8 staged runs C1 is still judged on all staged runs and the evaluable-run rule below stays at 6.

## Exact commands per run (`msfragger/scripts/run_one.sh <run> <mzML> <dir>`)

Driver: `scripts/run_all.sh list.tsv /scratch/kohlbach/b113/msfragger/heldout/runs /scratch/kohlbach/b113/msfragger/heldout/results`
(runs in manifest order; refuses an existing run or results directory). Each step under `/usr/bin/time -v`.

1. FASTag (the frozen CFG-05 shortlist options of 1.12 plus the export):
   `FASTag -in <mzML> -out tags.tsv -recon_fasta human.fasta -tag_length 4 -extension 6 -fixed_modifications "Carbamidomethyl (C)" -variable_modifications "Oxidation (M)" -shortlist_out sl.tsv -fasta_out red.fasta -shortlist_max_evalue 1 -shortlist_min_spectra 1 -shortlist_parsimony none -shortlist_top 0 -search_config_out fragger.params -search_engine msfragger -threads 32`
2. Arm **a** (exported files, unedited), in the directory FASTag wrote to:
   `java -Xmx64g -jar MSFragger-4.4.1.jar fragger.params <run>.mzML`. sha256 of `fragger.params` and `red.fasta` is
   taken before and after.
3. Arm **aE** (entrapment for a): the exported `fragger.params` with `database_name` alone replaced; database =
   targets of `red.fasta` + one shuffled entrapment copy of each (`ENTRAP_`, tryptic-peptide shuffle of the 1.12
   `entrap.py`) + reversed decoys (`rev_`) of both (`mkdb.py --entrap`).
4. Arm **b** (reference): `closed_b.params`, database = `human.fasta` + reversed decoys (`mkdb.py`).
5. Arm **bE**: as b with the entrapment copy of the full proteome (informational).
6. Arm **c** (informational, no verdict): the exported parameters on the database of b (`database_name` alone
   replaced). It separates the effect of the smaller database (a against c) from that of the parameters (c against b).

## Scoring (`msfragger/scorers/score_msfragger.py`, one row per run)

FDR, the same for every arm: from MSFragger's `.pin`, one PSM per scan (rank 1), sorted by hyperscore descending
(ties: decoys first). Decoy = every protein starts with `rev_`; entrapment = every non-decoy protein starts with
`ENTRAP_`. q = decoys / non-decoys above the position, made monotone. **Identified** = non-decoy PSM with q <= 0.01.
Peptides are compared without flanks, modifications and charge, I = L. No rescoring (no Percolator, no
PeptideProphet). The same FDR on the expectation value is reported without a verdict.

- recall (per run) = scans identified in b that are identified in a with the same peptide / scans identified in b.
- speed-up (per run) = wall(b) / (wall(FASTag) + wall(a)), wall clock of `/usr/bin/time`.
- entrapment FDP of aE = 2 E / (T + E) over its identified PSMs (E entrapment, T target; entrapment ratio 1).

## Criteria and thresholds

A run is **evaluable** when arm b returned 0 and identified at least 1,000 spectra.

| | Criterion | Threshold | Source of the threshold |
|---|---|---|---|
| C1 (primary) | in every staged run: FASTag returns 0 and writes both files; MSFragger returns 0 on them, unedited; the files are unchanged afterwards; a identifies at least one target PSM | all runs | task definition |
| C2 (primary) | recall in every evaluable run (a missing or failed arm a counts as 0) | >= 0.80 | Sage shortlist DEV freeze CFG-05 (`acceptance/1.12/dev/engines/FREEZE-05-17.md`): retained recall 0.826 (PXD003531, the lower of the two DEV runs; PXD017035 0.89 to 0.91); rounded down |
| G1 (guard) | median speed-up over the evaluable runs | > 1.0 | the repository documents no runtime for the Sage shortlist, only the database reduction (49x); break-even including FASTag's runtime is the only bound that needs no new run |
| G2 (guard) | entrapment FDP of aE: pooled over the evaluable runs, and in each evaluable run | pooled <= 0.015; each run <= 0.020 | Sage shortlist plan bound 1.5 % (largest documented value 1.36 %); per-run cap 2 % as in PREREG-item17 |

The README "Held-out acceptance" table states that the shortlist (#5) has no held-out result, so the thresholds come
from the documented DEV results. They were measured there with Sage, at peptide level, on a large multi-species
database (589,010 entries); this test measures spectrum-level recall with MSFragger on one reference proteome, as the
task prescribes. The thresholds were written before any MSFragger comparison on these 8 runs. A dry run of the
scripts on the DEV file PXD003531 (gate input, not held-out) was made after the thresholds were fixed; it changed no
threshold and no setting, only added the informational arm c.

**Verdict** (`msfragger/scorers/verdict_msfragger.py`, tested on synthetic input by `verdict_msfragger_test.py`):

1. C1 is PASS or FAIL over all staged runs.
2. Fewer than 6 evaluable runs: C2, G1 and G2 are **INCONCLUSIVE**.
3. Otherwise each of C2, G1, G2 is PASS or FAIL at its threshold (a value that cannot be computed fails).
4. Overall: **FAIL** if any criterion fails; else **INCONCLUSIVE** if any is inconclusive; else **PASS**.

**Technical failures during the run.** A non-zero return code of FASTag or of MSFragger in arm a is a result (C1
fails); it is not rerun. A failed arm b makes the run non-evaluable; a run without an aE result or without all three times has no G2 or G1 value, and with fewer than 6 values that guard is INCONCLUSIVE. Only if
the driver is stopped from outside (node reboot, job killed by a signal from outside, file system full; shown by the
logs) the interrupted run directory is renamed `<run>.interrupted`, kept, and that run is started once more with the
identical command; this is listed as a deviation.

Timing caveat: node data is shared and loaded; arms of a run follow each other directly, so both sides of the
speed-up see similar load, but single wall-clock values are noisy. G1 uses the median for this reason.

## Deviations from the task text, fixed here

- `alknodb/prereg-exclude-pxd.txt` lists all 135 pool projects, only because the census draw tables name them as
  `not_needed`. Excluding it literally leaves no project. The exclusion list is therefore rebuilt from the sources
  (rule above); every PXD that any arm or DEV set staged, ran, reserved or reported stays excluded.
- PXD010982 (MF01) is also on the census second-draw exclusion list (`census/inputs2/excl_pxd_draw2.txt`). No file
  of any branch, no report and no data file on the cluster shows a use; census drew it as `not_needed`. It stays.

## Staging result (added with the staged manifest, before any run)

Staged 2026-11-10; `manifests/msfragger-heldout.tsv` now carries sha256 of every raw and mzML file
(`msfragger/inputs/staged_chosen.tsv`, `staged_backup.tsv`). 7 chosen files passed the check. PXD001725 (MF06): the
chosen file and the backup file both downloaded completely (size correct, second download identical), but
ThermoRawFileParser 2.0.0 reports "Empty RAW file" for both. By the rule above the project is dropped without a
redraw. **The test runs on 7 runs from 7 projects** (`msfragger/inputs/list.tsv`); C1 is judged on these 7, the
evaluable-run minimum stays 6. This is one run fewer than the 8 the task asks for and is reported as a deviation.
Nothing else in this document changed.
