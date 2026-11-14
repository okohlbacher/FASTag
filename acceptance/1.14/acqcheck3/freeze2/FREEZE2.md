# acqcheck3 freeze 2 (audited manifest; before any FASTag binary reads a held-out file)

Date: 2026-11-14 (CET). No FASTag run has started (`run.started` absent on data).

## Staging (PREREG rule, 4 passes, hard stop 2026-11-15 12:00 CET not reached)

- Node data (`stage.sh`, Thermo + Bruker, 130 rows incl. backups): 122 staged, 8 not staged; done 2026-11-14T00:38:51+01:00.
  Not staged: AQ3.DIA_diapasef.08, .10 (fetch_FAIL); AQ3.DIA_diapasef.03 (rc 97, .d unpack failed: `mv: cannot stat .../dtmp/TTU_MB_..._6471.d/: Not a directory`);
  AQ3.SRM.08 (rc 97); AQ3.PRM.05 (rc 134, Bruker conversion); AQ3.PRM.07, AQ3.SRM.02, AQ3.WWA_DDA.01 (rc 1, Thermo conversion).
  All count as not staged; no extra attempt outside the frozen passes.
- Flash (`stage_sciex.ps1`, SCIEX, 40 rows): all 40 staged (ALL_DONE 2026-11-13T18:09:30); `pull_sciex.sh` copied all 40 mzML to data, sha256 equal (stage.sciex.done 2026-11-14T04:06:48+01:00).
- Backup rule (`select.py`, `select.out`): 146 selected rows, 139 staged, 7 not staged. Replacements: DIA_diapasef.03/.08/.10 -> .16/.17/.18;
  PRM.05 -> PRM.13; PRM.07 -> PRM.14; SRM.02 -> SRM.07. Not replaced: WWA_DDA.01 (stratum has no backup). AQ3.SRM.08 was a backup.

## Truth (`truth.py`, prep2.sh) and audit

`audited.prep2.tsv` is prep2's output (sha256 0b85f672...). `audited.tsv` (sha256 **b47b81c48144c0de16817be7f2d3b3251d87c23f83edafcb52eeab33614a6b49**,
the frozen input of `run.sh`) equals it except for (a) audit notes appended to the `note` column of the 16 rows whose truth differs from the
drawn class or is UNCLEAR, and (b) the drop below. No truth label changed (columns 1-15 identical).

Audit (PRIDE v3 record; linked paper where the record defers to it), all 16 rows: every truth label is consistent with the record.
- Drawn DIA, truth NONDIA (6): DIA_astral.10 (Exploris DDA run in a mixed Exploris/Astral project), DIA_diapasef.13 (DDA-PASEF run of a
  DDA+DIA project), DIA_swath.07, .14, .15 (IDA library/identification runs of SWATH projects), DIA_orbitrap_scheme.15 (DDA library run, `dda13`).
- Drawn DDA_astral, truth DIA (7): DDA_astral.01, .02, .04, .05, .06, .07, .08 (records or papers: Astral DIA, 4 Th windows, directDIA).
- UNCLEAR, excluded (3): PRM.01 (KiP-PRM with dependent MS2, 37 % dependent), PRM.08 (DDA along with PRM in the same runs), SRM.03 (QTRAP MRM, no MS2 spectra).

## Cross-branch drop rule (PREREG: selected PXD on another acc114/* branch is dropped, no replacement)

Branches checked (fetched 2026-11-14): origin/acc114/aspn, acc114/compltol3, acc114/exactonly. Files naming more than 2,000 PXDs are
catalogues and skipped, as in `collect_pxd.py` (h2r_pride_candidates.tsv 19,555; aspn control_trypsin_order.tsv 2,578).
One hit: **PXD049383 (AQ3.DIA_swath.13, staged, truth DIA)** is named in acc114/aspn `aspn/inputs/aspn_pool_raw.tsv` and
`aspn_epmc_articles.tsv` -> `staged = dropped_acc114`.

## Units entering the run (known before the run, from truth only)

138 staged rows with truth: 135 DIA/NONDIA units after the drop and 3 UNCLEAR.
DIA 60 (Astral 21, timsTOF 14, SCIEX 11, Orbitrap 14); NONDIA 75 (Orbitrap 32, SCIEX 21, timsTOF 19, **Astral 3**).
**K3 Astral NONDIA has n = 3 < 8**: by the frozen rule that row is INCONCLUSIVE unless a refusal makes it FAIL, so the overall verdict
can be FAIL or INCONCLUSIVE but not PASS. This is recorded before the run; no criterion is changed, and the unused Astral DDA backups are not
used (the backup rule replaces only unstaged main files).

## Deviations recorded at freeze 2

1. `manifests/acqcheck3.tsv` and `disjointness/acqcheck3.tsv` were not in the freeze-1 commit (repo `.gitignore` `*.tsv`); their sha256
   equal the values frozen in the PREREG and SHA256SUMS (25599bb5..., 741d51bd...). Added here with `git add -f`, unchanged.
2. Audit notes are kept in the `note` column of audited.tsv (one file), prep2's output is kept as audited.prep2.tsv.
