# #15B held-out H1 result: `-ion_series auto` as default (CFG-15B-cand against CFG-15B-base)

**Verdict: INCONCLUSIVE.** E1 PASS, E2 INCONCLUSIVE, E3 PASS. Scored once on 2026-11-09. Not re-scored. H2 not run.

## Question and criterion

The question is whether `-ion_series auto` may become the default. The criterion is PREREG-item15B.md, amendment 1.
All three endpoints must hold:

- **E1:** on electron-activated spectra, cand - base >= +5.0 points, and the 2.5th bootstrap percentile > 0.
- **E2:** non-inferior on the hybrid and collisional cells (charge z2, z3, z4+), with the #2 margins:
  - at least 200 clusters per cell;
  - point estimate > -0.5;
  - Holm-adjusted bound > -1.0.

  An underpowered cell blocks E2.
- **E3:** every baseline row of a collisional spectrum is identical in the candidate.

## Numbers (H1 = set7 PXD024621 + set9 PXD009208, 6 files)

| Endpoint | Cell | Clusters | Spectra | base % | cand % | diff (points) | 2.5th / 97.5th pct | Result |
|---|---|---|---|---|---|---|---|---|
| E1 | electron (ETD), all charges | 5313 | 10456 | 0.88 | 82.25 | +81.37 | 79.48 / 83.24 | PASS |
| E2 | collisional z2 | 220 | 3008 | 83.88 | 83.88 | 0.00 | 0.00 / 0.00 (Holm lb 0.00) | pass |
| E2 | collisional z3 | 0 | 0 | - | - | - | - | inconclusive (underpowered) |
| E2 | collisional z4+ | 0 | 0 | - | - | - | - | inconclusive (underpowered) |
| E2 | overall | | | | | | | INCONCLUSIVE |
| E3 | collisional rows, set7 | | 117380 + 411237 + 69308 rows | | | | | identical (PASS); set9 has 0 collisional rows |

H1 has no hybrid spectra, so it has no hybrid cells, as stated before the run.

### Why E2 is INCONCLUSIVE

Every HCD PSM that MSFragger reported on set7 has charge 2:
- per file, 9355, 1986 and 3108 rank-1 hits before FDR;
- no charge-3 or higher hit.

PXD024621 uses a charge-dependent HCD/ETD decision tree: charge 2 goes to HCD, higher charges go to ETD. So the
collisional z3 and z4+ cells are empty. Under the preregistered rule an empty cell is underpowered, and an
underpowered cell blocks. The scorer's verdict is therefore INCONCLUSIVE, not PASS.

The one populated collisional cell (z2) is exactly equal in the two arms. The criterion is not relaxed, and the
split is not re-scored.

### Truth and runs

| Item | Count |
|---|---|
| Truth PSMs at 1% PSM FDR (plain target-decoy q on expectscore, no rescoring), set7 | 1119, 4757, 947 |
| Truth PSMs, set9 | 1480, 683, 4478 |
| FASTag runs (FASTAG_RC=0) | 12/12 |
| MSFragger searches (FRAGGER_RC=0): set7 by + cz, set9 cz | 9/9 |
| Runs not ok | none |

## Where and what ran

| What | Value |
|---|---|
| Node | data. Load 42-47 of 224 cores and 839 GB free RAM, so ibminode05 was not used. No BinAC2. |
| Freeze commit | da6082361a40f39bffb065f19cdc0ac60d76e944 (parent 5735c58), pushed 2026-11-09T18:58:11Z |
| Run-start row | HO-15B-H1-run-start, commit a4f50ed, pushed 19:01:44Z (UTC) |
| Run times (UTC) | FASTag 19:02:23-19:02:25Z; MSFragger 19:02:24-19:05:17Z; scoring 19:05:56-19:06:11Z |
| FASTag | RC a117801, FASTag.bin sha256 `c4c2ad67fcd9106e474f552267f7cdfefe107f394b268bbc236308b773e4d7f3`, verified before the runs. Run through the `rc-a117801/opt/FASTag` wrapper, `-threads 12`. |
| CFG-15B-base | RC defaults (`-ion_series by`), param_hash 3121296f… |
| CFG-15B-cand | `-ion_series auto`, param_hash 5a5fe0c0… |
| MSFragger | 4.4.1, jar `/ceph/ibmi/abi/oliver/spextract/tools/MSFragger-4.4.1.jar`, sha256 `56b15a35060e1aa3b38508eed5e1b21ce697918bad75b450307160c86c652112`, verified. OpenJDK 21.0.12.1, `-Xmx128G`. |
| MSFragger parameter files | The frozen files of `scorers/truth/item15B/`, checked against SHA256SUMS (`results/item15B/params_check.txt`). |
| Scorer | `score_item15B.py` 1d91c8f4…, `acclib.py` fe387a34…, fastag_bench `score.py` e2b8788a…, `parsers.py` 01e27548…. Python 3.11.18, pandas 3.1.0, numpy 2.4.6. |
| Scoring command | `python3 scorers/score_item15B.py . H1 /scratch/kohlbach/fastag-heldout-1.12 <R>/runs <R>/truth <R>/h1/score-H1`, with `<R>` = `data:/scratch/kohlbach/fastag-heldout-1.12/item15B`. Run from a git archive of da60823. |
| Records | `acceptance/1.12/results/item15B/`: jobs, times.log, outputs.sha256, score-H1. Registry row HO-15B-H1-result. |

## Consequence

`-ion_series auto` does not become the default in 1.12 on this result. That is because the result is INCONCLUSIVE.
It is not a FAIL:
- the electron-activated gain is large and clear (+81 points);
- collisional spectra are unchanged.

What blocks E2 is a property of H1 that the PREREG did not anticipate: the HCD spectra of set7 are all charge 2.
Every next step needs a user decision:
- **H2 (set10)** is reserved by the PREREG for confirming a variant after an H1 failure. It is not a rescue for an
  INCONCLUSIVE H1. Also, set10 has no collisional spectra.
- **A new preregistered test** on another split would be the alternative.
