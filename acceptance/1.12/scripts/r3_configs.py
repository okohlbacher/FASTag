#!/usr/bin/env python3
"""Round 3 changes to frozen-configs.tsv (DECISIONS-2026-11-08.md), one step per commit. The param_hash formula is
make_configs.py's: sha256 of 'binary=<sha>;bundle=<SHA256SUMS sha>;options=<options>;tables=<name:sha,...>'.
The status is not part of the hash. Existing option strings and hashes are never changed. Only status and note
change, and new rows are appended.
  c  append the 0.5 Da ion-trap twins CFG-02/06/09-{base,cand}-it05 (option string of the 20 ppm config plus
     '-fragment_tolerance 0.5 -fragment_tolerance_unit Da', used on ion-trap MS2 runs only), all 'frozen'; set
     CFG-02-*, CFG-06-* 'frozen' (decision 3 closes decision 4 of the readiness list; PREREG amendments committed)
  d  CFG-04 'frozen' (decision 6; PREREG-item04.md)
  e  CFG-03-base, CFG-03-cand, CFG-05 'not_scored_refit'; CFG-07 'deferred_1.12.1'; CFG-15B-* 'pending_msfragger'
Usage: r3_configs.py <acceptance dir> <step>"""
import csv, hashlib, sys

A, STEP = sys.argv[1], sys.argv[2]
P = f"{A}/frozen-configs.tsv"
with open(P) as f:
    rows = list(csv.DictReader(f, delimiter="\t"))
cols = list(rows[0].keys())
by = {r["config"]: r for r in rows}
TOL = "-fragment_tolerance 0.5 -fragment_tolerance_unit Da"

def h(r):
    return hashlib.sha256(f"binary={r['binary_sha256']};bundle={r['bundle_sha256sums']};options={r['options']};"
                          f"tables={r['tables']}".encode()).hexdigest()
for r in rows:   # guard: no committed hash may drift
    assert h(r) == r["param_hash"], r["config"]

def setst(c, st, note):
    by[c]["status"] = st
    by[c]["note"] = note

if STEP == "c":
    for item, pre in (("#2", "PREREG-item02.md"), ("#6", "PREREG-item06.md"), ("#9", "PREREG-item09.md")):
        n = item[1:].zfill(2)
        for arm in ("base", "cand"):
            src = by[f"CFG-{n}-{arm}"]
            cid = f"CFG-{n}-{arm}-it05"
            assert cid not in by
            r = dict(src)
            r.update(config=cid, options=f"{src['options']} + {TOL} (ion-trap MS2 runs only; {src['config']} on the other runs)",
                     status="frozen",
                     note=f"0.5 Da ion-trap twin of {src['config']} (DECISIONS-2026-11-08 #2); {pre} amendment 1 "
                          f"(cells, denominator, informativeness floor, scorer sha256); scored once, on the ion_trap set only")
            r["param_hash"] = h(r)
            rows.append(r); by[cid] = r
    for c in ("CFG-02-base", "CFG-02-cand"):
        setst(c, "frozen", "PREREG-item02.md amendment 1 (round 3): item02-H1-r2 high-resolution sets (astral, qe, timstof); "
              "ion_trap set scored with the -it05 twin; H2 reserves item02-H2 + item02-H2r; informativeness floor; scorer sha256 in the amendment")
    for c in ("CFG-06-base", "CFG-06-cand"):
        setst(c, "frozen", "PREREG-item06.md amendment 1 (round 3): item06-H1-r2 high-resolution sets (astral, qe); ion_trap "
              "set scored with the -it05 twin; H2 reserves item06-H2 + item06-H2r; informativeness floor; scorer sha256 in the amendment")
    for c in ("CFG-09-base", "CFG-09-cand"):
        setst(c, "frozen", "PREREG-item09.md (score_item09.py) and amendment 1 (round 3): orbitrap_tof stratum only; the ion_trap "
              "stratum (PXD009049) is scored with the -it05 twin; informativeness floor; scorer sha256 in the amendment")
elif STEP == "d":
    setst("CFG-04", "frozen", "PREREG-item04.md (round 3, DECISIONS-2026-11-08 #6): F4-10/F4-11/F4-12 and the margin accepted by "
          "the user; truth, cells, denominator, scorer sha256 in PREREG-item04.md; scored once on item04-test")
elif STEP == "e":
    for c in ("CFG-03-base", "CFG-03-cand"):
        setst(c, "not_scored_refit", "DECISIONS-2026-11-08 #4: not scored on held-out in 1.12.x; refit on DEV first, a new config "
              "is preregistered later (old note: DEV misses protease/alkylation/label; PREREG-chem.md, score_item03.py 285df1d0)")
    setst("CFG-05", "not_scored_refit", "DECISIONS-2026-11-08 #4: not scored on held-out in 1.12.x; refit on DEV first, a new config "
          "is preregistered later (DEV freeze dev/engines/FREEZE-05-17.md missed recall 0.95 / retained 0.90; A5-02 PASS)")
    setst("CFG-07", "deferred_1.12.1", "DECISIONS-2026-11-08 #1: E7-03 release test deferred to 1.12.1; 1.12.0 ships the default "
          "with the E7-02 sweep evidence; PREREG-item07.md (score_item07.py b135aa9b) stays for E7-03 as drawn")
    for c in ("CFG-15B-base", "CFG-15B-cand"):
        setst(c, "pending_msfragger", "DECISIONS-2026-11-08 #5: the user accepts the MSFragger licence and provides the path; "
              "not scored until then (PREREG-item15B.md, score_item15B.py 0e8534db; MSFragger version, jar sha256 and the z "
              "definition check on PXD060724 (DEV) still to be recorded)")
else:
    sys.exit("step c|d|e")
with open(P, "w") as o:
    w = csv.DictWriter(o, fieldnames=cols, delimiter="\t", lineterminator="\n")
    w.writeheader(); w.writerows(rows)
print("\n".join(f"{r['config']}\t{r['status']}\t{r['param_hash'][:12]}" for r in rows))
