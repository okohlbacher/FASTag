# PREREG: label discovery, absence call on runs that do not record the reporter region (format 5)

Status: FROZEN with this commit, 2026-11-10. No FASTag run on any selected run exists at this commit. Staging (download,
conversion) of the selected files was started before this commit; it involves no FASTag binary.

## What is tested

The rule of PR #66 (`feat/b113-labeldisc-nocall`, commit a709e62; this branch is that commit plus `acceptance/` files, nothing
under `src/` changes): `region_recorded = no` lets the absence rule call `label-free` on a run whose MSn scans do not record
112-137 m/z. The test is paired: every audited run is run with two binaries.

| | binary on `data` | sha256 |
|---|---|---|
| candidate | `/scratch/kohlbach/b113/labeldisc-nocall/heldout/bin/cand/FASTag.bin` (Release build of a709e62; ctest 89/89, identity gate PASS) | `897a9fd0f49c3c077c42a849f09a5c39729fb8e2ff889c752ec9ddb539d3df26` |
| baseline | `.../heldout/bin/base/FASTag.bin` (the format-4 binary of the "before" columns of PR #66, `eval2/optK`) | `ec6b09f568a2c431aeef99d508317bd09830307909a07916aafcf89490008308` |

Command, one run per file and binary (`scripts/run_nocall.py`, the runner of held-out test 3 with a different scratch name):

    FASTag -in <mzML> -out <tmp> -tag_length 4 -threads 8 -subsample_fraction 0.25 -fragment_tolerance 20.0
           -fragment_tolerance_unit ppm -digest_out digest.tsv -label_out label.tsv -label_discovery_out ld.tsv
    env FASTAG_FULL_PRECISION=1 FASTAG_DIGEST_DIR=/scratch/kohlbach/fastag-labeldisc/src/data/digest

## Data

Public PRIDE projects only; Thermo `.raw` files of 30 MB to 2 GiB, downloaded to `data:/scratch/kohlbach/b113/labeldisc-nocall/heldout/in`
and converted with ThermoRawFileParser 2.0.0 `-f 2` (`scripts/stage_pride.sh`). One run per project.

**Pool and eligibility.** The pool and the eligibility rules 1 to 6, the file rule and the SDRF rule of
`PREREG-labeldisc3.md` (branch `acc113r/labeldisc3`, commit a966586), unchanged: the PRIDE project search fetched on 2026-11-10
(`pool.json`, sha256 `5af16e41bf13b54cafd6b4e98530ce4a35c9f8e4aaa6ba68bd643d76e1aff86b`), classified by the same code
(`scripts/select_nocall.py` is `select_heldout3.py` with the seed, the targets and the size cap changed). This excludes
DIA/SRM/PRM, top-down, cross-linking, heavy-methyl SILAC and the other labels outside the vocabulary by project text, and
blanks, standards and QC runs by file name.

**Disjointness.** `manifests/excluded_pxd.txt` (14,555 accessions) is not eligible: the exclusion list of held-out test 3
(2,251: every PXD in any branch of the repository, both development sets of this rule included); every project selected or
looked at by held-out test 3; every PXD named in any file under `output/backlog-1.13/` (the reserved lists of the shifts,
census and species arms, `alknodb/prereg-exclude-pxd.txt`, all drafts and results); every PXD named in any `acceptance/`
file of any worktree, the candidate catalogues `pool.tsv`, `h2r_pride_candidates.tsv`, `prescreen.tsv` and `draw_order.tsv`
excepted; and the audited manifests of both development sets of this rule on `data`.

**Selection.** Cells are class x instrument class (HYB = LTQ Orbitrap family and LTQ FT, where ion-trap MS2 is common;
TRI = Tribrid). Within a cell the eligible projects are sorted by accession and shuffled with
`random.Random("fastag-1.13:labeldisc-nocall:<class>:<cell>")`; within a project the eligible files are shuffled with
`random.Random("fastag-1.13:labeldisc-nocall:<PXD>")`, the first is the run, the next two are backups.

| class | HYB | TRI | selected |
|---|---|---|---|
| label-free | 24 | 10 | 34 |
| SILAC | 12 | 3 | 15 |
| dimethyl | 4 | 3 (target 4; cell short) | 7 |
| TMT | 6 | 6 | 12 |
| TMTpro | | 3 | 3 |
| iTRAQ4 | 4 | | 4 |
| iTRAQ8 | 4 | | 4 |

79 runs from 79 projects, 60 GiB. Q Exactive-type instruments are not drawn: they have no ion-trap MS2, and the rule can
only act on them through a first mass above the region.

**Backup rule.** If the download or the conversion of the run fails, backup 1 is staged, then backup 2; if all fail the
project is dropped and listed, not replaced.

## Truth

- Before this freeze the label sentences of the PRIDE text of every selected project were read once (`scripts/textcheck.py`).
  Four projects are excluded for a stated reason (`manifests/manual_exclusions.tsv`); no truth class was changed.
- After staging and before any FASTag run: the reporter-scan audit of held-out test 3, unchanged (`scripts/audit_scan.py`,
  `scripts/audit_nocall.py`): isobaric truth needs reporter ions in a high-resolution group (TMT: T >= 0.3 and P < 0.05;
  TMTpro: T >= 0.3 and P >= 0.3; iTRAQ4: I >= 0.3 and I8 < 0.05; iTRAQ8: I8 >= 0.3), otherwise the run is excluded; a
  label-free, SILAC or dimethyl run with reporter ions (T or I >= 0.05) is excluded; runs without MS2 spectra or with a
  median isolation width above 4 Th are excluded. An isobaric run without a high-resolution group cannot be audited and is
  excluded: the test therefore cannot see the known weak point of the rule, an isobaric sample measured with ion-trap CID only.
- The audit uses no FASTag output. The audited manifest is committed and pushed before FASTag runs (second freeze commit).

## Scoring

`scorers/feat.py` (the table script of the development measurements; classes label-free, TMT, TMTpro/iTRAQ8, iTRAQ4, SILAC,
dimethyl; outcome right / no call / wrong) once per binary, then `scorers/score_nocall.py` once. A run whose FASTag exit
code is not 0 with either binary is left out of all criteria and listed.

| id | criterion | PASS | FAIL | INCONCLUSIVE |
|---|---|---|---|---|
| S1 (primary, safety) | runs wrong with the candidate and not wrong with the baseline | 0 | >= 1 | |
| S2 (safety of the new path) | labelled runs with `region_recorded = no` that the candidate calls label-free | 0, and >= 5 such labelled runs | >= 1 | 0, and < 5 such labelled runs |
| E1 (benefit) | label-free runs without a baseline call that the candidate calls label-free | >= 40 % of them, and >= 8 such runs | < 40 %, and >= 8 such runs | < 8 such runs |
| I1 (no side effect) | runs with a baseline call whose call class changes | 0 | >= 1 | |

Overall: FAIL if any criterion fails; otherwise INCONCLUSIVE if any is inconclusive; otherwise PASS.
`score_nocall.py --selftest` runs the verdict rule on synthetic input (passes at this commit).

Run once, score once. No tuning, no rerun with changed settings, no second scoring. A technical fault of the harness is
fixed and recorded as a deviation; the rule is not touched.

## Checksums at the freeze

    78eaadea890fef0c75b360d0637f2442f7cb639efe3791f369e14952b11497ff  labeldisc-nocall/manifests/excluded_pxd.txt
    2e3fd51b0788fe76b0be856508ad2b567799dcba2132595c061b8c8adb5180f0  labeldisc-nocall/manifests/manual_exclusions.tsv
    df6bf8e7eb67c3aa97544c08c103a22b4f51e9d840f4a394333f4146bfca9f10  labeldisc-nocall/manifests/pool.tsv
    61e7c40da4372899c852c1ccd846bbc0f48cdb7d340c345f5c60cb81d5ac4d54  labeldisc-nocall/manifests/selected.tsv
    55818c166cdeb57756335e2eed9d88f9841afa940c278b35206bce011645ad61  labeldisc-nocall/manifests/selection_log.tsv
    fc5e4ea75c5564aa37b6720c7a9f9e48b777e90fb34b1ac034ef3e1ef430f521  labeldisc-nocall/manifests/stage_list.tsv
    aad44ad15de2746785334f6367de45bb6765090cd5e36f9ca20829338e041ad1  labeldisc-nocall/scorers/feat.py
    9c07ee9655e20d45ebe908f5911e7c6986a59bd12bf2f54796d2240701312223  labeldisc-nocall/scorers/score_nocall.py
    a8fb0284af94b1cb5347fc8fc2683f1a47e33053ea9da4eff776bc47e0eeb063  labeldisc-nocall/scripts/audit_nocall.py
    09646d4dee9d6f2b94ff81ecdcb92da0081cb0f7bcddde0ffa4bd6dfa4342603  labeldisc-nocall/scripts/audit_scan.py
    d1405792e12a914a4927f41877ccd5a6014441779dc6d35483d323d84cb07ff8  labeldisc-nocall/scripts/run_nocall.py
    b21361a399ce0bc23c7c72c9f3beb108870e6b11079769eb0f848e75fa9a6f1f  labeldisc-nocall/scripts/select_nocall.py
    80aca4f530d559cdfcaf1250c4f9ccf93e2a632dc72bd21887ac6d525971bb94  labeldisc-nocall/scripts/stage_pride.sh
    50eaeeed988f4f486eb8512a740a9ba5cbdddf0ecfc4704e09ccfe38e8ebed8c  labeldisc-nocall/scripts/textcheck.py
