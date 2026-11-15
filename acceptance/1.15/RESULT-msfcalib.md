# RESULT-msfcalib: `calibrate_mass 2` in the MSFragger export, held-out test: **FAIL**

Protocol `acceptance/1.15/PREREG-msfcalib.md` (freeze 1 1b84b580, freeze 2 0fa9b7b4). Candidate
`post115/msfragger-calib` 48a2f22c. Run once on node data, 2026-11-15 21:10-22:11 UTC, scored once
(`msfcalib/results/runs.tsv`, `verdict.tsv`). 10 staged runs, 9 evaluable (MC01: arm b identified 30 spectra).

**Consequence (PREREG):** the export goes back to `calibrate_mass 0`; `calibrate_mass 2` is not a validated default.

| Criterion | Threshold | Result | Verdict |
|---|---|---|---|
| C1 | every run: exits 0, files unchanged, log line, a2 identifies | 10 of 10 | PASS |
| C2 | kept share of a2 in every evaluable run >= 0.80 | min 0.919, median 0.970, pooled 0.961 | PASS |
| G1 | median speed-up of a2 > 1.0 | median 1.108 (min 0.947, max 1.294) | PASS |
| G2 | entrapment FDP of aE2: pooled <= 1.5 %, each run <= 2.0 % | pooled 1.10 %, max 1.28 % | PASS |
| P1 | median kept share a2 - a0 > 0 | +0.025 (min +0.015, max +0.061; higher in 9 of 9) | PASS |
| P2 | no run crosses 2.0 % FDP from aE0 to aE2 | none | PASS |
| P3 | speed-up of a2 > 1.0 in every evaluable run | MC02 0.947, MC10 0.974 | **FAIL** |
| **Overall** | | | **FAIL** |

Arm 0 (the 1.14.0 export), for information, no verdict: C2 min 0.883, median 0.917, pooled 0.930; G1 median 1.899
(min 1.601); G2 pooled 1.12 %, max 1.32 %.

Per run (evaluable runs; kept share a0 -> a2, speed-up a0 -> a2): MC02 0.917 -> 0.960, 1.64 -> 0.95; MC03 0.912 ->
0.941, 1.90 -> 1.16; MC04 0.952 -> 0.970, 1.97 -> 1.11; MC05 0.909 -> 0.970, 1.95 -> 1.11; MC06 0.903 -> 0.919, 1.83 ->
1.21; MC07 0.883 -> 0.920, 1.95 -> 1.06; MC08 0.954 -> 0.980, 2.34 -> 1.29; MC09 0.963 -> 0.978, 1.80 -> 1.11; MC10
0.955 -> 0.978, 1.60 -> 0.97. Calibration roughly doubles the MSFragger time on the shortlist (a2 42-88 s vs a0
25-46 s; full search b 59-97 s). r1 and r2 identified the same peptides in every run and arm.

**Deviations:** none from the protocol. Record of the frozen scripts: they write no load snapshot per run or arm;
only the start snapshot exists.

**Shared-node context (timing):** node data was shared with other users throughout. Load at start 56.7 (0.25 per core,
224 cores), including another session's diaTracer (16 threads) and DIA-Umpire tuning queues; those DIAspeXtract tuning
jobs were stopped (SIGSTOP) from about 22:15 CET (21:15 UTC, during MC02) to the end of the run. a0 and a2 were
interleaved and mirrored within each run, so both arms saw similar load; the speed-ups are single-node wall clocks.

Files: `msfcalib/results/runs.tsv`, `msfcalib/results/verdict.tsv`; run directories and logs on node data under
`/scratch/kohlbach/acc115/msfcalib/runs/`, `run_all.log`, `load_start.txt`.
