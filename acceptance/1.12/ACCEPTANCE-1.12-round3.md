# FASTag 1.12 held-out acceptance, round 3

2026-11-08. Branch `acceptance/1.12`. Binary: the RC bundle a117801, FASTag.bin `c4c2ad67...`, whose CLI is identical
to 1.12.0. Each config was scored at most once and nothing was re-scored. The informativeness floor is 1.8% for #2, #6
and #9 only.

## Results per item

| Item | Status | Verdict | Registry rows |
|---|---|---|---|
| #4 tags on unidentified spectra | scored once (node data) | **PASS** | HO-04-test-run1, -run1-retry, HO-04-test-result (4da3cfc) |
| #9 profile centroiding (`-pick_profile auto`) | scored once (BinAC2) | **FAIL; ANALYSER_RESTRICTION_NEEDED** | HO-09-H1-run1 (14e255d), HO-09-H1-result (fb22dd6) |
| #6 charge inference (`-unknown_charge infer`) | scored once (BinAC2) | **INCONCLUSIVE** (corrected from FAIL) | HO-06-H1-r2-run1 (7720bbc), HO-06-H1-r2-result (607e625), HO-06-H1-r2-result-corr1, HO-06-H1-r2-run1-corr1 |
| #2 complement rules (`-complement_rule both`) | run, **not scored** | none: 3 of 13 runs have no truth | HO-02-H1-r2-run1 (8c3c20a), HO-02-H1-r2-run1-corr1 |
| #3 termini / alkylation | not_scored_refit | - | HO-03-heldout-r3 |
| #5 shortlist | not_scored_refit | - | HO-05-heldout-r3, HO-05-negative-r3 |
| #7 acquisition check (E7-03) | deferred_1.12.1 | - | HO-07-E7-03-r3 |
| #15B ion series | pending_msfragger | - | HO-15B-sets-r3 |
| #1 / #10 species call | blocked_dev_nogo | - | HO-01-DEV-ALLDECOY, HO-01-heldout-PREREG-r2 |
| #17 search shifts | pending_prereg | - | HO-17-heldout-r2 |
| #11 census | not_in_sprint | - | - |

### #4: PASS (item04-test, 9 pools, PREREG-item04 at 0d64d85)

| Cell | Spectra / clusters | Rank-1 - chance | 95% CI | p_holm | Result |
|---|---|---|---|---|---|
| matched TL3, pools_not_excluded, no_byproduct_candidate (primary) | 27,006 / 1,289 | **0.270** | 0.237-0.307 | 0.001 | PASS (margin 0.05) |
| matched TL5 (Holm) | 20,432 / 1,132 | 0.237 | 0.200-0.272 | 0.001 | PASS |

- No pool was excluded. Six pools were flagged uncertain by entrapment and kept in the primary scope.
- Every sensitivity cell has its lower bound above 0.05.
- Reported, not gating: F4-02 precision transfer not shown (0.270, CI 0.232-0.310). F4-04 `-diversity`: no benefit
  claimed.

### #9: FAIL; ANALYSER_RESTRICTION_NEEDED (item09-H1, 3 runs)

**B1 non-inferiority: FAIL.** 13 cells pass, 2 fail and 3 are underpowered. None is uninformative; the lowest baseline
rate is 2.6%.
- orbitrap_tof: all 9 cells pass, at +10.5 to +32.0 points.
- ion_trap L3 z3: +0.49 points, Holm bound -1.79, **FAIL**.
- ion_trap L4 z3: +0.49 points, Holm bound -1.66, **FAIL**.
- ion_trap z4+ (L3, L4, L5): 43 clusters each, underpowered.

**B2 (no fewer tagged spectra): FAIL.**
- PXD009049 L4: -25. PXD009049 L5: -28.
- PXD016519 L3: -567, which is a high-resolution run.

**C (cost, reported):** `auto` costs 0.52 to 0.76 times `legacy`.

`legacy` stays the default.

### #6: INCONCLUSIVE (item06-H1-r2, 6 runs; PXD001473 has no truth)

The verdict is INCONCLUSIVE under rule 4. The endpoint results below are descriptive only:

| Endpoint | Result |
|---|---|
| (1) charge-call accuracy >= 0.90 | 0.7512 (42,237 / 56,229; Wilson 0.7476-0.7547): fails. astral 0.769, ion_trap 0.519, qe 0.776 |
| (2a) 27 cells | 15 pass, 9 fail, 3 underpowered (ion_trap z4+, 162 clusters), 0 uninformative. The 9 failures: 5 z2 cells (astral S_L3 and S_L4, ion_trap S_L3 and S_L5, qe S_L3), 3 ion_trap z3 cells (S_L3, S_L4, S_L5) and astral S_L3 z4+ |
| (2b) better on >= 2 of 3 sets | passes: astral +0.61 (0.32-0.92), qe +0.89 (0.67-1.10); ion_trap -1.01 |
| (3) G_L3 unchanged | passes: 0 differing rows in 6 runs |
| truth per run | PXD066944 13,858; PXD000806 113; **PXD001473 0**; PXD002429 2,787; PXD001540 2,235; PXD069528 37,372 |

`infer` gains 2.5 to 5.2 points on 3+ spectra and loses on 2+ spectra in every set. It does not become the default.

### #2: not scored (item02-H1-r2, 13 runs)

All 156 FASTag tasks have FASTAG_RC=0, and their outputs are kept on BinAC2. Three runs have no truth:
- **PXD033741, PXD076520 (timsTOF):** Sage exits 134 with "missing MS1 precursor".
- **PXD001473 (ion_trap):** 2,301 target rank-1 PSMs, none at q <= 0.01.

Under rule 5, any scoring now is INCONCLUSIVE. Criterion (iv), timing on DEV PXD003531, was measured but not scored:
the median ratio is about 1.019 against a limit of 1.03.

## Audit findings and fixes (bookkeeping only, nothing re-scored)

| # | Finding | Severity | Fix |
|---|---|---|---|
| 1 | The #6 verdict was reported as FAIL, but rule 4 makes it INCONCLUSIVE: PXD001473 truth has 0 PSMs at q <= 0.01, and the scorer checks only that the file exists | major | Registry row `HO-06-H1-r2-result-corr1` gives INCONCLUSIVE, with (1)/(2a) descriptive. `heldout-1.12/item06.md` is corrected. The scorer fix is left to a future amendment |
| 2 | The #2 decision put the INCONCLUSIVE risk on the two timsTOF runs only. PXD001473 also has no truth, so option (a) would still be INCONCLUSIVE | major | Row `HO-02-H1-r2-run1-corr1` adds PXD001473 and a diagnosis. `heldout-1.12/item02.md` re-poses the decision so that it covers all three runs |
| 3 | Run-start row 7720bbc claims it was recorded before any Sage or FASTag task. sacct says those started at 23:23:14 CET and the commit is 23:23:50 CET | major | Row `HO-06-H1-r2-run1-corr1` gives the sacct submit, start and end of 6472627 to 6472630. The binding freeze (ed0a7e0, 22:15Z) predates submission (22:22:44Z) |

Diagnosis of PXD001473, without reading any FASTag output:
- The input looks normal: Orbitrap MS1, ion-trap CID MS2, centroided, charges annotated. The Sage config matches the
  truth table (Trypsin, CAM, Ox M, 10 ppm / 0.5 Da).
- **Suspected cause, not confirmed:** the file name points to HAMMOC phosphopeptide enrichment, and the truth search
  has no Phospho (STY). The base peak sits at precursor - 98/z in 3.6% of MS2 spectra, against 0.6% in PXD002429.

`scripts/check_registry.py`: 51 pairs, 0 failures.

## What 1.12.1 needs

- **#2:** the user decides on truth amendment 2 for all three runs:
  - PXD001473: a phospho truth search, or drop the run and amend rule 5.
  - PXD033741, PXD076520: precursor repair or another Sage setting.
  - Or score as is and accept INCONCLUSIVE.

  Then run only those truth tasks and score once. The FASTag outputs and the timing need no rerun.
- **Scorers (#2, #6, and future configs):** treat a truth with 0 PSMs at the preregistered q as "without truth". Fix
  the PREREG scoring command, because `python3 -I` breaks `import acclib`. Both changes need a PREREG amendment and
  new sha256 values before any scoring.
- **#6:** no default change. A new charge-inference variant needs a DEV refit (the 2+ losses, ion-trap 3+) and a new
  frozen config. The reserves item06-H2 and H2r are unused, but they cover Astral only and are underpowered.
- **#9:** an analyser restriction needs a new RC and a new config. B2 also fails on high-resolution data
  (PXD016519 L3), and there is no ion-trap reserve. Until then, `auto` may at most be recommended for high-resolution
  MS2, if the user decides so.
- **#7:** the E7-03 release test.
- **#3, #5:** refit on DEV, then preregister new configs.
- **#15B:** the MSFragger path from the user.
- **#17:** write PREREG-item17.
- **#1 / #10:** a user decision on the failed DEV go/no-go.
- **Process:** commit and push every run-start row before `sbatch`, as was done for #9.

## Round 4 (2026-11-09)

Commits on `acceptance/1.12`: d4c79b2 (decisions DEC-1112-r4-A..E, PREREG-item02/06 amendment 2 with the
`python -I` erratum, scorer changes), 09e14b3 (run-start rows, pushed while every job was still PENDING), e769b93
(result rows). #2 and #6 H2/H2r were each scored once. Neither passes, and both defaults stay.

### #2: INCONCLUSIVE (item02-H1-r2, high-resolution sets astral, qe, timstof; Slurm 6474439)

Rule 5: PXD074582 (Astral, Bos taurus database) has a truth with 0 target PSMs at q <= 0.01 (lowest q 0.47). The
endpoints, descriptive only, fail either way:

| Endpoint | Result |
|---|---|
| (i) 54 cells | FAIL: 41 pass, 13 fail (astral L3_default z3 -0.64, Holm bound -1.36; 12 are 4+ cells) |
| (ii) astral | FAIL: -0.15 points (2.5-97.5%: -0.29 to -0.01) |
| (iii) timstof 4+ | FAIL at L5 (-0.56); L3, L4 ok |
| (iv) time ratio | PASS: 1.019 |
| truth PSMs | PXD066944 14,641; PXD070049 351; **PXD074582 0**; PXD033741 72,363 and PXD076520 23,516 (both repaired, Slurm 6474438); PXD050504 6,829; PXD069528 29,843 |

- Truth repair: Sage 0.14.7 panics on MS2 whose only precursor m/z is 0. A derived mzML drops exactly those spectra
  (3,412 and 3,513); the Sage config is otherwise unchanged.
- A scorer bug was fixed by amendment before scoring: timsTOF spectra are keyed by the full native ID, not `scan=`.
- The six ion-trap runs are out of #2; the `-it05` configs are never scored. `same_charge` stays the default.

### #6 H2/H2r: FAIL (PXD020394 qe, PXD055983 Astral; Slurm 6474440-6474443, 16/16 FASTag runs exit 0)

| Endpoint | Result |
|---|---|
| (1) charge-call accuracy >= 0.90 | FAIL: 0.745 (n 188,827) |
| (2a) cells | FAIL: 12 pass, 3 fail (astral S_L3 z2 -1.48, astral S_L4 z2 -0.91, qe S_L3 z2 -0.66), 3 underpowered (qe z4+, 195 clusters) |
| (2b) better on both sets | FAIL: astral +1.12; qe +0.03 (-0.28 to 0.35) |
| (3) G_L3 unchanged | PASS: 0 differing rows |

Same pattern as H1: gains on 3+, losses on 2+. H1 stays INCONCLUSIVE. `assume2` stays the default.

### #9: documentation only

README on `acceptance/1.12` gives the item09-H1 subgroup as an observation, not a validated result (corrected in
this round, see finding 2 below). The default stays `legacy`.

### Audit findings (bookkeeping only, nothing re-scored)

| # | Finding | Severity | Fix |
|---|---|---|---|
| 1 | PR #36 (docs/1.12.1-acceptance, bd1d2d4), CHANGELOG and README intros: "scored once; nothing was re-scored" is not true for #6 (CFG-06-base/cand scored on H1-r2 and again on H2/H2r; the PREREG rule keeping H2 for a variant was dropped by amendment 2; ion-trap data removed after H1 was seen). For #2 the ion-trap set was removed after the #6 H1 and #9 ion-trap failures. The README also says no held-out result covers ion-trap MS2, yet #9 and #6 H1 scored ion-trap cells | major | **Open, before PR #36 is merged:** each config scored once per split; #6 scored a second time on the H2/H2r reserve by user decision after the INCONCLUSIVE H1, without ion-trap runs; low-resolution data removed from #2 and #6 after the #6 H1 and #9 ion-trap results were known; ion-trap sentence becomes "ion-trap MS2 was tested for #9 and #6 H1 and failed or was worse; no 1.12 option is validated there" |
| 2 | README #9 recommendation named Astral and TOF, but item09-H1 scored two Orbitrap runs only (PXD016519 QE Plus, PXD018024 QE HF; PXD035981 not evaluable), and the subgroup was chosen after a FAILED protocol (B2 also failed on PXD016519) | major | Fixed on `acceptance/1.12`: "Orbitrap profile MS2 (tested on two Q Exactive runs); Astral and TOF not tested", stated as a descriptive subgroup of a failed protocol. **Open:** the same change in PR #36 |
| 3 | Amendment 2 added rule 4b (0-PSM truth = no truth) and declared the round-3 high-resolution truths usable without checking their PSM counts. PXD074582's 0-PSM truth was knowable from the truth file alone, so the only scoring of #2 ended INCONCLUSIVE. PXD070049 has only 351 PSMs, so (ii) rests mostly on PXD066944 | major | Registry row `HO-02-H1-r2-result-note1` records the deviation; not re-scored. Any future amendment needs a pre-scoring check of every truth against the scoring rules, from truth files only, before the run-start row is pushed |

`scripts/check_registry.py`: 51 pairs, 0 failures.

### Low-resolution files

`output/features-1.12/LOWRES-DELETE-COMMANDS.md`: 188 ion-trap files (158.05 GB on data, 71.70 GB of them also on
BinAC2) plus 4 derived copies on BinAC2, 288 `rm` lines. Nothing was deleted. Files of #1, #3, #5, #7 and #15B belong to
unscored items and need a PREREG amendment before deletion; `header:` rows and 25 hard-linked files need a check.

### Open

- PR #36: findings 1 and 2, before merge.
- The README #9 wording reaches integration/main only via the main session.
- #2 has used its one scoring. A new PXD074582 truth (database mismatch suspected) would need a user decision and a new
  amendment.
