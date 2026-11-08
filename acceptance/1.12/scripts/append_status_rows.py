#!/usr/bin/env python3
"""Append (never replace) registry rows that bring the HO records up to frozen-configs.tsv after the 2026-11-08
audit: HO-03-heldout-r2 (the #3 manifest with the current CFG-03 configs, superseding HO-03-heldout, whose configs
were never run), a HO-03-heldout-SUPERSEDED marker, and one '-PREREG' status row per manifest whose configs moved
from 'frozen' to 'pending_prereg'. Refuses to write a row id that already exists. Run once; then check_registry.py.
Usage: append_status_rows.py <acceptance dir> <registry.tsv>"""
import csv, hashlib, sys

A, REG = sys.argv[1], sys.argv[2]
BIN = "c4c2ad67fcd9106e474f552267f7cdfefe107f394b268bbc236308b773e4d7f3"
DAY = "2026-11-08"
def rd(p):
    with open(p) as f:
        return list(csv.DictReader((l for l in f if not l.startswith("# ")), delimiter="\t"))
cfg = {r["config"]: r for r in rd(f"{A}/frozen-configs.tsv")}
reg = rd(REG); byid = {r["row_id"]: r for r in reg}
cols = open(REG).readline().rstrip("\n").split("\t")
def conf(cs):
    return "; ".join(f"{c} [{cfg[c]['status']}] {cfg[c]['options']} param_hash {cfg[c]['param_hash']}" for c in cs)
GATE = ("Gate (README 'Rules that bind the runs', amended 2026-11-08): a config is scored only when a committed "
        "PREREG file fixes the truth search per run (database, mods, tolerances), the cells and pooling, the "
        "denominator, and the scorer script with its sha256; until then its status is pending_prereg.")
rows = []
o = byid["HO-03-heldout"]
r2 = dict(o)
r2.update(row_id="HO-03-heldout-r2", flags=conf(["CFG-03-base", "CFG-03-cand"]), recorded=DAY,
          source="PREREG-chem.md; frozen-configs.tsv (scripts/make_configs.py); supersedes HO-03-heldout")
r2["notes"] = ("SUPERSEDES HO-03-heldout (same manifest, sha256 above): that row names CFG-03-base 37c1ff84... "
    "[frozen] and CFG-03-cand 9c04f9c1... [pending_dev_fit], which were replaced before any run and never run. "
    "Current configs: CFG-03-base b539190a... and CFG-03-cand e373910d..., both pending_scorer; fitted tables "
    "digest_models_v2.tsv 51d5d582c61856c16908d3fe8cf7337c92b859be91aafc7ca754fdba169e28b4 and "
    "digest_calibration.tsv 901989f3d90915a1a120ad945018913c35870c81bae0c596e0a149a557d9ed2c, "
    "-digest_min_confidence 0.8 (PREREG-chem.md). STATUS: NOT READY: the held-out scorer script (endpoint() of "
    "dev/scripts/fit_chem.py) is not committed with its sha256, and the user's decision on the DEV results "
    "(protease, alkylation, label miss their targets in-sample) is open. Manifest facts unchanged from "
    "HO-03-heldout: 179 files from 169 PXDs, 173/179 staged with sha256 at 1e91234, Arg-C descriptive only "
    "(13 runs), ddaPASEF 6 of 10 verified (timsTOF endpoint not met until 4 downloads verify). Not run, not scored.")
rows.append(r2)
rows.append({**{c: "" for c in cols}, "row_id": "HO-03-heldout-SUPERSEDED", "kind": "heldout_status", "item": "#3",
    "case": o["case"], "refset": o["refset"], "pxd": o["pxd"], "input": f"acceptance/1.12/manifests/{o['case']}.tsv",
    "input_sha256": o["input_sha256"], "flags": "CFG-03-base (37c1ff84..., stale), CFG-03-cand (9c04f9c1..., stale)",
    "notes": "HO-03-heldout is superseded by HO-03-heldout-r2. Its config hashes and statuses are stale (never run); "
             "use HO-03-heldout-r2 and frozen-configs.tsv. Kept in place as history.",
    "recorded": DAY, "source": "audit 2026-11-08; scripts/check_registry.py"})
PRE = [("HO-01-heldout", ["CFG-01-base", "CFG-01-cand"], "CFG-01-base: PREREG-species-call.md has no held-out scorer "
        "script with sha256. CFG-01-cand stays blocked_dev_nogo. #1 stays BLOCKED (DEV NO-GO) until the user decides."),
       ("HO-02-H1", ["CFG-02-base", "CFG-02-cand"], "No PREREG-item02.md: truth search per run, the lt_score.py rule, "
        "the cells, the Holm-adjusted cluster bootstrap, the denominator and the scorer sha256 are not committed. "
        "Also still BLOCKED by PXD001540 (ion-trap MS2) and the incomplete H2."),
       ("HO-02-H2", ["CFG-02-base", "CFG-02-cand"], "No PREREG-item02.md (see HO-02-H1-PREREG). RULE NOT MET (Astral 0/2, timsTOF 0/2) as before."),
       ("HO-06-H1", ["CFG-06-base", "CFG-06-cand"], "No PREREG-item06.md: the E6-01 charge truth, cells, denominator and "
        "scorer sha256 are not committed. Also still BLOCKED (Astral H2 missing, PXD001540)."),
       ("HO-06-H2", ["CFG-06-base", "CFG-06-cand"], "As HO-06-H1-PREREG; Astral reserve 0 as before."),
       ("HO-07-E7-03", ["CFG-07"], "No PREREG-item07.md: truth labels, strata pooling, denominator and scorer sha256 "
        "are not committed. Also still BLOCKED: 11 SCIEX SWATH .wiff (and 17 other vendor files) need msconvert on "
        "Windows; DIA strata 37 < 40, SWATH not covered."),
       ("HO-09-H1", ["CFG-09-base", "CFG-09-cand"], "Replaces the 'READY when staged' status of HO-09-H1. No "
        "PREREG-item09.md (see HO-09-H1-NOTRUN and output/features-1.12/heldout-1.12/item09.md). Not run."),
       ("HO-15B-sets", ["CFG-15B-base", "CFG-15B-cand"], "Replaces the READY reading of HO-15B-sets. No "
        "PREREG-item15B.md: the MSFragger c/z truth search per run (database, mods, tolerances, 1% PSM FDR), the z "
        "definition check on PXD060724, the cells, the denominator and the scorer sha256 are not committed. Not run.")]
for rid, cs, why in PRE:
    m = byid[rid]
    rows.append({**{c: "" for c in cols}, "row_id": f"{rid}-PREREG", "kind": "heldout_status", "item": m["item"],
        "case": m["case"], "refset": f"RC a117801, FASTag.bin {BIN}", "pxd": m["pxd"],
        "input": f"acceptance/1.12/manifests/{m['case']}.tsv", "input_sha256": m["input_sha256"], "flags": conf(cs),
        "notes": f"STATUS: NOT READY (pending_prereg). {why} {GATE} Not run, not scored; each config still available "
                 "for exactly one scoring.", "recorded": DAY,
        "source": "audit 2026-11-08; acceptance/1.12/README.md; frozen-configs.tsv"})
for r in rows:
    if r["row_id"] in byid:
        sys.exit(f"refusing: row {r['row_id']} exists already")
with open(REG, "a") as f:
    for r in rows:
        f.write("\t".join(str(r.get(c, "")).replace("\t", " ").replace("\n", " ") for c in cols) + "\n")
print("appended", [r["row_id"] for r in rows])
