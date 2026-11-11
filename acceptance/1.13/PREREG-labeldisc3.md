# PREREG: label discovery, held-out test 3 (fresh projects, audited truth)

Status: frozen with this commit. No FASTag run on any selected run exists at this commit.

## What is tested

The label call of `-label_discovery_out` (report format 3, section `ld_call`) of FASTag at `origin/integration/1.13`
= 514cc3e (merge of PR #62). Nothing under `src/` changes on this branch. Binary: `data:/scratch/kohlbach/fastag-labeldisc/eval2/optI/FASTag.bin`,
sha256 `e18a3c7810422342392c2b9b2a1717bc6afcddcde2394033a208e38d17133aa3`, built from d0a4e07; `git diff d0a4e07 514cc3e -- src` is empty.

Command, one run per file (the command of the first test):

    FASTag -in <mzML> -out <tmp> -tag_length 4 -threads 8 -subsample_fraction 0.25 -fragment_tolerance 20.0
           -fragment_tolerance_unit ppm -digest_out digest.tsv -label_out label.tsv -label_discovery_out ld.tsv
    env FASTAG_FULL_PRECISION=1 FASTAG_DIGEST_DIR=/scratch/kohlbach/fastag-labeldisc/src/data/digest

The test follows section (d) of `output/backlog-1.13/labeldisc/EXPLORE-mods-from-tags.md`. The rule was developed on the
DEV runs and on the spent held-out set of the first test; none of those projects is used here.

## Data

Public PRIDE projects (PXD) only; Thermo `.raw` files of at most 6 GiB, downloaded from PRIDE straight to `data` and
converted with ThermoRawFileParser 2.0.0 `-f 2`. One run per project.

**Disjointness.** A project is not eligible if its accession appears in `labeldisc3/manifests/excluded_pxd.txt`
(2251 accessions): every PXD named in any file of any branch of the repository (which contains the manifests
`split-256.tsv`, `labeldisc-heldout.tsv`, `heldout_A.tsv`, `heldout_B.tsv`, `runs256.tsv` of the first test), except the three
candidate catalogues `acceptance/1.12/inputs/h2r_pride_candidates.tsv`, `acceptance/1.13/alknodb/inputs/prescreen.tsv` and
`.../draw_order.tsv` (lists of PRIDE projects that were never run); plus every PXD in the first test's working lists on `data`
(`explore/dev.list`, `explore/heldout.list`, the audit tables) and every PXD named in `EXPLORE-mods-from-tags.md`.

**Pool.** The PRIDE v3 project search, once per quantification-method value (TMT, iTRAQ, SILAC, Dimethyl Labeling and four
label-free values), fetched on 2026-11-10 (`scripts/fetch_pride_pool.py`). `scripts/select_heldout3.py` classifies each project;
`manifests/pool.tsv` lists every project with its class or the reason it was dropped.

A project is eligible for a class only if all of the following hold.

1. Structured field: its quantification methods name exactly one family (generic "relative/absolute quantification" ignored).
2. Free text (title, description, sample and data protocols, keywords) states the same family and no other family. Label-free
   projects must say so (label-free, LFQ, iBAQ, spectral count, intensity-based) and must not mention any label or "heavy".
   Labelled projects must not mention label-free.
3. Class within the family, from the text: TMTpro if TMTpro, 16-plex or 18-plex is stated, otherwise TMT (a project stating
   both a 6/10/11-plex and TMTpro is dropped); iTRAQ4 or iTRAQ8 only if exactly one plex is stated.
4. Labels outside the vocabulary (15N, NeuCode, ICAT, mTRAQ, 18O, ICPL, AQUA, heavy methyl, AHA, DiLeu, TMTzero, iodoTMT,
   super/pulsed/spike-in SILAC, deuteration, TAILS and others; regex `R_OOV`) drop the project. They are not scored as "other".
5. Excluded by metadata: top-down, intact protein, native MS, proteoform, middle-down, cross-linking, HDX, imaging, MALDI,
   DIA/SWATH, SRM/MRM/PRM, targeted, metabolomics, lipidomics, glycans (regex `R_EXCL`, and the PRIDE experiment types).
6. Instruments: all of one class. QE = Q Exactive, Exploris, Astral; TRI = Fusion, Lumos, Eclipse, Ascend; HYB = LTQ Orbitrap
   (XL, Velos, Elite, Discovery), LTQ FT. Any other instrument (time-of-flight, pure ion trap) drops the project. This test
   therefore says nothing about time-of-flight data.

**File rule.** Within a project: `.raw`, 30 MB to 6 GiB, name not matching
`blank|wash|QC|std|standard|test|calib|library|lib|GPF|SRM|MRM|DIA|SWATH|PRM|MSX|targeted|hela|BSA|iRT|intact|topdown|XL|crosslink`,
and in labelled projects not matching `label.?free|LFQ|unlabel|nolabel|_LF_`. Exclusion is by PRIDE metadata and file name
only, never by FASTag output.

**Selection.** Cells are class x instrument class, plus one label-free cell NT for projects whose text names only a
non-tryptic digestion or endogenous peptides. Within a cell the eligible projects are sorted by accession and shuffled with
`random.Random("fastag-1.13:labeldisc3:<class>:<cell>")`; projects are taken in that order until the target is met. Within a
project the eligible files are sorted by name and shuffled with `random.Random("fastag-1.13:labeldisc3:<PXD>")`: the first is
the run, the next two are backups. A cell that cannot be filled stays short.

| class | QE | TRI | HYB | NT | target |
|---|---|---|---|---|---|
| TMT | 8 | 12 | 4 | | 24 |
| TMTpro | 10 | 12 | | | 22 |
| iTRAQ4 | 7 | 2 | 5 | | 14 |
| iTRAQ8 | 8 | 2 | 4 | | 14 |
| SILAC | 10 | 4 | 12 | | 26 |
| dimethyl | 10 | 4 | 8 | | 22 |
| label-free | 24 | 12 | 16 | 12 | 64 |

The aim is at least 15 audited runs per family (TMT, TMTpro, iTRAQ, SILAC, dimethyl); a family below 15 is reported as such.

**SDRF.** Where a project has an SDRF (among its PRIDE files, or in the bigbio collection) that lists the selected file, its
`comment[label]` must give the same class; otherwise the project is skipped at selection. Most projects have no SDRF. For
those the PRIDE quantification-method field takes the place of the SDRF label, and the free text must agree with it
independently (rules 1 to 3). This is weaker than a per-file SDRF label and is the main remaining truth risk; the reporter
scan below covers it for isobaric labels, nothing covers it for SILAC and dimethyl.

**Backup rule.** If the download or the conversion of the run fails, backup 1 is staged, then backup 2. If all fail, the
project is dropped and listed; it is not replaced.

## Truth audit (after staging, before any FASTag run)

`scripts/audit_scan.py` (the reporter scan `repscan.py` of the exploration, plus the MS2 isolation width) reads every second
MS2/MS3 spectrum. `scripts/audit_heldout3.py` computes, per high-resolution (FTMS) MS2 or MS3 group with at least 100 read
spectra, the share of spectra with reporter channels above 1 % of the base peak within 3 mDa, minus the share at decoy
m/z (+-17 mDa): T (>= 2 TMT channels 126-131), P (>= 2 channels of TMTpro only, 132-135), I (>= 2 iTRAQ4 channels 114-117),
I8 (>= 1 channel of iTRAQ8 only: 113, 118, 119, 121); each the maximum over groups. A run is scored only if:

| truth | required | otherwise |
|---|---|---|
| TMT | T >= 0.3 and P < 0.05 | excluded |
| TMTpro | T >= 0.3 and P >= 0.3 | excluded |
| iTRAQ4 | I >= 0.3 and I8 < 0.05 | excluded |
| iTRAQ8 | I8 >= 0.3 | excluded |
| label-free, SILAC, dimethyl | T < 0.05 and I < 0.05 | excluded |

An isobaric run without a high-resolution group cannot be audited and is excluded. A label-free, SILAC or dimethyl run without
such a group, or whose spectra start above m/z 112, cannot be checked for reporters; it is kept and flagged. Also excluded: a
run with no MS2 spectra, a run with a median MS2 isolation width above 4 Th (DIA). SILAC and dimethyl truth is not checked
against MS1 pairs, on purpose: such a check would remove exactly the runs on which the absence rule can fail.

Manual reading: for every selected project the label sentences of the PRIDE text are read once. A project may be excluded
for a stated reason (`manifests/manual_exclusions.tsv`); a truth class is never changed. No run is replaced after the audit.
The audit uses no FASTag output. The audited manifest is committed before FASTag runs (second freeze commit).

The audit rule was tried on the DEV scans only: it keeps 117 of 119 DEV runs with these classes and excludes one TMTpro run
without TMTpro-only channels and one iTRAQ8 run without usable high-resolution spectra.

## Scoring

`scorers/score_labeldisc3.py`, run once on all audited runs. Tested on DEV only (audited DEV manifest, runs `eval2/devI`:
96 runs, all correct, which is expected because the rule was fitted there).

Truth classes: label-free, TMT, TMTpro, iTRAQ4, iTRAQ8, SILAC, dimethyl. TMTpro and iTRAQ8 are separate classes.
Outcome per run: **correct** (the call class equals the truth), **no call** (status `no_call`, or the run failed), **wrong**
(any other call; a call with tokens of two classes, an `ambiguous:` call and an `unknown:` call are wrong). No call and wrong
are always reported separately.

Baselines: "always label-free", and Param-Medic 0.2 (May et al.; github.com/dhmay/param-medic, the version with
modification inference) on the same mzML files with default options, `scripts/run_parammedic.py`. The class is read from the
`*_present` columns of its result table: none set -> label-free; any TMT column -> TMT; iTRAQ 8-plex -> iTRAQ8, otherwise
iTRAQ 4-plex -> iTRAQ4; any SILAC column -> SILAC; two families -> mixed; no result table -> failed (counted as not correct);
the phosphorylation column is ignored. Param-Medic is Python 2 code; it runs from a conda Python 2.7 environment
(`heldout3/venv27`), not from a venv, because it does not run under Python 3. Param-Medic knows neither TMTpro nor dimethyl, so the
comparison is at family level (TMT and TMTpro one family, iTRAQ4 and iTRAQ8 one family) and a Param-Medic SILAC call on a
dimethyl run counts as correct for Param-Medic.

## Hypotheses and pass criteria

| id | criterion | pass iff |
|---|---|---|
| S1 (primary, safety) | wrong calls on audited label-free runs (a label is called on an unlabelled run) | 0 |
| A1 | prevalence-weighted accuracy 0.8 x accuracy(label-free runs) + 0.2 x accuracy(labelled runs); "always label-free" scores 0.80 | > 0.80 |
| A2 | family-correct runs, FASTag against Param-Medic, same runs | FASTag >= Param-Medic |
| R | strict recall per family, no call counted as a miss | TMT >= 0.80, TMTpro >= 0.80, iTRAQ4+iTRAQ8 >= 0.80, SILAC >= 0.60, dimethyl >= 0.50; all five |
| F | false label-free rate: labelled runs called label-free / all labelled runs | <= 0.05 |

Reported without a threshold: Clopper-Pearson bounds for S1 and F, raw accuracy against "always label-free" on the set as
drawn, the paired sign test for A2, the confusion table, the no-call reasons, F per family and per call basis (the absence
rule separately), and all outcome tables per stratum. Strata are measured from the mzML by the audit scan, not taken from
the metadata: MS2 analyzer (FT, ion trap, mixed), acquisition (MS2 or MS3: at least 100 MS3 spectra), digestion from the
PRIDE text (tryptic, other, mixed, unstated), and the selection cell.

Every wrong call gets a one-line cause in the result report. Causes are looked up after scoring and change no score.

## Order of work and freeze

1. This commit: PREREG, selection script, scorer, staging, audit and run scripts, pool table, manifest of selected runs.
2. Staging and audit on `data` under `/scratch/kohlbach/fastag-labeldisc/heldout3/`; commit of the audited manifest.
3. One FASTag run per audited run, Param-Medic on the same files, one scoring pass, commit of the results.

No tuning and no second scoring. A technical fault of the harness is fixed and recorded as a deviation; the rule is not touched.

## Recorded defaults (decisions taken without asking)

- Time-of-flight and pure ion-trap instruments are out of scope (Thermo Orbitrap `.raw` only).
- Truth without SDRF rests on the PRIDE quantification field plus free text (see SDRF above).
- Labels outside the vocabulary are excluded, not scored as "other".
- The weighting 0.8 / 0.2 in A1 stands for a repository in which four of five runs are unlabelled.
- The recall thresholds for SILAC (0.60) and dimethyl (0.50) are lower than for isobaric labels because the rule calls
  only Lys8/Arg10 pairs from precursors and has no dimethyl precursor rule; both miss many runs by design.

## Addendum: selection result and checksums

185 runs from 185 projects were selected (185 GiB of raw files); `manifests/selected.tsv` lists each run and its
two backups, `manifests/selection_log.tsv` every project that was looked at.

| class | QE | TRI | HYB | NT | selected |
|---|---|---|---|---|---|
| TMT | 8 | 12 | 4 |  | 24 |
| TMTpro | 10 | 12 |  |  | 22 |
| iTRAQ4 | 7 | 1 | 5 |  | 13 |
| iTRAQ8 | 8 | 2 | 4 |  | 14 |
| SILAC | 10 | 4 | 12 |  | 26 |
| dimethyl | 10 | 4 | 8 |  | 22 |
| label-free | 24 | 12 | 16 | 12 | 64 |

One cell is short (iTRAQ4 on a Tribrid: 1 of 2; 4 eligible projects). Projects skipped during selection: 17 without an
eligible raw file, 46 whose SDRF label disagrees with the class (most are community-annotated SDRF files on PRIDE that say
"label free sample" for a labelled project; the rule skips them all the same). Of the selected runs 37 have an SDRF that
agrees, 8 an SDRF that does not list the file, 140 no SDRF.

sha256 at the freeze:

    80f3141bab351fc5e677e9f85a682f091e332a6e873da70da97eb25bae6cca58  labeldisc3/manifests/excluded_pxd.txt
    2945671d1a40f470946e6c5f8d204f4ac0414a260d875ad25c4e0baea11c5159  labeldisc3/manifests/pool.tsv
    6bb5da88d768e83cd969cf6ebb088f40e9233bba15180b79c5f7c54e7907f831  labeldisc3/manifests/selected.tsv
    d9fc3dc1b5fe7a0363aaa1a5b7a2eb223896d9eec859371a1d611a59ad01d9b0  labeldisc3/manifests/selection_log.tsv
    46fe3d34742cac8f3c2329a657cb1123769c62dc5b32f5fd70e1465706c5af8a  labeldisc3/manifests/stage_list.tsv
    134e7c8785223f7ad044b167689ba6504763ab01fd477fd191b4dbfbd1edb1e6  labeldisc3/scorers/score_labeldisc3.py
    9a9a70aaa2e7f806d36a9c09551cf7aed87fa6190162cedbd89c1c83ac1bf8e2  labeldisc3/scripts/audit_heldout3.py
    09646d4dee9d6f2b94ff81ecdcb92da0081cb0f7bcddde0ffa4bd6dfa4342603  labeldisc3/scripts/audit_scan.py
    896c50f2ce096a9d05cd3e63f769c6fe795c5cc61b2a63de2836acdb296ed1e1  labeldisc3/scripts/fetch_pride_pool.py
    d8f68f5214ee498457d592ac33a6ba3773d3e76caf675a73af5ab11fd7decc6d  labeldisc3/scripts/run_heldout3.py
    1b8ba1285adca0a44ef07663a7b62a43186a573df920e5011841a0ea7d21fe56  labeldisc3/scripts/run_parammedic.py
    0e4b8a562043bf3a9dfd4c1d1093fd52aa2a1b6427016ef169f807997a9bc49b  labeldisc3/scripts/select_heldout3.py
    aa79fd96660499379e507c62f1bd0f9fff905e5257f61a4909bdb49b45d61f7f  labeldisc3/scripts/stage_pride_labeldisc3.sh

## Addendum 2: truth audit (freeze commit 2, before any FASTag or Param-Medic run on a selected run)

Audited manifest: `labeldisc3/manifests/audited.tsv` (185 projects, 163 with include = yes). Only include = yes rows are run and scored.

| class | selected | included | excluded, with reason |
|---|---|---|---|
| TMT | 24 | 18 | 5 reporter scan disagrees, 1 reporter scan not assessable |
| TMTpro | 22 | 18 | 4 reporter scan disagrees |
| iTRAQ4 | 13 | 8 | 2 reporter scan disagrees, 2 not assessable, 1 download failed |
| iTRAQ8 | 14 | 11 | 3 reporter scan disagrees |
| SILAC | 26 | 22 | 4 manual (3 pulsed SILAC, 1 spike-in SILAC; `manifests/manual_exclusions.tsv`) |
| dimethyl | 22 | 22 | |
| label-free | 64 | 64 | |

iTRAQ4 (8) and iTRAQ8 (11) are below the 15 runs asked for; the selection had no further eligible projects to draw on after the freeze
("No run is replaced after the audit"). Criterion R scores the two together (19 runs), as fixed above.

Staging record (`manifests/stage1.tsv`, `stage1.r2.tsv`, `stage1.r3.tsv`, `stage2.tsv`, `stage2b.tsv`, `stage3.tsv`; later tables override earlier rows):

- The first pass left 58 downloads failed (PRIDE refused connections, 403, closed transfers; other jobs were downloading from the same host).
  The same files were fetched again with the same checks (`scripts/retry_stage.sh`); 57 then passed.
- Backups used (rank 1): PXD043085 (the rank 0 raw file is empty) and PXD034116 (the rank 0 raw file is not readable, two identical downloads).
- PXD027668 is excluded: all three files (rank 0, 1, 2) differ from the SHA-1 that PRIDE lists, each after four downloads.
- The reporter scans were run with `scripts/scan_all.sh`; the scan results are in `manifests/scan_json.tgz`.

Deviations so far:

1. `.gitignore` ignores `*.tsv`, so freeze commit 1 holds the manifests only as the sha256 values listed above. The files are added in this
   commit and still have those sha256 values.
2. `retry_stage.sh` and `scan_all.sh` were written after freeze commit 1 (harness only: same downloads, same checks, same scan).

sha256:

    d6ece0bad217df9ff516cd3da451dc27359b54a0befd09ff9343a5254fd69dbf  labeldisc3/manifests/audited.tsv
    b135b11696a927572767bb5e096bbcd22bb7fad381fced945fbb648f8071de1d  labeldisc3/manifests/manual_exclusions.tsv
    7dec7182de19bb94058b025fc6bd9f3286b83239aa5c1a158e25564b0f9e680d  labeldisc3/manifests/scan_json.tgz
    1cdd44f223c30809c8ed9307cce36a309fb27c447421269ce1051ed7395d4fe0  labeldisc3/manifests/stage1.tsv
    968d297e4cda85c1050b9998d26129e3b73ffe863b488d85e1b79da3e87a065e  labeldisc3/manifests/stage1.r2.tsv
    a436dc15a4e32c46f0d8588759f6ae0b803e047f8677bcecb59ae46b1bcb5040  labeldisc3/manifests/stage1.r3.tsv
    b6714bbd255a0adaaa8be48f300db7279fb98b1258272ffee19ab12dc62b850a  labeldisc3/manifests/stage2.tsv
    9bb90a8c07c86be60c906b6a617985e49050eb49adc20d6c2e8b0ab5f6340cc7  labeldisc3/manifests/stage2b.tsv
    6d913b1bf209d625811d17d20fc4836767b6d8fd9c3fef8f7b0f06dee5ad1e8b  labeldisc3/manifests/stage3.tsv
    3333d36647e3b270f376b447a1ccc83552ade3c8af6c63126cd6f8a177d995c1  labeldisc3/scripts/retry_stage.sh
    7b75484bead05c0004c80186ac1d38fab6a3c175460f902449c3cfa141e32df7  labeldisc3/scripts/scan_all.sh
