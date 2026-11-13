# PREREG-compltol-heldout3: third held-out test of `-complement_tolerance_unit auto`

Backlog item 15. Status: **FROZEN (freeze 1)** on 2026-11-13. When this file is committed and pushed, no spectrum file
of this test has been downloaded: only PRIDE project and file metadata were read (the draw below). Freeze 2 (after
staging and the truth audit) adds the runs section and the manifest and is pushed before the candidate touches any
held-out file. The candidate is run once and scored once. Nothing is tuned on held-out data, nothing is rerun or
re-scored, and no criterion may be changed after this commit. FAIL, INCONCLUSIVE and INSUFFICIENT DATA are valid
results.

Earlier tests: held-out 1 (`PREREG-compltol.md`) FAIL on Astral with the first estimator; held-out 2
(`PREREG-compltol-heldout2.md`, revised estimator) INCONCLUSIVE: no criterion failed, but four ion-trap 3+ cells
had baselines below the 1.8 % informativeness floor; no timsTOF run; the five high-resolution files all kept 0.02 Da,
so a window widened above 0.02 Da was never tested. This test addresses those three gaps.

## Design decisions (fixed now, before any data)

| | Decision | Reason |
|---|---|---|
| a | Candidate = released FASTag 1.13.4 (tag `v1.13.4`, main `0ddff9b7`) | The feature (`src/ComplementTol.h`, the probe in phase 5) is unchanged since held-out 2 |
| b | Keep the 1.8 % floor (acclib `INFO_FLOOR_PCT`); ion-trap runs need >= 1,000 target charge-3 PSMs at q <= 0.01 | See "DEV basis for the charge-3 minimum" |
| c | timsTOF set: 3 runs from 3 projects; non-inferiority only; whether auto widens is reported | Untested so far |
| d | Widening arm: selected by proxy (older Orbitrap models, MS2 in the Orbitrap: set `ft_old`); outcome NOT TESTED if no high-resolution file widens. No extra draw after seeing data, no dry-run screen | Held-out 2: no high-resolution window above 0.02 Da |
| e | Thresholds carried over: non-inferiority point > -0.5 and Holm bound > -1.0; ion-trap gain at L3 point >= +1.0 with p2.5 > 0; run time ratio <= 1.03 on DEV PXD003531 | Held-out 2, unchanged |

### DEV basis for the charge-3 minimum (b)

Development data only: DEV PXD001819 (dev4) and the spent held-out 2 ion-trap runs, base/cand arms already
computed (`data:/scratch/kohlbach/acc114/compltol3/dev3plus.py`, acclib functions, run on 2026-11-13):

| Run | charge-3 PSMs | charge-3 clusters | base rate z3 L3/L4/L5 default |
|---|---|---|---|
| PXD001819 UPS1 (DEV) | 4,051 | 1,088 | 6.94 / 5.26 / 4.15 % |
| PXD041382 102641 | 1,783 | 1,378 | 2.64 / 1.79 / 1.23 % |
| PXD027039 COM-MP2-2 | 581 | 448 | 1.38 / 0.34 / 1.03 % |
| PXD058223 CNN1 | 4,464 | 3,288 | 1.95 / 1.10 / 0.78 % |

Charge-3 clusters per charge-3 PSM range from 0.27 to 0.77. With >= 1,000 charge-3 PSMs every ion-trap run alone gives
>= 270 charge-3 clusters at the lowest DEV ratio, so the pooled 3+ cells reach the 200-cluster power floor even if only
one run carried them; the smallest DEV run (581) would be excluded. **Stated limit:** on DEV the charge-3 baseline rate
does not follow the charge-3 PSM count (CNN1 has the most charge-3 PSMs and the lowest rates). The minimum secures
power, not informativeness; the ion-trap 3+ cells at L4/L5 can again fall below 1.8 % and make (i) INCONCLUSIVE.
No other selection rule was tried on held-out data.

## Frozen software

| What | Value |
|---|---|
| Candidate | FASTag 1.13.4, tag `v1.13.4` = `0ddff9b72ad5f92d82ab3f52f8329fc61d084d9c` (git archive) |
| Binary | built on IBMI node data (OpenMS 70cebcd144, env fastag-omsdev, Ninja Release, tests ON): `data:/scratch/kohlbach/acc114/compltol3/frozen/FASTag.bin` sha256 `38fc772954ea1df02a22f219dd9308cb7c2d1752effab4509635aff1d09edf72`; started through the wrapper `frozen/FASTag` sha256 `b84c190a1348e2f4c8435671fc27c94e0af89691d8ca7bebeef7efcca5fdb43b` (held-out 2's wrapper); ctest of the build: 87/87 passed (rc 0); build script `data:/scratch/kohlbach/acc114/compltol3/build.sh` |
| CFG-CT3-base | defaults (`-complement_tolerance_unit Da`, 0.02 Da), param_hash `84f21a448ae0b94b32a041a1c1719fd2febd22d1059e6c35434d6ab3836adde3` |
| CFG-CT3-cand | `-complement_tolerance_unit auto` (other options default), param_hash `a67142e5dcded705bd63487c13e280803b85b8555a398a505fb3f6a6990824b6` |
| CFG-CT3-base-it05 | CFG-CT3-base + `-fragment_tolerance 0.5 -fragment_tolerance_unit Da` (ion_trap runs), `97084bd52fefd35b84bf624ecac392a0a2dc3e8c51bbf1ef73d1c53d550df0d6` |
| CFG-CT3-cand-it05 | CFG-CT3-cand + the same, `4a8244807e2efb1d36db12256d73235e1adcec3cd0aa3147937ebeacb70884f4` |
| Truth engine | Sage v0.14.7, sha256 `d3820543a31bfa2a556e04f91719204ce0ac6f34dcca6670314a13df87064625`; `sage.json` by `acceptance/1.12/scorers/truth_config.py` (`899e387c2d08e02c371f7c1318994c0ecc3e0f208d7bce2eab740b0c25c66ec5`) from the row of `compltol/heldout3/truth/H3-*.tsv` |
| Conversion | ThermoRawFileParser (prose-auto env) `-f 2`; timsTOF: diaweaver-7ed1169 FileConverter sha256 `beaae92b8f07c501a47c4037239c75ee153752850fe18cf68508ad47511578b6`, `acceptance/1.12/scripts/fix_zip_paths.py` (`653a1750...0005`), Sage input `acceptance/1.12/scorers/drop_noprecursor_ms2.py` (`1cfc6b664c8e9c45fc4f6494d910a455444682ef04decdef35d5aa4a1f77efc5`, 1.12 #2 amendment 2) |
| Scorer | `acceptance/1.12/scorers/score_item02.py` `5704b8634c5a98f8993a4dccc4c331e6d84405dbf0b5dbaa42b523d68677e395`, `acclib.py` `fe387a3455a52678f78c20c3156b63c251e08daa5b92da2f3e205d1d9ab2b1c1`, `bench/fastag-bench/src/fastag_bench/score.py` `e2b8788a...9f75`, `parsers.py` `01e27548...f49` (held-out 1 and 2's scorer, unchanged) |
| Verdict script | `compltol/heldout3/scorers/verdict_heldout3.py` (`--selftest` passes on synthetic input); sha256 of it and of every script and table of this test in `compltol/heldout3/SHA256SUMS` |
| Python | `/ceph/ibmi/abi/oliver/jpr-bench/envs/py/bin/python` on data, started with `-E -s` for the scorer and the verdict (held-out 2 deviation 1: with `-I` the scorer cannot import `acclib`); `python -I` for every script that reads a downloaded archive |

param_hash = sha256 of `<binary sha256>\t<options column of frozen-configs.tsv>`.

## Selection (fixed now; the draw is already done and committed)

`compltol/heldout3/select/select_heldout3.py` (rule in its docstring), PRIDE API v3, searched 2026-11-13
(`search.json` sha256 `d9444a8f4c3b032dfd85ebec6ed5e289ccecab33be2e47d1d36852edfd8503d7`, kept on data). Two
draws: `ltq` (LTQ Orbitrap XL/Velos/Elite, Orbitrap Elite; 16 projects) and `timstof` (timsTOF family, DDA/PASEF named;
8 projects); ascending sha256('compltol-H3:' + accession); one PRIDE RAW-category file per project. Metadata rule:
one organism with a panel FASTA, trypsin and iodo/chloroacetamide named, no label/enrichment/DIA/other-protease stop
word. Output, committed now: `select/candidates.tsv` (24 candidates), `select/candidates.tsv.log`, the truth tables
`truth/H3-ltq-itms.tsv`, `truth/H3-ltq-ftms.tsv`, `truth/H3-timstof.tsv`. No project outside `candidates.tsv`
is ever staged for this test; nothing is drawn later.

Exclusion: `select/excl_pxd.txt`, 24,363 accessions, built by `select/build_excl.sh` = every PXD named in any file of
any origin branch (159 refs, after `git fetch`) except the PRIDE candidate catalog `h2r_pride_candidates.tsv` (a
pool, not a use: HELDOUT-COMMON.md names it as the pool for new draws), every PXD in any file under the FASTag
output folder, and held-out 2's list (2,302: reserved lists, DEV PXD003531 / PXD001819, all earlier tests).
Over-exclusion is accepted. Metadata pass after exclusion: ltq 33 projects, timstof 16.

## Staging (download and conversion only; no FASTag)

`compltol/heldout3/scripts/stage_all.sh <heldout3 dir of a git archive of the freeze-1 commit>` on node data, work dir
`/scratch/kohlbach/acc114/compltol3` (bulk on /scratch; nothing on /ceph/ibmi/abi). Per candidate `stage.sh`:

- **Download, bounded:** https from the PRIDE mirror, 4 downloads at a time; single connection resumed, at most 20
  attempts; then the rest by 4 parallel range requests (200 MB parts, at most 40 attempts each). Accepted when the size
  equals PRIDE's and, where PRIDE gives a SHA-1, it matches; otherwise the candidate does not qualify
  (`download`). **Backup rule:** none beyond this; a failed candidate is replaced only by the next qualifying
  candidate of the same set in `candidates.tsv` draw order. No second file of a project is tried.
- **Conversion:** `.raw` with ThermoRawFileParser `-f 2`; timsTOF `.zip` unpacked with `python -I -m zipfile`, the
  first `.d` directory in name order, FileConverter `-threads 6`; the Sage input is the `.noprec.mzML` copy without
  the MS2 that carry no precursor m/z (FASTag reads the full mzML; native IDs equal).
- **Truth:** Sage 0.14.7 closed search with the panel FASTA of the species, trypsin, C+57.021464 fixed, M+15.994915
  variable (max 2). ltq files: by the MS2 filter strings, >= 95 % ITMS -> table H3-ltq-itms (precursor 10 ppm, fragment
  0.5 Da, not deisotoped), >= 95 % FTMS -> H3-ltq-ftms (10 ppm, 20 ppm, deisotoped), else no truth. timsTOF: precursor
  20 ppm, fragment 20 ppm, deisotoped (1.12 #2). Truth = target, rank 1, spectrum_q <= 0.01.

## Qualification and selection (`scripts/qualify.py`, written now)

Set of a file: `timstof` (timsTOF draw); `ion_trap` (ltq, >= 95 % ITMS); `ft_old` (ltq, >= 95 % FTMS: the widening
proxy). A file qualifies when the download was accepted, the mzML exists, Sage rc 0, >= 1,000 target rank-1 PSMs at
q <= 0.01; `ion_trap` also >= 1,000 of them at charge 3; `timstof` also <= 10 % of its MS2 without a precursor m/z;
and its truth audit is `ok`. Per set the first 3 qualifying projects in draw order are selected.

**Minimums:** ion_trap 3 and timstof 3 selected projects. If either is short, the test stops before FASTag with
**INSUFFICIENT DATA** (qualify.py exit 3); criteria are not lowered. `ft_old` has no minimum (0 to 3 runs).

**Truth audit** (after staging, before freeze 2; never reads a FASTag output): per staged candidate, from the PRIDE
project record (title, description, sample and data protocols, PTMs, instrument) and the title/abstract of the
linked publication where PRIDE names one, recorded in `compltol/heldout3/audit.tsv` (pxd, audit ok / no, reason,
source). `no` only for: (1) a label or enrichment applies to the drawn file; (2) the enzyme is not trypsin alone;
(3) cysteines not carbamidomethylated (no IAA/CAA alkylation); (4) the drawn file is DIA (diaPASEF, SWATH-like);
(5) the drawn file's species differs from the truth FASTA; (6) the project is a candidate or manifest row of another
held-out test whose freeze commit on origin precedes this test's freeze-1 commit.

Freeze 2 = `freeze2.py`: `manifests/compltol-H3.tsv`, `compltol/heldout3/qualification.tsv`, `audit.tsv`,
`disjointness/compltol-H3.tsv` (PXD against `excl_pxd.txt`; raw and mzML sha256 against every sha256 under
`acceptance/` on every other origin branch), the runs section below, `SHA256SUMS`; committed and pushed before
`run_heldout.sh` starts.

## Runs (filled at freeze 2)

| Set | PXD | Run | Draw rank | MS2 (filter) | Truth PSMs (2+, 3+, 4+) | mzML sha256 |
|---|---|---|---|---|---|---|
| ion_trap | PXD042441 | Lum_22aug0911 | 3 | ITMS:99380 | 3846 (z2:2469,z3:1256,z4+:121) | `f446c9a97086fcdfd78c416101790ae3dd0c00ac6362a03f3c823250620a5e06` |
| ion_trap | PXD029710 | 3D_fraction | 4 | ITMS:22945 | 4549 (z2:1970,z3:1912,z4+:667) | `fba1a79e6aaa8cb91ee0c42dc5ecd03f73b5067af6d2b7573130b5579cefae72` |
| ion_trap | PXD016535 | OVMMA161017_218 | 5 | ITMS:47124 | 22164 (z2:14070,z3:6896,z4+:1198) | `4ddd3ea0614b6941192c0f5bc53f132859ab46d30eb8e8cf69f8311f2737fa4f` |
| ft_old | PXD041682 | 20210116_GrantC_CunninghamJ_3A4 | 11 | FTMS:23615 | 10065 (z2:6437,z3:3375,z4+:253) | `b1f699e3ecbd6d80c905d1fee46b41e137afedf3ec70f2186a875ff0e597ae9e` |
| timstof | PXD066317 | YE012LQB1_HFDVAT_2_Slot2-29_1_364 | 1 | tof | 49326 (z1:276,z2:39858,z3:8615,z4+:577) | `b7987c5447a5eebba31ada22e0300df65c6a29a024e6f398e5b77a7e0774df11` |
| timstof | PXD049281 | 15_S1-C6_1_7066 | 3 | tof | 19271 (z1:2,z2:12170,z3:5948,z4+:1151) | `ff70a6abad3dd550677872a01c392c402613c54bab0e0cb37f9befcea7a915ae` |
| timstof | PXD027637 | KA510LQ_c_sp_2_Slot1-13_1_1398 | 4 | tof | 90056 (z1:306,z2:72582,z3:15788,z4+:1380) | `c9cde179a7f339544f61fa3958172c617b17424e25d1b5df57ae6c482f2c3b5d` |

Not selected: PXD028118 (ltq rank 1, set ion_trap: fewer than 1000 PSMs); PXD042748 (ltq rank 2, set ion_trap: truth audit: (1) enrichment: clickable excB probe, CuAAC with biotin-azide, target pull-down (chemoproteomics)); PXD025434 (ltq rank 6, set ft_old: fewer than 1000 PSMs); PXD025463 (ltq rank 7, set ft_old: fewer than 1000 PSMs); PXD041856 (ltq rank 8, set ion_trap: fewer than 1000 PSMs); PXD015742 (ltq rank 9, set ion_trap: qualifies, beyond the first 3 projects of its set); PXD026091 (ltq rank 10, set ion_trap: fewer than 1000 PSMs); PXD019727 (ltq rank 12, set ion_trap: fewer than 1000 PSMs); PXD030951 (ltq rank 13, set ion_trap: qualifies, beyond the first 3 projects of its set); PXD010851 (ltq rank 14, set ion_trap: qualifies, beyond the first 3 projects of its set); PXD027136 (ltq rank 15, set ion_trap: qualifies, beyond the first 3 projects of its set); PXD026908 (ltq rank 16, set ion_trap: truth audit: (2) enzyme: Lys-C plus trypsin); PXD066100 (timstof rank 2, set timstof: no mzML); PXD037316 (timstof rank 5, set timstof: qualifies, beyond the first 3 projects of its set); PXD076286 (timstof rank 6, set timstof: fewer than 1000 PSMs); PXD034369 (timstof rank 7, set timstof: truth audit: (5) species of the drawn file not established: feline and human plasma EVs compared, PRIDE lists human only); PXD068839 (timstof rank 8, set timstof: qualifies, beyond the first 3 projects of its set).

Selected per set: ion_trap 3, ft_old 1, timstof 3. Disjointness (`disjointness/compltol-H3.tsv`): 7/7 PASS.

## FASTag runs (cells), once

Per run and arm 6 cells: `-tag_length 3/4/5` (`L*_default`) and the same with `-no_deisotope` (`L*_nodeiso`),
`-threads 6`, 2 files in parallel (12 threads; node data is shared by four tests). ion_trap runs add
`-fragment_tolerance 0.5 -fragment_tolerance_unit Da` in both arms; the candidate arm adds
`-complement_tolerance_unit auto`. Command: `frozen/FASTag -in <staged mzML> -out tags.tsv -threads 6 -tag_length <L>
[-no_deisotope] [arm] [it05]`. Run directories `run/runs/<CFG or CFG-it05>/compltol-H3/<run_rel>/<cell>/`,
`FASTAG_RC=<rc>` appended to `run.log`. Driver, on data, from a git archive of the freeze-2 commit:

    bash acceptance/1.13/compltol/heldout3/scripts/run_heldout.sh <archive>/acceptance/1.13

It checks the binary, scripts (SHA256SUMS), mzML, truth and DEV sha256; runs the cells; writes the widened subset;
runs the timing; then the scorer runs and the verdict; it refuses to start when `run/score` exists.
**Technical failures:** no rerun. If the driver is interrupted (node or session loss) it may be started again; it never
reruns a cell that has written `FASTAG_RC`. A cell with `FASTAG_RC != 0` or without output stays and makes the verdict
INCONCLUSIVE (rule 5). The scorer runs and the verdict run once.

## Scoring (once)

    python -E -s acceptance/1.12/scorers/score_item02.py acceptance/1.13 compltol-H3 run/runs truth run/score \
        --timing run/timing/timing.tsv --base CFG-CT3-base --cand CFG-CT3-cand
    ... the same into run/score_ii with --sets ion_trap
    ... compltol-H3W into run/score_vi (only when the widened manifest has a row)
    python -E -s acceptance/1.13/compltol/heldout3/scorers/verdict_heldout3.py verdict run/score run/score_ii \
        run/score_vi run/runs acceptance/1.13/manifests/compltol-H3.tsv run/timing/timing.tsv

Correctness, denominator, cells and bootstrap as held-out 1 and 2 (#2 scorer): rank-1 tag correct by the flank rule
against the truth peptide; denominator every truth spectrum of the run, the same in both arms; cand - base in
percentage points; peptide-cluster bootstrap, 2,000 draws; set x profile x length x charge cells; Holm over the
powered informative cells; a cell needs >= 200 clusters; a cell with a baseline below 1.8 % is uninformative.

**Widened subset (compltol-H3W):** after the cells, `verdict_heldout3.py widened` keeps the rows of the sets `ft_old`
and `timstof` whose candidate `run.log` reports one window in all six cells and a window in force > 0.02 Da, and
links `runs/CFG-CT3-{base,cand}/compltol-H3W` and `truth/compltol-H3W` to the compltol-H3 directories, so the
frozen scorer scores exactly those files under their own Holm family. Ion-trap files never enter it.

## Criteria

- **(i) Non-inferiority per cell, all sets** (ion_trap, ft_old, timstof): point > -0.5 and Holm bound > -1.0. FAIL:
  any cell fails. PASS: no cell fails and every charge-2 and charge-3 cell of every set passes. Otherwise
  INCONCLUSIVE. An underpowered or uninformative 4+ cell is reported and does not block (held-out 2 rule).
- **(ii) Ion-trap gain.** ion_trap set, L3_default, charges >= 2 pooled (`ii_cell` of the `--sets ion_trap` scorer
  run): point >= +1.0 and 2.5th bootstrap percentile > 0, else FAIL.
- **(iii) timsTOF non-inferiority.** The timstof cells of (i) under the rule of (i) (FAIL / PASS / INCONCLUSIVE).
  Reported with it: the window measured and in force per timsTOF file (does auto widen?), and the first test's 4+
  check (`iii_cells` of the scorer), reported only.
- **(iv) Time.** DEV PXD003531 (sha256 `2b1da22229a9d8e8d4cde05d889c3a74dedd68bb9f00f3bdd9d78d2a8d9ace4a`), 1 thread,
  7 interleaved repeats per arm on data after the cells: median cand / median base <= 1.03 PASS. data is shared:
  above 1.03 INCONCLUSIVE when the base repeats spread (max / min) by more than 1.06, else FAIL; rc != 0 INCONCLUSIVE.
- **(v) One window per file, never below the default.** Every candidate `run.log` reports the same `Complement
  tolerance (auto)` measurement in the six cells of a file and a window in force >= 0.02 Da; no base `run.log` has the
  line. PASS / FAIL. Windows in `measured_windows.tsv`.
- **(vi) Widening arm.** No widened file: **NOT TESTED** (this outcome is prespecified; no further file is drawn).
  Else the cells of the compltol-H3W scorer run under the rule of (i). The per-cell gains there are reported only.
- **Rule 5.** Any run not `ok` in the scorer's `runs.tsv` (compltol-H3, and compltol-H3W when scored): INCONCLUSIVE.
- **Verdict.** Rule 5 first. Else FAIL if any of (i)-(vi) is FAIL. Else PASS if (i)-(v) PASS and (vi) is PASS or NOT
  TESTED. Else INCONCLUSIVE. Before any FASTag run: INSUFFICIENT DATA as stated above.

## Limits known at freeze 1

- (i) can again be INCONCLUSIVE from ion-trap 3+ cells at L4/L5 below the 1.8 % floor (see DEV basis).
- The widening proxy may produce no widened file; then (vi) is NOT TESTED by design.
- Truth chemistry from PRIDE text and the audit; one closed Sage search; timsTOF truth on the derived mzML.
- Timing on a shared node. gate.sh against the 1.12.0 references is not run; ctest only.
- Two timsTOF candidates (PXD066317, PXD066100) carry the same sample-name prefix (YE012...); they are distinct
  PRIDE projects and count as different projects.
