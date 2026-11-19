# census (#11 triage), held-out result: FAIL (E2)

Scored once on 2026-11-09 (node data) with the frozen scorers of f054006 (`score_census.sh`: SHA256SUMS OK), on the
six runs of `manifests/census-triage.tsv` (input sha256 of every run checked against the manifest before scoring;
outputs in `run/outputs.sha256`). Protocol: PREREG-census.md. Nothing was re-run or re-scored.

## Verdict (primary: semi-enzymatic Sage, (D+1)/T FDR among the unidentified spectra)

| | Endpoint | Value | Criterion | |
|---|---|---|---|---|
| E1 | pooled rr | 5.85 (95% run bootstrap 3.19-10.26) | >= 2.0, CI lo >= 1.5 | pass |
| E2 | per-run rr | PXD003903 undefined; 1.58, 9.76, 5.34, 9.69, 2.22 | > 1 in every run | **fail** |
| E3 | pooled d vs top-n_peaks | +0.055 (0.010-0.133) | > 0, CI lo > 0 | pass |

**VERDICT FAIL.** The one failing criterion is E2: in PXD003903 (PT4530-6.raw) neither group has a single
second-search hit at the subset FDR (0 of 2,280 candidates, 0 of 37,178 others), so its rr is undefined, which the
preregistered rule counts as a failure. The closed search identified only 381 of that run's 39,839 MS2 spectra
(the other runs: 511 to 31,437), so the run yields almost no identifications under any of the searches here; with
the search's own q-values the semi search gives 21 vs 21 hits (rr 16.3), the open search 36 vs 53 (rr 11.1). Why
this run identifies so little was not investigated before scoring and is not used to change the verdict.

In the five other runs triage enriched the second-search hits 1.6- to 9.8-fold. The candidates are 15.5% of the
unidentified spectra and hold 51.8% of their semi-search hits (pooled hit rate 12.5% vs 2.1%).

## Pooled, all truths (reported without a verdict)

| Truth | p triage | p rest | rr (CI) | d n_peaks (CI) | d n_edges | recall | AUROC -log10 E |
|---|---|---|---|---|---|---|---|
| semi, subset FDR (primary) | 0.125 | 0.021 | 5.85 (3.19-10.26) | +0.055 (0.010-0.133) | +0.021 | 0.52 | 0.83 |
| semi, Sage q | 0.159 | 0.033 | 4.82 (2.58-8.90) | +0.062 (0.013-0.147) | +0.029 | 0.47 | 0.82 |
| open, subset FDR | 0.257 | 0.055 | 4.72 (2.56-9.52) | +0.014 (-0.030-0.082) | -0.020 | 0.46 | 0.84 |
| open, Sage q | 0.307 | 0.072 | 4.26 (2.40-8.44) | +0.013 (-0.033-0.085) | -0.022 | 0.44 | 0.83 |

Against the open search the E-value threshold does not beat a pick of the same number of spectra by peak count
(d interval includes 0; negative against n_edges and n_peaks_kept): it enriches open-search hits about as well as
"many peaks" does. Per-run tables: `primary_semi_subset.tsv` and the three `secondary_*.tsv` files.

## Consequence

The census and `-census_ids` stay as documented; triage remains "an E-value threshold, not a quality call". The
result supports describing the candidates as enriched for spectra a semi-specific second search identifies (pooled,
and in five of six runs), not a per-run guarantee. The census classifier (phase C) was not built.
