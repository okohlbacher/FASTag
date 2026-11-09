#!/usr/bin/env python3
"""The scored held-out manifest (labeldisc-heldout.tsv) from heldout_A.tsv, heldout_B.tsv and the staging results of
part B (staged_B.tsv, then any retry files in order; the last result of a key wins). Every A and B row is included
(include = yes); a B row without a converted input keeps fastag_input '-' and is scored as a no call.
Usage: build_heldout_manifest.py <heldout_A.tsv> <heldout_B.tsv> <out.tsv> <staged_B.tsv> [retry.tsv ...]"""
import csv, sys
A, B, OUT = sys.argv[1:4]
STAGED = sys.argv[4:]
RA = "/scratch/kohlbach/fastag-heldout-1.12"
RB = "/scratch/kohlbach/fastag-labeldisc/heldout/in"
st = {}
for p in STAGED:
    for line in open(p):
        f = line.rstrip("\n").split("\t")
        if len(f) >= 8: st[f[0]] = f
rows = []
for r in csv.DictReader(open(A), delimiter="\t"):
    rows.append(dict(id=f"{r['pxd']}__{r['run']}", pxd=r["pxd"], label_class=r["label_class"], include="yes", part="A",
                     stratum=r["stratum"], instrument=r["instrument"], label_truth=r["label_truth"], root=RA,
                     fastag_input=r["fastag_input"], fastag_input_sha256=r["fastag_input_sha256"], stage_status="item08"))
for r in csv.DictReader(open(B), delimiter="\t"):
    k = f"{r['pxd']}__{r['run']}"
    f = st.get(k)
    ok = f is not None and f[4] == "0" and f[5] and f[7]
    rows.append(dict(id=k, pxd=r["pxd"], label_class=r["label_class"], include="yes", part="B", stratum=r["stratum"],
                     instrument=r["instrument"], label_truth=r["label_truth"], root=RB,
                     fastag_input=f[5] if ok else "-", fastag_input_sha256=f[7] if ok else "-",
                     stage_status=(f[2] + ";conv_rc=" + f[4]) if f else "NOT_STAGED"))
with open(OUT, "w") as o:
    o.write("# labeldisc held-out set: heldout_A.tsv (item08-heldout rows) + heldout_B.tsv (new labelled draw), staged\n")
    w = csv.DictWriter(o, fieldnames=list(rows[0].keys()), delimiter="\t", lineterminator="\n"); w.writeheader(); w.writerows(rows)
print(len(rows), "rows;", sum(r["fastag_input"] == "-" for r in rows), "without input")
