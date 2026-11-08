#!/usr/bin/env python3
"""2026-11-08, prep round 2 ('prereg'): set the status of the configs whose scoring protocol is now pre-registered
(PREREG-item02/06/07/09/15B.md, the held-out sections of PREREG-species-call.md and PREREG-chem.md) and append one
status row per manifest to the registry. Only the status and note columns of frozen-configs.tsv change; options,
tables and param_hash stay as they are. Statuses follow the README scoring-protocol gate:
  frozen               the PREREG fixes truth search, cells, denominator and scorer sha256, and nothing else is open
                       (CFG-01-base, CFG-09-*);
  blocked_user_signoff the PREREG is complete, but an open user decision changes what it scores (CFG-02-*, CFG-06-*:
                       decision 4; CFG-07: decision 1, E7-03 shortfall; CFG-03-*: decision 3, DEV misses);
  pending_dev          a DEV step of the plan is still missing (CFG-15B-*: MSFragger and the z check).
Refuses to write a row id that exists. Run once; then check_registry.py.
Usage: append_prereg_rows.py <acceptance dir>"""
import csv
import hashlib
import sys

A = sys.argv[1]
REG, CFG = f"{A}/validation-registry.tsv", f"{A}/frozen-configs.tsv"
BIN = "c4c2ad67fcd9106e474f552267f7cdfefe107f394b268bbc236308b773e4d7f3"
DAY = "2026-11-08"


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


S = {f: sha(f"{A}/scorers/{f}") for f in ("acclib.py", "score_item01.py", "score_item02.py", "score_item03.py",
                                          "score_item06.py", "score_item07.py", "score_item09.py", "score_item15B.py")}
NEW = {
    "CFG-01-base": ("frozen", f"held-out protocol in PREREG-species-call.md (2026-11-08), scorer scorers/score_item01.py "
                    f"{S['score_item01.py']}; scored only together with CFG-01-cand (blocked_dev_nogo)"),
    "CFG-02-base": ("blocked_user_signoff", "PREREG-item02.md fixes truth, cells, denominator, scorer "
                    f"(score_item02.py {S['score_item02.py']}); user decision 4 open (PXD001540 ion-trap 'QE' run scored "
                    "as ion_trap; H2 without Astral/timsTOF); frozen by the PREREG amendment commit once accepted"),
    "CFG-02-cand": ("blocked_user_signoff", "as CFG-02-base (PREREG-item02.md, user decision 4)"),
    "CFG-03-base": ("blocked_user_signoff", f"held-out scorer committed (PREREG-chem.md; score_item03.py "
                    f"{S['score_item03.py']}); user decision 3 on the DEV misses (protease, alkylation, label) open"),
    "CFG-03-cand": ("blocked_user_signoff", "as CFG-03-base (PREREG-chem.md, user decision 3)"),
    "CFG-06-base": ("blocked_user_signoff", "PREREG-item06.md fixes truth (Sage charge_truth on the charge-stripped "
                    f"copy), cells, denominator, scorer (score_item06.py {S['score_item06.py']}); user decision 4 open"),
    "CFG-06-cand": ("blocked_user_signoff", "as CFG-06-base (PREREG-item06.md, user decision 4)"),
    "CFG-07": ("blocked_user_signoff", f"PREREG-item07.md for E7-03 as drawn (score_item07.py {S['score_item07.py']}); "
               "DIA 37 < 40 and no SWATH (11 SCIEX .wiff need Windows); user decision 1 (complete E7-03 or score as drawn)"),
    "CFG-09-base": ("frozen", f"PREREG-item09.md (score_item09.py {S['score_item09.py']}); PXD035981 not evaluable "
                    "(no truth database), reserve PXD018024 in its place"),
    "CFG-09-cand": ("frozen", "as CFG-09-base (PREREG-item09.md)"),
    "CFG-15B-base": ("pending_dev", "PREREG-item15B.md fixes runs, cells, denominator, scorer "
                     f"(score_item15B.py {S['score_item15B.py']}); open: MSFragger not installed (licence: the user), "
                     "its version and jar sha256, the z definition check on PXD060724 (DEV)"),
    "CFG-15B-cand": ("pending_dev", "as CFG-15B-base (PREREG-item15B.md)"),
}
ROWS = [  # (new row id, manifest row it refers to, configs, why)
    ("HO-01-heldout-PREREG-r2", "HO-01-heldout", ["CFG-01-base", "CFG-01-cand"],
     "Held-out scoring protocol of #1/#10 committed in PREREG-species-call.md (truth: Sage ref50 genus-unique peptides "
     "per scorers/truth/item01.tsv; hard negatives family/order only; scorer score_item01.py). CFG-01-base frozen; "
     "CFG-01-cand stays blocked_dev_nogo (stand-in and all-decoy DEV tests failed), so #1 is NOT RUN and cannot run."),
    ("HO-02-H1-PREREG-r2", "HO-02-H1", ["CFG-02-base", "CFG-02-cand"],
     "PREREG-item02.md committed: Sage truth per run (scorers/truth/item02.tsv), 54 cells set x profile x length x "
     "charge, Holm-adjusted cluster bootstrap, all truth spectra as denominator, scorer score_item02.py. BLOCKED by "
     "user decision 4: PXD001540 is scored in the ion_trap set (no QE set in H1), H2 lacks Astral and timsTOF."),
    ("HO-02-H2-PREREG-r2", "HO-02-H2", ["CFG-02-base", "CFG-02-cand"],
     "PREREG-item02.md committed (see HO-02-H1-PREREG-r2); H2 used only for a retry; PXD035981 not evaluable (no truth "
     "database)."),
    ("HO-03-heldout-PREREG", "HO-03-heldout-r2", ["CFG-03-base", "CFG-03-cand"],
     "Held-out scorer committed (PREREG-chem.md section 'Held-out scoring protocol', score_item03.py; reproduces "
     "eval_passes.json on DEV). pending_scorer -> blocked_user_signoff: user decision 3 (DEV misses) open."),
    ("HO-06-H1-PREREG-r2", "HO-06-H1", ["CFG-06-base", "CFG-06-cand"],
     "PREREG-item06.md committed: charge-stripped copy (scorers/strip_charge.py, the gate's derivation), Sage "
     "charge_truth on it, charge accuracy and 18 non-inferiority cells, scorer score_item06.py. BLOCKED by user "
     "decision 4 (sets as #2; no Astral H2)."),
    ("HO-06-H2-PREREG-r2", "HO-06-H2", ["CFG-06-base", "CFG-06-cand"], "PREREG-item06.md committed (see HO-06-H1-PREREG-r2)."),
    ("HO-07-E7-03-PREREG-r2", "HO-07-E7-03", ["CFG-07"],
     "PREREG-item07.md committed for the E7-03 sample as drawn (truth = drawn stratum class, no relabelling; 0 false "
     "refusals with exact 95% bound; >= 90% refused per DIA stratum with >= 5 scored files; scorer score_item07.py). "
     "SHORTFALL: DIA 37 < 40, SWATH not covered (1 scorable DIA_swath file, a timsTOF .d). BLOCKED by user decision 1."),
    ("HO-09-H1-PREREG-r2", "HO-09-H1", ["CFG-09-base", "CFG-09-cand"],
     "PREREG-item09.md committed: Sage truth on the centroided corpus mzML (scorers/truth/item09.tsv), PXD035981 not "
     "evaluable and replaced by the reserve PXD018024 (fixed before any run), 18 cells stratum x length x charge, B2 "
     "tagged-spectra check, scorer score_item09.py. CFG-09-base/cand FROZEN; not run, not scored."),
    ("HO-15B-sets-PREREG-r2", "HO-15B-sets", ["CFG-15B-base", "CFG-15B-cand"],
     "PREREG-item15B.md committed except the truth engine version: MSFragger is not installed (licence acceptance is "
     "the user's), its version/jar sha256 and the PXD060724 z definition check are open -> pending_dev. set6 "
     "(PXD071331) is all EThcD (hybrid), which auto reads as b/y."),
]


def rd(p):
    with open(p) as f:
        return list(csv.DictReader((l for l in f if not l.startswith("# ")), delimiter="\t"))


lines = open(CFG).read().splitlines()
head = lines[0].split("\t")
iS, iN, iC = head.index("status"), head.index("note"), head.index("config")
out = [lines[0]]
for l in lines[1:]:
    f = l.split("\t")
    if f[iC] in NEW:
        f[iS], f[iN] = NEW[f[iC]]
    out.append("\t".join(f))
open(CFG, "w").write("\n".join(out) + "\n")
cfg = {r["config"]: r for r in rd(CFG)}
reg = rd(REG)
byid = {r["row_id"]: r for r in reg}
cols = open(REG).readline().rstrip("\n").split("\t")
GATE = ("Scorers: scorers/SHA256SUMS; acclib.py " + S["acclib.py"] + ". DEV tests on DEV outputs only "
        "(scorers/tests/run_dev_tests.sh, dev_results/). Not run, not scored; each config still available for exactly "
        "one scoring.")
new = []
for rid, ref, cs, why in ROWS:
    if rid in byid:
        sys.exit(f"refusing: row {rid} exists already")
    m = byid[ref]
    new.append({**{c: "" for c in cols}, "row_id": rid, "kind": "heldout_status", "item": m["item"], "case": m["case"],
                "refset": f"RC a117801, FASTag.bin {BIN}", "pxd": m["pxd"],
                "input": f"acceptance/1.12/manifests/{m['case']}.tsv", "input_sha256": m["input_sha256"],
                "flags": "; ".join(f"{c} [{cfg[c]['status']}] {cfg[c]['options']} param_hash {cfg[c]['param_hash']}"
                                   for c in cs),
                "notes": f"STATUS: {', '.join(sorted({cfg[c]['status'] for c in cs}))}. {why} {GATE}",
                "recorded": DAY, "source": "prep round 2 (prereg); README scoring-protocol gate; frozen-configs.tsv"})
with open(REG, "a") as f:
    for r in new:
        f.write("\t".join(str(r.get(c, "")).replace("\t", " ").replace("\n", " ") for c in cols) + "\n")
print("statuses", {c: v[0] for c, v in NEW.items()})
print("appended", [r["row_id"] for r in new])
