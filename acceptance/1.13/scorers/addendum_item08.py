#!/usr/bin/env python3
"""Backlog #8 addendum A1 (PREREG-item08-addendum.md): POST HOC, DESCRIPTIVE ONLY, no pass/fail.
Committed after the held-out run finished and before score_item08.py was run. Reads only the runs.tsv that
score_item08.py writes (label_call rows of label.tsv; no digest.tsv, no log.txt).
  D1 few-tag subset F: runs whose CFG-08-base basis is `few_tags` (the 1.12 rule's < 175 C-terminal ends).
     On F report the truth composition and, for CFG-08-cand: correct, spurious label (a non-label-free call
     whose class differs from the truth; on label-free truth this is a false label), missed label (label-free
     call on labelled truth), no call.
  D2 complement (not few_tags): runs where the cand call differs from the base call. Expected 0 by
     construction (same binary, same rules once >= 175 ends); a non-zero value is reported as found.
Usage: addendum_item08.py <runs.tsv from score_item08.py> <out json>"""
import csv
import json
import sys

src, out = sys.argv[1:3]
rows = list(csv.DictReader(open(src), delimiter="\t"))
F = [r for r in rows if r["CFG-08-base_basis"] == "few_tags"]
NF = [r for r in rows if r["CFG-08-base_basis"] != "few_tags"]
LF = "label-free"


def kind(r):
    c, t = r["CFG-08-cand"], r["label_class"]
    if c == "no call":
        return "no_call"
    if c == t:
        return "correct"
    if c != LF:
        return "spurious_label"
    return "missed_label"


d1 = {"n": len(F), "truth": {}, "cand": {}, "false_label_on_label_free_truth": 0, "label_free_truth_n": 0}
for r in F:
    d1["truth"][r["label_class"]] = d1["truth"].get(r["label_class"], 0) + 1
    k = kind(r)
    d1["cand"][k] = d1["cand"].get(k, 0) + 1
    if r["label_class"] == LF:
        d1["label_free_truth_n"] += 1
        d1["false_label_on_label_free_truth"] += r["CFG-08-cand"] not in (LF, "no call")
d1["spurious_runs"] = [f"{r['pxd']}__{r['run']}:{r['label_class']}->{r['CFG-08-cand']}" for r in F
                       if kind(r) == "spurious_label"]
d2 = {"n": len(NF), "cand_differs_from_base": sum(r["CFG-08-cand"] != r["CFG-08-base"] for r in NF)}
S = {"status": "post hoc, descriptive, no pass/fail", "D1_few_tag_subset": d1, "D2_not_few_tags": d2}
json.dump(S, open(out, "w"), indent=1)
print(json.dumps(S, indent=1))
