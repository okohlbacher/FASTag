# Staging note (written before the candidate ran)

- The first staging process (frozen command, one sequential pass) ended at 01:06 CET on 2026-11-11 after R01, R02 and R03,
  when the ssh session that had launched it was closed. No data or script fault. Its rows are kept unchanged.
- Restart at 02:15 CET: the same frozen `stage.sh`, unchanged, once per remaining run (R04 to R12) with the run's own
  rows of the frozen `stage.tsv`, nine runs in parallel, detached from the session. `staged.tsv` is the first pass
  followed by the nine per-run tables. Selection rules, file order (chosen, then backup) and checks are unchanged.
- PXD040583 (R02, R09, R11): all six files convert to mzML without any MS2 spectrum and fail the staging check.
  R02 (Asp-N) is excluded without replacement (no Asp-N reserve). R09 (Lys-C) is replaced by reserve R12. Reserve R11 is unusable.
- Test set: 9 runs, 6 projects, 5 proteases (minimum 8 / 6 / 3).
