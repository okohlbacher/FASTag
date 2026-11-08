#!/usr/bin/env python3
"""Merge the draws (inputs/raw_*.tsv, manifests drawn by select_corpus.py, the split tables) with the staging
results (inputs/staged/*.tsv from stage_pride.sh / e703_conv.sh) into one manifest per item and split.
Staged paths are relative to data:/scratch/kohlbach/fastag-heldout-1.12. Run select_corpus.py first (the corpus
manifests are rewritten here). Usage: build_manifests.py <acceptance dir>"""
import csv, os, sys

A = sys.argv[1]; I = f"{A}/inputs"; M = f"{A}/manifests"; S = f"{I}/staged"
ROOT = "data:/scratch/kohlbach/fastag-heldout-1.12"
def rd(p):
    if not os.path.exists(p): return []
    with open(p) as f:
        return list(csv.DictReader((l for l in f if not l.startswith("# ")), delimiter="\t"))
def staged(*names):
    d = {}
    for n in names:
        p = f"{S}/{n}"
        if not os.path.exists(p): continue
        for l in open(p):
            x = l.rstrip("\n").split("\t")
            if len(x) >= 9: d[x[0]] = x
    return d
def put(r, x):
    if not x:
        r.update(stage_status="NOT STAGED YET", staged_raw="", raw_sha256="", fastag_input="", fastag_input_bytes="",
                 fastag_input_sha256="", conversion=r.get("conversion", "")); return r
    conv_ok = x[4] in ("0", "NA")
    st = x[2] + ("" if conv_ok else f";CONVERSION_FAILED_rc{x[4]}")
    r.update(stage_status=st, staged_raw=x[1], raw_sha256=x[3],
             fastag_input=x[5] if x[5] else x[1], fastag_input_bytes=x[6], fastag_input_sha256=x[7] if x[5] else x[3],
             conversion=x[8])
    return r
def write(name, rows):
    if not rows: return
    keys = []
    for r in rows:
        for k in r:
            if k not in keys: keys.append(k)
    with open(f"{M}/{name}.tsv", "w") as f:
        f.write(f"# staged under {ROOT}\n")
        w = csv.DictWriter(f, fieldnames=keys, delimiter="\t", lineterminator="\n", restval=""); w.writeheader(); w.writerows(rows)
    print(name, len(rows), sum(1 for r in rows if r.get("stage_status", "").startswith(("copied", "sha1_ok", "no_pride_sha1"))
                               and "FAILED" not in r.get("stage_status", "") and "MISMATCH" not in r.get("stage_status", "")))

# #2/#6/#9 (corpus): annotate the select_corpus.py manifests
sc = staged("staged_corpus.tsv")
for name in ("item02-H1", "item02-H2", "item06-H1", "item06-H2"):
    rows = [r for r in rd(f"{M}/{name}.tsv")]
    src = "item02-H1" if name.endswith("H1") else "item02-H2"
    out = []
    for r in rows:
        x = sc.get(f"{src}:{r['pxd']}")
        r = {k: v for k, v in r.items() if k not in ("stage_status", "staged_raw", "raw_sha256", "fastag_input_bytes")}
        keep = (r["fastag_input"], r["fastag_input_sha256"])
        put(r, x)
        r["source_fastag_input"], r["expected_sha256"] = keep
        if x and x[3] != keep[1]: r["stage_status"] += ";SHA256_DIFFERS_FROM_SOURCE"
        out.append(r)
    write(name, out)
rows = []
for r in rd(f"{M}/item09-H1.tsv"):
    r = {k: v for k, v in r.items() if k not in ("stage_status", "staged_raw", "raw_sha256", "fastag_input_bytes", "truth_staged", "truth_staged_sha256")}
    put(r, sc.get(f"item09:{r['split']}:{r['pxd']}"))
    t = sc.get(f"item09:{r['split']}:{r['pxd']}:truth")
    r["truth_staged"], r["truth_staged_sha256"] = (t[1], t[3]) if t else ("", "")
    rows.append(r)
write("item09-H1", rows)
# #1
s1 = staged("staged_1.tsv")
rows = []
for r in rd(f"{I}/raw_species_heldout.tsv"):
    r = dict(r, source=r.pop("path"))
    rows.append(put(r, s1.get(f"item01:{r['stratum']}:{r['pxd']}")))
for r in rd(f"{I}/raw_named_1.tsv"):
    rows.append(put(dict(item="#1", split="heldout", stratum="multi_named", pxd=r["pxd"], run=r["file"], source=r["url"],
                         pride_sha1=r["pride_sha1"], bytes=r["bytes"], selection=r["selection"]),
                    s1.get(f"item01:multi_named:{r['pxd']}:{r['file']}")))
for r in rd(f"{I}/raw_species_extra.tsv"):
    rows.append(put(dict(item="#1", split="heldout", stratum="multi_bigbio", pxd=r["pxd"], run=r["file"], source=r["url"],
                         pride_sha1=r["pride_sha1"], bytes=r["bytes"], organisms=r["organisms"], sdrf=r["sdrf"],
                         instrument=r["instrument"], selection=r["selection"]), s1.get(f"item01:multi_bigbio:{r['pxd']}")))
write("item01-heldout", rows)
# #3
s3 = staged("staged_3.tsv")
write("item03-heldout", [put(dict(r), s3.get(f"item03:{r['stratum'].replace(':', '_')}:{r['pxd']}:{r['run']}"))
                         for r in rd(f"{I}/raw_chem_heldout.tsv")])
# #5, #17
s5 = staged("staged_5_17.tsv")
g = {}
for r in rd(f"{I}/raw_named_5_17.tsv"):
    it = "item%02d" % int(r["item"].lstrip("#"))
    g.setdefault(f"{it}-{r['split']}", []).append(put(dict(r), s5.get(f"{it}:{r['split']}:{r['pxd']}")))
for k, v in g.items(): write(k, v)
# #4, #11: from bench/fastag-bench/config/proteometools_splits.tsv (drawn 2026-11-07, F4-06)
sp = staged("staged_pt.tsv")
spl = rd(f"{A}/../../bench/fastag-bench/config/proteometools_splits.tsv")
for name, split, item in (("item04-test", "test", "#4"), ("item11-f7test", "f7test", "#11"), ("item11-final", "final", "#11")):
    write(name, [put(dict(item=item, split=split, pool=r["pool"], seed=r["seed"], batch=r["batch"], pxd="PXD004732",
                          file=r["raw_3xhcd"], bytes=r["raw_size"], pride_sha1=r["raw_sha1"], url=r["raw_url"],
                          selection=f"proteometools_splits.tsv (F4-06), seed {r['seed']}"), sp.get(f"{name}:{r['pool']}"))
                 for r in spl if r["split"] == split])
# #15B
r15 = rd(f"{I}/staged/item15B-split.tsv")
if r15:
    write("item15B-sets", [dict(item="#15B", **r) for r in r15])
# #7 E7-03
conv = {}
for n in ("e703_conv_t.tsv", "e703_conv_d.tsv", "e703_conv_d2.tsv"):
    p = f"{S}/{n}"
    if os.path.exists(p):
        for l in open(p):
            x = l.rstrip("\n").split("\t")
            conv[x[0]] = x
rows = []
for r in rd(f"{I}/e7-03-manifest.tsv"):
    x = conv.get(r["id"])
    r = {k: r[k] for k in ("id", "stratum", "class", "pxd", "instrument", "file", "bytes", "sha256", "conversion_route")}
    r["item"] = "#7"
    if x:
        r.update(stage_status=x[1], staged_raw=f"e7-03/{r['id']}/raw/{r['file']}", conv_rc=x[3],
                 fastag_input=("e7-03/" + x[4]) if x[4] and x[3] == "0" else "", fastag_input_bytes=x[5],
                 fastag_input_sha256=x[6], conversion_note=x[7])
        if x[3] == "NA": r["convertible_here"] = "no (SCIEX .wiff: msconvert on Windows)"
        elif x[3] == "0": r["convertible_here"] = "yes"
        else: r["convertible_here"] = f"FAILED rc {x[3]}"
    else:
        r.update(stage_status="NOT STAGED YET")
    rows.append(r)
write("item07-E7-03", rows)
