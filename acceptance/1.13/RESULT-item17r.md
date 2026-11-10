# RESULT-item17r: #17 -search_shifts, second held-out test

Protocol: PREREG-item17r.md, frozen in commit 4d6e925 (pushed before the run). Candidate feat/b113-shifts 28cc8ce
(`FASTag.bin` ff09dea1...), CFG-17r-base-113 against CFG-17r-cand-113. Run once on node data, 2026-11-10
12:34-13:04 CET, all four runs exit 0 at the first attempt; scored once with `score_item17r.py` (f6bbfe0b...).
Tables: `item17r/heldout/score/` (verdict.tsv, cells.tsv, peaks.tsv).

**Item verdict: FAIL.** Comet FAIL (P2, P4), Sage FAIL (P4). `-search_shifts` stays experimental.

| Criterion | Comet | Sage |
|---|---|---|
| P1 gain >= 2 % on >= 3 runs | PASS (4 of 4) | PASS (4 of 4) |
| P2 FDP(cand) <= FDP(base) + 0.3 pp and <= 2.0 %, every run | FAIL (3 of 4; PXD037999 0.88 % -> 1.28 %, +0.40 pp) | PASS (4 of 4) |
| P3 no run loses > 1 % PSMs | PASS (4 of 4) | PASS (4 of 4) |
| P4 >= 60 % of the admissible open-search peaks on >= 3 runs | FAIL (0 of 4 evaluable) | FAIL (0 of 3 evaluable) |

Target PSMs at 1 % FDR, base -> cand (gain), entrapment FDP base -> cand, P4 recovered / admissible (needed):

| Run | Comet PSMs | Comet FDP % | Comet P4 | Sage PSMs | Sage FDP % | Sage P4 |
|---|---|---|---|---|---|---|
| PXD049248 label-free | 11979 -> 13081 (+9.2 %) | 0.90 -> 0.96 | 1 / 10 (6) | 15754 -> 17423 (+10.6 %) | 0.96 -> 0.96 | 1 / 3 (2) |
| PXD065251 SILAC | 27494 -> 29607 (+7.7 %) | 1.14 -> 0.95 | 2 / 7 (5) | 29384 -> 31280 (+6.5 %) | 1.12 -> 1.13 | 0 / 1 (not evaluable) |
| PXD037999 TMT10 | 7469 -> 10215 (+36.8 %) | 0.88 -> 1.28 | 1 / 8 (5) | 8451 -> 10582 (+25.2 %) | 1.04 -> 0.98 | 1 / 3 (2) |
| PXD073763 TMTpro | 13321 -> 14747 (+10.7 %) | 1.31 -> 1.16 | 1 / 7 (5) | 14195 -> 16074 (+13.2 %) | 1.18 -> 1.08 | 1 / 4 (3) |

Reported without threshold, admissible peaks FASTag lists as gap peaks (detected) / of those exported: Comet 1/1 of
10, 3/2 of 7, 2/2 of 8, 3/1 of 7; Sage 1/1 of 3, 0/0 of 1, 1/1 of 3, 3/1 of 4 (run order as in the table).
Distinct peptides rise by 2.6 to 20.3 % (Comet) and 4.0 to 13.7 % (Sage). No P1 or P3 call lies within 0.1 % of
its limit.

Deviations from the PREREG: none. No run was restarted, no backup was used, nothing was re-scored.
The configs CFG-17r-base-113 and CFG-17r-cand-113 are spent and are not scored again.
