# RESULT-item17: #17 -search_shifts held-out test, scored once: FAIL

2026-11-09, node data. Protocol `PREREG-item17.md` (committed 6d5515e + d4baacb, run-start row 785a559, all before
the run). CFG-17-base-113 vs CFG-17-cand-113 on the four runs of `item17-heldout`, scorer `score_item17.py`
8ecd686c... (sha256 checked on data before scoring), run once on the four `searches.tsv`. Files: `item17/heldout/`
(`score/` = the scoring; `score_3run_noPXD000001/` = the preregistered three-run view, no criterion).

## Verdict

| Engine | P1 gain >= 2 % (>= 3/4) | P2 FDP <= 1.5 % (4/4) | P3 loss <= 1 % (4/4) | P4 open-search recovery (>= 3/4) | Verdict |
|---|---|---|---|---|---|
| Comet | PASS (3/4) | PASS (4/4) | PASS (4/4) | FAIL (1/4) | **FAIL** |
| Sage | PASS (3/4) | FAIL (1/4) | PASS (4/4) | FAIL (0/4) | **FAIL** |

Item verdict: **FAIL**. The three-run view without PXD000001 gives the same verdicts. `-search_shifts` stays
experimental; no "recommended" wording.

## Cells (target PSMs at 1 % PSM FDR, entrapment r = 1)

| Run | Engine | PSMs base -> cand | gain | peptides gain | FDP base / cand | base scans lost | open peaks recovered |
|---|---|---|---|---|---|---|---|
| PXD014764 (SILAC) | Comet | 4224 -> 5979 | +41.6 % | +29.8 % | 1.18 / 1.26 % | 3.8 % | 3/10 |
| PXD014764 | Sage | 4738 -> 6196 | +30.8 % | +23.1 % | 1.51 / 1.63 % | 0.5 % | 3/10 |
| PXD004541 (TMT10) | Comet | 10079 -> 15053 | +49.4 % | +39.0 % | 1.09 / 1.32 % | 2.1 % | 4/10 |
| PXD004541 | Sage | 11186 -> 11518 | +3.0 % | +3.1 % | 1.46 / 1.55 % | 0.9 % | 1/10 |
| PXD000001 (TMT6) | Comet | 1116 -> 1133 | +1.5 % | +2.0 % | 0.71 / 0.70 % | 0.2 % | 0/9 |
| PXD000001 | Sage | 1258 -> 1258 | 0 | 0 | 2.36 / 2.36 % | 0 | 0/9 |
| PXD063151 (label-free) | Comet | 34941 -> 43101 | +23.4 % | +5.5 % | 1.07 / 1.06 % | 10.1 % | 7/10 |
| PXD063151 | Sage | 46530 -> 55805 | +20.0 % | +11.1 % | 1.20 / 1.16 % | 1.3 % | 3/10 |

The primary endpoint (more identifications at 1 % FDR with the shifts) holds on 3 of 4 runs for both engines, with
large gains; the item fails on the preregistered secondary criteria.

## Why it fails (observations, nothing re-scored or tuned)

- **P2 (Sage)**: the closed Sage base itself exceeds 1.5 % entrapment FDP on PXD000001 (2.36 %, identical
  configuration because Sage got no shift there) and sits at 1.46-1.51 % on PXD004541/PXD014764; the shifts add
  0.1 pp. The failure is mostly Sage's FDR calibration at 1 % on these runs, not the shifts, but the criterion is
  on the cand search and fails.
- **P4, labelled runs**: on TMT runs FASTag's gap peaks sit in the label frame (L + x). The isotope rule (rule 0) is
  not applied to the remainder x: on PXD004541 the peaks L + 1.005 and L + 2.004 (651 and 185 spectra) became Comet
  offsets 1.0049 / 2.0039 instead of an isotope-error range, so Sage (no offsets) searched isotope errors 0..0 and
  missed the two largest open-search peaks (+1.006: 2206 PSMs, +2.007: 604). On PXD000001 the only exported shifts
  were two offsets (73.06, 25.97); the open-search peaks (+21.98 Na, +1.005, +229.19 TMT overlabelling, residue
  losses) were not found by FASTag at all (few spectra: 6103 MS2).
- **P4, other peaks** not exported by any rule: +42.01/+41.03/+43.02 (acetyl/carbamyl-like) and +370.22, +264.16 on
  PXD014764; Oxidation on non-M residues (+15.997) and +3.008 on PXD004541; -1.001 on PXD063151 (negative offsets are
  dropped for Comet, see A5-01).
- **PXD063151**: the offsets 0.0619, 0.1006, 0.9061, 1.0471, 1.0779 are near-zero/near-isotope masses consistent with
  a precursor calibration error; Comet's gain there comes with 10.1 % of the base-identified scans lost (secondary
  measure, no criterion; P3 is the count criterion and passes).

## Consequences

- `-search_shifts` remains experimental; README/doc state the held-out result.
- Candidate fixes for a later item (each needs a new DEV freeze and fresh held-out data; none is applied here):
  apply the isotope rule to label-frame remainders; skip near-zero offsets (|x| below a precursor-tolerance bound);
  report Sage's base FDP problem separately from the shifts.
