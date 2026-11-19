# PREREG-census: census triage finds spectra a second search identifies (1.13 backlog item 7, plan #11)

Status 2026-11-09: **protocol fixed, CFG-census-triage-113 `frozen` in the commit that adds this file. Not run, not
scored.** The held-out split `census-triage` (6 runs) is run once, scored once, never re-scored; nothing is tuned on
it. A FAIL is a valid result: `-census_ids` triage stays as documented ("an E-value threshold, not a quality call")
and the result is recorded in doc/CENSUS-TRIAGE-EVAL.md.
Design: output/backlog-1.13/census/DESIGN.md (with its four amendments, all made before any held-out run).

## Question

Do the spectra `-census -census_ids` marks as triage candidates (first search: no target hit at q <= 0.01; census
status tagged or placed; best E-value <= 0.01) get identified by a second, wider search more often than the other
unidentified spectra, and more often than the same number of unidentified spectra picked by peak count?

## Frozen software

| What | Value |
|---|---|
| FASTag | `data:/scratch/kohlbach/b113/census/opt/FASTag.bin` sha256 `07d4adb796ae595cd8907e16a428e8d8273a2f3f5a6640a2197d710ac12b2fa0` (wrapper `opt/FASTag` `b84c190a1348e2f4c8435671fc27c94e0af89691d8ca7bebeef7efcca5fdb43b`), built on node data from origin/main 702b45c (FASTag 1.12.1); `feat/b113-census` changes no source file. Gate: gate.sh vs refs-1.12.0 `GATE PASS (9 cases)`; new cases 5/8 PASS, chem_reports, census_dda, census_recon differ only in the report line `run version 1.12.0 -> 1.12.1` (every output equals the RC a117801 output with the version masked; the tag, census, recon and delta files are byte-identical). |
| CFG-census-triage-113 | `-census -census_ids <closed.idXML> -census_ids_fdr 0.01 -census_triage_evalue 0.01 -threads 8`, all other options at defaults |
| Run script | `census/scorers/run_census_triage.sh` (sha256 in `census/scorers/SHA256SUMS`) |
| OpenMS | 70cebcd144: SageAdapter `11b0d1dd...e174a`, IDScoreSwitcher `c3ddb98a...32b7`, DecoyDatabase (reverse, `DECOY_` prefix) |
| Sage | 0.14.7 binary (prints 0.14.6) sha256 `d3820543a31bfa2a556e04f91719204ce0ac6f34dcca6670314a13df87064625` |
| Database | UP000005640 `/ceph/ibmi/abi/oliver/jpr-bench/data/PXD054073/UP000005640_9606.fasta` sha256 `1f028a9ab2bca643c0e121c01ba3e05c92136beaa693a6197a32a025670df4bc` (20,950 proteins), with decoys `data:/scratch/kohlbach/b113/census/db/UP000005640_9606_td.fasta` sha256 `281e4e25b05ddc125f2983c2941b38155dbd33d3d53f5f372e3ed88a9a1c5378` |
| Conversion | ThermoRawFileParser 2.0.0 (`/ceph/ibmi/abi/oliver/prose-auto-20261029/env/bin/thermorawfileparser`, sha256 `73039004...ccb2`) `-f 2` |
| Scorer | `census/scorers/census_triage_eval.py` = `tools/census_triage_eval.py` of `feat/b113-census` d777b98/4299f89, sha256 `f167f1b798741a97118fb8f2ca22c5c492a30993cd86730a9a1461a0b0e02400`; `verdict_census.py`, `score_census.sh` (sha256 in `SHA256SUMS`; `score_census.sh` checks them before scoring). Reviewed adversarially twice (Codex) before freezing. |

## Searches per run (truth)

- **closed** (the `-census_ids` input): SageAdapter, 10 ppm precursor, 20 ppm fragment, Trypsin (KR, not before
  P), 2 missed cleavages, fixed Carbamidomethyl (C), variable Oxidation (M), max 2 variable mods, isotope errors -1..3,
  charges 2-5, no deisotoping, no RT prediction (adapter defaults); IDScoreSwitcher `spectrum_q` -> score type
  `q-value`. FASTag accepts a target hit at q <= 0.01.
- **semi** (primary truth): Sage with the closed search's results.json, semi-enzymatic, plus variable protein
  N-term acetyl (+42.010565) and peptide N-term pyro-Glu from Q (-17.026549).
- **open** (secondary truth): Sage with the closed search's results.json, precursor window [-500, +150] Da,
  isotope errors 0.

## Population, truth, endpoints

- U: census rows with `identified` 0 (empty `identified` excluded, counted as `n_unknown`).
- Primary truth: the semi search's rank-1 PSM is a target with q <= 0.01, q recomputed among the rank-1 PSMs of U
  only as (decoys + 1) / targets by `sage_discriminant_score` (`--fdr subset`). An unreported spectrum is not a hit.
- Triage = U with `triage` 1; rest = U with `triage` 0. Baseline = the |triage| spectra of U with the largest
  `n_peaks` (ties: lower index).
- Pooling: counts summed over the 6 runs. Intervals: percentile 95%, run-cluster bootstrap, 10,000 resamples, seed
  20261109.

| | Endpoint | Criterion |
|---|---|---|
| E1 | pooled rr = P(hit \| triage) / P(hit \| rest) | rr >= 2.0 and CI lower bound >= 1.5 |
| E2 | per-run rr | rr > 1 in every run (inf counts as > 1; undefined fails) |
| E3 | pooled d = P(hit \| triage) - P(hit \| top-n_peaks baseline) | d > 0 and CI lower bound > 0 |

Verdict (`verdict_census.py`): PASS when E1-E3 hold; FAIL when a point criterion fails (rr < 2.0, a run rr <= 1 or
undefined, d <= 0); INCONCLUSIVE when the point criteria hold and a CI criterion does not.

Reported without a verdict: semi with Sage's own q-values (`--fdr global`); open with subset and global q-values;
d against `n_edges` and `n_peaks_kept`; recall; AUROC of -log10(best_evalue); per-run tables; join diagnostics.

## Runs

`manifests/census-triage.tsv` (6 runs, one per project; sha256 of every raw and mzML), drawn by
`census/scripts/select_census_heldout.py` (rule in its header; draw table `census/inputs/draw.tsv`) and staged by
`census/scripts/stage_census.sh`. DEV (pipeline check only): PXD003531 and PXD014764 gate runs; the held-out runs
share no PXD and no file with them (`disjointness/census-triage.tsv`). PXD014764 is also a held-out run of #17
(`manifests/item17-heldout.tsv`); here it served only as a DEV pipeline check, and nothing from it reaches #17.

Commands (node data, one run after another, 8 threads):

    bash census/scorers/run_census_triage.sh <mzML> /scratch/kohlbach/b113/census/heldout-runs/<PXD> 8
    bash census/scorers/score_census.sh manifests/census-triage.tsv /scratch/kohlbach/b113/census/heldout-runs census/results

## Not in this test

The census classifier (PLAN-qc phase C, F7: AUROC >= 0.80, ECE <= 0.05) is not built: it needs #4's spectrum-level
labels and the F7 train pools, which do not exist. The reserved F7 pools (acceptance/1.12 `item11-f7test`,
`item11-final`) stay unopened. MSFragger 4.4.1 is not run.

## Result (appended 2026-11-09, after the single scoring)

Scored once: **FAIL** (E1 pass, rr 5.85, CI 3.19-10.26; E2 fail, PXD003903 has no hit in either group, rr
undefined; E3 pass, d +0.055, CI 0.010-0.133). Details: `census/results/RESULT.md`.
