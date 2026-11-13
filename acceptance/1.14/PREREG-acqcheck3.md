# PREREG-acqcheck3: raw-DIA acquisition check of FASTag 1.13.4 on Astral, timsTOF and SCIEX

Status: **FROZEN (freeze 1)**, 2026-11-13. Committed and pushed to `acc114/acqcheck3` **before any file of the
held-out set is downloaded**. One run, scored once, nothing tuned, no criterion changed after this commit.
Freeze 2 (audited manifest with truth) is pushed before any FASTag binary reads a held-out file.

## What is tested

FASTag 1.13.4 refuses raw DIA by default (`-acquisition_check refuse`, exit 11, `FASTAG_REFUSED reason=raw_dia`),
with the revised 1.13 rule (closed window set; placeholder charge). Its held-out test (acqcheck2, PASS: 0/58
non-DIA refused, 35/37 DIA refused) held Thermo Orbitrap files only, and one closed-window-set file. This test
covers what was missing: Orbitrap Astral, Bruker timsTOF (diaPASEF positives, ddaPASEF negatives), SCIEX (SWATH
positives, IDA negatives), Orbitrap DIA with unusual window schemes (enriched for closed window sets),
recurring-window DDA, and targeted runs (PRM, SRM) as negatives.

## Frozen software (sha256)

| What | Value |
|---|---|
| Candidate | FASTag 1.13.4, tag v1.13.4 = main 0ddff9b72ad5f92d82ab3f52f8329fc61d084d9c, built on node data (`git archive v1.13.4`, fastag-omsdev env, OpenMS develop 70cebcd144 as pinned in CI): `data:/scratch/kohlbach/b114/acqcheck3/opt/FASTag` **sha256 a37c8b065166c88859c526f7d7b030d8e2fa157f83e669f33385252f8645253f** |
| Scripts | `acqcheck3/SHA256SUMS` (draw.py, collect_pxd.py, disj.py, stage.sh, stage_sciex.ps1, pull_sciex.sh, select.py, truth.py, prep2.sh, decide.sh, probe.sh, run.sh, score.py) |
| Converters | ThermoRawFileParser 2.0.0 (prose-auto env); diaweaver-7ed1169 FileConverter (Bruker .d, as E7-03); ProteoWizard msconvert 3.0.22187 on flash (SCIEX, as E7-03 amendment 1) |

`truth.py --selftest`, `select.py --selftest` and `score.py --selftest` pass. Development checks of truth.py and
decide.sh used spent E7-03 files only (DIA/DDA Astral, diaPASEF, ddaPASEF, SWATH, TripleTOF IDA, PRM, and the
block-design DIA_orbitrap.12, which truth.py marks as no single cycle, per = 0).

## Held-out set

Catalog: PRIDE v3 `/projects`, fetched 2026-11-13 (42,124 projects; `inputs/catalog.log`). Draw: `draw.py`,
seed 20261113, one file per project, files of the stratum's format of at most 5 GiB, names not contradicting the
stratum; per stratum 3 backups drawn in the same order. Strata (assignment by PRIDE text and instrument, first
match; `draw.py`): DIA_astral 15, DIA_diapasef 15, DIA_swath 15, DIA_orbitrap_scheme 15 (Orbitrap DIA text naming
MSX, staggered/overlapping/variable/narrow windows, GPF or a window scheme), DDA_astral 14, DDA_ddapasef 18,
DDA_sciex 18 (IDA), DDA_recurring 10 (Orbitrap DDA of cross-linking, AP-MS, IP, pull-down or purified proteins),
WWA_DDA 6, PRM 12, SRM 6 (PRM/SRM of any of the three vendors). Formats: Thermo `.raw`, Bruker `.d.zip`,
SCIEX `.wiff`/`.wiff2` with `.wiff.scan`. Draw result: `manifests/acqcheck3.tsv` **sha256 25599bb57d269d87e6b77c830e2ca09deef3f7df455bcfae774c9ce7d18f86a6 (170 rows: 140 main, 30 backup; 170 projects; 305 GB; 99 rows without a PRIDE SHA-1 are checked by size). The PRIDE pool held only 2 WWA_DDA projects, so that stratum has 2 files and no backup** (`inputs/draw.log`).

Exclusion (`inputs/exclude.txt`, 4,044 PXDs): every PXD named on any `origin/*` branch (162 refs, all
`acceptance/*`, `acc113*`, `acc114/*`, `post113*`), under the FASTag `work`, `output` and `data` folders on the
Mac, and under `/scratch/kohlbach/{b113,b114,post0131,post1131,post1133,fastag*}` on data, collected with the
established rule of labeldisc test 5 (`collect_pxd.py`: a file or directory naming more than 2,000 PXDs is a PRIDE
catalogue and skipped; mode-000 files are never read). Disjointness table: `disjointness/acqcheck3.tsv` (0 of 170 drawn projects in any source or in the HELDOUT-COMMON reserved lists). Catalogues skipped: `inputs/excl_catalogues.txt`.
Other held-out tests of this round run in parallel; at freeze 2 any selected file whose PXD appears on another
`acc114/*` branch is dropped (listed, no replacement).

## Staging (download and conversion only; no FASTag, no truth script)

Node data, `/scratch/kohlbach/b114/acqcheck3/heldout`: `stage.sh manifest.tsv "2026-11-15 12:00"` (Thermo and
Bruker rows, main and backup; 3 parallel downloads). Flash: `stage_sciex.ps1 -Stop "2026-11-15 12:00"` (SCIEX
rows, 3 parallel downloads from PRIDE on flash); `pull_sciex.sh` copies the mzML to data (data -> flash, sha256
checked). Download rule (bounded): PRIDE SHA-1 (or the listed size) checked; at most 3 attempts per file per pass;
at most 4 passes; hard stop 2026-11-15 12:00 CET. Conversion routes as in the scripts; a file whose conversion
fails is not staged. **Backup rule** (`select.py`): per stratum every staged main file is used; each main file
not staged is replaced by the next staged, unused backup of its stratum (at most 3 per stratum); otherwise it is
excluded. Nothing else replaces a file.

## Truth (`truth.py`, vendor metadata, all MS2; independent of FASTag's rule)

- Thermo: scan-filter dependent flag and window coverage, the acqcheck2 rule (DIA: dep <= 0.05, windows cover
  >= 80 % of >= 100 Th, >= 5 visits per window; NONDIA dependent: dep >= 0.95; NONDIA targeted: dep <= 0.05 and
  coverage <= 50 %, or >= 95 % SRM filters).
- SCIEX: experiment index of each MS2 (msconvert native id). DIA: >= 95 % of MS2 in experiments with one fixed
  window, >= 5 such experiments, tiling as above; NONDIA dependent (IDA): >= 95 % in experiments whose window
  varies; NONDIA targeted: fixed experiments with coverage <= 50 %.
- Bruker: `Frames.MsMsType` in analysis.tdf. DIA >= 95 % diaPASEF frames (9); NONDIA dependent >= 95 % PASEF (8);
  NONDIA targeted >= 95 % prm-PASEF/MS-MS (10, 2).
- UNCLEAR otherwise, < 500 MS2, or > 5 % MS2 without the needed metadata; UNCLEAR files are excluded.

Truth audit (part of freeze 2): `audited.tsv` lists the drawn stratum, the truth and its metadata. For every file
whose truth differs from its drawn class or is UNCLEAR, the PRIDE record (and the linked paper where the record
does not settle it) is read and a note is recorded. The audit documents; it does not change a truth label.

## Run (once, after freeze 2)

`run.sh <sha256 of audited.tsv>` on data. Per unit (staged, truth DIA or NONDIA; input sha256 checked first):
`decide.sh`: `FASTag -in <mzML> -out tags.tsv -threads 2`, every other option at its default, observed until
it exits, or stopped 120 s after its `Acquisition check:` line (it is then tagging), or after 3600 s without
that line; 4 runs at once. Then `FASTag -probe_input` (reported only), then `score.py` once.
**Refused** = the run exited with code 11 and printed `FASTAG_REFUSED reason=raw_dia`; anything else counts as
not refused (a miss if truth is DIA).

## Criteria and verdict (`score.py`)

Vendor of a unit: timsTOF (.d), SCIEX (.wiff), Astral (.raw with >= 50 % ASTMS filters), Orbitrap (other .raw).

| Row | Criterion | Minimum n |
|---|---|---|
| K1 | refused among truth NONDIA = 0 (one-sided exact 95 % upper bound reported) | 50 |
| K2 | refused among truth DIA >= 90 % | 40 |
| K3 | per vendor (Astral, timsTOF, SCIEX): DIA refused >= 90 %; NONDIA refused = 0 | 8 each |
| K4 | closed-window DIA (truth DIA, Thermo or SCIEX, single-cycle share per < 0.5) refused >= 90 % | 5 |
| K5 | recurring-window or targeted NONDIA (recur >= 0.5 or kind targeted*) refused = 0 | 10 |

Row verdict: FAIL if violated and n >= minimum, or (zero-refusal rows) any refusal; PASS if it holds with
n >= minimum; INCONCLUSIVE otherwise. **Overall: FAIL** if any row fails; **PASS** if K1, K2 and the six K3 rows
pass (K4 and K5 then reported with their own verdicts); **INCONCLUSIVE** otherwise. If staging leaves fewer
units than a minimum, that row is INCONCLUSIVE; no criterion is lowered.

## Technical failures

A unit whose default run did not exit (stopped or timed out) counts as not refused. No rerun of the scored run,
except after a failure of the node or the scripts that produced no `summary.txt`; such a rerun uses the same frozen
files and is reported. Deviations are recorded in RESULT.
