"""RUNS_TSV for score_silac_v2.py: each frozen run -> its harness task's label.tsv (empty when absent).
Usage: python3 -I build_runs.py BENCH_ROOT MANIFEST OUT_TSV"""
import csv, glob, json, os, sys
root, man, out = sys.argv[1:4]
task = {}
for p in sorted(glob.glob(os.path.join(root, "plans", "silac-heldout-v2-PXD*.json")), key=os.path.getmtime):
    if p.endswith(".workers.json"): continue
    for t in json.load(open(p))["tasks"]:
        task[(t["dataset"], t["input"])] = os.path.join(root, "tasks", t["id"])
with open(out, "w") as f:
    f.write("pxd\tfile\tlabel_tsv\n")
    for r in csv.DictReader(open(man), delimiter="\t"):
        if r["role"] != "run": continue
        d = task.get((r["pxd"], r["file"]))
        lt = os.path.join(d, "label.tsv") if d and os.path.exists(os.path.join(d, "label.tsv")) else ""
        f.write(f"{r['pxd']}\t{r['file']}\t{lt}\n")
