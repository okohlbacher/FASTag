#!/usr/bin/env python3
"""Check that no DEV input of a DEV regeneration is a held-out file of ANY item (not only its own item).

A DEV file is flagged when, against any row of any acceptance/1.12/manifests/item*.tsv (rejected candidate sets
included, to be safe):
  - its file stem equals a held-out stem, or one stem is a prefix of the other within the same PXD
    (catches re-conversions such as '<raw stem>-20141210.mzML');
  - or its size equals a held-out fastag_input_bytes / bytes value and its sha256 equals that row's
    fastag_input_sha256 / raw_sha256 (hashed only on a size match).
Usage: check_dev_inputs.py <manifests dir> <dev list tsv: run_id, pxd, path> <out tsv>
Exit 0 when nothing is flagged, 1 otherwise."""
import csv, glob, hashlib, os, re, sys

MAN, DEV, OUT = sys.argv[1:4]


def rd(p):
    with open(p) as f:
        return list(csv.DictReader((l for l in f if not l.startswith("# ")), delimiter="\t"))


def stem(n):
    n = os.path.basename(str(n).replace("\\", "/").rstrip("/")).lower()
    while True:
        m = re.sub(r"\.(raw|mzml|d|zip|tar|gz|tgz|pseudo|profile|mgf|mzpeak|wiff|wiff2|scan|baf)$", "", n)
        if m == n:
            return n
        n = m


ho = []  # (item, split, pxd, stem, sizes, shas, manifest)
for m in sorted(glob.glob(os.path.join(MAN, "item*.tsv"))):
    for r in rd(m):
        names = [r.get(k, "") for k in ("file", "run", "source", "staged_raw", "fastag_input") if r.get(k)]
        sizes = {r.get(k) for k in ("bytes", "fastag_input_bytes") if r.get(k)}
        shas = {r.get(k) for k in ("raw_sha256", "fastag_input_sha256") if r.get(k)}
        for n in names:
            ho.append((r.get("item", ""), r.get("split", ""), r.get("pxd", ""), stem(n), sizes, shas,
                       os.path.basename(m)))
by_size = {}
for h in ho:
    for s in h[4]:
        by_size.setdefault(s, []).append(h)

dev = rd(DEV)
out, bad = [], 0
for d in dev:
    st, pxd, path = stem(d["path"]), d["pxd"], d["path"]
    hits = set()
    for item, split, hpxd, hst, _, _, man in ho:
        if st == hst or (pxd == hpxd and hst and (st.startswith(hst) or hst.startswith(st))):
            hits.add(f"{man}:{item}:{split}:name")
    try:
        size = str(os.path.getsize(path))
    except OSError:
        size = ""
    if size in by_size:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for b in iter(lambda: f.read(1 << 24), b""):
                h.update(b)
        dig = h.hexdigest()
        for item, split, _, _, _, shas, man in by_size[size]:
            if dig in shas:
                hits.add(f"{man}:{item}:{split}:sha256")
    bad += bool(hits)
    out.append({"run_id": d["run_id"], "pxd": pxd, "path": path, "result": "HELD-OUT" if hits else "PASS",
                "hits": ";".join(sorted(hits))})
with open(OUT, "w") as o:
    w = csv.DictWriter(o, fieldnames=["run_id", "pxd", "path", "result", "hits"], delimiter="\t",
                       lineterminator="\n")
    w.writeheader()
    w.writerows(out)
print(f"{len(dev)} DEV inputs, {bad} flagged as held-out files")
sys.exit(1 if bad else 0)
