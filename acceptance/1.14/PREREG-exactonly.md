# PREREG-exactonly: `-shortlist_exact_only` under `-search_engine msfragger`, held-out test (1.14)

Status: **FROZEN 2026-11-13.** Protocol, drawn manifest, scorer, verdict script and thresholds are fixed in the commit
that adds this file (branch `acc114/exactonly`, from tag v1.13.4), pushed before any file of the 10 drawn projects is
downloaded (freeze 1). A second commit adds the staged and audited manifest (sha256 of raw and mzML, truth audit) and
nothing else; it is pushed before the candidate binary or MSFragger reads any held-out file (freeze 2). The split
`exactonly-heldout` is run once and scored once. Nothing is tuned on it, no run is repeated with changed settings,
nothing is re-scored, no criterion is changed. Deviations are recorded, not repaired. FAIL and INCONCLUSIVE are valid
results. The code is not changed.

Authorization: the user's interview answer of 2026-11-13 selected this test among the owed held-out tests.
Pattern: `acceptance/1.13/PREREG-msfragger2.md` on branch `post1131/msfragger-heldout2` (second msfragger test, PASS).
Criteria and thresholds are those of that test, unchanged.

## Question

FASTag 1.13.4 under `-search_engine msfragger -search_config_out` (tryptic shortlist) applies four shortlist defaults:
`-shortlist_gapped` on, `-shortlist_max_evalue 10`, `-recon_min_length 6`, `-recon_missed_cleavages 2`.
`-shortlist_exact_only` turns gapped placement off and keeps the other three. Used unedited, with
`-shortlist_exact_only`, the three other msfragger defaults as FASTag applies them, and all export options at their
defaults, does the export of `-search_engine msfragger` keep at least 80 % of the spectra a default MSFragger closed
search on the full human proteome identifies, faster, with an entrapment FDP of at most 1.5 % pooled and 2.0 % in
every run?

Secondary arm (no effect on the verdict): the same command without `-shortlist_exact_only` (the 1.13.4 default,
gapped placement on), on the same runs, scored by the same scorer and verdict script.

## Frozen software and inputs

| What | Value |
|---|---|
| Candidate | tag v1.13.4 = main 0ddff9b72ad5f92d82ab3f52f8329fc61d084d9c (released FASTag 1.13.4) |
| FASTag | built on node data from `git archive v1.13.4` (`data:/scratch/kohlbach/acc114/exactonly/{src,build}`, `build.sh` = the msfragger2 build script with paths and `-j 12`): `build/FASTag`, sha256 `9b560d63255913a4e40383d0651d2fee906339094d2310823f2e67fda8206314`; shortlist header reports `FASTag 1.13.4`. Run through the wrapper `opt/fastag` (OPENMS_DATA_PATH, FASTAG_DIGEST_DIR, LD_LIBRARY_PATH, OPENBLAS_NUM_THREADS=1; as in msfragger2) |
| MSFragger | 4.4.1, `/ceph/ibmi/abi/oliver/spextract/tools/MSFragger-4.4.1.jar`, sha256 `56b15a35060e1aa3b38508eed5e1b21ce697918bad75b450307160c86c652112`; OpenJDK 21, `-Xmx64g`. Not downloaded, not redistributed |
| Database | `db/human.fasta`, copy of the msfragger2 file (UP000005640 reviewed, 2026_04, 20,414 entries), sha256 `6342992b6a9824ab73f31ac9df8c90f8bf24f54d4a0730768e28535f34ef6416` |
| Arm b parameters | `db/closed_b.params`, sha256 `50bebd9aa8a93a11c49cb181b889d790d1e836c43fa80b88e8a2954a8d571663`: MSFragger's `--config closed` output with `num_threads = 12` and the `labile_fragment_ion_series` fix (`scripts/make_b_params.sh`); `database_name` set per run |
| Conversion | ThermoRawFileParser 2.0.0 `-f 2`, `scripts/stage_msfragger.sh` (unchanged) with `MSFRAGGER_HELDOUT=/scratch/kohlbach/acc114/exactonly/data` |
| Scripts, scorer, verdict | `exactonly/SHA256SUMS`. Unchanged from msfragger2: `verdict_msfragger_test.py`, `mkdb.py`, `stage_msfragger.sh`, `fetch_pride_meta.sh`. Changed: `score_msfragger.py` and `verdict_msfragger.py` (only a `--selftest` switch that runs `verdict_msfragger_test.py`; scoring and verdict code unchanged), `make_b_params.sh` (12 threads), `run_one.sh` (see Exact commands), `run_all.sh` (scores the secondary arm with the same scorer), `build_manifest.py` (paths, run ids EX), `build_exclusions.py` (scope, below), `select_exactonly.py` (seed, exclusion list) |
| Threads | 12 for FASTag and for every MSFragger search (node data is shared by four parallel tests, at most 12 threads each; msfragger2 used 32); runs and arms strictly one after another |

## Runs

10 runs from 10 PRIDE projects, one run per project: `manifests/exactonly-heldout.tsv`; draw table
`exactonly/inputs/draw.tsv`; disjointness `disjointness/exactonly-heldout.tsv`.

Draw (`exactonly/inputs/select_exactonly.py`, seed `fastag-1.14:exactonly:msfragger:qe`), rules of msfragger2:

- Pool: the 135 `qe` projects with result `OK_not_needed` in `h2r_pride_candidates.tsv` (copy of
  `acceptance/1.12/inputs/h2r_pride_candidates.tsv` beside the script): Q Exactive only, DDA, trypsin, label-free, no
  enrichment, lysate, one organism.
- Excluded (`build_exclusions.py`, `exactonly/inputs/excl_pxd.tsv`, 23,993 accessions with the first file naming
  each): every PXD named (1) in any file of any `origin/*` branch (159 refs after `git fetch` on 2026-11-13, among them
  every `acc113r/*`, `post1131/*` and `acceptance/*` branch), (2) in any text file under the FASTag output folder
  `output/` (all `backlog-1.13`, `backlog-1.14`, `backlog-1.15`, `features-1.12`, `tagging-vault`, `jpr-paper`, ...;
  files above 20 MB, binary formats and sealed mode-000 files are skipped, sealed files are not opened), (3) in a
  directory or file name under the FASTag data folder. Not counted as use, as before: the pool file, exclusion lists
  (`excl*`, `prereg-exclude*`, `other_arms*`), `not_needed` rows of draw tables. 46 of the 135 pool projects remain.
  No `acc114/*` branch existed on origin at the draw; the three parallel 1.14 tests draw DIA, ion-trap and Asp-N data.
- The PRIDE record names exactly one organism, Homo sapiens. File rule: `.raw`, 0.2 to 4 GB, name without
  blank/QC/wash/standard/DIA/PRM/HeLa/test/library; shuffled with seed `<seed>:<PXD>`; first = chosen, second = backup.
- The first 10 projects with an eligible file in the shuffled order are taken (draw ranks 2 to 48).

| Run | PXD | Chosen file | Backup file |
|---|---|---|---|
| EX01 | PXD007080 | 20150430_AWH_FabianBraun_150414_shRNA849-1_07.raw | 20150430_AWH_FabianBraun_150414_coshRNA-1_01.raw |
| EX02 | PXD006553 | HF0111_MS601_KarlMorten_16.raw | HF0111_MS601_KarlMorten_1.raw |
| EX03 | PXD045654 | UMH15027X003__HU264_5_IgG_2_92-357437.raw | UMH15027X002__HU264_4_IgG_1_92-357436.raw |
| EX04 | PXD003252 | A2780-DRcontrol-1.raw | A2780-2.raw |
| EX05 | PXD024632 | PHH_Media_LysC_Exp60.raw | PHH_Media_LysC_Exp40.raw |
| EX06 | PXD018069 | Teeth_Sample_control_008.raw | Teeth_Sample_control_004.raw |
| EX07 | PXD037344 | MS206435QEHF_Orli_Kronauer_Sec_Pellet_02.raw | MS206435QEHF_Orli_Kronauer_Sec_Pellet_04.raw |
| EX08 | PXD008934 | Prosser_1119.raw | Prosser_1205.raw |
| EX09 | PXD014823 | MGP2.raw | MGP1.raw |
| EX10 | PXD032816 | P2CH20190415_HOMO_3.raw | P2CH20190415_WT_1.raw |

Disjointness: none of the 10 PXDs is in the exclusion list; on node data (`/scratch/kohlbach`,
`/ceph/ibmi/abi/oliver`, five levels, sweep of 2026-11-13 in `exactonly/inputs/cluster_sweep.txt`) only PRIDE
metadata and SDRF files carry these accessions, no raw or mzML file.

**Staging** (no candidate, no search): download over https from the PRIDE FTP mirror, at most 4 downloads at a time;
per file up to 8 resumed tries; PRIDE SHA-1 checked (without a PRIDE checksum: the size and a second independent
download with the same sha256); conversion; check: every MS2 is FTMS HCD and at least 5,000 MS2 carry a charge.

**Replacement rules, fixed before staging.** If the chosen file fails download, conversion or check, the backup file
of the same project is staged and used. If that fails too, the project is dropped and the test has fewer runs; there
is no redraw and no third file.

**Truth audit, fixed before staging; done before freeze 2 from the PRIDE project record (instruments, organisms,
quantification, PTMs, sample and data processing protocols, description) and, where the record names a publication,
its abstract.** A run is excluded (before any FASTag run, recorded with the source) only on a clear statement that the
project is not: Q Exactive family, DDA, human, digested with trypsin (Lys-C followed by trypsin counts as trypsin;
Lys-C alone does not), label-free (no TMT, iTRAQ, SILAC, dimethyl), without PTM enrichment. Affinity purification,
immunoprecipitation, fractions and tissue are allowed and noted. An unclear record does not exclude. An excluded run
is not staged-and-run; C1 is judged on the remaining runs; the evaluable-run minimum stays 6.

## Exact commands per run (`exactonly/scripts/run_one.sh <run> <mzML> <dir>`)

Driver: `scripts/run_all.sh list.tsv /scratch/kohlbach/acc114/exactonly/runs /scratch/kohlbach/acc114/exactonly/results`
(runs in manifest order; refuses an existing run or results directory). Each step under `/usr/bin/time -v`.

1. FASTag, **primary arm** (msfragger2 base options; the four msfragger shortlist options are not given, so FASTag
   applies its defaults for the three that stay; plus `-shortlist_exact_only`):
   `FASTag -in <mzML> -out tags.tsv -recon_fasta human.fasta -tag_length 4 -extension 6 -fixed_modifications "Carbamidomethyl (C)" -variable_modifications "Oxidation (M)" -shortlist_out sl.tsv -fasta_out red.fasta -shortlist_min_spectra 1 -shortlist_parsimony none -shortlist_top 0 -shortlist_exact_only -search_config_out fragger.params -search_engine msfragger -threads 12`
   (the base options `-tag_length 4 -extension 6 -shortlist_min_spectra 1 -shortlist_parsimony none -shortlist_top 0`
   are those of both earlier msfragger tests and are kept so the tested shortlist differs from the PASSed one only in
   gapped placement).
2. Arm **a**: `java -Xmx64g -jar MSFragger-4.4.1.jar fragger.params <run>.mzML` on the unedited export, in the
   directory FASTag wrote to; sha256 of `fragger.params` and `red.fasta` before and after.
3. Arm **aE**: the exported `fragger.params` with `database_name` alone replaced; targets of `red.fasta` + one
   shuffled entrapment copy of each (`ENTRAP_`) + reversed decoys (`rev_`) of both (`mkdb.py --entrap`).
4. Arm **b** (reference): `closed_b.params`, `human.fasta` + reversed decoys (`mkdb.py`).
5. Arm **bE** (informational): b with the entrapment copy of the full proteome.
6. **Secondary arm g**: steps 1 to 3 again in `<dir>/g/` with the same FASTag command without
   `-shortlist_exact_only` (gapped default); `g/b` links to arm b of the run.

Dropped from msfragger2 (informational there): arm c and arm a0.

## Scoring (`exactonly/scorers/score_msfragger.py`, scoring code unchanged from msfragger2; one row per run)

FDR, the same for every arm: from MSFragger's `.pin`, one PSM per scan (rank 1), sorted by hyperscore descending
(ties: decoys first). Decoy = every protein starts with `rev_`; entrapment = every non-decoy protein starts with
`ENTRAP_`. q = decoys / non-decoys above the position, made monotone. **Identified** = non-decoy PSM with q <= 0.01.
Peptides are compared without flanks, modifications and charge, I = L. No rescoring.

- kept share ("recall", per run) = scans identified in b that a identifies with the same peptide / scans identified in b.
- speed-up (per run) = wall(b) / (wall(FASTag) + wall(a)), wall clock of `/usr/bin/time`.
- entrapment FDP of aE = 2 E / (T + E) over its identified PSMs.

Primary: `results/runs.tsv`, `results/verdict.tsv`. Secondary (same scorer on `<run>/g`): `results/runs_gapped.tsv`,
`results/verdict_gapped.tsv`. Both scored in the same single scoring pass of `run_all.sh`.

## Criteria and thresholds (unchanged from msfragger2), primary arm

A run is **evaluable** when arm b returned 0 and identified at least 1,000 spectra.

| | Criterion | Threshold |
|---|---|---|
| C1 (primary) | in every staged run: FASTag returns 0 and writes both files; MSFragger returns 0 on them, unedited; the files are unchanged afterwards; a identifies at least one target PSM | all runs |
| C2 (primary) | kept share in every evaluable run (a missing or failed arm a counts as 0) | >= 0.80 |
| G1 (guard) | median speed-up over the evaluable runs | > 1.0 |
| G2 (guard) | entrapment FDP of aE: pooled over the evaluable runs, and in each evaluable run | pooled <= 0.015; each run <= 0.020 |

**Verdict** (`exactonly/scorers/verdict_msfragger.py`, verdict code unchanged; called with the number of staged runs):

1. C1 is PASS or FAIL over all staged runs.
2. Fewer than 6 evaluable runs: C2, G1 and G2 are **INCONCLUSIVE**.
3. Otherwise each of C2, G1, G2 is PASS or FAIL at its threshold (a value that cannot be computed fails).
4. Overall: **FAIL** if any criterion fails; else **INCONCLUSIVE** if any is inconclusive; else **PASS**.

The secondary arm gets the same table from the same script; it is reported beside the primary verdict and changes
nothing in it. Descriptive, pre-specified, no verdict: per run, kept share primary minus secondary, and the ratio of
their speed-ups (median over the evaluable runs).

**Technical failures during the run.** A non-zero return code of FASTag or of MSFragger in arm a is a result (C1
fails); it is not rerun. A failed arm b makes the run non-evaluable; a run without an aE result or without all three
times has no G2 or G1 value, and with fewer than 6 values that guard is INCONCLUSIVE. Only if the driver is stopped
from outside (node reboot, job killed by a signal from outside, file system full; shown by the logs) the interrupted
run directory is renamed `<run>.interrupted`, kept, and that run is started once more with the identical command;
this is listed as a deviation.

Timing caveat: node data is shared and loaded; arms of a run follow each other directly, so both sides of the
speed-up see similar load, but single wall-clock values are noisy. G1 uses the median for this reason.

## Expectation, written before the run (no criterion)

Exact-only with the other three values has no earlier development value. Check before the freeze on the development
run PXD003531 only (`devcheck`, this harness, 12 threads): the secondary arm's shortlist FASTA is byte-identical to the
msfragger2 development check (sha256 `24d90b7d...`), so the 1.13.4 build reproduces the PASSed configuration. On that
run the primary arm keeps 0.841 (1,409 shortlist proteins, speed-up 2.64, entrapment FDP 1.35 %) against 0.939 for
the gapped default (3,870 proteins, 2.45, 1.28 %). On msfragger2's development table, gapped placement added 2 to 5
points of kept share at each step. The development run is among the easier ones (gapped 0.939 against held-out median
0.934, minimum 0.833), so C2 is expected to fail in at least one run: a run near 0.83 with gapped would fall to about
0.73 if the PXD003531 difference (10 points) holds. G1 is expected to pass (smaller shortlist), G2 to be close to the
gapped values.

## Staging and truth audit result (added with freeze 2, before any run)

Staged 2026-11-13; `manifests/exactonly-heldout.tsv` carries sha256 of every raw and mzML file
(`exactonly/inputs/staged_chosen.tsv`). All 10 chosen files passed download and check (9 with the PRIDE SHA-1;
PXD045654 without one: size and identical second download); no backup file was downloaded.

Truth audit (`exactonly/inputs/truth_audit.tsv`, PRIDE records): two runs are excluded by the frozen rule and are not
run: **EX06 PXD018069** (tooth enamel etched with 5 % HCl, no protease: not digested with trypsin) and **EX07
PXD037344** (ant pupal fluid, searched against the Ooceraea biroi proteome: not human, although the record names Homo
sapiens). The manifest's `use` column (written by the unchanged builder) shows `run` for them; the audit overrides it.
EX03 PXD045654 is affinity-purification eluates (allowed, noted). **The test runs on 8 runs from 8 projects**
(`exactonly/inputs/list.tsv`); C1 is judged on these 8; the evaluable-run minimum stays 6.

Deviations up to here: none. Nothing else in this document changed.
