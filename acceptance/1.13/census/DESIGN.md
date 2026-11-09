# 1.13 item 7 (#11): census triage evaluation, design

Backlog row 7: "Does triage find spectra a second search identifies; optionally the census classifier (AUROC >= 0.80)".
Branch `feat/b113-census` (from origin/main 702b45c, FASTag 1.12.1). Held-out records in branch `acceptance/1.13`,
directory `acceptance/1.13/census/`. Written 2026-11-09, before any second-search result of any run was read.

## What is tested

`-census -census_ids <first search>` marks a spectrum as a triage candidate when the first search does not identify
it (no target hit at q <= `-census_ids_fdr`), its census status is `tagged` or `placed`, and its best E-value is at
or below `-census_triage_evalue` (both 0.01 by default). The README calls this "an E-value threshold, not a quality
call". The claim to test is the use the triage list is for: **the candidates are the unidentified spectra a second,
wider search is more likely to identify.**

No FASTag option changes. With the item's code (a scorer and its tests) the binary is unchanged, so every output is
byte-identical; the gate is run anyway (gate.sh vs refs-1.12.0 plus the eight new cases).

## Per run

1. **First (closed) search**: OpenMS SageAdapter (OpenMS 70cebcd144) with Sage 0.14.7 on UP000005640 plus reversed
   decoys (OpenMS DecoyDatabase, `DECOY_` prefix). 10 ppm precursor, 20 ppm fragment, fixed carbamidomethyl C,
   variable Met oxidation, tryptic, 2 missed cleavages (the adapter's defaults otherwise). IDScoreSwitcher makes
   Sage's `spectrum_q` the score (type `q-value`, lower better), which `-census_ids` reads.
2. **FASTag** at defaults plus `-census -census_ids closed.idXML -census_ids_fdr 0.01 -census_triage_evalue 0.01`.
   Without `-fasta` no spectrum is `placed`; all candidates are `tagged`.
3. **Second searches** with Sage 0.14.7, the closed search's settings as SageAdapter wrote them (results.json),
   changed only as follows:
   - `semi`: semi-enzymatic, plus variable protein N-terminal acetylation and N-terminal pyro-Glu from Q;
   - `open`: precursor window [-500, +150] Da (backlog #21's window), isotope errors 0.

## Population, truth, endpoints

- U: census rows with `identified` = 0 (unmatched rows, `identified` empty, are excluded and counted).
- Truth T (primary): the `semi` search's rank-1 PSM is a target at q <= 0.01, with q recomputed by target-decoy
  among the rank-1 PSMs of U only (a separate FDR for the newly identified spectra; the search's own q-values are
  estimated over all spectra, so they understate the error among the hard, unidentified ones).
- Triage group: U with `triage` = 1; rest: U with `triage` = 0 (tagged with a worse E-value, or untagged).
- Baseline: the same number of U spectra picked by the largest `n_peaks` (positive input peaks, no tagging), ties to
  the lower input index.

Endpoints, pooled over runs (counts summed), 95% intervals by run-cluster bootstrap (10,000 resamples, seed
20261109):

| | Endpoint | Criterion |
|---|---|---|
| E1 | rr = P(T \| triage) / P(T \| rest) | pooled rr >= 2.0 and its CI lower bound >= 1.5 |
| E2 | per-run rr | rr > 1 in every run |
| E3 | d = P(T \| triage) - P(T \| top-n_peaks baseline) | pooled d > 0 and its CI lower bound > 0 |

Verdict: PASS when E1, E2 and E3 hold; FAIL when a point criterion fails (pooled rr < 2.0, a run with rr <= 1, or
pooled d <= 0); INCONCLUSIVE when the point criteria hold and a CI criterion does not.

Reported without a verdict: the same numbers with the `open` truth and with each search's own q-values; d against
`n_edges` and `n_peaks_kept`; recall (share of T in U that triage covers); the AUROC of -log10(best_evalue) for T
within U; per-run tables.

These criteria were written before the DEV second searches were read. DEV is used to check the pipeline only; the
criteria and settings are not changed after it unless a pipeline defect is found, and any such change is recorded.

## Data

- DEV (pipeline check only): the gate runs PXD003531 (20130611_QE3_UPLC10_CFR_SA_OC_T_NO_03_01_01) and PXD014764
  (20190412_KEH_HF_SA_ANW_R11_100419_CNOT_R1_f008), both Q Exactive HCD DDA, human.
- Held-out: 6 runs from 6 PRIDE projects never named anywhere in the FASTag repository, outputs or cluster folders,
  drawn by `acceptance/1.13/census/scripts/select_census_heldout.py` from the Q Exactive projects that passed the
  1.12 #2/#6 project rule but were not needed there (DDA, trypsin, label-free, lysate, no enrichment), restricted to
  Homo sapiens; one .raw per project (0.2-4 GB), converted with ThermoRawFileParser 2.0.0. Manifest (PXD, file,
  PRIDE SHA-1, sha256), PREREG and frozen config are committed to acceptance/1.13 before any held-out run. Each run
  is scored exactly once.

## Code

- `tools/census_triage_eval.py`: the scorer (Python standard library only): per-run and pooled counts, rr, recall,
  size-matched baselines, AUROC, run-cluster bootstrap, `--fdr global|subset`.
- `test/census_triage_eval_test.py` (ctest `census_triage_eval_test`): hand-counted tables (unknown rows, decoys,
  rank 2, q boundary, subset FDR with ties, baseline ties, pooling, bootstrap bounds, refusals).
- `test/census_triage_eval_cli_test.sh` (ctest `census_triage_eval_cli_test`): a real `-census -census_ids` run of
  the fixture, counts against an awk recount, refusals.
- `doc/CENSUS-TRIAGE-EVAL.md`: how to run it and the held-out result; README pointer in the Census section.

## Not done here

- **The census classifier (PLAN-qc phase C, F7)**: it needs the spectrum-level labels of #4 and the F7 train pools
  (seed 3), which do not exist yet; the reserved F7-test and final pools (acceptance/1.12 manifests item11-f7test,
  item11-final) stay unopened.
- **MSFragger 4.4.1** as a second engine: not run; Sage semi and open are the two arms.

## Amendments before any held-out run (2026-11-09)

1. *Subset FDR estimator* (adversarial review of the scorer, Codex, round 1, finding 3): q = (decoys + 1) / targets
   instead of decoys / targets, the finite-sample target-decoy competition estimate; D/T accepted a lone target at
   q 0. This makes the truth stricter in both groups. It was made after the DEV numbers with D/T were read (DEV
   pooled rr 3.10 on PXD003531; with (D+1)/T 3.13), which is recorded here; no criterion changed.
2. *rr when the rest has no hit*: rr = inf (it was undefined and dropped from the bootstrap, which biased the
   interval). rr is undefined only when neither group has a hit. E2: inf counts as rr > 1; an undefined run rr
   fails E2.
3. *Join*: Sage's TSV is read with CSV quoting; a run in which no spectrum of U has a second-search PSM is refused
   (a pipeline failure, not a result); the counts of U spectra the second search reports are written.
4. *Held-out draw*: the organism rule compares the PRIDE name by prefix (`Homo sapiens (human)`); the exact match
   first written rejected every project. Fixed before any draw output was used.
