# FASTag 1.12.0 release readiness

2026-11-08. RC = integration/1.12 a117801 (FASTag.bin c4c2ad67...). Records: branch `acceptance/1.12` at 1f580c8
(registry, frozen configs, PREREG files); release PR #34 head 3208a05.

**Verdict: not ready.** No 1.12 item has a held-out result. No held-out config is runnable today: every config is
blocked, pending, or out of the sprint (see below). The release PR conflicts with main. The one changed default
(#7) ships without its release test unless the user decides otherwise.

## Acceptance per item

PASS/FAIL means a held-out result. "Not run" means nothing was scored. DEV numbers are in-sample.

| Item | Result | Numbers | Registry rows | Config status |
|---|---|---|---|---|
| #1 species call | **not run** (DEV NO-GO) | DEV, 47 runs (36 FTMS): decoy-replicate KS n 1760, D 0.162, p 6.7e-41 (needs > 0.01). Chosen point g_0.01_0.01_5_on: sensitivity 0.945 (52/55), false present in 35/36 runs (0.972; target <= 10%), 7.69 per run, specificity (a) 0.816 (LB 0.796; target >= 0.95). LOPO-CV gives the same numbers. Held-out set: 80 files / 74 PXDs, 52 primary. | HO-01-heldout, HO-01-heldout-PREREG | base pending_prereg, cand blocked_dev_nogo |
| #10 both orientations | **not run** | DEV, descriptive only: 416 forward vs 313 both genus `present` rows. Blocked together with #1. | HO-10-heldout | blocked_dev_nogo |
| #2 complement rules | **not run** | H1 12 runs; PXD001540 "QE" has ion-trap MS2. H2: Astral 0/2, timsTOF 0/2. No scoring protocol. | HO-02-H1, HO-02-H2, HO-02-H1-PREREG, HO-02-H2-PREREG | pending_prereg |
| #3 chemistry | **not run** | DEV, 177 runs, CFG-03-cand: protease balanced accuracy 0.514 (target >= 0.75), called accuracy 0.956 (LB 0.891; target LB >= 0.90). Alkylation accuracy 0.358 vs always-CAM 0.916, 'none' recall 1/7. Label 0.639 vs baseline 0.798. Held-out: 179 files; 173 verified; ddaPASEF 6/10; Arg-C 13 runs (descriptive only). | HO-03-heldout (superseded), HO-03-heldout-r2, HO-03-heldout-SUPERSEDED | pending_scorer |
| #4 tag accuracy | **not run** | Test split 10 pools (9 scored). Margin not frozen. | HO-04-test | blocked_user_signoff |
| #5 shortlist hand-off | **not run** | 5 runs + 1 negative. Dev freeze and engine acceptance A5-02 not done. | HO-05-heldout, HO-05-negative | pending_dev |
| #6 charge inference | **not run** | H1 5 runs; Astral H2 missing; PXD001540 as #2. E6-01 truth not run. | HO-06-H1, HO-06-H2, HO-06-H1-PREREG, HO-06-H2-PREREG | pending_prereg |
| #7 raw-DIA refusal (default) | **not run** | E7-03: 214 files drawn; 149 non-DIA + 37 DIA converted. DIA 37 < 40 and no SWATH without the 11 SCIEX .wiff files (17 more vendor files also need Windows). | HO-07-E7-03, HO-07-E7-03-PREREG | pending_prereg |
| #9 profile centroiding | **not run** | 3 profile runs + 1 reserve, staged. Truth search, cells and scorer not pre-registered (heldout-1.12/item09.md). | HO-09-H1, HO-09-H1-NOTRUN, HO-09-H1-PREREG | pending_prereg |
| #11 census | **not run** (outside sprint) | F7-test and final pools registered only. | HO-11-f7test, HO-11-final | not_in_sprint |
| #15B c/z ions | **not run** | H1 PXD071331 + PXD024621, H2 PXD014719; 8 files staged. MSFragger truth and z definition not pre-registered. | HO-15B-sets, HO-15B-sets-PREREG | pending_prereg |
| #17 mass shifts | **not run** | 4 runs. Dev freeze and A5-02 not done. | HO-17-heldout | pending_dev |

Staging: every manifest is disjoint from its item's DEV set (17/17 PASS). All 13 manifests are staged and
sha256-verified on BinAC2; for item03 that is 177 of 179 files (BINAC2-RUNTIME.md). The BinAC2 runtime reproduces refs-1.12.0 (17/17 digests; Slurm
6464655 and 6464797). `scripts/check_registry.py` passes (25 manifest/config pairs, 0 failures).

## Release PR #34 (release/1.12.0 -> main, draft)

- **Mergeable: CONFLICTING.** main moved to 46f0316 (PR #32 PARAM_UI). Needs a main merge and PARAM_UI entries for
  the 1.12 parameters (hidden except acquisition_check). pull_request CI does not start while the conflict stands.
- CLI tree equals a117801. FASTag.bin 5cdba952... from the merge, byte-identical to a117801 built at the same path.
- Checks on node data (m1): ctest 65/65; gate_job PASS (GATE 9, BASELINE IDENTITY 60: 55 SAME / 4 ADDED / 1 PREFIX);
  gate.sh vs refs-1.10.0 PASS 9, vs refs-1.12.0 PASS 9; gate_new_cases refs-dev PASS 9, refs-1.12.0 PASS 8.
  Interface diff: help 1/+26, helphelp 1/+65, CTD 2/+79, INI 1/+78, with only the version lines changed.
- CI on 996e6d6: ci.yml 42464076709 **green**, ui.yml 42464076693 **green**. windows.yml 42464078928 **failed**:
  the Tauri MSI bundler got HTTP 504 on a download after fastag.exe built (transient). The failed job was re-run.
- 3208a05 (docs only): CHANGELOG/README wording from audit finding 4. No CI ran on it (see the conflict above).
- The PR body lists the open items, E7-03 among them.

## Audit findings

| # | Finding | Severity | Outcome |
|---|---|---|---|
| 1 | HO-03-heldout names configs that no longer exist (37c1ff84 "frozen", 9c04f9c1) | major | **Fixed** (1f580c8). Appended HO-03-heldout-r2 with CFG-03-base b539190a and CFG-03-cand e373910d (pending_scorer) and the fitted table sha256s 51d5d582 and 901989f3. The old row stays, and HO-03-heldout-SUPERSEDED marks it. New `scripts/check_registry.py` fails on any hash, status or manifest mismatch (PASS now). `registry_rows.py` no longer replaces committed rows. |
| 2 | "frozen" does not cover the scoring protocol | major | **Fixed** (bookkeeping). The README gate now requires a committed PREREG file with truth search per run, cells and pooling, denominator, and scorer with sha256. CFG-01-base, CFG-02-\*, CFG-06-\*, CFG-07, CFG-09-\* and CFG-15B-\* are now pending_prereg (hashes unchanged). -PREREG status rows replace the READY readings. **Open:** writing the PREREG-item02/06/07/09/15B files and the #1 scorer. |
| 3 | The #1 NO-GO uses a Poisson-replicate KS test, not the plan's all-decoy run | major | **Recorded, decision open.** PREREG-species-call.md now has a "Deviation" section with the stand-in's result next to the DEV false-present rate (35/36 runs). No status changed. |
| 4 | CHANGELOG implies unmarked options are validated and calls #1 "calibrated" | major | **Fixed** in PR #34 (3208a05). All new options are now experimental, and no option is described as held-out validated. #1 is now "Species call (decoy, experimental)": shipped table provisional, DEV check failed. #10 no longer says "calibrated". The README species wording follows. CLI tree unchanged. CI re-run waits on the main conflict. |
| 5 | #7 default ships without release test E7-03 | major | **Open: user decision.** E7-03 is listed in the PR #34 body and the CHANGELOG #7 entry. It cannot be fixed by bookkeeping: it needs the Windows conversions, then one scoring after a PREREG-item07.md. |

## Decisions needed from the user

1. **#7:** finish E7-03 before the merge (convert 11 SWATH .wiff and 17 other vendor files on Windows, register
   them, commit PREREG-item07.md, score CFG-07 once), or release the #7 default without its held-out release test.
2. **#1/#10:** accept the Poisson-replicate KS test as the go/no-go (NO-GO stands, `-species_call` stays opt-in and
   uncalibrated), or run the plan's all-decoy run on DEV first.
3. **#3:** whether to score CFG-03-* at all given the DEV misses (protease, alkylation, label), and whether 1.12.0
   ships the fitted v2 tables (not bundled now).
4. **#2/#6:** where the Astral and timsTOF H2 reserves come from, and what happens to the PXD001540 "QE" cell
   (its MS2 are ion trap).
5. **#4:** sign-off on F4-10/11/12 and the margin freeze.
6. **Release scope:** whether 1.12.0 ships with no held-out-validated option (all new options experimental, as the
   CHANGELOG now says), or waits for some items to be scored.
7. **PR #34:** the wording changes beyond the brief (Spectrum view 1.12, Linux app from 1.12.0, heading), and the
   main merge with PARAM_UI entries.

Work that needs no decision but has to be done before any held-out run on BinAC2: PREREG-item02/06/07/09/15B.md
(truth search, cells, denominator, scorer and its sha256), the #1 and #3 held-out scorers, the #5/#17 dev freeze and
A5-02, and re-verifying the 4 ddaPASEF and 2 tryptic #3 downloads.
