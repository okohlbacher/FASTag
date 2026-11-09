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

Every one of the 8 refused must-pass files comes from the DDA_astral stratum. Each run's own listing is a
narrow-window DIA scheme: 20-300 windows of 2-20 Th that tile the range every cycle, with 100% of the MS2
uncharged. The draw takes its strata from project metadata, which did not say DIA. The 7 DIA files that were not
refused fall into three groups:

- 4 have no repeating scheme. They have 1000-2000 distinct precursors, as DDA/IDA library runs in DIA projects do.
- 2 are tiling Orbitrap DIA whose converted MS2 carry a charge. The rule only warns on such runs, by design.
- 1 is a genuine miss: uncharged and periodic, but its 38 m/z do not form one cycle of 12.

## What this means for users

- Raw diaPASEF and Astral (n)DIA were refused in every case. So were most SWATH and Orbitrap DIA runs. The check
  did not pass every raw-DIA run it was given. A charged, tiling Orbitrap DIA run is tagged with a warning, not
  refused. Read the `Acquisition check:` line on stderr.
- The check does not refuse pseudo-DDA output, and no DDA run outside the mis-stratified Astral projects was
  refused.
- The held-out test does not validate the rule. A revised rule needs a fresh sample, preferably stratified by the
  file's own window listing rather than by project text. Whether the default stays `refuse` is open.
