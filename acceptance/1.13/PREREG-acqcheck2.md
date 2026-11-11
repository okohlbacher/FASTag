# PREREG-acqcheck2: revised raw-DIA acquisition check (backlog #7, `-acquisition_check`)

Status: **FROZEN**, 2026-11-10 (local, CST). Committed and pushed to `acc113r/acqcheck` **before the candidate
binary, the base binary or the truth script read any held-out file**. One run, scored once, nothing tuned on
held-out data, no criterion relaxed after this commit.

## What is tested

E7-03 (PREREG-item07) failed for the 1.12/1.13 rule; that sample is spent and was the development set here.
Branch `feat/b113-acqcheck2` adds two schemes inside the existing "windowed and tiling" branch of
`classifyAcquisition()`: (a) a closed window set (each isolation m/z visited >= 10 times and >= 99 % of the
second-half MS2 on an m/z seen in the first half) counts as a scheme without one detectable cycle; (b) >= 99 % of
MS2 carrying the same nonzero precursor charge (placeholder charge) no longer downgrades DIA to DIA-like.
Question: on fresh public Thermo files, does the revised rule refuse no data-dependent or targeted file and
refuse at least 90 % of the DIA files?

## Frozen software

| What | Value |
|---|---|
| Candidate source | `feat/b113-acqcheck2` 7d2522fb97d4d4a38425f9be14d1bec45b223054 |
| Candidate binary | `data:/scratch/kohlbach/b113/acqcheck2/opt/FASTag`, sha256 **d372d74c6774ac5db22afd7b886a079f29aa7b50b5fc90bff052ca6a7892fc63** (fastag-omsdev, OpenMS 70cebcd144) |
| Base binary (reported only) | `data:/scratch/kohlbach/b113/acqcheck2/opt-base/FASTag` (origin/integration/1.13 e21d8033), sha256 c93f683c0bd512923c5ec49fb61e3da9581c4bd7d5f4b072f3b27693c295944d |
| Truth script | `acqcheck2/scorers/truth.py` sha256 **4380a783a585504de090d283ea0c634139e19bd0959206dc482d9493d2a0a3c8** |
| Scorer and verdict | `acqcheck2/scorers/score.py` sha256 **0b99573dbdb4b7792a11c954c98f221bb594c5c5df16c73ab3f42d2fefc442f7** (`--selftest` passes) |
| Probe wrapper | `acqcheck2/scorers/probe.sh` sha256 cda1867cc89eee5c791fe442f46e0bbf9eff175dc27daa445666bc62142b5444 |
| Run script | `acqcheck2/scorers/run.sh` sha256 5c41e3cfeadc59ca1061cd3fddc584bc47adc44da853a38e318bbe3cf7a32b74 |
| Staging | `stage.sh` c1f1345088bfcc7c7912e5a3e5925d86535e71cd572158873883697cbbde23a5, `stage2.sh` eb7fe3e0fa35d366c680fae665674cf6f9ab3572f29993e0575a3e88726d25a4 |
| Draw | `mkdraw.py` 9c8654819744a5e59ffa93d08a6acd3ab8bd1882760c2bb30b7b65cd2b97f6b8 -> `draw.py` 4c7ae894167e8d85f854abee5e9feb6bdbaa8fcdcf9857e8592a470da586bf18, seed 20261110, `inputs/exclude.txt` df04955c40f0f010263ffad3fa87951d6d080f8066d56d01c6e09555432f0df6 |
| Manifest | `manifests/acqcheck2.tsv` sha256 **97d86bad95eee2e74854aad539e81bb7dc9acfe3618ab5f4ef1dcb8a8cf9583d** (98 files, 98 projects) |
| Disjointness | `disjointness/acqcheck2.tsv` sha256 6c7960bf5665778eebf772dd0bb9e13d2e11a8ce3a920cac85b0c4ad4014f9f2 (0 of 98 overlaps) |

All hashes also in `acqcheck2/SHA256SUMS`.

## Held-out set

Public PRIDE projects only, one Thermo `.raw` file per project (<= 2.5 GiB), drawn by `draw.py` (the E7-03
sampler with a new seed and exclusion list) from strata defined by PRIDE text and instrument:
DIA_orbitrap 45, DDA_qexactive 14, DDA_exploris 13, DDA_tribrid 14, PRM 8, WWA_DDA 4. No Astral, timsTOF or SCIEX
file is in this sample (the Astral pools were empty after exclusion; the truth script needs Thermo filter
strings), so the verdict covers Thermo Orbitrap-type acquisitions only. The second new criterion (closed window
set) rests on one development file; if no such file is drawn it stays untested here.

Disjoint by PRIDE project from the spent E7-03 sample, the E7-02 development corpus and sweep, every list in
`output/backlog-1.13`, every PXD on any `acceptance/*` or `acc113r/*` branch (fetched 2026-11-10 18:20 CST) and
the reserved lists (`disjointness/acqcheck2.tsv`). The draw gave 99 files; AQ2.DDA_exploris.03 (PXD046699) was
removed before the freeze because the project appeared on `acc113r/labeldisc-nocall` after the draw; no replacement.

## Truth

The drawn stratum is only a label. Truth per file comes from `truth.py`, written before this freeze, independent
of FASTag's code and applied to every MS2 of the converted file (ThermoRawFileParser 2.0.0 mzML):
dep = share of MS2 whose Thermo filter string marks a data-dependent scan; windows = distinct isolation windows.

- **NONDIA** (dependent): dep >= 0.95. **NONDIA** (targeted): dep <= 0.05 and the windows cover <= 50 % of their m/z span.
- **DIA**: dep <= 0.05, windows cover >= 80 % of a span >= 100 m/z, each window visited >= 5 times on average.
- **UNCLEAR**: anything else, < 500 MS2, or > 5 % of MS2 without filter string or isolation window.

Check on the spent sample (development): truth.py gives DIA for the nine DIA files that PRIDE files as DDA and
NONDIA for the two DDA library runs in the DIA stratum. The label-versus-truth table is reported.

## Commands (node data, `/scratch/kohlbach/b113/acqcheck2/heldout`)

Staging (no FASTag binary, no truth script): `stage.sh manifest.tsv stage.tsv 24`, then `stage2.sh` (one retry
pass with 10 parallel downloads for files PRIDE refused in pass 1; hard stop 20:20 CST = 03:20 CET).
The scored run, once: `bash run.sh`, which for every staged manifest file runs

    python3 truth.py <id> <mzML>
    FASTag -probe_input <mzML>        (candidate, then base; record "acquisition", field "refuse")
    python3 score.py manifest.tsv truth.tsv probe.cand.tsv probe.base.tsv units.tsv summary.txt

`refuse:true` in the probe record is exactly the condition under which `-acquisition_check refuse` (the
default) exits 11. `run.sh` refuses to start a second time.

## Criteria and verdict

Unit: one file with truth DIA or NONDIA.

- **K1** files refused among truth NONDIA = 0 (minimum 40 files).
- **K2** files refused among truth DIA >= 90 % (minimum 25 files).

**FAIL** if K1 is violated (any n) or K2 is violated with >= 25 DIA files. **PASS** if both hold with both
minimum n. Otherwise **INCONCLUSIVE**. The base binary's counts are reported next to it and do not enter the
verdict. Descriptive only: counts per stratum, DIA-like calls, label-versus-truth table.

## Technical failures

- A file not staged by the hard stop (download refused, SHA-1 or size mismatch, conversion error) is excluded and
  listed; no replacement.
- A file with truth UNCLEAR or without truth line is excluded and listed.
- A scored file for which the candidate gives no usable probe record (exit code != 0 or no acquisition record)
  counts as **not refused** (a miss if truth is DIA).
- No rerun of the scored run except for a failure of the node or the scripts that produced no summary; such a
  rerun uses the same frozen files and is reported.

## Addendum 1 (2026-11-10, before the scored run; staging only)

Pass 1 met refused connections for most files: PRIDE limits the connections per address and other jobs on the
node download at the same time. `stage2.sh` (one retry pass) was replaced, before it had started a download, by
`acqcheck2/scorers/stage3.sh` (sha256 580d111ed7a78ccfa820889ac433705ebbb98ecda29e909c3c63bedfcde2ab11): `stage.sh` is repeated with
8 parallel downloads until every manifest file is staged or the unchanged hard stop 20:20 CST. Nothing else
changes; at this point no FASTag binary and no truth script has read a held-out file (`run.sh` waits for
`stage.final.done`). The project list was fetched at about 18:12 CST, not 18:20.
