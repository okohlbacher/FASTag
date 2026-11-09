# Census triage evaluation

`-census -census_ids <first search>` marks a spectrum as a triage candidate (`triage` = 1) when the first search
leaves it unidentified, its status is `tagged` or `placed`, and its best E-value is at most `-census_triage_evalue`
(see README, Census). This page describes how the claim behind the list was tested: **the candidates are the
unidentified spectra a second, wider search is more likely to identify** (1.13 backlog item 7, plan #11). No FASTag
option was added or changed for it.

## The scorer

`tools/census_triage_eval.py` (Python standard library only) reads a run table and writes a long TSV
(`scope`, `key`, `value`; scope is a run label or `pooled`):

    python3 tools/census_triage_eval.py runs.tsv --fdr subset --baseline n_peaks --baseline n_edges --out eval.tsv

`runs.tsv` has the columns `run`, `census` (the run's `.census.tsv` written with `-census_ids`), `second` (the
second search's Sage `results.sage.tsv`) and optionally `mzml` (the basename the Sage `filename` column must name).

- U: census rows with `identified` = 0; rows with an empty `identified` are counted (`n_unknown`) and left out.
- A spectrum of U is a second-search hit when its rank-1 Sage PSM is a target at q <= `--q` (0.01). `--fdr global`
  uses Sage's `spectrum_q`, estimated over all spectra of the second search; `--fdr subset` recomputes target-decoy
  q-values among the rank-1 PSMs of U only, ordered by `sage_discriminant_score` (a separate FDR for the newly
  identified spectra, which the search-wide estimate understates).
- `rr` = hit rate of the triage candidates / hit rate of the rest of U; `recall` = share of U's hits that are
  candidates; `d_<column>` = hit rate of the candidates minus that of the same number of U spectra with the largest
  `<column>` (ties to the lower input index); `auroc_neglog10_evalue` = AUROC of -log10(best_evalue) for the hits
  within U (untagged spectra rank lowest).
- Pooled values sum the runs' counts. `rr` and `d_*` get percentile 95% intervals from a run-cluster bootstrap
  (`--boot` resamples, `--seed`).

Tests: ctest `census_triage_eval_test` (hand-counted tables) and `census_triage_eval_cli_test` (a real
`-census -census_ids` run of the fixture against an awk recount).

## Held-out test (1.13)

Preregistered in branch `acceptance/1.13` (`PREREG-census.md`, `manifests/census-triage.tsv`, `census/`; manifest,
frozen config and scorer sha256 committed in f054006 before any held-out run; scored once, abcd607).

- Runs: 6 Q Exactive HCD DDA runs of human lysates from 6 PRIDE projects never used before (PXD003903, PXD016143,
  PXD017427, PXD034582, PXD037976, PXD069084), 202,422 spectra the first search left unidentified.
- First search: Sage 0.14.7 through OpenMS SageAdapter (UP000005640 + reversed decoys, 10/20 ppm, tryptic,
  fixed carbamidomethyl, variable Met oxidation), Sage's q-value as the idXML score (IDScoreSwitcher); FASTag at
  defaults with `-census -census_ids`.
- Second searches: Sage with the same settings, semi-enzymatic plus N-terminal acetyl and pyro-Glu (primary), or
  with a [-500, +150] Da precursor window (open, secondary).
- Criteria: E1 pooled rr >= 2.0 with CI lower bound >= 1.5; E2 rr > 1 in every run; E3 the candidates' hit rate
  above that of the same number of spectra picked by `n_peaks`, CI lower bound > 0.

**Result: FAIL**, by E2 only. E1 pooled rr 5.85 (run bootstrap 3.19-10.26) and E3 +0.055 (0.010-0.133) pass. In one
run (PXD003903, 381 of 39,839 spectra identified by the first search) neither group had a single semi-search hit
at 1% FDR, so its rr is undefined, which the protocol counts as a failure; in the other five runs the candidates'
hit rate was 1.6 to 9.8 times that of the other unidentified spectra. Pooled, the candidates were 15.5% of the
unidentified spectra and held 52% of their semi-search hits (hit rate 12.5% vs 2.1%).

Secondary: against the open search the enrichment is similar (rr 4.7), but the candidates do no better than a pick
by peak count (d +0.014, CI -0.030 to 0.082).

What this supports: the triage list is enriched for spectra a semi-specific second search identifies, pooled and in
most runs; it is not a per-run guarantee and not a quality call. The census classifier of the plan (phase C) was not
built, because the spectrum-level labels it needs do not exist yet.
