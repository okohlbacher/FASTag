#!/usr/bin/env python3
"""DEV-only test of score_item08.py: lays the in-sample DEV regeneration (the 193 label-evaluable runs of
inputs/item08_dev_label_call.tsv, re-run with the frozen binary at the default = CFG-08-cand and at
-label_call_min_tags 175 = CFG-08-base) out as the held-out runs root and writes a DEV manifest in the
item08 format. Expected: CFG-08-cand 178/193 (the harness termini count), CFG-08-base 150/193 (FASTag 1.12's
label_call), majority 159/193.
Usage: dev_item08.py <item08_dev_label_call.tsv> <dev reports dir (<run>/B0.label.tsv, B175.label.tsv)> <out root>"""
import csv
import os
import sys

truthf, dev, root = sys.argv[1:4]
CLS = {"TMTpro": "TMTpro/iTRAQ8", "iTRAQ8": "TMTpro/iTRAQ8"}
rows = [r for r in csv.DictReader((l for l in open(truthf) if not l.startswith("#")), delimiter="\t")
        if r["evaluable"] == "True"]
os.makedirs(root, exist_ok=True)
with open(f"{root}/dev_manifest.tsv", "w") as fh:
    fh.write("# DEV only (in-sample)\n")
    fh.write("item\tsplit\tpxd\trun\tstratum\tinstrument\tlabel_truth\tlabel_class\tfastag_input\t"
             "fastag_input_sha256\tstage_status\tinclude\n")
    for r in rows:
        fh.write(f"#8\tdev\t{r['set']}__{r['acc']}\t{r['run']}\t{r['set']}\t-\t{r['label_truth']}\t"
                 f"{CLS.get(r['label_truth_class'], r['label_truth_class'])}\t-\t-\t-\tyes\n")
os.makedirs(f"{root}/runs", exist_ok=True)
with open(f"{root}/runs/inputs_verified.tsv", "w") as fh:
    fh.write("pxd\trun\tpath\tsha256_manifest\tsha256_found\tresult\n")
    for r in rows:
        fh.write(f"{r['set']}__{r['acc']}\t{r['run']}\t-\t-\t-\tOK\n")
for cfg, arm in (("CFG-08-cand", "B0"), ("CFG-08-base", "B175")):
    for r in rows:
        name = f"{r['set']}__{r['acc']}__{r['run']}"
        d = f"{root}/runs/{cfg}/{name}"
        os.makedirs(d, exist_ok=True)
        src = f"{dev}/{name}/{arm}.label.tsv"
        if os.path.exists(src):
            with open(src) as a, open(f"{d}/label.tsv", "w") as b:
                b.write(a.read())
            open(f"{d}/rc.txt", "w").write("0\n")
print(len(rows), "DEV runs laid out under", root)
