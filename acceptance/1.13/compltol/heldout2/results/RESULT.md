# compltol (backlog item 15): held-out test 2 of the revised estimator

Verdict by the frozen rule: **INCONCLUSIVE**. No criterion failed. (i) is INCONCLUSIVE because four ion-trap 3+
cells have a baseline below the 1.8 % informativeness floor; every other cell passed.

- Candidate: `origin/integration/1.13` e21d8033f94c895c9880882226826afb42778d6d, feature unchanged. Binary built on
  node data, sha256 `ea096d0c1e7b8e5816e03f5026914d0007c56632ae2fe8f1d43be143d75d3392` (ctest rc 0).
- Acceptance branch `acc113r/compltol` (from origin/acceptance/1.13 ae9a85f): freeze commit `cb84295` (pushed
  before the binary touched a held-out file), results commit: see the hand-back / `git log`.
- Protocol: `acceptance/1.13/PREREG-compltol-heldout2.md`. Run 2026-11-11 01:38 to 01:55 CET on data, 96 FASTag
  runs, all rc 0. Scored once (see deviation 1).

## Data

8 new public PRIDE runs, 8/8 disjoint (PXD against 2,302 excluded projects, sha256 against every recorded hash).

| Set | PXD | Run | Truth PSMs (q <= 0.01) |
|---|---|---|---|
| astral | PXD069807 | 20250622_DDA_400ng_Tube80_ISS_WT83_Plate1_RowF_Column7 | 73,618 |
| astral | PXD069807 | 20250622_DDA_400ng_Tube27_Ground_QX_Plate2_RowE_Column9 | 44,120 |
| ion_trap | PXD041382 | 102641 | 8,902 |
| ion_trap | PXD027039 | COM-MP2-2 | 2,470 |
| ion_trap | PXD058223 | CNN1_180410113835 | 13,960 |
| qe | PXD075617 | OMG5379A7LC2_G1 | 3,707 |
| qe | PXD076370 | MS221730-KS | 7,512 |
| qe | PXD078122 | 20260205_HF1_MaRa_SA_P0312_Dmo2_04 | 18,917 |

## Verdict per criterion

| Criterion | Verdict | Numbers |
|---|---|---|
| (i) non-inferiority per cell (point > -0.5, Holm bound > -1.0) | **INCONCLUSIVE** | 54 cells: 44 pass, 0 fail, 10 uninformative (all ion trap). Astral 18/18 and QE 18/18 pass with difference 0.0000 in every cell. Ion trap: 8 pass (+0.62 to +1.57 points, Holm bounds +0.29 to +1.14); 3+ at L4/L5 (4 cells, baseline 0.85 to 1.22 %) and 4+ (6 cells) uninformative. The frozen rule needs every 2+/3+ cell of every set to pass, so the four uninformative 3+ cells block a PASS. Their point differences: +0.47, +0.44, -0.06, -0.13. |
| (ii) gain on ion trap, L3 default, charge >= 2 (point >= +1.0, p2.5 > 0) | **PASS** | 6.74 % -> 7.81 %, +1.07 points (95 % 0.87 to 1.27), 13,969 clusters. Reported only: pooled astral + ion trap +0.19 (0.15 to 0.23), which is below the first test's +0.3. |
| (iii) timsTOF | **NOT TESTED** | no timsTOF run |
| (iv) run time, DEV PXD003531, 1 thread, 7 interleaved repeats (ratio <= 1.03) | **PASS** | median 20.283 s -> 20.483 s, ratio 1.010; baseline max/min 1.058 |
| (v) one window per file, in force >= 0.02 Da, nothing logged without auto | **PASS** | 8/8 files, identical in all six cells |

Measured windows (same in all six cells of a file):

| Run | Measured | In force | Signal pairs |
|---|---|---|---|
| Astral Tube80 | 0.0185 Da | 0.02 Da (lower bound) | 82 |
| Astral Tube27 | not measured (35 of 42 needed) | 0.02 Da (fallback) | 35 |
| ion trap PXD041382 | 0.426 Da | 0.426 Da | 146 |
| ion trap PXD027039 | 0.339 Da | 0.339 Da | 52 |
| ion trap PXD058223 | 0.337 Da | 0.337 Da | 181 |
| QE PXD075617 | 0.0150 Da | 0.02 Da (lower bound) | 94 |
| QE PXD076370 | not measured (30 of 40 needed) | 0.02 Da (fallback) | 30 |
| QE PXD078122 | 0.0064 Da | 0.02 Da (lower bound) | 163 |

## What this shows

- On all five high-resolution files the window in force was 0.02 Da, so the candidate equals the default there.
  The Astral failure of the first test (0.0566 Da in one cell) did not recur: the one measured Astral window was
  0.0185 Da, the other file fell back.
- The gain is confined to ion-trap data and is about +1 point at L3 (2+ cells +0.6 to +1.6). That is smaller than
  on DEV (+2.3 to +7.6 on PXD001819).
- No cell lost more than 0.13 points.

## Deviations

1. **Scorer invocation.** The frozen command used `python -I`; with `-I` the scorer cannot import `acclib` and
   stopped at the import, before it read any data (logs kept in `results/score.importfail/`). The same scorer and
   verdict files (sha256 unchanged) were then run once without `-I`, as in the first test. No held-out number had
   been seen before that. Strictly this is a second scorer start, against "the scorer runs once".
2. Astral and two QE raw files were downloaded with parallel https range requests because single connections ran
   at 0.4 MB/s; the file sizes match PRIDE and the sha256 are in the manifest.
3. The ion-trap draw was extended to 10 projects before qualification; four of the first seven did not qualify
   (two were FTMS, two had fewer than 1,000 PSMs).

## Changes against the first test (fixed before the freeze, justified from DEV)

- (i): underpowered or uninformative 4+ cells do not block; 2+/3+ cells still must pass.
- (ii): ion-trap set only, threshold +1.0 instead of pooled astral + ion trap +0.3.

## Limits

- One Astral project (two files of one study); in neither file did auto change the window, so the estimator's
  behaviour on Astral data above 0.02 Da is not tested.
- Three ion-trap files, all with a fragment tolerance of 0.5 Da; low identification rates (baseline 4 to 10 %).
- No timsTOF.
- Timing on a shared node (load about 105 during the timing); the DEV tags were identical in both arms.
- `gate.sh` against the 1.12.0 references was not run for this binary; only ctest.
- Truth is Sage at 1 % spectrum FDR with a closed search.

## Paths

- Worktree: `/Users/kohlbach/Claude/OpenMS/New Tools/FASTag/work/FASTag/.worktrees/acc113r-compltol`
- Protocol: `acceptance/1.13/PREREG-compltol-heldout2.md`, `manifests/compltol-H2.tsv`,
  `disjointness/compltol-H2.tsv`, `compltol/heldout2/` (scripts, scorer, selection, qualification)
- Results: `acceptance/1.13/compltol/heldout2/results/` (`score/verdict.json`, `score/cells_i.tsv`,
  `score/measured_windows.tsv`, `score_ii/`, `timing/`)
- On data: `/scratch/kohlbach/b113/compltol/heldout2/` (raw, staged mzML, truth, run)
