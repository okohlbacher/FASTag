#!/usr/bin/env python3
"""Split the wrong headers (truth charge != header) by the chimera-mode Sage run: does a second peptide carry the header charge?
Usage: hc_chimera.py label=hc.tsv,truth.sage.tsv,chimera.sage.tsv ...   (truth q<=0.001, chimera PSM q<=0.01)"""
import csv, re, sys
from collections import defaultdict
SCAN = re.compile(r"scan=(\d+)"); key = lambda s: (SCAN.search(s).group(1) if SCAN.search(s) else s)
T = dict(n=0, w=0, co=0, fl=0, tp=0, tp_co=0, fp=0)
for spec in sys.argv[1:]:
    label, p = spec.split("=", 1); hc, sage, chim = p.split(",")
    truth = {}
    for r in csv.DictReader(open(sage), delimiter="\t"):
        if float(r["spectrum_q"]) <= 0.001 and int(r["label"]) == 1 and r.get("rank", "1") in ("", "1"): truth.setdefault(key(r["scannr"]), int(r["charge"]))
    ch = defaultdict(set)
    for r in csv.DictReader(open(chim), delimiter="\t"):
        if float(r["spectrum_q"]) <= 0.01 and int(r["label"]) == 1: ch[key(r["scannr"])].add(int(r["charge"]))
    c = dict.fromkeys(T, 0)
    for r in csv.DictReader(open(hc), delimiter="\t"):
        k = key(r["native_id"]); h = int(r["header_charge"])
        if not 1 <= h <= 4 or k not in truth: continue
        c["n"] += 1; wrong = truth[k] != h; co = wrong and h in ch[k]; f = r["verdict"] == "disagree"
        c["w"] += wrong; c["co"] += co; c["fl"] += f; c["tp"] += f and wrong; c["tp_co"] += f and co; c["fp"] += f and not wrong
    for k in T: T[k] += c[k]
    c["label"] = label; rows = [c] if "rows" not in dir() else rows + [c]
rows.append(dict(T, label="ALL"))
print("run\ttruth\twrong\twrong_coisolated\twrong_strict\tflagged\ttp\ttp_strict\tfp\tsens\tsens_strict\tprec\tprec_strict\tfalse_alarm")
for c in rows:
    ws = c["w"] - c["co"]; tps = c["tp"] - c["tp_co"]; d = lambda a, b: f"{a/b:.3f}" if b else "-"
    # strict: co-isolated cases are neither wrong headers nor false flags
    print("\t".join(map(str, [c["label"], c["n"], c["w"], c["co"], ws, c["fl"], c["tp"], tps, c["fp"], d(c["tp"], c["w"]), d(tps, ws), d(c["tp"], c["fl"]), d(tps, tps + c["fp"]), d(c["fp"], c["n"] - c["w"])])))
