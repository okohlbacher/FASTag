# e703 / acqcheck2: held-out test of the revised raw-DIA rule

**Verdict: PASS** (preregistered, run once, scored once, 2026-11-10).

| | Candidate (`feat/b113-acqcheck2` 7d2522fb) | Base (`integration/1.13` e21d8033, reported only) | Criterion |
|---|---|---|---|
| K1 refused among truth non-DIA | **0 of 58** (upper 95 % bound 5.0 %) | 0 of 58 | 0, n >= 40 |
| K2 refused among truth DIA | **35 of 37 (94.6 %)** | 19 of 37 (51.4 %) | >= 90 %, n >= 25 |

Sample: 98 public PRIDE projects, one Thermo `.raw` each, disjoint from the spent E7-03 sample and all reserved
lists (0 of 98 overlaps); all 98 staged and converted; 95 scored, 3 excluded as truth UNCLEAR by the frozen rule
(AQ2.DIA_orbitrap.13, AQ2.DDA_qexactive.06, .12: non-dependent scans that neither tile nor look targeted;
none was refused). Truth per file from Thermo scan-filter dependence and isolation-window coverage over all MS2
(`truth.py`, frozen before the run), not from the drawn label.

By truth and drawn stratum (n, candidate refused, base refused):

| Truth | Stratum | n | candidate | base |
|---|---|---|---|---|
| DIA | DIA_orbitrap | 36 | 35 | 19 |
| DIA | DDA_qexactive | 1 | 0 | 0 |
| non-DIA | DIA_orbitrap (data-dependent runs in DIA projects) | 8 | 0 | 0 |
| non-DIA | DDA_exploris / DDA_qexactive / DDA_tribrid | 13 / 11 / 14 | 0 | 0 |
| non-DIA | PRM / WWA_DDA | 8 / 4 | 0 | 0 |

The 16 files the candidate refuses and the base does not: 15 were DIA-like in the base (one charge on every MS2),
1 was DDA in the base (AQ2.DIA_orbitrap.22, 38 windows revisited without one cycle; the only held-out file that
exercises the closed-window-set criterion).

The 2 misses (described after scoring, not re-scored):
- AQ2.DIA_orbitrap.41 (PXD083538): 60 windows, period 1.0, but mixed charges on the MS2; called DIA-like (warned, tagged).
- AQ2.DDA_qexactive.02 (PXD001164): no data-dependent scans, 5384 distinct 2 Th windows over 1107 m/z; no repeating
  scheme within the 4000 probed MS2; called DDA.

Limits: Thermo Orbitrap-type files only; no Astral, timsTOF or SCIEX file in this sample (their calls are as in
1.12 and were tested, with the failed verdict, in E7-03). The closed-window-set criterion was exercised by one
held-out file. 22 % of the files drawn as DIA by PRIDE text (8 of 37 with a truth) are data-dependent runs.

Deviations from the PREREG: none in the scored run. Staging needed retry passes (addendum 1, pushed before the
run; PRIDE refused connections); the automatic start of `run.sh` after staging did not fire, it was started by
hand once (02:27 CET, 39 s).

Where: branch `acc113r/acqcheck`, `acceptance/1.13/PREREG-acqcheck2.md` (freeze 1982895, addendum f60c5c7),
`manifests/acqcheck2.tsv`, `disjointness/acqcheck2.tsv`, `acqcheck2/scorers/`, `acqcheck2/results/`
(`units.tsv`, `summary.txt`, `truth.tsv`, `probe.cand.tsv`, `probe.base.tsv`, `stage.tsv`, `run.sha256`).
Binaries and files: `data:/scratch/kohlbach/b113/acqcheck2/`.
