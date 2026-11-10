"""Score -species_call reports on the DEV runs (DEV only).
usage: score.py LABEL=GLOB_WITH_{run} [LABEL=...]   e.g. explain='/scratch/.../dev13/{run}/real/explain/species.tsv'
A glob containing 'alldecoy' is scored as the all-decoy arm (every present genus is false).
Per label: runs, false genera called present (total, per run, runs with any), true genera recovered / expected,
with 95 % intervals by bootstrap over runs, for all runs and for the fit / check halves (split by PXD: PXD accessions
sorted, alternating). 'strict' counts every non-truth genus as false; 'curated' leaves out the genera verified as
real material that the truth label omits (KNOWN below, see REASSESS.md). SCORE_ANALYZER=FTMS in the environment
restricts to the runs of that analyzer (devdump/<run>/meta.json)."""
import sys, csv, json, os
from pathlib import Path
import numpy as np
from load import manifest, parse_truth, CONTAM, DUMP
rng = np.random.default_rng(11)
KNOWN = {("PXD041573_Obp3", "Escherichia"), ("PXD016055_RPL3", "Escherichia"), ("PXD078382_Biotin2", "Pseudomonas"),
         ("PXD058521_fly", "Staphylococcus"), ("PXD058521_fly", "Pseudomonas")}
INDEXED = None

def present(path):
    out = []
    with open(path) as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            if r.get("call") == "present": out.append(r["name"].split()[0])
    return out

def ci(v):
    v = np.asarray(v, float)
    b = [rng.choice(v, len(v)).mean() for _ in range(4000)]
    return "%.2f [%.2f, %.2f]" % (v.mean(), np.percentile(b, 2.5), np.percentile(b, 97.5))

def ratio_ci(a, b):
    a = np.asarray(a, float); b = np.asarray(b, float)
    bs = []
    for _ in range(4000):
        i = rng.integers(0, len(a), len(a))
        if b[i].sum() > 0: bs.append(a[i].sum() / b[i].sum())
    return "%d/%d = %.2f [%.2f, %.2f]" % (a.sum(), b.sum(), a.sum() / max(b.sum(), 1), np.percentile(bs, 2.5), np.percentile(bs, 97.5))

if __name__ == "__main__":
    man = manifest()
    genera = set(l.strip() for l in open(Path(__file__).parent / "index_genera.txt"))
    pxds = sorted({man[r]["pxd"] for r in man})
    half = {p: ("fit" if i % 2 == 0 else "check") for i, p in enumerate(pxds)}
    for spec in sys.argv[1:]:
        label, pat = spec.split("=", 1)
        decoy = "alldecoy" in pat
        rows = []
        for run in sorted(man):
            p = Path(pat.format(run=run))
            if not p.exists(): continue
            if os.environ.get("SCORE_ANALYZER") and json.loads((DUMP / run / "meta.json").read_text()).get("analyzer") != os.environ["SCORE_ANALYZER"]: continue
            truth = parse_truth(man[run]["truth"]); human = "Homo" in truth
            exp = [g for g in truth if g in genera] if not decoy else []
            call = present(p)
            fs, fc, tp, detail = 0, 0, 0, []
            for g in call:
                if decoy: fs += 1; fc += 1; detail.append(g); continue
                if g in truth: tp += 1; continue
                if g in CONTAM or (g == "Homo" and not human): continue
                fs += 1; detail.append(g)
                if (run, g) not in KNOWN: fc += 1
            rows.append((run, half[man[run]["pxd"]], fs, fc, tp, len(exp), ",".join(detail), ",".join(g for g in exp if g not in call)))
        print(f"== {label}: {len(rows)} runs")
        for part in ("all", "fit", "check"):
            x = [r for r in rows if part == "all" or r[1] == part]
            if not x: continue
            fs = [r[2] for r in x]; fc = [r[3] for r in x]
            line = (f"  {part:5s} n {len(x):2d} | false/run strict {ci(fs)} (total {sum(fs)}, runs with any {sum(1 for v in fs if v)})"
                    f" | curated {ci(fc)} (total {sum(fc)}, runs with any {sum(1 for v in fc if v)})")
            if not decoy: line += " | true recovered " + ratio_ci([r[4] for r in x], [r[5] for r in x])
            print(line)
        for r in rows:
            if r[6] or r[7]: print(f"     {r[0]:26s} {r[1]:5s} false: {r[6] or '-':45s} missed: {r[7] or '-'}")
