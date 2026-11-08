# FASTag 1.12 held-out acceptance: user decisions of 2026-11-08 (round 3)

These are the user's answers to the open questions of `output/features-1.12/RELEASE-1.12.0-READINESS.md`
("Decisions needed from the user") and of `output/features-1.12/H2-reserve-proposal.md`. The main session put the
questions to the user on 2026-11-08 and passed the answers on to this registration round. They are recorded here
as given, without any change of substance. Each one also has a `DEC-1112-r3-NN` note row in
`validation-registry.tsv`. Nothing below was decided after a held-out result: no 1.12 held-out config has been run
or scored.

| # | Readiness question | Decision | Registry consequence |
|---|---|---|---|
| 1 | #7: finish E7-03 before the merge, or release the #7 default without its held-out release test | **E7-03, the release test, is deferred to 1.12.1.** 1.12.0 ships with the E7-02 sweep evidence. | CFG-07 status `deferred_1.12.1`. E7-03 is not scored in 1.12.0. |
| 2 | #2/#6/#9: the ion-trap cells measure almost nothing at 20 ppm (DEV PXD001819: about 4% rank-1 correct) | **Rescore the ion-trap cells at 0.5 Da.** Add new frozen configs that are identical to the existing ones except for a fragment tolerance of 0.5 Da, used on the ion-trap MS2 runs. Keep the existing 20 ppm configs for the high-resolution cells. Preregister the configs in PREREG amendments (cells, denominators, scorer sha256) before any scoring. **Audit finding:** non-inferiority passes on cells where both arms are near zero. So the amendment adds a pre-specified **informativeness floor**: the reference arm's rank-1 correct rate must reach a stated minimum. The minimum is chosen from DEV ion-trap runs only (PXD001819 at 0.5 Da). Below it a cell is reported `uninformative` and does not count as PASS. | New configs CFG-02-base-it05, CFG-02-cand-it05, CFG-06-base-it05, CFG-06-cand-it05, CFG-09-base-it05, CFG-09-cand-it05. Amendments to PREREG-item02/06/09.md, scorers updated, new sha256. |
| 3 | #2/#6: where the Astral and timsTOF H2 reserves come from, and what happens to the PXD001540 "QE" cell | **PRIDE is accepted as the source of the H2 reserves.** This is a recorded deviation from PLAN-data-types #2 ("from the same corpora"). **PXD068073 is dropped.** It is a methionine-oxidation study (Spy/MsrP), which the selection rule's intent excludes. **The other proposed runs are registered.** The Astral reserve cell then has a single run (PXD055983), which is reported as underpowered. **For the H1 QE cell, the proposal's recommended PXD069528 is used, and PXD001540 moves to the ion-trap cell.** | New manifests item02-H2r (Astral PXD055983; timsTOF PXD070494, PXD081146) and item06-H2r (Astral PXD055983 only; #6 has no timsTOF class). H1 revisions item02-H1-r2 and item06-H1-r2 (PXD001540 in stratum ion_trap, PXD069528 added as qe). |
| 4 | #3: whether to score CFG-03-* at all given the DEV misses | **#3 is not scored on held-out data in 1.12.x.** It is refitted on DEV first, and a new config is preregistered later. | CFG-03-base and CFG-03-cand status `not_scored_refit`. |
| 4b | #5: (DEV miss of the shortlist freeze) | **#5, as #3:** not scored on held-out data in 1.12.x. It is refitted on DEV first, and a new config is preregistered later. | CFG-05 status `not_scored_refit`. |
| 5 | #15B: MSFragger truth (licence) | **The user will accept the MSFragger licence and provide the path.** Until then #15B is not scored. | CFG-15B-base and CFG-15B-cand status `pending_msfragger`. |
| 6 | #4: sign-off on F4-10/11/12 and the margin freeze | **The user accepts the F4-10, F4-11 and F4-12 proposals as recorded, and the proposed margin.** CFG-04 is frozen accordingly, and #4 is scored once. | CFG-04 status `frozen` in the commit that adds PREREG-item04.md (truth, cells, denominator, scorer sha256). |
| 7 | PR #33 | The main session merges it after the release. It is not part of acceptance. | none |

## What the decisions do not change

- The registry stays append-only. Rows that are already committed are never rewritten. Status changes are new
  `-r3` rows, which `scripts/check_registry.py` reads as the current state.
- Each config is scored exactly once. Configs are never re-scored or tuned after a result is seen. A FAIL is
  reported as a FAIL.
- The binary is the frozen RC bundle (FASTag.bin `c4c2ad67fcd9106e474f552267f7cdfefe107f394b268bbc236308b773e4d7f3`,
  integration/1.12 a117801). Its CLI tree is identical to the released 1.12.0 (main 09ba1d8). Nothing under `src/` is
  changed.
- #1/#10 (readiness decision 2) and the release scope (decision 6) are not part of this round. CFG-01-cand and
  CFG-10-cand stay `blocked_dev_nogo`.

## Plan deviation recorded (decision 3)

PLAN-data-types #2 draws the H2 reserve "from the same corpora". The corpora hold no DDA Astral or ddaPASEF run
outside H1, DEV and the gate (0/2 each), so the Astral and timsTOF reserves come from PRIDE instead. They were
selected by the rule in `scripts/select_h2r_pride.py`, which was fixed before any download (cb76d59). The files were
staged and hashed in 4dc281e. The QE replacement for H1 (PXD069528) comes from the same PRIDE rule. The PRIDE
search, the draw and the header checks are in `output/features-1.12/H2-reserve-proposal.md`. The QE and ion-trap H2
reserves stay as registered (corpus draws, item02-H2/item06-H2).

PXD068073 was taken by the draw. It is dropped by decision 3, so the Astral reserve has one run where the plan wants
two. No other Astral project passed the rule (2 of 546), so no replacement is drawn. The backup file of PXD068073 is
not used either, because the whole project is excluded.
