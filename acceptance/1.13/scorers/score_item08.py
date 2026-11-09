#!/usr/bin/env python3
"""Backlog #8 held-out scorer (PREREG-item08.md). Scores the label_call rows of CFG-08-cand and CFG-08-base.

Denominator: every `include = yes` row of the manifest. Truth: its label_class (SDRF, fixed at the draw;
TMTpro and iTRAQ8 one class). A run counts as called when its label.tsv has `label_call status call`; the
called class is the `label_call label` value (TMTpro -> TMTpro/iTRAQ8). A no call, a missing or failed run
(rc != 0, no label.tsv) and an input that failed its sha256 check all count as wrong ("no call").
  E1 (primary): accuracy(CFG-08-cand) >= majority + 0.05, majority = share of the most frequent truth class
      over the denominator.
  E2: correct(CFG-08-cand) >= correct(CFG-08-base) on the same runs (paired).
Descriptive only: Wilson 95% CIs, called accuracy, per-class recall, balanced accuracy, discordant pairs and
the exact two-sided sign test.
Usage: score_item08.py <manifest> <runs root> <out dir>"""
import csv
import json
import math
import os
import sys

man, runs, out = sys.argv[1:4]
CFGS = ("CFG-08-cand", "CFG-08-base")
CLS = {"TMTpro": "TMTpro/iTRAQ8", "iTRAQ8": "TMTpro/iTRAQ8"}
MARGIN = 0.05


def wilson(k, n, z=1.959964):
    if n == 0:
        return [None, None]
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(c - h, 4), round(c + h, 4)]


def sign_p(a, b):
    n, k = a + b, min(a, b)
    if n == 0:
        return 1.0
    return min(1.0, 2 * sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n)


def call(cfg, r, verified):
    if verified.get((r["pxd"], r["run"])) != "OK":
        return "no call", "input_not_verified"
    d = f"{runs}/{cfg}/{r['pxd']}__{r['run']}"
    try:
        rc = int(open(f"{d}/rc.txt").read().strip())
    except (OSError, ValueError):
        return "no call", "not_run"
    if rc != 0:
        return "no call", f"rc_{rc}"
    lc = {}
    try:
        for line in open(f"{d}/label.tsv"):
            f = line.rstrip("\n").split("\t")
            if len(f) >= 3 and f[0] == "label_call":
                lc[f[1]] = f[2]
    except OSError:
        return "no call", "no_label_tsv"
    if lc.get("status") != "call":
        return "no call", lc.get("reason", "no_label_call_rows")
    return CLS.get(lc["label"], lc["label"]), "call"


rows = [r for r in csv.DictReader((l for l in open(man) if not l.startswith("# ")), delimiter="\t")
        if r["include"] == "yes"]
verified = {}
vf = f"{runs}/inputs_verified.tsv"
if os.path.exists(vf):
    for v in csv.DictReader(open(vf), delimiter="\t"):
        verified[(v["pxd"], v["run"])] = v["result"]
n = len(rows)
truth = [r["label_class"] for r in rows]
classes = sorted(set(truth))
maj_class = max(classes, key=lambda c: (truth.count(c), c))
maj = truth.count(maj_class) / n
calls = {c: [call(c, r, verified) for r in rows] for c in CFGS}
S = {"n": n, "majority_class": maj_class, "majority_share": round(maj, 4), "margin": MARGIN, "configs": {}}
for c in CFGS:
    lab = [x[0] for x in calls[c]]
    ok = [a == t for a, t in zip(lab, truth)]
    called = [a != "no call" for a in lab]
    per = {k: {"n": truth.count(k), "correct": sum(o for o, t in zip(ok, truth) if t == k)} for k in classes}
    for k in per:
        per[k]["recall"] = round(per[k]["correct"] / per[k]["n"], 4)
        per[k]["ci"] = wilson(per[k]["correct"], per[k]["n"])
    conf = {}
    for t, a in zip(truth, lab):
        conf.setdefault(t, {}).setdefault(a, 0)
        conf[t][a] += 1
    kc = sum(ok)
    S["configs"][c] = {"correct": kc, "accuracy": round(kc / n, 4), "accuracy_ci": wilson(kc, n),
                       "called": sum(called), "called_correct": sum(o for o, cl in zip(ok, called) if cl),
                       "called_accuracy": round(sum(o for o, cl in zip(ok, called) if cl) / max(sum(called), 1), 4),
                       "balanced_accuracy": round(sum(p["recall"] for p in per.values()) / len(per), 4),
                       "per_class": per, "confusion": conf,
                       "reasons": {k: [x[1] for x in calls[c]].count(k) for k in sorted({x[1] for x in calls[c]})}}
a = S["configs"]["CFG-08-cand"]
b = S["configs"]["CFG-08-base"]
okc = [x[0] == t for x, t in zip(calls["CFG-08-cand"], truth)]
okb = [x[0] == t for x, t in zip(calls["CFG-08-base"], truth)]
cand_only, base_only = sum(x and not y for x, y in zip(okc, okb)), sum(y and not x for x, y in zip(okc, okb))
S["E1"] = {"rule": "accuracy(CFG-08-cand) >= majority_share + 0.05", "value": a["accuracy"],
           "threshold": round(maj + MARGIN, 4), "result": "PASS" if a["correct"] / n >= maj + MARGIN - 1e-12 else "FAIL"}
S["E2"] = {"rule": "correct(CFG-08-cand) >= correct(CFG-08-base)", "cand": a["correct"], "base": b["correct"],
           "cand_right_base_wrong": cand_only, "base_right_cand_wrong": base_only,
           "sign_test_p_descriptive": sign_p(cand_only, base_only),
           "result": "PASS" if a["correct"] >= b["correct"] else "FAIL"}
S["overall"] = "PASS" if S["E1"]["result"] == "PASS" and S["E2"]["result"] == "PASS" else "FAIL"
os.makedirs(out, exist_ok=True)
json.dump(S, open(f"{out}/summary.json", "w"), indent=1)
with open(f"{out}/runs.tsv", "w") as fh:
    fh.write("pxd\trun\tstratum\tlabel_class\t" + "\t".join(f"{c}\t{c}_basis" for c in CFGS) + "\n")
    for i, r in enumerate(rows):
        fh.write(f"{r['pxd']}\t{r['run']}\t{r['stratum']}\t{truth[i]}\t" +
                 "\t".join(f"{calls[c][i][0]}\t{calls[c][i][1]}" for c in CFGS) + "\n")
print(json.dumps({k: S[k] for k in ("n", "majority_class", "majority_share", "E1", "E2", "overall")}, indent=1))
for c in CFGS:
    x = S["configs"][c]
    print(c, x["correct"], "/", n, x["accuracy"], x["accuracy_ci"], "called", x["called"], "bal", x["balanced_accuracy"])
