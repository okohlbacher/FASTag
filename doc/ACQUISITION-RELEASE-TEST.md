# Raw-DIA check (#7): held-out release test E7-03

Status: **scored once, FAIL** (acceptance/1.13, 2026-11-09). This changes no code, default or output. The check
(`-acquisition_check refuse`, the default since 1.12.0) is exactly what main ships: `src/` is identical between the
frozen RC a117801 and 1.12.1.

## Protocol

- **Sample:** 214 PRIDE files from 214 projects, drawn on 2026-11-08 after the thresholds were frozen (62abb64,
  registry E7-09). The draw is stratified by instrument class and acquisition (`output/features-1.12/e7-03-sample/`).
  It is disjoint from the E7-02 development sweep.
- **Staging:** Thermo files go through ThermoRawFileParser and timsTOF .d through FileConverter, as for E7-02.
  The 28 vendor files without a Linux route (SCIEX .wiff, Agilent .d, Bruker .baf, Waters .raw) go through
  msconvert 3.0.22187 on Windows (vendor peak picking). 213 of 214 are staged; one deposited solarix .d is
  incomplete. In addition, 37 pseudo-DDA files are made from DIA runs (DIAspeXtract 1.7.0, diaTracer 2.2.1).
- **Truth:** a file's label is its drawn stratum's class, with no relabelling. DDA, PRM, SureQuant/inclusion, WWA
  and all pseudo-DDA files must pass. Raw DIA conversions must be refused (exit 11, `FASTAG_REFUSED reason=raw_dia`).
- **Acceptance:** (a) 0 refusals of must-pass files; (b) >= 90% refused in each DIA stratum with >= 5 files.
- Preregistration: `acceptance/1.12/PREREG-item07.md`, amended in `acceptance/1.13/PREREG-item07.md`
  (committed before any run). Result: `acceptance/1.13/results/item07/RESULT.md`.

## Result

| Endpoint | Result | Criterion |
|---|---|---|
| (a) refusals of must-pass files | **8 / 202** (one-sided 95% upper bound 7.0%) | 0 |
| (b) Orbitrap DIA refused | **7 / 12** | >= 90% |
| (b) Astral DIA stratum refused (11 Astral, 1 timsTOF drawn by project metadata) | 12 / 12 | >= 90% |
| (b) diaPASEF refused | 12 / 12 | >= 90% |
| (b) SWATH stratum refused (11 SCIEX, 1 timsTOF drawn by project metadata) | **10 / 12** | >= 90% |
| pseudo-DDA passed | 37 / 37 | - |
| DDA (Q Exactive, Exploris, Tribrid, ddaPASEF, Q-TOF, ion trap), PRM, SureQuant, WWA passed | 149 / 149 | - |
| DDA_astral (as drawn) passed | 8 / 16 | - |

The scored result is the table above: 8 of 202 must-pass files refused, Orbitrap DIA 7/12, SWATH 10/12. Nothing
below changes it, and none of it is a re-score.

### Post-hoc reading of the disagreements (hypotheses, not part of the score)

The truth label is the stratum each file was drawn into, which the draw took from project text (title,
description, protocols, keywords, instrument list). The readings below come after scoring. Most of them rest on
FASTag's own `Acquisition check:` window listing, the output of the rule under test, so they cannot vouch for it.

- **The 8 refused must-pass files (all DDA_astral).** FASTag lists a tiling narrow-window scheme for each (20-300
  windows of 2-20 Th, 100% uncharged MS2). One check outside FASTag was made after scoring: the Thermo filter
  strings that ThermoRawFileParser copies into the mzML (`MS:1000512`, first 3000 MS2 of each file). In all 8
  refused files none of these MS2 carries the data-dependent flag `d` (e.g. `ASTMS + c NSI Full ms2
  352.4101@hcd29.00`). In all 8 DDA_astral files that passed, every one does (e.g. `ASTMS + c NSI d Full ms2`).
  That suggests the 8 are DIA runs filed in projects whose text did not say DIA. It is a hypothesis: no instrument
  method or PRIDE file annotation was checked, and the preregistered score counts them as false refusals.
- **The 7 DIA files that passed.** As listed by FASTag:
  - 4 show no repeating window scheme (1000-2000 distinct precursor m/z). They may be DDA library runs deposited
    in DIA projects; this is not verified. For the two Orbitrap files (DIA_orbitrap.02, .09) the Thermo filter
    strings carry the data-dependent flag in every MS2 checked. For the two SCIEX files (DIA_swath.07, .09) the
    .wiff conversions have no filter strings; their MS2 isolation windows are 1 Th wide, which is consistent
    with, but does not prove, IDA.
  - 2 are tiling Orbitrap DIA whose converted MS2 carry a charge (no data-dependent flag in their filter
    strings). The rule only warns on such runs, by design, so these are misses of the rule as frozen.
  - 1 is a genuine miss (DIA_orbitrap.12): uncharged and periodic, but its 38 m/z do not form one cycle of 12.

## What this means for users

- The rule failed its held-out release test: 8 of 202 files that had to pass were refused (upper 95% bound 7.0%),
  and only 7 of 12 Orbitrap DIA and 10 of 12 SWATH files were refused. Raw diaPASEF and Astral DIA strata were
  refused 12/12 each.
- If a file is refused that you know is DDA, read the `Acquisition check:` line on stderr and rerun with
  `-acquisition_check warn` or `off`. A charged, tiling Orbitrap DIA run is tagged with a warning, not refused.
- All 37 pseudo-DDA files and all 149 files of the other must-pass strata (DDA on Q Exactive, Exploris, Tribrid,
  ddaPASEF, Q-TOF, ion trap; PRM; SureQuant; WWA) passed.
- The held-out test does not validate the rule. A revised rule needs a fresh sample, preferably stratified from the
  files themselves (for example vendor scan filters) rather than from project text. Whether the default stays
  `refuse` is open.

## Revised rule (1.13) and its held-out test (acqcheck2)

Causes on the E7-03 sample, checked against scan filters and isolation windows: the 8 refused Astral files and one
Tribrid file are DIA runs filed as DDA; 4 missed files are DDA/IDA library runs in DIA projects; 3 Orbitrap DIA
files were genuine misses (2 with a default charge 2+ on every MS2, 1 with blocks of windows repeated without one
cycle). The 1.13 rule refuses both schemes (see README, Raw DIA input is refused). E7-03 was its development set.

Preregistered test on 98 fresh public PRIDE projects (one Thermo file each, disjoint from E7-03; truth per file
from scan-filter dependence and window coverage; `acceptance/1.13/PREREG-acqcheck2.md` on `acc113r/acqcheck`):
**PASS**. Refused: 0 of 58 non-DIA files (upper 95% bound 5.0%), 35 of 37 DIA files (94.6%; the 1.12 rule 19 of
37). 3 files had no clear truth and were excluded. Misses: one DIA run with mixed charges (warned, not refused)
and one non-dependent run with 5384 windows of 2 Th and no repeating scheme. The sample held no Astral, timsTOF or
SCIEX file; for those the rule is unchanged and E7-03 is the only test.
