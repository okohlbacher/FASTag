# census-triage-2: result (PREREG-census-2, scored once on 2026-11-10)

Verdict: **PASS**. Freeze 7aa2ae3; staged manifest 1d7d7a0; candidate `feat/b113-census` 16b50f4, binary
`95a57172...ea91`; 8 runs, all `RUN_DONE` at the first attempt, all scored; `verdict.txt` is the scorer's output.

| | Criterion | Result | |
|---|---|---|---|
| E0 | >= 6 of 8 runs evaluable | 7 of 8 (PXD042242 not evaluable: no hit among its 10,187 unidentified spectra, q_min 0.034) | pass |
| E1 | pooled rr >= 2.0, CI lo >= 1.5 | rr 5.32, CI 2.59 to 8.25 (triage 5,776 / 53,187 = 10.9%; rest 3,253 / 159,443 = 2.0%) | pass |
| E2 | rr > 1 in every evaluable run | min 1.75 (PXD068740), max 21.1 (PXD044743) | pass |
| E3 | pooled d vs n_peaks > 0, CI lo > 0 | d +0.0229, CI 0.0176 to 0.0286 (baseline 4,557 / 53,187 = 8.6%) | pass |

| Run | File | U | triage | hits in U | P(hit\|triage) | P(hit\|rest) | rr | d vs n_peaks |
|---|---|---|---|---|---|---|---|---|
| PXD003400 | chosen | 4,116 | 1,246 | 436 | 0.204 | 0.063 | 3.21 | +0.067 |
| PXD028322 | chosen | 38,368 | 4,429 | 789 | 0.108 | 0.0092 | 11.78 | +0.021 |
| PXD032145 | chosen | 7,619 | 3,103 | 260 | 0.051 | 0.022 | 2.29 | +0.013 |
| PXD042242 | chosen | 10,187 | 588 | 0 | 0 | 0 | undefined (not evaluable) | 0 |
| PXD044743 | chosen | 32,097 | 8,948 | 174 | 0.017 | 0.0008 | 21.10 | +0.013 |
| PXD067571 | backup | 46,291 | 16,939 | 4,916 | 0.217 | 0.042 | 5.14 | +0.022 |
| PXD068740 | backup | 38,769 | 4,711 | 811 | 0.034 | 0.019 | 1.75 | +0.032 |
| PXD073999 | chosen | 35,183 | 13,223 | 1,643 | 0.068 | 0.034 | 1.99 | +0.027 |

Reported without a verdict (pooled): recall of triage 0.64; AUROC of -log10(best E-value) 0.80; d vs `n_edges`
+0.0197 (CI 0.0103 to 0.0314); d vs `n_peaks_kept` +0.0243 (CI 0.0168 to 0.0319). Semi with Sage's q-values: rr 4.32
(CI 2.31 to 6.21), d +0.0244 (CI lo 0.0164). Open search, subset q: rr 4.41 (CI 3.10 to 6.31), d +0.0021 (CI lo
-0.0185); open, Sage's q: rr 4.25 (CI 2.93 to 5.85), d -0.0032 (CI lo -0.0277). Against the open search the triage
set is enriched over the rest but not better than the peak-count baseline.

## Deviations and events

- PXD067571 and PXD068740: the chosen file failed staging. Neither has a PRIDE SHA-1; the second, verifying
  download was cut off by the server (curl 18), so its sha256 differed. The backup file was staged once and passed,
  as the PREREG rule says. The chosen files were not run.
- No run was restarted, none excluded (`excluded_runs.tsv` does not exist). The scoring driver was started once.
- Nothing else deviates from PREREG-census-2.

Files: `verdict.txt`, `primary_semi_subset.tsv`, `secondary_*.tsv`, `runs_*.tsv`, `outputs.sha256.tsv` (sha256 of
every run's input and outputs; the mzML hashes equal the staged manifest), `staging/`, `logs/`. Run data:
`data:/scratch/kohlbach/b113/census/heldout/census2`.
