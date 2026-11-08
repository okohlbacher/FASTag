"""Round 3 status rows (DECISIONS-2026-11-08.md), read by append_r3_rows.py steps c, d, e: (row id, manifest,
configs named in long form, note). The configs' status and param_hash are taken from frozen-configs.tsv when the
row is appended."""
FLOOR = "INFO_FLOOR_PCT"   # replaced by the value in acclib.py (amendment 1), see NOTE_C
IT = "the 0.5 Da ion-trap twins (-it05: same option string + -fragment_tolerance 0.5 -fragment_tolerance_unit Da) on the ion_trap set"
NOTE_C = ("STATUS: frozen (round 3). PREREG-item{n}.md amendment 1: high-resolution sets scored with the 20 ppm configs, "
          + IT + "; informativeness floor: a cell whose baseline rank-1 correct rate is below 1.8% (from DEV PXD001819 at 0.5 Da "
          "only) is 'uninformative', not tested, never a pass; scorers/SHA256SUMS (score_item{n}.py, score_item02.py, acclib.py) "
          "in the amendment. {extra} Not run, not scored; each config available for exactly one scoring.")
c = [
 ("HO-02-H1-r3", "item02-H1", ["CFG-02-base", "CFG-02-cand", "CFG-02-base-it05", "CFG-02-cand-it05"],
  NOTE_C.replace("{n}", "02").replace("{extra}", "SUPERSEDED for scoring by item02-H1-r2 (HO-02-H1-r2): this manifest is NOT scored.")),
 ("HO-02-H1-r2-r3", "item02-H1-r2", ["CFG-02-base", "CFG-02-cand", "CFG-02-base-it05", "CFG-02-cand-it05"],
  NOTE_C.replace("{n}", "02").replace("{extra}", "The #2 H1 set scored: astral 3, ion_trap 6 (PXD001540 included), qe 1 (PXD069528), timstof 3.")),
 ("HO-02-H2-r3", "item02-H2", ["CFG-02-base", "CFG-02-cand", "CFG-02-base-it05", "CFG-02-cand-it05"],
  NOTE_C.replace("{n}", "02").replace("{extra}", "H2 reserve (corpus draw: ion_trap 2, qe 1 evaluable); used only as PREREG-item02.md's H2 rule says.")),
 ("HO-02-H2r-r3", "item02-H2r", ["CFG-02-base", "CFG-02-cand", "CFG-02-base-it05", "CFG-02-cand-it05"],
  NOTE_C.replace("{n}", "02").replace("{extra}", "H2 reserve from PRIDE (astral 1 run, underpowered; timstof 2); used only as PREREG-item02.md's H2 rule says.")),
 ("HO-06-H1-r3", "item06-H1", ["CFG-06-base", "CFG-06-cand", "CFG-06-base-it05", "CFG-06-cand-it05"],
  NOTE_C.replace("{n}", "06").replace("{extra}", "SUPERSEDED for scoring by item06-H1-r2 (HO-06-H1-r2): this manifest is NOT scored.")),
 ("HO-06-H1-r2-r3", "item06-H1-r2", ["CFG-06-base", "CFG-06-cand", "CFG-06-base-it05", "CFG-06-cand-it05"],
  NOTE_C.replace("{n}", "06").replace("{extra}", "The #6 H1 set scored: astral 1, ion_trap 4 (PXD001540 included), qe 1 (PXD069528); (2b) needs 2 of 3 sets better.")),
 ("HO-06-H2-r3", "item06-H2", ["CFG-06-base", "CFG-06-cand", "CFG-06-base-it05", "CFG-06-cand-it05"],
  NOTE_C.replace("{n}", "06").replace("{extra}", "H2 reserve (corpus draw); used only as PREREG-item06.md's H2 rule says.")),
 ("HO-06-H2r-r3", "item06-H2r", ["CFG-06-base", "CFG-06-cand", "CFG-06-base-it05", "CFG-06-cand-it05"],
  NOTE_C.replace("{n}", "06").replace("{extra}", "H2 reserve from PRIDE: astral 1 run, underpowered.")),
 ("HO-09-H1-r3", "item09-H1", ["CFG-09-base", "CFG-09-cand", "CFG-09-base-it05", "CFG-09-cand-it05"],
  NOTE_C.replace("{n}", "09").replace("{extra}", "ion_trap stratum PXD009049 with the -it05 twins (its truth was already 0.5 Da), orbitrap_tof PXD016519 + PXD018024 with the 20 ppm configs.")),
]
d = [
 ("HO-04-test-r3", "item04-test", ["CFG-04"],
  "STATUS: frozen (round 3, DECISIONS-2026-11-08 #6). PREREG-item04.md: F4-10/F4-11/F4-12 accepted as recorded, margin 0.05 "
  "(5 points) frozen (scorers/item04/unidentified-test.yaml, unidentified.margin_frozen), harness 7ef0f33 with file sha256s, "
  "FASTag = RC bundle a117801, 9 scored test pools, primary matched TL3 / pools_not_excluded / no_byproduct_candidate, Holm "
  "over TL3+TL5. Not run, not scored; scored exactly once on node data."),
]
e = [
 ("HO-03-heldout-r3", "item03-heldout", ["CFG-03-base", "CFG-03-cand"],
  "STATUS: not_scored_refit (DECISIONS-2026-11-08 #4). #3 is not scored on held-out data in 1.12.x; refit on DEV first, a new "
  "config is preregistered later. The manifest stays registered and unread; these configs are never scored."),
 ("HO-05-heldout-r3", "item05-heldout", ["CFG-05"],
  "STATUS: not_scored_refit (DECISIONS-2026-11-08 #4). #5 is not scored on held-out data in 1.12.x; refit on DEV first, a new "
  "config is preregistered later. The manifest stays registered and unread; CFG-05 is never scored."),
 ("HO-05-negative-r3", "item05-negative", ["CFG-05"],
  "STATUS: not_scored_refit (DECISIONS-2026-11-08 #4), as HO-05-heldout-r3."),
 ("HO-07-E7-03-r3", "item07-E7-03", ["CFG-07"],
  "STATUS: deferred_1.12.1 (DECISIONS-2026-11-08 #1). E7-03 is the #7 release test of 1.12.1; 1.12.0 ships the refuse default "
  "with the E7-02 sweep evidence. PREREG-item07.md stays as written for E7-03 as drawn (DIA 37 < 40, no SWATH); the SCIEX .wiff "
  "and other vendor conversions still need Windows. Not run, not scored."),
 ("HO-15B-sets-r3", "item15B-sets", ["CFG-15B-base", "CFG-15B-cand"],
  "STATUS: pending_msfragger (DECISIONS-2026-11-08 #5). The user accepts the MSFragger licence and provides the path; then "
  "PREREG-item15B.md gets the MSFragger version and jar sha256 and the z definition check on PXD060724 (DEV), and the configs "
  "are frozen in that commit. Not run, not scored."),
]
ROWS = {"c": c, "d": d, "e": e}
