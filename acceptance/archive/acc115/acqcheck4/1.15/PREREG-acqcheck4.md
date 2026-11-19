# PREREG-acqcheck4: raw-DIA acquisition check of FASTag 1.14.0 on Astral DDA and closed-window DIA

Status: **FROZEN (freeze 1)**, 2026-11-15. Committed and pushed to `acc115/acqcheck4` **before any file of the
held-out set is downloaded**. One run, scored once, nothing tuned, no criterion changed after this commit.
Freeze 2 (audited manifest with truth and the selection) is pushed before any FASTag binary reads a held-out file.

## What is tested

FASTag 1.14.0 refuses raw DIA by default (`-acquisition_check refuse`: exit 11, `FASTAG_REFUSED reason=raw_dia`).
Its third held-out test (acqcheck3, FASTag 1.13.4, same check) was INCONCLUSIVE with no criterion failed, for two
rows only: Astral DDA had 3 units (minimum 8), because 7 of 14 files drawn as Astral DDA were DIA and 4 were
Exploris/Eclipse runs; and closed-window DIA had none (every DIA file had a single cycle). This test closes those
two rows on fresh Thermo `.raw` files, with K1 and K2 over all units as in acqcheck3. The acquisition check of
1.14.0 equals that of 1.13.4 (`git diff v1.13.4 v1.14.0 -- src/Acquisition.cpp` renames enum values only).

## Frozen software (sha256)

| What | Value |
|---|---|
| Candidate | FASTag 1.14.0, tag v1.14.0 = main da92dee60550ba87944d923e066416688f202425, built on node data from `git archive v1.14.0` (src.tgz sha256 14dde7e6703cfaf0c372bf1aed8e368be8857bcdbe4e79967d66aba39a76fc4e; fastag-omsdev env, OpenMS develop 70cebcd144 as pinned in CI; `build.sh`): `data:/scratch/kohlbach/acc115/acqcheck4/opt/FASTag` **sha256 f7e2ec8d6ef09b07504bc06989d61f88a8a605e3f881a3c2ec22b828ab7d22bd** |
| Scripts | `acqcheck4/tools/SHA256SUMS` (catalog.py, collect_pxd.py, branch_pxd.py, draw.py, disj.py, stage.sh, truth.py, select.py, prep2.sh, decide.sh, probe.sh, run.sh, score.py, build.sh) |
| Download | PRIDE skill `pride_get.py` (md5 fabf07352b9c58a7585d01f5e4e639e5): HTTPS, `--split 4`, PRIDE MD5 and size checked; persistent copy in `/ceph/ibmi/abi/dont-backup/pride/<PXD>/raw/` |
| Converter | ThermoRawFileParser 2.0.0 `-f 2` (prose-auto env, as acqcheck3) |

`truth.py --selftest`, `select.py --selftest` and `score.py --selftest` pass. truth.py is acqcheck3's with one added
descriptive column (`model`, the instrument model term of the mzML); its labels and statistics are unchanged.

## Definitions (fixed before the draw)

**Astral DDA unit** (row K3): truth NONDIA of kind `dependent` (truth.py: >= 95 % of MS2 carry the data-dependent
scan-filter flag) **and** an Astral instrument by file metadata: the mzML instrument model term names Astral
(e.g. MS:1003378 Orbitrap Astral) and >= 50 % of MS2 scan filters start with `ASTMS` (Astral analyser). Both
come from the file, not from PRIDE. A file drawn as Astral DDA that fails either is not an Astral DDA unit (it
still counts in K1 or K2 by its truth).

**Closed-window DIA unit** (row K4, acqcheck3's rule): truth DIA (Thermo tiling, non-dependent) with truth.py's
single-cycle share `per` < 0.5. `per` collapses consecutive repeats of the MS2 window sequence (target and width to
0.1 Th) and, with W distinct windows, is the share of positions at which the next W windows are W distinct ones.
A DIA method that steps once through all its windows per cycle (fixed, variable, staggered, GPF single range)
gives `per` near 1; schemes whose window sets change within the run (retention-time-dependent window segments) or
whose window order varies between cycles (MSX random multiplexing, block repeats) give `per` < 0.5. This is the
case FASTag's 1.13 closed-window-set rule targets (no single cycle; every window visited >= 10 times; the second
half of the probed events brings almost no new m/z). It is a property of the file, known only after conversion,
so the draw enriches for it by project text and the selection rule below uses backups until enough units exist.

## Held-out set

Catalog: PRIDE v3 `/projects`, fetched 2026-11-15 (42,132 projects; `inputs/catalog.log`). Draw: `draw.py`, seed
20261115, Thermo `.raw` files of at most 5 GiB, one file per project (DDA_astral: up to 3, because only 25
projects of its pool have a usable file; files of one project are distinct runs and are scored as separate units); only projects whose listed instruments are
all Thermo Orbitrap/ion-trap models. Strata (first match, by title, description, protocols, keywords, instruments):

| Stratum | Pool rule | Main | Backups |
|---|---|---|---|
| DDA_astral | instruments name Astral; text names DDA (DDA, data-dependent, TopN, top speed) or names no DIA; not WWA. Files: never a DIA, targeted or SureQuant name; DDA-named files preferred; **up to 3 files per project**, emitted in rounds (first files of all projects, then second, then third) | 20 | 40 |
| DIA_closed | Thermo DIA text naming a window scheme. Tier A first (text names RT-dependent window segments, dynamic windows, MSX count >= 2, BoxCarmax, multiplexed DIA/msxDIA), then tier B (MSX, stagger/overlap/demultiplex, GPF/gas-phase fractionation, variable/narrow windows, window scheme/segments, chromatogram library); each tier shuffled | 20 | 20 |
| DIA_orbitrap | other Thermo DIA text | 20 | 5 |
| PRM | Thermo PRM text, no SRM/SureQuant/WWA, no DIA text | 8 | 3 |
| DDA_orbitrap | Thermo DDA text, no DIA/PRM/SRM text, not Astral | 36 | 6 |

Pools: DDA_astral 41 projects (25 with a usable file), DIA_closed 445 (tier A 31), DIA_orbitrap 2,351, PRM 350, DDA_orbitrap 12,507. Draw result: `manifests/acqcheck4.tsv` **sha256 17a73800caf5a15696c2483ec21ad541808a3633d1b704784299a6817b147b67** (178 rows: 104 main, 74 backup; 143 projects; 289 GB; 121 rows without a PRIDE checksum in the project file list, checked by pride_get against PRIDE's checksum file; `inputs/draw.log`).

Exclusion (`inputs/exclude.txt`, 4,675 PXDs), union of: every PXD named on any `origin/*` branch after `git fetch`
(30 refs, `inputs/excl_branches.txt`; `branch_pxd.py`, collect_pxd's catalogue rule per file: a file naming
more than 2,000 PXDs is a catalogue and skipped, `inputs/excl_branch_catalogues.txt`); everything under the FASTag
`work`, `output` (including `backlog-1.13` to `backlog-1.15`) and `data` folders on the Mac (`collect_pxd.py`);
acqcheck3's exclusion list; the 10 PXDs drawn by the parallel test acc115/msfcalib (`inputs/excl_msfcalib.txt`); everything under `/scratch/kohlbach/{acc114,acc115/* except acqcheck4,b113*,b114*,b115*,
post0131,post1131,post1133,fastag*}` on data; and every PXD already in the shared PRIDE archive. Disjointness table:
`disjointness/acqcheck4.tsv` (0 of 178 drawn files in any source).

## Staging (download and conversion only; no FASTag, no truth script)

Node data, `/scratch/kohlbach/acc115/acqcheck4/heldout`: `stage.sh manifest.tsv "2026-11-17 12:00"`. Every row
(main and backup) is staged: `pride_get.py meta`, `get --split 4` (PRIDE MD5 and size checked), `stage` to
`files/<id>/raw/`, ThermoRawFileParser 2.0.0 `-f 2`; 3 downloads at once, at most 2 conversions at once (nice -n 10; node data is shared); at most 2 passes; hard stop
2026-11-17 12:00 CET. A file whose download or conversion fails is not staged.

## Truth and selection (freeze 2)

`prep2.sh truth`: `truth.py` on every staged row (rules as acqcheck3: Thermo scan-filter dependent flag, SRM
filters, window coverage; DIA = dep <= 0.05, windows cover >= 80 % of >= 100 Th, >= 5 visits per window;
NONDIA dependent = dep >= 0.95; NONDIA targeted = dep <= 0.05 and coverage <= 50 % or >= 95 % SRM filters;
UNCLEAR otherwise, < 500 MS2, or > 5 % MS2 without filter or window; UNCLEAR files are excluded).

Cross-branch drop: right before freeze 2, after `git fetch`, a drawn row whose PXD is named on any other
`origin/*` branch (same catalogue rule) is `dropped` and counts as not staged.

Selection (`select.py`, deterministic, uses only staging status and truth):
- DIA_orbitrap, PRM, DDA_orbitrap (acqcheck3 rule): every staged main row is used; each main row not staged is
  replaced, in manifest order, by the next staged unused backup of its stratum; otherwise excluded.
- DDA_astral and DIA_closed (target rule): every staged main row is used; then the backups in manifest order:
  while fewer than **12 Astral DDA units** (DDA_astral) or **8 closed-window DIA units** (DIA_closed) are among
  the used rows of the stratum, the next staged backup is used. Unused rows are never run.

Truth audit (part of freeze 2): `audited.tsv` lists every drawn row with selection, staging and truth. For every
selected staged row whose truth differs from its drawn class or is UNCLEAR, and for every selected staged DDA_astral
row that is not an Astral DDA unit, the PRIDE record (and the linked paper where the record does not settle it) is read and a
note is recorded. The audit documents; it does not change a truth label or the selection.

## Run (once, after freeze 2)

`run.sh <sha256 of audited.tsv>` on data. Per unit (selected, staged, truth DIA or NONDIA; input sha256 checked
first): `decide.sh` (acqcheck3's, unchanged): `FASTag -in <mzML> -out tags.tsv -threads 2`, every other option at
its default, observed until it exits, or stopped 120 s after its `Acquisition check:` line, or after 3600 s
without that line; 4 runs at once. Then `FASTag -probe_input` (reported only), then `score.py` once.
**Refused** = the run exited with code 11 and printed `FASTAG_REFUSED reason=raw_dia`; anything else counts as
not refused (a miss if truth is DIA).

## Criteria and verdict (`score.py`; thresholds as acqcheck3)

| Row | Criterion | Minimum n |
|---|---|---|
| K1 | refused among truth NONDIA = 0 (one-sided exact 95 % upper bound reported) | 50 |
| K2 | refused among truth DIA >= 90 % | 40 |
| K3 | refused among Astral DDA units = 0 | 8 |
| K4 | refused among closed-window DIA units >= 90 % | 5 |

Row verdict: FAIL if violated and n >= minimum, or (zero-refusal rows) any refusal; PASS if it holds with
n >= minimum; INCONCLUSIVE otherwise. **Overall: FAIL** if any row fails; **PASS** if all four rows pass;
**INCONCLUSIVE** otherwise. If staging leaves fewer units than a minimum, that row is INCONCLUSIVE; no criterion
is lowered. Reported only: Astral DIA, recurring/targeted NONDIA, probe/run concordance.

## Technical failures

A unit whose default run did not exit (stopped or timed out) counts as not refused. No rerun of the scored run,
except after a failure of the node or the scripts that produced no `summary.txt`; such a rerun uses the same frozen
files and is reported. Deviations are recorded in RESULT, not repaired.
