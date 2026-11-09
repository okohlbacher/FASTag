#!/usr/bin/env python3
"""#15B round 2: PRIDE v3 project metadata (organisms, experiment types, protocols) of the candidate projects at
and after <from_order> in cand_15b.tsv, cached as <cache>/<PXD>.project.json. Retries HTML/error answers.
Usage: pride_meta_15b_r2.py <cand_15b.tsv> <from_order> <cache> <out.tsv>"""
import csv, json, os, sys, time, urllib.request

CAND, FROM, CACHE, OUT = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
os.makedirs(CACHE, exist_ok=True)
seen = []
for r in csv.DictReader(open(CAND), delimiter="\t"):
    if r["order"] != "-" and int(r["order"]) >= FROM and r["pxd"] not in seen: seen.append(r["pxd"])

def get(acc):
    p = f"{CACHE}/{acc}.project.json"
    if os.path.exists(p): return json.load(open(p))
    for a in range(8):
        try:
            with urllib.request.urlopen(f"https://www.ebi.ac.uk/pride/ws/archive/v3/projects/{acc}", timeout=90) as h:
                d = json.loads(h.read())
            json.dump(d, open(p, "w")); return d
        except Exception:
            time.sleep(10 * (a + 1))
    return None

with open(OUT, "w") as o:
    o.write("pxd\torganisms\texperiment_types\tsoftware\ttitle\n")
    for acc in seen:
        d = get(acc)
        if d is None: o.write(f"{acc}\tFETCH_FAILED\t\t\t\n"); continue
        nm = lambda k: ";".join((x.get("name") or "") for x in (d.get(k) or []) if isinstance(x, dict))
        o.write("\t".join([acc, nm("organisms"), nm("experimentTypes"), nm("softwares"),
                           " ".join((d.get("title") or "").split())[:120]]) + "\n"); o.flush()
print("done")
