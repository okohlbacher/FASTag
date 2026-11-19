# PREREG-item11 addendum A1 (backlog #11, a/x ions)

Committed 2026-11-09 **after** the single held-out run and scoring of item 11 (Result section of
PREREG-item11.md). PREREG-item11.md is frozen and unchanged; E1, E2, the decision rule and the result
**E1 FAIL** stand as written. Nothing here relaxes or replaces a criterion, and nothing was re-run or re-scored
on the held-out set.

## 1. Scope of the result, restated (adversarial review)

What the held-out run measured: `-ion_series ax` with even-electron a/x flank offsets (a = residues - CO,
x = residues + CO2), the complement rule M - 2H, and every UVPD spectrum read as a/x only, loses to b/y by
30.8 points (E1, T1, pooled) on held-out PXD018176 replicate 2.

What it did not measure, so the interpretation in PREREG-item11.md ("the spectra carry b/y ladders; a/x ions are
too sparse to form tags", "not a/x ladders") goes beyond the data:

- an a+1/x+1 reading. The DEV fragment census (`item11/dev/ioncheck.txt`, 100 ms) has a+1 5.01% vs a 3.59% and
  x+1 1.83% vs x 1.01%. Tags spelled from a+1 or x+1 ladders get flanks 1.0078 Da off, which the flank rule
  (0.05 Da) scores as wrong;
- a mixed reading of one spectrum (b/y and a/x together); the ax arm discards the b/y ladders;
- a physically possible complement rule (section 2).

## 2. Complement rule changed after the review (DEV-only work)

The tested rule paired peaks whose neutral masses sum to M - 2H, the sum of even-electron a and x. No single
Calpha-C cleavage yields that pair: its fragments sum to M (a+1/x+1) or M - H (a+1/x, a/x+1). Branch
feat/b113-ax now tests M - H and M (`IonPair::compl_deltas` {-H, 0}). This is a change after the held-out run:
it is **DEV-only work**, it is not scored on PXD018176 replicate 2 (spent), and it does not change the item 11
result. A rerun of the a/x reading with this rule, an a+1/x+1 reading or a hybrid reading would be a new
backlog item with its own DEV work and a new, disjoint held-out set.
