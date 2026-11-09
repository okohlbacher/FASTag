# PREREG item 11: backlog 11, a/x ions (`-ion_series ax`)

Committed before any FASTag run on a `heldout` file of `manifests/item11-heldout.tsv`. The held-out MGFs were
downloaded and hashed (staging only; no FASTag or MSFragger run on them). Files of this item: `item11/` (scripts,
DEV results, `SHA256SUMS`), `manifests/item11-heldout.tsv`, `manifests/item11-dev.tsv`,
`disjointness/item11-heldout.tsv`, `scorers/score_item11.py`, the `CFG-11-*` rows of `frozen-configs.tsv` and the
`*-11-*` rows of `validation-registry.tsv`.

## What is evaluated

`-ion_series ax` of `feat/b113-ax` at 99ec699 (base origin/main 702b45c, FASTag 1.12.1), built on node data
(OpenMS 70cebcd144, env fastag-omsdev); binary sha256 `064b82780b9edb44294000423b6e0b7fff4c2dc15241b5a8525cb9d5011a978c`,
copied to `data:/scratch/kohlbach/b113/ax/frozen/FASTag`. Two arms, param_hash = sha256 of the options string:

| Config | Arm | Options |
|---|---|---|
| CFG-11-base | baseline | `-threads 4 -fragment_tolerance 15` (b/y, the default) |
| CFG-11-cand | candidate | `-threads 4 -fragment_tolerance 15 -ion_series ax` |

15 ppm is the MS2 accuracy of the data's own search (PRIDE data-processing protocol of PXD018176). Input: the
recalibrated UVPD MGFs as deposited (no activation in MGF, so `-ion_series auto -ion_series_photo ax` cannot be
tested on this set; it is covered by the CLI tests only).

## Data and split

PXD018176 (Rappsilber lab; tryptic E. coli K12 lysate; Orbitrap Fusion Lumos; for every precursor one HCD and
one 213-nm UVPD MS2, deposited as separate recalibrated MGFs; UVPD laser times 5-100 ms; public PRIDE data).

- `dev` (`manifests/item11-dev.tsv`): replicate 1, runs B191108_01-08 (UVPD MGF + HCD MGF per run), used for
  every DEV check below.
- `heldout` (`manifests/item11-heldout.tsv`, sha256 in `item11/SHA256SUMS`): replicate 2, runs B191108_15-22
  (5, 10, 15, 20, 30, 40, 50, 100 ms), 16 MGFs, PRIDE SHA-1 checked, sha256 recorded.
- Disjoint by file name and sha256 (`disjointness/item11-heldout.tsv`). **Limitation, stated now:** both
  replicates are the same lysate on the same instrument, so the held-out set is a technical replicate, not
  independent biology; peptide clusters overlap with DEV. No other public 213-nm or 193-nm UVPD set with a
  paired HCD truth was found (PRIDE search "UVPD", 2026-11-09).

## Truth

MSFragger 4.4.1 (jar sha256 `56b15a35...2112`), standalone, the frozen parameter files of `item11/SHA256SUMS`
(`msfragger_by`, `_abxy`, `_ax`): database UP000000625_83333.fasta (the PRIDE project's FASTA, sha256
`45ede201...2667`) plus reversed decoys `rev_` (`ecoli.td.fasta`); strict trypsin KR/P, 3 missed cleavages,
length 7-50; Carbamidomethyl C fixed; variable Oxidation M and protein N-term Acetyl, at most 3; precursor
10 ppm, isotope errors 0/1/2; fragment 15 ppm; charges from the MGF (else 1-6); MGF titles rewritten to
MSFragger's `<stem>.<scan>.<scan>.<z>` form by `item11/scripts/mgf_titles.py` (peaks unchanged). Rank 1,
target-decoy q-value on expectscore per search file, targets with q <= 0.01 (`score_item11.fragger_psms`, as
#15B).

- T1 (primary): the b/y search of the HCD MGF. A PSM of HCD scan s is the truth of the UVPD scan s + 1 when
  the UVPD block exists, its PEPMASS is within 10 ppm of the HCD PEPMASS and its CHARGE equals the PSM's charge;
  otherwise it is dropped and counted (`t1_unpaired`). T1 does not depend on the UVPD fragments.
- T2 (secondary): the search of the UVPD MGF with fragment_ion_series a,b,x,y.
- Reported only: the PSM count of the a,x-only search of the UVPD MGF.

## Endpoints

Correctness: the paper flank rule with each row's ion series (`score.py` REVERSED_OFFSET, `ion_series` column),
rank 1 = the spectrum's first row; an untagged truth spectrum is not correct (arm-independent denominator).
Clusters: I/L-folded unmodified truth peptide; 2,000 cluster bootstrap draws (`acclib.paired_diff`, seed per
cell name).

- **E1 (primary, decides):** T1, all held-out UVPD spectra pooled: cand - base >= +5.0 points and the 2.5th
  bootstrap percentile > 0 -> PASS; otherwise FAIL. (The c/z rule of #15B, E1.)
- E2 (descriptive): the same difference on T2; per laser time on T1 and T2; the union (either arm correct); the
  shuffled-peptide chance level of each arm on T1; the a,x-only PSM counts.

A FAIL keeps `-ion_series ax` and `-ion_series_photo` experimental and opt-in; nothing is changed or tuned
afterwards on this set. Scorer `scorers/score_item11.py` (sha256 in `item11/SHA256SUMS`, with
`acceptance/1.12/scorers/acclib.py` `fe387a34...` and `bench/fastag-bench` `score.py` `2130853f...` /
`parsers.py` `01e27548...` of feat/b113-ax 99ec699, REVERSED_OFFSET["ax"] = 71.984744, imported through
`ITEM11_BENCH_SRC` because this branch's own score.py predates the a/x offset), run once by
`item11/scripts/run_item11.sh` (python of `envs/prepdda`, pandas 3.0.6, numpy 2.4.6), which refuses another
binary, jar, parameter file, scorer, score.py, manifest or input sha256 and an existing results directory. The
scorer, run on DEV-1 from this tree, reproduces the DEV-1 cells and runs tables byte for byte
(`item11/dev/score-dev1/`).

## DEV results (before this file was committed)

Arms as above, binary of 6ee8b4b (same tags as the frozen 99ec699, which changed only help and warning text;
`item11/dev/frozen_rerun.txt`).

DEV-1, PXD018176 replicate 1 (`item11/dev/score-dev1/`):

| Truth | UVPD spectra | by rank-1 correct | ax rank-1 correct | ax - by (95% bootstrap) |
|---|---|---|---|---|
| T1 (HCD partner) | 77,594 | 31.65% | 0.05% | -31.59 [-32.36, -30.82] |
| T2 (UVPD a,b,x,y) | 57,745 | 61.63% | 0.08% | -61.55 [-62.34, -60.75] |

Per laser time ax stays at 0.00-0.23% (T1 by 8.1% at 5 ms to 49.2% at 100 ms). The a,x-only MSFragger search
identifies 0-104 spectra per run against 2,720-9,360 for a,b,x,y. Fragment census of 2,000 T1 PSMs per run
(`item11/dev/ioncheck.txt`, 15 ppm, share of backbone positions matched): 100 ms y 15.8%, b 9.2%, a+1 5.0%,
a 3.6%, x+1 1.8%, x 1.0%; 30 ms y 10.1%, b 5.5%, a+1 3.0%, a 1.8%, x 0.4%. At 213 nm these spectra hold b/y
ladders and isolated a/a+1 ions, not a/x ladders, so reading them as a/x loses the b/y tags and finds no a/x tags.

DEV-2, PXD003109 (`item11/dev/dev2/`, one 193-nm run, OR7_20150805_KLF_Hela_3mJ_50ms_, HeLa, Q Exactive with the
laser in the HCD cell, ThermoRawFileParser 2.0.0 mzML; `item11/dev/dev2/README.md`): T2 (a,b,x,y, human
UniProt, 20 ppm) 12,689 PSMs; by 63.12%, ax 0.32%, ax - by -62.80 [-63.79, -61.86]; the a,x-only search finds 541
PSMs. The file records every UVPD scan as beam-type CID (`@hcd2.00`), so `auto -ion_series_photo ax` reads it as
b/y (tags identical to by), as specified.

Expectation, stated before the run: on this evidence E1 will FAIL. The held-out run is done anyway, because the
protocol for opt-in modes asks for a registered held-out result and the set exists.
