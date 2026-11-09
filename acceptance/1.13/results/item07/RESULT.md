# #7 E7-03 release test: scored once, verdict FAIL

CFG-07 (the RC binary c4c2ad67 at defaults, `-acquisition_check refuse`, thresholds frozen at 62abb64) was run on all
250 staged units of `acceptance/1.13/manifests/item07-E7-03.tsv`: 213 conversions and 37 pseudo-DDA files. The
runs were on node data on 2026-11-09 from 22:13:02 to 22:27:34 CET, at most 4 at a time with `-threads 8`. The
manifest, PREREG amendment 1 and the frozen config had been committed and pushed at 22:12:41 (1e31244). The scorer is
`acceptance/1.12/scorers/score_item07.py` b135aa9b, unchanged, with acclib fe387a34, run once from a git archive of
1e31244. Its output is `result.json` (sha256 79abe2d7...) and `units.tsv` (06719309...). There were no RUN_FAILED
units and no input sha256 mismatches. One file is NOT_STAGED (DDA_ddapasef.08).

| Endpoint | Result | Criterion | |
|---|---|---|---|
| (a) false refusals of must-pass units | **8 of 202** (exact one-sided 95% upper bound 7.0%) | 0 | **FAIL** |
| (b) DIA_orbitrap refused | 7 / 12 (58%) | >= 90% | **FAIL** |
| (b) DIA_astral refused | 12 / 12 | >= 90% | pass |
| (b) DIA_diapasef refused | 12 / 12 | >= 90% | pass |
| (b) DIA_swath refused | 10 / 12 (83%) | >= 90% | **FAIL** |
| design check | 202 must-pass units, 48 DIA, four DIA strata gating | met | |
| **verdict** | **FAIL** | | |

Every pseudo-DDA unit passed (37/37). So did every unit of DDA_qexactive, DDA_exploris, DDA_tribrid,
DDA_ddapasef, DDA_qtof, DDA_iontrap_hybrid, PRM, SureQuant/inclusion and WWA. All 8 false refusals are in
DDA_astral (8 of its 16 files).

## Window listing of every disagreement (reported per the PREREG; it does not change the verdict)

The truth label is the class of the stratum the file was drawn into by its project's metadata. It is not
relabelled. Below is the run's own `Acquisition check:` line for each disagreement.

**Must pass, refused (8, all DDA_astral).** Every one shows a raw-DIA scheme: the same isolation windows repeat
every cycle (periodicity 1), they tile the range (coverage 1), and 100% of the MS2 are uncharged.

| id | PXD | windows x width | range (m/z) |
|---|---|---|---|
| DDA_astral.01 | PXD078553 | 113 x 4 Th | 350-803 |
| DDA_astral.02 | PXD065353 | 300 x 2 Th | 380-981 |
| DDA_astral.03 | PXD051942 | 150 x 4 Th | 380-981 |
| DDA_astral.06 | PXD077117 | 20 x 20 Th | 400-801 |
| DDA_astral.07 | PXD065350 | 300 x 2 Th | 380-981 |
| DDA_astral.09 | PXD070580 | 300 x 2 Th | 380-981 |
| DDA_astral.11 | PXD066686 | 300 x 2 Th | 380-981 (file name: `..._300SPD_..._380_980_...`) |
| DDA_astral.16 | PXD069234 | 150 x 4 Th | 481-1081 |

These are narrow-window Astral DIA (nDIA) runs in projects that the draw put into the DDA_astral stratum. The
draw's rule (sample.py) assigns a stratum from the project's title, description, protocols and keywords plus its
instrument list, so a DIA project that does not name DIA in that text lands in DDA. By the preregistered rule they
count as false refusals.

**Must be refused, passed (7).**

| id | PXD | call | listing |
|---|---|---|---|
| DIA_orbitrap.02 | PXD023174 | DDA | no repeating scheme: periodicity 0.01, 1439 distinct precursor m/z, 0% uncharged |
| DIA_orbitrap.09 | PXD069053 | DDA | no repeating scheme: periodicity 0.01, 2037 distinct precursor m/z, 0% uncharged |
| DIA_orbitrap.03 | PXD041099 | DIA-like, tagged with a warning | 41 windows x 18 Th tile 350-1150 (periodicity 1), but the MS2 carry a charge (0% uncharged) |
| DIA_orbitrap.08 | PXD030283 | DIA-like, tagged with a warning | 20 windows x 25.5 Th tile 406-1179 (periodicity 1), but charged (0% uncharged) |
| DIA_orbitrap.12 | PXD045988 | DDA | periodicity 0.5, cycle 12, but 38 distinct precursor m/z, 100% uncharged |
| DIA_swath.07 | PXD025791 | DDA | no repeating scheme: periodicity 0.02, 1515 distinct precursor m/z, 100% uncharged |
| DIA_swath.09 | PXD004880 | DDA | no repeating scheme: periodicity 0.03, 1030 distinct precursor m/z, 100% uncharged |

Descriptively, these fall into three groups:

- **No repeating scheme (4 files: orbitrap.02, .09, swath.07, .09).** They have 1000-2000 distinct precursor m/z
  and periodicity near 0. That is what DDA/IDA looks like, for example the library runs that DIA projects often
  deposit next to their DIA runs.
- **Charged tiling DIA (2 files: orbitrap.03, .08).** The windows are a DIA scheme, but the converted MS2 carry a
  charge state. By design the rule only warns on such runs. The thresholds froze that design (E7-01/E7-09).
- **A genuine miss (orbitrap.12).** The run is uncharged and periodic, but its 38 distinct m/z do not match a
  cycle of 12.

Even if all 12 apparent label errors were set aside, (b) DIA_orbitrap would be 7 of 10 (70% < 90%). The test
would still FAIL. This is reported only to place the result. It is not a re-scoring.

## Consequences (no change made here)

- CFG-07 is scored. It is never re-scored, and the rule is not re-tuned on this set (PREREG). A new rule or new
  thresholds would need a fresh sample. A fresh draw needs a stratum assignment based on the file (for example
  the window listing), not on project text, so that label errors like the 8 DDA_astral files do not decide the
  verdict.
- The default `-acquisition_check refuse` shipped in 1.12.0/1.12.1 on the E7-02 sweep evidence. This held-out
  test does not confirm it: 8 of 16 files drawn from "DDA" Astral projects were refused. Their own listings show
  raw DIA. Whether the default stays `refuse` is the user's decision. The README states the result.
