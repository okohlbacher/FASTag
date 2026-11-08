#!/usr/bin/env python3
"""#1 (and #10) held-out runs (PLAN-organism-chemistry #1 'Held-out protocol' and 'Validation data').

Rule (fixed before any held-out run; no FASTag output is read):
  pool    = the runs of results/sdrf_truth_runs.tsv (234 PXDs) whose PXD is not one of the 37 DEV PXDs of
            config/species_runs.tsv; high-resolution MS2 only (first-MS2 filter FTMS/ASTMS, or a timsTOF/TOF run;
            ion-trap MS2 excluded); organism truth = SDRF characteristics[organism] of the run's row (community SDRF
            at bigbio 70bd353 or the submitter SDRF, as in sdrf_truth_runs.tsv); runs without an organism are dropped.
  multi   = pool runs whose SDRF row(s) name >= 2 organisms (xenograft, host-pathogen, spike-ins), at most 3 per PXD
            (random.Random('fastag-1.12:#1:multi:<PXD>') when more), PLUS the named mixtures PXD001819 (UPS1/yeast),
            PXD006118 (Kleiner mock communities), PXD023217 (CAMPI/SIHUMIx; PXD- and file-disjoint from DEV), 3 runs
            each drawn from PRIDE by select_named.py (seed 'fastag-1.12:#1:heldout:<PXD>').
  single  = the other pool runs (one organism), one run per PXD, PXDs sorted and shuffled with
            random.Random('fastag-1.12:#1:single'), taken until the held-out set has 50 runs (>= 40 required)
            from >= 25 PXDs.
  pseudo  = pool runs marked pseudo-DDA (DIAspeXtract) from non-DEV PXDs, at most 3 per PXD: a separate stratum,
            reported, excluded from the primary metrics.
  #10 is scored on the same set (second pre-registered config of #1).
Usage: select_species.py <sdrf_truth_runs.tsv> <sdrf dir> <species_runs.tsv> <all_pa_scan.tsv> <out.tsv>
"""
import csv, os, random, sys
sys.path.insert(0, os.environ.get("FASTAG_BENCH_SRC", "bench/fastag-bench/src"))
from fastag_bench.sdrftruth import read_sdrf, rows_for_run, _col, run_stem  # noqa: E402

TRUTH, SD, SPEC, SCAN, OUT = sys.argv[1:6]
TARGET = 50

def rd(p):
    with open(p) as f:
        return list(csv.DictReader((l for l in f if not l.startswith("#")), delimiter="\t"))

dev = {r["pxd"] for r in rd(SPEC)}
scan = {}
for r in rd(SCAN):
    scan.setdefault(run_stem(r["path"]), r)
src = rd(f"{SD}/sources.tsv")

def organisms(acc, run):
    for kind in ("submitter", "community"):
        for s in src:
            if s["acc"] == acc and s["kind"] == kind:
                head, rows = read_sdrf(f"{SD}/{acc}/{kind}/{s['file']}")
                hit = rows_for_run(head, rows, run)
                if hit:
                    orgs = set()
                    for v in _col(head, hit, "characteristics[organism]"):
                        for o in v.replace(" and ", ";").split(";"):
                            o = o.strip()
                            if o and o.lower() not in ("not available", "not applicable"): orgs.add(o)
                    return sorted(orgs), kind
    return [], ""

def hr(sc):
    f = sc.get("filter", "")
    if f.startswith("ITMS"): return False
    if f.startswith(("FTMS", "ASTMS")): return True
    return sc.get("ms2_analyser", "") in ("", "tof", "orbitrap", "astral")   # FileConverter .d: TOF

pool = []
for r in rd(TRUTH):
    acc = r["acc"].split("-")[0]
    if acc in dev: continue
    sc = scan.get(r["run"])
    orgs, kind = organisms(acc, r["run"])
    pool.append(dict(acc=acc, run=r["run"], set=r["set"], pseudo=r["pseudo"], orgs=orgs, kind=kind,
                     path=sc["path"] if sc else "", filter=sc.get("filter", "") if sc else "",
                     hr=hr(sc) if sc else None))
out = []
def add(p, stratum, note):
    out.append({"item": "#1", "split": "heldout", "stratum": stratum, "pxd": p["acc"], "run": p["run"],
                "sdrf_set": p["set"], "organisms": ";".join(p["orgs"]), "sdrf_kind": p["kind"], "path": p["path"],
                "ms2_filter": p["filter"], "selection": note})
skipped = {"no_mzml": 0, "low_res": 0, "no_organism": 0}
ok = []
for p in pool:
    if not p["path"]: skipped["no_mzml"] += 1; continue
    if not p["orgs"]: skipped["no_organism"] += 1; continue
    if p["pseudo"] == "True": ok.append(p); continue
    if not p["hr"]: skipped["low_res"] += 1; continue
    ok.append(p)
by = {}
for p in ok:
    k = "pseudo" if p["pseudo"] == "True" else ("multi" if len(p["orgs"]) >= 2 else "single")
    by.setdefault(k, {}).setdefault(p["acc"], []).append(p)
for k, cap in (("multi", 3), ("pseudo", 3)):
    for acc in sorted(by.get(k, {})):
        runs = sorted(by[k][acc], key=lambda p: p["run"])
        random.Random(f"fastag-1.12:#1:{k}:{acc}").shuffle(runs)
        for p in runs[:cap]:
            add(p, k if k == "pseudo" else "multi_sdrf", f"{k}: all eligible PXDs, <= {cap} runs per PXD")
named_multi = 9  # PXD001819, PXD006118, PXD023217 x 3, staged from PRIDE (select_named.py)
n_primary = sum(1 for o in out if o["stratum"] != "pseudo") + named_multi
accs = sorted(by.get("single", {}))
random.Random("fastag-1.12:#1:single").shuffle(accs)
for acc in accs:
    if n_primary >= TARGET: break
    runs = sorted(by["single"][acc], key=lambda p: p["run"])
    random.Random(f"fastag-1.12:#1:single:{acc}").shuffle(runs)
    add(runs[0], "single", "single: random.Random('fastag-1.12:#1:single') over PXDs, one run per PXD")
    n_primary += 1
with open(OUT, "w") as f:
    w = csv.DictWriter(f, fieldnames=list(out[0].keys()), delimiter="\t", lineterminator="\n")
    w.writeheader(); w.writerows(out)
print("pool", len(pool), "eligible", len(ok), "skipped", skipped, "rows", len(out), "primary incl. named mixtures", n_primary,
      "pxds", len({o["pxd"] for o in out if o["stratum"] != "pseudo"}) + 3)
