# Item #14r `-check_header_charge` (new rule): held-out result

Date 2026-11-10. Protocol `acceptance/1.13/PREREG-item14r.md`, frozen at 8d13581 (pushed before the run).
Candidate `feat/b113-hdrcharge` 8e3f127 (rule 2c253e2), FASTag sha256 509cec79d178e4b7e159c0faa0ad86d7af56431ffe8909ef73d0261db23fb835,
config CFG-14r-warn (`-check_header_charge warn -check_header_out hc.tsv -threads 16`). Run once, scored once on node `data`;
all ten FASTag runs and all scorers returned 0. Scorer hashes as frozen (`scorer.sha256`).

## Verdict: PASS

| Criterion | Requirement | Observed | Verdict |
|---|---|---|---|
| H0 | >= 4 of 5 runs evaluable, >= 200 wrong headers pooled | 5 of 5; 2,258 | met |
| H1 | pooled precision, Wilson 95 % lower bound >= 0.60 | 608/896 = 0.679 (0.647-0.708) | PASS |
| H2 | pooled sensitivity >= 0.20 | 608/2,258 = 0.269 | PASS |
| H3 | right headers flagged <= 0.5 % pooled, <= 1.0 % per run | 288/82,927 = 0.347 %; worst run 0.502 % (PXD071028) | PASS |

Truth: Sage 0.14.7 on the charge-stripped copy, PSMs with q <= 0.001. "Wrong" = header charge differs from the Sage charge. Flag = verdict `disagree`.

## Per run (files as given)

| Run | Class | Truth | Wrong | Flagged | TP | FP | Precision | Sensitivity | Right flagged |
|---|---|---|---|---|---|---|---|---|---|
| PXD037572 | qe | 2,750 | 140 | 81 | 78 | 3 | 0.963 | 0.557 | 0.115 % |
| PXD016408 | qe | 27,509 | 454 | 152 | 75 | 77 | 0.493 | 0.165 | 0.285 % |
| PXD033520 | qe | 3,157 | 42 | 20 | 14 | 6 | 0.700 | 0.333 | 0.193 % |
| PXD071028 | astral | 27,143 | 1,057 | 403 | 272 | 131 | 0.675 | 0.257 | 0.502 % |
| PXD080900 | astral | 24,626 | 565 | 240 | 169 | 71 | 0.704 | 0.299 | 0.295 % |
| pooled | | 85,185 | 2,258 | 896 | 608 | 288 | 0.679 | 0.269 | 0.347 % |

The pooled result is not uniform: PXD016408 alone has precision 0.493 and sensitivity 0.165, both below the pooled thresholds
(the criteria are pooled; only H3 has a per-run bound).

## Reported, not criteria

| | qe | astral | pooled |
|---|---|---|---|
| Precision (Wilson lower bound) | 0.660 (0.600) | 0.686 (0.649) | 0.679 (0.647) |
| Sensitivity | 0.263 | 0.272 | 0.269 |
| Right headers flagged | 0.262 % | 0.403 % | 0.347 % |
| Precision, flagged charge = Sage charge | 0.621 | 0.649 | 0.641 (574/896) |
| Flags on spectra whose rank-1 Sage hit is a decoy | 4 | 3 | 7 |

- Evidence: 806 of 896 flags come from MS1 isotope spacing (530 correct, 0.658), 90 from complement pairs (78 correct, 0.867).
- Chimera split: 165 of the 2,258 wrong headers are co-isolated cases; without them sensitivity 588/2,093 = 0.281, precision 588/876 = 0.671.
- Perturbed copies (header charge altered in every fifth scan): 16,584 wrong of 82,927; flagged 12,908, correct 12,671;
  precision 0.982, sensitivity 0.764 (qe 0.917, astral 0.664), flagged charge = Sage charge 0.955, right headers flagged 0.357 %.
- DEV reference: precision 0.75, sensitivity 0.33, right headers flagged 0.27 %. Held-out is lower on precision and sensitivity, higher on false alarms.

## Deviations and limits

No deviation after the freeze: no rerun, no re-scoring, no backup or exclusion rule triggered during the run. Before the freeze (all stated in the PREREG):

- Astral class is not a sample: the two runs are ranks 73 and 89 of 119 in the seeded order; the 87 candidates before and between them failed the stated rules.
- PXD071028 uses the backup file: the verification download of the chosen file was truncated (no PRIDE SHA-1 for the Astral files).
  PXD033520 and PXD080900 were restaged with the chosen file after the staging script got retries and resumable downloads.
- All five runs are affinity-purification samples, i.e. lower complexity than whole-proteome runs.
- Truth uses fixed C+57; PXD071028 (MMTS) and PXD033520 (no alkylation) therefore have no Cys peptides in the truth.
- FASTag found no usable index in the two Astral mzML files and scanned them instead; PXD071028: 244,461 MS2 read, 244,965 counted at staging.

## Files

`asgiven.tsv`, `perturbed.tsv`, `perturbed.summary.json`, `chimera.tsv`, `verdict.json`, scorer logs, `fastag.<PXD>.<copy>.log`,
`outputs.sha256` (the ten `hc.tsv`), `scorer.sha256`. Bulk data stay on `data:/scratch/kohlbach/b113/hdrcharge/heldout/r2/`.
