#!/usr/bin/env python3
"""Markdown tables for P5-taxonomy-benchmark.md from compare_indexes.py output.

Usage: report_tables.py <per_run_calls.tsv> [REF CAND...]   (default SHIP B Bnw S50)
Prints one per-run table per setting (headline call per index; a call that
differs from REF is in bold) and the per-setting change and correctness counts.
"""
import csv
import sys
from collections import defaultdict

path = sys.argv[1]
cfgs = sys.argv[2:] or ["SHIP", "B", "Bnw", "S50"]
ref = cfgs[0]
rows = list(csv.DictReader(open(path), delimiter="\t"))
truth = lambda r: {p.split("=")[0] for p in r["truth"].split(";") if p}

counts = defaultdict(lambda: defaultdict(int))
for arm in ["default", "deconv", "gapped", "all"]:
    sub = [r for r in rows if r["arm"] == arm]
    print(f"\n#### Setting `{arm}`\n")
    print("| Run | Truth | Paper (1.9.0) | " + " | ".join(cfgs) + " |")
    print("|---|---|---|" + "---|" * len(cfgs))
    for r in sub:
        t = truth(r)
        cells = []
        for c in cfgs:
            h = r[f"{c}_headline"]
            top1 = r[f"{c}_top1"]
            ok = top1 in t
            counts[(c, arm)]["correct"] += ok
            changed = c != ref and (h != r[f"{ref}_headline"] or top1 != r[f"{ref}_top1"])
            counts[(c, arm)]["changed"] += changed
            if c != ref and r.get(f"{c}_table_identical") == "no":
                counts[(c, arm)]["table"] += 1
            s = h + ("" if ok else " ✗")
            cells.append(f"**{s}**" if changed else s)
        tr = r["truth"].replace(";", ", ")
        p = r["paper_v190_top1"]
        print(f"| {r['run_id']} | {tr} | {p} | " + " | ".join(cells) + " |")

print("\n#### Counts (48 runs per setting)\n")
print("| Index | Setting | Headline calls changed vs " + ref + " | Visible tables changed | Top-1 in truth |")
print("|---|---|---|---|---|")
for c in cfgs:
    for arm in ["default", "deconv", "gapped", "all"]:
        k = counts[(c, arm)]
        print(f"| {c} | {arm} | {k['changed'] if c != ref else '-'} | {k['table'] if c != ref else '-'} | {k['correct']}/48 |")
