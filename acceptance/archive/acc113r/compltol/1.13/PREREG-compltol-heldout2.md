# PREREG-compltol-heldout2: second held-out test of `-complement_tolerance_unit auto` (revised estimator)

Backlog item 15 of 1.13. Status: **FROZEN** on 2026-11-10. Nothing of this test has been run on a held-out file with
FASTag when this file is committed: only download, ThermoRawFileParser and Sage (the truth) have touched the files.
The candidate is run once and scored once. Nothing is tuned on held-out data, nothing is rerun or re-scored, and no
criterion may be changed after this commit. A FAIL or an INCONCLUSIVE is a valid result.

The first held-out test (`PREREG-compltol.md`, `results/compltol/`, binary c5f96b5) failed its criterion (i) on
Astral. The estimator was then revised on DEV only (floor-corrected median + MAD, one window per file, never below
`-complement_tolerance`). This test is the first run of the revised estimator on held-out data.

## Frozen software and configs

| What | Value |
|---|---|
| Candidate | `origin/integration/1.13` e21d8033f94c895c9880882226826afb42778d6d, unchanged |
| Binary | built from that commit on IBMI node data (OpenMS 70cebcd144, env fastag-omsdev): `data:/scratch/kohlbach/b113/compltol/heldout2/frozen/FASTag.bin` sha256 `ea096d0c1e7b8e5816e03f5026914d0007c56632ae2fe8f1d43be143d75d3392`, started through the wrapper `frozen/FASTag` sha256 `b84c190a1348e2f4c8435671fc27c94e0af89691d8ca7bebeef7efcca5fdb43b`; ctest of the build: rc 0 |
| CFG-CT2-base | defaults (`-complement_tolerance_unit Da`, 0.02 Da), param_hash `6ad882ba7faa187ef1841b92a99cbe4f5bf58345ebf518d1b423ad71e42aeb24` |
| CFG-CT2-cand | `-complement_tolerance_unit auto` (other options default), param_hash `ec58e2ab87ecfae7f8d1abc71a4f8c0321c5bfc8736e76b13f67c80f4cb324e7` |
| CFG-CT2-base-it05 | CFG-CT2-base + `-fragment_tolerance 0.5 -fragment_tolerance_unit Da` (ion_trap runs), `a2cf7f363ba8077bb6f0a66e6af53c325474b73cac557a46a2013a3ebaa85c94` |
| CFG-CT2-cand-it05 | CFG-CT2-cand + the same, `a202b177935f4bc194bfe82448e34b22f25061515bb8a8e2d6da7bd3090d157b` |
| Truth engine | Sage v0.14.7, binary sha256 `d3820543a31bfa2a556e04f91719204ce0ac6f34dcca6670314a13df87064625`; `sage.json` written by `acceptance/1.12/scorers/truth_config.py` (`899e387c2d08e02c371f7c1318994c0ecc3e0f208d7bce2eab740b0c25c66ec5`) from `compltol/heldout2/truth/compltol-H2-candidates.tsv` |
| Scorer | `acceptance/1.12/scorers/score_item02.py` `5704b8634c5a98f8993a4dccc4c331e6d84405dbf0b5dbaa42b523d68677e395`, `acclib.py` `fe387a3455a52678f78c20c3156b63c251e08daa5b92da2f3e205d1d9ab2b1c1`, `bench/fastag-bench/src/fastag_bench/score.py` `e2b8788a78f1176169f617c01b2e17f21578b8909f7c79b33d23ae1b71075f79`, `parsers.py` `01e27548bcae489d3f205960730c8bc36624e16935ea5df0bec5a6a04ea51f49` (the first test's scorer, unchanged) |
| Verdict script | `compltol/heldout2/scorers/verdict_heldout2.py` (`--selftest` on synthetic input passes); sha256 in `compltol/heldout2/SHA256SUMS` with every script and table of this test |
| Python | `/ceph/ibmi/abi/oliver/jpr-bench/envs/py/bin/python -I` on data (3.11.18, numpy 2.4.6, pandas 3.1.0) |

param_hash = sha256 of `<binary sha256>\t<options column of frozen-configs.tsv>`.

## Runs

Public PRIDE runs only. Selection (`compltol/heldout2/select/select_heldout2.py`, PRIDE API v3, seeded draw; rule
and seed in the script; `select/candidates.tsv` is its output): projects whose instrument, species, enzyme and
alkylation text fit one stratum, not in `select/excl_pxd.txt`; one .raw file per project (Astral: the two smallest
DDA files of the one project that passed). `select/excl_pxd.txt` (2,302 projects) is the union of: the reserved
lists of HELDOUT-COMMON.md, `alknodb/prereg-exclude-pxd.txt`, the species draft manifest, the DEV projects, and
every PXD named in a manifest, disjointness, result, draw, selection, registry or PREREG file of
`origin/acceptance/1.13`, every `origin/acc113r/*` branch and `origin/integration/1.13`, and in the backlog-1.13
reports. That covers the first test's 11 runs and the DEV runs (PXD003531, PXD001819).

Qualification (`compltol/heldout2/scripts/qualify.py`, no FASTag; table `compltol/heldout2/qualification.tsv`):
download complete, mzML written, at least 95 % of the MS2 filter strings from the stratum's analyser (ion_trap
ITMS, qe FTMS, astral ASTMS), Sage rc 0, at least 1,000 target rank-1 PSMs at spectrum_q <= 0.01. Selected: per
stratum the qualifying projects in draw order, at most 3 projects. A candidate that was not staged when the
qualification table was written (once, at the freeze) is not selected. The rule looks at the truth and the
instrument only, never at a FASTag output.

Manifest `manifests/compltol-H2.tsv` (sha256 in `compltol/heldout2/SHA256SUMS`), 8 runs:

| Set | PXD | Run | Draw rank | MS2 (filter) | Truth PSMs (2+, 3+, 4+) | mzML sha256 |
|---|---|---|---|---|---|---|
| astral | PXD069807 | 20250622_DDA_400ng_Tube80_ISS_WT83_Plate1_RowF_Column7 | 1 | ASTMS:263887 | 73618 (z2:39180,z3:30370,z4+:4068) | `14e19eb026ee2d03c85708e5cc61846d4aad16ef57efd1a96598430dfd325912` |
| astral | PXD069807 | 20250622_DDA_400ng_Tube27_Ground_QX_Plate2_RowE_Column9 | 1 | ASTMS:274019 | 44120 (z2:19904,z3:19629,z4+:4587) | `1c35d170ef6f546aead75f529dddc31cd9533984e0ac865c7464226dcef17fb2` |
| ion_trap | PXD041382 | 102641 | 2 | ITMS:25795 | 8902 (z2:6869,z3:1783,z4+:250) | `5fee794e8a263ec8f2b05f1df6a1d9d3796c0c9e2d22a28df89da96c98c6bd55` |
| ion_trap | PXD027039 | COM-MP2-2 | 4 | ITMS:20369 | 2470 (z2:1813,z3:581,z4+:76) | `411830cf314ccac401da019bc9141d9f6f5de62aa407c8f1d2f210614b63ac5e` |
| ion_trap | PXD058223 | CNN1_180410113835 | 5 | ITMS:35764 | 13960 (z2:8831,z3:4464,z4+:665) | `a746acd4723f4e6cb0626b406d060c24aca6d780fa73cb297c8f3702e14f5dce` |
| qe | PXD075617 | OMG5379A7LC2_G1 | 1 | FTMS:12460 | 3707 (z2:1974,z3:1553,z4+:180) | `64498419bcdb642f55fac689abecf79997f25be85f07c821c4fb0bde98d560fc` |
| qe | PXD076370 | MS221730-KS | 2 | FTMS:131944 | 7512 (z2:3547,z3:3426,z4+:539) | `6787a07a348ec5cbbeb581e36b7d9c0e05f7779058864e250e50d00189351ecf` |
| qe | PXD078122 | 20260205_HF1_MaRa_SA_P0312_Dmo2_04 | 3 | FTMS:40967 | 18917 (z2:12071,z3:6046,z4+:800) | `458dcde4313f8a5d6b1c7f6e2bea1ecf55a17894eb02e3a5d8aa7f5e43172750` |

Not selected: PXD044453 (ion_trap rank 1: MS2 analyser not ITMS); PXD037091 (ion_trap rank 3: fewer than 1000 PSMs); PXD056008 (ion_trap rank 6: fewer than 1000 PSMs); PXD060552 (ion_trap rank 7: MS2 analyser not ITMS); PXD019360 (ion_trap rank 8: qualifies, beyond the first 3 projects); PXD060832 (ion_trap rank 9: qualifies, beyond the first 3 projects); PXD052400 (ion_trap rank 10: qualifies, beyond the first 3 projects); PXD075574 (qe rank 4: qualifies, beyond the first 3 projects); PXD078303 (qe rank 5: qualifies, beyond the first 3 projects).

Disjointness: `disjointness/compltol-H2.tsv` (PXD against `select/excl_pxd.txt`, raw and mzML sha256 against every
sha256 recorded under `acceptance/` of this branch): 8/8 PASS.

No timsTOF run: the selection covers Thermo .raw only. Criterion (iii) of the first test is therefore **not
tested** here.

## Truth per run

Sage 0.14.7, closed search, per `truth/compltol-H2-candidates.tsv`: the species FASTA of the panel
`/ceph/ibmi/abi/oliver/prose-auto-20261029/panel/` (sha256 in `truth/fasta.sha256`), trypsin, C+57.021464 fixed,
M+15.994915 variable (max 2), precursor 10 ppm, fragment 20 ppm deisotoped (0.5 Da, not deisotoped, for
ion_trap). Truth = target, rank 1, spectrum_q <= 0.01. The chemistry is read from the PRIDE project text. The
`results.sage.tsv` sha256 of each run is in the manifest (`truth_sha256`) and is checked before the run.

## FASTag runs (cells), once

Per run and arm 6 cells: `-tag_length 3/4/5` (`L*_default`) and `-tag_length 3/4/5 -no_deisotope` (`L*_nodeiso`),
`-threads 16`; ion_trap runs add `-fragment_tolerance 0.5 -fragment_tolerance_unit Da` in both arms; the candidate
arm adds `-complement_tolerance_unit auto`. Command:

    frozen/FASTag -in <staged mzML> -out tags.tsv -threads 16 -tag_length <L> [-no_deisotope] [arm] [it05]

Run directories `run/runs/<CFG or CFG-it05>/compltol-H2/<run_rel>/<cell>/`, `FASTAG_RC=<rc>` appended to
`run.log`. Driver, on node data, from a git archive of the freeze commit:

    bash acceptance/1.13/compltol/heldout2/scripts/run_heldout.sh <archive>/acceptance/1.13

It checks the binary, script, mzML, truth and DEV sha256, runs the cells (4 files in parallel), then the timing,
then the scorer and the verdict script, and refuses to start when `run/score` exists.

**Technical failures.** No rerun. If the driver is interrupted (node or session loss), it may be started again;
it never runs a cell again that has written `FASTAG_RC`. A cell with `FASTAG_RC != 0` or without output stays as
it is and makes the verdict INCONCLUSIVE (rule 5). The scorer and the verdict script run once.

## Scoring (once)

    python -I acceptance/1.12/scorers/score_item02.py acceptance/1.13 compltol-H2 run/runs truth run/score \
        --timing run/timing/timing.tsv --base CFG-CT2-base --cand CFG-CT2-cand
    python -I acceptance/1.12/scorers/score_item02.py ... run/score_ii ... --sets ion_trap
    python -I acceptance/1.13/compltol/heldout2/scorers/verdict_heldout2.py run/score run/score_ii run/runs \
        acceptance/1.13/manifests/compltol-H2.tsv run/timing/timing.tsv

Correctness, denominator, cells, bootstrap as the first test (#2 scorer): rank-1 tag correct by the flank rule
against the truth peptide; denominator every truth spectrum of the run, the same in both arms; statistic cand -
base in percentage points; peptide-cluster bootstrap, 2,000 draws; set x profile x length x charge cells.

## Criteria

- **(i) Non-inferiority per cell.** Thresholds of the first test: a cell needs at least 200 clusters, point >
  -0.5, Holm bound > -1.0 (one-sided alpha 0.025); a cell with a baseline rate below 1.8 % is uninformative.
  FAIL: any cell fails. PASS: no cell fails and every charge-2 and charge-3 cell of every set passes. Otherwise
  INCONCLUSIVE. **Change from the first test:** an underpowered or uninformative 4+ cell is reported but does not
  block a PASS (a 4+ cell that fails still fails (i)). DEV reason: on both DEV runs every 4+ cell was underpowered
  (PXD003531: 169 clusters) or uninformative (PXD001819), so with single files per project the first rule cannot
  pass whatever the feature does. The first test's strict (i) is reported beside it.
- **(ii) Gain where the window was wrong.** Ion_trap set, length 3, CLI default profile, charges >= 2 pooled
  (`ii_cell` of the `--sets ion_trap` scorer run): point >= +1.0 and 2.5th bootstrap percentile > 0. **Change
  from the first test** (astral + ion_trap pooled, >= +0.3): on DEV the revised estimator keeps 0.02 Da on the
  high-resolution run (measured 0.0139 Da, tags identical to base in all 18 cells), so a gain can only come from
  low-resolution MS2; a pool with Astral would measure the PSM mix. +1.0 is less than half of the smallest DEV
  gain in a powered ion-trap cell (+2.3 to +7.6 on PXD001819). The pooled astral + ion_trap value is reported
  only.
- **(iii) timsTOF 4+.** NOT TESTED (no timsTOF run).
- **(iv) Time.** DEV run PXD003531 (sha256 `2b1da22229a9d8e8d4cde05d889c3a74dedd68bb9f00f3bdd9d78d2a8d9ace4a`), 1
  thread, 7 interleaved repeats per arm on data after the cells: median cand / median base <= 1.03 PASS (the first
  test's threshold; DEV, 3 repeats on data: base 23.56/23.10/21.95 s, cand 23.16/23.67/21.96 s, ratio 1.003). data
  is a shared node (the first test timed on an exclusive node): above 1.03 the result is INCONCLUSIVE when the
  base repeats spread (max / min) by more than 1.06 (the DEV base spread was 1.07), else FAIL. A timing run with
  rc != 0: INCONCLUSIVE.
- **(v) One window per file, never below the default.** In every candidate `run.log`, the line `Complement
  tolerance (auto): ...` reports the same measurement in the six cells of a file and a window in force >= 0.02
  Da; no base `run.log` has the line. PASS / FAIL. From DEV: the revision's two properties (one probe per file;
  0.0139 Da measured on PXD003531 -> 0.02 in force). The windows are listed in `measured_windows.tsv`.
- **Rule 5.** Any run that is not `ok` in the scorer's `runs.tsv` (FASTAG_RC != 0, missing output, no truth):
  verdict INCONCLUSIVE.
- **Verdict.** Rule 5 first. Else FAIL if any of (i), (ii), (iv), (v) is FAIL. Else PASS if all four PASS. Else
  INCONCLUSIVE. (iii) stays NOT TESTED in any case and is named in the result.

## Limits known at the freeze

- Astral: one project (2 files of PXD069807); the metadata rule left no second Astral DDA project with files of a usable size.
- No timsTOF; (iii) not tested.
- Truth chemistry from the PRIDE text (carbamidomethyl fixed, Met oxidation variable), one closed Sage search.
- Timing on a shared node.
- (i) and (ii) differ from the first test as stated above; both first-test versions are reported.
- The binary was checked with the build's ctest (rc 0); gate.sh against the 1.12.0 references was not run for
  this test.

## DEV (development data only)

Revised estimator, dev4 (`data:/scratch/kohlbach/b113/compltol/dev4`, registry `DEV-CT-compltol-r2`, frozen #2
scorer): PXD003531 (Q Exactive) measured 0.0139 Da, 0.02 Da in force, tags equal the base tags in all 18 cells;
PXD001819 (ion trap, 0.5 Da) 0.224 Da, +2.3 to +7.6 points in every powered 2+ and 3+ cell; 4+ cells underpowered
or uninformative.
