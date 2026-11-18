# acqcheck3 held-out result: raw-DIA acquisition check of FASTag 1.13.4 (Astral, timsTOF, SCIEX)

**Verdict: INCONCLUSIVE** (scored once, 2026-11-14). No criterion failed. 0 of 75 non-DIA files were refused,
60 of 60 DIA files were refused. The overall verdict cannot be PASS because one gate row, K3 Astral NONDIA, has
n = 3 against a minimum of 8. This shortfall was known and recorded at freeze 2, before the run.

Protocol: `acceptance/1.14/PREREG-acqcheck3.md` on `acc114/acqcheck3`. Freeze 1 1315abe, addendum 1 8d77813,
**freeze 2 b7387985** (audited.tsv sha256 b47b81c48144c0de16817be7f2d3b3251d87c23f83edafcb52eeab33614a6b49).
Candidate: FASTag 1.13.4 (v1.13.4 = 0ddff9b), binary sha256 a37c8b06...253f, checked in `run.sha256`, with all
options at their defaults (`-acquisition_check refuse`).
Run: `run.sh` on node data, 2026-11-14 04:23:49 to 04:38:23 CET, 135 units, 4 at once, 2 threads each. All 135
units exited on their own: 60 exited with rc 11 and printed `FASTAG_REFUSED reason=raw_dia`, 75 exited with rc 0.
No unit was stopped or timed out. The `-probe_input` metadata probe agreed with the run on all 135 units.

| Row | Criterion | n (min) | Result | Verdict |
|---|---|---|---|---|
| K1 | NONDIA refused = 0 | 75 (50) | 0 of 75 (upper 95 % bound 3.9 %) | PASS |
| K2 | DIA refused >= 90 % | 60 (40) | 60 of 60 (100 %) | PASS |
| K3 | Astral DIA >= 90 % | 21 (8) | 21 of 21 | PASS |
| K3 | Astral NONDIA = 0 | 3 (8) | 0 of 3 (upper bound 63.2 %) | INCONCLUSIVE |
| K3 | timsTOF DIA >= 90 % | 14 (8) | 14 of 14 | PASS |
| K3 | timsTOF NONDIA = 0 | 19 (8) | 0 of 19 (upper bound 14.6 %) | PASS |
| K3 | SCIEX DIA >= 90 % | 11 (8) | 11 of 11 | PASS |
| K3 | SCIEX NONDIA = 0 | 21 (8) | 0 of 21 (upper bound 13.3 %) | PASS |
| K4 | closed-window DIA >= 90 % | 0 (5) | no unit (every DIA file had a single cycle, per >= 0.9996) | INCONCLUSIVE |
| K5 | recurring/targeted NONDIA = 0 | 57 (10) | 0 of 57 (upper bound 5.1 %) | PASS |

By stratum: DIA_astral 14/14 refused, DDA_astral files that are really DIA 7/7, DIA_diapasef 14/14,
DIA_swath 11/11, DIA_orbitrap_scheme 14/14. None of these non-DIA groups had a refusal: ddaPASEF 0/19, SCIEX IDA
0/21, Orbitrap and Astral DDA 0/25 (DDA_astral 7, DDA_recurring 10, WWA_DDA 1, SRM-stratum DDA 5, plus one
non-DIA file each from the DIA_astral and DIA_orbitrap_scheme strata), and the PRM stratum 0/10 (8 targeted, 2 DDA). Files: `acceptance/1.14/acqcheck3/results/summary.txt`, `units.tsv`.

## Staging and selection

- Data (Thermo and Bruker): 122 of 130 rows staged in 4 passes. Not staged: DIA_diapasef.08 and .10 (fetch failed);
  DIA_diapasef.03 (.d unpack: `mv: cannot stat ... Not a directory`); SRM.08 and PRM.05 (Bruker conversion);
  PRM.07, SRM.02 and WWA_DDA.01 (Thermo conversion). Flash (SCIEX): 40 of 40 staged and pulled to data with matching sha256.
- Backup rule: DIA_diapasef.03/.08/.10 replaced by .16/.17/.18, PRM.05 by PRM.13, PRM.07 by PRM.14, SRM.02 by SRM.07.
  WWA_DDA.01 was not replaced (the stratum had no backup). Result: 146 selected rows, 139 staged.
- Excluded from scoring: 11 rows. These are 7 not staged, 1 dropped (cross-branch rule) and 3 with truth UNCLEAR
  (PRM.01 and PRM.08, which mix dependent and targeted MS2; SRM.03, an MRM file with no MS2 spectra).
- Truth audit (16 rows whose truth differs from the drawn class or is UNCLEAR): every truth label agrees with
  the PRIDE record, or with the linked paper where the record defers to it. Seven files drawn as DDA_astral are
  Astral DIA runs. Six files drawn as DIA are DDA, IDA or ddaPASEF runs from mixed DDA+DIA projects. No label was changed.

## Deviations and notes

1. **Cross-branch drop.** The freeze-2 rule drops a file whose project appears on another acc114/* branch.
   AQ3.DIA_swath.13 (PXD049383, truth DIA) is listed in two acc114/aspn input files
   (`aspn_pool_raw.tsv` and `aspn_epmc_articles.tsv`), so it was dropped and not replaced. Files naming more than
   2,000 PXDs were treated as catalogues and skipped, which is collect_pxd's rule.
2. **Freeze-1 commit was missing two files.** The manifest and disjointness `.tsv` files were not committed at
   freeze 1 because the repo's `.gitignore` excludes `*.tsv`. They were added unchanged at freeze 2 with
   `git add -f`. Their sha256 equal the freeze-1 values.
3. **Audit notes location.** The audit notes are in the `note` column of audited.tsv. prep2's original output is
   kept as `freeze2/audited.prep2.tsv`. The two files are identical in columns 1-15.
4. **Astral NONDIA shortfall.** Only 3 units, because 7 of the 14 DDA_astral draws were really DIA and 4 were
   Exploris or Eclipse runs. Under the frozen rules this row is INCONCLUSIVE. No criterion was lowered, and the
   unused backups were not added (the backup rule replaces only main files that failed to stage).
5. **K4 had no units.** The DIA_orbitrap_scheme stratum (MSX, staggered and variable windows) produced no file
   without a single cycle.
6. **Lost ssh session.** The ssh session that launched `run.sh` was reset by the gateway during the run. The
   nohup'd run was not affected: 135 of 135 units completed and `run.done` was written. The run was not restarted.
7. Hard stop (2026-11-15 12:00 CET) not reached. Nothing was re-scored.

## Reading

FASTag 1.13.4 refused every DIA file in this sample: Astral, diaPASEF, SWATH and Orbitrap window schemes,
including 7 Astral DIA runs that PRIDE metadata had labelled DDA. It refused no non-DIA file: Astral or
Orbitrap DDA, ddaPASEF, SCIEX IDA, PRM, or recurring-window DDA. The test is inconclusive only for Astral DDA
(3 files), and it had no closed-window DIA file to test (K4).
