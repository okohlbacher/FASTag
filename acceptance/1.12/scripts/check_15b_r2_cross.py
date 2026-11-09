#!/usr/bin/env python3
"""#15B round 2 (user decision 2026-11-09): the replacement sets (split H1/H2 rows of item15B-split-r2.tsv) must be
disjoint from every DEV set of every item (check_disjoint.py's DEV table, all items pooled, PXD and file level) and
from every other item's held-out manifest (manifests/item*.tsv except item15B*, PXD and file level).
Usage: check_15b_r2_cross.py <acceptance dir> <item15B-split-r2.tsv> <out.tsv>"""
import csv, glob, io, os, re, sys, contextlib, runpy

A, LOG, OUT = sys.argv[1:4]
def rd(p):
    with open(p) as f:
        return list(csv.DictReader((l for l in f if not l.startswith("# ")), delimiter="\t"))
def stem(n):
    n = os.path.basename(str(n).replace("\\", "/")).lower()
    while True:
        m = re.sub(r"\.(raw|mzml|d|zip|tar|gz|tgz|pseudo|profile|mgf|mzpeak)$", "", n)
        if m == n: return n
        n = m
# DEV table of check_disjoint.py, run in a scratch copy so its outputs do not touch the worktree
import tempfile, shutil
tmp = tempfile.mkdtemp()
shutil.copytree(A, f"{tmp}/a", ignore=shutil.ignore_patterns("results", "runs", "*.mzML"))
os.makedirs(f"{tmp}/bench/fastag-bench", exist_ok=True)
shutil.copytree(f"{A}/../../bench/fastag-bench/config", f"{tmp}/bench/fastag-bench/config")
os.makedirs(f"{tmp}/x", exist_ok=True)
shutil.move(f"{tmp}/a", f"{tmp}/x/1.12")
sys_argv = sys.argv
sys.argv = ["check_disjoint.py", f"{tmp}/x/1.12"]
with contextlib.redirect_stdout(io.StringIO()):
    g = runpy.run_path(f"{A}/scripts/check_disjoint.py")
sys.argv = sys_argv
dev_pxd = set().union(*(v[0] for v in g["DEV"].values()))
dev_files = set().union(*(v[1] for v in g["DEV"].values()))
dev_pools = {p for p, s in g["pool_split"].items() if s in ("f7train", "dev", "test")}
shutil.rmtree(tmp)
other_pxd, other_files = {}, {}
for m in sorted(glob.glob(f"{A}/manifests/item*.tsv")):
    name = os.path.basename(m)[:-4]
    if name.startswith("item15B"): continue
    for r in rd(m):
        p = r.get("pxd", ""); f = r.get("file") or r.get("run") or r.get("source", "")
        if p: other_pxd.setdefault(p, set()).add(name)
        if f: other_files.setdefault(stem(f), set()).add(name)
rows = [r for r in csv.DictReader(open(LOG), delimiter="\t") if r["split"] in ("H1", "H2")]
res = []
for r in rows:
    p, f = r["pxd"], stem(r["file"])
    hit = []
    if p in dev_pxd: hit.append("PXD in a DEV set")
    if f in dev_files: hit.append("file in a DEV set")
    if p in other_pxd: hit.append("PXD in " + ",".join(sorted(other_pxd[p])))
    if f in other_files: hit.append("file in " + ",".join(sorted(other_files[f])))
    res.append([r["split"], r["set"], p, r["file"], "; ".join(hit) or "-", "FAIL" if hit else "PASS"])
with open(OUT, "w") as o:
    o.write("split\tset\tpxd\tfile\toverlap\tresult\n")
    for x in res: o.write("\t".join(x) + "\n")
print(f"dev_pxd {len(dev_pxd)} dev_files {len(dev_files)} other_manifest_pxd {len(other_pxd)} files {len(other_files)}")
for x in res: print("\t".join(x))
print("RESULT", "PASS" if res and all(x[-1] == "PASS" for x in res) else "FAIL")
