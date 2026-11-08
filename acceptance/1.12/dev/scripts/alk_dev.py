#!/usr/bin/env python3
"""#3g DEV check (no fit: n_min 10 and s_min 0.6 are the plan's frozen values): the -alkylation_out call of the C pass
(RC a117801, database = the run's prose-auto panel FASTA through -recon_fasta) against the SDRF alkylation truth
(alk_truth: Carbamidomethyl, Methylthio, none; '-' not evaluable). Reports accuracy with no-call counted wrong, the
always-CAM baseline, called accuracy and the 'none' recall the plan checks on the DEV 'none' runs before the rule
is frozen (PLAN-organism-chemistry #3g).
Usage: alk_dev.py <repo> <runs dir> <check tsv> <out tsv> [pass: C (default) or A, the whole-run pass]"""
import csv, math, sys
from pathlib import Path

REPO, RUNS, CHECK, OUT = sys.argv[1:5]
PASS = sys.argv[5] if len(sys.argv) > 5 else "C"
ok = {r["run_id"] for r in csv.DictReader(open(CHECK), delimiter="\t") if r["result"] == "PASS"}
truth = {}
for r in csv.DictReader((l for l in open(f"{REPO}/acceptance/1.12/inputs/sdrf_truth_runs.tsv") if not l.startswith("# ")),
                        delimiter="\t"):
    truth[f"{r['set']}__{r['acc']}__{r['run']}"] = r["alk_truth"]


def wilson(k, n, z=1.959963984540054):
    if n == 0:
        return float("nan")
    ph = k / n
    d = 1 + z * z / n
    return max(0.0, (ph + z * z / (2 * n)) / d - z * math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n)) / d)


rows = []
for k in sorted(ok):
    t = truth.get(k, "")
    f = Path(RUNS) / k / f"{PASS}.alkylation.tsv"
    if not f.exists():
        rows.append((k, t, "no_report", "-"))
        continue
    rep = {}
    for line in open(f):
        p = line.rstrip("\n").split("\t")
        if len(p) >= 3:
            rep[(p[0], p[1])] = p[2]
    st = rep.get(("alkylation_call", "status"))
    call = rep.get(("alkylation_call", "reagent")) if st == "call" else "no_call"
    rows.append((k, t, call, rep.get(("alkylation_call", "reason"), "-")))
with open(OUT, "w") as o:
    o.write("run\talk_truth\tcall\treason\n")
    for r in rows:
        o.write("\t".join(r) + "\n")
ev = [(t, c) for _, t, c, _ in rows if t in ("Carbamidomethyl", "Methylthio", "none") and c != "no_report"]
n = len(ev)
corr = sum(1 for t, c in ev if t == c)
called = [(t, c) for t, c in ev if c != "no_call"]
kc = sum(1 for t, c in called if t == c)
cam = sum(1 for t, _ in ev if t == "Carbamidomethyl")
none = [(t, c) for t, c in ev if t == "none"]
kn = sum(1 for t, c in none if c == "none")
print(f"evaluable {n} (no C pass for {sum(1 for r in rows if r[2] == 'no_report')} DEV runs)")
print(f"accuracy (no-call wrong) {corr / n:.4f}; always-CAM baseline {cam / n:.4f}")
print(f"called {len(called)}, correct {kc}, called accuracy {kc / max(1, len(called)):.4f} (Wilson LB {wilson(kc, len(called)):.4f})")
print(f"'none' recall {kn}/{len(none)} = {kn / max(1, len(none)):.4f}")
