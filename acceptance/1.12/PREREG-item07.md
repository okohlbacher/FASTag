# PREREG-item07: #7 raw-DIA refusal, release test E7-03 (CFG-07)

Status 2026-11-08: **protocol fixed for the E7-03 sample as drawn; not run, not scored.** The sample does not meet
the plan's release-test design (below). Status of CFG-07: **`blocked_user_signoff`**, not `frozen`: whether E7-03 is
completed first (the Windows conversions) or scored as drawn is the user's decision (release readiness, decision 1).
If the user decides to score the sample as drawn, the commit that records that decision in this file sets CFG-07
`frozen` (README gate, with an appended registry row) and this protocol applies unchanged; if the missing files are converted and added, the manifest changes and this file is amended before any
run. CFG-07 is scored exactly once; on failure the rule is not re-tuned on this set (a new fresh set is drawn).
Source: PLAN-data-types.md #7 (Release test, Acceptance), registry E7-03, E7-09, E7-10, HO-07-E7-03.

## Frozen software and config

| What | Value |
|---|---|
| RC | a117801; FASTag.bin `c4c2ad67fcd9106e474f552267f7cdfefe107f394b268bbc236308b773e4d7f3`; bundle SHA256SUMS `93a1ad6d1184b156febb15b9f564e36a0a974f989fe9e5e7d8cf4849927cc051` |
| CFG-07 | `RC defaults (-acquisition_check refuse, probe 4000; thresholds frozen at 62abb64, E7-09)`, param_hash `07d12e1e8f712977793055988c1127914972a3e9c5a478d6b29fb42276d9f550` |
| Scorer | `scorers/score_item07.py` `b135aa9b5b9db5af7507ab81b5abd3f770c30590af7542789e3ad7ac6b0b750e`, `scorers/acclib.py` `d2342eb4c15e5801d9c13f2edcd1e56cec70349c941df0db2d061bb6630eeedf` |

## The sample as drawn, and its shortfall

`manifests/item07-E7-03.tsv` (sha256 `ae0e4e5e932acba6cd523f3efe2643e69d5f059ac3bf4c023628a73acd54917a`, registry
HO-07-E7-03 / E7-10): 214 PRIDE files from 214 PXDs, drawn 2026-11-08 by `e7-03-sample/sample.py` after the freeze
(E7-09). Staged with sha256: 186 conversions (149 non-DIA, 37 DIA) and 37 pseudo-DDA files (DIAspeXtract 1.7.0 for
the 23 Thermo DIA files, diaTracer 2.2.1 for the 14 timsTOF .d files).

| Stratum class | Drawn | Convertible on Linux, staged | Not staged |
|---|---|---|---|
| DIA_orbitrap | 12 | 12 | 0 |
| DIA_astral | 12 | 12 (DIA_astral.03 is a timsTOF .d drawn by project metadata) | 0 |
| DIA_diapasef | 12 | 12 | 0 |
| DIA_swath | 12 | 1 (DIA_swath.04, a timsTOF .d drawn by project metadata) | 11 SCIEX .wiff |
| non-DIA (DDA, PRM, SureQuant/inclusion, WWA) | 166 | 149 | 17 (11 SCIEX .wiff, 3 Agilent .d, 2 Bruker .baf, 1 Waters .raw) |
| pseudo-DDA (from the 37 staged DIA files) | - | 37 | - |

**Shortfall, stated explicitly:**

1. **DIA 37 < 40.** The plan requires at least 40 DIA files; 37 are scorable.
2. **SWATH/variable windows is not covered.** The only scorable DIA_swath file is a timsTOF .d (diaPASEF in fact);
   no SCIEX SWATH file is scorable without the 11 .wiff conversions (msconvert on Windows). DIA_swath has 1 scored file
   (< 5), so it is reported separately and does not gate.
3. The non-DIA side reaches >= 150 only with the 37 pseudo-DDA files (149 + 37 = 186 must-pass units; without
   pseudo-DDA 149 < 150).
4. 17 vendor non-DIA files are not scored (15 of DDA_qtof, 1 of DDA_qexactive, 1 of DDA_ddapasef); the Q-TOF stratum
   has 1 scorable file of 16.

Scoring the sample as drawn therefore tests the refusal on Orbitrap, Astral and diaPASEF DIA and the pass on
Thermo/Bruker DDA, PRM, SureQuant, WWA and pseudo-DDA, but not on SWATH and hardly on Q-TOF. The scorer prefixes
its verdict with `SAMPLE_SHORTFALL` while the design is not met.

## FASTag runs

One run per staged unit with CFG-07 (RC defaults, no added option): every `fastag_input` (conversion) and every
`pseudo_input` of a DIA file. Command: `FASTag -in <unit> -out tags.tsv -threads <n>` in
`runs/CFG-07/item07-E7-03/<dir>/<stem>/` (`jobs/example-fastag.slurm`, OPTS empty), with `FASTAG_RC=<rc>` appended
to `run.log`. The probe runs before any output is opened; a refusal leaves no output.

## Truth labels (no search; fixed before any run)

- A unit's label is its drawn stratum's class in the manifest (column `class`): `nonDIA` units and every pseudo-DDA
  unit **must pass**; `DIA` conversions **must be refused**.
- No relabelling after the run: a file whose project metadata put it in the wrong stratum (for example DIA_astral.03
  and DIA_swath.04, timsTOF .d) counts as drawn. For every unit whose outcome disagrees with its label the window
  listing (isolation targets and widths of the first MS2) is reported next to it; it does not change the verdict.

## Outcomes, denominators, strata and pooling

- refused: FASTAG_RC 11 and a `FASTAG_REFUSED reason=raw_dia` line in run.log; passed: FASTAG_RC 0; anything else
  (other exit code, missing log) = RUN_FAILED.
- Must-pass denominator: the must-pass units with outcome passed or refused (149 conversions + 37 pseudo-DDA when
  every run completes). Strata are pooled for (a).
- DIA denominator per stratum: the stratum's staged DIA conversions with outcome passed or refused. A NOT_STAGED file
  is listed and never counted as a pass or a refusal.

## Acceptance (PLAN-data-types #7; must pass before release)

- (a) **0 refusals** of must-pass units. Reported with it: the one-sided exact 95% upper bound of the false-refusal
  rate (Clopper-Pearson; at 0 refusals 1 - 0.05^(1/n), 1.6% at n = 186).
- (b) **>= 90% refused in each DIA stratum** with at least 5 scored files (DIA_orbitrap, DIA_astral, DIA_diapasef as
  drawn); a stratum with fewer than 5 scored files (DIA_swath: 1) is reported separately and does not gate.
- Any RUN_FAILED unit makes the verdict INCONCLUSIVE (the unit is investigated, not dropped).
- Design check (reported with the verdict): >= 150 must-pass units, >= 40 scored DIA files, all four DIA strata
  gating. Not met by this sample (`SAMPLE_SHORTFALL`).

## Scoring command

    python3 -I scorers/score_item07.py <out> --acc acceptance/1.12 --runs <root>/runs

Output (`result.json`, `units.tsv`) to `results/item07/` with a registry row.

## DEV test of the scorer (DEV outputs only)

`score_item07.py <out> --dev-sweep scorers/tests/e7-02-sweep.tsv` applies the same rules to the frozen calls of the
E7-02 development sweep (183 data sets + fixtures, adjudicated labels): false refusals 0 of 179 (upper bound 1.66%),
refused DIA_orbitrap 16/16, DIA_diapasef 10/10, DIA_fixture 5/5; DIA_astral 4/4 and DIA_orbitrap_charged 0/3 reported
separately (< 5 files), design check not met. These are the calls of the freeze build (62abb64, FASTag.bin c6d83fed...) recorded in the sweep table
(columns call_frozen_exit, FASTAG_REFUSED_frozen), counted by the scorer. Output: `scorers/tests/dev_results/item07.txt`.
