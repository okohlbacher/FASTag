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

Preregistered in branch `acceptance/1.13`, directory `acceptance/1.13/census/` (manifest, PREREG, frozen config,
scorer sha256, all committed before any held-out run; scored once). Result: see the section below.
