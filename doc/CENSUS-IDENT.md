# Census identifiability score (`-census_score`)

FASTag 1.16, work item 4 (use case C). `-census -census_score` gives every MS2 spectrum of the census an
`ident_score`: a frozen logistic model of how likely a standard database search of the run identifies it.
`-census_sorted_out <file>` writes the census rows ordered by that score. `-census_ids_exact` makes the
`-census_ids` join one-to-one, for label joins that feed a model or an evaluation.

The score is a ranking for review order. It is not a calibrated probability and not a quality call, and the
development result below decides whether it is worth more than the existing census triage.

## What is scored

- **Target.** Identification at q <= 0.01 (rank-1 target PSM) by one pinned search: Sage 0.14.7 through OpenMS
  SageAdapter (OpenMS 70cebcd144), the reviewed (Swiss-Prot) human entries of the pinned UniProt FASTA plus reversed
  decoys, 10 ppm precursor, 20 ppm fragment, fixed carbamidomethyl C, variable Met oxidation, trypsin with 2 missed
  cleavages, isotope errors -1 to 3, a spectrum without a charge tried at 2+ to 5+, one search per run (per-run FDR,
  no joint search across splits). A spectrum the model ranks high but this search cannot identify (a non-tryptic
  peptide, a protein outside the database, an unexpected modification) is a miss by definition: the score learns this search's reach, not intrinsic identifiability.
- **Features** (`src/CensusScore.h`, `FEATURE_COLUMNS`): `-log10(pre_best_evalue)`, `pre_best_len`,
  `pre_best_mean_conf`, `pre_tag_cover`, `n_found`, `n_peaks`, `n_compl`, `n_edges`, `n_peaks_kept`, `int_gini`,
  `charge_used`, `precursor_mz`. The four `pre_*` columns are new: the best of **all** tags of the selected
  precursor hypothesis before any database filter, so the score does not change with `-fasta` (the `best_*`
  columns are the reported tags, after it). A feature a spectrum does not have (no precursor, not prepared, no tag)
  is the lowest value of the run, so **every census status gets a score**; nothing is evaluated complete-case.
- **Per-run standardization.** Each feature is replaced by its mid-rank in the run, `(rank - 0.5) / n`, ties
  averaged. E-value scales (database size, tolerance, analyzer) therefore do not enter, and the score of a spectrum
  depends on the run it is in (and on subsampling).
- **Model.** Logistic regression on the 12 rank features, fitted once on the development runs only, coefficients
  frozen in `src/CensusScore.cpp` (and `tools/census_ident_model.json`, which a ctest compares with the C++ block).
  Repeated spectra are down-weighted in fitting and evaluation: weight 1 / cluster size, a cluster being the
  spectra with the same `charge_used`, precursor m/z within 10 ppm and RT within 60 s of its first spectrum
  (sorted by charge, m/z, RT). Every run has the same total weight. Ridge 1e-3 on the coefficients.

## Labels: the exact join

`tools/census_ident.py labels` joins a run's Sage `results.sage.tsv` to its census table:

- every rank-1 PSM must name one census spectrum by its native id; a PSM that names none is **unmappable** and
  refuses the run (never dropped);
- the Sage `filename` must be the run's mzML; the PSM's precursor m/z (`expmass / charge + proton`) must agree with
  the census row's within 20 ppm for at least 99% of PSMs (a renamed file of another run fails here, since Thermo
  native ids `scan=N` exist in every run);
- two rank-1 PSMs for one spectrum refuse the run;
- each census row gets `accepted` (target, q <= 0.01; label 1), `target_above_q`, `decoy` or `no_psm` (searched,
  nothing exported; label 0). `no_psm` and unmappable are never mixed.

The FASTag side, `-census_ids <idXML> -census_ids_exact`, applies the same rules to the idXML join and the two
must agree row by row (the dev pipeline checks it): no scan-number fallback, refusal when any reference names no
MS2 spectrum read, a spectrum has two identifications, a hit has no target/decoy annotation, or the file names no
run or another run than `-in`. The summary then adds `ids_exact`, `unidentified_with_psm` and
`unidentified_no_psm`. The default join is unchanged (scan fallback, warn above 1% and refuse above 50% foreign
references).

## Evaluation (`tools/census_ident.py eval`)

- Per-run AUC of the score for the first-search label, cluster-weighted, all census rows (every status);
  baselines best E-value (`-log10 pre_best_evalue`, untagged lowest) and `n_peaks`. Reported: mean over runs,
  ΔAUC = AUC(score) - AUC(baseline) per run, mean, with 95% percentile intervals from a run-cluster and a
  sample-cluster bootstrap (10,000 resamples, seed 20261118).
- Precision of the top 10% per run (cluster-weighted), and its gain over each baseline.
- Second-search recovery at a fixed review budget: among the spectra the first search left unidentified, the hits
  of a semi-enzymatic Sage search (the first search's settings, semi-enzymatic, plus protein N-terminal acetyl and
  N-terminal pyro-Glu from Q; subset FDR 1% among the unidentified, as `tools/census_triage_eval.py`) found in the
  top k by each ranker, with k = the run's census triage candidates (the triage set itself is the baseline to beat)
  and k = 10% of the unidentified spectra.
- Development numbers are leave-one-sample-out: the model scoring a run was fitted without that run's tissue.

## Development result (PXD000561, 78 runs of 13 dev samples; no held-out data)

Leave-one-sample-out, 77 evaluable runs:

| | ident_score | best E-value | n_peaks |
|---|---|---|---|
| mean per-run AUC | 0.744 | 0.714 | 0.649 |
| ΔAUC, run-bootstrap 95% CI | | +0.030 (0.025-0.036) | +0.095 (0.087-0.104) |
| top-10% precision | 0.621 | 0.585 | 0.465 |

Second-search recovery (semi-enzymatic, subset FDR 1%) at the census-triage budget: 11.73% of the top k by
`ident_score` vs 10.96% of the triage set (+0.77 points, CI 0.58-0.95); at 10% of the unidentified 16.1% vs 14.7%
(best E-value). The margins hold, but the gain over triage is small, so census triage stays the recommended list
and `-census_score` is experimental until a held-out test (draft preregistration, not run).

Label-join finding: SageAdapter (OpenMS 70cebcd144) writes no charge-1 PSM to its idXML (1,338 of 988,709 dev rows
differ from `results.sage.tsv` for that reason, one more for a `target+decoy` annotation), so labels come from the
Sage TSV.
