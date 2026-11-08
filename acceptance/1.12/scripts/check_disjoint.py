#!/usr/bin/env python3
"""Disjointness of each held-out manifest against its item's DEV set (PXD level and file level), and of each H2
reserve against its H1. Writes disjointness/<manifest>.tsv (one row per held-out file) and disjointness/summary.tsv.
DEV sets (from the item plans and the registry):
  #1/#10  config/species_runs.tsv (48 runs, 37 PXDs)
  #2      PXD076528, PXD001819, PXD003531, PXD054073, PXD000001            (PLAN-data-types #2)
  #3      sdrf_truth_runs.tsv (254 runs, 234 PXDs) + prose-auto validation sets/corpora + species DEV PXDs
          (the E7-03 exclusion list is a superset of the prose-auto sets)    (PLAN-organism-chemistry #3)
  #4      dev pools of proteometools_splits.tsv (pool level; peptide level via F4-12 shared identities)
  #5      PXD003531, PXD017035                                              (PLAN-handoff #5)
  #6      PXD001819, PXD003531                                              (PLAN-data-types #6)
  #9      PXD000865                                                         (PLAN-data-types #9)
  #11     F7-train pools and the #4 dev/test pools (pool level)             (PLAN-qc #11 phase C)
  #15B    PXD060724 (dev), PXD010783 (dev smoke)                            (registry E15B-02/03)
  #17     PXD003531                                                         (PLAN-handoff #17)
Usage: check_disjoint.py <acceptance dir>"""
import csv, glob, os, re, sys

A = sys.argv[1]
def rd(p):
    with open(p) as f:
        return list(csv.DictReader((l for l in f if not l.startswith("#")), delimiter="\t"))
def stem(n):
    n = os.path.basename(str(n).replace("\\", "/")).lower()
    while True:
        m = re.sub(r"\.(raw|mzml|d|zip|tar|gz|tgz|pseudo|profile|mgf|mzpeak)$", "", n)
        if m == n: return n
        n = m

bench = f"{A}/../../bench/fastag-bench/config"
sp = rd(f"{bench}/species_runs.tsv")
species_pxd = {r["pxd"] for r in sp}; species_files = {stem(r["mzml"]) for r in sp}
truth = rd(f"{A}/inputs/sdrf_truth_runs.tsv")
chem_pxd = {r["acc"].split("-")[0] for r in truth} | species_pxd | \
           {l.strip() for l in open(f"{A}/inputs/e703_exclude.txt") if l.strip()}
chem_files = {stem(r["run"]) for r in truth} | species_files
splits = rd(f"{bench}/proteometools_splits.tsv")
pool_split = {r["pool"]: r["split"] for r in splits}
DEV = {"#1": (species_pxd, species_files), "#10": (species_pxd, species_files),
       "#2": ({"PXD076528", "PXD001819", "PXD003531", "PXD054073", "PXD000001"}, set()),
       "#3": (chem_pxd, chem_files),
       "#5": ({"PXD003531", "PXD017035"}, set()), "#6": ({"PXD001819", "PXD003531"}, set()),
       "#9": ({"PXD000865"}, set()), "#15B": ({"PXD060724", "PXD010783"}, set()), "#17": ({"PXD003531"}, set())}
summ = []
for m in sorted(glob.glob(f"{A}/manifests/item*.tsv")):
    name = os.path.basename(m)[:-4]
    rows = rd(m)
    if not rows: continue
    out = []
    for r in rows:
        item = r.get("item", "")
        f = r.get("file") or r.get("run") or r.get("source", "")
        if item in ("#4", "#11"):
            dev_pools = {p for p, s in pool_split.items() if s == "dev"} if item == "#4" else \
                        {p for p, s in pool_split.items() if s in ("f7train", "dev", "test")}
            ok = r["pool"] not in dev_pools
            out.append({"file": f, "pxd": r["pxd"], "pool": r["pool"], "pxd_in_dev": "n/a (one PXD, pool-level split)",
                        "file_in_dev": "no" if ok else "YES", "result": "PASS" if ok else "FAIL"})
            continue
        pxds, files = DEV[item]
        p_in = r["pxd"] in pxds
        f_in = stem(f) in files
        out.append({"file": f, "pxd": r["pxd"], "pool": "", "pxd_in_dev": "YES" if p_in else "no",
                    "file_in_dev": "YES" if f_in else "no", "result": "FAIL" if (p_in or f_in) else "PASS"})
    os.makedirs(f"{A}/disjointness", exist_ok=True)
    with open(f"{A}/disjointness/{name}.tsv", "w") as o:
        w = csv.DictWriter(o, fieldnames=list(out[0].keys()), delimiter="\t", lineterminator="\n"); w.writeheader(); w.writerows(out)
    nf = sum(1 for x in out if x["result"] == "FAIL")
    summ.append([name, rows[0].get("item", ""), str(len(out)), str(nf), "PASS" if nf == 0 else "FAIL"])
# H2 vs H1 (reserve must not repeat an H1 PXD)
for item in ("item02", "item06"):
    h1 = {r["pxd"] for r in rd(f"{A}/manifests/{item}-H1.tsv")}
    h2 = {r["pxd"] for r in rd(f"{A}/manifests/{item}-H2.tsv")}
    summ.append([f"{item}-H2_vs_H1", "", str(len(h2)), str(len(h1 & h2)), "PASS" if not h1 & h2 else "FAIL"])
with open(f"{A}/disjointness/summary.tsv", "w") as o:
    o.write("manifest\titem\tfiles\tfailures\tresult\n")
    for s in summ: o.write("\t".join(s) + "\n")
for s in summ: print("\t".join(s))
