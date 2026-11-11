"""Oracle table v2 from the compact cache (prep.py): per run/arm/genus the exclusive count given the true genera S
(empty for alldecoy), at two units: spectra (as oracle.py) and distinct tags. DEV only.
usage: oracle2.py CACHE OUT.tsv"""
import pickle, sys
from pathlib import Path
import numpy as np
from load import manifest, parse_truth, CONTAM
man = manifest()
out = open(sys.argv[2], "w")
out.write("run\tarm\tgenus\tstatus\to\tu\tkd\tto\ttu\ttkd\tn_spec\n")
for p in sorted(Path(sys.argv[1]).glob("*.pkl")):
    d = pickle.load(open(p, "rb"))
    run, arm, gn = d["run"], d["arm"], d["genera"]
    truth = parse_truth(man[run]["truth"]); human = "Homo" in truth
    def status(x):
        if arm == "alldecoy": return "negative"
        if x in truth: return "positive"
        if x in CONTAM or (x == "Homo" and not human): return "excluded"
        return "negative"
    S = frozenset(i for i, x in enumerate(gn) if status(x) == "positive")
    expl = {s for s, _, g in d["target"] if g & S}
    n = len(gn)
    def counts(units, mask):
        sp = [set() for _ in range(n)]; tg = [set() for _ in range(n)]
        for s, sid, g in units:
            if mask and s in expl: continue
            for i in g: sp[i].add(s); tg[i].add(sid)
        return [len(x) for x in sp], [len(x) for x in tg]
    o, to = counts(d["target"], False)
    u, tu = counts(d["target"], True)
    kd = [counts(k, True) for k in d["decoys"]]
    for i, x in enumerate(gn):
        out.write(f"{run}\t{arm}\t{x}\t{status(x)}\t{o[i]}\t{u[i]}\t{','.join(str(k[0][i]) for k in kd)}\t{to[i]}\t{tu[i]}\t{','.join(str(k[1][i]) for k in kd)}\t{d['n_spec']}\n")
