# PREREG: label discovery, held-out test 4 (TMTpro call, pair rule, report format 5 of PR #66)

Status: FROZEN. Date: 2026-11-11. Written before any FASTag binary of the candidates read a file of this test.
Freeze 1 = the commit that adds this file. Freeze 2 = the commit that adds `labeldisc4/manifests/audited.tsv` (truth
audit, see below). Both are pushed before the first FASTag run on a selected file.

## What is tested

The call of `-label_discovery_out` (experimental in FASTag 1.13.1, held-out FAIL in tests 1 and 3), in two arms:

| arm | branch | commit | binary sha256 (`FASTag.bin`, node `data`) |
|---|---|---|---|
| 1: main rule with A (TMTpro from the TMTpro-only reporters) and B (precursor-pair rule: dimethyl, label-free on ion-trap MS2) | `post1131/labeldisc` | dd4f197 | e999342af40c1dfa66b314f838d0245a8b718a0346afc9dd3f4c911769ecb262 |
| 2: arm 1 plus the change of PR #66 (runs whose reporter region is not recorded also reach the absence rule) | `post1131/labeldisc-format5` | d6a53fd | 9179c6d34c60abf13a5ea2e0e1f140899f3af4de2e0432830bd4039f9324bf55 |
| reference, not judged: FASTag 1.13.1 | `main` | d16328b | c49bb6594feb6891821745b358d632b8d5d80469d82db8d8cfd072c356fb8926 |

Builds: `/scratch/kohlbach/post1131/labeldisc/opt-{b2,f2,m0}/` on `data`. The rules of arm 1 and arm 2 were fitted on the
development sets only (test 1, test 3 and no-call test sets, DEV); none of the projects below was read by any FASTag build.

## Data

Public PRIDE projects only, Thermo Orbitrap `.raw`, one run per project.

Pool: the PRIDE project table of test 3 and of the no-call test (`manifests/pool.tsv`, 14,247 projects), plus a keyword
search of the PRIDE project search for dimethyl projects without the quantification-method filter
(`scripts/fetch_dimethyl_pool.py`; 1,563 projects, 957 not in the first table). Reason for the addition: the first table
holds too few new dimethyl projects for criterion R (dimethyl) to be decidable.

Disjointness: `manifests/excluded_pxd.txt` (14,784 PXDs) = every PXD named in the FASTag work, output and backlog
folders, in the scratch folders of all tracks on `data`, in the reserved lists of HELDOUT-COMMON.md and in the
manifests and results of label-discovery tests 1, 3 and the no-call test. Files that list more than 2,000 PXDs were
treated as catalogues of PRIDE (pool tables) and skipped; the selected and audited manifests of the earlier tests are
not catalogues and are included. Check at freeze: selected projects in the exclusion list 0 of 160; selected projects in
`selected.tsv`, `audited.tsv`, `stage*.tsv`, `per_run.tsv` of test 3 and of the no-call test 0; in the audited set of
test 1 0.

Selection: `scripts/select_heldout4.py` (all rules are in the script; it is the selection script of the no-call test with
a new seed `fastag-1.13.1:labeldisc4:`, new targets and the second pool). Truth class from the PRIDE quantification field
and the free text; projects with an SDRF that disagrees are dropped; labels outside the vocabulary, DIA, targeted,
cross-linking and top-down projects are dropped. One `.raw` of 30 MB to 2 GiB per project, drawn by the seed; ranks 1
and 2 are backups. Instrument cells from the PRIDE instrument field: HYB (LTQ Orbitrap, Velos, Elite, XL), TRI (Fusion,
Lumos, Eclipse, Ascend), QE (Q Exactive, Exploris).

| class | HYB | TRI | QE | projects |
|---|---|---|---|---|
| label-free | 24 | 10 | 10 | 44 |
| SILAC | 12 | 5 | 5 | 22 |
| dimethyl | 14 | 7 | 7 | 28 |
| TMT | 6 | 8 | 6 | 20 |
| TMTpro | 2 | 14 | 8 | 24 |
| iTRAQ4 | 8 | - | 2 | 10 |
| iTRAQ8 | 6 | 2 | 4 | 12 |
| all | | | | 160 |

All 20 cells were filled (`manifests/sel.log`, `manifests/selection_log.tsv`). The numbers are larger than the minimum
numbers below because the audit removes runs; HYB is over-drawn for label-free and dimethyl (ion-trap MS2) and TRI for
TMTpro (SPS-MS3).

Text check before this freeze (the task: truth against PRIDE record and paper text; test 1 had 15 wrong truths):
`scripts/papercheck.py` printed, per selected project, the label sentences of the PRIDE record and of the paper (Europe
PMC full text 74, abstract only 54, no paper found 32). Read: every line for the 28 dimethyl projects (their truth rests
on text only); for the other classes the lines that name another label than the truth class. No project contradicts its
truth class; `manifests/manual_exclusions.tsv` is empty; `manifests/textcheck.tsv` lists the source per project. The paper
excerpts are not committed. A truth class is never changed.

## Truth audit (after staging, before any FASTag run) = freeze 2

Unchanged from test 3 (`scripts/audit_scan.py`, `scripts/audit_heldout4.py`): reporter scan of every second MS2/MS3
spectrum; T, P, I, I8 as defined in PREREG-labeldisc3.md. A run is scored only if

| truth | required |
|---|---|
| TMT | T >= 0.3 and P < 0.05 |
| TMTpro | T >= 0.3 and P >= 0.3 |
| iTRAQ4 | I >= 0.3 and I8 < 0.05 |
| iTRAQ8 | I8 >= 0.3 |
| label-free, SILAC, dimethyl | T < 0.05 and I < 0.05 |

An isobaric run without a high-resolution MS2/MS3 group is excluded; a non-isobaric run without one (or with spectra
starting above m/z 112) is kept and flagged. Excluded too: no MS2 spectra; median MS2 isolation width above 4 Th. SILAC and
dimethyl truth is not checked against MS1 pairs. No run is replaced after the audit; the audit uses no FASTag output.
Strata (MS2 analyzer FT / ion trap / mixed; acquisition MS2 / MS3 = at least 100 MS3 spectra) are measured by the scan.

## Commands (run once)

On `data`, `H=/scratch/kohlbach/post1131/labeldisc/heldout4`, per arm `X` in m0, b2, f2:

    python3 -I scripts/run_heldout4.py manifests/audited.tsv ../opt-X/FASTag ../opt-X/FASTag.bin <sha256 of opt-X/FASTag.bin> \
        /scratch/kohlbach/fastag-labeldisc/src/data/digest runs-X 5
    # per run: FASTag -in <mzML> -out <tmp> -tag_length 4 -threads 8 -subsample_fraction 0.25 -fragment_tolerance 20.0
    #   -fragment_tolerance_unit ppm -digest_out digest.tsv -label_out label.tsv -label_discovery_out ld.tsv
    #   env FASTAG_FULL_PRECISION=1 FASTAG_DIGEST_DIR=<digest dir>
    python3 -I scripts/run_parammedic.py manifests/audited.tsv /scratch/kohlbach/fastag-labeldisc/heldout3/venv27/bin/param-medic pm 16
    python3 -I scorers/score_labeldisc3.py manifests/audited.tsv runs-X pm/pm.tsv score-X
    python3 -I scorers/verdict_labeldisc4.py score-b2 score-f2 runs-f2 verdict.md

The runner checks the binary sha256 and every input sha256 before the run.

sha256: `scorers/score_labeldisc3.py` 134e7c8785223f7ad044b167689ba6504763ab01fd477fd191b4dbfbd1edb1e6 (the scorer of
test 3, unchanged); `scorers/verdict_labeldisc4.py` 670be50570de8471b8844900d5f6953622aedd84cba08e1ecad3dcdc7bf048cc
(`--selftest` on synthetic input: ok); `scripts/run_heldout4.py` c7d98f3a71c2760198c3f41bbcc1682b062403171409d7d810f8b57c377f1958;
`scripts/audit_heldout4.py` fd8af4ce31454a944f72f81a82515ff0bac4e5be2bb2f2be17ebad84b3078d19; `scripts/audit_scan.py`
09646d4dee9d6f2b94ff81ecdcb92da0081cb0f7bcddde0ffa4bd6dfa4342603; `scripts/run_parammedic.py`
1b8ba1285adca0a44ef07663a7b62a43186a573df920e5011841a0ea7d21fe56; `manifests/selected.tsv`
1b1eb1d3a1a54c0f6208a137ce8054997ed72081e08f746e04b12cfd032932e5.

## Criteria, arm 1 (carried over from test 3 without change of threshold)

Outcome per run as in test 3: correct, no call, wrong (a call of another class, of two classes, `ambiguous:` or `unknown:`).

| id | criterion | threshold | minimum number for PASS |
|---|---|---|---|
| S1 (primary, safety) | wrong calls on audited label-free runs | 0 | >= 30 label-free runs, of which >= 10 with ion-trap MS2 |
| A1 | 0.8 x accuracy(label-free) + 0.2 x accuracy(labelled) | > 0.80 | - |
| A2 | family-correct runs, FASTag against Param-Medic 0.2 (generous reading), same runs | FASTag >= Param-Medic | Param-Medic table present |
| R | strict recall per family, no call = miss | TMT >= 0.80, TMTpro >= 0.80, iTRAQ4+iTRAQ8 >= 0.80, SILAC >= 0.60, dimethyl >= 0.50 | each family >= 10 runs; TMTpro also >= 5 runs with MS3 acquisition |
| F | labelled runs called label-free / labelled runs | <= 0.05 | >= 40 labelled runs |

Addition against test 3: the minimum numbers (test 3 had none). Reason: the task asks that every criterion be decidable;
a threshold met on too few runs is reported INCONCLUSIVE instead of PASS. The SILAC and dimethyl thresholds are kept as
carried over although arm 1 now has a dimethyl rule.

Verdict per criterion: FAIL if the threshold is missed; else INCONCLUSIVE if a minimum number is not reached; else PASS.
Arm 1 overall: FAIL if any criterion is FAIL, else INCONCLUSIVE if any is INCONCLUSIVE, else PASS.

## Criteria, arm 2 = PR #66 (the two safety criteria of the no-call test)

| id | criterion | threshold | minimum number |
|---|---|---|---|
| P-S1 | runs wrong with arm 2 and not wrong with arm 1 | 0 | - |
| P-S2 | labelled runs with `region_recorded = no` (arm-2 report) called label-free by arm 2 | 0 | >= 5 such labelled runs, else INCONCLUSIVE |
| P-E1 (reported, does not decide) | label-free runs with no call in arm 1 and `region_recorded = no` that arm 2 calls label-free | >= 40 % | >= 8 runs |
| P-I1 (reported, does not decide) | class changes arm 1 -> arm 2 on runs with `region_recorded = yes` | 0 | - |

Change against the no-call test: the baseline of P-S1 is arm 1, not main, because PR #66 would be merged on top of A and B.
P-S2 is absolute as carried over; the report also says how many of its runs arm 1 already calls label-free (rule B, not
PR #66). PR #66 verdict: PASS (merge supported) only if P-S1 and P-S2 are PASS; FAIL if either is FAIL; else INCONCLUSIVE.
Nothing is merged or closed by this test.

## Technical failures

A selected file whose download or conversion fails is replaced by its rank 1, then rank 2 backup (`scripts/stage_retry.sh`,
before the audit); a project with no staged file is dropped and not replaced. A FASTag run that fails (non-zero exit, no
report, input checksum differs) counts as no call in arm 1 and is left out of the arm-2 criteria; it is not rerun, except
when the failure is of the harness (node, disk, runner script), which is fixed, rerun once and recorded as a deviation.
No tuning, no second scoring.

## Deviations known at freeze

- Staging (download from PRIDE and conversion to mzML with ThermoRawFileParser; no FASTag, no reporter scan) was started
  before this commit, as in the no-call test. The staged files were read by no FASTag binary and by no scorer.
- The 15 wrong truths of test 1 came from PRIDE metadata; here the text check and the reporter scan both precede the runs.

## Reported without threshold

Tables of test 3 (confusion, per stratum, Clopper-Pearson bounds for S1 and F, sign test for A2), the same for the
reference binary m0 and for arm 2, the paired table arm 1 against m0 per family, and one line of cause per wrong call
(looked up after scoring; changes no score).

## Addendum: staging and truth audit (freeze 2, before any FASTag or Param-Medic run on a selected file)

Staging: 157 of 160 rank-0 files staged and converted. Deviation of the harness: `stage_retry.sh` retried the one failed
rank-0 download (PXD012809, file name with `^`) 583 times instead of moving to the backup; the backups were then staged as
the rule above says (`manifests/stage/backup_r1.list`, `backup_r2b.list`, `stage_b1.tsv`, `stage_b2.tsv`).
PXD012809: rank 0 download failed, rank 1 staged (sha1 ok). PXD059735 (label-free) and PXD047416 (TMTpro): rank 0, 1 and
2 all failed in conversion (ThermoRawFileParser: "RAW file is likely corrupted"; for PXD059735 rank 1 also a second
download that differed); both projects are dropped and not replaced.

Truth audit (`scripts/audit_heldout4.py`, `manifests/audited.tsv`, sha256
50f1344154832888add34fc6d03e9bf1adbd46028a24bed14fd984d9b2254796): 140 of 160 projects included.

| class | included | excluded (reason) |
|---|---|---|
| label-free | 42 (25 ion-trap MS2) | 1 conversion failed, 1 no MS2 spectra |
| SILAC | 22 | - |
| dimethyl | 28 | - |
| TMT | 17 | 3 reporter scan disagrees |
| TMTpro | 20 (8 MS3) | 3 reporter scan disagrees, 1 conversion failed |
| iTRAQ4 | 6 | 3 reporter scan disagrees, 1 not assessable |
| iTRAQ8 | 9 | 2 reporter scan disagrees, 1 not assessable |

Kept and flagged (no high-resolution group or spectra above m/z 112, cannot be checked for reporters): label-free 37,
SILAC 15, dimethyl 24. All minimum numbers of the criteria are reached by the included runs (label-free 42 / 25 ion-trap,
labelled 102, each R family >= 15, TMTpro with MS3 8).

The commands of the PREREG are run by `scripts/run_all.sh` (sha256 0be8a2ee9cc2c5d0965b00a1cc107cd62492fcb30567260883d948d9103064b9;
five FASTag jobs of 8 threads, Param-Medic with 8 jobs, arms b2, f2, m0 in turn, then scoring and verdict once).
