#!/usr/bin/env python3
"""Held-out candidates for the -species_call explain PREREG (draft). No FASTag output is read.
Rule: the select_species.py rule of 1.12 #1 on what that draw left over.
  pool    = runs of sdrf_truth_runs.tsv with a local mzML (all_pa_scan.tsv), high-resolution MS2 (first-MS2 filter
            FTMS/ASTMS or a TOF run; ion trap and pseudo-DDA excluded), organism = SDRF characteristics[organism].
  exclude = every PXD and every file stem of species_dev_all.tsv, training_runs.tsv, species_runs.tsv and the
            1.12 #1 held-out manifest item01-heldout.tsv (all strata, including its pseudo and ion-trap rows).
  draw    = one run per PXD for one-organism PXDs, at most 3 for PXDs naming >= 2 organisms,
            random.Random('fastag-1.13:species-explain:<PXD>').
Writes the manifest and, next to it, <out>.disjoint.tsv (one row per run x exclusion list; all must be PASS).
Usage: select_heldout.py TRUTH SDRF_DIR SCAN OUT EXCLUDE.tsv [EXCLUDE.tsv ...]"""
import csv, os, random, re, sys
sys.path.insert(0, os.environ.get("FASTAG_BENCH_SRC", "bench/fastag-bench/src"))
from fastag_bench.sdrftruth import read_sdrf, rows_for_run, _col, run_stem  # noqa: E402

TRUTH, SD, SCAN, OUT = sys.argv[1:5]

def rd(p):
    with open(p) as f:
        return list(csv.DictReader((l for l in f if not l.startswith("# ")), delimiter="\t"))
def stem(n):
    n = os.path.basename(str(n).replace("\\", "/")).lower()
    while True:
        m = re.sub(r"\.(raw|mzml|d|zip|tar|gz|tgz|pseudo|profile|mgf|mzpeak)$", "", n)
        if m == n: return n
        n = m

excl = {}
for p in sys.argv[5:]:
    rows = rd(p)
    excl[os.path.basename(p)] = ({r["pxd"] for r in rows},
                                 {stem(r.get(c, "")) for r in rows for c in ("path", "mzml", "run", "staged_raw", "source") if r.get(c)})
scan = {}
for r in rd(SCAN): scan.setdefault(run_stem(r["path"]), r)
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

skip = {"excluded_pxd_or_file": 0, "no_mzml": 0, "pseudo": 0, "low_res": 0, "no_organism": 0}
by = {}
for r in rd(TRUTH):
    acc = r["acc"].split("-")[0]
    if any(acc in px or stem(r["run"]) in fs for px, fs in excl.values()): skip["excluded_pxd_or_file"] += 1; continue
    sc = scan.get(r["run"])
    if not sc: skip["no_mzml"] += 1; continue
    if r["pseudo"] == "True": skip["pseudo"] += 1; continue
    f = sc.get("filter", "")
    if f.startswith("ITMS") or not (f.startswith(("FTMS", "ASTMS")) or sc.get("ms2_analyser", "") in ("", "tof", "orbitrap", "astral")):
        skip["low_res"] += 1; continue
    orgs, kind = organisms(acc, r["run"])
    if not orgs: skip["no_organism"] += 1; continue
    by.setdefault(acc, []).append(dict(pxd=acc, run=r["run"], organisms=";".join(orgs), sdrf_kind=kind, path=sc["path"], ms2_filter=f))
out = []
for acc in sorted(by):
    runs = sorted(by[acc], key=lambda p: p["run"])
    random.Random(f"fastag-1.13:species-explain:{acc}").shuffle(runs)
    multi = any(";" in p["organisms"] for p in runs)
    for p in runs[:3 if multi else 1]:
        out.append(dict(split="heldout", stratum="multi" if ";" in p["organisms"] else "single", **p))
with open(OUT, "w") as f:
    w = csv.DictWriter(f, fieldnames=list(out[0].keys()), delimiter="\t", lineterminator="\n")
    w.writeheader(); w.writerows(out)
bad = 0
with open(OUT + ".disjoint.tsv", "w") as f:
    f.write("run\tpxd\tlist\tpxd_in_list\tfile_in_list\tresult\n")
    for o in out:
        for name, (px, fs) in excl.items():
            a, b = o["pxd"] in px, stem(o["path"]) in fs or stem(o["run"]) in fs
            bad += a or b
            f.write(f"{o['run']}\t{o['pxd']}\t{name}\t{'yes' if a else 'no'}\t{'yes' if b else 'no'}\t{'FAIL' if a or b else 'PASS'}\n")
print("skipped", skip, "rows", len(out), "pxds", len(by), "disjointness failures", bad)
